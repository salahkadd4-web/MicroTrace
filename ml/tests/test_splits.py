import numpy as np
import pandas as pd

from microtrace_ml.splits import group_kfold, leave_one_source_out, pristine_to_aged


def _df():
    rows = []
    for i in range(30):
        rows.append(
            {
                "source": "SRC_" + "ABC"[i % 3],
                "polymer": ["PE", "PP", "PS"][i % 3],
                "sample_group": f"g{i // 3}",
                "state": ["pristine", "weathered", "biofouled"][(i // 3) % 3],
            }
        )
    return pd.DataFrame(rows)


def test_group_kfold_no_group_leak():
    df = _df()
    groups = df["sample_group"].to_numpy()
    n = 0
    for train, test in group_kfold(df, n_splits=3, seed=0):
        assert set(groups[train]) & set(groups[test]) == set()
        assert len(set(train) & set(test)) == 0
        n += 1
    assert n == 3


def test_leave_one_source_out_holds_each_source_once():
    df = _df()
    out = list(leave_one_source_out(df))
    assert len(out) == 3
    assert {s for s, _, _ in out} == {"SRC_A", "SRC_B", "SRC_C"}
    for held, train, test in out:
        assert (df["source"].to_numpy()[test] == held).all()
        assert (df["source"].to_numpy()[train] != held).all()
        assert len(train) + len(test) == len(df)


def test_pristine_to_aged_split():
    df = _df()
    train, test = pristine_to_aged(df)
    state = df["state"].to_numpy()
    assert len(train) > 0 and len(test) > 0
    assert (state[train] == "pristine").all()
    assert not np.isin(state[test], ["pristine"]).any()
    assert set(state[test]) == {"weathered", "biofouled"}
