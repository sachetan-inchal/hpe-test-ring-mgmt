"""
simulator/proxy_engine.py

Thin shim that imports the HPE proxy (CLI replay engine) from the
san-emulatoreditor backend, keeping the simulator decoupled.
"""
import os, sys

_EMULATOR_BACKEND = os.path.join(
    os.path.dirname(__file__), "..", "san-emulatoreditor", "backend"
)
if os.path.exists(_EMULATOR_BACKEND):
    sys.path.insert(0, _EMULATOR_BACKEND)
    from proxy import get_command_output, load_device_commands  # noqa: F401
else:
    # Minimal fallback — reads any '+ command' format file
    def get_command_output(device_file: str, command_name: str) -> str:
        if not os.path.exists(device_file):
            return f"Error: {device_file} not found"
        with open(device_file, errors="replace") as f:
            lines = [l.rstrip() for l in f]
        blocks = {}
        cur = None
        for line in lines:
            if line.startswith("+ "):
                cur = line[2:].strip(); blocks[cur] = []
            elif cur:
                blocks[cur].append(line)
        return "\n".join(blocks.get(command_name, [f"Command not found: {command_name}"]))
