import re

def parse_showsys(text):
    """Parse 'showsys' output."""
    nodes = []
    edges = []
    
    for line in text.splitlines():
        # Try full format: ID Name Model Serial Nodes Master TotalCap AllocCap FreeCap FailedCap
        m = re.match(
            r"^\s*(0x\w+)\s+(\S+)\s+(.+?)\s+(\S+)\s+(\d+)\s+(\d+)\s+"
            r"(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$", line
        )
        if m:
            array_id = f"array:{m.group(2)}"
            nodes.append({
                "id": array_id,
                "type": "Array",
                "name": m.group(2),
                "model": m.group(3).strip(),
                "serial": m.group(4)
            })
            break # Usually only one system info line
            
    return {"nodes": nodes, "edges": edges}
