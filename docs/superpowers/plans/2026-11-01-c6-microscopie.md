# C6 — Analyse d'images de microscopie — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un onglet « Images » où un chercheur dépose une image de microscopie (PNG, JPEG, TIFF) et reçoit une **proposition** : le contour de chaque particule candidate, leur nombre, leur taille (Feret, aire, en µm si l'échelle est connue), leur forme (`fibre | fragment | bille`, `film` non évalué) avec un score, la distribution des tailles et l'image annotée. Un statut `Proposition | Non fiable (abstention)` dit quand le modèle ne sait pas. Le chercheur accepte, corrige (par particule) ou rejette ; les images validées donnent un **comptage de particules candidates**, distinct des mesures.

**Architecture :**
- `core` contient tout le traitement d'image (`microtrace_core.imaging`) : lecture sûre (Pillow), échelle, forêt de pixels et classifieur de forme en inférence numpy, géométrie (scikit-image), statut et abstention, rendu des PNG sans métadonnées, index et séparation de `dataset3`, évaluateur, commande `train-image`.
- Le moteur charge `models/c6-microscopie-i1.npz` après vérification du sha256 contre un verrou versionné, expose `GET /ai/image/model`, `POST /ai/image/analyze`, `POST /ai/image/validate`, et rédige seul les textes français (`image_text.py`).
- Le web enregistre chaque analyse et chaque décision comme une nouvelle ligne `ModelPrediction` (kind `image`), stocke l'image réécrite par le moteur (jamais le fichier déposé), et ne calcule rien.

**Tech Stack :** celle de C1 à C7 et C5. **Dépendances ajoutées (à valider par le contrôleur avant la tâche 1)** : `Pillow==12.1.1` (MIT-CMU) et `scikit-image==0.26.0` (BSD-3, avec networkx, imageio, tifffile, lazy-loader) dans l'extra `core[imaging]` et dans le moteur ; scikit-learn reste dans `core[train]`. Torch et torchvision seulement dans l'extra `ml[maskrcnn]` de la tâche 9 (optionnelle). Aucune dépendance npm.

**Spec :** `docs/superpowers/specs/2026-11-01-c6-microscopie-design.md` (décisions D1 à D8 au §0), qui précise la spec du prototype (`2026-10-25-prototype-studio-design.md`, §2, §3, §10 « C6 » et « Cycle de vie des modèles », §11).

## Sources à lire

| Fichier | Pourquoi |
|---|---|
| `docs/superpowers/specs/2026-11-01-c6-microscopie-design.md` | **Conception** : données (§3), modèle (§4), entraînement (§5), dépendances et poids (§6), moteur (§7), service (§8), écran (§9), consentement (§10), fiche (§11), chiffres attendus (§12), relecture (§13) |
| `docs/superpowers/plans/2026-10-31-c5-spectral.md` | Global Constraints, découpage et tests du modèle le plus proche |
| `core/src/microtrace_core/spectral/{archive,train}.py` | archive déterministe, manifeste, verrou, bloc de métriques de la fiche |
| `engine/src/microtrace_engine/{app,spectral,spectral_text,uploads,numbers}.py` | magasin de poids, routes, textes, lecture bornée |
| `web/src/server/{spectral,training-consent,file-store,multipart,download-response}.ts`, `web/src/lib/{spectral,training-consent}.ts` | service, décisions, magasin, export |
| `…/etudes/[studyId]/spectres/**` | pages, formulaires, tests, route `analyser` |
| `web/src/server/__tests__/tenant-isolation.test.ts`, `web/e2e/spectral.spec.ts` | isolation, parcours e2e lu dans `datasets/` |
| `datasets/SOURCES.md`, `datasets/Images/dataset3/` | licences ; données (lecture seule) |

## Global Constraints

1. **Aucun calcul d'image en TypeScript** : segmentation, tailles, formes, histogramme, statut, application des corrections, arrondis : `core` ou le moteur. Le TypeScript valide des listes fermées et des formes (entiers, longueurs), transmet, enregistre et affiche.
2. **Aucune fuite entre photos** : l'index ne contient que les 237 images d'origine ; groupes (préfixe `fibre_2`, quasi-doublons) ; séparation par `sha256(clé du groupe) mod 100` ; le test n'est lu qu'une fois, après les choix sur la validation ; le modèle servi est appris sur apprentissage + validation, jamais sur le test.
3. **Déterminisme** : graine 0 ; archive de C5 à date fixe ; deux entraînements donnent le même sha256. Ni date ni commit dans les poids.
4. **Poids sans pickle** : `.npz` lu par `np.load(..., allow_pickle=False)` sur des octets vérifiés **avant** lecture. Jamais de poids ni d'image de `datasets/` dans Git : `git status --porcelain` avant chaque commit ; `git ls-files models datasets | grep -v SOURCES.md` vide.
5. **Aucune métadonnée** : `core` ne renvoie jamais une chaîne lue dans un fichier image ; seul `PixelSize` est extrait, en nombre ; les PNG produits n'ont ni `pnginfo` ni `exif` ; le fichier déposé n'est jamais écrit dans le magasin.
6. **Les mots à un seul endroit** : textes du modèle dans `microtrace_engine/image_text.py` ; le web n'ajoute que les libellés des décisions, des options de correction et du formulaire (`web/src/lib/images.ts`) et du consentement (`web/src/lib/training-consent.ts`).
7. **Rien n'est modifié ni supprimé** : analyses et décisions sont de nouvelles lignes `ModelPrediction` ; une décision est validée contre l'`output` **enregistré**.
8. **Comptages ≠ mesures** : rien dans `Measurement`, `/summary`, Résultats ou le rapport.
9. **Multi-laboratoires (§11)** : `LabContext` partout ; filtre `laboratoryId` ; « Étude introuvable. », « Analyse introuvable. », 404 pour les routes de fichiers ; chaque fonction exportée dans `tenant-isolation.test.ts`.
10. **Droits** : lecture `viewer` ; analyse et décision `researcher`+ sur étude non archivée ; consentement et export d'entraînement `lab_admin`.
11. **Interface** : français ; un seul `h1` ; `h2` pour les sections ; jetons de couleur seulement (SVG et Recharts compris) ; tablette 768 et 1024 ; **aucun lien dont le nom contient « Rapport » ou « Résultats »** ; jamais le nom du fichier déposé dans un nom de lien ou de fichier téléchargé.
12. **Journaux** : jamais de pixel, de nom de fichier, de métadonnée, de note ni de valeur dans `console.*`, les journaux du moteur, l'audit ou l'export.
13. **Sécurité et environnement** : ne lis jamais `.env*` ; ne touche pas au PostgreSQL Windows (5432) ; pas de Docker (le `Dockerfile` et `docker-compose.yml` peuvent être modifiés, pas lancés) ; tests web sur embedded-postgres ; rien sous `datasets/` n'est modifié ni commité.

## Review Focus

1. **Fuite entre photos** : groupes, quasi-doublons, dérivés exclus, test lu une fois, espion sur l'apprentissage (tâches 1, 2).
2. **Échelle fausse ou absente** : refus d'une échelle contraire aux métadonnées, tailles `null` sans échelle, prise en compte du recadrage et de la réduction, `XResolution` ignoré (tâches 1, 3).
3. **Images énormes ou étranges** : 16 bits, CMYK, alpha, palette, orientation EXIF, multipage, bombe de décompression, fichier tronqué, 413 sans appel au moteur (tâches 1, 3, 4).
4. **Aucune image avec métadonnées personnelles** : TIFF piégé, octets des PNG produits, journaux, magasin sans fichier déposé, export (tâches 1, 3, 4, 6).
5. **Isolation entre laboratoires** : services, routes de fichiers, export (tâches 4, 6, 7).
6. **Formes non évaluées** : `film` jamais proposé, `evaluated: false`, mention à l'écran (tâches 1, 3, 5).
7. **Abstention atteinte** : raisons synthétiques, parts publiées au test, e2e d'une image uniforme (tâches 1, 2, 7).
8. **Empreinte des poids différente → refus de servir** (tâche 3).

## Quand s'arrêter (décisions du contrôleur)

Arrête-toi et écris la question en tête de ton rapport si :
- le contrôleur n'a pas validé D2 (Pillow, scikit-image) : n'installe rien ;
- l'index ne compte pas 237 images, 218 groupes, et 147 / 48 / 42 images par côté ;
- les métriques du test s'écartent des valeurs attendues du §12 de la conception au-delà des tolérances de la tâche 2 ;
- la forêt numpy diffère de `predict_proba` de plus de 1e-6, ou deux entraînements ne donnent pas le même sha256 ;
- l'archive dépasse 50 Mo, ou l'analyse d'une image de 2 560 × 1 800 dépasse 30 s dans le moteur sur ce PC ;
- une dépendance autre que celles de D2 semble nécessaire ;
- un test existant de C1 à C7, C5 ou de la passe de design doit changer de sens pour passer (déplacements permis : `write_archive` vers `microtrace_core/archive.py` avec réexport ; ajout d'un onglet à une liste attendue ; passage du consentement à `c2` dans les tests qui le citent).

---

Pour chaque tâche : tests d'abord (échec noté), implémentation, vérifications, commit conventionnel terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Web : `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` dans `web/`. Python : `.venv/Scripts/python -m pytest core/tests ml/tests engine/tests -q` depuis la racine.

### Tâche 0 — Dépendances (après accord du contrôleur)

**Fichiers :** `core/pyproject.toml` (extra `imaging = ["Pillow==12.1.1", "scikit-image==0.26.0"]`), `engine/pyproject.toml` (dépend de `microtrace-core[imaging]`), `engine/constraints.txt` (régénéré : `pip freeze` restreint à l'arbre core + engine), `engine/Dockerfile` (rien à changer si l'installation passe par les contraintes ; sinon ajouter l'extra).

**Commandes :**
```
.venv/Scripts/python -m pip install -e "core[dev,train,imaging]" -e "engine[dev]"
.venv/Scripts/python -c "import PIL, skimage; print(PIL.__version__, skimage.__version__)"   # 12.1.1 0.26.0
.venv/Scripts/python -m pytest engine/tests/test_hygiene.py -q                                # contraintes = venv
.venv/Scripts/python -m pytest core/tests ml/tests engine/tests -q                             # 0 failed
```
Vérifie les licences installées : `pip show Pillow scikit-image networkx imageio tifffile lazy-loader` → MIT-CMU/HPND, BSD-3, BSD-3, BSD-2, BSD-3, BSD-3. Toute autre licence : arrêt.

**Commit :** `build: Pillow et scikit-image pour l'analyse d'images (extra core[imaging], moteur)`

### Tâche 1 — Paquet `microtrace_core.imaging` (code et tests synthétiques)

**Fichiers :**
- créer `core/src/microtrace_core/archive.py` (contenu déplacé de `spectral/archive.py` : `FIXED_DATE`, `write_archive`, `read_archive`) ; `spectral/archive.py` les réexporte (tests C5 inchangés) ;
- créer `core/src/microtrace_core/imaging/{__init__,reading,features,forest,geometry,shape,model,render,dataset,evaluate,train}.py` ;
- modifier `core/src/microtrace_core/cli.py` (sous-commandes `train-image` et `image-eval`) ;
- créer `core/tests/imaging_fixtures.py` (images synthétiques : disques, rectangles minces, fond à gradient, bruit graine 0 ; mini-jeu `dataset3` écrit dans `tmp_path` : 3 sous-jeux × 6 images 256 × 192 avec masques, fichiers `counts`, TIFF Hitachi piégés) et `core/tests/test_imaging_{reading,forest,geometry,shape,model,render,dataset,evaluate,train}.py`.

**Interfaces (exactes) :**
```python
# imaging/__init__.py
IMAGE_MODEL_NAME = "c6-microscopie"; IMAGE_MODEL_VERSION = "i1"; SEED = 0

# reading.py
MAX_IMAGE_BYTES = 25 * 1024 * 1024; MAX_PIXELS = 40_000_000; MIN_SIDE = 128; HITACHI_BAR_FRACTION = 1 / 16
class ImageIssue(StrEnum): EMPTY = "empty"; UNSUPPORTED_FORMAT = "unsupported_format"; UNREADABLE = "unreadable"
    MULTIPAGE = "multipage"; TOO_SMALL = "too_small"; TOO_MANY_PIXELS = "too_many_pixels"; UNSUPPORTED_MODE = "unsupported_mode"
class ImageReadError(ValueError):
    def __init__(self, issue: ImageIssue, width: int | None = None, height: int | None = None, pixels: int | None = None) -> None
@dataclass(frozen=True) class DecodedImage: gray: np.ndarray  # uint8 (h, w), orientée, sans bandeau
    format: str; width: int; height: int; bit_depth: int; color: str; orientation_applied: bool; alpha_ignored: bool
    cropped_bottom_px: int; metadata_um_per_px: float | None; contrast: float   # centile 99 − centile 1, sur 255
def decode_image(data: bytes) -> DecodedImage
def hitachi_pixel_size_nm(xp_comment: bytes | str) -> float | None          # motif ^PixelSize=([0-9.]+)$ seulement

# features.py
SIGMAS = (1, 2, 4, 8, 16); BACKGROUND_SIGMA = 64; N_FEATURES = 23
def normalise(gray: np.ndarray) -> np.ndarray                                # float32, centiles 1–99
def pixel_features(img: np.ndarray) -> np.ndarray                            # (h, w, 23) float32

# forest.py
@dataclass(frozen=True) class Forest: feature: np.ndarray; threshold: np.ndarray; left: np.ndarray; right: np.ndarray
    value: np.ndarray; roots: np.ndarray; max_depth: int
def forest_from_sklearn(rf) -> Forest                                         # entraînement seulement
def forest_proba(f: Forest, X: np.ndarray) -> np.ndarray                      # (n,) float32, moyenne des feuilles

# geometry.py
MAX_CONTOUR_POINTS = 200
@dataclass(frozen=True) class Particle: id: int; contour: tuple[tuple[float, float], ...]; bbox: tuple[int, int, int, int]
    area_px: float; feret_max_px: float; feret_min_px: float; eq_diameter_px: float; circularity: float; solidity: float
    elongation: float; aspect: float; extent: float; eccentricity: float; touches_border: bool
def particles_from_labels(labels: np.ndarray) -> list[Particle]              # ids 1..n par aire décroissante
def feret(points: np.ndarray) -> tuple[float, float]                          # calibres tournants sur l'enveloppe convexe

# shape.py
SHAPES = ("fibre", "fragment", "bille"); UNEVALUATED_SHAPES = ("film",)
@dataclass(frozen=True) class ShapeModel: mean: np.ndarray; scale: np.ndarray; coef: np.ndarray; intercept: np.ndarray; classes: tuple[str, ...]
def shape_features(p: Particle) -> np.ndarray                                 # circularité, solidité, log aspect, log allongement, étendue, excentricité
def shape_proba(m: ShapeModel, X: np.ndarray) -> np.ndarray                   # softmax
def rule_shape(p: Particle) -> str                                            # référence publiée (allongement ≥ 3 ; bille ; fragment)

# model.py
ANALYSIS_MAX_SIDE = 1024; MAX_PARTICLES = 300; MIN_CONTRAST = 10; SCALE_MISMATCH_TOLERANCE = 0.02
SIZE_BINS_UM = (0, 10, 20, 50, 100, 200, 500, 1000, 5000, math.inf)
class Status(StrEnum): PROPOSAL = "proposal"; UNRELIABLE = "unreliable"
class Reason(StrEnum): NO_PARTICLE = "no_particle"; TOO_MANY_PARTICLES = "too_many_particles"
    LARGE_FOREGROUND = "large_foreground"; LOW_CONTRAST = "low_contrast"; SCALE_OUT_OF_RANGE = "scale_out_of_range"
class ScaleSource(StrEnum): METADATA = "metadata"; ENTERED = "entered"; NONE = "none"
class ScaleMismatch(ValueError): entered: float; metadata: float
@dataclass(frozen=True) class Settings: pixel_threshold: float; min_area_frac: float; shape_min_score: float
    max_foreground: float; scale_min: float; scale_max: float     # échelles en µm/px de l'image d'analyse
@dataclass(frozen=True) class ImageModel: name: str; version: str; forest: Forest; shape: ShapeModel; settings: Settings; meta: Mapping[str, object]
@dataclass(frozen=True) class Scale: um_per_px_input: float; um_per_px_analysis: float; source: ScaleSource
@dataclass(frozen=True) class ScoredParticle: particle: Particle; shape: str; shape_score: float; confident: bool
@dataclass(frozen=True) class SizeBin: lower: float; upper: float; count: int
@dataclass(frozen=True) class ImageAnalysis: status: Status; reasons: tuple[Reason, ...]; scale: Scale | None
    analysis_size: tuple[int, int]; downscale: float; foreground: float; particles: tuple[ScoredParticle, ...]
    count: int; size_bins: tuple[SizeBin, ...] | None; min_detectable_px: float; analysis_gray: np.ndarray
def resolve_scale(decoded: DecodedImage, entered: float | None, analysis_width: int) -> Scale | None   # ScaleMismatch
def segment(model: ImageModel, gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]                     # (probabilité, étiquettes)
def analyze(model: ImageModel, decoded: DecodedImage, entered_um_per_px: float | None) -> ImageAnalysis
def size_distribution(feret_um: Sequence[float]) -> tuple[SizeBin, ...]
@dataclass(frozen=True) class Validated: count: int; kept: int; excluded: int; missed: int
    by_shape: Mapping[str, int]; size_bins: tuple[SizeBin, ...] | None; changes: int
class CorrectionError(ValueError): code: str; particle_id: int | None          # unknown_particle | both | unknown_shape
def apply_corrections(particles: Sequence[Mapping], scale_um_per_px: float | None, excluded: Sequence[int],
                      reshaped: Sequence[tuple[int, str]], missed: int) -> Validated

# render.py
def png_bytes(gray: np.ndarray) -> bytes                                      # Image.fromarray(...).save(PNG), sans pnginfo ni exif
def annotated_png(gray: np.ndarray, particles: Sequence[ScoredParticle]) -> bytes   # contours colorés par forme, numéros

# dataset.py (entraînement seulement)
SUBSETS: Mapping[str, tuple[str, str | None, str]]  # bead, fibre_1, fibre_2, fragment_1, fragment_2 → (dossier, dossier TIFF, forme)
@dataclass(frozen=True) class Item: subset: str; shape: str; image: Path; label: Path; count: int | None
    um_per_px: float | None; tiff: Path | None; group: str; split: str
def read_counts(path: Path) -> dict[str, int]
def build_index(root: Path) -> list[Item]                                     # 237 éléments, triés par chemin
def assign_groups(items: Sequence[Item], thumbs: np.ndarray, threshold: float = 0.9) -> list[str]
def split_of(group_key: str) -> str                                           # sha256 mod 100 : <20 test, <40 val, sinon train

# evaluate.py
def match_instances(pred: np.ndarray, gt: np.ndarray, iou_min: float = 0.5) -> list[tuple[int, int, float]]
def gt_instances(mask: np.ndarray, min_area_frac: float) -> np.ndarray
def evaluate_split(items, predict: Callable[[Item], np.ndarray], shape_of: Callable | None) -> dict   # métriques §5.3

# train.py (seul module qui importe sklearn)
class IndexMismatch(RuntimeError): ...
def otsu_baseline(gray: np.ndarray, min_area_frac: float = 0.002) -> np.ndarray
def fit_forest(items: Sequence[Item]) -> Forest
def fit_shape(items: Sequence[Item]) -> ShapeModel
def choose_settings(model_forest: Forest, shape: ShapeModel, val: Sequence[Item]) -> tuple[Settings, dict]
def train(root: Path) -> tuple[ImageModel, dict]                              # modèle final + manifeste (sans date ni commit)
def render_card_metrics(manifest: Mapping) -> str
def run_training(*, dataset: Path, models_dir: Path, manifest: Path, data_list: Path, lock: Path,
                 card: Path | None, check: bool = False) -> int               # 0 | 3 | 4 | 5 | 6
def model_to_arrays(m: ImageModel) -> dict[str, np.ndarray]; def model_from_arrays(a) -> ImageModel; def load_model_bytes(data: bytes) -> ImageModel
```
- Choix des réglages, final sur apprentissage + validation, test lu une fois : conception §5.4. Statut et raisons : §4.5. Lecture : §7.2. Échelle : §7.3.
- `model_to_arrays`, `model_from_arrays` et `load_model_bytes` vivent dans `model.py` (pas d'import de sklearn) ; `train.py` les réutilise.

**Tests :**
- `test_archive_moved_without_change` : `microtrace_core.spectral.archive.write_archive is microtrace_core.archive.write_archive` ; tests C5 verts.
- `test_decode_formats` (paramétré) : PNG `L` 200 × 150, PNG `RGBA` (`alpha_ignored`), PNG palette, JPEG RGB, JPEG CMYK, TIFF 16 bits (valeurs 1 000 à 60 000 → `gray.min() == 0`, `gray.max() == 255`, `bit_depth == 16`), TIFF `F` → `gray.dtype == uint8`, forme `(150, 200)`.
- `test_decode_exif_orientation_6` : JPEG 200 × 100 avec orientation 6 → `width == 100`, `height == 200`, `orientation_applied`.
- `test_decode_errors` (paramétré) : `b""` → `EMPTY` ; GIF → `UNSUPPORTED_FORMAT` ; PNG tronqué à la moitié → `UNREADABLE` ; TIFF de 2 pages → `MULTIPAGE` ; PNG 100 × 300 → `TOO_SMALL` ; en-tête PNG déclarant 50 000 × 50 000 (IHDR forgé, 200 octets) → `TOO_MANY_PIXELS` **sans** décodage (espion sur `Image.Image.load` jamais appelé) ; mode `I;16B` 2 canaux impossible → `UNSUPPORTED_MODE`.
- `test_hitachi_scale_and_bar` : TIFF 1 280 × 960 avec `XPComment` `"SerialNumber=5000-3123-03\r\nDataNumber=SU5000 0002\r\nPixelSize=992.1875\r\n"` → `metadata_um_per_px == 0.9921875`, `cropped_bottom_px == 60`, `gray.shape == (900, 1280)` ; sans `SerialNumber` : ni recadrage ni échelle ; `XResolution = 25 400` px/pouce sans `XPComment` → `metadata_um_per_px is None`.
- `test_no_metadata_string_leaks` : TIFF piégé (`XPComment` avec `SampleName=Jean Dupont`, `Comment=Dupont`, `XPAuthor="Jean Dupont"`, EXIF `Artist`, XMP `<dc:creator>Jean Dupont</dc:creator>`) : `"Dupont"` absent de `repr(decoded)`, de `png_bytes(decoded.gray)`, de `annotated_png(...)` ; les PNG produits n'ont aucun bloc `tEXt`, `iTXt`, `zTXt` ni `eXIf` (lecture des blocs).
- `test_forest_matches_sklearn` : `RandomForestClassifier(n_estimators=7, max_depth=6, random_state=0)` sur 2 000 × 23 points synthétiques ; `forest_proba` égal à `predict_proba[:, 1]` à 1e-6 sur 5 000 points.
- `test_feret_square_and_rectangle` : carré plein 100 × 100 px → Feret max ≈ 141,4 (± 1,5), min ≈ 100 (± 1,5) ; rectangle 200 × 10 → max ≈ 200,2, min ≈ 10 (± 1).
- `test_particles_ids_by_area_and_border` : 3 disques de rayons 30, 20, 10, dont le plus petit coupé par le bord → ids 1, 2, 3 par aire décroissante, `touches_border` seulement pour le 3 ; contours ≤ 200 points, fermés.
- `test_shape_proba_matches_sklearn` : `LogisticRegression(C=1, class_weight="balanced")` sur descripteurs synthétiques ; probabilités égales à 1e-9.
- `test_film_never_proposed` : un rectangle mince 400 × 60 px → forme ∈ `SHAPES` ; `"film"` jamais dans les sorties de `shape_proba` (classes du modèle) ni de `analyze`.
- `test_scale_resolution` : PNG 2 048 × 1 536 avec 0,5 µm/px saisi → `um_per_px_analysis == 1.0` (réduction à 1 024) ; carré de 200 × 200 px dans l'image déposée → Feret min ≈ 100 µm (± 2) ; TIFF Hitachi (0,9921875) + saisie 1,0 → `ScaleMismatch` ; + saisie 0,995 (écart 0,28 %) → `source == "metadata"`.
- `test_no_scale_no_microns` : sans échelle → `scale is None`, `size_bins is None`.
- `test_abstention_reasons` (modèle synthétique « seuil sur l'intensité », `Settings(0.5, 0.0005, 0.6, 0.4, 0.06, 25.0)`) : image uniforme 128 → `NO_PARTICLE` ; damier 2 × 2 de carrés 300 px → `LARGE_FOREGROUND` ; 400 disques de rayon 6 sur 1 024 × 1 024 → `TOO_MANY_PARTICLES` et 300 particules gardées (les plus grandes) ; image d'amplitude 10 → `LOW_CONTRAST` ; échelle 40 µm/px (modèle synthétique de plage 0,06–25) → `SCALE_OUT_OF_RANGE` ; 5 disques sur fond noir → `PROPOSAL`, `count == 5`.
- `test_size_distribution_bins` : Feret `[5, 10, 15, 60, 6000]` → comptes `[1, 2, 0, 1, 0, 0, 0, 0, 1]` (bornes inférieures incluses).
- `test_apply_corrections` : 5 particules (fibre, fibre, fragment, bille, fragment), `excluded=[2]`, `reshaped=[(3, "film"), (4, "bille")]`, `missed=2` → `count == 6`, `kept == 4`, `excluded == 1`, `missed == 2`, `by_shape == {"fibre": 1, "fragment": 1, "bille": 1, "film": 1, "unspecified": 2}`, `changes == 1` ; id 9 → `CorrectionError("unknown_particle", 9)` ; id exclu et reformé → `"both"` ; forme `"cercle"` → `"unknown_shape"`.
- `test_build_index_on_fixture` : le mini-jeu donne 18 éléments, échelles depuis les TIFF (largeur TIFF / largeur PNG appliquée), comptages lus (tabulations et espaces finaux tolérés), dossiers `*crop` et `label_index` ignorés.
- `test_groups_and_split` : deux images quasi identiques (bruit 1 %) → même groupe ; `PAN_01_2kV` et `PAN_01_3kV` → même groupe ; `split_of("bead/bead/image/x.png")` est stable (valeur fixée dans le test) ; aucun groupe dans deux côtés.
- `test_match_instances` : deux carrés décalés de 10 % → IoU ≈ 0,82 apparié ; décalés de 60 % → non apparié ; un prédit couvrant deux vrais → un seul appariement.
- `test_training_never_sees_test` : espion sur `fit_forest`, `fit_shape` et `choose_settings` : aucun élément `split == "test"` ; `choose_settings` ne reçoit que `val`.
- `test_training_is_deterministic` : `run_training` deux fois sur le mini-jeu → même sha256.
- `test_numpy_forest_checked` : `forest_proba` faussé (monkeypatch) → code 6, rien n'est écrit.
- `test_cli_exit_codes` : mini-jeu privé d'une image (index de 17 attendu 18 par le test via un paramètre `expected_images`) → 3 ; `--check` après entraînement → 0 ; sha du manifeste modifié → 4.
- `test_render_card_metrics_replaces_block_only` : comme C5.

**Commandes :**
```
.venv/Scripts/python -m pytest core/tests/test_imaging_*.py -q   # avant : ImportError ; après : tous passent
.venv/Scripts/python -m pytest core/tests ml/tests -q             # 0 failed (C5 inchangé)
```

**Commit :** `feat(core): analyse d'images C6 — lecture sûre, forêt de pixels, géométrie, formes, abstention et entraînement`

### Tâche 2 — Entraînement réel, manifeste, verrou et fiche du modèle

**Fichiers :** produire `models/c6-microscopie-i1.npz` (**ignoré par Git**) ; créer `docs/models/c6-microscopie-manifest.json`, `docs/models/c6-microscopie-i1-data.sha256`, `engine/src/microtrace_engine/image_model.lock.json` (écrits par la commande) ; créer `docs/models/c6-microscopie.md` (plan du §11 de la conception, bloc de métriques écrit par la commande) ; créer `core/tests/test_imaging_real.py` (marqués `data`, ignorés si `datasets/Images/dataset3` ou les poids manquent) et `core/tests/test_imaging_card.py`.

**Commandes :**
```
.venv/Scripts/python -m microtrace_core train-image --dataset datasets/Images/dataset3 --models models \
  --manifest docs/models/c6-microscopie-manifest.json --data-list docs/models/c6-microscopie-i1-data.sha256 \
  --lock engine/src/microtrace_engine/image_model.lock.json --card docs/models/c6-microscopie.md   # code 0, 15–25 min
.venv/Scripts/python -m microtrace_core train-image … --check                                     # code 0, rien n'est écrit
git status --porcelain                                                                             # rien sous models/ ni datasets/
```
Vérifie dans le manifeste avant de continuer (sinon « Quand s'arrêter ») — valeurs attendues au §12 de la conception :
- index : 237 images, 218 groupes, 147 / 48 / 42 ; 188 échelles ; plage d'échelle d'analyse 0,124 à 12,4 µm/px, d'où `SCALE_MIN` 0,06 et `SCALE_MAX` 25 (à 0,01 près) ;
- réglages : `PIXEL_THRESHOLD` 0,7 et `MIN_AREA_FRAC` 0,005 (un pas de grille d'écart toléré ; 0,01 possible, la grille mesurée s'arrêtait à 0,005), `MAX_FOREGROUND` 0,25, `SHAPE_MIN_SCORE` 0,6 ou 0,7 ;
- test (modèle final appris sur apprentissage + validation ; la conception a mesuré un modèle appris sur l'apprentissage seul) : Dice 0,71 ± 0,05, F1 objets 0,49 ± 0,08, erreur absolue de comptage 2,0 ± 0,5, F1 `fragment_1` ≥ 0,85 ; Feret maximal, erreur relative médiane ≤ 5 % ; formes sur composantes de référence : exactitude ≥ 0,85, rappel bille 1,0 attendu (8 composantes) ; référence Otsu au test : F1 0,29 ± 0,05, erreur de comptage 1,8 ± 0,5 ;
- abstention au test : 5 à 9 images `unreliable` sur 42, en majorité `fibre_2` ;
- la forêt numpy égale `predict_proba` à 1e-6 ; environ 300 000 nœuds ; archive ≤ 50 Mo ;
- si le F1 objets de la forêt sur la validation n'est pas supérieur à celui d'Otsu, arrête-toi : le modèle d'essai serait Otsu (question au contrôleur).

**Tests :**
- `test_card_metrics_block_is_current` ; la fiche contient « Modèle d'essai », « particules candidates », « film », « non évaluée », « licence à confirmer », « Roboflow » et le sha256 du manifeste.
- `test_real_index` : 237 éléments, 218 groupes, côtés 147 / 48 / 42, 188 échelles, 187 comptages ; aucun chemin contenant `crop` ou `label_index`.
- `test_real_weights_match_manifest`, `test_real_data_list_matches_datasets`.
- `test_real_e2e_image` : `datasets/Images/dataset3/bead/original_image_bead/Dove_men_acrylates_copolymer_microbeads_new_No0045.tif` (sha256 `0fba3362…5180`, 1 230 494 octets) décodé puis analysé sans échelle saisie → `scale.source == "metadata"`, `um_per_px_input == 0.7632211`, `cropped_bottom_px == 60`, analyse 1 024 × 720, `status == "proposal"`, `1 <= count <= 2`, diamètre équivalent de la plus grande particule entre 240 et 340 µm.
- `test_real_uniform_image_abstains` : image uniforme 1 024 × 768 de valeur 128 → `unreliable`, `NO_PARTICLE`.

**Commit :** `feat(core): modèle d'images i1 entraîné (séparation par photo, réglages sur validation, manifeste, verrou) et fiche c6-microscopie`

### Tâche 3 — Routes `/ai/image` du moteur et schéma

**Fichiers :**
- créer `engine/src/microtrace_engine/image.py` (verrou, `ImageModelStore`, conversions `to_response`, `to_model_info`, `to_validated`) et `image_text.py` (conception §7.1, §7.4, §7.5, §7.6) ;
- modifier `schemas.py`, `app.py` (trois routes, `create_app(settings, spectral_lock=None, image_lock=None)`), `engine/pyproject.toml` (données du paquet : `image_model.lock.json`) ;
- régénérer `engine/openapi.json` ; créer `engine/tests/test_image.py` (fixture `image_models_dir` : modèle synthétique de la tâche 1 et son verrou) ; étendre `tests/test_hygiene.py` ;
- web : `npm run gen:engine` ; `web/src/server/engine/client.ts` : types `ImageAnalyzeResponse`, `ImageModelInfo`, `ImageValidateRequest`, `ImageValidatedSummary` et méthodes ci-dessous, testées dans le test du client.

**Interfaces :**
```python
class ImageModelStore:
    def __init__(self, models_dir: Path, lock: ModelLock, loader: Callable[[bytes], ImageModel] = load_model_bytes) -> None
    def get(self) -> tuple[ModelState, ImageModel | None, str | None]
@app.get("/ai/image/model", response_model=ImageModelInfo, dependencies=[Depends(require_secret)])
@app.post("/ai/image/analyze", response_model=ImageAnalyzeResponse, dependencies=[Depends(require_secret)],
          responses={503: {"model": ErrorModel, "description": "Modèle d'images indisponible"}})
async def image_analyze(file: UploadFile = File(...), scale_um_per_px: str | None = Form(None)) -> ImageAnalyzeResponse
@app.post("/ai/image/validate", response_model=ImageValidatedSummary, dependencies=[Depends(require_secret)])
def image_validate(req: ImageValidateRequest) -> ImageValidatedSummary
```
```ts
imageModel: () => call<ImageModelInfo>("GET", "/ai/image/model"),
analyzeImage: (args: { file: UploadInput; scaleUmPerPx: string | null }) => call<ImageAnalyzeResponse>("POST", "/ai/image/analyze", { form }),
validateImage: (body: ImageValidateRequest) => call<ImageValidatedSummary>("POST", "/ai/image/validate", { json: body }),
```
- `read_upload(file, MAX_IMAGE_BYTES)` ; décodage et analyse dans le pool de threads ; sha256 vérifié avant `loader`.

**Tests** (`test_image.py`) :
- `test_model_info_available` : `name == "c6-microscopie"`, `version == "i1"`, `trial_label == "Modèle d'essai"`, `trial_sentence` exacte (§7.1), `limits[1]` contient « images MEB seulement », `limits[3]` contient « ne dit pas si une particule est un plastique », `shape_vocabulary` contient `{"code": "film", "label": "Film", "evaluated": false}`.
- `test_model_missing` / `test_sha_mismatch_refuses_to_serve` (loader espion jamais appelé) / `test_invalid_archive` : messages exacts du §7.6 ; `POST /ai/image/analyze` → 503.
- `test_analyze_contract` : PNG synthétique de 5 disques, échelle « 0,5 » → 200, `status == "proposal"`, `status_label == "Proposition"`, `count == 5`, 5 particules avec contour, `scale.source == "entered"`, `size_distribution` non nul, `input.sha256` = sha256 des octets, `images.display_png_base64` décodé est un PNG de taille `analysis_width × analysis_height`, l'explication contient « Leur nature (plastique ou non) n'est pas déterminée par l'image. » et « Proposition à valider par une personne compétente. ».
- `test_analyze_no_scale` : `scale is None`, `feret_max_um is None` partout, explication contient « Échelle inconnue ».
- `test_analyze_hitachi_tiff` : TIFF piégé avec `PixelSize=992.1875` → `scale.source == "metadata"`, `input.cropped_bottom_px == 60` ; « Dupont » absent du JSON complet et des PNG décodés ; saisie « 2 » → 422 avec le message de désaccord exact.
- `test_analyze_unreliable_texts` : image uniforme → `status_label == "Non fiable (abstention)"`, raison `no_particle`, explication commence par « Aucune proposition fiable : ».
- `test_analyze_errors_422` (paramétré, messages exacts §7.1) : GIF, tronqué, multipage, 100 × 300, 50 000 × 50 000, échelle « abc », échelle « 0 ».
- `test_analyze_too_large_413` : 25 Mio + 1 → 413 « Fichier trop volumineux (limite : 25 Mo). ».
- `test_validate` : la sortie de `test_analyze_contract` + `excluded=[1]`, `missed_count=1` → `count == 5`, `kept == 4`, `sentence` exacte ; id 99 → 422 « Particule 99 inconnue. » ; disponible quand les poids manquent.
- `test_lock_matches_manifest`, `test_image_routes_are_protected`.
- Hygiène `test_image_logs_hold_no_file_name_nor_metadata` : fichier « DONOR-SECRET.tif » piégé ; ni le nom ni « Dupont » dans `caplog` ni dans la réponse.
- Performance (marqué `data`) : analyse d'une image `fragment_1` 2 560 × 1 800 ≤ 30 s (mesure notée dans le rapport de tâche).

**Commandes :**
```
.venv/Scripts/python -m pytest engine/tests -q
.venv/Scripts/python -m microtrace_engine --dump-openapi engine/openapi.json
cd web && npm run gen:engine && npm run typecheck && npm test -- client
```

**Commit :** `feat(engine): routes /ai/image (analyse, validation, fiche du modèle), verrou sha256 et schéma OpenAPI`

### Tâche 4 — Service images du web : analyses, décisions, fichiers, audit et isolation

**Fichiers :**
- créer `web/src/server/images.ts`, `web/src/lib/images.ts` ;
- créer les routes `…/etudes/[studyId]/images/analyser/route.ts` (POST, 25 Mio + 1 Mio), `…/images/[analysisId]/image/route.ts`, `…/images/[analysisId]/annotee/route.ts`, `…/images/[analysisId]/particules/route.ts`, `…/images/comptages/route.ts` (GET ; HEAD → 405) ;
- modifier `web/src/lib/audit-labels.ts`, `web/src/lib/engine-messages.ts` (`IMAGE_MODEL_UNAVAILABLE` = « Le modèle d'images est indisponible : aucune analyse n'est possible pour l'instant. » ; `IMAGE_REFUSED` = « Le moteur d'analyse n'a pas pu analyser cette image. ») ;
- tests : `web/src/server/__tests__/images.test.ts`, `…/images/__tests__/{analyser-route,file-routes}.test.ts`, `tenant-isolation.test.ts`, test d'`audit-labels`.

**Interfaces :**
```ts
// lib/images.ts
export type ImageDecision = "accepted" | "corrected" | "rejected";
export const IMAGE_DECISIONS: readonly { code: ImageDecision; label: string; badge: "positive" | "warning" | "neutral"; noteRequired: boolean }[];
export const IMAGE_STATUS_BADGES: Record<"proposal" | "unreliable", "positive" | "neutral">;
export const CORRECTION_OPTIONS: readonly { code: "proposed" | "fibre" | "fragment" | "bille" | "film" | "excluded"; label: string }[];
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024; export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.tif,.tiff";
export const MAX_MISSED = 10_000;
export function imageDecisionBadge(status: string | null): { label: string; badge: "positive" | "warning" | "neutral" | "outline" };

// server/images.ts
export type ImageModelState = { kind: "ok" | "unavailable"; info: ImageModelInfo } | { kind: "engine_down" };
export type ImageDecisionView = { id: string; decision: ImageDecision; validated: ImageValidatedSummary | null; note: string | null;
  decidedBy: string | null; decidedAt: Date; count: number; excluded: number[]; reshaped: { id: number; shape: string }[]; missed: number };
export type ImageAnalysisRow = { id: string; createdAt: Date; fileName: string; status: string; statusLabel: string; count: number;
  scaleSource: string; scaleSourceLabel: string; modelVersion: string; decision: ImageDecisionView | null };
export type ImageAnalysisView = ImageAnalysisRow & { createdBy: string | null; sizeBytes: number; inputSha256: string;
  scaleEntered: string | null; modelName: string; modelSha256: string | null; output: ImageAnalysisOutput; archived: boolean };
export type ValidatedCountRow = { analysisId: string; decisionId: string; decidedAt: Date; decision: ImageDecision;
  validated: ImageValidatedSummary; medianFeretUm: number | null };
export type AnalyzeImageInput = { fileName: string; mimeType: string; bytes: Uint8Array<ArrayBuffer>; scaleUmPerPx: string | null };
export async function getImageModel(ctx: LabContext): Promise<ImageModelState>;
export async function listImageAnalyses(ctx: LabContext, studyId: string): Promise<{ rows: ImageAnalysisRow[]; hidden: number }>;
export async function listValidatedCounts(ctx: LabContext, studyId: string): Promise<ValidatedCountRow[]>;
export async function getImageAnalysis(ctx: LabContext, studyId: string, analysisId: string): Promise<ImageAnalysisView | null>;
export async function readAnalysisImage(ctx: LabContext, studyId: string, analysisId: string, which: "display" | "annotated"): Promise<Buffer | null>;
export async function analyzeImage(ctx: LabContext, studyId: string, input: AnalyzeImageInput): Promise<{ id: string; existing: boolean }>;
export async function recordImageDecision(ctx: LabContext, studyId: string, analysisId: string, input: { decision: string;
  excluded?: number[]; reshaped?: { id: number; shape: string }[]; missed?: number; note?: string | null }): Promise<{ id: string }>;
export async function buildCountsCsv(ctx: LabContext, studyId: string): Promise<DownloadFile>;
export async function buildParticlesCsv(ctx: LabContext, studyId: string, analysisId: string): Promise<DownloadFile>;
```
- Étapes, correspondance `ModelPrediction`, règles, audit : conception §8.1 à §8.4. `ImageAnalysisOutput` = `Omit<ImageAnalyzeResponse, "images">`. `medianFeretUm` vient de `validated.size_distribution.median_um` (aucun calcul).

**Tests** (`images.test.ts`, embedded-postgres, `MICROTRACE_VAR_DIR` temporaire, simulacre `engineClient` : `PROPOSAL` (5 particules, échelle saisie, deux PNG de 1 × 1 en base64), `UNRELIABLE` (`no_particle`)) :
- **analyse écrite** : `kind "image"`, `status "proposed"`, `inputFileSha256`, `modelName "c6-microscopie"`, `modelVersion "i1"` ; `input` = `{ role: "analysis", fileName, sizeBytes, mimeType, scaleEntered: "0.5", displaySha256, annotatedSha256 }` ; `output` sans clé `images` et égal au reste de la réponse ; **le magasin contient exactement 2 nouveaux fichiers** (les PNG du moteur), **aucun** dont le sha256 est celui du fichier déposé ; audit `image.analysis`, clés triées `["count","inputSha256","kind","modelVersion","scaleSource","status","studyId"]`.
- **idempotence** ; **refus sans écriture** : viewer, archivée (moteur non appelé), autre laboratoire, fichier vide, 25 Mio + 1 (moteur non appelé), échelle « 1e3 » (« Échelle invalide. », moteur non appelé), 422 transmis, 503 → `IMAGE_MODEL_UNAVAILABLE`, sha256 différent, `EngineUnavailableError` relancée.
- **décisions** : `accepted` → `validateImage` appelé avec les particules **enregistrées**, `output.validated` stocké ; `corrected` + `excluded [2]` + `missed 1` → `status "corrected"`, `input` porte les corrections ; `rejected` + note → `validated null`, `validateImage` non appelé ; audit `image.decision` avec `hasNote`, sans texte de note.
- **refus de décision** (messages exacts §8.3) : décision inconnue ; `accepted` sur `UNRELIABLE` ; `accepted` avec corrections ; `corrected` sans correction ; `rejected` sans note ; `rejected` avec corrections ; identifiant non entier ou 301 identifiants (« Corrections invalides. ») ; 422 du moteur (« Particule 9 inconnue. ») ; note de 1 001 caractères ; analyse d'une autre étude ; étude archivée ; viewer.
- **lecture** : plus récente d'abord ; dernière décision et `count` ; `createdAt` strictement croissants à horloge figée ; `listValidatedCounts` ne garde que les dernières décisions acceptées ou corrigées ; `getImageAnalysis` d'un autre laboratoire → `null`.
- **fichiers** : `readAnalysisImage` renvoie les octets du magasin (sha256 revérifié), `null` pour une analyse étrangère.
- **CSV** : `buildCountsCsv` → première ligne = colonnes du §9.3, une ligne par image validée, nom `microtrace-comptages-particules-<date>.csv`, audit `image.counts_export` ; aucune colonne ni valeur « fileName » ; `buildParticlesCsv` → 5 lignes, colonnes du §9.3, `excluded` = `true` pour l'id 2 après la correction.
- `analyser-route.test.ts` : 401 ; non-membre 404 ; `content-length` > 26 Mio → 413 sans moteur ; non multipart → 400 ; succès → 200 `{ id }` ; viewer → 403 ; archivée → 409 ; moteur injoignable → 503.
- `file-routes.test.ts` : image → 200 `image/png`, `nosniff`, `private, no-store`, `inline` ; annotée → `attachment; filename="microtrace-image-annotee-<date>.png"` ; particules et comptages → `text/csv` ; analyse d'un autre laboratoire → 404 ; HEAD → 405 ; le nom du fichier déposé n'apparaît dans aucun en-tête.
- `audit-labels` : entité « Analyse d'image », objet « 5 particules candidates » ; « image non fiable » ; la décision spectrale reste « Analyse spectrale ».
- `tenant-isolation.test.ts` : module `images` dans `MODULES` et `CASES` ; `analyzeImage`, `recordImageDecision` dans `WRITES` ; lecteurs ; simulacre `imageModel`, `analyzeImage`, `validateImage` ; une analyse de B citée dans une étude de A → « Analyse introuvable. ».

**Commandes :** `npm test -- images analyser-route file-routes tenant-isolation audit-labels`, puis toutes les vérifications du web.

**Commit :** `feat(web): service images — analyses et décisions ModelPrediction, images réécrites, CSV, audit et isolation`

### Tâche 5 — Onglet Images

**Fichiers :**
- `StudyTabs.tsx` : `{ segment: "images", label: "Images" }` entre `spectres` et `rapport` ;
- créer `…/images/page.tsx`, `AnalyzeImageForm.tsx` (client), `…/images/[analysisId]/page.tsx`, `ParticleOverlay.tsx` (serveur, SVG), `SizeHistogram.tsx` (client, Recharts), `ImageDecisionForm.tsx` (client, `ActionForm`), `actions.ts` (`recordImageDecisionAction(labSlug, prev, formData)` : champs `studyId`, `analysisId`, `decision`, `note`, `missed`, et `particle-<id>` ∈ `CORRECTION_OPTIONS` ; traduction en `excluded` et `reshaped` sans calcul, « Proposée » ignorée ; `revalidatePath(…, "layout")`) ;
- tests : `…/images/__tests__/{page,AnalyzeImageForm}.test.tsx`, `…/images/[analysisId]/__tests__/{page,ParticleOverlay,ImageDecisionForm,SizeHistogram}.test.tsx`, test de `StudyTabs`.

**Contenu :** conception §9.1 et §9.2 dans l'ordre. `AnalyzeImageForm` envoie un `FormData` (`file`, `scale_um_per_px`) à `…/images/analyser`, puis `router.push(…/images/{id})`.

**Tests :**
- onglets : Paramètres, Imports, Résultats, Qualité, Spectres, **Images**, Rapport, Journal ; `aria-current` sur `/images` et `/images/abc`.
- liste : `Alert info` avec « Modèle d'essai », `trial_sentence` mot pour mot, « images MEB seulement », « ne dit pas si une particule est un plastique » ; viewer, étude archivée, modèle indisponible (une seule alerte destructive, table conservée), `engine_down`, vide (« Aucune image analysée dans cette étude. ») ; un fichier nommé « Rapport Résultats.tif » ne donne aucun lien dont le nom contient « Rapport » ou « Résultats » ; section « Comptage de particules candidates (images validées) » avec la phrase « Ils ne figurent ni dans Résultats ni dans le rapport. » et le lien « Télécharger les comptages (CSV) » ; aucune ligne de total ; « Fiche du modèle (version i1) » cite `docs/models/c6-microscopie.md` et « Film : forme non évaluée dans cette version ».
- `AnalyzeImageForm` : champ « Image de microscopie » (`accept` = `IMAGE_ACCEPT`), « Échelle (µm par pixel) » facultatif avec son aide ; `fetch` reçoit `file` et `scale_um_per_px` ; erreur dans `FormError`, saisie conservée ; « Analyse en cours… » désactivé ; succès → `router.push`.
- analyse : `explanation` mot pour mot ; raisons en liste pour `unreliable` ; `dl` avec « Échelle : 0,5 µm/px (saisie) » ou « inconnue » ; version différente → alerte ; un seul `h1` ; liens « Télécharger l'image annotée (PNG) » et « Télécharger les particules (CSV) ».
- `ParticleOverlay` : `<img>` vers `…/image` ; `<svg viewBox="0 0 1024 720">` ; 5 `polygon` ; `stroke` égal à `var(--chart-1)` pour une fibre ; forme incertaine en `stroke-dasharray` ; `role="img"`, `aria-label` « Image analysée : 5 particules candidates délimitées » ; légende HTML (Fibre, Fragment, Bille, Forme incertaine).
- `SizeHistogram` : `role="img"`, une barre par classe non vide ; « Voir les données » liste les 9 classes ; sans échelle : « Échelle inconnue : pas de distribution en µm. ».
- `ImageDecisionForm` : « Acceptée » absent pour `unreliable` ; « Corrigée » affiche une ligne par particule avec un `select` étiqueté « Forme retenue pour la particule 3 » (options `CORRECTION_OPTIONS`, défaut « Proposée : Fragment ») et « Particules manquées (sans contour) » ; « Note » obligatoire indiquée pour « Rejetée » ; erreur dans `FormError` ; bouton désactivé pendant l'envoi.
- aucune couleur codée en dur : la regex du test Résultats est appliquée à tous les fichiers de `images/`.

**Commandes :** `npm test -- images StudyTabs`, puis toutes les vérifications du web.

**Commit :** `feat(web): onglet Images (dépôt, contours superposés, particules, distribution, décisions et comptages)`

### Tâche 6 — Consentement `c2` et export des images consenties

**Fichiers :** `web/src/lib/training-consent.ts` (`TRAINING_CONSENT_VERSION = "c2"`, détail des images §10, `IMAGE_EXPORT_COLUMNS`, `IMAGE_EXPORT_FORMAT = "microtrace.image-training-export"`, `EXPORT_NOTICE` étendu aux images), `web/src/server/training-consent.ts` (`buildTrainingExport(ctx, format, kind = "spectral")`), `…/membres/export-entrainement/route.ts` (`type=spectres|images`), `…/membres/page.tsx` (liens « Exporter les images consenties (JSON) » et « (CSV) ») ; tests `training-consent.test.ts`, `export-route.test.ts`, `membres/__tests__/page.test.tsx`, `tenant-isolation.test.ts` ; les tests existants qui citent `"c1"` passent à `TRAINING_CONSENT_VERSION` (permis, Quand s'arrêter).

**Tests :**
- un laboratoire consentant en `c1` → export spectral **et** image refusés avec `CONSENT_RENEW`, sans audit ; après retrait puis accord → `c2`.
- jeu : A consentant `c2` ; étude A1 (publiée, pseudonymisée) : `i1` acceptée, `i2` corrigée (exclusion de 2), `i3` rejetée, `i4` sans décision ; étude A2 simulée : `i5` acceptée ; étude A3 sans pseudonymisation : `i6` acceptée ; B consentant : `j1` acceptée. JSON images → lignes `i2, i1` (récent d'abord), clés = `IMAGE_EXPORT_COLUMNS` + `display_png_base64` + `particles` ; `display_png_base64` décodé = octets du magasin ; `particles[1].excluded == true` pour `i2` ; aucune clé `file_name`, `note`, `title` ; aucune ligne de B, A2 ni A3 ; aucun octet du fichier déposé (il n'existe pas dans le magasin).
- CSV images : en-tête = `IMAGE_EXPORT_COLUMNS.join(",")`, 2 lignes.
- audit `lab.training_export` `{ format: "json", rows: 2, consentVersion: "c2", kind: "image" }`.
- route : `type=images` → nom `microtrace-<slug>-entrainement-images-<date>.json` ; `type=xml` → 400 « Type d'export inconnu. » ; non-responsable → 404.

**Commandes :** `npm test -- training-consent export-route membres tenant-isolation images`, puis toutes les vérifications.

**Commit :** `feat(web): consentement c2 étendu aux images et export audité des analyses d'images consenties`

### Tâche 7 — Parcours de bout en bout Images

**Fichiers :** `web/e2e/images.spec.ts` (en tête : « Image MEB de datasets/Images/dataset3 (licence à confirmer), lue au moment du test, jamais copiée ni versionnée ») ; `web/e2e/global-setup.ts` : après le démarrage du moteur, `GET /ai/image/model` ; si indisponible, `E2E_IMAGE_MODEL=absent` et les parcours sont ignorés avec « Poids du modèle d'images absents (models/c6-microscopie-i1.npz) : lancez python -m microtrace_core train-image (voir DEMARRAGE.md). » (comme Spectres).

**Parcours H — responsable du laboratoire A, étude `labA.studyId` :**
1. lien « Images » (`exact: true`) : badge « Modèle d'essai », « images MEB seulement », « ne dit pas si une particule est un plastique », « … : désactivée. » ;
2. « Image de microscopie » = le TIFF `Dove_men_acrylates_copolymer_microbeads_new_No0045.tif` lu dans `datasets/` (sha256 vérifié, `0fba3362…5180`), échelle vide ; « Analyser l'image » → URL `/images/<id>` ;
3. « Proposition » ; `dl` : « Échelle » contient « 0,763 » et « lue dans l'image (MEB Hitachi) », « Bandeau retiré » 60 px ; le calque `role="img"` a un `aria-label` « Image analysée : 1 particule candidate délimitée » ou « … : 2 particules candidates délimitées » ; la table « Particules candidates » a 1 ou 2 lignes, en µm ; la page ne contient ni « Jack », ni « Jihui », ni « PC-SEM » (noms du fichier `.txt` voisin, jamais lu) ; l'image servie par `…/image` est un PNG dont les octets ne contiennent ni `tEXt`, ni `eXIf`, ni « SU5000 » ;
4. « Télécharger l'image annotée (PNG) » → téléchargement nommé `microtrace-image-annotee-<date>.png` ;
5. décision « Corrigée » : particule 1 « Bille », « Particules manquées » = 1 → badge « Corrigée », phrase « … validées : … 1 ajoutée sans contour. » ; `page.reload()` : toujours là ; la section « Comptage de particules candidates (images validées) » de la liste a 1 ligne, et « Télécharger les comptages (CSV) » donne une ligne de données avec `scale_source` = `metadata` ;
6. même fichier, même échelle vide → même adresse d'analyse (idempotence) ;
7. PNG uniforme 512 × 384 (valeur 128) généré par le test, nommé « Rapport Résultats.png » → « Non fiable (abstention) », « aucune particule candidate détectée », pas de radio « Acceptée » ; « Rejetée » avec la note « Image vide de test. » ; la liste n'a aucun lien dont le nom contient « Rapport » ou « Résultats » ;
8. Journal : 2 « Analyse d'image enregistrée », 2 « Décision sur une image enregistrée », 1 « Export des comptages de particules candidates » ;
9. base : `SELECT count(*) FROM "ModelPrediction" WHERE kind='image'` = 4 ; aucun fichier du magasin n'a le sha256 du TIFF déposé.

**Parcours I — isolation (`bob@e2e.test`)** : `/labo/{B}/etudes/{A.study}/images` et `/labo/{A}/etudes/{A.study}/images/{id}` → « Page introuvable » ; `GET …/images/{id}/image` → 404.

**Commandes :** `cd web && npm run e2e -- images.spec.ts spectral.spec.ts quality.spec.ts examples.spec.ts`

**Commit :** `test(web): parcours de bout en bout de l'onglet Images`

### Tâche 8 — Clôture

- `docs/superpowers/suivi-prototype.md` : section « C6 — points reportés » (§14 de la conception et ce que tu as laissé de côté) ; dans « Exigences avant tout hébergement de données réelles » : « Avant de présenter C6 aux laboratoires : retrouver la source et la licence de `dataset3` (images MEB) ; Roboflow reste exclu tant que sa licence n'est pas connue. ».
- `DEMARRAGE.md` : « Entraîner le modèle d'images (une fois) » : commande de la tâche 2, `--check`, durée observée, `models/` hors Git, redémarrage du moteur.
- Captures (`e2e/screenshots.spec.ts`) : pages Images si poids et `dataset3` présents, sinon sautées (comme Spectres).
- Relecture du diff contre les Global Constraints : grep `Math.`, `reduce(`, `toFixed`, `sort(` numériques dans `server/images.ts`, `lib/images.ts`, `images/` ; couleurs codées en dur ; Prisma sans `laboratoryId` ; `console.` ; `fileName` dans les `after` d'audit, les CSV et l'export ; `git ls-files models datasets | grep -v SOURCES.md` vide ; manifeste, fiche et §12 de la conception portent les mêmes chiffres (le manifeste fait foi).
- Vérifications finales : pytest complet ; `train-image … --check` → 0 ; dans `web/` : `npm test`, `typecheck`, `lint`, `build`, `e2e`.

**Commit :** `docs: clôture de C6 (analyse d'images de microscopie)`

### Tâche 9 (optionnelle, hors clôture) — Mask R-CNN reproductible pour GPU

**Fichiers :** `ml/pyproject.toml` (extra `maskrcnn = ["torch==<épinglé>", "torchvision==<épinglé>"]`, versions choisies au moment de l'exécution et notées) ; `core/src/microtrace_core/imaging/coco.py` et sous-commande `python -m microtrace_core image-dataset export-coco --dataset … --out var/c6-coco` (mêmes groupes et côtés ; instances = composantes du masque ; polygones VIA de `fibre_1crop` rattachés à leur photo, côté de la photo) ; `ml/src/microtrace_ml/maskrcnn.py` (`train`, `predict` → JSON de polygones du test) ; `core` : `python -m microtrace_core image-eval --dataset … --predictions preds.json` (évaluateur de la tâche 1) ; tests : export COCO sur le mini-jeu (aucune image de test dans `train.json`), `maskrcnn` ignoré sans torch.

**Exécution :** sur GPU (Colab), jamais sur ce PC. Comparaison écrite dans la fiche (section « Pistes ») ; adoption (`i2`) seulement selon la règle du §4.4 de la conception, après une conception courte et l'accord du contrôleur.

**Commit :** `feat(ml): script Mask R-CNN reproductible (GPU) et export COCO séparé par photo`
