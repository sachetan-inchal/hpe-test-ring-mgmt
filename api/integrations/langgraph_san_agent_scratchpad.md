# SAN Autonomous Agent Scratchpad

This file documents the scratchpad schema used by `san_autonomous_agent_graph.py`.

Scratchpad entries are append-only and structured as JSON objects:

- `{"phase": "plan", "plan": <planner_json>}`
- `{"phase": "exec", "command": <cli_cmd>, "chars": <len>}`
- `{"phase": "exec_error", "command": <cli_cmd>, "error": <str>}`
- `{"phase": "parse_error", "error": <str>}`
- `{"phase": "persist_error", "error": <str>}`
- `{"phase": "reflect", "decision": <reflect_json>}`
- `{"phase": "cypher", "rows": <int>}`
- `{"phase": "cypher_error", "error": <str>}`

