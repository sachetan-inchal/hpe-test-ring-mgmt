"""
Hybrid RAG: Universal JSON summaries + Neo4j Cypher (discovery graph schema).
Requires GROQ_API_KEY in the environment (no embedded secrets).
"""
import os
import json

try:
    from groq import Groq
    HAS_GROQ = True
except ImportError:
    HAS_GROQ = False

import requests

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:14b")

def detect_ollama():
    for p in [11434, 11435, 11430, 8000]:
        try:
            r = requests.get(f"http://127.0.0.1:{p}/api/tags", timeout=0.5)
            if r.status_code == 200:
                return p
        except Exception:
            pass
    return 11434


# Matches monorepo/discovery/neo4j_store.py (no Port nodes)
NEO4J_SCHEMA = """
Nodes and keys (discovery ingest):
  ArraySystem: ip_address (unique anchor), name, model, serial, release_version,
    total_cap_mib, free_cap_mib, config_type, node_count, is_decommissioned (optional)
  Node: node_id (string id like "<array_ip>_N0"), name, is_master, mem_mib, up_since
  Switch: name, state, mode, serial, temperature, model, ip_address
  Host: ip_address, name, os_name, os_version, wwn, multipath, device_type, ...
  Cage: cage_id (string), name, state, model, drive_count, temperature
  PhysicalDisk: serial (key), pd_id, cage_pos, drive_type, manufacturer, model,
    firmware_rev, capacity_gb, sed_state, protocol, state, health, device, ...

Relationships:
  (ArraySystem)-[:HAS_NODE]->(Node)
  (ArraySystem)-[:HAS_SWITCH]->(Switch)
  (ArraySystem)-[:HAS_CAGE]->(Cage)
  (Cage)-[:CONTAINS]->(PhysicalDisk)
  (Host)-[:CONNECTS_TO]->(ArraySystem)
  (Host)-[:HAS_DISK]->(PhysicalDisk)   // Linux host disks
  (ArraySystem)-[:REMOTE_COPY_PEER]->(ArraySystem)

Notes:
  - Match ArraySystem by ip_address, e.g. MATCH (a:ArraySystem {ip_address: $ip})
  - Hosts attach to arrays with CONNECTS_TO (direction: Host -> ArraySystem)
  - Use labels() or properties liberally in RETURN for clarity
"""
LLM_CALL_COUNTER = 0

def get_llm_calls_count():
    global LLM_CALL_COUNTER
    return LLM_CALL_COUNTER

def reset_llm_calls_count():
    global LLM_CALL_COUNTER
    LLM_CALL_COUNTER = 0
    return LLM_CALL_COUNTER


class RAGEngine:
    def __init__(self, json_store=None, neo4j_loader=None, ontology_traversal=None):
        self.json_store = json_store
        self.neo4j_loader = neo4j_loader
        self.ontology_traversal = ontology_traversal
        key = (os.environ.get("GROQ_API_KEY") or "").strip()
        self.client = Groq(api_key=key) if HAS_GROQ and key else None
        self.active_ollama_port = detect_ollama()

    def _llm_call_ollama(self, system_prompt, user_prompt, history=None, temperature=0.1, disable_think=False, stream=False, json_mode=False, ollama_model=None, request_id=None):
        global LLM_CALL_COUNTER
        LLM_CALL_COUNTER += 1
        messages = [{"role": "system", "content": system_prompt}]
        if history and isinstance(history, list):
            for msg in history[-6:]:
                if isinstance(msg, dict) and "role" in msg and "content" in msg:
                    messages.append(msg)
        messages.append({"role": "user", "content": user_prompt})
        
        # Auto-detect best model from available tags
        model_to_use = ollama_model or OLLAMA_MODEL
        if not ollama_model and not os.environ.get("OLLAMA_MODEL"):
            try:
                r = requests.get(f"http://127.0.0.1:{self.active_ollama_port}/api/tags", timeout=1.0)
                if r.status_code == 200:
                    available_models = [m.get("name") for m in r.json().get("models", []) if m.get("name")]
                    if available_models:
                        # Prioritize deepseek models first
                        deepseek_models = [m for m in available_models if "deepseek" in m.lower()]
                        if deepseek_models:
                            # Prefer 8b or 7b if available, otherwise any deepseek
                            deepseek_8b = [m for m in deepseek_models if "8b" in m.lower()]
                            deepseek_7b = [m for m in deepseek_models if "7b" in m.lower()]
                            if deepseek_8b:
                                model_to_use = deepseek_8b[0]
                            elif deepseek_7b:
                                model_to_use = deepseek_7b[0]
                            else:
                                model_to_use = deepseek_models[0]
                        elif "qwen3:14b" in available_models:
                            model_to_use = "qwen3:14b"
                        else:
                            model_to_use = available_models[0]
            except Exception:
                pass

        try:
            url = f"http://127.0.0.1:{self.active_ollama_port}/api/chat"
            if disable_think:
                messages[0]["content"] += "\n\nCRITICAL INSTRUCTION: DO NOT output any reasoning or thinking steps. Output ONLY the final direct answer. DO NOT output <think> tags."
                
            data = {
                "model": model_to_use,
                "messages": messages,
                "stream": stream,
                "options": {
                    "temperature": temperature
                }
            }
            if json_mode:
                data["format"] = "json"
            if stream:
                try:
                    response = requests.post(url, json=data, stream=True, timeout=120)
                    response.raise_for_status()
                except Exception as conn_err:
                    def error_generator():
                        yield json.dumps({
                            "message": {
                                "content": f"Ollama connection error: {str(conn_err)}. Please verify that Ollama is running on port {self.active_ollama_port} (e.g. using `ollama serve`)."
                            },
                            "done": True
                        })
                    return error_generator()

                if disable_think:
                    def generator():
                        import json
                        import sys
                        from api.app import _cancelled_requests
                        buffer = ""
                        passed_think = False
                        try:
                            for line in response.iter_lines():
                                if request_id and request_id in _cancelled_requests:
                                    try:
                                        response.close()
                                    except Exception:
                                        pass
                                    break
                                if line:
                                    decoded = line.decode('utf-8')
                                    try:
                                        chunk_data = json.loads(decoded)
                                        content = chunk_data.get("message", {}).get("content", "")
                                        buffer += content
                                        
                                        if not passed_think:
                                            if "</think>" in buffer:
                                                parts = buffer.split("</think>", 1)
                                                passed_think = True
                                                remaining = parts[1]
                                                # We transitioned! Yield any remaining normal response text
                                                if remaining:
                                                    chunk_data["message"]["content"] = remaining
                                                    yield json.dumps(chunk_data)
                                            else:
                                                # We are still in the think block.
                                                chunk_data["type"] = "think"
                                                yield json.dumps(chunk_data)
                                        else:
                                            yield decoded
                                    except Exception:
                                        yield decoded
                        except Exception as stream_err:
                            yield json.dumps({
                                "message": {"content": f"\n\n[Ollama stream interrupted: {str(stream_err)}]"},
                                "done": True
                            })
                    return generator()
                else:
                    def generator():
                        import sys
                        from api.app import _cancelled_requests
                        try:
                            for line in response.iter_lines():
                                if request_id and request_id in _cancelled_requests:
                                    try:
                                        response.close()
                                    except Exception:
                                        pass
                                    break
                                if line:
                                    yield line.decode('utf-8')
                        except Exception as stream_err:
                            yield json.dumps({
                                "message": {"content": f"\n\n[Ollama stream interrupted: {str(stream_err)}]"},
                                "done": True
                            })
                    return generator()

            try:
                response = requests.post(url, json=data, timeout=300)
                response.raise_for_status()
                result = response.json().get("message", {}).get("content", "")
            except Exception as conn_err:
                return f"Ollama connection error: {str(conn_err)}. Please verify that Ollama is running on port {self.active_ollama_port}."

            if disable_think:
                import re
                result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip()
                if "</think>" in result:
                    result = result.split("</think>", 1)[1].strip()
            return result
        except Exception as e:
            return f"Ollama LLM Error: {str(e)}"

    def _llm_call(self, system_prompt, user_prompt, history=None, temperature=0.1, use_ollama=False, disable_think=False, stream=False, json_mode=False, ollama_model=None, request_id=None):
        if use_ollama:
            return self._llm_call_ollama(system_prompt, user_prompt, history, temperature, disable_think, stream, json_mode, ollama_model=ollama_model, request_id=request_id)
            
        global LLM_CALL_COUNTER
        LLM_CALL_COUNTER += 1
        if stream:
            # Fake stream for Groq if requested (since we didn't implement Groq stream)
            def fake_stream(text):
                yield json.dumps({"message": {"content": text}, "done": True})
            
        if not self.client:
            return "Error: GROQ_API_KEY is not set or groq is not installed."
        try:
            messages = [{"role": "system", "content": system_prompt}]
            if history and isinstance(history, list):
                for msg in history[-6:]:
                    if isinstance(msg, dict) and "role" in msg and "content" in msg:
                        messages.append(msg)
            messages.append({"role": "user", "content": user_prompt})
            
            kwargs = {
                "model": GROQ_MODEL,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": 4096,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
                
            response = self.client.chat.completions.create(**kwargs)
            result = response.choices[0].message.content
            if stream:
                return fake_stream(result)
            return result
        except Exception as e:
            if stream:
                return fake_stream(f"LLM Error: {str(e)}")
            return f"LLM Error: {str(e)}"

    def classify_query(self, query, history=None, use_ollama=False, disable_think=False):
        system = """You are a query classifier for a SAN (Storage Area Network) system.
Classify the user's query into one of these categories:
- "standard": Simple aggregate property lookups (total capacity, version, total counts of things).
- "graph": ANY request asking for "lists", "individual details", "all elements", or relationship traversal (e.g. "list all nodes", "what hosts connect to X").
- "hybrid": Complex queries needing both high-level aggregate data AND specific list details.

Return ONLY the category word, nothing else."""

        result = self._llm_call(system, query, history=history, use_ollama=use_ollama, disable_think=disable_think)
        import re
        result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip().lower().strip('"\'')
        if result not in ("standard", "graph", "hybrid"):
            result = "hybrid"
        return result

    def standard_rag(self, query, history=None, use_ollama=False, disable_think=False, stream=False):
        context_parts = []
        sources = []

        # 1. Try to load from MongoDB real_sandatas first
        mongo_data = None
        mongo_uri = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/hpe_san")
        try:
            from pymongo import MongoClient
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=1000)
            db = client.get_database()
            doc = db.real_sandatas.find_one({})
            if doc and doc.get("nodes"):
                mongo_data = doc
        except Exception:
            pass

        if mongo_data:
            sources.append("MongoDB (real_sandatas)")
            nodes = mongo_data.get("nodes", [])
            
            # Smart Aggregator to prevent LLM context window overflow
            summary = {
                "arrays": [],
                "switches": [],
                "hosts_summary": {
                    "total_hosts": 0,
                    "os_distribution": {},
                    "hosts": [] # We list names and IPs
                },
                "disks_summary": {
                    "total_disks": 0,
                    "states": {},
                    "unhealthy_disks": [] # Only list details for failed/degraded drives
                },
                "ports_summary": {
                    "total_ports": 0,
                    "states": {},
                    "unhealthy_ports": [] # Only list details for offline/down ports
                },
                "cages_summary": {
                    "total_cages": 0,
                    "states": {},
                    "unhealthy_cages": []
                }
            }

            for n in nodes:
                ntype = n.get("type", "").lower()
                status = n.get("status", "normal").lower()
                
                if ntype == "array":
                    summary["arrays"].append({
                        "name": n.get("name"),
                        "model": n.get("model"),
                        "serial": n.get("serialNumber"),
                        "ip": n.get("ipAddress"),
                        "firmware": n.get("firmware"),
                        "status": n.get("status"),
                        "free_capacity": n.get("freeCapacityTb"),
                        "total_capacity": n.get("totalCapacityTb")
                    })
                elif ntype == "switch":
                    summary["switches"].append({
                        "name": n.get("name"),
                        "model": n.get("model"),
                        "serial": n.get("serialNumber"),
                        "ip": n.get("ipAddress"),
                        "status": n.get("status")
                    })
                elif ntype == "host":
                    summary["hosts_summary"]["total_hosts"] += 1
                    os_type = n.get("osType") or "Unknown"
                    summary["hosts_summary"]["os_distribution"][os_type] = summary["hosts_summary"]["os_distribution"].get(os_type, 0) + 1
                    summary["hosts_summary"]["hosts"].append({
                        "name": n.get("name"),
                        "ip": n.get("ipAddress"),
                        "status": n.get("status")
                    })
                elif ntype == "disk":
                    summary["disks_summary"]["total_disks"] += 1
                    summary["disks_summary"]["states"][status] = summary["disks_summary"]["states"].get(status, 0) + 1
                    if status in ("failed", "degraded", "offline", "error"):
                        summary["disks_summary"]["unhealthy_disks"].append({
                            "id": n.get("id"),
                            "pdId": n.get("pdId"),
                            "model": n.get("diskModel"),
                            "status": n.get("status"),
                            "cage_pos": n.get("cagePos"),
                            "capacity": n.get("capacity")
                        })
                elif ntype == "port":
                    summary["ports_summary"]["total_ports"] += 1
                    summary["ports_summary"]["states"][status] = summary["ports_summary"]["states"].get(status, 0) + 1
                    if status in ("failed", "degraded", "offline", "down", "error"):
                        summary["ports_summary"]["unhealthy_ports"].append({
                            "id": n.get("id"),
                            "name": n.get("name"),
                            "nsp": n.get("nsp"),
                            "status": n.get("status"),
                            "label": n.get("label")
                        })
                elif ntype == "cage":
                    summary["cages_summary"]["total_cages"] += 1
                    summary["cages_summary"]["states"][status] = summary["cages_summary"]["states"].get(status, 0) + 1
                    if status in ("failed", "degraded", "offline", "error"):
                        summary["cages_summary"]["unhealthy_cages"].append({
                            "id": n.get("id"),
                            "name": n.get("name"),
                            "status": n.get("status"),
                            "temp": n.get("temperature")
                        })
            
            context_parts.append("Real SAN Infrastructure Summary (from MongoDB real_sandatas):")
            context_parts.append(json.dumps(summary, indent=2, default=str))
        else:
            # 2. Fallback to json_store
            if not self.json_store:
                return {"answer": "No JSON store configured for standard RAG.", "sources": []}
            all_data = self.json_store.load_all()
            if not all_data:
                return {"answer": "No arrays in json_store. Add *.json under data/json_store or use graph mode.", "sources": []}

            sources.extend(list(all_data.keys()))
            for name, data in all_data.items():
                summary = {
                    "array_name": data.get("name"),
                    "model": data.get("model"),
                    "serial": data.get("serial"),
                    "version": data.get("release_version"),
                    "release_type": data.get("release_type"),
                    "config_type": data.get("config_type"),
                    "node_count": data.get("node_count"),
                    "total_cap_mib": data.get("total_cap_mib"),
                    "free_cap_mib": data.get("free_cap_mib"),
                    "failed_cap_mib": data.get("failed_cap_mib"),
                    "protocols": data.get("protocols_supported"),
                    "num_ports": len(data.get("ports", [])),
                    "num_switches": len(data.get("switches", [])),
                    "num_hosts": len(data.get("hosts", [])),
                    "num_cages": len(data.get("cages", [])),
                    "num_drives": len(data.get("drives", [])),
                    "nodes_summary": [{"node_id": n.get("node_id"), "name": n.get("name")} for n in data.get("nodes", [])],
                    "switches": [s.get("name") for s in data.get("switches", [])],
                    "cage_states": [{"id": c.get("cage_id"), "state": c.get("state")} for c in data.get("cages", [])],
                    "drive_states": {},
                    "failed_drives": [],
                }
                for d in data.get("drives", []):
                    st = d.get("state", "unknown")
                    summary["drive_states"][st] = summary["drive_states"].get(st, 0) + 1
                    if st in ("failed", "degraded"):
                        summary["failed_drives"].append({"pd_id": d["pd_id"], "state": st, "model": d.get("model")})

                context_parts.append(json.dumps(summary, indent=2, default=str))

        # Add Ontology context if available
        if self.ontology_traversal:
            from integrations.ontology_engine import GraphTraversal
            if isinstance(self.ontology_traversal, GraphTraversal):
                nodes = self.ontology_traversal.get_nodes()
                if nodes:
                    ontology_summary = "Ontology Static Topology:\n"
                    for n in nodes[:50]: # Cap for context length
                        props = n.get("properties", {})
                        ontology_summary += f"- {n.get('label')}: {props.get('name', n.get('node_id'))} (ID: {n.get('node_id')})\n"
                    context_parts.append(ontology_summary)

        context = "\n\n---\n\n".join(context_parts)
        system = f"""You are an HPE SAN infrastructure expert assistant. Answer questions using ONLY the provided data.
Be precise with numbers. Format responses clearly.

Available array data:
{context}"""

        answer = self._llm_call(system, query, history=history, use_ollama=use_ollama, disable_think=disable_think, stream=stream)
        
        mongo_query = "db.real_sandatas.findOne({})" if mongo_data else "data/json_store/*.json"
        context_raw = json.dumps(summary, indent=2, default=str) if mongo_data else context

        if stream:
            return {
                "stream_generator": answer, 
                "sources": sources, 
                "rag_type": "standard",
                "mongo_query": mongo_query,
                "context_raw": context_raw
            }
        return {
            "answer": answer, 
            "sources": sources, 
            "rag_type": "standard",
            "mongo_query": mongo_query,
            "context_raw": context_raw
        }

    def graph_rag(self, query, history=None, use_ollama=False, disable_think=False, stream=False):
        if not self.neo4j_loader:
            return self.standard_rag(query, history=history, use_ollama=use_ollama, disable_think=disable_think, stream=stream)

        system = f"""You are a Cypher query generator for a Neo4j SAN database.

Schema:
{NEO4J_SCHEMA}

Generate a valid Cypher query to answer the user's question.
Return ONLY the Cypher query, no explanation, no markdown formatting.
Use MATCH, WHERE, RETURN. Use OPTIONAL MATCH for nullable relationships.
Always RETURN meaningful property fields and labels, not just internal ids.
Prefer elementId(n) if you need a node identifier."""

        cypher = self._llm_call(system, query, history=history, temperature=0.0, use_ollama=use_ollama, disable_think=disable_think)
        import re
        cypher = re.sub(r'<think>.*?</think>', '', cypher, flags=re.DOTALL).strip().strip("`").strip()
        if cypher.startswith("```"):
            cypher = "\n".join(cypher.split("\n")[1:])
        if cypher.endswith("```"):
            cypher = "\n".join(cypher.split("\n")[:-1])

        try:
            results = self.neo4j_loader.run_cypher(cypher)
            clean_results = []
            for r in results:
                clean = {}
                for k, v in r.items():
                    if hasattr(v, "items"):
                        clean[k] = dict(v)
                    elif hasattr(v, "__iter__") and not isinstance(v, str):
                        clean[k] = list(v)
                    else:
                        clean[k] = v
                clean_results.append(clean)
        except Exception as e:
            clean_results = []
            cypher_error = str(e)
            retry_system = f"""{system}

The previous query failed with error: {cypher_error}
Previous query: {cypher}
Fix the query."""
            cypher = self._llm_call(retry_system, query, history=history, temperature=0.0, use_ollama=use_ollama, disable_think=disable_think)
            cypher = re.sub(r'<think>.*?</think>', '', cypher, flags=re.DOTALL).strip().strip("`").strip()
            if cypher.startswith("```"):
                cypher = "\n".join(cypher.split("\n")[1:])
            if cypher.endswith("```"):
                cypher = "\n".join(cypher.split("\n")[:-1])
            try:
                results = self.neo4j_loader.run_cypher(cypher)
                clean_results = []
                for r in results:
                    clean = {}
                    for k, v in r.items():
                        if hasattr(v, "items"):
                            clean[k] = dict(v)
                        elif hasattr(v, "__iter__") and not isinstance(v, str):
                            clean[k] = list(v)
                        else:
                            clean[k] = v
                    clean_results.append(clean)
            except Exception as e2:
                return {
                    "answer": f"Failed to execute graph query: {e2}",
                    "cypher": cypher,
                    "rag_type": "graph",
                    "error": str(e2),
                }

        if clean_results:
            result_str = json.dumps(clean_results[:50], indent=2, default=str)
            synth_system = """You are an HPE SAN expert. Synthesize a clear answer from the query results.
Format as markdown with tables where appropriate. Be concise and precise."""
            answer = self._llm_call(synth_system, f"Question: {query}\n\nQuery Results:\n{result_str}", history=history, use_ollama=use_ollama, disable_think=disable_think, stream=stream)
            if stream:
                return {
                    "stream_generator": answer,
                    "cypher": cypher,
                    "results_count": len(clean_results),
                    "raw_results": clean_results[:20],
                    "rag_type": "graph",
                }
        else:
            answer = "No results found for this query."
            if stream:
                def empty_stream(): yield json.dumps({"message": {"content": answer}, "done": True})
                return {
                    "stream_generator": empty_stream(),
                    "cypher": cypher,
                    "results_count": 0,
                    "raw_results": [],
                    "rag_type": "graph",
                }

        return {
            "answer": answer,
            "cypher": cypher,
            "results_count": len(clean_results),
            "raw_results": clean_results[:20],
            "rag_type": "graph",
        }

    def query(self, user_query, history=None, use_ollama=False, disable_think=False, stream=False):
        query_type = self.classify_query(user_query, history=history, use_ollama=use_ollama, disable_think=disable_think)

        if query_type == "standard":
            result = self.standard_rag(user_query, history=history, use_ollama=use_ollama, disable_think=disable_think, stream=stream)
        elif query_type == "graph":
            result = self.graph_rag(user_query, history=history, use_ollama=use_ollama, disable_think=disable_think, stream=stream)
        else:
            std = self.standard_rag(user_query, history=history, use_ollama=use_ollama, disable_think=disable_think, stream=stream)
            graph = self.graph_rag(user_query, history=history, use_ollama=use_ollama, disable_think=disable_think, stream=stream)
            if graph.get("results_count", 0) > 0:
                result = graph
                result["standard_context"] = std.get("answer") or ""
            else:
                result = std
            result["rag_type"] = "hybrid"

        result["query_type"] = query_type
        result["render_blocks"] = self._build_render_blocks(result)
        return result

    def _build_render_blocks(self, result):
        blocks = []
        if result.get("answer"):
            blocks.append({"type": "markdown", "content": result["answer"]})
        if result.get("raw_results") and len(result["raw_results"]) > 0:
            sample = result["raw_results"][0]
            headers = list(sample.keys())
            rows = []
            for r in result["raw_results"][:20]:
                rows.append([str(r.get(h, "")) for h in headers])
            blocks.append({"type": "table", "headers": headers, "rows": rows})
        if result.get("cypher"):
            blocks.append({"type": "code", "language": "cypher", "content": result["cypher"]})
        return blocks
