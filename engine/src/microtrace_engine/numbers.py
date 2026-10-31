"""Number formatting shared by the French texts (decimal comma, no exponent)."""
from __future__ import annotations

from decimal import Decimal


def _plain(x: float) -> str:
    """A rounded number as plain French text (decimal comma, no exponent)."""
    text = format(Decimal(repr(x)), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _vs_threshold(x: float, digits: int, threshold: float, *, above: bool,
                  significant: bool = False) -> str:
    """Display ``x`` with ``digits`` decimals (or significant digits), then add digits until
    the shown number is strictly on the triggering side of the threshold (above: > threshold,
    otherwise < threshold), so the text never contradicts the decision made on the exact number.
    """
    for d in range(digits, 13):
        shown = float(f"{x:.{d}g}") if significant else round(x, d)
        if (shown > threshold) if above else (shown < threshold):
            return _plain(shown)
    return _plain(x)
