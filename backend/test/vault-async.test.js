import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {enqueueVault} from '../src/security/remote.js';
import {createGedRouter} from '../src/routes/jpged.routes.js';
test('fila usa Event sem aguardar validação e aceita apenas etapas do cofre',async()=>{
 const calls=[],client={send:async c=>{calls.push(c.input);return {StatusCode:202};}};
 assert.deepEqual(await enqueueVault('vault',{action:'prove',id:'attempt',body:{signature:'public'}},client),{pending:true});
 assert.equal(calls[0].InvocationType,'Event');assert.equal(JSON.parse(calls[0].Payload).body.signature,'public');
 await assert.rejects(enqueueVault('vault',{action:'disconnect'},client));assert.equal(calls.length,1);
 await assert.rejects(enqueueVault('vault',{action:'complete'}, {send:async()=>({StatusCode:500})}),{code:'COFRE_FILA_INDISPONIVEL'});
});
test('HTTP responde 202, valida posse/MFA antes da fila e consulta apenas estado público',async()=>{
 const oldSigner=process.env.SIGNER_FUNCTION,oldAdmin=process.env.VAULT_ADMIN_FUNCTION;process.env.SIGNER_FUNCTION='signer';process.env.VAULT_ADMIN_FUNCTION='admin';
 const seen=[],app=express();let denied=false;
 app.use(express.json());app.use((req,res,next)=>{req.auth={sub:'master',master:req.headers['x-master']!=='no',empresaIds:['A']};next();});
 app.use(createGedRouter({database:{get:async(type,id)=>({id})},invoke:async(target,payload)=>{seen.push(payload.action);if(denied)throw Object.assign(new Error('MFA'),{status:403,code:'MFA_REQUIRED'});return {phase:'proving'};},enqueue:async(target,payload)=>{seen.push('enqueue:'+payload.action);return {pending:true};}}));
 app.use((e,req,res,next)=>res.status(e.status||500).json({code:e.code}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}`,headers={'content-type':'application/json','x-empresa-id':'A',authorization:'Bearer '+ 'a'.repeat(60)};
 try{
  let r=await fetch(url+'/cofre/attempt/comprovar',{method:'POST',headers,body:JSON.stringify({signature:'public'})});assert.equal(r.status,202);assert.deepEqual(await r.json(),{ok:true,pending:true});assert.deepEqual(seen,['check','enqueue:prove']);
  r=await fetch(url+'/cofre/attempt/situacao',{headers});assert.deepEqual(await r.json(),{ok:true,phase:'proving'});
  assert.equal((await fetch(url+'/cofre/attempt/situacao',{headers:{...headers,'x-master':'no'}})).status,403);
  denied=true;assert.equal((await fetch(url+'/cofre/attempt/concluir',{method:'POST',headers,body:JSON.stringify({wrappedKey:'encrypted'})})).status,403);assert.equal(seen.filter(x=>x.startsWith('enqueue')).length,1);
 }finally{server.close();if(oldSigner===undefined)delete process.env.SIGNER_FUNCTION;else process.env.SIGNER_FUNCTION=oldSigner;if(oldAdmin===undefined)delete process.env.VAULT_ADMIN_FUNCTION;else process.env.VAULT_ADMIN_FUNCTION=oldAdmin;}
});
