"""sshclient.temp_inventory_server

Mongo-only temporary HTTP server for SSH credentials + command execution.

This file used to be a sqlite-backed inventory service. It has been migrated
so the entire SSH credential workflow works without sqlite.

Endpoints:
- GET  /api/devices
  -> returns { devices: [...] }
- POST /api/credentials/save
  -> { device_name, ip, username, password, port?, dns_name?, dns_server?, category? }
- POST /api/credentials/delete
  -> { device_name?, ip? }
- POST /api/ssh/exec
  -> { ip, username?, password?, port?, commands[] | command?, ... }
     - If password is omitted, it will attempt to load stored password from Mongo.

Note: This server is kept to support any existing UI wiring. The main monorepo
Flask API (`api/app.py`) already includes the same Mongo endpoints.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional

try:
    from pymongo import MongoClient
except ImportError:  # pragma: no cover
    MongoClient = None

from .inventory_manager import MongoInventoryManager, _decrypt_password


class _AppInventory:
    def __init__(self):
        self.mgr = MongoInventoryManager()

    @property
    def available(self) -> bool:
        return self.mgr.available

    def list_devices(self) -> List[Dict[str, Any]]:
        return self.mgr.list_devices_decrypted()

    def save(self, body: Dict[str, Any]):
        name = (body.get("device_name") or body.get("name") or "").strip()
        ip = (body.get("ip") or body.get("ip_address") or "").strip() or None
        dns_name = (body.get("dns_name") or "").strip()
        dns_server = (body.get("dns_server") or "").strip()
        username = (body.get("username") or "").strip()
        password = body.get("password")
        port = body.get("port", 22)
        category = (body.get("category") or "Host").strip() or "Host"

        if not name or not username or not password or not ip and not dns_name:
            raise ValueError("device_name, ip or dns_name, username, and password are required")

        return self.mgr.upsert_device(
            device_name=name,
            ip=ip,
            dns_name=dns_name,
            dns_server=dns_server,
            username=username,
            password=password,
            port=int(port),
            category=category,
        )

    def delete(self, body: Dict[str, Any]):
        device_name = (body.get("device_name") or "").strip() or None
        ip = (body.get("ip") or body.get("ip_address") or "").strip() or None
        if not device_name and not ip:
            raise ValueError("device_name or ip is required")
        return self.mgr.delete_device(device_name=device_name, ip=ip)

    def get_password_for_ip(self, ip: str) -> Optional[str]:
        # MongoInventoryManager doesn't expose direct lookups; perform direct query here.
        if not self.mgr.available:
            return None
        try:
            col = self.mgr.db.ssh_credentials
            doc = col.find_one({"ip": ip})
            if not doc:
                return None
            return _decrypt_password(doc.get("password", ""))
        except Exception:
            return None


INV = _AppInventory()


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _send(self, status: int, obj: Dict[str, Any]):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def log_message(self, format, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/devices":
            if not INV.available:
                return self._send(503, {"error": "MongoDB unavailable"})
            try:
                devices = INV.list_devices()
                return self._send(200, {"devices": devices})
            except Exception as e:
                return self._send(500, {"error": str(e)})

        self._send(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/credentials/save":
            try:
                body = self._read_json()
                if not INV.available:
                    return self._send(503, {"error": "MongoDB unavailable"})
                res = INV.save(body)
                return self._send(200, res | {"status": "saved"})
            except Exception as e:
                return self._send(400, {"error": str(e)})

        if parsed.path == "/api/credentials/delete":
            try:
                body = self._read_json()
                if not INV.available:
                    return self._send(503, {"error": "MongoDB unavailable"})
                deleted = INV.delete(body)
                if deleted > 0:
                    return self._send(200, {"status": "deleted", "deleted": deleted})
                return self._send(404, {"error": "Credentials not found"})
            except Exception as e:
                return self._send(400, {"error": str(e)})

        if parsed.path == "/api/ssh/exec":
            try:
                body = self._read_json()
                ip = (body.get("ip") or body.get("ip_address") or "").strip()
                username = (body.get("username") or "").strip()
                password = body.get("password")
                port = body.get("port", 22)

                commands = body.get("commands")
                if not isinstance(commands, list):
                    c = body.get("command")
                    commands = [c] if c else []

                if not ip or not username or not commands:
                    return self._send(400, {"error": "ip, username, and commands[] (or command) are required"})

                # Load password from Mongo when not provided
                if (password is None or password == "") and INV.available:
                    pw = INV.get_password_for_ip(ip)
                    if pw:
                        password = pw

                if password is None or password == "":
                    return self._send(400, {"error": "password required (either provide it or ensure credentials exist in Mongo)"})

                from api.integrations.device_connector import SSHConnector

                connector = SSHConnector(host=ip, username=username, password=password, port=int(port))
                if connector.connect():
                    results: Dict[str, Any] = {}
                    for cmd in commands:
                        r = connector.execute(cmd)
                        results[cmd] = {"stdout": r.get("stdout", ""), "stderr": r.get("stderr", "")}
                    connector.disconnect()
                    return self._send(200, {"ip": ip, "port": int(port), "results": results})
                return self._send(401, {"ip": ip, "error": f"SSH authentication failure to {ip}"})

            except Exception as e:
                return self._send(500, {"error": str(e)})

        self._send(404, {"error": "Not found"})


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5055)
    args = parser.parse_args()

    if not INV.available:
        print("WARNING: MongoDB unavailable; server will still start but requests will fail.")

    server = HTTPServer((args.host, args.port), Handler)
    print(f"Temp SSH inventory server (Mongo-backed) listening on http://{args.host}:{args.port}")
    print("Endpoints:")
    print("  GET  /api/devices")
    print("  POST /api/credentials/save")
    print("  POST /api/credentials/delete")
    print("  POST /api/ssh/exec")
    server.serve_forever()


if __name__ == "__main__":
    main()

