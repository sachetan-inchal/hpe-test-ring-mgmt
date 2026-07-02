"""
SAN AI Agent — Autonomous ReAct-style agentic loop over the HPE simulator and real SSH devices.

Features:
  - Dynamically injects the device topology (names, IPs, real/mock status, team scopes) into the LLM system context.
  - Exposes explicit callable tools: ssh_execute, run_cypher, parse_and_persist.
  - Follows a structured JSON tool calling schema for planning and reflection.
"""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from discovery.crawler import HPE_COMMANDS
from discovery.parsers.sim_parser import parse_sim_array_output

# ── Allowlist ─────────────────────────────────────────────────────────────────

ALLOWED_COMMANDS = frozenset(HPE_COMMANDS) | frozenset({
    "checkhealth", "cli checkhealth", "showversion", "showportdev",
})

FORBIDDEN_PATTERNS = re.compile(
    r"[|;&`$><]|\b(rm|sudo|curl|wget|bash|sh)\b",
    re.IGNORECASE,
)

# How many reflection / tool execution rounds before forcing final synthesis
MAX_REFLECT_ITERS = 4

# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def _normalize_cmd(command: str) -> str:
    return " ".join(command.strip().split())


def validate_command(command: str) -> str:
    cmd = _normalize_cmd(command)
    if not cmd:
        raise ValueError("Empty command")
    if FORBIDDEN_PATTERNS.search(cmd):
        raise ValueError("Command contains disallowed shell patterns")
    for allowed in sorted(ALLOWED_COMMANDS, key=len, reverse=True):
        if cmd == allowed or cmd.startswith(allowed + " "):
            return cmd
    raise ValueError(f"Command not in allowlist: {cmd.split()[0]!r}")


def _parse_single(command: str, output: str, command_parsers: dict) -> Any:
    cmd = _normalize_cmd(command)
    for key in sorted(command_parsers.keys(), key=len, reverse=True):
        if cmd == key or cmd.startswith(key + " "):
            return command_parsers[key](output)
    return {"raw_lines": len(output.splitlines())}


def _strip_think(text: str) -> str:
    """Remove <think>...</think> blocks from LLM output."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _extract_json(text: str) -> Optional[dict]:
    """Pull the first {...} JSON object out of an LLM response."""
    text = _strip_think(text)
    try:
        return json.loads(text)
    except Exception:
        pass
    text = re.sub(r"```(?:json)?", "", text).strip().strip("`").strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    return None


# ── Agent ─────────────────────────────────────────────────────────────────────

class SanAgent:
    def __init__(
        self,
        execute_fn: Callable[[str, str], str],
        list_devices_fn: Callable[[], list],
        neo4j_store=None,
        run_cypher_fn: Optional[Callable] = None,
        llm_call: Optional[Callable] = None,
        command_parsers: Optional[dict] = None,
        parse_array_outputs: Optional[Callable] = None,
    ):
        self.execute = execute_fn
        self.list_devices = list_devices_fn
        self.neo4j = neo4j_store
        self.run_cypher = run_cypher_fn
        self.llm_call = llm_call
        self.command_parsers = command_parsers or {}
        self.parse_array_outputs = parse_array_outputs or parse_sim_array_output
        self.request_id = None
        self.notebook = {}
        self.notebook_summary = {}

    def _load_topology_context(self) -> str:
        """Dynamic lookup of all devices, kinds, teams, and IP distribution context."""
        devices = []
        # Mock/virtual devices
        try:
            raw_virtuals = self.list_devices() or []
            for d in raw_virtuals:
                if isinstance(d, dict):
                    devices.append({
                        "device_name": d.get("name"),
                        "device_kind": "mock (virtual)",
                        "team": d.get("team") or d.get("owner_team") or "real-devices",
                        "inband_ip": d.get("ip") or d.get("ip_address"),
                        "oob_ip": d.get("oob_ip") or "None"
                    })
                elif isinstance(d, str):
                    name = d.replace(".txt", "")
                    devices.append({
                        "device_name": name,
                        "device_kind": "mock (virtual)",
                        "team": "real-devices",
                        "inband_ip": d,
                        "oob_ip": "None"
                    })
        except Exception:
            pass

        # Real registered devices from MongoDB
        try:
            from discovery.mongo_store import MongoStore
            mongo = MongoStore()
            if mongo.available:
                db = mongo.db
                for cred in db.ssh_credentials.find():
                    devices.append({
                        "device_name": cred.get("device_name"),
                        "device_kind": cred.get("device_kind") or "real",
                        "team": cred.get("team") or cred.get("team_scope") or "real-devices",
                        "inband_ip": cred.get("ip") or cred.get("ip_address"),
                        "oob_ip": cred.get("oob_ip") or "None"
                    })
        except Exception:
            pass

        # Deduplicate by device_name
        seen = set()
        deduped = []
        for d in devices:
            if d["device_name"] and d["device_name"] not in seen:
                seen.add(d["device_name"])
                deduped.append(d)
        return json.dumps(deduped, indent=2)

    # ── Intent Classifier ────────────────────────────────────────────────────

    _INTENT_SYSTEM = """\
You are an intent classifier for an HPE SAN storage systems assistant.
Classify the user's input into one of these categories:
- GREETING: Simple hello, thanks, greeting, or polite small talk.
- OUT_OF_SCOPE: General knowledge, poetry, questions about your name/identity, or other non-SAN topics.
- DIAGNOSTIC: A question, request, or query about SAN hardware, health, configuration, zoning, hosts, version, capacity, or troubleshooting.

Return ONLY a JSON object:
{"intent": "GREETING" | "OUT_OF_SCOPE" | "DIAGNOSTIC", "response": "A direct, polite response if the intent is GREETING or OUT_OF_SCOPE, otherwise null."}

Output ONLY the JSON. No markdown."""

    def _llm_classify_intent(self, query: str, use_ollama=False, disable_think=False, ollama_model=None) -> dict:
        if not self.llm_call:
            return {"intent": "DIAGNOSTIC", "response": None}
        q_clean = query.lower().strip().strip("?.! ")
        if q_clean in ("hi", "hello", "hey", "hola", "greetings", "good morning", "good afternoon", "thanks", "thank you", "bye", "goodbye"):
            resp = "Hello! I am your HPE SAN Storage Assistant. How can I help you with your storage arrays, switches, or hosts today?"
            if q_clean in ("thanks", "thank you"):
                resp = "You're welcome! Let me know if you need any more SAN diagnostics or assistance."
            elif q_clean in ("bye", "goodbye"):
                resp = "Goodbye! Have a great day managing your SAN infrastructure."
            return {"intent": "GREETING", "response": resp}
            
        try:
            old_callback = getattr(self, "on_synthesis_chunk", None)
            self.on_synthesis_chunk = None
            try:
                raw = self._stream_llm_call(
                    self._INTENT_SYSTEM, f"User input: {query}",
                    use_ollama=use_ollama, disable_think=disable_think,
                    json_mode=True, ollama_model=ollama_model
                )
            finally:
                self.on_synthesis_chunk = old_callback
                
            data = _extract_json(raw)
            if data and data.get("intent"):
                return {
                    "intent": str(data["intent"]).upper(),
                    "response": data.get("response")
                }
        except Exception:
            pass
        return {"intent": "DIAGNOSTIC", "response": None}

    def _stream_llm_call(self, system: str, user: str, use_ollama=False, disable_think=False, json_mode=False, ollama_model=None) -> str:
        if not self.llm_call:
            return ""
        ans = self.llm_call(
            system, user,
            use_ollama=use_ollama, disable_think=disable_think, stream=True,
            json_mode=json_mode, ollama_model=ollama_model, request_id=self.request_id
        )
        full_ans = []
        if hasattr(ans, "__iter__") and not isinstance(ans, str):
            for chunk in ans:
                try:
                    chunk_data = json.loads(chunk)
                    msg = chunk_data.get("message", {})
                    thinking = msg.get("thinking") or msg.get("reasoning_content") or ""
                    content = msg.get("content") or ""
                    if thinking:
                        chunk_text, is_think = thinking, True
                    else:
                        chunk_text, is_think = content, False
                except Exception:
                    chunk_text, is_think = chunk, False

                if chunk_text:
                    full_ans.append(chunk_text)
                    callback = getattr(self, "on_synthesis_chunk", None)
                    if callback:
                        try:
                            callback(chunk_text, is_think)
                        except Exception:
                            pass
            return "".join(full_ans)
        return str(ans)

    # ── Step emitter ─────────────────────────────────────────────────────────

    def _step(self, steps: list, step_type: str, title: str, detail: str = "", **extra):
        step = {
            "id": len(steps) + 1,
            "type": step_type,
            "title": title,
            "detail": detail,
            "timestamp": _now_iso(),
            "status": "complete",
            **extra,
        }
        steps.append(step)
        callback = getattr(self, "on_step", None)
        if callback:
            try:
                callback(step)
            except Exception:
                pass

    # ── Phase 1: LLM Planner with Callable Tools ─────────────────────────────

    _PLANNER_SYSTEM = """\
You are an Autonomous SAN Diagnostics Assistant for HPE storage networks (3PAR, Primera, Alletra).
Decide which tools to call first to fulfill the user's query.

INVENTORY TOPO (Devices available in the network):
{topology_context}

CALLABLE TOOLS:
1. ssh_execute(device_name, ip, command)
   - Establish connection to an INVENTORY TOPO device using default/pre-configured simulator credentials and run a single CLI command.
   - ONLY use this for standard topology devices listed in INVENTORY TOPO.
   - Do NOT use this if the user provides explicit custom credentials, custom username, password, or custom port.
   - Args:
     - device_name: name of target device
     - ip: target IP
     - command: CLI command string
2. run_cypher(query)
   - Run a read-only Cypher query on the Neo4j graph database to retrieve topology relationships.
   - Schema: Nodes: ArraySystem(ip_address, name, model, serial, release_version), Node, Switch, Host, Cage, PhysicalDisk.
             Relationships: (Host)-[:CONNECTS_TO]->(ArraySystem), (ArraySystem)-[:HAS_NODE|HAS_CAGE|HAS_SWITCH]->(Node|Cage|Switch), (Cage)-[:CONTAINS]->(PhysicalDisk)
   - Args:
     - query: Neo4j Cypher query string
3. parse_and_persist(device_name, command, raw_output)
   - Send raw CLI command outputs to the parser, extract structured facts, and store them in the Neo4j Graph DB and MongoDB.
   - Args:
     - device_name: name of target device
     - command: command string
     - raw_output: raw text output from ssh_execute
4. read_neo4j_manual()
   - Retrieve the full schema documentation, node label properties, and guidelines for writing Neo4j Cypher queries for the HPE SAN network topology.
   - Args: None
5. ssh_custom_execute(host, username, password, port, commands)
   - CRITICAL: You MUST use this tool whenever the user explicitly provides custom SSH credentials (such as username, password, custom port, etc.) or when connecting to a custom target host (e.g. 127.0.0.1 on port 2201).
   - This tool establishes a direct connection using Paramiko.
   - Pass multiple commands as a list of strings, e.g. ["showsys", "shownode", "showswitch"] or as a newline-separated string. Do NOT concatenate them with commas like "showsys,shownode,showswitch" in a single command.
   - Args:
     - host: Target host IP or hostname (string)
     - username: SSH username (string)
     - password: SSH password (string)
     - port: SSH port (integer)
     - commands: A list of command strings or a single command string to execute.
6. write_notebook(key, content)
   - Save raw command logs, outputs, search results, or notes under a specific key in the local scratchpad. Use this to remember long outputs without cluttering the context window.
   - Args:
     - key: Unique identifier string for the note/log
     - content: Full text content to store
7. read_notebook_summary()
   - Return a summary index of all stored keys and previews in the scratchpad.
   - Args: None
8. read_notebook_key(key, start_line, end_line)
   - Read the exact content stored under a key in the scratchpad. You can specify start_line and end_line to retrieve specific lines/chunks instead of loading the entire content.
   - Args:
     - key: The notepad key to read
     - start_line: 1-indexed start line number (default 1)
     - end_line: 1-indexed end line number (optional)

Return ONLY a JSON object:
{{
  "reasoning": "Plan/Reflect reasoning...",
  "tool_calls": [
    {{
      "tool": "ssh_execute" | "run_cypher" | "parse_and_persist" | "read_neo4j_manual" | "ssh_custom_execute" | "write_notebook" | "read_notebook_summary" | "read_notebook_key",
      "args": {{ ... }}
    }}
  ]
}}



Output ONLY the JSON. No markdown, no text outside the JSON."""

    def _llm_plan(self, query: str, topology_context: str, steps: list,
                  use_ollama=False, disable_think=False, ollama_model=None) -> dict:
        """Ask LLM to plan tool calls."""
        if not self.llm_call:
            return {"reasoning": "Standard plan", "tool_calls": []}

        system_prompt = self._PLANNER_SYSTEM.format(topology_context=topology_context)
        user_msg = f"User query: {query}"

        self._step(steps, "thinking", "Planning Tools", "Asking LLM to plan autonomous tool calls...")
        try:
            raw = self._stream_llm_call(
                system_prompt, user_msg,
                use_ollama=use_ollama, disable_think=disable_think,
                json_mode=True, ollama_model=ollama_model
            )
            data = _extract_json(raw)
            if data and "tool_calls" in data:
                self._step(steps, "thinking", "Plan Approved",
                           f"Reasoning: {data.get('reasoning')}\n"
                           f"Scheduled {len(data['tool_calls'])} tool call(s).")
                return data
        except Exception as e:
            sys.stderr.write(f"[SanAgent] Planner failed: {e}\n")

        return {"reasoning": "Fallback plan", "tool_calls": []}

    # ── Tool Execution Handlers ──────────────────────────────────────────────

    def _tool_ssh_execute(self, device_name: str, ip: str, command: str, steps: list) -> str:
        self._step(steps, "command", f"SSH: Executing command", f"Running `{command}` on device `{device_name}` ({ip})...", command=command, device_ip=ip)
        try:
            validated = validate_command(command)
            output = self.execute(ip, validated)
            self._step(steps, "command", f"SSH: Completed", f"Successfully received output from `{device_name}`.", command=command, device_ip=ip, command_output=output)
            return output
        except Exception as e:
            err_msg = f"Execution failed: {str(e)}"
            self._step(steps, "error", f"SSH: Failed", err_msg)
            return err_msg

    def _tool_run_cypher(self, query: str, steps: list, use_ollama=False, disable_think=False, ollama_model=None) -> list:
        if not (query and self.run_cypher and self.neo4j and self.neo4j.available):
            self._step(steps, "error", "Cypher: Unavailable", "Neo4j is not connected.")
            return []

        self._step(steps, "cypher", "Neo4j: Querying", query.strip(), cypher=query.strip())
        try:
            rows = self.run_cypher(query) or []
            self._step(steps, "result", "Neo4j: Complete", f"Retrieved {len(rows)} row(s) from Neo4j.", rows=rows[:50])
            return rows
        except Exception as ex:
            self._step(steps, "cypher_error", "Neo4j: Query failed", str(ex))
            # Self-correction logic
            correction_system = (
                "You are a Neo4j Cypher debugging assistant. Fix the failing Cypher query so it compiles and runs.\n"
                "Schema: ArraySystem(ip_address, name, model, serial, release_version), Node, Switch, Host, Cage, PhysicalDisk.\n"
                "Relationships: (Host)-[:CONNECTS_TO]->(ArraySystem), (ArraySystem)-[:HAS_NODE|HAS_CAGE|HAS_SWITCH]->(Node|Cage|Switch), (Cage)-[:CONTAINS]->(PhysicalDisk).\n"
                "Output ONLY the corrected Cypher. No markdown."
            )
            try:
                corrected = self.llm_call(
                    correction_system,
                    f"Original:\n{query}\n\nError:\n{ex}",
                    use_ollama=use_ollama, disable_think=disable_think, stream=False,
                    ollama_model=ollama_model
                )
                corrected = _strip_think(corrected).strip().strip("`").strip()
                if corrected.startswith("```"):
                    corrected = "\n".join(corrected.split("\n")[1:])
                if corrected.endswith("```"):
                    corrected = "\n".join(corrected.split("\n")[:-1])

                self._step(steps, "cypher", "Neo4j: Retrying corrected query", corrected, cypher=corrected)
                rows = self.run_cypher(corrected) or []
                self._step(steps, "result", "Neo4j: Corrected query complete", f"Retrieved {len(rows)} row(s).", rows=rows[:50])
                return rows
            except Exception as e2:
                self._step(steps, "cypher_error", "Neo4j: Self-correction failed", str(e2))
                return []

    def _tool_parse_and_persist(self, device_name: str, command: str, raw_output: str, steps: list) -> dict:
        self._step(steps, "thinking", "Parser: Processing", f"Parsing raw outputs of `{command}` from device `{device_name}`.")
        try:
            parsed = _parse_single(command, raw_output, self.command_parsers)
            count = len(parsed) if isinstance(parsed, list) else (1 if parsed else 0)
            
            # Neo4j Graph store (if array outputs)
            if self.neo4j and self.neo4j.available:
                try:
                    structured = self.parse_array_outputs({command: raw_output})
                    structured["name"] = device_name
                    structured["hosts"] = self._hosts_for_neo4j(structured.get("hosts", []))
                    self.neo4j.store(structured)
                except Exception:
                    pass

            # MongoDB persist
            try:
                from discovery.mongo_store import MongoStore
                mongo = MongoStore()
                if mongo.available:
                    mongo.db.sandatas.update_one(
                        {"device_name": device_name},
                        {"$set": {
                            "device_name": device_name,
                            "last_command": command,
                            "parsed_data": parsed,
                            "updated_at": datetime.utcnow().isoformat() + "Z"
                        }},
                        upsert=True
                    )
            except Exception:
                pass

            self._step(steps, "parsed", f"Parser: Saved successfully", f"Extracted and persisted {count} records in databases.", parsed_preview=parsed)
            return parsed
        except Exception as e:
            err_msg = f"Parser failure: {str(e)}"
            self._step(steps, "error", "Parser: Failed", err_msg)
            return {"error": err_msg}

    def _hosts_for_neo4j(self, hosts: list) -> list:
        out = []
        for h in hosts:
            row = dict(h)
            row["os_name"] = row.get("os_name") or row.get("os") or row.get("persona", "")
            row["ip_address"] = row.get("ip_address") or row.get("wwn", "")
            row["multipath"] = row.get("multipath") or row.get("port", "")
            out.append(row)
        return out

    def _tool_read_neo4j_manual(self, steps: list) -> str:
        self._step(steps, "thinking", "Manual: Reading Schema", "Retrieving the Neo4j SAN Knowledge-base manual and schema guide.")
        manual_content = """\\
=== NEO4J SAN KNOWLEDGE-BASE MANUAL ===
The topology of the SAN network is stored in Neo4j with the following Node types and relationships.

1. NODE LABELS:
- ArraySystem: Represents the storage array (e.g. ARR-01).
  Properties: ip_address, name, model, serial, release_version, total_cap_mib, free_cap_mib, config_type, node_count, is_decommissioned.
- Node: Controller node inside an array.
  Properties: node_id, name, is_master, mem_mib, up_since.
- Port: Physical port on a controller node or switch.
  Properties: port_id, name, type, speed, state.
- Switch: FC switch.
  Properties: name, state, mode, serial, temperature, model, ip_address.
- Host: Compute server/host.
  Properties: ip_address, name, os_name, os_version, wwn, multipath, device_type.
- Cage: Drive enclosure shelf.
  Properties: cage_id, name, state, model, drive_count, temperature.
- PhysicalDisk: Hard disk drive.
  Properties: serial, pd_id, cage_pos, drive_type, manufacturer, model, firmware_rev, capacity_gb, sed_state, protocol, state, health, device.

2. RELATIONSHIPS:
- (a:ArraySystem)-[:HAS_NODE]->(n:Node)
- (n:Node)-[:HAS_PORT]->(p:Port)
- (a:ArraySystem)-[:HAS_CAGE]->(c:Cage)
- (c:Cage)-[:CONTAINS]->(d:PhysicalDisk)
- (p1:Port)-[:CONNECTS_TO]->(p2:Port)  -- Connects a node port to switch/host port or vice versa
- (h:Host)-[:CONNECTS_TO]->(a:ArraySystem)
- (h:Host)-[:HAS_DISK]->(d:PhysicalDisk)
- (a:ArraySystem)-[:HAS_SWITCH]->(s:Switch)
- (a:ArraySystem)-[:REMOTE_COPY_PEER]->(a2:ArraySystem)

3. IMPORTANT QUERYING AND ONTOLOGY NOTES:
- IMPORTANT: There is NO node labeled "Device" in the database! Do not run "MATCH (d:Device) ...".
- "Device" types/kinds (real vs virtual/mock) are NOT stored in Neo4j directly as a property of a single "Device" node. They are categorized based on their Node labels:
  - Storage arrays are labeled `ArraySystem`.
  - Switches are labeled `Switch`.
  - Compute hosts are labeled `Host`.
  - Individual virtual/mock devices vs. real ones can be referenced in the INVENTORY TOPO context or by checking the MongoDB `ssh_credentials` collection.
  - To check all active array systems in Neo4j: `MATCH (a:ArraySystem) RETURN a`
  - To check switches: `MATCH (s:Switch) RETURN s`
  - To check hosts: `MATCH (h:Host) RETURN h`
"""
        return manual_content

    def _tool_ssh_custom_execute(self, host: str, username: str, password: str, port: Any, commands: Any, steps: list) -> str:
        self._step(steps, "command", "SSH Custom: Connecting", f"Connecting to {username}@{host}:{port} via SSH...")
        import paramiko
        
        try:
            port_val = int(port)
        except Exception:
            port_val = 22

        if isinstance(commands, str):
            if "\\n" in commands or "\n" in commands:
                cmd_list = [c.strip() for c in commands.replace("\\n", "\n").split("\n") if c.strip()]
            else:
                cmd_list = [commands]
        elif isinstance(commands, list):
            cmd_list = [str(c) for c in commands]
        else:
            cmd_list = [str(commands)]

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            client.connect(
                hostname=host,
                username=username,
                password=password,
                port=port_val,
                timeout=10.0
            )
            self._step(steps, "command", "SSH Custom: Connected", f"Successfully connected to {host}:{port_val}.")
        except Exception as e:
            err_msg = f"SSH connection failed: {str(e)}"
            self._step(steps, "error", "SSH Custom: Connection Failed", err_msg)
            return err_msg

        results = []
        try:
            for cmd in cmd_list:
                self._step(steps, "command", f"SSH Custom: Executing", f"Running `{cmd}`...", command=cmd, device_ip=host)
                try:
                    stdin, stdout, stderr = client.exec_command(cmd)
                    out = stdout.read().decode('utf-8', errors='replace')
                    err = stderr.read().decode('utf-8', errors='replace')
                    exit_code = stdout.channel.recv_exit_status()
                    
                    combined = f"Exit code: {exit_code}\\nSTDOUT:\\n{out}"
                    if err:
                        combined += f"\\nSTDERR:\\n{err}"
                    
                    self._step(steps, "command", f"SSH Custom: Command Completed", f"Completed `{cmd}` with exit code {exit_code}.", command=cmd, device_ip=host, command_output=combined)
                    results.append(f"Command: {cmd}\\n{combined}")
                except Exception as ex:
                    err_msg = f"Failed to execute `{cmd}`: {str(ex)}"
                    self._step(steps, "error", f"SSH Custom: Command Failed", err_msg)
                    results.append(f"Command: {cmd}\\nError: {err_msg}")
        finally:
            try:
                client.close()
            except Exception:
                pass

        return "\\n\\n".join(results)

    def _tool_write_notebook(self, key: str, content: str, steps: list) -> str:
        self._step(steps, "thinking", "Notebook: Writing Key", f"Saving logs/notes under key `{key}` in notepad.")
        self.notebook[key] = content
        
        # Build 1-line index summary
        lines = content.splitlines()
        line_count = len(lines)
        first_few = " ".join([l.strip() for l in lines[:3] if l.strip()])[:100]
        summary_str = f"{line_count} lines. Preview: {first_few}..."
        self.notebook_summary[key] = summary_str
        return f"Successfully saved key `{key}` in notepad. {summary_str}"

    def _tool_read_notebook_summary(self, steps: list) -> dict:
        self._step(steps, "thinking", "Notebook: Reading Index", "Viewing index of keys stored in the notepad.")
        if not self.notebook_summary:
            return {"message": "Notepad is currently empty."}
        return self.notebook_summary

    def _tool_read_notebook_key(self, key: str, start_line: Any = 1, end_line: Any = None, steps: list = None) -> str:
        self._step(steps, "thinking", "Notebook: Reading Section", f"Reading key `{key}` from line {start_line} to {end_line or 'end'}.")
        if key not in self.notebook:
            err = f"Key `{key}` not found in notepad."
            self._step(steps, "error", "Notebook: Key Not Found", err)
            return err
            
        content = self.notebook[key]
        lines = content.splitlines()
        
        try:
            start = max(1, int(start_line)) - 1
        except Exception:
            start = 0
            
        try:
            end = int(end_line) if end_line is not None else len(lines)
        except Exception:
            end = len(lines)
            
        sliced_lines = lines[start:end]
        result = "\n".join(sliced_lines)
        
        self._step(steps, "thinking", "Notebook: Completed Read", f"Read {len(sliced_lines)} line(s) from key `{key}`.")
        return f"=== NOTEBOOK KEY: {key} (lines {start+1} to {end}) ===\n{result}"



    # ── Phase 3: Reflection Loop ─────────────────────────────────────────────

    _REFLECT_SYSTEM = """\
You are deciding if the gathered facts are sufficient to answer the user query or if you need to execute more tools.

INVENTORY TOPO:
{topology_context}

CALLABLE TOOLS:
1. ssh_execute(device_name, ip, command)
   - Establish connection to an INVENTORY TOPO device using default/pre-configured simulator credentials and run a single CLI command.
   - ONLY use this for standard topology devices listed in INVENTORY TOPO.
   - Do NOT use this if the user provides explicit custom credentials, custom username, password, or custom port.
2. run_cypher(query)
3. parse_and_persist(device_name, command, raw_output)
4. read_neo4j_manual()
5. ssh_custom_execute(host, username, password, port, commands)
   - CRITICAL: You MUST use this tool whenever the user explicitly provides custom SSH credentials (such as username, password, custom port, etc.) or when connecting to a custom target host (e.g. 127.0.0.1 on port 2201).
   - This tool establishes a direct connection using Paramiko.
   - Pass multiple commands as a list of strings, e.g. ["showsys", "shownode", "showswitch"] or as a newline-separated string. Do NOT concatenate them with commas like "showsys,shownode,showswitch" in a single command.
6. write_notebook(key, content)
7. read_notebook_summary()
8. read_notebook_key(key, start_line, end_line)

FACTS AND OBSERVATIONS GATHERED SO FAR:
{observations}

CRITICAL REFLECTION RULES:
1. If you have already successfully run the commands requested by the user and have their outputs in the observations, you have all the facts. Set "done": true.
2. DO NOT repeat the same tool calls with the same arguments. If a tool call returned a result, repeating it is redundant.
3. If the user's question has been answered by the gathered observations, set "done": true immediately.

Return ONLY a JSON object:
{{
  "done": true | false,
  "reasoning": "Why we are done or why we need more tools...",
  "tool_calls": [ // Only if done is false
    {{
      "tool": "ssh_execute" | "run_cypher" | "parse_and_persist" | "read_neo4j_manual" | "ssh_custom_execute" | "write_notebook" | "read_notebook_summary" | "read_notebook_key",
      "args": {{ ... }}
    }}
  ]
}}

Output ONLY the JSON. No markdown.
"""

    def _llm_reflect(self, query: str, topology_context: str, observations: list, steps: list,
                      use_ollama=False, disable_think=False, ollama_model=None) -> Optional[dict]:
        if not self.llm_call:
            return None

        system_prompt = self._REFLECT_SYSTEM.format(
            topology_context=topology_context,
            observations=json.dumps(observations, indent=2, default=str)
        )
        user_msg = f"User query: {query}"

        try:
            raw = self._stream_llm_call(
                system_prompt, user_msg,
                use_ollama=use_ollama, disable_think=disable_think,
                json_mode=True, ollama_model=ollama_model
            )
            data = _extract_json(raw)
            if data:
                if data.get("done") is True:
                    self._step(steps, "thinking", "Reflection Complete", "LLM decided it has enough facts to generate report.")
                    return None
                else:
                    self._step(steps, "thinking", "Reflection Request", f"Need more data. Reasoning: {data.get('reasoning')}")
                    return data
        except Exception as e:
            sys.stderr.write(f"[SanAgent] Reflection failed: {e}\n")
        return None

    # ── Phase 4: Final Synthesis ─────────────────────────────────────────────

    _SYNTH_SYSTEM = """\
You are an expert HPE SAN storage systems engineer writing a diagnostic assessment.

CRITICAL RULES:
1. Write like a senior SAN engineer presenting to a customer. Professional, clear, precise.
2. NEVER mention JSON fields, tool_calls, database columns, parser internals, or raw dictionaries.
3. Base everything solely on the observations and facts gathered. No hallucinations.
4. Format all tabular output using standard GitHub Flavored Markdown pipe tables.
5. Provide a clear, actionable recommendation at the end."""

    def _llm_synthesize(self, query: str, observations: list, steps: list,
                        use_ollama=False, disable_think=False, stream=False, ollama_model=None) -> str:
        if not self.llm_call:
            return "Standard fallback report. Execution complete."

        user_msg = (
            f"OBSERVATIONS GATHERED:\n{json.dumps(observations, indent=2, default=str)}\n\n"
            f"USER QUESTION:\n{query}"
        )

        try:
            return self._stream_llm_call(
                self._SYNTH_SYSTEM, user_msg,
                use_ollama=use_ollama, disable_think=disable_think,
                ollama_model=ollama_model
            )
        except Exception as e:
            sys.stderr.write(f"[SanAgent] Synthesis failed: {e}\n")
            return "Synthesis failed. Please review execution steps."

    # ── Orchestrator ─────────────────────────────────────────────────────────

    def run(self, query: str, array_hint: Optional[str] = None,
            on_step: Optional[callable] = None,
            use_ollama=False, disable_think=False, ollama_model: Optional[str] = None,
            request_id: Optional[str] = None, stream=False) -> dict:
        self.on_step = on_step
        self.request_id = request_id
        self.notebook = {}
        self.notebook_summary = {}
        try:
            return self._run_agentic(query, array_hint,
                                     use_ollama=use_ollama,
                                     disable_think=disable_think,
                                     ollama_model=ollama_model,
                                     request_id=request_id,
                                     stream=stream)
        finally:
            self.on_step = None

    def _run_agentic(self, query: str, array_hint: Optional[str] = None,
                      use_ollama=False, disable_think=False, ollama_model: Optional[str] = None,
                      request_id: Optional[str] = None, stream=False) -> dict:
        steps: list[dict] = []
        observations = []
        t0 = time.time()

        # 1. Intent Gate
        intent_data = self._llm_classify_intent(query, use_ollama=use_ollama, disable_think=disable_think, ollama_model=ollama_model)
        if intent_data["intent"] in ("GREETING", "OUT_OF_SCOPE"):
            resp_text = intent_data["response"] or "I am focused on HPE SAN diagnostics and management."
            if stream:
                callback = getattr(self, "on_synthesis_chunk", None)
                if callback: callback(resp_text, False)
            self._step(steps, "final", "Polite response", resp_text)
            return {
                "answer": resp_text, "steps": steps, "cypher": None, "table": [],
                "graph": {"nodes": [], "edges": []}, "array": None,
                "neo4j_connected": bool(self.neo4j and self.neo4j.available),
                "elapsed_ms": int((time.time() - t0) * 1000),
            }

        # 2. Load topology context
        topology_context = self._load_topology_context()

        # 3. Plan Initial Tool Calls
        plan = self._llm_plan(query, topology_context, steps, use_ollama=use_ollama, disable_think=disable_think, ollama_model=ollama_model)
        tool_calls = plan.get("tool_calls") or []

        # 4. Loop: Execute and Reflect
        executed_calls = set()
        for reflection_round in range(MAX_REFLECT_ITERS + 1):
            if not tool_calls:
                break

            run_any = False
            for tc in tool_calls:
                tool_name = tc.get("tool")
                args = tc.get("args") or {}
                
                # Check signature to prevent infinite loops
                args_signature = str(sorted(args.items())) if isinstance(args, dict) else str(args)
                call_signature = (tool_name, args_signature)
                if call_signature in executed_calls:
                    continue
                executed_calls.add(call_signature)
                run_any = True
                
                if tool_name == "ssh_execute":
                    raw = self._tool_ssh_execute(args.get("device_name"), args.get("ip"), args.get("command"), steps)
                    observations.append({
                        "action": "ssh_execute",
                        "device_name": args.get("device_name"),
                        "command": args.get("command"),
                        "raw_output_length": len(raw or ""),
                        "raw_output": raw
                    })
                elif tool_name == "run_cypher":
                    rows = self._tool_run_cypher(args.get("query"), steps, use_ollama, disable_think, ollama_model)
                    observations.append({
                        "action": "run_cypher",
                        "query": args.get("query"),
                        "result_rows": rows
                    })
                elif tool_name == "parse_and_persist":
                    parsed = self._tool_parse_and_persist(args.get("device_name"), args.get("command"), args.get("raw_output"), steps)
                    observations.append({
                        "action": "parse_and_persist",
                        "device_name": args.get("device_name"),
                        "command": args.get("command"),
                        "parsed_output": parsed
                    })
                elif tool_name == "read_neo4j_manual":
                    manual = self._tool_read_neo4j_manual(steps)
                    observations.append({
                        "action": "read_neo4j_manual",
                        "manual": manual
                    })
                elif tool_name == "ssh_custom_execute":
                    raw = self._tool_ssh_custom_execute(
                        args.get("host"),
                        args.get("username"),
                        args.get("password"),
                        args.get("port"),
                        args.get("commands"),
                        steps
                    )
                    observations.append({
                        "action": "ssh_custom_execute",
                        "host": args.get("host"),
                        "username": args.get("username"),
                        "password": "***" if args.get("password") else None,
                        "port": args.get("port"),
                        "commands": args.get("commands"),
                        "raw_output": raw
                    })
                elif tool_name == "write_notebook":
                    res = self._tool_write_notebook(args.get("key"), args.get("content"), steps)
                    observations.append({
                        "action": "write_notebook",
                        "key": args.get("key"),
                        "result": res
                    })
                elif tool_name == "read_notebook_summary":
                    res = self._tool_read_notebook_summary(steps)
                    observations.append({
                        "action": "read_notebook_summary",
                        "result": res
                    })
                elif tool_name == "read_notebook_key":
                    res = self._tool_read_notebook_key(
                        args.get("key"),
                        args.get("start_line", 1),
                        args.get("end_line"),
                        steps
                    )
                    observations.append({
                        "action": "read_notebook_key",
                        "key": args.get("key"),
                        "result": res
                    })

            if not run_any:
                # Every planned tool call in this round was already executed previously. Break to synthesize.
                self._step(steps, "thinking", "Guard: Breaking Loop", "All planned actions have already been executed. Finishing.")
                break

            # Reflect
            reflection = self._llm_reflect(query, topology_context, observations, steps, use_ollama, disable_think, ollama_model)
            if not reflection or reflection.get("done") is True:
                break
            tool_calls = reflection.get("tool_calls") or []

        # 5. Synthesize Answer
        answer = self._llm_synthesize(query, observations, steps, use_ollama, disable_think, stream, ollama_model)
        self._step(steps, "final", "Final result", "Successfully completed diagnostics assessment.")

        # Build Cypher/Table fallbacks from observations
        cyphers = [obs["query"] for obs in observations if obs.get("action") == "run_cypher"]
        tables = [obs["result_rows"] for obs in observations if obs.get("action") == "run_cypher"]

        return {
            "answer": answer, "steps": steps, 
            "cypher": cyphers[0] if cyphers else None, 
            "table": tables[0] if tables else [],
            "graph": {"nodes": [], "edges": []},
            "neo4j_connected": bool(self.neo4j and self.neo4j.available),
            "elapsed_ms": int((time.time() - t0) * 1000),
        }
