from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 5173


class SPARequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        clean_path = unquote(parsed.path).lstrip("/")
        candidate = (ROOT / clean_path).resolve()

        try:
            candidate.relative_to(ROOT)
        except ValueError:
            return str(ROOT / "index.html")

        if candidate.exists():
            return str(candidate)
        if Path(clean_path).suffix:
            return str(candidate)
        return str(ROOT / "index.html")


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), SPARequestHandler)
    print(f"Serving exhibition control SPA on http://{HOST}:{PORT} from {ROOT}", flush=True)
    server.serve_forever()
