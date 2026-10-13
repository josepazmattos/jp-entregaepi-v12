"""Run the unmodified SDK installer in disposable Windows CI.
Private inputs are encrypted to a one-use runner key; never commit a serial.
"""
import base64, ctypes, hashlib, json, os, re, subprocess, tempfile, time, urllib.error, urllib.request, zipfile
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

REPO = "josepazmattos/jp-entregaepi-v12"
BRANCH = "instalador-unico-20261013"
SDK_SHA = "2d17fae6d34c45d5c46ae822efe014728a17c1abec2b0512c8dc01e1611f6ed9"

def api(path, body=None):
    req=urllib.request.Request("https://api.github.com/repos/"+REPO+path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization":"Bearer "+os.environ["GH_TOKEN"],"Accept":"application/vnd.github+json"},
        method="PUT" if body is not None else "GET")
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)

def receive(root):
    key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
    public=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
    folder=".ci-inputs/"+os.environ["GITHUB_RUN_ID"]
    api("/contents/"+folder+"/public-key.pem",{"branch":BRANCH,"message":"Publish disposable SDK test public key","content":base64.b64encode(public).decode()})
    print("Waiting for encrypted SDK test input",flush=True)
    for _ in range(120):
        try:
            r=api("/contents/"+folder+"/input.json?ref="+BRANCH)
            envelope=json.loads(base64.b64decode(r["content"]))
            break
        except urllib.error.HTTPError as e:
            if e.code!=404:raise
        time.sleep(5)
    else:raise RuntimeError("SDK_INPUT_TIMEOUT")
    symmetric=key.decrypt(base64.b64decode(envelope["key"]),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
    private=json.loads(AESGCM(symmetric).decrypt(base64.b64decode(envelope["nonce"]),base64.b64decode(envelope["data"]),os.environ["GITHUB_RUN_ID"].encode()))
    with urllib.request.urlopen(private["url"],timeout=120) as r: encrypted=r.read(400*1024*1024)
    data=AESGCM(base64.b64decode(private["key"])).decrypt(base64.b64decode(private["nonce"]),encrypted,b"jp-sdk-windows-test")
    assert hashlib.sha256(data).hexdigest()==SDK_SHA,"SDK_HASH_MISMATCH"
    archive=root/"sdk.zip";archive.write_bytes(data)
    with zipfile.ZipFile(archive) as z:
        exe=next(n for n in z.namelist() if n.endswith("eNBioBSP_v5.2.0.6.exe"))
        serial=next(n for n in z.namelist() if n.endswith("SERIAL.txt"))
        setup=root/"SDK.exe";setup.write_bytes(z.read(exe))
        license_code=z.read(serial).decode("utf-8-sig").strip()
    assert license_code and "\n" not in license_code
    print("::add-mask::"+license_code,flush=True)
    return setup,license_code

def main():
    assert os.name=="nt" and os.environ.get("GITHUB_ACTIONS")=="true"
    assert os.environ.get("GITHUB_REPOSITORY")==REPO
    out=Path(".deploy/sdk-probe");out.mkdir(parents=True,exist_ok=True)
    report={"physicalReaderTested":False,"sdkInitialized":False,"events":[]}
    from pywinauto import Desktop
    with tempfile.TemporaryDirectory(prefix="JP-official-sdk-") as temp:
        root=Path(temp);setup,serial=receive(root)
        response=root/"setup.iss"
        process=subprocess.Popen([str(setup),"/r",'/f1'+str(response),"/SMS"])
        deadline=time.monotonic()+300
        seen=set(); last_click=0
        try:
            while time.monotonic()<deadline:
                windows=[w for w in Desktop(backend="win32").windows() if re.search(r"(eNBio|NBioBSP|InstallShield)",w.window_text(),re.I)]
                for window in windows:
                    children=window.children()
                    labels=[c.window_text().replace(serial,"[REDACTED]") for c in children if c.class_name()!="Edit"]
                    signature=repr(labels)
                    if signature not in seen:
                        seen.add(signature);report["events"].append({"title":window.window_text(),"labels":labels})
                        print(json.dumps(report["events"][-1]),flush=True)
                    if time.monotonic()-last_click<1.5:continue
                    edits=[c for c in children if c.class_name()=="Edit" and c.is_visible() and c.is_enabled()]
                    if any("Serial" in x or "License Code" in x for x in labels) and len(edits)>=3:
                        for control,value in zip(edits,["JP Biometria","Hokinet",serial]):control.set_edit_text(value)
                    buttons=[c for c in children if c.class_name()=="Button" and c.is_visible() and c.is_enabled()]
                    for label in ("Next >","Next","Yes","I accept the terms of the license agreement","Install","Finish"):
                        found=next((b for b in buttons if b.window_text().replace("&","").strip()==label),None)
                        if found:
                            found.click();last_click=time.monotonic();break
                if process.poll() is not None and not windows:break
                time.sleep(.5)
            report["setupExitCode"]=process.poll()
            if response.exists():
                text=response.read_text(errors="replace").replace(serial,"{{SERIAL}}")
                (out/"setup-template.iss").write_text(text)
            for parent in [Path(os.environ.get("ProgramFiles(x86)","C:/Program Files (x86)")),Path(os.environ["ProgramFiles"])]:
                for folder in parent.glob("*NITGEN*"):
                    report.setdefault("installedFiles",[]).extend(str(p) for p in folder.rglob("NBioBSP.dll"))

            probe = root/"init.ps1"
            probe.write_text(r"""$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OfficialSDK {
 [DllImport("NBioBSP.dll", CallingConvention=CallingConvention.Winapi)] public static extern uint NBioAPI_Init(out UIntPtr handle);
 [DllImport("NBioBSP.dll", CallingConvention=CallingConvention.Winapi)] public static extern uint NBioAPI_Terminate(UIntPtr handle);
}
'@
$handle=[UIntPtr]::Zero
$code=[OfficialSDK]::NBioAPI_Init([ref]$handle)
@{architecture=([IntPtr]::Size*8);initialize=$code;readerTested=$false}|ConvertTo-Json -Compress
if($code -eq 0){[OfficialSDK]::NBioAPI_Terminate($handle)|Out-Null}
""",encoding="utf-8")
            for arch,folder in [("x86","SysWOW64"),("amd64","System32")]:
                ps=Path(os.environ["SystemRoot"])/folder/"WindowsPowerShell/v1.0/powershell.exe"
                result=subprocess.run([str(ps),"-NoProfile","-NonInteractive","-File",str(probe)],capture_output=True,text=True,timeout=30)
                try: status=json.loads(result.stdout.strip())
                except ValueError: status={"initialize":None,"processCode":result.returncode}
                report.setdefault("initialization",{})[arch]=status
            report["sdkInitialized"]=all(v.get("initialize")==0 for v in report["initialization"].values())
            # Save setup metadata, never the vendor serial or biometric data.
            report["setupCompleted"]=process.poll()==0 and response.exists()
        finally:
            (out/"report.json").write_text(json.dumps(report,indent=2))
            if process.poll() is None:
                subprocess.run(["taskkill","/PID",str(process.pid),"/T","/F"],capture_output=True)
    print(json.dumps(report),flush=True)
    assert report.get("setupCompleted"),"OFFICIAL_SETUP_FAILED"

if __name__=="__main__":main()
