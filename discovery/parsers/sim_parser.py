"""
discovery/parsers/sim_parser.py

Parses the HPE CLI output as emitted by the simulator (simulator_manager.py).
Supersedes universal_parser.py for the monorepo — handles the actual column
formats produced by data_generator.py / device_terminal.py.

Each parse_* function is tolerant of leading whitespace and header lines.
"""
import re


# ─────────────────────────────── showsys ──────────────────────────────────────
def parse_showsys(text: str) -> dict:
    """
    Expected line:
     0x1001 PROD-A HPE Alletra Storage MP         HPE12385034 4      0 386547056 ...
    """
    for line in text.splitlines():
        line = line.strip()
        # Match: 0xHEX  NAME  MODEL(words + spaces)  SERIAL  NODES  MASTER  CAPs...
        m = re.match(
            r"(0x[0-9a-fA-F]+)\s+"          # array_id
            r"(\S+)\s+"                     # name
            r"(HPE[\w\s]+?)\s{2,}"          # model (greedy, stops at 2+ spaces)
            r"(HPE\w+)\s+"                  # serial
            r"(\d+)\s+"                     # node_count
            r"(\d+)\s+"                     # master
            r"(\d+)\s+"                     # total_cap
            r"(\d+)\s+"                     # alloc_cap
            r"(\d+)\s+"                     # free_cap
            r"(\d+)",                       # failed_cap
            line
        )
        if m:
            return {
                "array_id":       m.group(1),
                "name":           m.group(2),
                "model":          m.group(3).strip(),
                "serial":         m.group(4),
                "nodes":          int(m.group(5)),
                "master":         int(m.group(6)),
                "total_cap_mib":  int(m.group(7)),
                "alloc_cap_mib":  int(m.group(8)),
                "free_cap_mib":   int(m.group(9)),
                "failed_cap_mib": int(m.group(10)),
            }
    return {}


# ─────────────────────────────── shownode ─────────────────────────────────────
def parse_shownode(text: str) -> list:
    """
    Expected line:
       0 PROD-A-N0    1:1   Yes    Yes       262144   2026-04-28 18:48:47 PDT
    """
    nodes = []
    for line in text.splitlines():
        m = re.match(
            r"\s*(\d+)\s+"          # node_id
            r"(\S+)\s+"             # name
            r"(\d+:\d+)\s+"         # encl_bay
            r"(Yes|No)\s+"          # master
            r"(Yes|No)\s+"          # in_cluster
            r"(\d+)\s+"             # memory_mib
            r"(.+)$",               # up_since
            line
        )
        if m:
            nodes.append({
                "node_id":    int(m.group(1)),
                "name":       m.group(2),
                "encl_bay":   m.group(3),
                "is_master":  m.group(4) == "Yes",
                "in_cluster": m.group(5) == "Yes",
                "memory_mib": int(m.group(6)),
                "up_since":   m.group(7).strip(),
            })
    return nodes


# ─────────────────────────────── showport ─────────────────────────────────────
def parse_showport(text: str) -> list:
    """
    Expected line:
     0:1:1  target  ready  50:06:... 50:06:... host  FC   -
    """
    ports = []
    for line in text.splitlines():
        m = re.match(
            r"\s*(\d+:\d+:\d+)\s+"          # port_id
            r"(initiator|target|peer)\s+"   # mode
            r"(ready|loss_sync|offline)\s+" # state
            r"(\S+)\s+"                     # node_wwn
            r"(\S+)\s+"                     # port_wwn
            r"(host|disk|free|file|cluster)\s+"  # type
            r"(\S+)"                        # protocol
            r"(?:\s+(.*))?$",               # optional label
            line
        )
        if m:
            parts = m.group(1).split(":")
            ports.append({
                "port_id":      m.group(1),
                "node":         int(parts[0]),
                "slot":         int(parts[1]) if len(parts) > 1 else 0,
                "port_num":     int(parts[2]) if len(parts) > 2 else 0,
                "mode":         m.group(2),
                "state":        m.group(3),
                "node_wwn_ip":  m.group(4),
                "port_wwn_hw":  m.group(5),
                "type":         m.group(6),
                "protocol":     m.group(7),
                "label":        m.group(8).strip() if m.group(8) else "-",
            })
    return ports


# ─────────────────────────────── showhost ─────────────────────────────────────
def parse_showhost(text: str) -> list:
    """
    Expected line:
      0   host-prod-a-00     Generic-ALUA  93:C7:65:8C:4F:DD:59:4F 0:1:1  Windows Server
    """
    hosts = []
    for line in text.splitlines():
        m = re.match(
            r"\s*(\d+)\s+"              # host_id
            r"(\S+)\s+"                 # name
            r"(\S+)\s+"                 # persona
            r"([0-9A-Fa-f:]{23})\s+"   # wwn (8 bytes hex colon separated)
            r"(\d+:\d+:\d+)\s+"         # port
            r"(.+)$",                   # os
            line
        )
        if m:
            hosts.append({
                "host_id":  int(m.group(1)),
                "name":     m.group(2),
                "persona":  m.group(3),
                "wwn":      m.group(4),
                "port":     m.group(5),
                "os":       m.group(6).strip(),
            })
    return hosts


# ─────────────────────────────── showswitch ───────────────────────────────────
def parse_showswitch(text: str) -> list:
    """
    Expected line:
    swprod-a1  Normal  Auto  Off  SN12345  OK  OK  Normal  35C
    """
    switches = []
    for line in text.splitlines():
        m = re.match(
            r"\s*(\S+)\s+"                  # name
            r"(Normal|Fault|Degraded|Unknown)\s+"  # state
            r"(\S+)\s+"                     # mode
            r"(\S+)\s+"                     # locate_led
            r"(\S+)\s+"                     # serial
            r"(\S+)\s+"                     # ps1
            r"(\S+)\s+"                     # ps2
            r"(\S+)\s+"                     # fans
            r"(\S+)",                       # temp
            line, re.IGNORECASE
        )
        if m:
            switches.append({
                "name":        m.group(1),
                "state":       m.group(2),
                "mode":        m.group(3),
                "locate_led":  m.group(4),
                "serial":      m.group(5),
                "ps1":         m.group(6),
                "ps2":         m.group(7),
                "fans":        m.group(8),
                "temperature": m.group(9),
            })
    return switches

# ─────────────────────────────── showportdev ─────────────────────────────────
def parse_showportdev(text: str) -> list:
    """
    Parses 'showportdev ns -nohdtot X:Y:Z'
    """
    devs = []
    for line in text.splitlines():
        # Match pattern: 0xc1100 ... 2000... 1000... ... HN:xxx OS:yyy host-xxx (or -)
        if "HN:" in line and "OS:" in line:
            m = re.search(r"(\S{16})\s+(\S{16})\s+.*?HN:(\S+)\s+OS:(\S+)\s+(\S+)$", line)
            if m:
                devs.append({
                    "wwn_node": m.group(1),
                    "wwn_port": m.group(2),
                    "hostname": m.group(3),
                    "os": m.group(4),
                    "status": m.group(5),
                })
    return devs

# ─────────────────────────────── fabricshow & switchshow ──────────────────────
def parse_fabricshow(text: str) -> list:
    switches = []
    for line in text.splitlines():
        m = re.match(r"\s*\d+:\s+\w+\s+([0-9a-fA-F:]+)\s+(\S+)\s+(\S+)\s+\"([^\"]+)\"", line)
        if m:
            switches.append({
                "wwn": m.group(1),
                "enet_ip": m.group(2),
                "fc_ip": m.group(3),
                "name": m.group(4),
            })
    return switches

def parse_switchshow_detailed(text: str) -> dict:
    result = {"ports": []}
    parsing_ports = False
    for line in text.splitlines():
        line = line.strip()
        if not parsing_ports:
            if line.startswith("switchName:"): result["switchName"] = line.split(":", 1)[1].strip()
            elif line.startswith("switchState:"): result["switchState"] = line.split(":", 1)[1].strip()
            elif line.startswith("switchWwn:"): result["switchWwn"] = line.split(":", 1)[1].strip()
            elif line.startswith("Index Port Address"): parsing_ports = True
        else:
            if re.match(r"^\s*\d+\s+\d+\s+[0-9a-fA-F]+\s+", line):
                parts = line.split()
                if len(parts) >= 6:
                    result["ports"].append({
                        "index": parts[0],
                        "port": parts[1],
                        "state": parts[5],
                        "proto": parts[6] if len(parts) > 6 else ""
                    })
    return result

# ─────────────────────────────── showcage ─────────────────────────────────────
def parse_showcage(text: str) -> list:
    """
    Expected line:
      0  cage0  24  38C  H6060-J126  2U24  Normal
    """
    cages = []
    for line in text.splitlines():
        m = re.match(
            r"\s*(\d+)\s+"    # cage_id
            r"(\S+)\s+"       # name
            r"(\d+)\s+"       # drives
            r"(\S+)\s+"       # temp
            r"(\S+)\s+"       # model
            r"(\S+)\s+"       # form_factor
            r"(\S+)",         # state
            line
        )
        if m:
            cages.append({
                "cage_id":    int(m.group(1)),
                "name":       m.group(2),
                "drives":     int(m.group(3)),
                "temp":       m.group(4),
                "model":      m.group(5),
                "form_factor":m.group(6),
                "state":      m.group(7),
            })
    return cages


def parse_showcage_state(text: str) -> list:
    """
    Expected line:
      0  cage0  Normal  OK
    """
    cages = []
    for line in text.splitlines():
        m = re.match(
            r"\s*(\d+)\s+"   # cage_id
            r"(\S+)\s+"      # name
            r"(\S+)\s+"      # state
            r"(\S+)",        # detailed_state
            line
        )
        if m and m.group(2).startswith("cage"):
            cages.append({
                "cage_id":        int(m.group(1)),
                "name":           m.group(2),
                "state":          m.group(3),
                "detailed_state": m.group(4),
            })
    return cages


# ─────────────────────────────── showpd ───────────────────────────────────────
def parse_showpd(text: str) -> list:
    """
    Simulator output format (no RPM column):
     Id CagePos  Type State    Total_MiB Free_MiB Cap_GB
      0    0:0      SSD   normal   1966080    729677   1920
    """
    pds = []
    for line in text.splitlines():
        # 5-column format: id  cagepos  type  state  total  free  cap
        m = re.match(
            r"\s*(\d+)\s+"      # pd_id
            r"(\d+:\d+)\s+"     # cage_pos
            r"(\S+)\s+"         # type (SSD/HDD/NVMe)
            r"(normal|degraded|failed)\s+"  # state
            r"(\d+)\s+"         # total_mib
            r"(\d+)\s+"         # free_mib
            r"(\d+)",           # cap_gb
            line
        )
        if m:
            cage_pos = m.group(2)
            pds.append({
                "pd_id":       int(m.group(1)),
                "cage_pos":    cage_pos,
                "cage_id":     int(cage_pos.split(":")[0]),
                "slot":        int(cage_pos.split(":")[1]),
                "type":        m.group(3),
                "rpm":         "SSD" if m.group(3) in ("SSD", "NVMe") else "7200",
                "state":       m.group(4),
                "total_mib":   int(m.group(5)),
                "free_mib":    int(m.group(6)),
                "capacity_gb": int(m.group(7)),
            })
    return pds


def parse_showpd_s(text: str) -> dict:
    """showpd -s → {pd_id: {...}}"""
    pds = {}
    for line in text.splitlines():
        m = re.match(
            r"\s*(\d+)\s+(\d+:\d+)\s+(\S+)\s+(normal|degraded|failed)\s+(\S+)\s+(\S+)",
            line
        )
        if m:
            pid = int(m.group(1))
            pds[pid] = {
                "pd_id": pid,
                "cage_pos": m.group(2),
                "type": m.group(3),
                "state": m.group(4),
                "detailed_state": m.group(5),
                "sed_state": m.group(6),
            }
    return pds


def parse_showpd_i(text: str) -> dict:
    """showpd -i → {pd_id: {...}}"""
    pds = {}
    for line in text.splitlines():
        m = re.match(
            r"\s*(\d+)\s+(\d+:\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$",
            line
        )
        if m:
            pid = int(m.group(1))
            pds[pid] = {
                "pd_id": pid,
                "cage_pos": m.group(2),
                "state": m.group(3),
                "node_wwn": m.group(4),
                "manufacturer": m.group(5),
                "model": m.group(6),
                "serial": m.group(7),
                "fw_rev": m.group(8),
                "protocol": m.group(9),
                "disk_type": m.group(10),
                "admission_time": m.group(11).strip(),
            }
    return pds


def parse_showversion(text: str) -> dict:
    result = {"release_version": None, "release_type": None, "components": {}}
    for line in text.splitlines():
        if "Release version" in line:
            result["release_version"] = line.split()[-1]
        elif "Release Type:" in line:
            result["release_type"] = line.split(":", 1)[1].strip()
        else:
            m = re.match(r"^(.+?)\s{2,}(\S+)\s*$", line)
            if m and m.group(2)[:1].isdigit():
                result["components"][m.group(1).strip()] = m.group(2).strip()
    return result


# ─────────────────────────────── Top-level ─────────────────────────────────────
def parse_sim_array_output(cmd_outputs: dict) -> dict:
    """
    Main entry point called by the crawler.
    cmd_outputs: dict of {command_str: output_text}
    Returns the unified parsed entity dict.
    """
    def _get(*keys):
        for k in keys:
            if k in cmd_outputs and cmd_outputs[k].strip():
                return cmd_outputs[k]
        return ""

    version  = parse_showversion(_get("showversion -b"))
    sys_info = parse_showsys(_get("showsys"))
    nodes    = parse_shownode(_get("shownode"))
    ports    = parse_showport(_get("showport"))
    hosts    = parse_showhost(_get("showhost"))
    switches = parse_showswitch(_get("showswitch"))

    # cages: prefer -state if available
    cage_state = parse_showcage_state(_get("showcage -state"))
    cage_basic = parse_showcage(_get("showcage"))
    # Merge
    cage_state_map = {c["cage_id"]: c for c in cage_state}
    cage_basic_map = {c["cage_id"]: c for c in cage_basic}
    all_ids = set(list(cage_state_map) + list(cage_basic_map))
    cages = []
    for cid in sorted(all_ids):
        cage = {"cage_id": cid}
        if cid in cage_basic_map:
            cage.update(cage_basic_map[cid])
        if cid in cage_state_map:
            cage.update(cage_state_map[cid])
        cages.append(cage)

    # physical disks: merge base + -s + -i
    drives = parse_showpd(_get("showpd"))
    pds_s  = parse_showpd_s(_get("showpd -s"))
    pds_i  = parse_showpd_i(_get("showpd -i"))
    for pd in drives:
        pid = pd["pd_id"]
        if pid in pds_s:
            pd.update({k: v for k, v in pds_s[pid].items() if k not in pd})
        if pid in pds_i:
            pd.update({k: v for k, v in pds_i[pid].items() if k not in pd})

    portdevs = parse_showportdev(_get("showportdev ns -nohdtot 0:3:1", "showportdev ns -nohdtot 1:3:1"))
    fabric = parse_fabricshow(_get("fabricshow"))
    switch_detail = parse_switchshow_detailed(_get("switchshow"))

    protocols = list(set(p.get("protocol", "") for p in ports if p.get("protocol")))

    return {
        # Identity
        "array_id":         sys_info.get("array_id", ""),
        "name":             sys_info.get("name", ""),
        "model":            sys_info.get("model", ""),
        "serial":           sys_info.get("serial", ""),
        "release_version":  version.get("release_version", ""),
        "release_type":     version.get("release_type", ""),
        "node_count":       sys_info.get("nodes", len(nodes)),
        "master_node":      sys_info.get("master", 0),
        "total_cap_mib":    sys_info.get("total_cap_mib", 0),
        "alloc_cap_mib":    sys_info.get("alloc_cap_mib", 0),
        "free_cap_mib":     sys_info.get("free_cap_mib", 0),
        "failed_cap_mib":   sys_info.get("failed_cap_mib", 0),
        "config_type":      "switched" if switches else "switchless",
        "protocols_supported": protocols,
        # Entities
        "nodes":    nodes,
        "ports":    ports,
        "switches": switches,
        "hosts":    hosts,
        "cages":    cages,
        "drives":   drives,
        "portdevs": portdevs,
        "fabric":   fabric,
        "switch_detail": switch_detail,
        # Version components
        "components": [{"name": k, "version": v} for k, v in version.get("components", {}).items()],
    }
