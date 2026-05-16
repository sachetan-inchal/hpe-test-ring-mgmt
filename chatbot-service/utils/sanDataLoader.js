import fs from 'fs/promises';
import path from 'path';
import SANData from '../models/SANData.js';
import neo4j from 'neo4j-driver';

// Initialize Neo4j Driver
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASS || 'hpe_san_password')
);

/**
 * Fetches live SAN data from Neo4j to provide real-time context for GraphRAG.
 */
export const getLiveNeo4jData = async () => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (n)
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN collect(DISTINCT {
        id: n.id,
        name: n.name,
        type: labels(n)[0],
        status: n.status,
        ip_address: n.ip_address,
        model: n.model,
        serialNumber: n.serialNumber,
        firmware: n.firmware,
        totalCapacityTb: n.totalCapacityTb,
        usedCapacityTb: n.usedCapacityTb,
        parentId: n.parentId,
        isDecommissioned: n.isDecommissioned
      }) as nodes,
      collect(DISTINCT {
        from: startNode(r).id,
        to: endNode(r).id,
        label: type(r)
      }) as edges
    `);
    const record = result.records[0];
    const nodes = record.get('nodes').filter(n => n.id !== null);
    const edges = record.get('edges').filter(e => e.from !== null && e.to !== null);
    
    if (nodes.length === 0) return null;
    return { nodes, edges };
  } catch (error) {
    console.error('Neo4j GraphRAG Error:', error);
    return null;
  } finally {
    await session.close();
  }
};

// The provided SAN infrastructure data
const SAN_INFRASTRUCTURE_DATA = {
  "nodes": [
    {
      "id": "ARR-01",
      "name": "SAN-PROD-ARRAY-01",
      "type": "Array",
      "status": "normal",
      "category": "main",
      "parentId": null,
      "isDecommissioned": false,
      "model": "HPE 3PAR 8400",
      "serialNumber": "SN_12345",
      "firmware": "3.3.1.MU5",
      "protocol": "FC / NVMe",
      "totalCapacityTb": 500,
      "usedCapacityTb": 120.5,
      "freeCapacityTb": 379.5,
      "locationZone": "CXO_L2",
      "rackRow": "R24",
      "nodeCount": 2,
      "jbofCount": 2,
      "diskCount": 8
    },
    {
      "id": "ARR-02",
      "name": "SAN-DR-ARRAY-02",
      "type": "Array",
      "status": "degraded",
      "category": "main",
      "parentId": null,
      "isDecommissioned": false,
      "model": "HPE Primera A630",
      "serialNumber": "SN_67890",
      "firmware": "4.1.0.GA",
      "protocol": "FC",
      "totalCapacityTb": 980,
      "usedCapacityTb": 412,
      "freeCapacityTb": 568,
      "locationZone": "DR_EAST",
      "rackRow": "R08",
      "nodeCount": 2,
      "jbofCount": 1,
      "diskCount": 6
    },
    {
      "id": "ARR01-N0",
      "name": "Controller-0",
      "type": "Node",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "cpuCores": 32,
      "memoryGb": 128,
      "isMaster": true,
      "firmware": "3.3.1.MU5"
    },
    {
      "id": "ARR01-N1",
      "name": "Controller-1",
      "type": "Node",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "cpuCores": 32,
      "memoryGb": 128,
      "isMaster": false,
      "firmware": "3.3.1.MU5"
    },
    {
      "id": "ARR01-P1",
      "name": "Port 0:0:1",
      "type": "Port",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "protocol": "FC",
      "mode": "target",
      "portType": "host",
      "speed": "32G",
      "wwn": "20:00:00:25:B5:01:00:01",
      "state": "ready"
    },
    {
      "id": "ARR01-P2",
      "name": "Port 0:0:2",
      "type": "Port",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "protocol": "FC",
      "mode": "target",
      "portType": "host",
      "speed": "32G",
      "wwn": "20:00:00:25:B5:01:00:02",
      "state": "ready"
    },
    {
      "id": "ARR01-P3",
      "name": "Port 1:0:1",
      "type": "Port",
      "status": "degraded",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "protocol": "NVMe",
      "mode": "target",
      "portType": "disk",
      "speed": "100G",
      "wwn": "20:00:00:25:B5:01:01:01",
      "state": "loss_sync"
    },
    {
      "id": "ARR01-JBOF1",
      "name": "JBOF-Shelf-1",
      "type": "JBOF",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "diskCount": 24,
      "model": "HPE NVMe JBOF",
      "capacity": "230 TB"
    },
    {
      "id": "ARR01-JBOF2",
      "name": "JBOF-Shelf-2",
      "type": "JBOF",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "diskCount": 24,
      "model": "HPE NVMe JBOF",
      "capacity": "230 TB"
    },
    {
      "id": "ARR01-D1",
      "name": "Disk-0:0:0",
      "type": "Disk",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR01-JBOF1",
      "isDecommissioned": false,
      "capacity": "3.84 TB",
      "diskModel": "KIOXIA KPM6XRUG3T84",
      "diskType": "SSD",
      "diskProtocol": "SAS",
      "wearLevel": "2%"
    },
    {
      "id": "ARR01-D2",
      "name": "Disk-0:0:1",
      "type": "Disk",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR01-JBOF1",
      "isDecommissioned": false,
      "capacity": "3.84 TB",
      "diskModel": "KIOXIA KPM6XRUG3T84",
      "diskType": "SSD",
      "diskProtocol": "SAS",
      "wearLevel": "5%"
    },
    {
      "id": "ARR01-D3",
      "name": "Disk-0:1:0",
      "type": "Disk",
      "status": "failed",
      "category": "sub",
      "parentId": "ARR01-JBOF2",
      "isDecommissioned": false,
      "capacity": "7.68 TB",
      "diskModel": "Samsung PM1733",
      "diskType": "NVMe",
      "diskProtocol": "NVMe",
      "wearLevel": "78%"
    },
    {
      "id": "ARR01-D4",
      "name": "Disk-0:1:1",
      "type": "Disk",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR01-JBOF2",
      "isDecommissioned": false,
      "capacity": "7.68 TB",
      "diskModel": "Samsung PM1733",
      "diskType": "NVMe",
      "diskProtocol": "NVMe",
      "wearLevel": "12%"
    },
    {
      "id": "ARR01-PCI1",
      "name": "HBA-QLogic-01",
      "type": "PCI_Device",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR01-N0",
      "isDecommissioned": false,
      "pciType": "HBA",
      "pciModel": "QLogic QLE2692",
      "pciFirmware": "9.08.02",
      "pciSpeed": "32Gbps",
      "slot": "Slot 1"
    },
    {
      "id": "ARR01-CAGE1",
      "name": "Cage-0",
      "type": "Cage",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-01",
      "isDecommissioned": false,
      "cageModel": "Drive Cage",
      "temperature": 35,
      "cageCapacity": "24 slots"
    },
    {
      "id": "ARR02-N0",
      "name": "Controller-0",
      "type": "Node",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-02",
      "isDecommissioned": false,
      "cpuCores": 48,
      "memoryGb": 256,
      "isMaster": true,
      "firmware": "4.1.0.GA"
    },
    {
      "id": "ARR02-N1",
      "name": "Controller-1",
      "type": "Node",
      "status": "degraded",
      "category": "sub",
      "parentId": "ARR-02",
      "isDecommissioned": false,
      "cpuCores": 48,
      "memoryGb": 256,
      "isMaster": false,
      "firmware": "4.1.0.GA"
    },
    {
      "id": "ARR02-P1",
      "name": "Port 0:0:1",
      "type": "Port",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-02",
      "isDecommissioned": false,
      "protocol": "FC",
      "mode": "target",
      "speed": "32G",
      "wwn": "20:00:00:25:B5:02:00:01",
      "state": "ready"
    },
    {
      "id": "ARR02-P2",
      "name": "Port 0:0:2",
      "type": "Port",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-02",
      "isDecommissioned": false,
      "protocol": "FC",
      "mode": "target",
      "speed": "32G",
      "wwn": "20:00:00:25:B5:02:00:02",
      "state": "ready"
    },
    {
      "id": "ARR02-JBOF1",
      "name": "JBOF-Shelf-1",
      "type": "JBOF",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR-02",
      "isDecommissioned": false,
      "diskCount": 24,
      "model": "HPE NVMe JBOF",
      "capacity": "185 TB"
    },
    {
      "id": "ARR02-D1",
      "name": "Disk-0:0:0",
      "type": "Disk",
      "status": "normal",
      "category": "sub",
      "parentId": "ARR02-JBOF1",
      "isDecommissioned": false,
      "capacity": "3.84 TB",
      "diskModel": "KIOXIA KPM6XRUG3T84",
      "diskType": "SSD",
      "diskProtocol": "SAS"
    },
    {
      "id": "ARR02-D2",
      "name": "Disk-0:0:1",
      "type": "Disk",
      "status": "degraded",
      "category": "sub",
      "parentId": "ARR02-JBOF1",
      "isDecommissioned": false,
      "capacity": "3.84 TB",
      "diskModel": "KIOXIA KPM6XRUG3T84",
      "diskType": "SSD",
      "diskProtocol": "SAS",
      "wearLevel": "92%"
    },
    {
      "id": "SW-01",
      "name": "FC-Switch-Core-1",
      "type": "Switch",
      "status": "normal",
      "category": "main",
      "parentId": null,
      "isDecommissioned": false,
      "model": "Brocade G620",
      "serialNumber": "BRC4821",
      "firmware": "v8.2.1b",
      "domainId": 1,
      "temperature": 42,
      "switchType": "FC"
    },
    {
      "id": "SW-02",
      "name": "FC-Switch-Core-2",
      "type": "Switch",
      "status": "normal",
      "category": "main",
      "parentId": null,
      "isDecommissioned": false,
      "model": "Brocade G620",
      "serialNumber": "BRC4822",
      "firmware": "v8.2.1b",
      "domainId": 2,
      "temperature": 45,
      "switchType": "FC"
    },
    {
      "id": "SW-03",
      "name": "Eth-Switch-Mgmt",
      "type": "Switch",
      "status": "degraded",
      "category": "main",
      "parentId": null,
      "isDecommissioned": true,
      "model": "Aruba CX 6300",
      "serialNumber": "ARU9901",
      "firmware": "10.09.1020",
      "temperature": 38,
      "switchType": "Ethernet"
    },
    {
      "id": "SW01-SP1",
      "name": "sw1/port-0",
      "type": "SwitchPort",
      "status": "normal",
      "category": "sub",
      "parentId": "SW-01",
      "isDecommissioned": false,
      "speed": "32G",
      "wwn": "50:00:51:E0:01:00:00:01",
      "state": "online",
      "protocol": "FC"
    },
    {
      "id": "SW01-SP2",
      "name": "sw1/port-1",
      "type": "SwitchPort",
      "status": "normal",
      "category": "sub",
      "parentId": "SW-01",
      "isDecommissioned": false,
      "speed": "32G",
      "wwn": "50:00:51:E0:01:00:00:02",
      "state": "online",
      "protocol": "FC"
    },
    {
      "id": "SW01-SP3",
      "name": "sw1/port-2",
      "type": "SwitchPort",
      "status": "normal",
      "category": "sub",
      "parentId": "SW-01",
      "isDecommissioned": false,
      "speed": "32G",
      "wwn": "50:00:51:E0:01:00:00:03",
      "state": "online",
      "protocol": "FC"
    },
    {
      "id": "SW02-SP1",
      "name": "sw2/port-0",
      "type": "SwitchPort",
      "status": "normal",
      "category": "sub",
      "parentId": "SW-02",
      "isDecommissioned": false,
      "speed": "32G",
      "wwn": "50:00:51:E0:02:00:00:01",
      "state": "online",
      "protocol": "FC"
    },
    {
      "id": "SW02-SP2",
      "name": "sw2/port-1",
      "type": "SwitchPort",
      "status": "degraded",
      "category": "sub",
      "parentId": "SW-02",
      "isDecommissioned": false,
      "speed": "16G",
      "wwn": "50:00:51:E0:02:00:00:02",
      "state": "online",
      "protocol": "FC"
    },
    {
      "id": "SW03-SP1",
      "name": "eth0/1",
      "type": "SwitchPort",
      "status": "normal",
      "category": "sub",
      "parentId": "SW-03",
      "isDecommissioned": true,
      "speed": "25G",
      "state": "up",
      "protocol": "Ethernet"
    },
    {
      "id": "HOST-01",
      "name": "LNX-ORA-DB01",
      "type": "Host",
      "status": "normal",
      "category": "main",
      "parentId": null,
      "isDecommissioned": false,
      "osType": "Linux",
      "ipAddress": "10.50.1.22",
      "multipathStatus": "dual",
      "wwn": "20:00:00:25:B5:AA:BB:01",
      "connectedPortsCount": 2
    },
    {
      "id": "HOST-02",
      "name": "WNT-SQL-05",
      "type": "Host",
      "status": "normal",
      "category": "main",
      "parentId": null,
      "isDecommissioned": false,
      "osType": "Windows",
      "ipAddress": "10.50.1.45",
      "multipathStatus": "dual",
      "wwn": "20:00:00:25:B5:AA:BB:02",
      "connectedPortsCount": 2
    },
    {
      "id": "H01-HP1",
      "name": "hba0-p0",
      "type": "HostPort",
      "status": "normal",
      "category": "sub",
      "parentId": "HOST-01",
      "isDecommissioned": false,
      "protocol": "FC",
      "speed": "32G",
      "wwn": "10:00:00:25:B5:AA:01:01",
      "state": "logged_in"
    },
    {
      "id": "H01-HP2",
      "name": "hba0-p1",
      "type": "HostPort",
      "status": "normal",
      "category": "sub",
      "parentId": "HOST-01",
      "isDecommissioned": false,
      "protocol": "FC",
      "speed": "32G",
      "wwn": "10:00:00:25:B5:AA:01:02",
      "state": "logged_in"
    },
    {
      "id": "H02-HP1",
      "name": "hba0-p0",
      "type": "HostPort",
      "status": "normal",
      "category": "sub",
      "parentId": "HOST-02",
      "isDecommissioned": false,
      "protocol": "FC",
      "speed": "16G",
      "wwn": "10:00:00:25:B5:AA:02:01",
      "state": "logged_in"
    },
    {
      "id": "H03-HP1",
      "name": "hba0-p0",
      "type": "HostPort",
      "status": "failed",
      "category": "sub",
      "parentId": "HOST-03",
      "isDecommissioned": false,
      "protocol": "FC",
      "speed": "32G",
      "wwn": "10:00:00:25:B5:AA:03:01",
      "state": "offline"
    },
    {
      "id": "SW-DECOM-01",
      "name": "FC-Switch-Old-Lab",
      "type": "Switch",
      "status": "normal",
      "category": "main",
      "parentId": null,
      "isDecommissioned": true,
      "model": "Brocade 6510",
      "serialNumber": "BRC1001",
      "firmware": "v7.4.2",
      "switchType": "FC"
    }
  ],
  "edges": [
    {
      "from": "ARR-01",
      "to": "SW-01",
      "label": "FC 32G"
    },
    {
      "from": "ARR-01",
      "to": "SW-02",
      "label": "FC 32G"
    },
    {
      "from": "ARR-02",
      "to": "SW-02",
      "label": "FC 32G"
    },
    {
      "from": "ARR-02",
      "to": "SW-03",
      "label": "Ethernet"
    },
    {
      "from": "SW-01",
      "to": "HOST-01",
      "label": "zoned"
    },
    {
      "from": "SW-01",
      "to": "HOST-02",
      "label": "zoned"
    },
    {
      "from": "SW-02",
      "to": "HOST-01",
      "label": "zoned"
    },
    {
      "from": "SW-01",
      "to": "SW-02",
      "label": "ISL"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-N0",
      "label": "has_node"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-N1",
      "label": "has_node"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-P1",
      "label": "has_port"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-P2",
      "label": "has_port"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-P3",
      "label": "has_port"
    },
    {
      "from": "ARR01-N0",
      "to": "ARR01-PCI1",
      "label": "has_pci"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-JBOF1",
      "label": "has_jbof"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-JBOF2",
      "label": "has_jbof"
    },
    {
      "from": "ARR01-JBOF1",
      "to": "ARR01-D1",
      "label": "has_disk"
    },
    {
      "from": "ARR01-JBOF1",
      "to": "ARR01-D2",
      "label": "has_disk"
    },
    {
      "from": "ARR01-JBOF2",
      "to": "ARR01-D3",
      "label": "has_disk"
    },
    {
      "from": "ARR01-JBOF2",
      "to": "ARR01-D4",
      "label": "has_disk"
    },
    {
      "from": "ARR-01",
      "to": "ARR01-CAGE1",
      "label": "has_cage"
    },
    {
      "from": "ARR-02",
      "to": "ARR02-N0",
      "label": "has_node"
    },
    {
      "from": "ARR-02",
      "to": "ARR02-N1",
      "label": "has_node"
    },
    {
      "from": "ARR-02",
      "to": "ARR02-P1",
      "label": "has_port"
    },
    {
      "from": "ARR-02",
      "to": "ARR02-P2",
      "label": "has_port"
    },
    {
      "from": "ARR-02",
      "to": "ARR02-JBOF1",
      "label": "has_jbof"
    },
    {
      "from": "ARR02-JBOF1",
      "to": "ARR02-D1",
      "label": "has_disk"
    },
    {
      "from": "ARR02-JBOF1",
      "to": "ARR02-D2",
      "label": "has_disk"
    },
    {
      "from": "SW-01",
      "to": "SW01-SP1",
      "label": "has_port"
    },
    {
      "from": "SW-01",
      "to": "SW01-SP2",
      "label": "has_port"
    },
    {
      "from": "SW-01",
      "to": "SW01-SP3",
      "label": "has_port"
    },
    {
      "from": "SW-02",
      "to": "SW02-SP1",
      "label": "has_port"
    },
    {
      "from": "SW-02",
      "to": "SW02-SP2",
      "label": "has_port"
    },
    {
      "from": "SW-03",
      "to": "SW03-SP1",
      "label": "has_port"
    },
    {
      "from": "HOST-01",
      "to": "H01-HP1",
      "label": "has_port"
    },
    {
      "from": "HOST-01",
      "to": "H01-HP2",
      "label": "has_port"
    },
    {
      "from": "HOST-02",
      "to": "H02-HP1",
      "label": "has_port"
    },
    {
      "from": "HOST-03",
      "to": "H03-HP1",
      "label": "has_port"
    }
  ]
};

// Load SAN data into database
export const loadSANData = async () => {
  try {
    // Clear existing data
    await SANData.deleteMany({});
    
    // Create new SAN data entry
    const sanData = new SANData({
      name: 'HPE SAN Infrastructure',
      description: 'Complete HPE Storage Area Network Infrastructure Data including arrays, switches, hosts, and components',
      nodes: SAN_INFRASTRUCTURE_DATA.nodes,
      edges: SAN_INFRASTRUCTURE_DATA.edges,
      lastUpdated: new Date(),
      version: '1.0'
    });
    
    await sanData.save();
    console.log('SAN data loaded successfully');
    return sanData;
  } catch (error) {
    console.error('Error loading SAN data:', error);
    throw error;
  }
};

// Get SAN data for AI context
export const getSANDataForAI = async () => {
  try {
    // Try live Neo4j data first
    const liveData = await getLiveNeo4jData();
    if (liveData) {
      console.log('Using live Neo4j data for AI context');
      return liveData;
    }

    const sanData = await SANData.findOne({});
    if (!sanData) {
      // Load data if not exists
      return await loadSANData();
    }
    return sanData;
  } catch (error) {
    console.error('Error getting SAN data:', error);
    return null;
  }
};

// Search SAN nodes by type, status, or name
export const searchSANNodes = async (query) => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) return [];
    
    const { nodes } = sanData;
    const lowerQuery = query.toLowerCase();
    
    return nodes.filter(node => 
      node.name.toLowerCase().includes(lowerQuery) ||
      node.type.toLowerCase().includes(lowerQuery) ||
      node.status.toLowerCase().includes(lowerQuery) ||
      node.id.toLowerCase().includes(lowerQuery)
    );
  } catch (error) {
    console.error('Error searching SAN nodes:', error);
    return [];
  }
};

// Get failed or degraded components
export const getProblematicComponents = async () => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) return [];
    
    return sanData.nodes.filter(node => 
      node.status === 'failed' || 
      node.status === 'degraded'
    );
  } catch (error) {
    console.error('Error getting problematic components:', error);
    return [];
  }
};

// Get capacity information
export const getCapacityInfo = async () => {
  try {
    const sanData = await getSANDataForAI();
    if (!sanData) return null;
    
    const arrays = sanData.nodes.filter(node => node.type === 'Array');
    const totalCapacity = arrays.reduce((sum, arr) => sum + (arr.totalCapacityTb || 0), 0);
    const usedCapacity = arrays.reduce((sum, arr) => sum + (arr.usedCapacityTb || 0), 0);
    const freeCapacity = arrays.reduce((sum, arr) => sum + (arr.freeCapacityTb || 0), 0);
    
    return {
      totalArrays: arrays.length,
      totalCapacityTb: totalCapacity,
      usedCapacityTb: usedCapacity,
      freeCapacityTb: freeCapacity,
      utilizationPercentage: totalCapacity > 0 ? ((usedCapacity / totalCapacity) * 100).toFixed(2) : 0,
      arrays: arrays.map(arr => ({
        id: arr.id,
        name: arr.name,
        model: arr.model,
        status: arr.status,
        totalCapacityTb: arr.totalCapacityTb,
        usedCapacityTb: arr.usedCapacityTb,
        freeCapacityTb: arr.freeCapacityTb,
        utilizationPercentage: arr.totalCapacityTb > 0 ? ((arr.usedCapacityTb / arr.totalCapacityTb) * 100).toFixed(2) : 0
      }))
    };
  } catch (error) {
    console.error('Error getting capacity info:', error);
    return null;
  }
};
