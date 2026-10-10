"""Execute the actual complete EXE in a clean Windows CI profile, no USB reader."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

from complete_release import verify, FILENAME
from windows_biometria_smoke import LocalControl, read_test_key


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', required=True, type=Path)
    p.add_argument('--commit', required=True)
    a = p.parse_args()
    assert os.name == 'nt' and os.environ.get('GITHUB_ACTIONS') == 'true', 'Disposable Windows CI only'
    verify(a.source, a.commit)
    home = Path(os.environ['LOCALAPPDATA']) / 'JP' / 'Biometria'
    assert not home.exists(), 'The test profile must not contain a real installation'
    report = {'physicalReaderTested': False, 'checks': [], 'buildSha': a.commit}
    control = None
    try:
        key_hash = None
        for attempt in range(2):
            # Capture bounded stdout; no biometric data is requested by this test.
            process = subprocess.Popen([str((a.source / FILENAME).resolve()), '--install-quiet'],
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            output, _ = process.communicate(timeout=240)
            result = json.loads(output.decode('utf-8').strip().splitlines()[-1])
            assert result['code'] in ('USB_ABSENT', 'READER_NOT_FOUND', 'HVCI_DRIVER', 'DRIVER_FAILED', 'SECURITY_UNKNOWN', 'REBOOT_REQUIRED'), result
            key = read_test_key(home / 'control.key')
            digest = hashlib.sha256(key).hexdigest()
            if key_hash: assert key_hash == digest, 'Reinstall must preserve station identity'
            key_hash = digest
            control = LocalControl(key)
            agents = control.owned()
            assert len(agents) == 1 and agents[0]['buildSha'] == a.commit, 'Unexpected agent instance'
            for _ in range(30):
                _, status = control.json(agents[0]['port'], '/status')
                if not status.get('checking'): break
                time.sleep(.5)
            assert status.get('sdk') is True, {k: status.get(k) for k in ('sdk', 'reader', 'errorCode')}
            assert status.get('reader') is False and status.get('ok') is False, 'No physical reader may be reported'
            assert status.get('javaArch') in ('amd64', 'x86_64')
            report['checks'].append({'attempt': attempt + 1, 'result': result['code'], 'sdkLoaded': True, 'reader': False})
        report['passed'] = True
    finally:
        if control:
            for agent in control.owned():
                for _ in range(20):
                    try:
                        control.command(agent['port'], 'shutdown'); break
                    except Exception:
                        time.sleep(.5)
        output = Path('.deploy/windows-complete-report.json'); output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    main()
