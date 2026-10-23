"""Raw spectrum record shared by all readers."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, get_args

import numpy as np

Technique = Literal["ftir_atr", "raman"]
YUnit = Literal["absorbance", "transmittance_pct", "intensity"]
State = Literal["pristine", "weathered", "biofouled", "unknown"]

MIN_POINTS = 10


@dataclass(frozen=True, eq=False)
class Spectrum:
    """A raw spectrum; x and y are kept in the original unit, unprocessed."""

    spectrum_id: str
    source: str
    technique: Technique
    x: np.ndarray
    y: np.ndarray
    x_unit: Literal["cm-1", "nm"]
    polymer: str
    polymer_raw: str
    state: State
    sample_group: str
    file: str
    laser_nm: float | None = None
    y_unit: YUnit = "intensity"
    label_note: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        x = np.asarray(self.x, dtype=np.float64)
        y = np.asarray(self.y, dtype=np.float64)
        object.__setattr__(self, "x", x)
        object.__setattr__(self, "y", y)
        if x.shape != y.shape or x.ndim != 1:
            raise ValueError("x and y must be 1-D arrays of the same length")
        if len(x) < MIN_POINTS:
            raise ValueError(f"spectrum needs at least {MIN_POINTS} points, got {len(x)}")
        if self.technique not in get_args(Technique):
            raise ValueError(f"invalid technique: {self.technique!r}")
        if self.state not in get_args(State):
            raise ValueError(f"invalid state: {self.state!r}")
        if self.y_unit not in get_args(YUnit):
            raise ValueError(f"invalid y_unit: {self.y_unit!r}")
        if self.technique == "ftir_atr" and self.y_unit not in ("absorbance", "transmittance_pct"):
            raise ValueError(f"ftir_atr requires absorbance or transmittance_pct, got {self.y_unit!r}")
        if self.technique == "raman" and self.y_unit != "intensity":
            raise ValueError(f"raman requires y_unit 'intensity', got {self.y_unit!r}")
        if self.technique == "raman" and self.x_unit == "nm" and self.laser_nm is None:
            raise ValueError("raman spectrum in nm requires laser_nm")
