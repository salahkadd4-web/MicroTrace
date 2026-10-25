import pytest
from microtrace_core.results import (
    leslie_like_context,
    leslie_like_mapping,
    run_import,
)
from microtrace_core.results.examples import leslie_like_wide_table

from microtrace_engine.crossimport import cross_import_issues
from microtrace_engine.schemas import ExistingKeyModel


@pytest.fixture(scope="module")
def records():
    return list(run_import(
        leslie_like_wide_table(), leslie_like_mapping(), leslie_like_context()).records)


def _key(r, **kw):
    d = dict(sample_id=r.sample_id, aliquot=r.aliquot, record_type=r.record_type.value,
             polymer=r.polymer, polymer_raw=r.polymer_raw, method=r.method,
             matrix=r.matrix.value, matrix_detail=r.matrix_detail)
    d.update(kw)
    return ExistingKeyModel(**d)


def test_no_existing_no_issue(records):
    assert cross_import_issues(records, []) == []


def test_duplicates_one_per_record_with_row(records):
    issues = cross_import_issues(records, [_key(r) for r in records])
    dups = [i for i in issues if i.code == "E_DUPLICATE_RECORD"]
    assert len(dups) == len(records)
    assert dups[0].row == records[0].source_row
    assert dups[0].severity == "error"
    assert dups[0].field == "sample_id"
    assert "déjà enregistré dans un import actif de l'étude" in dups[0].message


def test_method_normalised_like_b1(records):
    r = records[0]
    issues = cross_import_issues([r], [_key(r, method="  " + r.method.upper() + " ")])
    assert [i.code for i in issues] == ["E_DUPLICATE_RECORD"]


def test_other_sample_no_issue(records):
    assert cross_import_issues(records, [_key(records[0], sample_id="zzz")]) == []


def test_sample_conflict_once(records):
    same = [r for r in records if r.sample_id == records[0].sample_id]
    assert len(same) > 1
    issues = cross_import_issues(same, [_key(same[0], matrix="plasma", aliquot="zz")])
    assert [i.code for i in issues] == ["E_SAMPLE_CONFLICT"]
    assert issues[0].severity == "error"


def test_record_type_conflict(records):
    r = records[0]
    other = "field_blank" if r.record_type.value != "field_blank" else "sample"
    issues = cross_import_issues([r], [_key(r, record_type=other, aliquot="zz")])
    assert [i.code for i in issues] == ["E_SAMPLE_CONFLICT"]


def test_same_sample_other_polymer_or_method_no_collision(records):
    r = records[0]
    assert cross_import_issues([r], [_key(r, polymer="ZZ", polymer_raw="ZZ")]) == []
    assert cross_import_issues([r], [_key(r, method="Autre méthode")]) == []


def test_qc_record_duplicate_and_conflict(records):
    from dataclasses import replace

    from microtrace_core.results.vocab import RecordType

    qc = replace(records[0], sample_id="BLK1", record_type=RecordType.procedural_blank)
    dup = cross_import_issues([qc], [_key(qc)])
    assert [i.code for i in dup] == ["E_DUPLICATE_RECORD"]
    conflict = cross_import_issues([qc], [_key(qc, matrix="plasma", aliquot="zz")])
    assert [i.code for i in conflict] == ["E_SAMPLE_CONFLICT"]
    typ = cross_import_issues([qc], [_key(qc, record_type="sample", aliquot="zz")])
    assert [i.code for i in typ] == ["E_SAMPLE_CONFLICT"]


def test_other_polymer_path(records):
    from dataclasses import replace

    foo = replace(records[0], polymer="OTHER", polymer_raw="polyfoo")
    bar = replace(records[0], polymer="OTHER", polymer_raw="polybar")
    ex = [_key(foo)]
    assert [i.code for i in cross_import_issues([foo], ex)] == ["E_DUPLICATE_RECORD"]
    assert cross_import_issues([bar], ex) == []


def test_other_polymer_without_raw_rejected():
    with pytest.raises(ValueError):
        ExistingKeyModel(sample_id="1", record_type="sample", polymer="OTHER",
                         method="m", matrix="plasma")
