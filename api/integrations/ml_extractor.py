#!/usr/bin/env python3
"""
ml_extractor.py

Lightweight classifier to identify device types (hosts, switches, arrays) from log lines.
Uses a fast heuristic regex matcher and falls back to SentenceTransformers/MiniLM if installed.
This provides robust out-of-the-box functionality with the ability to upscale to true ML.
"""
import re
import os
import json

class MLEntityClassifier:
    def __init__(self):
        # Heuristic database compiled from m1-array_proxy, m2-commands, m3-spreadsheet, m4-sshcmdsoutput logs
        self.host_patterns = [
            r"^c3-dl\d{3}g\d{1,2}-\d+$",  # e.g., c3-dl380g9-349
            r"^host-.*",                  # e.g., host-alpha-001, host-lnx-222
            r"^win-host-.*",
            r"^rhel-.*",
            r"^WIN-.*"
        ]
        
        self.switch_patterns = [
            r"^c3-sn\d{4}b-\d+$",         # e.g., c3-sn3600b-24
            r"^c3-hp\d{4}-\d+$",          # e.g., c3-hp5950-03
            r"^c3-brg\d{3}-\d+$",         # e.g., c3-brg620-07
            r"^sw\d+$",                   # e.g., sw1, sw2
            r"^sw-.*"                     # e.g., sw-core-01, sw-edge-61
        ]
        
        self.array_patterns = [
            r"^s\d{4}$",                  # e.g., s4378, s4377
            r"^4UW\d{7}(-\d)?$",          # e.g., 4UW0004634, 4UW0004634-0
            r"^Arcus-.*"                  # e.g., Arcus-4
        ]
        
        # Load SentenceTransformer dynamically if available to keep environment light
        self.model = None
        self.cache = {}  # Cache to prevent redundant transformer executions
        self._load_transformer()

    def _load_transformer(self):
        try:
            from sentence_transformers import SentenceTransformer
            # Only loaded if the package is installed
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
            
            # Seed references for similarity classification
            self.categories = {
                "host": ["c3-dl380g9-349", "host-lnx-222", "host-esx-131", "c3-dl360g10-84"],
                "switch": ["c3-sn3600b-24", "c3-hp5950-03", "sw-edge-61", "c3-brg620-07"],
                "array": ["s4378", "s4377", "S4380", "4UW0004634"]
            }
            self.embeddings = {}
            for cat, examples in self.categories.items():
                self.embeddings[cat] = self.model.encode(examples)
        except Exception:
            # Silently fall back to heuristics if sentence-transformers is not present
            self.model = None

    def classify(self, name: str) -> str:
        """Classify device name as 'host', 'switch', 'array', or 'unknown'."""
        name = name.strip()
        if not name:
            return "unknown"
            
        if name in self.cache:
            return self.cache[name]
            
        result = self._classify_uncached(name)
        self.cache[name] = result
        return result

    def _classify_uncached(self, name: str) -> str:
        # 1. Direct Regex/Heuristic Checks (Extremely fast, covers 100% of reference data)
        for pattern in self.array_patterns:
            if re.match(pattern, name, re.IGNORECASE):
                return "array"
        for pattern in self.switch_patterns:
            if re.match(pattern, name, re.IGNORECASE):
                return "switch"
        for pattern in self.host_patterns:
            if re.match(pattern, name, re.IGNORECASE):
                return "host"
                
        # 2. SentenceTransformer Cosine-Similarity Fallback
        if self.model is not None:
            try:
                import numpy as np
                name_emb = self.model.encode(name)
                best_cat = "unknown"
                max_score = 0.0
                
                for cat, embs in self.embeddings.items():
                    # Compute cosine similarities
                    dots = np.dot(embs, name_emb)
                    norms = np.linalg.norm(embs, axis=1) * np.linalg.norm(name_emb)
                    similarities = dots / norms
                    mean_score = np.mean(similarities)
                    if mean_score > max_score and mean_score > 0.45:
                        max_score = mean_score
                        best_cat = cat
                return best_cat
            except Exception:
                pass
                
        return "unknown"

    def scan_log_file(self, filepath: str) -> dict:
        """
        Scans a raw log file, extracts potential device names/IPs,
        and returns a structured index.
        """
        if not os.path.exists(filepath):
            return {}
            
        results = {
            "hosts": set(),
            "switches": set(),
            "arrays": set()
        }
        
        # Regex to scan for alphanumeric tokens (could be device names)
        # Matches common patterns like s4378, c3-dl380g9-349, etc.
        token_regex = re.compile(r"\b[a-zA-Z0-9\-_]{3,24}\b")
        
        with open(filepath, "r", errors="replace") as f:
            for line in f:
                # Find all potential tokens in line
                tokens = token_regex.findall(line)
                for token in tokens:
                    category = self.classify(token)
                    if category == "host":
                        results["hosts"].add(token)
                    elif category == "switch":
                        results["switches"].add(token)
                    elif category == "array":
                        results["arrays"].add(token)
                        
        # Convert sets to sorted lists for JSON serialization
        return {k: sorted(list(v)) for k, v in results.items()}

if __name__ == "__main__":
    classifier = MLEntityClassifier()
    # Quick CLI test
    test_devices = ["c3-dl380g9-349", "sw-core-01", "s4378", "4UW0004634", "unknown-item-xyz"]
    print("Testing ML Classifications:")
    for d in test_devices:
        print(f"  {d:<20} -> {classifier.classify(d)}")
