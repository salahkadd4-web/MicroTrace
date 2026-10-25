from __future__ import annotations

import hmac
from importlib.metadata import version
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from microtrace_core.results import RULES_VERSION, suggest_mapping
from microtrace_core.results.contact import MAX_SCAN_CHARS, header_has_contact
from microtrace_core.results.tables import RawTable, TableReadError, read_table

from . import ENGINE_API_VERSION
from .convert import mapping_to_model
from .schemas import MappingModel, TableReadResponse
from .settings import Settings
from .uploads import read_upload, sha256_hex, sheet_names

PREVIEW_ROWS = 20

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


def _hidden_names(columns: tuple[str, ...]) -> dict[str, str]:
    """Header -> safe display name (contact data or over-long headers become by position)."""
    return {
        c: (f"colonne n° {k}" if len(c) > MAX_SCAN_CHARS or header_has_contact(c) else c)
        for k, c in enumerate(columns, 1)
    }


async def _load(file: UploadFile, sheet: str | None) -> tuple[bytes, RawTable]:
    try:
        data = await read_upload(file)
        return data, read_table(data, file.filename or "", sheet)
    except (TableReadError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


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

    @app.post(
        "/tables/read",
        response_model=TableReadResponse,
        dependencies=[Depends(require_secret)],
    )
    async def tables_read(
        file: UploadFile = File(...), sheet: str | None = Form(None)
    ) -> TableReadResponse:
        data, table = await _load(file, sheet)
        filename = file.filename or ""
        try:
            sheets = sheet_names(data, filename)
        except TableReadError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        safe = _hidden_names(table.columns)
        return TableReadResponse(
            filename=filename,
            sha256=sha256_hex(data),
            size=len(data),
            sheet=table.sheet,
            sheets=sheets,
            columns=[safe[c] for c in table.columns],
            preview=[
                {safe[c]: row[c] for c in table.columns}
                for row in table.rows[:PREVIEW_ROWS]
            ],
            n_rows=len(table.rows),
        )

    @app.post(
        "/mapping/suggest",
        response_model=MappingModel,
        dependencies=[Depends(require_secret)],
    )
    async def mapping_suggest(
        file: UploadFile = File(...), sheet: str | None = Form(None)
    ) -> MappingModel:
        _, table = await _load(file, sheet)
        safe = _hidden_names(table.columns)
        m = mapping_to_model(suggest_mapping(table))
        return m.model_copy(
            update={
                "field_columns": {
                    k: safe.get(v, v) for k, v in m.field_columns.items()
                },
                "polymer_columns": {
                    safe.get(k, k): v for k, v in m.polymer_columns.items()
                },
            }
        )

    return app
