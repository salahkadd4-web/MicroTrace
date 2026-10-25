import argparse
from pathlib import Path

import uvicorn

from .app import create_app, openapi_json
from .settings import load_settings


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m microtrace_engine")
    parser.add_argument("--dump-openapi", metavar="PATH",
                        help="écrire le schéma OpenAPI dans PATH, sans démarrer le serveur")
    args = parser.parse_args(argv)
    if args.dump_openapi:
        Path(args.dump_openapi).write_text(openapi_json(), encoding="utf-8", newline="\n")
        return
    settings = load_settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
