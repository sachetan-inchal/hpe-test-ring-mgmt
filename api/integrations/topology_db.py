"""
topology_db.py

JSON-based CRUD for the ontology topology database (database.json).
Ported from Unmesh's FastAPI project — provides:
  - Load/save database.json
  - CRUD operations on nodes
  - Decommission cascade logic
  - Edge management
"""
import json
import os
import threading
from pathlib import Path


class TopologyDB:
    """Thread-safe JSON topology store backed by data/ontology/database.json."""

    def __init__(self, db_path: str = None):
        if db_path is None:
            monorepo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            db_path = os.path.join(monorepo, "data", "ontology", "database.json")
        self.db_path = db_path
        self._lock = threading.Lock()

    # ── Read / Write ──────────────────────────────────────────────────────

    def _read(self) -> dict:
        p = Path(self.db_path)
        if not p.exists():
            return {"nodes": [], "edges": []}
        return json.loads(p.read_text(encoding="utf-8"))

    def _write(self, data: dict):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        Path(self.db_path).write_text(json.dumps(data, indent=2), encoding="utf-8")

    # ── Public API ────────────────────────────────────────────────────────

    def get_topology(self) -> dict:
        """Return the full topology (nodes + edges)."""
        with self._lock:
            return self._read()

    def get_node(self, node_id: str) -> dict | None:
        data = self.get_topology()
        for n in data.get("nodes", []):
            if str(n.get("id")) == node_id:
                return n
        return None

    def update_node(self, node_id: str, *, is_decommissioned: bool | None = None,
                    properties: dict | None = None) -> dict:
        """
        Update a node's properties and/or decommission status.
        Decommission cascades to children (nodes with parentId == node_id).
        """
        with self._lock:
            data = self._read()
            found = False
            for node in data.get("nodes", []):
                if str(node.get("id")) == node_id:
                    found = True
                    if is_decommissioned is not None:
                        node["isDecommissioned"] = is_decommissioned
                        # Cascade to children
                        for child in data.get("nodes", []):
                            if str(child.get("parentId")) == node_id:
                                child["isDecommissioned"] = is_decommissioned
                    if properties:
                        for k, v in properties.items():
                            node[k] = v
                    break

            if not found:
                raise KeyError(f"Node '{node_id}' not found")

            self._write(data)
            return {"status": "ok"}

    def add_node(self, node_data: dict) -> dict:
        """
        Add a new node. Required fields: id, name, type, status, category.
        Optional: parentId, isDecommissioned, extra properties.
        """
        node_id = str(node_data.get("id", ""))
        if not node_id:
            raise ValueError("Node id is required")

        with self._lock:
            data = self._read()
            if any(str(n.get("id")) == node_id for n in data.get("nodes", [])):
                raise ValueError(f"Node ID '{node_id}' already exists")

            new_node = {
                "id": node_id,
                "name": node_data.get("name", node_id),
                "type": node_data.get("type", "Unknown"),
                "status": node_data.get("status", "normal"),
                "category": node_data.get("category", "main"),
                "parentId": node_data.get("parentId"),
                "isDecommissioned": node_data.get("isDecommissioned", False),
            }
            # Merge any extra properties
            props = node_data.get("properties")
            if isinstance(props, dict):
                new_node.update(props)

            data.setdefault("nodes", []).append(new_node)
            self._write(data)
            return {"status": "ok", "node": new_node}

    def delete_node(self, node_id: str) -> dict:
        """Delete a node and all edges referencing it."""
        with self._lock:
            data = self._read()
            initial = len(data.get("nodes", []))
            data["nodes"] = [n for n in data.get("nodes", []) if str(n.get("id")) != node_id]

            if len(data["nodes"]) == initial:
                raise KeyError(f"Node '{node_id}' not found")

            # Remove edges involving this node
            data["edges"] = [
                e for e in data.get("edges", [])
                if str(e.get("from")) != node_id and str(e.get("to")) != node_id
            ]
            self._write(data)
            return {"status": "ok"}

    def get_stats(self) -> dict:
        """Return summary statistics for health/admin dashboards."""
        data = self.get_topology()
        nodes = data.get("nodes", [])
        active = [n for n in nodes if not n.get("isDecommissioned")]
        return {
            "total_nodes": len(nodes),
            "active_nodes": len(active),
            "decommissioned": len(nodes) - len(active),
            "normal": sum(1 for n in active if n.get("status") == "normal"),
            "degraded": sum(1 for n in active if n.get("status") == "degraded"),
            "failed": sum(1 for n in active if n.get("status") == "failed"),
            "types": {},
        }
