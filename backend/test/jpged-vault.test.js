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
test('cofre conserva a cadeia completa validada quando A1 fornece somente o titular',async()=>{
 const f=fixture();f.chain=f.chain.slice(0,1);const c=await f.service.start(company,'master',{chain:f.chain});
 await f.service.prove(company,'master',c.id,{signature:sign('sha256',Buffer.from(c.signingBase64,'base64'),f.key).toString('base64')});
 const cert=await f.service.complete(company,'master',c.id,{wrappedKey:Buffer.alloc(1024).toString('base64')});
 assert.equal(cert.chain.length,2);assert.equal(cert.chain[0],f.chain[0]);assert.equal(cert.chain[1],readFileSync(join(dir,'root.der')).toString('base64'));
});
test('CMS do cofre valida e-CPF/e-CNPJ, ESS, cadeia e conteúdo sem consultar representante',async()=>{for(const variant of ['leaf','pf']){const f=fixture(variant),bytes=Buffer.from('ficha inteira'),built=detachedCms(bytes,f.chain),cms=built.complete(sign('sha256',built.signedBytes,f.key));await validate(cms,bytes,company.cnpj);await assert.rejects(validate(cms,Buffer.from('alterada'),company.cnpj),{code:'CERTIFICADO_ASSINATURA_INVALIDA'});}});
test('cadastro comprova posse antes de criar chave e impede repetição e troca de empresa/ator',async()=>{const f=fixture();let c=await f.service.start(company,'master',{chain:f.chain});assert.deepEqual(f.calls,[]);await assert.rejects(f.service.prove(company,'other',c.id,{}),{code:'COFRE_EXPIRADO'});await assert.rejects(f.service.prove({...company,id:'other'},'master',c.id,{}),{code:'COFRE_EXPIRADO'});await assert.rejects(f.service.prove(company,'master',c.id,{signature:'AAAA'}),{code:'COFRE_CHAVE_DIVERGENTE'});assert.deepEqual(f.calls,[]);assert.equal((await f.service.status(company,'master',c.id)).phase,'failed');c=await f.service.start(company,'master',{chain:f.chain});const body={signature:sign('sha256',Buffer.from(c.signingBase64,'base64'),f.key).toString('base64')};await f.service.prove(company,'master',c.id,body);assert.deepEqual(f.calls,['create']);assert.equal((await f.service.prove(company,'master',c.id,body)).wrappingKey,'public');assert.deepEqual(f.calls,['create']);const cert=await f.service.complete(company,'master',c.id,{wrappedKey:Buffer.alloc(1024).toString('base64')});assert.equal(cert.mode,'vault');assert.equal(cert.active,true);assert.equal((await f.service.complete(company,'master',c.id,{})).active,true);});
test('chave divergente não é ativada e é retirada do cofre; cadastro anterior permanece',async()=>{const f=fixture(),c=await f.service.start(company,'master',{chain:f.chain});await f.service.prove(company,'master',c.id,{signature:sign('sha256',Buffer.from(c.signingBase64,'base64'),f.key).toString('base64')});f.vault.import=async()=>Buffer.from('wrong');await assert.rejects(f.service.complete(company,'master',c.id,{wrappedKey:Buffer.alloc(1024).toString('base64')}),{code:'COFRE_CHAVE_DIVERGENTE'});assert.equal(await f.ged.get(company.id,'CERT','current'),null);assert.ok(f.calls.includes('retire:synthetic-key'));});
const proof=(f,c)=>({signature:sign('sha256',Buffer.from(c.signingBase64,'base64'),f.key).toString('base64')});
const wrapped={wrappedKey:Buffer.alloc(1024).toString('base64')};
const barrier=()=>{let release;const promise=new Promise(r=>{release=r;});return {promise,release};};
test('validação em andamento bloqueia cancelamento e duplicação sem criar outra chave',async()=>{
 const f=fixture(),gate=barrier(),entered=barrier();
 f.service=createVaultService({...f,validate:async(...args)=>{entered.release();await gate.promise;return validate(...args);},audit:async()=>{}});
 const c=await f.service.start(company,'master',{chain:f.chain}),pending=f.service.prove(company,'master',c.id,proof(f,c));await entered.promise;
 assert.equal((await f.service.status(company,'master',c.id)).phase,'proving');
 assert.deepEqual(await f.service.prove(company,'master',c.id,proof(f,c)),{pending:true});
 await assert.rejects(f.service.cancel(company,'master',c.id),{code:'COFRE_EM_ANDAMENTO'});
 await assert.rejects(f.service.start(company,'master',{chain:f.chain}),{code:'COFRE_OCUPADO'});
 gate.release();await pending;assert.deepEqual(f.calls,['create']);
 const state=await f.service.status(company,'master',c.id);assert.deepEqual(state,{phase:'proved',wrappingKey:'public'});
 assert.ok(!JSON.stringify(state).includes('token'));await assert.rejects(f.service.status(company,'other',c.id));
});
test('duas provas simultâneas adquirem uma única versão antes de criar chave',async()=>{
 const f=fixture(),c=await f.service.start(company,'master',{chain:f.chain});
 const result=await Promise.allSettled([f.service.prove(company,'master',c.id,proof(f,c)),f.service.prove(company,'master',c.id,proof(f,c))]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(f.calls,['create']);
});
test('falha de revogação fica consultável e preserva certificado anterior',async()=>{
 const f=fixture();await f.ged.put(company.id,'CERT','current',{active:true,keyArn:'old-key',mode:'vault'});
 f.service=createVaultService({...f,validate:async()=>{throw Object.assign(new Error('Revogação indisponível.'),{status:503,code:'CERTIFICADO_REVOGACAO_INDISPONIVEL'});},audit:async()=>{}});
 const c=await f.service.start(company,'master',{chain:f.chain});await assert.rejects(f.service.prove(company,'master',c.id,proof(f,c)));
 assert.equal((await f.service.status(company,'master',c.id)).failure.code,'CERTIFICADO_REVOGACAO_INDISPONIVEL');assert.deepEqual(f.calls,[]);assert.equal((await f.ged.get(company.id,'CERT','current')).keyArn,'old-key');
});
test('conclusão em andamento bloqueia cancelamento e repetição da importação',async()=>{
 const f=fixture(),c=await f.service.start(company,'master',{chain:f.chain});await f.service.prove(company,'master',c.id,proof(f,c));
 const original=f.vault.import,gate=barrier(),entered=barrier();let count=0;f.vault.import=async(...args)=>{count++;entered.release();await gate.promise;return original(...args);};
 const pending=f.service.complete(company,'master',c.id,wrapped);await entered.promise;
 assert.equal((await f.service.status(company,'master',c.id)).phase,'completing');assert.deepEqual(await f.service.complete(company,'master',c.id,wrapped),{pending:true});await assert.rejects(f.service.cancel(company,'master',c.id),{code:'COFRE_EM_ANDAMENTO'});
 gate.release();await pending;assert.equal(count,1);assert.equal((await f.service.status(company,'master',c.id)).installed,true);await f.service.cancel(company,'master',c.id);assert.deepEqual(f.calls,['create']);
});
test('resposta perdida da gravação do certificado não exclui chave ativa',async()=>{
 const f=fixture(),c=await f.service.start(company,'master',{chain:f.chain});await f.service.prove(company,'master',c.id,proof(f,c));
 const put=f.ged.put;f.ged.put=async(...args)=>{const saved=await put(...args);if(args[1]==='CERT')throw new Error('lost response');return saved;};
 assert.equal((await f.service.complete(company,'master',c.id,wrapped)).active,true);assert.deepEqual(f.calls,['create']);assert.equal((await f.service.status(company,'master',c.id)).phase,'installed');
});
test('falha auxiliar após ativação não desfaz instalação nem permite cancelamento',async()=>{
 const f=fixture();f.service=createVaultService({...f,validate,audit:async()=>{throw new Error('audit offline');}});
 const c=await f.service.start(company,'master',{chain:f.chain});await f.service.prove(company,'master',c.id,proof(f,c));const put=f.ged.put;
 f.ged.put=async(...args)=>{if(args[1]==='IMPORT'&&args[3].phase==='installed')throw new Error('offline');return put(...args);};
 assert.equal((await f.service.complete(company,'master',c.id,wrapped)).active,true);await f.service.cancel(company,'master',c.id);assert.deepEqual(f.calls,['create']);assert.equal((await f.service.status(company,'master',c.id)).phase,'installed');
});
test('alteração do empregador durante a validação impede criação da chave',async()=>{
 const f=fixture();let latest=company;f.service=createVaultService({...f,validate:async(...args)=>{const result=await validate(...args);latest={...company,cnpj:'99999999000199'};return result;},loadCompany:async()=>latest,audit:async()=>{}});
 const c=await f.service.start(company,'master',{chain:f.chain});await assert.rejects(f.service.prove(company,'master',c.id,proof(f,c)),{code:'COFRE_EMPRESA_ALTERADA'});assert.deepEqual(f.calls,[]);
});
test('cancelamento obtém bloqueio antes de retirar chave e libera nova instalação',async()=>{
 const f=fixture(),c=await f.service.start(company,'master',{chain:f.chain});await f.service.prove(company,'master',c.id,proof(f,c));await f.service.cancel(company,'master',c.id);
 assert.equal((await f.service.status(company,'master',c.id)).phase,'cancelled');await assert.rejects(f.service.complete(company,'master',c.id,wrapped),{code:'COFRE_EXPIRADO'});const next=await f.service.start(company,'master',{chain:f.chain});assert.notEqual(next.id,c.id);
});
