"""
discovery/neo4j_store.py

Neo4j graph store for the discovery engine.
Stores all discovered SAN entities as a proper knowledge graph
with typed nodes and named relationships.
"""
import os
import logging

log = logging.getLogger(__name__)

NEO4J_URI  = os.environ.get("NEO4J_URI",  "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASS = os.environ.get("NEO4J_PASS", "hpe_san_password")


class Neo4jStore:
    def __init__(self, uri=NEO4J_URI, user=NEO4J_USER, password=NEO4J_PASS):
        self._driver = None
        self._available = False
        try:
            from neo4j import GraphDatabase
            self._driver = GraphDatabase.driver(uri, auth=(user, password))
            self._driver.verify_connectivity()
            self._available = True
            self._create_constraints()
            log.info(f"[neo4j] Connected to {uri}")
        except ImportError:
            log.warning("[neo4j] neo4j driver not installed. Run: pip install neo4j")
        except Exception as e:
            log.warning(f"[neo4j] Unavailable: {e}")

    def _run(self, cypher, **params):
        with self._driver.session() as session:
            return session.run(cypher, **params).data()

    def _create_constraints(self):
        constraints = [
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:ArraySystem) REQUIRE n.ip_address IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:Host) REQUIRE n.ip_address IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:Switch) REQUIRE n.serial IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (n:PhysicalDisk) REQUIRE n.serial IS UNIQUE",
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
        # Merge ArraySystem
        self._run("""
            MERGE (a:ArraySystem {ip_address: $ip})
            SET a.name=$name, a.model=$model, a.serial=$serial,
                a.release_version=$rv, a.total_cap_mib=$tc,
                a.free_cap_mib=$fc, a.config_type=$ct,
                a.node_count=$nc
        """, ip=ip, name=p.get("name"), model=p.get("model"),
            serial=p.get("serial"), rv=p.get("release_version"),
            tc=p.get("total_cap_mib",0), fc=p.get("free_cap_mib",0),
            ct=p.get("config_type"), nc=p.get("node_count",0))

        # Nodes
        for n in p.get("nodes", []):
            self._run("""
                MERGE (n:Node {node_id: $nid})
                SET n.name=$name, n.is_master=$master, n.mem_mib=$mem, n.up_since=$up
                WITH n
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (a)-[:HAS_NODE]->(n)
            """, nid=f"{ip}_N{n.get('node_id')}", name=n.get("name"),
                master=n.get("is_master",False), mem=n.get("mem_mib",0),
                up=str(n.get("up_since","")), ip=ip)

        # Switches
        for s in p.get("switches", []):
            self._run("""
                MERGE (sw:Switch {name: $name})
                SET sw.state=$state, sw.mode=$mode, sw.serial=$serial,
                    sw.temperature=$temp, sw.model=$model, sw.ip_address=$swip
                WITH sw
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (a)-[:HAS_SWITCH]->(sw)
            """, name=s.get("name"), state=s.get("state"), mode=s.get("mode"),
                serial=s.get("serial"), temp=str(s.get("temperature","")),
                model=s.get("model",""), swip=s.get("ip_address",""), ip=ip)

        # Hosts
        for h in p.get("hosts", []):
            h_ip = h.get("ip_address") or h.get("wwn", f"wwn_{h.get('host_id')}")
            self._run("""
                MERGE (h:Host {ip_address: $hip})
                SET h.name=$name, h.os_name=$os, h.wwn=$wwn, h.multipath=$mp
                WITH h
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (h)-[:CONNECTS_TO]->(a)
            """, hip=h_ip, name=h.get("name"), os=h.get("os_name"),
                wwn=h.get("wwn",""), mp=h.get("multipath",""), ip=ip)

        # Cages + Drives
        for cage in p.get("cages", []):
            cage_id = f"{ip}_cage_{cage.get('cage_id')}"
            self._run("""
                MERGE (c:Cage {cage_id: $cid})
                SET c.name=$name, c.state=$state, c.model=$model,
                    c.drive_count=$dc, c.temperature=$temp
                WITH c
                MATCH (a:ArraySystem {ip_address: $ip})
                MERGE (a)-[:HAS_CAGE]->(c)
            """, cid=cage_id, name=cage.get("name"), state=cage.get("state"),
                model=cage.get("model",""), dc=cage.get("drive_count",0),
                temp=str(cage.get("temperature","")), ip=ip)

        for d in p.get("drives", []):
            serial = d.get("serial") or f"{ip}_pd_{d.get('pd_id')}"
            cage_id = f"{ip}_cage_{d.get('cage_pos','0:0').split(':')[0]}"
            self._run("""
                MERGE (pd:PhysicalDisk {serial: $serial})
                SET pd.pd_id=$pid, pd.cage_pos=$cp, pd.drive_type=$dtype,
                    pd.manufacturer=$mfg, pd.model=$model,
                    pd.firmware_rev=$fw, pd.capacity_gb=$cap,
                    pd.sed_state=$sed, pd.protocol=$proto, pd.state=$state
                WITH pd
                MATCH (c:Cage {cage_id: $cid})
                MERGE (c)-[:CONTAINS]->(pd)
            """, serial=serial, pid=str(d.get("pd_id")), cp=d.get("cage_pos"),
                dtype=d.get("drive_type"), mfg=d.get("manufacturer"),
                model=d.get("model"), fw=d.get("firmware_rev"),
                cap=d.get("capacity_gb",0), sed=d.get("sed_state"),
                proto=d.get("protocol"), state=d.get("state"), cid=cage_id)

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
