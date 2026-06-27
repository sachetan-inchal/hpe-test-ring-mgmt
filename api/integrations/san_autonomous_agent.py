"""Public entrypoint for the SAN autonomous LangGraph/LangChain agent.

This module wires the LangGraph graph (state machine) to existing repo stores
and connectors.

It intentionally mirrors the behavior of integrations/san_agent.py where
possible, but adds:
- explicit state-based looping (LangGraph)
- generic Neo4j Cypher read-only tool
- generic SSH operations tool (connect + exec)
- optional simulator execution
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from discovery.neo4j_store import Neo4jStore
from discovery.mongo_store import MongoStore
from integrations.neo4j_runner import run_cypher as neo4j_run_cypher
from integrations.rag_engine import RAGEngine

from .san_autonomous_agent_factory import build_san_autonomous_agent_graph


class SANAutonomousAgent:
    def __init__(
        self,
        *,
        neo4j_store: Neo4jStore,
        mongo_store: Optional[MongoStore],
        llm_call: Callable[..., Any],
        rag_engine: Optional[RAGEngine],
        list_arrays_fn: Callable[[], list[dict]],
        virtual_network_exec_fn: Callable[[str, str], str],
        ssh_connector_factory: Callable[..., Any],
        ssh_credentials_resolver: Optional[Callable[[str], Optional[dict]]] = None,
        allowed_commands: Optional[set[str]] = None,
    ):
        self.graph = build_san_autonomous_agent_graph(
            neo4j_store=neo4j_store,
            mongo_store=mongo_store,
            llm_call=llm_call,
            rag_engine=rag_engine,
            list_arrays_fn=list_arrays_fn,
            virtual_network_exec_fn=virtual_network_exec_fn,
            ssh_connector_factory=ssh_connector_factory,
            ssh_credentials_resolver=ssh_credentials_resolver,
            allowed_commands=allowed_commands,
        )

    def run(self, query: str, array_hint: Optional[str] = None) -> dict:
        return self.graph.run(query=query, array_hint=array_hint)

