"""Test exact one-file installer on clean Windows: integrity, install, repeat and repair."""
import base64,hashlib,io,json,os,shutil,struct,subprocess,time,urllib.error,urllib.request,zipfile
from pathlib import Path
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import padding,rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from windows_official_sdk_probe import api,BRANCH
from windows_biometria_smoke import LocalControl,read_test_key


def receive(root):
    key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
    public=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
    folder='.ci-inputs/'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['JP_TEST_SLOT']
    for retry in range(6):
        try:
            api('/contents/'+folder+'/public-key.pem',{'branch':BRANCH,'message':'Publish one-use installer test key','content':base64.b64encode(public).decode()});break
        except urllib.error.HTTPError as e:
            if e.code!=409 or retry==5:raise
            time.sleep(1+retry)
    print('Waiting for encrypted candidate installer',flush=True)
    for _ in range(120):
        try:
            r=api('/contents/'+folder+'/input.json?ref='+BRANCH)
            envelope=json.loads(base64.b64decode(r['content']));break
        except urllib.error.HTTPError as e:
            if e.code!=404:raise
        time.sleep(5)
    else:raise RuntimeError('INPUT_TIMEOUT')
    symmetric=key.decrypt(base64.b64decode(envelope['key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
    private=json.loads(AESGCM(symmetric).decrypt(base64.b64decode(envelope['nonce']),base64.b64decode(envelope['data']),folder.encode()))
    with urllib.request.urlopen(private['url'],timeout=120) as r:encrypted=r.read(200*1024*1024)
    data=AESGCM(base64.b64decode(private['key'])).decrypt(base64.b64decode(private['nonce']),encrypted,b'jp-unified-installer-test')
    manifest=private['release']
    assert manifest['buildSha']==os.environ['GITHUB_SHA'],'Unexpected source revision'
    assert len(data)==manifest['sizeBytes'] and hashlib.sha256(data).hexdigest()==manifest['sha256']
    exe=root/manifest['filename'];exe.write_bytes(data)
    return exe,manifest


def invoke(exe):
    result=subprocess.run([str(exe),'--install-quiet'],capture_output=True,timeout=240)
    status=json.loads(result.stdout.decode().strip().splitlines()[-1])
    return result.returncode,status


def shutdown(control):
    for own in control.owned():
        for _ in range(20):
            try:control.command(own['port'],'shutdown');break
            except Exception:time.sleep(.5)
    for _ in range(30):
        if not control.owned():return
        time.sleep(.2)
    raise AssertionError('Owned agent did not stop')


def main():
    assert os.name=='nt' and os.environ.get('GITHUB_ACTIONS')=='true'
    assert os.environ['GITHUB_REPOSITORY']=='josepazmattos/jp-entregaepi-v12'
    root=Path('.deploy/private').resolve();root.mkdir(parents=True,exist_ok=True)
    home=Path(os.environ['LOCALAPPDATA'])/'JP'/'Biometria';assert not home.exists()
    report={'physicalReaderTested':False,'clientWindowsEditionsTested':False,'checks':[],'installerChecksPassed':False,'sdkInitialized':False}
    control=None
    try:
        exe,manifest=receive(root);report.update(buildSha=manifest['buildSha'],sha256=manifest['sha256'],os=os.environ['JP_TEST_SLOT'])
        damaged=root/'damaged.exe';data=bytearray(exe.read_bytes())
        with zipfile.ZipFile(exe) as z:entry=z.getinfo('sdk/Bin/NBioBSP.dll')
        offset=entry.header_offset;name_len,extra_len=struct.unpack_from('<HH',data,offset+26)
        data[offset+30+name_len+extra_len+entry.compress_size//2]^=0x80
        damaged.write_bytes(data)
        code,result=invoke(damaged)
        assert code!=0 and result['code']=='PACKAGE_INVALID',result
        assert not (home/'control.key').exists(),'Corrupt package changed agent identity'
        report['checks'].append({'case':'corrupt-package','rejectedBeforeInstall':True})
        key_hash=None
        for attempt in range(3):
            if attempt==2:
                shutdown(control)
                registered=home/'sdk-5.2.0.6-jp1'
                shutil.move(str(registered),str(root/'registered-before-repair'))
                url='https://www.jptreinamentos.com.br/EntregaEPI/build-inputs/biometria-chrome-runtime-3455fbf7588a.zip'
                with urllib.request.urlopen(url,timeout=120) as r:legacy=r.read(140*1024*1024)
                assert hashlib.sha256(legacy).hexdigest()=='3455fbf7588aa954a11438bcb9c9c3066e627f2236e420df0cace9eae15b47ad'
                legacy_root=home/'sdk-5.2.0.6'
                with zipfile.ZipFile(io.BytesIO(legacy)) as z:
                    for n in z.namelist():
                        if n.startswith('amd64/sdk/'):
                            target=legacy_root/n.removeprefix('amd64/sdk/');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(n))
                old_dll=next(legacy_root.rglob('NBioBSP.dll'));old_hash=hashlib.sha256(old_dll.read_bytes()).hexdigest()
            code,result=invoke(exe)
            assert code==1 and result['ok'] is False and result['code']=='READER_NOT_FOUND',result
            key=read_test_key(home/'control.key');digest=hashlib.sha256(key).hexdigest()
            if key_hash:assert digest==key_hash,'Station identity changed'
            key_hash=digest;control=LocalControl(key);owned=control.owned()
            assert len(owned)==1 and owned[0]['buildSha']==manifest['buildSha']
            _,status=control.json(owned[0]['port'],'/status')
            assert status['sdk'] is True and status['reader'] is False and status['ok'] is False
            assert status['errorCode']=='READER_NOT_FOUND',status['errorCode']
            assert status['javaArch'] in ('amd64','x86_64')
            if attempt==2:assert hashlib.sha256(old_dll.read_bytes()).hexdigest()==old_hash,'Earlier SDK changed'
            report['checks'].append({'case':['clean-install','reinstall','repair-legacy-sdk'][attempt],'sdkInitialized':True,'identityPreserved':True,'ownedInstances':1})
        report['installerChecksPassed']=True;report['sdkInitialized']=True
    finally:
        if control:shutdown(control)
        Path('.deploy/unified-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report),flush=True)

if __name__=='__main__':main()
