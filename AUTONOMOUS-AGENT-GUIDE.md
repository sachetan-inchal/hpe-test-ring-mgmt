# AUTONOMOUS-AGENT-GUIDE (SAN LangGraph / LangChain)

## Purpose
This repo includes a **SAN autonomous agent** implemented as a **LangGraph-style state machine**. It can:
- resolve a target **ArraySystem** (optional `array` hint / best-effort matching)
- plan safe CLI commands
- execute commands using either:
  - real SSH (when credentials exist) **or**
  - simulated/replay execution (via existing simulator connectors)
- parse command outputs using the **existing parsers**
- refresh **Neo4j + Mongo** by reusing the discovery store mechanisms
- optionally run a **Neo4j read-only Cypher** query and synthesize a final natural-language answer

## UI: Autonomous Agent page (React)
Route: **`/autonomous-agent`**
- File: `dashboard/src/pages/SANAutonomousAgentPage.jsx`
- It streams execution steps via SSE from the backend endpoint:
  - **GET** `/api/agent/run/stream`

## Backend: SSE execution endpoint
The dashboard expects **SSE streaming** where each event is JSON in the shape:
- `{ type: "step", step: <string> }`
- `{ type: "synthesis", content: <string>, is_think: <boolean> }`
- final event: `{ type: "final", result: <object> }`
- optional error/cancel events: `{ type: "error", error: <string> }` or `{ type: "cancelled" }`

### Request
`/api/agent/run/stream?query=<natural language>&array=<optional array hint>`

Example:
- `GET /api/agent/run/stream?query=status of array <array name>&array=<array hint>`

### What happens internally
1. Agent starts and emits step events.
2. Agent may execute multiple CLI commands (SSH or simulator).
3. Agent parses evidence using existing parsers.
4. Agent persists parsed evidence (Neo4j + Mongo) through existing store logic.
5. Agent decides whether a Cypher query is needed; if so it runs **read-only** Cypher.
6. Agent synthesizes a final answer (markdown/text) and the SSE stream finishes with `type: final`.

## Tools available to the agent
### 1) SSH Operations tool (connect + exec)
- Connects to a device using the repo’s existing connector abstraction.
- Command execution is routed through `api/integrations/device_connector.py` (SSHConnector / SimulatorConnector).

**Credential lookup**:
- If username/password are not supplied by the caller, the agent execution layer can resolve credentials from Mongo (`db.ssh_credentials`) using the same credential mechanism used elsewhere in the repo.

### 2) Neo4j Cypher tool (read-only)
- Executes a **read-only** Cypher query (the tool enforces a “no write” guard).
- Returned rows are used as evidence for final response synthesis.

### 3) Simulator exec tool (optional)
- When SSH is unavailable or when the system is configured to use replay data, commands are executed against the simulator/replay datasets.

## How to ensure the “latest data” behavior
- Discovery + storage are designed to **overwrite/refresh** per device anchor:
  - Neo4j: wipes subgraph anchored by `ip_address` (arrays/hosts) then recreates
  - Mongo: replaces the single `sandatas` doc for reconciliation, and prunes/offlines missing nodes
- Therefore, after an agent run that executes the relevant CLI commands and stores parsed output, Neo4j/Mongo should reflect the newest parsed results.

## Scratchpad / hallucination-proofing
The autonomous agent implementation uses an internal **scratchpad list** of structured events (plan/exec/reflect/cypher synthesis metadata). This reduces hallucination risk by ensuring the synthesizer uses:
- parsed evidence (structured JSON)
- (optional) Neo4j query rows
- executed command list + partial output summaries

## Deployment / configuration notes
- Ensure the backend Flask server is running.
- Ensure Neo4j is reachable (`Neo4jStore.available == True`).
- For real SSH:
  - Mongo `ssh_credentials` must contain entries for the relevant IPs
  - password encryption uses `SECRET_ENCRYPTION_KEY` from environment

## Troubleshooting checklist
1. **UI shows no steps**:
   - confirm backend SSE endpoint is reachable:
     - `GET /api/agent/run/stream?query=test`
2. **Agent cannot execute commands**:
   - check whether simulator mode is active vs SSH mode
   - check Mongo credentials exist for the resolved device IPs
3. **Agent answers but is incomplete**:
   - the agent reflector may need more rounds (`max_reflect_rounds`)
   - consider providing a more specific `array` hint in the UI query
