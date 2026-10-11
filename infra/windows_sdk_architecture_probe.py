"""Diagnostic only: documented vendor initialization, without capture or validity bypass."""
import hashlib, io, json, os, subprocess, tempfile, urllib.request, zipfile
from pathlib import Path

assert os.name == 'nt' and os.environ.get('GITHUB_ACTIONS') == 'true'
url='https://www.jptreinamentos.com.br/EntregaEPI/build-inputs/nitgen-original-x86-diagnostic-20261011.zip'
with urllib.request.urlopen(url,timeout=60) as response: data=response.read(10*1024*1024)
assert hashlib.sha256(data).hexdigest()=='2d02c86bd16df0ff95586437de7cea9081e8ede285cc0f042347e2fe68618562'
with tempfile.TemporaryDirectory(prefix='jp-original-sdk-x86-') as tmp:
    root=Path(tmp)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            assert name.startswith('x86/') and name.endswith('.dll') and '..' not in name and '\\' not in name
            (root/Path(name).name).write_bytes(archive.read(name))
    script=root/'probe.ps1'
    script.write_text('''$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OriginalSDK {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool SetDllDirectory(string p);
 [DllImport("NBioBSP.dll",CallingConvention=CallingConvention.Winapi)] public static extern uint NBioAPI_Init(out UIntPtr handle);
 [DllImport("NBioBSP.dll",CallingConvention=CallingConvention.Winapi)] public static extern uint NBioAPI_Terminate(UIntPtr handle);
}
'@
if([IntPtr]::Size -ne 4) {throw 'Expected x86 process'}
[OriginalSDK]::SetDllDirectory($PSScriptRoot) | Out-Null
$handle=[UIntPtr]::Zero
$code=[OriginalSDK]::NBioAPI_Init([ref]$handle)
@{architecture='x86';initialize=$code;readerTested=$false} | ConvertTo-Json -Compress
if($code -eq 0) {[OriginalSDK]::NBioAPI_Terminate($handle) | Out-Null}
''',encoding='utf-8')
    powershell=Path(os.environ['SystemRoot'])/'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    subprocess.run([str(powershell),'-NoProfile','-NonInteractive','-File',str(script)],cwd=root,check=True,timeout=30)
