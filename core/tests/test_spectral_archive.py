from __future__ import annotations

import io
import zipfile

import numpy as np
import pytest
from spectral_fixtures import clean_curve, make_model

from microtrace_core.spectral.archive import (
    FIXED_DATE,
    load_model_bytes,
    model_from_arrays,
    model_to_arrays,
    read_archive,
    write_archive,
)
from microtrace_core.spectral.model import SpectralQuery, identify


def test_archive_is_byte_deterministic(tmp_path):
    arrays = model_to_arrays(make_model())
    sha1 = write_archive(tmp_path / "a.npz", arrays)
    sha2 = write_archive(tmp_path / "b.npz", dict(reversed(list(arrays.items()))))
    assert sha1 == sha2
    assert (tmp_path / "a.npz").read_bytes() == (tmp_path / "b.npz").read_bytes()
    with zipfile.ZipFile(tmp_path / "a.npz") as zf:
        assert [i.filename for i in zf.infolist()] == sorted(i.filename for i in zf.infolist())
        assert all(i.date_time == FIXED_DATE for i in zf.infolist())


def test_archive_rejects_object_arrays(tmp_path):
    with pytest.raises(ValueError):
        write_archive(tmp_path / "x.npz", {"a": np.array([{"k": 1}], dtype=object)})
    assert not (tmp_path / "x.npz").exists()


def test_archive_holds_no_pickle(tmp_path):
    write_archive(tmp_path / "m.npz", model_to_arrays(make_model()))
    data = (tmp_path / "m.npz").read_bytes()
    assert read_archive(data)  # allow_pickle=False would raise on any object array


def test_model_roundtrip(tmp_path):
    model = make_model()
    write_archive(tmp_path / "m.npz", model_to_arrays(model))
    loaded = load_model_bytes((tmp_path / "m.npz").read_bytes())
    x, y = clean_curve("ftir_atr", "B")
    q = SpectralQuery(x, y, "ftir_atr", "cm-1", "absorbance", None)
    a, b = identify(model, q), identify(loaded, q)
    assert (a.status, a.abstention, a.coverage, a.candidates, a.margin, a.classifier) == (
        b.status, b.abstention, b.coverage, b.candidates, b.margin, b.classifier)
    assert [(r.spectrum_id, r.library, r.score) for r in a.references] == [
        (r.spectrum_id, r.library, r.score) for r in b.references]
    assert np.array_equal(a.query_curve[1], b.query_curve[1])
    assert a.thresholds == b.thresholds


def test_invalid_archive(tmp_path):
    arrays = model_to_arrays(make_model())
    for key in ("raman/refs", "ftir_atr/svm_gamma", "meta"):
        broken = {k: v for k, v in arrays.items() if k != key}
        write_archive(tmp_path / "b.npz", broken)
        with pytest.raises(ValueError, match="^invalid model archive"):
            load_model_bytes((tmp_path / "b.npz").read_bytes())
    with pytest.raises(ValueError, match="^invalid model archive"):
        load_model_bytes(b"not an archive")
    buf = io.BytesIO()
    np.savez(buf, a=np.array([{"x": 1}], dtype=object), allow_pickle=True)
    with pytest.raises(ValueError, match="^invalid model archive"):
        load_model_bytes(buf.getvalue())


@pytest.mark.parametrize("key,bad", [
    ("ftir_atr/svm_dual_coef", lambda a: a[:, :-1]),
    ("ftir_atr/svm_intercept", lambda a: a[:-1]),
    ("ftir_atr/svm_n_support", lambda a: a[:-1]),
    ("ftir_atr/plot_x", lambda a: a[:-1]),
    ("ftir_atr/svm_gamma", lambda a: np.asarray(float("nan"))),
    ("ftir_atr/svm_gamma", lambda a: np.asarray(0.0)),
])
def test_inconsistent_archive_is_invalid(key, bad):
    arrays = model_to_arrays(make_model())
    arrays[key] = bad(arrays[key])
    with pytest.raises(ValueError, match="^invalid model archive"):
        model_from_arrays(arrays)
