import sqlite3

conn = sqlite3.connect('san_inventory.db')
cursor = conn.cursor()

# Check schema
print("Schema:")
cursor.execute("PRAGMA table_info(target_devices)")
for row in cursor.fetchall():
    print(row)

# Check data
print("\nData:")
cursor.execute("SELECT * FROM target_devices")
for row in cursor.fetchall():
    print(row)

conn.close()
