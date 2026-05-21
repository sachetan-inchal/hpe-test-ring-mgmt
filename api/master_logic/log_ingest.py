"""
api/master_logic/log_ingest.py

LogIngestManager — Dual-mode log file ingest engine.

Modes:
  - TXT: Raw terminal snapshot (handles prompts, SSH banners, human text)
  - JSON: Parsed array data (list of array dicts or single dict)

Flow:
  1. Backup current Neo4j + MongoDB + ES data  →  data/backups/<timestamp>.json
  2. Wipe all 3 databases
  3. Parse the file and populate all 3 databases
  4. Return stats + backup_id   (backup_id can be used to restore later)
"""

import json
import logging
import os
import re
import time
from datetime import datetime, timezone

log = logging.getLogger(__name__)

MONOREPO   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKUP_DIR = os.path.join(MONOREPO, "data", "backups")

# ── TXT cleaning regexes ──────────────────────────────────────────────────────
# Shell prompt: user@host:path# cmd
_RE_PROMPT   = re.compile(r"^[a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+:[^\n]*#\s+\S+.*$", re.MULTILINE)
# Bash -x nested trace
_RE_TRACE    = re.compile(r"^\+\+\s", re.MULTILINE)
# SSH housekeeping lines
_RE_SSH      = re.compile(
    r"^(The authenticity of host|Warning: Permanently added"
    r"|Are you sure you want to continue|Permanently added"
    r"|Last login:|Enter passphrase|spawn |Password:\s*$)",
    re.IGNORECASE | re.MULTILINE,
)
# Human-written section headers / comment blocks
_RE_HEADER   = re.compile(r"^(#{2,}|={3,}|-{3,}|NOTE:|TODO:|DESCRIPTION:|ARRAY\s+\d+\s*[:–\-])", re.MULTILINE | re.IGNORECASE)


def _clean_txt(raw_text: str) -> str:
    """Strip terminal noise from a raw CLI snapshot so parsers can handle it cleanly."""
    lines = raw_text.splitlines()
    clean = []
    for line in lines:
        s = line.rstrip()
        # Shell prompts  user@host:~# somecommand
        if re.match(r"^[a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+:[^\n]*#\s+", s):
            continue
        # Nested bash trace ++ 
        if s.startswith("++ "):
            continue
        # SSH banners / prompts
        if re.match(
            r"^(The authenticity|Warning:.*Permanently|Are you sure|Permanently added"
            r"|Last login:|Enter passphrase|Password:\s*$|spawn )",
            s, re.IGNORECASE,
        ):
            continue
        # Human section headers
        if re.match(r"^(#{2,}|={3,}|-{3,})", s):
            continue
        if re.match(r"^(NOTE|TODO|DESCRIPTION|ARRAY\s+\d+)[:–\-]", s, re.IGNORECASE):
            continue
        clean.append(s)
    return "\n".join(clean)


def _split_multi_array_txt(raw_text: str) -> list:
    """
    Split a multi-array terminal capture into per-array text sections.

    Heuristic: a new array section starts when we see a shell prompt for
    'showsys' OR a standalone 'showsys' header line after a long gap.
    Falls back to returning the whole text as one section.
    """
    # Split on prompt lines that precede 'showsys'
    parts = re.split(
        r"(?=^[a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+:[^\n]*#\s+showsys\b)",
        raw_text,
        flags=re.MULTILINE,
    )
    if len(parts) > 1:
        return [p for p in parts if p.strip()]

    # Fallback: split on bare 'showsys' lines that look like command headers
    # (lines where 'showsys' is the only content, preceded by a blank line)
    parts = re.split(r"(?:^|\n)(?=showsys\s*\n)", raw_text)
    if len(parts) > 1:
        return [p for p in parts if p.strip()]

    # Single-array file
    return [raw_text]


# ── LogIngestManager ─────────────────────────────────────────────────────────

class LogIngestManager:
    """Full ingest lifecycle: backup → wipe → parse → populate (reversible)."""

    def __init__(self, neo4j_store, mongo_store, es_indexer):
        self.neo4j = neo4j_store
        self.mongo = mongo_store
        self.es    = es_indexer
        os.makedirs(BACKUP_DIR, exist_ok=True)

    # ── Backup ───────────────────────────────────────────────────────────────

    def _backup_neo4j(self) -> dict:
        if not self.neo4j.available:
            return {"nodes": [], "edges": []}
        try:
            nodes_raw = self.neo4j._run(
                "MATCH (n) RETURN labels(n)[0] AS label, "
                "properties(n) AS props, elementId(n) AS eid"
            )
            edges_raw = self.neo4j._run(
                "MATCH (a)-[r]->(b) "
                "RETURN elementId(a) AS src_eid, elementId(b) AS tgt_eid, "
                "type(r) AS rel_type, properties(r) AS rprops"
            )
            nodes = [{"eid": n["eid"], "label": n["label"], "props": dict(n["props"])} for n in nodes_raw]
            edges = [
                {
                    "src_eid": e["src_eid"],
                    "tgt_eid": e["tgt_eid"],
                    "rel_type": e["rel_type"],
                    "rprops": dict(e["rprops"]),
                }
                for e in edges_raw
            ]
            return {"nodes": nodes, "edges": edges}
        except Exception as ex:
            log.warning(f"[log_ingest] Neo4j backup failed: {ex}")
            return {"nodes": [], "edges": []}

    def _backup_mongo(self) -> dict:
        if not self.mongo.available:
            return {}
        try:
            doc = self.mongo.db.sandatas.find_one({})
            if doc:
                doc.pop("_id", None)
                return doc
            return {}
        except Exception as ex:
            log.warning(f"[log_ingest] MongoDB backup failed: {ex}")
            return {}

    def _backup_es(self) -> dict:
        if not self.es.available:
            return {}
        try:
            indices = ["hpe_san_arrays", "hpe_san_hosts", "hpe_san_drives", "hpe_san_events"]
            backup = {}
            for idx in indices:
                try:
                    results = self.es._client.search(
                        index=idx,
                        body={"query": {"match_all": {}}, "size": 10000},
                    )
                    backup[idx] = [
                        {"_id": h["_id"], "_source": h["_source"]}
                        for h in results["hits"]["hits"]
                    ]
                except Exception:
                    backup[idx] = []
            return backup
        except Exception as ex:
            log.warning(f"[log_ingest] ES backup failed: {ex}")
            return {}

    def create_backup(self, label: str = None) -> str:
        """Export Neo4j + MongoDB + ES to data/backups/<timestamp>.json. Returns backup_id."""
        backup_id = datetime.now(timezone.utc).strftime("backup_%Y%m%d_%H%M%S")
        neo4j_data = self._backup_neo4j()
        mongo_data = self._backup_mongo()
        es_data    = self._backup_es()
        backup = {
            "backup_id":  backup_id,
            "label":      label or backup_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "neo4j":  neo4j_data,
            "mongo":  mongo_data,
            "es":     es_data,
        }
        path = os.path.join(BACKUP_DIR, f"{backup_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(backup, f, indent=2, default=str)
        log.info(
            f"[log_ingest] Backup saved: {backup_id} ({label or backup_id}) "
            f"({len(neo4j_data['nodes'])} Neo4j nodes, "
            f"{len(mongo_data.get('nodes', []))} Mongo nodes)"
        )
        return backup_id

    def list_backups(self) -> list:
        """Return metadata for all available backups (newest first)."""
        os.makedirs(BACKUP_DIR, exist_ok=True)
        results = []
        for fn in sorted(os.listdir(BACKUP_DIR), reverse=True):
            if not fn.endswith(".json"):
                continue
            path = os.path.join(BACKUP_DIR, fn)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                results.append({
                    "backup_id":   meta.get("backup_id", fn[:-5]),
                    "label":       meta.get("label", meta.get("backup_id", fn[:-5])),
                    "created_at":  meta.get("created_at", ""),
                    "neo4j_nodes": len(meta.get("neo4j", {}).get("nodes", [])),
                    "neo4j_edges": len(meta.get("neo4j", {}).get("edges", [])),
                    "mongo_nodes": len(meta.get("mongo", {}).get("nodes", [])),
                    "filename":    fn,
                })
            except Exception:
                pass
        return results

    # ── Wipe ─────────────────────────────────────────────────────────────────

    def _wipe_neo4j(self):
        if not self.neo4j.available:
            return
        self.neo4j._run("MATCH (n) DETACH DELETE n")
        log.info("[log_ingest] Neo4j wiped.")

    def _wipe_mongo(self):
        if not self.mongo.available:
            return
        self.mongo.db.sandatas.delete_many({})
        self.mongo.nodes = {}
        self.mongo.edges = set()
        log.info("[log_ingest] MongoDB wiped.")

    def _wipe_es(self):
        if not self.es.available:
            return
        for idx in ["hpe_san_arrays", "hpe_san_hosts", "hpe_san_drives", "hpe_san_events"]:
            try:
                self.es._client.delete_by_query(
                    index=idx,
                    body={"query": {"match_all": {}}},
                    conflicts="proceed",
                )
            except Exception:
                pass
        log.info("[log_ingest] Elasticsearch wiped.")

    def wipe_all(self):
        self._wipe_neo4j()
        self._wipe_mongo()
        self._wipe_es()

    # ── Restore ──────────────────────────────────────────────────────────────

    def restore(self, backup_id: str) -> dict:
        """
        Restore a previous backup snapshot.
        1. Wipes all 3 databases
        2. Replays the backed-up nodes/edges/docs
        Returns restore stats.
        """
        path = os.path.join(BACKUP_DIR, f"{backup_id}.json")
        if not os.path.exists(path):
            raise FileNotFoundError(f"Backup not found: {backup_id}")

        with open(path, "r", encoding="utf-8") as f:
            backup = json.load(f)

        self.wipe_all()
        stats = {"neo4j_nodes": 0, "neo4j_edges": 0, "mongo_nodes": 0, "es_docs": 0}

        # ── Neo4j restore ──
        neo4j_data = backup.get("neo4j", {})
        nodes = neo4j_data.get("nodes", [])
        edges = neo4j_data.get("edges", [])
        eid_to_info: dict = {}   # old_eid → (label, name_for_match)

        if self.neo4j.available:
            for node in nodes:
                label = node.get("label") or "Unknown"
                props = node.get("props") or {}
                old_eid = node.get("eid")
                # Pick best match key
                match_val = (
                    props.get("ip_address")
                    or props.get("serial")
                    or props.get("port_id")
                    or props.get("slot_id")
                    or props.get("name")
                    or props.get("id")
                    or ""
                )
                match_key = "name"
                if props.get("ip_address"):
                    match_key = "ip_address"
                elif props.get("serial"):
                    match_key = "serial"
                elif props.get("port_id"):
                    match_key = "port_id"
                elif props.get("slot_id"):
                    match_key = "slot_id"

                if not match_val:
                    continue  # Skip anonymous nodes – can't MERGE without an ID
                try:
                    cypher = f"MERGE (n:{label} {{{match_key}: $val}}) SET n += $props"
                    self.neo4j._run(cypher, val=match_val, props=props)
                    eid_to_info[old_eid] = (label, match_key, match_val)
                    stats["neo4j_nodes"] += 1
                except Exception as ex:
                    log.warning(f"[restore] Node restore failed ({label}): {ex}")

            for edge in edges:
                src = eid_to_info.get(edge.get("src_eid"))
                tgt = eid_to_info.get(edge.get("tgt_eid"))
                rel  = edge.get("rel_type", "RELATES_TO")
                if not src or not tgt:
                    continue
                try:
                    cypher = (
                        f"MATCH (a:{src[0]} {{{src[1]}: $sv}}) "
                        f"MATCH (b:{tgt[0]} {{{tgt[1]}: $tv}}) "
                        f"MERGE (a)-[:{rel}]->(b)"
                    )
                    self.neo4j._run(cypher, sv=src[2], tv=tgt[2])
                    stats["neo4j_edges"] += 1
                except Exception as ex:
                    log.warning(f"[restore] Edge restore failed: {ex}")

        # ── MongoDB restore ──
        mongo_data = backup.get("mongo", {})
        if self.mongo.available and mongo_data:
            try:
                mongo_data["lastUpdated"] = datetime.now(timezone.utc)
                self.mongo.db.sandatas.replace_one({}, mongo_data, upsert=True)
                stats["mongo_nodes"] = len(mongo_data.get("nodes", []))
            except Exception as ex:
                log.warning(f"[restore] MongoDB restore failed: {ex}")

        # ── Elasticsearch restore ──
        es_data = backup.get("es", {})
        if self.es.available and es_data:
            for idx, docs in es_data.items():
                for doc in docs:
                    try:
                        self.es._client.index(
                            index=idx,
                            id=doc.get("_id"),
                            document=doc.get("_source", {}),
                        )
                        stats["es_docs"] += 1
                    except Exception:
                        pass

        log.info(f"[restore] Restored {backup_id}: {stats}")
        return {"backup_id": backup_id, "restored": stats}

    # ── Parse + Populate ─────────────────────────────────────────────────────

    def _store_parsed(self, parsed: dict):
        """Write a parsed array dict into Neo4j + MongoDB + Elasticsearch."""
        # The stores need _device_type and _ip markers
        parsed.setdefault("_device_type", "hpe_array")
        parsed.setdefault("_ip", parsed.get("array_id") or parsed.get("name") or "ingested")

        if self.neo4j.available:
            try:
                self.neo4j.store(parsed)
            except Exception as ex:
                log.warning(f"[log_ingest] Neo4j store failed: {ex}")

        if self.mongo.available:
            try:
                self.mongo.store(parsed)
            except Exception as ex:
                log.warning(f"[log_ingest] MongoDB store failed: {ex}")

        if self.es.available:
            try:
                self.es.index(parsed)
            except Exception as ex:
                log.warning(f"[log_ingest] ES index failed: {ex}")

    def ingest_txt(self, raw_text: str) -> dict:
        """Parse a raw TXT terminal snapshot and store results in all databases."""
        from api.master_logic.universal_parser import parse_array_dump

        cleaned  = _clean_txt(raw_text)
        sections = _split_multi_array_txt(cleaned)

        parsed_arrays, errors = [], []
        for i, section in enumerate(sections):
            if not section.strip():
                continue
            try:
                parsed = parse_array_dump(section)
                if parsed.get("name") or parsed.get("array_id"):
                    parsed_arrays.append(parsed)
                    log.info(f"[log_ingest] TXT §{i+1}: parsed '{parsed.get('name', 'unknown')}'")
                else:
                    errors.append(f"Section {i+1}: no array identity found (check showsys block)")
            except Exception as ex:
                errors.append(f"Section {i+1}: {str(ex)}")
                log.warning(f"[log_ingest] TXT §{i+1} parse error: {ex}")

        for p in parsed_arrays:
            self._store_parsed(p)

        return {
            "mode":           "txt",
            "sections_found": len(sections),
            "arrays_parsed":  len(parsed_arrays),
            "errors":         errors,
            "arrays": [
                {
                    "name":   p.get("name"),
                    "serial": p.get("serial"),
                    "model":  p.get("model"),
                    "drives": len(p.get("drives", [])),
                    "hosts":  len(p.get("hosts", [])),
                    "ports":  len(p.get("ports", [])),
                }
                for p in parsed_arrays
            ],
        }

    def ingest_json(self, data) -> dict:
        """Parse a JSON array dump (list or single dict) and store in all databases."""
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = [data]
        else:
            return {"mode": "json", "items_found": 0, "arrays_parsed": 0, "errors": ["Invalid JSON – expected object or array"], "arrays": []}

        parsed_arrays, errors = [], []
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                errors.append(f"Item {i}: not a dict, skipping")
                continue
            if item.get("name") or item.get("array_id"):
                parsed_arrays.append(item)
                log.info(f"[log_ingest] JSON item {i+1}: '{item.get('name', 'unknown')}'")
            else:
                errors.append(f"Item {i}: missing 'name' or 'array_id' field")

        for p in parsed_arrays:
            self._store_parsed(p)

        return {
            "mode":          "json",
            "items_found":   len(items),
            "arrays_parsed": len(parsed_arrays),
            "errors":        errors,
            "arrays": [
                {
                    "name":   p.get("name"),
                    "serial": p.get("serial"),
                    "model":  p.get("model"),
                    "drives": len(p.get("drives", [])),
                    "hosts":  len(p.get("hosts", [])),
                    "ports":  len(p.get("ports", [])),
                }
                for p in parsed_arrays
            ],
        }

    def ingest(self, raw_text: str = None, json_data=None, skip_backup: bool = False, snapshot_label: str = None) -> dict:
        """
        Full pipeline:  backup → wipe → parse → populate.

        Args:
            raw_text:       Raw .txt terminal snapshot content.
            json_data:      Parsed JSON (list or dict).
            skip_backup:    If True, skips the backup step (dangerous – use only for testing).
            snapshot_label: Custom label to automatically save the newly ingested data as a snapshot.

        Returns:
            dict with keys: backup_id, snapshot_id, mode, arrays_parsed, errors, elapsed_sec, status
        """
        t0 = time.time()

        # 1. Backup (so the operation is reversible)
        backup_id = None
        if not skip_backup:
            try:
                backup_id = self.create_backup()
            except Exception as ex:
                log.warning(f"[log_ingest] Backup step failed (continuing anyway): {ex}")

        # 2. Wipe
        self.wipe_all()

        # 3. Parse + Populate
        if json_data is not None:
            result = self.ingest_json(json_data)
        elif raw_text is not None:
            result = self.ingest_txt(raw_text)
        else:
            raise ValueError("Provide either raw_text (TXT mode) or json_data (JSON mode).")

        # 3.5. Auto-snapshot the new environment
        new_snapshot_id = None
        if snapshot_label and result.get("arrays_parsed", 0) > 0:
            try:
                new_snapshot_id = self.create_backup(label=snapshot_label)
            except Exception as ex:
                log.warning(f"[log_ingest] Auto-snapshot step failed: {ex}")

        # 4. Attach metadata
        elapsed = round(time.time() - t0, 2)
        result["backup_id"]   = backup_id
        result["snapshot_id"] = new_snapshot_id
        result["elapsed_sec"] = elapsed
        result["status"]      = "success" if result.get("arrays_parsed", 0) > 0 else "partial"

        log.info(
            f"[log_ingest] Done: {result['arrays_parsed']} arrays in {elapsed}s "
            f"(backup: {backup_id}, snapshot: {new_snapshot_id})"
        )
        return result
