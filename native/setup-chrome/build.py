"""Build one x86 launcher for Windows 10 x86/x64 and Windows 11 x64.
No drivers, serials, machine-wide Java installation or elevation are included.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
VERSION = '12.10.0-chrome1'
FILENAME = 'JP-Biometria-Windows-10-11.exe'

def machine(data):
    if data[:2] != b'MZ': raise ValueError('Not a PE file')
    offset = struct.unpack_from('<I', data, 0x3c)[0]
    if data[offset:offset+4] != b'PE\0\0': raise ValueError('Not a PE file')
    return struct.unpack_from('<H', data, offset+4)[0]

def archive_bytes(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for n,b in sorted(entries.items()):
            i=zipfile.ZipInfo(n,(2020,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(i,b)
    return buffer.getvalue()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',required=True,type=Path)
    p.add_argument('--build-sha',required=True)
    p.add_argument('--seed',type=Path)
    args=p.parse_args()
    if not re.fullmatch('[0-9a-f]{40}',args.build_sha):p.error('Full Git SHA required')
    lock=json.loads((ROOT/'runtime-lock.json').read_text())
    if args.seed: data=args.seed.read_bytes()
    else:
        with urllib.request.urlopen(lock['url'],timeout=120) as r:data=r.read(140*1024*1024)
    if hashlib.sha256(data).hexdigest()!=lock['sha256']:raise ValueError('Runtime integrity failed')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries={n:z.read(n) for n in z.namelist()}
    for arch,pe in [('amd64',0x8664),('x86',0x14c)]:
        assert machine(entries[arch+'/jre/bin/java.exe'])==pe
        sdk=[n for n in entries if n.startswith(arch+'/sdk/') and n.endswith('.dll')]
        assert any(n.endswith('/NBioBSPJNI.dll') for n in sdk)
        assert any(n.endswith('/NBioBSP.dll') for n in sdk)
        
        for n in sdk:
            b=entries[n]
            if machine(b)!=pe:
                # Vendor language DLLs contain only resources, no executable code.
                offset=struct.unpack_from('<I',b,0x3c)[0]+24
                assert n.rsplit('/',1)[-1] in ('NBSP2Eng.dll','NBSP2Jpn.dll','NBSP2Kor.dll')
                assert struct.unpack_from('<I',b,offset+4)[0]==0
                assert struct.unpack_from('<I',b,offset+16)[0]==0
        assert arch+'/sdk/Lib/NBioBSPJNI.jar' in entries
    assert all(n.startswith(('amd64/sdk/','amd64/jre/','x86/sdk/','x86/jre/')) for n in entries)
    spec=importlib.util.spec_from_file_location('agentbuild',ROOT.parent/'biometria'/'build.py')
    agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
    with tempfile.TemporaryDirectory() as t:
        classes=Path(t)/'classes';agent.compile_java(classes);agent.build_payload(classes)
        executable=Path(t)/'agent.exe'
        env=dict(os.environ,GOOS='windows',GOARCH='386',CGO_ENABLED='0',GOTOOLCHAIN='local')
        subprocess.run([agent.go_bin(),'build','-trimpath','-buildvcs=false','-ldflags',
            '-H windowsgui -s -w -buildid= -X main.buildSHA='+args.build_sha,'-o',str(executable),'.'],
            cwd=ROOT.parent/'biometria',env=env,check=True)
        entries['agent.exe']=executable.read_bytes();assert machine(entries['agent.exe'])==0x14c
        manifest={'version':VERSION,'files':[{'name':n,'size':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in sorted(entries.items())]}
        entries['manifest.json']=json.dumps(manifest,sort_keys=True).encode()
        (ROOT/'payload.zip').write_bytes(archive_bytes(entries))
        subprocess.run([agent.go_bin(),'test','-count=1','./...'],cwd=ROOT,check=True)
        args.output.mkdir(parents=True,exist_ok=True);out=args.output.resolve()/FILENAME
        subprocess.run([agent.go_bin(),'build','-trimpath','-buildvcs=false','-ldflags','-s -w -buildid=','-o',str(out),'.'],cwd=ROOT,env=env,check=True)
        data=out.read_bytes();assert machine(data)==0x14c
        release={'version':VERSION,'agentVersion':agent.VERSION,'buildSha':args.build_sha,'filename':FILENAME,
            'sha256':hashlib.sha256(data).hexdigest(),'sizeBytes':len(data),'runtimeArchitectures':['x86','amd64'],
            'driverIncluded':False,'serialIncluded':False,'physicalCaptureValidated':False,
            'knownLimitation':'Original SDK returned NITGEN_15 in earlier Windows initialization tests; requires real-device validation.'}
        (args.output/'release.json').write_text(json.dumps(release,indent=2)+'\n')
        print(json.dumps(release))

if __name__=='__main__':main()
