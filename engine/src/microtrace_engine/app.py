from __future__ import annotations

import hmac
import base64
import logging
from dataclasses import replace
from importlib.metadata import version
from typing import Any, TypeVar

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from microtrace_core.results import (
    AGGREGATION_RULE_FR,
    LESLIE_LIKE_FILENAME,
    RULES_VERSION,
    aggregate_aliquots,
    data_dictionary_csv,
    data_dictionary_markdown,
    describe,
    leslie_like_context,
    leslie_like_csv,
    leslie_like_mapping,
    quantification_frequency,
    run_import,
    suggest_mapping,
)
from microtrace_core.results.contact import header_label
from microtrace_core.results.tables import RawTable, TableReadError, read_table

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter, ValidationError

from . import ENGINE_API_VERSION
from .convert import (
    context_from_model,
    context_to_model,
    record_from_model,
    summary_to_models,
    import_result_to_model,
    mapping_from_model,
    mapping_to_model,
)
from .crossimport import cross_import_issues
from .report import build_markdown, to_html
from .schemas import (
    DictionaryResponse,
    ExampleResponse,
    ReportRequest,
    ReportResponse,
    SummaryRequest,
    SummaryResponse,
    ExistingKeyModel,
    ImportResultModel,
    MappingModel,
    StudyContextModel,
    TableReadResponse,
)
from .settings import Settings
from .uploads import read_upload, sha256_hex, sheet_names

PREVIEW_ROWS = 20

logger = logging.getLogger("microtrace_engine")

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
    """Header -> unique safe display name.

    A header holding contact data or longer than MAX_SCAN_CHARS is shown by position
    (B1's header_label rule). Displayed names are guaranteed unique. A mapping that refers
    to a hidden column cannot be applied (such files are blocked by the PII check).
    """
    hidden = {
        c: f"colonne n° {k}"
        for k, c in enumerate(columns, 1)
        if header_label(c, k).startswith("colonne n°")
    }
    taken = {c for c in columns if c not in hidden}
    out: dict[str, str] = {}
    for c in columns:
        if c not in hidden:
            out[c] = c
            continue
        name = hidden[c]
        if name in taken:
            name = f"{name} (masquée)"
        base, n = name, 1
        while name in taken:
            n += 1
            name = f"{base} #{n}"
        taken.add(name)
        out[c] = name
    return out


async def _load(file: UploadFile, sheet: str | None) -> tuple[bytes, RawTable]:
    try:
        data = await read_upload(file)
        return data, read_table(data, file.filename or "", sheet)
    except (TableReadError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


T = TypeVar("T")


def _parse_json(raw: str | None, adapter: TypeAdapter[T], label: str) -> T:
    """Parse a JSON form field; errors are French and never echo the submitted content."""
    try:
        return adapter.validate_json(raw if raw is not None else "")
    except ValidationError:
        raise HTTPException(
            status_code=422, detail=f"Le champ « {label} » est invalide (JSON ou schéma)."
        ) from None


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="MicroTrace engine",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_request, _exc: RequestValidationError) -> JSONResponse:
        # French, and never echoes the submitted content.
        return JSONResponse(
            status_code=422, content={"detail": "Requête invalide : corps ou champs non conformes."}
        )

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
            return JSONResponse(
                status_code=500, content={"detail": "Erreur interne du moteur."}
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
                    k: v
                    for k, v in m.polymer_columns.items()
                    if k not in table.columns or safe[k] == k
                },
            }
        )

    @app.post(
        "/imports/check",
        response_model=ImportResultModel,
        dependencies=[Depends(require_secret)],
    )
    async def imports_check(
        file: UploadFile = File(...),
        sheet: str | None = Form(None),
        mapping: str = Form(...),
        context: str = Form(...),
        existing: str | None = Form(None),
    ) -> ImportResultModel:
        mapping_m = _parse_json(mapping, TypeAdapter(MappingModel), "mapping")
        context_m = _parse_json(context, TypeAdapter(StudyContextModel), "context")
        existing_m = (
            _parse_json(existing, TypeAdapter(list[ExistingKeyModel]), "existing")
            if existing and existing.strip()
            else []
        )
        try:
            ctx = context_from_model(context_m)
            mp = mapping_from_model(mapping_m)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        _, table = await _load(file, sheet)
        try:
            result = run_import(table, mp, ctx)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        sample_col = mp.field_columns.get("sample_id")
        visible = _hidden_names(table.columns).get(sample_col or "") == sample_col
        extra = cross_import_issues((*result.records, *result.qc_records), existing_m,
                                    column=sample_col if visible else None)
        if extra:
            result = replace(
                result,
                records=(),
                qc_records=(),
                issues=result.issues + tuple(extra),
            )
        return import_result_to_model(result)

    @app.post(
        "/summary",
        response_model=SummaryResponse,
        dependencies=[Depends(require_secret)],
    )
    def summary(req: SummaryRequest) -> SummaryResponse:
        try:
            records = [record_from_model(r) for r in req.records]
            samples, freqs, stats = summary_to_models(
                aggregate_aliquots(records),
                quantification_frequency(records),
                describe(records),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        return SummaryResponse(
            frequencies=freqs,
            stats=stats,
            samples=samples,
            aggregation_rule=AGGREGATION_RULE_FR,
        )

    @app.post(
        "/report",
        response_model=ReportResponse,
        dependencies=[Depends(require_secret)],
    )
    def report(req: ReportRequest) -> ReportResponse:
        try:
            context_from_model(req.context)
            markdown = build_markdown(req)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        return ReportResponse(markdown=markdown, html=to_html(markdown, req.study.title))

    @app.get(
        "/dictionary",
        response_model=DictionaryResponse,
        dependencies=[Depends(require_secret)],
    )
    def dictionary() -> DictionaryResponse:
        return DictionaryResponse(
            csv=data_dictionary_csv(), markdown=data_dictionary_markdown()
        )

    @app.get(
        "/examples/leslie-like",
        response_model=ExampleResponse,
        dependencies=[Depends(require_secret)],
    )
    def example_leslie_like() -> ExampleResponse:
        return ExampleResponse(
            filename=LESLIE_LIKE_FILENAME,
            csv_base64=base64.b64encode(leslie_like_csv()).decode("ascii"),
            context=context_to_model(leslie_like_context()),
            mapping=mapping_to_model(leslie_like_mapping()),
        )

    return app
