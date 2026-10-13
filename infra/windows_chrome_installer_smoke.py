"""Check exact universal installer bytes in disposable Windows CI; never capture."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
from windows_biometria_smoke import LocalControl,read_test_key


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True,type=Path)
    p.add_argument('--commit',required=True)
    p.add_argument('--runtime',choices=['x86','amd64'],required=True)
    a=p.parse_args()
    assert os.name=='nt' and os.environ.get('GITHUB_ACTIONS')=='true','Disposable Windows CI only'
    m=json.loads((a.source/'release.json').read_text());exe=(a.source/m['filename']).resolve()
    assert m['buildSha']==a.commit and exe.stat().st_size==m['sizeBytes']
    assert hashlib.sha256(exe.read_bytes()).hexdigest()==m['sha256']
    home=Path(os.environ['LOCALAPPDATA'])/'JP'/'Biometria'
    assert not home.exists(),'A clean profile is required'
    report={'physicalReaderTested':False,'windowsClientEditionsTested':False,'buildSha':a.commit,'runtime':a.runtime,'checks':[]}
    control=None;key_hash=None
    try:
        for attempt in range(2):
            cmd=[str(exe),'--install-quiet']+(['--runtime-x86'] if a.runtime=='x86' else [])
            r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=240)
            result=json.loads(r.stdout.decode().strip().splitlines()[-1])
            # Known vendor validity failure is reported as failure, never ready.
            assert result['code'] in ('READER_NOT_FOUND','NITGEN_15'),result
            assert result['ok'] is False and r.returncode==1
            assert result['architecture']==a.runtime
            key=read_test_key(home/'control.key');digest=hashlib.sha256(key).hexdigest()
            if key_hash:assert digest==key_hash,'Station identity changed'
            key_hash=digest;control=LocalControl(key);owned=control.owned()
            assert len(owned)==1 and owned[0]['buildSha']==a.commit
            _,status=control.json(owned[0]['port'],'/status')
            assert status['sdk'] is True and status['reader'] is False and status['ok'] is False
            assert status['javaArch'] in (('x86','i386') if a.runtime=='x86' else ('amd64','x86_64'))
            report['checks'].append({'attempt':attempt+1,'sdkFilesLoaded':True,'initializationCode':status['errorCode'],'reader':False,'identityPreserved':True})
        report['installerChecksPassed']=True
        report['biometricOperationApproved']=False
    finally:
        if control:
            for own in control.owned():
                for _ in range(20):
                    try:control.command(own['port'],'shutdown');break
                    except Exception:time.sleep(.5)
        out=Path('.deploy/windows-chrome-report.json');out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

if __name__=='__main__':main()
