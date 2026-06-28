"""
SAN AI Agent — Autonomous ReAct-style agentic loop over the HPE simulator.

Architecture:
  1. LLM #1 (Planner)   — Given user query, decide which CLI tools to call.
  2. Execute tools       — Run validated simulator/SSH commands, parse outputs.
  3. LLM #2..N (Reflect) — After each observation, ask: "Done or need more?"
                           Max MAX_REFLECT_ITERS reflection rounds.
  4. LLM #final (Synth)  — Stream the expert markdown report to the user.

All four phases stream step events to the UI in real time.
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

# How many "reflect → run more commands" rounds before forcing synthesis
MAX_REFLECT_ITERS = 3

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


def _extract_array_hint(query: str) -> Optional[str]:
    q = query.lower()
    candidates = []
    for token in re.findall(r"\b([a-z][a-z0-9_-]{2,}|\d{3,})\b", q, re.I):
        t = token.lower()
        if t in ("array", "hosts", "host", "list", "given", "along", "with",
                 "type", "that", "all", "the", "show", "running"):
            continue
        candidates.append(token)
    for c in candidates:
        if re.match(r"^(s\d+|prod-[a-z]|dr-[a-z]|edge-[a-z])", c, re.I):
            return c
    return candidates[0] if candidates else None


def _strip_think(text: str) -> str:
    """Remove <think>...</think> blocks from LLM output."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _extract_json(text: str) -> Optional[dict]:
    """Pull the first {...} JSON object out of an LLM response."""
    text = _strip_think(text)
    # Try direct parse first
    try:
        return json.loads(text)
    except Exception:
        pass
    # Strip code fences
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

    # ── Device resolution ────────────────────────────────────────────────────

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

        # Fallback: scan simulator data directory
        from pathlib import Path
        try:
            repo_root = Path(__file__).resolve().parent.parent.parent
            devices_dir = repo_root / "simulator" / "data" / "devices"
            if devices_dir.exists():
                for fp in devices_dir.glob("*.txt"):
                    name = fp.stem
                    if not any(a.get("name") == name or a.get("ip") == fp.name for a in arrays):
                        arrays.append({"ip": fp.name, "name": name, "type": "hpe_array"})
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
        for a in arrays:
            name = (a.get("name") or a.get("id") or "").lower()
            ip = (a.get("ip") or "").lower()
            if h in name or h in ip or name in h:
                return a
        return arrays[0]

    def _stream_llm_call(self, system: str, user: str, use_ollama=False, disable_think=False, json_mode=False) -> str:
        if not self.llm_call:
            return ""
        ans = self.llm_call(
            system, user,
            use_ollama=use_ollama, disable_think=disable_think, stream=True,
            json_mode=json_mode
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

    # ── Phase 1: LLM Planner ─────────────────────────────────────────────────

    _PLANNER_SYSTEM = """\
You are a SAN Diagnostics Planner for HPE 3PAR/Primera/Alletra storage arrays.
Decide which CLI commands to execute to answer the user's question.

Allowed CLI commands (use ONLY these):
  showsys, showhost, showport, showpd, showcage, showcage -state,
  showversion -b, shownode, showswitch, cli checkhealth

Neo4j Schema (for cypher field):
  Nodes: ArraySystem(ip_address, name, model, serial, release_version),
         Node, Switch, Host, Cage, PhysicalDisk
  Relationships: (Host)-[:CONNECTS_TO]->(ArraySystem),
                 (ArraySystem)-[:HAS_NODE|HAS_CAGE|HAS_SWITCH]->(Node|Cage|Switch),
                 (Cage)-[:CONTAINS]->(PhysicalDisk)

Return ONLY a valid JSON object with these keys:
  "reasoning"  — one sentence explaining your plan
  "commands"   — list of CLI command strings (1-6 commands, no duplicates)
  "cypher"     — optional Neo4j Cypher query string, or null

Output ONLY the JSON. No markdown, no explanation outside the JSON."""

    def _llm_plan(self, query: str, array_name: str, steps: list,
                  use_ollama=False, disable_think=False) -> dict:
        """LLM Call #1: Ask the model what tools to use."""

        # Rule-based fallback plan (used if LLM unavailable or fails)
        fallback = self._rule_plan(query, array_name)

        if not self.llm_call:
            return fallback

        user_msg = (
            f"User query: {query}\n"
            f"Target array: {array_name}\n"
            f"Available arrays: {', '.join(a.get('name','?') for a in self._arrays()[:5])}"
        )

        self._step(steps, "thinking", "Planning",
                   f"Asking LLM to plan diagnostic steps for: *{query}*")
        try:
            raw = self._stream_llm_call(
                self._PLANNER_SYSTEM, user_msg,
                use_ollama=use_ollama, disable_think=disable_think,
                json_mode=True
            )
            data = _extract_json(raw)
            if data:
                cmds_raw = data.get("commands") or []
                validated = []
                seen = set()
                for c in cmds_raw[:6]:
                    try:
                        v = validate_command(str(c))
                        if v not in seen:
                            seen.add(v)
                            validated.append(v)
                    except ValueError:
                        pass
                if validated:
                    plan = {
                        "reasoning": str(data.get("reasoning", "LLM diagnostic plan")),
                        "commands": validated,
                        "cypher": data.get("cypher") or fallback.get("cypher"),
                    }
                    self._step(steps, "thinking", "Planning",
                               f"Plan: {plan['reasoning']}\n"
                               f"Commands: {', '.join('`' + c + '`' for c in validated)}")
                    return plan
        except Exception as e:
            sys.stderr.write(f"[SanAgent] LLM plan failed: {e}\n")

        # Use fallback and emit it as a step
        self._step(steps, "thinking", "Planning",
                   f"Using rule-based plan: {fallback['reasoning']}\n"
                   f"Commands: {', '.join('`' + c + '`' for c in fallback['commands'])}")
        return fallback

    def _rule_plan(self, query: str, array_name: str) -> dict:
        """Keyword-based fallback planner (no LLM required)."""
        q = query.lower()
        commands, reasoning = [], []
        cypher = None

        if any(k in q for k in ("host", "zoned", "os type")):
            reasoning.append("Need host zoning from showhost.")
            commands.append("showhost")
            cypher = (
                "MATCH (a:ArraySystem)<-[:CONNECTS_TO]-(h:Host) "
                f"WHERE toLower(a.name) = toLower('{array_name}') "
                "RETURN h.name AS host_name, h.os_name AS os_type ORDER BY h.name"
            )
        if any(k in q for k in ("hba", "driver", "portdev")):
            reasoning.append("Need HBA detail from showportdev.")
            commands.extend(["showportdev ns -nohdtot 0:3:1", "showportdev ns -nohdtot 1:3:1"])
        if "failed" in q and any(k in q for k in ("pd", "drive", "disk")):
            reasoning.append("Need physical disk state from showpd.")
            commands.append("showpd")
        if "protocol" in q:
            commands.append("showport")
        if "switch" in q:
            commands.append("showswitch")
        if any(k in q for k in ("tpd", "version", "firmware")):
            reasoning.append("Need firmware version from showversion -b.")
            commands.append("showversion -b")
        if any(k in q for k in ("capacity", "usable", "tib", "tb")):
            commands.append("showsys")
        if "node" in q:
            commands.append("shownode")
        if any(k in q for k in ("upgrade", "firmware update", "readiness", "health check", "checkhealth")):
            reasoning.append("Running full diagnostic suite.")
            commands.extend(["shownode", "showcage -state", "showcage", "showpd", "cli checkhealth"])
        if "cage" in q:
            commands.extend(["showcage -state", "showcage"])

        if not commands:
            reasoning.append("General array inventory: showsys, showhost, showport.")
            commands = ["showsys", "showhost", "showport"]
            cypher = (
                "MATCH (a:ArraySystem)<-[:CONNECTS_TO]-(h:Host) "
                f"WHERE toLower(a.name) = toLower('{array_name}') "
                "RETURN h.name AS host_name, h.os_name AS os_type ORDER BY h.name LIMIT 25"
            )

        seen, deduped = set(), []
        for c in commands:
            if c not in seen:
                seen.add(c)
                deduped.append(c)

        return {
            "reasoning": " ".join(reasoning) or "General array diagnostics.",
            "commands": deduped,
            "cypher": cypher,
        }

    # ── Phase 2: Execute tools ────────────────────────────────────────────────

    def _execute_command(self, ip: str, array_name: str, cmd: str,
                         steps: list, cmd_outputs: dict) -> Any:
        """Run one validated CLI command, parse it, emit steps."""
        try:
            safe = validate_command(cmd)
        except ValueError as e:
            self._step(steps, "error", "Command blocked", str(e))
            return None

        output = self.execute(ip, safe)
        cmd_outputs[safe] = output
        self._step(steps, "command", f"Ran command on {array_name}", safe,
                   command=safe, device_ip=ip, command_output=output)

        parsed = _parse_single(safe, output, self.command_parsers)
        count = len(parsed) if isinstance(parsed, list) else (1 if parsed else 0)
        label = safe.split()[0]
        self._step(steps, "parsed", f"Parsed {label} output",
                   f"Successfully parsed {count} record(s) from `{safe}`.",
                   parsed_preview=parsed if isinstance(parsed, (list, dict)) else None)
        return parsed

    # ── Phase 3: LLM Reflection ───────────────────────────────────────────────

    _REFLECT_SYSTEM = """\
You are a SAN diagnostics agent deciding whether you have enough information to answer the user.

You have already run some CLI commands and received their outputs (summarised as SAN facts).
Decide: are you done, or do you need one more specific command to fully answer the query?

Allowed CLI commands (use ONLY these, if needed):
  showsys, showhost, showport, showpd, showcage, showcage -state,
  showversion -b, shownode, showswitch, cli checkhealth

Return ONLY a valid JSON object:
  {"done": true}                                   — if you have enough data
  {"done": false, "command": "showpd"}             — if you need one more command

Output ONLY the JSON. No markdown, no explanation outside the JSON."""

    def _llm_reflect(self, query: str, array_name: str, san_facts: dict,
                     already_run: list[str], steps: list,
                     use_ollama=False, disable_think=False) -> Optional[str]:
        """LLM Call #N: Reflection. Returns a new command string or None if done."""
        if not self.llm_call:
            return None

        user_msg = (
            f"User query: {query}\n"
            f"Array: {array_name}\n"
            f"Commands already run: {', '.join(already_run)}\n\n"
            f"Current SAN facts gathered:\n{json.dumps(san_facts, indent=2, default=str)}"
        )

        try:
            raw = self._stream_llm_call(
                self._REFLECT_SYSTEM, user_msg,
                use_ollama=use_ollama, disable_think=disable_think,
                json_mode=True
            )
            data = _extract_json(raw)
            if data:
                if data.get("done") is True:
                    return None  # Agent is satisfied
                cmd = data.get("command") or data.get("action")
                if cmd:
                    try:
                        return validate_command(str(cmd))
                    except ValueError:
                        pass
        except Exception as e:
            sys.stderr.write(f"[SanAgent] LLM reflect failed: {e}\n")
        return None

    # ── Normalise parsed output into clean SAN facts ──────────────────────────

    def _build_san_facts(self, array_name: str, parsed_snapshot: dict) -> dict:
        hosts_list = parsed_snapshot.get("hosts", [])
        drives_list = parsed_snapshot.get("drives", [])
        nodes_list = parsed_snapshot.get("nodes", [])
        cages_list = parsed_snapshot.get("cages", [])

        unhealthy_drives = [d for d in drives_list if d.get("state", "").lower() not in ("normal", "ok")]
        unhealthy_cages = [c for c in cages_list if c.get("state", "").lower() not in ("normal", "ok")]
        unhealthy_nodes = [n for n in nodes_list if n.get("state", "").lower() not in ("normal", "ok", "online")]

        health = "Degraded" if (unhealthy_drives or unhealthy_cages or unhealthy_nodes) else "Healthy"

        return {
            "array_name": array_name,
            "overall_health_status": health,
            "tpd_firmware_version": (
                parsed_snapshot.get("release_version")
                or parsed_snapshot.get("version")
                or "Not Available"
            ),
            "total_host_connections": len(hosts_list),
            "host_list": [
                {"name": h.get("name"), "os": h.get("os_name") or h.get("os", "Unknown"),
                 "wwn": h.get("wwn", "-"), "paths": h.get("port") or h.get("multipath", "-")}
                for h in hosts_list[:20]
            ],
            "total_drive_count": len(drives_list),
            "total_cage_count": len(cages_list),
            "total_node_count": len(nodes_list),
            "node_list": [
                {"id": n.get("node_id"), "name": n.get("name"), "status": n.get("status", "unknown")}
                for n in nodes_list[:8]
            ],
            "degraded_drives": [{"id": d.get("pd_id"), "state": d.get("state")} for d in unhealthy_drives],
            "degraded_cages": [{"id": c.get("cage_id"), "state": c.get("state")} for c in unhealthy_cages],
            "degraded_nodes": [{"id": n.get("node_id"), "state": n.get("state")} for n in unhealthy_nodes],
            "cage_list": [
                {"id": c.get("cage_id"), "name": c.get("name"), "state": c.get("state", "unknown")}
                for c in cages_list[:8]
            ],
        }

    # ── Phase 4: LLM Synthesis (streamed) ────────────────────────────────────

    _SYNTH_SYSTEM = """\
You are an expert HPE SAN storage systems engineer writing a diagnostic assessment.

CRITICAL RULES:
1. Write like a senior SAN engineer presenting to a customer. Professional, clear, precise.
2. NEVER mention JSON fields, parser internals, database rows, dictionary keys, or missing properties.
3. If a value is Not Available, state it as "Not Available". Never speculate.
4. Format all tables using standard GitHub Flavored Markdown pipe-table syntax.
5. Base everything solely on the SAN facts provided. No hallucination.
6. Provide a clear, actionable recommendation at the end."""

    def _llm_synthesize(self, query: str, array_name: str, san_facts: dict,
                        neo4j_rows: list, steps: list,
                        use_ollama=False, disable_think=False, stream=False) -> str:
        """LLM Call #final: Produce the markdown expert report."""
        if not self.llm_call:
            return self._fallback_report(array_name, san_facts)

        user_msg = (
            f"SAN DIAGNOSTIC FACTS:\n{json.dumps(san_facts, indent=2, default=str)}\n\n"
            f"USER QUESTION:\n{query}"
        )
        if neo4j_rows:
            user_msg += f"\n\nADDITIONAL GRAPH DATA:\n{json.dumps(neo4j_rows[:20], indent=2, default=str)}"

        try:
            return self._stream_llm_call(
                self._SYNTH_SYSTEM, user_msg,
                use_ollama=use_ollama, disable_think=disable_think
            )
        except Exception as e:
            sys.stderr.write(f"[SanAgent] LLM synthesis failed: {e}\n")
            return self._fallback_report(array_name, san_facts)

    # ── Fallback plain-text report (no LLM) ──────────────────────────────────

    def _fallback_report(self, array_name: str, san_facts: dict) -> str:
        lines = [f"### SAN Diagnostic Report: **{array_name}**\n"]
        v = san_facts.get("tpd_firmware_version", "Not Available")
        lines.append(f"* **TPD / Firmware Version:** `{v}`")
        lines.append(f"* **Overall Health:** {san_facts.get('overall_health_status', 'Unknown')}")

        n = san_facts.get("total_node_count", 0)
        if n:
            lines.append(f"* **Controller Nodes:** {n} node(s) online.")
        c = san_facts.get("total_cage_count", 0)
        if c:
            degraded_cages = san_facts.get("degraded_cages", [])
            if degraded_cages:
                lines.append(f"* **Cages:** {len(degraded_cages)} degraded enclosure(s) detected!")
            else:
                lines.append(f"* **Cages:** All {c} enclosure cages healthy.")
        d = san_facts.get("total_drive_count", 0)
        if d:
            degraded_drives = san_facts.get("degraded_drives", [])
            if degraded_drives:
                lines.append(f"* **Drives:** {len(degraded_drives)} degraded/failed disk(s) detected!")
            else:
                lines.append(f"* **Drives:** All {d} physical drives healthy.")
        h = san_facts.get("total_host_connections", 0)
        if h:
            lines.append(f"* **Hosts:** {h} host(s) registered and zoned.")
        if len(lines) == 1:
            lines.append(f"All components on **{array_name}** are operating within normal parameters.")
        return "\n".join(lines)

    # ── Neo4j helpers ─────────────────────────────────────────────────────────

    def _run_cypher_safe(self, cypher: str, steps: list,
                         use_ollama=False, disable_think=False) -> list:
        """Run cypher with LLM self-correction on failure."""
        if not (cypher and self.run_cypher and self.neo4j and self.neo4j.available):
            return []

        self._step(steps, "cypher", "Ran query on Neo4j", cypher.strip(), cypher=cypher.strip())
        try:
            rows = self.run_cypher(cypher) or []
            self._step(steps, "result", "Graph query results",
                       f"Retrieved {len(rows)} row(s) from Neo4j.", rows=rows[:50])
            return rows
        except Exception as ex:
            self._step(steps, "cypher_error", "Cypher failed", str(ex))
            if not self.llm_call:
                return []

            # Self-correction
            self._step(steps, "thinking", "Correcting Cypher query",
                       "Asking LLM to fix the invalid Cypher statement.")
            correction_system = (
                "You are a Neo4j Cypher debugging assistant. "
                "Fix the failing Cypher query so it compiles and runs. "
                "Schema: ArraySystem(ip_address, name, model, serial, release_version), "
                "Node, Switch, Host, Cage, PhysicalDisk. "
                "Relationships: (Host)-[:CONNECTS_TO]->(ArraySystem), "
                "(ArraySystem)-[:HAS_NODE|HAS_CAGE|HAS_SWITCH]->(Node|Cage|Switch), "
                "(Cage)-[:CONTAINS]->(PhysicalDisk). "
                "GOTCHA: Use IN ['a','b'] not 'a' OR name = 'b'. "
                "Output ONLY the corrected Cypher. No markdown."
            )
            try:
                corrected = self.llm_call(
                    correction_system,
                    f"Original:\n{cypher}\n\nError:\n{ex}",
                    use_ollama=use_ollama, disable_think=disable_think, stream=False
                )
                corrected = _strip_think(corrected).strip().strip("`").strip()
                if corrected.startswith("```"):
                    corrected = "\n".join(corrected.split("\n")[1:])
                if corrected.endswith("```"):
                    corrected = "\n".join(corrected.split("\n")[:-1])

                self._step(steps, "cypher", "Retrying corrected Cypher", corrected, cypher=corrected)
                rows = self.run_cypher(corrected) or []
                self._step(steps, "result", "Graph query results (corrected)",
                           f"Retrieved {len(rows)} row(s) from Neo4j.", rows=rows[:50])
                return rows
            except Exception as e2:
                self._step(steps, "cypher_error", "Cypher self-correction failed", str(e2))
                return []

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
        nodes = [{"data": {"id": f"array:{array_name}", "label": array_name, "type": "ArraySystem"}}]
        edges = []
        for row in rows[:12]:
            hname = row.get("host_name") or row.get("h.name") or row.get("name")
            if not hname:
                continue
            hid = f"host:{hname}"
            nodes.append({"data": {"id": hid, "label": hname, "type": "Host"}})
            edges.append({"data": {"source": hid, "target": f"array:{array_name}", "label": "CONNECTS_TO"}})
        return {"nodes": nodes, "edges": edges}

    # ── Public entry points ───────────────────────────────────────────────────

    def run(self, query: str, array_hint: Optional[str] = None,
            on_step: Optional[callable] = None,
            use_ollama=False, disable_think=False, stream=False) -> dict:
        self.on_step = on_step
        try:
            return self._run_agentic(query, array_hint,
                                     use_ollama=use_ollama,
                                     disable_think=disable_think,
                                     stream=stream)
        finally:
            self.on_step = None

    # ── Core agentic loop ─────────────────────────────────────────────────────

    def _run_agentic(self, query: str, array_hint: Optional[str] = None,
                     use_ollama=False, disable_think=False, stream=False) -> dict:
        steps: list[dict] = []
        t0 = time.time()

        # ── Resolve target array ─────────────────────────────────────────────
        hint = array_hint or _extract_array_hint(query)
        target = self._resolve_array(hint)
        if not target:
            return {
                "answer": "No simulated arrays found. Start the Python simulator first.",
                "steps": [{"type": "error", "title": "No devices",
                            "detail": "Simulator returned an empty device list."}],
                "neo4j_connected": bool(self.neo4j and self.neo4j.available),
            }

        ip = target.get("ip") or target.get("id")
        array_name = target.get("name") or hint or ip

        # ── Phase 1: LLM Planner ─────────────────────────────────────────────
        plan = self._llm_plan(query, array_name, steps,
                              use_ollama=use_ollama, disable_think=disable_think)
        commands_to_run: list[str] = list(plan["commands"])
        cypher: Optional[str] = plan.get("cypher")
        ran_commands: list[str] = []
        cmd_outputs: dict = {}

        # ── Phase 2: Execute initial tool set ────────────────────────────────
        for cmd in commands_to_run:
            self._execute_command(ip, array_name, cmd, steps, cmd_outputs)
            ran_commands.append(cmd)

        # ── Persist + normalise ───────────────────────────────────────────────
        parsed_snapshot: dict = {}
        if cmd_outputs:
            try:
                parsed_snapshot = self._persist_parsed(ip, array_name, cmd_outputs)
                hosts_n = len(parsed_snapshot.get("hosts", []))
                drives_n = len(parsed_snapshot.get("drives", []))
                self._step(steps, "neo4j", "Updated Neo4j graph database",
                           f"Merged array **{array_name}**: {hosts_n} host(s), "
                           f"{drives_n} drive(s), "
                           f"{len(parsed_snapshot.get('nodes', []))} node(s).",
                           nodes_updated=hosts_n + drives_n)
            except Exception as ex:
                self._step(steps, "neo4j", "Neo4j update skipped", str(ex))

        san_facts = self._build_san_facts(array_name, parsed_snapshot)

        # ── Phase 3: Reflection loop ──────────────────────────────────────────
        if self.llm_call and use_ollama:
            for reflection_round in range(MAX_REFLECT_ITERS):
                self._step(steps, "reflecting", "Reflecting",
                           f"Checking if more data is needed (round {reflection_round + 1}/{MAX_REFLECT_ITERS})…")
                next_cmd = self._llm_reflect(
                    query, array_name, san_facts, ran_commands, steps,
                    use_ollama=use_ollama, disable_think=disable_think
                )
                if next_cmd is None:
                    self._step(steps, "reflecting", "Reflecting",
                               "Agent is satisfied with the data collected. Proceeding to synthesis.")
                    break
                if next_cmd in ran_commands:
                    # LLM asked for a command already run — stop
                    self._step(steps, "reflecting", "Reflecting",
                               f"Command `{next_cmd}` already executed. Proceeding to synthesis.")
                    break

                # Run the extra command the agent requested
                self._step(steps, "reflecting", "Reflecting",
                           f"Agent needs more data: running `{next_cmd}`")
                self._execute_command(ip, array_name, next_cmd, steps, cmd_outputs)
                ran_commands.append(next_cmd)

                # Re-parse & rebuild facts with new data
                try:
                    parsed_snapshot = self._persist_parsed(ip, array_name, cmd_outputs)
                    san_facts = self._build_san_facts(array_name, parsed_snapshot)
                except Exception:
                    pass

        # ── Cypher / Neo4j query ──────────────────────────────────────────────
        neo4j_rows: list = []
        if cypher:
            neo4j_rows = self._run_cypher_safe(
                cypher, steps, use_ollama=use_ollama, disable_think=disable_think
            )

        # Deterministic fallbacks when graph is empty
        if not neo4j_rows and parsed_snapshot.get("hosts") and "host" in query.lower():
            neo4j_rows = [
                {"host_name": h.get("name"), "os_type": h.get("os_name") or h.get("os"),
                 "paths": h.get("port") or h.get("multipath"), "connection_type": "Fibre Channel"}
                for h in parsed_snapshot["hosts"]
            ]
        if not neo4j_rows and parsed_snapshot.get("drives") and "fail" in query.lower():
            neo4j_rows = [
                {"array_name": array_name, "pd_id": d.get("pd_id"), "state": d.get("state")}
                for d in parsed_snapshot["drives"]
                if d.get("state") in ("failed", "degraded")
            ]

        # ── Phase 4: Synthesis ────────────────────────────────────────────────
        answer = self._llm_synthesize(
            query, array_name, san_facts, neo4j_rows, steps,
            use_ollama=use_ollama, disable_think=disable_think, stream=stream
        )

        # Short description for the final step bubble
        final_desc = "Successfully completed SAN diagnostics."
        for line in [l.strip() for l in answer.split("\n") if l.strip()]:
            clean = re.sub(r"^[#*\s\-\[\]\(\)]+", "", line).strip()
            if clean and len(clean) > 10 and clean.lower() not in (
                "san diagnostic report", "array health and status", "host details",
                "recommendation", "health summary", "host zoning status", "tpd version"
            ):
                final_desc = clean[:137] + "..." if len(clean) > 140 else clean
                break

        self._step(steps, "final", "Final result", final_desc)

        return {
            "answer": answer,
            "steps": steps,
            "cypher": cypher,
            "table": neo4j_rows,
            "graph": self._build_subgraph(array_name, neo4j_rows),
            "array": {"name": array_name, "ip": ip},
            "neo4j_connected": bool(self.neo4j and self.neo4j.available),
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    # ── Batch analysis helper (kept for token-overflow fallback) ──────────────

    def _analyze_batch(self, entity_type: str, items: list, chunk_size: int = 30,
                       use_ollama=False, disable_think=False) -> list:
        """Analyze large hardware entity lists in batches to avoid LLM token overflow."""
        issues = []
        if not self.llm_call or not items:
            return issues
        total = len(items)
        n_batches = (total + chunk_size - 1) // chunk_size
        for i in range(0, total, chunk_size):
            chunk = items[i:i + chunk_size]
            batch_num = (i // chunk_size) + 1
            prompt = (
                f"You are a hardware diagnostics agent. Analyze batch {batch_num}/{n_batches} "
                f"of {len(chunk)} {entity_type} records. Identify components in degraded, failed, "
                f"or abnormal states. Healthy components — ignore entirely.\n\n"
                f"Records:\n{json.dumps(chunk, default=str)}\n\n"
                "Return ONLY a valid JSON list of problematic component objects, "
                "or [] if all are healthy."
            )
            try:
                res = self.llm_call(
                    "Return ONLY a valid JSON list [] of abnormal components, or [] if all healthy. "
                    "No markdown.",
                    prompt, use_ollama=use_ollama, disable_think=disable_think,
                    json_mode=True
                )
                try:
                    parsed_res = json.loads(_strip_think(res).strip())
                    if isinstance(parsed_res, list):
                        issues.extend(parsed_res)
                except Exception:
                    if any(k in res.lower() for k in ("failed", "degraded", "abnormal")):
                        issues.append({"batch": batch_num, "summary": res.strip()})
            except Exception:
                issues.extend([
                    item for item in chunk
                    if item.get("state", "").lower() not in ("normal", "ok")
                ])
        return issues
