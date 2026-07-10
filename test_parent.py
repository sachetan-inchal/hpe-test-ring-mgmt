from simulator.network_sim import virtual_network
for d in virtual_network.list_devices():
    print(f"Device: {d.get('name')} | IP: {d.get('ip')} | Type: {d.get('type')}")
