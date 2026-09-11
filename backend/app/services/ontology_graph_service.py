"""Catalog discovery, graph caching and response orchestration."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from threading import RLock

from app.config import ONTOLOGY_ROOT, discover_catalog, resolve_source
from app.services.ontology_parser import OntologyParser


class OntologyGraphService:
    def __init__(self, parser: OntologyParser | None = None) -> None:
        self._parser = parser or OntologyParser()
        self._cache: dict[tuple[str, str], tuple[tuple, dict]] = {}
        self._lock = RLock()

    def catalog(self) -> dict:
        return discover_catalog()

    def get_graph(self, domain: str, module: str, refresh: bool = False) -> dict:
        source = resolve_source(domain, module)
        signature = self._signature(source.domain_root)
        key = (domain, module)

        with self._lock:
            cached = self._cache.get(key)
            if not refresh and cached and cached[0] == signature:
                return deepcopy(cached[1])

        payload = self._parser.parse(source)
        with self._lock:
            self._cache[key] = (signature, payload)
        return deepcopy(payload)

    @staticmethod
    def _signature(domain_root: Path) -> tuple:
        if not ONTOLOGY_ROOT.is_dir():
            return ()
        return tuple(
            (path.relative_to(domain_root).as_posix(), path.stat().st_mtime_ns, path.stat().st_size)
            for path in sorted(domain_root.rglob("*.ttl"))
            if path.is_file()
        )
