"""
discovery/crawler.py

Universal Iterative BFS Crawler for HPE SAN Discovery.

Algorithm:
  1. Seed one or more IPs.
  2. Fingerprint each device (HPE Array CLI / Linux / Windows).
  3. Execute the appropriate discovery command set.
  4. Parse all output — extract linked IPs and WWNs.
  5. Enqueue discovered IPs and repeat.
  6. Stream discovery events via SSE for the dashboard.
  7. Store everything in Neo4j + Elasticsearch.
"""
import os
import sys
import json
import time
import logging
import threading
import collections
from typing import List, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MONOREPO = os.path.dirname(BASE_DIR)
sys.path.insert(0, MONOREPO)
sys.path.insert(0, BASE_DIR)

from simulator.network_sim import virtual_network
from fingerprint import fingerprint_device, DeviceType
from parsers.sim_parser import parse_sim_array_output
from parsers.linux_parser import parse_linux_output
from parsers.windows_parser import parse_windows_output
from neo4j_store import Neo4jStore
from indexer import ElasticsearchIndexer

log = logging.getLogger(__name__)

# ── Discovery commands per device type ────────────────────────────────────────

HPE_COMMANDS = [
    "showsys",
    "shownode",
    "showport",
    "showswitch",
    "showhost",
    "showcage",
    "showcage -state",
    "showpd",
    "showpd -s",
    "showpd -i",
    "showversion -b",
    "lscpu",
]

LINUX_COMMANDS = [
    "uname -a",
    "cat /etc/os-release",
    "lsblk",
    "ip addr show",
    "multipath -ll",
    "dmidecode -s bios-version",
    "dmidecode -s system-product-name",
    "cat /proc/cpuinfo | grep 'model name' | head -1",
    "hostname",
]
for dev_node in ["/dev/sda", "/dev/sdb", "/dev/sdc", "/dev/sdd"]:
    LINUX_COMMANDS.append(f"smartctl -a {dev_node}")

WINDOWS_COMMANDS = [
    "Get-PhysicalDisk | Select-Object DeviceId, Model, FirmwareVersion, Size",
    "wmic bios get smbiosbiosversion",
    "Get-ComputerInfo",
    "Get-NetAdapter",
    "Get-HBaPort",
    "Get-WmiObject Win32_DiskDrive",
    "hostname",
]


# ── Discovery Engine ──────────────────────────────────────────────────────────

class DiscoveryCrawler:
    """
    BFS-based iterative discovery crawler.
    Traverses the virtual SAN network starting from seed IPs.
    Emits live events so the dashboard can animate the discovery.
    """

    def __init__(self, neo4j_store: Optional[Neo4jStore] = None,
                 es_indexer: Optional[ElasticsearchIndexer] = None):
        self.neo4j = neo4j_store
        self.es = es_indexer

        self.running = False
        self.events: List[dict] = []
        self._lock = threading.Lock()
        self.visited: set = set()
        self.queue: collections.deque = collections.deque()
        self.discovered_entities = []

    def _emit(self, event: dict):
        with self._lock:
            self.events.append(event)
        log.info(f"[crawler] {event.get('msg', event.get('type'))}")

    def cancel(self):
        """Cancel the running BFS discovery crawler."""
        with self._lock:
            if self.running:
                self.running = False
                log.info("[crawler] Cancel requested by API.")

    def discover(self, seed_ips: List[str], delay_ms: int = 20):
        """Start BFS discovery from one or more seed IPs."""
        with self._lock:
            self.running = True
            self.events = []
            self.visited = set()
            self.queue = collections.deque(seed_ips)
            self.discovered_entities = []
            self.delay_ms = delay_ms

        self._emit({"type": "start", "msg": f"Discovery started. Seeds: {seed_ips}"})

        while self.queue:
            with self._lock:
                if not self.running:
                    self._emit({"type": "cancelled", "msg": f"Discovery cancelled by user. Visited {len(self.visited)} devices."})
                    break
            ip = self.queue.popleft()
            if ip in self.visited:
                continue
            self.visited.add(ip)
            self._discover_device(ip)

        with self._lock:
            was_running = self.running
            self.running = False

        if was_running:
            self._emit({"type": "complete", "msg": f"Discovery complete. Visited {len(self.visited)} devices."})

    def _discover_device(self, ip: str):
        self._emit({"type": "connecting", "ip": ip, "msg": f"Connecting to {ip}..."})

        terminal = virtual_network.connect(ip)
        if terminal is None:
            self._emit({"type": "unreachable", "ip": ip, "msg": f"{ip}: Connection refused"})
            return

        # Fingerprint the device
        dev_type = fingerprint_device(ip, virtual_network)
        meta = virtual_network.get_metadata(ip)
        device_name = meta.get("name", ip)

        self._emit({
            "type": "connected",
            "ip": ip,
            "device_name": device_name,
            "device_type": dev_type.value,
            "msg": f"Connected to {device_name} ({dev_type.value}) @ {ip}",
        })

        # Execute the right command set
        if dev_type == DeviceType.HPE_ARRAY:
            raw_outputs = self._run_commands(ip, HPE_COMMANDS)
            parsed = parse_sim_array_output(raw_outputs)
            parsed["_ip"] = ip
            parsed["_device_type"] = "hpe_array"
            
            # Emit internal components for live plotting
            for node in parsed.get("nodes", []):
                self._emit({"type": "node_internal", "ip": ip, "node_id": node.get("node_id"), "label": node.get("name"), "node_type": "Node"})
            for port in parsed.get("ports", []):
                self._emit({"type": "node_internal", "ip": ip, "node_id": port.get("port_id"), "label": f"P{port.get('port_num')}", "node_type": "Port"})
                self._emit({"type": "edge_internal", "ip": ip, "source": ip, "target": port.get("port_id"), "label": "HAS_PORT"})
            for disk in parsed.get("drives", []):
                self._emit({"type": "node_internal", "ip": ip, "node_id": disk.get("pd_id"), "label": f"Disk {disk.get('pd_id')}", "node_type": "PhysicalDisk"})
                self._emit({"type": "edge_internal", "ip": ip, "source": ip, "target": disk.get("pd_id"), "label": "HAS_DISK"})

            new_ips = self._extract_linked_ips(parsed)
            self._emit({
                "type": "parsed",
                "ip": ip,
                "device_name": device_name,
                "device_type": "hpe_array",
                "entity_counts": {k: len(v) if isinstance(v, list) else 1
                                  for k, v in parsed.items() if not k.startswith("_")},
                "msg": f"Parsed {device_name}: {len(parsed.get('nodes',[]))} nodes, "
                       f"{len(parsed.get('drives',[]))} drives, {len(parsed.get('hosts',[]))} hosts",
            })

        elif dev_type == DeviceType.LINUX:
            raw_outputs = self._run_commands(ip, LINUX_COMMANDS)
            parsed = parse_linux_output(raw_outputs, ip=ip)
            parsed["_ip"] = ip
            parsed["_device_type"] = "linux_host"
            new_ips = []
            self._emit({
                "type": "parsed",
                "ip": ip,
                "device_name": device_name,
                "device_type": "linux_host",
                "msg": f"Parsed Linux host {device_name}: OS={parsed.get('os_name')}, "
                       f"BIOS={parsed.get('bios_version')}, {len(parsed.get('disks',[]))} disks",
            })

        elif dev_type == DeviceType.WINDOWS:
            raw_outputs = self._run_commands(ip, WINDOWS_COMMANDS)
            parsed = parse_windows_output(raw_outputs, ip=ip)
            parsed["_ip"] = ip
            parsed["_device_type"] = "windows_host"
            new_ips = []
            self._emit({
                "type": "parsed",
                "ip": ip,
                "device_name": device_name,
                "device_type": "windows_host",
                "msg": f"Parsed Windows host {device_name}: OS={parsed.get('os_name')}, "
                       f"BIOS={parsed.get('bios_version')}, {len(parsed.get('disks',[]))} disks",
            })
        else:
            self._emit({"type": "skip", "ip": ip, "msg": f"{ip}: Unknown device type, skipping"})
            return

        self.discovered_entities.append(parsed)

        # Persist to Neo4j
        if self.neo4j:
            try:
                self.neo4j.store(parsed)
                self._emit({"type": "neo4j_stored", "ip": ip, "msg": f"Stored {device_name} in Neo4j"})
            except Exception as e:
                self._emit({"type": "neo4j_error", "ip": ip, "msg": f"Neo4j error: {e}"})

        # Index in Elasticsearch
        if self.es:
            try:
                self.es.index(parsed)
                self._emit({"type": "es_indexed", "ip": ip, "msg": f"Indexed {device_name} in Elasticsearch"})
            except Exception as e:
                self._emit({"type": "es_error", "ip": ip, "msg": f"Elasticsearch error: {e}"})

        # Enqueue newly discovered IPs
        for new_ip in new_ips:
            if new_ip not in self.visited:
                self.queue.append(new_ip)
                self._emit({"type": "discovered_ip", "ip": new_ip, "source": ip,
                            "msg": f"Discovered new device IP: {new_ip} from {ip}"})

    def _run_commands(self, ip: str, commands: List[str]) -> dict:
        terminal = virtual_network.connect(ip)
        if not terminal:
            return {}
        
        outputs = {}
        for cmd in commands:
            output = terminal.execute(cmd)
            outputs[cmd] = output
            self._emit({
                "type": "command",
                "ip": ip,
                "command": cmd,
                "output_preview": output[:80] + "..." if len(output) > 80 else output,
                "msg": f"  [{ip}] > {cmd}",
            })
            if getattr(self, "delay_ms", 0) > 0:
                time.sleep(self.delay_ms / 1000.0)
        return outputs

    def _extract_linked_ips(self, parsed: dict) -> List[str]:
        """
        Extract all routable IPs from a parsed array entity.
        Looks in: connected_array_ips, switch IPs, host IPs.
        """
        ips = []
        # From connected arrays (from network topology metadata)
        ip = parsed.get("_ip", "")
        meta = virtual_network.get_metadata(ip) if hasattr(virtual_network, 'get_metadata') else {}
        ips.extend(meta.get("connected_array_ips", []))
        # From switches parsed
        for sw in parsed.get("switches", []):
            sw_name = sw.get("name", "")
            # Look up IP from network topology
            devices = virtual_network.list_devices()
            for d in devices:
                if d.get("name") == sw_name and d.get("ip"):
                    ips.append(d["ip"])
        # From hosts parsed out of showhost
        for h in parsed.get("hosts", []):
            h_name = h.get("name", "")
            devices = virtual_network.list_devices()
            for d in devices:
                if d.get("name") == h_name and d.get("ip"):
                    ips.append(d["ip"])
        return [x for x in ips if x and x not in self.visited]

    def get_status(self) -> dict:
        with self._lock:
            return {
                "running": self.running,
                "visited": list(self.visited),
                "queue": list(self.queue),
                "events": list(self.events),
                "entity_count": len(self.discovered_entities),
            }


# Singleton
discovery_crawler = DiscoveryCrawler()
