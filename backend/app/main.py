"""FastAPI entry point for the standalone ontology visualizer backend."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.ontology_analysis import router as analysis_router
from app.api.ontology_graph import router as ontology_router
from app.api.ontology_maintenance import router as maintenance_router
from app.api.r2rml_mapping import router as r2rml_router
from app.config import cors_origins


app = FastAPI(
    title="Ontology Visualization API",
    version=__version__,
    description="Local TTL ontology graph and safe maintenance API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
async def health() -> dict:
    return {"status": "ok", "version": __version__}


app.include_router(
    ontology_router,
    prefix="/api/v1/ontology",
    tags=["ontology"],
)
app.include_router(
    maintenance_router,
    prefix="/api/v1/ontology",
    tags=["ontology-maintenance"],
)
app.include_router(
    analysis_router,
    prefix="/api/v1/ontology",
    tags=["ontology-analysis"],
)
app.include_router(
    r2rml_router,
    prefix="/api/v1/mappings",
    tags=["r2rml-mappings"],
)
