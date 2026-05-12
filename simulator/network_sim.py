"""
simulator/network_sim.py

Virtual network layer — replaces real TCP sockets with an in-process
routing table. Devices register themselves by IP; the crawler connects
by calling connect(ip) which returns the appropriate Terminal instance.

No real OS sockets are opened. All communication is in-process.
"""
import os
import threading
import requests
from typing import Dict, Optional

SIMULATOR_URL = os.environ.get("SIMULATOR_URL", "http://localhost:5001")

class VirtualNetwork:
    """
    Central routing table for the simulated SAN network.
    In the simulator process, it holds local Terminal instances.
    In the API process, it proxies calls to the simulator via REST.
    """

    def __init__(self):
        self._registry: Dict[str, object] = {}  # ip → terminal
        self._metadata: Dict[str, dict] = {}    # ip → device metadata
        self._lock = threading.Lock()

    def register(self, ip: str, terminal, metadata: dict = None):
        """Register a device terminal at a given IP."""
        with self._lock:
            self._registry[ip] = terminal
            self._metadata[ip] = metadata or {}

    def connect(self, ip: str) -> Optional[object]:
        """
        'Connect' to a device at the given IP.
        Returns a local Terminal or a RemoteProxyTerminal.
        """
        with self._lock:
            if ip in self._registry:
                return self._registry[ip]
        
        # If not local, try to see if it exists on the remote simulator
        try:
            # print(f"[network_sim] Checking remote simulator for {ip} at {SIMULATOR_URL}")
            resp = requests.get(f"{SIMULATOR_URL}/sim/devices", timeout=2.0) # Increased timeout
            if resp.ok:
                devices = resp.json()
                for d in devices:
                    if d["ip"] == ip:
                        return RemoteProxyTerminal(ip)
            else:
                print(f"[network_sim] Remote simulator returned status {resp.status_code}")
        except Exception as e:
            print(f"[network_sim] Remote simulator check failed: {e}")
        return None

    def execute(self, ip: str, command: str) -> str:
        """Execute a command on the device at ip. Returns output string."""
        terminal = self.connect(ip)
        if terminal is None:
            return f"ssh: connect to host {ip} port 22: Connection refused"
        
        if isinstance(terminal, RemoteProxyTerminal):
            return terminal.execute(command)
        return terminal.execute(command)

    def list_devices(self) -> list:
        """List all registered device IPs and their metadata."""
        # Try remote first if we are in proxy mode
        try:
            resp = requests.get(f"{SIMULATOR_URL}/sim/devices", timeout=0.5)
            if resp.ok:
                return resp.json()
        except Exception:
            pass

        with self._lock:
            return [
                {"ip": ip, **meta}
                for ip, meta in self._metadata.items()
            ]

    def get_metadata(self, ip: str) -> dict:
        # Try remote first
        devices = self.list_devices()
        for d in devices:
            if d["ip"] == ip:
                return d
        
        with self._lock:
            return self._metadata.get(ip, {})

    def unregister(self, ip: str):
        with self._lock:
            self._registry.pop(ip, None)
            self._metadata.pop(ip, None)

    def shutdown_all(self):
        with self._lock:
            for terminal in self._registry.values():
                try:
                    terminal.shutdown()
                except Exception:
                    pass
            self._registry.clear()
            self._metadata.clear()


class RemoteProxyTerminal:
    """Proxies execute() calls to the simulator's REST API."""
    def __init__(self, ip: str):
        self.ip = ip

    def execute(self, command: str, timeout: float = 5.0) -> str:
        try:
            # The simulator endpoint is /sim/exec/<ip>/<command>
            # We need to URL encode the command
            import urllib.parse
            safe_cmd = urllib.parse.quote(command)
            resp = requests.get(f"{SIMULATOR_URL}/sim/exec/{self.ip}/{safe_cmd}", timeout=timeout)
            if resp.ok:
                return resp.json().get("output", "")
            return f"Error: Simulator returned {resp.status_code}"
        except Exception as e:
            return f"Error: Failed to reach simulator proxy: {e}"

    def shutdown(self):
        pass


# Singleton — imported by simulator_manager and discovery crawler
virtual_network = VirtualNetwork()
