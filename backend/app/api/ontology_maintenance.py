"""Safety-gated ontology editing, import, export and history endpoints."""

from __future__ import annotations

import io
import json
import zipfile
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.config import discover_catalog, resolve_source
from app.services.ontology_graph_service import OntologyGraphService
from app.services.ontology_maintenance_service import (
    MaintenanceConflictError,
    MaintenanceValidationError,
    OntologyMaintenanceService,
    VersionNotFoundError,
)


router = APIRouter()
_service: OntologyMaintenanceService | None = None
_graph_service: OntologyGraphService | None = None


class ContentBody(BaseModel):
    content: str


class PreviewBody(BaseModel):
    domain: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    module: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    content: str
    base_hash: str | None = None
    create_new: bool = False


class SaveBody(PreviewBody):
    reason: str | None = Field(default=None, max_length=160)


class EditOperation(BaseModel):
    action: Literal["upsert", "delete"]
    entity_type: Literal["class", "datatype_property", "object_property"]
    uri: str
    label: str | None = None
    comment: str | None = None
    parent_uris: list[str] = Field(default_factory=list)
    has_key_uris: list[str] = Field(default_factory=list)
    domain_uris: list[str] = Field(default_factory=list)
    range_uris: list[str] = Field(default_factory=list)
    sub_property_of: list[str] = Field(default_factory=list)
    inverse_of: str | None = None
    is_functional: bool = False


class OperationPreviewBody(BaseModel):
    domain: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    module: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    base_hash: str
    operations: list[EditOperation] = Field(min_length=1, max_length=30)


class RestoreBody(BaseModel):
    expected_hash: str


def get_service() -> OntologyMaintenanceService:
    global _service
    if _service is None:
        _service = OntologyMaintenanceService()
    return _service


def get_graph_service() -> OntologyGraphService:
    global _graph_service
    if _graph_service is None:
        _graph_service = OntologyGraphService()
    return _graph_service


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(
            status_code=404,
            detail={
                "code": "ONTOLOGY_SOURCE_NOT_FOUND",
                "message": "请求的领域、模块或文件不存在。",
            },
        )
    if isinstance(exc, FileExistsError):
        return HTTPException(
            status_code=409,
            detail={
                "code": "ONTOLOGY_MODULE_EXISTS",
                "message": "目标模块已经存在，请改用替换模式或更换模块标识。",
            },
        )
    if isinstance(exc, MaintenanceConflictError):
        return HTTPException(
            status_code=409,
            detail={"code": "ONTOLOGY_WRITE_CONFLICT", "message": str(exc)},
        )
    if isinstance(exc, MaintenanceValidationError):
        return HTTPException(
            status_code=422,
            detail={"code": "ONTOLOGY_VALIDATION_FAILED", "message": str(exc)},
        )
    if isinstance(exc, VersionNotFoundError):
        return HTTPException(
            status_code=404,
            detail={"code": "ONTOLOGY_VERSION_NOT_FOUND", "message": str(exc)},
        )
    if isinstance(exc, ValueError):
        return HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_ONTOLOGY_SELECTION",
                "message": "领域、模块或请求参数无效。",
            },
        )
    return HTTPException(
        status_code=500,
        detail={
            "code": "ONTOLOGY_MAINTENANCE_FAILED",
            "message": "本体维护操作失败，原文件未被覆盖。",
        },
    )


@router.get("/source")
async def get_source(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    module: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    service: OntologyMaintenanceService = Depends(get_service),
) -> dict:
    try:
        return service.source(domain, module)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/validate")
async def validate_content(
    body: ContentBody,
    service: OntologyMaintenanceService = Depends(get_service),
) -> dict:
    return service.validate(body.content)


@router.post("/preview")
async def preview_content(
    body: PreviewBody,
    service: OntologyMaintenanceService = Depends(get_service),
) -> dict:
    try:
        return service.preview_content(
            body.domain,
            body.module,
            body.content,
            body.base_hash,
            create_new=body.create_new,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/preview-operations")
async def preview_operations(
    body: OperationPreviewBody,
    service: OntologyMaintenanceService = Depends(get_service),
) -> dict:
    try:
        return service.preview_operations(
            body.domain,
            body.module,
            body.base_hash,
            [operation.model_dump() for operation in body.operations],
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/save")
async def save_content(
    body: SaveBody,
    service: OntologyMaintenanceService = Depends(get_service),
) -> dict:
    try:
        return service.save(
            body.domain,
            body.module,
            body.content,
            body.base_hash,
            body.reason,
            create_new=body.create_new,
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/versions")
async def list_versions(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    module: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    service: OntologyMaintenanceService = Depends(get_service),
) -> dict:
    try:
        return service.list_versions(domain, module)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.post("/versions/{version_id}/restore")
async def restore_version(
    version_id: str,
    body: RestoreBody,
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    module: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    service: OntologyMaintenanceService = Depends(get_service),
) -> dict:
    try:
        return service.restore(domain, module, version_id, body.expected_hash)
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/export/module")
async def export_module(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    module: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
    format: Literal["ttl", "json"] = Query("ttl"),
    maintenance: OntologyMaintenanceService = Depends(get_service),
    graphs: OntologyGraphService = Depends(get_graph_service),
) -> Response:
    try:
        if format == "json":
            payload = graphs.get_graph(domain, module, refresh=True)
            content = json.dumps(payload, ensure_ascii=False, indent=2)
            media_type = "application/json"
            suffix = "json"
        else:
            content = maintenance.source(domain, module)["content"]
            media_type = "text/turtle; charset=utf-8"
            suffix = "ttl"
        filename = f"{domain}-{module}.{suffix}"
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        raise _translate_error(exc) from exc


@router.get("/export/domain")
async def export_domain(
    domain: str = Query(..., pattern=r"^[a-z0-9][a-z0-9-]*$"),
) -> Response:
    try:
        catalog_domain = next(
            item for item in discover_catalog()["domains"] if item["id"] == domain
        )
        unique_sources = {}
        for module in catalog_domain["modules"]:
            source = resolve_source(domain, module["id"])
            unique_sources[source.path.resolve()] = source

        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for path, source in sorted(
                unique_sources.items(), key=lambda item: item[0].as_posix()
            ):
                relative = path.relative_to(source.domain_root).as_posix()
                bundle.writestr(relative, path.read_bytes())
        return Response(
            content=archive.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{domain}-ontologies.zip"'
            },
        )
    except StopIteration as exc:
        raise _translate_error(FileNotFoundError(domain)) from exc
    except Exception as exc:
        raise _translate_error(exc) from exc
