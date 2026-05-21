import subprocess
import time
import sys

print("Testing subprocess spawn...")
shell_cmd = ['powershell.exe', '-NoLogo', '-NoExit']
try:
    proc = subprocess.Popen(
        shell_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=0
    )
    time.sleep(1)
    poll_val = proc.poll()
    print("Poll value after 1s:", poll_val)
    if poll_val is not None:
        print("PowerShell exited immediately! Code:", poll_val)
    else:
        print("PowerShell is running successfully!")
        proc.stdin.write(b"echo 'Hello from Subprocess'\r\n")
        proc.stdin.flush()
        time.sleep(1)
        # read some output
        import os
        os.set_blocking(proc.stdout.fileno(), False)
        out = proc.stdout.read()
        print("Output:", out)
        proc.kill()
except Exception as e:
    print("Spawn failed:", e)
