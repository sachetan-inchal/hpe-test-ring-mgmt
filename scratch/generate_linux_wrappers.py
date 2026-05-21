import os
import stat

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MOCK_CLI_DIR = os.path.join(os.path.dirname(BASE_DIR), 'scratch', 'mock_hpe_cli')

commands = [
    "cli", "fabricshow", "lscpu", "showcage", "showhost", "shownode",
    "showpd", "showport", "showportdev", "showswitch", "showsys",
    "showversion", "switchshow"
]

print("Generating Linux/macOS bash wrappers...")
for cmd in commands:
    filepath = os.path.join(MOCK_CLI_DIR, cmd)
    content = f"""#!/bin/bash
DIR="$( cd "$( dirname "${{BASH_SOURCE[0]}}" )" && pwd )"

# Dynamically run with available python interpreter
if command -v py &> /dev/null; then
    py "$DIR/mock_hpe_cli.py" {cmd} "$@"
elif command -v python3 &> /dev/null; then
    python3 "$DIR/mock_hpe_cli.py" {cmd} "$@"
else
    python "$DIR/mock_hpe_cli.py" {cmd} "$@"
fi
"""
    with open(filepath, 'w', newline='\n') as f:
        f.write(content)
    
    # Make executable (chmod +x)
    try:
        st = os.stat(filepath)
        os.chmod(filepath, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    except Exception:
        pass
    print(f"  [OK] Generated: {cmd}")

print("All Linux wrappers created successfully!")
