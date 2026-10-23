"""Polymer vocabulary and label normalisation."""
from __future__ import annotations

import re

UNKNOWN = "UNKNOWN"
OTHER = "OTHER"

CANONICAL: frozenset[str] = frozenset({
    "PE", "PP", "PET", "PS", "PVC", "PA", "PU", "PC", "PMMA", "ABS", "PLA",
    "PTFE", "POM", "SILICONE", "EVA", "ACRYLIC", "CA", "CELLULOSE", "RUBBER", "NC",
})

_ALIASES: dict[str, str] = {
    "polyethylene": "PE", "ldpe": "PE", "hdpe": "PE", "oxidized pe": "PE",
    "polypropylene": "PP",
    "polystyrene": "PS",
    "polyvinyl chloride": "PVC",
    "polycarbonate": "PC",
    "polyurethane": "PU",
    "polyethylene terephthalate": "PET", "polyester": "PET",
    "polyamide": "PA", "nylon": "PA", "polyamine (nylon)": "PA",
    "poly (methyl methacrylate)": "PMMA", "polymethyl methacrylate": "PMMA",
    "acrylonitrile butadiene styrene": "ABS",
    "polylactic acid": "PLA",
    "polytetrafluoroethylene": "PTFE",
    "polyoxymethylene": "POM",
    "polyethylene vinyl acetate": "EVA", "peva": "EVA",
    "cellulose acetate": "CA",
    "cotton": "CELLULOSE", "dyed cellulose": "CELLULOSE",
    "nitrocellulose": "NC",
}
# Every canonical code maps to itself, lowercased.
_ALIASES.update({code.lower(): code for code in CANONICAL})

_PREFIX = re.compile(r"^\(.*?\)\s*")
_UNKNOWN_LABELS = {"", "/", "none"}


def normalize_polymer(label: str | None) -> str:
    """Map a raw polymer label to a canonical code, UNKNOWN or OTHER. Never raises."""
    if label is None:
        return UNKNOWN
    key = re.sub(r"\s+", " ", label.strip().lower())
    if key in _UNKNOWN_LABELS:
        return UNKNOWN
    key = _PREFIX.sub("", key).strip()
    if key in _UNKNOWN_LABELS:
        return UNKNOWN
    return _ALIASES.get(key, OTHER)
