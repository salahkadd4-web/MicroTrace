# Chantier A — Catalogue spectral harmonisé et baseline d'identification — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** lire les 7 bibliothèques spectrales de `datasets/Spectres/`, les harmoniser dans un catalogue Parquet unique et traçable, puis mesurer honnêtement une baseline d'identification de polymères (corrélation et PCA+SVM) avec des séparations sans fuite.

**Architecture :** monorepo. `core/` (package `microtrace_core`) contient les lecteurs, le prétraitement et le catalogue, et sera réutilisé tel quel par la future application. `ml/` (package `microtrace_ml`) dépend de `core` et contient les séparations, les modèles et l'évaluation. `app/` n'existe pas encore et n'importera jamais `ml`. Les données brutes restent intactes : le catalogue stocke à la fois le spectre brut et le spectre prétraité, avec l'empreinte sha256 du fichier source.

**Tech Stack :** Python ≥ 3.12 (local : 3.14.3), numpy, scipy, pandas, pyarrow, openpyxl, scikit-learn, pytest.

**Spec :** `MicroTrace_AI_plan_projet.md` (sections 3.2, 3.3, 9 et 10) et `datasets/SOURCES.md` (inventaire et formats). Décisions prises dans la conversation du 2026-10-23 : tout en Python, monorepo `core/ml/app`, `app` n'importe jamais `ml`.

## Global Constraints

- Python `>=3.12` ; environnement virtuel `.venv/` à la racine ; installation : `.venv/Scripts/python -m pip install -e "core[dev]" -e "ml[dev]"`.
- Dépendances core : `numpy>=2.1`, `scipy>=1.14`, `pandas>=2.2`, `pyarrow>=17`, `openpyxl>=3.1`. ml : `microtrace-core`, `scikit-learn>=1.5`. dev : `pytest>=8`.
- **Ne jamais écrire dans `datasets/`.** Sorties : `data/processed/` (ignoré par Git) et `reports/` (versionné).
- Les tests unitaires n'utilisent **que des fichiers synthétiques** créés dans `tmp_path`. Seuls les tests marqués `@pytest.mark.data` lisent `datasets/`, et ils sont ignorés (skip) si le dossier est absent.
- Chemins : uniquement `pathlib`. Plusieurs dossiers ont un espace final (`FLOPP .csv`). Dans le catalogue, `file` est stocké en POSIX, relatif à la racine `datasets/`.
- Le catalogue porte toujours la mention `data_nature = "reference/environmental polymers — not human biological matrices"` (règle du plan, section 6.2.F).
- Laser Raman MicroPlastiX : `MPX_RAMAN_LASER_NM = 532.0`, déduit des pics du PE (voir `SOURCES.md`). Conversion : `shift = 1e7/laser_nm − 1e7/λ_nm`.
- Grilles communes : `ftir_atr` = `np.arange(600, 4001, 4.0)` (851 points) ; `raman` = `np.arange(250, 3201, 4.0)` (738 points).
- Messages de commit au format conventionnel, se terminant par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Axes x décroissants** (ATR MicroPlastiX 4000→550, RaSPI brut 4002→…) : le prétraitement doit trier, pas inverser le spectre. → test `test_clean_sorts_descending_x` (tâche 2).
2. **Lignes irrégulières avec cellules vides finales** (RaSPI brut, lignes de longueurs variables) : le lecteur les ignore sans créer de NaN au milieu du spectre. → test `test_raspi_drops_trailing_empty_cells` (tâche 4).
3. **Unités mélangées dans MicroPlastiX Raman** (1 881 en nm, 96 en cm⁻¹) : convertir uniquement si `x_unit == "nm"`. → test `test_preprocess_converts_only_nm` (tâche 2) et `test_mpx_reads_units_per_record` (tâche 4).
4. **Étiquettes absentes, « / » ou inconnues** : jamais d'exception. `UNKNOWN` ou `OTHER`, puis exclusion de l'évaluation. → `test_normalize_polymer_*` (tâche 1) et `test_evaluation_excludes_unknown_and_other` (tâche 7).
5. **Spectre qui ne couvre qu'une partie de la grille** : NaN hors plage, `coverage < 0.8` exclu de l'évaluation, et le matcher exige un recouvrement minimal. → `test_resample_nan_outside_range` (tâche 2) et `test_matcher_rejects_low_overlap` (tâche 6).

---

### Tâche 1 : Squelette du monorepo, modèle `Spectrum` et vocabulaire des polymères

**Files :**
- Create : `core/pyproject.toml`, `core/src/microtrace_core/__init__.py`, `core/src/microtrace_core/spectrum.py`, `core/src/microtrace_core/polymers.py`
- Create : `pytest.ini` (racine), `conftest.py` (racine)
- Test : `core/tests/test_spectrum.py`, `core/tests/test_polymers.py`

**Interfaces :**
- Produces :
  - `Technique = Literal["ftir_atr", "raman"]`, `State = Literal["pristine", "weathered", "biofouled", "unknown"]`
  - `@dataclass(frozen=True) class Spectrum` : `spectrum_id: str, source: str, technique: Technique, x: np.ndarray, y: np.ndarray, x_unit: Literal["cm-1","nm"], polymer: str, polymer_raw: str, state: State, sample_group: str, file: str, laser_nm: float | None = None, label_note: str = "", extra: dict[str, str] = field(default_factory=dict)`. `x` et `y` sont **bruts**, dans l'unité d'origine.
  - `UNKNOWN = "UNKNOWN"`, `OTHER = "OTHER"`, `CANONICAL: frozenset[str]`, `normalize_polymer(label: str | None) -> str`
  - Fixture racine `datasets_root() -> Path` : retourne `<repo>/datasets`, ou appelle `pytest.skip` si `datasets/Spectres` est absent.

- [ ] **Étape 1 : écrire les tests qui échouent**

```python
# core/tests/test_polymers.py
import pytest
from microtrace_core.polymers import normalize_polymer, UNKNOWN, OTHER

@pytest.mark.parametrize("raw,expected", [
    ("polyethylene", "PE"), ("LDPE", "PE"), ("HDPE", "PE"), ("Oxidized PE", "PE"),
    ("(09) PET", "PET"), ("(insitu 01) PE", "PE"), ("polyester", "PET"),
    ("Polyamide", "PA"), ("nylon", "PA"), ("polyamine (nylon)", "PA"),
    ("poly (methyl methacrylate)", "PMMA"), ("Polymethyl Methacrylate", "PMMA"),
    ("Acrylonitrile Butadiene Styrene", "ABS"), ("polytetrafluoroethylene", "PTFE"),
    ("polyoxymethylene", "POM"), ("silicone", "SILICONE"),
    ("Polyethylene Vinyl Acetate", "EVA"), ("PEVA", "EVA"),
    ("Acrylic", "ACRYLIC"), ("Cellulose Acetate", "CA"),
    ("Cotton", "CELLULOSE"), ("Dyed Cellulose", "CELLULOSE"),
    ("Rubber", "RUBBER"), ("NC", "NC"), ("PLA", "PLA"),
])
def test_normalize_polymer_aliases(raw, expected):
    assert normalize_polymer(raw) == expected

@pytest.mark.parametrize("raw", [None, "", "  ", "/", "None"])
def test_normalize_polymer_unknown(raw):
    assert normalize_polymer(raw) == UNKNOWN

def test_normalize_polymer_unmapped_is_other():
    assert normalize_polymer("Polysulfone") == OTHER
    assert normalize_polymer("Polyethylene-co-Polypropylene") == OTHER
```

```python
# core/tests/test_spectrum.py — un Spectrum valide se construit ; ValueError si :
#   len(x) != len(y) ; len(x) < 10 ; technique ou state hors des Literal ;
#   technique == "raman" et x_unit == "nm" et laser_nm is None.
```

- [ ] **Étape 2 : créer l'environnement, puis lancer les tests et vérifier qu'ils échouent**

Run : `python -m venv .venv` puis `.venv/Scripts/python -m pip install pytest numpy` puis `.venv/Scripts/python -m pytest core/tests -v`
Attendu : échec à l'import (`ModuleNotFoundError: microtrace_core`). Après l'étape 3 : `.venv/Scripts/python -m pip install -e "core[dev]"`.

- [ ] **Étape 3 : implémenter**

`core/pyproject.toml` : nom `microtrace-core`, layout `src/`, dépendances et extra `dev` des Global Constraints. `pytest.ini` : `testpaths = core/tests ml/tests`, `markers = data: needs datasets/ on disk`.

`normalize_polymer` : `strip`, minuscules, espaces multiples réduits à un seul, suppression d'un préfixe `^\(.*?\)\s*` (format MicroPlastiX), puis recherche dans une table d'alias `dict[str, str]`. Les valeurs vides, `"/"` et `"none"` donnent `UNKNOWN` ; un label absent de la table donne `OTHER`. La table doit contenir exactement les correspondances testées, plus les formes canoniques elles-mêmes (`"pe"`, `"pp"`, `"pet"`, `"ps"`, `"pvc"`, `"pc"`, `"pu"`, `"polypropylene"`, `"polystyrene"`, `"polyvinyl chloride"`, `"polycarbonate"`, `"polyurethane"`, `"polyethylene terephthalate"`, `"polylactic acid"`, `"nitrocellulose"`, `"cellulose"`).

- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent**

Run : `.venv/Scripts/python -m pytest core/tests -v` → tout PASS.

- [ ] **Étape 5 : commit** — `feat(core): scaffold package, Spectrum model and polymer vocabulary`

---

### Tâche 2 : Prétraitement

**Files :**
- Create : `core/src/microtrace_core/preprocess.py`
- Test : `core/tests/test_preprocess.py`

**Interfaces :**
- Consumes : `Spectrum` (tâche 1)
- Produces :
  - `PREPROCESS_VERSION = "1"`, `GRIDS: dict[Technique, np.ndarray]` (valeurs des Global Constraints)
  - `nm_to_raman_shift(wavelength_nm: np.ndarray, laser_nm: float) -> np.ndarray`
  - `clean(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]` : retire les paires non finies, trie x par ordre croissant, moyenne les x en double
  - `resample(x, y, grid: np.ndarray) -> np.ndarray` : interpolation linéaire, NaN hors de `[x.min(), x.max()]`
  - `als_baseline(y: np.ndarray, lam: float, p: float, n_iter: int = 10) -> np.ndarray` : moindres carrés asymétriques (Eilers), calculés sur la zone finie seulement, NaN conservés
  - `minmax(y: np.ndarray) -> np.ndarray` : ramène à [0, 1] en ignorant les NaN ; un signal constant donne des zéros
  - `coverage(y_grid: np.ndarray) -> float` : fraction des points finis
  - `preprocess(s: Spectrum) -> np.ndarray` (float32, longueur `len(GRIDS[s.technique])`). Pipeline : conversion nm → cm⁻¹ si `s.x_unit == "nm"`, puis `clean`, `resample`, soustraction de `als_baseline` (raman : `lam=1e5, p=0.01` ; ftir_atr : `lam=1e6, p=0.01`), puis `minmax`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```python
def test_nm_to_raman_shift_532():
    # λ = 1/(1/532e-7 - 2848) en nm → 2848 cm-1
    lam = 1e7 / (1e7 / 532.0 - 2848.0)
    assert nm_to_raman_shift(np.array([lam]), 532.0)[0] == pytest.approx(2848.0, abs=1e-6)

def test_clean_sorts_descending_x():
    x, y = clean(np.array([3.0, 2.0, 1.0, 2.0]), np.array([30.0, 20.0, 10.0, 22.0]))
    assert x.tolist() == [1.0, 2.0, 3.0] and y.tolist() == [10.0, 21.0, 30.0]

def test_clean_drops_non_finite():
    x, y = clean(np.array([1.0, np.nan, 3.0]), np.array([1.0, 2.0, np.inf]))
    assert x.tolist() == [1.0]

def test_resample_nan_outside_range():
    out = resample(np.array([1000.0, 2000.0]), np.array([0.0, 1.0]), np.array([900.0, 1500.0, 2100.0]))
    assert np.isnan(out[0]) and out[1] == pytest.approx(0.5) and np.isnan(out[2])

def test_als_removes_linear_baseline():
    x = np.linspace(0, 1, 500); peak = np.exp(-((x - 0.5) / 0.01) ** 2)
    y = peak + 2 * x + 1
    corrected = y - als_baseline(y, lam=1e5, p=0.01)
    assert np.abs(corrected[x < 0.4]).max() < 0.05
    assert corrected.max() > 0.8

def test_minmax_constant_is_zeros():
    assert minmax(np.array([5.0, 5.0, np.nan])).tolist()[:2] == [0.0, 0.0]

def test_preprocess_converts_only_nm():
    # deux Spectrum Raman avec le même pic (2848 cm-1), l'un en cm-1, l'autre en nm (laser 532) :
    # après preprocess, argmax de la grille identique (±1 point) et égal à l'indice de 2848 sur GRIDS["raman"]
```

- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent** — `.venv/Scripts/python -m pytest core/tests/test_preprocess.py -v` → FAIL (import).
- [ ] **Étape 3 : implémenter** les fonctions de `preprocess.py`. ALS : `scipy.sparse` (matrice des différences secondes `D`, résolution itérative de `(W + lam·DᵀD) z = W y` avec `spsolve`).
- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent** → tout PASS.
- [ ] **Étape 5 : commit** — `feat(core): spectral preprocessing (unit conversion, resampling, ALS baseline)`

---

### Tâche 3 : Lecteurs FLOPP, SLoPP et base Raman vieillie

**Files :**
- Create : `core/src/microtrace_core/readers/__init__.py`, `readers/common.py`, `readers/flopp.py`, `readers/slopp.py`, `readers/weathered.py`
- Test : `core/tests/test_readers_libraries.py`, `core/tests/conftest.py` (helpers qui écrivent l'arborescence synthétique dans `tmp_path`)

**Interfaces :**
- Consumes : `Spectrum`, `normalize_polymer`
- Produces :
  - `read_xy(path: Path, delimiter: str | None, skip_rows: int = 0) -> tuple[np.ndarray, np.ndarray]` (`delimiter=None` : n'importe quel blanc)
  - `sha256_file(path: Path) -> str`
  - `read_flopp(root: Path, variant: Literal["FLOPP", "FLOPP-e"]) -> Iterator[Spectrum]` : lit `root/"Spectres"/f"{variant} .csv"/*.CSV`, CSV à 2 colonnes sans en-tête. `source` = `"flopp"` ou `"flopp_e"`, `technique="ftir_atr"`, `state` = `"pristine"` ou `"weathered"`. Le code polymère est le préfixe avant le premier espace ; il est traduit par `FLOPP_CODES = {"AC": "acrylic", "CO": "cotton", "CE": "cellulose", "R": "rubber", "PEVA": "eva", "EVA": "eva", "CA": "cellulose acetate"}`, puis passé à `normalize_polymer`. `polymer_raw` = le code. `sample_group = f"{source}:{stem}"`, `spectrum_id = f"{source}:{stem}"`.
  - `read_slopp(root: Path, variant: Literal["SLoPP", "SLoPP-E"]) -> Iterator[Spectrum]` : lit `root/"Spectres"/"SLoPP and SLoPP-E"/variant/<dossier polymère>/*.txt`, séparateur tabulation. `polymer_raw` = nom du dossier. `source` = `"slopp"` ou `"slopp_e"`, `technique="raman"`, `x_unit="cm-1"`, `state` = `"pristine"` ou `"weathered"`. Les `.l6s` sont ignorés.
  - `read_weathered(root: Path) -> Iterator[Spectrum]` : lit le dossier `root/"Spectres"/"A Raman database of microplastics weathered under natural environments"`. Étiquettes tirées de `content.xlsx` (openpyxl) : lignes dont la colonne A correspond à `^(sta|wea)-\d+$` ; colonne B = `polymer_raw` ; colonne F = `label_note`. Un `.txt` sans ligne correspondante reçoit `polymer_raw=""`, donc `UNKNOWN`. `source="raman_weathered"`, `state` : `sta` → `pristine`, `wea` → `weathered`. Séparateur : blanc.

- [ ] **Étape 1 : écrire les tests qui échouent.** Les helpers de `conftest.py` créent pour chaque lecteur 2 à 3 fichiers de 12 lignes dans l'arborescence exacte (y compris le dossier `"FLOPP .csv"` avec espace final, et un `content.xlsx` écrit avec openpyxl). Assertions :
  - `test_flopp_reads_codes_and_states` : `ABS 1. Orange LEGO Fragment.CSV` donne `polymer == "ABS"`, `spectrum_id == "flopp:ABS 1. Orange LEGO Fragment"` et `state == "pristine"` ; avec `FLOPP-e`, `CO 1. Grey Fiber.CSV` donne `"CELLULOSE"`, `"weathered"`, `source == "flopp_e"`.
  - `test_slopp_label_from_folder` : `SLoPP-E/Polyethylene/Polyethylene 1. Blue Sphere.txt` donne `polymer == "PE"` et `state == "weathered"` ; un `.l6s` voisin n'est pas lu.
  - `test_weathered_labels_from_xlsx` : `wea-15.txt` avec la ligne `("wea-15", "PE", "/", "not", 3, "identified By ATR-FTIR")` donne `polymer == "PE"` et `label_note == "identified By ATR-FTIR"` ; `wea-99.txt` sans ligne donne `polymer == "UNKNOWN"` ; une ligne de type `"/"` donne `"UNKNOWN"`.
  - Pour chaque lecteur : `file` relatif en POSIX (`"Spectres/FLOPP .csv/ABS 1. Orange LEGO Fragment.CSV"`) et `len(s.x) == 12`.
- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent** → FAIL.
- [ ] **Étape 3 : implémenter** les trois lecteurs et `common.py`.
- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent** → PASS.
- [ ] **Étape 5 : commit** — `feat(core): readers for FLOPP, SLoPP and weathered Raman libraries`

---

### Tâche 4 : Lecteurs MicroPlastiX et RaSPI, et registre des lecteurs

**Files :**
- Create : `core/src/microtrace_core/readers/mpx.py`, `readers/raspi.py`
- Modify : `core/src/microtrace_core/readers/__init__.py` (registre)
- Test : `core/tests/test_readers_mpx_raspi.py`

**Interfaces :**
- Consumes : `read_xy`, `Spectrum`, `normalize_polymer`
- Produces :
  - `MPX_RAMAN_LASER_NM = 532.0`
  - `read_mpx(root: Path) -> Iterator[Spectrum]` : lit `root/"Spectres"/"10.22000-1820"/"data"/"dataset"`, parcourt `metadata.json["data"]` et lit pour chaque enregistrement `record["file"]` (CSV avec 1 ligne d'en-tête). `technique` : `"ATR"` → `ftir_atr`, `"Raman"` → `raman`. `x_unit = record["x_unit"]`. `laser_nm = MPX_RAMAN_LASER_NM` pour le Raman, `None` sinon. `polymer_raw = record["Polymer"]`. `state` : `"bio"` → `biofouled`, `"nobio"` → `weathered`. `sample_group = "mpx:" + record["Polymer"]` (regroupement par produit, plus strict que par site). `spectrum_id = "mpx:" + stem`. `extra` contient Region, Campaign, Exposure_days et State (en str). Un fichier référencé mais absent est ignoré, avec un `warnings.warn` qui le nomme.
  - `read_raspi(root: Path) -> Iterator[Spectrum]` : lit `RaSPI_raw.csv` avec le module `csv`, par paires de lignes `(id, "wavenumber", …)` puis `("", "intensity", …)`, après la ligne d'en-tête. Les cellules vides finales sont retirées avant la conversion en float. Les métadonnées viennent de `RaSPI_metadata.csv` (module `csv`, `encoding="utf-8-sig"`, jointure sur `Spectra ID`) : `polymer_raw = "Plastic Type"`, `laser_nm = float("Laser (nm)")`. `x_unit="cm-1"`, `state="pristine"`, `source="raspi"`, `sample_group = "raspi:" + re.sub(r"[a-z]$", "", id)` (`PE1a` → `raspi:PE1`).
  - `iter_all(root: Path) -> Iterator[Spectrum]` : enchaîne dans cet ordre `read_mpx`, `read_flopp(FLOPP)`, `read_flopp(FLOPP-e)`, `read_slopp(SLoPP)`, `read_slopp(SLoPP-E)`, `read_raspi`, `read_weathered`.

- [ ] **Étape 1 : écrire les tests qui échouent** (arborescence synthétique) :
  - `test_mpx_reads_units_per_record` : deux enregistrements Raman, l'un `x_unit="nm"`, l'autre `"cm-1"`. Les deux Spectrum conservent leur unité d'origine et ont `laser_nm == 532.0`. Un enregistrement ATR a `laser_nm is None` et `technique == "ftir_atr"`.
  - `test_mpx_groups_by_product` : `"(09) PET"` à deux régions différentes donne le même `sample_group == "mpx:(09) PET"`, avec `polymer == "PET"` et `state == "biofouled"` pour `Treatment="bio"`.
  - `test_mpx_missing_file_warns` : `pytest.warns(UserWarning, match="absent.csv")`, et les autres enregistrements sont bien lus.
  - `test_raspi_drops_trailing_empty_cells` : une paire de lignes terminée par `",,,"` donne `len(x) == len(y) == 12`, sans NaN.
  - `test_raspi_metadata_quoted_commas` : un champ `"cream container,mhplastics.com/...,c16902/03"` donne `polymer == "PP"` et `laser_nm == 633.0`.
  - `test_raspi_sample_group_strips_suffix` : `PE1a` et `PE1b` donnent `"raspi:PE1"`.
- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent** → FAIL.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent** → PASS.
- [ ] **Étape 5 : commit** — `feat(core): MicroPlastiX and RaSPI readers, reader registry`

---

### Tâche 5 : Catalogue Parquet traçable et CLI

**Files :**
- Create : `core/src/microtrace_core/catalog.py`, `core/src/microtrace_core/cli.py`, `core/src/microtrace_core/__main__.py`
- Test : `core/tests/test_catalog.py`, `core/tests/test_real_data.py` (marqué `data`)

**Interfaces :**
- Consumes : `iter_all`, `preprocess`, `coverage`, `GRIDS`, `PREPROCESS_VERSION`, `sha256_file`
- Produces :
  - `build_catalog(datasets_root: Path, out_dir: Path) -> dict` : écrit `out_dir/"spectra_catalog.parquet"` et `out_dir/"catalog_meta.json"`, et retourne le contenu de la méta.
  - Colonnes Parquet : `spectrum_id, source, technique, polymer, polymer_raw, state, sample_group, file, file_sha256, laser_nm, x_unit, label_note, coverage (float), x_raw (list<float64>), y_raw (list<float64>), y_grid (list<float32>), extra (str JSON)`.
  - Méta JSON : `built_at` (ISO UTC), `preprocess_version`, `grids` (`{technique: [start, stop, step]}`), `data_nature` (texte des Global Constraints), `git_commit` (`git rev-parse HEAD`, ou `"unknown"`), `counts` (`by_source`, `by_technique`, `by_polymer`), `warnings` (liste de str).
  - `load_catalog(path: Path) -> pd.DataFrame` ; `grid_matrix(df: pd.DataFrame) -> np.ndarray` (empile `y_grid` en float32, shape `(n, len(grid))` ; `ValueError` si `df` mélange plusieurs techniques).
  - CLI : `python -m microtrace_core build-catalog --datasets <dir> --out <dir>`

- [ ] **Étape 1 : écrire les tests qui échouent :**
  - `test_build_catalog_roundtrip` : sur l'arborescence synthétique complète (helpers des tâches 3 et 4), la méta contient `by_source` avec les 7 sources ; `load_catalog` relit le même nombre de lignes ; `x_raw` est identique au fichier source ; `file_sha256` est égal à `sha256_file` du fichier.
  - `test_build_catalog_rejects_duplicate_ids` : deux Spectrum avec le même `spectrum_id` (injectés en monkeypatchant `iter_all`) lèvent `ValueError`, avec l'identifiant dans le message.
  - `test_grid_matrix_rejects_mixed_techniques` → `ValueError`.
  - `test_cli_build_catalog` : `subprocess.run([sys.executable, "-m", "microtrace_core", "build-catalog", ...])` renvoie le code retour 0 et crée les 2 fichiers.
  - `test_real_data.py::test_real_counts` (`@pytest.mark.data`, fixture `datasets_root`, sortie dans `tmp_path`) : `by_source == {"mpx": 5809, "flopp": 186, "flopp_e": 195, "slopp": 148, "slopp_e": 113, "raspi": 402, "raman_weathered": 173}`. Les spectres Raman MicroPlastiX de polymère `PE` et `state == "weathered"` (sans biofilm) ont leur maximum de `y_grid` dans `[2800, 2950]` cm⁻¹ pour au moins 80 % d'entre eux, ce qui valide le laser à 532 nm.
- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent** → FAIL.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent** → `.venv/Scripts/python -m pytest core/tests -v` PASS, y compris `test_real_counts` (données présentes en local).
- [ ] **Étape 5 : construire le vrai catalogue** — `.venv/Scripts/python -m microtrace_core build-catalog --datasets datasets --out data/processed` ; vérifier que `catalog_meta.json` ne contient pas d'avertissement inattendu.
- [ ] **Étape 6 : commit** — `feat(core): traceable Parquet spectral catalog and CLI`

---

### Tâche 6 : Package `ml`, séparations sans fuite et matcher par corrélation

**Files :**
- Create : `ml/pyproject.toml`, `ml/src/microtrace_ml/__init__.py`, `ml/src/microtrace_ml/splits.py`, `ml/src/microtrace_ml/matching.py`
- Test : `ml/tests/test_splits.py`, `ml/tests/test_matching.py`

**Interfaces :**
- Consumes : `load_catalog`, `grid_matrix` (le DataFrame du catalogue, filtré sur une seule technique)
- Produces :
  - `leave_one_source_out(df) -> Iterator[tuple[str, np.ndarray, np.ndarray]]` : `(source_tenue, idx_train, idx_test)`, une itération par source.
  - `group_kfold(df, n_splits: int = 5, seed: int = 0) -> Iterator[tuple[np.ndarray, np.ndarray]]` : `StratifiedGroupKFold(shuffle=True, random_state=seed)` avec `y=polymer` et `groups=sample_group`.
  - `pristine_to_aged(df) -> tuple[np.ndarray, np.ndarray]` : apprentissage sur `state == "pristine"`, test sur `state in {"weathered", "biofouled"}`.
  - `NO_MATCH = "NO_MATCH"` ; `@dataclass MatchResult(labels: np.ndarray, scores: np.ndarray, best_ids: np.ndarray)`
  - `class CorrelationMatcher(min_overlap: float = 0.5)` avec `fit(Y: np.ndarray, labels: Sequence[str], ids: Sequence[str]) -> CorrelationMatcher` et `predict(Q: np.ndarray, threshold: float = 0.0) -> MatchResult`. Le score est la corrélation de Pearson calculée sur les points finis à la fois dans la requête et dans la référence. Une paire dont le recouvrement est inférieur à `min_overlap × n_points` reçoit le score `-inf`. Si le meilleur score est inférieur à `threshold`, ou s'il n'existe aucune paire valide, l'étiquette est `NO_MATCH`.

- [ ] **Étape 1 : écrire les tests qui échouent :**
  - `test_group_kfold_no_group_leak` : DataFrame synthétique (30 lignes, 10 groupes, 3 polymères). Pour chaque pli, `set(groups[train]) & set(groups[test]) == set()`.
  - `test_leave_one_source_out_holds_each_source_once` : 3 sources donnent 3 itérations ; tous les indices de test appartiennent à la source tenue.
  - `test_pristine_to_aged_split` : aucun indice `pristine` dans le test, aucun indice vieilli dans l'apprentissage.
  - `test_matcher_finds_shifted_scaled_copy` : bibliothèque de 3 spectres gaussiens à des positions distinctes. La requête `2 × spectre_1 + 0.3` donne `labels == ["B"]` et un score supérieur à 0.999.
  - `test_matcher_rejects_low_overlap` : une requête dont seuls 30 % des points sont finis donne `NO_MATCH` avec `min_overlap=0.5`.
  - `test_matcher_threshold_abstains` : du bruit pur avec `threshold=0.9` donne `NO_MATCH`.
- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent** → FAIL.
- [ ] **Étape 3 : implémenter**, après `.venv/Scripts/python -m pip install -e "ml[dev]"`. Le matcher est vectorisé sur la bibliothèque pour chaque requête : NaN remplacés par 0, masques de finitude, sommes partielles (Σx, Σy, Σxy, Σx², Σy², n) calculées par produits matriciels avec les masques.
- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent** → `.venv/Scripts/python -m pytest ml/tests -v` PASS.
- [ ] **Étape 5 : commit** — `feat(ml): leakage-safe splits and correlation matcher`

---

### Tâche 7 : Évaluation de la baseline (corrélation et PCA+SVM) et rapport

**Files :**
- Create : `ml/src/microtrace_ml/classifier.py`, `ml/src/microtrace_ml/evaluate.py`, `ml/src/microtrace_ml/cli.py`, `ml/src/microtrace_ml/__main__.py`
- Test : `ml/tests/test_evaluate.py`
- Output (versionné) : `reports/baseline/metrics.json`, `reports/baseline/report.md`

**Interfaces :**
- Consumes : `load_catalog`, `grid_matrix`, les séparations, `CorrelationMatcher`, `NO_MATCH`
- Produces :
  - `make_pca_svm(n_components: int = 30) -> sklearn.pipeline.Pipeline` : `SimpleImputer(strategy="constant", fill_value=0.0)`, puis `PCA(n_components)`, puis `SVC(kernel="rbf", class_weight="balanced")`.
  - `EVAL_EXCLUDED = {"UNKNOWN", "OTHER"}`, `MIN_COVERAGE = 0.8`
  - `evaluate_predictions(y_true: Sequence[str], y_pred: Sequence[str]) -> dict` : clés `n`, `accuracy`, `macro_f1`, `coverage` (fraction des prédictions différentes de `NO_MATCH`), `per_class_recall` (dict), `confusion` (dict de dicts). Un `NO_MATCH` compte comme une erreur dans `accuracy`.
  - `run_baseline(catalog_path: Path, out_dir: Path, threshold: float = 0.7) -> dict` : pour chaque technique, et pour chaque protocole (`loso`, `group_kfold`, `pristine_to_aged`) × méthode (`correlation@0`, `correlation@threshold`, `pca_svm`), calcule les métriques. Les lignes `polymer ∈ EVAL_EXCLUDED` ou `coverage < MIN_COVERAGE` sont retirées avant toute séparation, et leur nombre est noté dans `excluded`. En `loso`, une requête dont le polymère est absent de la bibliothèque est comptée dans `out_of_library` et exclue de `accuracy`. Écrit `metrics.json` et `report.md` : un tableau par technique, l'effectif par source et par polymère, le texte `data_nature` et le `git_commit` du catalogue.
  - CLI : `python -m microtrace_ml baseline --catalog <parquet> --out <dir> [--threshold 0.7]`

- [ ] **Étape 1 : écrire les tests qui échouent :**
  - `test_evaluate_predictions_counts_no_match_as_error` : `y_true=["PE","PE","PP","PP"]`, `y_pred=["PE","NO_MATCH","PP","PE"]` donne `accuracy == 0.5`, `coverage == 0.75` et `per_class_recall == {"PE": 0.5, "PP": 0.5}`.
  - `test_evaluation_excludes_unknown_and_other` : un catalogue synthétique (écrit via `build_catalog` sur l'arborescence synthétique, ou un DataFrame Parquet construit directement) avec des lignes `UNKNOWN` et `OTHER`. `run_baseline` termine sans erreur, aucune de ces étiquettes n'apparaît dans `per_class_recall`, et `excluded > 0`.
  - `test_loso_out_of_library_counted` : une source ne contient qu'un polymère absent des autres sources, ce qui donne `out_of_library == n` pour cette source.
  - `test_cli_baseline_writes_reports` : le code retour est 0 et `metrics.json` et `report.md` existent.
- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent** → FAIL.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent** → `.venv/Scripts/python -m pytest -v` (tout le dépôt) PASS.
- [ ] **Étape 5 : lancer sur les vraies données** — `.venv/Scripts/python -m microtrace_ml baseline --catalog data/processed/spectra_catalog.parquet --out reports/baseline`. Relire `report.md`. Une précision supérieure à 0.98 en `group_kfold` **et** en `loso` doit faire suspecter une fuite et être examinée avant le commit.
- [ ] **Étape 6 : commit** — `feat(ml): baseline evaluation (correlation, PCA+SVM) and first report` (inclut `reports/baseline/`)
