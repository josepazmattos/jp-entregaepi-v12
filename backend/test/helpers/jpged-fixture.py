"""Ephemeral synthetic CA, never included in application trust roots."""
from cryptography import x509
from cryptography.x509.oid import NameOID,ObjectIdentifier
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime,timezone,timedelta
from pathlib import Path
import sys
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
now=datetime.now(timezone.utc); rootkey=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SYNTHETIC JPGED TEST ROOT')])
root=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(rootkey.public_key()).serial_number(1).not_valid_before(now-timedelta(days=2)).not_valid_after(now+timedelta(days=30)).add_extension(x509.BasicConstraints(ca=True,path_length=1),True).add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),True).sign(rootkey,hashes.SHA256())
leafkey=rsa.generate_private_key(public_exponent=65537,key_size=2048)
leaf=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SYNTHETIC COMPANY')])).issuer_name(name).public_key(leafkey.public_key()).serial_number(2).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=10)).add_extension(x509.BasicConstraints(ca=False,path_length=None),True).add_extension(x509.KeyUsage(True,True,False,False,False,False,False,False,False),True).add_extension(x509.SubjectAlternativeName([x509.OtherName(ObjectIdentifier('2.16.76.1.3.3'),b'\x0c\x0e12345678000195')]),False).add_extension(x509.CertificatePolicies([x509.PolicyInformation(ObjectIdentifier('2.16.76.1.2.1.999'),None)]),False).add_extension(x509.CRLDistributionPoints([x509.DistributionPoint(full_name=[x509.UniformResourceIdentifier('https://synthetic.invalid/root.crl')],relative_name=None,reasons=None,crl_issuer=None)]),False).sign(rootkey,hashes.SHA256())
for n,c in [('root',root),('leaf',leaf)]:
 (out/(n+'.pem')).write_bytes(c.public_bytes(serialization.Encoding.PEM));(out/(n+'.der')).write_bytes(c.public_bytes(serialization.Encoding.DER))
(out/'leaf.key').write_bytes(leafkey.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
from cryptography.hazmat.primitives.serialization.pkcs12 import serialize_key_and_certificates
(out/'synthetic.pfx').write_bytes(serialize_key_and_certificates(b'Synthetic',leafkey,leaf,[root],serialization.BestAvailableEncryption(b'synthetic-test-only')))
for variant in ['fresh','revoked','expired']:
 b=x509.CertificateRevocationListBuilder().issuer_name(name).last_update(now-timedelta(hours=1)).next_update(now+timedelta(days=1) if variant!='expired' else now-timedelta(minutes=1))
 if variant=='revoked':b=b.add_revoked_certificate(x509.RevokedCertificateBuilder().serial_number(2).revocation_date(now-timedelta(minutes=30)).build())
 (out/(variant+'.crl')).write_bytes(b.sign(rootkey,hashes.SHA256()).public_bytes(serialization.Encoding.DER))
# PF variants exercise both ICP-Brasil identifiers; no real person's credentials.
for variant in ['pf','pf-serial','pf-conflict','pf-a3']:
 key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
 subject=[x509.NameAttribute(NameOID.COMMON_NAME,'SYNTHETIC PERSON')]
 if variant in ['pf-serial','pf-conflict']:subject.append(x509.NameAttribute(NameOID.SERIAL_NUMBER,'98765432100' if variant=='pf-conflict' else '12345678909'))
 builder=x509.CertificateBuilder().subject_name(x509.Name(subject)).issuer_name(name).public_key(key.public_key()).serial_number(10+len(variant)).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=10)).add_extension(x509.BasicConstraints(ca=False,path_length=None),True).add_extension(x509.KeyUsage(True,True,False,False,False,False,False,False,False),True)
 if variant!='pf-serial':
  data=b'0101199012345678909'
  builder=builder.add_extension(x509.SubjectAlternativeName([x509.OtherName(ObjectIdentifier('2.16.76.1.3.1'),bytes([12,len(data)])+data)]),False)
 cert=builder.add_extension(x509.CertificatePolicies([x509.PolicyInformation(ObjectIdentifier('2.16.76.1.2.'+('3' if variant=='pf-a3' else '1')+'.999'),None)]),False).add_extension(x509.CRLDistributionPoints([x509.DistributionPoint(full_name=[x509.UniformResourceIdentifier('https://synthetic.invalid/root.crl')],relative_name=None,reasons=None,crl_issuer=None)]),False).sign(rootkey,hashes.SHA256())
 (out/(variant+'.pem')).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
 (out/(variant+'.der')).write_bytes(cert.public_bytes(serialization.Encoding.DER))
 (out/(variant+'.key')).write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
 (out/(variant+'.pfx')).write_bytes(serialize_key_and_certificates(b'Synthetic PF',key,cert,[root],serialization.BestAvailableEncryption(b'synthetic-test-only')))

# An intermediate CA tests complete-chain assembly rather than only root/leaf.
ikey=rsa.generate_private_key(public_exponent=65537,key_size=2048)
iname=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SYNTHETIC INTERMEDIATE')])
intermediate=x509.CertificateBuilder().subject_name(iname).issuer_name(name).public_key(ikey.public_key()).serial_number(30).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=20)).add_extension(x509.BasicConstraints(ca=True,path_length=0),True).add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),True).add_extension(x509.CRLDistributionPoints([x509.DistributionPoint(full_name=[x509.UniformResourceIdentifier('https://synthetic.invalid/root.crl')],relative_name=None,reasons=None,crl_issuer=None)]),False).sign(rootkey,hashes.SHA256())
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
b=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'SYNTHETIC CHAIN COMPANY')])).issuer_name(iname).public_key(key.public_key()).serial_number(31).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=10))
for ext in leaf.extensions:
 if ext.oid.dotted_string!='2.5.29.31':b=b.add_extension(ext.value,ext.critical)
b=b.add_extension(x509.CRLDistributionPoints([x509.DistributionPoint(full_name=[x509.UniformResourceIdentifier('https://synthetic.invalid/intermediate.crl')],relative_name=None,reasons=None,crl_issuer=None)]),False)
cert=b.sign(ikey,hashes.SHA256())
(out/'chain.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM));(out/'chain.der').write_bytes(cert.public_bytes(serialization.Encoding.DER))
(out/'chain.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
(out/'chain-ca.pem').write_bytes(intermediate.public_bytes(serialization.Encoding.PEM)+root.public_bytes(serialization.Encoding.PEM))
(out/'intermediate.der').write_bytes(intermediate.public_bytes(serialization.Encoding.DER))
(out/'chain.pfx').write_bytes(serialize_key_and_certificates(b'Synthetic chain',key,cert,[intermediate,root],serialization.BestAvailableEncryption(b'synthetic-test-only')))
(out/'intermediate.crl').write_bytes(x509.CertificateRevocationListBuilder().issuer_name(iname).last_update(now-timedelta(hours=1)).next_update(now+timedelta(days=1)).sign(ikey,hashes.SHA256()).public_bytes(serialization.Encoding.DER))
