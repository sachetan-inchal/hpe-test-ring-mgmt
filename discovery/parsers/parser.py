"""
parser.py – Parse raw CLI outputs into structured Python dicts.
Adapted from san_dashboard/backend/parser.py with all regex parsers.
"""
import re


def parse_showversion(text):
    """Parse 'showversion -b' output."""
    result = {"release_version": None, "release_type": None, "components": {}}
    for line in text.splitlines():
        if line.startswith("Release version"):
            result["release_version"] = line.split()[-1]
        elif line.startswith("Release Type:"):
            result["release_type"] = line.split(":", 1)[1].strip()
        else:
            m = re.match(r"^(.+?)\s{2,}(\S+)\s*$", line)
            if m and m.group(2)[0:1].isdigit():
                result["components"][m.group(1).strip()] = m.group(2).strip()
    return result


def parse_showsys(text):
    """Parse 'showsys' output → dict with array identity."""
    for line in text.splitlines():
        # Try full format: ID Name Model Serial Nodes Master TotalCap AllocCap FreeCap FailedCap
        m = re.match(
            r"^\s*(0x\w+)\s+(\S+)\s+(.+?)\s+(\S+)\s+(\d+)\s+(\d+)\s+"
            r"(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$", line
        )
        if m:
            return {
                "array_id": m.group(1), "name": m.group(2),
                "model": m.group(3).strip(), "serial": m.group(4),
                "nodes": int(m.group(5)), "master": int(m.group(6)),
                "total_cap_mib": int(m.group(7)), "alloc_cap_mib": int(m.group(8)),
                "free_cap_mib": int(m.group(9)), "failed_cap_mib": int(m.group(10)),
            }
    return {}


def infer_array_identity(sys_info, nodes, version_info):
    """Infer missing array identity from node names and version data.
    
    If showsys data line was truncated, tries to extract the array serial
    from shownode node names (pattern: SERIAL-NodeID like 4UW0004634-0).
    """
    if sys_info.get("name"):
        return sys_info  # Already have data

    result = dict(sys_info) if sys_info else {}

    # Try to extract serial from node names
    if nodes:
        node_name = nodes[0].get("name", "")
        m = re.match(r"^(.+)-\d+$", node_name)
        if m:
            serial = m.group(1)
            result.setdefault("serial", serial)
            result.setdefault("name", f"s{serial[-4:]}" if len(serial) >= 4 else serial)

    result.setdefault("nodes", len(nodes))
    result.setdefault("master", 0)
    for n in nodes:
        if n.get("is_master"):
            result["master"] = n["node_id"]
            break

    if version_info:
        result.setdefault("release_version", version_info.get("release_version", ""))

    return result


def parse_shownode(text):
    """Parse 'shownode' output → list of node dicts."""
    nodes = []
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+)\s+(\S+)\s+(\d+:\d+)\s+(Yes|No)\s+(Yes|No)\s+(\d+)\s+(.+)$",
            line
        )
        if m:
            nodes.append({
                "node_id": int(m.group(1)), "name": m.group(2),
                "encl_bay": m.group(3),
                "is_master": m.group(4) == "Yes",
                "in_cluster": m.group(5) == "Yes",
                "memory_mib": int(m.group(6)),
                "up_since": m.group(7).strip(),
            })
    return nodes


def parse_showport(text):
    """Parse 'showport' output → list of port dicts."""
    ports = []
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+:\d+:\d+)\s+(initiator|target|peer)\s+"
            r"(ready|loss_sync|offline)\s+(\S+)\s+(\S+)\s+"
            r"(host|disk|free|file|cluster)\s+(\S+)\s*(.*)?$",
            line
        )
        if m:
            ports.append({
                "port_id": m.group(1),
                "node": int(m.group(1).split(":")[0]),
                "slot": int(m.group(1).split(":")[1]),
                "port_num": int(m.group(1).split(":")[2]),
                "mode": m.group(2), "state": m.group(3),
                "node_wwn_ip": m.group(4), "port_wwn_hw": m.group(5),
                "type": m.group(6), "protocol": m.group(7),
                "label": m.group(8).strip() if m.group(8) else "-",
            })
    return ports


def parse_showhost(text):
    """Parse 'showhost' output → list of host dicts {wwn, ports[], multipath_status}."""
    host_map = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(?:--\s+)?(\w{16})\s+(\d+:\d+:\d+|\-{3})\s*$", line)
        if m:
            wwn, port = m.group(1), m.group(2)
            if wwn not in host_map:
                host_map[wwn] = {"wwn": wwn, "ports": [], "missing_path": False}
            if port != "---":
                host_map[wwn]["ports"].append(port)
            else:
                host_map[wwn]["missing_path"] = True
    for h in host_map.values():
        unique_nodes = {p.split(":")[0] for p in h["ports"]}
        h["multipath_status"] = "dual" if len(unique_nodes) >= 2 else ("single" if unique_nodes else "none")
    return list(host_map.values())


def parse_showswitch(text):
    """Parse 'showswitch' output → list of switch dicts."""
    switches = []
    for line in text.splitlines():
        m = re.match(
            r"^(\S+)\s+(Normal|Fault|Degraded|Unknown)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)",
            line, re.IGNORECASE
        )
        if m:
            switches.append({
                "name": m.group(1), "state": m.group(2), "mode": m.group(3),
                "locate_led": m.group(4), "serial": m.group(5),
                "ps1": m.group(6), "ps2": m.group(7),
                "fans": m.group(8), "temperature": m.group(9),
            })
    return switches


def parse_showcage_state(text):
    """Parse 'showcage -state' output → list of cage dicts."""
    cages = []
    for line in text.splitlines():
        m = re.match(r"^\s*(\d+)\s+(cage\d+)\s+(\S+)\s+(\S+)\s*$", line)
        if m:
            cages.append({
                "cage_id": int(m.group(1)), "name": m.group(2),
                "state": m.group(3), "detailed_state": m.group(4),
            })
    return cages


def parse_showcage(text):
    """Parse basic 'showcage' output → list of cage dicts."""
    cages = []
    for line in text.splitlines():
        m = re.match(r"^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$", line)
        if m:
            cages.append({
                "cage_id": int(m.group(1)), "name": m.group(2),
                "drives": int(m.group(3)), "temp": m.group(4),
                "model": m.group(5), "form_factor": m.group(6),
                "state": m.group(7),
            })
    return cages


def parse_showpd(text):
    """Parse 'showpd' output → list of physical disk dicts."""
    pds = []
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+)\s+(\d+:\d+)\s+(\S+)\s+(\S+)\s+(normal|degraded|failed)\s+(\d+)\s+(\d+)\s+(\d+)",
            line
        )
        if m:
            pds.append({
                "pd_id": int(m.group(1)), "cage_pos": m.group(2),
                "cage_id": int(m.group(2).split(":")[0]),
                "slot": int(m.group(2).split(":")[1]),
                "type": m.group(3), "rpm": m.group(4), "state": m.group(5),
                "total_mib": int(m.group(6)), "free_mib": int(m.group(7)),
                "capacity_gb": int(m.group(8)),
            })
    return pds


def parse_showpd_s(text):
    """Parse 'showpd -s' output → dict keyed by pd_id."""
    pds = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(\d+)\s+(\d+:\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$", line)
        if m:
            pds[int(m.group(1))] = {
                "pd_id": int(m.group(1)), "cage_pos": m.group(2),
                "type": m.group(3), "state": m.group(4),
                "detailed_state": m.group(5), "sed_state": m.group(6),
            }
    return pds


def parse_showpd_i(text):
    """Parse 'showpd -i' output → dict keyed by pd_id."""
    pds = {}
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+)\s+(\d+:\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$",
            line
        )
        if m:
            pds[int(m.group(1))] = {
                "pd_id": int(m.group(1)), "cage_pos": m.group(2),
                "state": m.group(3), "node_wwn": m.group(4),
                "manufacturer": m.group(5), "model": m.group(6),
                "serial": m.group(7), "fw_rev": m.group(8),
                "protocol": m.group(9), "disk_type": m.group(10),
                "admission_time": m.group(11).strip(),
            }
    return pds


def parse_device(proxy_func, device_file):
    """Parse all CLI commands from a device file using the proxy.
    
    Args:
        proxy_func: callable(device_file, command) → str
        device_file: device data filename
    Returns:
        dict with all parsed sections
    """
    def _get(cmd):
        return proxy_func(device_file, cmd)

    version = parse_showversion(_get("showversion -b"))
    sys_info = parse_showsys(_get("showsys"))
    nodes = parse_shownode(_get("shownode"))
    ports = parse_showport(_get("showport"))
    hosts = parse_showhost(_get("showhost"))
    switches = parse_showswitch(_get("showswitch"))
    cages = parse_showcage_state(_get("showcage -state"))
    if not cages:
        cages = parse_showcage(_get("showcage"))
    pds = parse_showpd(_get("showpd"))
    pds_s = parse_showpd_s(_get("showpd -s"))
    pds_i = parse_showpd_i(_get("showpd -i"))

    # Merge pd info
    for pd in pds:
        pid = pd["pd_id"]
        if pid in pds_s:
            pd.update({k: v for k, v in pds_s[pid].items() if k not in pd})
        if pid in pds_i:
            pd.update({k: v for k, v in pds_i[pid].items() if k not in pd})

    return {
        "version": version, "sys_info": sys_info,
        "nodes": nodes, "ports": ports, "hosts": hosts,
        "switches": switches, "cages": cages,
        "physical_disks": pds,
    }
