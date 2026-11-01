"""Command line entry point: python -m microtrace_core build-catalog ..."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from microtrace_core.catalog import build_catalog


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="microtrace_core")
    sub = parser.add_subparsers(dest="command", required=True)
    bc = sub.add_parser("build-catalog", help="build the Parquet spectral catalogue")
    bc.add_argument("--datasets", type=Path, required=True)
    bc.add_argument("--out", type=Path, required=True)
    ts = sub.add_parser("train-spectral", help="train and evaluate the spectral model s1")
    ts.add_argument("--catalog", type=Path, required=True)
    ts.add_argument("--baseline", type=Path, required=True)
    ts.add_argument("--models", type=Path, required=True)
    ts.add_argument("--manifest", type=Path, required=True)
    ts.add_argument("--data-list", type=Path, required=True)
    ts.add_argument("--lock", type=Path, required=True)
    ts.add_argument("--card", type=Path, default=None)
    ts.add_argument("--check", action="store_true",
                    help="retrain in memory and compare the weights hash to the manifest")
    ti = sub.add_parser("train-image", help="train and evaluate the image model i1")
    ti.add_argument("--dataset", type=Path, required=True)
    ti.add_argument("--models", type=Path, required=True)
    ti.add_argument("--manifest", type=Path, required=True)
    ti.add_argument("--data-list", type=Path, required=True)
    ti.add_argument("--lock", type=Path, required=True)
    ti.add_argument("--card", type=Path, default=None)
    ti.add_argument("--expected-images", type=int, default=None,
                    help="number of photos the index must hold (default: the 237 of dataset3)")
    ti.add_argument("--check", action="store_true",
                    help="retrain in memory and compare the weights hash to the manifest")
    ie = sub.add_parser("image-eval", help="score polygon predictions with the image evaluator")
    ie.add_argument("--dataset", type=Path, required=True)
    ie.add_argument("--predictions", type=Path, required=True,
                    help="JSON: image path (relative to the dataset) -> list of polygons")
    ie.add_argument("--split", choices=("train", "val", "test"), default="test")
    ie.add_argument("--min-area-frac", type=float, default=0.005)
    args = parser.parse_args(argv)
    if args.command == "train-image":
        from microtrace_core.imaging.train import EXPECTED_IMAGES, run_training  # scikit-learn

        return run_training(
            dataset=args.dataset, models_dir=args.models, manifest=args.manifest,
            data_list=args.data_list, lock=args.lock, card=args.card, check=args.check,
            expected_images=EXPECTED_IMAGES if args.expected_images is None
            else args.expected_images)
    if args.command == "image-eval":
        from microtrace_core.imaging.dataset import build_index
        from microtrace_core.imaging.evaluate import evaluate_polygons

        preds = json.loads(Path(args.predictions).read_text(encoding="utf-8"))
        items = [i for i in build_index(args.dataset) if i.split == args.split]
        result = evaluate_polygons(args.dataset, items, preds, min_area_frac=args.min_area_frac)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    if args.command == "train-spectral":
        from microtrace_core.spectral.train import run_training  # imports scikit-learn

        return run_training(
            catalog=args.catalog, baseline=args.baseline, models_dir=args.models,
            manifest=args.manifest, data_list=args.data_list, lock=args.lock,
            card=args.card, check=args.check)
    meta = build_catalog(args.datasets, args.out)
    print(json.dumps(meta["counts"], indent=2))
    return 0
