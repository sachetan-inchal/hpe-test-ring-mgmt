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
from device_terminal import HPEArrayTerminal, LinuxHostTerminal, WindowsHostTerminal

logging.basicConfig(level=logging.INFO, format="%(levelname)s [simulator] %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

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
        })
        log.info(f"  [Array] {arr['name']} @ {arr['ip_address']} — ready")

        # 3. Spin up Switch terminals (simple HPE-like CLI)
        for sw in arr.get("switches", []):
            sw_terminal = HPEArrayTerminal(
                device_id=sw["name"],
                ip=sw["ip_address"],
                config=sw,
                device_file=device_file,  # switches replay from array dump for now
            )
            virtual_network.register(sw["ip_address"], sw_terminal, metadata={
                "name": sw["name"],
                "type": "switch",
                "model": sw.get("model", "FC Switch"),
                "parent_array": arr["name"],
            })
            log.info(f"  [Switch] {sw['name']} @ {sw['ip_address']} — ready")

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
            else:
                h_terminal = LinuxHostTerminal(
                    device_id=host["name"],
                    ip=host["ip_address"],
                    config=host_cfg,
                )
            virtual_network.register(host["ip_address"], h_terminal, metadata={
                "name": host["name"],
                "type": "host",
                "os": host.get("os_name"),
                "os_type": os_type,
                "parent_array": arr["name"],
            })
            log.info(f"  [Host/{os_type.title()}] {host['name']} @ {host['ip_address']} — ready")

    log.info("=" * 60)
    log.info(f"  Total devices online: {len(virtual_network.list_devices())}")
    log.info("  Simulator ready. Crawler may now start discovery.")
    log.info("=" * 60)


# ── REST API ──────────────────────────────────────────────────────────────────

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
