"""
simulator/proxy_engine.py

Self-contained CLI replay engine for the HPE SAN simulator.
Reads '+ command' format device dump files and returns command output.

This is intentionally a standalone copy so the monorepo works after a
fresh `git clone` without requiring the external san-emulatoreditor project.

Supports:
  1. Bash -x trace format: lines starting with '+ command'
  2. Plain header format: known command name on its own line
"""
import os

# Data directory is always relative to THIS file, inside the monorepo
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "devices")

# All known HPE array CLI commands (used for plain-header format detection)
KNOWN_COMMANDS = {
    "showversion -b", "showhost", "showsys", "shownode", "showport",
    "showswitch", "showpd", "showpd -s", "showpd -i",
    "showcage", "showcage -state", "showcage -pci", "showcage -sfp",
    "cli checkhealth", "lscpu", "fabricshow", "switchshow",
    "showportdev ns -nohdtot 0:3:1",
}


def _parse_plus_format(lines):
    """Parse '+ command' (bash -x) format from real captured sessions."""
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
    """Parse plain-header format where command name appears alone on a line."""
    blocks = {}
    cur = None
    for line in lines:
        stripped = line.strip()
        matched_cmd = None
        # Match longest command first to avoid partial matches (e.g. showpd vs showpd -s)
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
    """Load and parse all command blocks from a device dump file."""
    with open(filepath, "r", errors="replace") as f:
        lines = [l.rstrip() for l in f]

    # Auto-detect format: if any line starts with '+ ', it's bash-trace format
    has_plus = any(l.startswith("+ ") for l in lines)
    return _parse_plus_format(lines) if has_plus else _parse_plain_format(lines)


def get_command_output(device_file: str, command_name: str) -> str:
    """
    Get CLI output for a specific command from a device dump file.

    Args:
        device_file: filename (e.g. 'prod_a.txt') or absolute path
        command_name: CLI command string (e.g. 'showsys', 'showpd -s')
    Returns:
        String of CLI output lines, or an error message if not found.
    """
    # Resolve to absolute path if given a bare filename
    if not os.path.isabs(device_file):
        filepath = os.path.join(DATA_DIR, device_file)
    else:
        filepath = device_file

    if not os.path.exists(filepath):
        return f"Error: Device file '{filepath}' not found"

    commands = load_device_commands(filepath)

    if command_name in commands:
        return "\n".join(commands[command_name])
    else:
        return f"Command not found: {command_name}"


def list_device_commands(device_file: str) -> list:
    """List all available commands in a device dump file."""
    if not os.path.isabs(device_file):
        filepath = os.path.join(DATA_DIR, device_file)
    else:
        filepath = device_file

    if not os.path.exists(filepath):
        return []
    return list(load_device_commands(filepath).keys())


def list_devices() -> list:
    """List all available device dump files in the data directory."""
    if not os.path.exists(DATA_DIR):
        return []
    return [f for f in os.listdir(DATA_DIR) if f.endswith(".txt")]
