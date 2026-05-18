"""
discovery/neo4j_store.py

Neo4j graph store for the discovery engine.
Stores all discovered SAN entities as a proper knowledge graph
with typed nodes and named relationships, capturing all parsed parameters.
"""
import os
import logging

log = logging.getLogger(__name__)

NEO4J_URI  = os.environ.get("NEO4J_URI",  "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASS = os.environ.get("NEO4J_PASS", "hpe_san_password")


class Neo4jStore:
    def __init__(self, uri=NEO4J_URI, user=NEO4J_USER, password=NEO4J_PASS):
        self.uri = uri
        self.user = user
        self.password = password
        self._driver = None
        self._available = False
        self._init_driver()

    def _init_driver(self):
        try:
            from neo4j import GraphDatabase
            if self._driver:
                try:
                    self._driver.close()
                except Exception:
                    pass
            self._driver = GraphDatabase.driver(self.uri, auth=(self.user, self.password))
            self._driver.verify_connectivity()
            self._available = True
            self._create_constraints()
            log.info(f"[neo4j] Connected to {self.uri}")
        except Exception as e:
            log.warning(f"[neo4j] Connection failed: {e}")
            self._available = False

    def _run(self, cypher, **params):
        with self._driver.session() as session:
            return session.run(cypher, **params).data()

    def _create_constraints(self):
        constraints = [
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:ArraySystem) REQUIRE n.ip_address IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:Host) REQUIRE n.ip_address IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:Switch) REQUIRE n.serial IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:PhysicalDisk) REQUIRE n.serial IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:Port) REQUIRE n.port_id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:CageSlot) REQUIRE n.slot_id IS UNIQUE",
        ]
        for c in constraints:
            try:
                self._run(c)
            except Exception:
                pass

    def store(self, parsed: dict):
        if not self._available:
            return
        dtype = parsed.get("_device_type", "")
        if dtype == "hpe_array":
            self._store_array(parsed)
        elif dtype in ("linux_host", "windows_host"):
            self._store_host(parsed)

    def _store_array(self, p: dict):
        ip = p.get("_ip", "")
        
        # Merge ArraySystem with all capacities and versions
        self._run("""
            MERGE (a:ArraySystem {ip_address: $ip})
            SET a.array_id=$aid, a.name=$name, a.model=$model, a.serial=$serial,
                a.release_version=$rv, a.release_type=$rt, a.config_type=$ct,
                a.node_count=$nc, a.master_node=$mn, a.total_cap_mib=$tc,
                a.alloc_cap_mib=$ac, a.free_cap_mib=$fc, a.failed_cap_mib=$fac,
                a.protocols_supported=$ps
        """, ip=ip, aid=p.get("array_id"), name=p.get("name"), model=p.get("model"),
            serial=p.get("serial"), rv=p.get("release_version"), rt=p.get("release_type"),
            ct=p.get("config_type"), nc=p.get("node_count",0), mn=p.get("master_node",0),
            tc=p.get("total_cap_mib",0), ac=p.get("alloc_cap_mib",0),
            fc=p.get("free_cap_mib",0), fac=p.get("failed_cap_mib",0),
            ps=p.get("protocols_supported",[]))

        # Nodes (Controllers)
        for n in p.get("nodes", []):
            nid = f"{ip}_N{n.get('node_id')}"
            self._run("""
                MERGE (n:Node {node_id: $nid})
                SET n.name=$name, n.encl_bay=$eb, n.is_master=$master,
                    n.in_cluster=$cluster, n.mem_mib=$mem, n.up_since=$up
                WITH n
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (a)-[:HAS_NODE]->(n)
            """, nid=nid, name=n.get("name"), eb=n.get("encl_bay"),
                master=n.get("is_master",False), cluster=n.get("in_cluster",False),
                mem=n.get("mem_mib",0), up=str(n.get("up_since","")), ip=ip)

        # Array Ports (New Nodes)
        for port in p.get("ports", []):
            port_id = f"{ip}_P{port.get('nsp')}"
            self._run("""
                MERGE (pt:Port {port_id: $pid})
                SET pt.nsp=$nsp, pt.node=$node, pt.slot=$slot, pt.port_num=$port_num,
                    pt.mode=$mode, pt.state=$state, pt.node_wwn_ip=$node_wwn,
                    pt.port_wwn_hw=$port_wwn, pt.type=$type, pt.protocol=$proto,
                    pt.label=$label
                WITH pt
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (a)-[:HAS_PORT]->(pt)
            """, pid=port_id, nsp=port.get("nsp"), node=port.get("node"),
                slot=port.get("slot"), port_num=port.get("port"),
                mode=port.get("mode"), state=port.get("state"),
                node_wwn=port.get("node_wwn_ip"), port_wwn=port.get("port_wwn_hw"),
                type=port.get("type"), proto=port.get("protocol"),
                label=port.get("label"), ip=ip)

        # Switches with detailed PS / Fan / LED telemetry
        for s in p.get("switches", []):
            self._run("""
                MERGE (sw:Switch {name: $name})
                SET sw.state=$state, sw.mode=$mode, sw.locate_led=$led,
                    sw.serial=$serial, sw.ps1=$ps1, sw.ps2=$ps2, sw.fans=$fans,
                    sw.temperature=$temp, sw.model=$model, sw.ip_address=$swip
                WITH sw
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (a)-[:HAS_SWITCH]->(sw)
            """, name=s.get("name"), state=s.get("state"), mode=s.get("mode"),
                led=s.get("locate_led"), serial=s.get("serial"), ps1=s.get("ps1"),
                ps2=s.get("ps2"), fans=s.get("fans"), temp=str(s.get("temp", s.get("temperature", ""))),
                model=s.get("model",""), swip=s.get("ip_address",""), ip=ip)

        # Hosts with WWN mappings
        for h in p.get("hosts", []):
            h_ip = h.get("ip_address") or h.get("wwn", f"wwn_{h.get('host_id')}")
            self._run("""
                MERGE (h:Host {ip_address: $hip})
                SET h.host_id=$hid, h.name=$name, h.persona=$persona,
                    h.wwn=$wwn, h.port=$port, h.os_name=$os
                WITH h
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (h)-[:CONNECTS_TO]->(a)
            """, hip=h_ip, hid=h.get("host_id"), name=h.get("name"),
                persona=h.get("persona"), wwn=h.get("wwn",""),
                port=h.get("port",""), os=h.get("os",""), ip=ip)

        # Cages
        for cage in p.get("cages", []):
            cage_id = f"{ip}_cage_{cage.get('cage_id')}"
            self._run("""
                MERGE (c:Cage {cage_id: $cid})
                SET c.name=$name, c.state=$state, c.detailed_state=$ds,
                    c.model=$model, c.form_factor=$ff, c.drive_count=$dc,
                    c.temperature=$temp
                WITH c
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (a)-[:HAS_CAGE]->(c)
            """, cid=cage_id, name=cage.get("name"), state=cage.get("state"),
                ds=cage.get("detailed_state"), model=cage.get("model",""),
                ff=cage.get("form_factor"), dc=cage.get("drives", cage.get("drive_count", 0)),
                temp=str(cage.get("temp", cage.get("temperature", ""))), ip=ip)

        # Physical Disks with full metadata
        for d in p.get("drives", []):
            serial = d.get("serial") or f"{ip}_pd_{d.get('pd_id')}"
            cage_id = f"{ip}_cage_{d.get('cage_pos','0:0').split(':')[0]}"
            self._run("""
                MERGE (pd:PhysicalDisk {serial: $serial})
                SET pd.pd_id=$pid, pd.cage_pos=$cp, pd.state=$state,
                    pd.detailed_state=$ds, pd.sed_state=$sed,
                    pd.drive_type=$dtype, pd.manufacturer=$mfg, pd.model=$model,
                    pd.firmware_rev=$fw, pd.capacity_gb=$cap,
                    pd.protocol=$proto, pd.admission_time=$admission
                WITH pd
                MATCH (c:Cage {cage_id: $cid})
                MERGE (c)-[:CONTAINS]->(pd)
            """, serial=serial, pid=str(d.get("pd_id")), cp=d.get("cage_pos"),
                state=d.get("state"), ds=d.get("detailed_state"), sed=d.get("sed_state"),
                dtype=d.get("type", d.get("disk_type")), mfg=d.get("manufacturer"),
                model=d.get("model"), fw=d.get("fw_rev", d.get("firmware_rev")),
                cap=d.get("capacity_gb", d.get("total_mib", 0) / 1024.0),
                proto=d.get("protocol"), admission=d.get("admission_time"), cid=cage_id)

        # Cage Slots (PCI and SFPs diagnostics - New Nodes)
        for slot in p.get("cage_slots", []):
            slot_id = f"{ip}_cage_{slot.get('cage_id')}_slot_{slot.get('slot')}"
            cage_id = f"{ip}_cage_{slot.get('cage_id')}"
            self._run("""
                MERGE (cs:CageSlot {slot_id: $sid})
                SET cs.cage_id=$cid, cs.name=$name, cs.slot_num=$slot, cs.type=$type,
                    cs.manufacturer=$mfg, cs.model=$model, cs.state=$state,
                    cs.status=$status, cs.tx_power=$tx, cs.rx_power=$rx,
                    cs.qualified=$qualified, cs.rx_loss=$loss
                WITH cs
                MATCH (c:Cage {cage_id: $cage_node_id})
                MERGE (c)-[:HAS_SLOT]->(cs)
            """, sid=slot_id, cid=slot.get("cage_id"), name=slot.get("name"), slot=slot.get("slot"),
                type=slot.get("type"), mfg=slot.get("manufacturer"), model=slot.get("model"),
                state=slot.get("state"), status=slot.get("status"), tx=slot.get("tx_power"),
                rx=slot.get("rx_power"), qualified=slot.get("qualified"), loss=slot.get("rx_loss"),
                cage_node_id=cage_id)

        # Remote copy links between arrays
        for peer_ip in p.get("connected_array_ips", []):
            self._run("""
                MATCH (a:ArraySystem {ip_address: $ip})
                MATCH (b:ArraySystem {ip_address: $peer})
                MERGE (a)-[:REMOTE_COPY_PEER]->(b)
            """, ip=ip, peer=peer_ip)

    def _store_host(self, p: dict):
        ip = p.get("_ip", "")
        dtype = p.get("_device_type", "host")
        self._run("""
            MERGE (h:Host {ip_address: $ip})
            SET h.name=$name, h.os_name=$os, h.os_version=$osv,
                h.bios_version=$bios, h.server_model=$sm,
                h.cpu_model=$cpu, h.device_type=$dtype
        """, ip=ip, name=p.get("hostname"), os=p.get("os_name"),
            osv=p.get("os_version"), bios=p.get("bios_version"),
            sm=p.get("server_model"), cpu=p.get("cpu_model"), dtype=dtype)

        for disk in p.get("disks", []):
            serial = disk.get("serial") or f"{ip}_{disk.get('device', disk.get('device_id','0'))}"
            self._run("""
                MERGE (pd:PhysicalDisk {serial: $serial})
                SET pd.model=$model, pd.firmware_rev=$fw,
                    pd.health=$health, pd.device=$dev
                WITH pd
                MATCH (h:Host {ip_address: $ip})
                MERGE (h)-[:HAS_DISK]->(pd)
            """, serial=serial, model=disk.get("model",""),
                fw=disk.get("firmware_rev",""), health=disk.get("health","OK"),
                dev=disk.get("device", disk.get("device_id","")), ip=ip)

    def close(self):
        if self._driver:
            self._driver.close()

    @property
    def available(self):
        return self._available
