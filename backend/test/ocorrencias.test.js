import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createStore} from '../src/db/store.js';
import {createOccurrenceService,OCCURRENCE_EMAIL} from '../src/services/ocorrencias.service.js';
import {createOccurrencesRouter} from '../src/routes/ocorrencias.routes.js';
import {companyEmails,companyEditableFields} from '../src/services/empresa-validation.js';
async function fixture(send=async()=> 'synthetic-message') {
 const db=createStore({allowMemory:true});const company=await db.create('empresa',{nome:'EMPRESA SINTÉTICA',email:'rh@example.com; gestor@example.com'});
 const ficha=await db.create('ficha',{empresaId:company.id,trabalhadorId:'worker',trabalhadorNome:'TRABALHADOR SINTÉTICO',status:'assinada',tipo:'Entrega',numero:'TESTE',data:'01/11/2026',itens:[{epiId:'epi',epiNome:'CAPACETE SINTÉTICO',ca:'0000',quantidade:2,tipoMovimentacao:'Entrega'}]});
 const body={requestId:'synthetic-request',indice:0,quantidade:1,motivo:'extravio',data:'07/11/2026',descricao:'Relato sintético',manifestacao:'',recolhido:false,valorCentavos:1500};
 return {db,company,ficha,body,service:createOccurrenceService(db,send)};
}
test('múltiplos e-mails: ponto e vírgula, espaços e duplicados; rejeita cabeçalhos, inválidos e excesso',()=>{
 assert.deepEqual(companyEmails(' rh@example.com ; gestor@example.com; RH@example.com; '),['RH@example.com','gestor@example.com']);
 assert.equal(companyEditableFields({email:'a@example.com;b@example.com'}).email,'a@example.com; b@example.com');
 assert.deepEqual(companyEmails(''),[]);
 for(const value of ['a@example.com,b@example.com','a@example.com\nBcc: b@example.com','sem-arroba','a@localhost','a..b@example.com',Array.from({length:11},(_,i)=>i+'@example.com').join(';')])assert.throws(()=>companyEmails(value));
});
test('vale separado preserva a ficha e o reenvio da solicitação não duplica nem consome saldo',async()=>{
 const f=await fixture(),before=await f.db.get('ficha',f.ficha.id);
 const items=await Promise.all([f.service.register(f.ficha,f.body,'actor'),f.service.register(f.ficha,f.body,'actor')]);assert.equal(items[0].id,items[1].id);
 assert.equal((await f.db.list('ocorrencia_epi',f.company.id)).length,1);assert.deepEqual(await f.db.get('ficha',f.ficha.id),before);
 await assert.rejects(f.service.register(f.ficha,{...f.body,descricao:'outro'},'actor'),e=>e.status===409);
 await f.service.register(f.ficha,{...f.body,requestId:'second'},'actor');
 await assert.rejects(f.service.register(f.ficha,{...f.body,requestId:'third'},'actor'),e=>e.status===409);
});
test('recusa extravio com devolução física, datas e valores inválidos e ficha cancelada',async()=>{
 const f=await fixture();
 for(const change of [{recolhido:true},{data:'2026-10-01'},{data:'2099-01-01'},{valorCentavos:-1},{valorCentavos:1.5},{quantidade:3},{indice:9},{motivo:'desgaste'},{descricao:''}])await assert.rejects(f.service.register(f.ficha,{...f.body,...change},'actor'),e=>e.status===400);
 await assert.rejects(f.service.register({...f.ficha,status:'cancelada'},f.body,'actor'),e=>e.status===409);
});
test('envio usa cadastro da empresa e cópia SAC, ignora destinatário do navegador e não repete',async()=>{
 const sent=[],f=await fixture(async item=>{sent.push(item);return 'synthetic';});
 let item=await f.service.register(f.ficha,{...f.body,email:'attacker@example.com'},'actor');
 item=await f.service.notify(item,'actor');assert.equal(item.email.status,'enviado');assert.deepEqual(item.email.destinatarios,['rh@example.com','gestor@example.com']);assert.deepEqual(item.email.copia,[OCCURRENCE_EMAIL]);
 await f.service.notify(item,'actor');assert.equal(sent.length,1);
 await assert.rejects(f.service.notify({...item,_version:1,email:{status:'pendente'}},'actor'),e=>e.status===409);
});
test('falha de envio conserva ocorrência; timeout impede repetição automática',async()=>{
 const f=await fixture(async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});});
 const created=await f.service.register(f.ficha,f.body,'actor'),item=await f.service.notify(created,'actor');assert.equal(item.email.status,'conferir_envio');assert.equal((await f.db.get('ocorrencia_epi',created.id)).descricao,f.body.descricao);
 await assert.rejects(f.service.notify(item,'actor'),e=>e.status===409);
});
test('reposição exige mesmo trabalhador/empresa, não altera ficha e é idempotente',async()=>{
 const f=await fixture(),item=await f.service.register(f.ficha,f.body,'actor');
 const replacement=await f.db.create('ficha',{...f.ficha,numero:'REPOSIÇÃO'}),before=await f.db.get('ficha',replacement.id);
 await assert.rejects(f.service.link(item,{...replacement,empresaId:'other'},'actor'),e=>e.status===403);
 await assert.rejects(f.service.link(item,{...replacement,trabalhadorId:'other'},'actor'),e=>e.status===403);
 const linked=await f.service.link(item,replacement,'actor');assert.equal((await f.service.link(linked,replacement,'actor')).reposicaoFichaId,replacement.id);assert.deepEqual(await f.db.get('ficha',replacement.id),before);
});
test('rotas impedem acesso cruzado a vale, envio e ficha original',async t=>{
 const f=await fixture(),item=await f.service.register(f.ficha,f.body,'actor');const app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={sub:'actor',master:false,empresaIds:['other']};next();});app.use('/api/fichas',createOccurrencesRouter(f.db,async()=>{throw new Error('must not send');}));app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port+'/api/fichas/ocorrencias/'+item.id;
 for(const [path,method] of [['','GET'],['/notificar','POST'],['/ficha','GET']])assert.equal((await fetch(base+path,{method,headers:{'x-empresa-id':'other'}})).status,403);
});
