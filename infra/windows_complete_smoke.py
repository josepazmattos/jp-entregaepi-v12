"""Execute the actual complete EXE in a clean Windows CI profile, no USB reader."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import sys
import tempfile

from complete_release import verify, FILENAME
from windows_biometria_smoke import LocalControl, read_test_key


def diagnose_sdk(home):
    """Compare documented SDK startup in isolated CI without capturing a finger."""
    sdk = home / 'sdk-5.2.0.6'
    binary = sdk / 'Bin/x64'
    java = Path(os.environ['LOCALAPPDATA']) / 'Programs/Eclipse Adoptium/jp-biometria-jre8u504b01/bin/java.exe'
    source = '''import com.nitgen.SDK.BSP.NBioBSPJNI;
public class NitgenBootstrapSmoke {
 public static void main(String[] args) {
  if(args.length>0)System.load(args[0]);
  NBioBSPJNI sdk=new NBioBSPJNI();
  try {
   System.out.println("initialize="+sdk.GetErrorCode());
   if(sdk.IsErrorOccured())return;
   NBioBSPJNI.DEVICE_ENUM_INFO devices=sdk.new DEVICE_ENUM_INFO();
   sdk.EnumerateDevice(devices);
   System.out.println("enumerate="+sdk.GetErrorCode()+";devices="+devices.DeviceCount);
   devices.dispose();
  }finally{sdk.dispose();}
 }
}'''
    with tempfile.TemporaryDirectory(prefix='jp-sdk-bootstrap-') as temp:
        folder = Path(temp); path = folder / 'NitgenBootstrapSmoke.java'; path.write_text(source)
        compiler = Path(os.environ['JAVA_HOME']) / 'bin/javac.exe'
        subprocess.run([str(compiler), '--release', '8', '-cp', str(sdk / 'Lib/NBioBSPJNI.jar'), str(path)], check=True)
        env = dict(os.environ); env['PATH'] = str(binary) + os.pathsep + os.environ.get('PATH', '')
        for label, cwd, preload in [('agent-directory', home, True), ('sdk-directory', binary, True), ('sdk-default-loader', binary, False)]:
            command = [str(java), '-Djava.library.path='+str(binary), '-cp', str(folder)+os.pathsep+str(sdk / 'Lib/NBioBSPJNI.jar'), 'NitgenBootstrapSmoke']
            if preload: command += [str(binary / 'NBioBSP.dll')]
            probe = subprocess.run(command, cwd=cwd, env=env, capture_output=True, timeout=30)
            # This sample only returns error codes and count; no templates, secrets or capture.
            lines = [line for line in probe.stdout.decode('utf-8', errors='replace').splitlines() if line.startswith(('initialize=', 'enumerate='))]
            print(json.dumps({'sdkBootstrap': label, 'exit': probe.returncode, 'result': lines}))


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
            if result.get('code') == 'NITGEN_15':
                diagnose_sdk(home)
            assert process.returncode == 0 and result.get('ok') is True and result['code'] == 'INSTALLED_WITHOUT_READER', result
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
            assert status.get('capabilities', {}).get('certificates') is True, 'Certificate setup must be available without USB'
            report['checks'].append({'attempt': attempt + 1, 'result': result['code'], 'sdkLoaded': True, 'reader': False})
        # Exercise the exact private JRE installed by the EXE, including modern
        # A1 PKCS12 and KMS wrapping. Never use a user's certificate or private key.
        repo = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(repo / 'native' / 'biometria'))
        from build import compile_java, crypto_jar
        with tempfile.TemporaryDirectory(prefix='jpged-runtime-test-') as temporary:
            folder = Path(temporary)
            classes = folder / 'classes'
            compile_java(classes, tests=True)
            subprocess.run([sys.executable, str(repo / 'backend/test/helpers/jpged-fixture.py'), str(folder)], check=True)
            private_java = Path(os.environ['LOCALAPPDATA']) / 'Programs/Eclipse Adoptium/jp-biometria-jre8u504b01/bin/java.exe'
            subprocess.run([str(private_java), '-Djava.awt.headless=true', '-cp', str(classes)+os.pathsep+str(crypto_jar()), 'JPBiometriaAgentTest', str(folder)], check=True, timeout=60)
            report['checks'].append({'privateJavaA1': True, 'kmsWrapping': True, 'syntheticCertificatesOnly': True})
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
