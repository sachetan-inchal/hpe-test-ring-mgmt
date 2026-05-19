import requests
import socket

def scan_ports():
    print("Scanning localhost ports for Ollama...")
    ports = [11434, 11435, 11430, 8000, 8001, 8080, 9000]
    for port in ports:
        try:
            r = requests.get(f"http://127.0.0.1:{port}/api/tags", timeout=0.5)
            print(f"[*] Port {port} responded with status: {r.status_code}")
            print(f"    Body: {r.json()}")
            return port
        except Exception:
            pass
    print("Ollama not found on localhost standard ports. Let's try scanning subnet or check network interfaces...")
    return None

if __name__ == "__main__":
    scan_ports()
