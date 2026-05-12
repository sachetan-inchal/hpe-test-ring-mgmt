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

from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MONOREPO = os.path.dirname(BASE_DIR)
try:
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

logging.basicConfig(level=logging.INFO, format="%(levelname)s [api] %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__, static_folder=os.path.join(MONOREPO, "dashboard", "build"), static_url_path="")
CORS(app)

# ── Infrastructure ────────────────────────────────────────────────────────────

neo4j   = Neo4jStore()
es      = ElasticsearchIndexer()

FIELD_DEF_PATH = os.path.join(MONOREPO, "data", "field_definitions.json")
ALLOWED_CREATE_LABELS = frozenset({"Host", "Switch", "ArraySystem", "Cage", "Node", "PhysicalDisk"})


class _Neo4jRagBridge:
    def run_cypher(self, query, params=None):
        return neo4j_run_cypher(neo4j, query, params)


_json_store = JsonStore(os.path.join(MONOREPO, "data", "json_store"))
_rag_engine = RAGEngine(
    json_store=_json_store,
    neo4j_loader=_Neo4jRagBridge() if neo4j.available else None,
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

# ── Frontend serving ──────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    build_dir = app.static_folder
    if build_dir and os.path.exists(os.path.join(build_dir, path)):
        return send_from_directory(build_dir, path)
    if build_dir and os.path.exists(os.path.join(build_dir, "index.html")):
        return send_from_directory(build_dir, "index.html")
    return jsonify({"message": "HPE SAN API running. Build the React dashboard for the UI."}), 200

# ── Simulator endpoints ───────────────────────────────────────────────────────

@app.route("/api/sim/devices", methods=["GET"])
def sim_devices():
    """List all virtual devices in the simulated SAN."""
    return jsonify(virtual_network.list_devices())

@app.route("/api/sim/exec", methods=["POST"])
def sim_exec():
    """Execute a CLI command on a simulated device.
    Body: {"ip": "10.20.10.5", "command": "showsys"}
    """
    data = request.json or {}
    ip      = data.get("ip", "")
    command = data.get("command", "")
    if not ip or not command:
        return jsonify({"error": "ip and command are required"}), 400

    output = virtual_network.execute(ip, command)
    return jsonify({"ip": ip, "command": command, "output": output})

@app.route("/api/sim/topology", methods=["GET"])
def sim_topology():
    """D3-ready node-link of the simulated network."""
    devices = virtual_network.list_devices()
    nodes = [{"id": d["ip"], "label": d.get("name", d["ip"]), "type": d.get("type")} for d in devices]
    edges = []
    for d in devices:
        for peer in d.get("connected_to", []):
            edges.append({"source": d["ip"], "target": peer, "type": "REMOTE_COPY"})
    return jsonify({"nodes": nodes, "edges": edges})

@app.route("/api/sim/status", methods=["GET"])
def sim_status():
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
def discovery_status():
    return jsonify(discovery_crawler.get_status())

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
    return jsonify({
        "status": "ok",
        "sim_devices": len(virtual_network.list_devices()),
        "neo4j": neo4j.available,
        "elasticsearch": es.available,
        "discovery_running": discovery_crawler.running,
        "groq_configured": groq_key,
    })

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  HPE SAN Monorepo API — http://localhost:5005")
    print(f"  Neo4j:          {'connected' if neo4j.available else 'unavailable'}")
    print(f"  Elasticsearch:  {'connected' if es.available else 'unavailable'}")
    print(f"  Sim devices:    {len(virtual_network.list_devices())}")
    print("=" * 60)
    print("  Start simulator first:  cd simulator && python simulator_manager.py")
    print("=" * 60)
    app.run(debug=True, host="0.0.0.0", port=5005, threaded=True)
