"""PCA + RBF-SVM baseline classifier."""

from __future__ import annotations

from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.svm import SVC


def make_pca_svm(n_components: int = 30, *, random_state: int = 0) -> Pipeline:
    """NaN -> 0, PCA, then a class-balanced RBF SVM."""
    return Pipeline(
        [
            # keep_empty_features: all-NaN grid columns stay (as 0) so features stay aligned
            ("impute", SimpleImputer(strategy="constant", fill_value=0.0,
                                     keep_empty_features=True)),
            ("pca", PCA(n_components=n_components, random_state=random_state)),
            ("svm", SVC(kernel="rbf", class_weight="balanced", random_state=random_state)),
        ]
    )
