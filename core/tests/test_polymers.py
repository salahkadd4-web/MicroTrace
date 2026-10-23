import pytest

from microtrace_core.polymers import CANONICAL, OTHER, UNKNOWN, normalize_polymer


@pytest.mark.parametrize("raw,expected", [
    ("polyethylene", "PE"), ("LDPE", "PE"), ("HDPE", "PE"), ("Oxidized PE", "PE"),
    ("(09) PET", "PET"), ("(insitu 01) PE", "PE"), ("polyester", "PET"),
    ("Polyamide", "PA"), ("nylon", "PA"), ("polyamine (nylon)", "PA"),
    ("poly (methyl methacrylate)", "PMMA"), ("Polymethyl Methacrylate", "PMMA"),
    ("Acrylonitrile Butadiene Styrene", "ABS"), ("polytetrafluoroethylene", "PTFE"),
    ("polyoxymethylene", "POM"), ("silicone", "SILICONE"),
    ("Polyethylene Vinyl Acetate", "EVA"), ("PEVA", "EVA"),
    ("Acrylic", "ACRYLIC"), ("Cellulose Acetate", "CA"),
    ("Cotton", "CELLULOSE"), ("Dyed Cellulose", "CELLULOSE"),
    ("Rubber", "RUBBER"), ("NC", "NC"), ("PLA", "PLA"),
])
def test_normalize_polymer_aliases(raw, expected):
    assert normalize_polymer(raw) == expected


@pytest.mark.parametrize("code", sorted(CANONICAL))
def test_normalize_polymer_canonical_is_identity(code):
    assert normalize_polymer(code) == code


@pytest.mark.parametrize("raw", [None, "", "  ", "/", "None"])
def test_normalize_polymer_unknown(raw):
    assert normalize_polymer(raw) == UNKNOWN


def test_normalize_polymer_unmapped_is_other():
    assert normalize_polymer("Polysulfone") == OTHER
    assert normalize_polymer("Polyethylene-co-Polypropylene") == OTHER
