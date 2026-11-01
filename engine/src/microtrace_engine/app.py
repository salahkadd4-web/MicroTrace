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
from microtrace_core.imaging.model import CorrectionError, ScaleMismatch, analyze
from microtrace_core.imaging.reading import MAX_IMAGE_BYTES, ImageReadError, decode_image
from microtrace_core.results import (
    AGGREGATION_RULE_FR,
    LESLIE_LIKE_FILENAME,
    RULES_VERSION,
    aggregate_aliquots,
    assess_quality,
    context_issues,
    data_dictionary_csv,
    data_dictionary_markdown,
    describe,
    LESLIE_2022_FILENAME,
    leslie_2022_context,
    leslie_2022_csv,
    leslie_2022_mapping,
    leslie_like_context,
    leslie_like_csv,
    leslie_like_mapping,
    quantification_frequency,
    run_import,
    suggest_mapping,
)
from microtrace_core.results.contact import header_label
from microtrace_core.results.tables import MAX_BYTES, RawTable, TableReadError, read_table
from microtrace_core.spectral.model import SpectralQuery, identify
from microtrace_core.spectral.reading import (
    MAX_SPECTRUM_BYTES,
    SpectrumReadError,
    parse_two_columns,
)
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
    blank_from_model,
    mapping_to_model,
    quality_record_from_model,
    quality_result_to_model,
    record_from_model,
    summary_to_models,
)
from .crossimport import cross_import_issues
from .errors import InputError, error_response, safe_errors
from . import image_text
from .image import (
    ImageModelStore,
    parse_scale,
    read_image_lock,
    recorded_problem,
    to_validated,
)
from .image import to_model_info as to_image_model_info
from .image import to_response as to_image_response
from .report import build_markdown, to_html
from .schemas import (
    DictionaryResponse,
    ErrorModel,
    ExampleResponse,
    ExistingKeyModel,
    HealthResponse,
    ImageAnalyzeResponse,
    ImageModelInfo,
    ImageValidatedSummary,
    ImageValidateRequest,
    ImportResultModel,
    MappingModel,
    QualityRequest,
    QualityResponse,
    ReportRequest,
    ReportResponse,
    StudyContextModel,
    SpectralIdentifyResponse,
    SpectralModelInfo,
    SpectralParsedModel,
    SummaryRequest,
    SummaryResponse,
    TableReadResponse,
    ValidateResponse,
)
from .settings import Settings
from .spectral import (
    ModelLock,
    ModelState,
    SpectralModelStore,
    read_lock,
    to_model_info,
    to_response,
    validate_params,
)
from .spectral_text import UNAVAILABLE, read_error_message
from .uploads import TooLarge, read_upload, sha256_hex, sheet_names

PREVIEW_ROWS = 20
DUPLICATE_MEASUREMENTS = ("Mesures en double dans la requête "
                          "(même fichier, feuille, ligne et colonne).")

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


def create_app(settings: Settings, spectral_lock: ModelLock | None = None,
               image_lock: ModelLock | None = None) -> FastAPI:
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
    # the weights are read lazily, on the first spectral request: the engine always starts
    spectral_store = SpectralModelStore(settings.models_dir, spectral_lock or read_lock())
    app.state.spectral_store = spectral_store
    image_store = ImageModelStore(settings.models_dir, image_lock or read_image_lock())
    app.state.image_store = image_store
    # Pillow logs the raw value of every TIFF tag at DEBUG (operator names, comments): never
    logging.getLogger("PIL").setLevel(logging.WARNING)

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
        "/context/validate",
        response_model=ValidateResponse,
        dependencies=[Depends(require_secret)],
    )
    def context_validate(ctx: StudyContextModel) -> ValidateResponse:
        # sync route: FastAPI runs it in the threadpool; B1 decides, not the web app
        problems = [i for i in context_issues(_domain(context_from_model, ctx))
                    if i.severity == "error"]
        if problems:
            raise HTTPException(status_code=422, detail=problems[0].message)
        return ValidateResponse(ok=True)

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
        "/quality",
        response_model=QualityResponse,
        dependencies=[Depends(require_secret)],
    )
    def quality(req: QualityRequest) -> QualityResponse:
        # sync route: FastAPI runs it in the threadpool
        records = [_domain(quality_record_from_model, r) for r in req.records]
        identities = {(x.ref.file_sha256, x.ref.sheet, x.ref.source_row, x.ref.source_column)
                      for x in records}
        if len(identities) != len(records):
            raise HTTPException(status_code=422, detail=DUPLICATE_MEASUREMENTS)
        blanks = [blank_from_model(b) for b in req.qc_summaries]
        result = assess_quality(records, blanks)
        return quality_result_to_model(result, req.blank_corrected)

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

    @app.get(
        "/examples/leslie-2022",
        response_model=ExampleResponse,
        dependencies=[Depends(require_secret)],
    )
    def example_leslie_2022() -> ExampleResponse:
        return ExampleResponse(
            filename=LESLIE_2022_FILENAME,
            csv_base64=base64.b64encode(leslie_2022_csv()).decode("ascii"),
            context=context_to_model(leslie_2022_context()),
            mapping=mapping_to_model(leslie_2022_mapping()),
        )

    @app.get(
        "/ai/spectral/model",
        response_model=SpectralModelInfo,
        dependencies=[Depends(require_secret)],
    )
    def spectral_model() -> SpectralModelInfo:
        # sync route: the first call reads and verifies the weights in the threadpool
        return to_model_info(spectral_store)

    @app.post(
        "/ai/spectral/identify",
        response_model=SpectralIdentifyResponse,
        dependencies=[Depends(require_secret)],
        responses={503: {"model": ErrorModel, "description": "Modèle spectral indisponible"}},
    )
    async def spectral_identify(
        file: UploadFile = File(..., description="Spectre : texte à deux colonnes (2 Mo au plus)"),
        technique: str = Form(...),
        x_unit: str = Form("cm-1"),
        y_unit: str = Form(...),
        laser_nm: str | None = Form(None),
    ) -> SpectralIdentifyResponse:
        params, problem = validate_params(technique, x_unit, y_unit, laser_nm)
        if params is None:
            raise HTTPException(status_code=422, detail=problem)
        state, model, digest = await run_in_threadpool(spectral_store.get)
        if state is not ModelState.OK or model is None or digest is None:
            raise HTTPException(status_code=503, detail=UNAVAILABLE[state.value])
        try:
            data = await read_upload(file, MAX_SPECTRUM_BYTES)
        except TooLarge as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from None

        def run() -> SpectralIdentifyResponse:
            try:
                x, y = parse_two_columns(data)
            except SpectrumReadError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=read_error_message(exc.issue, exc.line, exc.count)) from None
            ident = identify(model, SpectralQuery(
                x=x, y=y, technique=params.technique, x_unit=params.x_unit,  # type: ignore[arg-type]
                y_unit=params.y_unit, laser_nm=params.laser_nm))  # type: ignore[arg-type]
            return to_response(model, digest, ident, params=params,
                               data_sha256=sha256_hex(data), size=len(data), x=x)

        return await run_in_threadpool(run)

    @app.post(
        "/ai/spectral/parse",
        response_model=SpectralParsedModel,
        dependencies=[Depends(require_secret)],
    )
    async def spectral_parse(
        file: UploadFile = File(..., description="Spectre : texte à deux colonnes (2 Mo au plus)"),
    ) -> SpectralParsedModel:
        """The two numeric columns of a spectrum file (training export): numbers only."""
        try:
            data = await read_upload(file, MAX_SPECTRUM_BYTES)
        except TooLarge as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from None

        def run() -> SpectralParsedModel:
            try:
                x, y = parse_two_columns(data)
            except SpectrumReadError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=read_error_message(exc.issue, exc.line, exc.count)) from None
            return SpectralParsedModel(x=[float(v) for v in x], y=[float(v) for v in y])

        return await run_in_threadpool(run)

    @app.get(
        "/ai/image/model",
        response_model=ImageModelInfo,
        dependencies=[Depends(require_secret)],
    )
    def image_model() -> ImageModelInfo:
        # sync route: the first call reads and verifies the weights in the threadpool
        return to_image_model_info(image_store)

    @app.post(
        "/ai/image/analyze",
        response_model=ImageAnalyzeResponse,
        dependencies=[Depends(require_secret)],
        responses={503: {"model": ErrorModel, "description": "Modèle d'images indisponible"}},
    )
    async def image_analyze(
        file: UploadFile = File(..., description="Image PNG, JPEG ou TIFF (25 Mio au plus)"),
        scale_um_per_px: str | None = Form(
            None, description="Échelle saisie (µm par pixel de l'image déposée), facultative"),
    ) -> ImageAnalyzeResponse:
        entered, problem = parse_scale(scale_um_per_px)
        if problem is not None:
            raise HTTPException(status_code=422, detail=problem)
        state, model, digest = await run_in_threadpool(image_store.get)
        if state is not ModelState.OK or model is None or digest is None:
            raise HTTPException(status_code=503, detail=image_text.UNAVAILABLE[state.value])
        try:  # the size limit is enforced while reading: nothing is decoded above it
            data = await read_upload(file, MAX_IMAGE_BYTES)
        except TooLarge:
            raise HTTPException(status_code=413, detail=image_text.too_large_message()) from None

        def run() -> ImageAnalyzeResponse:
            try:
                decoded = decode_image(data)
                analysis = analyze(model, decoded, entered)
            except ImageReadError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=image_text.read_error_message(
                        exc.issue, exc.width, exc.height, exc.pixels)) from None
            except ScaleMismatch as exc:
                raise HTTPException(
                    status_code=422,
                    detail=image_text.scale_mismatch_message(exc.entered, exc.metadata)) from None
            return to_image_response(model, digest, analysis, decoded,
                                     data_sha256=sha256_hex(data), size=len(data))

        return await run_in_threadpool(run)

    @app.post(
        "/ai/image/validate",
        response_model=ImageValidatedSummary,
        dependencies=[Depends(require_secret)],
    )
    def image_validate(req: ImageValidateRequest) -> ImageValidatedSummary:
        # sync route, no access to the weights: available even when the model is missing.
        # The recorded analysis is trusted only after a consistency check; Task 4 (web) sends
        # only the analysis it stored server-side, never one supplied by a browser.
        problem = recorded_problem(req.analysis)
        if problem is not None:
            raise HTTPException(status_code=422, detail=problem)
        try:
            return to_validated(req.analysis, req.excluded,
                                [(r.id, r.shape) for r in req.reshaped], req.missed_count)
        except CorrectionError as exc:
            raise HTTPException(
                status_code=422,
                detail=image_text.correction_message(exc.code, exc.particle_id)) from None

    return app


def openapi_json() -> str:
    """The OpenAPI schema as committed in engine/openapi.json (no secret needed)."""
    schema = create_app(Settings(secret=secrets.token_urlsafe(32))).openapi()
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
