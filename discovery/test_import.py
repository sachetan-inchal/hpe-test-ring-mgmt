import os
import sys
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SIM_DIR = os.path.join(BASE_DIR, "..", "simulator")
print(f"BASE_DIR: {BASE_DIR}")
print(f"SIM_DIR: {SIM_DIR}")
sys.path.insert(0, SIM_DIR)
try:
    from network_sim import virtual_network
    print("Import successful!")
except ImportError as e:
    print(f"Import failed: {e}")
    print(f"Contents of {SIM_DIR}: {os.listdir(SIM_DIR)}")
