from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from urllib.error import HTTPError, URLError
from ipaddress import ip_address
import json
import re


ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 5173
OPERATOR_ORIGIN = 'http://127.0.0.1:7862'
MAX_BODY = 1024 * 1024


def allowed_scene_request(method: str, path: str) -> bool:
    """Fixed local upstream and explicitly supported configuration contracts."""
    pathname = urlparse(path).path
    voice_endpoints = {
        'GET': {'/api/v1/ui/scenes', '/api/v1/ui/runtime', '/api/v1/scenes', '/api/v1/settings/voice-activation'},
        'PATCH': {'/api/v1/scenes/voice-pipeline', '/api/v1/settings/voice-activation'},
        'POST': {'/api/v1/backend_config'},
    }
    if pathname in voice_endpoints.get(method, set()):
        return True
    device_endpoints = {
        'GET': {'/api/v1/status', '/api/v1/daemon/volume', '/api/v1/daemon/volume/microphone', '/api/v1/daemon/audio/xvf_microphone_gain', '/api/v1/idle_breathing', '/api/v1/sound-localization/settings', '/api/v1/ambient-vision/observations'},
        'POST': {'/api/v1/daemon/volume', '/api/v1/daemon/volume/microphone', '/api/v1/daemon/audio/xvf_microphone_gain', '/api/v1/idle_breathing'},
        'PATCH': {'/api/v1/sound-localization/settings', '/api/v1/ambient-vision/settings'},
        'DELETE': {'/api/v1/sound-localization/settings', '/api/v1/ambient-vision/observations'},
    }
    if pathname in device_endpoints.get(method, set()):
        return True
    if method == 'GET':
        return bool(re.fullmatch(r'/api/v1/ui/scenes/[a-zA-Z0-9_-]+', pathname))
    if method == 'POST':
        return pathname == '/api/v1/ui/scenes' or bool(re.fullmatch(r'/api/v1/scenes/[a-zA-Z0-9_-]+/publish', pathname))
    return method in ('PUT', 'DELETE') and bool(re.fullmatch(r'/api/v1/scenes/[a-zA-Z0-9_-]+', pathname))


def allowed_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return False
    if parsed.hostname == 'localhost':
        return True
    try:
        address = ip_address(parsed.hostname)
        return address.is_loopback or address.is_private
    except ValueError:
        return False


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SPARequestHandler(SimpleHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def scene_response(self, status: int, body: bytes):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        origin = self.headers.get('Origin', '')
        if allowed_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept')
        self.end_headers()
        self.wfile.write(body)

    def scene_proxy(self):
        path = self.path.removeprefix('/operator-api')
        origin = self.headers.get('Origin', '')
        if (origin and not allowed_origin(origin)) or not allowed_scene_request(self.command, path):
            self.scene_response(403, b'{"ok":false,"error":"scene_endpoint_not_allowed"}')
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > MAX_BODY or self.headers.get('Transfer-Encoding'):
                self.scene_response(413, b'{"ok":false,"error":"request_too_large"}')
                return
            body = self.rfile.read(length) if length else None
            request = Request(OPERATOR_ORIGIN + path, data=body, method=self.command, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
            opener = build_opener(ProxyHandler({}), NoRedirect)
            try:
                response = opener.open(request, timeout=7)
            except HTTPError as error:
                response = error
            with response:
                payload = response.read(MAX_BODY + 1)
                if len(payload) > MAX_BODY:
                    raise ValueError('response_too_large')
                json.loads(payload)
                self.scene_response(response.code, payload)
        except (ValueError, URLError, TimeoutError, OSError):
            self.scene_response(502, b'{"ok":false,"error":"scene_service_unavailable"}')

    def do_GET(self):
        if self.path.startswith('/operator-api/'):
            self.scene_proxy()
        else:
            super().do_GET()

    def do_OPTIONS(self):
        path = self.path.removeprefix('/operator-api')
        method = self.headers.get('Access-Control-Request-Method', '')
        if self.path.startswith('/operator-api/') and allowed_origin(self.headers.get('Origin', '')) and allowed_scene_request(method, path):
            self.scene_response(200, b'{}')
        else:
            self.scene_response(403, b'{"ok":false}')

    def do_POST(self):
        if self.path.startswith('/operator-api/'):
            self.scene_proxy()
        else:
            self.scene_response(404, b'{"ok":false}')

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        asset = urlparse(self.path).path.startswith('/assets/')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable' if asset else 'no-store')
        super().end_headers()

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
