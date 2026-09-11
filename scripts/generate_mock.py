"""Rebuild the public mock response from the fictional bundled ontology."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import resolve_source  # noqa: E402
from app.services.ontology_parser import OntologyParser  # noqa: E402

payload = OntologyParser().parse(resolve_source("cloud-demo", "dimension"))
output = ROOT / "frontend/public/mock/dimension_graph.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Generated public mock: {len(payload['nodes'])} nodes, {len(payload['edges'])} edges")
