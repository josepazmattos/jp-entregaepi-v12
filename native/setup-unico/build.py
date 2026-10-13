"""Build one offline installer using the runtime registered by the official SDK setup.
The original serial and development installer never enter the distributable.
"""
import argparse, hashlib, importlib.util, io, json, os, re, subprocess, tempfile, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
VERSION="12.10.0-unico1"
FILENAME="JP-Biometria-Instalador-Unico.exe"

def sha(data):return hashlib.sha256(data).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--registered-sdk",required=True,type=Path)
    p.add_argument("--sdk-report",required=True,type=Path)
    p.add_argument("--seed",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--build-sha",required=True)
    a=p.parse_args()
    assert re.fullmatch("[0-9a-f]{40}",a.build_sha)
    report=json.loads(a.sdk_report.read_text())
    registered=a.registered_sdk.read_bytes()
    assert report.get("sdkInitialized") is True,"Official SDK initialization must pass before build"
    assert report["registeredRuntime"]["sha256"]==sha(registered)
    seed=a.seed.read_bytes()
    assert sha(seed)=="d821d5dc768a51f741fd322d480f851058b39429356d1df13aa84e216bccccf9"
    with zipfile.ZipFile(io.BytesIO(seed)) as z:
        entries={"amd64/"+n if n.startswith("jre/") else n:z.read(n) for n in z.namelist() if n.startswith(("jre/","driver/")) or n=="sdk/LICENSE.txt"}
    with zipfile.ZipFile(io.BytesIO(registered)) as z:
        for n in z.namelist():
            assert not n.startswith("/") and ".." not in n and "\\" not in n
            if n.startswith("amd64/sdk/"):entries[n.removeprefix("amd64/")]=z.read(n)
    assert all(n in entries for n in ("sdk/Bin/NBioBSP.dll","sdk/Bin/NBioBSPJNI.dll","sdk/Lib/NBioBSPJNI.jar","amd64/jre/bin/java.exe","driver/FpUSB.inf"))
    assert not any("serial" in n.lower() for n in entries)
    spec=importlib.util.spec_from_file_location("agentbuild",ROOT.parent/"biometria/build.py")
    agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
    with tempfile.TemporaryDirectory() as t:
        classes=Path(t)/"classes";agent.compile_java(classes);agent.build_payload(classes)
        env=dict(os.environ,GOOS="windows",GOARCH="amd64",CGO_ENABLED="0",GOTOOLCHAIN="local")
        exe=Path(t)/"agent.exe"
        subprocess.run([agent.go_bin(),"build","-trimpath","-buildvcs=false","-ldflags","-H windowsgui -s -w -buildid= -X main.buildSHA="+a.build_sha,"-o",str(exe),"."],cwd=ROOT.parent/"biometria",env=env,check=True)
        entries["agent.exe"]=exe.read_bytes()
        manifest={"version":VERSION,"files":[{"name":n,"size":len(b),"sha256":sha(b)} for n,b in sorted(entries.items())]}
        entries["manifest.json"]=json.dumps(manifest,sort_keys=True).encode()
        with zipfile.ZipFile(ROOT/"payload.zip","w",zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for n,b in sorted(entries.items()):
                info=zipfile.ZipInfo(n,(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,b)
        subprocess.run([agent.go_bin(),"test","-count=1","./..."],cwd=ROOT,check=True)
        a.output.mkdir(parents=True,exist_ok=True);out=a.output.resolve()/FILENAME
        env["GOARCH"]="386"
        subprocess.run([agent.go_bin(),"build","-trimpath","-buildvcs=false","-ldflags","-s -w -buildid=","-o",str(out),"."],cwd=ROOT,env=env,check=True)
        with out.open("ab") as f:f.write((ROOT/"payload.zip").read_bytes())
        release={"version":VERSION,"agentVersion":agent.VERSION,"buildSha":a.build_sha,"filename":FILENAME,"sha256":sha(out.read_bytes()),"sizeBytes":out.stat().st_size,"sdkRegistrationVerified":True,"sourceRegisteredSDK":sha(registered),"driverIncluded":True,"javaIncluded":True,"physicalReaderTested":False,"windowsInstallerTestsPassed":False}
        (a.output/"release.json").write_text(json.dumps(release,indent=2)+"\n")
        print(json.dumps(release))

if __name__=="__main__":main()
