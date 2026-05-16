"""Synthetic HPE-style CLI dumps for the simulator data/devices directory."""
import os
import random


class DataFaker:
    def __init__(self, output_dir=None):
        self.output_dir = output_dir or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "simulator",
            "data",
            "devices",
        )
        os.makedirs(self.output_dir, exist_ok=True)

    def generate_array(self, seed_name, switches_count=2, hosts_count=10, drives_count=24):
        serial = f"FAKE{random.randint(100000, 999999)}"
        nodes_count = 2 # Standard for fake

        lines = []
        lines.append("showsys")
        lines.append("                                                                     ------------------(MiB)------------------")
        lines.append("     ID -Name- ------------Model------------ --Serial-- Nodes Master TotalCap    AllocCap    FreeCap FailedCap")
        lines.append(
            f" 0x1234 {seed_name} HPE Alletra Storage MP      {serial}     {nodes_count}      0 50000000    10000000    40000000         0"
        )

        lines.append("--\n+ shownode")
        lines.append("Node ----Name---- Encl:Bay Master InCluster Mem(MiB) -------Up_Since--------")
        for i in range(nodes_count):
            master = "Yes" if i == 0 else "No"
            lines.append(
                f"   {i} {serial}-{i}      1:{i+1} {master}    Yes         515539 2026-03-10 01:25:24 PDT"
            )

        lines.append("--\n+ showport")
        lines.append("N:S:P Mode  State ----Node_WWN---- -Port_WWN/MAC-- Type Protocol Label")
        for n in range(nodes_count):
            for s in range(1, 4):
                for p in range(1, 5):
                    lines.append(f"{n}:{s}:{p} target ready 2FF7{serial} 2FF7{serial}0{n}{s}{p} host FC -")

        lines.append("--\n+ showhost")
        lines.append(" Id Name          Persona       -WWN/iSCSI_Name- Port")
        for h in range(hosts_count):
            lines.append(f"  {h} host_{h}      Generic-ALUA  100000000000000{h} 0:1:1")

        lines.append("--\n+ showswitch")
        lines.append("Switch -----------WWN----------- State Mode -Serial- -Temp-")
        for s in range(switches_count):
            lines.append(f"sw{s}    100000000000000{s}        Online Normal SW{serial}{s} 35")

        lines.append("--\n+ showcage -pci")
        lines.append(" Id Name  -State- -Detailed_State- Drives -Temp- ---Model--- FormFactor")
        cage_count = max(1, drives_count // 24)
        for c in range(cage_count):
            lines.append(f"  {c} cage{c} Normal  Normal           {min(24, drives_count)}     30   CAGE-MODEL-A SFF")

        lines.append("--\n+ showpd -showcols Id,CagePos,Type,State,Total_MiB,Free_MiB,Cap_GB -noheading")
        for d in range(drives_count):
            cage_id = d % cage_count
            slot = d // cage_count
            lines.append(f"{d},{cage_id}:{slot},SSD,normal,1000000,500000,1000")

        lines.append("--\n+ showpd -s -showcols Id,Manufacturer,Model,Serial,FW_Rev,Protocol -noheading")
        for d in range(drives_count):
            lines.append(f"{d},FAKE-MFG,FAKE-MODEL,FAKE-DRIVE-{d},1.0,NVMe")

        lines.append("--\n+ showpd -i -showcols Id,SedState -noheading")
        for d in range(drives_count):
            lines.append(f"{d},fips_capable")

        lines.append("--\n+ showversion -b")
        lines.append("Release version 10.9.0.0")

        safe_name = seed_name.lower().replace("-", "_")
        file_path = os.path.join(self.output_dir, f"{safe_name}.txt")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        return file_path
