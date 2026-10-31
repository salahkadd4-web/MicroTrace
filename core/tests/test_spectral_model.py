from __future__ import annotations

import numpy as np
import pytest
from sklearn.decomposition import PCA
from sklearn.svm import SVC
from spectral_fixtures import (
    CENTRES,
    X_RAW,
    clean_curve,
    gaussian,
    make_catalog,
    make_model,
    noise_curve,
)

from microtrace_core.preprocess import GRIDS
from microtrace_core.spectral import model as model_mod
from microtrace_core.spectral.model import (
    PCA_COMPONENTS,
    Abstention,
    Status,
    SvmParams,
    SpectralQuery,
    identify,
    pca_transform,
    svm_predict,
    window_mask,
)
from microtrace_core.spectral.train import fit_technique, training_frame


def query(technique, x, y, *, x_unit="cm-1", y_unit=None, laser=None):
    y_unit = y_unit or ("intensity" if technique == "raman" else "absorbance")
    return SpectralQuery(x, y, technique, x_unit, y_unit, laser)


def test_pca_transform_matches_sklearn():
    rng = np.random.default_rng(1)
    X = rng.normal(size=(120, 90))
    X[rng.random(X.shape) < 0.1] = np.nan
    Q = rng.normal(size=(15, 90))
    Q[0, :10] = np.nan
    pca = PCA(PCA_COMPONENTS, svd_solver="full").fit(np.nan_to_num(X))
    ours = pca_transform(pca.mean_, pca.components_, Q)
    assert np.allclose(ours, pca.transform(np.nan_to_num(Q)), atol=1e-10)


def _svm_params(clf: SVC) -> SvmParams:
    dual, intercept = clf.dual_coef_, clf.intercept_
    if len(clf.classes_) == 2:
        dual, intercept = -dual, -intercept
    return SvmParams(clf.classes_, clf.support_vectors_, dual, intercept, clf.n_support_,
                     float(clf._gamma))


@pytest.mark.parametrize("n_classes", [5, 2])
def test_svm_predict_matches_sklearn(n_classes):
    rng = np.random.default_rng(0)
    centres = rng.normal(size=(n_classes, 30)) * 1.5
    labels = np.array(list("EDCBA"))[:n_classes]
    X = np.repeat(centres, 300 // n_classes, axis=0) + rng.normal(size=(300 // n_classes * n_classes, 30))
    y = np.repeat(labels, 300 // n_classes)
    clf = SVC(kernel="rbf", class_weight="balanced", gamma="scale").fit(X, y)
    Q = centres[rng.integers(0, n_classes, 200)] + rng.normal(size=(200, 30)) * 1.3
    assert np.array_equal(svm_predict(_svm_params(clf), Q), clf.predict(Q))


def test_identify_self_is_identified():
    df = training_frame(make_catalog(), "ftir_atr")
    row = df[df["polymer"] == "B"].iloc[0]
    res = identify(make_model(), query("ftir_atr", np.array(row["x_raw"]), np.array(row["y_raw"])))
    assert res.status is Status.IDENTIFIED and res.abstention is None
    assert res.candidates[0].polymer == "B" and res.candidates[0].score >= 0.999
    assert res.references[0].spectrum_id == row["spectrum_id"]
    assert len(res.candidates) == 3 and len(res.references) == 5
    assert res.classifier == "B" and res.other_technique is None


def test_identify_noise_abstains():
    x, y = noise_curve(0)
    for t in ("ftir_atr", "raman"):
        res = identify(make_model(), query(t, x, y))
        assert res.status is Status.NOT_IDENTIFIED
        assert res.abstention is Abstention.LOW_SCORE


def test_identify_absent_polymer_abstains():
    model = make_model(("A", "B"))
    for t in ("ftir_atr", "raman"):
        x, y = clean_curve(t, "C")
        res = identify(model, query(t, x, y))
        assert res.status is Status.NOT_IDENTIFIED, t


def test_identify_low_coverage():
    x = np.arange(600.0, 961.0, 2.0)
    res = identify(make_model(), query("ftir_atr", x, gaussian(x, 800.0) + 0.05))
    assert res.abstention is Abstention.LOW_COVERAGE
    assert res.status is Status.NOT_IDENTIFIED
    assert res.candidates == () and res.references == ()
    assert 0.25 < res.coverage < 0.35


def test_identify_technique_mismatch():
    # an FTIR-library shape submitted as Raman
    x, y = clean_curve("ftir_atr", "A")
    res = identify(make_model(), query("raman", x, y))
    assert res.abstention is Abstention.TECHNIQUE_MISMATCH
    assert res.status is Status.NOT_IDENTIFIED
    assert res.other_technique == "ftir_atr" and res.other_technique_score >= 0.99
    # and the opposite way round
    x, y = clean_curve("raman", "A")
    res = identify(make_model(), query("ftir_atr", x, y))
    assert res.abstention is Abstention.TECHNIQUE_MISMATCH and res.other_technique == "raman"


def test_identify_no_guard_for_nm_or_transmittance():
    laser = 532.0
    x, y = clean_curve("ftir_atr", "A")  # FTIR-only shape, declared Raman
    assert identify(make_model(), query("raman", x, y)).other_technique == "ftir_atr"
    nm = 1e7 / (1e7 / laser - x)
    res = identify(make_model(), query("raman", nm, y, x_unit="nm", laser=laser))
    assert res.other_technique is None
    x, y = clean_curve("raman", "A")  # Raman-only shape, declared FTIR
    assert identify(make_model(), query("ftir_atr", x, y)).other_technique == "raman"
    transmittance = 100.0 * 10.0 ** (-y)
    res = identify(make_model(), query("ftir_atr", x, transmittance, y_unit="transmittance_pct"))
    assert res.other_technique is None


def test_identify_disagreement_is_uncertain(monkeypatch):
    x, y = clean_curve("ftir_atr", "B")
    assert identify(make_model(), query("ftir_atr", x, y)).status is Status.IDENTIFIED
    monkeypatch.setattr(model_mod, "svm_predict",
                        lambda p, Z: np.array(["A"] * len(Z)))
    res = identify(make_model(), query("ftir_atr", x, y))
    assert res.status is Status.UNCERTAIN and res.classifier == "A"


def test_reference_curve_follows_licence():
    df = training_frame(make_catalog(), "ftir_atr")
    seen = {}
    for lib in ("mpx", "flopp"):
        row = df[(df["source"] == lib) & (df["polymer"] == "A")].iloc[0]
        res = identify(make_model(), query("ftir_atr", np.array(row["x_raw"]), np.array(row["y_raw"])))
        seen[lib] = res.references[0]
        assert res.references[0].library == lib
    assert seen["mpx"].curve is not None and np.isfinite(seen["mpx"].curve[1]).all()
    assert seen["flopp"].curve is None
    raman = training_frame(make_catalog(), "raman")
    row = raman[(raman["source"] == "slopp") & (raman["polymer"] == "A")].iloc[0]
    res = identify(make_model(), query("raman", np.array(row["x_raw"]), np.array(row["y_raw"])))
    assert res.references[0].library == "slopp" and res.references[0].curve is None


def test_unknown_library_has_no_curve():
    df = training_frame(make_catalog(), "ftir_atr")
    df = df.assign(source=df["source"].replace({"flopp": "mystery"}))
    tm = fit_technique(df, "ftir_atr", make_model().techniques["ftir_atr"].thresholds)
    m = model_mod.SpectralModel("n", "v", {"ftir_atr": tm}, {})
    row = df[df["source"] == "mystery"].iloc[0]
    res = identify(m, query("ftir_atr", np.array(row["x_raw"]), np.array(row["y_raw"])))
    assert res.references[0].library == "mystery" and res.references[0].curve is None


def test_query_curve_is_downsampled():
    for t in ("ftir_atr", "raman"):
        x, y = clean_curve(t, "A")
        res = identify(make_model(), query(t, x, y))
        cx, cy = res.query_curve
        assert len(cx) == len(cy) <= len(GRIDS[t][::2])
        assert np.isfinite(cy).all() and np.isfinite(cx).all()


def test_window_mask_matches_diagnostic_window():
    assert window_mask("raman").sum() == 350 and window_mask("ftir_atr").sum() == 301


def test_invalid_laser_is_rejected():
    x, y = clean_curve("raman", "A")
    with pytest.raises(ValueError):
        identify(make_model(), query("raman", x, y, laser=50.0))
    assert CENTRES and X_RAW.size  # fixtures stay importable
