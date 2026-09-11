from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.ontology_analysis_service import OntologyAnalysisService


client = TestClient(app)


def test_cross_module_graph_and_hierarchy() -> None:
    service = OntologyAnalysisService()
    graph = service.semantic_graph("cloud-demo", refresh=True)

    assert graph["meta"]["analysis_mode"] == "cross-module"
    assert set(graph["meta"]["module_counts"]) >= {
        "dimension",
        "metric",
        "capability",
        "scenario",
    }
    assert graph["meta"]["total_cross_module_edges"] > 0
    assert all("module" in node and "modules" in node for node in graph["nodes"])
    assert all("cross_module" in edge for edge in graph["edges"])

    hierarchy = service.hierarchy("cloud-demo")
    assert hierarchy["total_entries"] == len(graph["nodes"])
    assert hierarchy["root_ids"]


def test_neighborhood_path_impact_and_quality() -> None:
    service = OntologyAnalysisService()
    graph = service.semantic_graph("cloud-demo")
    connected = next(
        node for node in graph["nodes"] if any(
            edge["source"] == node["id"] or edge["target"] == node["id"]
            for edge in graph["edges"]
        )
    )
    neighbor = next(
        edge["target"] if edge["source"] == connected["id"] else edge["source"]
        for edge in graph["edges"]
        if edge["source"] == connected["id"] or edge["target"] == connected["id"]
    )

    neighborhood = service.neighborhood("cloud-demo", connected["id"], depth=2)
    assert neighborhood["nodes"][0]["distance"] == 0
    assert len(neighborhood["nodes"]) >= 2

    path = service.shortest_path("cloud-demo", connected["id"], neighbor)
    assert path["found"] is True
    assert path["hops"] == 1

    impact = service.impact("cloud-demo", connected["id"])
    assert impact["entity"]["id"] == connected["id"]
    assert impact["summary"]["total_references"] >= 1

    quality = service.quality("cloud-demo")
    assert quality["summary"]["total"] == len(quality["issues"])
    assert 0 <= quality["summary"]["score"] <= 100
    assert all(issue["severity"] in {"error", "warning", "info"} for issue in quality["issues"])


def test_analysis_api_contracts_and_missing_entity() -> None:
    graph_response = client.get(
        "/api/v1/ontology/analysis/graph", params={"domain": "cloud-demo"}
    )
    assert graph_response.status_code == 200
    graph = graph_response.json()

    source = graph["edges"][0]["source"]
    target = graph["edges"][0]["target"]
    path_response = client.get(
        "/api/v1/ontology/analysis/path",
        params={"domain": "cloud-demo", "source_uri": source, "target_uri": target},
    )
    assert path_response.status_code == 200
    assert path_response.json()["found"] is True

    quality_response = client.get(
        "/api/v1/ontology/analysis/quality", params={"domain": "cloud-demo"}
    )
    assert quality_response.status_code == 200
    assert "score" in quality_response.json()["summary"]

    missing = client.get(
        "/api/v1/ontology/analysis/impact",
        params={"domain": "cloud-demo", "entity_uri": "https://example.com/missing"},
    )
    assert missing.status_code == 404
