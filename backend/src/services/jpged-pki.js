import { webcrypto, X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import * as asn1 from 'asn1js';
import * as pki from 'pkijs';
import { sha256 } from './document-integrity.js';
import { normalizeCpf } from './certificate-identity.js';
import { httpError } from '../middleware/auth.js';

pki.setEngine('node', webcrypto, new pki.CryptoEngine({ name:'node',crypto:webcrypto,subtle:webcrypto.subtle }));
const reject = (message, code = 'CERTIFICADO_INVALIDO', status = 422) => { throw httpError(status,message,code); };
const der = cert => Buffer.from(cert.toSchema(true).toBER(false));
function parse(bytes) {const block=asn1.fromBER(bytes);if(block.offset!==bytes.length)reject('Estrutura da assinatura inválida.');return block.result;}
export function trustRoots() {
  const directory=new URL('../data/icp-brasil/',import.meta.url);
  const files=readdirSync(directory).filter(name=>/^raiz-v(?:4|5|6|7|12)\.crt$/.test(name));
  if(!files.length)reject('A cadeia oficial ICP-Brasil ainda não está disponível.','ICP_TRUST_UNAVAILABLE',503);
  return files.map(name=>{const cert=new X509Certificate(readFileSync(new URL(name,directory)));return new pki.Certificate({schema:parse(cert.raw)});});
}
export function publicAddress(address) {try{return ipaddr.process(address).range()==='unicast';}catch{return false;}}
// Download only CRLs from a cryptographically trusted chain. Resolve and pin DNS;
// no redirects, credentials, arbitrary ports, loopback, metadata or private ranges.
export async function fetchCrl(url) {
  const target=new URL(url);
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.port||target.hash||target.hostname.length>253)reject('Endereço de revogação não permitido.','CRL_ADDRESS');
  const addresses=await dns.lookup(target.hostname,{all:true});
  if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))reject('Endereço de revogação não permitido.','CRL_ADDRESS');
  return new Promise((resolve,rejectPromise)=>{
    const chosen=addresses[0];
    const request=(target.protocol==='https:'?https:http).get(target,{family:chosen.family,autoSelectFamily:false,lookup:(host,options,callback)=>options.all?callback(null,[chosen]):callback(null,chosen.address,chosen.family),timeout:6000,headers:{Accept:'application/pkix-crl, application/octet-stream'}},response=>{
      if(response.statusCode!==200){response.resume();rejectPromise(new Error('CRL_HTTP'));return;}
      const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>24*1024*1024){request.destroy(new Error('CRL_LIMIT'));return;}chunks.push(chunk);});response.on('end',()=>resolve(Buffer.concat(chunks)));response.on('error',rejectPromise);
    });const deadline=setTimeout(()=>request.destroy(new Error('CRL_DEADLINE')),7000);request.on('close',()=>clearTimeout(deadline));request.on('timeout',()=>request.destroy(new Error('CRL_TIMEOUT')));request.on('error',rejectPromise);
  });
}
const crlCache=new Map();
function certificateIdentity(cert) {
  const san=cert.extensions?.find(x=>x.extnID==='2.5.29.17')?.parsedValue;
  const fields=new Map();
  for(const name of san?.altNames||[]) {
    if(name.type!==0)continue;
    const elements=name.value?.valueBlock?.value||[],oid=elements[0]?.valueBlock?.toString();
    if(!['2.16.76.1.3.3','2.16.76.1.3.1'].includes(oid))continue;
    const value=elements[1]?.valueBlock?.value?.[0];
    const text=typeof value?.valueBlock?.value==='string'?value.valueBlock.value:Buffer.from(value?.valueBlock?.valueHexView||[]).toString('utf8');
    if(fields.has(oid))reject('Identificação duplicada no certificado.','CERTIFICADO_IDENTIDADE');fields.set(oid,text);
  }
  const serials=(cert.subject.typesAndValues||[]).filter(x=>x.type==='2.5.4.5').map(x=>x.value.valueBlock.value);
  if(serials.length>1)reject('Identificação ambígua no certificado.','CERTIFICADO_IDENTIDADE');
  const cnpj=fields.get('2.16.76.1.3.3');
  if(cnpj!==undefined){if(!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj))reject('CNPJ inválido no certificado.','CERTIFICADO_IDENTIDADE');return {kind:'e-CNPJ',cnpj};}
  // ICP-Brasil: legacy otherName = 8 birth-date characters + 11 CPF.
  // Modern profiles also use subject serialNumber (Resolution 211).
  const legacy=fields.get('2.16.76.1.3.1'),legacyCpf=legacy?.slice(8,19),serial=serials[0];
  if(legacy!==undefined&&(!/^\d{19}/.test(legacy)||!legacyCpf))reject('CPF inválido no certificado.','CERTIFICADO_IDENTIDADE');
  if(serial!==undefined&&!/^\d{11}$/.test(serial))reject('Use um certificado A1 de pessoa física ou jurídica.','CERTIFICADO_IDENTIDADE');
  if(legacyCpf&&serial&&legacyCpf!==serial)reject('Identificadores de CPF divergentes no certificado.','CERTIFICADO_IDENTIDADE');
  let cpf;try{cpf=normalizeCpf(serial||legacyCpf);}catch{reject('CPF ausente ou inválido no certificado.','CERTIFICADO_IDENTIDADE');}
  return {kind:'e-CPF',cpf};
}
export async function verifyCompanyCms(cmsBytes, content, companyIdentity, { roots = null, loadCrl = fetchCrl, now = new Date() } = {}) {
  if(!Buffer.isBuffer(cmsBytes)||cmsBytes.length>32768||cmsBytes.length<100)reject('Assinatura digital ausente ou muito grande.');
  let signed, signer;
  try {
    const info=new pki.ContentInfo({schema:parse(cmsBytes)});
    if(info.contentType!=='1.2.840.113549.1.7.2')throw new Error();
    signed=new pki.SignedData({schema:info.content});
    if(signed.signerInfos.length!==1||signed.encapContentInfo.eContent||signed.encapContentInfo.eContentType!=='1.2.840.113549.1.7.1'||signed.certificates.length>10)throw new Error();
    const attrs=signed.signerInfos[0].signedAttrs?.attributes;
    if(!attrs||new Set(attrs.map(x=>x.type)).size!==attrs.length||signed.signerInfos[0].digestAlgorithm.algorithmId!=='2.16.840.1.101.3.4.2.1')throw new Error();
    const verified=await signed.verify({signer:0,data:content,checkChain:false,extendedMode:true,checkDate:now});
    if(!verified.signatureVerified)throw new Error();signer=verified.signerCertificate;
    // CAdES/PAdES binds the signed attributes to the exact signing certificate.
    const ess=attrs.find(x=>x.type==='1.2.840.113549.1.9.16.2.47');
    const certId=ess?.values?.[0]?.valueBlock?.value?.[0]?.valueBlock?.value?.[0]?.valueBlock?.value;
    if(!certId||(certId.length<1||certId.length>2)||!(certId[0] instanceof asn1.OctetString)||Buffer.from(certId[0].valueBlock.valueHexView).toString('hex')!==sha256(der(signer)))throw new Error();
  }catch(e){if(e.status)throw e;reject('A assinatura não corresponde ao documento ou ao certificado.','CERTIFICADO_ASSINATURA_INVALIDA');}
  const identity=certificateIdentity(signer),target=typeof companyIdentity==='string'?{registrationType:'CNPJ',registrationNumber:companyIdentity}:companyIdentity;
  const expected=String(target?.registrationNumber||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(identity.kind==='e-CNPJ') {
    if(target?.registrationType!=='CNPJ'||identity.cnpj!==expected)reject('O CNPJ do certificado é diferente do cadastro da empresa.','CERTIFICADO_EMPRESA_DIVERGENTE');
  }
  // e-CPF identifies the signer. No corporate-role lookup or administrative
  // representative approval is required; configuration records local consent.
  if(signer.extensions?.find(x=>x.extnID==='2.5.29.19')?.parsedValue?.cA)reject('Use um certificado de pessoa física ou jurídica.');
  const usage=signer.extensions?.find(x=>x.extnID==='2.5.29.15')?.parsedValue?.valueBlock?.valueHexView;
  if(!usage||!(usage[0]&0xc0))reject('O certificado não permite assinatura de documentos.');
  const policies=signer.extensions?.find(x=>x.extnID==='2.5.29.32')?.parsedValue?.certificatePolicies||[];
  if(!policies.some(x=>/^2\.16\.76\.1\.2\.1\.\d+$/.test(x.policyIdentifier)))reject('Nesta versão, utilize um certificado ICP-Brasil A1 e-CPF ou e-CNPJ.','CERTIFICADO_TIPO');
  const trusted=roots||trustRoots(),certs=signed.certificates.filter(x=>x instanceof pki.Certificate&&x!==signer).concat(signer);
  const initial=await new pki.CertificateChainValidationEngine({trustedCerts:trusted,certs,checkDate:now}).verify();
  if(!initial.result)reject('Certificado vencido, inválido ou sem cadeia ICP-Brasil confiável.','CERTIFICADO_CADEIA_INVALIDA');
  const path=initial.certificatePath;
  if(!path||path.length<2)reject('Cadeia ICP-Brasil incompleta.');
  const evidence=await Promise.all(path.slice(0,-1).map(async(cert,index)=>{
    const urls=(cert.extensions?.find(x=>x.extnID==='2.5.29.31')?.parsedValue?.distributionPoints||[]).flatMap(point=>Array.isArray(point.distributionPoint)?point.distributionPoint.filter(x=>x.type===6).map(x=>x.value):[]).slice(0,3);
    if(!urls.length)reject('O certificado não fornece consulta de revogação.','CERTIFICADO_REVOGACAO_INDISPONIVEL');
    for(const url of urls)try{
      const cacheKey=sha256(der(path[index+1]))+url,cached=loadCrl===fetchCrl?crlCache.get(cacheKey):null;
      const bytes=cached&&cached.until>now.getTime()?cached.bytes:await loadCrl(url);
      const crl=new pki.CertificateRevocationList({schema:parse(bytes)});
      if(crl.thisUpdate.value>now||!crl.nextUpdate||crl.nextUpdate.value<=now||!crl.issuer.isEqual(path[index+1].subject)||!await crl.verify({issuerCertificate:path[index+1]}))continue;
      if(crl.crlExtensions?.extensions?.some(x=>x.extnID==='2.5.29.27'||x.extnID==='2.5.29.28'))continue; // delta/indirect CRLs require separate support
      if(crl.isCertificateRevoked(cert))reject('O certificado foi revogado.','CERTIFICADO_REVOGADO');
      if(loadCrl===fetchCrl){if(crlCache.size>=8||[...crlCache.values()].reduce((size,item)=>size+item.bytes.length,0)+bytes.length>64*1024*1024)crlCache.clear();crlCache.set(cacheKey,{bytes,until:Math.min(crl.nextUpdate.value.getTime(),now.getTime()+300000)});}
      return {crl,bytes,url};
    }catch(e){if(e.code==='CERTIFICADO_REVOGADO')throw e;}
    reject('Não foi possível verificar a revogação. A certificação continua pendente; tente novamente.','CERTIFICADO_REVOGACAO_INDISPONIVEL',503);
  }));
  const checked=await new pki.CertificateChainValidationEngine({trustedCerts:trusted,certs,crls:evidence.map(x=>x.crl),checkDate:now}).verify({passedWhenNotRevValues:false});
  if(!checked.result)reject('A cadeia ou a revogação do certificado não foi confirmada.','CERTIFICADO_CADEIA_INVALIDA');
  const nodeCert=new X509Certificate(der(signer));
  return {certificate:{fingerprint:sha256(der(signer)),thumbprint:nodeCert.fingerprint.replaceAll(':',''),...identity,subject:nodeCert.subject,issuer:nodeCert.issuer,validTo:signer.notAfter.value.toISOString(),validFrom:signer.notBefore.value.toISOString()},evidence:{checkedAt:now.toISOString(),rootSha256:sha256(der(path[path.length-1])),certificates:path.map(x=>der(x).toString('base64')),crls:evidence.map(x=>({url:x.url,sha256:sha256(x.bytes),der:x.bytes.toString('base64')}))}};
}
