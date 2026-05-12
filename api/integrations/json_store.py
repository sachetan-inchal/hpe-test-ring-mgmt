"""File-based Universal JSON store for standard RAG when arrays are not only in Neo4j."""
import json
import os


class JsonStore:
    def __init__(self, store_dir=None):
        self.store_dir = store_dir or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "data",
            "json_store",
        )
        os.makedirs(self.store_dir, exist_ok=True)

    def save_array(self, data):
        name = data.get("name", "unknown")
        filepath = os.path.join(self.store_dir, f"{name}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        return filepath

    def load_array(self, name):
        filepath = os.path.join(self.store_dir, f"{name}.json")
        if os.path.exists(filepath):
            with open(filepath, encoding="utf-8") as f:
                return json.load(f)
        return None

    def list_arrays(self):
        return [
            f.replace(".json", "")
            for f in os.listdir(self.store_dir)
            if f.endswith(".json")
        ]

    def load_all(self):
        return {name: self.load_array(name) for name in self.list_arrays()}
