import time
import paramiko

# Define your device inventory
devices = [
    {
        "ip": "172.23.109.228",
        "username": "sachetan",
        "password": "sachetan",
        "name": "Device 1 (172.23.109.228)",
    },
    {
        "ip": "172.17.7.224",
        "username": "sachetan",
        "password": "sachetan123",
        "name": "Device 2 (172.17.7.224)",
    },
    {
        "ip": "172.17.3.208",
        "username": "u0_a282",
        "password": "sachetan",
        "port": 8022,
        "name": "Device 3 (172.17.3.208:8022)",
    },
    {
        "ip": "172.17.9.127",
        "username": "u0_a361",
        "password": "sachetan123",
        "port": 8022,
        "name": "Device 4 (172.17.9.127:8022)",
    },
]


def _run_cmd(ssh: paramiko.SSHClient, cmd: str) -> dict:
    """Run a command and return stdout/stderr as strings."""
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return {"stdout": out, "stderr": err}


def run_sequential_commands():
    captured_outputs = {}

    commands = [
        {"label": "ls", "cmd": "ls"},
        {"label": "showversion -b", "cmd": "showversion -b"},
        {"label": "showsys", "cmd": "showsys"},
    ]

    for index, device in enumerate(devices, start=1):
        print(f"[{index}/{len(devices)}] Connecting to {device['name']} ({device['ip']})...")

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            port = int(device.get("port", 22))
            ssh.connect(
                hostname=device["ip"],
                port=port,
                username=device["username"],
                password=device["password"],
                timeout=10,
            )
            print(f"-> Connected to {device['ip']}. Executing commands...")

            device_results = {}
            for c in commands:
                label = c["label"]
                cmd = c["cmd"]
                print(f"   · {label}: {cmd}")

                res = _run_cmd(ssh, cmd)
                if res["stdout"]:
                    device_results[label] = res["stdout"]
                elif res["stderr"]:
                    device_results[label] = f"ERROR: {res['stderr']}"
                else:
                    device_results[label] = "(no output)"

            captured_outputs[device["name"]] = device_results

        except Exception as e:
            captured_outputs[device["name"]] = {
                "error": f"CONNECTION FAILED: {e}",
            }
            print(f"-> Failed to talk to {device['ip']}: {e}")

        finally:
            ssh.close()

        time.sleep(1.5)

    print("\n" + "=" * 60)
    print("        FINAL AGGREGATED REMOTE COMMAND OUTPUTS     ")
    print("=" * 60)

    for device_name, results in captured_outputs.items():
        print(f"\n📂 [TARGET]: {device_name}")
        print("-" * 60)
        if "error" in results:
            print(results["error"])
            continue

        for label, output in results.items():
            print(f"\n▸ {label}")
            print("-" * 40)
            print(output)
            print("-" * 40)


if __name__ == "__main__":
    run_sequential_commands()

