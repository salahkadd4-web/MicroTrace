"""All the French wording of the microscopy image analysis (design 7.1, 7.4, 7.5, 7.6): shape,
status, reason and scale labels, explanations, read and availability messages, limits and size
classes. ``core`` returns codes and numbers only; every word shown to a person is written here.
"""
from __future__ import annotations

import math

from microtrace_core.imaging.model import (
    MAX_PARTICLES,
    UNSPECIFIED,
    Reason,
    ScaleSource,
    Status,
)
from microtrace_core.imaging.reading import MAX_IMAGE_BYTES, MAX_PIXELS, MIN_SIDE, ImageIssue

from .numbers import _plain, _vs_threshold

TRIAL_LABEL = "Modèle d'essai"
TRIAL_SENTENCE = ("Modèle d'essai : entraîné sur des images publiques de microscopie "
                  "électronique, pas encore sur les vôtres.")
CARD_PATH = "docs/models/c6-microscopie.md"
TRAINING_DATA = "dataset3 : 237 images MEB, licence à confirmer"
VALIDATE = "Proposition à valider par une personne compétente."
NATURE = "Leur nature (plastique ou non) n'est pas déterminée par l'image."
NO_SCALE = "Échelle inconnue : tailles en pixels, non comparables entre images."
SIZE_BASIS = "feret_max_um"

BAR_ADVICE = ("Recadrez la bande d'informations (texte, échelle, date) avant le dépôt : seule la "
              "bande des TIFF Hitachi est retirée automatiquement. Elle pourrait être comptée comme "
              "particule et son texte resterait dans l'image exportée.")
BAR_LIMIT = BAR_ADVICE

LIMITS: tuple[str, ...] = (
    TRIAL_SENTENCE,
    "Entraîné et évalué sur des images MEB seulement : sur une image de microscopie optique ou "
    "d'un autre microscope, ses performances sont inconnues ; il faudra une recalibration avec "
    "quelques images annotées par le laboratoire.",
    "Le modèle n'a pas vu de particules extraites de sang.",
    "L'image ne dit pas si une particule est un plastique : seule une méthode chimique "
    "(spectre, Py-GC/MS) le peut.",
    "Une particule plus petite que la taille minimale indiquée n'est pas comptée. Des particules "
    "qui se touchent ou se croisent peuvent être comptées comme une seule.",
    "Modèle médiocre hors des fragments isolés sur fond lisse : les billes sont souvent proposées "
    "« fragment » et leur taille est surestimée ; sur un tapis de fibres l'image est en général "
    "jugée non fiable.",
    BAR_LIMIT,
    "La forme « film » n'est pas évaluée dans cette version : elle n'est jamais proposée.",
    "Une proposition n'est jamais enregistrée comme mesure : elle est à valider par une personne "
    "compétente.",
)

UNCERTAIN = "uncertain"
SHAPE_LABELS = {
    "fibre": "Fibre",
    "fragment": "Fragment",
    "bille": "Bille",
    "film": "Film",
    UNCERTAIN: "Forme incertaine",
    UNSPECIFIED: "Forme non renseignée",
}
_PLURAL = {"fibre": "fibres", "fragment": "fragments", "bille": "billes", "film": "films",
           UNCERTAIN: "formes incertaines"}
_SINGULAR = {"fibre": "fibre", "fragment": "fragment", "bille": "bille", "film": "film",
             UNCERTAIN: "forme incertaine"}
SHAPE_ORDER = ("fibre", "fragment", "bille", "film", UNCERTAIN)

STATUS_LABELS = {
    Status.PROPOSAL.value: "Proposition",
    Status.UNRELIABLE.value: "Non fiable (abstention)",
}
SHAPE_STATUS_LABELS = {"proposed": "Forme proposée", "uncertain": "Forme incertaine"}
REASON_LABELS = {
    Reason.NO_PARTICLE.value: "Aucune particule candidate",
    Reason.TOO_MANY_PARTICLES.value: "Trop de particules candidates",
    Reason.LARGE_FOREGROUND.value: "Image trop segmentée",
    Reason.LOW_CONTRAST.value: "Contraste trop faible",
    Reason.SCALE_OUT_OF_RANGE.value: "Échelle hors de la plage d'entraînement",
}
SCALE_SOURCE_LABELS = {
    ScaleSource.METADATA.value: "lue dans l'image (MEB Hitachi)",
    ScaleSource.ENTERED.value: "saisie",
    ScaleSource.NONE.value: "inconnue",
}

UNAVAILABLE = {
    "missing": "Modèle d'images absent : lancez l'entraînement "
               "(python -m microtrace_core train-image).",
    "sha_mismatch": "Le fichier du modèle d'images ne correspond pas à l'empreinte attendue : "
                    "il n'est pas utilisé.",
    "invalid": "Le fichier du modèle d'images est illisible : il n'est pas utilisé.",
}

# request validation and read errors (design 7.1)
BAD_SCALE = "Échelle invalide : un nombre de micromètres par pixel entre 0,001 et 1 000."
SCALE_MIN_INPUT = 0.001
SCALE_MAX_INPUT = 1000.0
MULTIPAGE = "TIFF à plusieurs pages non pris en charge : exportez une seule image."
UNSUPPORTED = "Format d'image non pris en charge : déposez un PNG, un JPEG ou un TIFF."
UNREADABLE = "Image illisible ou tronquée."
EMPTY = "Fichier vide."
UNSUPPORTED_MODE = "Mode de couleur de l'image non pris en charge : exportez-la en niveaux de gris."


def _thousands(v: float) -> str:
    return f"{int(round(v)):,}".replace(",", " ")


def read_error_message(issue: ImageIssue, width: int | None, height: int | None,
                       pixels: int | None) -> str:
    if issue is ImageIssue.EMPTY:
        return EMPTY
    if issue is ImageIssue.UNSUPPORTED_FORMAT:
        return UNSUPPORTED
    if issue is ImageIssue.MULTIPAGE:
        return MULTIPAGE
    if issue is ImageIssue.TOO_SMALL and width is not None and height is not None:
        return (f"Image trop petite ({width} × {height} px) : il faut au moins {MIN_SIDE} px "
                "de côté.")
    max_millions = MAX_PIXELS // 1_000_000
    if issue is ImageIssue.TOO_MANY_PIXELS:
        if pixels is None:
            return f"Image trop grande : {max_millions} millions de pixels au plus."
        # rounded up, so the shown number is always above the limit
        return (f"Image trop grande ({_thousands(math.ceil(pixels / 1_000_000))} millions de "
                f"pixels) : {max_millions} millions au plus.")
    if issue is ImageIssue.UNSUPPORTED_MODE:
        return UNSUPPORTED_MODE
    return UNREADABLE


def _sig(x: float, digits: int = 4) -> str:
    return _plain(float(f"{x:.{digits}g}"))


def scale_mismatch_message(entered: float, metadata: float) -> str:
    return (f"L'échelle saisie ({_sig(entered)} µm/px) diffère de celle lue dans l'image "
            f"({_sig(metadata)} µm/px) : corrigez-la ou laissez le champ vide.")


def too_large_message() -> str:
    return f"Fichier trop volumineux (limite : {MAX_IMAGE_BYTES // (1024 * 1024)} Mo)."


def status_label(status: str) -> str:
    return STATUS_LABELS[status]


def shape_label(shape: str) -> str:
    return SHAPE_LABELS.get(shape, shape)


def shape_score_text(score: float, threshold: float, confident: bool) -> str:
    """A shape score with 3 decimals or more, so the shown number never contradicts the
    decision (``confident`` iff ``score >= threshold``)."""
    for d in range(3, 13):
        shown = round(score, d)
        if (shown >= threshold) if confident else (shown < threshold):
            return f"{shown:.{d}f}".replace(".", ",")
    return f"{score:.12f}".replace(".", ",")


def size_label(lower: float, upper: float) -> str:
    if lower <= 0:
        return f"moins de {_thousands(upper)} µm"
    if math.isinf(upper):
        return f"{_thousands(lower)} µm et plus"
    return f"{_thousands(lower)} à {_thousands(upper)} µm"


def _floor_sig(x: float, digits: int = 2) -> float:
    """``x`` cut down to ``digits`` significant digits: an "at least" is never overstated."""
    if x <= 0:
        return 0.0
    exp = math.floor(math.log10(x)) - digits + 1
    step = 10.0 ** exp
    return math.floor(x / step * (1 + 1e-12)) * step


def _count_phrase(shape: str, n: int) -> str:
    return f"{n} {(_SINGULAR if n == 1 else _PLURAL)[shape]}"


def _reason_fragment(code: str, *, foreground: float, max_foreground: float,
                     scale_um_per_px: float | None, scale_min: float, scale_max: float) -> str:
    if code == Reason.NO_PARTICLE.value:
        return "aucune particule candidate détectée"
    if code == Reason.TOO_MANY_PARTICLES.value:
        return (f"plus de {MAX_PARTICLES} particules candidates (seules les {MAX_PARTICLES} "
                "plus grandes sont tracées)")
    if code == Reason.LARGE_FOREGROUND.value:
        shown = _vs_threshold(foreground * 100, 0, max_foreground * 100, above=True)
        return f"{shown} % de l'image est segmentée (tapis de fibres, agrégat ou fond texturé)"
    if code == Reason.LOW_CONTRAST.value:
        return "contraste trop faible"
    lo, hi = _sig(scale_min, 3), _sig(scale_max, 3)
    value = scale_um_per_px or 0.0
    above = value > scale_max
    shown = _vs_threshold(value, 3, scale_max if above else scale_min, above=above,
                          significant=True)
    return f"échelle de {shown} µm/px hors de la plage d'entraînement ({lo} à {hi})"


def explanation(*, status: str, reasons: list[str], count: int, by_shape: dict[str, int],
                min_detectable: float, has_scale: bool, foreground: float, max_foreground: float,
                scale_um_per_px: float | None, scale_min: float, scale_max: float) -> str:
    """The sentence under the status. Numbers shown never contradict the status decision."""
    if status == Status.UNRELIABLE.value:
        parts = [_reason_fragment(c, foreground=foreground, max_foreground=max_foreground,
                                  scale_um_per_px=scale_um_per_px, scale_min=scale_min,
                                  scale_max=scale_max) for c in reasons]
        return (f"Aucune proposition fiable : {' ; '.join(parts)}. "
                "Les contours restent visibles à titre indicatif.")
    shapes = ", ".join(_count_phrase(s, by_shape[s]) for s in SHAPE_ORDER if by_shape.get(s))
    unit = "µm" if has_scale else "px"
    least = _plain(_floor_sig(min_detectable))
    noun = "particule candidate" if count == 1 else "particules candidates"
    text = (f"{count} {noun} ({shapes}) d'au moins {least} {unit} de diamètre équivalent. "
            f"{NATURE} {VALIDATE}")
    return text if has_scale else f"{text} {NO_SCALE}"


def validated_sentence(count: int, kept: int, excluded: int, missed: int) -> str:
    noun = "particule candidate validée" if count == 1 else "particules candidates validées"
    return (f"{count} {noun} : {kept} {'proposée gardée' if kept <= 1 else 'proposées gardées'}, "
            f"{excluded} {'exclue' if excluded <= 1 else 'exclues'}, "
            f"{missed} {'ajoutée' if missed <= 1 else 'ajoutées'} sans contour.")


def correction_message(code: str, particle_id: int | None) -> str:
    if code == "unknown_particle":
        return f"Particule {particle_id} inconnue."
    if code == "both":
        return f"Particule {particle_id} : exclue ou reformée, pas les deux."
    if code == "duplicate":
        return f"Particule {particle_id} : forme corrigée plusieurs fois."
    return "Forme inconnue."


def recorded_problem(code: str, value: int | None = None, other: int | None = None) -> str:
    """422 messages for a recorded analysis that contradicts itself."""
    if code == "duplicate_id":
        return f"Analyse enregistrée incohérente : particule {value} en double."
    if code == "count":
        return (f"Analyse enregistrée incohérente : {value} particules annoncées pour "
                f"{other} dans la liste.")
    return f"Analyse enregistrée incohérente : forme de la particule {value} inconnue."
