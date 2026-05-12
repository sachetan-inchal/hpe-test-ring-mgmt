import requests, sys, urllib.parse, os
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, 'discovery'))
sys.path.insert(0, os.path.join(BASE_DIR, 'discovery', 'parsers'))
from discovery.parsers.sim_parser import parse_sim_array_output

cmds = ['showsys','shownode','showport','showswitch','showhost','showcage','showcage -state','showpd','showpd -s','showpd -i','showversion -b']
outputs = {}
for cmd in cmds:
    r = requests.get(f'http://localhost:5001/sim/exec/10.20.10.5/{urllib.parse.quote(cmd)}', timeout=5)
    outputs[cmd] = r.json().get('output','') if r.ok else ''

result = parse_sim_array_output(outputs)
print("Array:    ", result.get("name"), "(", result.get("model"), ")")
print("Nodes:    ", len(result.get("nodes", [])))
print("Ports:    ", len(result.get("ports", [])))
print("Hosts:    ", len(result.get("hosts", [])))
print("Drives:   ", len(result.get("drives", [])))
print("Cages:    ", len(result.get("cages", [])))
print("Switches: ", len(result.get("switches", [])))
print("TotalCap: ", result.get("total_cap_mib"), "MiB")
print("Serial:   ", result.get("serial"))
print("Version:  ", result.get("release_version"))
