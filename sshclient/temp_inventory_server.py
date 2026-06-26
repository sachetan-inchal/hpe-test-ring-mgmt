import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

from cryptography.fernet import Fernet

DB_NAME = os.path.join(os.path.dirname(__file__), "san_inventory.db")
KEY_FILE = os.path.join(os.path.dirname(__file__), "secret.key")

# Default devices to pre-populate
DEFAULT_DEVICES = [
    {
        "device_name": "Device 1 (172.23.109.228)",
        "ip": "172.23.109.228",
        "username": "sachetan",
        "password": "sachetan",
        "port": 22,
    },
    {
        "device_name": "Device 2 (172.17.7.224)",
        "ip": "172.17.7.224",
        "username": "sachetan",
        "password": "sachetan123",
        "port": 22,
    },
    {
        "device_name": "Device 3 (172.17.3.208:8022)",
        "ip": "172.17.3.208",
        "username": "u0_a282",
        "password": "sachetan",
        "port": 8022,
    },
    {
        "device_name": "Device 4 (172.17.9.127:8022)",
        "ip": "172.17.9.127",
        "username": "u0_a361",
        "password": "sachetan123",
        "port": 8022,
    },
]


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
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS target_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_name TEXT UNIQUE NOT NULL,
            ip_address TEXT NOT NULL,
            username TEXT NOT NULL,
            encrypted_password TEXT NOT NULL,
            port INTEGER DEFAULT 22
        )
        """
    )
    conn.commit()

    # Pre-populate with default devices if table is empty
    cursor.execute("SELECT COUNT(*) FROM target_devices")
    count = cursor.fetchone()[0]
    if count == 0:
        for device in DEFAULT_DEVICES:
            add_device(
                name=device["device_name"],
                ip=device["ip"],
                username=device["username"],
                password=device["password"],
                port=device["port"],
            )

    conn.close()


def add_device(name, ip, username, password, port=22):
    key = get_or_create_master_key()
    fernet = Fernet(key)
    encrypted_pw = fernet.encrypt(password.encode()).decode()

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    try:
        # Upsert by device_name
        cursor.execute(
            """
            INSERT INTO target_devices (device_name, ip_address, username, encrypted_password, port)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(device_name) DO UPDATE SET
                ip_address=excluded.ip_address,
                username=excluded.username,
                encrypted_password=excluded.encrypted_password,
                port=excluded.port
            """,
            (name, ip, username, encrypted_pw, int(port)),
        )
        conn.commit()
    finally:
        conn.close()


def list_devices_decrypted():
    key = get_or_create_master_key()
    fernet = Fernet(key)

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, device_name, ip_address, username, encrypted_password, port FROM target_devices"
    )
    rows = cursor.fetchall()
    conn.close()

    out = []
    for id_, name, ip, username, enc_pw, port in rows:
        pw = fernet.decrypt(enc_pw.encode()).decode()
        out.append(
            {
                "id": id_,
                "device_name": name,
                "ip_address": ip,
                "username": username,
                "password": pw,
                "port": int(port) if port is not None else 22,
            }
        )
    return out


def delete_device(device_name):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM target_devices WHERE device_name = ?", (device_name,))
    conn.commit()
    conn.close()


def run_ssh_commands(ip, username, password, port, commands):
    """Runs commands via paramiko and returns {<cmd>: {stdout, stderr}}."""
    import paramiko

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    ssh.connect(
        hostname=ip,
        port=int(port),
        username=username,
        password=password,
        timeout=10,
    )

    results = {}
    try:
        for cmd in commands:
            stdin, stdout, stderr = ssh.exec_command(cmd)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            results[cmd] = {"stdout": out, "stderr": err}
    finally:
        ssh.close()
    return results


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        # Allow browser-based static frontend (especially when opened via file://)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # ensure caches don't block CORS preflight responses
        self.send_header('Access-Control-Max-Age', '86400')


    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _send(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/devices":
            try:
                body = json.dumps({"devices": list_devices_decrypted()}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self._cors()
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._send(500, {"error": str(e)})
            return

        self._send(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/credentials/save":
            try:
                body = self._read_json()
                name = (body.get("device_name") or body.get("name") or "").strip()
                ip = (body.get("ip") or body.get("ip_address") or "").strip()
                username = (body.get("username") or "").strip()
                password = body.get("password")
                port = body.get("port", 22)

                if not name or not ip or not username or not password:
                    return self._send(400, {"error": "device_name, ip, username, password required"})

                add_device(name=name, ip=ip, username=username, password=password, port=port)
                self._send(200, {"status": "saved", "device_name": name, "ip": ip, "port": int(port)})
            except Exception as e:
                self._send(500, {"error": str(e)})
            return

        if parsed.path == "/api/credentials/delete":
            try:
                body = self._read_json()
                device_name = (body.get("device_name") or "").strip()
                if not device_name:
                    return self._send(400, {"error": "device_name required"})
                delete_device(device_name)
                self._send(200, {"status": "deleted", "device_name": device_name})
            except Exception as e:
                self._send(500, {"error": str(e)})
            return

        if parsed.path == "/api/ssh/exec":
            try:
                body = self._read_json()
                ip = (body.get("ip") or body.get("ip_address") or "").strip()
                username = (body.get("username") or "").strip()
                password = body.get("password")
                port = body.get("port", 22)
                commands = body.get("commands")
                if not isinstance(commands, list):
                    # allow single command
                    c = body.get("command")
                    commands = [c] if c else []

                if not ip or not username or not password or not commands:
                    return self._send(400, {"error": "ip, username, password, commands[] required"})

                results = run_ssh_commands(ip, username, password, port, commands)
                self._send(200, {"ip": ip, "port": int(port), "results": results})
            except Exception as e:
                self._send(500, {"error": str(e)})
            return

        self._send(404, {"error": "Not found"})

    def log_message(self, format, *args):
        # Reduce default logging noise
        return


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5055)
    args = parser.parse_args()

    init_database()

    server = HTTPServer((args.host, args.port), Handler)
    print(f"Temp SSH inventory server listening on http://{args.host}:{args.port}")
    print("Endpoints:")
    print("  GET  /api/devices")
    print("  POST /api/credentials/save  {device_name, ip, username, password, port}")
    print("  POST /api/ssh/exec          {ip, username, password, port, commands:[]}")
    server.serve_forever()


if __name__ == "__main__":
    main()

