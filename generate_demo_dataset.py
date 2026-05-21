"""
Generate comprehensive test dataset for HPE SAN Demo.

This script creates a realistic, non-hardcoded SAN topology with:
- Multiple storage arrays (Production, Backup, DR)
- Varied array models and configurations
- Switches with proper connectivity
- Diverse host ecosystem (Windows, Linux, ESXi)
- Physical infrastructure (Cages, Disks, Nodes)
- Cross-site replication relationships
"""

import json
import random
import uuid
from datetime import datetime, timedelta
from typing import List, Dict, Any

class SANDatasetGenerator:
    def __init__(self, seed=None):
        if seed:
            random.seed(seed)
        self.nodes = []
        self.edges = []
        self.array_count = 0

    def add_node(self, node_id: str, label: str, properties: Dict[str, Any]):
        """Add a node to the graph."""
        node = {
            "data": {
                "id": node_id,
                "label": label,
                **properties
            }
        }
        self.nodes.append(node)
        return node_id

    def add_edge(self, source: str, target: str, relationship: str):
        """Add an edge (relationship) to the graph."""
        edge = {
            "data": {
                "source": source,
                "target": target,
                "label": relationship
            }
        }
        self.edges.append(edge)

    def generate_array(self, name: str, ip_base: str, site: str, model: str, 
                       node_count: int = 2, cage_count: int = 2, disks_per_cage: int = 12) -> str:
        """
        Generate a complete storage array with controllers, cages, and disks.
        """
        array_id = f"ARRAY-{self.array_count:03d}"
        self.array_count += 1
        
        # Array System Node
        capacity_mib = 1024 * 1024 * 1024  # 1TB in MiB
        alloc_cap = int(capacity_mib * random.uniform(0.3, 0.8))
        
        array_props = {
            "name": name,
            "ip_address": f"{ip_base}.5",
            "model": model,
            "serial": f"SN-{name}-{random.randint(100000, 999999)}",
            "release_version": "12.4.1",
            "node_count": node_count,
            "master_node": 0,
            "total_cap_mib": capacity_mib,
            "alloc_cap_mib": alloc_cap,
            "free_cap_mib": capacity_mib - alloc_cap,
            "failed_cap_mib": 0,
            "protocols_supported": "FC,iSCSI",
            "site": site,
            "is_decommissioned": False
        }
        
        self.add_node(array_id, "ArraySystem", array_props)

        # Generate Controller Nodes
        for node_idx in range(node_count):
            node_id = f"{array_id}-NODE-{node_idx}"
            node_props = {
                "name": f"{name}-Controller-{node_idx}",
                "node_id": node_idx,
                "encl_bay": f"{node_idx}:0",
                "is_master": node_idx == 0,
                "in_cluster": True,
                "mem_mib": 65536,
                "up_since": (datetime.now() - timedelta(days=random.randint(100, 800))).isoformat(),
                "is_decommissioned": False
            }
            self.add_node(node_id, "Node", node_props)
            self.add_edge(array_id, node_id, "HAS_NODE")

            # Generate Ports for each controller
            for port_idx in range(4):
                port_id = f"{node_id}-PORT-{port_idx}"
                port_props = {
                    "nsp": f"{node_idx}:{port_idx // 2}:{port_idx % 2}",
                    "node": node_idx,
                    "slot": port_idx // 2,
                    "port_num": port_idx % 2,
                    "mode": random.choice(["initiator", "target", "peer"]),
                    "state": random.choice(["ready", "loss_sync"]) if random.random() > 0.9 else "ready",
                    "port_wwn_hw": f"50:00:00:00:00:00:00:{node_idx:02x}",
                    "type": "FC",
                    "protocol": "FC",
                    "label": f"Port-{port_idx}"
                }
                self.add_node(port_id, "Port", port_props)
                self.add_edge(node_id, port_id, "HAS_PORT")

        # Generate Cages (disk enclosures)
        for cage_idx in range(cage_count):
            cage_id = f"{array_id}-CAGE-{cage_idx}"
            cage_props = {
                "cage_id": cage_idx,
                "name": f"DiskEnclosure-{cage_idx}",
                "state": "ready",
                "detailed_state": "operational",
                "model": "HPE StorageEnclosure",
                "form_factor": "3.5in" if cage_idx == 0 else "2.5in",
                "drive_count": disks_per_cage,
                "temperature": random.randint(20, 40),
                "is_decommissioned": False
            }
            self.add_node(cage_id, "Cage", cage_props)
            self.add_edge(array_id, cage_id, "HAS_CAGE")

            # Generate Physical Disks
            for disk_idx in range(disks_per_cage):
                disk_id = f"{cage_id}-DISK-{disk_idx:02d}"
                # Simulate some disks with failures
                is_failed = random.random() < 0.05  # 5% failure rate
                
                disk_props = {
                    "pd_id": disk_idx,
                    "serial": f"DISK-{name}-{cage_idx}-{disk_idx:02d}-{uuid.uuid4().hex[:8]}",
                    "cage_pos": disk_idx,
                    "state": "failed" if is_failed else random.choice(["normal", "predictive_fail"]) if random.random() > 0.95 else "normal",
                    "detailed_state": "operational" if not is_failed else "failed_device",
                    "sed_state": random.choice(["formatted", "not_formatted"]),
                    "drive_type": random.choice(["ssd", "ssd", "ssd", "hdd"]),  # Mostly SSDs
                    "manufacturer": random.choice(["Samsung", "Intel", "Kioxia", "Seagate"]),
                    "model": "SSD-NVMe-1.6TB" if cage_idx == 0 else "HDD-SATA-4TB",
                    "firmware_rev": f"v{random.randint(1, 5)}.{random.randint(0, 9)}",
                    "capacity_gb": 1600 if cage_idx == 0 else 4000,
                    "protocol": "SAS",
                    "admission_time": (datetime.now() - timedelta(days=random.randint(50, 500))).isoformat(),
                    "is_decommissioned": False
                }
                self.add_node(disk_id, "PhysicalDisk", disk_props)
                self.add_edge(cage_id, disk_id, "CONTAINS")

        return array_id

    def generate_switch(self, name: str, ip: str, switch_idx: int) -> str:
        """Generate a Fiber Channel switch."""
        switch_id = f"SWITCH-{switch_idx:03d}"
        
        switch_props = {
            "name": name,
            "ip_address": ip,
            "model": random.choice(["Cisco MDS 9148S", "Brocade 6510", "Brocade G630", "Cisco MDS 9396T"]),
            "serial": f"SN-SW-{random.randint(100000, 999999)}",
            "state": "online",
            "mode": "fabric",
            "locate_led": "off",
            "ps1": "ok",
            "ps2": "ok",
            "fans": "ok",
            "temperature": random.randint(20, 35),
            "is_decommissioned": False
        }
        
        self.add_node(switch_id, "Switch", switch_props)
        
        # Generate Ports for switch
        for port_idx in range(random.randint(16, 48)):
            port_id = f"{switch_id}-PORT-{port_idx}"
            port_props = {
                "nsp": f"{port_idx}",
                "port_num": port_idx,
                "mode": "F" if random.random() > 0.3 else "E",
                "state": "Online" if random.random() > 0.05 else "Offline",
                "label": f"Port-{port_idx}",
                "speed": "32Gb"
            }
            self.add_node(port_id, "Port", port_props)
            self.add_edge(switch_id, port_id, "HAS_PORT")
        
        return switch_id

    def generate_host(self, name: str, ip: str, host_idx: int, os_type: str) -> str:
        """Generate a host/server."""
        host_id = f"HOST-{host_idx:03d}"
        
        os_mapping = {
            "windows": ("Windows Server 2022", "windows", "10:00:14:40:4a:24:19"),
            "linux": (random.choice(["Red Hat Enterprise Linux 9", "Ubuntu 22.04", "Oracle Linux 9"]), "linux", "50:00:14:40:4a:24:19"),
            "esxi": ("VMware ESXi 8.0", "hypervisor", "60:00:14:40:4a:24:19"),
        }
        
        os_name, os_class, wwn_prefix = os_mapping.get(os_type, ("Unknown", "unknown", "00:00:00:00:00:00:00"))
        
        host_props = {
            "name": name,
            "ip_address": ip,
            "host_id": host_idx,
            "persona": random.choice(["database", "appserver", "webserver", "fileserver"]),
            "wwn": f"{wwn_prefix}:{host_idx:02x}",
            "port": random.randint(8000, 9000),
            "os_name": os_name,
            "os_type": os_class,
            "multipath": True,
            "is_decommissioned": False
        }
        
        self.add_node(host_id, "Host", host_props)
        return host_id

    def connect_hosts_to_arrays_and_switches(self, hosts: List[str], arrays: List[str], switches: List[str]):
        """Create connections between hosts, arrays, and switches."""
        for host_id in hosts:
            # Connect to 1-2 arrays
            connected_arrays = random.sample(arrays, min(2, len(arrays)))
            for array_id in connected_arrays:
                self.add_edge(host_id, array_id, "CONNECTS_TO")

            # Connect to 1-2 switches
            connected_switches = random.sample(switches, min(2, len(switches)))
            for switch_id in connected_switches:
                self.add_edge(switch_id, host_id, "CONNECTS_TO")

    def connect_arrays_to_switches(self, arrays: List[str], switches: List[str]):
        """Create connections between arrays and switches."""
        for array_id in arrays:
            # Each array connects to 1-3 switches
            num_switches = min(random.randint(1, 3), len(switches))
            connected_switches = random.sample(switches, num_switches)
            for switch_id in connected_switches:
                self.add_edge(array_id, switch_id, "HAS_SWITCH")

    def create_replication_relationship(self, source_array_id: str, target_array_id: str):
        """Create a replication relationship between arrays."""
        self.add_edge(source_array_id, target_array_id, "REPLICATES_TO")

    def generate_production_environment(self):
        """Generate a typical production environment."""
        # Create primary production arrays
        prod_a = self.generate_array(
            "PROD-A", "10.10.1", "Primary", "HPE Alletra Storage MP",
            node_count=2, cage_count=3, disks_per_cage=24
        )
        
        prod_b = self.generate_array(
            "PROD-B", "10.10.2", "Primary", "HPE Alletra 9000",
            node_count=3, cage_count=4, disks_per_cage=28
        )
        
        # Create backup/DR arrays
        backup_c = self.generate_array(
            "BACKUP-C", "10.20.1", "Secondary", "HPE Primera 600",
            node_count=2, cage_count=2, disks_per_cage=16
        )
        
        dr_d = self.generate_array(
            "DR-D", "10.30.1", "Disaster-Recovery", "HPE Nimble HF60",
            node_count=2, cage_count=2, disks_per_cage=12
        )
        
        arrays = [prod_a, prod_b, backup_c, dr_d]
        
        # Create replication relationships
        self.create_replication_relationship(prod_a, backup_c)
        self.create_replication_relationship(prod_b, dr_d)
        self.create_replication_relationship(backup_c, dr_d)
        
        # Create switches
        switches = []
        for i in range(5):
            switch = self.generate_switch(f"SWITCH-FABRIC-{i+1}", f"10.40.{i+1}.1", i)
            switches.append(switch)
        
        # Create diverse host ecosystem
        hosts = []
        
        # Database servers (Linux)
        for i in range(4):
            host = self.generate_host(
                f"db-prod-{i+1:02d}", f"10.50.1.{100+i}", len(hosts), "linux"
            )
            hosts.append(host)
        
        # Application servers (Windows)
        for i in range(3):
            host = self.generate_host(
                f"app-prod-{i+1:02d}", f"10.50.2.{100+i}", len(hosts), "windows"
            )
            hosts.append(host)
        
        # Virtualization hosts (ESXi)
        for i in range(5):
            host = self.generate_host(
                f"vcenter-host-{i+1:02d}", f"10.50.3.{100+i}", len(hosts), "esxi"
            )
            hosts.append(host)
        
        # File servers (Mixed OS)
        for i in range(2):
            host = self.generate_host(
                f"file-server-{i+1:02d}", f"10.50.4.{100+i}", len(hosts), "windows"
            )
            hosts.append(host)
        
        # Web servers (Linux)
        for i in range(3):
            host = self.generate_host(
                f"web-server-{i+1:02d}", f"10.50.5.{100+i}", len(hosts), "linux"
            )
            hosts.append(host)
        
        # Connect everything
        self.connect_arrays_to_switches(arrays, switches)
        self.connect_hosts_to_arrays_and_switches(hosts, arrays, switches)
        
        return {
            "arrays": arrays,
            "switches": switches,
            "hosts": hosts
        }

    def generate_edge_datacenter_environment(self):
        """Generate a smaller edge datacenter environment."""
        # Single array edge deployment
        edge_e = self.generate_array(
            "EDGE-E", "10.60.1", "Edge", "HPE Nimble HF20",
            node_count=1, cage_count=1, disks_per_cage=8
        )
        
        arrays = [edge_e]
        
        # 2-3 switches
        switches = []
        for i in range(2):
            switch = self.generate_switch(f"EDGE-SW-{i+1}", f"10.60.{i+2}.1", 10 + i)
            switches.append(switch)
        
        # Edge hosts (mostly Linux, some Windows)
        hosts = []
        for i in range(4):
            os_type = "linux" if i % 3 != 0 else "windows"
            host = self.generate_host(
                f"edge-host-{i+1:02d}", f"10.60.100.{100+i}", 20 + i, os_type
            )
            hosts.append(host)
        
        self.connect_arrays_to_switches(arrays, switches)
        self.connect_hosts_to_arrays_and_switches(hosts, arrays, switches)
        
        return {
            "arrays": arrays,
            "switches": switches,
            "hosts": hosts
        }

    def generate_complete_dataset(self):
        """Generate complete multi-environment dataset."""
        self.generate_production_environment()
        self.generate_edge_datacenter_environment()
        
        return {
            "topology": {
                "nodes": self.nodes,
                "edges": self.edges
            },
            "metadata": {
                "generated": datetime.now().isoformat(),
                "version": "1.0",
                "node_count": len(self.nodes),
                "edge_count": len(self.edges),
                "array_count": self.array_count
            }
        }


def main():
    """Generate and save the dataset."""
    print("Generating comprehensive SAN demo dataset...")
    
    generator = SANDatasetGenerator(seed=42)
    dataset = generator.generate_complete_dataset()
    
    # Save to file
    output_file = "data/demo_dataset.json"
    with open(output_file, "w") as f:
        json.dump(dataset, f, indent=2)
    
    print(f"\nDataset generated successfully!")
    print(f"Output file: {output_file}")
    print(f"\nDataset Summary:")
    print(f"  - Total Nodes: {dataset['metadata']['node_count']}")
    print(f"  - Total Edges: {dataset['metadata']['edge_count']}")
    print(f"  - Storage Arrays: {dataset['metadata']['array_count']}")
    print(f"\nDataset includes:")
    print(f"  - 4 Storage Arrays (Production, Backup, DR, Edge)")
    print(f"  - 7 Fiber Channel Switches")
    print(f"  - 21+ Hosts (Database, Application, ESXi, File, Web servers)")
    print(f"  - Complete physical infrastructure (Cages, Disks, Ports, Nodes)")
    print(f"  - Cross-site replication relationships")
    print(f"\nNext steps:")
    print(f"  1. API call: POST /api/faker/import with this dataset")
    print(f"  2. Verify in Neo4j browser: http://localhost:7474")
    print(f"  3. View in Dashboard Discovery/Topology tabs")
    print(f"  4. Run AI Agent queries for demo scenarios")


if __name__ == "__main__":
    main()
