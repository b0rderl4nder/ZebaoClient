"""Local-only scene transport tests; no robot or real device writes."""
import importlib.util
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.client import HTTPConnection
import unittest

spec = importlib.util.spec_from_file_location('client_server', Path(__file__).resolve().parents[2] / 'serve_spa.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class Upstream(BaseHTTPRequestHandler):
    calls = []
    code = 200

    def do_GET(self):
        payload = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.calls.append((self.command, self.path, payload))
        self.send_response(self.code)
        self.end_headers()
        self.wfile.write(json.dumps({'ok': self.code == 200}).encode())

    do_POST = do_GET
    do_PUT = do_GET
    do_PATCH = do_GET
    do_DELETE = do_GET

    def log_message(self, *args):
        pass


class QuietHandler(server.SPARequestHandler):
    def log_message(self, *args):
        pass


class SceneProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        server.OPERATOR_ORIGIN = f'http://127.0.0.1:{cls.upstream.server_port}'
        cls.proxy = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.threads = [Thread(target=item.serve_forever, daemon=True) for item in (cls.upstream, cls.proxy)]
        for thread in cls.threads:
            thread.start()

    @classmethod
    def tearDownClass(cls):
        for item in (cls.upstream, cls.proxy):
            item.shutdown()
            item.server_close()
        for thread in cls.threads:
            thread.join()

    def setUp(self):
        Upstream.calls.clear()
        Upstream.code = 200

    def request(self, path, method='GET', body=None, headers=None):
        request = Request(f'http://127.0.0.1:{self.proxy.server_port}/operator-api{path}', method=method, data=body, headers=headers or {})
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_get_and_save_preserve_original_contract(self):
        for method, path, data in [('GET', '/api/v1/ui/scenes/custom', None), ('PUT', '/api/v1/scenes/custom', b'{"name":"test"}'), ('POST', '/api/v1/scenes/custom/publish', None), ('DELETE', '/api/v1/scenes/custom?replacement_scene_id=next', None)]:
            code, _, _ = self.request(path, method, data)
            self.assertEqual(code, 200)
            self.assertEqual(Upstream.calls[-1], (method, path, data or b''))

    def test_only_scene_endpoints_and_no_arbitrary_upstream(self):
        for path in ['/api/v1/settings', '/api/move/goto', '//example.com', '/api/v1/scenes/../../settings', '/api/v1/scenes/foo%2fbar']:
            self.assertEqual(self.request(path, 'PUT', b'{}')[0], 403)
        self.assertFalse(Upstream.calls)

    def test_browser_origin_and_preflight(self):
        headers = {'Origin': 'http://192.168.3.83:5173', 'Access-Control-Request-Method': 'PUT'}
        code, reply, _ = self.request('/api/v1/scenes/test', 'OPTIONS', headers=headers)
        self.assertEqual(code, 200)
        self.assertEqual(reply['Access-Control-Allow-Origin'], headers['Origin'])
        self.assertEqual(self.request('/api/v1/ui/scenes/test', headers={'Origin': 'https://untrusted.example'})[0], 403)
        self.assertFalse(Upstream.calls)

    def test_failure_is_not_success(self):
        Upstream.code = 409
        code, _, payload = self.request('/api/v1/scenes/custom', 'PUT', b'{}')
        self.assertEqual(code, 409)
        self.assertFalse(json.loads(payload)['ok'])

    def test_size_is_bounded(self):
        connection = HTTPConnection('127.0.0.1', self.proxy.server_port, timeout=3)
        connection.putrequest('PUT', '/operator-api/api/v1/scenes/custom')
        connection.putheader('Content-Length', str(server.MAX_BODY + 1))
        connection.endheaders()
        self.assertEqual(connection.getresponse().status, 413)
        connection.close()
        self.assertFalse(Upstream.calls)

    def test_native_voice_contracts_only(self):
        for method, path in [('GET', '/api/v1/scenes'), ('GET', '/api/v1/ui/runtime'), ('GET', '/api/v1/ui/scenes'), ('GET', '/api/v1/settings/voice-activation'), ('PATCH', '/api/v1/settings/voice-activation'), ('PATCH', '/api/v1/scenes/voice-pipeline'), ('POST', '/api/v1/backend_config')]:
            data = b'{}' if method != 'GET' else None
            self.assertEqual(self.request(path, method, data)[0], 200)
            self.assertEqual(Upstream.calls[-1], (method, path, data or b''))
        self.assertEqual(self.request('/api/v1/backend_config', 'GET')[0], 403)
        self.assertEqual(self.request('/api/v1/settings', 'PATCH', b'{}')[0], 403)

    def test_device_settings_contracts_only(self):
        endpoints = {
            'GET': ['status', 'daemon/volume', 'daemon/volume/microphone', 'daemon/audio/xvf_microphone_gain', 'idle_breathing', 'sound-localization/settings', 'ambient-vision/observations'],
            'POST': ['daemon/volume', 'daemon/volume/microphone', 'daemon/audio/xvf_microphone_gain', 'idle_breathing'],
            'PATCH': ['sound-localization/settings', 'ambient-vision/settings'],
            'DELETE': ['sound-localization/settings', 'ambient-vision/observations'],
        }
        for method, paths in endpoints.items():
            for path in paths:
                data = b'{}' if method != 'GET' else None
                full = '/api/v1/' + path
                self.assertEqual(self.request(full, method, data)[0], 200)
                self.assertEqual(Upstream.calls[-1], (method, full, data or b''))
        for path in ['daemon/move', 'daemon/audio/config/apply', 'debug/mic_capture_asr', 'status']:
            self.assertEqual(self.request('/api/v1/' + path, 'POST', b'{}')[0], 403)


if __name__ == '__main__':
    unittest.main()
