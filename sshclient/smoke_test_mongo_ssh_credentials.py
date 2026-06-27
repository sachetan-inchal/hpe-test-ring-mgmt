"""Smoke test for Mongo-backed SSH credentials migration.

Usage:
  python sshclient/smoke_test_mongo_ssh_credentials.py

What it checks:
- MongoInventoryManager can upsert/list/delete credentials
- Password encrypt/decrypt roundtrip works

Note:
- Requires MongoDB to be reachable at $MONGO_URI (default localhost:27017)
- Does NOT attempt real SSH connections.
"""

from sshclient.inventory_manager import MongoInventoryManager
import uuid


def main():
    mgr = MongoInventoryManager()
    assert mgr.available, "MongoInventoryManager reports MongoDB unavailable"

    dn = f"smoke-{uuid.uuid4()}"
    ip = "127.0.0.1"

    mgr.upsert_device(
        device_name=dn,
        ip=ip,
        username="root",
        password="P@ssw0rd!",
        port=22,
        dns_name="",
        dns_server="",
        category="Host",
    )

    items = mgr.list_devices_decrypted()
    found = [x for x in items if x.get("device_name") == dn]
    assert found, "Upserted credential not found in list"
    assert found[0]["password"] == "P@ssw0rd!", "Password decrypted value mismatch"

    deleted = mgr.delete_device(device_name=dn)
    assert deleted == 1, f"Expected 1 deletion, got {deleted}"

    print("OK: Mongo SSH credentials smoke test passed")


if __name__ == "__main__":
    main()

