from __future__ import annotations

from pathlib import Path

import pytest

import app.config as config
from app.services.ontology_maintenance_service import (
    MaintenanceConflictError,
    OntologyMaintenanceService,
)


BASE_TTL = """@prefix ex: <https://example.com/onto#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ex:Asset a owl:Class ; rdfs:label "资产"@zh .
ex:Server a owl:Class ; rdfs:subClassOf ex:Asset ; rdfs:label "服务器"@zh .
ex:assetCode a owl:DatatypeProperty ;
  rdfs:domain ex:Asset ;
  rdfs:range <http://www.w3.org/2001/XMLSchema#string> .
"""


@pytest.fixture()
def maintenance(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    ontology_root = tmp_path / "ontologies"
    source = ontology_root / "cloud-demo" / "core" / "dimension_ontology.ttl"
    source.parent.mkdir(parents=True)
    source.write_text(BASE_TTL, encoding="utf-8")
    monkeypatch.setattr(config, "ONTOLOGY_ROOT", ontology_root)
    service = OntologyMaintenanceService(history_root=tmp_path / "history")
    return service, source


def test_source_preview_save_and_version_history(maintenance) -> None:
    service, source_path = maintenance
    source = service.source("cloud-demo", "dimension")
    changed = source["content"].replace("服务器", "计算服务器")

    preview = service.preview_content(
        "cloud-demo", "dimension", changed, source["content_hash"]
    )
    assert preview["conflict"] is False
    assert preview["validation"]["valid"] is True
    assert preview["diff"]["added_triples"] == 1
    assert preview["diff"]["removed_triples"] == 1

    saved = service.save(
        "cloud-demo",
        "dimension",
        changed,
        source["content_hash"],
        "测试保存",
    )
    assert saved["saved"] is True
    assert saved["backup"]["reason"] == "测试保存"
    assert "计算服务器" in source_path.read_text(encoding="utf-8")

    versions = service.list_versions("cloud-demo", "dimension")
    assert len(versions["versions"]) == 1
    restored = service.restore(
        "cloud-demo",
        "dimension",
        versions["versions"][0]["id"],
        versions["current_hash"],
    )
    assert restored["restored"] is True
    assert "服务器" in source_path.read_text(encoding="utf-8")


def test_stale_hash_blocks_write(maintenance) -> None:
    service, _ = maintenance
    source = service.source("cloud-demo", "dimension")
    with pytest.raises(MaintenanceConflictError):
        service.save(
            "cloud-demo",
            "dimension",
            source["content"],
            "0" * 64,
            "stale",
        )


def test_structured_class_edit_and_delete_impact(maintenance) -> None:
    service, _ = maintenance
    source = service.source("cloud-demo", "dimension")
    edited = service.preview_operations(
        "cloud-demo",
        "dimension",
        source["content_hash"],
        [
            {
                "action": "upsert",
                "entity_type": "class",
                "uri": "https://example.com/onto#Server",
                "label": "云服务器",
                "comment": "计算资源",
                "parent_uris": ["https://example.com/onto#Asset"],
                "has_key_uris": ["https://example.com/onto#assetCode"],
            }
        ],
    )
    assert edited["validation"]["valid"] is True
    assert "云服务器" in edited["content"]
    assert "hasKey" in edited["content"]

    deleted = service.preview_operations(
        "cloud-demo",
        "dimension",
        source["content_hash"],
        [
            {
                "action": "delete",
                "entity_type": "class",
                "uri": "https://example.com/onto#Asset",
            }
        ],
    )
    assert deleted["impacts"][0]["reference_triples"] >= 2


def test_validation_detects_subclass_cycle(maintenance) -> None:
    service, _ = maintenance
    cycle = BASE_TTL + "\nex:Asset rdfs:subClassOf ex:Server .\n"
    result = service.validate(cycle)
    assert result["valid"] is False
    assert any(issue["code"] == "SUBCLASS_CYCLE" for issue in result["issues"])


def test_create_custom_module(maintenance) -> None:
    service, source_path = maintenance
    saved = service.save(
        "cloud-demo",
        "asset-extension",
        BASE_TTL,
        None,
        "导入新模块",
        create_new=True,
    )
    assert saved["created"] is True
    custom = source_path.parents[1] / "custom" / "asset-extension.ttl"
    assert custom.is_file()
    assert service.source("cloud-demo", "asset-extension")["content_hash"]
