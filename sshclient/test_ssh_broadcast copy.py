import time
import paramiko

# Define your device inventory
devices = [
    {
        "ip": "172.23.109.228",
        "username": "sachetan",
        "password": "sachetan",
        "name": "Device 1 (172.23.109.228)"
    },
    {
        "ip": "172.17.7.224",
        "username": "sachetan",
        "password": "sachetan123",
        "name": "Device 2 (172.17.7.224)"
    }
]

def run_sequential_ls():
    # Dictionary to temporarily store our captured outputs
    captured_outputs = {}

    for index, device in enumerate(devices, start=1):
        print(f"[{index}/{len(devices)}] Connecting to {device['name']}...")
        
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            # 1. Establish the connection
            ssh.connect(
                hostname=device["ip"],
                username=device["username"],
                password=device["password"],
                timeout=10
            )
            
            # 2. Execute 'ls' command on the remote home directory
            # We use 'ls -la' to show hidden files too, making the output distinct
            stdin, stdout, stderr = ssh.exec_command("ls -la")
            
            # 3. Read the output buffer streams
            remote_out = stdout.read().decode().strip()
            remote_err = stderr.read().decode().strip()
            
            # 4. Store the results under the device's name
            if remote_out:
                captured_outputs[device["name"]] = remote_out
            elif remote_err:
                captured_outputs[device["name"]] = f"ERROR: {remote_err}"
            else:
                captured_outputs[device["name"]] = "(Directory is empty)"
                
            print(f"-> Successfully collected output from {device['ip']}.")
            
        except Exception as e:
            captured_outputs[device["name"]] = f"CONNECTION FAILED: {e}"
            print(f"-> Failed to talk to {device['ip']}.")
            
        finally:
            # 5. Safely sever the connection channel before moving to the next device
            ssh.close()
            
        # Explicit sequential delay break
        time.sleep(1.5)

    # --------------------------------------------------
    # FINAL PRINT OUT PHASE (Once execution loop finishes)
    # --------------------------------------------------
    print("\n" + "="*60)
    print("        FINAL AGGREGATED REMOTE TERMINAL OUTPUTS      ")
    print("="*60)
    
    for device_name, ls_output in captured_outputs.items():
        print(f"\n📂 [TARGET]: {device_name}")
        print("-" * 40)
        print(ls_output)
        print("-" * 40)

if __name__ == "__main__":
    run_sequential_ls()