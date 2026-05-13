import networkx as nx

class TopologyGraph:
    def __init__(self):
        self.graph = nx.MultiDiGraph()

    def add_node(self, node_id, node_type, **kwargs):
        """Add or update a node in the graph."""
        self.graph.add_node(node_id, node_type=node_type, **kwargs)

    def add_edge(self, source, target, edge_type, **kwargs):
        """Add or update an edge in the graph."""
        self.graph.add_edge(source, target, type=edge_type, **kwargs)

    def clear(self):
        self.graph.clear()

    def get_nodes(self):
        nodes = []
        for nid, attrs in self.graph.nodes(data=True):
            nodes.append({"id": nid, **attrs})
        return nodes

    def get_edges(self):
        edges = []
        for u, v, attrs in self.graph.edges(data=True):
            edges.append({"source": u, "target": v, **attrs})
        return edges

    def to_dict(self):
        return {
            "nodes": self.get_nodes(),
            "edges": self.get_edges()
        }

    def to_cytoscape(self):
        """Convert to Cytoscape.js compatible JSON."""
        elements = []
        for nid, attrs in self.graph.nodes(data=True):
            elements.append({
                "group": "nodes",
                "data": {"id": nid, **attrs}
            })
        
        edge_id = 0
        for u, v, attrs in self.graph.edges(data=True):
            elements.append({
                "group": "edges",
                "data": {
                    "id": f"e{edge_id}",
                    "source": u,
                    "target": v,
                    **attrs
                }
            })
            edge_id += 1
        return elements

    def export_to_neo4j(self, neo4j_driver=None):
        """Export the current NetworkX graph to Neo4j."""
        print("Exporting topology to Neo4j...")
        nodes = self.get_nodes()
        edges = self.get_edges()
        
        if neo4j_driver:
            # We use the provided neo4j_driver (monorepo's Neo4jStore)
            for node in nodes:
                node_id = node.get("id")
                node_type = node.get("node_type", "Node")
                # Clean up props for Cypher
                props = {k: v for k, v in node.items() if k not in ("id", "node_type")}
                cypher = f"MERGE (n:{node_type} {{id: $id}}) SET n += $props"
                neo4j_driver._run(cypher, id=node_id, props=props)
            
            for edge in edges:
                src = edge.get("source")
                dst = edge.get("target")
                rel = edge.get("type", "CONNECTED_TO")
                cypher = f"MATCH (a), (b) WHERE a.id = $src AND b.id = $dst MERGE (a)-[r:{rel}]->(b)"
                neo4j_driver._run(cypher, src=src, dst=dst)
        
        return {"status": "success", "nodes_exported": len(nodes), "edges_exported": len(edges)}

# Global singleton instance
topology_graph = TopologyGraph()
