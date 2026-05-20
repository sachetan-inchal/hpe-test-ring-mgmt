import ctypes
from ctypes import wintypes
import time
import subprocess

user32 = ctypes.windll.user32
WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

VK_CONTROL = 0x11
VK_V = 0x56
VK_RETURN = 0x0D
KEYEVENTF_KEYUP = 0x0002

def set_clipboard_text(text):
    # Use powershell to set the clipboard reliably without ctypes memory pointer complexity
    # Quote the text and escape single quotes
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
                return False # Stop enumeration
    return True

user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)

if target_hwnd:
    print(f"Found target PowerShell window: HWND {target_hwnd}")
    set_clipboard_text("# Hello from Antigravity SAN Agent!")
    
    # Restore window
    user32.ShowWindow(target_hwnd, 9) # SW_RESTORE
    user32.SetForegroundWindow(target_hwnd)
    time.sleep(0.5) # Allow focus transition
    
    # Paste
    user32.keybd_event(VK_CONTROL, 0, 0, 0)
    user32.keybd_event(VK_V, 0, 0, 0)
    user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
    user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    
    # Press Enter
    user32.keybd_event(VK_RETURN, 0, 0, 0)
    user32.keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
    print("Simulated paste and enter successfully!")
else:
    print("PowerShell window not found.")
