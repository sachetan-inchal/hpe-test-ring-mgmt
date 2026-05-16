import os
import sys
from neo4j import GraphDatabase
from elasticsearch import Elasticsearch

def test_neo4j():
    uri = "bolt://localhost:7687"
    user = "neo4j"
    password = "hpe_san_password"
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        driver.verify_connectivity()
        print("Neo4j: SUCCESS")
        driver.close()
    except Exception as e:
        print(f"Neo4j: FAILED - {e}")

def test_es():
    host = "http://localhost:9200"
    try:
        es = Elasticsearch(host, verify_certs=False)
        if es.ping():
            print("Elasticsearch: SUCCESS")
        else:
            print("Elasticsearch: PING FAILED")
    except Exception as e:
        print(f"Elasticsearch: FAILED - {e}")

if __name__ == "__main__":
    test_neo4j()
    test_es()
