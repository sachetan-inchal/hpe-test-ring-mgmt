import os
from pymongo import MongoClient

mongo_uri = "mongodb+srv://hpeuser:hpeuserpassword@cluster0.2xwbcdn.mongodb.net/?appName=Cluster0"
client = MongoClient(mongo_uri)

# List the databases
print("Databases:", client.list_database_names())

# Check the 'test' database
db = client.test
print("Collections in 'test':", db.list_collection_names())

if "sandatas" in db.list_collection_names():
    doc = db.sandatas.find_one({})
    if doc:
        print("sandatas has a document. Keys:", doc.keys())
        print("nodes count:", len(doc.get("nodes", [])))
        print("edges count:", len(doc.get("edges", [])))
        # Let's print some node IDs
        print("Example node IDs:", [n.get("id") for n in doc.get("nodes", [])[:10]])
    else:
        print("sandatas collection exists but is empty.")
else:
    print("sandatas collection does not exist in 'test' database.")
