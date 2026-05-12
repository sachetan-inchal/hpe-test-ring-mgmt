"""
discovery/parsers/hpe_parser.py

Imports the universal parser which is now bundled in the monorepo.
"""
import os
import sys

# Add current directory to path so we can import universal_parser
sys.path.insert(0, os.path.dirname(__file__))

try:
    from universal_parser import parse_array_dump
except ImportError as e:
    def parse_array_dump(raw_text: str) -> dict:
        return {"error": f"HPE universal_parser not found: {e}"}
