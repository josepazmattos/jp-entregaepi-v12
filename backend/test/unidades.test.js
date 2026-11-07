import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import serverless from 'serverless-http';
import {createStore} from '../src/db/store.js';
import {createUnitsService,selectCompanyUnit} from '../src/services/unidades.service.js';
import {createEmpresasRouter} from '../src/routes/empresas.routes.js';
import {buildFicha} from '../src/services/ficha.service.js';
import {documentHash} from '../src/services/document-integrity.js';
const cnpj='04252011000110';
const units=[{id:'u1',cidade:'Dourados',uf:'MS',cep:'79800-000',endereco:'Rua A, 100'},{id:'u2',cidade:'Sidrolândia',uf:'MS',cep:'79170-000',endereco:'Rua B, 200'}];
async function fixture(){const storage=createStore({allowMemory:true});const company=await storage.create('empresa',{cnpj,nome:'EMPRESA TESTE',endereco:'Sede antiga'});let calls=0,clock=Date.parse('2026-11-07T10:00:00Z'),source={ok:true,cnpj,empresa:{id:'treino-e1'},unidades:structuredClone(units)};
 const lookup=async(input)=>{calls++;assert.equal(input,cnpj);return source;};const service=createUnitsService({storage,lookup,now:()=>clock});return {storage,company,lookup,service,get calls(){return calls;},set clock(v){clock=v;},set source(v){source=v;}};}
test('consulta usa CNPJ, cache diário e atualização sob demanda sem alterar endereço principal',async()=>{
 const f=await fixture();const [a,b]=await Promise.all([f.service.read(f.company.id),f.service.read(f.company.id)]);assert.equal(f.calls,1);assert.deepEqual(a,b);
 await f.service.read(f.company.id);assert.equal(f.calls,1);f.clock=Date.parse('2026-11-07T10:01:00Z');await f.service.read(f.company.id,{refresh:true});assert.equal(f.calls,2);
 assert.equal((await f.storage.get('empresa',f.company.id)).endereco,'Sede antiga');
});
test('escolha obrigatória, unidade de outra empresa recusada e versão antiga rejeitada',async()=>{
 const f=await fixture(),a=await f.service.read(f.company.id),company=await f.storage.get('empresa',f.company.id);
 assert.throws(()=>selectCompanyUnit(company,{unidadeVersao:a.version}),{code:'UNIDADE_OBRIGATORIA'});
 assert.throws(()=>selectCompanyUnit(company,{unidadeId:'outra',unidadeVersao:a.version}),{code:'UNIDADE_INVALIDA'});
 assert.throws(()=>selectCompanyUnit(company,{unidadeId:'u1',unidadeVersao:'antiga'}),{code:'UNIDADES_ALTERADAS'});
 const picked=selectCompanyUnit(company,{unidadeId:'u2',unidadeVersao:a.version});assert.equal(picked.endereco,'Rua B, 200');
});
test('ficha guarda unidade e CEP no conteúdo assinado, sem aceitar endereço forjado nem mudar histórico',async()=>{
 const f=await fixture(),a=await f.service.read(f.company.id),company=await f.storage.get('empresa',f.company.id);
 const ficha=buildFicha({empresaId:company.id,empresa:company,trabalhador:{id:'w',nomeCompleto:'TESTE'},items:[{epi:{id:'e',descricao:'Capacete',ca:'1'},requested:{quantidade:1}}],body:{unidadeId:'u2',unidadeVersao:a.version,empresaSnapshot:{endereco:'FORJADO'}},actor:'test'});
 assert.equal(ficha.empresaSnapshot.endereco,'Rua B, 200');assert.equal(ficha.empresaSnapshot.cep,'79170-000');assert.equal(ficha.empresaSnapshot.unidade.localidadeId,'u2');
 const before=documentHash(ficha);f.source={ok:true,cnpj,empresa:{id:'treino-e1'},unidades:[{...units[1],endereco:'Rua C, 300'}]};f.clock=Date.parse('2026-11-08T12:00:00Z');await f.service.read(company.id);
 assert.equal(documentHash(ficha),before);assert.notEqual(documentHash({...ficha,empresaSnapshot:{...ficha.empresaSnapshot,endereco:'alterado'}}),before);
 const current=await f.storage.get('empresa',company.id);assert.throws(()=>selectCompanyUnit(current,{unidadeId:'u2',unidadeVersao:a.version}),{code:'UNIDADES_ALTERADAS'});
});
test('troca de CNPJ invalida vínculo; retorno divergente não é aceito',async()=>{
 const f=await fixture();await f.service.read(f.company.id);await f.storage.update('empresa',f.company.id,{cnpj:'11222333000181'});
 const updated=await f.storage.get('empresa',f.company.id);assert.throws(()=>selectCompanyUnit(updated,{unidadeId:'u1'}),{code:'UNIDADES_CARREGAR'});
 const second=await fixture();second.source={ok:true,cnpj:'errado',empresa:null,unidades:[]};await assert.rejects(second.service.read(second.company.id),{code:'UNIDADES_DADOS'});
});
test('UF explícita no endereço é preservada apesar de diferença de acento na cidade',async()=>{
 const f=await fixture();f.source={ok:true,cnpj,empresa:{id:'central'},unidades:[{id:'sid',cidade:'Sidrolandia',endereco:'Rua Pernambuco, 265 - Centro, Sidrolândia - MS, 79170-000',uf:'',cep:'79170-000'}]};
 const r=await f.service.read(f.company.id);assert.equal(r.items[0].uf,'MS');
});
test('rotas restringem a consulta à empresa autenticada e ignoram CNPJ fornecido pelo navegador',async()=>{
 const f=await fixture(),other=await f.storage.create('empresa',{nome:'OUTRA',cnpj:'11222333000181'});const app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={sub:'user',master:false,empresaIds:[f.company.id]};next();});app.use('/api/empresas',createEmpresasRouter({storage:f.storage,accounts:{},unitLookup:f.lookup}));app.use((e,req,res,next)=>res.status(e.status||500).json({code:e.code}));const handler=serverless(app);
 const request=async(id,method='GET')=>handler({version:'2.0',rawPath:'/api/empresas/'+id+'/unidades'+(method==='POST'?'/atualizar':''),rawQueryString:'cnpj=11222333000181',headers:{host:'test','content-type':'application/json'},requestContext:{http:{method,path:'/',sourceIp:'127.0.0.1'}},body:method==='POST'?JSON.stringify({cnpj:'11222333000181'}):undefined},{});
 assert.equal((await request(other.id)).statusCode,403);assert.equal(f.calls,0);assert.equal((await request(f.company.id,'POST')).statusCode,200);assert.equal(f.calls,1);
});
