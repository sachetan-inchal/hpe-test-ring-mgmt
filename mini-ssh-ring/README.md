# Mini SSH Ring Manager

Bare-bones web UI (pure **HTML + JS**) to:
- Register SSH credentials for devices (Host / Array / Switch)
- Run a preset list of diagnostic commands against a target
- Trigger discovery across all saved devices
- View command output + discovery results

> This UI is meant to be lightweight and easy to modify; the actual SSH/discovery logic is implemented by the backend in `server.py` and exposed through the project’s API.

---

## What you need

- Python installed (to run `server.py`)
- Access to the API endpoints used by the UI
- No database containers (MongoDB) are required for credentials persistence; it now uses a pure Python local JSON file (`ssh_credentials.json`) to save data safely.

---

## Folder structure

- `index.html` – Single page web UI
- `server.py` – Backend service for the mini project
- `requirements.txt` – Python dependencies for `server.py`

---

## Run the backend

From the repo root:

```powershell
cd mini-ssh-ring
python server.py
```

Then open the UI page:
- If `server.py` serves `index.html`, open the local URL it prints.
- Otherwise, you can open `index.html` directly in a browser (if CORS / API base settings are compatible).

---

## UI usage

### 1) Add / Save SSH credentials
1. Enter:
   - **Device Name**
   - **Category** (Host / Array / Switch)
   - **IP** (or DNS fields if used by your backend)
   - **Username**
   - **Password**
2. Optionally customize **Preset Commands**:
   - Check/uncheck built-in commands for that category
3. Optionally add **Custom commands**:
   - Type a command in **Add command**
   - Click **Add**
   - Use the checkbox to enable/disable it
   - Use the 🗑 button to remove it
4. Click **Save Credentials**

### 2) Discover All
- Click **Discover All** to trigger discovery for all saved credentials.
- The discovery request is built from the enabled preset + enabled custom commands for each device’s category.

### 3) Run Diagnostic Commands (Connect & Run)
1. Provide target details:
   - **Target IP or DNS Name** (depending on backend support)
   - **Username / Password / Port**
   - **Target Category**
2. Choose which commands will run by checking preset/custom commands for that category.
3. Click **Connect & Run**
4. View output in the console area.

### 4) Refresh
- Refresh updates the **Registered Credentials** table.

---

## Neo4j / MongoDB (how to inspect stored data)

If your discovery flow persists data into Neo4j and/or MongoDB:

- **Neo4j**
  - Neo4j Browser: `http://localhost:7474`
  - Neo4j connection settings come from the top-level `docker-compose.yml`
  - In Neo4j Browser, you can run queries like:
    - `MATCH (n) RETURN labels(n), count(*)`

- **MongoDB**
  - Connection string: `mongodb://localhost:27017`
  - Use MongoDB Compass / Robo 3T to inspect databases & collections.

---

## Notes / customization

### API base
In `index.html`, the UI uses:
```js
const API_BASE = '';
```

If your backend is hosted under a different origin/path, update `API_BASE` accordingly.

### Preset commands
The built-in presets live in `index.html` inside `PRESET_COMMANDS`.

You can update or expand them, and the UI will automatically render checkboxes.

---

## Troubleshooting

- **Buttons do nothing / errors in console**
  - Open browser devtools → Console/Network
  - Verify the backend is running and the expected endpoints are reachable.

- **CORS errors**
  - Serve the UI from the same backend origin (recommended) or configure CORS in `server.py`.

---

## License

Add your preferred license header here (or confirm the repo’s existing license). 

