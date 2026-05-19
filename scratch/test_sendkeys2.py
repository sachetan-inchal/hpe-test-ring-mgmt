import subprocess
import time
import ctypes
import os

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

def escape_sendkeys(text):
    # order matters: escape { and } first!
    text = text.replace('{', '{{}').replace('}', '{}}')
    for char in ['+', '^', '%', '~', '(', ')']:
        text = text.replace(char, f"{{{char}}}")
    return text

if target_hwnd:
    user32.ShowWindow(target_hwnd, 9)
    user32.SetForegroundWindow(target_hwnd)
    time.sleep(1)
    
    cmd_to_run = "showsys"
    out_file = os.path.join(os.environ.get("TEMP", "C:\\Temp"), "test_out.txt")
    command_typed = f'{cmd_to_run} | Out-File -FilePath "{out_file}" -Encoding utf8'
    
    escaped_keys = escape_sendkeys(command_typed)
    ps_string = escaped_keys.replace("'", "''")
    clip_cmd = f"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ps_string}{{ENTER}}')"
    
    print("Running:", clip_cmd)
    subprocess.run(["powershell", "-Command", clip_cmd])
    print("Sent keys!")
