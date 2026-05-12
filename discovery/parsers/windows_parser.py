"""
discovery/parsers/windows_parser.py

Parses Windows PowerShell command outputs collected during discovery
into structured dicts. Covers: Get-PhysicalDisk, wmic bios, Get-ComputerInfo,
Get-NetAdapter, Get-HBaPort, Get-WmiObject Win32_DiskDrive.
"""
import re

def parse_windows_output(outputs: dict, ip: str = "") -> dict:
    result = {
        "_ip": ip,
        "_device_type": "windows_host",
        "hostname": outputs.get("hostname", "").strip(),
        "ip_address": ip,
        "os_name": "",
        "os_version": "",
        "bios_version": "",
        "server_model": "",
        "cpu_model": "",
        "memory_gb": 0,
        "disks": [],
        "network_interfaces": [],
        "hba_ports": [],
        "raw": {},
    }

    # Get-PhysicalDisk
    pd_out = outputs.get("Get-PhysicalDisk | Select-Object DeviceId, Model, FirmwareVersion, Size", "")
    disks = []
    for line in pd_out.splitlines()[2:]:
        parts = line.split()
        if len(parts) >= 4:
            disks.append({
                "device_id": parts[0],
                "model": " ".join(parts[1:-2]),
                "firmware_rev": parts[-2],
                "size": parts[-1],
            })
    result["disks"] = disks

    # wmic bios / Get-WmiObject Win32_BIOS
    bios_out = outputs.get("wmic bios get smbiosbiosversion", "")
    lines = [l.strip() for l in bios_out.splitlines() if l.strip()]
    if len(lines) >= 2:
        result["bios_version"] = lines[1]

    # Get-ComputerInfo
    ci_out = outputs.get("Get-ComputerInfo", "")
    for line in ci_out.splitlines():
        if "WindowsProductName" in line:
            result["os_name"] = line.split(":", 1)[1].strip() if ":" in line else ""
        elif "WindowsVersion" in line:
            result["os_version"] = line.split(":", 1)[1].strip() if ":" in line else ""
        elif "CsName" in line:
            result["hostname"] = result["hostname"] or (line.split(":", 1)[1].strip() if ":" in line else "")
        elif "CsProcessors" in line:
            result["cpu_model"] = line.split(":", 1)[1].strip() if ":" in line else ""
        elif "OsTotalVisibleMemory" in line:
            try:
                kb = int(line.split(":", 1)[1].strip())
                result["memory_gb"] = round(kb / (1024 * 1024), 1)
            except Exception:
                pass

    # Get-NetAdapter
    net_out = outputs.get("Get-NetAdapter", "")
    ifaces = []
    for line in net_out.splitlines()[2:]:
        parts = line.split()
        if len(parts) >= 4:
            ifaces.append({"name": parts[0], "status": parts[2], "speed": parts[-1]})
    ip_match = re.search(r"IPv4 Address: (\d+\.\d+\.\d+\.\d+)", net_out)
    if ip_match:
        result["ip_address"] = result["ip_address"] or ip_match.group(1)
    result["network_interfaces"] = ifaces

    # Get-HBaPort
    hba_out = outputs.get("Get-HBaPort", "")
    if "NodeWWN" in hba_out:
        port = {}
        for line in hba_out.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                port[k.strip()] = v.strip()
        if port:
            result["hba_ports"] = [port]

    # Get-WmiObject Win32_DiskDrive
    wd_out = outputs.get("Get-WmiObject Win32_DiskDrive", "")
    if wd_out and not disks:
        for line in wd_out.splitlines()[2:]:
            parts = line.split()
            if len(parts) >= 3:
                disks.append({"model": " ".join(parts[:-2]), "device_id": parts[-2], "size_bytes": parts[-1]})
        result["disks"] = disks

    result["raw"] = {k: v[:300] for k, v in outputs.items()}
    return result
