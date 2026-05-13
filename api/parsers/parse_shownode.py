import re

def parse_shownode(text, array_name=""):
    """Parse 'shownode' output."""
    nodes = []
    edges = []
    
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+)\s+(\S+)\s+(\d+:\d+)\s+(Yes|No)\s+(Yes|No)\s+(\d+)\s+(.+)$",
            line
        )
        if m:
            node_id = f"node:{m.group(2)}"
            nodes.append({
                "id": node_id,
                "type": "Node",
                "name": m.group(2),
                "encl_bay": m.group(3),
                "is_master": m.group(4) == "Yes"
            })
            if array_name:
                edges.append({
                    "source": f"array:{array_name}",
                    "target": node_id,
                    "type": "HAS_NODE"
                })
                
    return {"nodes": nodes, "edges": edges}
