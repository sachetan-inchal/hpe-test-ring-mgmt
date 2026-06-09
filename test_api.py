import requests
import json
import time

BASE_URL = "http://localhost:5005"

def test_endpoint(name, path, method="GET", body=None):
    url = f"{BASE_URL}{path}"
    print(f"Testing {name:25} | {method:4} {path:40}", end=" | ")
    try:
        if method == "GET":
            r = requests.get(url, timeout=5)
        elif method == "POST":
            r = requests.post(url, json=body, timeout=5)
        
        status = r.status_code
        if 200 <= status < 300:
            print(f"\033[92mPASS ({status})\033[0m")
            return True
        else:
            print(f"\033[91mFAIL ({status})\033[0m")
            print(f"   Response: {r.text[:100]}")
            return False
    except Exception as e:
        print(f"\033[91mERROR\033[0m | {str(e)}")
        return False

def run_suite():
    print("\n" + "="*80)
    print("   HPE SAN MASTER API - AUTOMATED TEST SUITE")
    print("="*80 + "\n")
    
    results = []
    
    # --- CORE ROUTES ---
    results.append(test_endpoint("Health Check", "/api/v1/health"))
    results.append(test_endpoint("API Catalog", "/api/v1/catalog"))
    results.append(test_endpoint("OpenAPI Spec", "/api/v1/openapi.json"))
    
    # --- SAN V1 ROUTES ---
    results.append(test_endpoint("List Devices (v1)", "/api/v1/san/devices"))
    results.append(test_endpoint("List Arrays (v1)", "/api/v1/san/arrays"))
    results.append(test_endpoint("Get Schema (v1)", "/api/v1/san/schema"))
    results.append(test_endpoint("Get Fields (v1)", "/api/v1/san/schema/fields"))
    
    # --- CLI & PARSER ---
    results.append(test_endpoint("CLI Exec (v1)", "/api/v1/san/cli/exec", "POST", 
                                 {"device": "s4634.txt", "command": "showsys"}))
    results.append(test_endpoint("Ingest Dump (v1)", "/api/v1/san/ingest/cli-dump", "POST", 
                                 {"device": "s9999.txt"}))
    
    # --- TOPOLOGY ---
    results.append(test_endpoint("Get Topology (v1)", "/api/v1/san/topology"))
    results.append(test_endpoint("Graph Cytoscape (v1)", "/api/v1/san/graph/cytoscape"))
    results.append(test_endpoint("Ontology Export", "/api/ontology/export"))
    results.append(test_endpoint("Ontology Import", "/api/ontology/import", "POST", {"nodes": [], "edges": []}))
    
    # --- LEGACY ROUTES ---
    print("\n--- Legacy Compatibility Layer ---")
    results.append(test_endpoint("Legacy Devices", "/api/devices"))
    results.append(test_endpoint("Legacy Arrays", "/api/arrays"))
    results.append(test_endpoint("Legacy Topology", "/api/topology"))
    results.append(test_endpoint("Legacy Graph", "/api/graph"))
    
    print("\n" + "="*80)
    passed = results.count(True)
    total = len(results)
    print(f"   RESULTS: {passed}/{total} PASSED")
    print("="*80 + "\n")

if __name__ == "__main__":
    # Wait a bit for server if just started
    time.sleep(1)
    run_suite()
