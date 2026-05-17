import sys
import os
import json

# Add api directory to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))

from app import _filter_graph_payload, _topology_db

actor = {
    "id": "some-id",
    "role": "team_member",
    "team": "Team-Alpha",
    "cluster": "Cluster-A",
    "managed_teams": set(),
    "managed_clusters": set()
}

payload = _topology_db.get_topology()
filtered = _filter_graph_payload(payload, actor)

print("Original nodes count:", len(payload.get("nodes", [])))
print("Filtered nodes count:", len(filtered.get("nodes", [])))
print("Filtered nodes:")
for n in filtered.get("nodes", []):
    print(n.get("id"), n.get("team"), n.get("cluster"))
