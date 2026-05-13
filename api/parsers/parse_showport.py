import re

def parse_showport(text):
    """Parse 'showport' output."""
    nodes = []
    edges = []
    
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+:\d+:\d+)\s+(initiator|target|peer)\s+"
            r"(ready|loss_sync|offline)\s+(\S+)\s+(\S+)\s+"
            r"(host|disk|free|file|cluster)\s+(\S+)\s*(.*)?$",
            line
        )
        if m:
            port_id_raw = m.group(1)
            node_num = port_id_raw.split(":")[0]
            # We need a way to link to the node. 
            # In our naming, nodes are usually named after their serial or node0, node1, etc.
            # For simplicity, let's assume node id is node:0, node:1 etc or we find it later.
            
            port_id = f"port:{port_id_raw}"
            nodes.append({
                "id": port_id,
                "type": "Port",
                "name": port_id_raw,
                "mode": m.group(2),
                "state": m.group(3),
                "protocol": m.group(7)
            })
            
            # Link port to node (heuristic)
            # nodes.append({"id": f"node:{node_num}", "type": "Node", "name": f"node{node_num}"})
            edges.append({
                "source": f"node:node{node_num}", # Assuming standard naming for now
                "target": port_id,
                "type": "HAS_PORT"
            })
                
    return {"nodes": nodes, "edges": edges}
