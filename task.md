# HPE SAN Monorepo — Full Integration Tasks

## Phase 1: Infrastructure & Backend
- [/] Update docker-compose.yml (add MongoDB)
- [/] Update .env / .env.example with all keys
- [ ] Copy & adapt Node.js chatbot service (Preetham's backend → monorepo/chatbot-service/)
- [x] Port Unmesh's topology CRUD + ontology engine into Flask API
- [x] Add SAN Fake Data Generator endpoint
- [x] Add import/export configuration endpoints
- [ ] Enhance RAG engine with dual mode (Standard RAG + GraphRAG)
- [x] Update requirements.txt

## Phase 2: React Dashboard — Foundation
- [ ] Update package.json with new dependencies
- [ ] Create HPE-themed design system (index.css)
- [ ] Create App shell with tab navigation + routing
- [ ] Create Login page (port from Preetham)
- [ ] Create Auth context + Toast context
- [ ] Update vite.config.js with chatbot proxy

## Phase 3: React Dashboard — Tab Pages
- [ ] Discovery Page (fix canvas, faster discovery speed)
- [ ] Topology Page (port Unmesh's SAN diagram, NodeCard, etc.)
- [ ] Emulator Page (terminal + CLI execution)
- [ ] AI Chat Page (full-page chat, RadialMenu, dual AI modes)
- [x] Admin Page (device CRUD, field schema, CSV ingest, data faker, import/export)
- [ ] Health Page (system health, capacity, recommendations)

## Phase 4: Verification
- [x] Build dashboard (npm run build)
- [x] Test all API endpoints
- [ ] Update RUN_GUIDE.md
