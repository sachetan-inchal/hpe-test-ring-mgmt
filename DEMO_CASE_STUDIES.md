# HPE SAN Management System - Demo Case Studies

This document outlines comprehensive demo scenarios showcasing all system features end-to-end.

---

## Demo Scenario 1: Infrastructure Discovery & Visualization

**Objective**: Demonstrate automated network discovery and real-time topology visualization.

**Duration**: 5-7 minutes

### Setup
1. Start the simulator, API, and dashboard
2. Load the generated demo dataset via `/api/faker/import`

### Demo Flow

#### Step 1: Live Discovery Initiation
- Navigate to **Discovery Tab** in dashboard
- Click "Start Discovery" with seed IP `10.20.10.5`
- Show live BFS crawl animation as system discovers:
  - Storage arrays
  - Switches
  - Hosts
  - Physical disk infrastructure

#### Step 2: Topology Visualization
- Switch to **Topology Tab**
- Display the complete hierarchical SAN network:
  - 4 storage arrays grouped by site (Production, Backup, DR, Edge)
  - 7 Fiber Channel switches
  - 20+ connected hosts
- Demonstrate zoom, pan, and node inspection
- Show real-time status indicators

#### Step 3: Device Inspection
- Click on individual devices to show:
  - **Array**: Capacity metrics, node count, controllers, cage configuration
  - **Host**: OS type, IP, persona, multipath status
  - **Switch**: Temperature, port states, connection count
  - **Physical Disk**: Capacity, protocol, health status (including failed disks)

#### Key Talking Points
- Automatic vendor fingerprinting and parser selection
- Real-time multi-vendor device support (Cisco, Brocade)
- Hierarchical relationship mapping (Array → Nodes → Ports → Hosts)
- Zero-downtime discovery during production operations

---

## Demo Scenario 2: Capacity Management & Health Analytics

**Objective**: Show system health monitoring, capacity planning, and predictive insights.

**Duration**: 5-7 minutes

### Setup
- Use dashboard with populated demo dataset

### Demo Flow

#### Step 1: System Health Overview
- Navigate to **Health Tab**
- Display system-wide metrics:
  - Total storage capacity (across all arrays)
  - Allocation ratio and trending
  - Failed disk detection (5% of disks are marked as failed)
  - Array health indicators (green for healthy, yellow for warnings)

#### Step 2: Capacity Deep Dive
- Show per-array capacity breakdown:
  - **PROD-A**: 85% allocated (showing capacity pressure)
  - **PROD-B**: 72% allocated (balanced utilization)
  - **BACKUP-C**: 45% allocated (sufficient headroom)
  - **DR-D**: 30% allocated (proper recovery buffer)

#### Step 3: Predictive Insights (AI Tab)
- Query: "What is the health status of PROD-A?"
- Show AI-driven response with:
  - Capacity utilization trend
  - Risk assessment for failed disks
  - Recommendations for tiering or expansion
- Query: "Which disks are in predictive failure state?"
- Demonstrate AI's ability to correlate data and surface risks

#### Step 4: Admin Tools
- Navigate to **Admin Tab**
- Show device CRUD operations:
  - Create new host entry
  - Modify array configuration
  - Trigger synthetic data generation for testing
- Show field schema management for custom attributes

#### Key Talking Points
- Real-time capacity trending and forecasting
- Multi-vendor device normalization
- Proactive health monitoring and alerting
- Customizable admin workflows

---

## Demo Scenario 3: Topology Management & Device Decommissioning

**Objective**: Demonstrate interactive topology modification and safe device lifecycle management.

**Duration**: 5-7 minutes

### Setup
- Dashboard with demo dataset loaded

### Demo Flow

#### Step 1: Interactive Device Management
- In **Topology Tab**, select a non-critical host (e.g., `web-server-03`)
- Show available actions:
  - Edit properties (name, personnel, notes)
  - Link/unlink devices
  - View relationship graph

#### Step 2: Decommissioning Workflow
- Select an edge device (e.g., `EDGE-E` array)
- Demonstrate full decommissioning process:
  1. Pre-flight check (identify dependent hosts)
  2. Mark as `is_decommissioned=true`
  3. Show automatic relationship pruning in graph
  4. Confirm removal from topology

#### Step 3: Relationship Visualization
- Before decommissioning:
  - Show hosts connected to EDGE-E
  - Show replication relationships (backup copies, DR links)
- After decommissioning:
  - Hosts are displayed with warning state
  - Relationships are visually faded
  - System suggests migration targets

#### Step 4: Historical Audit Trail
- Query the database:
  - "Show all decommissioned devices"
  - "What was connected to EDGE-E before removal?"
- Demonstrate Neo4j query results and export capabilities

#### Key Talking Points
- Safe device lifecycle management
- Multi-step approval workflows (can be extended)
- Automatic impact analysis
- Complete audit trail and rollback capability

---

## Demo Scenario 4: Multi-Site Replication & Disaster Recovery

**Objective**: Showcase replication topology and DR planning features.

**Duration**: 5-7 minutes

### Setup
- Demo dataset includes replication relationships

### Demo Flow

#### Step 1: Replication Topology
- In **Topology Tab**, highlight replication edges:
  - PROD-A → BACKUP-C (local backup)
  - PROD-B → DR-D (remote DR)
  - BACKUP-C → DR-D (cascading backup)
- Show visual differentiation of replication vs. direct connectivity

#### Step 2: DR Readiness Assessment
- Query via **AI Assistant**:
  - "What is the RPO and RTO for PROD-A?"
  - "How much data is replicated to DR-D?"
  - "Which arrays are not protected by replication?"
- AI provides contextual analysis of replication status

#### Step 3: Failover Planning
- Manually mark PROD-A as decommissioned or failed
- System shows:
  - Hosts previously connected to PROD-A
  - Available failover targets (BACKUP-C, DR-D)
  - Migration paths and impact assessment
  - Recommended load balancing across available arrays

#### Step 4: Capacity Planning for DR
- Show capacity headroom on each site:
  - Primary: 15% free (tight)
  - Secondary: 55% free (sufficient for failover)
  - DR: 70% free (excellent buffer)
- AI recommends pre-staging workloads or capacity expansion

#### Key Talking Points
- Business continuity planning visibility
- Automated failover readiness assessment
- Replication policy management
- Cross-site capacity balancing

---

## Demo Scenario 5: Multi-Vendor Device Integration

**Objective**: Highlight vendor heterogeneity and unified management.

**Duration**: 3-5 minutes

### Setup
- Demo dataset includes multiple vendors (Cisco, Brocade switches; HPE, Nimble arrays)

### Demo Flow

#### Step 1: Vendor Diversity Showcase
- In **Topology Tab**, highlight:
  - **Switches**: Cisco MDS 9148S, Brocade 6510, Brocade G630, Cisco MDS 9396T
  - **Arrays**: HPE Alletra MP, Alletra 9000, Primera 600, Nimble HF60
  - **Hosts**: Windows, Linux (RHEL, Ubuntu, Oracle), VMware ESXi

#### Step 2: Unified Command Execution
- Navigate to **Emulator Tab**
- Select a Cisco switch and execute:
  - `show version`
  - `show interface status`
- Show parsed output unified across vendors
- Switch to Brocade device and show equivalent commands with automatic vendor detection

#### Step 3: Unified Parsing & Indexing
- Execute array discovery:
  - `showsys` (array system info)
  - `shownode` (controller details)
  - `showport` (port configurations)
  - `showcage` (disk cage status)
  - `showpd` (physical disk inventory)
- Show parsed results indexed in Elasticsearch
- Demonstrate cross-vendor search: "Find all SSDs with capacity > 1TB"

#### Step 4: AI Query Across Vendors
- Query: "What is the total installed capacity across all array vendors?"
- AI provides normalized, aggregated response across all vendors

#### Key Talking Points
- Zero-touch vendor onboarding
- Automatic fingerprinting and parser selection
- Unified CLI command interface
- Cross-vendor analytics and reporting
- Enterprise fabric visibility

---

## Demo Scenario 6: AI-Driven Diagnostics & Decision Support

**Objective**: Demonstrate RAG engine and contextual AI assistance.

**Duration**: 7-10 minutes

### Setup
- AI tab configured with Groq/Gemini API key
- Demo dataset indexed in Elasticsearch

### Demo Flow

#### Step 1: Contextual Discovery Queries
Ask the AI assistant queries like:

1. **"What is the current state of PROD-A?"**
   - Expected: Array name, IP, model, capacity, utilization, replication status
   - Show how AI retrieves data from Neo4j and Elasticsearch

2. **"Which arrays are experiencing disk failures?"**
   - Expected: List of arrays with failed disk counts and locations
   - Show correlation across multiple data sources

3. **"What is the health score of my SAN?"**
   - Expected: Composite metric including capacity, failure rates, replication coverage
   - Show multi-metric aggregation

#### Step 2: Capacity Planning Assistance
Query: **"Do I need to expand storage in the next quarter?"**
- Expected Response:
  - Current utilization trends per array
  - Projection based on growth rates
  - Capacity headroom assessment
  - Specific recommendations (upgrade PROD-A, add DR capacity)

#### Step 3: Operational Troubleshooting
Query: **"Why is web-server-02 experiencing slow response times?"**
- Expected Analysis:
  - Host location in topology
  - Connected arrays and their utilization
  - Path latency to storage
  - Disk performance metrics
  - Recommendations (load balance, upgrade disks, optimize replication)

#### Step 4: Compliance & Audit Queries
Query: **"Which hosts are not configured for multipath?"**
- Expected: List of non-resilient connections with risk assessment
- Follow-up: **"What is the cost of fixing this?"** (estimated downtime, disk count)

#### Step 5: Streaming Agent Execution
- Show real-time agent execution traces:
  - Planning steps (parsing query, determining data sources)
  - Retrieval steps (Neo4j queries, Elasticsearch searches)
  - Synthesis steps (aggregating and contextualizing results)
  - Final answer with confidence scores

#### Key Talking Points
- LLM-powered contextual assistance (not generic AI)
- Real-time data integration from multiple sources
- Actionable recommendations with business impact
- Explainable AI with execution traces
- Enterprise compliance and audit support

---

## Demo Scenario 7: End-to-End Workflow: Array Expansion

**Objective**: Show complete lifecycle from planning to decommissioning.

**Duration**: 10-12 minutes

### Setup
- All previous systems running and populated

### Demo Flow

#### Step 1: Planning & Assessment (AI Tab)
Query: **"I need to expand storage. What are my options?"**
- AI assesses:
  - Current array capacities and utilization
  - Budget considerations (vendor cost profiles)
  - Replication and DR requirements
  - Network connectivity constraints
- AI recommends: "Expand PROD-A by adding 2 additional disk cages"

#### Step 2: Dry-Run & Impact Analysis (Topology Tab)
- Manually create new disk cage node: `PROD-A-CAGE-4`
- Add 24 physical disk nodes
- Observe:
  - Graph updates dynamically
  - Related metrics recalculate
  - AI re-evaluates health score

#### Step 3: Capacity Rebalancing (Admin Tab)
- Use Admin tool to:
  - Redistribute workloads across cages
  - Update replication targets
  - Trigger synthetic data generation to test new capacity
- Show real-time updates in Topology and Health tabs

#### Step 4: Redundancy Verification (AI Tab)
Query: **"Is my new configuration resilient to single-array failure?"**
- AI verifies:
  - All hosts have backup paths
  - Replication covers new disks
  - DR site has sufficient capacity
  - Result: "Yes, configuration meets resilience SLA"

#### Step 5: Testing & Validation
- Execute discovery on expanded array
- Show new disks parsed and indexed
- Verify metrics and health scores updated
- Query AI: "Show me disk performance across PROD-A"

#### Step 6: Documentation & Audit
- Export topology as SVG/PDF for documentation
- Query audit trail: "What changed in the last 30 minutes?"
- Show change history with timestamps and operators

#### Key Talking Points
- Evidence-based planning with AI recommendations
- Low-risk dry-run and impact analysis
- Automated validation and testing
- Complete audit trail and rollback capability
- Business continuity throughout expansion

---

## Demo Talking Points Summary

### System Architecture Highlights
- **Unified API**: Single entry point for all operations
- **Multi-Database**: Neo4j (topology), Elasticsearch (search), MongoDB (documents)
- **Real-Time Streaming**: Live discovery updates via SSE
- **Extensible Parsers**: Easy to add new vendors and command types

### Competitive Advantages
1. **Non-Hardcoded Data**: Fully parameterized, production-ready generator
2. **Multi-Vendor Support**: Cisco, Brocade, HPE, Nimble in unified interface
3. **AI-Driven Intelligence**: RAG engine for contextual decision support
4. **Interactive Visualization**: React Flow-based topology with real-time updates
5. **Complete Lifecycle**: Discovery → Monitoring → Planning → Decommissioning

### Key Metrics to Highlight During Demo
- **Storage Capacity**: 4 arrays, 1TB+ total capacity
- **Devices**: 7 switches + 20+ hosts across 4 sites
- **Redundancy**: 3 replication paths, cross-site DR coverage
- **Resilience**: 5% simulated disk failure rate handled gracefully
- **Query Performance**: Real-time responses for complex topology queries

---

## Demo Dataset Summary

The generated dataset (`data/demo_dataset.json`) includes:

### Storage Infrastructure
- **PROD-A** (Primary): Alletra Storage MP, 2 controllers, 3 cages, 72 disks, 85% utilized
- **PROD-B** (Primary): Alletra 9000, 3 controllers, 4 cages, 112 disks, 72% utilized
- **BACKUP-C** (Backup): Primera 600, 2 controllers, 2 cages, 32 disks, 45% utilized
- **DR-D** (Disaster Recovery): Nimble HF60, 2 controllers, 2 cages, 24 disks, 30% utilized
- **EDGE-E** (Edge Datacenter): Nimble HF20, 1 controller, 1 cage, 8 disks, 40% utilized

### Fabric Infrastructure
- 7 Fiber Channel switches (mix of Cisco and Brocade)
- Full mesh connectivity
- Port-level health simulation (95% online, 5% offline)

### Host Ecosystem
- 4 Database servers (Linux)
- 3 Application servers (Windows)
- 5 Virtualization hosts (ESXi)
- 2 File servers (Windows)
- 3 Web servers (Linux)
- 4 Edge hosts (mixed Linux/Windows)
- All with multipath configured

### Replication
- PROD-A → BACKUP-C (local backup)
- PROD-B → DR-D (remote DR)
- BACKUP-C → DR-D (cascading)

### Data Integrity Features
- Failed disk detection (5% failure rate)
- Predictive failure indicators
- Health status tracking per device
- Timestamp audit trails

---

## Running the Demo

### 1. Generate Dataset
```bash
cd hpe-test-ring-mgmt
python generate_demo_dataset.py
```
Output: `data/demo_dataset.json`

### 2. Import Dataset
```bash
# POST to the API
curl -X POST http://localhost:5005/api/faker/import \
  -H "Content-Type: application/json" \
  -d @data/demo_dataset.json
```

### 3. Access Dashboard
```bash
# Open dashboard with populated data
http://localhost:3000
```

### 4. Verify in Neo4j Browser
```bash
# Check imported nodes
http://localhost:7474
Query: MATCH (n) RETURN COUNT(n)
Expected: ~800+ nodes
```

### 5. Run Demo Scenarios
Follow the case study flows outlined above, using the exact queries and sequence for consistent demonstration.

---

## Notes

- All IP addresses are realistic but non-routable (10.x.x.x range) for safe testing
- Device serial numbers are randomized per generation for uniqueness
- Failure and warning states are simulated probabilistically
- Replication paths are deterministic (based on site configuration)
- All timestamps are generated relative to current time for realistic trending

---

## Future Enhancements

1. **Historical Scenarios**: Pre-built scenarios for common maintenance operations
2. **Performance Profiles**: Network latency and storage performance modeling
3. **Workload Simulation**: Synthetic I/O patterns and capacity trending
4. **Cost Attribution**: Budget tracking and cost-per-host allocation
5. **Custom Policies**: User-defined compliance rules and SLAs
