"""SAN tool adapters for the LangGraph/LangChain SAN autonomous agent.

This module provides small adapters that plug the agent's tool interface into
existing repo components:
- SSH operations tool: use existing /api/ssh/exec or connector layer.
- Simulator command tool: use virtual_network.execute.
- Neo4j Cypher tool: run read-only cypher through neo4j_store.

These are used by san_autonomous_agent_factory and/or san_autonomous_agent_graph.
"""

from __future__ import annotations

from typing import Any, Callable, Optional


def make_neo4j_readonly_cypher_tool(neo4j_store: Any, neo4j_run_cypher_fn: Callable[[str, Optional[dict]], list[dict]]):
    # Backwards-compatible helper: factory directly instantiates Neo4jCypherTool.
    # This file is kept for future extension.
    return {
        "neo4j_store": neo4j_store,
        "neo4j_run_cypher_fn": neo4j_run_cypher_fn,
    }

