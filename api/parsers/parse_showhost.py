import re

def parse_showhost(text):
    """Parse 'showhost' output."""
    nodes = []
    edges = []
    
    host_map = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(?:--\s+)?(\w{16})\s+(\d+:\d+:\d+|\-{3})\s*$", line)
        if m:
            wwn, port = m.group(1), m.group(2)
            if wwn not in host_map:
                host_map[wwn] = []
            if port != "---":
                host_map[wwn].append(port)

    for wwn, ports in host_map.items():
        host_id = f"host:{wwn}"
        nodes.append({
            "id": host_id,
            "type": "Host",
            "name": wwn,
            "wwn": wwn
        })
        for p in ports:
            edges.append({
                "source": f"port:{p}",
                "target": host_id,
                "type": "CONNECTED_TO"
            })
                
    return {"nodes": nodes, "edges": edges}
