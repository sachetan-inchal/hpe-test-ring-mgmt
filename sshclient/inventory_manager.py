import os
import sqlite3
from cryptography.fernet import Fernet

DB_NAME = "san_inventory.db"
KEY_FILE = "secret.key"

def get_or_create_master_key():
    """Generates or loads a local symmetric key for password encryption."""
    if not os.path.exists(KEY_FILE):
        key = Fernet.generate_key()
        with open(KEY_FILE, "wb") as f:
            f.write(key)
        return key
    with open(KEY_FILE, "rb") as f:
        return f.read()

def init_database():
    """Initializes the relational database schema for tracking target hosts."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS target_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_name TEXT UNIQUE NOT NULL,
            ip_address TEXT NOT NULL,
            username TEXT NOT NULL,
            encrypted_password TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

def add_device(name, ip, username, password):
    """Encrypts credentials and registers a device into the asset index."""
    key = get_or_create_master_key()
    fernet = Fernet(key)
    encrypted_pw = fernet.encrypt(password.encode()).decode()

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO target_devices (device_name, ip_address, username, encrypted_password)
            VALUES (?, ?, ?, ?)
        """, (name, ip, username, encrypted_pw))
        conn.commit()
        print(f"Successfully registered device profile: '{name}' ({ip}).")
    except sqlite3.IntegrityError:
        print(f"Error: A device with the name '{name}' already exists in the inventory.")
    finally:
        conn.close()

def list_devices():
    """Retrieves all devices and safely decrypts passwords for script usage."""
    key = get_or_create_master_key()
    fernet = Fernet(key)
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT device_name, ip_address, username, encrypted_password FROM target_devices")
    rows = cursor.fetchall()
    conn.close()

    decrypted_inventory = []
    for row in rows:
        name, ip, user, enc_pw = row
        decrypted_pw = fernet.decrypt(enc_pw.encode()).decode()
        decrypted_inventory.append({
            "device_name": name,
            "ip_address": ip,
            "username": user,
            "password": decrypted_pw
        })
    return decrypted_inventory

# --- Quick Interface Usage Demo ---
if __name__ == "__main__":
    init_database()
    
    print("--- Registering target lab devices ---")
    # Populate your 4 devices into the secure inventory app
    add_device("node-alpha", "192.168.1.101", "root", "AlphaPassword99!")
    add_device("node-beta",  "192.168.1.102", "admin", "BetaSecure2026$")
    add_device("node-gamma", "192.168.1.103", "root", "GammaPass77*")
    add_device("node-delta", "192.168.1.104", "root", "DeltaShield04#")
    
    print("\n--- Listing Active Decrypted Inventory ---")
    all_hosts = list_devices()
    for host in all_hosts:
        print(f"Host: {host['device_name']} | Endpoint: {host['username']}@{host['ip_address']} | Safe-Pass: {host['password']}")