# HPE SAN Monorepo

Enterprise-grade SAN Discovery, Simulation & Management Platform.

## Structure
```
HPE_SAN_Monorepo/
├── simulator/          # Mock SAN network with live terminals per device
│   ├── device_terminal.py      # Per-device virtual terminal server
│   ├── network_sim.py          # Virtual network routing / socket simulation
│   ├── simulator_manager.py    # Spawns and manages all device instances
│   ├── data_generator.py       # Generates rich mock data from m1-m3 schema
│   └── data/devices/           # Seed CLI dump files (s4634.txt, s9999.txt…)
├── discovery/          # Universal iterative BFS crawler & parsers
│   ├── crawler.py              # Main BFS discovery orchestrator
│   ├── fingerprint.py          # OS/device fingerprinting logic
│   ├── parsers/                # HPE CLI, Linux, Windows parsers
│   ├── indexer.py              # Elasticsearch indexer
│   └── neo4j_store.py          # Neo4j graph persistence
├── dashboard/          # React unified UI (topology map + sidebar + terminals)
│   ├── src/
│   │   ├── components/
│   │   │   ├── TopologyMap/    # Visual SAN Topology (from hpe-ontology-and-graph)
│   │   │   ├── AggregateSidebar/ # Detail panel (from san-emulatoreditor)
│   │   │   ├── DiscoveryPanel/ # Discovery status + live animation
│   │   │   └── NodeTerminal/   # Per-node interactive terminal modal
│   │   └── App.jsx
├── api/                # Flask REST + WebSocket backend
│   └── app.py
└── docker-compose.yml  # Neo4j + Elasticsearch services
```

## Quick Start
```bash
# 1. Start infrastructure
docker-compose up -d

# 2. Start the simulator (spawns virtual SAN devices)
cd simulator && python simulator_manager.py

# 3. Start the API backend
cd api && python app.py

# 4. Start the React dashboard
cd dashboard && npm install && npm start
```
