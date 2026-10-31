"""All the French wording of the quality assistant (rule titles, explanations, notes,
number labels, rule descriptions and limits). ``core`` computes structures only; every word
shown to a person is written here, and only here.

Numbers come from ``fmt_fr`` (decimal comma, 6 significant digits); rounding for display is
done here on the exact numbers that ``core`` exposes, never on a recomputed quantity.
"""
from __future__ import annotations

from dataclasses import dataclass

from microtrace_core.results import UNITS
from microtrace_core.results.issues import fmt_fr
from microtrace_core.results.quality import (
    ALIQUOT_RPD_THRESHOLD,
    LOD_RATE_ALPHA,
    LOD_RATE_MIN_STRATUM,
    MAD_CONSTANT,
    NEAR_BLANK_FACTOR,
    OUTLIER_MIN_SAMPLES,
    OUTLIER_Z_THRESHOLD,
    NoteReason,
    QualityGroup,
    QualityNote,
    QualityRule,
    Signal,
)
from microtrace_core.results.units import parse_unit
from microtrace_core.results.vocab import label_fr

from .labels import polymer_label
from .numbers import _plain, _vs_threshold


@dataclass(frozen=True)
class RuleText:
    title: str
    description: str
    limits: tuple[str, ...]


CATEGORY: dict[QualityRule, str] = {
    QualityRule.aliquot_discordance: "replicates",
    QualityRule.near_blank: "blanks",
    QualityRule.robust_outlier: "distribution",
    QualityRule.unusual_lod_rate: "batches",
}

_RPD = fmt_fr(ALIQUOT_RPD_THRESHOLD * 100)
_FACTOR = fmt_fr(NEAR_BLANK_FACTOR)
_Z = fmt_fr(OUTLIER_Z_THRESHOLD)
_ALPHA = fmt_fr(LOD_RATE_ALPHA)
_MIN_SAMPLES = OUTLIER_MIN_SAMPLES
_MIN_STRATUM = LOD_RATE_MIN_STRATUM

RULE_TEXTS: dict[QualityRule, RuleText] = {
    QualityRule.aliquot_discordance: RuleText(
        "Discordance entre aliquotes",
        "Pour un même échantillon, dans un même groupe d'analyse, avec au moins 2 aliquotes "
        "quantifiées : écart relatif = (maximum − minimum) / moyenne des valeurs quantifiées. "
        f"Signal si l'écart relatif dépasse {_RPD} %. Une aliquote censurée n'est jamais lue "
        "comme un nombre.",
        ("Une paire dont une aliquote est « < LOD » ne donne aucun signal : une discordance "
         "peut ainsi rester cachée.",
         f"Le seuil de {_RPD} % est un point de départ documenté, non un critère réglementaire ; "
         "il n'est pas réglable par laboratoire.")),
    QualityRule.near_blank: RuleText(
        "Valeur proche des blancs",
        "Chaque mesure quantifiée est comparée à la moyenne de chaque blanc de procédure "
        "résumé du même polymère, convertie dans l'unité du groupe : rapport = valeur / moyenne "
        f"du blanc. Signal si le rapport est inférieur à {_FACTOR}.",
        ("Le contrôle résumé n'a ni méthode ni matrice : il s'applique à toutes les méthodes "
         "et toutes les matrices du polymère.",
         "Sur des données déjà corrigées du blanc, le rapport compare une valeur nette à un "
         "blanc brut.",
         "Un blanc d'une autre grandeur ou base, ou d'une unité inconnue, ne produit aucun "
         "signal.",
         "Les blancs de terrain et les échantillons dopés sont ignorés.")),
    QualityRule.robust_outlier: RuleText(
        "Valeur atypique",
        "Sur les résultats par échantillon (moyenne des aliquotes quantifiées) d'un groupe : "
        f"score z modifié M = {fmt_fr(MAD_CONSTANT)} × (x − médiane) / MAD, avec MAD la "
        f"médiane des écarts absolus à la médiane. Signal si |M| dépasse {_Z}, avec au moins "
        f"{_MIN_SAMPLES} échantillons quantifiés et un MAD non nul.",
        ("Avec peu d'échantillons aux valeurs groupées, le MAD devient minuscule et la règle "
         "signale trop.",
         "Seules les valeurs quantifiées forment la distribution : avec une forte censure à "
         "gauche, elle est tronquée et une valeur basse anormale est presque indétectable.")),
    QualityRule.unusual_lod_rate: RuleText(
        "Taux de < LOD inhabituel",
        "Pour chaque lot (puis chaque date d'analyse) d'au moins "
        f"{_MIN_STRATUM} mesures analysées, quand il reste au moins {_MIN_STRATUM} autres "
        "mesures renseignées dans le groupe : test exact de Fisher bilatéral sur la part de "
        f"mesures « < LOD ». Signal si p est inférieur à {_ALPHA}.",
        (f"Seuil de {_ALPHA} sans correction des comparaisons multiples : environ 1 faux signal "
         "est attendu pour 100 comparaisons.",
         "Un écart entre lots peut venir de l'échantillonnage plutôt que de l'analyse.",
         "La date est comparée au jour près.",
         "Sans lot ni date renseignés, la règle n'est pas appliquée.")),
}


# ------------------------------------------------------------------------------ labels

_FIGURE_LABELS = {
    "n_aliquots": "Aliquotes", "n_quantified": "Aliquotes quantifiées", "min": "Minimum",
    "max": "Maximum", "mean": "Moyenne", "rpd_percent": "Écart relatif (%)",
    "threshold_percent": "Seuil (%)", "value": "Valeur", "blank_mean": "Moyenne du blanc",
    "blank_mean_reported": "Moyenne du blanc (unité du contrôle)", "blank_n": "n du blanc",
    "ratio": "Rapport valeur / blanc", "factor": "Seuil du rapport", "median": "Médiane",
    "mad": "Écart absolu médian", "z": "Score z modifié", "n": "Échantillons quantifiés",
    "threshold": "Seuil de |z|", "k_stratum": "Mesures < LOD (strate)",
    "n_stratum": "Mesures analysées (strate)", "k_rest": "Mesures < LOD (autres)",
    "n_rest": "Mesures analysées (autres)", "rate_stratum_percent": "Taux < LOD, strate (%)",
    "rate_rest_percent": "Taux < LOD, autres (%)", "p_value": "p (Fisher bilatéral)",
    "alpha": "Seuil de p",
}


def figure_label(name: str) -> str:
    return _FIGURE_LABELS.get(name, name)


def group_label(g: QualityGroup) -> str:
    matrix = label_fr("matrix", g.matrix.value)
    if g.matrix_detail:
        matrix = f"{matrix} ({g.matrix_detail})"
    return f"{polymer_label(g.polymer)}, {g.method}, {matrix}"


def _unit(code: str) -> str:
    return UNITS[code].label if code in UNITS else code


def _fig(s: Signal) -> dict[str, float]:
    return dict(s.figures)


def _z(z: float, threshold: float) -> str:
    shown = _vs_threshold(abs(z), 2, threshold, above=True)
    return f"-{shown}" if z < 0 else shown


def _r(x: float, digits: int) -> str:
    return fmt_fr(round(x, digits))


def subject_label(s: Signal) -> str:
    if s.rule == QualityRule.unusual_lod_rate:
        if s.dimension == "batch":
            return f"Lot {s.stratum}"
        return f"Date d'analyse {s.stratum}"
    label = f"Échantillon {s.sample_id}"
    if s.rule == QualityRule.near_blank and s.aliquot:
        label += f", aliquote {s.aliquot}"
    return label


# -------------------------------------------------------------------------- explanations

def _aliquot_values(s: Signal) -> str:
    unit = _unit(s.group.canonical_unit.code)
    parts = [f"{x.record.aliquot or '—'} = {fmt_fr(x.record.canonical_value or 0.0)}"
             for x in s.records]
    joined = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " et " + parts[-1]
    return f"{joined} {unit}"


def explanation(s: Signal, blank_corrected: str) -> str:
    f = _fig(s)
    head = f"{subject_label(s)} — {group_label(s.group)} : "
    unit = _unit(s.group.canonical_unit.code)
    if s.rule == QualityRule.aliquot_discordance:
        text = (f"{head}aliquotes quantifiées {_aliquot_values(s)}, écart relatif "
                f"{_vs_threshold(f['rpd_percent'], 1, f['threshold_percent'], above=True)} % (étendue / moyenne), au-delà du seuil de "
                f"{fmt_fr(f['threshold_percent'])} %.")
        left = int(f["n_aliquots"] - f["n_quantified"])
        if left > 0:
            plural = "s" if left > 1 else ""
            text += (f" {left} aliquote{plural} non quantifiée{plural} laissée{plural} de "
                     "côté.")
        return text
    if s.rule == QualityRule.near_blank:
        assert s.blank is not None
        reported_unit = parse_unit(s.blank.unit_code)
        reported_label = reported_unit.label if reported_unit else s.blank.unit_code
        mean = f"{fmt_fr(f['blank_mean_reported'])} {reported_label}"
        if reported_unit is None or reported_unit.code != s.group.canonical_unit.code:
            mean += f", soit {fmt_fr(f['blank_mean'])} {unit}"
        text = (f"{head}{fmt_fr(f['value'])} {unit}, soit {_vs_threshold(f['ratio'], 1, f['factor'], above=False)} fois la moyenne "
                f"des blancs de procédure ({mean} ; n = {int(f['blank_n'])}) ; seuil : moins de "
                f"{fmt_fr(f['factor'])} fois.")
        if blank_corrected == "yes":
            text += (" L'étude est déclarée corrigée du blanc : valeur déjà corrigée du blanc, "
                     "le rapport compare donc une valeur nette à un blanc brut.")
        return text
    if s.rule == QualityRule.robust_outlier:
        return (f"{head}{fmt_fr(f['value'])} {unit} (moyenne des aliquotes quantifiées), score "
                f"z modifié {_z(f['z'], f['threshold'])} (médiane {fmt_fr(f['median'])}, écart absolu médian "
                f"{fmt_fr(f['mad'])}, n = {int(f['n'])} échantillons quantifiés) ; seuil : "
                f"|z| > {fmt_fr(f['threshold'])}.")
    others = "autres lots" if s.dimension == "batch" else "autres dates"
    what = "Lot" if s.dimension == "batch" else "Date d'analyse"
    return (f"{what} « {s.stratum} » — {group_label(s.group)} : {int(f['k_stratum'])}/"
            f"{int(f['n_stratum'])} mesures < LOD ({_r(f['rate_stratum_percent'], 1)} %), "
            f"contre {int(f['k_rest'])}/{int(f['n_rest'])} ({_r(f['rate_rest_percent'], 1)} %) "
            f"dans les {others} ; test exact de Fisher bilatéral, p = {_vs_threshold(f['p_value'], 2, f['alpha'], above=False, significant=True)} "
            f"(seuil {fmt_fr(f['alpha'])}).")


# ------------------------------------------------------------------------------- notes

def _samples(n: int) -> str:
    return f"{n} échantillon quantifié" if n <= 1 else f"{n} échantillons quantifiés"


def note_message(n: QualityNote) -> str:
    g = group_label(n.group) if n.group else ""
    dim = "le lot" if n.dimension == "batch" else "la date d'analyse"
    dim_cap = "lot" if n.dimension == "batch" else "date d'analyse"
    if n.reason == NoteReason.no_blank_summary:
        return ("Aucun blanc de procédure résumé n'est enregistré pour l'étude : la recherche "
                "de valeurs proches des blancs n'est pas appliquée.")
    if n.reason == NoteReason.polymers_without_blank:
        names = ", ".join(polymer_label(p) for p in n.polymers)
        return (f"Aucun blanc de procédure résumé pour : {names}. Pas de comparaison aux "
                "blancs pour ces polymères.")
    b = n.blank
    if n.reason == NoteReason.blank_unit_mismatch:
        assert b is not None
        return (f"Le blanc de procédure « {polymer_label(b.polymer)} » est exprimé en "
                f"{_unit(b.unit_code)}, d'une autre grandeur ou base que le groupe {g} : pas de "
                "comparaison.")
    if n.reason == NoteReason.blank_unit_unknown:
        assert b is not None
        return (f"L'unité « {b.unit_code} » du blanc de procédure « {polymer_label(b.polymer)} »"
                " est inconnue : pas de comparaison.")
    if n.reason == NoteReason.blank_mean_missing:
        assert b is not None
        return (f"La moyenne du blanc de procédure « {polymer_label(b.polymer)} » est vide, "
                "nulle ou négative : pas de comparaison.")
    if n.reason == NoteReason.too_few_samples:
        return (f"{g} : {_samples(n.count or 0)}, il en faut au moins {_MIN_SAMPLES} ; pas de "
                "recherche de valeur atypique.")
    if n.reason == NoteReason.zero_mad:
        return (f"{g} : au moins la moitié des {n.count} valeurs sont identiques (écart absolu "
                "médian nul) ; le score z modifié n'est pas calculable.")
    if n.reason == NoteReason.dimension_empty:
        return (f"Taux de < LOD : {dim} n'est renseigné{'e' if n.dimension != 'batch' else ''} "
                f"pour aucune mesure ; comparaison par {dim_cap} impossible.")
    if n.reason == NoteReason.too_few_in_strata:
        none = "aucun lot" if n.dimension == "batch" else "aucune date d'analyse"
        return (f"{g} : {none} n'a au moins {_MIN_STRATUM} mesures analysées avec "
                f"au moins {_MIN_STRATUM} autres mesures renseignées ; pas de comparaison par "
                f"{dim_cap}.")
    count = n.count or 0
    plural = "s" if count > 1 else ""
    return (f"{count} comparaison{plural} de taux de < LOD effectuée{plural} (seuil "
            f"{_ALPHA}) : environ 1 faux signal est attendu pour 100 comparaisons.")
