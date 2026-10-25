from __future__ import annotations

import hmac
from importlib.metadata import version
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from microtrace_core.results import RULES_VERSION

from . import ENGINE_API_VERSION
from .settings import Settings

SECRET_HEADER = "X-Engine-Secret"


def make_require_secret(settings: Settings):
    expected = settings.secret.encode("utf-8")

    def require_secret(
        x_engine_secret: str | None = Header(default=None, alias=SECRET_HEADER),
    ) -> None:
        given = (x_engine_secret or "").encode("utf-8")
        if not x_engine_secret or not hmac.compare_digest(given, expected):
            raise HTTPException(
                status_code=401, detail="Secret du moteur manquant ou invalide."
            )

    return require_secret


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="MicroTrace engine",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    require_secret = make_require_secret(settings)
    app.state.require_secret = require_secret

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "engine_api": ENGINE_API_VERSION,
            "engine_version": version("microtrace-engine"),
            "rules_version": RULES_VERSION,
        }

    @app.get(
        "/openapi.json",
        include_in_schema=False,
        dependencies=[Depends(require_secret)],
    )
    def openapi_schema() -> dict[str, Any]:
        return app.openapi()

    return app
