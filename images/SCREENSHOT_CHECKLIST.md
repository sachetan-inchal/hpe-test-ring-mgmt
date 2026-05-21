# Screenshot & Asset Checklist — Official Documentation

## Captured (wired into `official_documentation.tex`)

| File | Used in doc |
|------|-------------|
| `Sign-up.png` | Authentication |
| `discovery-tab-fullscreen.png` | Discovery tab |
| `test-ring-viewer-tab.png` | Test Ring Viewer |
| `inventory-tab.png` | Inventory |
| `terminal-simulator-tab.png` | Emulator |
| `radial-quick-query-menu.png` | AI Assistant |
| `chatbot-san-agent-demo-query.png` | AI Assistant |
| `neo4j-powered-chatbot.png` | AI Assistant |
| `list-of-services-from-health-tab.png` | Health |

---

## Still optional (not yet in PDF)

Save all captures as **PNG** (recommended) or **JPEG** under `images/` using the exact filenames below. Use **1920×1080** or your monitor’s native resolution; crop to the relevant UI (no personal bookmarks/toolbars if possible).

**Before you shoot:** run the full stack (`npm start` + Docker databases) so every tab shows live data.

---

## A. Branding & Title Page

| # | Filename | What to capture |
|---|----------|-----------------|
| A1 | `hpe_logo.png` | Official HPE logo (already referenced on title page) |

---

## B. Setup & Infrastructure (Terminal / Docker / Browser)

| # | Filename | Software | What to capture |
|---|----------|----------|-----------------|
| B1 | `setup_prerequisites.png` | Windows Settings or `py --version`, `node -v`, `docker --version` | All four prerequisites visible in one terminal or collage |
| B2 | `setup_env_file.png` | VS Code / Notepad | `.env` in monorepo root with keys listed (blur/redact real API keys) |
| B3 | `setup_docker_compose.png` | PowerShell in `monorepo/` | `docker-compose up -d neo4j elasticsearch mongo` and success output |
| B4 | `setup_docker_desktop.png` | Docker Desktop | Containers `hpe_neo4j`, `hpe_elasticsearch`, `hpe_mongo` running (green) |
| B5 | `setup_npm_start.png` | PowerShell in monorepo root | `npm install` then `npm start` — show concurrently starting simulator, API, chatbot, dashboard |
| B6 | `setup_manual_terminals.png` | 4–5 terminal windows (optional) | Manual startup: simulator, `py api/app.py`, chatbot `npm run dev`, dashboard `npm run dev` |
| B7 | `infra_neo4j_browser.png` | Browser `http://localhost:7474` | Neo4j Browser logged in; run `MATCH (n) RETURN n LIMIT 25` with graph visible |
| B8 | `infra_elasticsearch.png` | Browser `http://localhost:9200` | Elasticsearch cluster JSON (`"status":"green"` or similar) |
| B9 | `infra_mongo_compass.png` | MongoDB Compass (optional) or `mongosh` | `hpe_san` DB with users/chats collections |
| B10 | `api_explorer_tester.png` | Browser `http://localhost:5005/tester` | Flask API Explorer / interactive tester |
| B11 | `api_standalone_terminal.png` | Browser `http://localhost:5005/terminal` | Standalone browser terminal page |

---

## C. Dashboard — Shell & Navigation

| # | Filename | What to capture |
|---|----------|-----------------|
| C1 | `dashboard_login.png` | Login page (`/login`) — HPE branding, username/password fields |
| C2 | `dashboard_sidebar_full.png` | After login: full sidebar with all nav items (Discovery, Test Ring Viewer, Inventory, Emulator, AI Assistant, Admin, Health) |
| C3 | `dashboard_status_bar.png` | Bottom status bar on any page showing API/simulator/chatbot health (green indicators) |
| C4 | `dashboard_global_search.png` | Top search bar with a sample query and results dropdown (if enabled) |

---

## D. Discovery Tab (`/discovery`)

| # | Filename | What to capture |
|---|----------|-----------------|
| D1 | `discovery_overview.png` | Full Discovery page — graph view with nodes after a completed scan |
| D2 | `discovery_panel_start.png` | Discovery panel open: seed IP `10.20.10.5`, **Start Discovery** button visible |
| D3 | `discovery_running_events.png` | Discovery **running** — live event log / stream updating |
| D4 | `discovery_neural_view.png` | Toggle to **Neural** view mode (if different from graph) |
| D5 | `discovery_result_grid.png` | Result grid / table of discovered devices |
| D6 | `discovery_node_selected.png` | Click a node — sidebar/card with device metadata |
| D7 | `discovery_embedded_terminal.png` | Open terminal on a discovered node — HPE or Linux CLI prompt |
| D8 | `discovery_aggregate_sidebar.png` | Aggregate sidebar with counts by device type |

---

## E. Test Ring Viewer / Topology (`/topology`)

| # | Filename | What to capture |
|---|----------|-----------------|
| E1 | `topology_san_diagram.png` | **SAN Diagram** tab — arrays, switches, hosts layout |
| E2 | `topology_canvas.png` | **Graph / Canvas** tab — React Flow topology with edges |
| E3 | `topology_node_focus.png` | Focus/highlight one array or host — connected path emphasized |
| E4 | `topology_node_card.png` | Node card detail panel (firmware, ports, team/cluster if shown) |
| E5 | `topology_decommission.png` | Decommission or selection UI (multi-select + action) |
| E6 | `topology_import_json.png` | Import topology JSON modal (if used) |
| E7 | `topology_export.png` | Download/export topology button or saved JSON snippet |

---

## F. Inventory Tab (`/inventory`)

| # | Filename | What to capture |
|---|----------|-----------------|
| F1 | `inventory_hierarchy_tree.png` | Hierarchy tree — arrays → nodes → disks |
| F2 | `inventory_path_highlight.png` | Click a path — highlighted chain between resources |
| F3 | `inventory_filters_search.png` | Search/filter narrowing the tree |

---

## G. Emulator Tab (`/emulator`)

| # | Filename | What to capture |
|---|----------|-----------------|
| G1 | `emulator_device_list.png` | Device picker / list of simulated endpoints |
| G2 | `emulator_terminal_hpe.png` | HPE array CLI — e.g. `showsystem`, `showport` output |
| G3 | `emulator_terminal_linux.png` | Linux host — `lsblk`, `multipath -ll`, or `ip addr` |
| G4 | `emulator_quick_commands.png` | Quick-command chips/buttons panel |

---

## H. AI Assistant Tab (`/chat`)

| # | Filename | What to capture |
|---|----------|-----------------|
| H1 | `chat_overview.png` | Full chat page with sidebar history |
| H2 | `chat_groq_response.png` | Sample SAN question + Groq engine response |
| H3 | `chat_gemini_response.png` | Same or different question with Gemini engine |
| H4 | `chat_agent_timeline.png` | Agent step timeline / reasoning sidebar during a query |
| H5 | `chat_radial_menu.png` | Suggested queries radial menu (if visible) |
| H6 | `chat_rag_context.png` | Response showing graph/search context or citations (if UI shows it) |

---

## I. Admin Tab (`/admin`) — admin user only

| # | Filename | What to capture |
|---|----------|-----------------|
| I1 | `admin_overview.png` | Full Admin page — all cards visible (scroll stitch if needed) |
| I2 | `admin_faker_generate.png` | SAN Fake Data Generator — config + **Generate Topology** success |
| I3 | `admin_faker_import_neo4j.png` | **Import to Neo4j** success message |
| I4 | `admin_add_node.png` | Add Node form — Host/Switch/Array selected + created confirmation |
| I5 | `admin_csv_ingest.png` | CSV/spreadsheet ingest upload + result |
| I6 | `admin_field_schema.png` | Field schema manager |
| I7 | `admin_delete_node.png` | Delete node confirmation (use test node ID) |

---

## J. Health Tab (`/health`)

| # | Filename | What to capture |
|---|----------|-----------------|
| J1 | `health_overview.png` | Stat cards: arrays, hosts, capacity, issues count |
| J2 | `health_service_badges.png` | Service badges — Flask, Neo4j, ES, Mongo, Chatbot all green |
| J3 | `health_capacity_bars.png` | Capacity utilization bars |
| J4 | `health_issues_investigate.png` | Issue row with **Investigate** → links to AI Assistant |

---

## K. Architecture Diagrams (draw or export)

These can be **diagrams** rather than screenshots:

| # | Filename | Suggested source |
|---|----------|------------------|
| K1 | `arch_high_level.png` | Draw.io / Excalidraw: Dashboard → Flask → Simulator / Neo4j / ES / Mongo / Chatbot |
| K2 | `arch_discovery_pipeline.png` | BFS flow: Seed → Fingerprint → Parse → Neo4j → Elasticsearch |
| K3 | `arch_rag_pipeline.png` | User query → ES + Neo4j → Groq/Gemini → Dashboard |

---

## L. Optional — Simulator & Discovery (backend)

| # | Filename | What to capture |
|---|----------|-----------------|
| L1 | `simulator_terminal_boot.png` | Terminal running `py simulator/simulator_manager.py` — devices listening |
| L2 | `discovery_logs_api.png` | API terminal showing discovery SSE or log lines |

---

## Recommended capture order

1. Start Docker → `npm start` → wait for all services green  
2. **Health** tab (proves stack is up)  
3. Run **Discovery** once → capture Discovery + Topology + Inventory  
4. **Emulator** CLI shots  
5. **AI Assistant** with both engines  
6. **Admin** (log in as admin)  
7. Infrastructure browsers (Neo4j, ES, API tester)  
8. Setup terminals (re-run commands for clean shots)

---

## Tips

- Use **light mode** or **dark mode** consistently across all UI shots (match dashboard default).  
- Hide OS notifications and close unrelated tabs.  
- Filename must match exactly — LaTeX uses `\screenshot{...}{filename}{...}`.  
- Rebuild in Overleaf with **XeLaTeX** after adding images.
