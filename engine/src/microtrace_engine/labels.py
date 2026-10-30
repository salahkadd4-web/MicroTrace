"""Display labels shared by the report and the quality texts."""
from __future__ import annotations

# Same display labels as the web screen (web/src/lib/polymer-labels.ts); other codes unchanged.
_POLYMER_LABELS = {"PS_SUM": "PS (somme)", "ANY": "Au moins un polymère"}


def polymer_label(code: str) -> str:
    return _POLYMER_LABELS.get(str(code), str(code))
