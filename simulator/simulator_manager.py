"""
simulator/simulator_manager.py

Orchestrates the entire simulated SAN:
1. Generates mock device data (via data_generator.py).
2. Instantiates one Terminal per device (Array/Linux/Windows).
3. Registers each terminal on the VirtualNetwork at its simulated IP.
4. Exposes a REST API so the dashboard can query device status.

Run this first before starting the discovery crawler.
"""
import os
import sys
import json
import threading
import logging

from flask import Flask, jsonify
from flask_cors import CORS

# Make simulator modules importable
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from data_generator import generate_and_save, DATA_DIR, META_DIR
from network_sim import virtual_network
from device_terminal import HPEArrayTerminal, LinuxHostTerminal, WindowsHostTerminal, BrocadeSwitchTerminal

logging.basicConfig(level=logging.INFO, format="%(levelname)s [simulator] %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Silence Flask logging
import logging
log_werkzeug = logging.getLogger('werkzeug')
log_werkzeug.setLevel(logging.ERROR)

# ── Boot sequence ──────────────────────────────────────────────────────────────

def boot():
    """Generate data and spin up all virtual terminals."""
    log.info("=" * 60)
    log.info("  HPE SAN Simulator — Boot Sequence")
    log.info("=" * 60)

    # 1. Generate device dump files + network metadata
    topology = generate_and_save()
    log.info(f"  Generated {len(topology['arrays'])} array configurations.")

    meta_path = os.path.join(META_DIR, "network_topology.json")
    with open(meta_path) as f:
        net_meta = json.load(f)

    # 2. Spin up Array terminals
    for arr in topology["arrays"]:
        device_file = os.path.join(DATA_DIR, f"{arr['name'].lower().replace('-','_')}.txt")
        if not os.path.exists(device_file):
            log.warning(f"  Missing device file: {device_file}, skipping.")
            continue

        terminal = HPEArrayTerminal(
            device_id=arr["array_id"],
            ip=arr["ip_address"],
            config=arr,
            device_file=device_file,
        )
        virtual_network.register(arr["ip_address"], terminal, metadata={
            "name": arr["name"],
            "type": "array",
            "model": arr["model"],
            "serial": arr["serial"],
            "connected_to": arr.get("connected_array_ips", []),
            "ssh_key_type": "RSA",             # Arrays: RSA key warning on connect
            "login_user": "root",
            "prompt": "cli% ",
        })
        log.info(f"  [Array] {arr['name']} @ {arr['ip_address']} — ready")

        # 3. Spin up Switch terminals — use BrocadeSwitchTerminal for FC switches
        for sw in arr.get("switches", []):
            sw_config = {
                **sw,
                "wwn": sw.get("wwn", "10:00:aa:bb:cc:dd:ee:01"),
            }
            sw_terminal = BrocadeSwitchTerminal(
                device_id=sw["name"],
                ip=sw["ip_address"],
                config=sw_config,
            )
            virtual_network.register(sw["ip_address"], sw_terminal, metadata={
                "name": sw["name"],
                "type": "switch",
                "model": sw.get("model", "Brocade FC Switch"),
                "parent_array": arr["name"],
                "ssh_key_type": None,          # FC switches: direct password, no key warning
                "login_user": "admin",
                "prompt": f"{sw['name']}:FID100:admin> ",
            })
            log.info(f"  [Switch/Brocade] {sw['name']} @ {sw['ip_address']} — ready")

        # 4. Spin up Host terminals
        for host in arr.get("hosts", []):
            os_type = host.get("os_type", "linux")
            host_cfg = {
                **host,
                "disks": [d for d in arr["drives"][:2]],  # give each host a couple of disks
            }
            if os_type == "windows":
                h_terminal = WindowsHostTerminal(
                    device_id=host["name"],
                    ip=host["ip_address"],
                    config=host_cfg,
                )
                ssh_key_type = None  # Windows hosts: direct password
            else:
                h_terminal = LinuxHostTerminal(
                    device_id=host["name"],
                    ip=host["ip_address"],
                    config=host_cfg,
                )
                ssh_key_type = "ECDSA"  # Linux/VMware hosts: ECDSA key warning
            virtual_network.register(host["ip_address"], h_terminal, metadata={
                "name": host["name"],
                "type": "host",
                "os": host.get("os_name"),
                "os_type": os_type,
                "parent_array": arr["name"],
                "ssh_key_type": ssh_key_type,
                "login_user": "root",
                "prompt": "PS C:\\> " if os_type == "windows" else "$ ",
            })
            log.info(f"  [Host/{os_type.title()}] {host['name']} @ {host['ip_address']} — ready")

    log.info("=" * 60)
    log.info(f"  Total devices online: {len(virtual_network.list_devices())}")
    log.info("  Simulator ready. Crawler may now start discovery.")
    log.info("=" * 60)


# ── REST API ──────────────────────────────────────────────────────────────────

@app.route("/sim/ssh/connect/<path:ip>")
def ssh_connect(ip):
    """Return SSH handshake metadata for a device (key type, login user, prompt)."""
    meta = virtual_network.get_metadata(ip)
    if not meta:
        return jsonify({"error": f"No device at {ip}"}), 404

    name = meta.get("name", ip)
    key_type = meta.get("ssh_key_type")   # "RSA", "ECDSA", or None
    login_user = meta.get("login_user", "root")
    prompt = meta.get("prompt", "$ ")

    # Build the handshake lines exactly as they appear in a real SSH session
    lines = []
    if key_type:
        lines.append(f"Warning: the {key_type} host key for '{name}' differs from "
                     f"the key for the IP address '{ip}'")
        lines.append("Are you sure you want to continue connecting (yes/no)?")
        # user answers yes →
        lines.append("")  # blank after yes
    # Password prompt differs: arrays use bare "Password:", hosts use "user@host's password:"
    if meta.get("type") == "array":
        password_prompt = "Password:"
    else:
        password_prompt = f"{login_user}@{name}'s password:"

    return jsonify({
        "name": name,
        "ip": ip,
        "type": meta.get("type"),
        "key_type": key_type,
        "login_user": login_user,
        "prompt": prompt,
        "handshake_lines": lines,
        "password_prompt": password_prompt,
    })


@app.route("/sim/devices")
def list_sim_devices():
    """List all simulated devices."""
    return jsonify(virtual_network.list_devices())

@app.route("/sim/exec/<path:ip>/<path:command>")
def exec_command(ip, command):
    """Execute a CLI command on a simulated device."""
    output = virtual_network.execute(ip, command)
    return jsonify({"ip": ip, "command": command, "output": output})

@app.route("/sim/topology")
def sim_topology():
    """Return topology as a D3-ready node-link dict."""
    devices = virtual_network.list_devices()
    nodes = [{"id": d["ip"], "label": d.get("name", d["ip"]), "type": d.get("type", "unknown")} for d in devices]
    # Build edges from connected_to metadata
    edges = []
    for d in devices:
        for peer_ip in d.get("connected_to", []):
            edges.append({"source": d["ip"], "target": peer_ip, "type": "REMOTE_COPY"})
    return jsonify({"nodes": nodes, "edges": edges})

@app.route("/sim/status")
def sim_status():
    return jsonify({
        "status": "running",
        "device_count": len(virtual_network.list_devices()),
    })


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    boot()
    log.info("  Starting Simulator API on http://localhost:5001")
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
