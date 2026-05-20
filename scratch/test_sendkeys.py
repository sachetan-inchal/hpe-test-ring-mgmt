import subprocess
import time
import ctypes

# Focus the powershell window first
user32 = ctypes.windll.user32
target_hwnd = None
def enum_windows_callback(hwnd, lParam):
    global target_hwnd
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            title_buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title_buf, length + 1)
            if "powershell" in title_buf.value.lower():
                target_hwnd = hwnd
                return False
    return True

user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)(enum_windows_callback), 0)

if target_hwnd:
    user32.ShowWindow(target_hwnd, 9)
    user32.SetForegroundWindow(target_hwnd)
    time.sleep(1)
    
    # Send keys using PowerShell SendWait
    cmd = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('echo hello{ENTER}')"
    subprocess.run(["powershell", "-Command", cmd])
    print("Sent keys!")
