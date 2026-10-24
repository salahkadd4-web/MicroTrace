import warnings

import numpy as np

from microtrace_ml.classifier import make_pca_svm


def test_pca_svm_keeps_all_nan_columns_without_warning():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(20, 6))
    X[:, 2] = np.nan  # a grid point never covered by the training spectra
    y = np.array(["PE", "PP"] * 10)
    model = make_pca_svm(n_components=3)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        model.fit(X, y)
        pred = model.predict(rng.normal(size=(4, 6)))
    assert model.named_steps["impute"].transform(X).shape == (20, 6)
    assert len(pred) == 4
