import ctypes
from ctypes import wintypes
import os

user32 = ctypes.windll.user32
WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

terminals = []

def enum_windows_callback(hwnd, lParam):
    if user32.IsWindowVisible(hwnd):
        # Get Window Text
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            title_buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title_buf, length + 1)
            title = title_buf.value
            
            # Get Window Class
            class_buf = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, class_buf, 256)
            class_name = class_buf.value
            
            lower_title = title.lower()
            lower_class = class_name.lower()
            
            # Check if it's a potential terminal window
            is_terminal = any(term in lower_title for term in ["powershell", "cmd", "terminal", "git bash", "git-bash", "wsl", "conhost", "mingw"]) or \
                          any(term in lower_class for term in ["consolewindowclass", "cascadiagroupingwindow", "terminalwindow"])
            
            if is_terminal:
                terminals.append({
                    "hwnd": hwnd,
                    "title": title,
                    "class": class_name
                })
    return True

# Enumerate
user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)

print(f"Found {len(terminals)} terminal window(s):")
for t in terminals:
    print(f"HWND: {t['hwnd']} | Title: {t['title']} | Class: {t['class']}")
