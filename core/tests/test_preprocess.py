import warnings

import numpy as np
import pytest

from microtrace_core.preprocess import (
    GRIDS,
    als_baseline,
    clean,
    coverage,
    minmax,
    nm_to_raman_shift,
    preprocess,
    resample,
)
from microtrace_core.spectrum import Spectrum


def test_nm_to_raman_shift_532():
    lam = 1e7 / (1e7 / 532.0 - 2848.0)
    assert nm_to_raman_shift(np.array([lam]), 532.0)[0] == pytest.approx(2848.0, abs=1e-6)


def test_clean_sorts_descending_x():
    x, y = clean(np.array([3.0, 2.0, 1.0, 2.0]), np.array([30.0, 20.0, 10.0, 22.0]))
    assert x.tolist() == [1.0, 2.0, 3.0] and y.tolist() == [10.0, 21.0, 30.0]


def test_clean_drops_non_finite():
    x, y = clean(np.array([1.0, np.nan, 3.0]), np.array([1.0, 2.0, np.inf]))
    assert x.tolist() == [1.0]


def test_resample_nan_outside_range():
    out = resample(np.array([1000.0, 2000.0]), np.array([0.0, 1.0]), np.array([900.0, 1500.0, 2100.0]))
    assert np.isnan(out[0]) and out[1] == pytest.approx(0.5) and np.isnan(out[2])


def test_als_removes_linear_baseline():
    x = np.linspace(0, 1, 500)
    peak = np.exp(-(((x - 0.5) / 0.01) ** 2))
    y = peak + 2 * x + 1
    corrected = y - als_baseline(y, lam=1e5, p=0.01)
    assert np.abs(corrected[x < 0.4]).max() < 0.05
    assert corrected.max() > 0.8


def test_minmax_constant_is_zeros():
    assert minmax(np.array([5.0, 5.0, np.nan])).tolist()[:2] == [0.0, 0.0]


def test_all_nan_inputs_are_quiet():
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        nan = np.full(20, np.nan)
        assert np.isnan(als_baseline(nan, 1e5, 0.01)).all() and len(als_baseline(nan, 1e5, 0.01)) == 20
        assert np.isnan(minmax(nan)).all()
        assert coverage(nan) == 0.0


def test_coverage():
    assert coverage(np.array([1.0, np.nan, 2.0, np.nan])) == 0.5


def _spec(x, y, unit, laser=None):
    return Spectrum(
        spectrum_id="t", source="t", technique="raman", x=x, y=y, x_unit=unit,
        polymer="PE", polymer_raw="PE", state="unknown", sample_group="g", file="f",
        laser_nm=laser,
    )


def test_preprocess_converts_only_nm():
    shift = np.linspace(200, 3300, 1500)
    y = np.exp(-(((shift - 2848.0) / 10.0) ** 2))
    s_cm = _spec(shift, y, "cm-1")
    lam = 1e7 / (1e7 / 532.0 - shift)
    s_nm = _spec(lam, y, "nm", 532.0)
    out_cm, out_nm = preprocess(s_cm), preprocess(s_nm)
    grid = GRIDS["raman"]
    expected = int(np.argmin(np.abs(grid - 2848.0)))
    assert out_cm.dtype == np.float32 and len(out_cm) == len(grid)
    assert abs(int(np.argmax(out_cm)) - expected) <= 1
    assert abs(int(np.argmax(out_nm)) - expected) <= 1
    # input not mutated
    assert s_nm.x[0] == lam[0]


def test_preprocess_outside_grid_is_all_nan():
    x = np.linspace(10000, 11000, 50)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        out = preprocess(_spec(x, np.arange(50.0), "cm-1"))
    assert out.dtype == np.float32 and np.isnan(out).all()


def _ftir(y, y_unit):
    x = np.arange(500.0, 4100.0, 2.0)
    return Spectrum(
        spectrum_id="t", source="t", technique="ftir_atr", x=x, y=y, x_unit="cm-1",
        y_unit=y_unit, polymer="PET", polymer_raw="PET", state="unknown",
        sample_group="g", file="f")


def _band():
    x = np.arange(500.0, 4100.0, 2.0)
    a = 0.8 * np.exp(-(((x - 1716.0) / 20.0) ** 2)) + 0.02
    return x, a


def test_preprocess_transmittance_is_converted_to_absorbance():
    x, a = _band()
    t = 100.0 * 10.0 ** (-a)
    pad = (x < 800.0) | (x > 3800.0)  # zero padding overlapping both grid ends
    t[pad] = 0.0
    t_in = t.copy()
    s = _ftir(t, "transmittance_pct")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        out = preprocess(s)
    grid = GRIDS["ftir_atr"]
    assert int(np.nanargmax(out)) == int(np.argmin(np.abs(grid - 1716.0)))
    padded = (grid < 800.0) | (grid > 3800.0)
    assert padded.sum() > 0 and np.isnan(out[padded]).all()
    assert np.isfinite(out[(grid >= 800) & (grid <= 3800)]).all()
    np.testing.assert_array_equal(s.y, t_in)


def test_preprocess_absorbance_gives_same_argmax():
    _, a = _band()
    out = preprocess(_ftir(a, "absorbance"))
    assert int(np.argmax(out)) == int(np.argmin(np.abs(GRIDS["ftir_atr"] - 1716.0)))
