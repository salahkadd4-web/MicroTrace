"""The packaged fictitious Leslie-like dataset reproduces the article's shape (simulated data)."""
import pytest

from microtrace_core.results import DataNature, Matrix, describe, quantification_frequency, read_table, run_import
from microtrace_core.results.examples import (
    LESLIE_LIKE_FILENAME,
    leslie_like_context,
    leslie_like_csv,
    leslie_like_mapping,
)


def test_examples_reproduce_article():
    table = read_table(leslie_like_csv(), LESLIE_LIKE_FILENAME)
    result = run_import(table, leslie_like_mapping(), leslie_like_context())
    assert not result.has_errors
    wb = Matrix.whole_blood
    freq = {(f.polymer, f.matrix): (f.n_quantified, f.n_samples)
            for f in quantification_frequency(result.records)}
    assert freq == {("PET", wb): (11, 22), ("PS_SUM", wb): (8, 22), ("PE", wb): (5, 22),
                    ("PMMA", wb): (1, 22), ("PP", wb): (0, 22), ("ANY", wb): (17, 22)}
    stats = {s.polymer: s for s in describe(result.records)}
    assert stats["PET"].max_measurement == pytest.approx(2.4)
    assert stats["PS_SUM"].max_measurement == pytest.approx(4.8)
    assert stats["PE"].max_measurement == pytest.approx(7.1)
    assert leslie_like_context().data_nature == DataNature.simulated
    assert isinstance(leslie_like_csv(), bytes) and LESLIE_LIKE_FILENAME == "exemple_fictif_leslie2022.csv"


# golden hash: any change to the packaged example is deliberate (update this constant)
LESLIE_LIKE_SHA256 = "166b9931bed8eea89bf5b4d939ede861c49765beae64b56beeb2aef7916e3d9e"


def test_leslie_like_csv_golden_hash():
    import hashlib

    assert hashlib.sha256(leslie_like_csv()).hexdigest() == LESLIE_LIKE_SHA256
