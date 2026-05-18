"""
discovery/mongo_store.py

MongoDB store for the discovery engine.
Stores the discovered SAN entities in a format compatible with the Chatbot's
Mongoose SANData schema, fully mapping all parsed parameters.
"""
import os
import logging
from datetime import datetime
try:
    from pymongo import MongoClient
except ImportError:
    MongoClient = None

log = logging.getLogger(__name__)

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/hpe_san")


class MongoStore:
    def __init__(self, uri=MONGO_URI):
        self.uri = uri
        self.client = None
        self.db = None
        self._available = False
        
        # In-memory representations to build the single document
        self.nodes = {}
        self.edges = set()
        
        self._init_client()

    def _init_client(self):
        if MongoClient is None:
            log.debug("[mongo] pymongo is not installed, standard RAG sync is skipped.")
            return
            
        try:
            self.client = MongoClient(self.uri, serverSelectionTimeoutMS=2000)
            self.client.admin.command('ping')
            self.db = self.client.get_database()
            self._available = True
            log.info(f"[mongo] Connected to {self.uri}")
        except Exception as e:
            log.warning(f"[mongo] Connection failed: {e}")
            self._available = False

    def _normalize_status(self, status: str) -> str:
        if not status:
            return "normal"
        s = str(status).lower()
        if s in ["normal", "degraded", "failed", "offline", "ok"]:
            return s
        if "ok" in s or "ready" in s or "online" in s or "up" in s or "logged_in" in s or "qualified" in s:
            return "normal"
        if "loss" in s or "warning" in s or "degraded" in s or "no_light" in s:
            return "degraded"
        if "fail" in s or "error" in s:
            return "failed"
        return "offline"

    def store(self, parsed: dict):
        if not self._available:
            return
            
        dtype = parsed.get("_device_type", "")
        if dtype == "hpe_array":
            self._store_array(parsed)
        elif dtype in ("linux_host", "windows_host"):
            self._store_host(parsed)
            
        self._sync_to_db()

    def _store_array(self, p: dict):
        ip = p.get("_ip", "")
        
        # 1. ArraySystem
        array_id = ip
        tc_tb = p.get("total_cap_mib", 0) / 1048576.0 if p.get("total_cap_mib") else 0
        fc_tb = p.get("free_cap_mib", 0) / 1048576.0 if p.get("free_cap_mib") else 0
        ac_tb = p.get("alloc_cap_mib", 0) / 1048576.0 if p.get("alloc_cap_mib") else 0
        fac_tb = p.get("failed_cap_mib", 0) / 1048576.0 if p.get("failed_cap_mib") else 0
        
        self.nodes[array_id] = {
            "id": array_id,
            "name": p.get("name", "Unknown Array"),
            "type": "Array",
            "status": self._normalize_status("normal"),
            "category": "main",
            "model": p.get("model", ""),
            "serialNumber": p.get("serial", ""),
            "firmware": p.get("release_version", ""),
            "releaseType": p.get("release_type", ""),
            "totalCapacityTb": round(tc_tb, 4),
            "usedCapacityTb": round(ac_tb, 4),
            "freeCapacityTb": round(fc_tb, 4),
            "failedCapacityTb": round(fac_tb, 4),
            "nodeCount": p.get("node_count", 0),
            "masterNode": p.get("master_node", 0),
            "configType": p.get("config_type", ""),
            "protocolsSupported": p.get("protocols_supported", []),
            "ipAddress": ip
        }

        # 2. Nodes (Controllers)
        for n in p.get("nodes", []):
            nid = f"{ip}_N{n.get('node_id')}"
            self.nodes[nid] = {
                "id": nid,
                "name": n.get("name", nid),
                "type": "Node",
                "status": self._normalize_status("normal"),
                "category": "sub",
                "parentId": array_id,
                "enclBay": n.get("encl_bay", ""),
                "isMaster": n.get("is_master", False),
                "inCluster": n.get("in_cluster", False),
                "memoryGb": round(n.get("mem_mib", 0) / 1024.0, 2),
                "upSince": str(n.get("up_since", ""))
            }
            self.edges.add((array_id, nid, "has_node"))

        # 3. Ports
        for port in p.get("ports", []):
            port_id = f"{ip}_P{port.get('nsp')}"
            self.nodes[port_id] = {
                "id": port_id,
                "name": port.get("label") or f"Port {port.get('nsp')}",
                "type": "Port",
                "status": self._normalize_status(port.get("state")),
                "category": "sub",
                "parentId": array_id,
                "nsp": port.get("nsp", ""),
                "node": port.get("node", 0),
                "slot": port.get("slot", 0),
                "portNum": port.get("port", 0),
                "mode": port.get("mode", ""),
                "state": port.get("state", ""),
                "nodeWwnIp": port.get("node_wwn_ip", ""),
                "portWwnHw": port.get("port_wwn_hw", ""),
                "portType": port.get("type", ""),
                "protocol": port.get("protocol", ""),
                "label": port.get("label", "")
            }
            self.edges.add((array_id, port_id, "has_port"))

        # 4. Switches
        for s in p.get("switches", []):
            sid = s.get("name") or s.get("serial") or s.get("ip_address")
            if sid:
                self.nodes[sid] = {
                    "id": sid,
                    "name": s.get("name", sid),
                    "type": "Switch",
                    "status": self._normalize_status(s.get("state")),
                    "category": "main",
                    "model": s.get("model", ""),
                    "serialNumber": s.get("serial", ""),
                    "state": s.get("state", ""),
                    "mode": s.get("mode", ""),
                    "locateLed": s.get("locate_led", ""),
                    "ps1": s.get("ps1", ""),
                    "ps2": s.get("ps2", ""),
                    "fans": s.get("fans", ""),
                    "temperature": float(s.get("temp", s.get("temperature"))) if (s.get("temp") or s.get("temperature")) else None
                }
                self.edges.add((array_id, sid, "has_switch"))

        # 5. Hosts
        for h in p.get("hosts", []):
            h_ip = h.get("ip_address") or h.get("wwn") or f"wwn_{h.get('host_id')}"
            self.nodes[h_ip] = {
                "id": h_ip,
                "name": h.get("name", h_ip),
                "type": "Host",
                "status": self._normalize_status("normal"),
                "category": "main",
                "hostId": h.get("host_id"),
                "persona": h.get("persona", ""),
                "wwn": h.get("wwn", ""),
                "port": h.get("port", ""),
                "osType": h.get("os", h.get("os_name", "")),
                "ipAddress": h.get("ip_address", ""),
                "multipathStatus": "active"
            }
            self.edges.add((h_ip, array_id, "zoned"))

        # 6. Cages
        for cage in p.get("cages", []):
            cid = f"{ip}_cage_{cage.get('cage_id')}"
            self.nodes[cid] = {
                "id": cid,
                "name": cage.get("name", cid),
                "type": "Cage",
                "status": self._normalize_status(cage.get("state")),
                "category": "sub",
                "parentId": array_id,
                "cageModel": cage.get("model", ""),
                "formFactor": cage.get("form_factor", ""),
                "driveCount": cage.get("drives", cage.get("drive_count", 0)),
                "temperature": float(cage.get("temp", cage.get("temperature"))) if (cage.get("temp") or cage.get("temperature")) else None
            }
            self.edges.add((array_id, cid, "has_cage"))

        # 7. Drives
        for d in p.get("drives", []):
            serial = d.get("serial") or f"{ip}_pd_{d.get('pd_id')}"
            cid = f"{ip}_cage_{d.get('cage_pos','0:0').split(':')[0]}"
            self.nodes[serial] = {
                "id": serial,
                "name": f"Disk {d.get('pd_id')}",
                "type": "Disk",
                "status": self._normalize_status(d.get("state")),
                "category": "sub",
                "parentId": cid,
                "pdId": str(d.get("pd_id")),
                "cagePos": d.get("cage_pos", ""),
                "diskModel": d.get("model", ""),
                "diskType": d.get("type", d.get("disk_type", "")),
                "diskProtocol": d.get("protocol", ""),
                "manufacturer": d.get("manufacturer", ""),
                "firmwareRev": d.get("fw_rev", d.get("firmware_rev", "")),
                "sedState": d.get("sed_state", ""),
                "admissionTime": d.get("admission_time", ""),
                "capacity": f"{d.get('capacity_gb', round(d.get('total_mib', 0)/1024.0, 2))} GB"
            }
            self.edges.add((cid, serial, "has_disk"))

        # 8. Cage Slots (PCI and SFPs diagnostics)
        for slot in p.get("cage_slots", []):
            slot_id = f"{ip}_cage_{slot.get('cage_id')}_slot_{slot.get('slot')}"
            cage_node_id = f"{ip}_cage_{slot.get('cage_id')}"
            self.nodes[slot_id] = {
                "id": slot_id,
                "name": slot.get("name") or f"Slot {slot.get('slot')}",
                "type": "CageSlot",
                "status": self._normalize_status(slot.get("state", slot.get("status"))),
                "category": "sub",
                "parentId": cage_node_id,
                "cageId": slot.get("cage_id"),
                "slotNum": slot.get("slot"),
                "slotType": slot.get("type", ""),
                "manufacturer": slot.get("manufacturer", ""),
                "slotModel": slot.get("model", ""),
                "slotState": slot.get("state", ""),
                "statusDetails": slot.get("status", ""),
                "txPower": slot.get("tx_power", ""),
                "rxPower": slot.get("rx_power", ""),
                "qualified": slot.get("qualified", ""),
                "rxLoss": slot.get("rx_loss", "")
            }
            self.edges.add((cage_node_id, slot_id, "has_slot"))

        # Remote peers
        for peer_ip in p.get("connected_array_ips", []):
            self.edges.add((array_id, peer_ip, "remote_copy_peer"))

    def _store_host(self, p: dict):
        ip = p.get("_ip", "")
        h_id = ip
        self.nodes[h_id] = {
            "id": h_id,
            "name": p.get("hostname", ip),
            "type": "Host",
            "status": self._normalize_status("normal"),
            "category": "main",
            "osType": p.get("os_name", ""),
            "ipAddress": ip
        }

        for disk in p.get("disks", []):
            serial = disk.get("serial") or f"{ip}_{disk.get('device', disk.get('device_id', '0'))}"
            self.nodes[serial] = {
                "id": serial,
                "name": disk.get("device", serial),
                "type": "Disk",
                "status": self._normalize_status(disk.get("health")),
                "category": "sub",
                "parentId": h_id,
                "diskModel": disk.get("model", "")
            }
            self.edges.add((h_id, serial, "has_disk"))

    def _sync_to_db(self):
        try:
            edges_list = [{"from": e[0], "to": e[1], "label": e[2]} for e in self.edges]
            nodes_list = list(self.nodes.values())
            
            doc = {
                "name": "HPE SAN Infrastructure",
                "description": "Dynamically discovered SAN data via crawler",
                "nodes": nodes_list,
                "edges": edges_list,
                "lastUpdated": datetime.utcnow(),
                "version": "1.0"
            }
            
            # Upsert into sandatas (default collection for Mongoose 'SANData' model)
            self.db.sandatas.replace_one({}, doc, upsert=True)
            log.debug(f"[mongo] Synced {len(nodes_list)} nodes and {len(edges_list)} edges to MongoDB.")
        except Exception as e:
            log.error(f"[mongo] Sync failed: {e}")

    def close(self):
        if self.client:
            self.client.close()

    @property
    def available(self):
        return self._available
