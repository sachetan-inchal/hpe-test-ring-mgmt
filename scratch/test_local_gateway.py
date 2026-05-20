import os
import subprocess
import sys

# Dynamically resolve paths relative to this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MONOREPO = os.path.dirname(BASE_DIR)
mock_cli_dir = os.path.abspath(os.path.join(MONOREPO, "scratch", "mock_hpe_cli"))

print("Monorepo root resolved to:", MONOREPO)
print("Mock CLI dir resolved to:", mock_cli_dir)

# Set up environment exactly like we do in app.py
env = os.environ.copy()
path_key = "PATH"
for k in env.keys():
    if k.upper() == "PATH":
        path_key = k
        break
env[path_key] = mock_cli_dir + os.pathsep + env.get(path_key, "")

# Run showsys via PowerShell exactly like app.py does
cmd_to_run = "showsys"
print(f"Running command: powershell -Command {cmd_to_run}")
try:
    res = subprocess.run(["powershell", "-Command", cmd_to_run], capture_output=True, text=True, env=env, timeout=15)
    print("\n--- Command Output ---")
    print(res.stdout)
    print("--- Command Error ---")
    print(res.stderr)
    print("--- End of Output ---")
    
    if "PROD-A" in res.stdout and "HPE Alletra Storage MP" in res.stdout:
        print("\nSUCCESS: The mock showsys command was resolved and executed successfully using the local virtual env Python!")
    else:
        print("\nFAILURE: Output did not contain expected mock array details.")
except Exception as e:
    print(f"ERROR: Execution failed: {str(e)}")
