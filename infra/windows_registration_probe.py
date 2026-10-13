"""Validate the manufacturer's registration tool using the supplied valid SDK serial.
No patching, alternate serial generation, date changes, or validity bypass.
"""
import base64,hashlib,io,json,os,subprocess,tempfile,time,urllib.request,zipfile
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from windows_official_sdk_probe import receive,export_registered_runtime

RUNTIME_URL='https://www.jptreinamentos.com.br/EntregaEPI/build-inputs/biometria-chrome-runtime-3455fbf7588a.zip'
RUNTIME_SHA='3455fbf7588aa954a11438bcb9c9c3066e627f2236e420df0cace9eae15b47ad'

def main():
    assert os.name=='nt' and os.environ.get('GITHUB_ACTIONS')=='true'
    from pywinauto import Desktop
    out=Path('.deploy/sdk-probe');out.mkdir(parents=True,exist_ok=True)
    report={'physicalReaderTested':False,'sdkInitialized':False,'registrationMethod':'Original RegNBioBSP.exe with supplied SDK serial','events':[],'initialization':{}}
    with tempfile.TemporaryDirectory(prefix='JP-SDK-registration-') as temp:
        root=Path(temp);private={};_,serial,return_key=receive(root,private)
        with urllib.request.urlopen(private['registrationUrl'],timeout=60) as r:encrypted=r.read(2*1024*1024)
        data=AESGCM(base64.b64decode(private['key'])).decrypt(base64.b64decode(private['registrationNonce']),encrypted,b'jp-registration-test')
        assert hashlib.sha256(data).hexdigest()==private['registrationSHA256']
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for arch in ('x86','amd64'):
                folder=root/arch;folder.mkdir();(folder/'RegNBioBSP.exe').write_bytes(z.read(arch+'/RegNBioBSP.exe'))
        with urllib.request.urlopen(RUNTIME_URL,timeout=120) as r:data=r.read(140*1024*1024)
        assert hashlib.sha256(data).hexdigest()==RUNTIME_SHA
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for name in z.namelist():
                if '/sdk/' in name:
                    assert '..' not in name and not name.startswith('/') and '\\' not in name
                    path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(z.read(name))
        try:
            for arch in ('amd64','x86'):
                binary=next((root/arch/'sdk').rglob('NBioBSP.dll'))
                before=hashlib.sha256(binary.read_bytes()).hexdigest()
                process=subprocess.Popen([str(root/arch/'RegNBioBSP.exe')],cwd=binary.parent)
                signed=False;seen=set();deadline=time.monotonic()+45
                try:
                    while time.monotonic()<deadline:
                        windows=[w for w in Desktop(backend='win32').windows() if w.process_id()==process.pid]
                        for window in windows:
                            children=window.descendants()
                            labels=[c.window_text().replace(serial,'[REDACTED]') for c in children if c.class_name()!='Edit']
                            sig=repr(labels)
                            if sig not in seen:
                                seen.add(sig);event={'architecture':arch,'title':window.window_text(),'labels':labels,'fields':[{'id':c.control_id(),'length':len(c.window_text())} for c in children if c.class_name()=='Edit']}
                                report['events'].append(event);print(json.dumps(event),flush=True)
                            edits=[c for c in children if c.class_name()=='Edit' and c.is_visible()]
                            buttons=[c for c in children if c.class_name()=='Button' and c.is_enabled() and c.is_visible()]
                            sign=next((b for b in buttons if b.window_text().replace('&','').strip()=='Sign'),None)
                            if sign is not None and not signed:
                                default=next((b for b in buttons if 'Use default path' in b.window_text()),None)
                                if default is not None and default.get_check_state():default.uncheck()
                                parts=serial.split('-')
                                assert len(edits)==1+len(parts),'REGISTRATION_FIELDS_UNEXPECTED'
                                for control,value in zip(edits,[str(binary)]+parts):control.set_edit_text(value)
                                sign.click();signed=True
                            elif sign is None:
                                ok=next((b for b in buttons if b.window_text().replace('&','').strip()=='OK'),None)
                                if ok is not None:ok.click()
                        if signed and hashlib.sha256(binary.read_bytes()).hexdigest()!=before:break
                        if process.poll() is not None:break
                        time.sleep(.5)
                finally:
                    if process.poll() is None:process.terminate();process.wait(timeout=10)
                report.setdefault('registrationChangedFile',{})[arch]=hashlib.sha256(binary.read_bytes()).hexdigest()!=before
                # Invoke documented initialization using the matching Windows process architecture.
                ps=root/(arch+'-probe.ps1')
                ps.write_text(r'''$ErrorActionPreference='Stop'
param()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RegisteredSDK {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
 [DllImport("NBioBSP.dll",CallingConvention=CallingConvention.Winapi)] public static extern uint NBioAPI_Init(out UIntPtr handle);
 [DllImport("NBioBSP.dll",CallingConvention=CallingConvention.Winapi)] public static extern uint NBioAPI_Terminate(UIntPtr handle);
}
'@
[RegisteredSDK]::SetDllDirectory($args[0])|Out-Null
$handle=[UIntPtr]::Zero
$code=[RegisteredSDK]::NBioAPI_Init([ref]$handle)
@{architecture=([IntPtr]::Size*8);initialize=$code;readerTested=$false}|ConvertTo-Json -Compress
if($code -eq 0){[RegisteredSDK]::NBioAPI_Terminate($handle)|Out-Null}
'''.replace('param()\n',''),encoding='utf-8')
                powershell=Path(os.environ['SystemRoot'])/('System32' if arch=='amd64' else 'SysWOW64')/'WindowsPowerShell/v1.0/powershell.exe'
                result=subprocess.run([str(powershell),'-NoProfile','-NonInteractive','-File',str(ps),str(binary.parent)],cwd=binary.parent,capture_output=True,text=True,timeout=30)
                try:status=json.loads(result.stdout.strip())
                except ValueError:status={'initialize':None,'processCode':result.returncode}
                report['initialization'][arch]=status
            report['sdkInitialized']=all(v.get('initialize')==0 for v in report['initialization'].values())
            if report['sdkInitialized']:export_registered_runtime(out,return_key,report,[root])
        finally:(out/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report),flush=True)
    assert report['sdkInitialized'],'REGISTERED_SDK_INITIALIZATION_FAILED'

if __name__=='__main__':main()
