"""
simulator/data_generator.py

Generates rich, enterprise-grade mock SAN data for ALL entity types
defined in mermaid-flowchart-san-tree.txt and the m1/m2/m3 reference files.

Produces device dump files compatible with proxy.py's '+ command' format,
so the existing parsers work without modification.
"""
import os
import json
import random
import string
import datetime
import ipaddress

# ── Configuration ─────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data", "devices")
META_DIR = os.path.join(BASE_DIR, "data", "network_meta")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(META_DIR, exist_ok=True)

MODELS = [
    "HPE Alletra Storage MP",
    "HPE Alletra 9000",
    "HPE Primera 600",
    "HPE 3PAR 8450",
    "HPE Nimble HF60",
]
SWITCH_MODELS = ["Brocade G630", "Brocade 6510", "Cisco MDS 9148S", "Cisco MDS 9396T"]
HOST_OS = [
    {"os_name": "VMware ESXi", "os_version": "8.0 U2", "type": "windows"},
    {"os_name": "Red Hat Enterprise Linux", "os_version": "9.2", "type": "linux"},
    {"os_name": "Windows Server", "os_version": "2022", "type": "windows"},
    {"os_name": "Ubuntu Server", "os_version": "22.04 LTS", "type": "linux"},
    {"os_name": "Oracle Linux", "os_version": "8.6", "type": "linux"},
]
DISK_TYPES = ["NVMe", "SSD", "HDD"]
DISK_MODELS = {
    "NVMe": [("SAMSUNG", "MZWLR3T8HBLS", "GXA7A01Q"), ("KIOXIA", "KCD6XLUL3T84", "1IAGD102")],
    "SSD":  [("SAMSUNG", "AELN30T7P5xn", "MSB4"), ("SEAGATE", "XS3840SE70084", "0002")],
    "HDD":  [("SEAGATE", "ST16000NM001G", "SN04"), ("WD", "WD161KRYZ-01U", "82.0")],
}
SFP_VENDORS = ["Finisar", "Avago", "InnoLight", "Sumitomo"]
CPU_MODELS = [
    "Intel(R) Xeon(R) Gold 6230R CPU @ 2.10GHz",
    "Intel(R) Xeon(R) Platinum 8280 CPU @ 2.70GHz",
    "AMD EPYC 7542 32-Core Processor",
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def _serial(prefix="SN"):
    return f"{prefix}{''.join(random.choices(string.digits, k=8))}"

def _wwn():
    parts = [f"{random.randint(0, 255):02X}" for _ in range(8)]
    return ":".join(parts)

def _mac():
    parts = [f"{random.randint(0, 255):02X}" for _ in range(6)]
    return ":".join(parts)

def _fw_rev():
    return f"{random.randint(1,9)}.{random.randint(0,9)}.{random.randint(0,9)}"

def _date(days_ago_max=365):
    d = datetime.datetime.now() - datetime.timedelta(days=random.randint(0, days_ago_max))
    return d.strftime("%Y-%m-%d %H:%M:%S PDT")

def _ip(subnet="10.20"):
    return f"{subnet}.{random.randint(1,254)}.{random.randint(2,254)}"

def _mib(tb):
    """Convert TB to MiB"""
    return int(tb * 1024 * 1024)

# ── Dump builder ─────────────────────────────────────────────────────────────

class ArrayDumpBuilder:
    """Builds a '+ command' format CLI dump for a simulated array."""

    def __init__(self, config: dict):
        self.c = config
        self.lines = []

    def _cmd(self, name):
        self.lines.append(f"+ {name}")

    def _add(self, *args):
        for a in args:
            self.lines.append(a)

    def build_showsys(self):
        c = self.c
        self._cmd("showsys")
        self._add(
            "                                                                     ------------------(MiB)------------------",
            "     ID -Name- ------------Model------------ --Serial-- Nodes Master TotalCap    AllocCap    FreeCap FailedCap",
            f" {c['array_id']} {c['name']:<6} {c['model']:<30} {c['serial']:<10} {c['node_count']}      {c['master_node']} "
            f"{c['total_cap_mib']:<12} {c['alloc_cap_mib']:<12} {c['free_cap_mib']:<8} 0",
        )

    def build_shownode(self):
        c = self.c
        self._cmd("shownode")
        self._add("Node ----Name---- Encl:Bay Master InCluster Mem(MiB) -------Up_Since--------")
        for n in c["nodes"]:
            master = "Yes" if n["node_id"] == c["master_node"] else "No"
            self._add(f"   {n['node_id']} {n['name']:<12} {n['encl_bay']}   {master:<6} Yes       {n['mem_mib']}   {n['up_since']}")

    def build_showport(self):
        c = self.c
        self._cmd("showport")
        self._add("N:S:P Mode      State    ----Node_WWN---- -Port_WWN/MAC-- Type  Protocol Label Speed")
        for p in c["ports"]:
            self._add(
                f"{p['nsp']:<6} {p['mode']:<10} {p['state']:<8} {p['node_wwn']} {p['port_wwn']} "
                f"{p['type']:<6} {p['protocol']:<8} {p.get('label','-'):<6} {p.get('speed','16G')}"
            )

    def build_showswitch(self):
        c = self.c
        self._cmd("showswitch")
        if not c["switches"]:
            self._add("No switches listed")
            return
        self._add("Name State Mode LocateLED Serial PS1 PS2 Fans Temp")
        for s in c["switches"]:
            self._add(f"{s['name']} {s['state']} Native off {s['serial']} OK OK OK {s['temperature']}")

    def build_showhost(self):
        c = self.c
        self._cmd("showhost")
        self._add(" Id Name              Persona       -WWN/iSCSI_Name/NQN-    Port  OS")
        for h in c["hosts"]:
            clean_wwn = h['wwn'].replace(":", "")
            self._add(f"  {h['host_id']:<3} {h['name']:<18} Generic-ALUA  {clean_wwn} {h['port']}  {h['os_name']}")

    def build_showcage(self):
        c = self.c
        self._cmd("showcage")
        self._add(" Id Name    -State- -Detailed_State- Drives -Temp- ---Model--- FormFactor CageType")
        for cage in c["cages"]:
            self._add(
                f"  {cage['cage_id']} {cage['name']:<8} {cage['state']:<8} {cage['detailed_state']:<16} "
                f"{cage['drive_count']:<7} {cage['temperature']:<7} {cage['model']:<12} {cage['form_factor']:<10} {cage['cage_type']}"
            )

    def build_showcage_state(self):
        c = self.c
        self._cmd("showcage -state")
        self._add("Id Name    State   PS1  PS2  Fans Temp SlotsIOM  SlotsSlot")
        for cage in c["cages"]:
            self._add(f"  {cage['cage_id']} {cage['name']:<8} {cage['state']:<8} OK   OK   OK   {cage['temperature']}  {cage.get('iom_slots',2)}        {cage['drive_count']}")

    def build_showpd(self):
        c = self.c
        self._cmd("showpd")
        self._add("Id CagePos Type RPM State Total Free Capacity(GB)")
        for d in c["drives"]:
            self._add(f" {d['pd_id']} {d['cage_pos']} {d['drive_type']} N/A {d['state']} {d['total_mib']} {d['free_mib']} {d['capacity_gb']}")

    def build_showpd_s(self):
        c = self.c
        self._cmd("showpd -s")
        self._add("Id CagePos Type Size(GB) State DetailedState SEDState")
        for d in c["drives"]:
            self._add(f" {d['pd_id']} {d['cage_pos']} {d['drive_type']} {d['capacity_gb']} {d['state']} OK {d['sed_state']}")

    def build_showpd_i(self):
        c = self.c
        self._cmd("showpd -i")
        self._add("Id CagePos State Node_WWN Manufacturer Model Serial FW_Rev Protocol DiskType AdmissionTime")
        for d in c["drives"]:
            mfg = d.get("manufacturer", "SAMSUNG")
            mdl = d.get("model", "MZ-1")
            serial = d.get("serial", "SN1")
            fw = d.get("firmware_rev", "1.0")
            proto = d.get("protocol", "SAS")
            self._add(f" {d['pd_id']} {d['cage_pos']} {d['state']} 2FF70002AC07F065 {mfg} {mdl} {serial} {fw} {proto} {d['drive_type']} 2026-05-18_13:12:33")

    def build_showversion(self):
        c = self.c
        self._cmd("showversion -b")
        self._add(f"Release version {c['release_version']}")
        self._add(f"Patches: None")
        self._add("")
        self._add("Component          Version")
        for comp_name, comp_ver in c["software_components"].items():
            self._add(f"  {comp_name:<25} {comp_ver}")

    def build_lscpu(self):
        """Generate Linux lscpu output for each node (firmware/hardware info)."""
        c = self.c
        self._cmd("lscpu")
        self._add(f"Architecture:        x86_64")
        self._add(f"CPU op-mode(s):      32-bit, 64-bit")
        self._add(f"Byte Order:          Little Endian")
        n = c["nodes"][0]
        cpu = n.get("cpu_model", CPU_MODELS[0])
        self._add(f"CPU(s):              {n.get('cpu_count', 48)}")
        self._add(f"Thread(s) per core:  2")
        self._add(f"Core(s) per socket:  {n.get('cpu_count', 48) // 4}")
        self._add(f"Socket(s):           2")
        self._add(f"Model name:          {cpu}")
        self._add(f"CPU MHz:             2100.000")
        self._add(f"L1d cache:           32K")
        self._add(f"L1i cache:           32K")
        self._add(f"L2 cache:            1024K")
        self._add(f"L3 cache:            22528K")
        self._add(f"Virtualization:      VT-x")
        self._add(f"NUMA node(s):        2")
        self._add(f"NUMA node0 CPU(s):   0-23")
        self._add(f"NUMA node1 CPU(s):   24-47")

    def build_showportdev_ns(self):
        c = self.c
        self._cmd("showportdev ns -nohdtot 0:3:1")
        self._add(f"0xc0200 0x00  0x00 2FF70000DUMMY001 20310000DUMMY001 0x8800 0x0012 n/a    0x0800 20310000DUMMY001 HPE {c['model']} - DUMMY000999 - fw:105600                                                              0:3:1")
        for i, h in enumerate(c["hosts"]):
            wwn1 = "2" + h["wwn"].replace(":", "")[1:]
            wwn2 = "1" + h["wwn"].replace(":", "")[1:]
            hostname = h['name']
            os = "Linux" if "linux" in h.get("os_type", "").lower() else "Windows"
            status = hostname if i % 2 == 0 else "-"
            self._add(f"0xc1100 0x0a  0x00 {wwn1} {wwn2} 0x0000 0x0000 0x0000 0x0000 20310000DUMMY001 Emulex SN1600E1P FV14.0.499.29 DV14.0.499.31 HN:{hostname}.local OS:{os}                             {status}")
            
    def build_fabricshow(self):
        c = self.c
        self._cmd("fabricshow")
        self._add("Switch ID   Worldwide Name          Enet IP Addr    FC IP Addr      Name")
        self._add("-------------------------------------------------------------------------")
        for i, s in enumerate(c["switches"]):
            self._add(f"  {i+1}: dmyc0{i+1} {s['wwn']} {s['ip_address']}   0.0.0.0         \"{s['name']}\"")
        self._add(f"The Fabric has {len(c['switches'])} switches")
        self._add("Fabric Name: FABRIC_DUMMY_01")
        
    def build_switchshow_detailed(self):
        c = self.c
        self._cmd("switchshow")
        s = c["switches"][0] if c["switches"] else None
        if s:
            self._add(f"switchName:     {s['name']}")
            self._add(f"switchType:     109.1")
            self._add(f"switchState:    {s['state']}")
            self._add(f"switchMode:     Native")
            self._add(f"switchRole:     Subordinate")
            self._add(f"switchDomain:   1")
            self._add(f"switchId:       dmyc63")
            self._add(f"switchWwn:      {s['wwn']}")
            self._add(f"zoning:         ON (FABRIC_DUMMY_1)")
            self._add(f"switchBeacon:   OFF")
            self._add(f"FC Router:      OFF")
            self._add(f"Fabric Name:    FABRIC_DUMMY_01")
            self._add(f"HIF Mode:       OFF")
            self._add(f"Allow XISL Use: OFF")
            self._add(f"LS Attributes:  [FID: 128, Base Switch: No, Default Switch: Yes, Address Mode 0]")
            self._add("")
            self._add("Index Port Address  Media Speed   State       Proto")
            self._add("==================================================")
            self._add("   0   0   630000   id    N16     Online      FC  E-Port  10:00:aa:bb:cc:00:00:08 \"sw-bridge-08\" (Trunk master)")
            self._add("   1   1   630100   id    N16     Online      FC  E-Port  (Trunk port, master is Port  0 )")
            self._add("   2   2   630200   id    N16     Online      FC  E-Port  10:00:aa:bb:cc:00:00:01 \"sw-core-01\" (upstream)(Trunk master)")
            self._add("   3   3   630300   id    N16     Online      FC  E-Port  (Trunk port, master is Port  2 )")
            for p in range(4, 20):
                self._add(f"  {p:2}  {p:2}   630{p:x}00   id    N16     No_Light    FC")

    def build(self):
        self.build_showsys()
        self.build_shownode()
        self.build_showport()
        self.build_showswitch()
        self.build_showhost()
        self.build_showcage()
        self.build_showcage_state()
        self.build_showpd()
        self.build_showpd_s()
        self.build_showpd_i()
        self.build_showversion()
        self.build_lscpu()
        self.build_showportdev_ns()
        self.build_fabricshow()
        self.build_switchshow_detailed()
        return "\n".join(self.lines)


# ── Config generator ──────────────────────────────────────────────────────────

def generate_array_config(
    name: str,
    array_id: str,
    ip: str,
    model: str = None,
    node_count: int = 2,
    drive_count: int = 48,
    switch_count: int = 2,
    host_count: int = 6,
    cage_count: int = 2,
    subnet: str = "10.20.10",
    connected_array_ips: list = None,
) -> dict:
    """Generate a complete config dict for one simulated array."""
    model = model or random.choice(MODELS)
    serial = _serial("HPE")
    total_tb = drive_count * 3.84
    alloc_tb = total_tb * random.uniform(0.3, 0.7)
    free_tb = total_tb - alloc_tb

    # Nodes
    nodes = []
    for i in range(node_count):
        cpu = random.choice(CPU_MODELS)
        cores = random.choice([24, 32, 48])
        nodes.append({
            "node_id": i,
            "name": f"{name}-N{i}",
            "encl_bay": f"1:{i+1}",
            "is_master": i == 0,
            "mem_mib": random.choice([262144, 524288, 1048576]),
            "up_since": _date(180),
            "cpu_model": cpu,
            "cpu_count": cores,
            "ip_address": f"{subnet}.{10+i}",
        })

    # Ports: node × slot × port
    ports = []
    protocols_pool = ["FC", "NVMe", "iSCSI"]
    for n_idx in range(node_count):
        for s in range(1, 4):
            for p in range(1, 5):
                proto = random.choice(protocols_pool)
                mode = "target" if proto in ["FC", "NVMe"] else "initiator"
                ports.append({
                    "nsp": f"{n_idx}:{s}:{p}",
                    "mode": mode,
                    "state": random.choice(["ready", "ready", "ready", "loss_sync"]),
                    "node_wwn": _wwn(),
                    "port_wwn": _wwn() if proto == "FC" else _mac(),
                    "type": "host" if proto != "iSCSI" else "ip",
                    "protocol": proto,
                    "label": f"P{n_idx}{s}{p}",
                    "speed": "32G" if proto == "FC" else "25G",
                })

    # Switches
    switches = []
    for i in range(switch_count):
        switches.append({
            "name": f"sw{name.lower()}{i+1}",
            "wwn": _wwn(),
            "state": "Online",
            "mode": "Normal",
            "serial": _serial("SW"),
            "temperature": random.randint(28, 42),
            "model": random.choice(SWITCH_MODELS),
            "ip_address": f"{subnet}.{200+i}",
        })

    # Hosts
    hosts = []
    for i in range(host_count):
        os_info = random.choice(HOST_OS)
        hosts.append({
            "host_id": i,
            "name": f"host-{name.lower()}-{i:02d}",
            "wwn": _wwn(),
            "port": f"0:1:{i % 4 + 1}",
            "os_name": os_info["os_name"],
            "os_version": os_info["os_version"],
            "os_type": os_info["type"],
            "ip_address": _ip(subnet[:5]),
            "multipath": random.choice(["DUAL", "SINGLE"]),
        })

    # Cages
    cages = []
    drives_per_cage = drive_count // cage_count
    for c in range(cage_count):
        cages.append({
            "cage_id": c,
            "name": f"cage{c}",
            "state": "Normal",
            "detailed_state": "Normal",
            "drive_count": drives_per_cage,
            "temperature": random.randint(25, 38),
            "model": "DCS-4048-G",
            "form_factor": "SFF",
            "cage_type": random.choice(["DCN", "DCF"]),
            "iom_slots": 2,
        })

    # Physical Disks
    drives = []
    d_idx = 0
    for cage in cages:
        for slot in range(cage["drive_count"]):
            dtype = random.choices(DISK_TYPES, weights=[50, 30, 20])[0]
            mfg, mdl, fw = random.choice(DISK_MODELS[dtype])
            cap_gb = {"NVMe": 3840, "SSD": 1920, "HDD": 16000}[dtype]
            total_mib = _mib(cap_gb / 1024)
            drives.append({
                "pd_id": d_idx,
                "cage_pos": f"{cage['cage_id']}:{slot}",
                "drive_type": dtype,
                "state": "normal",
                "total_mib": total_mib,
                "free_mib": int(total_mib * random.uniform(0.0, 0.5)),
                "capacity_gb": cap_gb,
                "manufacturer": mfg,
                "model": mdl,
                "serial": _serial("DRV"),
                "firmware_rev": fw,
                "protocol": "NVMe" if dtype == "NVMe" else "SAS",
                "sed_state": random.choice(["fips_capable", "capable", "not_capable"]),
            })
            d_idx += 1

    # Software components
    sw_ver = f"{random.randint(9,10)}.{random.randint(0,9)}.{random.randint(0,5)}.0"
    sw_components = {
        "CLI_Server":          f"CLI_BUILD_{random.randint(100,999)}",
        "Kernel":              f"5.{random.randint(10,15)}.{random.randint(0,20)}-hpe",
        "IO_Stack":            f"6.{random.randint(0,5)}.{random.randint(0,9)}",
        "Drive_Firmware_Mgr":  f"DFW-{random.randint(1,5)}.{random.randint(0,9)}",
        "Enclosure_Firmware":  f"EFW-{random.randint(1,4)}.{random.randint(0,9)}",
        "Switch_Firmware":     f"SFW-{random.randint(8,12)}.{random.randint(0,9)}",
        "Upgrade_Tool":        f"UPG-{random.randint(3,5)}.{random.randint(0,9)}",
    }

    return {
        "array_id": array_id,
        "name": name,
        "ip_address": ip,
        "model": model,
        "serial": serial,
        "node_count": node_count,
        "master_node": 0,
        "total_cap_mib": _mib(total_tb),
        "alloc_cap_mib": _mib(alloc_tb),
        "free_cap_mib": _mib(free_tb),
        "release_version": sw_ver,
        "release_type": "GA",
        "software_components": sw_components,
        "nodes": nodes,
        "ports": ports,
        "switches": switches,
        "hosts": hosts,
        "cages": cages,
        "drives": drives,
        "connected_array_ips": connected_array_ips or [],
    }


# ── Full SAN topology definition ──────────────────────────────────────────────

def generate_full_san_topology() -> dict:
    """
    Define a multi-array SAN topology with cross-connected meshes.
    Returns the full topology metadata dict (used by the simulator manager).
    """
    arrays = [
        {
            "name": "PROD-A",
            "array_id": "0x1001",
            "ip": "10.20.10.5",
            "model": "HPE Alletra Storage MP",
            "node_count": 4,
            "drive_count": 192,
            "switch_count": 2,
            "host_count": 8,
            "cage_count": 8,
            "subnet": "10.20.10",
            "connected_array_ips": ["10.20.20.5"],
        },
        {
            "name": "PROD-B",
            "array_id": "0x1002",
            "ip": "10.20.20.5",
            "model": "HPE Alletra 9000",
            "node_count": 2,
            "drive_count": 48,
            "switch_count": 2,
            "host_count": 4,
            "cage_count": 2,
            "subnet": "10.20.20",
            "connected_array_ips": ["10.20.10.5", "10.20.30.5"],
        },
        {
            "name": "DR-C",
            "array_id": "0x1003",
            "ip": "10.20.30.5",
            "model": "HPE Primera 600",
            "node_count": 2,
            "drive_count": 48,
            "switch_count": 1,
            "host_count": 4,
            "cage_count": 2,
            "subnet": "10.20.30",
            "connected_array_ips": ["10.20.20.5"],
        },
        {
            "name": "EDGE-D",
            "array_id": "0x1004",
            "ip": "10.20.40.5",
            "model": "HPE Nimble HF60",
            "node_count": 2,
            "drive_count": 24,
            "switch_count": 1,
            "host_count": 4,
            "cage_count": 1,
            "subnet": "10.20.40",
            "connected_array_ips": [],
        },
    ]

    topology = {"arrays": [], "network_map": {}}
    for arr_def in arrays:
        config = generate_array_config(**arr_def)
        topology["arrays"].append(config)
        topology["network_map"][config["ip_address"]] = config["name"]
        # Also map switch IPs
        for sw in config["switches"]:
            topology["network_map"][sw["ip_address"]] = sw["name"]
        # Also map host IPs
        for h in config["hosts"]:
            topology["network_map"][h["ip_address"]] = h["name"]

    return topology


# ── Main entry ────────────────────────────────────────────────────────────────

def generate_and_save():
    """Generate all device dumps and save network metadata."""
    topology = generate_full_san_topology()

    for arr_config in topology["arrays"]:
        builder = ArrayDumpBuilder(arr_config)
        dump_text = builder.build()
        filename = f"{arr_config['name'].lower().replace('-','_')}.txt"
        filepath = os.path.join(DATA_DIR, filename)
        with open(filepath, "w") as f:
            f.write(dump_text)
        print(f"[data_generator] Generated: {filepath}")

    # Save network metadata (used by simulator_manager for IP routing)
    meta_path = os.path.join(META_DIR, "network_topology.json")
    with open(meta_path, "w") as f:
        # Save only serializable parts (exclude full drive/port lists for meta)
        meta = {
            "network_map": topology["network_map"],
            "arrays": [
                {
                    "name": a["name"],
                    "array_id": a["array_id"],
                    "ip_address": a["ip_address"],
                    "model": a["model"],
                    "serial": a["serial"],
                    "node_count": a["node_count"],
                    "connected_array_ips": a["connected_array_ips"],
                    "switches": [{"name": s["name"], "ip_address": s["ip_address"]} for s in a["switches"]],
                    "hosts": [{"name": h["name"], "ip_address": h["ip_address"], "os_type": h["os_type"]} for h in a["hosts"]],
                }
                for a in topology["arrays"]
            ],
        }
        json.dump(meta, f, indent=2)
    print(f"[data_generator] Network metadata saved: {meta_path}")
    return topology


if __name__ == "__main__":
    generate_and_save()
    print("Done. Run simulator_manager.py to start the virtual SAN.")
