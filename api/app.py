"""
api/app.py

Unified Flask REST API for the HPE SAN Monorepo.
Serves:
  - Simulator control (start/status/device list/exec)
  - Discovery control (start/stream/status)
  - Topology graph (Neo4j → Cytoscape)
  - Elasticsearch search ("Everything" index)
  - Per-device terminal execution (for the dashboard node-click terminals)
  - Neo4j Cypher queries
  - SSE stream for live discovery events
  - RAG chat (/api/chat), spreadsheet ingest, synthetic device faker
  - Topology CRUD (elementId-based)
"""
import os
import sys
import re
import json
import time
import logging
import threading

# pyrefly: ignore [missing-import]
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MONOREPO = os.path.dirname(BASE_DIR)
try:
    # pyrefly: ignore [missing-import]
    from dotenv import load_dotenv
    load_dotenv(os.path.join(MONOREPO, ".env"))
except ImportError:
    pass
sys.path.insert(0, MONOREPO)
sys.path.insert(0, BASE_DIR)

from simulator.network_sim import virtual_network
from discovery.crawler import discovery_crawler, DiscoveryCrawler
from discovery.neo4j_store import Neo4jStore
from discovery.indexer import ElasticsearchIndexer

from integrations.json_store import JsonStore
from integrations.rag_engine import RAGEngine
from integrations.neo4j_runner import run_cypher as neo4j_run_cypher
from integrations.spreadsheet_pipeline import SpreadsheetPipeline
from integrations.data_faker import DataFaker
from integrations.topology_db import TopologyDB
from integrations.ontology_engine import populate_graph, OntologyLLMEngine

# ── Master API Logic (Merged from Editor) ──────────────────────────────────
from api.master_logic import proxy as master_proxy
from api.master_logic.universal_parser import parse_array_dump, parse_via_proxy
from api.master_logic.topology_graph import topology_graph
import networkx as nx

# Import individual parsers
from api.parsers.parse_showsys import parse_showsys
from api.parsers.parse_showport import parse_showport
from api.parsers.parse_showpd import parse_showpd
from api.parsers.parse_shownode import parse_shownode
from api.parsers.parse_showhost import parse_showhost
from api.parsers.parse_showcage import parse_showcage

_PARSERS = {
    "showsys":  parse_showsys,
    "showport": parse_showport,
    "showpd":   parse_showpd,
    "shownode": parse_shownode,
    "showhost": parse_showhost,
    "showcage": parse_showcage,
}

logging.basicConfig(level=logging.INFO, format="%(levelname)s [api] %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__, static_folder=os.path.join(MONOREPO, "dashboard", "dist"), static_url_path="")
CORS(app)

# ── Infrastructure ────────────────────────────────────────────────────────────

neo4j   = Neo4jStore()
es      = ElasticsearchIndexer()

@app.before_request
def ensure_infrastructure():
    """Attempt to connect to services if they weren't ready at startup."""
    if not neo4j.available:
        neo4j._init_driver()
    if not es.available:
        es._init_client()

FIELD_DEF_PATH = os.path.join(MONOREPO, "data", "field_definitions.json")
ALLOWED_CREATE_LABELS = frozenset({"Host", "Switch", "ArraySystem", "Cage", "Node", "PhysicalDisk"})


class _Neo4jRagBridge:
    def run_cypher(self, query, params=None):
        return neo4j_run_cypher(neo4j, query, params)


_json_store = JsonStore(os.path.join(MONOREPO, "data", "json_store"))
# Ontology Integration
_topology_db = TopologyDB()
_ontology_graph, _ontology_traversal, _ontology_source = populate_graph()
_ontology_engine = OntologyLLMEngine(_ontology_traversal)

_rag_engine = RAGEngine(
    json_store=_json_store,
    neo4j_loader=_Neo4jRagBridge() if neo4j.available else None,
    ontology_traversal=_ontology_traversal
)


def _cypher_for_spreadsheet(query, params=None):
    if not neo4j.available:
        return []
    return neo4j_run_cypher(neo4j, query, params)


_spreadsheet_pipeline = SpreadsheetPipeline(run_cypher_fn=_cypher_for_spreadsheet)
_data_faker = DataFaker()


def _load_allowed_keys():
    try:
        with open(FIELD_DEF_PATH, encoding="utf-8") as f:
            d = json.load(f)
        s = set()
        for vals in d.values():
            if isinstance(vals, list):
                s.update(vals)
        s.update({"ingest_os", "rack_location", "fc_support", "notes"})
        return s
    except Exception:
        return {"name", "model", "serial", "ip_address", "is_decommissioned"}


def _valid_prop_key(k):
    return isinstance(k, str) and re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", k)


# Inject stores into crawler singleton
discovery_crawler.neo4j = neo4j
discovery_crawler.es    = es

# ── Chatbot Proxy (Node.js) ───────────────────────────────────────────────────

CHATBOT_URL = os.environ.get("CHATBOT_SERVICE_URL", "http://localhost:5010")
SIMULATOR_URL = os.environ.get("SIMULATOR_URL", "http://localhost:5001")

def _proxy_to_sim(path, method="GET", data=None):
    if not SIMULATOR_URL:
        return None
    import requests
    url = f"{SIMULATOR_URL}{path}"
    try:
        if method == "GET":
            res = requests.get(url, timeout=3)
        else:
            res = requests.post(url, json=data, timeout=3)
        return res.json()
    except Exception:
        return None

@app.route("/chatbot/", defaults={"path": ""}, methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.route("/chatbot/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def chatbot_proxy(path):
    """Proxy requests starting with /chatbot to the Node.js chatbot-service."""
    import requests
    
    # Ensure the path starts with api/ if it's missing (as the dashboard strips it)
    clean_path = path if path.startswith("api") else f"api/{path}"
    target_url = f"{CHATBOT_URL}/{clean_path}"
    
    # Forward headers (optional but good for auth)
    headers = {k: v for k, v in request.headers if k.lower() != 'host'}
    
    try:
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers=headers,
            data=request.get_data(),
            cookies=request.cookies,
            allow_redirects=False,
            params=request.args
        )
        
        excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        headers = [(name, value) for (name, value) in resp.raw.headers.items()
                   if name.lower() not in excluded_headers]
        
        return Response(resp.content, resp.status_code, headers)
    except Exception as e:
        log.error(f"Proxy error: {e}")
        return jsonify({"error": "Chatbot service unreachable", "details": str(e)}), 503

# ── Frontend serving ──────────────────────────────────────────────────────────

@app.route("/tester")
def serve_tester():
    static_dir = os.path.join(BASE_DIR, "static")
    return send_from_directory(static_dir, "api_tester.html")

@app.route("/terminal")
def serve_terminal():
    static_dir = os.path.join(BASE_DIR, "static")
    return send_from_directory(static_dir, "terminal.html")

@app.route("/api/v1/openapi.json")
def v1_openapi():
    return jsonify({
        "openapi": "3.0.0",
        "info": {"title": "HPE SAN Master API", "version": "1.0.0"},
        "paths": {
            "/api/v1/san/devices": {"get": {"summary": "List all devices"}},
            "/api/v1/san/cli/exec": {"post": {"summary": "Execute CLI command"}},
            "/api/v1/san/graph/cytoscape": {"get": {"summary": "Get topology graph"}},
            "/api/v1/san/discovery/start": {"post": {"summary": "Start discovery"}},
        }
    })

# ── API Aliases for Dashboard ──────────────────────────────────────────────────

@app.route("/api/ontology/topology")
@app.route("/api/graph/neo4j")
def legacy_graph_alias():
    # Force a re-check if it's currently unavailable
    if not neo4j.available:
        neo4j._init_driver()
    return neo4j_graph()

@app.route("/api/faker/san", methods=["POST"])
def api_faker_san():
    return fake_san()

# ── Simulator endpoints ───────────────────────────────────────────────────────

@app.route("/api/sim/devices", methods=["GET"])
def sim_devices():
    """List all virtual devices in the simulated SAN."""
    proxied = _proxy_to_sim("/sim/devices")
    if proxied is not None:
        return jsonify(proxied)
    return jsonify(virtual_network.list_devices())

@app.route("/api/sim/exec", methods=["POST"])
def sim_exec():
    """Execute a CLI command on a simulated device."""
    data = request.json or {}
    proxied = _proxy_to_sim("/sim/exec", method="POST", data=data)
    if proxied is not None:
        return jsonify(proxied)
    
    ip      = data.get("ip", "")
    command = data.get("command", "")
    if not ip or not command:
        return jsonify({"error": "ip and command are required"}), 400

    output = virtual_network.execute(ip, command)
    return jsonify({"ip": ip, "command": command, "output": output})

@app.route("/api/sim/topology", methods=["GET"])
def sim_topology():
    """D3-ready node-link of the simulated network."""
    proxied = _proxy_to_sim("/sim/topology")
    if proxied is not None:
        return jsonify(proxied)
    
    devices = virtual_network.list_devices()
    nodes = [{"id": d["ip"], "label": d.get("name", d["ip"]), "type": d.get("type")} for d in devices]
    edges = []
    for d in devices:
        for peer in d.get("connected_to", []):
            edges.append({"source": d["ip"], "target": peer, "type": "REMOTE_COPY"})
    return jsonify({"nodes": nodes, "edges": edges})

@app.route("/api/sim/status", methods=["GET"])
def sim_status():
    proxied = _proxy_to_sim("/sim/status")
    if proxied is not None:
        return jsonify(proxied)
    
    count = len(virtual_network.list_devices())
    return jsonify({"status": "running" if count > 0 else "idle", "device_count": count})

# ── Discovery endpoints ───────────────────────────────────────────────────────

@app.route("/api/discover", methods=["POST"])
def start_discovery():
    """Start BFS discovery.
    Body: {"seed_ips": ["10.20.10.5"]} or {"seed_ip": "10.20.10.5"}
    """
    data = request.json or {}
    seed_ips = data.get("seed_ips") or [data.get("seed_ip", "10.20.10.5")]
    delay_ms = data.get("delay_ms", 20)

    if discovery_crawler.running:
        return jsonify({"error": "Discovery already running"}), 409

    def _run():
        discovery_crawler.discover(seed_ips, delay_ms=delay_ms)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"status": "started", "seed_ips": seed_ips})

@app.route("/api/discover/stream")
def discovery_stream():
    """SSE endpoint — push live discovery events to the dashboard."""
    def generate():
        sent = 0
        while True:
            events = discovery_crawler.events
            while sent < len(events):
                yield f"data: {json.dumps(events[sent])}\n\n"
                sent += 1
                if events[sent - 1].get("type") in ("complete", "error"):
                    return
            if not discovery_crawler.running and sent >= len(events):
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                return
            time.sleep(0.3)
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.route("/api/discover/status")
@app.route("/api/v1/san/discovery/status")
def discovery_status():
    return jsonify(discovery_crawler.get_status())

@app.route("/api/v1/san/discovery/events")
def discovery_events():
    return jsonify({"events": discovery_crawler.events, "count": len(discovery_crawler.events)})

# ── Topology / Graph endpoints ────────────────────────────────────────────────

@app.route("/api/graph/neo4j")
def neo4j_graph():
    """Full Neo4j graph as Cytoscape.js JSON (node data.id = elementId)."""
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available", "nodes": [], "edges": []}), 503
    try:
        nodes_raw = neo4j._run(
            "MATCH (n) RETURN labels(n)[0] AS label, properties(n) AS props, elementId(n) AS element_id"
        )
        edges_raw = neo4j._run(
            "MATCH ()-[r]->() RETURN elementId(startNode(r)) AS src, elementId(endNode(r)) AS tgt, type(r) AS rel_type"
        )
        nodes = [{"data": {"id": n["element_id"], "label": n["label"], **n["props"]}} for n in nodes_raw]
        edges = [{"data": {"source": e["src"], "target": e["tgt"], "label": e["rel_type"]}} for e in edges_raw]
        return jsonify({"nodes": nodes, "edges": edges})
    except Exception as ex:
        return jsonify({"error": str(ex), "nodes": [], "edges": []}), 500


# ── RAG chat, ingest, faker ───────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
@app.route("/api/v1/san/rag/query", methods=["POST"])
def chat():
    data = request.json or {}
    q = (data.get("query") or "").strip()
    if not q:
        return jsonify({"error": "query is required"}), 400
    history = data.get("history") or []
    try:
        result = _rag_engine.query(q, history=history if isinstance(history, list) else [])
        return jsonify(result)
    except Exception as ex:
        log.exception("chat failed")
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ingest/spreadsheet", methods=["POST"])
def ingest_spreadsheet():
    raw = request.data.decode("utf-8", errors="replace").strip()
    if not raw and request.form:
        raw = (request.form.get("csv") or "").strip()
    if not raw:
        return jsonify({"error": "Send raw CSV body or form field csv="}), 400
    try:
        result = _spreadsheet_pipeline.process_csv(raw)
        ingest_dir = os.path.join(MONOREPO, "data", "ingest")
        os.makedirs(ingest_dir, exist_ok=True)
        fn = time.strftime("ingest_%Y%m%d_%H%M%S.json")
        path = os.path.join(ingest_dir, fn)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, default=str)
        out = dict(result) if isinstance(result, dict) else {"data": result}
        out["_saved"] = fn
        return jsonify(out)
    except Exception as ex:
        log.exception("ingest")
        return jsonify({"error": str(ex)}), 500


@app.route("/api/faker/generate", methods=["POST"])
def faker_generate():
    data = request.json or {}
    name = data.get("name") or data.get("seed_name") or "synthetic_array"
    try:
        path = _data_faker.generate_array(str(name))
        return jsonify({
            "path": path,
            "hint": "File written to simulator/data/devices. Reload simulator devices if your process caches file list.",
        })
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


# ── Field definitions (Field Manager) ─────────────────────────────────────────

@app.route("/api/schema/fields", methods=["GET", "PUT"])
def schema_fields():
    if request.method == "GET":
        try:
            with open(FIELD_DEF_PATH, encoding="utf-8") as f:
                return jsonify(json.load(f))
        except Exception as ex:
            return jsonify({"error": str(ex)}), 500
    data = request.json
    if not isinstance(data, dict):
        return jsonify({"error": "JSON object required"}), 400
    try:
        with open(FIELD_DEF_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        return jsonify({"status": "ok"})
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


# ── Ontology Endpoints (Ported from Unmesh) ───────────────────────────────────

@app.route("/api/ontology/topology", methods=["GET"])
def get_ontology_topology():
    try:
        return jsonify(_topology_db.get_topology())
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ontology/nodes/<node_id>", methods=["PATCH"])
def patch_ontology_node(node_id):
    body = request.json or {}
    try:
        result = _topology_db.update_node(
            node_id,
            is_decommissioned=body.get("isDecommissioned"),
            properties=body.get("properties")
        )
        # Re-populate graph after update to keep reasoning engine in sync
        global _ontology_graph, _ontology_traversal, _ontology_source, _ontology_engine
        _ontology_graph, _ontology_traversal, _ontology_source = populate_graph()
        _ontology_engine = OntologyLLMEngine(_ontology_traversal)
        return jsonify(result)
    except KeyError as ex:
        return jsonify({"error": str(ex)}), 404
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ontology/nodes", methods=["POST"])
def create_ontology_node():
    body = request.json or {}
    try:
        result = _topology_db.add_node(body)
        # Re-populate graph
        global _ontology_graph, _ontology_traversal, _ontology_source, _ontology_engine
        _ontology_graph, _ontology_traversal, _ontology_source = populate_graph()
        _ontology_engine = OntologyLLMEngine(_ontology_traversal)
        return jsonify(result)
    except ValueError as ex:
        return jsonify({"error": str(ex)}), 400
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ontology/nodes/<node_id>", methods=["DELETE"])
def delete_ontology_node(node_id):
    try:
        result = _topology_db.delete_node(node_id)
        # Re-populate graph
        global _ontology_graph, _ontology_traversal, _ontology_source, _ontology_engine
        _ontology_graph, _ontology_traversal, _ontology_source = populate_graph()
        _ontology_engine = OntologyLLMEngine(_ontology_traversal)
        return jsonify(result)
    except KeyError as ex:
        return jsonify({"error": str(ex)}), 404
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ontology/chat", methods=["POST"])
def ontology_chat():
    data = request.json or {}
    q = (data.get("query") or "").strip()
    if not q:
        return jsonify({"error": "Query is required"}), 400
    try:
        answer = _ontology_engine.process_query(q)
        return jsonify({"answer": answer, "source": "ontology_graph"})
    except Exception as ex:
        log.exception("Ontology chat failed")
        return jsonify({"error": str(ex)}), 500


# ── Graph node CRUD (elementId) ───────────────────────────────────────────────

@app.route("/api/graph/nodes/<path:element_id>", methods=["PATCH"])
def patch_graph_node(element_id):
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available"}), 503
    body = request.json or {}
    allowed = _load_allowed_keys()
    deco = body.get("isDecommissioned")
    props = body.get("properties") or {}
    if not isinstance(props, dict):
        return jsonify({"error": "properties must be an object"}), 400

    sets = []
    params = {"eid": element_id}
    if deco is not None:
        sets.append("n.is_decommissioned = $deco")
        params["deco"] = bool(deco)
    for k, v in props.items():
        if k not in allowed or not _valid_prop_key(k):
            continue
        pk = "pv_" + k
        sets.append(f"n.{k} = ${pk}")
        params[pk] = v
    if not sets:
        return jsonify({"error": "No valid updates (isDecommissioned or whitelisted properties required)"}), 400
    cypher = f"MATCH (n) WHERE elementId(n) = $eid SET {', '.join(sets)} RETURN elementId(n) AS element_id"
    try:
        neo4j._run(cypher, **params)
        return jsonify({"status": "ok", "element_id": element_id})
    except Exception as ex:
        return jsonify({"error": str(ex)}), 400


@app.route("/api/graph/nodes/<path:element_id>", methods=["DELETE"])
def delete_graph_node(element_id):
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available"}), 503
    try:
        found = neo4j._run("MATCH (n) WHERE elementId(n) = $eid RETURN elementId(n) AS e LIMIT 1", eid=element_id)
        if not found:
            return jsonify({"error": "Node not found"}), 404
        neo4j._run("MATCH (n) WHERE elementId(n) = $eid DETACH DELETE n", eid=element_id)
        return jsonify({"status": "ok"})
    except Exception as ex:
        return jsonify({"error": str(ex)}), 400


@app.route("/api/graph/nodes", methods=["POST"])
def create_graph_node():
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available"}), 503
    body = request.json or {}
    label = body.get("label") or body.get("type")
    if label not in ALLOWED_CREATE_LABELS:
        return jsonify({"error": f"label must be one of {sorted(ALLOWED_CREATE_LABELS)}"}), 400
    allowed = _load_allowed_keys()
    extra = body.get("properties") or {}
    arr_ip = body.get("connect_to_array_ip") or body.get("array_ip")

    try:
        if label == "Host":
            ip = body.get("ip_address") or extra.get("ip_address")
            if not ip:
                return jsonify({"error": "ip_address required for Host"}), 400
            name = body.get("name") or extra.get("name") or ip
            rows = neo4j._run(
                """
                CREATE (n:Host {ip_address: $ip, name: $name})
                WITH n
                OPTIONAL MATCH (a:ArraySystem {ip_address: $arr})
                WHERE $arr IS NOT NULL
                FOREACH (x IN CASE WHEN a IS NOT NULL THEN [a] ELSE [] END |
                  MERGE (n)-[:CONNECTS_TO]->(x))
                RETURN elementId(n) AS element_id
                """,
                ip=ip,
                name=name,
                arr=arr_ip,
            )
        elif label == "Switch":
            name = body.get("name") or extra.get("name")
            serial = body.get("serial") or extra.get("serial") or name
            if not name:
                return jsonify({"error": "name required for Switch"}), 400
            rows = neo4j._run(
                """
                CREATE (n:Switch {name: $name, serial: $serial})
                WITH n
                OPTIONAL MATCH (a:ArraySystem {ip_address: $arr})
                WHERE $arr IS NOT NULL
                FOREACH (x IN CASE WHEN a IS NOT NULL THEN [a] ELSE [] END |
                  MERGE (x)-[:HAS_SWITCH]->(n))
                RETURN elementId(n) AS element_id
                """,
                name=name,
                serial=serial or name,
                arr=arr_ip,
            )
        elif label == "ArraySystem":
            ip = body.get("ip_address") or extra.get("ip_address")
            if not ip:
                return jsonify({"error": "ip_address required for ArraySystem"}), 400
            nm = body.get("name") or extra.get("name") or ip
            rows = neo4j._run(
                """
                MERGE (n:ArraySystem {ip_address: $ip})
                SET n.name = coalesce(n.name, $name)
                RETURN elementId(n) AS element_id
                """,
                ip=ip,
                name=nm,
            )
        elif label == "PhysicalDisk":
            serial = body.get("serial") or extra.get("serial")
            if not serial:
                return jsonify({"error": "serial required for PhysicalDisk"}), 400
            rows = neo4j._run(
                """
                CREATE (n:PhysicalDisk {serial: $serial})
                RETURN elementId(n) AS element_id
                """,
                serial=serial,
            )
        elif label == "Cage":
            cid = body.get("cage_id") or extra.get("cage_id")
            if not cid:
                return jsonify({"error": "cage_id required for Cage"}), 400
            cname = body.get("name") or extra.get("name") or str(cid)
            rows = neo4j._run(
                """
                CREATE (n:Cage {cage_id: $cid, name: $cname})
                WITH n
                OPTIONAL MATCH (a:ArraySystem {ip_address: $arr})
                WHERE $arr IS NOT NULL
                FOREACH (x IN CASE WHEN a IS NOT NULL THEN [a] ELSE [] END |
                  MERGE (x)-[:HAS_CAGE]->(n))
                RETURN elementId(n) AS element_id
                """,
                cid=str(cid),
                cname=cname,
                arr=arr_ip,
            )
        else:  # Node
            nid = body.get("node_id") or extra.get("node_id")
            if not nid or not arr_ip:
                return jsonify({"error": "node_id and connect_to_array_ip required for Node"}), 400
            nm = body.get("name") or extra.get("name") or nid
            rows = neo4j._run(
                """
                CREATE (n:Node {node_id: $nid, name: $nm})
                WITH n
                MATCH (a:ArraySystem {ip_address: $arr})
                MERGE (a)-[:HAS_NODE]->(n)
                RETURN elementId(n) AS element_id
                """,
                nid=str(nid),
                nm=nm,
                arr=arr_ip,
            )

        eid = rows[0]["element_id"] if rows else None
        if not eid:
            return jsonify({"error": "Create failed"}), 500

        patch_props = {k: v for k, v in extra.items() if k in allowed and _valid_prop_key(k)}
        if patch_props:
            sets = []
            params = {"eid": eid}
            for i, (k, v) in enumerate(patch_props.items()):
                pk = f"pv{i}"
                sets.append(f"n.{k} = ${pk}")
                params[pk] = v
            neo4j._run(
                f"MATCH (n) WHERE elementId(n) = $eid SET {', '.join(sets)}",
                **params,
            )

        return jsonify({"status": "ok", "element_id": eid})
    except Exception as ex:
        log.exception("create node")
        return jsonify({"error": str(ex)}), 400

@app.route("/api/graph/cypher", methods=["POST"])
@app.route("/api/v1/san/rag/cypher", methods=["POST"])
def run_cypher():
    """Execute a raw Cypher query.
    Body: {"cypher": "MATCH (n) RETURN n LIMIT 25", "params": {}}
    """
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available"}), 503
    data = request.json or {}
    cypher = data.get("cypher", "")
    params = data.get("params", {})
    if not cypher:
        return jsonify({"error": "Provide 'cypher' query"}), 400
    try:
        results = neo4j._run(cypher, **params)
        return jsonify({"results": results})
    except Exception as ex:
        return jsonify({"error": str(ex)}), 400

# ── Elasticsearch "Everything" search ────────────────────────────────────────

@app.route("/api/search")
def everything_search():
    """Universal search across all indexed SAN entities.
    Query param: q=<search_term>&index=<arrays|hosts|drives|*>
    """
    q = request.args.get("q", "")
    index = request.args.get("index", "*")
    if not q:
        return jsonify({"error": "Provide ?q=<search_term>"}), 400
    results = es.search(q, index_suffix=index)
    return jsonify({"query": q, "count": len(results), "results": results})

@app.route("/api/search/status")
def search_status():
    return jsonify({
        "elasticsearch": "available" if es.available else "unavailable",
        "neo4j":         "available" if neo4j.available else "unavailable",
    })

# ── Health ────────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    groq_key = bool((os.environ.get("GROQ_API_KEY") or "").strip())
    # Check if simulator is reachable
    sim_reachable = "ok"
    try:
        from simulator.network_sim import SIMULATOR_URL
        if SIMULATOR_URL and SIMULATOR_URL.startswith("http"):
            import requests
            res = requests.get(f"{SIMULATOR_URL}/sim/status", timeout=2.0)
            if not res.ok: sim_reachable = "error"
        else:
            sim_reachable = "error"
    except Exception:
        sim_reachable = "error"

    return jsonify({
        "status": "ok",
        "version": "2.0",
        "sim_devices": len(virtual_network.list_devices()),
        "neo4j": "ok" if neo4j.available else "unavailable",
        "elasticsearch": "ok" if es.available else "unavailable",
        "discovery_running": discovery_crawler.running,
        "groq_configured": groq_key,
        "simulator": sim_reachable
    })


# ─── Legacy /api Compatibility (from Editor) ───────────────────────────────

@app.route("/api/cli/exec", methods=["POST"])
def legacy_cli_exec():
    return v1_san_cli_exec()

@app.route("/api/cli/connect", methods=["POST"])
def legacy_cli_connect():
    return v1_san_cli_connect()

@app.route("/api/devices", methods=["GET"])
def legacy_get_devices():
    return v1_san_devices()

@app.route("/api/topology")
@app.route("/api/v1/san/topology")
@app.route("/api/v1/san/graph/editor")
@app.route("/api/v1/topology-json/topology")
def legacy_get_topology():
    return jsonify(topology_graph.to_dict())

@app.route("/api/topology/node", methods=["POST"])
@app.route("/api/v1/san/topology/node", methods=["POST"])
def legacy_add_topology_node():
    data = request.json or {}
    node_id = data.get("id")
    node_type = data.get("type", "Node")
    if not node_id:
        return jsonify({"error": "Node ID required"}), 400
    topology_graph.add_node(node_id, node_type, **data)
    return jsonify({"status": "ok"})

@app.route("/api/topology/edge", methods=["POST"])
@app.route("/api/v1/san/topology/edge", methods=["POST"])
def legacy_add_topology_edge():
    data = request.json or {}
    source = data.get("source")
    target = data.get("target")
    edge_type = data.get("type", "CONNECTED_TO")
    if not source or not target:
        return jsonify({"error": "Source and target required"}), 400
    topology_graph.add_edge(source, target, edge_type, **data)
    return jsonify({"status": "ok"})

@app.route("/api/topology/save", methods=["POST"])
@app.route("/api/v1/san/topology/save", methods=["POST"])
def legacy_save_topology():
    result = topology_graph.export_to_neo4j(neo4j_driver=neo4j)
    return jsonify(result)

@app.route("/api/graph")
@app.route("/api/v1/san/graph")
@app.route("/api/v1/san/graph/cytoscape")
def legacy_get_graph():
    return jsonify({
        "elements": topology_graph.to_cytoscape(),
        "summary": {"total_nodes": len(topology_graph.get_nodes())}
    })

@app.route("/api/v1/san/neo4j/graph")
def legacy_get_neo4j_graph():
    return neo4j_graph()

@app.route("/api/graph/path", methods=["POST"])
def legacy_find_path():
    return v1_graph_path()

@app.route("/api/topology/export")
def legacy_export_topology():
    lines = ["id,type,label,state,parent"]
    G = topology_graph.graph
    for nid, attrs in G.nodes(data=True):
        ntype = attrs.get("node_type", "")
        label = attrs.get("name", nid)
        state = attrs.get("state", "normal")
        parent = ""
        for pred in G.predecessors(nid):
            parent = pred
            break
        lines.append(f"{nid},{ntype},{label},{state},{parent}")
    return Response("\n".join(lines), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=topology.csv"})

@app.route("/api/ingest/cli-dump", methods=["POST"])
@app.route("/api/v1/san/ingest/cli-dump", methods=["POST"])
def legacy_ingest_cli_dump():
    data = request.json or {}
    raw_text = data.get("raw_text", "")
    device = data.get("device", "")
    try:
        if device:
            parsed = parse_via_proxy(device)
        elif raw_text:
            parsed = parse_array_dump(raw_text)
        else:
            return jsonify({"error": "Provide 'raw_text' or 'device'"}), 400
        _json_store.save_array(parsed)
        counts = {
            "nodes": len(parsed.get("nodes", [])),
            "ports": len(parsed.get("ports", [])),
            "switches": len(parsed.get("switches", [])),
            "hosts": len(parsed.get("hosts", [])),
            "cages": len(parsed.get("cages", [])),
            "drives": len(parsed.get("drives", [])),
        }
        return jsonify({"array_name": parsed.get("name", "unknown"), "entity_counts": counts})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/arrays")
@app.route("/api/v1/san/arrays")
def legacy_get_arrays():
    arrays = []
    for name in _json_store.list_arrays():
        data = _json_store.load_array(name)
        if data:
            arrays.append({
                "name": data.get("name"),
                "model": data.get("model"),
                "serial": data.get("serial"),
                "node_count": data.get("node_count"),
                "total_cap_mib": data.get("total_cap_mib"),
                "free_cap_mib": data.get("free_cap_mib"),
            })
    return jsonify({"arrays": arrays})

@app.route("/api/arrays/<name>")
@app.route("/api/v1/san/arrays/<name>")
def legacy_get_array_detail(name):
    data = _json_store.load_array(name)
    if not data:
        return jsonify({"error": f"Array '{name}' not found"}), 404
    return jsonify(data)

@app.route("/api/schema")
@app.route("/api/v1/san/schema")
def legacy_get_schema():
    mermaid = """flowchart TD
    A[ArraySystem] -->|HAS_NODE| B[Node]
    B -->|HAS_PORT| C[Port]
    A -->|HAS_SWITCH| D[Switch]
    A -->|HAS_CAGE| E[Cage]
    E -->|CONTAINS| F[PhysicalDisk]
    C -->|CONNECTS_TO| G[Host]
    G -->|CONNECTS_TO| A"""
    return jsonify({"mermaid": mermaid, "entities": ["ArraySystem", "Node", "Port", "Switch", "Host", "Cage", "PhysicalDisk"]})

@app.route("/api/v1/san/schema/fields")
def legacy_get_schema_fields():
    fields = {
        "ArraySystem": ["array_id", "name", "model", "serial", "release_version", "release_type",
                        "node_count", "total_cap_mib", "alloc_cap_mib", "free_cap_mib",
                        "failed_cap_mib", "config_type", "protocols_supported"],
        "Node": ["node_id", "name", "encl_bay", "is_master", "in_cluster", "memory_mib", "up_since"],
        "Port": ["port_id", "node", "slot", "port_num", "mode", "state", "protocol", "type",
                 "node_wwn_ip", "port_wwn_hw", "label"],
        "Switch": ["name", "state", "mode", "serial", "temperature"],
        "Host": ["wwn", "ports", "multipath_status", "missing_path"],
        "Cage": ["cage_id", "name", "state", "detailed_state", "drives", "temp", "model", "form_factor"],
        "PhysicalDisk": ["pd_id", "cage_pos", "type", "state", "total_mib", "free_mib",
                         "capacity_gb", "manufacturer", "model", "serial", "fw_rev", "protocol",
                         "sed_state"],
    }
    return jsonify(fields)

# ── API v1 Compatibility & Advanced Features (Master API) ──────────────────

@app.route("/api/v1/health")
def v1_health():
    return health()

@app.route("/api/v1/catalog")
def v1_catalog():
    routes = []
    for rule in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
        if rule.rule.startswith("/api/v1/") and "<" not in rule.rule:
            routes.append({
                "path": rule.rule,
                "methods": sorted(m for m in rule.methods if m not in ("HEAD", "OPTIONS")),
            })
    return jsonify({"routes": routes, "count": len(routes)})

@app.route("/api/v1/san/devices")
def v1_san_devices():
    devices = []
    for ip, f in master_proxy.DEVICE_REGISTRY.items():
        cmds = master_proxy.list_device_commands(f)
        devices.append({"ip": ip, "file": f, "available_commands": cmds})
    all_files = master_proxy.list_devices()
    registered_files = set(master_proxy.DEVICE_REGISTRY.values())
    for f in all_files:
        if f not in registered_files:
            devices.append({"ip": None, "file": f, "available_commands": master_proxy.list_device_commands(f)})
    return jsonify({"devices": devices, "count": len(devices)})

@app.route("/api/v1/san/cli/exec", methods=["POST"])
def v1_san_cli_exec():
    data    = request.json or {}
    device  = data.get("device", "")
    command = data.get("command", "")
    if not device or not command:
        return jsonify({"error": "device and command are required"}), 400
    output = master_proxy.get_command_output(device, command)
    return jsonify({"device": device, "command": command, "output": output})

@app.route("/api/v1/san/cli/connect", methods=["POST"])
def v1_san_cli_connect():
    ip = (request.json or {}).get("ip", "")
    device_file = master_proxy.resolve_ip(ip)
    if not device_file:
        return jsonify({"status": "refused", "message": f"No device at {ip}"}), 404
    sys_out = master_proxy.get_command_output(device_file, "showsys")
    parsed  = parse_showsys(sys_out)
    return jsonify({
        "status": "connected",
        "device_file": device_file,
        "name":  parsed.get("name", device_file.replace(".txt", "")),
        "model": parsed.get("model", "Unknown"),
        "ip": ip,
        "available_commands": master_proxy.list_device_commands(device_file),
    })

@app.route("/api/v1/san/discovery/start", methods=["POST"])
def v1_discovery_start():
    return start_discovery()

@app.route("/api/v1/san/discovery/stream")
def v1_discovery_stream():
    return discovery_stream()

@app.route("/api/v1/san/graph/cytoscape")
def v1_graph_cytoscape():
    return neo4j_graph()

@app.route("/api/v1/san/graph/path", methods=["POST"])
def v1_graph_path():
    data = request.json or {}
    src, dst = data.get("from"), data.get("to")
    if not src or not dst:
        return jsonify({"error": "from and to are required"}), 400
    
    # Build NetworkX graph from Neo4j data
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available for pathfinding"}), 503
    
    try:
        nodes_raw = neo4j._run("MATCH (n) RETURN elementId(n) AS eid")
        edges_raw = neo4j._run("MATCH (a)-[r]->(b) RETURN elementId(a) AS src, elementId(b) AS tgt")
        
        G = nx.Graph()
        for n in nodes_raw: G.add_node(n["eid"])
        for e in edges_raw: G.add_edge(e["src"], e["tgt"])
        
        if src not in G or dst not in G:
            return jsonify({"error": "One or both nodes not found in graph"}), 404
            
        path = nx.shortest_path(G, src, dst)
        return jsonify({"path": path, "hops": len(path) - 1})
    except nx.NetworkXNoPath:
        return jsonify({"error": "No path found"}), 404
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500

@app.route("/api/v1/san/parser/<command>", methods=["POST"])
def v1_san_parser(command):
    if command not in _PARSERS:
        return jsonify({"error": f"Unknown parser '{command}'"}), 400
    raw = (request.json or {}).get("raw_text", "")
    if not raw:
        return jsonify({"error": "Provide 'raw_text'"}), 400
    try:
        return jsonify(_PARSERS[command](raw))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Monorepo Proxy routes ──────────────────────────────────────────────────

@app.route("/api/v1/monorepo/health")
def v1_monorepo_health():
    return health()

@app.route("/api/v1/monorepo/sim/devices")
def v1_monorepo_sim_devices():
    return sim_devices()

@app.route("/api/v1/monorepo/chat", methods=["POST"])
def v1_monorepo_chat():
    return chat()

@app.route("/api/v1/monorepo/graph/neo4j")
def v1_monorepo_neo4j():
    return neo4j_graph()

@app.route("/api/v1/monorepo/search")
def v1_monorepo_search():
    return everything_search()

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """Serve the React frontend assets and handle SPA routing."""
    build_dir = app.static_folder
    # 1. If path is empty or doesn't exist as a file, serve index.html (SPA fallback)
    if not path or not os.path.isfile(os.path.join(build_dir, path)):
        if build_dir and os.path.exists(os.path.join(build_dir, "index.html")):
            return send_from_directory(build_dir, "index.html")
        return jsonify({"message": "HPE SAN API running. Build the React dashboard for the UI."}), 200
    
    # 2. Serve the actual static file (JS, CSS, images)
    return send_from_directory(build_dir, path)

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5005))
    print("=" * 60)
    print(f"  HPE SAN Monorepo API — http://localhost:{port}")
    print(f"  Neo4j:          {'connected' if neo4j.available else 'unavailable'}")
    print(f"  Elasticsearch:  {'connected' if es.available else 'unavailable'}")
    print(f"  Sim devices:    {len(virtual_network.list_devices())}")
    print("=" * 60)
    print("=" * 60)
    print("  Start simulator first:  cd simulator && python simulator_manager.py")
    print("=" * 60)
    
    # Auto-index logic in background
    def _auto_index():
        time.sleep(2) # Wait for server to start
        for dev in master_proxy.list_devices():
            name = dev.replace('.txt', '')
            if not _json_store.load_array(name):
                try:
                    data = parse_via_proxy(dev)
                    _json_store.save_array(data)
                    log.info(f"Auto-indexed: {data.get('name', dev)}")
                except Exception:
                    pass
    threading.Thread(target=_auto_index, daemon=True).start()
    
    app.run(debug=True, host="0.0.0.0", port=port, threaded=True)
