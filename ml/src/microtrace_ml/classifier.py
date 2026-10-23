"""PCA + RBF-SVM baseline classifier."""

from __future__ import annotations

from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.svm import SVC


def make_pca_svm(n_components: int = 30) -> Pipeline:
    """NaN -> 0, PCA, then a class-balanced RBF SVM."""
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="constant", fill_value=0.0)),
            ("pca", PCA(n_components=n_components)),
            ("svm", SVC(kernel="rbf", class_weight="balanced")),
        ]
    )
