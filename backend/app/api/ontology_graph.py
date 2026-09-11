"""Read-only ontology catalog and graph endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.services.ontology_graph_service import OntologyGraphService
from app.services.ontology_parser import OntologyParseError


router = APIRouter()
_service: OntologyGraphService | None = None


def get_service() -> OntologyGraphService:
    global _service
    if _service is None:
        _service = OntologyGraphService()
    return _service


@router.get("/catalog")
async def get_catalog(
    service: OntologyGraphService = Depends(get_service),
) -> dict:
    """Return the domains and modules currently present on disk."""

    return service.catalog()


@router.get("/graph")
async def get_ontology_graph(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    module: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    refresh: bool = Query(False, description="Ignore the in-memory cache once"),
    service: OntologyGraphService = Depends(get_service),
) -> dict:
    """Return ``meta / nodes / edges / warnings`` for one ontology module."""

    try:
        return service.get_graph(domain, module, refresh=refresh)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "ONTOLOGY_SOURCE_NOT_FOUND",
                "message": "请求的领域或模块不存在。请先刷新本体目录。",
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_ONTOLOGY_SELECTION",
                "message": "领域或模块参数无效。",
            },
        ) from exc
    except OntologyParseError as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "ONTOLOGY_PARSE_FAILED",
                "message": str(exc),
            },
        ) from exc
