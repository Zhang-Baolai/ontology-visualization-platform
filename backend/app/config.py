"""Safe ontology source discovery and application configuration."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ONTOLOGY_ROOT = PROJECT_ROOT / "ontologies"
ONTOLOGY_ROOT = Path(
    os.getenv("ONTOLOGY_ROOT", str(DEFAULT_ONTOLOGY_ROOT))
).expanduser().resolve()
HISTORY_ROOT = Path(
    os.getenv("ONTOLOGY_HISTORY_ROOT", str(ONTOLOGY_ROOT / ".ontology-history"))
).expanduser().resolve()

MAX_TTL_BYTES = int(os.getenv("ONTOLOGY_MAX_TTL_BYTES", str(2 * 1024 * 1024)))

SAFE_KEY = re.compile(r"^[a-z0-9][a-z0-9-]*$")


@dataclass(frozen=True)
class ModuleSpec:
    id: str
    label: str
    relative_path: Path
    include_imports: bool = False


@dataclass(frozen=True)
class OntologySource:
    domain: str
    module: str
    label: str
    path: Path
    domain_root: Path
    include_imports: bool


MODULE_SPCompute: tuple[ModuleSpec, ...] = (
    ModuleSpec("all", "完整本体", Path("data_ontology.ttl"), True),
    ModuleSpec("dimension", "维度本体", Path("core/dimension_ontology.ttl")),
    ModuleSpec("metric", "指标本体", Path("core/metric_ontology.ttl")),
    ModuleSpec("capability", "能力本体", Path("capability/capability_ontology.ttl")),
    ModuleSpec("scenario", "场景本体", Path("scenario/scenario_ontology.ttl")),
)

DOMAIN_LABELS = {
    "cloud-demo": "Cloud Demo",
    "service-demo": "Service Demo",
}


def _assert_safe_key(value: str, field: str) -> None:
    if not SAFE_KEY.fullmatch(value):
        raise ValueError(f"Invalid {field}: {value!r}")


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def to_display_path(path: Path) -> str:
    """Return a stable non-sensitive path for API metadata."""

    resolved = path.resolve()
    for root, prefix in ((PROJECT_ROOT, ""), (ONTOLOGY_ROOT, "ontologies")):
        try:
            relative = resolved.relative_to(root.resolve()).as_posix()
            return f"{prefix}/{relative}".lstrip("/")
        except ValueError:
            continue
    return path.name


def discover_catalog() -> dict:
    """Discover supported domains and known module files on disk."""

    domains: list[dict] = []
    if not ONTOLOGY_ROOT.is_dir():
        return {"domains": domains}

    for domain_dir in sorted(path for path in ONTOLOGY_ROOT.iterdir() if path.is_dir()):
        domain = domain_dir.name
        if not SAFE_KEY.fullmatch(domain):
            continue

        modules: list[dict] = []
        for spec in MODULE_SPCompute:
            source_path = (domain_dir / spec.relative_path).resolve()
            if source_path.is_file() and _is_within(source_path, domain_dir):
                modules.append(
                    {
                        "id": spec.id,
                        "label": spec.label,
                        "source_file": to_display_path(source_path),
                        "include_imports": spec.include_imports,
                    }
                )

        custom_root = domain_dir / "custom"
        if custom_root.is_dir():
            for source_path in sorted(custom_root.glob("*.ttl")):
                module_id = source_path.stem
                if not SAFE_KEY.fullmatch(module_id):
                    continue
                resolved = source_path.resolve()
                if not _is_within(resolved, custom_root):
                    continue
                modules.append(
                    {
                        "id": module_id,
                        "label": module_id.replace("-", " ").title(),
                        "source_file": to_display_path(resolved),
                        "include_imports": False,
                        "custom": True,
                    }
                )

        if modules:
            domains.append(
                {
                    "id": domain,
                    "label": DOMAIN_LABELS.get(domain, domain.replace("-", " ").title()),
                    "modules": modules,
                }
            )

    return {"domains": domains}


def resolve_source(domain: str, module: str) -> OntologySource:
    """Resolve a domain/module pair through fixed module specifications."""

    _assert_safe_key(domain, "domain")
    _assert_safe_key(module, "module")

    spec = next((item for item in MODULE_SPCompute if item.id == module), None)
    if spec is None:
        spec = ModuleSpec(
            module,
            module.replace("-", " ").title(),
            Path("custom") / f"{module}.ttl",
        )

    domain_root = (ONTOLOGY_ROOT / domain).resolve()
    source_path = (domain_root / spec.relative_path).resolve()
    if not _is_within(source_path, domain_root):
        raise ValueError("Ontology source escapes its domain root")
    if not source_path.is_file():
        raise FileNotFoundError(source_path)

    return OntologySource(
        domain=domain,
        module=module,
        label=spec.label,
        path=source_path,
        domain_root=domain_root,
        include_imports=spec.include_imports,
    )


def resolve_new_custom_source(domain: str, module: str) -> OntologySource:
    """Resolve a not-yet-created custom module without accepting arbitrary paths."""

    _assert_safe_key(domain, "domain")
    _assert_safe_key(module, "module")
    if any(item.id == module for item in MODULE_SPCompute):
        raise ValueError("Built-in module ids cannot be created as custom modules")

    domain_root = (ONTOLOGY_ROOT / domain).resolve()
    if not domain_root.is_dir() or not _is_within(domain_root, ONTOLOGY_ROOT):
        raise FileNotFoundError(domain_root)

    source_path = (domain_root / "custom" / f"{module}.ttl").resolve()
    if not _is_within(source_path, domain_root):
        raise ValueError("Ontology source escapes its domain root")
    if source_path.exists():
        raise FileExistsError(source_path)

    return OntologySource(
        domain=domain,
        module=module,
        label=module.replace("-", " ").title(),
        path=source_path,
        domain_root=domain_root,
        include_imports=False,
    )


def cors_origins() -> list[str]:
    configured = os.getenv("ONTOLOGY_CORS_ORIGINS", "").strip()
    if configured:
        return [item.strip() for item in configured.split(",") if item.strip()]
    return [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    ]
