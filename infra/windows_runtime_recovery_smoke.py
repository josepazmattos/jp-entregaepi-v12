"""Exercise the shipped EXE with two original SDK installations, without USB capture."""
import hashlib, io, json, os, shutil, time, urllib.request, zipfile
from pathlib import Path
import windows_biometria_smoke as smoke

base_run = smoke.WindowsSmoke.run

def run(self):
    base_run(self)
    url='https://www.jptreinamentos.com.br/EntregaEPI/build-inputs/biometria-runtime-d821d5dc.zip'
    with urllib.request.urlopen(url,timeout=60) as response: data=response.read(90*1024*1024)
    assert hashlib.sha256(data).hexdigest()=='d821d5dc768a51f741fd322d480f851058b39429356d1df13aa84e216bccccf9'
    managed=self.install_dir/'sdk-5.2.0.6'
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        for entry in manifest['files']:
            name=entry['name']
            if not name.startswith('sdk/'): continue
            assert '..' not in name and '\\' not in name
            content=archive.read(name)
            assert len(content)==entry['size'] and hashlib.sha256(content).hexdigest()==entry['sha256']
            target=managed/name[4:];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(content)
    programs=self.root/'Vendor Programs'
    vendor=programs/'Vendor Tools/NITGEN/previous SDK/SDK'
    shutil.copytree(managed,vendor)
    original_hashes={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in managed.rglob('*') if p.is_file()}
    overrides={'programfiles','programfiles(x86)','programw6432','jp_biometria_sdk'}
    self.environment={k:v for k,v in self.environment.items() if k.casefold() not in overrides}
    for key in ('ProgramFiles','ProgramFiles(x86)','ProgramW6432'): self.environment[key]=str(programs)
    result=self.launch(self.source/smoke.EXECUTABLE,['--install-quiet'],quiet=True)
    self.adopt_key();self.assert_registry()
    own=self.one_instance(result['port'])
    report=json.loads((self.install_dir/'runtime-diagnostic.json').read_text())
    assert report['sdkInitialized'] is False
    assert len(report['attempts'])==2 and all(a['code']=='NITGEN_15' and a['initialized'] is False for a in report['attempts'])
    assert report['attempts'][0]['sdk']==str(vendor) and report['attempts'][1]['sdk']==str(managed)
    assert not (self.install_dir/'runtime-verified.json').exists()
    for p,h in original_hashes.items(): assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h
    until=time.monotonic()+10
    while True:
        _,status=self.control.json(own['port'],'/status')
        if not status.get('checking') and status.get('errorCode')!='INITIALIZING':break
        assert time.monotonic()<until;time.sleep(.1)
    assert status['errorCode']=='NITGEN_15' and status['reader'] is False and status['ok'] is False
    for name in ['existingSDKNotHiddenByBundle','originalSDKProbedInSeparateJVMs','validityFailureNeverCachedOrReady','vendorLibrariesPreserved']:
        self.passed(name)

smoke.WindowsSmoke.run=run
if __name__=='__main__': raise SystemExit(smoke.main())
