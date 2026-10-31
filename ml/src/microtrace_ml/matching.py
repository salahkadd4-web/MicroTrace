"""Pearson-correlation library matcher (moved to ``microtrace_core.spectral.matching``)."""

from __future__ import annotations

from microtrace_core.spectral.matching import (
    NO_MATCH,
    CorrelationMatcher,
    MatchResult,
    correlation_matrix,
)

__all__ = ["NO_MATCH", "CorrelationMatcher", "MatchResult", "correlation_matrix"]
