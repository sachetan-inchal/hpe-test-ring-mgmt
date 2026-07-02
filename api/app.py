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
import json
import logging
import os
import re
import sys
import threading
import time

# pyrefly: ignore [missing-import]
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
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

import networkx as nx
from integrations.data_faker import DataFaker
from integrations.json_store import JsonStore
from integrations.neo4j_runner import run_cypher as neo4j_run_cypher
from integrations.ontology_engine import OntologyLLMEngine, populate_graph
from integrations.rag_engine import RAGEngine
from integrations.san_agent import SanAgent
from integrations.san_autonomous_agent import SANAutonomousAgent


from integrations.spreadsheet_pipeline import SpreadsheetPipeline
from integrations.topology_db import TopologyDB

# ── Master API Logic (Merged from Editor) ──────────────────────────────────
from api.master_logic import proxy as master_proxy
from api.master_logic.topology_graph import topology_graph
from api.master_logic.universal_parser import parse_array_dump, parse_via_proxy
from api.parsers.parse_showcage import parse_showcage
from api.parsers.parse_showhost import parse_showhost
from api.parsers.parse_shownode import parse_shownode
from api.parsers.parse_showpd import parse_showpd
from api.parsers.parse_showport import parse_showport

# Import individual parsers
from api.parsers.parse_showsys import parse_showsys
from discovery.crawler import DiscoveryCrawler, discovery_crawler
from discovery.parsers import sim_parser
from discovery.parsers.sim_parser import parse_sim_array_output
from discovery.indexer import ElasticsearchIndexer
from discovery.neo4j_store import Neo4jStore
from discovery.mongo_store import MongoStore
from simulator.network_sim import virtual_network

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
mongo   = MongoStore()

# ── Log Ingest Manager (dual-mode TXT/JSON → backup → wipe → populate) ────────
from api.master_logic.log_ingest import LogIngestManager
_log_ingest = LogIngestManager(neo4j, mongo, es)

@app.before_request
def ensure_infrastructure():
    """Attempt to connect to services if they weren't ready at startup."""
    if not neo4j.available:
        neo4j._init_driver()
    if not es.available:
        es._init_client()
    if not mongo.available:
        mongo._init_client()

@app.before_request
def enforce_read_only_on_external_ips():
    """Block state-mutating calls from external IPs unless explicitly authenticated as admin."""
    if request.method in ("GET", "OPTIONS", "HEAD"):
        return
    
    # Check if request is local
    remote_ip = request.remote_addr
    is_local = remote_ip in ("127.0.0.1", "localhost", "::1")
    
    # Check if user has admin privileges
    role = request.headers.get("X-User-Role", "").strip().lower()
    
    if not is_local and role != "admin":
        # Allow AI chat/assistant routes to function normally
        allowed_paths = ("/api/chat", "/api/ontology/chat", "/api/v1/monorepo/chat")
        if any(p in request.path for p in allowed_paths):
            return
            
        return jsonify({
            "error": "Access Denied: This server is running in Read-Only mode for remote IP connections."
        }), 403



@app.after_request
def apply_rbac_filter(response):
    try:
        if request.method != "GET" or not request.path.startswith("/api"):
            return response
        if not response.content_type or "application/json" not in response.content_type.lower():
            return response

        actor = _get_actor_context()
        if _ROLE_ORDER.get(actor["role"], 0) >= _ROLE_ORDER[_ROLE_ADMIN]:
            return response

        payload = response.get_json(silent=True)
        if payload is None:
            return response

        filtered = _filter_graph_payload(payload, actor)
        response.set_data(json.dumps(filtered))
        response.headers["Content-Length"] = str(len(response.get_data()))
        return response
    except Exception as exc:
        log.warning(f"[rbac] filter skipped: {exc}")
        return response

FIELD_DEF_PATH = os.path.join(MONOREPO, "data", "field_definitions.json")
ALLOWED_CREATE_LABELS = frozenset({"Host", "Switch", "ArraySystem", "Cage", "Node", "PhysicalDisk"})

_ROLE_TEAM_MEMBER = "team_member"
_ROLE_MANAGER = "manager"
_ROLE_SENIOR_MANAGER = "senior_manager"
_ROLE_ADMIN = "admin"
_ROLE_ORDER = {
    _ROLE_TEAM_MEMBER: 1,
    _ROLE_MANAGER: 2,
    _ROLE_SENIOR_MANAGER: 3,
    _ROLE_ADMIN: 4,
}


def _split_csv(value):
    if not value:
        return []
    return [x.strip() for x in str(value).split(",") if x.strip()]


def _get_actor_context():
    role = (request.headers.get("X-User-Role") or _ROLE_TEAM_MEMBER).strip().lower()
    if role not in _ROLE_ORDER:
        role = _ROLE_TEAM_MEMBER
    team = (request.headers.get("X-User-Team") or "").strip()
    cluster = (request.headers.get("X-User-Cluster") or "").strip()
    # Safe fallback: never widen visibility when context headers are missing.
    if role != _ROLE_ADMIN:
        if not team:
            team = "team-alpha"
        if not cluster:
            cluster = "cluster-1"
    return {
        "id": request.headers.get("X-User-Id") or "",
        "role": role,
        "team": team,
        "cluster": cluster,
        "managed_teams": set(_split_csv(request.headers.get("X-User-Managed-Teams"))),
        "managed_clusters": set(_split_csv(request.headers.get("X-User-Managed-Clusters"))),
    }


def _extract_node_data(node):
    if isinstance(node, dict) and isinstance(node.get("data"), dict):
        return node["data"]
    return node if isinstance(node, dict) else {}


def _node_identifier(node):
    if not isinstance(node, dict):
        return None
    payload = _extract_node_data(node)
    return payload.get("id") or node.get("id")


def _node_team_and_cluster(node_payload):
    team = (
        node_payload.get("team")
        or node_payload.get("owner_team")
        or node_payload.get("access_team")
        or ""
    )
    cluster = (
        node_payload.get("cluster")
        or node_payload.get("owner_cluster")
        or node_payload.get("access_cluster")
        or ""
    )
    team = str(team).strip()
    cluster = str(cluster).strip()
    return team, cluster


def _node_parent_id(node_payload):
    return (
        node_payload.get("parentId")
        or node_payload.get("parent_id")
        or node_payload.get("parent")
        or ""
    )


def _can_view_scope(node_team, node_cluster, actor):
    role = actor["role"]
    if _ROLE_ORDER.get(role, 0) >= _ROLE_ORDER[_ROLE_ADMIN]:
        return True

    # Strict mode: unscoped nodes are not visible to non-admin users.
    if not node_team and not node_cluster:
        return False

    if role == _ROLE_SENIOR_MANAGER:
        allowed_clusters = set(actor["managed_clusters"])
        if actor["cluster"]:
            allowed_clusters.add(actor["cluster"])
        return bool(node_cluster and node_cluster in allowed_clusters)

    if role == _ROLE_MANAGER:
        allowed_teams = set(actor["managed_teams"])
        if actor["team"]:
            allowed_teams.add(actor["team"])
        if node_team and node_team in allowed_teams:
            return True
        return bool(node_cluster and actor["cluster"] and node_cluster == actor["cluster"])

    if role == _ROLE_TEAM_MEMBER:
        if node_team:
            return bool(actor["team"] and node_team == actor["team"])
        return bool(node_cluster and actor["cluster"] and node_cluster == actor["cluster"])

    return False


def _can_view_node(node_payload, actor):
    node_team, node_cluster = _node_team_and_cluster(node_payload)
    return _can_view_scope(node_team, node_cluster, actor)


def _edge_endpoints(edge):
    if not isinstance(edge, dict):
        return None, None
    if isinstance(edge.get("data"), dict):
        data = edge["data"]
        return data.get("source"), data.get("target")
    return edge.get("from") or edge.get("source"), edge.get("to") or edge.get("target")


def _filter_graph_payload(payload, actor):
    if not isinstance(payload, dict):
        return payload

    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return payload

    # 1. Load topology data and teamconfig.json to read configurations
    try:
        topo_data = _topology_db.get_topology()
    except Exception:
        topo_data = {"nodes": [], "edges": []}

    try:
        config_path = os.path.join(MONOREPO, "data", "ontology", "teamconfig.json")
        with open(config_path, "r", encoding="utf-8") as f:
            teamconfig = json.load(f)
    except Exception:
        teamconfig = {"teams": [], "clusters": []}

    teams_list = teamconfig.get("teams", [])
    clusters_list = teamconfig.get("clusters", [])
    has_custom_config = bool(teams_list or clusters_list)

    if has_custom_config:
        # 2. Build mapping dictionaries
        team_to_cluster = {}
        cluster_to_team = {}
        for t in teams_list:
            t_id = t.get("id")
            c_id = t.get("clusterId")
            if t_id and c_id:
                t_id_clean = t_id.strip().lower()
                c_id_clean = c_id.strip().lower()
                team_to_cluster[t_id_clean] = c_id_clean
                cluster_to_team[c_id_clean] = t_id  # Keep original casing if possible
                t_name = t.get("name")
                if t_name:
                    team_to_cluster[t_name.strip().lower()] = c_id_clean

        cluster_to_devices = {}
        device_to_cluster = {}
        for c in clusters_list:
            c_id = c.get("id")
            devices = c.get("devices", [])
            if c_id:
                c_id_clean = c_id.strip().lower()
                dev_set = {d.strip().upper() for d in devices}
                cluster_to_devices[c_id_clean] = dev_set
                for d in dev_set:
                    device_to_cluster[d] = c_id  # Keep original casing of cluster ID
                c_name = c.get("name")
                if c_name:
                    cluster_to_devices[c_name.strip().lower()] = dev_set

        # 3. Build parent map from the active database.json nodes
        parent_map = {}
        for n in topo_data.get("nodes", []):
            n_id = n.get("id")
            p_id = n.get("parentId")
            if n_id:
                parent_map[n_id.upper()] = p_id.upper() if p_id else None

        # Also build parent map from the payload nodes to handle dynamically generated/discovered nodes
        for n in nodes:
            node_data = _extract_node_data(n)
            n_id = node_data.get("id")
            p_id = node_data.get("parentId")
            if n_id:
                parent_map[n_id.upper()] = p_id.upper() if p_id else parent_map.get(n_id.upper())

        # Helper function to find root parent
        def get_root_ancestor(node_id):
            curr = node_id.upper()
            visited = set()
            while curr in parent_map and parent_map[curr] is not None:
                if curr in visited:
                    break
                visited.add(curr)
                curr = parent_map[curr]
            return curr

        # 4. Resolve the allowed clusters for this actor
        allowed_clusters = set()

        def add_team_clusters(team_name):
            if not team_name:
                return
            c_id = team_to_cluster.get(team_name.strip().lower())
            if c_id:
                allowed_clusters.add(c_id)

        role = actor["role"]

        if _ROLE_ORDER.get(role, 0) >= _ROLE_ORDER[_ROLE_ADMIN]:
            # Admin has access to all clusters
            for c in clusters_list:
                c_id = c.get("id")
                if c_id:
                    allowed_clusters.add(c_id.strip().lower())
        elif role == _ROLE_SENIOR_MANAGER:
            for c in actor["managed_clusters"]:
                if c:
                    allowed_clusters.add(c.strip().lower())
            if actor["cluster"]:
                allowed_clusters.add(actor["cluster"].strip().lower())
        elif role == _ROLE_MANAGER:
            for t in actor["managed_teams"]:
                add_team_clusters(t)
            add_team_clusters(actor["team"])
            if actor["cluster"]:
                allowed_clusters.add(actor["cluster"].strip().lower())
        elif role == _ROLE_TEAM_MEMBER:
            add_team_clusters(actor["team"])
            if actor["cluster"]:
                allowed_clusters.add(actor["cluster"].strip().lower())

        # 5. Get allowed device IDs
        allowed_device_ids = set()
        for c_id in allowed_clusters:
            devs = cluster_to_devices.get(c_id)
            if devs:
                allowed_device_ids.update(devs)

        # Build a lookup of allowed device names, serials, and IDs from database.json:
        allowed_names_or_serials = set()
        for d_id in allowed_device_ids:
            allowed_names_or_serials.add(d_id.upper())
            for n in topo_data.get("nodes", []):
                if n.get("id") and n.get("id").upper() == d_id.upper():
                    if n.get("name"):
                        allowed_names_or_serials.add(n.get("name").upper())
                    if n.get("serialNumber"):
                        allowed_names_or_serials.add(n.get("serialNumber").upper())

        # 6. View function to check if node_data is allowed
        def custom_can_view(node_data):
            node_id = node_data.get("id")
            if not node_id:
                return False
            
            if role == _ROLE_ADMIN:
                return True
                
            # If node has explicit team property, check it first
            node_team = (node_data.get("team") or node_data.get("owner_team") or "").strip().lower()
            node_cluster = (node_data.get("cluster") or "").strip().lower()
            
            user_team_clean = actor["team"].strip().lower()
            user_cluster_clean = actor["cluster"].strip().lower()
            
            if role == _ROLE_TEAM_MEMBER:
                if node_team and node_team == user_team_clean:
                    return True
                
                # Check derived cluster scope
                root_ancestor_id = get_root_ancestor(node_id)
                user_team_cluster = team_to_cluster.get(user_team_clean)
                if user_team_cluster:
                    allowed_devs = cluster_to_devices.get(user_team_cluster, set())
                    if root_ancestor_id.upper() in allowed_devs:
                        return True
                return False
                
            elif role == _ROLE_MANAGER:
                if node_cluster and node_cluster == user_cluster_clean:
                    return True
                if node_team:
                    resolved_node_cluster = team_to_cluster.get(node_team)
                    if resolved_node_cluster and resolved_node_cluster == user_cluster_clean:
                        return True
                        
                # Check derived cluster scope
                root_ancestor_id = get_root_ancestor(node_id)
                allowed_devs = cluster_to_devices.get(user_cluster_clean, set())
                if root_ancestor_id.upper() in allowed_devs:
                    return True
                return False
                
            elif role == _ROLE_SENIOR_MANAGER:
                allowed_clusters_sm = {c.strip().lower() for c in actor["managed_clusters"]}
                if user_cluster_clean:
                    allowed_clusters_sm.add(user_cluster_clean)
                if node_cluster and node_cluster in allowed_clusters_sm:
                    return True
                if node_team:
                    resolved_node_cluster = team_to_cluster.get(node_team)
                    if resolved_node_cluster and resolved_node_cluster in allowed_clusters_sm:
                        return True
                root_ancestor_id = get_root_ancestor(node_id)
                for c_id in allowed_clusters_sm:
                    if root_ancestor_id.upper() in cluster_to_devices.get(c_id, set()):
                        return True
                return False
                
            return False

        can_view_fn = custom_can_view
    else:
        device_to_cluster = {}
        cluster_to_team = {}
        def legacy_can_view(node_data):
            return _can_view_node(node_data, actor)
        can_view_fn = legacy_can_view

    allowed_nodes = []
    allowed_ids = set()
    for node in nodes:
        node_data = _extract_node_data(node)
        node_id = _node_identifier(node)
        if can_view_fn(node_data):
            allowed_nodes.append(node)
            if node_id:
                allowed_ids.add(node_id)
                # Enrich node with its dynamically resolved team & cluster so frontend renders it correctly!
                if has_custom_config:
                    root_ancestor = get_root_ancestor(node_id)
                    cluster_id = device_to_cluster.get(root_ancestor.upper())
                    if cluster_id:
                        team_id = cluster_to_team.get(cluster_id.lower())
                        
                        cluster_name = cluster_id
                        for c in clusters_list:
                            if c.get("id") == cluster_id:
                                cluster_name = c.get("name") or cluster_id
                                break
                        
                        team_name = team_id or ""
                        for t in teams_list:
                            if t.get("id") == team_id:
                                team_name = t.get("name") or team_id
                                break

                        if not node_data.get("cluster"):
                            node_data["cluster"] = cluster_name
                        if not node_data.get("team"):
                            node_data["team"] = team_name

    payload["nodes"] = allowed_nodes

    edges = payload.get("edges")
    if isinstance(edges, list):
        filtered_edges = []
        for edge in edges:
            src, tgt = _edge_endpoints(edge)
            if src in allowed_ids and tgt in allowed_ids:
                filtered_edges.append(edge)
        payload["edges"] = filtered_edges

    return payload


_real_neo4j = Neo4jStore(is_real=True)

class _Neo4jRagBridge:
    def run_cypher(self, query, params=None):
        if not _real_neo4j.available:
            _real_neo4j._init_driver()
        return _real_neo4j._run(query, **(params or {}))


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


def _san_agent_llm(system: str, user: str, use_ollama=False, disable_think=False, stream=False, json_mode=False, ollama_model=None, request_id=None):
    return _rag_engine._llm_call(system, user, use_ollama=use_ollama, disable_think=disable_think, stream=stream, json_mode=json_mode, ollama_model=ollama_model, request_id=request_id)


# Per-command parsers: api REST parsers + sim_parser (simulator / discovery)
_AGENT_PARSERS = {
    **_PARSERS,
    "showswitch": sim_parser.parse_showswitch,
    "showversion": sim_parser.parse_showversion,
    "showversion -b": sim_parser.parse_showversion,
    "showcage -state": sim_parser.parse_showcage_state,
    "showpd -s": sim_parser.parse_showpd_s,
    "showpd -i": sim_parser.parse_showpd_i,
    "showportdev": sim_parser.parse_showportdev_ns,
}

# ── Embedded Desktop Shell ────────────────────────────────────────────────────
class DesktopShell:
    """Manages a persistent interactive shell subprocess for the embedded browser terminal."""

    def __init__(self):
        self.proc        = None          # subprocess.Popen instance
        self.output_q    = None          # queue.Queue of str chunks for browser
        self.agent_qs    = []            # active listeners for run_command
        self._qs_lock    = threading.Lock()
        self._reader_t   = None          # background reader thread
        self._env        = None          # shell environment
        self._lock       = threading.Lock()

    def is_running(self):
        return self.proc is not None and self.proc.poll() is None

    def spawn(self):
        """Spawn (or respawn) the shell subprocess."""
        import sys, os, queue, subprocess
        self.kill()

        mock_cli_dir = os.path.abspath(os.path.join(MONOREPO, 'scratch', 'mock_hpe_cli'))
        env = os.environ.copy()
        
        # Ensure all casing variants of PATH exist in env so Windows subprocess picks it up 100% reliably
        existing_paths = [env.get(k) for k in env if k.upper() == 'PATH' if env.get(k)]
        base_path = existing_paths[0] if existing_paths else ''
        env['PATH'] = mock_cli_dir + os.pathsep + base_path
        env['Path'] = env['PATH']
        env['path'] = env['PATH']
        
        self._env = env

        if sys.platform == 'win32':
            shell_cmd = ['powershell.exe', '-NoLogo', '-NoExit']
        else:
            shell_cmd = ['bash', '--norc', '--noprofile', '-i']

        self.output_q = queue.Queue(maxsize=4096)
        with self._qs_lock:
            self.agent_qs = []

        self.proc = subprocess.Popen(
            shell_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            bufsize=0,
        )

        self._reader_t = threading.Thread(target=self._read_loop, daemon=True)
        self._reader_t.start()
        log.info('[DesktopShell] Shell spawned: %s', shell_cmd[0])

    def _read_loop(self):
        """Background thread: read raw bytes from shell stdout, decode and queue."""
        buf = b''
        while self.proc and self.proc.poll() is None:
            try:
                chunk = self.proc.stdout.read(1)
            except Exception:
                break
            if not chunk:
                break
            buf += chunk
            try:
                text = buf.decode('utf-8')
                buf = b''
            except UnicodeDecodeError:
                # If partial multi-byte UTF-8, wait for next byte (max 4 bytes for UTF-8)
                if len(buf) > 4:
                    text = buf.decode('utf-8', errors='replace')
                    buf = b''
                else:
                    text = ''
            except Exception:
                text = buf.decode('latin-1')
                buf = b''
                
            if text:
                # 1. Put in browser xterm stream
                try:
                    self.output_q.put_nowait(text)
                except Exception:
                    pass  # queue full
                
                # 2. Fan-out to any active run_command collectors
                with self._qs_lock:
                    for aq in self.agent_qs:
                        try:
                            aq.put_nowait(text)
                        except Exception:
                            pass
        log.info('[DesktopShell] Reader loop exited.')

    def write(self, data: str):
        """Send raw keyboard input to the shell stdin."""
        if not self.is_running():
            return
        try:
            # Map xterm.js backspace (\x7f) to Windows-native backspace (\x08)
            import sys
            if sys.platform == 'win32':
                data = data.replace('\x7f', '\x08')
            self.proc.stdin.write(data.encode('utf-8'))
            self.proc.stdin.flush()
        except Exception as e:
            log.warning('[DesktopShell] write error: %s', e)

    def run_command(self, cmd: str, timeout: float = 30.0) -> str:
        """Send a complete command line and collect its output (used by SAN agent)."""
        import sys, time, queue as _q

        if not self.is_running():
            return 'Error: Desktop shell is not running. Please reconnect via Gateway Settings.'

        # Create a temporary queue for this command execution
        aq = _q.Queue(maxsize=8192)
        with self._qs_lock:
            self.agent_qs.append(aq)

        # Use a sentinel to detect end-of-output
        sentinel = f'__SAN_DONE_{int(time.time()*1000)}__'
        if sys.platform == 'win32':
            full_cmd = f"{cmd}\r\nWrite-Host '{sentinel}'\r\n"
        else:
            full_cmd = f"{cmd}\necho '{sentinel}'\n"

        self.write(full_cmd)

        collected = []
        start = time.time()
        try:
            while time.time() - start < timeout:
                try:
                    chunk = aq.get(timeout=0.15)
                    collected.append(chunk)
                    combined = ''.join(collected)
                    if sentinel in combined:
                        combined = combined[:combined.index(sentinel)]
                        lines = combined.splitlines()
                        lines = [l for l in lines if cmd.strip() not in l]
                        return '\n'.join(lines).strip()
                except _q.Empty:
                    combined = ''.join(collected)
                    if sentinel in combined:
                        combined = combined[:combined.index(sentinel)]
                        lines = [l for l in combined.splitlines() if cmd.strip() not in l]
                        return '\n'.join(lines).strip()
        finally:
            # Clean up the queue
            with self._qs_lock:
                if aq in self.agent_qs:
                    self.agent_qs.remove(aq)

        return ''.join(collected).strip() or 'Error: Command timed out.'

    def kill(self):
        """Terminate the running shell."""
        if self.proc:
            try: self.proc.kill()
            except: pass
            self.proc = None
        log.info('[DesktopShell] Shell terminated.')


_desktop_shell = DesktopShell()

# ── ActiveTerminalGateway ──────────────────────────────────────────────────────
class ActiveTerminalGateway:
    def __init__(self):
        self.connection_type = "simulated"  # "simulated", "local", "ssh", "desktop"
        self.ssh_host = None
        self.ssh_username = None
        self.ssh_password = None
        self.execution_mode = "auto"  # "auto", "manual"
        self.selected_hwnd = None
        
        # Approval flow properties
        self.pending_command = None
        self.pending_ip = None
        self.approval_event = threading.Event()
        self.user_decision = None  # "approve", "reject"
        self.modified_command = None

import base64

def _encrypt_password(password: str) -> str:
    key = os.environ.get("SECRET_ENCRYPTION_KEY", "HPE_SECRET_KEY_2026")
    xored = "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(password))
    return base64.b64encode(xored.encode("utf-8", errors="ignore")).decode("utf-8")

def _decrypt_password(enc_password: str) -> str:
    try:
        key = os.environ.get("SECRET_ENCRYPTION_KEY", "HPE_SECRET_KEY_2026")
        decoded = base64.b64decode(enc_password.encode("utf-8")).decode("utf-8", errors="ignore")
        return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(decoded))
    except Exception:
        return enc_password

_terminal_gateway = ActiveTerminalGateway()


def resolve_dns(domain: str, dns_server: str) -> str:
    """Resolve a domain name using a specific DNS server IP via UDP."""
    import socket
    import struct
    if not dns_server:
        return socket.gethostbyname(domain)
    try:
        # Build raw DNS Query packet
        # Header: ID, Flags (RD=1), QDCOUNT=1, ANCOUNT=0, NSCOUNT=0, ARCOUNT=0
        packet = struct.pack(">HHHHHH", 0x1234, 0x0100, 1, 0, 0, 0)
        # Question: Name (split by labels), Type (A=1), Class (IN=1)
        for part in domain.split("."):
            packet += struct.pack("B", len(part)) + part.encode("utf-8")
        packet += struct.pack("BHH", 0, 1, 1)

        # Send/Receive over UDP
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(3.0)
        sock.sendto(packet, (dns_server, 53))
        data, _ = sock.recvfrom(512)
        sock.close()

        # Parse response
        offset = 12
        while True:
            length = data[offset]
            if length == 0:
                offset += 5  # skip null byte, QTYPE (2B), QCLASS (2B)
                break
            offset += 1 + length

        # Answers start here. We check first answer.
        if data[offset] & 0xc0 == 0xc0:
            offset += 2
        else:
            while True:
                length = data[offset]
                if length == 0:
                    offset += 1
                    break
                offset += 1 + length
        
        rtype, rclass, ttl, rdlen = struct.unpack(">HHIH", data[offset:offset+10])
        offset += 10
        if rtype == 1 and rdlen == 4:  # Type A, length 4
            ip = socket.inet_ntoa(data[offset:offset+4])
            return ip
    except Exception as e:
        print(f"DNS query failed: {e}")
    # Fallback to system resolver
    import socket
    return socket.gethostbyname(domain)


@app.route("/api/credentials/save", methods=["POST"])
def save_ssh_credentials():
    """Securely save host login credentials in MongoDB."""
    data = request.json or {}
    ip = data.get("ip") or data.get("ip_address")
    username = data.get("username")
    password = data.get("password")
    port = data.get("port", 22)
    device_name = data.get("device_name") or data.get("name")
    dns_name = data.get("dns_name", "")
    dns_server = data.get("dns_server", "")
    category = data.get("category", "Host")
    device_kind = data.get("device_kind", "real")
    vsan_device_type = data.get("vsan_device_type", "host")
    selected_commands = data.get("selected_commands", [])
    mock_commands = data.get("mock_commands", {})
    custom_commands = data.get("custom_commands", [])
    team = data.get("team", "team-alpha")
    oob_ip = data.get("oob_ip", "")
    connected_to = data.get("connected_to", "")
    
    if not ip and not dns_name:
        return jsonify({"error": "ip or dns_name is required"}), 400
        
    if device_kind == "real":
        if not username or password is None:
            return jsonify({"error": "username and password are required"}), 400
    else:
        # Mock device defaults
        username = username or "simulator"
        password = password or ""
        
    try:
        encrypted = _encrypt_password(password)
        if mongo.available:
            db = mongo.db
            db.ssh_credentials.update_one(
                {"ip": ip or dns_name, "port": int(port)},
                {"$set": {
                    "username": username,
                    "password": encrypted,
                    "device_name": device_name or ip or dns_name,
                    "dns_name": dns_name,
                    "dns_server": dns_server,
                    "category": category,
                    "device_kind": device_kind,
                    "vsan_device_type": vsan_device_type,
                    "selected_commands": selected_commands,
                    "custom_commands": custom_commands,
                    "mock_commands": mock_commands,
                    "team": team,
                    "oob_ip": oob_ip,
                    "connected_to": connected_to
                }},
                upsert=True
            )
            return jsonify({"status": "saved", "message": f"SSH credentials indexed for {ip or dns_name}:{port}"})
        return jsonify({"error": "MongoDB unavailable"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/teams", methods=["GET"])
def list_all_teams():
    """List all unique teams present in the topology or user database, along with their manager's name if any."""
    # Invalid/garbage team values to exclude
    INVALID_TEAMS = {"", "*", "none", "null", "undefined", "all", "all teams", "all-teams"}
    teams_set = set()
    try:
        if neo4j.available:
            results = neo4j._run("MATCH (n) WHERE n.team IS NOT NULL RETURN DISTINCT n.team AS team")
            for r in results:
                val = (r["team"] or "").strip()
                if val and val.lower() not in INVALID_TEAMS:
                    teams_set.add(val)
    except Exception as e:
        log.warning(f"Failed to fetch teams from Neo4j: {e}")
        
    user_list = []
    try:
        if mongo.available:
            users = list(mongo.db.users.find({}, {"username": 1, "team": 1, "name": 1, "role": 1, "managedTeams": 1}))
            for u in users:
                user_list.append(u)
                uteam = (u.get("team") or "").strip()
                if uteam and uteam.lower() not in INVALID_TEAMS:
                    teams_set.add(uteam)
                for mt in u.get("managedTeams", []):
                    mteam = (mt or "").strip()
                    if mteam and mteam.lower() not in INVALID_TEAMS:
                        teams_set.add(mteam)
    except Exception as e:
        log.warning(f"Failed to fetch teams from MongoDB: {e}")
        
    # Also check the dedicated teams collection for explicit team records
    try:
        if mongo.available:
            team_docs = list(mongo.db.teams.find({}, {"name": 1, "manager_username": 1, "manager_name": 1}))
            for td in team_docs:
                tname = (td.get("name") or "").strip()
                if tname and tname.lower() not in INVALID_TEAMS:
                    teams_set.add(tname)
    except Exception as e:
        log.warning(f"Failed to fetch teams collection: {e}")

    teams_data = []
    # Build a lookup of manager info from dedicated teams collection
    team_collection_map = {}
    try:
        if mongo.available:
            for td in mongo.db.teams.find({}, {"name": 1, "manager_username": 1, "manager_name": 1}):
                if td.get("name"):
                    team_collection_map[td["name"]] = td
    except Exception:
        pass

    for team_name in sorted(list(teams_set)):
        manager_name = ""
        manager_username = ""
        # First check dedicated teams collection
        if team_name in team_collection_map:
            td = team_collection_map[team_name]
            manager_username = td.get("manager_username", "")
            manager_name = td.get("manager_name", "")
        if not manager_name:
            # Fallback to scanning user list
            for u in user_list:
                u_role = u.get("role", "")
                if u_role in ("manager", "director"):
                    u_team = u.get("team", "")
                    u_managed = u.get("managedTeams", [])
                    if u_team == team_name or team_name in u_managed:
                        manager_name = u.get("name") or u.get("username") or ""
                        manager_username = u.get("username") or ""
                        break
        teams_data.append({
            "id": team_name.lower().replace(" ", "-"),
            "name": team_name,
            "manager_name": manager_name,
            "manager_username": manager_username
        })
        
    return jsonify({"teams": teams_data})
        
@app.route("/api/teams/create", methods=["POST"])
def create_team():
    """Admin endpoint to create a new team. Stores in a dedicated teams collection."""
    data = request.json or {}
    name = data.get("name")
    manager_username = (data.get("manager_username") or "").strip()
    
    if not name:
        return jsonify({"error": "name is required"}), 400
        
    name = name.strip()
    try:
        if mongo.available:
            db = mongo.db
            team_doc = {"name": name}
            if manager_username:
                team_doc["manager_username"] = manager_username
                mgr_user = db.users.find_one({"username": manager_username}, {"name": 1, "role": 1})
                if mgr_user:
                    team_doc["manager_name"] = mgr_user.get("name", manager_username)
                    if mgr_user.get("role") not in ("manager", "director", "admin"):
                        db.users.update_one({"username": manager_username}, {"$set": {"role": "manager"}})
            db.teams.update_one({"name": name}, {"$set": team_doc}, upsert=True)
            return jsonify({"status": "created", "message": f"Team '{name}' created successfully"})
        return jsonify({"error": "Databases unavailable"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/teams/update", methods=["POST"])
def update_team():
    """Admin endpoint to edit a team name and/or its manager."""
    data = request.json or {}
    old_name = data.get("old_name")
    new_name = data.get("new_name")
    manager_username = data.get("manager_username")
    
    if not old_name:
        return jsonify({"error": "old_name is required"}), 400
        
    old_name = old_name.strip()
    new_name = (new_name or old_name).strip()
    
    if new_name != old_name:
        try:
            if neo4j.available:
                neo4j._run(
                    "MATCH (n) WHERE n.team = $old SET n.team = $new",
                    old=old_name, new=new_name
                )
                neo4j._run(
                    "MATCH (n) WHERE n.owner_team = $old SET n.owner_team = $new",
                    old=old_name, new=new_name
                )
                neo4j._run(
                    "MATCH (n) WHERE n.access_team = $old SET n.access_team = $new",
                    old=old_name, new=new_name
                )
        except Exception as e:
            log.warning(f"Failed to update team name in Neo4j: {e}")
            
    try:
        if mongo.available:
            db = mongo.db
            if new_name != old_name:
                db.users.update_many({"team": old_name}, {"$set": {"team": new_name}})
                db.users.update_many(
                    {"managedTeams": old_name},
                    {"$set": {"managedTeams.$[elem]": new_name}},
                    array_filters=[{"elem": old_name}]
                )
                
            if manager_username:
                target_user = db.users.find_one({"username": manager_username.strip()})
                if target_user:
                    new_role = target_user.get("role")
                    if new_role not in ("manager", "director", "admin"):
                        new_role = "manager"
                    db.users.update_one(
                        {"username": manager_username.strip()},
                        {"$set": {
                            "team": new_name,
                            "role": new_role
                        }}
                    )
                else:
                    return jsonify({"error": f"User '{manager_username}' not found"}), 404
                    
            return jsonify({"status": "updated", "message": f"Team '{old_name}' updated successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    return jsonify({"error": "Databases unavailable"}), 503


@app.route("/api/teams/delete", methods=["POST"])
def delete_team():
    """Admin endpoint to delete a team."""
    data = request.json or {}
    name = data.get("name")
    
    if not name:
        return jsonify({"error": "name is required"}), 400
        
    name = name.strip()
    
    try:
        if neo4j.available:
            neo4j._run("MATCH (n) WHERE n.team = $name REMOVE n.team", name=name)
            neo4j._run("MATCH (n) WHERE n.owner_team = $name REMOVE n.owner_team", name=name)
            neo4j._run("MATCH (n) WHERE n.access_team = $name REMOVE n.access_team", name=name)
    except Exception as e:
        log.warning(f"Failed to remove team from Neo4j: {e}")
        
    try:
        if mongo.available:
            db = mongo.db
            # Delete from teams collection
            db.teams.delete_one({"name": name})
            
            # Check if any devices are mapped to this team, move them to 'deleted-team-devices'
            device_count = db.ssh_credentials.count_documents({"team": name})
            if device_count > 0:
                db.ssh_credentials.update_many({"team": name}, {"$set": {"team": "deleted-team-devices"}})
                # Ensure the 'deleted-team-devices' team exists in the teams collection
                db.teams.update_one(
                    {"name": "deleted-team-devices"},
                    {"$set": {"name": "deleted-team-devices", "manager_name": "System", "manager_username": "system"}},
                    upsert=True
                )
            
            # Cleanup users
            db.users.update_many({"team": name}, {"$set": {"team": "team-alpha"}})
            db.users.update_many({"managedTeams": name}, {"$pull": {"managedTeams": name}})
            
            return jsonify({"status": "deleted", "message": f"Team '{name}' deleted successfully. {device_count} devices moved to 'deleted-team-devices'."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    return jsonify({"error": "Databases unavailable"}), 503


@app.route("/api/credentials/list", methods=["GET"])
def list_ssh_credentials():
    """List all saved SSH credentials, decrypted for client use."""
    try:
        # Load topology mappings to detect parent switches/arrays
        topology_edges = []
        node_categories = {}
        if mongo.available:
            try:
                db = mongo.db
                for col in (db.sandatas, db.real_sandatas):
                    doc = col.find_one({})
                    if doc:
                        if "edges" in doc:
                            topology_edges.extend(doc["edges"])
                        if "nodes" in doc:
                            for n in doc["nodes"]:
                                if "data" in n and isinstance(n["data"], dict):
                                    nid = str(n["data"].get("id") or "").lower()
                                    cat = str(n["data"].get("category") or n["data"].get("label") or n["data"].get("type") or "").lower()
                                    name = str(n["data"].get("name") or "").lower()
                                else:
                                    nid = str(n.get("id") or "").lower()
                                    cat = str(n.get("category") or n.get("label") or n.get("type") or "").lower()
                                    name = str(n.get("name") or "").lower()
                                
                                norm_cat = "host"
                                if "array" in cat:
                                    norm_cat = "array"
                                elif "switch" in cat:
                                    norm_cat = "switch"
                                    
                                if nid:
                                    node_categories[nid] = norm_cat
                                if name:
                                    node_categories[name] = norm_cat
            except Exception as ex:
                log.warning(f"Failed to load node categories for connection mapping: {ex}")

        # Map child -> parent based on edges (Switch -> Array or Host -> Switch)
        detected_connections = {}
        for e in topology_edges:
            f = str(e.get("from") or e.get("source") or "").lower()
            t = str(e.get("to") or e.get("target") or "").lower()
            if f and t:
                f_cat = node_categories.get(f)
                t_cat = node_categories.get(t)
                
                if f_cat == "host" and t_cat == "switch":
                    detected_connections[f] = t
                elif t_cat == "host" and f_cat == "switch":
                    detected_connections[t] = f
                elif f_cat == "switch" and t_cat == "array":
                    detected_connections[f] = t
                elif t_cat == "switch" and f_cat == "array":
                    detected_connections[t] = f

        persisted = []
        if mongo.available:
            db = mongo.db
            creds = list(db.ssh_credentials.find({}))
            for c in creds:
                decrypted = _decrypt_password(c.get("password", ""))
                dev_name_lower = str(c.get("device_name") or "").lower()
                dev_ip_lower = str(c.get("ip") or "").lower()
                
                # Check stored connected_to first, fallback to detected
                connected_to = c.get("connected_to", "")
                if not connected_to:
                    connected_to = detected_connections.get(dev_name_lower) or detected_connections.get(dev_ip_lower) or ""
                    
                persisted.append({
                    "device_name": c.get("device_name") or c.get("ip"),
                    "ip_address": c.get("ip"),
                    "ip": c.get("ip"),
                    "username": c.get("username"),
                    "password": decrypted,
                    "port": c.get("port", 22),
                    "dns_name": c.get("dns_name", ""),
                    "dns_server": c.get("dns_server", ""),
                    "category": c.get("category", "Host"),
                    "device_kind": c.get("device_kind", "real"),
                    "vsan_device_type": c.get("vsan_device_type", "host"),
                    "selected_commands": c.get("selected_commands", []),
                    "custom_commands": c.get("custom_commands", []),
                    "mock_commands": c.get("mock_commands", {}),
                    "team": c.get("team", "team-alpha"),
                    "oob_ip": c.get("oob_ip", ""),
                    "connected_to": connected_to
                })

        # Inject simulator-derived mock devices
        injected = []
        try:
            sim_devices = virtual_network.list_devices()
            for d in sim_devices:
                ip = d.get("ip")
                name = d.get("name") or d.get("device_name") or ip
                category = d.get("type") or d.get("category") or "Host"
                if "array" in category.lower():
                    category = "Array"
                elif "switch" in category.lower():
                    category = "Switch"
                else:
                    category = "Host"

                dev_name_lower = name.lower()
                dev_ip_lower = ip.lower()
                connected_to = detected_connections.get(dev_name_lower) or detected_connections.get(dev_ip_lower) or ""

                injected.append({
                    "device_name": name,
                    "ip_address": ip,
                    "ip": ip,
                    "username": "simulator",
                    "password": "",
                    "port": 22,
                    "dns_name": "",
                    "dns_server": "",
                    "category": category,
                    "device_kind": "mock",
                    "vsan_device_type": category.lower(),
                    "selected_commands": [],
                    "custom_commands": [],
                    "mock_commands": {},
                    "connected_to": connected_to
                })
        except Exception as e:
            log.error(f"Failed to list simulator devices: {e}")

        # Merge by IP + Port so persisted entries win and do not overwrite each other.
        by_key = {f"{d.get('ip')}:{d.get('port', 22)}": d for d in injected if d.get("ip")}
        for d in persisted:
            if d.get("ip"):
                by_key[f"{d.get('ip')}:{d.get('port', 22)}"] = d

        devices = list(by_key.values())
        return jsonify({"devices": devices})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/credentials/delete", methods=["POST"])
def delete_ssh_credentials():
    """Delete saved SSH credentials."""
    data = request.json or {}
    ip = data.get("ip") or data.get("ip_address")
    device_name = data.get("device_name")
    port = data.get("port")
    
    if not ip and not device_name:
        return jsonify({"error": "ip or device_name is required"}), 400
        
    try:
        if mongo.available:
            db = mongo.db
            query = {}
            if ip:
                query["ip"] = ip
                if port is not None:
                    query["port"] = int(port)
            elif device_name:
                query["device_name"] = device_name
                
            res = db.ssh_credentials.delete_one(query)
            if res.deleted_count > 0:
                return jsonify({"status": "deleted", "message": "Credentials deleted successfully"})
            return jsonify({"error": "Credentials not found"}), 404
        return jsonify({"error": "MongoDB unavailable"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/credentials/status/<path:ip>", methods=["GET"])
def get_ssh_credentials_status(ip):
    """Check if credentials exist for a target IP without leaking plaintext passwords."""
    try:
        if mongo.available:
            db = mongo.db
            cred = db.ssh_credentials.find_one({"ip": ip})
            if cred:
                return jsonify({"ip": ip, "has_credentials": True, "username": cred.get("username")})
        return jsonify({"ip": ip, "has_credentials": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ssh/exec", methods=["POST"])
@app.route("/api/ssh-ring/exec", methods=["POST"])
def ssh_ring_exec():
    """Execute a CLI command on a real SSH device or a simulated/mock device."""
    data = request.json or {}
    ip = data.get("ip") or data.get("ip_address")
    command = data.get("command")
    commands = data.get("commands")
    username = data.get("username")
    password = data.get("password")
    port = int(data.get("port", 22))
    dns_name = data.get("dns_name")
    dns_server = data.get("dns_server")
    
    if dns_name:
        try:
            resolved_ip = resolve_dns(dns_name, dns_server)
            ip = resolved_ip
        except Exception as e:
            return jsonify({"error": f"Failed to resolve DNS {dns_name}: {e}"}), 400

    if not ip:
        return jsonify({"error": "IP or DNS Name is required"}), 400
        
    if not command and not commands:
        return jsonify({"error": "command or commands are required"}), 400
        
    if isinstance(commands, list):
        cmds_to_run = commands
    elif command:
        cmds_to_run = [command]
    else:
        cmds_to_run = []
        
    # Determine if this is a mock/simulated device
    is_mock = False
    mock_commands = {}
    if mongo.available:
        try:
            db = mongo.db
            cred = db.ssh_credentials.find_one({"$or": [{"ip": ip}, {"oob_ip": ip}]})
            if cred and cred.get("device_kind") == "mock":
                is_mock = True
                mock_commands = cred.get("mock_commands") or {}
        except Exception:
            pass

    # If it is an existing simulator device, it can be executed via SimulatorConnector
    is_sim = any(d.get("ip") == ip for d in virtual_network.list_devices())

    if is_mock or is_sim:
        from api.integrations.device_connector import SimulatorConnector
        results = {}
        for cmd in cmds_to_run:
            # 1. Check if there is an explicit mock command override in the database
            if is_mock and cmd in mock_commands:
                entry = mock_commands[cmd]
                results[cmd] = {
                    "stdout": entry.get("stdout", ""),
                    "stderr": entry.get("stderr", ""),
                    "exit_code": entry.get("exit_code", 0)
                }
            # 2. Otherwise, if it's a simulator device, fall back to SimulatorConnector
            elif is_sim:
                try:
                    connector = SimulatorConnector(virtual_network, ip)
                    res = connector.execute(cmd)
                    results[cmd] = {
                        "stdout": res.get("stdout", ""),
                        "stderr": res.get("stderr", ""),
                        "exit_code": res.get("exit_code", 0)
                    }
                except Exception as e:
                    results[cmd] = {"stdout": "", "stderr": str(e), "exit_code": 1}
            else:
                results[cmd] = {"stdout": "", "stderr": "Command not simulated", "exit_code": 1}
        
        first_cmd_output = ""
        if cmds_to_run:
            first_res = results.get(cmds_to_run[0], {})
            first_cmd_output = first_res.get("stdout", "") + first_res.get("stderr", "")
            
        return jsonify({
            "ip": ip,
            "command": command or (cmds_to_run[0] if cmds_to_run else ""),
            "output": first_cmd_output,
            "results": results
        })

    # Real SSH Execution
    if not username or not password:
        return jsonify({"error": "username and password are required for real SSH devices"}), 400

    try:
        from api.integrations.device_connector import SSHConnector
        connector = SSHConnector(host=ip, username=username, password=password, port=port)
        if connector.connect():
            results = {}
            for cmd in cmds_to_run:
                res = connector.execute(cmd)
                results[cmd] = {
                    "stdout": res.get("stdout", ""),
                    "stderr": res.get("stderr", ""),
                    "exit_code": res.get("exit_code", 0)
                }
            connector.disconnect()
            
            first_cmd_output = ""
            if cmds_to_run:
                first_res = results.get(cmds_to_run[0], {})
                first_cmd_output = first_res.get("stdout", "") + first_res.get("stderr", "")
                
            return jsonify({
                "ip": ip,
                "command": command or (cmds_to_run[0] if cmds_to_run else ""),
                "output": first_cmd_output,
                "results": results
            })
        else:
            return jsonify({
                "ip": ip,
                "command": command or (cmds_to_run[0] if cmds_to_run else ""),
                "output": f"SSH Connection Authentication Failure to {ip}",
                "error": f"SSH Connection Authentication Failure to {ip}"
            }), 401
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/discover", methods=["POST"])
@app.route("/api/ssh-ring/discover", methods=["POST"])
def ssh_ring_discover_all():
    """Discover all registered credentials by running command sets per category."""
    from api.integrations.device_connector import SimulatorConnector, SSHConnector
    PRESET_COMMANDS = {
        "Array": [
            "showversion -b", "showsys", "shownode", "showport", "showhost",
            "showcage -pci", "showcage -sfp", "showcage -state", "showpd",
            "showpd -s", "showpd -i", "showportdev",
            "showportdev ns -nohdtot 0:3:1", "showportdev ns -nohdtot 1:3:1"
        ],
        "Host": [
            "lscpu", "systool -c fc_host -v", "lspci -nnk"
        ],
        "Switch": [
            "fabricshow", "switchshow"
        ]
    }
    data = request.json or {}
    commands_override = data.get("commands")
    commands_by_device = data.get("commands_by_device") or {}
    commands_by_category = data.get("commands_by_category") or {}
    target_ips = data.get("ips")

    # Load credentials using the list_ssh_credentials logic
    devices_resp = list_ssh_credentials()
    creds = devices_resp.get_json().get("devices", [])
    if not creds:
        return jsonify({"error": "No credentials registered"}), 400

    if target_ips:
        # Filter to only the selected device IPs
        creds = [c for c in creds if c.get("ip_address") in target_ips or c.get("ip") in target_ips]
        if not creds:
            return jsonify({"error": "None of the selected devices have registered credentials"}), 400

    all_results = []
    for d in creds:
        device_name = d.get("device_name") or d.get("ip_address") or "unknown"
        ip = d.get("ip_address") or d.get("ip") or d.get("dns_name")
        category = d.get("category") or "Host"
        username = d.get("username")
        password = d.get("password")
        port = int(d.get("port", 22))
        device_kind = d.get("device_kind", "real")
        mock_commands = d.get("mock_commands") or {}

        presets = None
        if isinstance(commands_override, list):
            presets = commands_override
        elif commands_by_device:
            presets = commands_by_device.get(ip) or commands_by_device.get(d.get("dns_name") or "")
        if not presets:
            presets = d.get("selected_commands")
        if not presets:
            if commands_by_category and isinstance(commands_by_category, dict):
                presets = commands_by_category.get(category)
        if not presets:
            presets = PRESET_COMMANDS.get(category) or []

        device_result = {
            "device_name": device_name,
            "ip": ip,
            "category": category,
            "status": "pending",
            "commands": {},
            "error": None,
        }

        try:
            device_result["status"] = "running"
            if not presets:
                device_result["status"] = "warning"
                all_results.append(device_result)
                continue

            results = {}
            is_sim = any(sim_d.get("ip") == ip for sim_d in virtual_network.list_devices())

            for cmd in presets:
                if device_kind == "mock" and cmd in mock_commands:
                    entry = mock_commands[cmd]
                    results[cmd] = {
                        "stdout": entry.get("stdout", ""),
                        "stderr": entry.get("stderr", ""),
                        "exit_code": entry.get("exit_code", 0)
                    }
                elif device_kind == "mock" or is_sim:
                    # Fallback to SimulatorConnector if it's virtual/simulated
                    try:
                        connector = SimulatorConnector(virtual_network, ip)
                        res = connector.execute(cmd)
                        results[cmd] = {
                            "stdout": res.get("stdout", ""),
                            "stderr": res.get("stderr", ""),
                            "exit_code": res.get("exit_code", 0)
                        }
                    except Exception as e:
                        results[cmd] = {"stdout": "", "stderr": str(e), "exit_code": 1}
                else:
                    # Real SSH Execution
                    from api.integrations.device_connector import SSHConnector
                    connector = SSHConnector(host=ip, username=username, password=password, port=port)
                    if connector.connect():
                        res = connector.execute(cmd)
                        results[cmd] = {
                            "stdout": res.get("stdout", ""),
                            "stderr": res.get("stderr", ""),
                            "exit_code": res.get("exit_code", 0)
                        }
                        connector.disconnect()
                    else:
                        results[cmd] = {"stdout": "", "stderr": "SSH Connection Failure", "exit_code": -1}

            # mark warning if any stderr / nonzero exit
            status = "success"
            for cmd, r in results.items():
                if (r.get("stderr") or "").strip():
                    status = "warning"
                    break
                if r.get("exit_code") not in (None, 0):
                    status = "warning"
                    break

            device_result["commands"] = results
            device_result["status"] = status

            # If it is a real device, parse and save it exclusively!
            if device_kind == "real" and status == "success":
                raw_outputs = {cmd: r.get("stdout", "") for cmd, r in results.items()}
                parsed = None
                
                if category == "Array":
                    try:
                        from discovery.parsers.sim_parser import parse_sim_array_output
                        parsed = parse_sim_array_output(raw_outputs)
                        parsed["_ip"] = ip
                        parsed["_device_type"] = "hpe_array"
                    except Exception as pe:
                        log.error(f"Failed to parse real Array output: {pe}")
                elif category == "Host":
                    is_windows = "windows" in (results.get("systeminfo") or {}).get("stdout", "").lower()
                    try:
                        if is_windows:
                            from discovery.parsers.windows_parser import parse_windows_output
                            parsed = parse_windows_output(raw_outputs, ip=ip)
                            parsed["_ip"] = ip
                            parsed["_device_type"] = "windows_host"
                        else:
                            from discovery.parsers.linux_parser import parse_linux_output
                            parsed = parse_linux_output(raw_outputs, ip=ip)
                            parsed["_ip"] = ip
                            parsed["_device_type"] = "linux_host"
                    except Exception as pe:
                        log.error(f"Failed to parse real Host output: {pe}")
                
                if parsed:
                    try:
                        from discovery.neo4j_store import Neo4jStore
                        from discovery.mongo_store import MongoStore
                        
                        real_neo4j = Neo4jStore(is_real=True)
                        real_mongo = MongoStore(is_real=True)
                        
                        if real_neo4j.available:
                            real_neo4j.store(parsed)
                        if real_mongo.available:
                            real_mongo.load_existing_state()
                            real_mongo.store(parsed)
                        log.info(f"Successfully stored real device {device_name} ({ip}) to real_sandatas and Real Neo4j labels")
                    except Exception as se:
                        log.error(f"Failed to save real device to stores: {se}")

        except Exception as e:
            device_result["status"] = "error"
            device_result["error"] = str(e)

        all_results.append(device_result)

    from datetime import datetime
    return jsonify({
        "status": "complete",
        "results": all_results,
        "discovered_at": datetime.utcnow().isoformat() + "Z"
    })


def _san_agent_executor(ip, cmd):
    # Check if we are in manual approval mode
    if _terminal_gateway.execution_mode == "manual":
        # Clear previous state
        _terminal_gateway.pending_command = cmd
        _terminal_gateway.pending_ip = ip
        _terminal_gateway.user_decision = None
        _terminal_gateway.modified_command = None
        _terminal_gateway.approval_event.clear()
        
        # Wait until user decision is set
        print(f"[TerminalGateway] Pausing execution. Waiting for approval of: {cmd} on {ip}")
        _terminal_gateway.approval_event.wait()
        
        pending_cmd = _terminal_gateway.pending_command
        _terminal_gateway.pending_command = None
        _terminal_gateway.pending_ip = None
        
        if _terminal_gateway.user_decision == "reject":
            return "Command execution rejected by user."
            
        cmd_to_run = _terminal_gateway.modified_command or pending_cmd
    else:
        cmd_to_run = cmd

    # Check if this IP/Name is in Mongo ssh_credentials and is a real device
    is_real = False
    username = "root"
    password = None
    port = 22
    if mongo.available:
        try:
            db = mongo.db
            cred = db.ssh_credentials.find_one({
                "$or": [
                    {"ip": ip},
                    {"ip_address": ip},
                    {"oob_ip": ip},
                    {"device_name": ip}
                ]
            })
            if cred:
                is_real = (cred.get("device_kind") == "real")
                username = cred.get("username", username)
                password = _decrypt_password(cred.get("password")) if cred.get("password") else None
                port = int(cred.get("port", port))
        except Exception as e:
            log.warning(f"Database lookup for credentials failed: {e}")

    if is_real:
        from api.integrations.device_connector import SSHConnector
        if not password:
            password = "root"
        connector = SSHConnector(
            host=ip,
            username=username,
            password=password,
            port=port
        )
        if connector.connect():
            res = connector.execute(cmd_to_run)
            connector.disconnect()
            return res.get("stdout", "") + "\n" + res.get("stderr", "")
        else:
            return f"SSH Connection Authentication Failure to {ip}"
    else:
        # Fall back to SimulatorConnector
        from api.integrations.device_connector import SimulatorConnector
        connector = SimulatorConnector(virtual_network, ip)
        res = connector.execute(cmd_to_run)
        return res.get("stdout", "")


def _san_agent_list_devices():
    devices = virtual_network.list_devices() or []
    if mongo.available:
        try:
            creds = list(mongo.db.ssh_credentials.find({}))
            for c in creds:
                ip = c.get("ip") or c.get("ip_address") or c.get("oob_ip")
                name = c.get("device_name") or ip
                if not ip:
                    continue
                # Prevent duplication if already present
                if not any(d.get("ip") == ip or d.get("name") == name for d in devices):
                    devices.append({
                        "id": name,
                        "name": name,
                        "ip": ip,
                        "device_kind": c.get("device_kind", "real"),
                        "virtual": (c.get("device_kind") == "mock"),
                        "username": c.get("username", "root"),
                        "port": int(c.get("port", 22))
                    })
        except Exception as e:
            log.warning(f"Failed to append mongo credentials to list_devices: {e}")
    return devices


_san_agent = SanAgent(
    execute_fn=_san_agent_executor,
    list_devices_fn=_san_agent_list_devices,
    neo4j_store=neo4j,
    run_cypher_fn=lambda q, params=None: neo4j_run_cypher(neo4j, q, params),
    llm_call=_san_agent_llm,
    command_parsers=_AGENT_PARSERS,
    parse_array_outputs=parse_sim_array_output,
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
        s.update({"ingest_os", "rack_location", "fc_support", "notes", "team", "cluster", "owner_team", "owner_cluster"})
        return s
    except Exception:
        return {"name", "model", "serial", "ip_address", "is_decommissioned", "team", "cluster", "owner_team", "owner_cluster"}


def _valid_prop_key(k):
    return isinstance(k, str) and re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", k)


# Inject stores into crawler singleton
discovery_crawler.neo4j = neo4j
discovery_crawler.es    = es
discovery_crawler.mongo = mongo

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

@app.route("/api/graph/neo4j")
def legacy_graph_alias():
    # Force a re-check if it's currently unavailable
    if not neo4j.available:
        neo4j._init_driver()
    return neo4j_graph()

def fake_san():
    data = request.json or {}
    arrays_count = int(data.get("arrays", 2))
    switches_count = int(data.get("switches", 2))
    hosts_count = int(data.get("hosts", 4))
    disks_per_array = int(data.get("disks_per_array", 6))
    name_prefix = str(data.get("name_prefix", "HPESYN")).strip() or "HPESYN"

    nodes = []
    edges = []

    # 1. Generate ArraySystems
    for i in range(1, arrays_count + 1):
        arr_id = f"{name_prefix}-ARR-{i:02d}"
        nodes.append({
            "data": {
                "id": arr_id,
                "label": "ArraySystem",
                "name": f"{name_prefix}-Array-{i}",
                "ip_address": f"10.10.{i}.10",
                "model": "HPE Alletra Storage MP",
                "serial": f"SN-ARR-{i}"
            }
        })
        # 2. Controllers (Node) for each ArraySystem
        for idx in range(2):
            node_id = f"{arr_id}-NODE-{idx}"
            nodes.append({
                "data": {
                    "id": node_id,
                    "label": "Node",
                    "name": f"Controller-{idx}",
                    "parentId": arr_id,
                    "node_id": str(idx)
                }
            })
            edges.append({
                "data": {
                    "source": arr_id,
                    "target": node_id,
                    "label": "HAS_NODE"
                }
            })
        # 3. Cage
        cage_id = f"{arr_id}-CAGE-0"
        nodes.append({
            "data": {
                "id": cage_id,
                "label": "Cage",
                "name": "Cage-0",
                "parentId": arr_id,
                "cage_id": "0"
            }
        })
        edges.append({
            "data": {
                "source": arr_id,
                "target": cage_id,
                "label": "HAS_CAGE"
            }
        })
        # 4. Disks in Cage
        for d in range(disks_per_array):
            disk_id = f"{cage_id}-DISK-{d:02d}"
            nodes.append({
                "data": {
                    "id": disk_id,
                    "label": "PhysicalDisk",
                    "name": f"Disk-{d}",
                    "parentId": cage_id,
                    "serial": f"SN-DSK-{i}-{d}"
                }
            })
            edges.append({
                "data": {
                    "source": cage_id,
                    "target": disk_id,
                    "label": "CONTAINS"
                }
            })

    # 5. Generate Switches
    for s in range(1, switches_count + 1):
        sw_id = f"{name_prefix}-SW-{s:02d}"
        nodes.append({
            "data": {
                "id": sw_id,
                "label": "Switch",
                "name": f"{name_prefix}-Switch-{s}",
                "serial": f"SN-SW-{s}",
                "temperature": 35
            }
        })
        # Connect to ArraySystems
        for i in range(1, arrays_count + 1):
            arr_id = f"{name_prefix}-ARR-{i:02d}"
            edges.append({
                "data": {
                    "source": arr_id,
                    "target": sw_id,
                    "label": "HAS_SWITCH"
                }
            })

    # 6. Generate Hosts
    for h in range(1, hosts_count + 1):
        h_id = f"{name_prefix}-HOST-{h:02d}"
        nodes.append({
            "data": {
                "id": h_id,
                "label": "Host",
                "name": f"{name_prefix}-Host-{h}",
                "ip_address": f"10.20.{h}.10",
                "wwn": f"10:00:00:00:00:00:00:{h:02x}"
            }
        })
        # Connect to round-robin Switch
        sw_idx = ((h - 1) % switches_count) + 1
        sw_id = f"{name_prefix}-SW-{sw_idx:02d}"
        edges.append({
            "data": {
                "source": sw_id,
                "target": h_id,
                "label": "HAS_HOST"
            }
        })
        # Connect to round-robin ArraySystem
        arr_idx = ((h - 1) % arrays_count) + 1
        arr_id = f"{name_prefix}-ARR-{arr_idx:02d}"
        edges.append({
            "data": {
                "source": h_id,
                "target": arr_id,
                "label": "CONNECTS_TO"
            }
        })

    return jsonify({
        "topology": {
            "nodes": nodes,
            "edges": edges
        }
    })


@app.route("/api/faker/san", methods=["POST"])
def api_faker_san():
    return fake_san()


@app.route("/api/faker/import", methods=["POST"])
def api_faker_import():
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available"}), 503
    topology = request.json or {}
    nodes = topology.get("nodes", [])
    edges = topology.get("edges", [])

    nodes_created = 0
    edges_created = 0

    try:
        # Import Nodes
        for node in nodes:
            data = node.get("data", {})
            node_id = data.get("id")
            label = data.get("label")
            if not node_id or not label:
                continue
            
            # Clean properties
            props = {k: v for k, v in data.items() if k not in ("id", "label")}
            
            # Merge Node in Neo4j safely
            if label in ("ArraySystem", "Node", "Switch", "Host", "Cage", "PhysicalDisk"):
                cypher = f"MERGE (n:{label} {{id: $node_id}}) SET n += $props RETURN elementId(n)"
                neo4j._run(cypher, node_id=node_id, props=props)
                nodes_created += 1

        # Import Edges
        for edge in edges:
            data = edge.get("data", {})
            source = data.get("source")
            target = data.get("target")
            rel = data.get("label")
            if not source or not target or not rel:
                continue

            if rel in ("HAS_NODE", "HAS_CAGE", "CONTAINS", "HAS_SWITCH", "HAS_HOST", "CONNECTS_TO"):
                cypher = f"MATCH (a), (b) WHERE a.id = $source AND b.id = $target MERGE (a)-[r:{rel}]->(b) RETURN elementId(r)"
                neo4j._run(cypher, source=source, target=target)
                edges_created += 1

        return jsonify({
            "status": "success",
            "nodes_created": nodes_created,
            "edges_created": edges_created
        })
    except Exception as ex:
        log.exception("Importing fake topology failed")
        return jsonify({"error": str(ex)}), 500


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

@app.route("/api/sim/mock-topology", methods=["GET"])
def sim_mock_topology():
    import json
    import os
    filepath = os.path.join(MONOREPO, "simulator", "data", "network_meta", "network_topology.json")
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        nodes = []
        edges = []
        for arr in data.get('arrays', []):
            arr_id = arr['ip_address']
            nodes.append({
                'id': arr_id, 'name': arr['name'], 'type': 'Array', 'status': 'normal', 'category': 'main',
                'model': arr.get('model'), 'serialNumber': arr.get('serial')
            })
            for sw in arr.get('switches', []):
                sw_id = sw['ip_address']
                nodes.append({'id': sw_id, 'name': sw['name'], 'type': 'Switch', 'status': 'normal', 'category': 'main'})
                edges.append({'from': arr_id, 'to': sw_id, 'label': 'HAS_SWITCH'})
            for h in arr.get('hosts', []):
                h_id = h['ip_address']
                nodes.append({'id': h_id, 'name': h['name'], 'type': 'Host', 'status': 'normal', 'category': 'main', 'os_type': h.get('os_type')})
                edges.append({'from': sw['ip_address'] if arr.get('switches') else arr_id, 'to': h_id, 'label': 'HAS_HOST'})
        return jsonify({"nodes": nodes, "edges": edges})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/sim/status", methods=["GET"])
def sim_status():
    proxied = _proxy_to_sim("/sim/status")
    if proxied is not None:
        return jsonify(proxied)
    
    count = len(virtual_network.list_devices())
    return jsonify({"status": "running" if count > 0 else "idle", "device_count": count})

@app.route("/api/sim/ssh/connect/<path:ip>", methods=["GET"])
def sim_ssh_connect(ip):
    """Return SSH handshake metadata for a simulated device."""
    proxied = _proxy_to_sim(f"/sim/ssh/connect/{ip}")
    if proxied is not None:
        return jsonify(proxied)
    # Fallback: synthesize from virtual_network metadata
    meta = virtual_network.get_metadata(ip)
    if not meta:
        return jsonify({"error": f"No device at {ip}"}), 404
    name = meta.get("name", ip)
    key_type = meta.get("ssh_key_type")
    login_user = meta.get("login_user", "root")
    dev_type = meta.get("type", "host")
    prompt = meta.get("prompt", "$ ")
    lines = []
    if key_type:
        lines.append(f"Warning: the {key_type} host key for '{name}' differs from the key for the IP address '{ip}'")
        lines.append("Are you sure you want to continue connecting (yes/no)?")
        lines.append("")
    password_prompt = "Password:" if dev_type == "array" else f"{login_user}@{name}'s password:"
    return jsonify({
        "name": name, "ip": ip, "type": dev_type,
        "key_type": key_type, "login_user": login_user,
        "prompt": prompt, "handshake_lines": lines,
        "password_prompt": password_prompt,
    })

# ── Discovery endpoints ───────────────────────────────────────────────────────

@app.route("/api/discover", methods=["POST"])
def start_discovery():
    """Start BFS discovery.
    Body: {"seed_ips": ["10.20.10.5"]} or {"seed_ip": "10.20.10.5"}
    """
    data = request.json or {}
    seed_ips = data.get("seed_ips") or [data.get("seed_ip", "10.20.10.5")]
    delay_ms = data.get("delay_ms", 20)
    commands = data.get("commands")

    if discovery_crawler.running:
        return jsonify({"error": "Discovery already running"}), 409

    def _run():
        discovery_crawler.discover(seed_ips, delay_ms=delay_ms, commands=commands)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"status": "started", "seed_ips": seed_ips})

@app.route("/api/discover/cancel", methods=["POST"])
def cancel_discovery():
    """Cancel the active BFS discovery process."""
    if not discovery_crawler.running:
        return jsonify({"message": "Discovery is not running"}), 200
    discovery_crawler.cancel()
    return jsonify({"status": "cancelled", "message": "Discovery cancellation request sent successfully"})

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

@app.route("/api/diagnostics/report", methods=["GET"])
def get_diagnostics_report():
    """Retrieve SAN topology health diagnostics and AI troubleshooting guidelines."""
    from integrations.diagnostics import SANDiagnostics
    # Run diagnostics using current databases and the registered LLM caller
    diag = SANDiagnostics(neo4j_store=neo4j, mongo_store=mongo, llm_fn=_san_agent_llm)
    return jsonify(diag.generate_diagnostic_report())

@app.route("/api/discover/ingest", methods=["POST"])
def ingest_log_discovery():
    """Upload a .txt log file and start discovery from it."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files['file']
    if not f.filename.endswith('.txt'):
        return jsonify({"error": "Only .txt files allowed"}), 400
    
    # Save to simulator/data/devices
    safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', f.filename.replace('.txt', ''))
    filename = f"{safe_name}.txt"
    dest = os.path.join(MONOREPO, "simulator", "data", "devices", filename)
    f.save(dest)
    
    # Register a fake IP for this file
    import random
    fake_ip = f"10.255.{random.randint(1,254)}.{random.randint(1,254)}"
    from api.master_logic.proxy import DEVICE_REGISTRY
    DEVICE_REGISTRY[fake_ip] = filename
    
    # Start discovery
    def _run():
        discovery_crawler.discover([fake_ip], delay_ms=100) # Slower for better animation
    threading.Thread(target=_run, daemon=True).start()
    
    return jsonify({"status": "ingested", "ip": fake_ip, "filename": filename})

@app.route("/api/graph/wipe", methods=["POST"])
def wipe_graph():
    """Clear all nodes and edges from Neo4j."""
    if not neo4j.available:
        return jsonify({"error": "Neo4j not available"}), 503
    try:
        neo4j._run("MATCH (n) DETACH DELETE n")
        return jsonify({"status": "cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Log File Ingest (dual-mode TXT / JSON) ─────────────────────────────────────

@app.route("/api/ingest/log", methods=["POST"])
def ingest_log():
    """
    Dual-mode log file ingest.

    Accepts either:
      - multipart file upload  (field name: 'file', extension .txt or .json)
      - JSON body              {"mode": "json", "data": [...]}
      - plain-text body        (Content-Type: text/plain)

    On success:
      1. Creates a backup of current Neo4j + MongoDB + ES  (→ backup_id)
      2. Wipes all 3 databases
      3. Parses the upload and populates all 3 databases
      4. Returns stats + backup_id so the operation can be reversed
    """
    try:
        skip_backup = request.args.get("skip_backup", "false").lower() == "true"

        # ── Multipart file upload ──
        if request.files and "file" in request.files:
            f = request.files["file"]
            fname = (f.filename or "").lower()
            raw = f.read().decode("utf-8", errors="replace")
            filename_label = f"📋 Ingest: {f.filename}"

            if fname.endswith(".json"):
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError as e:
                    return jsonify({"error": f"Invalid JSON: {e}"}), 400
                result = _log_ingest.ingest(json_data=data, skip_backup=skip_backup, snapshot_label=filename_label)
            else:  # treat as TXT
                result = _log_ingest.ingest(raw_text=raw, skip_backup=skip_backup, snapshot_label=filename_label)
            return jsonify(result)

        # ── JSON body  {"mode": "json", "data": [...]} ──
        body = request.get_json(silent=True)
        if body and "data" in body:
            body_label = f"📋 JSON Ingest ({datetime.now().strftime('%H:%M:%S')})"
            result = _log_ingest.ingest(json_data=body["data"], skip_backup=skip_backup, snapshot_label=body_label)
            return jsonify(result)

        # ── Plain-text body ──
        raw = request.data.decode("utf-8", errors="replace").strip()
        if raw:
            ct = request.content_type or ""
            body_label = f"📋 Plain Ingest ({datetime.now().strftime('%H:%M:%S')})"
            if "json" in ct:
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError as e:
                    return jsonify({"error": f"Invalid JSON: {e}"}), 400
                result = _log_ingest.ingest(json_data=data, skip_backup=skip_backup, snapshot_label=body_label)
            else:
                result = _log_ingest.ingest(raw_text=raw, skip_backup=skip_backup, snapshot_label=body_label)
            return jsonify(result)

        return jsonify({"error": "No file or body provided. Send a .txt or .json file as multipart, or JSON/text body."}), 400

    except Exception as ex:
        log.exception("ingest_log failed")
        return jsonify({"error": str(ex)}), 500


def split_into_dynamic_chunks(raw_text, max_chunk_size=15000):
    import re
    cmd_pattern = re.compile(
        r'^(?:\+\s*|[\w.-]+@[\w.-]+.*?[~#$]\s*|cli%\s*|#\s*)?'
        r'(showversion|showsys|shownode|showswitch|showport|showhost|showcage|showpd|lscpu|showvv|showld|showvlun|showdomain|showuser|cat\s+|vi\s+|chmod\s+|\./)\b',
        re.IGNORECASE
    )
    
    lines = raw_text.splitlines()
    blocks = []
    current_block = []
    
    for line in lines:
        if cmd_pattern.match(line) and current_block:
            blocks.append("\n".join(current_block))
            current_block = []
        current_block.append(line)
        
    if current_block:
        blocks.append("\n".join(current_block))
        
    # Dynamically scale max_chunk_size to fit the largest command block,
    # ensuring that we never split a table/command output in half.
    if blocks:
        largest_block_size = max(len(b) for b in blocks)
        if largest_block_size > max_chunk_size:
            max_chunk_size = largest_block_size + 100
        
    chunks = []
    current_chunk = []
    current_chunk_len = 0
    
    for block in blocks:
        block_len = len(block)
        if current_chunk_len + block_len + 1 <= max_chunk_size:
            current_chunk.append(block)
            current_chunk_len += block_len + 1
        else:
            if current_chunk:
                chunks.append("\n".join(current_chunk))
                current_chunk = []
                current_chunk_len = 0
            
            if block_len > max_chunk_size:
                block_lines = block.splitlines()
                sub_chunk = []
                sub_chunk_len = 0
                for bline in block_lines:
                    bline_len = len(bline)
                    if sub_chunk_len + bline_len + 1 <= max_chunk_size:
                        sub_chunk.append(bline)
                        sub_chunk_len += bline_len + 1
                    else:
                        if sub_chunk:
                            chunks.append("\n".join(sub_chunk))
                        sub_chunk = [bline]
                        sub_chunk_len = bline_len + 1
                if sub_chunk:
                    chunks.append("\n".join(sub_chunk))
            else:
                current_chunk.append(block)
                current_chunk_len = block_len
                
    if current_chunk:
        chunks.append("\n".join(current_chunk))
        
    return chunks


def _update_ontology_db(all_arrays, source_label=None, source_id=None):
    try:
        from integrations.topology_db import TopologyDB
        from datetime import datetime as _dt
        tdb = TopologyDB()

        # ── Generate source metadata ─────────────────────────────────────
        ts = _dt.now().strftime('%Y%m%d_%H%M%S')
        if not source_id:
            slug = re.sub(r'[^a-z0-9]+', '_', (source_label or 'ingest').lower())[:30].strip('_')
            source_id = f"src_{slug}_{ts}"
        if not source_label:
            source_label = f"Ingest {ts}"

        # ── Read existing database (APPEND mode) ──────────────────────────
        existing = tdb._read()
        existing_nodes = existing.get("nodes", [])
        existing_edges = existing.get("edges", [])
        existing_sources = existing.get("sources", [])
        existing_node_ids = {str(n.get("id")) for n in existing_nodes}

        new_nodes = []
        new_edges = []
        added_new_ids = set()

        def add_node_safe(node):
            nid = node.get("id")
            sid = str(nid)
            if nid not in added_new_ids and sid not in existing_node_ids:
                node["sourceId"] = source_id
                new_nodes.append(node)
                added_new_ids.add(nid)
                existing_node_ids.add(sid)
                
        for idx, arr in enumerate(all_arrays):
            if not isinstance(arr, dict):
                continue
                
            arr_serial = arr.get("serial") or arr.get("array_id") or f"SN_{idx+1}"
            arr_name = arr.get("name") or f"SAN-ARRAY-{idx+1}"
            arr_id = arr.get("array_id") or f"ARR-{arr_serial}"
            
            total_cap = arr.get("total_cap_mib", 0) or arr.get("total_cap", 0) or 0
            alloc_cap = arr.get("alloc_cap_mib", 0) or arr.get("alloc_cap", 0) or 0
            free_cap = arr.get("free_cap_mib", 0) or arr.get("free_cap", 0) or 0
            
            total_tb = round(total_cap / 1024 / 1024, 2) if total_cap else 500.0
            used_tb = round(alloc_cap / 1024 / 1024, 2) if alloc_cap else 120.0
            free_tb = round(free_cap / 1024 / 1024, 2) if free_cap else 380.0
            
            arr_node = {
                "id": arr_id,
                "name": arr_name,
                "type": "Array",
                "status": "normal",
                "category": "main",
                "parentId": None,
                "isDecommissioned": False,
                "model": arr.get("model") or "HPE Alletra",
                "serialNumber": arr_serial,
                "firmware": arr.get("release_version") or "10.6.0.40",
                "protocol": arr.get("config_type") or "FC / NVMe",
                "totalCapacityTb": total_tb,
                "usedCapacityTb": used_tb,
                "freeCapacityTb": free_tb,
                "nodeCount": arr.get("node_count") or len(arr.get("nodes", []) or []),
                "jbofCount": len(arr.get("cages", []) or []),
                "diskCount": len(arr.get("drives", []) or [])
            }
            add_node_safe(arr_node)
            
            # Nodes (Controllers)
            arr_nodes_list = arr.get("nodes") or []
            for n_idx, ctrl in enumerate(arr_nodes_list):
                ctrl_name = f"Controller-{n_idx}"
                if isinstance(ctrl, dict):
                    ctrl_name = ctrl.get("name") or ctrl_name
                elif isinstance(ctrl, str):
                    ctrl_name = ctrl
                    
                ctrl_id = f"{arr_id}-N{n_idx}"
                ctrl_node = {
                    "id": ctrl_id,
                    "name": ctrl_name,
                    "type": "Node",
                    "status": "normal",
                    "category": "sub",
                    "parentId": arr_id,
                    "isDecommissioned": False
                }
                add_node_safe(ctrl_node)
                new_edges.append({
                    "from": arr_id,
                    "to": ctrl_id,
                    "label": "has_node",
                    "sourceId": source_id
                })
                
            # Ports
            arr_ports_list = arr.get("ports") or []
            for p_idx, port in enumerate(arr_ports_list):
                port_name = f"Port {p_idx}"
                port_wwn = ""
                port_proto = "FC"
                port_mode = "target"
                port_state = "ready"
                
                if isinstance(port, dict):
                    port_name = port.get("name") or port.get("nsp") or port_name
                    port_wwn = port.get("wwn") or port.get("port_wwn") or ""
                    port_proto = port.get("protocol") or port_proto
                    port_mode = port.get("mode") or port_mode
                    port_state = port.get("state") or port_state
                elif isinstance(port, str):
                    port_name = port
                    
                port_id = f"{arr_id}-P-{port_wwn or p_idx}"
                port_node = {
                    "id": port_id,
                    "name": port_name,
                    "type": "Port",
                    "status": "normal",
                    "category": "sub",
                    "parentId": arr_id,
                    "isDecommissioned": False,
                    "protocol": port_proto,
                    "mode": port_mode,
                    "state": port_state,
                    "wwn": port_wwn
                }
                add_node_safe(port_node)
                new_edges.append({
                    "from": arr_id,
                    "to": port_id,
                    "label": "has_port",
                    "sourceId": source_id
                })
                
            # Switches
            arr_switches_list = arr.get("switches") or []
            for s_idx, sw in enumerate(arr_switches_list):
                sw_name = f"Switch-{s_idx}"
                sw_serial = ""
                if isinstance(sw, dict):
                    sw_name = sw.get("name") or sw_name
                    sw_serial = sw.get("serial") or ""
                elif isinstance(sw, str):
                    sw_name = sw
                    
                sw_id = f"SW-{sw_serial or sw_name}"
                sw_node = {
                    "id": sw_id,
                    "name": sw_name,
                    "type": "Switch",
                    "status": "normal",
                    "category": "main",
                    "parentId": None,
                    "isDecommissioned": False,
                    "serialNumber": sw_serial
                }
                add_node_safe(sw_node)
                new_edges.append({
                    "from": sw_id,
                    "to": arr_id,
                    "label": "connected",
                    "sourceId": source_id
                })
                
            # Hosts
            arr_hosts_list = arr.get("hosts") or []
            for h_idx, host in enumerate(arr_hosts_list):
                host_name = f"Host-{h_idx}"
                host_os = ""
                if isinstance(host, dict):
                    host_name = host.get("name") or host_name
                    host_os = host.get("os") or ""
                elif isinstance(host, str):
                    host_name = host
                    
                host_id = f"HOST-{host_name}"
                host_node = {
                    "id": host_id,
                    "name": host_name,
                    "type": "Host",
                    "status": "normal",
                    "category": "main",
                    "parentId": None,
                    "isDecommissioned": False,
                    "os": host_os
                }
                add_node_safe(host_node)
                new_edges.append({
                    "from": arr_id,
                    "to": host_id,
                    "label": "zoned",
                    "sourceId": source_id
                })
                
            # Cages
            arr_cages_list = arr.get("cages") or []
            for c_idx, cage in enumerate(arr_cages_list):
                cage_name = f"Cage-{c_idx}"
                if isinstance(cage, dict):
                    cage_name = cage.get("name") or cage_name
                elif isinstance(cage, str):
                    cage_name = cage
                    
                cage_id = f"{arr_id}-CAGE-{c_idx}"
                cage_node = {
                    "id": cage_id,
                    "name": cage_name,
                    "type": "Cage",
                    "status": "normal",
                    "category": "sub",
                    "parentId": arr_id,
                    "isDecommissioned": False
                }
                add_node_safe(cage_node)
                new_edges.append({
                    "from": arr_id,
                    "to": cage_id,
                    "label": "has_cage",
                    "sourceId": source_id
                })
                
            # Drives
            arr_drives_list = arr.get("drives") or []
            for d_idx, drv in enumerate(arr_drives_list):
                drv_name = f"Disk-{d_idx}"
                if isinstance(drv, dict):
                    drv_name = drv.get("name") or drv_name
                elif isinstance(drv, str):
                    drv_name = drv
                    
                drv_id = f"{arr_id}-D-{d_idx}"
                drv_node = {
                    "id": drv_id,
                    "name": drv_name,
                    "type": "Disk",
                    "status": "normal",
                    "category": "sub",
                    "parentId": arr_id,
                    "isDecommissioned": False
                }
                add_node_safe(drv_node)
                new_edges.append({
                    "from": arr_id,
                    "to": drv_id,
                    "label": "has_disk",
                    "sourceId": source_id
                })

        # ── Register source ────────────────────────────────────────────────
        # Remove previous entry with same ID so re-ingest updates counts
        existing_sources = [s for s in existing_sources if s.get("id") != source_id]
        existing_sources.append({
            "id": source_id,
            "label": source_label,
            "timestamp": _dt.now().isoformat(),
            "nodeCount": len(new_nodes),
            "edgeCount": len(new_edges)
        })

        merged = {
            "nodes": existing_nodes + new_nodes,
            "edges": existing_edges + new_edges,
            "sources": existing_sources
        }
        tdb._write(merged)
        log.info(f"[ontology_sync] Appended {len(new_nodes)} nodes, {len(new_edges)} edges (source: {source_id})")

        # Trigger reload of ontology engine globally
        global _ontology_graph, _ontology_traversal, _ontology_source, _ontology_engine
        from integrations.ontology_engine import populate_graph, OntologyLLMEngine
        _ontology_graph, _ontology_traversal, _ontology_source = populate_graph()
        _ontology_engine = OntologyLLMEngine(_ontology_traversal)
        log.info("[ontology_sync] In-memory ontology traversal and graph reloaded.")
    except Exception as ex:
        log.exception("Failed to update ontology database.json")


@app.route("/api/ingest/log/ai", methods=["POST"])
def ingest_log_ai():
    """
    LLM-powered fallback ingest.

    When standard parsing fails or yields incomplete results, this endpoint
    uses the SAN Agent's LLM to recursively extract array data from a raw
    text dump, then loads the result into all 3 databases.

    Accepts:  multipart file or raw text body
    Returns:  SSE stream with progress events, ending with a 'final' event
    """
    import collections

    # Read raw text
    raw = ""
    file_name = ""
    if request.files and "file" in request.files:
        f = request.files["file"]
        raw = f.read().decode("utf-8", errors="replace")
        file_name = f.filename
    elif request.data:
        raw = request.data.decode("utf-8", errors="replace").strip()
    elif (request.get_json(silent=True) or {}).get("text"):
        raw = request.get_json()["text"]

    if not raw:
        return jsonify({"error": "No text provided"}), 400

    skip_backup = request.args.get("skip_backup", "false").lower() == "true"
    # Determine LLM backend: explicit param → auto-detect from env
    _use_ollama_param = str(request.args.get("useOllama", "")).lower()
    if _use_ollama_param == "true":
        use_ollama_flag = True
    elif _use_ollama_param == "false":
        use_ollama_flag = False
    else:
        # Auto: use Groq when GROQ_API_KEY is set, Ollama otherwise
        use_ollama_flag = not bool((os.environ.get("GROQ_API_KEY") or "").strip())
    llm_backend_name = "Ollama" if use_ollama_flag else "Groq"

    # Snapshot name configuration
    snapshot_name = request.args.get("label") or request.args.get("snapshot_name")
    if not snapshot_name:
        if file_name:
            snapshot_name = f"✨ LLM Ingest: {file_name}"
        else:
            snapshot_name = f"✨ LLM Ingest ({datetime.now().strftime('%H:%M:%S')})"

    def generate():
        # Step 0 – backup
        yield f'data: {json.dumps({"type": "progress", "msg": "Creating backup of current data..."})}' + "\n\n"
        backup_id = None
        if not skip_backup:
            try:
                backup_id = _log_ingest.create_backup()
                yield f'data: {json.dumps({"type": "progress", "msg": f"Backup created: {backup_id}"})}' + "\n\n"
            except Exception as ex:
                yield f'data: {json.dumps({"type": "warning", "msg": f"Backup failed (continuing): {ex}"})}' + "\n\n"

        # Step 1 – wipe
        yield f'data: {json.dumps({"type": "progress", "msg": "Wiping existing database data..."})}' + "\n\n"
        _log_ingest.wipe_all()

        # Step 2 – LLM parse via SAN Agent
        yield f'data: {json.dumps({"type": "progress", "msg": f"Sending log to SAN Agent for LLM parsing ({llm_backend_name})..."})}' + "\n\n"

        system_prompt = (
            "You are an HPE 3PAR / Primera / Alletra SAN data extraction expert. "
            "The user will give you a raw CLI terminal dump. "
            "Extract ALL array information and return ONLY a valid JSON array where each element "
            "represents one HPE storage array. Each element must follow this schema exactly: "
            '{"name": str, "array_id": str, "model": str, "serial": str, '
            '"release_version": str, "node_count": int, "total_cap_mib": int, '
            '"free_cap_mib": int, "alloc_cap_mib": int, "config_type": str, '
            '"nodes": [], "ports": [], "switches": [], "hosts": [], '
            '"cages": [], "drives": []}. '
            "Ignore SSH banners, shell prompts, human comments. Return ONLY the JSON array."
        )

        # Chunk the raw text dynamically (avoid token overflow and keep commands whole)
        chunks = split_into_dynamic_chunks(raw, max_chunk_size=15000)
        all_arrays = []
        errors = []

        for idx, chunk in enumerate(chunks):
            yield f'data: {json.dumps({"type": "progress", "msg": f"LLM parsing chunk {idx+1}/{len(chunks)}..."})}' + "\n\n"
            # Signal frontend to open a new LLM chunk panel
            yield f'data: {json.dumps({"type": "llm_start", "chunk_idx": idx + 1, "total_chunks": len(chunks)})}' + "\n\n"

            full_response = ""
            try:
                if use_ollama_flag:
                    # Streaming Ollama call — emit think/chunk tokens live
                    stream_gen = _rag_engine._llm_call_ollama(
                        system_prompt,
                        f"Terminal dump (chunk {idx+1}/{len(chunks)}):\n\n{chunk}",
                        stream=True,
                        disable_think=False,
                    )
                    for raw_line in stream_gen:
                        try:
                            cd = json.loads(raw_line)
                            token = cd.get("message", {}).get("content", "")
                            if not token:
                                continue
                            full_response += token
                            # Classify token as think (inside <think>...</think>) or regular chunk
                            has_open = "<think>" in full_response
                            has_close = "</think>" in full_response
                            evt_type = "think" if (has_open and not has_close) else "chunk"
                            yield f'data: {json.dumps({"type": evt_type, "content": token})}' + "\n\n"
                        except Exception:
                            pass
                else:
                    # Non-streaming Groq: single call then emit as one chunk event
                    full_response = _san_agent_llm(
                        system_prompt,
                        f"Terminal dump (chunk {idx+1}/{len(chunks)}):\n\n{chunk}",
                        use_ollama=False,
                    )
                    if full_response:
                        yield f'data: {json.dumps({"type": "chunk", "content": full_response})}' + "\n\n"

                # Signal end of this LLM call
                yield f'data: {json.dumps({"type": "llm_done", "chunk_idx": idx + 1})}' + "\n\n"

                # Extract JSON — first strip <think> blocks
                cleaned = re.sub(r"<think>.*?</think>", "", full_response, flags=re.DOTALL).strip()
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
                cleaned = re.sub(r"```\s*$", "", cleaned.strip())
                m = re.search(r"(\[.*\])", cleaned, re.DOTALL)
                if m:
                    parsed = json.loads(m.group(1))
                    if isinstance(parsed, list):
                        all_arrays.extend(parsed)
                    elif isinstance(parsed, dict):
                        all_arrays.append(parsed)
                    count = len(parsed) if isinstance(parsed, list) else 1
                    yield f'data: {json.dumps({"type": "progress", "msg": f"Chunk {idx+1}: extracted {count} array(s)"})}' + "\n\n"
                else:
                    err_msg = f"Chunk {idx+1}: LLM output had no JSON array"
                    errors.append(err_msg)
                    yield f'data: {json.dumps({"type": "warning", "msg": err_msg})}' + "\n\n"

            except Exception as ex:
                errors.append(f"Chunk {idx+1}: {str(ex)}")
                yield f'data: {json.dumps({"type": "warning", "msg": f"Chunk {idx+1} failed: {ex}"})}' + "\n\n"
                yield f'data: {json.dumps({"type": "llm_done", "chunk_idx": idx + 1})}' + "\n\n"

        # Step 3 – populate databases
        yield f'data: {json.dumps({"type": "progress", "msg": f"Populating databases with {len(all_arrays)} arrays..."})}' + "\n\n"
        for arr in all_arrays:
            if isinstance(arr, dict):
                _log_ingest._store_parsed(arr)

        # Synchronize ontology database.json
        yield f'data: {json.dumps({"type": "progress", "msg": "Synchronizing ontology database..."})}' + "\n\n"
        _update_ontology_db(all_arrays, source_label=snapshot_name)

        # Step 4 – Save newly populated data as a snapshot
        snap_msg = f"Saving persistent snapshot \"{snapshot_name}\"..."
        yield f'data: {json.dumps({"type": "progress", "msg": snap_msg})}' + "\n\n"
        snapshot_id = None
        if all_arrays:
            try:
                snapshot_id = _log_ingest.create_backup(label=snapshot_name)
                yield f'data: {json.dumps({"type": "progress", "msg": f"Snapshot created successfully: {snapshot_id}"})}\n\n'
            except Exception as ex:
                yield f'data: {json.dumps({"type": "warning", "msg": f"Snapshot step failed: {ex}"})}\n\n'

        final = {
            "type":          "final",
            "backup_id":     backup_id,
            "snapshot_id":   snapshot_id,
            "arrays_parsed": len(all_arrays),
            "errors":        errors,
            "status":        "success" if all_arrays else "partial",
            "arrays": [
                {"name": a.get("name"), "serial": a.get("serial"), "model": a.get("model")}
                for a in all_arrays if isinstance(a, dict)
            ],
        }
        yield f'data: {json.dumps(final)}\n\n'

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/ingest/log/backup/create", methods=["POST"])
def create_ingest_backup():
    """Create a new named backup of the current database state on-demand."""
    from datetime import datetime
    try:
        data = request.get_json(silent=True) or {}
        label = data.get("label", "").strip()
        if not label:
            label = f"Snapshot ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"
        backup_id = _log_ingest.create_backup(label=label)
        return jsonify({"status": "success", "backup_id": backup_id, "label": label})
    except Exception as ex:
        log.exception("create_ingest_backup failed")
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ingest/log/backups", methods=["GET"])
def list_ingest_backups():
    """List all available ingest backups (for restore / audit)."""
    try:
        return jsonify({"backups": _log_ingest.list_backups()})
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ingest/log/restore", methods=["POST"])
def restore_ingest_backup():
    """
    Restore a previous ingest backup.

    Body: {"backup_id": "backup_20240101_120000"}

    Wipes current data and replays the backed-up snapshot.
    """
    data = request.get_json(silent=True) or {}
    backup_id = (data.get("backup_id") or "").strip()
    if not backup_id:
        return jsonify({"error": "backup_id is required"}), 400
    try:
        result = _log_ingest.restore(backup_id)
        # Refresh ontology global state so the live server is immediately synchronized
        try:
            global _ontology_graph, _ontology_traversal, _ontology_source, _ontology_engine
            from integrations.ontology_engine import populate_graph, OntologyLLMEngine
            _ontology_graph, _ontology_traversal, _ontology_source = populate_graph()
            _ontology_engine = OntologyLLMEngine(_ontology_traversal)
        except Exception as ex:
            log.warning(f"Failed to refresh ontology globals after restore: {ex}")
        return jsonify(result)
    except FileNotFoundError as ex:
        return jsonify({"error": str(ex)}), 404
    except Exception as ex:
        log.exception("restore_ingest_backup failed")
        return jsonify({"error": str(ex)}), 500

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


def _inject_teams_into_topology(data):
    if not data or "nodes" not in data:
        return data
    if not mongo.available:
        return data
    try:
        db = mongo.db
        creds_map = {}
        creds = list(db.ssh_credentials.find({}, {"device_name": 1, "ip": 1, "team": 1}))
        for c in creds:
            team = c.get("team")
            if team:
                if c.get("device_name"):
                    creds_map[c["device_name"].lower()] = team
                if c.get("ip"):
                    creds_map[c["ip"].lower()] = team
                    
        for n in data["nodes"]:
            n_id = str(n.get("id") or "").lower()
            if "data" in n and isinstance(n["data"], dict):
                n_id = str(n["data"].get("id") or "").lower()
                n_name = str(n["data"].get("name") or n["data"].get("device_name") or "").lower()
                matched_team = creds_map.get(n_name) or creds_map.get(n_id)
                if matched_team:
                    n["data"]["team"] = matched_team
                    n["data"]["owner_team"] = matched_team
            else:
                n_name = str(n.get("name") or n.get("device_name") or "").lower()
                matched_team = creds_map.get(n_name) or creds_map.get(n_id)
                if matched_team:
                    n["team"] = matched_team
                    n["owner_team"] = matched_team
    except Exception as ex:
        log.warning(f"Failed to inject teams into topology: {ex}")
    return data


@app.route("/api/graph/mongo")
def mongo_graph():
    """Retrieve topology graph from MongoDB sandatas collection."""
    # Trigger restart after pymongo installation
    if not mongo.available:
        return jsonify({"error": "MongoDB not available", "nodes": [], "edges": []}), 503
    try:
        db = mongo.db
        is_real = request.args.get("real", "false").lower() == "true"
        collection = db.real_sandatas if is_real else db.sandatas
        doc = collection.find_one({})
        if not doc:
            return jsonify({"nodes": [], "edges": []})
        
        nodes = doc.get("nodes", [])
        edges = doc.get("edges", [])
        
        # Ensure edges have both from/to and source/target properties for compatibility
        for e in edges:
            if "from" in e and "source" not in e:
                e["source"] = e["from"]
            if "to" in e and "target" not in e:
                e["target"] = e["to"]
                
        graph_data = _inject_teams_into_topology({"nodes": nodes, "edges": edges})
        return jsonify(graph_data)
    except Exception as ex:
        log.exception("Failed to query mongo_graph")
        return jsonify({"error": str(ex), "nodes": [], "edges": []}), 500



# ── RAG chat, ingest, faker ───────────────────────────────────────────────────

_cancelled_requests = set()

@app.route("/api/chat/stop", methods=["POST"])
@app.route("/api/chat/cancel", methods=["POST"])
def cancel_chat_request():
    data = request.json or {}
    req_id = data.get("requestId", "").strip()
    if req_id:
        _cancelled_requests.add(req_id)
        log.info(f"[Cancellation] Added request {req_id} to cancelled list.")
    return jsonify({"success": True, "cancelled": req_id})

@app.route("/api/terminal/windows", methods=["GET"])
def get_desktop_windows():
    """Returns open windows on Windows, or relay status on Linux/macOS."""
    import sys
    import os
    
    if sys.platform != 'win32':
        # On Linux/macOS there's no window-picker; just return relay status
        tmp_dir = os.environ.get('TMPDIR', '/tmp')
        cmd_file = os.path.join(tmp_dir, 'san_agent_cmd.txt')
        out_file = os.path.join(tmp_dir, 'san_agent_out.txt')
        relay_active = not os.path.exists(cmd_file)  # relay is running if cmd file was cleaned up
        return jsonify({
            "success": True,
            "platform": "linux",
            "windows": [],
            "relayInfo": {
                "tmpDir": tmp_dir,
                "relayActive": relay_active
            }
        })
    
    import ctypes
    from ctypes import wintypes
    
    user32 = ctypes.windll.user32
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    
    # Window classes that are known terminal/shell hosts
    TERMINAL_CLASSES = {
        'ConsoleWindowClass',       # Classic conhost (cmd.exe, PowerShell legacy)
        'CASCADIA_HOSTING_WINDOW_CLASS',  # Windows Terminal (new)
        'VirtualConsoleClass',      # ConEmu
        'mintty',                   # Git Bash / Cygwin
        'cygwin',
        'XTerm',
    }
    
    windows = []
    all_windows = []
    
    def enum_windows_callback(hwnd, lParam):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                title_buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, title_buf, length + 1)
                title = title_buf.value
                
                class_buf = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(hwnd, class_buf, 256)
                class_name = class_buf.value
                
                if title.strip():
                    entry = {
                        "hwnd": str(hwnd),
                        "title": title,
                        "className": class_name,
                        "isTerminal": class_name in TERMINAL_CLASSES
                    }
                    all_windows.append(entry)
                    if class_name in TERMINAL_CLASSES:
                        windows.append(entry)
        return True
    
    try:
        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        # Return terminals first, then the rest
        windows.sort(key=lambda w: w['title'].lower())
        others = [w for w in all_windows if not w['isTerminal']]
        others.sort(key=lambda w: w['title'].lower())
        return jsonify({
            "success": True,
            "platform": "windows",
            "windows": windows + others
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/terminal/connect", methods=["POST"])
def terminal_connect():
    data = request.json or {}
    _terminal_gateway.connection_type = data.get("type", "simulated")
    _terminal_gateway.execution_mode = data.get("executionMode", "auto")
    if _terminal_gateway.connection_type == "ssh":
        _terminal_gateway.ssh_host = data.get("host")
        _terminal_gateway.ssh_username = data.get("username")
        _terminal_gateway.ssh_password = data.get("password")
    elif _terminal_gateway.connection_type == "desktop":
        _terminal_gateway.selected_hwnd = data.get("hwnd")
        # Auto-spawn the embedded shell subprocess
        try:
            _desktop_shell.spawn()
            log.info('[TerminalGateway] Desktop shell spawned automatically on connect.')
        except Exception as e:
            log.warning('[TerminalGateway] Failed to auto-spawn shell: %s', e)
    log.info(f"[TerminalGateway] Configured connection to {_terminal_gateway.connection_type} ({_terminal_gateway.execution_mode} mode)")
    return jsonify({
        "success": True, 
        "connectionType": _terminal_gateway.connection_type, 
        "executionMode": _terminal_gateway.execution_mode,
        "selectedHwnd": _terminal_gateway.selected_hwnd
    })

@app.route("/api/terminal/pending", methods=["GET"])
def terminal_pending():
    return jsonify({
        "command": _terminal_gateway.pending_command,
        "ip": _terminal_gateway.pending_ip,
        "mode": _terminal_gateway.execution_mode
    })

@app.route("/api/terminal/approval", methods=["POST"])
def terminal_approval():
    data = request.json or {}
    decision = data.get("decision", "approve")
    modified_command = data.get("modifiedCommand")
    
    _terminal_gateway.user_decision = decision
    _terminal_gateway.modified_command = modified_command
    _terminal_gateway.approval_event.set() # RESUME executor thread!
    
    log.info(f"[TerminalGateway] User decision received: {decision} (modified command: {modified_command})")
    return jsonify({"success": True})

# ── Embedded terminal: spawn / SSE output stream / keyboard input ─────────────
@app.route("/api/terminal/spawn", methods=["POST"])
def terminal_spawn():
    """Spawn (or respawn) the embedded desktop shell subprocess."""
    try:
        _desktop_shell.spawn()
        return jsonify({"success": True, "message": "Shell spawned."})
    except Exception as e:
        log.exception('[DesktopShell] Failed to spawn')
        return jsonify({"success": False, "error": str(e)}), 500

def capture_window_screenshot(hwnd: int):
    """Capture a screenshot of a specific window by HWND using PIL.ImageGrab."""
    try:
        import ctypes
        from ctypes import wintypes
        import PIL.ImageGrab
        
        user32 = ctypes.windll.user32
        rect = wintypes.RECT()
        if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            bbox = (rect.left, rect.top, rect.right, rect.bottom)
            if bbox[2] > bbox[0] and bbox[3] > bbox[1]:
                # Add 8px offset to clip Windows shadows/borders if necessary
                return PIL.ImageGrab.grab(bbox)
    except Exception as e:
        log.warning(f"[Screencast] Failed to grab screenshot for hwnd {hwnd}: {e}")
    return None

@app.route("/api/terminal/screencast/<path:hwnd_str>")
def terminal_screencast(hwnd_str):
    """MJPEG stream of a specific window screenshot."""
    import time
    try:
        hwnd = int(hwnd_str)
    except ValueError:
        return "Invalid HWND", 400
        
    def generate():
        import io
        while True:
            img = capture_window_screenshot(hwnd)
            if img:
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=80)
                jpeg_bytes = buf.getvalue()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n'
                       b'Content-Length: ' + str(len(jpeg_bytes)).encode('utf-8') + b'\r\n\r\n' +
                       jpeg_bytes + b'\r\n')
            else:
                time.sleep(0.3)
            time.sleep(0.1) # ~10 FPS
            
    return Response(
        generate(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={
            'Cache-Control': 'no-cache, private',
            'Pragma': 'no-cache'
        }
    )

@app.route("/api/terminal/spawn-powershell", methods=["POST"])
def spawn_powershell_window():
    """Spawn a real, visible PowerShell window on the Windows desktop."""
    import sys
    import subprocess
    if sys.platform != 'win32':
        return jsonify({"success": False, "error": "Only supported on Windows"}), 400
    try:
        subprocess.Popen("start powershell.exe", shell=True)
        return jsonify({"success": True, "message": "PowerShell window spawned."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/terminal/type", methods=["POST"])
def terminal_type_keys():
    """Send keystrokes to a specific window by HWND using Windows automation."""
    data = request.json or {}
    hwnd_str = data.get("hwnd")
    text = data.get("text", "")
    
    if not hwnd_str or not text:
        return jsonify({"success": False, "error": "hwnd and text are required"}), 400
        
    try:
        hwnd = int(hwnd_str)
        import ctypes
        import time
        user32 = ctypes.windll.user32
        
        if not user32.IsWindow(hwnd):
            return jsonify({"success": False, "error": f"Invalid window handle: {hwnd}"}), 400
            
        # SW_RESTORE = 9
        user32.ShowWindow(hwnd, 9)
        # Bypass Windows Focus Stealing Prevention (simulate ALT press)
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.3)
        
        import subprocess
        escaped_text = text.replace("`", "``").replace('"', '`"').replace('$', '`$')
        # Send keys directly to currently active (foreground) window
        ps_cmd = f"""
        $wshell = New-Object -ComObject wscript.shell;
        $wshell.SendKeys("{escaped_text}");
        """
        res = subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, text=True)
        if res.returncode == 0:
            return jsonify({"success": True, "message": f"Keystrokes typed to window {hwnd}."})
        else:
            return jsonify({"success": False, "error": res.stderr or "Failed to type"}), 500
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/terminal/output")
def terminal_output_stream():
    """SSE stream: push shell stdout chunks to the browser xterm.js terminal."""
    def generate():
        import queue as _q
        yield 'data: {"data": ""} \n\n'  # keep-alive / initial handshake
        while True:
            if not _desktop_shell.is_running():
                import time
                time.sleep(0.3)
                continue
            try:
                chunk = _desktop_shell.output_q.get(timeout=1.0)
                import json
                yield f'data: {json.dumps({"data": chunk})}\n\n'
            except _q.Empty:
                yield ': keepalive\n\n'
            except GeneratorExit:
                break
            except Exception:
                break

    resp = Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control':   'no-cache',
            'X-Accel-Buffering':'no',
            'Connection':      'keep-alive',
        }
    )
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp


@app.route("/api/terminal/input", methods=["POST"])
def terminal_input():
    """Receive keystroke data from the browser xterm.js and write to shell stdin."""
    if not _desktop_shell.is_running():
        try:
            _desktop_shell.spawn()
            log.info('[TerminalGateway] Desktop shell auto-spawned on keystroke.')
        except Exception as e:
            log.warning('[TerminalGateway] Failed to auto-spawn on keystroke: %s', e)
            
    data = (request.json or {}).get('data', '')
    if data:
        _desktop_shell.write(data)
    return jsonify({"success": True})


@app.route("/api/terminal/session/stop", methods=["DELETE", "POST"])
def terminal_session_stop():
    _terminal_gateway.connection_type = "simulated"
    _terminal_gateway.execution_mode = "auto"
    _terminal_gateway.ssh_host = None
    _terminal_gateway.ssh_username = None
    _terminal_gateway.ssh_password = None
    _terminal_gateway.pending_command = None
    _terminal_gateway.pending_ip = None
    _terminal_gateway.selected_hwnd = None
    _terminal_gateway.approval_event.set()
    _desktop_shell.kill()
    log.info("[TerminalGateway] Disconnected from terminal and reset to simulated environment.")
    return jsonify({"success": True})

@app.route("/api/agent/run/stream")
def agent_run_stream():
    """Stream SAN AI Agent execution steps in real-time via SSE."""
    import collections
    query = request.args.get("query", "").strip()
    array_hint = request.args.get("array", "").strip()
    use_ollama = str(request.args.get("useOllama", "false")).lower() == "true"
    disable_think = str(request.args.get("disableThink", "false")).lower() == "true"
    ollama_model = request.args.get("ollamaModel", "").strip()
    req_id = request.args.get("requestId", "").strip()
    if not query:
        return Response("data: {\"error\": \"query is required\"}\n\n", mimetype="text/event-stream")

    def generate():
        queue = collections.deque()
        
        def on_step(step):
            queue.append({"type": "step", "step": step})

        def on_synthesis_chunk(chunk_text, is_think):
            queue.append({"type": "synthesis", "content": chunk_text, "is_think": is_think})

        result = {}
        error_holder = []
        
        def run_thread():
            try:
                _san_agent.on_synthesis_chunk = on_synthesis_chunk
                res = _san_agent.run(
                    query, 
                    array_hint=array_hint or None, 
                    on_step=on_step, 
                    use_ollama=use_ollama, 
                    disable_think=disable_think,
                    ollama_model=ollama_model or None,
                    request_id=req_id,
                    stream=True
                )
                result.update(res)
            except Exception as e:
                log.exception("agent stream run failed")
                error_holder.append(str(e))
            finally:
                _san_agent.on_synthesis_chunk = None

        t = threading.Thread(target=run_thread, daemon=True)
        t.start()

        # Send a handshake immediately so the browser knows the connection is established
        yield f"data: {json.dumps({'type': 'handshake'})}\n\n"

        last_heartbeat = time.time()
        while t.is_alive() or queue:
            if req_id in _cancelled_requests:
                log.info(f"Agent stream aborted via cancel request: {req_id}")
                yield f"data: {json.dumps({'type': 'cancelled'})}\n\n"
                return
            
            has_data = False
            while queue:
                item = queue.popleft()
                yield f"data: {json.dumps(item)}\n\n"
                has_data = True
                
            if not has_data and (time.time() - last_heartbeat > 3.0):
                yield ": ping\n\n"
                last_heartbeat = time.time()
                
            if error_holder:
                yield f"data: {json.dumps({'type': 'error', 'error': error_holder[0]})}\n\n"
                return
            time.sleep(0.1)

        if error_holder:
            yield f"data: {json.dumps({'type': 'error', 'error': error_holder[0]})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'final', 'result': result})}\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/agent/run", methods=["POST"])
@app.route("/api/v1/san/agent/run", methods=["POST"])
def agent_run():
    """SAN AI Agent: simulator CLI → parse → Neo4j → answer with execution trace."""
    data = request.json or {}
    q = (data.get("query") or data.get("message") or "").strip()
    use_ollama = data.get("useOllama", False)
    disable_think = data.get("disableThink", False)
    if not q:
        return jsonify({"error": "query is required"}), 400
    try:
        result = _san_agent.run(
            q, 
            array_hint=data.get("array") or data.get("array_hint"),
            use_ollama=use_ollama,
            disable_think=disable_think
        )
        return jsonify(result)
    except Exception as ex:
        log.exception("agent_run failed")
        return jsonify({"error": str(ex)}), 500


@app.route("/api/chat", methods=["POST"])
@app.route("/api/v1/san/rag/query", methods=["POST"])
def chat():
    data = request.json or {}
    q = (data.get("query") or "").strip()
    use_ollama = data.get("useOllama", False)
    disable_think = data.get("disableThink", False)
    stream = data.get("stream", False)
    mode = data.get("mode", "auto")
    req_id = data.get("requestId", "").strip()
    
    if not q:
        return jsonify({"error": "query is required"}), 400
    history = data.get("history") or []
    try:
        if mode == "standard":
            result = _rag_engine.standard_rag(q, history=history if isinstance(history, list) else [], use_ollama=use_ollama, disable_think=disable_think, stream=stream)
        elif mode == "graphrag":
            result = _rag_engine.graph_rag(q, history=history if isinstance(history, list) else [], use_ollama=use_ollama, disable_think=disable_think, stream=stream)
        else:
            result = _rag_engine.query(q, history=history if isinstance(history, list) else [], use_ollama=use_ollama, disable_think=disable_think, stream=stream)
        
        if stream and "stream_generator" in result:
            def generate():
                try:
                    # Prepend MongoDB Query and Context Retrieved in the stream if present
                    mongo_query = result.get("mongo_query")
                    context_raw = result.get("context_raw")
                    if mongo_query:
                        yield f"data: {json.dumps({'type': 'chunk', 'content': '### 🔍 MongoDB Query\\n```javascript\\n' + mongo_query + '\\n```\\n\\n'})}\n\n"
                    if context_raw:
                        yield f"data: {json.dumps({'type': 'chunk', 'content': '### 📦 Context Retrieved\\n```json\\n' + context_raw + '\\n```\\n\\n---\\n\\n### 💬 Response\\n'})}\n\n"

                    for chunk in result["stream_generator"]:
                        if req_id in _cancelled_requests:
                            log.info(f"SSE chat stream aborted via cancel request: {req_id}")
                            yield f"data: {json.dumps({'type': 'cancelled'})}\n\n"
                            break
                        try:
                            chunk_data = json.loads(chunk)
                            # Support dynamic Ollama reasoning/thinking streams (e.g. deepseek-r1:8b)
                            msg = chunk_data.get('message', {})
                            content = msg.get('content', '')
                            reasoning = msg.get('thinking') or msg.get('reasoning_content', '')
                            
                            if reasoning:
                                c_type = 'think'
                                yield f"data: {json.dumps({'type': c_type, 'content': reasoning, 'done': chunk_data.get('done', False)})}\n\n"
                            else:
                                c_type = 'think' if chunk_data.get('type') == 'think' else 'chunk'
                                yield f"data: {json.dumps({'type': c_type, 'content': content, 'done': chunk_data.get('done', False)})}\n\n"
                        except json.JSONDecodeError:
                            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
                except Exception as stream_err:
                    log.exception("Error during SSE stream generation")
                    yield f"data: {json.dumps({'type': 'chunk', 'content': f'\\n\\n[Stream Error: {str(stream_err)}]' })}\n\n"
                        
                # After the stream finishes, yield the final result structure (cypher, table etc)
                try:
                    final_result = {k: v for k, v in result.items() if k != "stream_generator"}
                    yield f"data: {json.dumps({'type': 'final', 'result': final_result})}\n\n"
                except Exception as final_err:
                    log.exception("Error yielding final result in SSE")
                
            return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

        # Prepend MongoDB Query and Context Retrieved to the final non-stream answer if present
        prefix = ""
        if result.get("mongo_query"):
            prefix += f"### 🔍 MongoDB Query\n```javascript\n{result['mongo_query']}\n```\n\n"
        if result.get("context_raw"):
            prefix += f"### 📦 Context Retrieved\n```json\n{result['context_raw']}\n```\n\n---\n\n### 💬 Response\n"
        if prefix and "answer" in result:
            result["answer"] = prefix + result["answer"]

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
    switches = int(data.get("switches", 2))
    hosts = int(data.get("hosts", 10))
    disks = int(data.get("disks", 24))
    
    try:
        path = _data_faker.generate_array(
            seed_name=str(name), 
            switches_count=switches, 
            hosts_count=hosts, 
            drives_count=disks
        )
        return jsonify({
            "status": "success",
            "path": path,
            "hint": "File written to simulator/data/devices.",
        })
    except Exception as ex:
        log.exception("Faker generation failed")
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
        is_real = request.args.get("real", "false").lower() == "true"
        if is_real:
            db = mongo.db
            doc = db.real_sandatas.find_one({})
            if not doc:
                return jsonify({"nodes": [], "edges": []})
            return jsonify(_inject_teams_into_topology(doc))

        data = _topology_db.get_topology()
        source = request.args.get("source", "all")
        if source and source != "all":
            # Return only nodes/edges belonging to the requested source
            filtered_nodes = [n for n in data.get("nodes", []) if n.get("sourceId") == source]
            node_ids = {n["id"] for n in filtered_nodes}
            filtered_edges = [
                e for e in data.get("edges", [])
                if e.get("sourceId") == source
                and e.get("from") in node_ids
                and e.get("to") in node_ids
            ]
            data = {
                "nodes": filtered_nodes,
                "edges": filtered_edges,
                "sources": data.get("sources", [])
            }
        return jsonify(_inject_teams_into_topology(data))
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ontology/sources", methods=["GET"])
def get_ontology_sources():
    """Return the list of ingested log sources registered in database.json."""
    try:
        data = _topology_db.get_topology()
        return jsonify({"sources": data.get("sources", [])})
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


@app.route("/api/ontology/export", methods=["GET"])
def export_ontology_topology():
    """Export the entire ontology topology database.json."""
    try:
        data = _topology_db.get_topology()
        return jsonify(data)
    except Exception as ex:
        log.exception("Ontology export failed")
        return jsonify({"error": str(ex)}), 500


@app.route("/api/ontology/import", methods=["POST"])
def import_ontology_topology():
    """Import and overwrite the entire ontology topology database.json."""
    data = request.json or {}
    if not isinstance(data, dict) or "nodes" not in data or "edges" not in data:
        return jsonify({"error": "Invalid format. JSON must contain 'nodes' and 'edges' lists."}), 400
    try:
        _topology_db._write(data)
        # Re-populate graph after update to keep reasoning engine in sync
        global _ontology_graph, _ontology_traversal, _ontology_source, _ontology_engine
        _ontology_graph, _ontology_traversal, _ontology_source = populate_graph()
        _ontology_engine = OntologyLLMEngine(_ontology_traversal)
        return jsonify({"status": "success", "message": "Ontology database configuration imported successfully."})
    except Exception as ex:
        log.exception("Ontology import failed")
        return jsonify({"error": str(ex)}), 500


# ── Graph node CRUD (elementId) ───────────────────────────────────────────────

@app.route("/api/graph/nodes/<path:element_id>", methods=["PATCH"])
def patch_graph_node(element_id):
    body = request.json or {}
    allowed = _load_allowed_keys()
    deco = body.get("isDecommissioned")
    props = body.get("properties") or {}
    if not isinstance(props, dict):
        return jsonify({"error": "properties must be an object"}), 400

    # 1. Update in MongoDB if available
    if mongo.available:
        try:
            db = mongo.db
            doc = db.sandatas.find_one({})
            if doc:
                nodes_list = doc.setdefault("nodes", [])
                for node in nodes_list:
                    if str(node.get("id")) == element_id:
                        if deco is not None:
                            node["isDecommissioned"] = bool(deco)
                            # Cascade to children
                            for child in nodes_list:
                                if str(child.get("parentId")) == element_id:
                                    child["isDecommissioned"] = bool(deco)
                        for k, v in props.items():
                            if k in allowed and _valid_prop_key(k):
                                node[k] = v
                from datetime import datetime
                doc["lastUpdated"] = datetime.utcnow()
                db.sandatas.replace_one({}, doc, upsert=True)
                log.info(f"[mongo] Updated node '{element_id}' in MongoDB.")
        except Exception as mongo_err:
            log.warning(f"[mongo] Failed to update node in MongoDB: {mongo_err}")

    # 2. Update in Neo4j (best effort)
    if neo4j.available:
        try:
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
            if sets:
                cypher = f"MATCH (n) WHERE elementId(n) = $eid SET {', '.join(sets)} RETURN elementId(n) AS element_id"
                neo4j._run(cypher, **params)
        except Exception as ex:
            log.warning(f"Neo4j PATCH failed: {ex}")

    return jsonify({"status": "ok", "element_id": element_id})


@app.route("/api/graph/nodes/<path:element_id>", methods=["DELETE"])
def delete_graph_node(element_id):
    # 1. Delete from MongoDB if available
    if mongo.available:
        try:
            db = mongo.db
            doc = db.sandatas.find_one({})
            if doc:
                nodes_list = doc.get("nodes", [])
                edges_list = doc.get("edges", [])
                doc["nodes"] = [n for n in nodes_list if str(n.get("id")) != element_id]
                doc["edges"] = [
                    e for e in edges_list 
                    if str(e.get("from")) != element_id 
                    and str(e.get("to")) != element_id 
                    and str(e.get("source")) != element_id 
                    and str(e.get("target")) != element_id
                ]
                from datetime import datetime
                doc["lastUpdated"] = datetime.utcnow()
                db.sandatas.replace_one({}, doc, upsert=True)
                log.info(f"[mongo] Deleted node '{element_id}' from MongoDB.")
        except Exception as mongo_err:
            log.warning(f"[mongo] Failed to delete node from MongoDB: {mongo_err}")

    # 2. Delete from Neo4j (best effort)
    if neo4j.available:
        try:
            neo4j._run("MATCH (n) WHERE elementId(n) = $eid DETACH DELETE n", eid=element_id)
        except Exception as ex:
            log.warning(f"Neo4j DELETE failed: {ex}")
            
    return jsonify({"status": "ok"})


@app.route("/api/graph/nodes", methods=["POST"])
def create_graph_node():
    body = request.json or {}
    label = body.get("label") or body.get("type")
    if label not in ALLOWED_CREATE_LABELS:
        return jsonify({"error": f"label must be one of {sorted(ALLOWED_CREATE_LABELS)}"}), 400
    allowed = _load_allowed_keys()
    extra = body.get("properties") or {}
    arr_ip = body.get("connect_to_array_ip") or body.get("array_ip")

    # 1. Determine Node properties for MongoDB
    user_team = request.headers.get("X-User-Team") or "Team Alpha"
    if user_team.lower() == "all":
        user_team = "Team Alpha"

    node_id = None
    node_name = body.get("name") or extra.get("name")
    ip_addr = None
    serial_no = None

    if label == "Host":
        ip_addr = body.get("ip_address") or extra.get("ip_address")
        if not ip_addr:
            return jsonify({"error": "ip_address required for Host"}), 400
        node_id = ip_addr
        node_name = node_name or ip_addr
    elif label == "Switch":
        node_name = node_name or body.get("serial")
        if not node_name:
            return jsonify({"error": "name or serial required for Switch"}), 400
        serial_no = body.get("serial") or extra.get("serial") or node_name
        node_id = serial_no
    elif label == "ArraySystem":
        ip_addr = body.get("ip_address") or extra.get("ip_address")
        if not ip_addr:
            return jsonify({"error": "ip_address required for ArraySystem"}), 400
        node_id = ip_addr
        node_name = node_name or ip_addr
    elif label == "PhysicalDisk":
        serial_no = body.get("serial") or extra.get("serial")
        if not serial_no:
            return jsonify({"error": "serial required for PhysicalDisk"}), 400
        node_id = serial_no
        node_name = node_name or serial_no
    elif label == "Cage":
        cid = body.get("cage_id") or extra.get("cage_id")
        if not cid:
            return jsonify({"error": "cage_id required for Cage"}), 400
        node_id = str(cid)
        node_name = node_name or str(cid)
    else:  # Node
        nid = body.get("node_id") or extra.get("node_id")
        if not nid:
            return jsonify({"error": "node_id required for Node"}), 400
        node_id = str(nid)
        node_name = node_name or str(nid)

    new_node = {
        "id": node_id,
        "name": node_name,
        "type": "Array" if label == "ArraySystem" else ("Disk" if label == "PhysicalDisk" else label),
        "status": body.get("status", "normal"),
        "category": "sub" if label in ["PhysicalDisk", "Cage", "Node"] else "main",
        "team": user_team,
        "owner_team": user_team,
        "isDecommissioned": False
    }

    if ip_addr:
        new_node["ip_address"] = ip_addr
    if serial_no:
        new_node["serial"] = serial_no
    if label in ["PhysicalDisk", "Cage", "Node"] and arr_ip:
        new_node["parentId"] = arr_ip

    for k, v in extra.items():
        if k not in new_node and _valid_prop_key(k):
            new_node[k] = v

    # 2. Write to MongoDB
    if mongo.available:
        try:
            db = mongo.db
            doc = db.sandatas.find_one({})
            from datetime import datetime
            if not doc:
                doc = {
                    "name": "HPE SAN Infrastructure",
                    "description": "Dynamically discovered SAN data via crawler",
                    "nodes": [],
                    "edges": [],
                    "lastUpdated": datetime.utcnow(),
                    "version": "1.0"
                }
            nodes_list = doc.setdefault("nodes", [])
            existing_idx = next((i for i, n in enumerate(nodes_list) if str(n.get("id")) == node_id), None)
            if existing_idx is not None:
                nodes_list[existing_idx].update(new_node)
            else:
                nodes_list.append(new_node)

            if arr_ip:
                edges_list = doc.setdefault("edges", [])
                edge_lbl = "CONNECTS_TO" if label == "Host" else ("HAS_SWITCH" if label == "Switch" else f"HAS_{label.upper()}")
                src = node_id if label == "Host" else arr_ip
                tgt = arr_ip if label == "Host" else node_id
                edge_exists = any(str(e.get("source")) == src and str(e.get("target")) == tgt for e in edges_list)
                if not edge_exists:
                    edges_list.append({
                        "from": src,
                        "to": tgt,
                        "source": src,
                        "target": tgt,
                        "label": edge_lbl
                    })
            doc["lastUpdated"] = datetime.utcnow()
            db.sandatas.replace_one({}, doc, upsert=True)
            log.info(f"[mongo] Successfully created node '{node_id}' in MongoDB.")
        except Exception as mongo_err:
            log.warning(f"[mongo] Failed to write to MongoDB: {mongo_err}")
            return jsonify({"error": f"MongoDB write failed: {str(mongo_err)}"}), 500

    # 3. Write to Neo4j (Optional / Best effort)
    eid = None
    if neo4j.available:
        try:
            if label == "Host":
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
                    ip=ip_addr or node_id,
                    name=node_name,
                    arr=arr_ip,
                )
            elif label == "Switch":
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
                    name=node_name,
                    serial=serial_no or node_name,
                    arr=arr_ip,
                )
            elif label == "ArraySystem":
                rows = neo4j._run(
                    """
                    MERGE (n:ArraySystem {ip_address: $ip})
                    SET n.name = coalesce(n.name, $name)
                    RETURN elementId(n) AS element_id
                    """,
                    ip=ip_addr or node_id,
                    name=node_name,
                )
            elif label == "PhysicalDisk":
                rows = neo4j._run(
                    """
                    CREATE (n:PhysicalDisk {serial: $serial})
                    RETURN elementId(n) AS element_id
                    """,
                    serial=serial_no or node_id,
                )
            elif label == "Cage":
                cid = body.get("cage_id") or extra.get("cage_id")
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
                    cname=node_name,
                    arr=arr_ip,
                )
            else:  # Node
                nid = body.get("node_id") or extra.get("node_id")
                rows = neo4j._run(
                    """
                    CREATE (n:Node {node_id: $nid, name: $nm})
                    WITH n
                    MATCH (a:ArraySystem {ip_address: $arr})
                    MERGE (a)-[:HAS_NODE]->(n)
                    RETURN elementId(n) AS element_id
                    """,
                    nid=str(nid),
                    nm=node_name,
                    arr=arr_ip,
                )
            eid = rows[0]["element_id"] if rows else None
            
            patch_props = {k: v for k, v in extra.items() if k in allowed and _valid_prop_key(k)}
            if eid and patch_props:
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
        except Exception as ex:
            log.warning(f"Neo4j write failed: {ex}")

    return jsonify({"status": "ok", "element_id": eid or node_id})

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


@app.route("/api/llm/calls", methods=["GET"])
def get_llm_calls():
    from integrations.rag_engine import get_llm_calls_count
    return jsonify({"count": get_llm_calls_count()})

@app.route("/api/llm/calls/reset", methods=["POST"])
def reset_llm_calls():
    from integrations.rag_engine import reset_llm_calls_count
    return jsonify({"count": reset_llm_calls_count()})


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

@app.route("/api/parsers/testcases-markdown", methods=["GET"])
def get_testcases_markdown_parsers():
    file_path = os.path.join(MONOREPO, "discovery", "parsers", "testcases-markdown.md")
    if not os.path.exists(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        raw_sections = re.split(r'^## FOR ', content, flags=re.MULTILINE)
        
        preface = ""
        if raw_sections and not content.startswith("## FOR "):
            preface = raw_sections.pop(0)
            
        parsers = []
        for raw_sec in raw_sections:
            if not raw_sec.strip():
                continue
            lines = raw_sec.split("\n")
            title = lines[0].strip()
            body = "\n".join(lines[1:])
            
            # Extract JS code block after **PARSING FUNCTION:**
            js_match = re.search(r'\*\*PARSING FUNCTION:\*\*\s*\n*```(?:javascript|js)\n(.*?)```', body, re.DOTALL | re.IGNORECASE)
            code = js_match.group(1).strip() if js_match else ""
            
            if not code:
                # Fallback to any js block
                js_block = re.search(r'```(?:javascript|js)\n(.*?)```', body, re.DOTALL | re.IGNORECASE)
                if js_block:
                    code = js_block.group(1).strip()
            
            func_name = ""
            if code:
                name_match = re.search(r'function\s+(\w+)', code)
                if name_match:
                    func_name = name_match.group(1)
                    
            # Extract CLI outputs
            cli_outputs = []
            cli_matches = re.finditer(r'\*\*CLI O/P.*?\*\*.*?\n```\n*(.*?)\n*```', body, re.DOTALL | re.IGNORECASE)
            for m in cli_matches:
                cli_outputs.append(m.group(1).strip())
                
            if not cli_outputs:
                # Fallback to non-js, non-json blocks
                all_blocks = re.finditer(r'```(\w*)\n*(.*?)\n*```', body, re.DOTALL)
                for ab in all_blocks:
                    lang = ab.group(1).strip().lower()
                    if lang not in ('javascript', 'js', 'json'):
                        cli_outputs.append(ab.group(2).strip())
                        
            # Extract expected parsed outputs
            parsed_outputs = []
            parsed_matches = re.finditer(r'\*\*PARSED OUTPUT.*?\*\*.*?\n```(?:json)?\n*(.*?)\n*```', body, re.DOTALL | re.IGNORECASE)
            for pm in parsed_matches:
                parsed_outputs.append(pm.group(1).strip())
                
            if not parsed_outputs:
                json_blocks = re.finditer(r'```json\n*(.*?)\n*```', body, re.DOTALL | re.IGNORECASE)
                for jb in json_blocks:
                    parsed_outputs.append(jb.group(1).strip())
                    
            parsers.append({
                "title": title,
                "func_name": func_name,
                "code": code,
                "cli_outputs": cli_outputs,
                "parsed_outputs": parsed_outputs
            })
            
        return jsonify({
            "preface": preface,
            "functions": parsers
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/parsers/testcases-markdown", methods=["POST"])
def save_testcases_markdown_parsers():
    file_path = os.path.join(MONOREPO, "discovery", "parsers", "testcases-markdown.md")
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400
        
    preface = data.get("preface", "")
    functions = data.get("functions", [])
    
    try:
        out = []
        if preface:
            out.append(preface.strip())
            
        for sec in functions:
            title = sec.get("title", "").strip()
            if not title:
                title = sec.get("func_name", "").upper()
            if not title:
                continue
                
            out.append(f"## FOR {title}")
            out.append("")
            
            # CLI Outputs
            cli_outs = sec.get("cli_outputs", [])
            if not cli_outs:
                cli_val = sec.get("cli_output")
                if cli_val:
                    cli_outs = [cli_val]
            
            for idx, cli in enumerate(cli_outs):
                label = "CLI O/P"
                if len(cli_outs) > 1:
                    label += f" (Variant {idx + 1})"
                out.append(f"**{label}:**")
                out.append("```")
                out.append(cli.strip())
                out.append("```")
                out.append("")
                
            # Parsing Function
            out.append("**PARSING FUNCTION:**")
            out.append("```javascript")
            out.append(sec.get("code", "").strip())
            out.append("```")
            out.append("")
            
            # Parsed Outputs
            parsed_outs = sec.get("parsed_outputs", [])
            if not parsed_outs:
                parsed_val = sec.get("parsed_output")
                if parsed_val:
                    parsed_outs = [parsed_val]
            for idx, po in enumerate(parsed_outs):
                label = "PARSED OUTPUT"
                if len(parsed_outs) > 1:
                    label += f" (Variant {idx + 1})"
                out.append(f"**{label}:**")
                out.append("```json")
                out.append(po.strip())
                out.append("```")
                out.append("")
                
        # Join and write
        new_content = "\n".join(out).strip() + "\n"
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
            
        return jsonify({"success": True, "message": "testcases-markdown.md saved successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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

def wait_for_services(timeout=60):
    """Wait for Neo4j and Elasticsearch to be ready before starting."""
    start_time = time.time()
    is_es_disabled = os.environ.get("DISABLE_ES", "false").lower() == "true"
    log.info("Waiting for infrastructure (Neo4j/Elasticsearch) to be ready...")
    while time.time() - start_time < timeout:
        if not neo4j.available:
            neo4j._init_driver()
        if not is_es_disabled and not es.available:
            es._init_client()
        
        if neo4j.available and (is_es_disabled or es.available):
            log.info("All infrastructure services are online!")
            return True
        
        log.info(f"Still waiting... (Neo4j: {'ok' if neo4j.available else 'wait'}, ES: {'disabled' if is_es_disabled else ('ok' if es.available else 'wait')})")
        time.sleep(5)
    return False

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5005))
    
    # Wait for databases to wake up before starting the web server (reduced timeout so it doesn't hang forever)
    wait_for_services(timeout=2)

    print("=" * 60)
    print(f"  HPE SAN Monorepo API — http://localhost:{port}")
    print(f"  Neo4j:          {'connected' if neo4j.available else 'unavailable'}")
    print(f"  Elasticsearch:  {'connected' if es.available else 'unavailable'}")
    print(f"  Sim devices:    {len(virtual_network.list_devices())}")
    print("=" * 60)
    
    # Start background threads only in the main worker process, not the reloader process
    if not app.debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        # Auto-index logic in background
        def _auto_index():
            time.sleep(5) # Wait for server to stabilize
            if not es.available:
                return
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

        # Daily automated discovery interval execution scheduler has been disabled at user request.
        # Discovery should only run when manually triggered via the UI.
        pass
    
    app.run(debug=True, host="0.0.0.0", port=port, threaded=True, use_reloader=True)

# Nodemon trigger restart comment
