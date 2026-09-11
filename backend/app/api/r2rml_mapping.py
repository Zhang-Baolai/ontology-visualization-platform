"""Read-only R2RML discovery and analysis endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.services.r2rml_mapping_service import R2RMLMappingService


router = APIRouter()
service = R2RMLMappingService()


@router.get("/catalog")
async def mapping_catalog(refresh: bool = Query(False)) -> dict:
    return service.catalog(refresh=refresh)


@router.get("/analysis")
async def mapping_analysis(
    domain: str | None = Query(None, pattern=r"^[a-z0-9][a-z0-9-]*$"),
    include_drafts: bool = Query(False),
    refresh: bool = Query(False),
) -> dict:
    try:
        return service.analysis(
            domain=domain,
            include_drafts=include_drafts,
            refresh=refresh,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
