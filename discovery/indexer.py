"""
discovery/indexer.py

Elasticsearch indexer for the "Everything" search capability.
Indexes all discovered entities (arrays, nodes, hosts, drives, etc.)
into Elasticsearch for full-text + structured enterprise-grade search.
"""
import os
import json
import logging
from typing import Optional

log = logging.getLogger(__name__)

ES_HOST = os.environ.get("ES_HOST", "http://localhost:9200")
ES_INDEX_PREFIX = "hpe_san"


class ElasticsearchIndexer:
    """
    Indexes all discovered SAN entities into Elasticsearch.
    Supports incremental updates (MERGE by IP + entity type).
    """

    def __init__(self, host: str = ES_HOST):
        self.host = host
        self._client = None
        self._available = False
        self._init_client()

    def _init_client(self):
        try:
            from elasticsearch import Elasticsearch
            # For ES 8.x/9.x, explicitly handle security-disabled environments
            self._client = Elasticsearch(
                self.host,
                verify_certs=False,
                request_timeout=5
            )
            # Try a direct HEAD request or info() which is more reliable than ping() in some versions
            if self._client.ping():
                self._available = True
                self._ensure_indices()
                log.info(f"[indexer] Elasticsearch connected at {self.host}")
            else:
                # Fallback check
                info = self._client.info()
                if info:
                    self._available = True
                    self._ensure_indices()
                    log.info(f"[indexer] Elasticsearch connected via info() at {self.host}")
        except ImportError:
            log.warning("[indexer] elasticsearch-py not installed. Run: pip install elasticsearch")
        except Exception as e:
            log.warning(f"[indexer] Elasticsearch unavailable: {e}")

    def _ensure_indices(self):
        """Create index mappings if they don't exist."""
        indices = {
            f"{ES_INDEX_PREFIX}_arrays": {
                "mappings": {
                    "properties": {
                        "name": {"type": "keyword"},
                        "model": {"type": "text"},
                        "serial": {"type": "keyword"},
                        "ip_address": {"type": "ip"},
                        "release_version": {"type": "keyword"},
                        "total_cap_mib": {"type": "long"},
                        "free_cap_mib": {"type": "long"},
                        "config_type": {"type": "keyword"},
                    }
                }
            },
            f"{ES_INDEX_PREFIX}_hosts": {
                "mappings": {
                    "properties": {
                        "name": {"type": "keyword"},
                        "ip_address": {"type": "ip"},
                        "os_name": {"type": "text"},
                        "os_version": {"type": "keyword"},
                        "bios_version": {"type": "keyword"},
                        "server_model": {"type": "text"},
                    }
                }
            },
            f"{ES_INDEX_PREFIX}_drives": {
                "mappings": {
                    "properties": {
                        "pd_id": {"type": "keyword"},
                        "model": {"type": "text"},
                        "serial": {"type": "keyword"},
                        "firmware_rev": {"type": "keyword"},
                        "capacity_gb": {"type": "float"},
                        "drive_type": {"type": "keyword"},
                        "health": {"type": "keyword"},
                    }
                }
            },
            f"{ES_INDEX_PREFIX}_events": {
                "mappings": {
                    "properties": {
                        "type": {"type": "keyword"},
                        "ip": {"type": "ip"},
                        "msg": {"type": "text"},
                        "timestamp": {"type": "date"},
                    }
                }
            },
        }
        for index, body in indices.items():
            if not self._client.indices.exists(index=index):
                self._client.indices.create(index=index, body=body)
                log.info(f"[indexer] Created index: {index}")

    def index(self, parsed: dict):
        """
        Index all entities from a parsed discovery result.
        Dispatches to the correct index based on _device_type.
        """
        if not self._available:
            log.debug("[indexer] Skipping index (Elasticsearch not available)")
            return

        dtype = parsed.get("_device_type", "unknown")
        ip = parsed.get("_ip", "unknown")

        try:
            if dtype == "hpe_array":
                self._index_array(parsed, ip)
            elif dtype in ("linux_host", "windows_host"):
                self._index_host(parsed, ip)
        except Exception as e:
            log.error(f"[indexer] Failed to index {ip}: {e}")

    def _index_array(self, parsed: dict, ip: str):
        # Array-level document
        doc = {
            "name": parsed.get("name"),
            "model": parsed.get("model"),
            "serial": parsed.get("serial"),
            "ip_address": ip,
            "release_version": parsed.get("release_version"),
            "release_type": parsed.get("release_type"),
            "total_cap_mib": parsed.get("total_cap_mib"),
            "alloc_cap_mib": parsed.get("alloc_cap_mib"),
            "free_cap_mib": parsed.get("free_cap_mib"),
            "config_type": parsed.get("config_type"),
            "protocols_supported": parsed.get("protocols_supported"),
            "node_count": parsed.get("node_count"),
            "switch_count": len(parsed.get("switches", [])),
            "host_count": len(parsed.get("hosts", [])),
            "cage_count": len(parsed.get("cages", [])),
            "drive_count": len(parsed.get("drives", [])),
        }
        self._client.index(
            index=f"{ES_INDEX_PREFIX}_arrays",
            id=ip,
            document=doc,
        )

        # Index each drive for firmware search
        for drive in parsed.get("drives", []):
            drive_doc = {
                "array_ip": ip,
                "array_name": parsed.get("name"),
                "pd_id": str(drive.get("pd_id")),
                "cage_pos": drive.get("cage_pos"),
                "drive_type": drive.get("drive_type"),
                "manufacturer": drive.get("manufacturer"),
                "model": drive.get("model"),
                "serial": drive.get("serial"),
                "firmware_rev": drive.get("firmware_rev"),
                "capacity_gb": drive.get("capacity_gb"),
                "protocol": drive.get("protocol"),
                "sed_state": drive.get("sed_state"),
                "health": drive.get("state", "normal"),
            }
            self._client.index(
                index=f"{ES_INDEX_PREFIX}_drives",
                id=f"{ip}_{drive.get('pd_id')}",
                document=drive_doc,
            )

    def _index_host(self, parsed: dict, ip: str):
        doc = {
            "name": parsed.get("hostname"),
            "ip_address": ip,
            "os_name": parsed.get("os_name"),
            "os_version": parsed.get("os_version"),
            "bios_version": parsed.get("bios_version"),
            "server_model": parsed.get("server_model"),
            "cpu_model": parsed.get("cpu_model"),
            "disk_count": len(parsed.get("disks", [])),
            "device_type": parsed.get("_device_type"),
        }
        self._client.index(
            index=f"{ES_INDEX_PREFIX}_hosts",
            id=ip,
            document=doc,
        )

    def search(self, query: str, index_suffix: str = "*") -> list:
        """Full-text search across all SAN entities."""
        if not self._available:
            return []
        try:
            res = self._client.search(
                index=f"{ES_INDEX_PREFIX}_{index_suffix}",
                body={
                    "query": {
                        "multi_match": {
                            "query": query,
                            "fields": ["*"],
                            "fuzziness": "AUTO",
                        }
                    },
                    "size": 50,
                },
            )
            return [hit["_source"] for hit in res["hits"]["hits"]]
        except Exception as e:
            log.error(f"[indexer] Search error: {e}")
            return []

    @property
    def available(self):
        return self._available
