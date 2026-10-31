"""Synthetic spectral catalogue: three Gaussian polymers (A, B, C) per technique.

FTIR libraries: ``mpx`` and ``flopp``; Raman libraries: ``mpx`` and ``slopp``.
Twenty spectra per polymer and library, noise seeded with 0. The peak positions differ
between the techniques so that a spectrum of one technique is clearly not the other.
"""
from __future__ import annotations

import hashlib
from functools import lru_cache

import numpy as np
import pandas as pd

from microtrace_core.preprocess import diagnostic_coverage, preprocess
from microtrace_core.spectral import SPECTRAL_MODEL_NAME, SPECTRAL_MODEL_VERSION
from microtrace_core.spectral.model import SpectralModel
from microtrace_core.spectral.thresholds import Thresholds
from microtrace_core.spectral.train import fit_technique, training_frame
from microtrace_core.spectrum import Spectrum

CENTRES = {
    "ftir_atr": {"A": 800.0, "B": 1100.0, "C": 1400.0},
    "raman": {"A": 700.0, "B": 1000.0, "C": 1500.0},
}
LIBS = {"ftir_atr": ("mpx", "flopp"), "raman": ("mpx", "slopp")}
Y_UNIT = {"ftir_atr": "absorbance", "raman": "intensity"}
X_RAW = np.arange(200.0, 4101.0, 2.0)
THRESHOLDS = Thresholds(0.5, 0.7, 0.05)


def gaussian(x: np.ndarray, centre: float, width: float = 25.0) -> np.ndarray:
    return np.exp(-0.5 * ((x - centre) / width) ** 2)


def make_catalog(polymers=("A", "B", "C"), n: int = 20, seed: int = 0,
                 techniques=("ftir_atr", "raman")) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for t in techniques:
        for lib in LIBS[t]:
            for poly in polymers:
                for i in range(n):
                    centre = CENTRES[t][poly] + rng.uniform(-3, 3)
                    y = (gaussian(X_RAW, centre) + 0.02 * rng.standard_normal(X_RAW.size)
                         + 0.05 + 1e-5 * X_RAW)
                    sid = f"{lib}:{t}:{poly}{i:02d}"
                    s = Spectrum(
                        spectrum_id=sid, source=lib, technique=t, x=X_RAW, y=y, x_unit="cm-1",
                        polymer=poly, polymer_raw=poly, state="pristine", sample_group=sid,
                        file=f"Spectres/{lib}/{sid}.csv", laser_nm=None, y_unit=Y_UNIT[t])
                    grid = preprocess(s)
                    rows.append({
                        "spectrum_id": sid, "source": lib, "technique": t, "polymer": poly,
                        "polymer_raw": poly, "state": "pristine", "sample_group": sid,
                        "file": s.file, "file_sha256": hashlib.sha256(sid.encode()).hexdigest(),
                        "laser_nm": None, "x_unit": "cm-1", "y_unit": Y_UNIT[t],
                        "label_note": "", "coverage": float(np.isfinite(grid).mean()),
                        "diagnostic_coverage": diagnostic_coverage(grid, t),
                        "x_raw": X_RAW.tolist(), "y_raw": y.tolist(), "y_grid": grid.tolist(),
                        "extra": "{}"})
    return pd.DataFrame(rows)


def clean_curve(technique: str, polymer: str, x: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    x = X_RAW if x is None else x
    return x, gaussian(x, CENTRES[technique][polymer]) + 0.05


def noise_curve(seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    return X_RAW, np.random.default_rng(seed).standard_normal(X_RAW.size)


@lru_cache(maxsize=4)
def _model(polymers: tuple[str, ...]) -> SpectralModel:
    df = make_catalog(polymers)
    techniques = {t: fit_technique(training_frame(df, t), t, THRESHOLDS)
                  for t in ("ftir_atr", "raman")}
    return SpectralModel(SPECTRAL_MODEL_NAME, SPECTRAL_MODEL_VERSION, techniques, {})


def make_model(polymers=("A", "B", "C")) -> SpectralModel:
    return _model(tuple(polymers))
