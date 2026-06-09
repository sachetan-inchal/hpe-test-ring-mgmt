# HPE SAN Test Ring Management — Teammate Handover Manual
## Transitioning from Mock Web-App to Proof-of-Concept Prototype

Hey Team! This manual explains how we are migrating our project from a **dummy web-app simulation** into a functional **Proof-of-Concept (PoC) Prototype** for our internal HPE presentation on **Friday, June 12th**.

All code changes have been committed and pushed to the new **`prototype`** branch on GitHub. Please check out this branch before continuing:
```bash
git fetch origin
git checkout prototype
```

---

## 1. The Core Shift: Mockup vs. Prototype

```
+------------------------------------+      +------------------------------------+
|         OLD MOCKUP STAGE           |      |        NEW PROTOTYPE STAGE         |
+------------------------------------+      +------------------------------------+
| - Hardcoded topology diagrams.     |      | - Live BFS crawl starting from IPs.|
| - In-process simulator loops.      | ---> | - Real SSH connections (Paramiko). |
| - Dummy text terminal sessions.   |      | - ML-parsed logs (MiniLM NER).     |
| - Unsecured, single-user setup.    |      | - Persistent DB stores (Mongo/Neo).|
+------------------------------------+      +------------------------------------+
```

Instead of displaying static mockups, the application now **actually SSHs** into target systems, runs commands like `showsys`, parses the output tables, stores the relationships in Neo4j/MongoDB, and runs diagnostics using an AI chatbot engine.

---

## 2. Worklet Handover Guides

We have divided the remaining tasks into **4 independent worklets** so that everyone can develop and test their components in parallel.

### 💻 Worklet 1: SSH Replay & Compatibility (Owner: Sachetan)
**Objective**: Build a mock replay agent to run on college test computers so we can simulate storage arrays without physical hardware.
*   **What was implemented**:
    - [mock_ssh_replay.py](file:///c:/Users/isach/OneDrive/Documents/HPEFINALSCHEMA/monorepo/simulator/mock_ssh_replay.py): A script that intercepts commands and prints captured console outputs from real HPE arrays.
    - **Read-Only Mode**: A security middleware in `app.py` that blocks mutating actions (POST/PATCH/DELETE) if the request comes from an external network IP.
*   **Your Next Steps**:
    1. Copy `mock_ssh_replay.py` onto your old RHEL laptop.
    2. Add alias scripts for array commands in `/usr/local/bin` (e.g. symlink `showsys` and `shownode` to `mock_ssh_replay.py`).
    3. Verify that external users accessing the app via the server's IP address cannot delete or modify elements.

---

### 🧠 Worklet 2: NLP Log Classifier & Ingestion (Owner: Samarth)
**Objective**: Extract device names from unstructured logs (`m1-m4`) using a local transformer model and build a Master Index.
*   **What was implemented**:
    - [ml_extractor.py](file:///c:/Users/isach/OneDrive/Documents/HPEFINALSCHEMA/monorepo/api/integrations/ml_extractor.py): Instantiates a 150MB MiniLM model (`all-MiniLM-L6-v2`) locally. To prevent slow performance, a token caching mechanism was implemented.
    - [scan_logs.py](file:///c:/Users/isach/OneDrive/Documents/HPEFINALSCHEMA/monorepo/api/integrations/scan_logs.py): Scans the logs, filters tokens, runs the classifier, and saves the outputs to [master_index.json](file:///c:/Users/isach/OneDrive/Documents/HPEFINALSCHEMA/monorepo/data/master_index.json).
*   **Your Next Steps**:
    1. Run `pip install sentence-transformers` on your machine.
    2. Run `python api/integrations/scan_logs.py` to index the files.
    3. Verify that the output lists hosts, switches, and arrays. Extend the regex heuristics in `ml_extractor.py` if new device name formats are introduced.

---

### ⚙️ Worklet 3: Scheduled Discovery & Diagnostics (Owner: Unmesh)
**Objective**: Run automated crawler scans daily and create a diagnostic health report for degraded systems.
*   **What was implemented**:
    - **Clean Overwrite**: Modified `Neo4jStore.store` in [neo4j_store.py](file:///c:/Users/isach/OneDrive/Documents/HPEFINALSCHEMA/monorepo/discovery/neo4j_store.py) to detach-delete old node data for an IP before inserting updated properties.
    - **Scheduler Daemon**: Spawns a background thread in `app.py` that runs the BFS crawler once every 24 hours.
    - [diagnostics.py](file:///c:/Users/isach/OneDrive/Documents/HPEFINALSCHEMA/monorepo/api/integrations/diagnostics.py): A module that parses device failure status codes and uses the LLM to output a troubleshooting report. Exposes the route `GET /api/diagnostics/report`.
*   **Your Next Steps**:
    1. Start the Flask API and call `curl http://localhost:5005/api/diagnostics/report`.
    2. Verify it lists degraded devices (such as port link losses or disk failures) and generates automated diagnostic recommendations.

---

### 🔑 Worklet 4: SSH Credential Management & Chatbot (Owner: Preetham)
**Objective**: Securely save passwords in MongoDB and prompt users dynamically when connections fail.
*   **What was implemented**:
    - **Symmetric Encryption**: Added XOR-base64 encryption helper methods in `app.py`.
    - **Credential Store APIs**: Created `/api/credentials/save` and `/api/credentials/status/<ip>` routes.
    - **Prompt Fallback**: The connection executor dynamically fetches credentials from MongoDB during crawls. If a connection fails, it emits an `auth_failed` SSE event to open a prompt modal in the frontend dashboard.
    - **Mentor slides**: Created [llm_justification_slide.md](file:///C:/Users/isach/.gemini/antigravity-ide/brain/270bf808-a63a-4f08-86d8-4362a70713de/llm_justification_slide.md).
*   **Your Next Steps**:
    1. Connect the React dashboard's terminal login screen to the `/api/credentials/save` endpoint.
    2. Add an event listener to the `/api/discover/stream` SSE channel to display a password modal when an `auth_failed` type event is received.
    3. Include the slide contents from `llm_justification_slide.md` in our project presentation deck.

---

## 3. How to Deploy & Verify on the College RHEL Server

When deploying the monorepo on the college machine:

1.  **Configure Network Binding**:
    - The Flask backend in `api/app.py` is configured to bind to `0.0.0.0`.
    - The Node.js chatbot service in `chatbot-service/server.js` binds to `0.0.0.0:5010`.
    - In `dashboard/vite.config.js`, update the proxy to target the server's LAN IP address.

2.  **Launch Databases and Services**:
    ```bash
    # Start Docker databases
    docker-compose up -d neo4j elasticsearch mongo
    
    # Launch backends
    python api/app.py &
    cd chatbot-service && npm run dev &
    ```

3.  **Verify Accessibility**:
    - Open a browser on another computer on the same network and navigate to `http://<RHEL_SERVER_IP>:3000`.
    - Open the Discovery tab, input a seed IP, and click **Start Discovery**.
    - If the target host has no credentials, verify that the dashboard prompts you with a password input modal.
