import test,{after} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {createGedRouter} from '../src/routes/jpged.routes.js';
const calls=[],app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={sub:'actor',master:req.headers['x-test-master']==='yes',empresaIds:['companyA'],authTime:req.headers['x-test-stale']?1:Date.now()/1000};next();});app.use('/api/jpged',createGedRouter({database:{get:async(type,id)=>type==='empresa'?{id,cnpj:'12345678000195'}:{id,empresaId:'companyB'}},service:{certificate:async id=>({empresaId:id}),configure:async company=>{calls.push(company.id);return {id:'config'};},documents:async()=>({items:[]}),download:async company=>({empresaId:company})}}));app.use((err,req,res,next)=>res.status(err.status||500).json({code:err.code}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));after(()=>server.close());
async function call(path,headers={},body){return fetch(`http://127.0.0.1:${server.address().port}/api/jpged${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});}
test('cliente usa empresa do token e não pode escolher outra',async()=>{let r=await call('/certificado');assert.equal(r.status,200);assert.equal((await r.json()).certificate.empresaId,'companyA');assert.equal((await call('/certificado',{'x-empresa-id':'companyB'})).status,403);});
test('Master precisa selecionar empresa e ficha deve corresponder à seleção',async()=>{assert.equal((await call('/certificado',{'x-test-master':'yes'})).status,400);assert.equal((await call('/fichas/fichaB/preparar',{'x-empresa-id':'companyA','x-test-master':'yes','x-empresa-id':'companyA'},{})).status,403);});
test('configurar exige autenticação recente e não recebe PFX ou senha',async()=>{assert.equal((await call('/certificado/configurar',{'x-test-stale':'yes','x-test-master':'yes','x-empresa-id':'companyA'},{})).status,401);for(const body of [{password:'synthetic'},{pfx:'synthetic'},{file:'synthetic'},{pdf:'synthetic'}])assert.equal((await call('/certificado/configurar',{},body)).status,400);assert.equal(calls.length,0);assert.equal((await call('/certificado/configurar',{'x-test-master':'yes','x-empresa-id':'companyA'},{})).status,200);assert.deepEqual(calls,['companyA']);});
test('consulta privada desativa cache e restringe referência',async()=>{const r=await call('/documentos');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');});

test('cliente não configura, remove ou importa certificado mesmo com sessão recente',async()=>{for(const path of ['/certificado/configurar','/certificado/configurar/id','/certificado/desvincular','/cofre/preparar','/cofre/id/comprovar','/cofre/id/concluir','/cofre/id/cancelar'])assert.equal((await call(path,{},{})).status,403,path);assert.equal(calls.length,1);});

test('rota de atualização respeita empresa e não aceita PDF ou senha no corpo',async()=>{
  const seen=[],isolated=express();isolated.use(express.json());
  isolated.use((req,res,next)=>{req.auth={sub:'client',empresaIds:['companyA'],master:false};next();});
  isolated.use('/api/jpged',createGedRouter({database:{get:async(type,id)=>({id})},service:{reissueLayout:async(...args)=>{seen.push(args);return {completed:true};},download:async(...args)=>({original:args[3].original})}}));
  isolated.use((error,req,res,next)=>res.status(error.status||500).json({code:error.code}));
  const local=isolated.listen(0,'127.0.0.1');await new Promise(r=>local.once('listening',r));
  try{
    const base=`http://127.0.0.1:${local.address().port}/api/jpged/documentos/doc`;
    const post=(body={},headers={})=>fetch(base+'/atualizar-layout',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await post()).status,200);assert.deepEqual(seen,[['companyA','client','doc']]);
    assert.equal((await post({}, {'x-empresa-id':'companyB'})).status,403);
    assert.equal((await post({empresaId:'companyB'})).status,403);
    for(const body of [{pdf:'fake'},{password:'fake'},{documentHash:'fake'}])assert.equal((await post(body)).status,400);
    assert.equal(seen.length,1);
    assert.equal((await(await fetch(base+'/download?versao=original')).json()).original,true);
    assert.equal((await fetch(base+'/download?versao=other')).status,400);
  }finally{local.close();}
});
