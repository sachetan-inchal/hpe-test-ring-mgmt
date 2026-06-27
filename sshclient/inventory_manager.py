"""sshclient.inventory_manager

Mongo-only SSH credentials inventory.

This file previously used sqlite3 + a local `san_inventory.db` / `secret.key`.
It has been migrated to use the monorepo's Mongo container.

Responsibilities:
- Upsert SSH credentials into `db.ssh_credentials`
- List credentials (decrypting passwords for client consumption)
- Delete credentials by device_name or IP

Password encryption matches `api/app.py`:
- `_encrypt_password` / `_decrypt_password`
- uses `SECRET_ENCRYPTION_KEY` env var
"""

from __future__ import annotations

import os
import base64
import logging
from typing import Any, Dict, List, Optional

try:
    from pymongo import MongoClient
except ImportError:  # pragma: no cover
    MongoClient = None

log = logging.getLogger(__name__)

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/hpe_san")


def _encrypt_password(password: str) -> str:
    key = os.environ.get("SECRET_ENCRYPTION_KEY", "HPE_SECRET_KEY_2026")
    xored = "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(password or ""))
    return base64.b64encode(xored.encode("utf-8", errors="ignore")).decode("utf-8")


def _decrypt_password(enc_password: str) -> str:
    try:
        key = os.environ.get("SECRET_ENCRYPTION_KEY", "HPE_SECRET_KEY_2026")
        decoded = base64.b64decode(enc_password.encode("utf-8")).decode("utf-8", errors="ignore")
        return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(decoded))
    except Exception:
        # If it's already plaintext or invalid, best effort return input.
        return enc_password


class MongoInventoryManager:
    def __init__(self, uri: str = MONGO_URI, db_name: Optional[str] = None):
        self.uri = uri
        self.db_name = db_name
        self.client = None
        self.db = None
        self._available = False
        self._init_client()

    def _init_client(self):
        if MongoClient is None:
            log.warning("pymongo not installed; MongoInventoryManager unavailable")
            return
        try:
            self.client = MongoClient(self.uri, serverSelectionTimeoutMS=2000)
            self.client.admin.command("ping")
            # If uri contains db name, get_database() picks it; otherwise fallback.
            if self.db_name:
                self.db = self.client.get_database(self.db_name)
            else:
                self.db = self.client.get_database()
            self._available = True
            log.info("[mongo][inventory] Connected")
        except Exception as e:
            self._available = False
            log.warning("[mongo][inventory] Connection failed: %s", e)

    @property
    def available(self) -> bool:
        return self._available

    def _coll(self):
        if not self._available:
            raise RuntimeError("MongoDB unavailable")
        return self.db.ssh_credentials

    def upsert_device(self, *,
                       device_name: str,
                       ip: Optional[str],
                       username: str,
                       password: str,
                       port: int = 22,
                       dns_name: str = "",
                       dns_server: str = "",
                       category: str = "Host") -> Dict[str, Any]:
        if not self._available:
            raise RuntimeError("MongoDB unavailable")
        if not ip and not dns_name:
            raise ValueError("Either ip or dns_name is required")
        key = ip or dns_name

        doc = {
            "username": username,
            "password": _encrypt_password(password),
            "port": int(port),
            "device_name": device_name or key,
            "dns_name": dns_name or "",
            "dns_server": dns_server or "",
            "category": category or "Host",
        }

        update = {
            "$set": {
                **doc,
                "ip": ip,
            }
        }
        # query by ip if present; otherwise by dns_name
        query = {"ip": ip} if ip else {"dns_name": dns_name}

        res = self._coll().update_one(query, update, upsert=True)
        return {"status": "saved", "matched": res.matched_count, "upserted": bool(res.upserted_id)}

    def list_devices_decrypted(self) -> List[Dict[str, Any]]:
        if not self._available:
            raise RuntimeError("MongoDB unavailable")
        out: List[Dict[str, Any]] = []
        for c in self._coll().find({}):
            out.append({
                "device_name": c.get("device_name") or c.get("ip"),
                "ip_address": c.get("ip"),
                "ip": c.get("ip"),
                "username": c.get("username"),
                "password": _decrypt_password(c.get("password", "")),
                "port": c.get("port", 22),
                "dns_name": c.get("dns_name", ""),
                "dns_server": c.get("dns_server", ""),
                "category": c.get("category", "Host"),
            })
        return out

    def delete_device(self, *, device_name: Optional[str] = None, ip: Optional[str] = None) -> int:
        if not self._available:
            raise RuntimeError("MongoDB unavailable")
        if not device_name and not ip:
            raise ValueError("device_name or ip is required")

        if ip:
            res = self._coll().delete_one({"ip": ip})
            return int(res.deleted_count)
        # delete by device_name (legacy UI behavior)
        res = self._coll().delete_one({"device_name": device_name})
        return int(res.deleted_count)


# Backwards-compatible module-level helpers (used by older scripts)
_default_mgr = MongoInventoryManager()


def init_database() -> None:
    # Mongo has no schema init needed.
    return


def add_device(name: str, ip: str, username: str, password: str, port: int = 22,
               dns_name: str = "", dns_server: str = "", category: str = "Host") -> None:
    _default_mgr.upsert_device(
        device_name=name,
        ip=ip,
        username=username,
        password=password,
        port=port,
        dns_name=dns_name,
        dns_server=dns_server,
        category=category,
    )


def list_devices() -> List[Dict[str, Any]]:
    return _default_mgr.list_devices_decrypted()


def delete_device(device_name: str) -> None:
    cnt = _default_mgr.delete_device(device_name=device_name)
    if cnt == 0:
        raise KeyError(f"device_name '{device_name}' not found")


if __name__ == "__main__":  # pragma: no cover
    print("MongoInventoryManager demo")
    if not _default_mgr.available:
        raise SystemExit("Mongo unavailable")

    # Example usage
    add_device("node-alpha", "192.168.1.101", "root", "ExamplePassword123!", port=22)
    print(list_devices())

