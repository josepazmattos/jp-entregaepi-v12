import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {sign,createPrivateKey,X509Certificate} from 'node:crypto';
import * as asn1 from 'asn1js';import * as pki from 'pkijs';
import {detachedCms} from '../src/services/jpged-cms.js';import {createVaultService} from '../src/services/jpged-vault.js';
import {verifyCompanyCms} from '../src/services/jpged-pki.js';import {createGedStorage} from '../src/db/jpged.js';
const dir=mkdtempSync(join(tmpdir(),'jpged-vault-'));after(()=>rmSync(dir,{recursive:true,force:true}));
execFileSync('python3',[new URL('./helpers/jpged-fixture.py',import.meta.url).pathname,dir]);
const root=new pki.Certificate({schema:asn1.fromBER(readFileSync(join(dir,'root.der'))).result});
const options={roots:[root],loadCrl:async()=>readFileSync(join(dir,'fresh.crl'))};
const validate=(cms,content,target)=>verifyCompanyCms(cms,content,target,options);
const company={id:'company',nome:'EMPRESA SINTÉTICA',cnpj:'12345678000195'};
function fixture(variant='leaf'){
 const ged=createGedStorage({memory:true}),key=createPrivateKey(readFileSync(join(dir,variant+'.key'))),leaf=new X509Certificate(readFileSync(join(dir,variant+'.pem')));
 const chain=[leaf.raw.toString('base64'),readFileSync(join(dir,'root.der')).toString('base64')],calls=[];
 const vault={create:async()=>{calls.push('create');return 'synthetic-key';},parameters:async()=>({wrappingKey:'public',importToken:'token'}),import:async()=>leaf.publicKey.export({format:'der',type:'spki'}),sign:async(arn,bytes)=>sign('sha256',bytes,key),retire:async arn=>calls.push('retire:'+arn)};
 const service=createVaultService({ged,vault,validate,audit:async()=>{}});return {ged,key,chain,calls,vault,service};
}
test('cofre preserva identidade e prova quando DynamoDB reordena mapas',async()=>{
 const f=fixture(),get=f.ged.get;f.ged.get=async(...args)=>{const x=await get(...args);if(x?.target)x.target=Object.fromEntries(Object.entries(x.target).reverse());return x;};
 const c=await f.service.start(company,'master',{chain:f.chain});
 await f.service.prove(company,'master',c.id,{signature:sign('sha256',Buffer.from(c.signingBase64,'base64'),f.key).toString('base64')});
 const cert=await f.service.complete(company,'master',c.id,{wrappedKey:Buffer.alloc(1024).toString('base64')});assert.equal(cert.active,true);
});
test('CMS do cofre valida e-CPF/e-CNPJ, ESS, cadeia e conteúdo sem consultar representante',async()=>{for(const variant of ['leaf','pf']){const f=fixture(variant),bytes=Buffer.from('ficha inteira'),built=detachedCms(bytes,f.chain),cms=built.complete(sign('sha256',built.signedBytes,f.key));await validate(cms,bytes,company.cnpj);await assert.rejects(validate(cms,Buffer.from('alterada'),company.cnpj),{code:'CERTIFICADO_ASSINATURA_INVALIDA'});}});
test('cadastro comprova posse antes de criar chave e impede repetição e troca de empresa/ator',async()=>{const f=fixture(),c=await f.service.start(company,'master',{chain:f.chain});assert.deepEqual(f.calls,[]);await assert.rejects(f.service.prove(company,'other',c.id,{}),{code:'COFRE_EXPIRADO'});await assert.rejects(f.service.prove({...company,id:'other'},'master',c.id,{}),{code:'COFRE_EXPIRADO'});await assert.rejects(f.service.prove(company,'master',c.id,{signature:'AAAA'}),{code:'COFRE_CHAVE_DIVERGENTE'});assert.deepEqual(f.calls,[]);const body={signature:sign('sha256',Buffer.from(c.signingBase64,'base64'),f.key).toString('base64')};await f.service.prove(company,'master',c.id,body);assert.deepEqual(f.calls,['create']);await assert.rejects(f.service.prove(company,'master',c.id,body));const cert=await f.service.complete(company,'master',c.id,{wrappedKey:Buffer.alloc(1024).toString('base64')});assert.equal(cert.mode,'vault');assert.equal(cert.active,true);await assert.rejects(f.service.complete(company,'master',c.id,{}),{code:'COFRE_EXPIRADO'});});
test('chave divergente não é ativada e é retirada do cofre; cadastro anterior permanece',async()=>{const f=fixture(),c=await f.service.start(company,'master',{chain:f.chain});await f.service.prove(company,'master',c.id,{signature:sign('sha256',Buffer.from(c.signingBase64,'base64'),f.key).toString('base64')});f.vault.import=async()=>Buffer.from('wrong');await assert.rejects(f.service.complete(company,'master',c.id,{wrappedKey:Buffer.alloc(1024).toString('base64')}),{code:'COFRE_CHAVE_DIVERGENTE'});assert.equal(await f.ged.get(company.id,'CERT','current'),null);assert.ok(f.calls.includes('retire:synthetic-key'));});
