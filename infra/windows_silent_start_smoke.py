"""Verify the final installer and silent startup on an isolated Windows CI account."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import time
import urllib.request
import zipfile

from windows_biometria_smoke import LocalControl, read_test_key, protocol_tree, run_value, expected_registry

BASE_URL = 'https://www.jptreinamentos.com.br/EntregaEPI/updates/12.10.0-unico1/JP-Biometria-Instalador-Unico.exe'
BASE_SHA = 'd8773cc34e0bcb4cbdb4a3120f7654cdcff7707a4f005343106d0625c48d4d3b'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def invoke_install(exe):
    p = subprocess.run([str(exe), '--install-quiet'], capture_output=True, timeout=240)
    result = json.loads(p.stdout.decode().strip().splitlines()[-1])
    assert p.returncode == 1 and result['code'] == 'READER_NOT_FOUND', result
    return result


def shutdown(control):
    for owned in control.owned():
        for attempt in range(40):
            try:
                control.command(owned['port'], 'shutdown')
                break
            except Exception:
                if attempt == 39:
                    raise
                time.sleep(.25)
    for _ in range(30):
        if not control.owned():
            return
        time.sleep(.2)
    raise AssertionError('Owned agent did not stop')


def invoke_start(exe, args, expected_exit, env=None):
    # A Windows GUI process must return without requiring the user to close a dialog.
    p = subprocess.Popen([str(exe), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    windows = []
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]

    @callback_type
    def callback(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == p.pid and user32.IsWindowVisible(hwnd):
            windows.append(int(hwnd))
        return True

    deadline = time.monotonic() + 90
    while p.poll() is None and time.monotonic() < deadline:
        user32.EnumWindows(callback, 0)
        time.sleep(.02)
    assert p.poll() is not None, 'Startup waited for an interaction or timed out'
    stdout, _ = p.communicate()
    assert not windows, 'Startup displayed a visible window'
    assert p.returncode == expected_exit, 'Unexpected startup exit code'
    if expected_exit:
        result = json.loads(stdout)
        assert result['ok'] is False and result['version'] == '12.10.1'
    return {'exitCode': p.returncode, 'visibleWindows': len(windows)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--commit', required=True)
    a = p.parse_args()
    assert os.name == 'nt' and os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ['GITHUB_REPOSITORY'] == 'josepazmattos/jp-entregaepi-v12'
    home = Path(os.environ['LOCALAPPDATA']) / 'JP' / 'Biometria'
    assert not home.exists(), 'Requires a fresh test account'
    report = {'passed': False, 'physicalReaderTested': False, 'clientWindowsEditionsTested': False,
              'buildSha': a.commit, 'checks': []}
    control = None
    try:
        release = json.loads((a.source / 'release.json').read_text())
        exe = (a.source / release['filename']).resolve()
        assert release['buildSha'] == a.commit and release['agentVersion'] == '12.10.1'
        assert sha(exe.read_bytes()) == release['sha256'] and exe.stat().st_size == release['sizeBytes']
        report['sha256'] = release['sha256']
        # Verify the installed agent has no console subsystem.
        with zipfile.ZipFile(exe) as z:
            agent = z.read('agent.exe')
            pe = struct.unpack_from('<I', agent, 0x3c)[0]
            assert struct.unpack_from('<H', agent, pe + 24 + 68)[0] == 2
            manifest = json.loads(z.read('manifest.json'))

        damaged = a.source / 'corrupt-test.exe'
        data = bytearray(exe.read_bytes())
        with zipfile.ZipFile(exe) as z:
            entry = z.getinfo('sdk/Bin/NBioBSP.dll')
        offset = entry.header_offset
        n, e = struct.unpack_from('<HH', data, offset + 26)
        data[offset + 30 + n + e + entry.compress_size // 2] ^= 0x80
        damaged.write_bytes(data)
        r = subprocess.run([str(damaged.resolve()), '--install-quiet'], capture_output=True, timeout=90)
        assert r.returncode != 0 and json.loads(r.stdout.decode().splitlines()[-1])['code'] == 'PACKAGE_INVALID'
        assert not (home / 'control.key').exists()
        report['checks'].append({'case': 'corrupt-package-rejected', 'passed': True})

        # Upgrade the exact published installer, preserving its SDK and station identity.
        with urllib.request.urlopen(BASE_URL, timeout=120) as r:
            original = r.read(100 * 1024 * 1024)
        assert sha(original) == BASE_SHA
        old = a.source / 'published-previous.exe'
        old.write_bytes(original)
        invoke_install(old.resolve())
        key = read_test_key(home / 'control.key')
        control = LocalControl(key)
        assert len(control.owned()) == 1
        original_key_hash = sha(key)
        for attempt in range(2):
            installed = invoke_install(exe)
            assert installed['version'] == release['version']
            assert sha(read_test_key(home / 'control.key')) == original_key_hash
            owned = control.owned()
            assert len(owned) == 1 and owned[0]['buildSha'] == a.commit
            _, status = control.json(owned[0]['port'], '/status')
            assert status['version'] == '12.10.1' and status['sdk'] is True
            assert status['reader'] is False and status['ok'] is False and status['errorCode'] == 'READER_NOT_FOUND'
            for f in manifest['files']:
                if f['name'].startswith('sdk/'):
                    target = home / 'sdk-5.2.0.6-jp1' / f['name'][4:]
                    assert sha(target.read_bytes()) == f['sha256'], 'Registered SDK changed'
            report['checks'].append({'case': ['upgrade', 'reinstall'][attempt],
                                     'identityPreserved': True, 'sdkInitialized': True, 'ownedInstances': 1})

        launcher = home / 'JPBiometria.exe'
        expected_tree, expected_run = expected_registry(launcher)
        assert protocol_tree() == expected_tree and run_value() == expected_run
        shutdown(control)
        result = invoke_start(launcher, ['--start'], 0)
        report['checks'].append({'case': 'windows-autorun', **result})
        owned = control.owned()
        assert len(owned) == 1 and owned[0]['buildSha'] == a.commit
        result = invoke_start(launcher, ['--start', 'jpbiometria://start?ts=1'], 0)
        assert len(control.owned()) == 1
        report['checks'].append({'case': 'browser-start-reuses-agent', **result})
        _, status = control.json(owned[0]['port'], '/status')
        assert status['ok'] is False and status['errorCode'] == 'READER_NOT_FOUND'
        report['checks'].append({'case': 'error-visible-to-app', 'code': status['errorCode']})
        shutdown(control)

        for name, args in [('control.key', ['--start']), ('JPBiometriaAgent.jar', ['--start', 'jpbiometria://start'])]:
            original_path = home / name
            moved = home / (name + '.test-backup')
            original_path.rename(moved)
            try:
                result = invoke_start(launcher, args, 1)
                report['checks'].append({'case': 'missing-' + name, **result})
            finally:
                moved.rename(original_path)
        report['checks'].append({'case': 'invalid-start-uri', **invoke_start(launcher, ['--start', 'invalid'], 1)})
        report['checks'].append({'case': 'missing-profile', **invoke_start(launcher, ['--start'], 1, dict(os.environ, LOCALAPPDATA=''))})
        report['passed'] = True
    finally:
        if control:
            shutdown(control)
        Path('.deploy/silent-start-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    main()
