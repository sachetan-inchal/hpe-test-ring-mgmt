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
from mongo_store import MongoStore

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
    "showcage -pci",
    "showcage -sfp",
    "showpd",
    "showpd -s",
    "showpd -i",
    "showportdev ns -nohdtot 0:3:1",
    "showportdev ns -nohdtot 1:3:1",
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
                 es_indexer: Optional[ElasticsearchIndexer] = None,
                 mongo_store: Optional[MongoStore] = None):
        self.neo4j = neo4j_store
        self.es = es_indexer
        self.mongo = mongo_store

        self.running = False
        self.events: List[dict] = []
        self._lock = threading.Lock()
        self.visited: set = set()
        self.queue: collections.deque = collections.deque()
        self.discovered_entities = []

    def _emit(self, event: dict):
        with self._lock:
            self.events.append(event)
        etype = event.get('type')
        if etype not in ("node_internal", "edge_internal"):
            log.info(f"[crawler] {event.get('msg', etype)}")

    def cancel(self):
        """Cancel the running BFS discovery crawler."""
        with self._lock:
            if self.running:
                self.running = False
                log.info("[crawler] Cancel requested by API.")

    def _get_ssh_connector(self, ip: str):
        if not self.mongo or not self.mongo.available:
            return None
        try:
            db = self.mongo.client.hpe_san
            cred = db.ssh_credentials.find_one({"ip": ip})
            if cred:
                from api.integrations.device_connector import SSHConnector
                import base64
                key = os.environ.get("SECRET_ENCRYPTION_KEY", "HPE_SECRET_KEY_2026")
                enc_password = cred.get("password")
                try:
                    decoded = base64.b64decode(enc_password.encode("utf-8")).decode("utf-8", errors="ignore")
                    password = "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(decoded))
                except Exception:
                    password = enc_password
                username = cred.get("username", "root")
                port = int(cred.get("port", 22))
                return SSHConnector(host=ip, username=username, password=password, port=port)
        except Exception as e:
            log.warning(f"[crawler] Failed to fetch credentials for {ip} from MongoDB: {e}")
        return None

    def discover(self, seed_ips: List[str], delay_ms: int = 20, commands: Optional[List[str]] = None):
        """Start BFS discovery from one or more seed IPs."""
        with self._lock:
            self.running = True
            self.events = []
            self.visited = set()
            self.queue = collections.deque(seed_ips)
            self.discovered_entities = []
            self.delay_ms = delay_ms
            self.custom_commands = commands

        # Check if any seed IP is a real SSH device
        is_real_run = False
        if self.mongo and self.mongo.available:
            try:
                db = self.mongo.client.hpe_san
                for s_ip in seed_ips:
                    cred = db.ssh_credentials.find_one({"ip": s_ip})
                    if cred and cred.get("device_kind") == "real":
                        is_real_run = True
                        break
            except Exception:
                pass
        
        if self.mongo:
            self.mongo.is_real = is_real_run

        if self.mongo and self.mongo.available:
            self.mongo.load_existing_state()

        self._emit({"type": "start", "msg": f"Discovery started. Seeds: {seed_ips} (Real Mode: {is_real_run})"})

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
            if self.mongo and self.mongo.available:
                self.mongo.prune_and_sync_final_state()
            self._emit({"type": "complete", "msg": f"Discovery complete. Visited {len(self.visited)} devices."})

    def _discover_device(self, ip: str):
        self._emit({"type": "connecting", "ip": ip, "msg": f"Connecting to {ip}..."})

        # Get the name configured by the user as the default name
        configured_name = None
        if self.mongo and self.mongo.available:
            try:
                db = self.mongo.client.hpe_san
                cred = db.ssh_credentials.find_one({"ip": ip})
                if cred and cred.get("device_name"):
                    configured_name = cred.get("device_name")
            except Exception:
                pass

        ssh_connector = self._get_ssh_connector(ip)
        dev_type = DeviceType.UNKNOWN
        device_name = configured_name or ip
        connected_via_ssh = False

        if ssh_connector and ssh_connector.connect():
            self._emit({"type": "connecting", "ip": ip, "msg": f"SSH connection established to {ip}. Fingerprinting..."})
            connected_via_ssh = True
            # Probe showsys
            probe = ssh_connector.execute("showsys")
            if probe.get("exit_code") == 0 and any(kw in probe.get("stdout", "") for kw in ["TotalCap", "AllocCap", "Model", "Serial"]):
                dev_type = DeviceType.HPE_ARRAY
            else:
                # Probe uname -a
                probe = ssh_connector.execute("uname -a")
                if "Linux" in probe.get("stdout", ""):
                    dev_type = DeviceType.LINUX
                else:
                    probe_w = ssh_connector.execute("Get-ComputerInfo")
                    if "WindowsProductName" in probe_w.get("stdout", ""):
                        dev_type = DeviceType.WINDOWS
            
            # Resolve name for HPE devices or fallback to hostname CLI
            if dev_type == DeviceType.HPE_ARRAY:
                stdout = probe.get("stdout", "") if probe.get("exit_code") == 0 else ""
                if stdout:
                    for line in stdout.splitlines():
                        if "TotalCap" in line or "AllocCap" in line:
                            continue
                        parts = line.strip().split()
                        if len(parts) >= 2 and parts[0].startswith("0x"):
                            device_name = parts[1]
                            break
            else:
                # Check if it is a switch
                switch_probe = ssh_connector.execute("showswitch")
                if switch_probe.get("exit_code") == 0 and any(kw in switch_probe.get("stdout", "") for kw in ["Online", "Offline", "Native"]):
                    dev_type = DeviceType.HPE_ARRAY # Treat switches as HPE_ARRAY for parser flow
                    stdout = switch_probe.get("stdout", "")
                    for line in stdout.splitlines():
                        if "Online" in line or "Offline" in line:
                            parts = line.strip().split()
                            if parts:
                                device_name = parts[0]
                                break
                else:
                    # Run hostname to get the real device name for standard Linux/Windows hosts
                    hn_probe = ssh_connector.execute("hostname")
                    if hn_probe.get("exit_code") == 0:
                        stdout = hn_probe.get("stdout", "").strip()
                        if stdout and "not found" not in stdout.lower() and "error" not in stdout.lower():
                            device_name = stdout
            
            ssh_connector.disconnect()
            self._emit({
                "type": "connected",
                "ip": ip,
                "device_name": device_name,
                "device_type": dev_type.value,
                "msg": f"SSH connected to {device_name} ({dev_type.value}) @ {ip}",
            })

        if not connected_via_ssh:
            terminal = virtual_network.connect(ip)
            if terminal is None:
                self._emit({"type": "unreachable", "ip": ip, "msg": f"{ip}: Connection refused"})
                return

            dev_type = fingerprint_device(ip, virtual_network)
            meta = virtual_network.get_metadata(ip)
            device_name = meta.get("name", ip)

            self._emit({
                "type": "connected",
                "ip": ip,
                "device_name": device_name,
                "device_type": dev_type.value,
                "msg": f"Connected to simulated {device_name} ({dev_type.value}) @ {ip}",
            })

        # Execute the right command set
        cmd_list = self.custom_commands if self.custom_commands else HPE_COMMANDS
        if dev_type == DeviceType.HPE_ARRAY:
            raw_outputs = self._run_commands(ip, cmd_list)
            with self._lock:
                if not self.running:
                    return
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
            cmd_list = self.custom_commands if self.custom_commands else LINUX_COMMANDS
            raw_outputs = self._run_commands(ip, cmd_list)
            with self._lock:
                if not self.running:
                    return
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
            cmd_list = self.custom_commands if self.custom_commands else WINDOWS_COMMANDS
            raw_outputs = self._run_commands(ip, cmd_list)
            with self._lock:
                if not self.running:
                    return
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

        parsed["_is_real"] = connected_via_ssh
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

        # Sync to MongoDB for Chatbot Standard RAG
        if self.mongo:
            try:
                self.mongo.store(parsed)
                self._emit({"type": "mongo_stored", "ip": ip, "msg": f"Synced {device_name} to MongoDB"})
            except Exception as e:
                self._emit({"type": "mongo_error", "ip": ip, "msg": f"MongoDB error: {e}"})

        # Enqueue newly discovered IPs
        for new_ip in new_ips:
            if new_ip not in self.visited:
                self.queue.append(new_ip)
                self._emit({"type": "discovered_ip", "ip": new_ip, "source": ip,
                            "msg": f"Discovered new device IP: {new_ip} from {ip}"})

    def _run_commands(self, ip: str, commands: List[str]) -> dict:
        ssh_connector = self._get_ssh_connector(ip)
        if ssh_connector and ssh_connector.connect():
            self._emit({"type": "command_session_start", "ip": ip, "msg": f"Executing command checklist over SSH on {ip}..."})
            outputs = {}
            for cmd in commands:
                with self._lock:
                    if not self.running:
                        break
                res = ssh_connector.execute(cmd)
                output = res.get("stdout", "") + res.get("stderr", "")
                outputs[cmd] = output
                self._emit({
                    "type": "command",
                    "ip": ip,
                    "command": cmd,
                    "output": output,
                    "output_preview": output[:80] + "..." if len(output) > 80 else output,
                    "msg": f"  [{ip}] > {cmd}",
                })
                if getattr(self, "delay_ms", 0) > 0:
                    time.sleep(self.delay_ms / 1000.0)
            ssh_connector.disconnect()
            return outputs

        terminal = virtual_network.connect(ip)
        if not terminal:
            return {}
        
        outputs = {}
        for cmd in commands:
            with self._lock:
                if not self.running:
                    break
            output = terminal.execute(cmd)
            outputs[cmd] = output
            self._emit({
                "type": "command",
                "ip": ip,
                "command": cmd,
                "output": output,
                "output_preview": output[:80] + "..." if len(output) > 80 else output,
                "msg": f"  [{ip}] > {cmd}",
            })
            if getattr(self, "delay_ms", 0) > 0:
                time.sleep(self.delay_ms / 1000.0)
        return outputs

    def _extract_linked_ips(self, parsed: dict) -> List[str]:
        """
        Extract all connected IPs to visit next from a parsed array entity,
        ONLY if they are explicitly registered in the Inventory tab (MongoDB).
        """
        ips = []
        array_ip = parsed.get("_ip", "")
        array_name = parsed.get("name") or parsed.get("device_name", "")
        all_devices = virtual_network.list_devices()

        # Find the device metadata in simulator by name (casing & hyphen-insensitive)
        array_meta = {}
        cleaned_array_name = array_name.lower().replace("-", "")
        for d in all_devices:
            cleaned_d_name = d.get("name", "").lower().replace("-", "")
            if cleaned_d_name == cleaned_array_name:
                array_meta = d
                break

        if not array_meta:
            log.warning(f"[crawler] Could not find metadata for array '{array_name}' in simulator network topology.")
            return []

        # Fetch registered device names and IPs from MongoDB
        registered_device_ips = {}
        if self.mongo and self.mongo.available:
            try:
                db = self.mongo.client.hpe_san
                kind_filter = "real" if self.mongo.is_real else "mock"
                for cred in db.ssh_credentials.find({"device_kind": kind_filter}, {"device_name": 1, "ip": 1}):
                    if cred.get("device_name") and cred.get("ip"):
                        registered_device_ips[cred["device_name"].lower()] = cred["ip"]
            except Exception:
                pass

        # Determine parent team to inherit
        parent_team = "team-alpha"
        if self.mongo and self.mongo.available:
            try:
                db = self.mongo.client.hpe_san
                parent_cred = db.ssh_credentials.find_one({"ip": array_ip})
                if parent_cred and parent_cred.get("team"):
                    parent_team = parent_cred.get("team")
            except Exception:
                pass

        # 1. Peer arrays from the array's own metadata
        for peer_ip in array_meta.get("connected_to", []):
            peer_meta = {}
            for d in all_devices:
                if d.get("ip") == peer_ip:
                    peer_meta = d
                    break
            
            peer_name = peer_meta.get("name", "") or f"Peer-{peer_ip}"
            
            # Auto register peer array
            if self.mongo and self.mongo.available:
                try:
                    db = self.mongo.client.hpe_san
                    existing = db.ssh_credentials.find_one({"device_name": peer_name})
                    if not existing:
                        db.ssh_credentials.insert_one({
                            "device_name": peer_name,
                            "ip": "",
                            "port": 22,
                            "username": "",
                            "password": "",
                            "device_kind": "real",
                            "category": "Array",
                            "team": parent_team,
                            "connected_to": array_name,
                            "ip_pending": True,
                            "password_pending": True,
                            "username_pending": True
                        })
                        log.info(f"[crawler] Auto-registered discovered peer array {peer_name} in inventory as pending.")
                except Exception as ex:
                    log.warning(f"[crawler] Failed to auto-register peer array {peer_name}: {ex}")

            loopback_ip = registered_device_ips.get(peer_name.lower())
            if loopback_ip:
                ips.append(loopback_ip)

        # Build host→switch mapping from topology JSON (via_switch field)
        host_to_switch = {}
        try:
            import json as _json
            topo_path = os.path.join(os.path.dirname(__file__), "..", "san-lab", "network_topology.json")
            if not os.path.exists(topo_path):
                # Try relative from monorepo root
                topo_path = os.path.join(os.path.dirname(__file__), "..", "network_topology.json")
            if not os.path.exists(topo_path):
                # Try Docker path (inside container)
                topo_path = "/etc/san-lab/network_topology.json"
            if os.path.exists(topo_path):
                with open(topo_path) as f:
                    topo_data = _json.load(f)
                for arr in topo_data.get("arrays", []):
                    for h in arr.get("hosts", []):
                        via = h.get("via_switch", "")
                        if via:
                            host_to_switch[h["name"].lower()] = via
        except Exception as ex:
            log.debug(f"[crawler] Could not load host→switch map from topology JSON: {ex}")

        # 2. All switches and hosts that belong to this array
        for d in all_devices:
            parent = d.get("parent_array", "")
            if parent and parent.lower().replace("-", "") == cleaned_array_name:
                dev_name = d.get("name", "")
                if dev_name:
                    dtype = d.get("type", "host")
                    category = "Switch" if dtype == "switch" else "Host"

                    # Hosts connect to their switch; switches connect to the array
                    if category == "Host":
                        connected_to_val = host_to_switch.get(dev_name.lower(), array_name)
                    else:
                        connected_to_val = array_name

                    # Auto register connected switch or host
                    if self.mongo and self.mongo.available:
                        try:
                            db = self.mongo.client.hpe_san
                            existing = db.ssh_credentials.find_one({"device_name": dev_name})
                            if not existing:
                                db.ssh_credentials.insert_one({
                                    "device_name": dev_name,
                                    "ip": "",
                                    "port": 22,
                                    "username": "",
                                    "password": "",
                                    "device_kind": "real",
                                    "category": category,
                                    "team": parent_team,
                                    "connected_to": connected_to_val,
                                    "ip_pending": True,
                                    "password_pending": True,
                                    "username_pending": True
                                })
                                log.info(f"[crawler] Auto-registered {dev_name} (connected_to: {connected_to_val}) as pending.")
                            else:
                                # Update connected_to if it was incorrectly set to the array
                                old_ct = existing.get("connected_to", "")
                                if category == "Host" and old_ct == array_name and connected_to_val != array_name:
                                    db.ssh_credentials.update_one(
                                        {"device_name": dev_name},
                                        {"$set": {"connected_to": connected_to_val}}
                                    )
                                    log.info(f"[crawler] Corrected {dev_name} connected_to: {array_name} → {connected_to_val}")
                        except Exception as ex:
                            log.warning(f"[crawler] Failed to auto-register device {dev_name}: {ex}")

                    loopback_ip = registered_device_ips.get(dev_name.lower())
                    if loopback_ip:
                        ips.append(loopback_ip)

        # Fetch registered IPs from MongoDB (now includes newly registered ones)
        registered_ips = set()
        if self.mongo and self.mongo.available:
            try:
                db = self.mongo.client.hpe_san
                kind_filter = "real" if self.mongo.is_real else "mock"
                for cred in db.ssh_credentials.find({"device_kind": kind_filter}, {"ip": 1}):
                    if cred.get("ip"):
                        registered_ips.add(cred["ip"])
            except Exception:
                pass

        # Only enqueue if the discovered IP is registered in MongoDB and not visited
        return [x for x in ips if x and x in registered_ips and x not in self.visited]


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
# Note: we inject stores into the singleton later if needed, or instantiate them directly.
# By default, crawler initializes its own stores if not provided.
discovery_crawler = DiscoveryCrawler()
