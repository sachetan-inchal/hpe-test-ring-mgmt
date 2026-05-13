import re

def parse_showpd(text):
    """Parse 'showpd' output."""
    nodes = []
    edges = []
    
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+)\s+(\d+:\d+)\s+(\S+)\s+(\S+)\s+(normal|degraded|failed)\s+(\d+)\s+(\d+)\s+(\d+)",
            line
        )
        if m:
            pd_id = f"disk:{m.group(1)}"
            cage_id = m.group(2).split(":")[0]
            nodes.append({
                "id": pd_id,
                "type": "Disk",
                "name": f"PD {m.group(1)}",
                "cage_pos": m.group(2),
                "state": m.group(5),
                "capacity": m.group(8)
            })
            edges.append({
                "source": f"cage:cage{cage_id}",
                "target": pd_id,
                "type": "CONTAINS"
            })
                
    return {"nodes": nodes, "edges": edges}
