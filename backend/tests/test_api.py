from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_and_catalog() -> None:
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "version": "1.5.3"}

    response = client.get("/api/v1/ontology/catalog")
    assert response.status_code == 200
    assert {domain["id"] for domain in response.json()["domains"]} == {
        "service-demo",
        "cloud-demo",
    }


def test_graph_endpoint_and_cache_refresh() -> None:
    response = client.get(
        "/api/v1/ontology/graph",
        params={"domain": "cloud-demo", "module": "dimension", "refresh": "true"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["domain"] == "cloud-demo"
    assert payload["meta"]["module"] == "dimension"
    assert payload["meta"]["total_nodes"] == len(payload["nodes"])


def test_invalid_selection_is_rejected_without_path_access() -> None:
    invalid_key = client.get(
        "/api/v1/ontology/graph",
        params={"domain": "../cloud-demo", "module": "dimension"},
    )
    assert invalid_key.status_code == 422

    missing = client.get(
        "/api/v1/ontology/graph",
        params={"domain": "unknown", "module": "dimension"},
    )
    assert missing.status_code == 404


def test_local_frontend_origin_is_allowed() -> None:
    response = client.options(
        "/api/v1/ontology/catalog",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_validate_endpoint_rejects_invalid_turtle() -> None:
    response = client.post(
        "/api/v1/ontology/validate",
        json={"content": "@prefix ex: <https://example.com/> . ex:Broken a"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert payload["errors"] == 1
    assert payload["issues"][0]["code"] == "TURTLE_SYNTAX_ERROR"


def test_source_and_export_endpoints() -> None:
    source = client.get(
        "/api/v1/ontology/source",
        params={"domain": "cloud-demo", "module": "dimension"},
    )
    assert source.status_code == 200
    assert source.json()["content_hash"]
    assert "owl:Class" in source.json()["content"]

    exported = client.get(
        "/api/v1/ontology/export/module",
        params={"domain": "cloud-demo", "module": "dimension", "format": "json"},
    )
    assert exported.status_code == 200
    assert exported.json()["meta"]["module"] == "dimension"
