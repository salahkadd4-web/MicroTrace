"""French error responses that never echo submitted content.

Every error body is ``{"detail": "<message français>"}``, plus ``errors`` (location and
type only, never the input, context or pydantic message) for validation errors. A location
segment that may come from user data (a dict key, an unknown field name) becomes ``"*"``.
"""
from __future__ import annotations

import http
import logging
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import schemas

logger = logging.getLogger("microtrace_engine")

INVALID_REQUEST = "Requête invalide : corps ou champs non conformes."
INTERNAL_ERROR = "Erreur interne du moteur."
BAD_MULTIPART = ("Corps de requête multipart illisible (partie mal formée, ou champ texte de "
                 "plus de 1 Mo : envoyer les gros contenus JSON comme fichier).")
_FRENCH = {404: "Ressource introuvable.", 405: "Méthode non autorisée."}

# dicts whose keys are user data (file headers, field names chosen by the client)
DICT_FIELDS = frozenset({"field_columns", "polymer_columns", "constants", "counts_by_status"})
_ROOTS = frozenset({"body", "query", "header", "path", "cookie", "[key]",
                    "file", "sheet", "mapping", "context", "existing"})


def _known_names() -> frozenset[str]:
    names: set[str] = set(_ROOTS)
    for obj in vars(schemas).values():
        if isinstance(obj, type) and issubclass(obj, BaseModel):
            names.update(obj.model_fields)
    return frozenset(names)


KNOWN_NAMES = _known_names()


def safe_loc(loc: Iterable[Any]) -> list[str | int]:
    out: list[str | int] = []
    prev: object = None
    for seg in loc:
        if isinstance(seg, int) and not isinstance(seg, bool):
            out.append(seg)
        elif prev in DICT_FIELDS or seg not in KNOWN_NAMES:
            out.append("*")
        else:
            out.append(str(seg))
        prev = seg
    return out


def safe_errors(errors: Sequence[Any], prefix: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Only ``loc`` (sanitised) and ``type`` of each pydantic / FastAPI error."""
    return [{"loc": safe_loc((*prefix, *e.get("loc", ()))), "type": str(e.get("type", ""))}
            for e in errors]


class InputError(Exception):
    """A 422 with a French message and, optionally, sanitised error locations."""

    def __init__(self, detail: str, errors: list[dict[str, Any]] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.errors = errors


def error_response(status: int, detail: str, errors: list[dict[str, Any]] | None = None,
                   headers: dict[str, str] | None = None) -> JSONResponse:
    content: dict[str, Any] = {"detail": detail}
    if errors is not None:
        content["errors"] = errors
    return JSONResponse(status_code=status, content=content, headers=headers)


def install(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_request, exc: RequestValidationError) -> JSONResponse:
        return error_response(422, INVALID_REQUEST, safe_errors(exc.errors()))

    @app.exception_handler(InputError)
    async def _input_error(_request, exc: InputError) -> JSONResponse:
        return error_response(422, exc.detail, exc.errors)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 400:
            # Starlette / FastAPI body parsing ("Part exceeded…", malformed multipart):
            # the parser's English message is not echoed
            return error_response(422, BAD_MULTIPART)
        detail = exc.detail
        if exc.status_code in _FRENCH and detail == http.HTTPStatus(exc.status_code).phrase:
            detail = _FRENCH[exc.status_code]
        return error_response(exc.status_code, str(detail), headers=exc.headers)

    @app.middleware("http")
    async def _generic_errors(request, call_next):
        # Unexpected errors: generic 500; log only the exception type and the route
        # (the message may hold a cell value). A middleware is used rather than an
        # Exception handler, which Starlette re-raises to the server (traceback logged).
        try:
            return await call_next(request)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Erreur interne : %s sur %s", type(exc).__name__, request.url.path
            )
            return error_response(500, INTERNAL_ERROR)
