"""Command line entry point: python -m microtrace_ml baseline ..."""

from __future__ import annotations

import argparse
from pathlib import Path

from microtrace_ml.evaluate import run_baseline


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="microtrace_ml")
    sub = parser.add_subparsers(dest="command", required=True)
    bl = sub.add_parser("baseline", help="evaluate the baseline methods and write a report")
    bl.add_argument("--catalog", type=Path, required=True)
    bl.add_argument("--out", type=Path, required=True)
    bl.add_argument("--threshold", type=float, default=0.7)
    args = parser.parse_args(argv)
    run_baseline(args.catalog, args.out, threshold=args.threshold)
    print(f"wrote {args.out / 'metrics.json'} and {args.out / 'report.md'}")
    return 0
