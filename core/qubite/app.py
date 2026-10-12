"""Small typed API foundation. Construction/startup perform no network or DDL."""
from typing import Literal

from fastapi import FastAPI, Response
from pydantic import BaseModel, ConfigDict

from . import __version__
from .config import ConfigurationError, Settings
from .migrations import MigrationError, check


class Health(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: Literal["qubite-core"] = "qubite-core"
    api_version: Literal["v1"] = "v1"
    status: Literal["ok"] = "ok"


class Readiness(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: Literal["qubite-core"] = "qubite-core"
    api_version: Literal["v1"] = "v1"
    status: Literal["ready", "not_ready"]
    storage: Literal["postgresql"] = "postgresql"
    schema_version: str | None = None
    code: Literal["ready", "storage_not_configured", "storage_not_ready"]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings.from_env()
    app = FastAPI(title="Qubite Core", version=__version__, docs_url=None, redoc_url=None,
                  openapi_url="/api/v1/openapi.json")

    @app.get("/api/v1/health/live", response_model=Health, operation_id="core_liveness", tags=["health"])
    def live() -> Health:
        return Health()

    @app.get("/api/v1/health/ready", response_model=Readiness, operation_id="core_readiness", tags=["health"],
             responses={503: {"model": Readiness, "description": "Storage unavailable, unconfigured or migration not current"}})
    def ready(response: Response) -> Readiness:
        response.headers["Cache-Control"] = "no-store"
        if settings.database_url is None:
            response.status_code = 503
            return Readiness(status="not_ready", code="storage_not_configured")
        try:
            version = check(settings)
        except (ConfigurationError, MigrationError):
            response.status_code = 503
            return Readiness(status="not_ready", code="storage_not_ready")
        return Readiness(status="ready", schema_version=version, code="ready")

    return app
