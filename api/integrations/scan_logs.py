#!/usr/bin/env python3
"""
scan_logs.py

Scans raw HPE log files (m1, m2, m3, m4) to extract and classify SAN device names
using the MLEntityClassifier. Saves results to a master index JSON file
and registers discovered components in Neo4j and MongoDB.
"""
import os
import sys
import json
import logging

# Ensure parent directories are in the path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MONOREPO = os.path.dirname(os.path.dirname(BASE_DIR))
sys.path.insert(0, MONOREPO)

from api.integrations.ml_extractor import MLEntityClassifier
from discovery.neo4j_store import Neo4jStore
from discovery.mongo_store import MongoStore

logging.basicConfig(level=logging.INFO, format="%(levelname)s [scan_logs] %(message)s")
log = logging.getLogger(__name__)

# Search paths for logs
ROOT_DIR = os.path.dirname(MONOREPO)
LOGS_TO_SCAN = [
    ("m1-array_proxy.txt", os.path.join(ROOT_DIR, "m1-array_proxy.txt")),
    ("m2-commands-data.txt", os.path.join(ROOT_DIR, "m2-commands-data.txt")),
    ("m3-spreadsheet-csv.txt", os.path.join(ROOT_DIR, "m3-spreadsheet-csv.txt")),
    ("m4-sshcmdsoutput.txt", os.path.join(ROOT_DIR, "m4-sshcmdsoutput.txt"))
]

INDEX_OUTPUT_PATH = os.path.join(MONOREPO, "data", "master_index.json")

def scan_all():
    classifier = MLEntityClassifier()
    master_index = {
        "hosts": set(),
        "switches": set(),
        "arrays": set()
    }
    
    # 1. Scan each log file
    for name, path in LOGS_TO_SCAN:
        # Fallback to monorepo copy if root doesn't exist
        if not os.path.exists(path):
            path = os.path.join(MONOREPO, name)
            
        if os.path.exists(path):
            log.info(f"Scanning log file: {path}")
            res = classifier.scan_log_file(path)
            for k in master_index:
                master_index[k].update(res.get(k, []))
        else:
            log.warning(f"Log file not found: {name}")

    # Convert to serialized format
    master_index = {k: sorted(list(v)) for k, v in master_index.items()}
    
    # Ensure data directory exists
    os.makedirs(os.path.dirname(INDEX_OUTPUT_PATH), exist_ok=True)
    with open(INDEX_OUTPUT_PATH, "w") as f:
        json.dump(master_index, f, indent=2)
    log.info(f"Master index saved to: {INDEX_OUTPUT_PATH}")
    log.info(f"Found: {len(master_index['hosts'])} hosts, {len(master_index['switches'])} switches, {len(master_index['arrays'])} arrays.")
    
    # 2. Sync to database stores
    neo4j = Neo4jStore()
    mongo = MongoStore()
    
    if neo4j.available:
        log.info("Syncing master index to Neo4j...")
        # Store individual nodes in Neo4j
        for h in master_index["hosts"]:
            neo4j.execute_write("MERGE (h:Host {name: $name}) ON CREATE SET h.status='normal'", {"name": h})
        for s in master_index["switches"]:
            neo4j.execute_write("MERGE (s:Switch {name: $name}) ON CREATE SET s.status='normal'", {"name": s})
        for a in master_index["arrays"]:
            neo4j.execute_write("MERGE (a:ArraySystem {name: $name}) ON CREATE SET a.status='normal'", {"name": a})
        log.info("Neo4j sync complete.")
        
    if mongo.available:
        log.info("Syncing master index to MongoDB...")
        try:
            # Save consolidated index document
            db = mongo._client.hpe_san
            db.master_index.update_one(
                {"_id": "master_index"},
                {"$set": master_index},
                upsert=True
            )
            log.info("MongoDB sync complete.")
        except Exception as e:
            log.warning(f"MongoDB write failed: {e}")

if __name__ == "__main__":
    scan_all()
