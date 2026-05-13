"""
universal_parser.py – Converts raw CLI dumps into instance-based Universal JSON.
"""
import sys
import os
import json
import re

# Add current dir to path for local imports
sys.path.insert(0, os.path.dirname(__file__))

from .parser import (
    parse_showversion, parse_showsys, parse_shownode, parse_showport,
    parse_showhost, parse_showswitch, parse_showcage, parse_showcage_state,
    parse_showpd, parse_showpd_s, parse_showpd_i, infer_array_identity,
)

def _split_commands(raw_text):
    blocks = {}
    lines = raw_text.splitlines()
    has_plus = any(l.startswith("+ ") for l in lines)

    if has_plus:
        cur = None
        for line in lines:
            if line.startswith("+ "):
                cur = line[2:].strip()
                blocks[cur] = []
            elif cur is not None:
                blocks[cur].append(line)
    else:
        KNOWN = [
            "showversion -b", "showhost", "showsys", "shownode", "showport",
            "showswitch", "showpd -s", "showpd -i", "showpd",
            "showcage -state", "showcage -pci", "showcage -sfp", "showcage",
            "cli checkhealth", "lscpu",
        ]
        KNOWN.sort(key=len, reverse=True)
        cur = None
        for line in lines:
            stripped = line.strip()
            matched = None
            for cmd in KNOWN:
                if stripped == cmd or stripped.startswith(cmd + " "):
                    matched = stripped
                    break
            if matched:
                cur = matched
                blocks[cur] = []
            elif cur is not None:
                blocks[cur].append(line)
    return {cmd: "\n".join(output_lines) for cmd, output_lines in blocks.items()}

def _get_block(blocks, *candidates):
    for c in candidates:
        if c in blocks:
            return blocks[c]
    return ""

def parse_array_dump(raw_text):
    blocks = _split_commands(raw_text)
    version = parse_showversion(_get_block(blocks, "showversion -b"))
    sys_info = parse_showsys(_get_block(blocks, "showsys"))
    nodes = parse_shownode(_get_block(blocks, "shownode"))
    sys_info = infer_array_identity(sys_info, nodes, version)
    ports = parse_showport(_get_block(blocks, "showport"))
    hosts = parse_showhost(_get_block(blocks, "showhost"))
    switches = parse_showswitch(_get_block(blocks, "showswitch"))

    cages_state = parse_showcage_state(_get_block(blocks, "showcage -state"))
    cages_basic = parse_showcage(_get_block(blocks, "showcage"))
    cages = []
    cage_state_map = {c["cage_id"]: c for c in cages_state}
    cage_basic_map = {c["cage_id"]: c for c in cages_basic}
    all_cage_ids = set(list(cage_state_map.keys()) + list(cage_basic_map.keys()))
    for cid in sorted(all_cage_ids):
        cage = {"cage_id": cid}
        if cid in cage_basic_map:
            cage.update(cage_basic_map[cid])
        if cid in cage_state_map:
            cage.update(cage_state_map[cid])
        cages.append(cage)

    pds = parse_showpd(_get_block(blocks, "showpd"))
    pds_s = parse_showpd_s(_get_block(blocks, "showpd -s"))
    pds_i = parse_showpd_i(_get_block(blocks, "showpd -i"))
    for pd in pds:
        pid = pd["pd_id"]
        if pid in pds_s:
            pd.update({k: v for k, v in pds_s[pid].items() if k not in pd})
        if pid in pds_i:
            pd.update({k: v for k, v in pds_i[pid].items() if k not in pd})

    config_type = "switched" if switches else "switchless"
    protocols = list(set(p.get("protocol", "") for p in ports if p.get("protocol")))

    result = {
        "array_id": sys_info.get("array_id", ""),
        "name": sys_info.get("name", ""),
        "model": sys_info.get("model", ""),
        "serial": sys_info.get("serial", ""),
        "release_version": version.get("release_version", ""),
        "release_type": version.get("release_type", ""),
        "node_count": sys_info.get("nodes", 0),
        "master_node": sys_info.get("master", 0),
        "total_cap_mib": sys_info.get("total_cap_mib", 0),
        "alloc_cap_mib": sys_info.get("alloc_cap_mib", 0),
        "free_cap_mib": sys_info.get("free_cap_mib", 0),
        "failed_cap_mib": sys_info.get("failed_cap_mib", 0),
        "config_type": config_type,
        "protocols_supported": protocols,
        "components": [{"name": k, "version": v} for k, v in version.get("components", {}).items()],
        "nodes": nodes,
        "ports": ports,
        "switches": switches,
        "hosts": hosts,
        "cages": cages,
        "drives": pds,
    }
    return result

def parse_via_proxy(device_file):
    from .proxy import get_command_output
    def _get(cmd):
        return get_command_output(device_file, cmd)

    version = parse_showversion(_get("showversion -b"))
    sys_info = parse_showsys(_get("showsys"))
    nodes = parse_shownode(_get("shownode"))
    sys_info = infer_array_identity(sys_info, nodes, version)
    ports = parse_showport(_get("showport"))
    hosts = parse_showhost(_get("showhost"))
    switches = parse_showswitch(_get("showswitch"))
    cages_state = parse_showcage_state(_get("showcage -state"))
    cages_basic = parse_showcage(_get("showcage"))
    cages = []
    cage_state_map = {c["cage_id"]: c for c in cages_state}
    cage_basic_map = {c["cage_id"]: c for c in cages_basic}
    for cid in sorted(set(list(cage_state_map.keys()) + list(cage_basic_map.keys()))):
        cage = {"cage_id": cid}
        if cid in cage_basic_map: cage.update(cage_basic_map[cid])
        if cid in cage_state_map: cage.update(cage_state_map[cid])
        cages.append(cage)

    pds = parse_showpd(_get("showpd"))
    pds_s = parse_showpd_s(_get("showpd -s"))
    pds_i = parse_showpd_i(_get("showpd -i"))
    for pd in pds:
        pid = pd["pd_id"]
        if pid in pds_s: pd.update({k: v for k, v in pds_s[pid].items() if k not in pd})
        if pid in pds_i: pd.update({k: v for k, v in pds_i[pid].items() if k not in pd})

    config_type = "switched" if switches else "switchless"
    protocols = list(set(p.get("protocol", "") for p in ports if p.get("protocol")))

    return {
        "array_id": sys_info.get("array_id", ""),
        "name": sys_info.get("name", ""),
        "model": sys_info.get("model", ""),
        "serial": sys_info.get("serial", ""),
        "release_version": version.get("release_version", ""),
        "release_type": version.get("release_type", ""),
        "node_count": sys_info.get("nodes", 0),
        "master_node": sys_info.get("master", 0),
        "total_cap_mib": sys_info.get("total_cap_mib", 0),
        "alloc_cap_mib": sys_info.get("alloc_cap_mib", 0),
        "free_cap_mib": sys_info.get("free_cap_mib", 0),
        "failed_cap_mib": sys_info.get("failed_cap_mib", 0),
        "config_type": config_type,
        "protocols_supported": protocols,
        "components": [{"name": k, "version": v} for k, v in version.get("components", {}).items()],
        "nodes": nodes,
        "ports": ports,
        "switches": switches,
        "hosts": hosts,
        "cages": cages,
        "drives": pds,
    }
