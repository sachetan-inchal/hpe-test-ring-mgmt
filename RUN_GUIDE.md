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

Start the graph and search engines via Docker. **IMPORTANT**: Only start the database services if you plan to run the API and Chatbot locally.

```powershell
# You MUST be in the monorepo directory
cd monorepo
# Only start databases (Recommended for development)
docker-compose up -d neo4j elasticsearch mongo
```

> [!WARNING]
> Do NOT run `docker-compose up -d` without service names if you are also running `py api/app.py`. This will cause a port conflict on **5005**.

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

---

## 4. Run Everything at Once (Recommended)

You can now start all services (Simulator, API, Chatbot, and Dashboard) with a single command. This setup uses `concurrently` to manage processes and `nodemon` for hot-reloading.

1. **One-time Setup**:
   ```powershell
   cd monorepo
   npm install
   ```

2. **Start All Services**:
   ```powershell
   npm run dev
   ```

- **Hot-Reloading**: Python services (`api` and `simulator`) will automatically restart when `.py` or `.json` files are modified.
- **Unified Logging**: All logs are color-coded in one terminal window.

---

## 5. Troubleshooting

| Issue | Solution |
|-------|----------|
| **Red "Unavailable" Services** | Ensure you are NOT running the `api` or `chatbot` Docker containers. Run `docker stop hpe_san_api hpe_chatbot`. |
| **Elasticsearch 400 Error** | Ensure you have `elasticsearch<9.0` installed. Run `pip install "elasticsearch<9.0"`. |
| **Discovery Seed IP fails** | Ensure the Simulator is running on port `5001`. The default seed is `10.20.10.5`. |
| **Chatbot logic errors** | Check the `.env` file in the monorepo root; the chatbot-service loads config from there. |

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
