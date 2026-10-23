import numpy as np
import pytest

from microtrace_core.spectrum import Spectrum


def make(**overrides):
    kwargs = dict(
        spectrum_id="s1", source="test", technique="ftir_atr",
        x=list(range(20)), y=list(range(20)), x_unit="cm-1", y_unit="absorbance",
        polymer="PE", polymer_raw="polyethylene", state="pristine",
        sample_group="g1", file="a/b.csv",
    )
    kwargs.update(overrides)
    if kwargs["technique"] == "raman" and "y_unit" not in overrides:
        kwargs["y_unit"] = "intensity"
    return Spectrum(**kwargs)


def test_valid_spectrum_converts_to_float64_arrays():
    s = make()
    assert s.x.dtype == np.float64 and s.y.dtype == np.float64
    assert s.laser_nm is None and s.label_note == "" and s.extra == {}


def test_extra_is_not_shared_between_instances():
    assert make().extra is not make().extra


def test_length_mismatch():
    with pytest.raises(ValueError):
        make(y=list(range(19)))


def test_too_short():
    with pytest.raises(ValueError):
        make(x=list(range(9)), y=list(range(9)))


def test_bad_technique():
    with pytest.raises(ValueError):
        make(technique="nir")


def test_bad_state():
    with pytest.raises(ValueError):
        make(state="burnt")


def test_raman_nm_requires_laser():
    with pytest.raises(ValueError):
        make(technique="raman", x_unit="nm")
    assert make(technique="raman", x_unit="nm", laser_nm=532.0).laser_nm == 532.0


def test_y_unit_defaults_and_validation():
    assert make(technique="raman", y_unit="intensity").y_unit == "intensity"
    assert make(y_unit="transmittance_pct").y_unit == "transmittance_pct"
    with pytest.raises(ValueError):
        make(y_unit="intensity")  # ftir_atr needs absorbance or transmittance
    with pytest.raises(ValueError):
        make(technique="raman", y_unit="absorbance")
    with pytest.raises(ValueError):
        make(y_unit="bogus")
