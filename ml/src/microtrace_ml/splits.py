"""Leakage-safe evaluation splits.

All functions take the catalogue DataFrame (already filtered to one technique)
and return positional indices usable with ``df.iloc[idx]``.
"""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

AGED_STATES = ("weathered", "biofouled")


def leave_one_source_out(
    df: pd.DataFrame,
) -> Iterator[tuple[str, np.ndarray, np.ndarray]]:
    """Yield ``(held_source, idx_train, idx_test)``, one iteration per source."""
    source = df["source"].to_numpy()
    for held in sorted(set(source)):
        is_held = source == held
        yield str(held), np.flatnonzero(~is_held), np.flatnonzero(is_held)


def group_kfold(
    df: pd.DataFrame, n_splits: int = 5, seed: int = 0
) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    """Stratified (by polymer) k-fold that never splits a ``sample_group``."""
    cv = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    y = df["polymer"].to_numpy()
    groups = df["sample_group"].to_numpy()
    for train, test in cv.split(np.zeros(len(df)), y, groups):
        yield train, test


def pristine_to_aged(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Train on pristine spectra, test on weathered or biofouled ones."""
    state = df["state"].to_numpy()
    train = np.flatnonzero(state == "pristine")
    test = np.flatnonzero(np.isin(state, AGED_STATES))
    return train, test
