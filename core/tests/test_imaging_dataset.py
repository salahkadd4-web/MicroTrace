"""dataset3 index, scales, counts, groups and the fixed split (miniature dataset)."""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pytest

from microtrace_core.imaging.dataset import (
    SUBSETS,
    Item,
    assign_groups,
    build_index,
    read_counts,
    split_of,
)

from imaging_fixtures import SUBSET_SPECS, mini_scale, write_mini_dataset


@pytest.fixture(scope="module")
def root(tmp_path_factory) -> Path:
    return write_mini_dataset(tmp_path_factory.mktemp("dataset3"))


def test_subsets_mapping():
    assert set(SUBSETS) == {"bead", "fibre_1", "fibre_2", "fragment_1", "fragment_2"}
    assert SUBSETS["bead"] == ("bead/bead", "bead/original_image_bead", "bille")
    assert SUBSETS["fibre_2"] == ("fibre/fibre_2", "fibre/original_image_fibre_2", "fibre")
    assert SUBSETS["fragment_2"][2] == "fragment"


def test_build_index_on_fixture(root):
    items = build_index(root)
    assert len(items) == 18
    assert [i.image for i in items] == sorted(i.image for i in items)
    assert {i.subset for i in items} == set(SUBSET_SPECS)
    for i in items:
        rel = i.image.relative_to(root).as_posix()
        assert "crop" not in rel and "label_index" not in rel
        assert i.label.exists() and i.label.parent.name == "label" and i.label.name == i.image.name
        assert i.shape == SUBSET_SPECS[i.subset][2]
        assert i.split in {"train", "val", "test"}
    assert {i.split for i in items} == {"train", "val", "test"}

    scaled = [i for i in items if i.um_per_px is not None]
    assert len(scaled) == 17  # one photo has no TIFF
    for i in scaled:
        n = int(re.search(r"(\d+)\.png$", i.image.name).group(1))
        assert i.tiff is not None and i.um_per_px == pytest.approx(mini_scale(n))
    (unscaled,) = [i for i in items if i.um_per_px is None]
    assert unscaled.tiff is None

    counted = [i for i in items if i.count is not None]
    assert len(counted) == 17  # one photo has no counts line
    assert all(1 <= i.count <= 2 for i in counted)


def test_index_never_reads_the_acquisition_sidecars(root, monkeypatch):
    opened = []
    real_open = Path.open
    real_read_text = Path.read_text

    def spy_open(self, *a, **k):
        opened.append(self.name)
        return real_open(self, *a, **k)

    def spy_read_text(self, *a, **k):
        opened.append(self.name)
        return real_read_text(self, *a, **k)

    monkeypatch.setattr(Path, "open", spy_open)
    monkeypatch.setattr(Path, "read_text", spy_read_text)
    items = build_index(root)
    assert len(items) == 18
    blob = repr(items)
    assert "Dupont" not in blob and "PC-SEM" not in blob
    # the only text files the index may open are the counts files, never the sidecars
    texts = {n for n in opened if n.endswith(".txt")}
    assert texts == {spec[5] for spec in SUBSET_SPECS.values()}


def test_read_counts_tolerates_tabs_spaces_and_missing_final_newline(tmp_path):
    f = tmp_path / "counts.txt"
    f.write_bytes(b"a.png\t2 \r\nb c.png\t1\t\n\nbad line\nd.png \t 12")
    assert read_counts(f) == {"a.png": 2, "b c.png": 1, "d.png": 12}


def test_groups_and_split(root):
    rng = np.random.default_rng(0)
    items = build_index(root)
    thumbs = rng.normal(size=(len(items), 48, 64))
    # two near-identical photos (1 % noise) land in one group
    thumbs[5] = thumbs[2] + 0.01 * rng.normal(size=(48, 64))
    groups = assign_groups(items, thumbs)
    assert len(groups) == len(items) and groups[2] == groups[5]
    assert len(set(groups)) == len(items) - 1
    assert all(groups[k] != groups[2] for k in range(len(items)) if k not in (2, 5))

    # fibre_2: PAN_01 at three voltages is one field
    def mk(name):
        p = Path(f"fibre/fibre_2/image/{name}")
        return Item("fibre_2", "fibre", p, p, None, None, None, "", "")

    f2 = [mk("PAN_01_2kV.png"), mk("PAN_01_3kV.png"), mk("PAN_01_2.5kV_20201119.png"),
          mk("PE_03_3kV.png"), mk("p12polyester_fibre.png")]
    g = assign_groups(f2, rng.normal(size=(5, 48, 64)))
    assert g[0] == g[1] == g[2] and len({g[0], g[3], g[4]}) == 3

    # the split is a function of the group only: nothing is on two sides
    side = {}
    for item in items:
        side.setdefault(item.group, set()).add(item.split)
    assert all(len(s) == 1 for s in side.values())
    assert all(item.split == split_of(item.group) for item in items)


def test_split_of_is_stable():
    assert split_of("bead/bead/image/x.png") == "val"
    sides = {split_of(f"k{i}") for i in range(200)}
    assert sides == {"train", "val", "test"}
    n = 4000
    share = {s: sum(split_of(f"g{i}") == s for i in range(n)) / n for s in ("train", "val", "test")}
    assert share["test"] == pytest.approx(0.2, abs=0.03)
    assert share["val"] == pytest.approx(0.2, abs=0.03)
