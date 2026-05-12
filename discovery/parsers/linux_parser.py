"""
discovery/parsers/linux_parser.py

Parses Linux command outputs collected during discovery into structured dicts.
Covers: uname, os-release, lsblk, smartctl, ip addr, multipath, dmidecode.
"""
import re

def parse_linux_output(outputs: dict, ip: str = "") -> dict:
    result = {
        "_ip": ip,
        "_device_type": "linux_host",
        "hostname": _parse_hostname(outputs.get("hostname", "")),
        "ip_address": ip,
        "os_name": "",
        "os_version": "",
        "kernel": "",
        "architecture": "",
        "bios_version": "",
        "server_model": "",
        "cpu_model": "",
        "disks": [],
        "network_interfaces": [],
        "multipath": [],
        "raw": {},
    }

    # uname -a
    uname = outputs.get("uname -a", "")
    if uname:
        parts = uname.split()
        if len(parts) > 2:
            result["kernel"] = parts[2]
        if len(parts) > 11:
            result["architecture"] = parts[-2]

    # cat /etc/os-release
    osrel = outputs.get("cat /etc/os-release", "")
    for line in osrel.splitlines():
        if line.startswith("NAME="):
            result["os_name"] = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("VERSION="):
            result["os_version"] = line.split("=", 1)[1].strip().strip('"')

    # lsblk
    lsblk = outputs.get("lsblk", "")
    disks = []
    for line in lsblk.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 4 and "disk" in parts:
            disks.append({"device": parts[0].strip(), "size": parts[3]})
    result["disks_raw"] = disks

    # smartctl per disk
    disks_smart = []
    for cmd, out in outputs.items():
        if cmd.startswith("smartctl -a"):
            dev = cmd.split()[-1]
            smart = _parse_smartctl(out, dev)
            if smart:
                disks_smart.append(smart)
    result["disks"] = disks_smart

    # ip addr show
    ip_out = outputs.get("ip addr show", "")
    ifaces = []
    cur_if = {}
    for line in ip_out.splitlines():
        m = re.match(r"^\d+: (\w+):", line)
        if m:
            if cur_if:
                ifaces.append(cur_if)
            cur_if = {"name": m.group(1)}
        m2 = re.search(r"inet (\d+\.\d+\.\d+\.\d+)", line)
        if m2 and cur_if:
            cur_if["inet"] = m2.group(1)
    if cur_if:
        ifaces.append(cur_if)
    result["network_interfaces"] = ifaces

    # multipath -ll
    mp = outputs.get("multipath -ll", "")
    if mp and "mpatha" in mp:
        result["multipath"] = [{"raw": mp[:200]}]

    # dmidecode
    result["bios_version"] = outputs.get("dmidecode -s bios-version", "").strip()
    result["server_model"] = outputs.get("dmidecode -s system-product-name", "").strip()

    # CPU
    cpuinfo = outputs.get("cat /proc/cpuinfo | grep 'model name' | head -1", "")
    if ":" in cpuinfo:
        result["cpu_model"] = cpuinfo.split(":", 1)[1].strip()

    result["raw"] = {k: v[:300] for k, v in outputs.items()}
    return result


def _parse_hostname(output: str) -> str:
    return output.strip().splitlines()[0] if output.strip() else "unknown"


def _parse_smartctl(output: str, device: str) -> dict:
    d = {"device": device}
    for line in output.splitlines():
        if line.startswith("Device Model:"):
            d["model"] = line.split(":", 1)[1].strip()
        elif line.startswith("Serial Number:"):
            d["serial"] = line.split(":", 1)[1].strip()
        elif line.startswith("Firmware Version:"):
            d["firmware_rev"] = line.split(":", 1)[1].strip()
        elif line.startswith("User Capacity:"):
            d["capacity_raw"] = line.split(":", 1)[1].strip()
        elif "SMART overall-health" in line:
            d["health"] = "PASSED" if "PASSED" in line else "FAILED"
    return d if len(d) > 1 else None
