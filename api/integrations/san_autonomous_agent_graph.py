"""LangChain/LangGraph based SAN autonomous agent.

This module ADDS a separate implementation (does not replace api/integrations/san_agent.py).

High-level design
------------------
- Uses a state machine (LangGraph) to run a multi-step loop:
  1) Parse NL query + resolve target array(s)
  2) Plan required CLI commands
  3) Execute CLI commands (SSH-capable tool; simulator supported via existing connectors)
  4) Parse outputs via existing parsers
  5) Write/refresh parsed JSON into Neo4j + Mongo
  6) Decide if graph query (Cypher) is needed for the remaining part
  7) Use Cypher tool, then synthesize final answer
  8) Terminate only when enough evidence is gathered.

Tools provided
--------------
- Neo4j Cypher tool: runs validated Cypher against existing Neo4j store.
- SSH Operations tool: generic connect/exec wrapper (uses existing connectors layer).
- Simulator CLI tool (optional): uses virtual_network execute for replay datasets.

Notes
-----
- The repo already supports:
  - parsers in api/parsers/* and discovery/parsers/sim_parser.py
  - Neo4j ingestion in discovery/neo4j_store.py
  - Mongo ingestion in discovery/mongo_store.py

LangGraph state is kept small and uses scratchpad snippets for traceability.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

# Keep imports local to the monorepo's Python path configuration.
# api/app.py manipulates sys.path so `integrations.*` is resolvable at runtime.
try:
    from integrations.rag_engine import RAGEngine
except Exception:  # pragma: no cover
    RAGEngine = None


# Try to import langgraph/langchain. This repo may run without them; fall back gracefully.
try:
    from langgraph.graph import StateGraph, END  # type: ignore
    from langchain_core.messages import SystemMessage, HumanMessage  # type: ignore
    HAS_LANGCHAIN = True
except Exception:  # pragma: no cover
    HAS_LANGCHAIN = False


# ---------------------------
# Shared utilities / guards
# ---------------------------

FORBIDDEN_SHELL = re.compile(r"[|;&`$><]|\b(rm|sudo|curl|wget|bash|sh)\b", re.I)


def _validate_shell_command(cmd: str, allowlist: Optional[set[str]] = None) -> str:
    cmd = " ".join((cmd or "").strip().split())
    if not cmd:
        raise ValueError("Empty command")
    if FORBIDDEN_SHELL.search(cmd):
        raise ValueError("Command contains disallowed shell patterns")
    if allowlist is not None and len(allowlist) > 0:
        # exact match or prefix match allowed
        for a in sorted(allowlist, key=len, reverse=True):
            if cmd == a or cmd.startswith(a + " "):
                return cmd
        raise ValueError(f"Command not in allowlist: {cmd}")
    return cmd


def _strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _extract_first_json_object(text: str) -> Optional[dict]:
    if not text:
        return None
    t = _strip_think(text)
    try:
        return json.loads(t)
    except Exception:
        pass
    t = re.sub(r"```(?:json)?", "", t).strip().strip("`").strip()
    m = re.search(r"\{.*\}", t, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            return None
    return None


# ---------------------------
# Agent state
# ---------------------------


@dataclass
class AgentState:
    query: str
    array_hint: Optional[str] = None

    # resolved target(s)
    target_array_names: List[str] = field(default_factory=list)
    target_array_ips: List[str] = field(default_factory=list)

    # planner/execution
    planned_commands: List[str] = field(default_factory=list)
    executed_commands: List[str] = field(default_factory=list)
    cmd_outputs: Dict[str, str] = field(default_factory=dict)

    # parsed evidence
    parsed_snapshots: Dict[str, dict] = field(default_factory=dict)  # keyed by array name
    san_facts: Dict[str, Any] = field(default_factory=dict)

    # neo4j evidence
    cypher: Optional[str] = None
    neo4j_rows: List[dict] = field(default_factory=list)

    # decision + termination
    done: bool = False
    need_graph: bool = False
    reflect_round: int = 0
    max_reflect_rounds: int = 4

    # scratchpad for hallucination-proofing
    scratchpad: List[dict] = field(default_factory=list)

    # final output
    answer: Optional[str] = None


# ---------------------------
# Tool wrappers
# ---------------------------


class Neo4jCypherTool:
    def __init__(self, neo4j_store, run_cypher_fn: Callable[[str, Optional[dict]], List[dict]]):
        self.neo4j_store = neo4j_store
        self._run_cypher_fn = run_cypher_fn

    @property
    def available(self) -> bool:
        return bool(self.neo4j_store and getattr(self.neo4j_store, "available", False))

    def __call__(self, cypher: str, params: Optional[dict] = None) -> List[dict]:
        params = params or {}
        if not self.available:
            raise RuntimeError("Neo4j not available")
        # Minimal guard: disallow write operations by default (can be expanded)
        if re.search(r"\b(DELETE|DETACH DELETE|CREATE|SET|MERGE|DROP|CALL)\b", cypher, re.I):
            raise ValueError("Cypher tool only allows read queries")
        return self._run_cypher_fn(cypher, params=params)


class SSHOpsTool:
    """Generic SSH connect/exec wrapper.

    Uses existing connector abstraction in api/integrations/device_connector.py.
    """

    def __init__(
        self,
        ssh_connector_factory: Callable[[str, str, str, int], Any],
        ssh_credentials_resolver: Optional[Callable[[str], Optional[dict]]] = None,
    ):
        self.ssh_connector_factory = ssh_connector_factory
        self.ssh_credentials_resolver = ssh_credentials_resolver

    def connect_and_exec(self, ip: str, username: str, password: str, command: str, port: int = 22) -> str:
        cmd = _validate_shell_command(command)
        connector = self.ssh_connector_factory(host=ip, username=username, password=password, port=port)
        if not connector.connect():
            raise RuntimeError(f"SSH auth/connection failed for {ip}")
        try:
            res = connector.execute(cmd)
        finally:
            try:
                connector.disconnect()
            except Exception:
                pass
        return (res.get("stdout", "") or "") + "\n" + (res.get("stderr", "") or "")

    def __call__(
        self,
        ip: str,
        command: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
        port: int = 22,
    ) -> str:
        if not ip:
            raise ValueError("ip is required")
        creds = None
        if (not username or not password) and self.ssh_credentials_resolver:
            creds = self.ssh_credentials_resolver(ip)
        username = username or (creds.get("username") if creds else None) or "root"
        password = password or (creds.get("password") if creds else None)
        if not password:
            raise ValueError("password is required (or resolvable from credentials resolver)")
        return self.connect_and_exec(ip=ip, username=username, password=password, command=command, port=port)


# ---------------------------
# LangGraph agent factory
# ---------------------------


class SanAutonomousAgentGraph:
    def __init__(
        self,
        *,
        llm_call: Callable[..., Any],
        rag_engine: Optional[RAGEngine] = None,
        list_arrays_fn: Optional[Callable[[], list[dict]]] = None,
        parse_array_outputs_fn: Optional[Callable[[Dict[str, str]], dict]] = None,
        persist_parsed_fn: Optional[Callable[[dict], None]] = None,
        neo4j_cypher_tool: Optional[Neo4jCypherTool] = None,
        ssh_ops_tool: Optional[SSHOpsTool] = None,
        simulator_exec_fn: Optional[Callable[[str, str], str]] = None,
        allowed_commands: Optional[set[str]] = None,
        max_reflect_rounds: int = 4,
    ):
        self.llm_call = llm_call
        self.rag_engine = rag_engine
        self.list_arrays_fn = list_arrays_fn
        self.parse_array_outputs_fn = parse_array_outputs_fn
        self.persist_parsed_fn = persist_parsed_fn
        self.neo4j_cypher_tool = neo4j_cypher_tool
        self.ssh_ops_tool = ssh_ops_tool
        self.simulator_exec_fn = simulator_exec_fn
        self.allowed_commands = allowed_commands
        self.max_reflect_rounds = max_reflect_rounds

        if HAS_LANGCHAIN:
            self._graph = self._build_graph()
        else:
            self._graph = None

    # ---- planner prompts ----

    _PLANNER_SYSTEM = """You are a SAN autonomous agent planner.
Given the user's natural language query and the available tool/CLI surface,
choose a minimal set of safe CLI commands and (optionally) a read-only Neo4j Cypher query.

Return ONLY JSON with keys:
{
  "array_query": "array identification hint string (or null)",
  "commands": ["showhost", "shownode", ...],
  "need_graph": true/false,
  "cypher": "read-only cypher string or null",
  "stop_when": "short criterion for when enough evidence exists"
}

Rules:
- commands must be from the known safe allowlist.
- Cypher must be read-only (no writes).
"""

    _REFLECT_SYSTEM = """You are a SAN autonomous agent reflector.
Given the question, executed commands, parsed evidence, and (optional) Cypher results,
decide whether the agent is DONE or needs another CLI command.

Return ONLY JSON:
{ "done": true }
OR
{ "done": false, "command": "one allowed CLI command" }
"""

    _SYNTH_SYSTEM = """You are a SAN engineer. Produce a hallucination-proof answer.
Use ONLY the provided evidence facts and Neo4j rows.
Return markdown.
"""

    # -------------------------
    # core steps
    # -------------------------

    def _resolve_arrays(self, state: AgentState) -> AgentState:
        if not self.list_arrays_fn:
            return state
        arrays = self.list_arrays_fn() or []
        hint = state.array_hint or state.query
        hint_l = (hint or "").lower()

        chosen = []
        for a in arrays:
            name = (a.get("name") or a.get("id") or "").lower()
            ip = (a.get("ip") or a.get("id") or "").lower()
            if state.array_hint and (state.array_hint.lower() in name or state.array_hint.lower() in ip):
                chosen.append(a)
            elif not state.array_hint:
                if hint_l and (hint_l in name or hint_l in ip):
                    chosen.append(a)

        if not chosen and arrays:
            chosen = arrays[:1]

        state.target_array_names = [c.get("name") or c.get("id") for c in chosen if c.get("name") or c.get("id")]
        state.target_array_ips = [c.get("ip") or c.get("id") for c in chosen if c.get("ip") or c.get("id")]
        return state

    def _plan(self, state: AgentState) -> AgentState:
        if not self.llm_call:
            return state

        array_hint = state.array_hint or (state.target_array_names[0] if state.target_array_names else None)
        array_hint = array_hint or ""

        prompt_user = {
            "query": state.query,
            "array_hint": array_hint,
            "allowed_commands": sorted(self.allowed_commands) if self.allowed_commands else [],
            "previous": {
                "executed": state.executed_commands,
                "parsed_keys": list(state.parsed_snapshots.keys()),
            },
        }

        raw = self.llm_call(self._PLANNER_SYSTEM, json.dumps(prompt_user), json_mode=True, stream=False)
        data = _extract_first_json_object(raw) or {}
        cmds = data.get("commands") or []

        validated = []
        seen = set()
        for c in cmds:
            try:
                vc = _validate_shell_command(str(c), self.allowed_commands)
            except Exception:
                continue
            if vc not in seen:
                seen.add(vc)
                validated.append(vc)

        state.planned_commands = validated[:8]
        state.need_graph = bool(data.get("need_graph"))
        state.cypher = data.get("cypher")
        state.scratchpad.append({"phase": "plan", "plan": data})
        return state

    def _execute_commands(self, state: AgentState) -> AgentState:
        if not state.target_array_ips:
            return state
        ip = state.target_array_ips[0]
        array_name = state.target_array_names[0] if state.target_array_names else ip

        outputs: Dict[str, str] = {}

        for cmd in state.planned_commands:
            try:
                if self.simulator_exec_fn:
                    out = self.simulator_exec_fn(ip, cmd)
                elif self.ssh_ops_tool:
                    out = self.ssh_ops_tool(ip=ip, command=cmd)
                else:
                    raise RuntimeError("No exec tool configured")
                outputs[cmd] = out
                state.executed_commands.append(cmd)
                state.scratchpad.append({"phase": "exec", "command": cmd, "chars": len(out or "")})
            except Exception as ex:
                state.scratchpad.append({"phase": "exec_error", "command": cmd, "error": str(ex)})

        state.cmd_outputs.update(outputs)

        # parse + persist per array
        if self.parse_array_outputs_fn:
            try:
                parsed = self.parse_array_outputs_fn(outputs)
                state.parsed_snapshots[array_name] = parsed
            except Exception as ex:
                state.scratchpad.append({"phase": "parse_error", "error": str(ex)})

        if self.persist_parsed_fn and state.parsed_snapshots.get(array_name):
            try:
                self.persist_parsed_fn(state.parsed_snapshots[array_name])
            except Exception as ex:
                state.scratchpad.append({"phase": "persist_error", "error": str(ex)})

        return state

    def _reflect_or_continue(self, state: AgentState) -> AgentState:
        if not self.llm_call:
            return state
        if state.reflect_round >= state.max_reflect_rounds:
            state.done = True
            return state

        evidence = {
            "cmd_outputs_summary": {k: (len(v or ""), (v or "").splitlines()[:3]) for k, v in state.cmd_outputs.items()},
            "parsed_keys": list(state.parsed_snapshots.keys()),
            "need_graph": state.need_graph,
        }

        raw = self.llm_call(
            self._REFLECT_SYSTEM,
            json.dumps({"query": state.query, "executed": state.executed_commands, "evidence": evidence}),
            json_mode=True,
            stream=False,
        )
        data = _extract_first_json_object(raw) or {}
        if data.get("done") is True:
            state.done = True
        else:
            nxt = data.get("command")
            if nxt:
                try:
                    nxt = _validate_shell_command(str(nxt), self.allowed_commands)
                    state.planned_commands = [nxt]
                    state.done = False
                except Exception:
                    state.done = True
        state.reflect_round += 1
        state.scratchpad.append({"phase": "reflect", "decision": data})
        return state

    def _maybe_cypher(self, state: AgentState) -> AgentState:
        if not state.cypher:
            return state
        if not self.neo4j_cypher_tool:
            return state
        try:
            rows = self.neo4j_cypher_tool(state.cypher, params={})
            state.neo4j_rows = rows or []
            state.scratchpad.append({"phase": "cypher", "rows": len(state.neo4j_rows)})
        except Exception as ex:
            state.scratchpad.append({"phase": "cypher_error", "error": str(ex)})
        return state

    def _synthesize(self, state: AgentState) -> AgentState:
        if not self.llm_call:
            state.answer = "Agent unavailable: missing llm_call."
            return state

        # Build compact evidence payload to reduce token usage.
        evidence = {
            "parsed_snapshots": {k: v for k, v in state.parsed_snapshots.items()},
            "neo4j_rows": state.neo4j_rows[:50],
            "executed_commands": state.executed_commands,
            "stop_when": "Based on agent reflection completion",
        }
        raw = self.llm_call(
            self._SYNTH_SYSTEM,
            json.dumps({"query": state.query, "evidence": evidence}),
            stream=False,
        )
        state.answer = raw
        return state

    # -------------------------
    # LangGraph wiring
    # -------------------------

    def _build_graph(self):
        g = StateGraph(AgentState)

        def node_resolve(s: AgentState) -> AgentState:
            return self._resolve_arrays(s)

        def node_plan(s: AgentState) -> AgentState:
            return self._plan(s)

        def node_exec(s: AgentState) -> AgentState:
            return self._execute_commands(s)

        def node_cypher(s: AgentState) -> AgentState:
            return self._maybe_cypher(s)

        def node_reflect(s: AgentState) -> AgentState:
            return self._reflect_or_continue(s)

        def node_synth(s: AgentState) -> AgentState:
            return self._synthesize(s)

        g.add_node("resolve_arrays", node_resolve)
        g.add_node("plan", node_plan)
        g.add_node("execute", node_exec)
        g.add_node("cypher", node_cypher)
        g.add_node("reflect", node_reflect)
        g.add_node("synthesize", node_synth)

        g.set_entry_point("resolve_arrays")
        g.add_edge("resolve_arrays", "plan")
        g.add_edge("plan", "execute")
        g.add_edge("execute", "cypher")
        g.add_edge("cypher", "reflect")

        def route_after_reflect(s: AgentState):
            return "synthesize" if s.done else "execute"

        g.add_conditional_edges("reflect", route_after_reflect, {"synthesize": "synthesize", "execute": "execute"})
        g.add_edge("synthesize", END)

        return g.compile()

    # -------------------------
    # public API
    # -------------------------

    def run(self, query: str, array_hint: Optional[str] = None) -> dict:
        state = AgentState(query=query, array_hint=array_hint, max_reflect_rounds=self.max_reflect_rounds)

        if not HAS_LANGCHAIN or not self._graph:
            # Minimal fallback: reuse existing sequential flow by executing planner once.
            # (Keeps project working even without installing langgraph.)
            state = self._resolve_arrays(state)
            state = self._plan(state)
            state = self._execute_commands(state)
            state = self._maybe_cypher(state)
            state = self._synthesize(state)
        else:
            state = self._graph.invoke(state)

        return {
            "answer": state.answer,
            "target_array_names": state.target_array_names,
            "executed_commands": state.executed_commands,
            "cypher": state.cypher,
            "neo4j_rows": state.neo4j_rows,
            "scratchpad": state.scratchpad,
        }

