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
    args = parser.parse_args(argv)
    if args.command == "train-spectral":
        from microtrace_core.spectral.train import run_training  # imports scikit-learn

        return run_training(
            catalog=args.catalog, baseline=args.baseline, models_dir=args.models,
            manifest=args.manifest, data_list=args.data_list, lock=args.lock,
            card=args.card, check=args.check)
    meta = build_catalog(args.datasets, args.out)
    print(json.dumps(meta["counts"], indent=2))
    return 0
