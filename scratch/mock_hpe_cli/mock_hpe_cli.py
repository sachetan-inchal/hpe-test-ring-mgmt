import os
import sys

# Paths relative to the monorepo structure
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MONOREPO = os.path.dirname(os.path.dirname(BASE_DIR))
DATA_DIR = os.path.join(MONOREPO, "simulator", "data", "devices")

ACTIVE_DEVICE_FILE = os.path.join(BASE_DIR, "active_device.txt")

# Default device if not selected
DEFAULT_DEVICE = "prod_a.txt"

def get_active_device():
    if os.path.exists(ACTIVE_DEVICE_FILE):
        with open(ACTIVE_DEVICE_FILE, "r") as f:
            device = f.read().strip()
            if not device.endswith(".txt"):
                device += ".txt"
            return device
    return DEFAULT_DEVICE

def set_active_device(device_name):
    if not device_name.endswith(".txt"):
        device_name += ".txt"
    with open(ACTIVE_DEVICE_FILE, "w") as f:
        f.write(device_name)
    print(f"Active device changed to: {device_name}")

# All known HPE array CLI commands
KNOWN_COMMANDS = {
    "showversion -b", "showhost", "showsys", "shownode", "showport",
    "showswitch", "showpd", "showpd -s", "showpd -i",
    "showcage", "showcage -state", "showcage -pci", "showcage -sfp",
    "cli checkhealth", "lscpu", "fabricshow", "switchshow",
    "showportdev ns -nohdtot 0:3:1", "showportdev ns"
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
    with open(filepath, "r", errors="replace") as f:
        lines = [l.rstrip() for l in f]
    has_plus = any(l.startswith("+ ") for l in lines)
    return _parse_plus_format(lines) if has_plus else _parse_plain_format(lines)

def main():
    args = sys.argv[1:]
    if not args:
        print("MOCK HPE Storage CLI Utility")
        print("Usage:")
        print("  python mock_hpe_cli.py set-device [device_name.txt]")
        print("  python mock_hpe_cli.py [hpe_command]")
        sys.exit(0)

    if args[0] == "set-device":
        if len(args) < 2:
            print("Error: Specify a device file (e.g. prod_a.txt, prod_b.txt)")
            sys.exit(1)
        set_active_device(args[1])
        sys.exit(0)

    # Reconstruct command
    command = " ".join(args)
    device = get_active_device()
    filepath = os.path.join(DATA_DIR, device)

    if not os.path.exists(filepath):
        # Check case-insensitive
        found = False
        if os.path.exists(DATA_DIR):
            for f in os.listdir(DATA_DIR):
                if f.lower() == device.lower() or f.lower() == (device.lower() + ".txt"):
                    filepath = os.path.join(DATA_DIR, f)
                    found = True
                    break
        if not found:
            print(f"Error: Simulated configuration file '{device}' not found in {DATA_DIR}")
            sys.exit(1)

    commands = load_device_commands(filepath)
    
    # Try exact match or prefix match
    matched = None
    for cmd in commands:
        if cmd.lower() == command.lower() or command.lower().startswith(cmd.lower()):
            matched = cmd
            break

    if matched and matched in commands:
        print("\n".join(commands[matched]))
    else:
        # Fall back to returning mock execution log format
        print(f"cli% {command}\nCommand execution simulated successfully.")

if __name__ == "__main__":
    main()
