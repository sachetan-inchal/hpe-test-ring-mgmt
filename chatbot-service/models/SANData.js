import mongoose from 'mongoose';

// Node schema for individual components
const nodeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['Array', 'Node', 'Port', 'JBOF', 'Disk', 'Switch', 'SwitchPort', 'Host', 'HostPort', 'PCI_Device', 'Cage'],
    required: true 
  },
  status: { 
    type: String, 
    enum: ['normal', 'degraded', 'failed', 'offline'],
    required: true 
  },
  category: { 
    type: String, 
    enum: ['main', 'sub'],
    required: true 
  },
  parentId: { type: String, default: null },
  isDecommissioned: { type: Boolean, default: false },
  // Array-specific fields
  model: { type: String },
  serialNumber: { type: String },
  firmware: { type: String },
  protocol: { type: String },
  totalCapacityTb: { type: Number },
  usedCapacityTb: { type: Number },
  freeCapacityTb: { type: Number },
  locationZone: { type: String },
  rackRow: { type: String },
  nodeCount: { type: Number },
  jbofCount: { type: Number },
  diskCount: { type: Number },
  // Node-specific fields
  cpuCores: { type: Number },
  memoryGb: { type: Number },
  isMaster: { type: Boolean },
  // Port-specific fields
  mode: { type: String },
  portType: { type: String },
  speed: { type: String },
  wwn: { type: String },
  state: { type: String },
  // JBOF-specific fields
  capacity: { type: String },
  // Disk-specific fields
  capacity: { type: String },
  diskModel: { type: String },
  diskType: { type: String },
  diskProtocol: { type: String },
  wearLevel: { type: String },
  // Switch-specific fields
  domainId: { type: Number },
  temperature: { type: Number },
  switchType: { type: String },
  // SwitchPort-specific fields
  protocol: { type: String },
  // Host-specific fields
  osType: { type: String },
  ipAddress: { type: String },
  multipathStatus: { type: String },
  connectedPortsCount: { type: Number },
  // PCI_Device-specific fields
  pciType: { type: String },
  pciModel: { type: String },
  pciFirmware: { type: String },
  pciSpeed: { type: String },
  slot: { type: String },
  // Cage-specific fields
  cageModel: { type: String },
  temperature: { type: Number },
  cageCapacity: { type: String }
}, { _id: false });

// Edge schema for connections
const edgeSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  label: { type: String, required: true }
}, { _id: false });

// Main SAN data schema
const sanDataSchema = new mongoose.Schema({
  name: { type: String, required: true, default: 'SAN Infrastructure' },
  description: { type: String, default: 'Storage Area Network Infrastructure Data' },
  nodes: [nodeSchema],
  edges: [edgeSchema],
  lastUpdated: { type: Date, default: Date.now },
  version: { type: String, default: '1.0' }
}, { timestamps: true });

const SANData = mongoose.model('SANData', sanDataSchema);
export default SANData;
