"""
discovery/fingerprint.py

Device OS fingerprinting — determines whether a device at a given IP
is an HPE Storage Array, a Linux host, or a Windows host.
Uses lightweight probe commands that each terminal type responds to distinctively.
"""
import enum

class DeviceType(enum.Enum):
    HPE_ARRAY = "hpe_array"
    LINUX     = "linux_host"
    WINDOWS   = "windows_host"
    UNKNOWN   = "unknown"


def fingerprint_device(ip: str, virtual_network) -> DeviceType:
    """
    Probe a device and classify it by OS/device type.
    """
    # Check network metadata first (fastest path)
    meta = virtual_network.get_metadata(ip)
    meta_type = meta.get("type", "")
    meta_os = meta.get("os_type", "")

    if meta_type == "array":
        return DeviceType.HPE_ARRAY
    if meta_type == "switch":
        return DeviceType.HPE_ARRAY   # switches also respond to showswitch/showport
    if meta_type == "host":
        if meta_os == "windows":
            return DeviceType.WINDOWS
        return DeviceType.LINUX

    # Fallback: probe with showsys (HPE CLI)
    probe = virtual_network.execute(ip, "showsys")
    if probe and "Connection refused" not in probe and "not found" not in probe.lower():
        if any(kw in probe for kw in ["TotalCap", "AllocCap", "Model", "Serial"]):
            return DeviceType.HPE_ARRAY

    # Probe with uname (Linux)
    probe = virtual_network.execute(ip, "uname -a")
    if probe and "Linux" in probe:
        return DeviceType.LINUX

    # Probe with Windows
    probe = virtual_network.execute(ip, "hostname")
    if probe and "Connection refused" not in probe:
        probe_w = virtual_network.execute(ip, "Get-ComputerInfo")
        if "WindowsProductName" in probe_w:
            return DeviceType.WINDOWS

    return DeviceType.UNKNOWN
