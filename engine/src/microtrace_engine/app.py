from __future__ import annotations

import base64
import hmac
import json
import logging
import secrets
from dataclasses import replace
from importlib.metadata import version
from typing import Any, TypeVar

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
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
from microtrace_core.results.tables import MAX_BYTES, RawTable, TableReadError, read_table
from pydantic import BaseModel, TypeAdapter, ValidationError
from pydantic.json_schema import models_json_schema
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from . import ENGINE_API_VERSION, errors
from .convert import (
    context_from_model,
    context_to_model,
    import_result_to_model,
    mapping_from_model,
    mapping_to_model,
    record_from_model,
    summary_to_models,
)
from .crossimport import cross_import_issues
from .errors import InputError, error_response, safe_errors
from .report import build_markdown, to_html
from .schemas import (
    DictionaryResponse,
    ErrorModel,
    ExampleResponse,
    ExistingKeyModel,
    HealthResponse,
    ImportResultModel,
    MappingModel,
    ReportRequest,
    ReportResponse,
    StudyContextModel,
    SummaryRequest,
    SummaryResponse,
    TableReadResponse,
)
from .settings import Settings
from .uploads import TooLarge, read_upload, sha256_hex, sheet_names

PREVIEW_ROWS = 20

logger = logging.getLogger("microtrace_engine")

SECRET_HEADER = "X-Engine-Secret"
SECRET_INVALID = "Secret du moteur manquant ou invalide."
OPEN_PATHS = frozenset({"/health"})
MB = 1024 * 1024
EXISTING_MAX_BYTES = 20 * MB
# declared body limit: the file (MAX_BYTES) plus ``existing``, form fields and multipart framing
MAX_REQUEST_BYTES = MAX_BYTES + 25 * MB


def _secret_ok(given: str | None, expected: bytes) -> bool:
    return bool(given) and hmac.compare_digest((given or "").encode("utf-8"), expected)


class SecretAndSizeGate:
    """Pure ASGI middleware run before any body is read: a missing or wrong
    ``X-Engine-Secret`` (every path but /health) gets 401, a declared
    ``Content-Length`` above ``max_bytes`` gets 413."""

    def __init__(self, app: ASGIApp, secret: str, max_bytes: int) -> None:
        self.app = app
        self.expected = secret.encode("utf-8")
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            if scope["path"] not in OPEN_PATHS and not _secret_ok(
                    headers.get(SECRET_HEADER), self.expected):
                return await error_response(401, SECRET_INVALID)(scope, receive, send)
            declared = headers.get("content-length", "")
            if declared.isdigit() and int(declared) > self.max_bytes:
                limit = self.max_bytes // MB
                return await error_response(
                    413, f"Requête trop volumineuse (limite : {limit} Mo).")(
                    scope, receive, send)
        await self.app(scope, receive, send)


def make_require_secret(settings: Settings):
    expected = settings.secret.encode("utf-8")

    def require_secret(
        x_engine_secret: str | None = Header(default=None, alias=SECRET_HEADER),
    ) -> None:
        # defence in depth: SecretAndSizeGate has already checked the header
        if not _secret_ok(x_engine_secret, expected):
            raise HTTPException(status_code=401, detail=SECRET_INVALID)

    return require_secret


def _hidden_names(columns: tuple[str, ...]) -> dict[str, str]:
    """Header -> unique safe display name.

    A header holding contact data or longer than MAX_SCAN_CHARS is shown by position
    (B1's header_label rule). Displayed names are guaranteed unique. A file whose headers
    hold contact data is blocked by the import check (E_PII_COLUMN); a long header is only
    masked, not blocked: the file can still be imported, a mapping naming that column by its
    displayed name finds no such column, and B1 never echoes it in an issue.
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
    """Bounded read then parse (off the event loop); TableReadError messages are French
    and hold no cell value, any other exception becomes the generic 500."""
    try:
        data = await read_upload(file)
        return data, await run_in_threadpool(read_table, data, file.filename or "", sheet)
    except TableReadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


T = TypeVar("T")
_EXISTING = TypeAdapter(list[ExistingKeyModel])
_MAPPING = TypeAdapter(MappingModel)
_CONTEXT = TypeAdapter(StudyContextModel)


def _parse_json(raw: str | bytes, adapter: TypeAdapter[T], label: str) -> T:
    """Parse a JSON part; errors are French, located, and never echo the submitted content."""
    try:
        return adapter.validate_json(raw)
    except ValidationError as exc:
        raise InputError(f"Le champ « {label} » est invalide (JSON ou schéma).",
                         safe_errors(exc.errors(), (label,))) from None


def _domain(fn, *args):
    """B1 / engine conversions of client input: their ValueError are deliberate French
    messages (StudyContext, DetectionLimit, unit codes) and are returned as 422."""
    try:
        return fn(*args)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorModel, "description": "Secret du moteur manquant ou invalide"},
    413: {"model": ErrorModel, "description": "Requête trop volumineuse"},
    422: {"model": ErrorModel, "description": "Entrée invalide (message français, et "
                                              "emplacements pour une erreur de schéma)"},
    500: {"model": ErrorModel, "description": "Erreur interne du moteur"},
}
# JSON carried as multipart parts: registered in components.schemas for code generation
PART_MODELS: tuple[type[BaseModel], ...] = (MappingModel, StudyContextModel, ExistingKeyModel)
REF = "#/components/schemas/{model}"


def _json_part(model: type[BaseModel], what: str) -> dict[str, Any]:
    return {"description": f"{what} : JSON conforme au schéma {model.__name__}",
            "json_schema_extra": {"contentMediaType": "application/json",
                                  "contentSchema": {"$ref": REF.format(model=model.__name__)}}}


IMPORTS_CHECK_DOC = (
    "Contrôle d'import (règles B1) et cohérence avec les imports actifs de l'étude.\n\n"
    "Corps multipart :\n"
    "- `file` : fichier CSV ou XLSX ;\n"
    "- `sheet` : feuille à lire (XLSX, facultatif) ;\n"
    "- `mapping` : champ texte, JSON conforme au schéma `MappingModel` ;\n"
    "- `context` : champ texte, JSON conforme au schéma `StudyContextModel` ;\n"
    "- `existing` : partie fichier facultative (JSON, 20 Mo au plus), liste de "
    "`ExistingKeyModel` déjà enregistrés dans l'étude."
)


def _register_part_models(schema: dict[str, Any]) -> None:
    _, top = models_json_schema([(m, "validation") for m in PART_MODELS], ref_template=REF)
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    for name, definition in top.get("$defs", {}).items():
        components.setdefault(name, definition)


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="MicroTrace engine",
        version=version("microtrace-engine"),
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        responses=ERROR_RESPONSES,
        generate_unique_id_function=lambda route: route.name,
    )
    base_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            _register_part_models(base_openapi())
        return app.openapi_schema  # type: ignore[return-value]

    app.openapi = openapi  # type: ignore[method-assign]
    errors.install(app)
    app.add_middleware(SecretAndSizeGate, secret=settings.secret, max_bytes=MAX_REQUEST_BYTES)

    require_secret = make_require_secret(settings)
    app.state.require_secret = require_secret

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            engine_api=ENGINE_API_VERSION,
            engine_version=version("microtrace-engine"),
            rules_version=RULES_VERSION,
        )

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
            sheets = await run_in_threadpool(sheet_names, data, filename)
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
        m = mapping_to_model(await run_in_threadpool(suggest_mapping, table))
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
        description=IMPORTS_CHECK_DOC,
    )
    async def imports_check(
        file: UploadFile = File(..., description="Fichier CSV ou XLSX"),
        sheet: str | None = Form(None, description="Feuille à lire (XLSX)"),
        mapping: str = Form(..., **_json_part(MappingModel, "Correspondance des colonnes")),
        context: str = Form(..., **_json_part(StudyContextModel, "Contexte de l'étude")),
        existing: UploadFile | None = File(
            None, description="Fichier JSON facultatif (20 Mo au plus) : liste de "
                              "ExistingKeyModel"),
    ) -> ImportResultModel:
        mapping_m = _parse_json(mapping, _MAPPING, "mapping")
        context_m = _parse_json(context, _CONTEXT, "context")
        existing_m: list[ExistingKeyModel] = []
        if existing is not None:
            try:
                raw = await read_upload(existing, EXISTING_MAX_BYTES)
            except TooLarge:
                raise HTTPException(
                    status_code=422,
                    detail=f"La partie « existing » dépasse la limite de "
                           f"{EXISTING_MAX_BYTES // MB} Mo.") from None
            if raw.strip():
                existing_m = _parse_json(raw, _EXISTING, "existing")
        ctx = _domain(context_from_model, context_m)
        mp = _domain(mapping_from_model, mapping_m)
        data, table = await _load(file, sheet)

        def check() -> ImportResultModel:
            result = run_import(table, mp, ctx)
            sample_col = mp.field_columns.get("sample_id")
            visible = _hidden_names(table.columns).get(sample_col or "") == sample_col
            extra = cross_import_issues((*result.records, *result.qc_records), existing_m,
                                        column=sample_col if visible else None)
            if extra:
                result = replace(result, records=(), qc_records=(),
                                 issues=result.issues + tuple(extra))
            return import_result_to_model(
                result, engine_version=version("microtrace-engine"),
                sha256=sha256_hex(data), sheet=table.sheet)

        return await run_in_threadpool(check)

    @app.post(
        "/summary",
        response_model=SummaryResponse,
        dependencies=[Depends(require_secret)],
    )
    def summary(req: SummaryRequest) -> SummaryResponse:
        # sync route: FastAPI runs it in the threadpool
        records = [_domain(record_from_model, r) for r in req.records]
        samples, freqs, stats = summary_to_models(
            aggregate_aliquots(records),
            quantification_frequency(records),
            describe(records),
        )
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
        # sync route: FastAPI runs it in the threadpool
        ctx = _domain(context_from_model, req.context)
        records = [_domain(record_from_model, r) for r in req.records]
        qc = [_domain(record_from_model, r) for r in req.qc_records]
        markdown = build_markdown(req, ctx, records, qc)
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


def openapi_json() -> str:
    """The OpenAPI schema as committed in engine/openapi.json (no secret needed)."""
    schema = create_app(Settings(secret=secrets.token_urlsafe(32))).openapi()
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
