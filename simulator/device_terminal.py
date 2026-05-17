"""
simulator/device_terminal.py

Virtual device terminal — runs in a thread and responds to CLI commands
exactly as a real HPE array, Linux host, or Windows host would.

Uses the proxy.py logic to replay CLI captures for HPE devices.
For Linux/Windows hosts, generates OS-appropriate command responses
based on the host config from the network topology.

This is the core "living element" of the Cisco Packet Tracer-like simulator.
"""
import os
import sys
import json
import time
import threading
import queue
import random

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data", "devices")

# ── Base Terminal ──────────────────────────────────────────────────────────────

class BaseTerminal:
    """Abstract terminal — subclass for each device type."""

    def __init__(self, device_id: str, ip: str, config: dict):
        self.device_id = device_id
        self.ip = ip
        self.config = config
        self._alive = True
        self._cmd_queue = queue.Queue()
        self._resp_queue = queue.Queue()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def execute(self, command: str, timeout: float = 5.0) -> str:
        """Send a command to this terminal and receive its output."""
        self._cmd_queue.put(command)
        try:
            return self._resp_queue.get(timeout=timeout)
        except queue.Empty:
            return f"Error: Command '{command}' timed out on {self.ip}"

    def shutdown(self):
        self._alive = False
        self._cmd_queue.put("__exit__")

    def _run(self):
        while self._alive:
            try:
                cmd = self._cmd_queue.get(timeout=1.0)
                if cmd == "__exit__":
                    break
                response = self._handle(cmd)
                self._resp_queue.put(response)
            except queue.Empty:
                continue

    def _handle(self, command: str) -> str:
        raise NotImplementedError


# ── HPE Array Terminal ─────────────────────────────────────────────────────────

class HPEArrayTerminal(BaseTerminal):
    """
    Simulates an HPE storage array CLI terminal.
    Uses the proxy.py engine to replay CLI captures from data/devices/*.txt.
    Supports ALL commands from the m2-commands-data reference.
    """

    PROMPT = "cli% "
    SSH_KEY_TYPE = "RSA"

    def __init__(self, device_id: str, ip: str, config: dict, device_file: str):
        self.device_file = device_file
        # Lazy-load proxy; it resolves DATA_DIR relative to its own location
        sys.path.insert(0, os.path.join(BASE_DIR, "..", "discovery"))
        super().__init__(device_id, ip, config)

    def _handle(self, command: str) -> str:
        from proxy_engine import get_command_output
        time.sleep(0.05)  # simulate real latency
        output = get_command_output(self.device_file, command)
        return f"{self.PROMPT}{command}\n{output}"


# ── Linux Host Terminal ────────────────────────────────────────────────────────

class LinuxHostTerminal(BaseTerminal):
    """
    Simulates a Linux server terminal (RHEL, Ubuntu, Oracle Linux).
    Responds to topology, hardware discovery, and firmware commands.
    """

    PROMPT = "$ "
    SSH_KEY_TYPE = "ECDSA"

    def _handle(self, command: str) -> str:
        time.sleep(0.05)
        cmd = command.strip()
        c = self.config

        if cmd in ("uname -a", "uname"):
            hostname = c.get("name", "linux-host")
            ver = c.get("os_version", "5.14.0")
            return f"Linux {hostname} {ver}-284.30.1.el9_2.x86_64 #1 SMP PREEMPT_DYNAMIC Fri Nov 3 SMP x86_64 GNU/Linux"

        elif cmd == "cat /etc/os-release":
            os_name = c.get("os_name", "Red Hat Enterprise Linux")
            os_ver = c.get("os_version", "9.2")
            return (
                f'NAME="{os_name}"\n'
                f'VERSION="{os_ver} (Plow)"\n'
                f'ID="rhel"\nVERSION_ID="{os_ver}"\n'
                f'PRETTY_NAME="{os_name} {os_ver} (Plow)"\n'
                f'HOME_URL="https://www.redhat.com/"\n'
                f'BUG_REPORT_URL="https://bugzilla.redhat.com/"'
            )

        elif cmd == "lsblk":
            lines = ["NAME    MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS"]
            for i, disk in enumerate(c.get("disks", [])):
                dev = f"sd{chr(97+i)}"
                lines.append(f"{dev:<8}  8:{i*16}   0 {disk.get('capacity_gb', 3840)}G  0 disk")
                lines.append(f"  {dev}1    8:{i*16+1} 0 {disk.get('capacity_gb', 3840)}G  0 part /data")
            if not c.get("disks"):
                lines.append("sda       8:0    0  500G  0 disk")
                lines.append("  sda1    8:1    0  500G  0 part /")
            return "\n".join(lines)

        elif cmd.startswith("smartctl -a"):
            dev = cmd.split()[-1] if len(cmd.split()) > 2 else "/dev/sda"
            disks = c.get("disks", [{"model": "SAMSUNG MZ7LH1T9HMLT", "serial": "SN123456", "firmware_rev": "HXT7904Q", "capacity_gb": 1920}])
            disk = disks[0]
            return (
                f"smartctl 7.3 2022-02-28 r5338 [x86_64-linux-5.14.0] (local build)\n"
                f"Device Model:     {disk.get('model', 'SAMSUNG')}\n"
                f"Serial Number:    {disk.get('serial', 'SN0000')}\n"
                f"Firmware Version: {disk.get('firmware_rev', '1.0')}\n"
                f"User Capacity:    {disk.get('capacity_gb', 1920) * 1000000000:,} bytes [{disk.get('capacity_gb', 1920)} GB]\n"
                f"Rotation Rate:    Solid State Device\n"
                f"SMART overall-health self-assessment test result: PASSED"
            )

        elif cmd == "ip addr show" or cmd == "ip a":
            return (
                f"1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n"
                f"    inet 127.0.0.1/8 scope host lo\n"
                f"2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n"
                f"    inet {c.get('ip_address', '10.20.100.10')}/24 brd 10.20.100.255 scope global eth0"
            )

        elif cmd == "multipath -ll":
            wwn = c.get("wwn", "50:06:01:60:00:00:00:01")
            return (
                f"mpatha ({wwn.replace(':','')}) dm-0 HPE,Alletra Storage MP\n"
                f"size=3.84T features='1 queue_if_no_path' hwhandler='1 alua' wp=rw\n"
                f"`-+- policy='service-time 0' prio=50 status=active\n"
                f"  |- 3:0:0:1 sda  8:0   active ready running\n"
                f"  `- 4:0:0:1 sdb  8:16  active ready running"
            )

        elif cmd == "dmidecode -s bios-version":
            return f"U32 v2.{random.randint(10,80)}"

        elif cmd == "dmidecode -s system-product-name":
            return random.choice(["ProLiant DL380 Gen10", "ProLiant DL360 Gen10 Plus", "ProLiant DL580 Gen10"])

        elif cmd == "cat /proc/cpuinfo | grep 'model name' | head -1":
            return f"model name : {c.get('cpu_model', 'Intel(R) Xeon(R) Gold 6230R CPU @ 2.10GHz')}"

        elif cmd == "hostname":
            return c.get("name", "linux-host")

        elif cmd.startswith("ls") or cmd == "pwd":
            return "/home/admin"

        elif cmd == "help" or cmd == "?":
            return (
                "Available commands:\n"
                "  uname -a              OS info\n"
                "  cat /etc/os-release   OS release details\n"
                "  lsblk                 Block devices\n"
                "  smartctl -a /dev/sdX  Disk S.M.A.R.T. data & firmware\n"
                "  ip addr show          Network interfaces\n"
                "  multipath -ll         Multipath status\n"
                "  dmidecode -s bios-version     BIOS firmware\n"
                "  dmidecode -s system-product-name  Server model\n"
                "  cat /proc/cpuinfo     CPU details\n"
                "  hostname              This host's name\n"
                "  systool -c fc_host -v | grep -E 'Class Device|port_state|port_name|speed'  HBA FC info\n"
                "  lspci -nnk | grep -A3 -i 'fibre|fc|emulex|qlogic|lpfc|qlgc'  PCI FC adapters"
            )

        elif cmd == "systool -c fc_host -v | grep -E 'Class Device|port_state|port_name|speed'":
            wwn = c.get("wwn", "10:00:00:00:c9:00:00:01").replace(":", "").lower()
            return (
                f'  Class Device = "host5"\n'
                f'  Class Device path = "/sys/devices/pci0000:09/0000:09:00.0/0000:0a:00.0/host5/fc_host/host5"\n'
                f'    port_name           = "0x{wwn}"\n'
                f'    port_state          = "Online"\n'
                f'    speed               = "16 Gbit"\n'
                f'    supported_speeds    = "4 Gbit, 8 Gbit, 16 Gbit"'
            )

        elif cmd == "lspci -nnk | grep -A3 -i 'fibre|fc|emulex|qlogic|lpfc|qlgc'":
            return (
                "0a:00.0 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)\n"
                "        Subsystem: Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]\n"
                "        Kernel driver in use: lpfc\n"
                "        Kernel modules: lpfc\n"
                "0a:00.1 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)\n"
                "        Subsystem: Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]\n"
                "        Kernel driver in use: lpfc\n"
                "        Kernel modules: lpfc"
            )

        else:
            return f"bash: {cmd}: command not found"


# ── Windows Host Terminal ──────────────────────────────────────────────────────

class WindowsHostTerminal(BaseTerminal):
    """
    Simulates a Windows Server PowerShell terminal.
    Responds to topology, hardware, and firmware commands.
    """

    PROMPT = "PS C:\\> "

    def _handle(self, command: str) -> str:
        time.sleep(0.05)
        cmd = command.strip()
        c = self.config

        if "Get-PhysicalDisk" in cmd:
            disks = c.get("disks", [
                {"pd_id": 0, "model": "Samsung MZWLR3T8HBLS", "firmware_rev": "GXA7A01Q", "capacity_gb": 3840},
                {"pd_id": 1, "model": "Seagate XS3840SE70084", "firmware_rev": "0002", "capacity_gb": 3840},
            ])
            lines = ["DeviceId  Model                         FirmwareVersion  Size"]
            lines.append("-" * 70)
            for d in disks:
                lines.append(f"{d.get('pd_id',0):<10}{d.get('model','Unknown'):<34}{d.get('firmware_rev','N/A'):<17}{d.get('capacity_gb',0)}GB")
            return "\n".join(lines)

        elif "wmic bios get" in cmd.lower() or "Get-WmiObject Win32_BIOS" in cmd:
            return (
                f"SMBIOSBIOSVersion\n"
                f"U32 v2.{random.randint(10,80)}\n\n"
                f"Manufacturer : HPE\n"
                f"Name         : Default System BIOS\n"
                f"Version      : HPQOEM - 1072009"
            )

        elif "Get-ComputerInfo" in cmd:
            return (
                f"WindowsProductName   : {c.get('os_name', 'Windows Server 2022')}\n"
                f"WindowsVersion       : {c.get('os_version', '10.0.20348')}\n"
                f"CsName               : {c.get('name', 'WIN-HOST-01')}\n"
                f"OsTotalVisibleMemorySize : {c.get('mem_gb', 128) * 1024 * 1024}\n"
                f"CsProcessors         : {c.get('cpu_model', 'Intel(R) Xeon(R) Gold 6230R CPU @ 2.10GHz')}"
            )

        elif "Get-NetAdapter" in cmd or "ipconfig" in cmd.lower():
            return (
                f"Name         InterfaceDescription   Status  MacAddress         LinkSpeed\n"
                f"----         --------------------   ------  ----------         ---------\n"
                f"Ethernet0    Broadcom NetXtreme GE  Up      {':'.join([f'{random.randint(0,255):02X}' for _ in range(6)])}  10 Gbps\n"
                f"\nIPv4 Address: {c.get('ip_address', '10.20.100.20')}\n"
                f"Subnet Mask:  255.255.255.0\n"
                f"Default GW:   {c.get('ip_address','10.20.100.1').rsplit('.',1)[0]}.1"
            )

        elif "Get-HBaPort" in cmd or "fcinfo" in cmd.lower():
            wwn = c.get("wwn", "10:00:00:00:C9:00:00:01")
            return (
                f"NodeWWN  : {wwn}\n"
                f"PortWWN  : {c.get('port_wwn', wwn)}\n"
                f"PortType : FabricPort\n"
                f"PortState: Online\n"
                f"PortSpeed: 16Gbps"
            )

        elif "Get-WmiObject Win32_DiskDrive" in cmd:
            disks = c.get("disks", [{"model": "Samsung MZWLR3T8HBLS", "serial": "SN0001", "capacity_gb": 3840}])
            lines = ["Caption                       DeviceID  Size"]
            lines.append("-" * 60)
            for i, d in enumerate(disks):
                lines.append(f"{d.get('model','Unknown'):<30}  \\\\.\\PHYSICALDRIVE{i}  {d.get('capacity_gb',0)*1073741824}")
            return "\n".join(lines)

        elif cmd.lower() in ("hostname", "[system.net.dns]::gethostname()"):
            return c.get("name", "WIN-HOST-01")

        elif cmd.lower() == "help" or cmd == "?":
            return (
                "Available commands:\n"
                "  Get-PhysicalDisk | Select DeviceId,Model,FirmwareVersion  Physical disks + firmware\n"
                "  wmic bios get smbiosbiosversion                           BIOS firmware version\n"
                "  Get-ComputerInfo                                          OS & hardware summary\n"
                "  Get-NetAdapter                                            Network adapters\n"
                "  Get-HBaPort                                               FC HBA ports\n"
                "  Get-WmiObject Win32_DiskDrive                             Disk drives\n"
                "  hostname                                                  Host name"
            )

        else:
            return f"'{cmd}' is not recognized as a cmdlet, function, script file, or operable program."


# ── Brocade FC Switch Terminal ─────────────────────────────────────────────────

class BrocadeSwitchTerminal(BaseTerminal):
    """
    Simulates a Brocade FC switch CLI terminal.
    Prompt: switch-name:FID100:admin>
    Supports: fabricshow, switchshow, help.
    """

    SSH_KEY_TYPE = None  # Switches use direct password auth (no host-key warning)

    def __init__(self, device_id: str, ip: str, config: dict):
        self.switch_name = config.get("name", "switch-lab-01")
        super().__init__(device_id, ip, config)

    @property
    def PROMPT(self):
        return f"{self.switch_name}:FID100:admin> "

    def _handle(self, command: str) -> str:
        time.sleep(0.05)
        cmd = command.strip()
        c = self.config
        switch_name = c.get("name", "switch-lab-01")
        wwn = c.get("wwn", "10:00:aa:bb:cc:dd:ee:01")

        if cmd == "fabricshow":
            lines = [
                "Switch ID   Worldwide Name          Enet IP Addr    FC IP Addr      Name",
                "-------------------------------------------------------------------------",
            ]
            # Generate fabric entries from connected peers + self
            sw_list = [
                (1,  "10:00:aa:aa:aa:aa:aa:01", "192.168.10.11",  "sw-core-01"),
                (2,  "10:00:aa:aa:aa:aa:aa:02", "192.168.10.12",  "sw-core-02"),
                (3,  "10:00:aa:aa:aa:aa:aa:03", "192.168.10.13",  "sw-core-03"),
                (4,  "10:00:aa:aa:aa:aa:aa:04", "192.168.10.14",  "sw-core-04"),
                (5,  "10:00:aa:aa:aa:aa:aa:05", "192.168.10.15",  "sw-core-05"),
                (6,  "10:00:aa:aa:aa:aa:aa:06", "192.168.10.16",  "sw-core-06"),
                (7,  "10:00:aa:aa:aa:aa:aa:07", "192.168.10.17",  "sw-core-07"),
                (8,  "10:00:aa:aa:aa:aa:aa:08", "192.168.10.18",  "sw-core-08"),
                (9,  "10:00:aa:aa:aa:aa:aa:09", "192.168.10.19",  "sw-core-09"),
                (10, "10:00:aa:aa:aa:aa:aa:0a", "192.168.10.20",  "sw-core-10"),
                (11, "10:00:aa:aa:aa:aa:aa:0b", "192.168.10.21",  "sw-core-11"),
                (12, "10:00:aa:aa:aa:aa:aa:0c", "192.168.10.22",  "sw-core-12"),
                (13, "10:00:aa:aa:aa:aa:aa:0d", "192.168.10.23",  "sw-core-13"),
                (14, "10:00:aa:aa:aa:aa:aa:0e", "192.168.10.24",  "sw-core-14"),
                (15, "10:00:aa:aa:aa:aa:aa:0f", "192.168.10.25",  "sw-core-15"),
                (16, "10:00:aa:aa:aa:aa:aa:10", "192.168.10.26",  "sw-core-16"),
                (17, "10:00:aa:aa:aa:aa:aa:11", "192.168.10.27",  "sw-core-17"),
                (18, "10:00:aa:aa:aa:aa:aa:12", "192.168.10.28",  "sw-core-18"),
                (19, "10:00:aa:aa:aa:aa:aa:13", "192.168.10.29",  "sw-core-19"),
                (30, "10:00:aa:aa:aa:aa:aa:1e", "192.168.10.30",  "sw-core-30"),
                (31, "10:00:aa:aa:aa:aa:aa:1f", "192.168.10.31",  "sw-core-31"),
                (32, "10:00:aa:aa:aa:aa:aa:20", "192.168.10.32",  "sw-core-32"),
                (61, "10:00:aa:aa:aa:aa:aa:3d", "192.168.10.61",  "sw-edge-61"),
                (66, "10:00:aa:aa:aa:aa:aa:42", "192.168.10.66",  "sw-edge-66"),
                (67, "10:00:aa:aa:aa:aa:aa:43", "192.168.10.67",  "sw-edge-67"),
                (73, "10:00:aa:aa:aa:aa:aa:49", "192.168.10.73",  "sw-edge-73"),
                (74, "10:00:aa:aa:aa:aa:aa:4a", "192.168.10.74",  "sw-edge-74"),
                (75, "10:00:aa:aa:aa:aa:aa:4b", "192.168.10.75",  "sw-edge-75"),
                (76, "10:00:aa:aa:aa:aa:aa:4c", "192.168.10.76",  "sw-edge-76"),
                (77, "10:00:aa:aa:aa:aa:aa:4d", "192.168.10.77",  "sw-edge-77"),
                (78, "10:00:aa:aa:aa:aa:aa:4e", "192.168.10.78",  "sw-edge-78"),
                (79, "10:00:aa:aa:aa:aa:aa:4f", "192.168.10.79",  "sw-edge-79"),
                (97, "10:00:aa:aa:aa:aa:aa:61", "192.168.10.97",  "sw-edge-97"),
                (99, "10:00:aa:aa:aa:aa:aa:63", "192.168.10.99",  "sw-edge-99"),
                (100,"10:00:aa:aa:aa:aa:aa:64", "192.168.10.100", "sw-edge-100"),
                (101,"10:00:aa:aa:aa:aa:aa:65", "192.168.10.101", "sw-edge-101"),
                (116,"10:00:aa:aa:aa:aa:aa:74", "192.168.10.116", "sw-edge-116"),
                (117,"10:00:aa:aa:aa:aa:aa:75", "192.168.10.117", "sw-edge-117"),
                (173,"10:00:aa:aa:aa:aa:aa:ad", "192.168.10.173", "sw-edge-173"),
                (201,"10:00:aa:aa:aa:aa:aa:c9", "192.168.10.201", "sw-edge-201"),
            ]
            for sid, swwn, ip_addr, name in sw_list:
                domain_hex = f"dmyc{sid:02x}"
                lines.append(f"{sid:3}: {domain_hex} {swwn} {ip_addr:<15} 0.0.0.0         \"{name}\"")
            lines.append("")
            lines.append(f"The Fabric has {len(sw_list)} switches")
            lines.append("Fabric Name: FABRIC_DUMMY_01")
            return "\n".join(lines)

        elif cmd == "switchshow":
            lines = [
                f"switchName:     {switch_name}",
                "switchType:     109.1",
                "switchState:    Online",
                "switchMode:     Native",
                "switchRole:     Subordinate",
                "switchDomain:   99",
                "switchId:       dmyc63",
                f"switchWwn:      {wwn}",
                "zoning:         ON (FABRIC_DUMMY_1)",
                "switchBeacon:   OFF",
                "FC Router:      OFF",
                "Fabric Name:    FABRIC_DUMMY_01",
                "HIF Mode:       OFF",
                "Allow XISL Use: OFF",
                "LS Attributes:  [FID: 128, Base Switch: No, Default Switch: Yes, Address Mode 0]",
                "",
                "Index Port Address  Media Speed   State       Proto",
                "==================================================",
                '   0   0   630000   id    N16     Online      FC  E-Port  10:00:aa:bb:cc:00:00:08 "sw-bridge-08" (Trunk master)',
                '   1   1   630100   id    N16     Online      FC  E-Port  (Trunk port, master is Port  0 )',
                '   2   2   630200   id    N16     Online      FC  E-Port  10:00:aa:bb:cc:00:00:01 "sw-core-01" (upstream)(Trunk master)',
                '   3   3   630300   id    N16     Online      FC  E-Port  (Trunk port, master is Port  2 )',
            ]
            # No_Light ports 4–15
            for p in range(4, 16):
                lines.append(f"  {p:2}  {p:2}   630{p:x}00   id    N16     No_Light    FC")
            # F-Ports 16–21
            fport_wwns = ["10:00:11:22:33:44:55:10", "10:00:11:22:33:44:55:11",
                          "10:00:11:22:33:44:55:12", "10:00:11:22:33:44:55:13",
                          "10:00:11:22:33:44:55:14", "10:00:11:22:33:44:55:15"]
            for i, p in enumerate(range(16, 22)):
                lines.append(f"  {p:2}  {p:2}   63{p:x}00   id    N16     Online      FC  F-Port  {fport_wwns[i]}")
            # No_Light 22–23
            for p in range(22, 24):
                lines.append(f"  {p:2}  {p:2}   63{p:x}00   id    N16     No_Light    FC")
            # F-Ports 24–27
            extra_fports = ["10:00:11:22:33:44:55:18", "10:00:11:22:33:44:55:19",
                            "10:00:11:22:33:44:55:1a", "10:00:11:22:33:44:55:1b"]
            for i, p in enumerate(range(24, 28)):
                lines.append(f"  {p:2}  {p:2}   63{p:x}00   id    N16     Online      FC  F-Port  {extra_fports[i]}")
            # No_Light 28–47
            for p in range(28, 48):
                lines.append(f"  {p:2}  {p:2}   63{p:x}00   id    N16     No_Light    FC")
            return "\n".join(lines)

        elif cmd in ("help", "?"):
            return (
                "Available commands:\n"
                "  fabricshow    Show fabric topology (all switches, WWNs, IPs)\n"
                "  switchshow    Show this switch's state and port table\n"
                "  help / ?      This help text"
            )

        else:
            return f"{switch_name}:FID100:admin> {cmd}: command not found"
