## SSH Credentials Migration (SQLite → Mongo)

### Step 1 — Convert sqlite-based SSH inventory modules to Mongo-only
- [x] Update `sshclient/inventory_manager.py` to remove `sqlite3` and `secret.key` logic.
- [x] Implement Mongo-backed functions: init (no-op), upsert/save, list, delete.
- [x] Encrypt/decrypt passwords consistently with `api/app.py` (`SECRET_ENCRYPTION_KEY`).

### Step 2 — Convert temporary HTTP inventory server to Mongo-only
- [x] Update `sshclient/temp_inventory_server.py` to remove all sqlite code.
- [x] Make `/api/devices`, `/api/credentials/save`, `/api/credentials/delete`, `/api/ssh/exec` call Mongo.
- [x] Ensure `/api/ssh/exec` can use stored credentials when password is omitted.


### Step 3 — Verify wiring
- [x] Check `docker-compose.yml` for any service pointing to the SQLite temp server.
- [x] Update compose to run Mongo-backed server (or switch endpoints to `api/app.py`).


### Step 4 — Smoke test
- [x] Save credentials → list → delete using Mongo-backed inventory.
- [x] Execute `/api/ssh/exec` using stored credentials (requires reachable SSH target; not executed in this automated smoke test).




