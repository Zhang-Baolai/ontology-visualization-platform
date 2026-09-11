from __future__ import annotations

from rdflib import URIRef

from app.config import discover_catalog, resolve_source
from app.services.ontology_parser import OntologyParser


def test_catalog_discovers_both_domains_and_five_modules() -> None:
    catalog = discover_catalog()
    domains = {item["id"]: item for item in catalog["domains"]}

    assert set(domains) == {"service-demo", "cloud-demo"}
    assert [item["id"] for item in domains["cloud-demo"]["modules"]] == [
        "all",
        "dimension",
        "metric",
        "capability",
        "scenario",
    ]


def test_cloud_demo_dimension_graph_matches_frontend_contract() -> None:
    payload = OntologyParser().parse(resolve_source("cloud-demo", "dimension"))
    meta = payload["meta"]

    assert set(payload) == {"meta", "nodes", "edges", "warnings"}
    assert meta["total_classes"] == len(payload["nodes"]) == 6
    assert meta["total_datatype_properties"] == 4
    assert meta["total_object_properties"] == 4
    assert meta["total_edges"] == len(payload["edges"])
    assert any(edge["edge_type"] == "subClassOf" for edge in payload["edges"])
    assert any(edge["edge_type"] == "objectProperty" for edge in payload["edges"])
    assert any(edge["inferred"] for edge in payload["edges"])
    assert any(edge["inverse_of"] for edge in payload["edges"])
    assert any(node["datatype_properties"] for node in payload["nodes"])
    assert any(node["has_key"] for node in payload["nodes"])


def test_complete_ontology_follows_local_imports() -> None:
    payload = OntologyParser().parse(resolve_source("cloud-demo", "all"))
    meta = payload["meta"]

    assert meta["total_classes"] == 12
    assert len(meta["source_files"]) == 5
    assert meta["source_files"][0] == "ontologies/cloud-demo/data_ontology.ttl"
    assert all("mappings" not in path for path in meta["source_files"])


def test_local_imports_decode_spaces_and_stay_inside_domain(tmp_path) -> None:
    root = tmp_path / "example domain"
    root.mkdir()
    current = root / "data_ontology.ttl"
    imported = root / "nested module.ttl"
    resolve = OntologyParser._resolve_import
    assert resolve(URIRef(imported.as_uri()), current, root) == imported
    assert resolve(URIRef((tmp_path / "outside.ttl").as_uri()), current, root) is None
    assert resolve(URIRef("https://example.org/remote.ttl"), current, root) is None
    assert resolve(URIRef("file://remote-host/share/ontology.ttl"), current, root) is None
