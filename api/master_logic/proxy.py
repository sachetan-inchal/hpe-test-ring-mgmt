"""
proxy.py – CLI replay engine.
"""
import os

# Root of monorepo
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "simulator", "data", "devices")

KNOWN_COMMANDS = {
    "showversion -b", "showhost", "showsys", "shownode", "showport",
    "showswitch", "showpd", "showpd -s", "showpd -i",
    "showcage", "showcage -state", "showcage -pci", "showcage -sfp",
    "cli checkhealth", "UPGRADE", "lscpu",
}

def _parse_plus_format(lines):
    blocks = {}
    cur = None
    for line in lines:
        if line.startswith("+ "):
            cur = line[2:].strip()
            blocks[cur] = []
        elif cur is not None:
            blocks[cur].append(line)
    return blocks

def _parse_plain_format(lines):
    blocks = {}
    cur = None
    for line in lines:
        stripped = line.strip()
        matched_cmd = None
        for cmd in sorted(KNOWN_COMMANDS, key=len, reverse=True):
            if stripped == cmd or stripped.startswith(cmd + " "):
                matched_cmd = stripped
                break
        if matched_cmd:
            cur = matched_cmd
            blocks[cur] = []
        elif cur is not None:
            blocks[cur].append(line)
    return blocks

def load_device_commands(filepath):
    if not os.path.exists(filepath): return {}
    with open(filepath, "r", errors="replace") as f:
        lines = [l.rstrip() for l in f]
    has_plus = any(l.startswith("+ ") for l in lines)
    if has_plus: return _parse_plus_format(lines)
    else: return _parse_plain_format(lines)

def get_command_output(device_file, command_name):
    if not os.path.isabs(device_file):
        filepath = os.path.join(DATA_DIR, device_file)
    else:
        filepath = device_file
    if not os.path.exists(filepath):
        return f"Error: Device file '{device_file}' not found"
    commands = load_device_commands(filepath)
    if command_name in commands:
        return "\n".join(commands[command_name])
    else:
        return f"Command not found: {command_name}"

def list_device_commands(device_file):
    if not os.path.isabs(device_file):
        filepath = os.path.join(DATA_DIR, device_file)
    else:
        filepath = device_file
    if not os.path.exists(filepath): return []
    return list(load_device_commands(filepath).keys())

def list_devices():
    if not os.path.exists(DATA_DIR): return []
    return [f for f in os.listdir(DATA_DIR) if f.endswith(".txt")]

DEVICE_REGISTRY = {
    "10.20.10.5":  "prod_a.txt",
    "10.20.20.5":  "prod_b.txt",
    "10.20.30.5":  "dr_c.txt",
    "10.20.40.5":  "edge_d.txt",
    "10.20.10.10": "s4634.txt",
}

def resolve_ip(ip_address):
    return DEVICE_REGISTRY.get(ip_address)
