import numpy as np

from microtrace_ml.matching import NO_MATCH, CorrelationMatcher


def _library():
    x = np.linspace(0, 1, 200)
    return np.stack([np.exp(-((x - c) ** 2) / 0.002) for c in (0.2, 0.5, 0.8)]), x


def _fit():
    Y, _ = _library()
    return CorrelationMatcher().fit(Y, ["A", "B", "C"], ["a1", "b1", "c1"]), Y


def test_matcher_finds_shifted_scaled_copy():
    m, Y = _fit()
    res = m.predict((2 * Y[1] + 0.3)[None, :])
    assert list(res.labels) == ["B"]
    assert list(res.best_ids) == ["b1"]
    assert res.scores[0] > 0.999
    assert res.scores.dtype == np.float64


def test_matcher_rejects_low_overlap():
    m, Y = _fit()
    q = Y[1].copy()
    q[60:] = np.nan  # only 30 % finite
    res = m.predict(q[None, :])
    assert list(res.labels) == [NO_MATCH]
    assert res.scores[0] == -np.inf


def test_matcher_threshold_abstains():
    m, Y = _fit()
    q = np.random.default_rng(0).normal(size=(1, Y.shape[1]))
    res = m.predict(q, threshold=0.9)
    assert list(res.labels) == [NO_MATCH]


def test_matcher_constant_query_is_minus_inf_not_nan():
    m, Y = _fit()
    res = m.predict(np.ones((1, Y.shape[1])))
    assert res.scores[0] == -np.inf
    assert list(res.labels) == [NO_MATCH]


def test_matcher_partial_overlap_and_chunking():
    m, Y = _fit()
    q = np.tile(Y[2], (5, 1)) * 3.0
    q[:, :40] = np.nan  # 80 % finite, passes
    res = m.predict(q, chunk_size=2)
    assert list(res.labels) == ["C"] * 5
    assert (res.scores > 0.99).all()
