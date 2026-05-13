import re

def parse_showcage(text, array_name=""):
    """Parse 'showcage' and 'showcage -state' output."""
    nodes = []
    edges = []
    
    for line in text.splitlines():
        # Try showcage -state format
        m = re.match(r"^\s*(\d+)\s+(cage\d+)\s+(\S+)\s+(\S+)\s*$", line)
        if m:
            cage_id = f"cage:{m.group(2)}"
            nodes.append({
                "id": cage_id,
                "type": "Cage",
                "name": m.group(2),
                "state": m.group(3)
            })
            if array_name:
                edges.append({
                    "source": f"array:{array_name}",
                    "target": cage_id,
                    "type": "HAS_CAGE"
                })
            continue

        # Try regular showcage format
        m = re.match(r"^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$", line)
        if m:
            cage_id = f"cage:{m.group(2)}"
            nodes.append({
                "id": cage_id,
                "type": "Cage",
                "name": m.group(2),
                "state": m.group(7)
            })
            if array_name:
                edges.append({
                    "source": f"array:{array_name}",
                    "target": cage_id,
                    "type": "HAS_CAGE"
                })
                
    return {"nodes": nodes, "edges": edges}
