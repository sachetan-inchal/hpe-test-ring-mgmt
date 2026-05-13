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
docker-compose up -d neo4j elasticsearch mongo
```

- **Neo4j Browser**: [http://localhost:7474](http://localhost:7474) (User: `neo4j`, Pass: `hpe_san_password`)
- **Elasticsearch**: [http://localhost:9200](http://localhost:9200)
- **MongoDB**: [mongodb://localhost:27017](mongodb://localhost:27017)

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

### C. Chatbot Service (Port 5010)
```powershell
cd monorepo/chatbot-service
npm install
npm run dev
```

### D. Dashboard (Port 3000)
```powershell
cd monorepo/dashboard
npm install
npm run dev
```

### D. API Explorer (Port 5005)
The Master API now includes a built-in interactive developer tool:
- **URL (API Explorer)**: [http://localhost:5005/tester](http://localhost:5005/tester)
- **URL (Standalone Terminal)**: [http://localhost:5005/terminal](http://localhost:5005/terminal)
- Use these to test SAN CLI commands, run graph pathfinding, and explore all API endpoints without writing code.

---

## Using the Dashboard

1. **Discovery Tab**: Live BFS network scan visualization.
2. **Topology Tab**: Ported from Unmesh — interactive SAN diagram with decommission management.
3. **Emulator Tab**: Execute CLI commands on simulated devices via terminal.
4. **AI Assistant**: Full-page chat with dual engine support (Gemini/Groq) and persistent history.
5. **Admin Tab**: Comprehensive device CRUD, schema management, and synthetic data generation.
6. **Health Tab**: System health metrics, capacity charts, and AI-driven recommendations.

## Project Structure

- `api/` — Unified Flask REST API.
- `api/integrations/` — RAG engine, spreadsheet pipeline, and data faker.
- `dashboard/` — React Flow + Vite frontend.
- `discovery/` — Iterative BFS crawler and multi-vendor parsers.
- `simulator/` — Virtual network and CLI replay engine.
- `data/` — JSON storage and field definitions.
