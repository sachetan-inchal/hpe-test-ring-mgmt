import subprocess
import time

proc = subprocess.Popen(
    ['powershell.exe', '-NoLogo', '-NoExit'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    bufsize=0
)

# Read initial prompt
time.sleep(1)
import os
os.set_blocking(proc.stdout.fileno(), False)
print("Initial:", proc.stdout.read())

# Write 'a'
proc.stdin.write(b'a')
proc.stdin.flush()
time.sleep(0.5)
print("After 'a':", proc.stdout.read())

# Write 'b\r\n'
proc.stdin.write(b'b\r\n')
proc.stdin.flush()
time.sleep(0.5)
print("After 'b\\r\\n':", proc.stdout.read())

proc.kill()
