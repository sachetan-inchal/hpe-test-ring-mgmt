# HPE SAN Monorepo — Setup & Run Guide

This monorepo unifies the SAN Simulator, Discovery Engine, React Dashboard, AI Assistant (RAG), and Neo4j topology management.

## Prerequisites

1. **Python 3.10+** (Use `py` command on Windows)
2. **Node.js & npm**
3. **Docker Desktop** (Required for Neo4j and Elasticsearch)

---

## 1. Environment Setup

1. Copy `.env.example` to `.env`.
2. Fill in your `GROQ_API_KEY` for **AI Assistant** and **Spreadsheet Ingest** features.
3. Install Python dependencies:
   ```powershell
   cd monorepo
   pip install -r requirements.txt
   ```

## 2. Infrastructure

Start the graph and search engines via Docker:
```powershell
cd monorepo
docker-compose up -d neo4j elasticsearch
```

- **Neo4j Browser**: [http://localhost:7474](http://localhost:7474) (User: `neo4j`, Pass: `hpe_san_password`)
- **Elasticsearch**: [http://localhost:9200](http://localhost:9200)

## 3. Application Execution

For the best experience, run all three components in separate terminals:

### A. Simulator (Port 5001)
```powershell
cd monorepo
py simulator/simulator_manager.py
```

### B. Main API (Port 5005)
```powershell
cd monorepo
py api/app.py
```

### C. Dashboard (Port 3000)
```powershell
cd monorepo/dashboard
npm install
npm run dev
```

---

## Using the Dashboard

1. **Topology Canvas**: Visualizes the SAN network. Click nodes for details.
2. **Start Discovery**: Click the button in the header to run the BFS crawler against the simulated network.
3. **AI Assistant**: Natural language chat over the topology. Supports hybrid RAG (JSON store + Neo4j).
4. **Admin Panel**: Add/Delete nodes, ingest CSV data, or generate synthetic device files.
5. **Node Terminal**: Click an IP in the sidebar to open a terminal for executing CLI commands on simulated devices.

## Project Structure

- `api/` — Unified Flask REST API.
- `api/integrations/` — RAG engine, spreadsheet pipeline, and data faker.
- `dashboard/` — React Flow + Vite frontend.
- `discovery/` — Iterative BFS crawler and multi-vendor parsers.
- `simulator/` — Virtual network and CLI replay engine.
- `data/` — JSON storage and field definitions.
