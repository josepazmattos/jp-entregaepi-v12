"""Reproduce vendor SDK initialization in an isolated Windows CI directory."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import urllib.request
import zipfile
import shutil

from windows_complete_smoke import diagnose_sdk

assert os.name == 'nt' and os.environ.get('GITHUB_ACTIONS') == 'true'
repo = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo / 'native/setup-completo'))
from build_ci import SEED_URL, SEED_HASH

with urllib.request.urlopen(SEED_URL, timeout=60) as response:
    data = response.read(90 * 1024 * 1024)
assert hashlib.sha256(data).hexdigest() == SEED_HASH
with urllib.request.urlopen('https://www.jptreinamentos.com.br/EntregaEPI/build-inputs/nitgen-java-diagnostic-20261011.zip', timeout=30) as response:
    alternatives = response.read(200000)
assert hashlib.sha256(alternatives).hexdigest() == 'f0f0248978dba14afe94b3ffc233a6f68d24e54e4bef602ebf6551f3bdee8df0'
with tempfile.TemporaryDirectory(prefix='jp-sdk-isolated-') as temporary:
    root = Path(temporary)
    home = root / 'JP/Biometria'
    home.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        for entry in manifest['files']:
            name = entry['name']
            if not name.startswith(('sdk/', 'jre/')) and name != 'driver/Venus.dll':
                continue
            assert '\\' not in name and '..' not in name and ':' not in name
            content = archive.read(name)
            assert len(content) == entry['size'] and hashlib.sha256(content).hexdigest() == entry['sha256']
            base = home / 'sdk-5.2.0.6' if name.startswith('sdk/') else root / 'Programs/Eclipse Adoptium/jp-biometria-jre8u504b01'
            target = root / 'driver/Venus.dll' if name == 'driver/Venus.dll' else base / name[4:]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    previous = os.environ['LOCALAPPDATA']
    os.environ['LOCALAPPDATA'] = str(root)
    try:
        diagnose_sdk(home)
        supplied = root / 'supplied-java'; supplied.mkdir()
        with zipfile.ZipFile(io.BytesIO(alternatives)) as archive:
            for name in ['index/NBioBSPJNI.jar', 'busca/NBioBSPJNI.jar', 'system/NSearch.dll']:
                target = supplied / name; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
        # Diagnostic only: no app/runtime replacement and no capture or fingerprint samples.
        for name in ['index', 'busca']:
            diagnose_sdk(home, supplied / name / 'NBioBSPJNI.jar', name+'-')
        shutil.copyfile(supplied / 'system/NSearch.dll', home / 'sdk-5.2.0.6/Bin/x64/NSearch.dll')
        diagnose_sdk(home, label_prefix='full-system-')
        # The driver's user-mode DLL is distinct from the USB kernel driver.
        # The stock INF copies Venus.dll into the Windows system directory.
        shutil.copyfile(root / 'driver/Venus.dll', home / 'sdk-5.2.0.6/Bin/x64/Venus.dll')
        diagnose_sdk(home, label_prefix='driver-user-mode-')
        # Compare the documented C initialization entry point to isolate the JNI layer.
        # This does not replace the production API or bypass its validation.
        binary = home / 'sdk-5.2.0.6/Bin/x64'
        # A separate process releases the loaded Windows DLL before temp cleanup.
        native_probe = '''import ctypes, json, os, sys
from pathlib import Path
binary = Path(sys.argv[1])
with os.add_dll_directory(str(binary)):
    sdk = ctypes.WinDLL(str(binary / 'NBioBSP.dll'))
    sdk.NBioAPI_Init.argtypes = [ctypes.POINTER(ctypes.c_size_t)]
    sdk.NBioAPI_Init.restype = ctypes.c_uint32
    sdk.NBioAPI_Terminate.argtypes = [ctypes.c_size_t]
    sdk.NBioAPI_Terminate.restype = ctypes.c_uint32
    handle = ctypes.c_size_t()
    code = sdk.NBioAPI_Init(ctypes.byref(handle))
    print(json.dumps({'sdkBootstrap': 'documented-c-api', 'initialize': code}), flush=True)
    if code == 0: sdk.NBioAPI_Terminate(handle)
'''
        subprocess.run([sys.executable, '-c', native_probe, str(binary)], check=True, timeout=30)
        # The A1 runtime is independently testable even when vendor SDK init fails.
        sys.path.insert(0, str(repo / 'native/biometria'))
        from build import compile_java, crypto_jar
        classes = root / 'certificate-test-classes'
        compile_java(classes, tests=True)
        fixtures = root / 'synthetic-certificates'
        subprocess.run([sys.executable, str(repo / 'backend/test/helpers/jpged-fixture.py'), str(fixtures)], check=True)
        private_java = root / 'Programs/Eclipse Adoptium/jp-biometria-jre8u504b01/bin/java.exe'
        subprocess.run([str(private_java), '-Djava.awt.headless=true', '-cp', str(classes)+os.pathsep+str(crypto_jar()), 'JPBiometriaAgentTest', str(fixtures)], check=True, timeout=60)
    finally:
        os.environ['LOCALAPPDATA'] = previous
