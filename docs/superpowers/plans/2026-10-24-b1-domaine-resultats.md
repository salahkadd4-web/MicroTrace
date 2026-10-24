# B1 — Domaine « résultats » (microtrace_core.results) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un package Python pur qui lit un tableau de résultats analytiques (CSV ou XLSX, format long ou large), le fait correspondre au schéma standard, applique les règles scientifiques de Studio et produit des enregistrements validés, des issues localisées en français et des statistiques honnêtes.

**Architecture :** nouveau sous-package `core/src/microtrace_core/results/`, sans dépendance web, réutilisé tel quel par B2 (API) et B3 (interface). Chaque fichier porte une responsabilité : vocabulaires, unités, censure, schéma, lecture, correspondance, validation, synthèse. L'orchestrateur `run_import` enchaîne ces étapes. Aucune valeur n'est imputée, convertie hors règle ou corrigée en silence.

**Tech Stack :** Python ≥ 3.12, bibliothèque standard (`csv`, `dataclasses`, `enum`, `re`, `statistics`), `openpyxl` (déjà une dépendance de core), pytest.

**Spec :** `docs/superpowers/specs/2026-10-24-microtrace-studio-v0-design.md` (§3 anti-objectifs, §5 règles, §6 schéma, §9 réussite B1).

## Global Constraints

- Aucune nouvelle dépendance : stdlib + `openpyxl` seulement (pas de pandas dans `results/`). Python ≥ 3.12.
- `microtrace_core.results` n'importe ni `ml`, ni un framework web.
- Messages d'issue **en français**, codes d'issue **stables en anglais** (liste fermée en tâche 6/7).
- Anti-objectifs du spec §3 : aucune imputation, aucune conversion hors du même (grandeur, base), jamais de mélange masse/nombre dans un agrégat, valeurs simulées étiquetées `simulated`.
- Les tests utilisent uniquement des tableaux synthétiques construits dans les tests ou dans `core/tests/results/conftest.py` ; toute donnée de test est étiquetée `simulated`.
- Commandes : `.venv/Scripts/python -m pytest core/tests/results -q -W error` ; suite rapide `.venv/Scripts/python -m pytest -q -W error -m "not data"`.
- Commits conventionnels terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Symbole micro** : `µg/mL` (U+00B5), `μg/mL` (U+03BC), `ug/ml` et `µg/ml` désignent la même unité. → `test_parse_unit_micro_variants` (tâche 1).
2. **Cellules Excel typées** : un nombre stocké en float (`0.3`), un entier (`1`), une date (`datetime`) et une espace insécable (`\xa0`) dans un en-tête ou une valeur doivent arriver en texte fidèle (`"0.3"`, `"1"`, `"2021-06-01"`, espace normalisée). → `test_read_xlsx_typed_cells` (tâche 4).
3. **CSV français** : séparateur `;` et virgule décimale (`1,2`) → valeur 1,2, pas d'erreur. → `test_read_csv_semicolon_decimal_comma` (tâche 4) et `test_parse_reported_value_decimal_comma` (tâche 2).
4. **Lignes vides** en fin ou au milieu d'une feuille : ignorées sans issue, et les numéros de ligne restent ceux du tableur. → `test_read_table_skips_blank_rows_keeps_row_numbers` (tâche 4).
5. **Identifiants à zéros initiaux** (`001`) : conservés en texte. → `test_read_csv_keeps_leading_zeros` (tâche 4).

---

### Tâche 1 : Vocabulaires et unités

**Files :**
- Create : `core/src/microtrace_core/results/__init__.py`, `results/vocab.py`, `results/units.py`
- Test : `core/tests/results/__init__.py` (vide si nécessaire), `core/tests/results/test_vocab_units.py`

**Interfaces :**
- Produces :
  - `vocab.py` : `class Matrix(StrEnum)` = `whole_blood, plasma, serum, other` ; `class Technique(StrEnum)` = `py_gc_ms, ted_gc_ms, micro_ftir, micro_raman, other` ; `class QuantityKind(StrEnum)` = `mass_concentration, number_concentration` ; `class Basis(StrEnum)` = `per_volume, per_mass` ; `class DetectionStatus(StrEnum)` = `quantified, between_lod_loq, not_quantified, below_lod, not_analysed` ; `class RecordType(StrEnum)` = `sample, procedural_blank, field_blank, spiked` ; `class IdentificationStatus(StrEnum)` = `confirmed, candidate` ; `class DataNature(StrEnum)` = `published, laboratory, simulated` ; `PS_SUM = "PS_SUM"` ; `THERMOANALYTICAL = frozenset({Technique.py_gc_ms, Technique.ted_gc_ms})` ; `STATUS_RANK: dict[DetectionStatus, int]` (quantified 4 > between_lod_loq 3 > not_quantified 2 > below_lod 1 > not_analysed 0).
  - `parse_matrix(text: str) -> Matrix | None` : synonymes insensibles à la casse et aux accents : `whole blood`, `sang total`, `sang`, `blood` → whole_blood ; `plasma` ; `serum`, `sérum` ; `other`, `autre`.
  - `parse_technique(text: str) -> Technique | None` : `py-gc/ms`, `pyr-gc/ms`, `py_gc_ms`, `pyrolysis gc-ms` → py_gc_ms ; `ted-gc/ms`, `ted_gc_ms` → ted_gc_ms ; `µftir`, `micro-ftir`, `ftir`, `micro_ftir` → micro_ftir ; `µraman`, `micro-raman`, `raman`, `micro_raman` → micro_raman ; `other`, `autre` → other.
  - `normalize_result_polymer(label: str | None, technique: Technique) -> str` : `core.polymers.normalize_polymer(label)`, puis `"PS"` → `PS_SUM` si `technique in THERMOANALYTICAL`.
  - `default_identification(technique: Technique) -> IdentificationStatus` : `other` → candidate, sinon confirmed.
  - `units.py` : `@dataclass(frozen=True) class Unit(code: str, label: str, kind: QuantityKind, basis: Basis, factor: float)` (`factor` = multiplicateur vers l'unité canonique) ; `UNITS: dict[str, Unit]` avec exactement les codes `ug/mL` (1), `ng/mL` (0.001), `mg/L` (1), `ug/L` (0.001), `ug/g` (1), `ng/g` (0.001), `mg/kg` (1), `particles/mL` (1), `particles/L` (0.001), `particles/g` (1) ; canoniques : `ug/mL`, `ug/g`, `particles/mL`, `particles/g` ; libellés d'affichage avec `µ`.
  - `parse_unit(text: str) -> Unit | None` ; `canonical_unit(kind, basis) -> Unit` ; `convert(value: float, src: Unit, dst: Unit) -> float` (lève `UnitMismatchError(ValueError)` si (kind, basis) diffèrent) ; `to_canonical(value: float, unit: Unit) -> tuple[float, Unit]`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```python
@pytest.mark.parametrize("text", ["µg/mL", "μg/mL", "ug/ml", "µg/ml", " UG/ML ", "µg mL-1", "µg·mL⁻¹"])
def test_parse_unit_micro_variants(text):
    assert parse_unit(text).code == "ug/mL"

@pytest.mark.parametrize("text,code", [("mg/L", "mg/L"), ("ng/mL", "ng/mL"), ("µg/L", "ug/L"),
    ("mg/kg", "mg/kg"), ("particles/mL", "particles/mL"), ("particules/mL", "particles/mL"),
    ("p/mL", "particles/mL"), ("MPs/L", "particles/L"), ("items/g", "particles/g")])
def test_parse_unit_codes(text, code): assert parse_unit(text).code == code

def test_parse_unit_unknown(): assert parse_unit("ppm") is None and parse_unit("") is None

def test_convert_same_kind():
    assert convert(500.0, UNITS["ng/mL"], UNITS["ug/mL"]) == pytest.approx(0.5)
    assert to_canonical(2.0, UNITS["mg/L"]) == (2.0, UNITS["ug/mL"])

@pytest.mark.parametrize("a,b", [("ug/mL", "particles/mL"), ("ug/mL", "ug/g")])
def test_convert_refuses_other_kind_or_basis(a, b):
    with pytest.raises(UnitMismatchError): convert(1.0, UNITS[a], UNITS[b])

def test_ps_becomes_ps_sum_only_for_thermoanalytical():
    assert normalize_result_polymer("PS", Technique.py_gc_ms) == "PS_SUM"
    assert normalize_result_polymer("polystyrene", Technique.ted_gc_ms) == "PS_SUM"
    assert normalize_result_polymer("PS", Technique.micro_ftir) == "PS"

def test_parse_matrix_and_technique():
    assert parse_matrix("Sang total") is Matrix.whole_blood and parse_matrix("SÉRUM") is Matrix.serum
    assert parse_matrix("urine") is None
    assert parse_technique("Py-GC/MS") is Technique.py_gc_ms and parse_technique("µFTIR") is Technique.micro_ftir
    assert default_identification(Technique.other) is IdentificationStatus.candidate
```

- [ ] **Étape 2 : lancer** `.venv/Scripts/python -m pytest core/tests/results -q -W error` → FAIL (import).
- [ ] **Étape 3 : implémenter.** Normaliser le texte de l'unité avant recherche : `strip`, minuscules, `μ`/`µ`/`u` → `u`, suppression des espaces, `·` → `/` uniquement quand il est suivi de l'exposant `⁻¹` ou `-1` (forme `µg mL-1`, `µg·mL⁻¹` → `ug/ml`). Table de synonymes `{forme normalisée: code}`.
- [ ] **Étape 4 : relancer** → PASS.
- [ ] **Étape 5 : commit** — `feat(results): vocabularies and unit registry`

---

### Tâche 2 : Censure — lecture des valeurs rapportées et statut

**Files :** Create `core/src/microtrace_core/results/censoring.py` ; Test `core/tests/results/test_censoring.py`

**Interfaces :**
- Consumes : `DetectionStatus`
- Produces :
  - `@dataclass(frozen=True) class Reported(value: float | None, hint: DetectionStatus | None, bound: float | None, ok: bool)` — `ok=False` si le texte est illisible.
  - `parse_reported_value(text: str) -> Reported`. Règles (insensibles à la casse, espaces et `\xa0` retirés aux bords) :
    - `""`, `na`, `n/a`, `not analysed`, `not analyzed`, `non analysé` → hint `not_analysed`, value None.
    - `<lod`, `< lod`, `<ld`, `nd`, `n.d.`, `n.d`, `not detected`, `non détecté` → hint `below_lod`.
    - `<loq`, `< loq`, `<lq` → hint `not_quantified`.
    - `<` + nombre → bound = nombre, hint None, value None.
    - `*` + nombre ou nombre + `*` → value = nombre, hint `between_lod_loq` (convention Leslie 2022).
    - nombre (point ou virgule décimale, signe `-` permis, pas de séparateur de milliers) → value, hint None.
    - autre → `ok=False`.
  - `infer_status(r: Reported, lod: float | None, loq: float | None) -> DetectionStatus | None` : si `r.hint` → hint ; si `r.bound` : `bound <= lod` → below_lod, sinon `not_quantified` ; si `r.value` : `value >= loq` → quantified, `lod <= value < loq` → between_lod_loq, `value < lod` → below_lod ; si une limite manque, retourner None (statut indéterminable par les limites).
  - `parse_declared_status(text: str) -> DetectionStatus | None` : `quantified`, `>loq`, `q` → quantified ; `between_lod_loq`, `lod-loq`, `lod–loq` → between_lod_loq ; `not_quantified`, `<loq` → not_quantified ; `below_lod`, `<lod`, `nd` → below_lod ; `not_analysed`, `na` → not_analysed.

- [ ] **Étape 1 : tests qui échouent**

```python
@pytest.mark.parametrize("text,value,hint,bound", [
    ("1.2", 1.2, None, None), ("1,2", 1.2, None, None), ("<LOD", None, "below_lod", None),
    ("n.d.", None, "below_lod", None), ("<LOQ", None, "not_quantified", None),
    ("< 0,68", None, None, 0.68), ("*1.2", 1.2, "between_lod_loq", None), ("1.2*", 1.2, "between_lod_loq", None),
    ("", None, "not_analysed", None), ("\xa02.4\xa0", 2.4, None, None)])
def test_parse_reported_value(text, value, hint, bound):
    r = parse_reported_value(text)
    assert r.ok and r.value == value and r.bound == bound and (r.hint == hint)

def test_parse_reported_value_decimal_comma(): assert parse_reported_value("0,13").value == pytest.approx(0.13)

@pytest.mark.parametrize("text", ["abc", "1.2.3", "1 000", "<", "**"])
def test_parse_reported_value_unreadable(text): assert parse_reported_value(text).ok is False

@pytest.mark.parametrize("text,lod,loq,status", [
    ("2.4", 0.13, 0.43, "quantified"), ("0.2", 0.13, 0.43, "between_lod_loq"),
    ("0.05", 0.13, 0.43, "below_lod"), ("<0.13", 0.13, 0.43, "below_lod"),
    ("<0.43", 0.13, 0.43, "not_quantified"), ("*0.3", 0.13, 0.43, "between_lod_loq"),
    ("2.4", None, None, None)])
def test_infer_status(text, lod, loq, status):
    s = infer_status(parse_reported_value(text), lod, loq)
    assert (s.value if s else None) == status
```

- [ ] **Étape 2 :** lancer → FAIL. **Étape 3 :** implémenter (regex numérique ancrée `^-?\d+([.,]\d+)?$`). **Étape 4 :** → PASS.
- [ ] **Étape 5 : commit** — `feat(results): reported-value parsing and detection status`

---

### Tâche 3 : Schéma standard, enregistrements et dictionnaire

**Files :** Create `core/src/microtrace_core/results/schema.py`, `results/records.py` ; Test `core/tests/results/test_schema.py`

**Interfaces :**
- Consumes : vocabulaires et `Unit` (tâche 1), `DetectionStatus`.
- Produces :
  - `@dataclass(frozen=True) class FieldSpec(name: str, label_fr: str, type: str, required: bool, description_fr: str, allowed: tuple[str, ...] = ())` ; `STANDARD_FIELDS: tuple[FieldSpec, ...]` dans cet ordre : `sample_id`*, `matrix`*, `polymer`*, `reported_value`*, `unit`*, `method`*, `aliquot`, `record_type`, `matrix_detail`, `lod`, `loq`, `detection_status`, `identification_status`, `size_min_um`, `size_max_um`, `analysis_date`, `batch`, `lab`, `comment` (* = obligatoire). `allowed` rempli depuis les enums pour `matrix`, `record_type`, `detection_status`, `identification_status`, et depuis `UNITS` pour `unit`.
  - `REQUIRED_FIELDS: frozenset[str]` ; `FIELD_NAMES: tuple[str, ...]`.
  - `data_dictionary_csv() -> str` (colonnes `name,label_fr,type,required,description_fr,allowed` ; `allowed` joint par `|`) ; `data_dictionary_markdown() -> str` (tableau Markdown, titre `# Dictionnaire de données — MicroTrace Studio`).
  - `records.py` :
    - `@dataclass(frozen=True) class DetectionLimit(method: str, polymer: str, lod: float | None, loq: float | None, unit_code: str, source: str)` ;
    - `@dataclass(frozen=True) class MethodSpec(name: str, technique: Technique)` ;
    - `@dataclass(frozen=True) class StudyContext(data_nature: DataNature, methods: tuple[MethodSpec, ...], limits: tuple[DetectionLimit, ...] = (), reference_doi: str | None = None, reference_license: str | None = None, blank_corrected: str = "unknown")` (`blank_corrected` ∈ `yes|no|unknown`) ;
    - `@dataclass(frozen=True) class MeasurementRecord` avec les champs : `sample_id: str, aliquot: str, record_type: RecordType, matrix: Matrix, matrix_detail: str, polymer: str, polymer_raw: str, method: str, technique: Technique, reported_value: str, value: float | None, unit: Unit, canonical_value: float | None, canonical_unit: Unit, status: DetectionStatus, lod: float | None, loq: float | None, identification_status: IdentificationStatus, size_min_um: float | None, size_max_um: float | None, analysis_date: str, batch: str, lab: str, comment: str, source_row: int, source_column: str` (`kind`/`basis` dérivés de `unit`).

- [ ] **Étape 1 : tests qui échouent** — `test_required_fields_exact` (`REQUIRED_FIELDS == {"sample_id","matrix","polymer","reported_value","unit","method"}`) ; `test_dictionary_csv_has_one_row_per_field` (19 lignes de données + en-tête, `unit` liste les 10 codes) ; `test_dictionary_markdown_title_and_fields` ; `test_study_context_rejects_bad_blank_corrected` (ValueError).
- [ ] **Étapes 2–4 :** FAIL → implémenter → PASS.
- [ ] **Étape 5 : commit** — `feat(results): standard schema, records and data dictionary`

---

### Tâche 4 : Lecture CSV et XLSX

**Files :** Create `core/src/microtrace_core/results/tables.py` ; Test `core/tests/results/test_tables.py`

**Interfaces :**
- Produces : `@dataclass(frozen=True) class RawTable(columns: tuple[str, ...], rows: tuple[dict[str, str], ...], row_numbers: tuple[int, ...], source_name: str, sheet: str | None)` ; `read_table(data: bytes, filename: str, sheet: str | None = None) -> RawTable` ; `class TableReadError(ValueError)`.
  - Format choisi par l'extension (`.csv`, `.tsv`, `.txt` → texte ; `.xlsx` → openpyxl `read_only=True, data_only=True`) ; sinon `TableReadError`.
  - Texte : décodage `utf-8-sig`, repli `cp1252` ; séparateur détecté parmi `;` `,` `\t` sur l'en-tête (`csv.Sniffer` restreint, repli sur le plus fréquent). Toutes les cellules restent du texte.
  - XLSX : première feuille par défaut, ou `sheet` (TableReadError listant les feuilles si absente) ; conversion en texte : `int` → `str(int)`, `float` entier → sans `.0`, autre float → `repr` court (`format(v, ".15g")`), `datetime`/`date` → ISO `YYYY-MM-DD` (avec l'heure seulement si non nulle), `None` → `""`.
  - En-têtes et cellules : `\xa0` → espace, espaces de bord retirés. En-têtes vides → `colonne_<n>` ; en-têtes dupliqués → TableReadError nommant la colonne.
  - Lignes entièrement vides ignorées ; `row_numbers` = numéro de ligne du tableur (en-tête = 1).
  - Fichier sans ligne de données → TableReadError.

- [ ] **Étape 1 : tests qui échouent** (fichiers construits en mémoire ; XLSX écrit avec openpyxl dans `tmp_path`) :
  - `test_read_csv_semicolon_decimal_comma` (`"sample_id;value\nD1;1,2\n"` → `rows[0]["value"] == "1,2"`, colonnes `("sample_id","value")`),
  - `test_read_csv_keeps_leading_zeros` (`"001"` reste `"001"`),
  - `test_read_csv_cp1252_fallback` (en-tête `"Matrice;Unité"` encodé cp1252),
  - `test_read_xlsx_typed_cells` (0.3 → `"0.3"`, 1 → `"1"`, 2.0 → `"2"`, `datetime(2021,6,1)` → `"2021-06-01"`, en-tête `"Polymère\xa0"` → `"Polymère"`),
  - `test_read_table_skips_blank_rows_keeps_row_numbers` (lignes 2, 4 remplies, 3 vide → `row_numbers == (2, 4)`),
  - `test_read_table_errors` (extension `.ods`, en-têtes dupliqués, fichier sans données, feuille absente → `TableReadError`).
- [ ] **Étapes 2–4 :** FAIL → implémenter → PASS.
- [ ] **Étape 5 : commit** — `feat(results): CSV and XLSX table reader`

---

### Tâche 5 : Correspondance des colonnes (formats long et large)

**Files :** Create `core/src/microtrace_core/results/mapping.py` ; Test `core/tests/results/test_mapping.py`

**Interfaces :**
- Consumes : `RawTable`, `FIELD_NAMES`.
- Produces :
  - `@dataclass(frozen=True) class Mapping(mode: Literal["long", "wide"], field_columns: dict[str, str], polymer_columns: dict[str, str] = {}, constants: dict[str, str] = {}, split_aliquot_suffix: bool = False)` (utiliser `field(default_factory=dict)`). `field_columns` : champ standard → colonne du fichier ; `polymer_columns` (mode large) : colonne du fichier → libellé de polymère ; `constants` : champ standard → valeur fixe pour toutes les lignes (ex. `unit="µg/mL"`, `matrix="sang total"`, `method="Py-GC/MS Leslie 2022"`).
  - `suggest_mapping(table: RawTable) -> Mapping` : correspondance par synonymes normalisés (minuscules, sans accents, sans espaces ni `_`/`-`) ; exemples obligatoires : `sample_id` ← `sample id`, `sampleid`, `id échantillon`, `échantillon`, `donor`, `donneur`, `id` ; `polymer` ← `polymer`, `polymère`, `polymer type` ; `reported_value` ← `value`, `valeur`, `concentration`, `result`, `résultat` ; `unit` ← `unit`, `unité`, `units` ; `matrix` ← `matrix`, `matrice` ; `method` ← `method`, `méthode`, `technique` ; `aliquot` ← `aliquot`, `aliquote`, `replicate`, `réplicat` ; `lod`, `loq`, `detection_status` (`status`, `statut`), `record_type` (`type`, `sample type`). Si aucune colonne `polymer` n'est trouvée mais qu'au moins deux en-têtes sont des polymères reconnus par `core.polymers.normalize_polymer` (ni UNKNOWN ni OTHER), proposer le mode large avec ces colonnes.
  - `@dataclass(frozen=True) class MappedRow(fields: dict[str, str], source_row: int, source_column: str)` ; `apply_mapping(table: RawTable, mapping: Mapping) -> tuple[list[MappedRow], list[Issue]]` : mode long → une ligne par ligne du tableau (`source_column` = colonne de `reported_value`) ; mode large → une ligne par (ligne, colonne de polymère), `polymer` = libellé de la colonne, `reported_value` = cellule, `source_column` = nom de la colonne ; les constantes remplissent les champs absents (une colonne associée l'emporte ; si une colonne ET une constante visent le même champ → issue `E_MAPPING_CONFLICT`) ; `split_aliquot_suffix` : `sample_id` de forme `^(.+?)([a-z])$` (ex. `12a`) → `sample_id="12"`, `aliquot="a"` sauf si `aliquot` est déjà associé ; colonne associée absente du tableau → issue `E_MAPPING_UNKNOWN_COLUMN`.
  - `Issue` est défini en tâche 6 : **créer ici** `core/src/microtrace_core/results/issues.py` avec `@dataclass(frozen=True) class Issue(code: str, severity: Literal["error", "warning", "info"], message: str, row: int | None = None, column: str | None = None)` et `has_errors(issues) -> bool`.

- [ ] **Étape 1 : tests qui échouent**
  - `test_suggest_long` (en-têtes `Donneur;Aliquote;Polymère;Valeur;Unité` → `field_columns` attendu, mode long),
  - `test_suggest_wide` (en-têtes `Donor, PMMA, PP, PS, PE, PET` → mode large, 5 `polymer_columns`, `sample_id` ← `Donor`),
  - `test_apply_wide_unpivots_with_constants` (2 lignes × 5 polymères → 10 `MappedRow`, `fields["unit"] == "µg/mL"` via constante, `source_column == "PET"`, `source_row` conservé),
  - `test_apply_split_aliquot_suffix` (`"12a"` → `("12","a")`, `"7"` reste `("7","")`),
  - `test_apply_conflict_and_unknown_column` (codes `E_MAPPING_CONFLICT`, `E_MAPPING_UNKNOWN_COLUMN`, sévérité error).
- [ ] **Étapes 2–4 :** FAIL → implémenter → PASS.
- [ ] **Étape 5 : commit** — `feat(results): long and wide column mapping`

---

### Tâche 6 : Validation des lignes

**Files :** Create `core/src/microtrace_core/results/validation.py` ; Test `core/tests/results/test_validation.py`

**Interfaces :**
- Consumes : `MappedRow`, `StudyContext`, `Issue`, censure, unités, vocabulaires, `MeasurementRecord`.
- Produces : `validate_rows(rows: list[MappedRow], context: StudyContext) -> tuple[list[MeasurementRecord], list[Issue]]`. Une ligne avec au moins une erreur ne produit pas d'enregistrement. Codes et sévérités (liste fermée ; message français indiquant la valeur fautive ; `row`/`column` renseignés) :

| Code | Sév. | Condition |
|---|---|---|
| `E_REQUIRED_MISSING` | error | champ obligatoire vide (après constantes) |
| `E_UNKNOWN_MATRIX` | error | `parse_matrix` → None |
| `E_MATRIX_DETAIL_MISSING` | error | matrice `other` sans `matrix_detail` |
| `E_UNKNOWN_METHOD` | error | `method` absente de `context.methods` |
| `E_UNKNOWN_UNIT` | error | `parse_unit` → None |
| `E_UNPARSABLE_VALUE` | error | `parse_reported_value(...).ok` faux |
| `E_NEGATIVE_VALUE` | error | valeur < 0 |
| `E_UNKNOWN_RECORD_TYPE` / `E_UNKNOWN_STATUS` / `E_UNKNOWN_IDENTIFICATION` | error | valeur hors vocabulaire |
| `E_POLYMER_MISSING` | error | polymère normalisé = UNKNOWN |
| `W_POLYMER_OTHER` | warning | polymère normalisé = OTHER (enregistrement conservé avec `polymer="OTHER"`) |
| `I_PS_AS_SUM` | info | PS → PS_SUM (technique thermoanalytique) |
| `E_LIMIT_UNIT_MISMATCH` | error | limite de la table d'étude dans un autre (grandeur, base) que la mesure |
| `E_LOD_GT_LOQ` | error | LOD > LOQ (ligne ou table) |
| `W_LIMIT_CONFLICT` | warning | LOD/LOQ de la ligne ≠ table d'étude (après conversion dans l'unité de la mesure) |
| `W_NO_LIMITS` | warning | aucune LOD/LOQ et statut non déclaré : statut = `quantified` si valeur numérique, hint sinon, `not_quantified` pour une borne `<x` |
| `E_STATUS_VALUE_CONFLICT` | error | statut déclaré `below_lod`/`not_quantified`/`not_analysed` avec une valeur numérique sans `*` |
| `W_STATUS_INCONSISTENT` | warning | statut déclaré ≠ statut déduit par `infer_status` ; on garde le **déclaré** |
| `W_VALUE_BELOW_LOD` | warning | valeur numérique < LOD sans statut déclaré : statut `below_lod`, `value=None`, `reported_value` intact |
| `E_DUPLICATE_RECORD` | error | même (`sample_id`, `aliquot`, `record_type`, polymère normalisé, `method`) déjà vu (signalé sur la 2ᵉ occurrence) |

  Règles de construction : limites = colonnes `lod`/`loq` de la ligne (dans l'unité de la ligne) sinon table d'étude (`method`, polymère normalisé) convertie dans l'unité de la mesure ; `canonical_value` = `to_canonical(value)` si `value` non None ; `identification_status` = colonne sinon `default_identification(technique)` ; tailles parsées en float (illisible → `E_UNPARSABLE_VALUE` sur la colonne de taille).

- [ ] **Étape 1 : tests qui échouent** — un test par code ci-dessus (nom `test_<code_en_minuscules>`), chacun vérifiant `code`, `severity`, `row` et `column`, plus :
  - `test_valid_long_row_builds_record` (valeur `2,4` µg/mL sang total Py-GC/MS PET, limites table 0.13/0.43 → `status == quantified`, `canonical_value == 2.4`, `identification_status == confirmed`),
  - `test_ng_per_ml_canonicalised` (`500` ng/mL → `canonical_value == 0.5`, unité canonique `ug/mL`, `value == 500`),
  - `test_star_value_between` (`*0.3` → `between_lod_loq`, `value == 0.3`).
- [ ] **Étapes 2–4 :** FAIL → implémenter → PASS.
- [ ] **Étape 5 : commit** — `feat(results): row validation rules`

---

### Tâche 7 : Données personnelles, règles de fichier et orchestrateur `run_import`

**Files :** Create `core/src/microtrace_core/results/privacy.py`, `results/importer.py` ; Modify `results/__init__.py` (exports publics) ; Test `core/tests/results/test_privacy.py`, `core/tests/results/test_importer.py`, `core/tests/results/conftest.py`

**Interfaces :**
- Consumes : tâches 3 à 6.
- Produces :
  - `detect_pii(table: RawTable, mapping: Mapping) -> list[Issue]` :
    - `E_PII_COLUMN` (error, `column` renseigné) : en-tête dont la forme normalisée contient `nom`, `name`, `prenom`, `firstname`, `lastname`, `surname`, `naissance`, `birth`, `dob`, `email`, `mail`, `telephone`, `phone`, `tel`, `adresse`, `address`, `securitesociale`, `ssn`, `nir`, `dossier`, `patient` — sauf si l'en-tête est exactement associé à un champ standard non personnel (ex. `polymer name` ↔ `polymer`) ;
    - `E_PII_VALUE` (error, `row`/`column`) : une cellule contenant une adresse e-mail (`\S+@\S+\.\w+`) ou un numéro de téléphone (≥ 9 chiffres avec séparateurs optionnels, ex. `06 12 34 56 78`, `+213 555 12 34 56`) ;
    - `W_POSSIBLE_BIRTHDATE` (warning) : date complète (`JJ/MM/AAAA`, `AAAA-MM-JJ`) dans une colonne non associée à `analysis_date`.
  - Règles de fichier (dans `importer.py`) : `W_MIXED_QUANTITY_KINDS` (warning, sans ligne) si les enregistrements valides mêlent plusieurs (grandeur, base) ; `E_PUBLISHED_WITHOUT_REFERENCE` (error) si `context.data_nature == published` sans `reference_doi` ou `reference_license`.
  - `RULES_VERSION = "1"` ; `@dataclass(frozen=True) class ImportResult(records: tuple[MeasurementRecord, ...], qc_records: tuple[MeasurementRecord, ...], issues: tuple[Issue, ...], n_rows: int, rules_version: str)` avec propriété `has_errors` ; `run_import(table: RawTable, mapping: Mapping, context: StudyContext) -> ImportResult` : `detect_pii` → `apply_mapping` → `validate_rows` → règles de fichier. **Si une erreur existe, `records` et `qc_records` sont vides** (rien n'est importable). Sinon, `record_type == sample` → `records`, les autres → `qc_records`.
  - `conftest.py` fournit des tableaux synthétiques étiquetés `simulated` : `leslie_like_wide_table()` (CSV large `Donor;PMMA;PP;PS;PE;PET`, donneurs `1a`…`22b` avec une seule aliquote `a` pour les donneurs 6, 9, 15 et 18, notations `<LOD`, `*x`, nombres à virgule ; **construit pour satisfaire exactement les fréquences et maxima de `test_leslie_like_frequencies_and_maxima` en tâche 8**, valeurs fictives, statut par rapport aux limites du Tableau 3) et `particles_long_table()` (CSV long, particules/mL, technique `micro_raman`), plus le `StudyContext` et le `Mapping` correspondants (constantes `matrix="sang total"`, `unit="µg/mL"`, `method="Py-GC/MS"`, `split_aliquot_suffix=True`, table de limites = Tableau 3 de Leslie 2022 : PMMA 0.10/0.33, PP 0.68/2.3, PS 0.34/1.1, PE 0.61/2.0, PET 0.13/0.43 µg/mL).
- [ ] **Étape 1 : tests qui échouent**
  - `test_pii_column_and_values` (colonnes `Nom`, `Date de naissance` → `E_PII_COLUMN` ×2 ; cellule `jean@x.fr` → `E_PII_VALUE` ; `06 12 34 56 78` → `E_PII_VALUE` ; `12/03/1985` dans `comment` → `W_POSSIBLE_BIRTHDATE` ; `polymer name` associé à `polymer` → aucune issue),
  - `test_leslie_like_imports_clean` (aucune issue de sévérité error ; `I_PS_AS_SUM` présent ; tous les polymères ∈ {PMMA, PP, PS_SUM, PE, PET} ; aliquotes `a`/`b`),
  - `test_traps_each_produce_expected_issue` : à partir du tableau propre, injecter chaque piège séparément et vérifier l'issue exacte avec ligne et colonne — unité `ppm` → `E_UNKNOWN_UNIT` ; une ligne en `particles/mL` ajoutée → `W_MIXED_QUANTITY_KINDS` ; statut déclaré `<LOD` avec valeur `1.2` → `E_STATUS_VALUE_CONFLICT` ; colonne `Nom` → `E_PII_COLUMN` ; limite PET LOD 0.5 > LOQ 0.43 → `E_LOD_GT_LOQ` ; ligne `3a` dupliquée → `E_DUPLICATE_RECORD`,
  - `test_errors_block_all_records` (un piège bloquant → `records == ()` et `has_errors`),
  - `test_published_requires_reference`,
  - `test_qc_rows_separated` (ligne `record_type=procedural_blank` → dans `qc_records`).
- [ ] **Étapes 2–4 :** FAIL → implémenter → PASS.
- [ ] **Étape 5 : commit** — `feat(results): privacy checks and import orchestrator`

---

### Tâche 8 : Synthèse honnête (aliquotes, fréquences, statistiques)

**Files :** Create `core/src/microtrace_core/results/summary.py` ; Test `core/tests/results/test_summary.py`

**Interfaces :**
- Consumes : `MeasurementRecord`, `STATUS_RANK`, `ImportResult`, fixtures de la tâche 7.
- Produces :
  - `AGGREGATION_RULE_FR: str` — texte exact : `"Valeur par échantillon = moyenne des aliquotes quantifiées (≥ LOQ) ; si aucune aliquote n'est quantifiée, statut le plus élevé observé, sans valeur. Aucune imputation."`
  - `@dataclass(frozen=True) class SampleResult(sample_id: str, polymer: str, method: str, kind: QuantityKind, basis: Basis, canonical_unit: Unit, status: DetectionStatus, value: float | None, n_aliquots: int, n_quantified: int)` ; `aggregate_aliquots(records: Iterable[MeasurementRecord]) -> list[SampleResult]` (groupé par `sample_id`, polymère, méthode, (kind, basis) ; ignore les `record_type != sample` ; tri déterministe).
  - `@dataclass(frozen=True) class Frequency(polymer: str, n_samples: int, n_quantified: int, fraction: float)` ; `quantification_frequency(records) -> list[Frequency]` : par polymère, nombre d'échantillons (donneurs) ayant au moins une aliquote `quantified` ; dernière ligne `polymer="ANY"` = échantillons ayant au moins un polymère quantifié ; dénominateur = nombre d'échantillons distincts de l'import.
  - `@dataclass(frozen=True) class PolymerStats(polymer: str, kind: QuantityKind, basis: Basis, canonical_unit: Unit, counts_by_status: dict[str, int], n_quantified: int, min: float | None, median: float | None, mean: float | None, max: float | None, max_measurement: float | None)` ; `describe(records) -> list[PolymerStats]` : comptes par statut **au niveau échantillon** (après agrégation), statistiques sur les seules valeurs d'échantillons quantifiés, `max_measurement` = maximum des `canonical_value` des mesures individuelles quantifiées ; jamais deux (kind, basis) dans un même `PolymerStats`.
- [ ] **Étape 1 : tests qui échouent**
  - `test_aggregate_mean_of_quantified_only` (a = 2.0 quantifié, b = `*0.3` → valeur 2.0, `n_quantified == 1`),
  - `test_aggregate_no_quantified_takes_highest_status` (a `<LOD`, b `*0.3` → `between_lod_loq`, `value is None`),
  - `test_leslie_like_frequencies_and_maxima` — le tableau `leslie_like_wide_table()` de la tâche 7 **doit être construit** pour reproduire l'article (Leslie 2022 §3.2) : 22 donneurs ; fréquences PET 11, PS_SUM 8, PE 5, PMMA 1, PP 0, ANY 17 ; maxima par mesure PET 2.4, PS_SUM 4.8, PE 7.1 µg/mL :

```python
freq = {f.polymer: (f.n_quantified, f.n_samples) for f in quantification_frequency(result.records)}
assert freq == {"PET": (11, 22), "PS_SUM": (8, 22), "PE": (5, 22), "PMMA": (1, 22), "PP": (0, 22), "ANY": (17, 22)}
stats = {s.polymer: s for s in describe(result.records)}
assert stats["PET"].max_measurement == pytest.approx(2.4)
assert stats["PS_SUM"].max_measurement == pytest.approx(4.8)
assert stats["PE"].max_measurement == pytest.approx(7.1)
assert stats["PP"].n_quantified == 0 and stats["PP"].median is None
```

  - `test_describe_never_mixes_kinds` (enregistrements µg/mL et particules/mL du même polymère → deux `PolymerStats` distincts),
  - `test_qc_records_excluded_from_summary`.
- [ ] **Étapes 2–4 :** FAIL → implémenter → PASS ; puis suite rapide complète `-m "not data"` → PASS, sortie propre.
- [ ] **Étape 5 : commit** — `feat(results): honest per-sample aggregation, frequencies and statistics`
