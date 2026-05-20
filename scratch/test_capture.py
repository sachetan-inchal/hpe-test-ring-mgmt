import ctypes
from ctypes import wintypes
import time
import subprocess
import os

user32 = ctypes.windll.user32
WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

VK_CONTROL = 0x11
VK_V = 0x56
VK_RETURN = 0x0D
VK_MENU = 0x12 # ALT Key
KEYEVENTF_KEYUP = 0x0002

def set_clipboard_text(text):
    escaped_text = text.replace("'", "''")
    cmd = f"[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms]::Clipboard::SetText('{escaped_text}')"
    subprocess.run(["powershell", "-Command", cmd], capture_output=True)

target_hwnd = None

def enum_windows_callback(hwnd, lParam):
    global target_hwnd
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            title_buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title_buf, length + 1)
            title = title_buf.value
            if "powershell" in title.lower():
                target_hwnd = hwnd
                return False
    return True

user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)

if target_hwnd:
    print(f"Found target PowerShell window: HWND {target_hwnd}")
    
    # Path to output file
    temp_dir = os.environ.get("TEMP", os.environ.get("TMP", "C:\\Temp"))
    out_file = os.path.join(temp_dir, "san_agent_out.txt")
    
    if os.path.exists(out_file):
        try: os.remove(out_file)
        except: pass
        
    command_to_run = f'echo "Live Terminal Capture Success!" | Out-File -FilePath "{out_file}" -Encoding utf8'
    print(f"Routing command to terminal: {command_to_run}")
    
    set_clipboard_text(command_to_run)
    
    # Alt-key trick to bypass Windows focus permission locks
    user32.keybd_event(VK_MENU, 0, 0, 0)
    user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
    
    # Focus
    user32.ShowWindow(target_hwnd, 9)
    res_focus = user32.SetForegroundWindow(target_hwnd)
    print(f"SetForegroundWindow returned: {res_focus}")
    
    time.sleep(1.0) # More generous focus wait
    
    # Paste
    user32.keybd_event(VK_CONTROL, 0, 0, 0)
    user32.keybd_event(VK_V, 0, 0, 0)
    user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
    user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    
    time.sleep(0.2)
    
    # Enter
    user32.keybd_event(VK_RETURN, 0, 0, 0)
    user32.keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
    
    # Poll for output
    print("Waiting for output file...")
    start_time = time.time()
    captured_text = None
    
    while time.time() - start_time < 8.0:
        if os.path.exists(out_file) and os.path.getsize(out_file) > 0:
            time.sleep(0.3)
            try:
                with open(out_file, "r", encoding="utf-8-sig") as f:
                    captured_text = f.read()
                os.remove(out_file)
                break
            except Exception as e:
                pass
        time.sleep(0.1)
        
    if captured_text:
        print("\n=== CAPTURED OUTPUT ===")
        print(captured_text.strip())
        print("=======================")
        print("\nSUCCESS: Focus, paste, and capture worked perfectly!")
    else:
        print("\nFAILURE: Did not capture the output in time.")
else:
    print("PowerShell window not found.")
