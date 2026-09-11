"""Cross-module ontology analysis endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.services.ontology_analysis_service import OntologyAnalysisService
from app.services.ontology_parser import OntologyParseError


router = APIRouter()
_service: OntologyAnalysisService | None = None


def get_service() -> OntologyAnalysisService:
    global _service
    if _service is None:
        _service = OntologyAnalysisService()
    return _service


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(
            status_code=404,
            detail={
                "code": "ANALYSIS_TARGET_NOT_FOUND",
                "message": "请求的领域或实体不存在，请刷新本体后重试。",
            },
        )
    if isinstance(exc, ValueError):
        return HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_ANALYSIS_REQUEST",
                "message": str(exc),
            },
        )
    if isinstance(exc, OntologyParseError):
        return HTTPException(
            status_code=500,
            detail={"code": "ONTOLOGY_PARSE_FAILED", "message": str(exc)},
        )
    return HTTPException(
        status_code=500,
        detail={
            "code": "ONTOLOGY_ANALYSIS_FAILED",
            "message": "本体语义分析失败，未修改任何本体文件。",
        },
    )


@router.get("/analysis/graph")
async def get_semantic_graph(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    refresh: bool = Query(False),
    service: OntologyAnalysisService = Depends(get_service),
) -> dict:
    try:
        return service.semantic_graph(domain, refresh=refresh)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/analysis/hierarchy")
async def get_hierarchy(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    refresh: bool = Query(False),
    service: OntologyAnalysisService = Depends(get_service),
) -> dict:
    try:
        return service.hierarchy(domain, refresh=refresh)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/analysis/neighborhood")
async def get_neighborhood(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    entity_uri: str = Query(..., min_length=3),
    depth: int = Query(1, ge=1, le=2),
    direction: Literal["incoming", "outgoing", "both"] = Query("both"),
    service: OntologyAnalysisService = Depends(get_service),
) -> dict:
    try:
        return service.neighborhood(domain, entity_uri, depth=depth, direction=direction)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/analysis/path")
async def get_shortest_path(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    source_uri: str = Query(..., min_length=3),
    target_uri: str = Query(..., min_length=3),
    directed: bool = Query(False),
    service: OntologyAnalysisService = Depends(get_service),
) -> dict:
    try:
        return service.shortest_path(domain, source_uri, target_uri, directed=directed)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/analysis/impact")
async def get_impact(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    entity_uri: str = Query(..., min_length=3),
    service: OntologyAnalysisService = Depends(get_service),
) -> dict:
    try:
        return service.impact(domain, entity_uri)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/analysis/quality")
async def get_quality_report(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    refresh: bool = Query(False),
    service: OntologyAnalysisService = Depends(get_service),
) -> dict:
    try:
        return service.quality(domain, refresh=refresh)
    except Exception as exc:
        raise _translate_error(exc) from exc
