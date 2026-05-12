"""LLM-assisted CSV extraction for SAN inventory spreadsheets."""
import os
import json

try:
    from groq import Groq
    HAS_GROQ = True
except ImportError:
    HAS_GROQ = False

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")


class SpreadsheetPipeline:
    def __init__(self, run_cypher_fn=None):
        """
        run_cypher_fn: callable(query: str, params: dict | None) -> list[dict]
        """
        self.run_cypher = run_cypher_fn
        key = (os.environ.get("GROQ_API_KEY") or "").strip()
        self.client = Groq(api_key=key) if HAS_GROQ and key else None

    def _llm_call(self, system_prompt, user_prompt, temperature=0.1):
        if not self.client:
            return '{"error": "GROQ_API_KEY not set or groq not installed"}'
        try:
            response = self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                max_tokens=4096,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content
        except Exception as e:
            return json.dumps({"error": str(e)})

    def process_csv(self, csv_text):
        system_prompt = """You are a SAN Infrastructure data extractor.
Extract structured entities from raw CSV rows and output valid JSON only.
Extract arrays, hosts, and switches. For hosts, extract OS, rack location, and cpu/memory if available.
Output format:
{
  "arrays": [{"name": "string", "config_type": "string", "rack": "string"}],
  "hosts": [{"name": "string", "os": "string", "rack": "string", "fc_support": "string", "switches": ["string"]}]
}"""

        user_prompt = f"Extract structured data from the following CSV content:\n\n{csv_text}"
        result_json_str = self._llm_call(system_prompt, user_prompt)

        try:
            structured_data = json.loads(result_json_str)
        except json.JSONDecodeError:
            return {"error": "Failed to parse LLM JSON output", "raw": result_json_str[:500]}

        if structured_data.get("error"):
            return structured_data

        if self.run_cypher and structured_data.get("hosts"):
            for h in structured_data["hosts"]:
                name = h.get("name")
                if not name:
                    continue
                try:
                    self.run_cypher(
                        """
                        MATCH (host:Host)
                        WHERE host.name = $name OR host.wwn = $name OR host.ip_address = $name
                        SET host.rack_location = coalesce($rack, host.rack_location),
                            host.ingest_os = coalesce($os, host.ingest_os),
                            host.fc_support = coalesce($fc, host.fc_support)
                        """,
                        {
                            "name": name,
                            "rack": h.get("rack", "") or None,
                            "os": h.get("os", "") or None,
                            "fc": h.get("fc_support", "") or None,
                        },
                    )
                except Exception:
                    pass

        return structured_data
