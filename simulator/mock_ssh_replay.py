#!/usr/bin/env python3
"""
mock_ssh_replay.py

A mock replay command runner.
When copied to a target RHEL server or computer and added as alias or in PATH,
it intercepts commands (e.g. showsys, shownode, multipath -ll) and prints the
exact captured outputs from the HPE logs, mimicking a live HPE storage array or SAN host.

Supports dynamic parsing of m1-array_proxy.txt and other dump files.
"""
import sys
import os
import re

# Direct mappings of CLI commands to output fragments based on HPE m1, m2, and m4 logs.
MOCK_DATABASE = {
    "showversion": """
Release version 10.6.0.40
Release Type: Standard Support Release

Component Name                   Version
CLI Server                       10.6.0.40
CLI Client                       10.6.0.40
System Manager                   10.6.0.40
Kernel                           10.6.0.38
IO Stack                         10.6.0.40
Drive Firmware                   10.6.0.40
Enclosure Firmware               10.6.0.40
Switch Firmware                  10.15.1010
Upgrade Tool                     643 (250602-10.6.0)
""",
    "showsys": """
                                                                     ------------------(MiB)------------------
     ID -Name- ------------Model------------ --Serial-- Nodes Master TotalCap    AllocCap    FreeCap FailedCap
      1 s4378  HPE Alletra Storage MP B10000 4UW0004634     4 Yes    562475827 526333030   36142797         0
""",
    "shownode": """
Node ----Name---- Encl:Bay Master InCluster Mem(MiB) -------Up_Since--------
   0 4UW0004634-0      1:1 Yes    Yes         515539 2026-03-10 01:25:24 PDT
   1 4UW0004634-1      1:2 No     Yes         515539 2026-03-10 01:25:27 PDT
   2 4UW0004634-2      2:1 No     Yes         515539 2026-03-10 01:25:29 PDT
   3 4UW0004634-3      2:2 No     Yes         515539 2026-03-10 01:25:00 PDT
""",
    "showswitch": """
Name State  Mode   LocateLED Serial     PS1 PS2 Fans Temp
sw1  Normal Online off       TW32KM3056 ok  ok  ok   normal
sw2  Normal Online off       TW32KM303T ok  ok  ok   normal
-----------------------------------------------------------
2    total
""",
    "showport": """
N:S:P      Mode     State --Node_WWN/IP--- -Port_WWN/HW_Addr- Type Protocol Label
0:1:1 initiator     ready       16.1.14.90       946DAED6F21A disk     NVMe  DP-1
0:1:2 initiator     ready       16.1.15.90       946DAED6F21B disk     NVMe  DP-2
0:2:1 initiator     ready         16.1.8.1       946DAED6F32E disk     NVMe  DP-1
0:2:2 initiator     ready         16.1.9.1       946DAED6F32F disk     NVMe  DP-2
0:3:1    target     ready 2FF70002AC07F065   20310002AC07F065 host       FC     -
0:3:2    target loss_sync 2FF70002AC07F065   20320002AC07F065 free       FC     -
0:3:3    target loss_sync 2FF70002AC07F065   20330002AC07F065 free       FC     -
0:3:4    target loss_sync 2FF70002AC07F065   20340002AC07F065 free       FC     -
""",
    "showhost": """
Id Name            Persona      -WWN/iSCSI_Name/NQN- Port
  4 host-alpha-001 Generic-ALUA 1000D000000000A1     0:3:1
                                1000D000000000A2     3:3:1
  0 host-beta-002  Generic-ALUA 51402EC0000000B1     0:3:1
                                51402EC0000000B2     0:3:1
""",
    "showcage": """
 Cage IOM Slot -Type-- Manufacturer --Model--- ----Serial----- -Rev- Firmware
    1   1    1 Eth     Mellanox     CX6-DP-DX  MT2324T00530    n/a   22.36.1010
    1   1    2 Eth     Mellanox     CX6-DP-DX  MT2324T0053J    n/a   22.36.1010
""",
    "showpd": """
                             ------Size(MiB)------
  Id CagePos Type RPM State       Total       Free Capacity(GB)
   0 41:1    QLC  N/A normal   29295616   27600896        30720
   1 41:2    QLC  N/A normal   29295616   27601920        30720
""",
    "lscpu": """
Architecture:            x86_64
  CPU op-mode(s):        32-bit, 64-bit
  Address sizes:         46 bits physical, 48 bits virtual
  Byte Order:            Little Endian
CPU(s):                  64
  On-line CPU(s) list:   0-63
Vendor ID:               GenuineIntel
  BIOS Vendor ID:        Intel(R) Corporation
  Model name:            Intel(R) Xeon(R) Gold 6230R CPU @ 2.10GHz
""",
    "uname -a": "Linux rhel-test-box 5.14.0-284.30.1.el9_2.x86_64 #1 SMP PREEMPT_DYNAMIC Fri Nov 3 2026 x86_64 GNU/Linux",
    "cat /etc/os-release": """
NAME="Red Hat Enterprise Linux"
VERSION="9.2 (Plow)"
ID="rhel"
ID_LIKE="fedora"
VERSION_ID="9.2"
PLATFORM_ID="platform:el9"
PRETTY_NAME="Red Hat Enterprise Linux 9.2 (Plow)"
""",
    "lsblk": """
NAME    MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda       8:0    0  3.8T  0 disk 
├─sda1    8:1    0  500M  0 part /boot
└─sda2    8:2    0  3.8T  0 part /
sdb       8:16   0  3.8T  0 disk 
""",
    "smartctl -a": """
smartctl 7.3 2022-02-28 r5338 [x86_64-linux-5.14.0]
Device Model:     SAMSUNG MZ7LH1T9HMLT
Serial Number:    S438SAMSUNG1234
Firmware Version: HXT7904Q
User Capacity:    1,920,383,488,000 bytes [1.92 TB]
SMART overall-health self-assessment test result: PASSED
""",
    "multipath -ll": """
mpatha (351402ec0000000b1) dm-0 HPE,Alletra Storage MP
size=3.84T features='1 queue_if_no_path' hwhandler='1 alua' wp=rw
`-+- policy='service-time 0' prio=50 status=active
  |- 3:0:0:1 sda  8:0   active ready running
  `- 4:0:0:1 sdb  8:16  active ready running
""",
    "dmidecode -s bios-version": "U32 v2.82",
    "dmidecode -s system-product-name": "ProLiant DL380 Gen10 Plus",
    "fabricshow": """
Switch ID   Worldwide Name          Enet IP Addr    FC IP Addr      Name
-------------------------------------------------------------------------
  1: dmyc01 10:00:aa:aa:aa:aa:aa:01 192.168.10.11   0.0.0.0         "sw-core-01"
  2: dmyc02 10:00:aa:aa:aa:aa:aa:02 192.168.10.12   0.0.0.0         "sw-core-02"
""",
    "switchshow": """
switchName:     sw-fabric-99
switchType:     109.1
switchState:    Online
switchMode:     Native
switchRole:     Subordinate
switchDomain:   99
switchId:       dmyc63
switchWwn:      10:00:aa:bb:cc:dd:ee:99
zoning:         ON (FABRIC_DUMMY_1)
""",
    "systool -c fc_host": """
  Class Device = "host5"
    port_name           = "0x1000aaaabbbb0001"
    port_state          = "Online"
    speed               = "16 Gbit"
    supported_speeds    = "4 Gbit, 8 Gbit, 16 Gbit"
""",
    "lspci -nnk": """
0a:00.0 Fibre Channel [0c04]: Emulex Corporation LPe31000/LPe32000 Series 16Gb/32Gb Fibre Channel Adapter [10df:e300] (rev 01)
        Subsystem: Hewlett Packard Enterprise StoreFabric SN1200E 2-Port 16Gb Fibre Channel Adapter [1590:0214]
        Kernel driver in use: lpfc
        Kernel modules: lpfc
""",
    "showportdev ns -nohdtot 0:3:1": """
0xc0200 0x00  0x00 2FF70000DUMMY001 20310000DUMMY001 0x8800 0x0012 n/a    0x0800 20310000DUMMY001 HPE Alletra Storage MP - DUMMY000999 - fw:105600                                                              0:3:1
0xc1100 0x0a  0x00 2000AAAABBBB1001 1000AAAABBBB1001 0x0000 0x0000 0x0000 0x0000 20310000DUMMY001 Emulex SN1600E1P FV14.0.499.29 DV14.0.499.31 HN:host-lnx-222.example.local OS:Linux                             host-lnx-222
""",
    "showportdev ns -nohdtot 1:3:1": """
0xc0400 0x00  0x00 2FF70000DUMMY001 21310000DUMMY001 0x8800 0x0012 n/a    0x0800 21310000DUMMY001 HPE Alletra Storage MP - DUMMY000999 - fw:105600                                                              1:3:1
0xc1200 0x09  0x00 2000AAAABBBB0001 1000AAAABBBB0001 0x0000 0x0000 0x0000 0x0000 21310000DUMMY001 Emulex SN1600E1P FV14.0.499.29 DV14.0.499.31 HN:host-lnx-222.example.local OS:Linux                             host-lnx-222
"""
}

def load_dump_file(filepath):
    if not os.path.exists(filepath):
        return {}
    with open(filepath, "r", errors="replace") as f:
        lines = [l.rstrip() for l in f]
    
    has_plus = any(l.startswith("+ ") for l in lines)
    
    blocks = {}
    cur = None
    
    if has_plus:
        for line in lines:
            if line.startswith("+ "):
                cur = line[2:].strip()
                blocks[cur] = []
            elif cur is not None:
                blocks[cur].append(line)
    else:
        known_cmds = {
            "showversion -b", "showhost", "showsys", "shownode", "showport",
            "showswitch", "showpd", "showpd -s", "showpd -i",
            "showcage", "showcage -state", "showcage -pci", "showcage -sfp",
            "cli checkhealth", "lscpu", "fabricshow", "switchshow",
            "showportdev ns -nohdtot 0:3:1", "showportdev ns -nohdtot 1:3:1",
            "lspci -nnk", "systool -c fc_host"
        }
        for line in lines:
            stripped = line.strip()
            matched_cmd = None
            for cmd in sorted(known_cmds, key=len, reverse=True):
                if stripped == cmd or stripped.startswith(cmd + " "):
                    matched_cmd = stripped
                    break
            if matched_cmd:
                cur = matched_cmd
                blocks[cur] = []
            elif cur is not None:
                blocks[cur].append(line)
                
    return {k: "\n".join(v) for k, v in blocks.items()}

def run_cmd(cmd_str):
    cleaned = cmd_str.strip()
    
    # 1. Try loading dynamic logs from potential workspace locations
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("REPLAY_DUMP_FILE", ""),
        "m1-array_proxy.txt",
        os.path.join(script_dir, "m1-array_proxy.txt"),
        os.path.join(script_dir, "..", "m1-array_proxy.txt"),
        os.path.join(script_dir, "..", "..", "m1-array_proxy.txt"),
        os.path.join(script_dir, "data", "devices", "prod_a.txt")
    ]
    
    dynamic_db = {}
    for c in candidates:
        if c and os.path.exists(c):
            try:
                dynamic_db = load_dump_file(c)
                if dynamic_db:
                    break
            except Exception:
                pass
                
    # If dynamic db is loaded, search it
    if dynamic_db:
        # Exact match
        if cleaned in dynamic_db:
            print(dynamic_db[cleaned].strip())
            sys.exit(0)
        # Fuzzy match
        for k, v in dynamic_db.items():
            if k in cleaned:
                print(v.strip())
                sys.exit(0)
                
    # 2. Fall back to hardcoded MOCK_DATABASE
    if cleaned in MOCK_DATABASE:
        print(MOCK_DATABASE[cleaned].strip())
        sys.exit(0)
        
    for k, v in MOCK_DATABASE.items():
        if k in cleaned:
            print(v.strip())
            sys.exit(0)
            
    print(f"bash: {cleaned}: command not found (mock SSH replay server)")
    sys.exit(127)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_cmd(" ".join(sys.argv[1:]))
    else:
        print("HPE SAN Mock Replay Interactive Console. Type 'exit' to quit.")
        while True:
            try:
                line = input("cli% " if sys.platform == "win32" else "$ ")
                if line.strip().lower() in ("exit", "quit"):
                    break
                if not line.strip():
                    continue
                run_cmd(line)
            except (KeyboardInterrupt, EOFError):
                break
