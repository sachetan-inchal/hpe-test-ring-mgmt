import ctypes
from ctypes import wintypes
import sys

# Reconfigure stdout to use utf-8 to prevent cp1252 print errors
sys.stdout.reconfigure(encoding='utf-8')

user32 = ctypes.windll.user32
WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

windows = []

def enum_windows_callback(hwnd, lParam):
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            title_buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title_buf, length + 1)
            title = title_buf.value
            
            class_buf = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, class_buf, 256)
            class_name = class_buf.value
            
            windows.append({
                "hwnd": hwnd,
                "title": title,
                "class": class_name
            })
    return True

user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)

print(f"Listing all {len(windows)} visible windows:")
for w in sorted(windows, key=lambda x: x["title"].lower()):
    # Escape any potential print issues
    safe_title = w['title'].encode('utf-8', errors='replace').decode('utf-8')
    print(f"HWND: {w['hwnd']} | Class: {w['class']} | Title: {safe_title}")
