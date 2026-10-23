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
    args = parser.parse_args(argv)
    meta = build_catalog(args.datasets, args.out)
    print(json.dumps(meta["counts"], indent=2))
    return 0
