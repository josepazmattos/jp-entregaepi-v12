import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import dns from 'node:dns/promises';import https from 'node:https';import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import * as asn1 from 'asn1js';
import * as pki from 'pkijs';
import {verifyCompanyCms,publicAddress,trustRoots,fetchCrl,issuerCertificates,verifyIcpPath} from '../src/services/jpged-pki.js';
import {buildSigningPdf,embedCms,signingBytes} from '../src/services/jpged-pdf.js';
const dir=mkdtempSync(join(tmpdir(),'jpged-crypto-'));after(()=>rmSync(dir,{recursive:true,force:true}));
execFileSync('python3',[new URL('./helpers/jpged-fixture.py',import.meta.url).pathname,dir]);
const root=new pki.Certificate({schema:asn1.fromBER(readFileSync(join(dir,'root.der'))).result});
const options={roots:[root],loadCrl:async()=>readFileSync(join(dir,'fresh.crl'))};
function sign(content,variant='leaf'){writeFileSync(join(dir,'content'),content);execFileSync('openssl',['cms','-sign','-binary','-cades','-md','sha256','-in',join(dir,'content'),'-signer',join(dir,variant+'.pem'),'-inkey',join(dir,variant+'.key'),'-certfile',join(dir,variant==='chain'?'chain-ca.pem':'root.pem'),'-outform','DER','-out',join(dir,'signed.der')]);return readFileSync(join(dir,'signed.der'));}
const content=Buffer.from('JPGED SYNTHETIC DOCUMENT'),cms=sign(content);
test('CAdES real verifica assinatura, CNPJ, cadeia, ESS e revogação',async()=>{const r=await verifyCompanyCms(cms,content,'12345678000195',options);assert.equal(r.certificate.cnpj,'12345678000195');assert.equal(r.evidence.crls.length,1);assert.equal(r.evidence.certificates.length,2);});
test('documento adulterado e CNPJ de outra empresa são recusados',async()=>{await assert.rejects(verifyCompanyCms(cms,Buffer.from('changed'),'12345678000195',options),{code:'CERTIFICADO_ASSINATURA_INVALIDA'});await assert.rejects(verifyCompanyCms(cms,content,'99999999000199',options),{code:'CERTIFICADO_EMPRESA_DIVERGENTE'});});
test('certificado não confiável ou vencido é recusado antes de buscar LCR',async()=>{let fetched=false;await assert.rejects(verifyCompanyCms(cms,content,'12345678000195',{roots:[],loadCrl:async()=>{fetched=true;}}),{code:'CERTIFICADO_CADEIA_INCOMPLETA'});assert.equal(fetched,false);await assert.rejects(verifyCompanyCms(cms,content,'12345678000195',{...options,now:new Date(Date.now()+60*86400000)}),{code:'CERTIFICADO_VENCIDO'});});
test('revogado, LCR vencida e rede indisponível não concluem',async()=>{await assert.rejects(verifyCompanyCms(cms,content,'12345678000195',{...options,loadCrl:async()=>readFileSync(join(dir,'revoked.crl'))}),{code:'CERTIFICADO_REVOGADO'});for(const loadCrl of [async()=>readFileSync(join(dir,'expired.crl')),async()=>{throw new Error('NETWORK');}])await assert.rejects(verifyCompanyCms(cms,content,'12345678000195',{...options,loadCrl}),{code:'CERTIFICADO_REVOGACAO_INDISPONIVEL'});});
test('endereços privados, loopback, metadata e IPv4 mapeado são bloqueados',()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(ip),false,ip);assert.equal(publicAddress('8.8.8.8'),true);});
test('raízes de produção são oficiais e excluem CA sintética',()=>{assert.ok(trustRoots().length>=2);for(const cert of trustRoots())assert.notEqual(Buffer.from(cert.toSchema(true).toBER(false)).toString('hex'),readFileSync(join(dir,'root.der')).toString('hex'));});
test('PDF com entrega e devolução preserva ByteRange e valida CMS incorporado',async()=>{const ficha={id:'synthetic',numero:'TESTE',empresaId:'company',trabalhadorId:'worker',trabalhadorNome:'COLABORADOR SINTÉTICO',tipo:'Mista',data:'10/10/2026',empresaSnapshot:{nome:'EMPRESA SINTÉTICA',cnpj:'12345678000195'},trabalhadorSnapshot:{nomeCompleto:'COLABORADOR SINTÉTICO'},assinaturaBiometrica:{id:'bio',signedAt:new Date().toISOString(),dedo:'R_INDEX'},itens:Array.from({length:60},(_,i)=>({quantidade:i+1,epiNome:'CAPACETE DE SEGURANÇA',ca:'365',datasMovimentacao:i%2?{devolucao:'10/10/2026'}:{entrega:'10/10/2026'}}))};const r=await buildSigningPdf(ficha,{subject:'SYNTHETIC COMPANY'}),signature=sign(r.signedBytes),final=embedCms(r.pdf,r.start,r.end,signature);assert.deepEqual(signingBytes(final,r.start,r.end),r.signedBytes);await verifyCompanyCms(signature,signingBytes(final,r.start,r.end),'12345678000195',options);writeFileSync(join(dir,'signed.pdf'),final);if(process.env.JPGED_PDF_OUTPUT)writeFileSync(process.env.JPGED_PDF_OUTPUT,final);const dump=execFileSync('pdftotext',[join(dir,'signed.pdf'),'-']).toString();assert.match(dump,/CAPACETE/);assert.match(dump,/Devolução/);assert.match(dump,/60/);});

test('busca de LCR fixa o IP público resolvido e recusa destino privado antes do HTTP',async t=>{let sent=0;const request=new EventEmitter();request.destroy=error=>{request.emit('error',error);request.emit('close');};t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);t.mock.method(https,'get',(url,options,handle)=>{sent++;assert.equal(options.family,4);assert.equal(options.autoSelectFamily,false);options.lookup('synthetic.invalid',{all:true},(error,values)=>assert.deepEqual(values,[{address:'8.8.8.8',family:4}]));queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=200;handle(response);response.emit('data',Buffer.from('CRL'));response.emit('end');request.emit('close');});return request;});assert.deepEqual(await fetchCrl('https://synthetic.invalid/root.crl'),Buffer.from('CRL'));t.mock.method(dns,'lookup',async()=>[{address:'127.0.0.1',family:4}]);await assert.rejects(fetchCrl('https://synthetic.invalid/root.crl'),{code:'CRL_ADDRESS'});assert.equal(sent,1);});

const pfTarget={companyId:'company',registrationType:'CNPJ',registrationNumber:'12345678000195'};
test('e-CPF A1 aceita legado SAN e serialNumber sem cadastro de representante',async()=>{for(const variant of ['pf','pf-serial']){const result=await verifyCompanyCms(sign(content,variant),content,pfTarget,options);assert.equal(result.certificate.kind,'e-CPF');assert.equal(result.certificate.cpf,'12345678909');assert.equal(result.certificate.cnpj,undefined);}});
test('e-CPF atende empregador CAEPF sem pesquisa de representante; e-CNPJ divergente é recusado',async()=>{const target={...pfTarget,registrationType:'CAEPF',registrationNumber:'12345678900001'};assert.equal((await verifyCompanyCms(sign(content,'pf'),content,target,options)).certificate.kind,'e-CPF');await assert.rejects(verifyCompanyCms(cms,content,target,options),{code:'CERTIFICADO_EMPRESA_DIVERGENTE'});});
test('identidades conflitantes e certificado A3 não são tratados como A1',async()=>{await assert.rejects(verifyCompanyCms(sign(content,'pf-conflict'),content,pfTarget,options),{code:'CERTIFICADO_IDENTIDADE'});await assert.rejects(verifyCompanyCms(sign(content,'pf-a3'),content,pfTarget,options),{code:'CERTIFICADO_TIPO'});});

test('cadeia com intermediária exige validação e LCR de todos os níveis',async()=>{const result=await verifyCompanyCms(sign(content,'chain'),content,'12345678000195',{...options,loadCrl:async url=>readFileSync(join(dir,url.endsWith('/intermediate.crl')?'intermediate.crl':'fresh.crl'))});assert.equal(result.evidence.certificates.length,3);assert.equal(result.evidence.crls.length,2);await assert.rejects(verifyCompanyCms(sign(content,'chain'),content,'12345678000195',options),{code:'CERTIFICADO_REVOGACAO_INDISPONIVEL'});});

test('A1 sem intermediária completa cadeia e preserva validação criptográfica e revogação',async()=>{
  const intermediate=new pki.Certificate({schema:asn1.fromBER(readFileSync(join(dir,'intermediate.der'))).result});
  const info=new pki.ContentInfo({schema:asn1.fromBER(sign(content,'chain')).result}),signed=new pki.SignedData({schema:info.content});
  signed.certificates=signed.certificates.filter(cert=>!cert.extensions?.find(x=>x.extnID==='2.5.29.19')?.parsedValue?.cA);
  info.content=signed.toSchema(true);const leafOnly=Buffer.from(info.toSchema().toBER(false));
  await assert.rejects(verifyCompanyCms(leafOnly,content,'12345678000195',{...options,intermediates:[]}),{code:'CERTIFICADO_CADEIA_INCOMPLETA'});
  const config={...options,intermediates:[intermediate],loadCrl:async url=>readFileSync(join(dir,url.endsWith('/intermediate.crl')?'intermediate.crl':'fresh.crl'))};
  const result=await verifyCompanyCms(leafOnly,content,'12345678000195',config);assert.equal(result.evidence.certificates.length,3);assert.equal(result.evidence.crls.length,2);
  await assert.rejects(verifyCompanyCms(leafOnly,content,'12345678000195',{...config,roots:[]}),{code:'CERTIFICADO_CADEIA_INCOMPLETA'});
  await assert.rejects(verifyCompanyCms(leafOnly,Buffer.from('changed'),'12345678000195',config),{code:'CERTIFICADO_ASSINATURA_INVALIDA'});
});

test('mensagens distinguem A1 vencido, ainda não válido e cadeia emissora vencida',async()=>{
  const leaf=new pki.Certificate({schema:asn1.fromBER(readFileSync(join(dir,'chain.der'))).result});
  const expired=new pki.Certificate({schema:asn1.fromBER(readFileSync(join(dir,'intermediate-expired.der'))).result});
  await assert.rejects(verifyIcpPath(leaf,[],{roots:[root],intermediates:[expired]}),{code:'CERTIFICADO_EMISSORA_FORA_VALIDADE'});
  await assert.rejects(verifyIcpPath(leaf,[],{roots:[root],intermediates:[],now:new Date(Date.now()-3*86400000)}),{code:'CERTIFICADO_AINDA_NAO_VALIDO'});
  await assert.rejects(verifyIcpPath(leaf,[],{roots:[root],intermediates:[],now:new Date(Date.now()+60*86400000)}),{code:'CERTIFICADO_VENCIDO'});
});

test('intermediárias oficiais SAFEWEB/RFB validam até raiz ICP-Brasil existente',async()=>{
  const candidates=issuerCertificates();assert.equal(candidates.length,2);
  for(const cert of candidates){const result=await verifyIcpPath(cert,[],{now:new Date('2026-10-11T03:00:00Z')});assert.ok(result.path.length>=2);assert.ok(trustRoots().some(root=>Buffer.from(root.toSchema(true).toBER(false)).equals(Buffer.from(result.path.at(-1).toSchema(true).toBER(false)))));}
});
