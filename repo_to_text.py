import os
import sys
import json
import time
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

IGNORE_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build'}
ALLOW_EXTS = {'.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.json', '.md', '.yaml', '.yml', '.toml', '.rs', '.go', '.java', '.cpp', '.h', '.c'}

def export_codebase(root, out_file):
    with open(out_file, 'w', encoding='utf-8') as f:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            for fname in filenames:
                if os.path.splitext(fname)[1].lower() in ALLOW_EXTS:
                    fpath = os.path.join(dirpath, fname)
                    try:
                        content = open(fpath, 'r', encoding='utf-8').read()
                        f.write(f"# File: {fpath}\n```\n{content}\n```\n\n")
                    except Exception:
                        pass
    print(f"✅ Exported to {out_file}")

def get_file_tree(root="."):
    tree = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for fname in filenames:
            if os.path.splitext(fname)[1].lower() in ALLOW_EXTS:
                # Get relative path cleanly
                full_path = os.path.join(dirpath, fname)
                rel_path = os.path.relpath(full_path, root)
                # Normalize slashes
                rel_path = rel_path.replace("\\", "/")
                
                # Approximate token count safely
                try:
                    size = os.path.getsize(full_path)
                    tree.append({
                        "path": rel_path,
                        "name": fname,
                        "size": size,
                        "tokens": max(1, size // 4)
                    })
                except Exception:
                    pass
    return tree

def run_git_command(args):
    try:
        result = subprocess.run(['git'] + args, capture_output=True, text=True, check=True)
        return True, result.stdout.strip()
    except subprocess.CalledProcessError as e:
        return False, e.stderr.strip()

# ─── Simple Local HTTP Companion Server ────────────────────────

class CompanionServerHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, status, payload):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode('utf-8'))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == '/api/tree':
            tree = get_file_tree()
            self.send_json(200, {"status": "success", "tree": tree})
            return

        if path == '/api/file':
            target = query.get('path', [''])[0]
            if not target:
                self.send_json(400, {"error": "Missing path parameter"})
                return
            
            # Simple path traversal protection
            safe_target = os.path.abspath(target)
            if not safe_target.startswith(os.path.abspath(".")):
                self.send_json(403, {"error": "Access denied outside root directory"})
                return

            try:
                with open(target, 'r', encoding='utf-8') as f:
                    content = f.read()
                self.send_json(200, {"status": "success", "path": target, "content": content})
            except Exception as e:
                self.send_json(404, {"error": str(e)})
            return

        if path == '/api/status':
            # Check git status
            success, out = run_git_command(['status', '--short'])
            branch_success, branch = run_git_command(['branch', '--show-current'])
            self.send_json(200, {
                "status": "success",
                "git": success,
                "changes": out,
                "current_branch": branch if branch_success else "unknown"
            })
            return

        if path == '/api/get_queued_task':
            queue_path = os.path.join(".antigravity-cache", "queue.json")
            if os.path.exists(queue_path):
                try:
                    with open(queue_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    # Clear queue after reading (single task at a time)
                    os.remove(queue_path)
                    self.send_json(200, {"status": "success", "task": data.get("task")})
                except Exception as e:
                    self.send_json(500, {"error": str(e)})
            else:
                self.send_json(200, {"status": "empty", "task": None})
            return

        self.send_json(404, {"error": "Endpoint not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode('utf-8')) if body else {}
        except Exception:
            payload = {}

        if path == '/api/dispatch_task':
            task = payload.get('task')
            if not task:
                self.send_json(400, {"error": "No task description provided"})
                return
            
            os.makedirs(".antigravity-cache", exist_ok=True)
            queue_path = os.path.join(".antigravity-cache", "queue.json")
            with open(queue_path, 'w', encoding='utf-8') as f:
                json.dump({"task": task, "timestamp": time.time()}, f)
            
            self.send_json(200, {"status": "success", "message": "Task queued for Swarm"})
            return

        if path == '/api/write_batch' or path == '/api/write':
            # Handle both list of {path, content} and dict {path: content}
            files_payload = payload.get('files', {})
            files_to_write = {}
            
            if isinstance(files_payload, list):
                for f in files_payload:
                    if 'path' in f and 'content' in f:
                        files_to_write[f['path']] = f['content']
            else:
                files_to_write = files_payload

            if not files_to_write:
                self.send_json(400, {"error": "No files provided"})
                return

            written = []
            errors = []
            for fpath, content in files_to_write.items():
                try:
                    safe_target = os.path.abspath(fpath)
                    if not safe_target.startswith(os.path.abspath(".")):
                        errors.append(f"Skipped unsafe path: {fpath}")
                        continue
                    
                    os.makedirs(os.path.dirname(safe_target), exist_ok=True)
                    with open(safe_target, 'w', encoding='utf-8') as f:
                        f.write(content)
                    written.append(fpath)
                except Exception as e:
                    errors.append(f"Failed writing {fpath}: {str(e)}")

            self.send_json(200, {"status": "success", "written": written, "errors": errors})
            return

        if path == '/api/branch':
            # Create a dedicated git branch safely
            branch_name = payload.get('branch_name')
            if not branch_name:
                timestamp = int(time.time())
                branch_name = f"antigravity-patch-{timestamp}"
            
            success, out = run_git_command(['checkout', '-b', branch_name])
            if success:
                self.send_json(200, {"status": "success", "branch": branch_name, "message": out})
            else:
                self.send_json(500, {"status": "error", "error": out})
            return

        if path == '/api/revert':
            # Safe reset / discard changes
            mode = payload.get('mode', 'soft')
            if mode == 'hard':
                success, out = run_git_command(['reset', '--hard'])
            else:
                success, out = run_git_command(['checkout', '--', '.'])
            
            if success:
                self.send_json(200, {"status": "success", "message": "Changes reverted successfully"})
            else:
                self.send_json(500, {"status": "error", "error": out})
            return

        self.send_json(404, {"error": "Endpoint not found"})

def run_server(port=8000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, CompanionServerHandler)
    print(f"🚀 Antigravity Local Companion Server listening on http://localhost:{port}")
    print("Use Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
        httpd.server_close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == '--server':
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
        run_server(port)
    else:
        export_codebase(sys.argv[1] if len(sys.argv) > 1 else ".", "codebase.txt")
        print("💡 Tip: Run 'python repo_to_text.py --server' to start the interactive local companion API for Antigravity live coding.")
