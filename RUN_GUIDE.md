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

### Option A: Running via Docker (Recommended)

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

---

### Option B: Running without Docker (Neo4j Desktop & MongoDB Desktop)

If you prefer to run the databases locally without Docker:

1. **MongoDB Desktop / Compass**:
   - Download and install [MongoDB Community Server](https://www.mongodb.com/try/download/community) and [MongoDB Compass](https://www.mongodb.com/products/tools/compass).
   - Start the local MongoDB service. It will run on `mongodb://localhost:27017` by default with no authentication required.
   - This matches the default `MONGO_URI` in `.env`.

2. **Neo4j Desktop**:
   - Download and install [Neo4j Desktop](https://neo4j.com/download/).
   - Create a new Local DBMS (version 5.x or 4.x).
   - Set a password (e.g., `password`).
   - Start the DBMS. It will listen on `bolt://localhost:7687` by default.
   - Update `NEO4J_PASS` in your `.env` file to match this password.

3. **Elasticsearch (Optional)**:
   - You do not need to run Elasticsearch. The application automatically detects if Elasticsearch is offline, marks it as `"unavailable"` in the health dashboard, and gracefully bypasses search indexing. You can install it later if needed.

## 3. Application Execution

### The Easy Way (One-Command Startup)
This is the recommended way for daily development. It starts Docker, watches for file changes, and runs everything in one terminal.

```powershell
# In the monorepo root
npm install
npm start
```

### The Manual Way (Separate Terminals)
Use this if you need to debug a specific component.

1. **Start Databases**: `docker-compose up -d neo4j elasticsearch mongo`
2. **Simulator**: `py simulator/simulator_manager.py`
3. **API**: `py api/app.py`
4. **Chatbot**: `cd chatbot-service && npm run dev`
5. **Dashboard**: `cd dashboard && npm run dev`

### D. API Explorer (Port 5005)
The Master API now includes a built-in interactive developer tool:
- **URL (API Explorer)**: [http://localhost:5005/tester](http://localhost:5005/tester)
- **URL (Standalone Terminal)**: [http://localhost:5005/terminal](http://localhost:5005/terminal)

---

## 4. Troubleshooting

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
