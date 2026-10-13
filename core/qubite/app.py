"""Small typed API foundation. Construction/startup perform no network or DDL."""
from typing import Literal

from fastapi import FastAPI, Response, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from . import __version__
from .config import ConfigurationError, Settings
from .migrations import MigrationError, check
from .identity.auth.http import AuthGuard
from .identity.auth.routes import create_router
from .identity.auth.store import AuthError
from .identity.oauth.providers import Exchange
from .identity.oauth.routes import create_router as oauth_router
from .identity.challenges.routes import create_router as challenge_router
from .policy.routes import create_router as policy_router


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


def create_app(settings: Settings | None = None, *, auth_clock=None, oauth_transport=None, mail_transport=None) -> FastAPI:
    settings = settings if settings is not None else Settings.from_env()
    app = FastAPI(title="Qubite Core", version=__version__, docs_url=None, redoc_url=None,
                  openapi_url="/api/v1/openapi.json")
    app.add_middleware(AuthGuard, settings=settings)
    app.include_router(create_router(settings, auth_clock))
    app.include_router(policy_router(settings, auth_clock))
    app.include_router(challenge_router(settings, auth_clock, mail_transport))
    app.include_router(oauth_router(settings,auth_clock,Exchange(transport=oauth_transport,network_enabled=settings.oauth_network_enabled)))

    @app.exception_handler(AuthError)
    async def auth_error(request: Request, error: AuthError):
        headers = {"Cache-Control": "no-store"}
        if error.status == 429:
            headers["Retry-After"] = "300"
        response = JSONResponse({"code": error.code}, status_code=error.status, headers=headers)
        if error.status == 401 and error.code == "unauthenticated":
            # Expired/revoked cookies must not block the next anonymous login challenge.
            # A wrong password during reauth is invalid_credentials and keeps the session.
            response.delete_cookie(settings.session_cookie, path="/", httponly=True,
                                   secure=not settings.auth_local_http, samesite="lax")
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # Default validation errors can include plaintext password/body values.
        return JSONResponse({"code": "invalid_request"}, status_code=400,
                            headers={"Cache-Control": "no-store"})

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
