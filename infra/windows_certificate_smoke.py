#!/usr/bin/env python3
"""Exercise the production PowerShell signer with an ephemeral synthetic A1.
No client certificate, biometric device, or real credentials are used.
"""
import base64,json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def powershell(script,data=None):
 exe=Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
 p=subprocess.run([str(exe),'-NoProfile','-STA','-EncodedCommand',base64.b64encode(script.encode('utf-16le')).decode()],input=(json.dumps(data)+'\n') if data else None,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
 if p.returncode:raise RuntimeError(p.stderr[-6000:])
 return p.stdout.strip()
with tempfile.TemporaryDirectory(prefix='jpged-win-test-') as folder:
 subprocess.run(['python',str(ROOT/'backend/test/helpers/jpged-fixture.py'),folder],check=True)
 path=Path(folder);pfx=str(path/'synthetic.pfx').replace("'","''")
 setup="$ErrorActionPreference='Stop'; $c=New-Object Security.Cryptography.X509Certificates.X509Certificate2; $c.Import('"+pfx+"','synthetic-test-only',[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet -bor [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet); $s=New-Object Security.Cryptography.X509Certificates.X509Store('My','CurrentUser');$s.Open('ReadWrite');$s.Add($c);$s.Close();$c.Thumbprint"
 thumbprint=powershell(setup)
 try:
  assert len(thumbprint)==40
  content=b'JPGED SYNTHETIC WINDOWS SIGNATURE';(path/'content').write_bytes(content)
  answer=json.loads(powershell((ROOT/'native/biometria/certificates.ps1').read_text(encoding='utf-8').replace('} catch {\n    # Never','} catch {\n    throw\n    # Never'),{'action':'sign','thumbprint':thumbprint,'contentBase64':base64.b64encode(content).decode()}))
  assert answer.get('ok'),answer
  (path/'signed.der').write_bytes(base64.b64decode(answer['cms']))
  subprocess.run(['node',str(ROOT/'backend/test/helpers/verify-windows-cms.js'),folder],check=True)
 finally:
  powershell("$s=New-Object Security.Cryptography.X509Certificates.X509Store('My','CurrentUser');$s.Open('ReadWrite');foreach($c in $s.Certificates){if($c.Thumbprint -eq '"+thumbprint+"'){$s.Remove($c)}};$s.Close();exit 0")
print('Windows certificate signing verified: synthetic CMS, CNPJ, ESS, chain and revocation; no client certificate used.')
