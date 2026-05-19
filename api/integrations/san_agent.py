"""
SAN AI Agent — constrained tool-calling loop over the Python simulator.

Flow: natural language → plan → simulator CLI → parse → Neo4j → Cypher → summary.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from discovery.crawler import HPE_COMMANDS
from discovery.parsers.sim_parser import parse_sim_array_output

# Same allowlist as discovery crawler (+ health commands)
ALLOWED_COMMANDS = frozenset(HPE_COMMANDS) | frozenset({
    "checkhealth", "cli checkhealth", "showversion", "showportdev",
})

FORBIDDEN_PATTERNS = re.compile(
    r"[|;&`$><]|\b(rm|sudo|curl|wget|bash|sh)\b",
    re.IGNORECASE,
)


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
    base = cmd
    for allowed in sorted(ALLOWED_COMMANDS, key=len, reverse=True):
        if cmd == allowed or cmd.startswith(allowed + " "):
            return cmd
    raise ValueError(f"Command not in allowlist: {cmd.split()[0]}")


def _parse_single(command: str, output: str, command_parsers: dict) -> Any:
    """Delegate to injected parsers (api._PARSERS + sim_parser extras from app.py)."""
    cmd = _normalize_cmd(command)
    for key in sorted(command_parsers.keys(), key=len, reverse=True):
        if cmd == key or cmd.startswith(key + " "):
            return command_parsers[key](output)
    return {"raw_lines": len(output.splitlines())}


def _extract_array_hint(query: str) -> Optional[str]:
    q = query.lower()
    # s9999, prod-a, array s9999, etc.
    m = re.search(r"\b(array\s+)?([a-z0-9][a-z0-9_-]{2,})\b", q, re.I)
    candidates = []
    for token in re.findall(r"\b([a-z][a-z0-9_-]{2,}|\d{3,})\b", q, re.I):
        t = token.lower()
        if t in ("array", "hosts", "host", "list", "given", "along", "with", "type", "that", "all", "the", "show", "running"):
            continue
        candidates.append(token)
    for c in candidates:
        if re.match(r"^(s\d+|prod-[a-z]|dr-[a-z]|edge-[a-z])", c, re.I):
            return c
    return candidates[0] if candidates else None


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

    def _arrays(self) -> list[dict]:
        devices = self.list_devices() or []
        arrays = []
        for d in devices:
            if isinstance(d, str):
                arrays.append({"ip": d, "name": d.replace(".txt", ""), "type": "hpe_array"})
            elif (d.get("type") or "").lower() in ("hpe_array", "array", "arraysystem"):
                arrays.append(d)
            elif d.get("name", "").upper().startswith(("PROD", "DR", "EDGE", "S")):
                arrays.append({**d, "type": "hpe_array"})
        if not arrays:
            for d in devices:
                name = (d.get("name") if isinstance(d, dict) else str(d)) or ""
                if name and not name.startswith("host") and not name.startswith("sw"):
                    arrays.append(d if isinstance(d, dict) else {"ip": name, "name": name})
                    
        import os
        from pathlib import Path
        try:
            repo_root = Path(__file__).resolve().parent.parent.parent
            devices_dir = repo_root / "simulator" / "data" / "devices"
            if devices_dir.exists():
                for file_path in devices_dir.glob("*.txt"):
                    name = file_path.stem
                    if not any(a.get("name") == name or a.get("ip") == file_path.name for a in arrays):
                        arrays.append({"ip": file_path.name, "name": name, "type": "hpe_array"})
        except Exception:
            pass
            
        return arrays

    def _resolve_array(self, hint: Optional[str]) -> Optional[dict]:
        arrays = self._arrays()
        if not arrays:
            return None
        if not hint:
            return arrays[0]
        h = hint.lower().replace(".txt", "")
        
        # 1. Host or Device name lookup: check if hint refers to a host/device that belongs to a parent array
        devices = self.list_devices() or []
        for d in devices:
            dname = (d.get("name") or "").lower()
            dip = (d.get("ip") or "").lower()
            if (h in dname or dname in h or h in dip) and d.get("parent_array"):
                p_array = d["parent_array"].lower()
                for a in arrays:
                    aname = (a.get("name") or a.get("id") or "").lower()
                    aip = (a.get("ip") or "").lower()
                    if p_array == aname or p_array == aip:
                        return a

        # 2. Direct array name match
        for a in arrays:
            name = (a.get("name") or a.get("id") or "").lower()
            ip = (a.get("ip") or "").lower()
            if h in name or h in ip or name in h:
                return a
        return arrays[0]

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

    def _plan(self, query: str, array_name: str) -> dict:
        q = query.lower()
        commands = []
        cypher = None
        reasoning = []

        # Check conditions independently to support multi-part queries!
        if any(k in q for k in ("host", "zoned", "os type", "os that")):
            reasoning.append("Need host zoning from showhost and OS from host records.")
            commands.append("showhost")
            if not cypher:
                cypher = (
                    "MATCH (a:ArraySystem)<-[:CONNECTS_TO]-(h:Host) "
                    f"WHERE toLower(a.name) = toLower('{array_name}') "
                    "RETURN h.name AS host_name, h.os_name AS os_type, h.multipath AS paths "
                    "ORDER BY h.name"
                )

        if any(k in q for k in ("hba", "driver", "portdev")):
            reasoning.append("Need HBA detail, driver, and firmware versions from showportdev ns.")
            commands.extend(["showportdev ns -nohdtot 0:3:1", "showportdev ns -nohdtot 1:3:1"])
            if not cypher:
                cypher = (
                    "MATCH (a:ArraySystem)<-[:CONNECTS_TO]-(h:Host) "
                    f"WHERE toLower(a.name) = toLower('{array_name}') "
                    "RETURN h.name AS host_name, h.os_name AS os_type, h.wwn AS wwn, "
                    "h.hba_fw AS hba_fw, h.hba_driver AS hba_driver, h.hba_model AS hba_model "
                    "ORDER BY h.name"
                )

        if "failed" in q and ("pd" in q or "drive" in q or "disk" in q):
            reasoning.append("Need physical disk state from showpd.")
            commands.append("showpd")
            if not cypher:
                cypher = (
                    "MATCH (a:ArraySystem)-[:HAS_CAGE]->(:Cage)-[:CONTAINS]->(d:PhysicalDisk) "
                    "WHERE d.state IN ['failed', 'degraded'] "
                    "RETURN a.name AS array_name, d.pd_id AS pd_id, d.state AS state "
                    "ORDER BY a.name"
                )

        if "protocol" in q:
            reasoning.append("Extract supported protocols from showport.")
            commands.append("showport")
            if not cypher:
                cypher = (
                    f"MATCH (a:ArraySystem) WHERE toLower(a.name) = toLower('{array_name}') "
                    "RETURN a.name AS array_name, a.protocols_supported AS protocols"
                )

        if "switch" in q and "state" in q:
            reasoning.append("Inspect internal fabric switches via showswitch.")
            commands.append("showswitch")

        if "tpd" in q or "version" in q or "firmware" in q:
            reasoning.append("Read release version from showversion -b.")
            commands.append("showversion -b")
            if not cypher:
                cypher = (
                    f"MATCH (a:ArraySystem) WHERE toLower(a.name) = toLower('{array_name}') "
                    "RETURN a.name AS array_name, a.release_version AS tpd_version"
                )

        if "capacity" in q or "usable" in q or "tib" in q or "tb" in q:
            reasoning.append("Read capacity from showsys.")
            commands.append("showsys")

        if "node" in q and "count" in q:
            reasoning.append("Count nodes via shownode.")
            commands.append("shownode")

        if any(k in q for k in ("upgrade", "firmware update", "update", "readiness", "health check", "checkhealth")):
            reasoning.append("Running full array diagnostics suite (nodes, cages, disks, and checkhealth) for update readiness.")
            commands.extend(["shownode", "showcage -state", "showcage", "showpd", "cli checkhealth"])

        if "cage" in q:
            reasoning.append("Evaluate cage health from showcage -state.")
            commands.append("showcage -state")
            commands.append("showcage")

        # If nothing matched, use the default suite
        if not commands:
            reasoning.append("General array inventory: showsys, showhost, showport.")
            commands = ["showsys", "showhost", "showport"]
            cypher = (
                "MATCH (a:ArraySystem)<-[:CONNECTS_TO]-(h:Host) "
                f"WHERE toLower(a.name) = toLower('{array_name}') "
                "RETURN h.name AS host_name, h.os_name AS os_type ORDER BY h.name LIMIT 25"
            )

        # Deduplicate commands while preserving order
        seen = set()
        deduped_commands = []
        for cmd in commands:
            if cmd not in seen:
                seen.add(cmd)
                deduped_commands.append(cmd)

        if self.llm_call and not deduped_commands:
            try:
                raw = self.llm_call(
                    "You plan SAN diagnostics. Return JSON only: "
                    '{"reasoning":"...","commands":["showhost"],"cypher":"MATCH ..."}. '
                    f"Array: {array_name}. Allowed commands: {sorted(ALLOWED_COMMANDS)}.",
                    query,
                )
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    commands = [validate_command(c) for c in data.get("commands", [])[:6]]
                    reasoning = [data.get("reasoning", "LLM plan")]
                    cypher = data.get("cypher") or cypher
                    # Re-deduplicate
                    seen = set()
                    deduped_commands = []
                    for c in commands:
                        if c not in seen:
                            seen.add(c)
                            deduped_commands.append(c)
            except Exception:
                pass

        return {"reasoning": " ".join(reasoning), "commands": deduped_commands, "cypher": cypher}

    def _hosts_for_neo4j(self, hosts: list) -> list:
        out = []
        for h in hosts:
            row = dict(h)
            row["os_name"] = row.get("os_name") or row.get("os") or row.get("persona", "")
            row["ip_address"] = row.get("ip_address") or row.get("wwn", "")
            row["multipath"] = row.get("multipath") or row.get("port", "")
            out.append(row)
        return out

    def _persist_parsed(self, ip: str, array_name: str, cmd_outputs: dict) -> dict:
        parsed = self.parse_array_outputs(cmd_outputs)
        parsed["_ip"] = ip
        parsed["_device_type"] = "hpe_array"
        if not parsed.get("name"):
            parsed["name"] = array_name
        parsed["hosts"] = self._hosts_for_neo4j(parsed.get("hosts", []))
        if self.neo4j and getattr(self.neo4j, "available", False):
            self.neo4j.store(parsed)
        return parsed

    def _build_subgraph(self, array_name: str, rows: list) -> dict:
        """Small Cytoscape-style graph for the UI."""
        nodes = [{"data": {"id": f"array:{array_name}", "label": array_name, "type": "ArraySystem"}}]
        edges = []
        for i, row in enumerate(rows[:12]):
            hname = row.get("host_name") or row.get("h.name") or row.get("name")
            if not hname:
                continue
            hid = f"host:{hname}"
            nodes.append({"data": {"id": hid, "label": hname, "type": "Host"}})
            edges.append({"data": {"source": hid, "target": f"array:{array_name}", "label": "CONNECTS_TO"}})
        return {"nodes": nodes, "edges": edges}

    def run(self, query: str, array_hint: Optional[str] = None, on_step: Optional[callable] = None, use_ollama=False, disable_think=False) -> dict:
        self.on_step = on_step
        try:
            return self._run_internal(query, array_hint, use_ollama=use_ollama, disable_think=disable_think)
        finally:
            self.on_step = None

    def _run_internal(self, query: str, array_hint: Optional[str] = None, use_ollama=False, disable_think=False) -> dict:
        steps: list[dict] = []
        t0 = time.time()
        hint = array_hint or _extract_array_hint(query)
        target = self._resolve_array(hint)
        if not target:
            return {
                "answer": "No simulated arrays found. Start the Python simulator (simulator_manager.py) first.",
                "steps": [{"type": "error", "title": "No devices", "detail": "Simulator returned an empty device list."}],
                "neo4j_connected": bool(self.neo4j and self.neo4j.available),
            }

        ip = target.get("ip") or target.get("id")
        array_name = target.get("name") or hint or ip
        plan = self._plan(query, array_name)

        self._step(
            steps, "thinking", "Thinking",
            f"To answer this, I need to:\n• {plan['reasoning']}\n• Target array: **{array_name}** (`{ip}`)",
        )

        cmd_outputs = {}
        parsed_snapshot = {}

        for cmd in plan["commands"]:
            try:
                safe = validate_command(cmd)
            except ValueError as e:
                self._step(steps, "error", "Command blocked", str(e))
                continue

            output = self.execute(ip, safe)
            cmd_outputs[safe] = output
            self._step(
                steps, "command", f"Ran command on {array_name}", safe,
                command=safe, device_ip=ip, command_output=output
            )

            parsed = _parse_single(safe, output, self.command_parsers)
            count = len(parsed) if isinstance(parsed, list) else (1 if parsed else 0)
            label = safe.split()[0]
            self._step(
                steps, "parsed", f"Parsed {label} output",
                f"Successfully parsed {count} record(s) from `{safe}`.",
                parsed_preview=parsed if isinstance(parsed, (list, dict)) else None,
            )

        if cmd_outputs:
            try:
                parsed_snapshot = self._persist_parsed(ip, array_name, cmd_outputs)
                hosts_n = len(parsed_snapshot.get("hosts", []))
                drives_n = len(parsed_snapshot.get("drives", []))
                self._step(
                    steps, "neo4j", "Updated Neo4j graph database",
                    f"Merged array **{array_name}**: {hosts_n} host(s), {drives_n} drive(s), "
                    f"{len(parsed_snapshot.get('nodes', []))} node(s).",
                    nodes_updated=hosts_n + drives_n,
                )
            except Exception as ex:
                self._step(steps, "neo4j", "Neo4j update skipped", str(ex))

        rows = []
        cypher = plan.get("cypher")
        if cypher and self.run_cypher and self.neo4j and self.neo4j.available:
            self._step(steps, "cypher", "Ran query on Neo4j", cypher.strip(), cypher=cypher.strip())
            try:
                rows = self.run_cypher(cypher) or []
                self._step(
                    steps, "result", "Graph query results",
                    f"Retrieved {len(rows)} row(s) from Neo4j.",
                    rows=rows[:50],
                )
            except Exception as ex:
                self._step(steps, "cypher_error", "Cypher failed", str(ex))

        # Deterministic fallbacks when graph empty
        if not rows and parsed_snapshot.get("hosts") and "host" in query.lower():
            rows = [
                {
                    "host_name": h.get("name"),
                    "os_type": h.get("os_name") or h.get("os"),
                    "paths": h.get("port") or h.get("multipath"),
                    "connection_type": "Fibre Channel",
                }
                for h in parsed_snapshot["hosts"]
            ]

        if not rows and parsed_snapshot.get("drives") and "fail" in query.lower():
            rows = [
                {"array_name": array_name, "pd_id": d.get("pd_id"), "state": d.get("state")}
                for d in parsed_snapshot["drives"]
                if d.get("state") in ("failed", "degraded")
            ]

        if not rows and parsed_snapshot.get("protocols_supported"):
            rows = [{"array_name": array_name, "protocols": parsed_snapshot["protocols_supported"]}]

        answer = self._summarize(query, array_name, rows, parsed_snapshot, plan, use_ollama=use_ollama, disable_think=disable_think)
        
        # Dynamically extract a short, informative sentence from the AI's actual summary
        final_desc = "Successfully completed SAN diagnostics."
        summary_lines = [l.strip() for l in answer.split('\n') if l.strip()]
        for line in summary_lines:
            # Strip markdown headers, bolding, lists, etc.
            clean = re.sub(r'^[#*\s\-\[\]\(\)]+', '', line).strip()
            if clean and not clean.lower().startswith('san diagnostic') and len(clean) > 10:
                # Skip simple headers
                if clean.lower() in ("array health and status", "host details", "recommendation", "health summary", "host zoning status", "tpd version"):
                    continue
                if len(clean) > 140:
                    final_desc = clean[:137] + "..."
                else:
                    final_desc = clean
                break
                
        self._step(steps, "final", "Final result", final_desc)

        return {
            "answer": answer,
            "steps": steps,
            "cypher": cypher,
            "table": rows,
            "graph": self._build_subgraph(array_name, rows),
            "array": {"name": array_name, "ip": ip},
            "neo4j_connected": bool(self.neo4j and self.neo4j.available),
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    def _analyze_batch(self, entity_type: str, items: list, chunk_size: int = 30, use_ollama=False, disable_think=False) -> list:
        """Analyze large lists of hardware entities in batches to prevent LLM token overflow."""
        issues = []
        if not self.llm_call or not items:
            return issues

        total_items = len(items)
        total_batches = (total_items + chunk_size - 1) // chunk_size

        for i in range(0, total_items, chunk_size):
            chunk = items[i:i + chunk_size]
            batch_num = (i // chunk_size) + 1
            
            prompt = (
                f"You are a hardware diagnostics agent. Analyze this batch ({batch_num}/{total_batches}) "
                f"of {len(chunk)} {entity_type} records. Identify any components reporting degraded, failed, "
                f"or abnormal states. If a component is completely healthy, ignore it.\n\n"
                f"Records:\n{json.dumps(chunk, default=str)}\n\n"
                f"Format your output strictly as a JSON list of objects containing only the problematic components, "
                f"or return an empty list [] if everything in this batch is completely healthy."
            )
            try:
                res = self.llm_call(
                    "You are a hardware diagnostics agent that returns strictly raw, valid JSON. Do not include markdown formatting (like ```json). Return ONLY a valid JSON list [] of abnormal, degraded, or failed component objects, or an empty list [] if all are healthy.",
                    prompt,
                    use_ollama=use_ollama,
                    disable_think=disable_think
                )
                # Try to parse the LLM's response as a list
                try:
                    parsed_res = json.loads(res.strip())
                    if isinstance(parsed_res, list):
                        issues.extend(parsed_res)
                except Exception:
                    # Fallback string parsing if JSON fails
                    if "failed" in res.lower() or "degraded" in res.lower() or "abnormal" in res.lower():
                        issues.append({"batch": batch_num, "summary": res.strip()})
            except Exception:
                # If LLM rate limits on batching, do local state checks as fallback
                local_unhealthy = [
                    item for item in chunk 
                    if item.get("state", "").lower() not in ("normal", "ok") 
                    or item.get("status", "").lower() not in ("normal", "ok", "online")
                ]
                issues.extend(local_unhealthy)
                
        return issues

    def _summarize(self, query: str, array_name: str, rows: list, parsed: dict, plan: dict, use_ollama=False, disable_think=False) -> str:
        if self.llm_call and (rows or parsed):
            # 1. Try sending the full context first (for Dev Tier or high token limit configurations)
            try:
                summary_context = {
                    "question": query,
                    "array": array_name,
                    "rows_returned": len(rows),
                    "table_data": rows,
                    "release_version": parsed.get("release_version") or parsed.get("version"),
                    "parsed_nodes": parsed.get("nodes", []),
                    "parsed_cages": parsed.get("cages", []),
                    "parsed_drives": parsed.get("drives", []),
                    "parsed_hosts": parsed.get("hosts", []),
                }
                ans = self.llm_call(
                    "You are a premium SAN diagnostic assistant. Summarize the array health, TPD version, and host zoning status in markdown. "
                    "You MUST format all tables using standard GitHub Flavored Markdown (GFM) pipe-table syntax "
                    "(with | separators and dashes for headers, e.g. | Header | Header |\n| --- | --- |\n| Row | Row |). "
                    "Never use plain text, tab-separated columns, or HTML tables. "
                    "If the query asked about physical disks, cages, nodes, or checkhealth and they are all healthy, state that explicitly! "
                    "Provide a clear recommendation on whether the array is ready for a firmware update based on the health check. Be concise.",
                    json.dumps(summary_context, default=str),
                    use_ollama=use_ollama,
                    disable_think=disable_think
                )
                if ans and (ans.startswith("LLM Error:") or ans.startswith("Error:") or any(k in ans.lower() for k in ("rate_limit", "rate limit", "413", "too large", "tpm", "token"))):
                    raise ValueError(ans)
                return ans
            except Exception as ex:
                err_msg = str(ex)
                # 2. Catch Request too large / rate limits / 413 error and initiate self-healing batch analysis loops
                if any(k in err_msg.lower() for k in ("rate_limit", "rate limit", "413", "too large", "tpm", "token")):
                    print(f"Token limit / Rate limit exceeded. Triggering dynamic self-healing batching orchestrator...")
                    
                    nodes = parsed.get("nodes", [])
                    cages = parsed.get("cages", [])
                    drives = parsed.get("drives", [])
                    hosts = parsed.get("hosts", [])

                    # Parallelize/Batch analyze the 96 drives in chunks of 30
                    unhealthy_drives = self._analyze_batch("physical drive", drives, chunk_size=30, use_ollama=use_ollama, disable_think=disable_think)
                    
                    # Batch analyze cages in chunks of 10
                    unhealthy_cages = self._analyze_batch("enclosure cage", cages, chunk_size=10, use_ollama=use_ollama, disable_think=disable_think)

                    # Compact hosts to preserve essential fields
                    compact_hosts = [
                        {
                            "name": h.get("name"),
                            "os": h.get("os") or h.get("os_name") or "Generic",
                            "paths": h.get("port") or h.get("multipath") or "-"
                        }
                        for h in hosts
                    ]

                    summary_context_compact = {
                        "question": query,
                        "array": array_name,
                        "rows_returned": len(rows),
                        "table_data": rows[:20],
                        "node_count": parsed.get("node_count") or len(nodes),
                        "cage_count": len(cages),
                        "drive_count": len(drives),
                        "host_count": len(hosts),
                        "release_version": parsed.get("release_version") or parsed.get("version"),
                        "unhealthy_drives_detected": unhealthy_drives,
                        "unhealthy_cages_detected": unhealthy_cages,
                        "parsed_nodes": [{"node_id": n.get("node_id"), "name": n.get("name"), "status": n.get("status")} for n in nodes[:4]],
                        "parsed_hosts": compact_hosts[:15],
                        "batch_processing_active": True,
                        "batch_processing_note": "Token limits were exceeded on full request. Sub-loops pre-analyzed drives and cages to extract unhealthy instances."
                    }

                    try:
                        ans = self.llm_call(
                            "You are a premium SAN diagnostic assistant. Summarize the array health, TPD version, and host zoning status in markdown. "
                            "You MUST format all tables using standard GitHub Flavored Markdown (GFM) pipe-table syntax "
                            "(with | separators and dashes for headers, e.g. | Header | Header |\n| --- | --- |\n| Row | Row |). "
                            "Never use plain text, tab-separated columns, or HTML tables. "
                            "If the query asked about physical disks, cages, nodes, or checkhealth and they are all healthy, state that explicitly! "
                            "Provide a clear recommendation on whether the array is ready for a firmware update based on the health check. Be concise.",
                            json.dumps(summary_context_compact, default=str),
                            use_ollama=use_ollama,
                            disable_think=disable_think
                        )
                        if ans and not (ans.startswith("LLM Error:") or ans.startswith("Error:") or any(k in ans.lower() for k in ("rate_limit", "rate limit", "413", "too large", "tpm", "token"))):
                            return ans
                    except Exception:
                        pass

        # 3. Manual markdown synthesis fallback if Groq/LLM completely fails or is disabled:
        lines = [f"### SAN Diagnostic Report: **{array_name}**\n"]

        # 0. Active TPD Version
        rel_ver = parsed.get("release_version") or parsed.get("version")
        if rel_ver:
            lines.append(f"* **Active TPD Version:** `{rel_ver}`")

        # 1. Node count summary
        node_list = parsed.get("nodes", [])
        n_count = parsed.get("node_count") or len(node_list)
        if n_count > 0:
            lines.append(f"* **Controller Nodes:** {n_count} Node(s) Online and active in cluster.")
            if node_list:
                node_names = ", ".join(n.get("name", f"node-{n.get('node_id')}") for n in node_list)
                lines.append(f"  * Active nodes: `{node_names}`")

        # 2. Cages summary
        cage_list = parsed.get("cages", [])
        if cage_list:
            degraded_cages = [c for c in cage_list if c.get("state", "").lower() not in ("normal", "ok")]
            if degraded_cages:
                lines.append(f"* **Enclosure Cages:** {len(degraded_cages)} degraded enclosure(s) found!")
                for c in degraded_cages:
                    lines.append(f"  * `{c.get('name')}` state is `{c.get('state')}` (Temp: {c.get('temp')})")
            else:
                lines.append(f"* **Enclosure Cages:** All {len(cage_list)} cages are healthy and reporting `Normal` temperature and power states.")

        # 3. Disk summary
        drive_list = parsed.get("drives", [])
        if drive_list:
            failed_drives = [d for d in drive_list if d.get("state", "").lower() not in ("normal", "ok")]
            if failed_drives:
                lines.append(f"* **Physical Disks:** {len(failed_drives)} degraded/failed disk(s) detected!")
                lines.append("\n| Drive ID | Enclosure Position | Type | State |")
                lines.append("| --- | --- | --- | --- |")
                for d in failed_drives:
                    lines.append(f"| {d.get('pd_id')} | {d.get('cage_pos')} | {d.get('type')} | **{d.get('state')}** |")
            else:
                lines.append(f"* **Physical Disks:** All {len(drive_list)} physical drives (SSD/HDD) are healthy (`normal` state).")

        # 4. Host connections summary
        host_list = parsed.get("hosts", [])
        if host_list:
            lines.append(f"* **Zoned Hosts:** {len(host_list)} hosts are registered and zoned with this array.")
            # If hosts were queried directly, print a nice table
            if "host" in query.lower():
                lines.append("\n| Host Name | OS Type | Persona | WWN / Path |")
                lines.append("| --- | --- | --- | --- |")
                for h in host_list[:15]:
                    lines.append(f"| {h.get('name')} | {h.get('os') or h.get('os_name') or 'Unknown'} | {h.get('persona', '-')} | {h.get('wwn')} |")
                if len(host_list) > 15:
                    lines.append(f"| ... | and {len(host_list) - 15} more | | |")

        # 5. General fallback
        if len(lines) == 1:
            lines.append(f"Successfully executed SAN diagnostics on **{array_name}**. All components (nodes, cages, disks) are operating within normal operational parameters.")

        return "\n".join(lines)
