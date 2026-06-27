"""Factory that wires the LangGraph SAN autonomous agent to this repo's tools/stores."""

from __future__ import annotations

import os
from typing import Any, Callable, Dict, Optional

from discovery.crawler import HPE_COMMANDS
from discovery.parsers.sim_parser import parse_sim_array_output
from discovery.neo4j_store import Neo4jStore
from discovery.mongo_store import MongoStore

from integrations.neo4j_runner import run_cypher as neo4j_run_cypher

from .san_autonomous_agent_graph import Neo4jCypherTool, SSHOpsTool, SanAutonomousAgentGraph


def build_san_autonomous_agent_graph(
    *,
    neo4j_store: Neo4jStore,
    mongo_store: Optional[MongoStore],
    llm_call: Callable[..., Any],
    list_arrays_fn: Callable[[], list[dict]],
    virtual_network_exec_fn: Callable[[str, str], str],
    ssh_connector_factory: Callable[..., Any],
    ssh_credentials_resolver: Optional[Callable[[str], Optional[dict]]] = None,
    allowed_commands: Optional[set[str]] = None,
) -> SanAutonomousAgentGraph:

    allowed = allowed_commands or (set(HPE_COMMANDS) | {"showversion -b", "showportdev", "cli checkhealth"})

    neo4j_tool = Neo4jCypherTool(
        neo4j_store=neo4j_store,
        run_cypher_fn=lambda cypher, params=None: neo4j_run_cypher(neo4j_store, cypher, params=params),
    )

    ssh_tool = SSHOpsTool(
        ssh_connector_factory=ssh_connector_factory,
        ssh_credentials_resolver=ssh_credentials_resolver,
    )

    def persist_parsed_fn(parsed: dict) -> None:
        # parsed is expected to be the same schema as discovery parsers output.
        # Ensure required fields are present.
        if mongo_store and getattr(mongo_store, "available", False):
            mongo_store.store(parsed)
        if getattr(neo4j_store, "available", False):
            neo4j_store.store(parsed)

    return SanAutonomousAgentGraph(
        llm_call=llm_call,
        rag_engine=None,
        list_arrays_fn=list_arrays_fn,
        parse_array_outputs_fn=parse_sim_array_output,
        persist_parsed_fn=persist_parsed_fn,
        neo4j_cypher_tool=neo4j_tool,
        ssh_ops_tool=ssh_tool,
        simulator_exec_fn=virtual_network_exec_fn,
        allowed_commands=allowed,
        max_reflect_rounds=4,
    )

