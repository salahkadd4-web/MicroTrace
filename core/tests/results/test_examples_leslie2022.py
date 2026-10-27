"""The real Leslie et al. 2022 Table S2 (CC BY 4.0) reproduces the article's frequencies."""
from importlib import resources

from microtrace_core.results import DataNature, Matrix, quantification_frequency, read_table, run_import
from microtrace_core.results.examples import (
    LESLIE_2022_DOI,
    LESLIE_2022_FILENAME,
    LESLIE_2022_LICENSE,
    LESLIE_LIMITS,
    leslie_2022_context,
    leslie_2022_csv,
    leslie_2022_mapping,
)


def test_leslie2022_matches_paper():
    table = read_table(leslie_2022_csv(), LESLIE_2022_FILENAME)
    result = run_import(table, leslie_2022_mapping(table), leslie_2022_context())
    errors = [i for i in result.issues if i.severity == "error"]
    assert not errors, [(i.code, i.row) for i in errors]
    wb = Matrix.whole_blood
    freq = {(f.polymer, f.matrix): (f.n_quantified, f.n_samples)
            for f in quantification_frequency(result.records)}
    assert freq == {("PET", wb): (11, 22), ("PS_SUM", wb): (8, 22), ("PE", wb): (5, 22),
                    ("PMMA", wb): (1, 22), ("PP", wb): (0, 22), ("ANY", wb): (17, 22)}


def test_leslie2022_context_is_published():
    ctx = leslie_2022_context()
    assert ctx.data_nature == DataNature.published
    assert ctx.reference_doi == LESLIE_2022_DOI == "10.1016/j.envint.2022.107199"
    assert ctx.reference_license == LESLIE_2022_LICENSE == "CC BY 4.0"
    assert LESLIE_2022_FILENAME == "leslie2022_tableau_S2.csv"
    assert {l.polymer: (l.lod, l.loq) for l in ctx.limits} == LESLIE_LIMITS


def test_leslie2022_csv_shape():
    raw = leslie_2022_csv().decode("utf-8").splitlines()
    assert raw[0] == "Donor;PMMA;PP;PS;PE;PET"
    assert len(raw) - 1 == 40  # 44 aliquot slots - 4 single-aliquot donors
    donors = [r.split(";")[0] for r in raw[1:]]
    for d in (6, 9, 15, 18):
        assert f"{d}a" in donors and f"{d}b" not in donors
    assert "<0.093" in raw[1] and "0.44*" in raw[1]  # verbatim notation


def test_leslie2022_csv_is_packaged_resource():
    res = resources.files("microtrace_core.results").joinpath("data/leslie2022_table_s2.csv")
    assert res.read_bytes() == leslie_2022_csv()
    assert resources.files("microtrace_core.results").joinpath("data/README.md").is_file()
