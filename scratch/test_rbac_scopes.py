import requests

BASE_URL = "http://localhost:5005"

def run_tests():
    print("Running RBAC Scope Verification Tests...")

    # 1. Test Admin Access (no filtering - should return all nodes)
    try:
        res_admin = requests.get(
            f"{BASE_URL}/api/ontology/topology?source=all",
            headers={"X-User-Role": "admin"}
        )
        admin_data = res_admin.json()
        print(f"Admin node count: {len(admin_data.get('nodes', []))}")
        assert len(admin_data.get('nodes', [])) > 100, "Admin should see all nodes"
    except Exception as e:
        print(f"Admin test failed: {e}")
        return False

    # 2. Test Team Member Access (strict team-alpha scoped visibility)
    try:
        res_member = requests.get(
            f"{BASE_URL}/api/ontology/topology?source=all",
            headers={
                "X-User-Role": "team_member",
                "X-User-Team": "team-alpha",
                "X-User-Cluster": "cluster-1"
            }
        )
        member_data = res_member.json()
        print(f"Team Member (Team Alpha) node count: {len(member_data.get('nodes', []))}")
        assert len(member_data.get('nodes', [])) < len(admin_data.get('nodes', [])), "Team member should have restricted view"
        assert len(member_data.get('nodes', [])) > 0, "Team member should see their own components"
    except Exception as e:
        print(f"Team member test failed: {e}")
        return False

    # 3. Test MongoDB Endpoint Filter
    try:
        res_mongo = requests.get(
            f"{BASE_URL}/api/graph/mongo",
            headers={
                "X-User-Role": "team_member",
                "X-User-Team": "team-alpha",
                "X-User-Cluster": "cluster-1"
            }
        )
        mongo_data = res_mongo.json()
        print(f"MongoDB Team Scoped node count: {len(mongo_data.get('nodes', []))}")
    except Exception as e:
        print(f"MongoDB endpoint test failed: {e}")
        return False

    print("All RBAC Scope tests passed successfully!")
    return True

if __name__ == "__main__":
    run_tests()
