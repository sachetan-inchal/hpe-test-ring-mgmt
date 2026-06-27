import os
import threading
from datetime import datetime

from flask import Flask, jsonify, request
from flask_cors import CORS

# Log full server-side tracebacks for easier debugging of 500 errors.
import traceback


# Pure Python local persistence for credentials using JSON
import json

DATA_FILE = os.path.join(os.path.dirname(__file__), "ssh_credentials.json")

def _load_raw_credentials() -> list:
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return []
    except Exception:
        return []

def _save_raw_credentials(creds_list: list):
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(creds_list, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving credentials: {e}")

import base64

# Simple XOR-encryption to avoid storing plaintext. Compatible with api/app.py logic.
SECRET_ENCRYPTION_KEY = os.environ.get("SECRET_ENCRYPTION_KEY", "HPE_SECRET_KEY_2026")

def _encrypt_password(password: str) -> str:
    key = SECRET_ENCRYPTION_KEY
    xored = "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(password or ""))
    return base64.b64encode(xored.encode("utf-8", errors="ignore")).decode("utf-8")

def _decrypt_password(enc_password: str) -> str:
    try:
        key = SECRET_ENCRYPTION_KEY
        decoded = base64.b64decode((enc_password or "").encode("utf-8")).decode("utf-8", errors="ignore")
        return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(decoded))
    except Exception:
        return enc_password


# ---- SSH connector (paramiko) ----

def exec_ssh_commands(host: str, username: str, password: str, port: int, commands: list[str]):
    try:
        import paramiko
    except Exception:
        raise RuntimeError("paramiko is not installed. Install dependencies for mini-ssh-ring.")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=username, password=password, port=port, timeout=10)

    try:
        results = {}
        for cmd in commands:
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            try:
                exit_code = stdout.channel.recv_exit_status()
            except Exception:
                exit_code = 0
            results[cmd] = {"stdout": out, "stderr": err, "exit_code": exit_code}
        return results
    finally:
        try:
            client.close()
        except Exception:
            pass


PRESET_COMMANDS = {
    "Array": [
        "showversion -b",
        "showsys",
        "shownode",
        "showport",
        "showhost",
        "showcage -pci",
        "showcage -sfp",
        "showcage -state",
        "showpd",
        "showpd -s",
        "showpd -i",
        "showportdev",
        "showportdev ns -nohdtot 0:3:1",
        "showportdev ns -nohdtot 1:3:1",
    ],
    "Host": [
        "lscpu",
        "systool -c fc_host -v",
        "lspci -nnk",
    ],
    "Switch": [
        "fabricshow",
        "switchshow",
    ],
}

# ---- Flask app ----

app = Flask(__name__, static_folder=".")
CORS(app)

_data_lock = threading.Lock()

# Credentials storage is now fully JSON-file-based and persistent.

@app.get("/")
def index():
    # Serve pure HTML (no templating)
    from flask import send_from_directory
    return send_from_directory(os.path.dirname(__file__), "index.html")


@app.get("/api/credentials/list")
def list_credentials():
    try:
        creds = []
        with _data_lock:
            raw_list = _load_raw_credentials()
            for c in raw_list:
                decrypted = _decrypt_password(c.get("password", ""))
                creds.append({
                    "device_name": c.get("device_name") or c.get("ip") or c.get("ip_address"),
                    "ip_address": c.get("ip"),
                    "ip": c.get("ip"),
                    "username": c.get("username"),
                    "password": decrypted,
                    "port": c.get("port", 22),
                    "dns_name": c.get("dns_name", ""),
                    "dns_server": c.get("dns_server", ""),
                    "category": c.get("category", "Host"),
                    "selected_commands": c.get("selected_commands") or [],
                    "custom_commands": c.get("custom_commands") or [],
                })
        return jsonify({"devices": creds})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/credentials/save")
def save_credentials():
    data = request.json or {}
    ip = data.get("ip") or data.get("ip_address")
    dns_name = (data.get("dns_name") or "").strip()
    username = data.get("username")
    password = data.get("password")
    port = int(data.get("port", 22))
    device_name = data.get("device_name") or data.get("name") or (ip or dns_name)
    dns_server = (data.get("dns_server") or "").strip()
    category = data.get("category") or "Host"

    if not ip and not dns_name:
        return jsonify({"error": "ip or dns_name is required"}), 400
    if not username or password is None:
        return jsonify({"error": "username and password are required"}), 400

    key = ip or dns_name
    doc = {
        "ip": ip or None,
        "dns_name": dns_name,
        "dns_server": dns_server,
        "device_name": device_name,
        "username": username,
        "password": _encrypt_password(password),
        "port": port,
        "category": category,
        "selected_commands": data.get("selected_commands") or [],
        "custom_commands": data.get("custom_commands") or [],
    }

    try:
        with _data_lock:
            creds_list = _load_raw_credentials()
            match_ip = ip or dns_name
            found_idx = -1
            for idx, c in enumerate(creds_list):
                if c.get("ip") == match_ip:
                    found_idx = idx
                    break
            if found_idx >= 0:
                creds_list[found_idx] = doc
            else:
                creds_list.append(doc)
            _save_raw_credentials(creds_list)
        return jsonify({"status": "saved", "message": f"Saved credentials for {key}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/credentials/delete")
def delete_credentials():
    data = request.json or {}
    device_name = data.get("device_name")
    ip = data.get("ip") or data.get("ip_address")

    try:
        with _data_lock:
            creds_list = _load_raw_credentials()
            initial_len = len(creds_list)
            
            if ip:
                creds_list = [c for c in creds_list if c.get("ip") != ip]
            elif device_name:
                creds_list = [c for c in creds_list if c.get("device_name") != device_name]
            else:
                return jsonify({"error": "ip or device_name required"}), 400
                
            if len(creds_list) == initial_len:
                return jsonify({"error": "Credentials not found"}), 404
                
            _save_raw_credentials(creds_list)
        return jsonify({"status": "deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/ssh/exec")
def ssh_exec():
    data = request.json or {}
    ip = data.get("ip") or data.get("ip_address")
    dns_name = (data.get("dns_name") or "").strip()
    dns_server = (data.get("dns_server") or "").strip()

    username = data.get("username")
    password = data.get("password")
    port = int(data.get("port", 22))

    command = data.get("command")
    commands = data.get("commands")

    if dns_name:
        # minimal resolution: let OS resolve it (barebones demo)
        import socket
        ip = socket.gethostbyname(dns_name)

    if not ip or not username or password is None:
        return jsonify({"error": "ip/dns_name, username, and password are required"}), 400

    if command and commands:
        cmds = [command]
    elif commands and isinstance(commands, list):
        cmds = commands
    elif command:
        cmds = [command]
    else:
        return jsonify({"error": "command or commands are required"}), 400

    try:
        results = exec_ssh_commands(ip, username, password, port, cmds)
        first = cmds[0] if cmds else ""
        return jsonify({"ip": ip, "command": first, "results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/discover")
def discover_all():
    """Discover all registered credentials by running preset command sets per category."""
    data = request.json or {}
    # Priority order for commands per device:
    # 1) `commands` (global override list) — runs same commands for every device
    # 2) `commands_by_device` (dict keyed by IP) — per-device from UI checkbox state
    # 3) device's saved `selected_commands` in JSON store
    # 4) category defaults (PRESET_COMMANDS)
    commands_override   = data.get("commands")
    commands_by_device  = data.get("commands_by_device") or {}
    commands_by_category = data.get("commands_by_category") or {}

    # Load credentials
    creds = list_credentials().get_json().get("devices", [])
    if not creds:
        return jsonify({"error": "No credentials registered"}), 400

    all_results = []

    # Sequential to keep output readable
    for d in creds:
        device_name = d.get("device_name") or d.get("ip_address") or "unknown"
        ip = d.get("ip_address") or d.get("ip") or d.get("dns_name")
        category = d.get("category") or "Host"
        username = d.get("username")
        password = d.get("password")
        port = int(d.get("port", 22))

        presets = None
        if isinstance(commands_override, list):
            presets = commands_override
        elif commands_by_device:
            # Look up by IP first, then by dns_name fallback
            presets = commands_by_device.get(ip) or commands_by_device.get(d.get("dns_name") or "")
        if not presets:
            presets = d.get("selected_commands")
        if not presets:
            if commands_by_category and isinstance(commands_by_category, dict):
                presets = commands_by_category.get(category)
        if not presets:
            presets = PRESET_COMMANDS.get(category) or []


        device_result = {
            "device_name": device_name,
            "ip": ip,
            "category": category,
            "status": "pending",
            "commands": {},
            "error": None,
        }

        try:
            device_result["status"] = "running"
            if not presets:
                device_result["status"] = "warning"
                all_results.append(device_result)
                continue
            results = exec_ssh_commands(ip, username, password, port, presets)

            # mark warning if any stderr
            status = "success"
            for cmd, r in results.items():
                if (r.get("stderr") or "").strip():
                    status = "warning"
                    break

            device_result["commands"] = results
            device_result["status"] = status
        except Exception as e:
            device_result["status"] = "error"
            device_result["error"] = str(e)

        all_results.append(device_result)

    return jsonify({"status": "complete", "results": all_results, "discovered_at": datetime.utcnow().isoformat() + "Z"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5055))
    app.run(host="0.0.0.0", port=port, debug=True)

