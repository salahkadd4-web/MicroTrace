"""All the French wording of the spectral identification aid (design 7.3 and 7.4): polymer,
technique, status and library labels, explanations, read and availability messages, limits and
axis labels. ``core`` returns structures only; every word shown to a person is written here.
"""
from __future__ import annotations

import unicodedata

from microtrace_core.polymers import CANONICAL
from microtrace_core.preprocess import DIAGNOSTIC_WINDOWS
from microtrace_core.spectral.libraries import Library
from microtrace_core.spectral.reading import MAX_POINTS, ReadIssue
from microtrace_core.spectral.thresholds import Status
from microtrace_core.spectrum import MIN_POINTS

from .numbers import _vs_threshold

TRIAL_LABEL = "Modèle d'essai"
TRIAL_SENTENCE = "Modèle d'essai : entraîné sur des données publiques, pas encore sur les vôtres."
CARD_PATH = "docs/models/c5-spectral.md"
VALIDATE = "Proposition à valider par une personne compétente."
LICENCE_PENDING = "Licence à confirmer"
CURVE_PENDING_NOTE = "Licence à confirmer : courbe non affichée."
CURVE_FORBIDDEN_NOTE = "Courbe non affichée : la licence ne permet pas sa diffusion."

LIMITS: tuple[str, ...] = (
    TRIAL_SENTENCE,
    "Le modèle n'a pas vu de particules extraites de sang : ses performances sur ce cas sont inconnues.",
    "Il n'y a pas de classe non plastique dans cette version : un matériau absent des bibliothèques "
    "(protéine, minéral, fond…) devrait conduire à une abstention, mais peut être confondu avec le "
    "polymère le plus proche.",
    "Les performances viennent d'une validation où chaque bibliothèque est tenue à part ; elles "
    "décrivent surtout MicroPlastiX, majoritaire.",
    "Une proposition n'est jamais enregistrée comme mesure : elle est à valider par une personne "
    "compétente.",
)

POLYMER_LABELS: dict[str, str] = {
    "PE": "Polyéthylène (PE)",
    "PP": "Polypropylène (PP)",
    "PET": "Polyéthylène téréphtalate (PET)",
    "PS": "Polystyrène (PS)",
    "PVC": "Polychlorure de vinyle (PVC)",
    "PA": "Polyamide (PA)",
    "PU": "Polyuréthane (PU)",
    "PC": "Polycarbonate (PC)",
    "PMMA": "Polyméthacrylate de méthyle (PMMA)",
    "ABS": "Acrylonitrile butadiène styrène (ABS)",
    "PLA": "Acide polylactique (PLA)",
    "PTFE": "Polytétrafluoroéthylène (PTFE)",
    "POM": "Polyoxyméthylène (POM)",
    "SILICONE": "Silicone",
    "EVA": "Éthylène-acétate de vinyle (EVA)",
    "ACRYLIC": "Acrylique",
    "CA": "Acétate de cellulose (CA)",
    "CELLULOSE": "Cellulose (fibre naturelle, non plastique)",
    "RUBBER": "Caoutchouc",
    "NC": "Nitrocellulose (NC)",
    "OTHER": "Autre polymère",
    "NOT_PLASTIC": "Non plastique",
}

TECHNIQUE_LABELS = {"raman": "Raman", "ftir_atr": "FTIR (ATR)"}
_SHORT = {"raman": "Raman", "ftir_atr": "FTIR"}

STATUS_LABELS = {
    Status.IDENTIFIED.value: "Identifié (proposition)",
    Status.UNCERTAIN.value: "Incertain",
    Status.NOT_IDENTIFIED.value: "Non identifié (abstention)",
}

X_LABELS = {"raman": "Déplacement Raman (cm⁻¹)", "ftir_atr": "Nombre d'onde (cm⁻¹)"}
Y_LABEL = "Intensité normalisée (après prétraitement)"

# availability messages (design 7.2)
UNAVAILABLE = {
    "missing": "Modèle spectral absent : lancez l'entraînement "
               "(python -m microtrace_core train-spectral).",
    "sha_mismatch": "Le fichier du modèle spectral ne correspond pas à l'empreinte attendue : "
                    "il n'est pas utilisé.",
    "invalid": "Le fichier du modèle spectral est illisible : il n'est pas utilisé.",
}

# request validation (design 7.1)
BAD_TECHNIQUE = "Technique inconnue : choisissez Raman ou FTIR (ATR)."
BAD_X_UNIT = "Unité de l'axe inconnue."
NM_ONLY_RAMAN = "Un axe en longueur d'onde (nm) n'est possible qu'en Raman."
BAD_Y_UNIT = "Unité de l'ordonnée incompatible avec la technique."
LASER_REQUIRED = "Indiquez la longueur d'onde du laser (nm) pour un spectre Raman."
LASER_INVALID = "Longueur d'onde du laser invalide (entre 200 et 1 100 nm)."
LASER_FORBIDDEN = "Pas de laser pour un spectre FTIR."


def polymer_label(code: str) -> str:
    return POLYMER_LABELS.get(code, code)


def technique_label(technique: str) -> str:
    return TECHNIQUE_LABELS.get(technique, technique)


def status_label(status: str) -> str:
    return STATUS_LABELS[status]


def library_licence_text(lib: Library) -> str:
    return lib.licence or LICENCE_PENDING


def curve_note(lib: Library | None) -> str | None:
    """None when the curve is shown; otherwise why it is not."""
    if lib is not None and lib.curve_allowed:
        return None
    if lib is None or lib.licence is None:
        return CURVE_PENDING_NOTE
    return CURVE_FORBIDDEN_NOTE


def score_text(score: float) -> str:
    """A score with 3 decimals and a decimal comma."""
    return f"{score:.3f}".replace(".", ",")


def _threshold(t: float) -> str:
    return f"{t:.2f}".replace(".", ",")


def _below(x: float, threshold: float) -> str:
    """``x`` with at least 3 decimals, adding digits until the shown number is strictly under
    the threshold, so the text never contradicts a decision made on the exact number."""
    for d in range(3, 13):
        if round(x, d) < threshold:
            return f"{round(x, d):.{d}f}".replace(".", ",")
    return f"{x:.12f}".replace(".", ",")


def _thousands(v: float) -> str:
    return f"{int(round(v)):,}".replace(",", " ")


def correction_vocabulary() -> list[tuple[str, str]]:
    """The 20 canonical codes, OTHER and NOT_PLASTIC, sorted by label (accents ignored)."""
    codes = [*sorted(CANONICAL), "OTHER", "NOT_PLASTIC"]

    def key(code: str) -> str:
        plain = unicodedata.normalize("NFKD", polymer_label(code))
        return "".join(c for c in plain if not unicodedata.combining(c)).casefold()

    return [(c, polymer_label(c)) for c in sorted(codes, key=key)]


def read_error_message(issue: ReadIssue, line: int | None, count: int | None) -> str:
    if issue is ReadIssue.EMPTY:
        return "Fichier vide."
    if issue is ReadIssue.BINARY:
        return ("Fichier binaire non reconnu : déposez un fichier texte à deux colonnes "
                "(CSV ou TXT).")
    if issue is ReadIssue.JCAMP:
        return ("Format JCAMP-DX non pris en charge dans cette version : exportez le spectre "
                "en CSV à deux colonnes.")
    if issue is ReadIssue.NO_NUMERIC_ROWS:
        return "Aucune ligne de deux nombres trouvée."
    if issue is ReadIssue.TOO_MANY_HEADER_LINES:
        return "Plus de 50 lignes d'en-tête avant les données."
    if issue is ReadIssue.NON_NUMERIC_ROW:
        return f"Ligne {line} : valeurs non numériques."
    if issue is ReadIssue.TOO_MANY_COLUMNS:
        return (f"Ligne {line} : plus de deux colonnes de valeurs ; un seul spectre "
                "(deux colonnes) est attendu.")
    if issue is ReadIssue.TOO_FEW_POINTS:
        return f"Spectre trop court : {count} points, il en faut au moins {MIN_POINTS}."
    if issue is ReadIssue.TOO_MANY_POINTS:
        return f"Spectre trop long : plus de {_thousands(MAX_POINTS)} points."
    return "Fichier illisible."


def explanation(*, status: str, abstention: str | None, technique: str, coverage: float,
                candidates: list[tuple[str, float]], margin: float | None,
                classifier: str | None, uncertain_min: float, identified_min: float,
                margin_min: float, other_technique: str | None,
                other_score: float | None) -> str:
    """The sentence under the status. Numbers shown never contradict the status decision."""
    top = candidates[0] if candidates else None
    if abstention == "low_coverage":
        lo, hi = DIAGNOSTIC_WINDOWS[technique]  # type: ignore[index]
        shown = _vs_threshold(coverage * 100, 0, 80.0, above=False)
        return (f"Aucune proposition : le spectre couvre {shown} % de la fenêtre diagnostique "
                f"({_thousands(lo)}–{_thousands(hi)} cm⁻¹) ; il en faut 80 %. Vérifiez l'unité de "
                "l'axe et la longueur d'onde du laser.")
    if abstention == "no_overlap" or top is None:
        return ("Aucune proposition : le spectre n'a pas assez de points communs avec les "
                "spectres de référence.")
    if abstention == "technique_mismatch" and other_technique and other_score is not None:
        return (f"Aucune proposition : ce spectre ressemble davantage à un spectre "
                f"{_SHORT[other_technique]} (corrélation {score_text(other_score)}, contre "
                f"{score_text(top[1])} en {_SHORT[technique]}). Vérifiez la technique choisie.")
    s1 = top[1]
    label = polymer_label(top[0])
    if status == Status.NOT_IDENTIFIED.value:
        below = _below(s1, uncertain_min)
        return (f"Aucune proposition fiable : la meilleure corrélation ({below}) est sous le "
                f"seuil de {_threshold(uncertain_min)}. Le matériau peut être absent des "
                "bibliothèques (il n'y a pas de classe non plastique dans cette version), ou le "
                "spectre mal réglé (technique, laser) ou trop bruité.")
    second = polymer_label(candidates[1][0]) if len(candidates) > 1 else None
    classifier_text = polymer_label(classifier) if classifier else None
    if status == Status.IDENTIFIED.value:
        text = (f"{label} : corrélation {score_text(s1)} avec la référence la plus proche "
                f"(seuil d'identification {_threshold(identified_min)})")
        if margin is not None and second is not None:
            text += f", écart de {score_text(margin)} avec {second}"
        if classifier_text:
            text += f" ; le classifieur PCA+SVM propose aussi {classifier_text}"
        return f"{text}. {VALIDATE}"
    reasons: list[str] = []
    if classifier_text and classifier != top[0]:
        reasons.append(f"le classifieur PCA+SVM propose {classifier_text}")
    if margin is not None and second is not None and margin < margin_min:
        reasons.append(f"l'écart avec {second} n'est que de "
                       f"{_below(margin, margin_min)} "
                       f"(il faut {_threshold(margin_min)})")
    if s1 < identified_min:
        reasons.append("la corrélation est sous le seuil d'identification "
                       f"{_threshold(identified_min)}")
    because = (" ; ".join(reasons) if reasons
               else "les critères d'identification ne sont pas tous réunis")
    shown = (_below(s1, identified_min) if s1 < identified_min
             else score_text(s1))
    return (f"Proposition incertaine : {label} en tête (corrélation {shown}), mais {because}. "
            "Le bon polymère figure le plus souvent parmi les 3 propositions.")
