"""Study report: Markdown is the source, HTML a safe, self-contained rendering.

Only aggregates, QC summary rows and B1 issue messages are rendered (no per-record table).
"""
from __future__ import annotations

import html
import re
from collections import Counter
from datetime import datetime, timezone
from importlib.metadata import version

from microtrace_core.results import (
    AGGREGATION_RULE_FR,
    RULES_VERSION,
    MeasurementRecord,
    StudyContext,
    describe,
    quantification_frequency,
)
from microtrace_core.results.issues import fmt_fr
from microtrace_core.results.vocab import label_fr

from .schemas import ReportRequest

DISCLAIMER = "Prototype de recherche, pas un dispositif médical."
RULES_WARNING = "Attention : règles de contrôle différentes entre imports"
SEVERITY_FR = {"error": "erreur", "warning": "avertissement", "info": "information"}


_ENTITIES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", "[": "&#91;", "]": "&#93;",
             "`": "&#96;", "*": "&#42;", "|": "&#124;", "\\": "&#92;"}

def _lab(group: str, code: str) -> str:
    return label_fr(group, code)


def _c(value: object) -> str:
    """Untrusted text for Markdown: single line, markup and link syntax neutralised."""
    text = " ".join(str(value).split())
    return "".join(_ENTITIES.get(ch, ch) for ch in text)


def _num(v: float | None) -> str:
    return "—" if v is None else fmt_fr(v)


def _counts(issues) -> list[int]:
    n = Counter(x.severity for x in issues)
    return [n["error"], n["warning"], n["info"]]


def _table(header: list[str], rows: list[list[object]]) -> list[str]:
    out = ["| " + " | ".join(_c(h) for h in header) + " |",
           "|" + "|".join(" --- " for _ in header) + "|"]
    out += ["| " + " | ".join(_c(x) for x in r) + " |" for r in rows]
    return out + [""]


def _where(matrix, detail: str) -> str:
    name = _lab("matrix", getattr(matrix, "value", matrix))
    return f"{name} ({detail})" if detail else name


def build_markdown(req: ReportRequest, ctx: StudyContext, records: list[MeasurementRecord],
                   qc: list[MeasurementRecord]) -> str:
    """``ctx``, ``records`` and ``qc`` are ``req``'s context and records converted to B1."""
    s = req.study
    when = req.generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    L: list[str] = [f"# {_c(s.title)}", "", f"Rapport généré le {_c(when)}", ""]
    if s.nature == "simulated":
        L += ["> **SIMULÉ — données fictives**", ""]
    L += [f"> {DISCLAIMER}", ""]

    L += ["## Versions", "", f"- Moteur : {_c(version('microtrace-engine'))}",
          f"- Règles du calcul : {_c(RULES_VERSION)}"]
    seen = {i.rules_version for i in req.imports}
    for k, i in enumerate(req.imports, 1):
        L.append(f"- Règles de l'import {k} ({_c(i.file.name)}) : {_c(i.rules_version)}")
    if len(seen) > 1 or (seen and seen != {RULES_VERSION}):
        L += ["", f"**{RULES_WARNING}**"]
    L.append("")

    L += ["## Étude et référence", "", f"- Titre : {_c(s.title)}",
          f"- Nature des données : {_c(_lab('nature', s.nature))}",
          f"- DOI : {_c(s.doi) if s.doi else 'non renseigné'}",
          f"- Licence : {_c(s.license) if s.license else 'non renseignée'}",
          f"- Correction du blanc : {_c(_lab('blank', s.blank_corrected))}", ""]

    L += ["## Méthodes et limites de détection", ""]
    if req.context.methods:
        L += _table(["Méthode", "Technique"],
                    [[m.name, _lab('technique', m.technique)] for m in req.context.methods])
    if req.context.limits:
        L += _table(["Méthode", "Polymère", "LOD", "LOQ", "Unité", "Source"],
                    [[x.method, x.polymer, _num(x.lod), _num(x.loq), x.unit_code, x.source]
                     for x in req.context.limits])
    else:
        L += ["Aucune limite de détection déclarée.", ""]

    L += ["## Imports", ""]
    if req.imports:
        L += _table(["Fichier", "SHA-256", "Feuille", "Date", "Auteur", "Erreurs",
                     "Avertissements", "Informations"],
                    [[i.file.name, i.file.sha256, i.file.sheet or "—", i.date, i.author,
                      *_counts(i.issues)] for i in req.imports])
    else:
        L += ["Aucun import.", ""]

    L += ["## Règle d'agrégation", "", _c(AGGREGATION_RULE_FR), ""]

    L += ["## Fréquences de quantification", ""]
    freqs = quantification_frequency(records)
    if freqs:
        L += _table(["Polymère", "Matrice", "Quantifiés/échantillons"],
                    [[f.polymer, _where(f.matrix, f.matrix_detail),
                      f"{f.n_quantified}/{f.n_samples} ({fmt_fr(round(f.fraction * 100, 1))} %)"]
                     for f in freqs])
    else:
        L += ["Aucun échantillon.", ""]

    L += ["## Statistiques", "", "Statistiques sur valeurs quantifiées uniquement.", ""]
    stats = describe(records)
    if stats:
        L += _table(["Polymère", "Méthode", "Matrice", "Grandeur", "Unité", "n quantifiés",
                     "Min", "Médiane", "Moyenne", "Max"],
                    [[p.polymer, p.method, _where(p.matrix, p.matrix_detail),
                      f"{_lab('kind', p.kind.value)}, {_lab('basis', p.basis.value)}",
                      p.canonical_unit.label,
                      p.n_quantified, _num(p.min), _num(p.median), _num(p.mean), _num(p.max)]
                     for p in stats])
    else:
        L += ["Aucune statistique.", ""]

    L += ["## Contrôles qualité", ""]
    if qc:
        cnt = Counter((r.record_type.value, r.method, r.polymer, r.status.value) for r in qc)
        cnt = Counter({(_lab('record_type', k[0]), k[1], k[2], _lab('status', k[3])): n
                       for k, n in cnt.items()})
        L += _table(["Type", "Méthode", "Polymère", "Statut", "Nombre"],
                    [[*k, n] for k, n in sorted(cnt.items())])
    else:
        L += ["Aucun enregistrement de contrôle qualité.", ""]

    L += ["## Issues", ""]
    shown = [(k, x) for k, i in enumerate(req.imports, 1) for x in i.issues
             if x.severity in ("warning", "info")]
    if shown:
        L += _table(["Import", "Gravité", "Code", "Message"],
                    [[k, SEVERITY_FR[x.severity], x.code, x.message] for k, x in shown])
    else:
        L += ["Aucun avertissement ni information.", ""]

    L += ["## Limites", "",
          "- Ce rapport ne constitue pas un diagnostic.",
          "- L'identification des polymères est liée à la méthode analytique utilisée.",
          "- Les valeurs inférieures à la LOQ ne sont pas imputées.",
          "- Une fréquence de quantification n'est pas une concentration.", ""]
    return "\n".join(L)


CSS = ("body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;"
       "line-height:1.5;color:#111}table{border-collapse:collapse;margin:1rem 0;width:100%}"
       "th,td{border:1px solid #bbb;padding:.3rem .5rem;text-align:left;font-size:.9rem;"
       "word-break:break-word}th{background:#eee}blockquote{margin:1rem 0;padding:.5rem 1rem;"
       "border-left:4px solid #b45309;background:#fef3c7}")

_BOLD = re.compile(r"\*\*(.+?)\*\*")


def _text(text: str) -> str:
    # entities emitted by _c render as the literal characters, then everything is escaped
    out = html.escape(html.unescape(text), quote=True)
    return out.replace("[", "&#91;").replace("]", "&#93;").replace("`", "&#96;")


def _inline(text: str) -> str:
    out = []
    for part in re.split(r"(\*\*.+?\*\*)", text):
        if len(part) > 4 and part.startswith("**") and part.endswith("**"):
            out.append(f"<strong>{_text(part[2:-2])}</strong>")
        else:
            out.append(_text(part))
    return "".join(out)


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().split("|")[1:-1]]


def to_html(markdown: str, title: str) -> str:
    """Convert the Markdown subset emitted by build_markdown; all text is escaped first."""
    out: list[str] = []
    lines = markdown.split("\n")
    i = 0
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1
        elif ln.startswith("#"):
            n = min(len(ln) - len(ln.lstrip("#")), 6)
            out.append(f"<h{n}>{_inline(ln[n:].strip())}</h{n}>")
            i += 1
        elif ln.startswith(">"):
            out.append(f"<blockquote>{_inline(ln[1:].strip())}</blockquote>")
            i += 1
        elif ln.startswith("|"):
            block = []
            while i < len(lines) and lines[i].startswith("|"):
                block.append(lines[i])
                i += 1
            head = _split_row(block[0])
            body = [_split_row(b) for b in block[2:]]
            t = ["<table><thead><tr>"
                 + "".join(f"<th>{_inline(c)}</th>" for c in head) + "</tr></thead><tbody>"]
            t += ["<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>" for r in body]
            out.append("".join(t) + "</tbody></table>")
        elif ln.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(f"<li>{_inline(lines[i][2:])}</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
        else:
            out.append(f"<p>{_inline(ln)}</p>")
            i += 1
    return ("<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">"
            f"<title>{_text(title)}</title><style>{CSS}</style></head><body>"
            + "\n".join(out) + "</body></html>")
