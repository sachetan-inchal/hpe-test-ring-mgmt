"""Thin Cypher runner for RAG / ingest, backed by discovery Neo4jStore."""


def _serialize_value(v):
    if v is None:
        return None
    if hasattr(v, "items"):
        try:
            return dict(v)
        except Exception:
            return str(v)
    if hasattr(v, "__iter__") and not isinstance(v, (str, bytes)):
        try:
            return [_serialize_value(x) for x in v]
        except Exception:
            return str(v)
    return v


def run_cypher(neo4j_store, query, params=None):
    """Execute Cypher and return plain JSON-serializable dict rows."""
    if not neo4j_store or not neo4j_store.available:
        raise RuntimeError("Neo4j not available")
    params = params or {}
    rows = neo4j_store._run(query, **params)
    out = []
    for r in rows:
        clean = {}
        for k, v in r.items():
            clean[k] = _serialize_value(v)
        out.append(clean)
    return out
