from __future__ import annotations

from pathlib import Path
import shutil

from fastapi.testclient import TestClient

from app.api import r2rml_mapping
from app.main import app
from app.services.r2rml_mapping_service import R2RMLMappingService


FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "ontologies"


def test_catalog_separates_formal_and_draft_files() -> None:
    service = R2RMLMappingService(FIXTURE_ROOT)
    catalog = service.catalog()
    assert catalog["total_files"] == 3
    cloud_demo = next(item for item in catalog["domains"] if item["id"] == "cloud-demo")
    assert cloud_demo["formal_files"] == 1
    assert cloud_demo["draft_files"] == 1
    assert all(len(item["sha256"]) == 64 for item in catalog["files"])


def test_static_analysis_parses_columns_classes_joins_and_canonical_maps() -> None:
    service = R2RMLMappingService(FIXTURE_ROOT)
    payload = service.analysis(include_drafts=True)
    assert payload["meta"]["database_connected"] is False
    assert payload["meta"]["sql_executed"] is False
    assert payload["meta"]["total_files"] == 3
    assert payload["meta"]["total_triples_maps"] == 5
    assert payload["meta"]["total_joins"] == 1
    assert {node["type"] for node in payload["nodes"]} >= {
        "table", "column", "triples-map", "class", "property"
    }
    codes = {issue["code"] for issue in payload["issues"]}
    assert "CANONICAL_IRI_DECLARATION" in codes
    assert "ONTOLOGY_PROPERTY_NOT_FOUND" in codes
    assert "DRAFT_MAPPING_FILE" in codes
    assert "UNRESOLVED_PARENT_TRIPLES_MAP" not in codes


def test_analysis_excludes_drafts_by_default_and_supports_domain_filter() -> None:
    service = R2RMLMappingService(FIXTURE_ROOT)
    payload = service.analysis(domain="cloud-demo")
    assert payload["meta"]["total_files"] == 1
    assert payload["meta"]["total_triples_maps"] == 2
    assert not any(mapping["draft"] for mapping in payload["mappings"])


def test_read_only_mapping_api_contract(monkeypatch) -> None:
    monkeypatch.setattr(r2rml_mapping, "service", R2RMLMappingService(FIXTURE_ROOT))
    client = TestClient(app)
    catalog = client.get("/api/v1/mappings/catalog")
    assert catalog.status_code == 200
    assert catalog.json()["total_files"] == 3

    analysis = client.get(
        "/api/v1/mappings/analysis",
        params={"domain": "cloud-demo", "include_drafts": "true"},
    )
    assert analysis.status_code == 200
    payload = analysis.json()
    assert payload["meta"]["total_triples_maps"] == 3
    assert payload["meta"]["database_connected"] is False


def test_parse_error_and_zero_triples_map_are_blocking(tmp_path) -> None:
    mapping_root = tmp_path / "demo" / "mappings"
    mapping_root.mkdir(parents=True)
    (mapping_root / "broken.r2rml.ttl").write_text(
        "@prefix rr: <http://www.w3.org/ns/r2rml#> . <#broken> a",
        encoding="utf-8",
    )
    payload = R2RMLMappingService(tmp_path).analysis()
    codes = {issue["code"] for issue in payload["issues"]}
    assert "R2RML_TURTLE_PARSE_ERROR" in codes
    assert "ZERO_TRIPLES_MAP" in codes
    assert payload["meta"]["quality"]["errors"] == 2


def test_hidden_workspace_parent_does_not_disable_entity_validation(tmp_path) -> None:
    root = tmp_path / ".workspace" / "ontologies"
    shutil.copytree(FIXTURE_ROOT, root)
    payload = R2RMLMappingService(root).analysis(include_drafts=True)
    codes = {issue["code"] for issue in payload["issues"]}
    assert "ONTOLOGY_PROPERTY_NOT_FOUND" in codes
