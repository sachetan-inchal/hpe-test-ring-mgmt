"""
ontology_engine.py

Ported from Unmesh's hpe-ontology-and-graph project.
Contains:
  - InMemoryGraph (graph/core.py)
  - GraphTraversal (graph/traversal.py)
  - LLMEngine (query/llm_engine.py) — Groq-powered tool-calling agent
  - Graph loader (data/graph_loader.py) — populates graph from database.json

All classes are consolidated into this single module so the monorepo API
can import them without a deeply nested package structure.
"""
import json
import os
import time
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# ── InMemoryGraph (from Unmesh's graph/core.py) ──────────────────────────────


class GraphNode:
    def __init__(self, node_id: str, label: str, properties: dict = None):
        self.node_id = node_id
        self.label = label
        self.properties = properties or {}

    def __repr__(self):
        return f"({self.label}: {self.node_id} {self.properties})"


class GraphEdge:
    def __init__(self, source_id: str, target_id: str, edge_type: str, properties: dict = None):
        self.source_id = source_id
        self.target_id = target_id
        self.type = edge_type
        self.properties = properties or {}

    def __repr__(self):
        return f"[{self.source_id}] -[{self.type}]-> [{self.target_id}]"


class InMemoryGraph:
    def __init__(self):
        self.nodes: dict[str, GraphNode] = {}
        self.edges_out: dict[str, list[GraphEdge]] = {}
        self.edges_in: dict[str, list[GraphEdge]] = {}

    def add_node(self, node_id: str, label: str, properties: dict = None) -> GraphNode:
        if node_id not in self.nodes:
            self.nodes[node_id] = GraphNode(node_id, label, properties)
            self.edges_out[node_id] = []
            self.edges_in[node_id] = []
        else:
            self.nodes[node_id].label = label
            if properties:
                self.nodes[node_id].properties.update(properties)
        return self.nodes[node_id]

    def add_edge(self, source_id: str, target_id: str, edge_type: str, properties: dict = None):
        if source_id not in self.nodes or target_id not in self.nodes:
            return None
        edge = GraphEdge(source_id, target_id, edge_type, properties)
        self.edges_out[source_id].append(edge)
        self.edges_in[target_id].append(edge)
        return edge

    def get_node(self, node_id: str):
        return self.nodes.get(node_id)

    def find_nodes_by_label(self, label: str) -> list[GraphNode]:
        return [n for n in self.nodes.values() if n.label.lower() == label.lower()]

    def get_outgoing_edges(self, node_id: str, edge_type: str = None) -> list[GraphEdge]:
        edges = self.edges_out.get(node_id, [])
        if edge_type:
            return [e for e in edges if e.type == edge_type]
        return edges

    def get_incoming_edges(self, node_id: str, edge_type: str = None) -> list[GraphEdge]:
        edges = self.edges_in.get(node_id, [])
        if edge_type:
            return [e for e in edges if e.type == edge_type]
        return edges


# ── GraphTraversal (from Unmesh's graph/traversal.py) ────────────────────────


class GraphTraversal:
    def __init__(self, graph: InMemoryGraph):
        self.graph = graph

    def get_nodes(self, label: str = None) -> list[dict]:
        nodes = []
        for n in self.graph.nodes.values():
            if label is None or n.label.lower() == label.lower():
                nodes.append({"node_id": n.node_id, "label": n.label, "properties": n.properties})
        return nodes

    def get_node_by_id(self, node_id: str) -> dict | None:
        n = self.graph.get_node(node_id.upper())
        if not n:
            n = self.graph.get_node(node_id)
        if n:
            return {"node_id": n.node_id, "label": n.label, "properties": n.properties}
        return None

    def get_connected_nodes(self, node_id: str, edge_type: str = None, direction: str = "both") -> list[dict]:
        uid = node_id.upper()
        if not self.graph.get_node(uid):
            uid = node_id
        connected = []
        if direction in ("out", "both"):
            for edge in self.graph.get_outgoing_edges(uid, edge_type):
                n = self.graph.get_node(edge.target_id)
                if n:
                    connected.append({"node_id": n.node_id, "label": n.label,
                                      "properties": n.properties, "edge_type": edge.type, "direction": "outgoing"})
        if direction in ("in", "both"):
            for edge in self.graph.get_incoming_edges(uid, edge_type):
                n = self.graph.get_node(edge.source_id)
                if n:
                    connected.append({"node_id": n.node_id, "label": n.label,
                                      "properties": n.properties, "edge_type": edge.type, "direction": "incoming"})
        return connected

    def bfs_search(self, start_node_id: str, max_depth: int = 3, target_label: str = None) -> list[dict]:
        sid = start_node_id.upper()
        if not self.graph.get_node(sid):
            sid = start_node_id
        if not self.graph.get_node(sid):
            return []

        visited = set()
        queue = [(sid, 0)]
        results = []
        while queue:
            curr_id, depth = queue.pop(0)
            if curr_id in visited or depth > max_depth:
                continue
            visited.add(curr_id)
            n = self.graph.get_node(curr_id)
            if n and depth > 0:
                if target_label is None or n.label.lower() == target_label.lower():
                    results.append({"node_id": n.node_id, "label": n.label,
                                    "properties": n.properties, "hop_count": depth})
            for edge in self.graph.get_outgoing_edges(curr_id):
                if edge.target_id not in visited:
                    queue.append((edge.target_id, depth + 1))
            for edge in self.graph.get_incoming_edges(curr_id):
                if edge.source_id not in visited:
                    queue.append((edge.source_id, depth + 1))
        return results


# ── Graph Loader (from Unmesh's data/graph_loader.py) ────────────────────────


def load_graph_from_json(graph: InMemoryGraph, file_path: str) -> str:
    """Load nodes and edges from a JSON topology file into the in-memory graph."""
    payload = json.loads(Path(file_path).read_text(encoding="utf-8"))

    for node in payload.get("nodes", []):
        node_data = dict(node)
        node_id = str(node_data.pop("id"))
        label = str(node_data.pop("type", "Unknown"))
        properties = {k: v for k, v in node_data.items() if v is not None}
        graph.add_node(node_id=node_id, label=label, properties=properties)

    for edge in payload.get("edges", []):
        edge_data = dict(edge)
        source_id = str(edge_data.pop("from"))
        target_id = str(edge_data.pop("to"))
        edge_type = str(edge_data.pop("label", "CONNECTS_TO"))
        properties = {k: v for k, v in edge_data.items() if v is not None}
        graph.add_edge(source_id=source_id, target_id=target_id, edge_type=edge_type, properties=properties)

    return f"json:{Path(file_path).name}"


def populate_graph(db_path: str = None) -> tuple[InMemoryGraph, GraphTraversal, str]:
    """
    Build a fully populated graph + traversal from the ontology database.json.
    Returns (graph, traversal, source_label).
    """
    if db_path is None:
        monorepo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        db_path = os.path.join(monorepo, "data", "ontology", "database.json")

    graph = InMemoryGraph()
    if os.path.exists(db_path):
        source = load_graph_from_json(graph, db_path)
    else:
        source = "empty"
        log.warning("Ontology database.json not found at %s", db_path)

    traversal = GraphTraversal(graph)
    return graph, traversal, source


# ── LLMEngine (from Unmesh's query/llm_engine.py) ────────────────────────────


class LLMRequestError(RuntimeError):
    pass


class OntologyLLMEngine:
    """
    Groq-powered tool-calling agent that reasons over the in-memory graph.
    Uses tool calls to query graph traversal functions and synthesize answers.
    """

    def __init__(self, traversal: GraphTraversal):
        try:
            from groq import Groq
        except ImportError:
            self.client = None
            self.traversal = traversal
            return

        api_key = os.environ.get("GROQ_API_KEY", "").strip()
        self.client = Groq(api_key=api_key) if api_key else None
        self.traversal = traversal
        self.model_name = os.environ.get("HPE_LLM_MODEL", os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"))
        self.max_tool_rounds = int(os.environ.get("HPE_LLM_MAX_TOOL_ROUNDS", "5"))
        self.max_retries = int(os.environ.get("HPE_LLM_MAX_RETRIES", "2"))

        self.system_prompt = (
            "You are an expert HPE Storage Topology reasoning assistant. "
            "You have access to a live in-memory graph of the hardware topology via your tools. "
            "Whenever the user asks a question, use your tools to query the graph nodes "
            "(ArraySystem, Host, Switch, Cage, PhysicalDisk, etc.) and their relationships. "
            "If a user asks for 'hop count', use bfs_search with the target label. "
            "Examine the properties returned by the tools to answer questions about TPD versions, "
            "switchless architecture, usable space, HBA details, protocols, etc. "
            "Do not guess. Use the tools to retrieve exact data and then format it cleanly."
        )

        self.tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_nodes",
                    "description": "Returns all nodes, optionally filtered by label (e.g., 'ArraySystem', 'Host', 'Switch').",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "description": "Filter by node label. Optional."}
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_node_by_id",
                    "description": "Returns full details of a specific node given its node_id.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "node_id": {"type": "string", "description": "The exact ID of the node."}
                        },
                        "required": ["node_id"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_connected_nodes",
                    "description": "Returns nodes connected to a specific node_id.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "node_id": {"type": "string", "description": "The ID of the source node."},
                            "edge_type": {"type": "string", "description": "Filter by relationship type. Optional."},
                            "direction": {"type": "string", "enum": ["out", "in", "both"], "description": "Direction. Default: both."}
                        },
                        "required": ["node_id"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "bfs_search",
                    "description": "BFS up to max_depth. Useful for hop counts or path discovery.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "start_node_id": {"type": "string", "description": "Start node ID."},
                            "max_depth": {"type": "integer", "description": "Max hop count."},
                            "target_label": {"type": "string", "description": "Filter by label. Optional."}
                        },
                        "required": ["start_node_id"]
                    }
                }
            }
        ]

    def _execute_tool(self, tool_call) -> str:
        name = tool_call.function.name
        try:
            args = json.loads(tool_call.function.arguments or "{}")
        except json.JSONDecodeError:
            return f"Error: invalid JSON arguments for {name}"

        try:
            if name == "get_nodes":
                result = self.traversal.get_nodes(label=args.get("label"))
            elif name == "get_node_by_id":
                result = self.traversal.get_node_by_id(node_id=args.get("node_id", ""))
            elif name == "get_connected_nodes":
                result = self.traversal.get_connected_nodes(
                    node_id=args.get("node_id", ""),
                    edge_type=args.get("edge_type"),
                    direction=args.get("direction", "both"),
                )
            elif name == "bfs_search":
                result = self.traversal.bfs_search(
                    start_node_id=args.get("start_node_id", ""),
                    max_depth=args.get("max_depth", 3),
                    target_label=args.get("target_label"),
                )
            else:
                return f"Error: Unknown tool '{name}'"
            return json.dumps(result, default=str)
        except Exception as e:
            return f"Error executing {name}: {e}"

    def process_query(self, query: str) -> str:
        """Run a multi-turn tool-calling loop to answer the user's question."""
        if not self.client:
            return "Ontology LLM engine unavailable (GROQ_API_KEY not set or groq not installed)."

        query = query.strip()
        if not query:
            raise LLMRequestError("Query cannot be empty.")

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": query},
        ]

        for _ in range(self.max_tool_rounds):
            response = None
            for attempt in range(self.max_retries + 1):
                try:
                    response = self.client.chat.completions.create(
                        model=self.model_name,
                        messages=messages,
                        tools=self.tools,
                        tool_choice="auto",
                    )
                    break
                except Exception as exc:
                    if attempt >= self.max_retries:
                        raise LLMRequestError(f"LLM request failed: {exc}") from exc
                    time.sleep(0.5 * (attempt + 1))

            if response is None:
                raise LLMRequestError("LLM did not return a response.")

            msg = response.choices[0].message

            assistant_msg = {"role": "assistant"}
            if msg.content:
                assistant_msg["content"] = msg.content
            if msg.tool_calls:
                assistant_msg["tool_calls"] = [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in msg.tool_calls
                ]
            else:
                return msg.content or "No answer produced."

            messages.append(assistant_msg)

            for tool_call in msg.tool_calls:
                tool_result = self._execute_tool(tool_call)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": tool_call.function.name,
                    "content": tool_result,
                })

        raise LLMRequestError("Exceeded max tool iterations.")

    def get_graph_summary(self) -> str:
        """Return a text summary of the ontology graph for RAG context enrichment."""
        nodes = self.traversal.get_nodes()
        if not nodes:
            return ""

        by_label = {}
        for n in nodes:
            label = n.get("label", "Unknown")
            by_label.setdefault(label, []).append(n)

        parts = [f"Ontology graph has {len(nodes)} nodes across {len(by_label)} types:"]
        for label, group in sorted(by_label.items()):
            names = [n.get("properties", {}).get("name", n["node_id"]) for n in group[:10]]
            parts.append(f"  {label} ({len(group)}): {', '.join(names)}")
        return "\n".join(parts)
