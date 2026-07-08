"""
discovery/parsers/sim_parser.py

Parses the HPE CLI output by running the dynamic Javascript V8 parsers via Node.js.
Ensures zero duplication of parsing code and 100% fidelity to the test cases.
"""
import os
import sys
import json
import subprocess
import logging

log = logging.getLogger(__name__)

def run_js_parser(cmd_or_func: str, cli_output: str):
    """Executes the Node.js runner to parse the CLI output.

    NOTE: The Node runner is responsible for extracting/parsing the JS functions from
    discovery/parsers/testcases-markdown.md and executing them in a sandbox.

    Important: The parser functions expect *pure JS parsing logic* (no markdown syntax).
    This backend passes only raw CLI output to the runner.
    """
    if not cli_output or not cli_output.strip():
        # Return appropriate defaults for empty input
        if cmd_or_func in ("parseShowSys", "parseShowVersion", "showsys", "showversion -b"):
            return {}
        return {"nodes": [], "ports": [], "switches": [], "hosts": [], "cages": [], "drives": [], "slots": []}

    try:
        runner_path = os.path.join(os.path.dirname(__file__), "js_parser_runner.js")
        # Support PARSER_MODE env var: "vm" (default) or "direct" (no VM sandbox)
        parser_mode = os.environ.get("HPE_PARSER_MODE", "vm").strip().lower()
        cmd = ["node", runner_path, cmd_or_func]
        if parser_mode == "direct":
            cmd.append("--no-vm")
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        stdout, stderr = proc.communicate(input=cli_output)  # no timeout – waits as long as needed

        if proc.returncode == 0:
            try:
                return json.loads(stdout)
            except Exception as json_err:
                log.error(f"[js_parser] JSON decode failed for {cmd_or_func}: {json_err} | stdout={stdout[:200]}")
                return {}
        else:
            log.error(f"[js_parser] Runner error for {cmd_or_func}: {stderr}")
            return {}
    except Exception as e:
        log.error(f"[js_parser] Subprocess execution failed for {cmd_or_func}: {e}")
        return {}



# ─────────────────────────────── Wrappers ──────────────────────────────────────

def parse_showsys(text: str) -> dict:
    return run_js_parser("parseShowSys", text)

def parse_shownode(text: str) -> list:
    res = run_js_parser("parseShowNode", text)
    return res.get("nodes", [])

def parse_showport(text: str) -> list:
    res = run_js_parser("parseShowPort", text)
    return res.get("ports", [])

def parse_showhost(text: str) -> list:
    res = run_js_parser("parseShowHost", text)
    return res.get("hosts", [])

def parse_showswitch(text: str) -> list:
    res = run_js_parser("parseShowSwitch", text)
    return res.get("switches", [])

def parse_showcage(text: str) -> list:
    res = run_js_parser("parseShowCageBasic", text)
    cages = res.get("cages", [])
    for c in cages:
        if "id" in c and "cage_id" not in c:
            c["cage_id"] = str(c["id"])
    return cages

def parse_showcage_state(text: str) -> list:
    res = run_js_parser("parseShowCageState", text)
    cages = res.get("cages", [])
    for c in cages:
        if "id" in c and "cage_id" not in c:
            c["cage_id"] = str(c["id"])
    return cages

def parse_showpd(text: str) -> list:
    res = run_js_parser("parseShowPdBasic", text)
    drives = res.get("drives", [])
    for d in drives:
        if "id" in d and "pd_id" not in d:
            d["pd_id"] = str(d["id"])
    return drives

def parse_showpd_s(text: str) -> dict:
    res = run_js_parser("parseShowPdS", text)
    drives = res.get("drives", [])
    out = {}
    for d in drives:
        pid = str(d.get("id", ""))
        d["pd_id"] = pid
        out[pid] = d
    return out

def parse_showpd_i(text: str) -> dict:
    res = run_js_parser("parseShowPdI", text)
    drives = res.get("drives", [])
    out = {}
    for d in drives:
        pid = str(d.get("id", ""))
        d["pd_id"] = pid
        out[pid] = d
    return out

def parse_showversion(text: str) -> dict:
    return run_js_parser("parseShowVersion", text)

def parse_showportdev_ns(text: str) -> dict:
    return run_js_parser("parseShowPortDevNS", text)


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
    
    # Merge HBA detail, driver, firmware from showportdev ns if available
    portdev_keys = [k for k in cmd_outputs if k.strip().lower().startswith("showportdev")]
    for pk in portdev_keys:
        try:
            pd_parsed = parse_showportdev_ns(cmd_outputs[pk])
            entries = pd_parsed.get("entries", [])
            for entry in entries:
                wwn = entry.get("port_wwn") or entry.get("node_wwn")
                hname = entry.get("connected_host") or entry.get("hostname")
                if not hname:
                    continue
                hname_short = hname.split(".")[0]
                
                matched = False
                for h in hosts:
                    h_wwn = (h.get("wwn") or "").lower()
                    h_name = (h.get("name") or "").lower()
                    if (wwn and h_wwn == wwn.lower()) or (hname_short.lower() in h_name) or (h_name in hname_short.lower()):
                        h["os"] = entry.get("os")
                        h["os_name"] = entry.get("os")
                        h["hba_fw"] = entry.get("hba_fw")
                        h["hba_driver"] = entry.get("hba_driver")
                        h["hba_model"] = entry.get("hba_model")
                        if "Port" not in h:
                            h["Port"] = []
                        if pd_parsed.get("array_port") and not any(p.get("nsp") == pd_parsed["array_port"] for p in h["Port"]):
                            pParts = pd_parsed["array_port"].split(":")
                            portObj = {"nsp": pd_parsed["array_port"]}
                            if len(pParts) == 3:
                                portObj["node"] = int(pParts[0])
                                portObj["slot"] = int(pParts[1])
                                portObj["port"] = int(pParts[2])
                            h["Port"].append(portObj)
                        matched = True
                        break
                
                if not matched:
                    new_h = {
                        "wwn": wwn,
                        "name": hname_short,
                        "os": entry.get("os"),
                        "os_name": entry.get("os"),
                        "hba_fw": entry.get("hba_fw"),
                        "hba_driver": entry.get("hba_driver"),
                        "hba_model": entry.get("hba_model"),
                        "Port": []
                    }
                    if pd_parsed.get("array_port"):
                        pParts = pd_parsed["array_port"].split(":")
                        portObj = {"nsp": pd_parsed["array_port"]}
                        if len(pParts) == 3:
                            portObj["node"] = int(pParts[0])
                            portObj["slot"] = int(pParts[1])
                            portObj["port"] = int(pParts[2])
                        new_h["Port"].append(portObj)
                    hosts.append(new_h)
        except Exception as e:
            log.error(f"Failed to merge showportdev details: {e}")

    switches = parse_showswitch(_get("showswitch"))

    # Cages: Merge basic and state cage details
    cages_basic = parse_showcage(_get("showcage"))
    cages_state = parse_showcage_state(_get("showcage -state"))
    cages_map = {}
    for c in cages_basic:
        cages_map[c["cage_id"]] = c
    for c in cages_state:
        cid = c["cage_id"]
        if cid in cages_map:
            cages_map[cid].update(c)
        else:
            cages_map[cid] = c
    cages = list(cages_map.values())

    # PCI / SFP slots
    slots_pci = run_js_parser("parseShowCagePCI", _get("showcage -pci"))
    slots_sfp = run_js_parser("parseShowCageSFP", _get("showcage -sfp"))
    slots_map = {}
    
    # Process PCI slots
    for s in slots_pci.get("slots", []):
        cid = str(s.get("cage", ""))
        slot_num = s.get("slot")
        key = (cid, slot_num)
        
        s_mapped = {
            "cage_id": cid,
            "slot": slot_num,
            "type": s.get("type", "PCI"),
            "manufacturer": s.get("manufacturer", ""),
            "model": s.get("model", ""),
            "serial": s.get("serial", ""),
            "rev": s.get("rev", ""),
            "firmware": s.get("firmware", ""),
            "state": s.get("state", "OK")
        }
        slots_map[key] = s_mapped
        
    # Process SFP slots
    for s in slots_sfp.get("sfps", []):
        cid = str(s.get("cage", ""))
        slot_num = s.get("sfp")
        key = (cid, slot_num)
        
        s_mapped = {
            "cage_id": cid,
            "slot": slot_num,
            "type": "SFP",
            "manufacturer": s.get("manufacturer", ""),
            "part_number": s.get("part_number", ""),
            "serial": s.get("serial_number", ""),
            "qualified": s.get("qualified", ""),
            "max_speed_gbps": s.get("max_speed_gbps", 0),
            "state": s.get("state", "OK"),
            "ddm": s.get("ddm", ""),
            "rx_loss": s.get("rx_loss", "")
        }
        
        if key in slots_map:
            slots_map[key].update(s_mapped)
        else:
            slots_map[key] = s_mapped
            
    cage_slots = list(slots_map.values())

    # Physical disks: merge base + -s + -i
    drives = parse_showpd(_get("showpd"))
    pds_s  = parse_showpd_s(_get("showpd -s"))
    pds_i  = parse_showpd_i(_get("showpd -i"))
    for pd in drives:
        pid = pd["pd_id"]
        if pid in pds_s:
            pd.update({k: v for k, v in pds_s[pid].items() if k not in pd})
        if pid in pds_i:
            pd.update({k: v for k, v in pds_i[pid].items() if k not in pd})

    protocols = list(set(p.get("protocol", "") for p in ports if p.get("protocol")))

    return {
        # Identity
        "array_id":         sys_info.get("id", sys_info.get("array_id", "")),
        "name":             sys_info.get("name", ""),
        "model":            sys_info.get("model", ""),
        "serial":           sys_info.get("serial", ""),
        "release_version":  version.get("release_version", ""),
        "release_type":     version.get("release_type", ""),
        "node_count":       sys_info.get("nodes", len(nodes)),
        "master_node":      sys_info.get("master", 0),
        "total_cap_mib":    sys_info.get("total_cap", 0),
        "alloc_cap_mib":    sys_info.get("alloc_cap", 0),
        "free_cap_mib":     sys_info.get("free_cap", 0),
        "failed_cap_mib":   sys_info.get("failed_cap", 0),
        "config_type":      "switched" if switches else "switchless",
        "protocols_supported": protocols,
        # Entities
        "nodes":    nodes,
        "ports":    ports,
        "switches": switches,
        "hosts":    hosts,
        "cages":    cages,
        "drives":   drives,
        "cage_slots": cage_slots,
        # Version components
        "components": [{"name": k, "version": v} for k, v in version.get("components", {}).items()] if isinstance(version.get("components"), dict) else version.get("components", []),
    }
