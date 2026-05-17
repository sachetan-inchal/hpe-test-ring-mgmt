import pymongo

client = pymongo.MongoClient("mongodb+srv://hpeuser:hpeuserpassword@cluster0.2xwbcdn.mongodb.net/?appName=Cluster0")
db = client.get_default_database()
print("Collections:", db.list_collection_names())

users = list(db.users.find())
print("Total users:", len(users))
for u in users:
    print(f"User: {u.get('username')}, Role: {u.get('role')}, Team: {u.get('team')}, Cluster: {u.get('cluster')}, ManagedTeams: {u.get('managedTeams')}, ManagedClusters: {u.get('managedClusters')}")
