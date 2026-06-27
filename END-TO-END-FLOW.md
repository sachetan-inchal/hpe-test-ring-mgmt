# End-to-end flow
## 1) Discovery + crawler flow (how it finds devices, runs commands, parses, stores)

### 1.1 Entry points (HTTP → crawler thread)

From `api/app.py`:

-   `POST /api/discover`
    
    -   Reads  `seed_ips`  /  `seed_ip`
    -   Starts a background thread calling:
        -   `discovery_crawler.discover(seed_ips, delay_ms=..., commands=...)`
-   `GET /api/discover/stream`
    
    -   Opens an SSE stream that repeatedly yields queued events from:
        -   `discovery_crawler.events`
-   `POST /api/discover/cancel`
    
    -   Calls  `discovery_crawler.cancel()`

So the browser never directly “executes” discovery; it just receives streamed events.

----------

### 1.2 BFS traversal: what the crawler does per IP

In `discovery/crawler.py`, `DiscoveryCrawler.discover()` does:

1.  Initialize state:
    
    -   `self.queue = deque(seed_ips)`
    -   `self.visited = set()`
    -   `self.events = []`
2.  (Optional) If Mongo is available:
    
    -   `self.mongo.load_existing_state()`
3.  BFS loop:
    
    -   pop IP from queue
    -   skip if already visited
    -   call  `self._discover_device(ip)`
4.  When queue empty or cancelled:
    
    -   if it was running, it calls:
        -   `self.mongo.prune_and_sync_final_state()`  (only if Mongo available)
    -   emits a  `complete`  SSE event

----------

### 1.3 How it connects to devices (real SSH vs simulated terminal)

Inside `_discover_device(ip)`:

#### A) Try SSH credentials from Mongo (real SSH path)

-   `_get_ssh_connector(ip)`
    
    -   fetches document from Mongo:
        -   `db.ssh_credentials.find_one({"ip": ip})`
    -   decrypts password using XOR with  `SECRET_ENCRYPTION_KEY`
    -   builds  `SSHConnector(host=ip, username=..., password=..., port=...)`
-   If it can connect:
    
    -   Fingerprints via CLI probes:
        -   `showsys`  (detect HPE array if stdout contains expected keys)
        -   else  `uname -a`  (Linux)
        -   else  `Get-ComputerInfo`  (Windows)
    -   Also runs  `hostname`
    -   disconnects

#### B) If SSH fails: use simulator (virtual_network)

-   `virtual_network.connect(ip)`  to create a “terminal”
-   `dev_type = fingerprint_device(ip, virtual_network)`
-   `meta = virtual_network.get_metadata(ip)`  for device name

> For your “static replay data” question: **real SSH isn’t required** for discovery in this repo; the simulator path is where “replay files” are used.

----------

### 1.4 How “static replay data” is served for commands

There are two different “command execution” layers in the repo:

#### Simulator execution (used by crawler in sim mode)

-   `terminal.execute(cmd)`  (from  `simulator/network_sim.py`, not shown above)
-   That simulator uses  `simulator/mock_ssh_replay.py`  / replay datasets.

#### Non-LLM “CLI replay engine” (monorepo proxy, used elsewhere)

-   `api/master_logic/proxy.py`  provides:
    -   `get_command_output(device_file, command_name)`
    -   `DEVICE_REGISTRY`  mapping IP →  `*.txt`
    -   Command outputs are returned from  `simulator/data/devices/<file>.txt`

This “proxy replay” engine is used by **API endpoints** and **log ingest parsing**, not by the discovery crawler’s simulator terminal call (crawler uses `virtual_network.connect()` + `terminal.execute()`).

So:

-   **Discovery crawler**  gets replay output via  **simulator terminal**  path.
-   **/api/v1/san/cli/exec**  and  `/api/v1/san/cli/connect`  use  **master_logic/proxy.py**  replay files.

----------

### 1.5 Command checklist & output collection

In `discovery/crawler.py::_run_commands()`:

-   For SSH: loops through commands, runs  `ssh_connector.execute(cmd)`, concatenates stdout+stderr.
-   For simulator: loops through commands and uses  `terminal.execute(cmd)`.

`HPE_COMMANDS` includes:

-   `showsys`,  `shownode`,  `showport`,  `showswitch`,  `showhost`,  `showcage...`,  `showpd...`, etc.

Outputs are collected as:

-   `outputs[cmd] = output_text`

----------

### 1.6 Parsing: how raw outputs become structured JSON

Back in `_discover_device(ip)`:

-   For HPE arrays:
    
    -   `parsed = parse_sim_array_output(raw_outputs)`  (imported from  `discovery/parsers/sim_parser.py`)
    -   then sets:
        -   `parsed["_ip"] = ip`
        -   `parsed["_device_type"] = "hpe_array"`
-   For Linux/Windows:
    
    -   `parse_linux_output(...)`  or  `parse_windows_output(...)`

Then crawler extracts next IP targets:

-   `new_ips = self._extract_linked_ips(parsed)`

----------

### 1.7 How it decides what to visit next (BFS expansion)

In `_extract_linked_ips()`:

1.  Peer arrays via simulator metadata:
    
    -   `array_meta.get("connected_to", [])`
2.  Additionally: it finds devices in the simulator whose `parent_array` matches the array name.
    

Then it enqueues any `new_ip` not visited yet.

----------

## 2) How parsed data is stored (Mongo + Neo4j) and whether it’s “updated/replaced”

### 2.1 Neo4j writing: full overwrite per array/host

In `discovery/neo4j_store.py` method `store(parsed)`:

#### For arrays (`_device_type == "hpe_array"`):

-   It executes a “wipe old elements for that array IP” query before inserting new nodes:
    -   finds  `(a:ArraySystem {ip_address: $ip})`
    -   `OPTIONAL MATCH`es all related Node/Port/Cage/PhysicalDisk/CageSlot
    -   `DETACH DELETE`  them all
-   Then repopulates with MERGE.

#### For Linux/Windows hosts:

-   It wipes the host disk + host nodes:
    -   `MATCH (h:Host {ip_address: $ip}) ... DETACH DELETE pd, h`
-   Then repopulates.

**So Neo4j is effectively “replaced/overwritten per device anchor”** (by ip_address for arrays & hosts, and by serial uniqueness for disks).

----------

### 2.2 Mongo writing: it builds an in-memory graph and replaces the single “sandatas” document

In `discovery/mongo_store.py`:

-   `MongoStore.store(parsed)`  routes to  `_store_array()`  /  `_store_host()`
-   Those methods  **add/overwrite entries in in-memory dicts**:
    -   `self.nodes[<id>] = node_object`
    -   `self.edges.add((from, to, label))`
-   Then it calls  `_sync_to_db()`  which does:

`self.db.sandatas.replace_one({}, doc, upsert=True)`

So there is a single document (collection probably has one doc) representing:

-   `nodes: [...]`
-   `edges: [...]`

#### Is it updated / replaced with latest data?

Yes:

-   For each discovery run, it rebuilds nodes/edges for discovered entities.
-   After completion, it calls  `prune_and_sync_final_state()`:
    -   it marks dynamically crawled nodes not present in current run as offline, or deletes some depending on parent relationship.
-   Finally it writes the whole “sandatas” doc again via replace.

So Mongo is **not incremental per entity** during the run; it’s a **run-reconciliation + replace-one** approach.

----------

## 3) How parsed JSON is used in “RAG” modes (standard + GraphRAG)

### 3.1 What data “feeds” standard RAG?

`api/integrations/rag_engine.py`:

-   `standard_rag()`  loads:
    -   `all_data = self.json_store.load_all()`

`json_store` is based on `data/json_store/` and/or ingest pipeline outputs (not the crawler’s Mongo data directly).

So standard RAG uses:

-   static JSON summaries in  `data/json_store/*.json`

### 3.2 What data “feeds” GraphRAG?

`graph_rag()` does not use json_store primarily; it uses:

-   `self.neo4j_loader`  which is created in  `api/app.py`  as:
    -   `_Neo4jRagBridge().run_cypher(...)`
    -   which calls  `neo4j_run_cypher(neo4j, query, params)`

So GraphRAG uses:

-   **Neo4j discovery graph**  created by discovery/storage/ingest.

----------

## 4) GraphRAG mode: can it ingest natural language, compile to a “neo4j cipher”, execute, and return an answer?

Yes—based on `RAGEngine.graph_rag()` in `api/integrations/rag_engine.py`.

### 4.1 Step-by-step GraphRAG call flow (per user request)

In `graph_rag(user_query)`:

1.  Build a system prompt containing the schema (`NEO4J_SCHEMA`)
2.  LLM call (LLM produces Cypher):
    -   `_llm_call(..., system_prompt=..., user_prompt=query, temperature=0.0)`
    -   instruction: “Return ONLY the Cypher query”
3.  Post-process:
    -   strips  `<think>...</think>`
    -   strips backticks/markdown fences
4.  Execute the Cypher:
    -   `results = self.neo4j_loader.run_cypher(cypher)`
5.  Synthesize a human answer:
    -   LLM call again with:
        -   `Question: ...`
        -   `Query Results: <json of results>`
6.  Return:
    -   `cypher`,  `results_count`,  `raw_results`,  `answer`

### 4.2 How many “api calls so far” are used for GraphRAG?

GraphRAG, as implemented:

-   **Call #1:**  LLM generates Cypher
-   **Call #2:**  LLM synthesizes answer from Cypher results

Additionally, there is a non-LLM call:

-   **Neo4j execution**  (`run_cypher`) happens between them.

So your “GraphRAG [1 api calls so far]” / “[2 api calls so far for graphrag]” aligns with the implementation: **2 LLM calls per request** (plus 1 Neo4j call).

----------

## 5) Important nuance: “static replay data” vs “graph ingestion”

Your question mentions “static replay data” and “commands responding with static replay data”.

In this repo, there are two separate pathways:

1.  **Discovery**:
    
    -   Uses simulator terminal (replay dataset) OR SSH.
    -   Produces parsed JSON.
    -   Writes into Neo4j + Mongo.
2.  **GraphRAG**:
    
    -   Reads from  **Neo4j**, not from the replay files directly.
    -   Therefore: GraphRAG “implicitly ingests replay data”  _only to the extent that discovery/ingest has already written it into Neo4j_.

If Neo4j was never populated (or hasn’t been updated after new replay logs), GraphRAG will answer from whatever Neo4j currently contains.

----------

## 6) Do Mongo + Neo4j get “latest data” on subsequent discovery runs?

-   Neo4j:  **yes**, per anchor wipe/overwrite per IP for arrays/hosts.
-   Mongo:  **yes**, via rebuilding reconciliation and replacing the single  `sandatas`  document; also prune/offline logic at the end.

So the storage is “refreshed” rather than “appended forever”.



# TL-DR

-   HTTP /api/discover starts a background thread running discovery_crawler.discover(seed_ips).
    
-   The crawler does BFS over IPs: queue pop → fingerprint/connect (SSH from Mongo creds or simulator via virtual_network.connect) → run a command checklist per device → collect stdout+stderr → parse into structured dict via parse_sim_array_output/parse_linux_output/parse_windows_output → compute next IPs from simulator metadata/parent_array relationships → persist.
    
-   Persistence: Neo4jStore.store() overwrites per-device: it wipes old ArraySystem/Host subgraphs anchored by ip_address, then MERGE-recreates nodes/relationships. MongoStore.store() rebuilds an in-memory nodes/edges graph for the run and then replace_one({}, doc, upsert=True) into sandatas; prune_and_sync_final_state() reconciles missing dynamic nodes after completion.
    

Command “static replay”:

-   Discovery’s simulator path uses terminal.execute(cmd) which is backed by the simulator replay datasets.
    
-   Separately, master_logic/proxy.py implements replay-from-_.txt (DEVICE_REGISTRY mapping IP→txt) used by CLI endpoints /api/v1/san/cli/_ and log parsing/ingest, not the BFS crawler terminal path.
    

RAG / GraphRAG:

-   Standard RAG uses json_store.load_all() (static JSON under data/json_store).
    
-   GraphRAG uses Neo4j graph data through a Neo4j cypher runner.
    
-   GraphRAG natural language capability: yes. For each request it does:
    

1.  LLM call #1 generates a Cypher query from the natural language using NEO4J_SCHEMA.
    
2.  Neo4j executes that Cypher.
    
3.  LLM call #2 synthesizes a natural-language answer from the Cypher results.
    

-   It also returns the generated cypher and raw results.
    

Update behavior:

-   Neo4j is effectively replaced/overwritten per discovery anchor (ArraySystem ip_address for arrays, Host ip_address for hosts) before reinserting.
    
-   Mongo is replaced as a single sandatas document per discovery run, with prune/offline reconciliation at the end.","command":"curl -X POST http://localhost:5005/api/v1/san/discovery/start -H "Content-Type: application/json" -d "{"seed_ips":["10.20.10.5"]}"