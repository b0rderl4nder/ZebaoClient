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


class EmbodiedConfigurationBoundary(unittest.TestCase):
    def test_policy_editor_has_no_scene_execution_shortcuts(self):
        self.assertTrue(server.allowed_scene_request('GET', '/api/v1/ui/interaction-policies'))
        for method in ('PUT', 'DELETE'):
            self.assertTrue(server.allowed_scene_request(method, '/api/v1/interaction-policies/custom_rule'))
        self.assertFalse(server.allowed_scene_request('POST', '/api/v1/interaction-policies/custom_rule'))
        self.assertFalse(server.allowed_scene_request('PUT', '/api/v1/interaction-policies/custom_rule/activate'))
        self.assertFalse(server.allowed_scene_request('DELETE', '/api/v1/ui/interaction-policies'))

    def test_only_existing_settings_methods_are_exposed(self):
        for method in ('GET', 'PATCH'):
            self.assertTrue(server.allowed_scene_request(method, '/api/v1/embodied-interaction'))
        for method in ('POST', 'DELETE', 'PUT'):
            self.assertFalse(server.allowed_scene_request(method, '/api/v1/embodied-interaction'))
        self.assertFalse(server.allowed_scene_request('POST', '/api/v1/embodied-interaction/action'))


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

    def test_diagnostics_only_exposes_read_and_explicit_log_clear(self):
        for path in ['/api/v1/operations/logs?limit=50&category=service', '/api/v1/acceptance/runs', '/api/v1/debug/diagnostic_snapshot?limit=10']:
            self.assertEqual(self.request(path)[0], 200)
            self.assertEqual(self.request(path, 'POST')[0], 403)
        self.assertEqual(self.request('/api/v1/operations/logs?all_entries=true', 'DELETE')[0], 200)
        for path in ['/api/v1/operations/logs', '/api/v1/operations/logs?all_entries=false', '/api/v1/acceptance/runs']:
            self.assertEqual(self.request(path, 'DELETE')[0], 403)

    def test_provider_config_cannot_activate_or_write_other_providers(self):
        for provider in ['local_omni', 'platform_ws', 'cloud_omni', 'aliyun_native_omni']:
            path = '/api/v1/settings/voice-connections/' + provider
            self.assertEqual(self.request(path)[0], 200)
            self.assertEqual(self.request(path, 'PATCH', b'{"revision":"r","values":{}}')[0], 200)
            self.assertEqual(self.request(path + '/activate', 'POST')[0], 403)
        self.assertEqual(self.request('/api/v1/settings/voice-connections/unknown', 'PATCH')[0], 403)

    def test_template_and_history_use_exact_configuration_endpoints(self):
        for method, path in [('GET', '/api/v1/ui/scene-templates'), ('GET', '/api/v1/scenes/quiet/revisions'), ('POST', '/api/v1/scenes/quiet/revisions/rev_1/restore')]:
            self.assertEqual(self.request(path, method)[0], 200)
        for path in ['/api/v1/scenes/quiet/revisions/rev%2f1/restore', '/api/v1/scenes/quiet/revisions/rev_1/delete']:
            self.assertEqual(self.request(path, 'POST')[0], 403)

    def test_prompt_variant_endpoints_are_bounded_and_preserve_payloads(self):
        for method, path in [('GET', '/api/v1/prompts'), ('POST', '/api/v1/prompts/conversation.aliyun_native_omni/variants'), ('POST', '/api/v1/prompts/conversation.aliyun_native_omni/activate'), ('PUT', '/api/v1/prompts/conversation.aliyun_native_omni/variants/custom-1'), ('DELETE', '/api/v1/prompts/conversation.aliyun_native_omni/variants/custom-1')]:
            self.assertEqual(self.request(path, method)[0], 200)
        for method, path in [('DELETE', '/api/v1/prompts'), ('POST', '/api/v1/prompts/conversation.aliyun_native_omni/execute'), ('PUT', '/api/v1/prompts/conversation%2fother/variants/custom-1')]:
            self.assertEqual(self.request(path, method)[0], 403)

    def test_capability_memory_quiet_contracts_are_bounded(self):
        for method, path in [('PATCH', '/api/v1/scenes/global'), ('DELETE', '/api/v1/capabilities/tool'), ('POST', '/api/v1/capabilities/tool/restore'), ('GET', '/api/v1/quiet-mode'), ('PATCH', '/api/v1/quiet-mode'), ('DELETE', '/api/v1/quiet-mode'), ('GET', '/api/v1/memory'), ('DELETE', '/api/v1/memory/fact-1'), ('DELETE', '/api/v1/memory')]:
            self.assertEqual(self.request(path, method)[0], 200)
        self.assertEqual(self.request('/api/v1/memory', 'POST', b'{}')[0], 403)
        self.assertEqual(self.request('/api/v1/capabilities/tool/execute', 'POST', b'{}')[0], 403)

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

    def test_people_and_explicit_voice_capture_only(self):
        for method, path in [('GET', 'people'), ('POST', 'people'), ('GET', 'people/test-id'), ('PATCH', 'people/test-id'), ('DELETE', 'people/test-id'), ('GET', 'people/import-candidates?provider=compreface'), ('POST', 'people/import'), ('GET', 'voiceprints/enrollment-prompts'), ('POST', 'voiceprints/register'), ('DELETE', 'face-identities/mappings/test')]:
            self.assertEqual(self.request('/api/v1/' + path, method, b'{}' if method != 'GET' else None)[0], 200)
        capture = '/api/v1/debug/mic_capture_asr?seconds=6&include_pcm=1&processed=1&transcribe=0&suppress_handler=1&purpose=voiceprint_enrollment'
        self.assertEqual(self.request(capture, 'POST')[0], 200)
        for invalid in [capture.replace('seconds=6', 'seconds=60'), capture + '&save=1', capture.replace('purpose=voiceprint_enrollment', 'purpose=debug'), '/api/v1/people/import', '/api/v1/face-identities/mappings/a%2fb']:
            self.assertEqual(self.request(invalid, 'DELETE' if 'mappings' in invalid or invalid.endswith('/import') else 'POST')[0], 403)

    def test_network_configuration_has_no_device_control_proxy(self):
        for method, path in [('GET', 'network/wifi'), ('POST', 'network/wifi/scan'), ('POST', 'network/wifi/connect'), ('DELETE', 'network/wifi/test-network'), ('POST', 'network/hotspot'), ('GET', 'home-assistant'), ('PATCH', 'home-assistant'), ('POST', 'home-assistant/probe'), ('GET', 'app_autostart'), ('POST', 'app_autostart'), ('GET', 'demo-readiness')]:
            self.assertEqual(self.request('/api/v1/' + path, method, b'{}' if method != 'GET' else None)[0], 200)
        for method, path in [('POST', 'home-assistant/control'), ('DELETE', 'network/wifi/a%2fb'), ('POST', 'network/restart'), ('DELETE', 'demo-readiness')]:
            self.assertEqual(self.request('/api/v1/' + path, method, b'{}')[0], 403)

    def test_flow_configuration_catalog_does_not_enable_flow_execution(self):
        self.assertEqual(self.request('/api/v1/ui/scene-flows', 'GET')[0], 200)
        for method, path in [('POST', '/api/v1/ui/scene-flows'), ('POST', '/api/v1/scenes/test/flow'), ('POST', '/api/v1/scenes/test/flow/task')]:
            self.assertEqual(self.request(path, method, b'{}')[0], 403)


if __name__ == '__main__':
    unittest.main()
