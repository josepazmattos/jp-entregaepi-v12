import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reportFixture} from './helpers/epi-report-fixture.js';
const fixture=reportFixture();after(fixture.cleanup);process.env.EPI_REPORT_PATH=fixture.filePath;
process.env.NODE_ENV='test';process.env.DATA_MODE='memory';delete process.env.TABLE_NAME;delete process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.COGNITO_ISSUER='https://cognito-idp.sa-east-1.amazonaws.com/synthetic';process.env.COGNITO_CLIENT_ID='synthetic';process.env.AUTH_COMPANY_CLAIM='custom:empresa_id';
const {handler}=await import('../src/lambda.js'),store=await import('../src/db/store.js');
const a=await store.create('empresa',{nome:'EMPRESA SINTÉTICA A'}),b=await store.create('empresa',{nome:'EMPRESA SINTÉTICA B'});
const worker=await store.create('trabalhador',{empresaId:a.id,nomeCompleto:'TRABALHADOR SINTÉTICO',status:'Ativo'});
const legacy=await store.create('epi',{ca:'365',nomeCurto:'CAPACETE ORIGINAL',descricao:'DESCRIÇÃO PRESERVADA',fabricante:'ORIGINAL',modelo:'M',tamanho:'G',empresaId:a.id});
async function api(path,body,company=a,method=body?'POST':'GET'){
  const url=new URL(path,'https://synthetic.invalid');const claims={sub:company.id,iss:process.env.COGNITO_ISSUER,aud:'synthetic',token_use:'id',exp:String(Math.floor(Date.now()/1000)+3600),'cognito:groups':['EMPRESA'],'custom:empresa_id':company.id};
  const r=await handler({version:'2.0',routeKey:'ANY /{proxy+}',rawPath:url.pathname,rawQueryString:url.search.slice(1),headers:{host:'synthetic.invalid','content-type':'application/json','x-empresa-id':company.id},requestContext:{requestId:randomUUID(),stage:'$default',http:{method,path:url.pathname,protocol:'HTTP/1.1',sourceIp:'127.0.0.1'},authorizer:{jwt:{claims}}},isBase64Encoded:false,...(body?{body:JSON.stringify(body)}:{})},{});return {status:r.statusCode,body:JSON.parse(r.body)};
}
test('empresas consultam o mesmo catálogo sem copiar registros para o banco',async()=>{
  for(const company of [a,b]){const r=await api('/api/epis/catalogo?q=100',null,company);assert.equal(r.status,200);assert.equal(r.body.items[0].id,fixture.id('100'));}
  assert.equal((await store.list('epi')).length,1);
});
test('CA existente mostra EPI já cadastrado e preserva todos os campos anteriores',async()=>{
  const before=await store.get('epi',legacy.id);
  const checked=await api('/api/epis/cadastrado/CA%20365');assert.equal(checked.body.message,'EPI já cadastrado');assert.equal(checked.body.item.id,legacy.id);
  for(const company of [a,b]){const r=await api('/api/epis',{ca:'365',nomeCurto:'NÃO SUBSTITUIR',descricao:'ALTERADA',modelo:'OUTRO',tamanho:'P'},company);assert.equal(r.status,200);assert.equal(r.body.code,'EPI_JA_CADASTRADO');assert.equal(r.body.item.id,legacy.id);}
  assert.deepEqual(await store.get('epi',legacy.id),before);
});
test('CA do relatório é reutilizado sem novo cadastro, mesmo por outra empresa',async()=>{
  const count=(await store.list('epi')).length;
  const r=await api('/api/epis',{ca:'100',nomeCurto:'NOME ALTERADO'},b);assert.equal(r.status,200);assert.equal(r.body.message,'EPI já cadastrado');assert.equal(r.body.item.id,fixture.id('100'));assert.equal((await store.list('epi')).length,count);
});
test('duas empresas cadastrando o mesmo CA simultaneamente com modelos distintos criam só um registro',async()=>{
  const responses=await Promise.all([api('/api/epis',{ca:'9876501',nomeCurto:'LUVA A',modelo:'A',tamanho:'P'},a),api('/api/epis',{ca:'9876501',nomeCurto:'LUVA B',modelo:'B',tamanho:'G'},b)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(responses[0].body.item.id,responses[1].body.item.id);assert.equal(responses.filter(r=>r.body.reutilizado).length,1);assert.equal((await store.list('epi')).filter(e=>e.ca==='9876501').length,1);
});
test('ficha usa itens do relatório e cadastro sem CA, mantém datas por movimento e ignora campos forjados',async()=>{
  const noCA=(await api('/api/epis',{tipo:'sem_ca',nomeCurto:'UNIFORME SINTÉTICO'})).body.item;
  const payload={trabalhadorId:worker.id,data:'11/10/2026',itens:[{epiId:fixture.id('100'),quantidade:3,tipoMovimentacao:'Entrega',epiDescricao:'FALSO'},{epiId:noCA.id,quantidade:2,tipoMovimentacao:'Devolução'}]};
  const r=await api('/api/fichas',payload);assert.equal(r.status,200);assert.equal(r.body.item.itens[0].epiDescricao,'ÓCULOS DE PROTEÇÃO 0');assert.equal(r.body.item.itens[0].datasMovimentacao.devolucao,'');assert.equal(r.body.item.itens[1].datasMovimentacao.entrega,'');assert.equal(r.body.item.itens[1].semCA,true);
  assert.equal((await api('/api/fichas',payload,b)).status,403);
  assert.equal((await api('/api/fichas',{...payload,itens:[{epiId:fixture.id('999'),quantidade:1}]})).status,409);
  assert.deepEqual(await store.get('epi',legacy.id),legacy);
});
test('CA divergente pode receber um cadastro conferido, sem duas opções para o mesmo CA',async()=>{
  const r=await api('/api/epis',{ca:'999',nomeCurto:'DADOS CONFERIDOS',descricao:'PREENCHIMENTO MANUAL'});assert.equal(r.status,200);assert.equal(r.body.reutilizado,false);
  const results=await api('/api/epis/catalogo?q=999');assert.equal(results.body.total,1);assert.equal(results.body.items[0].id,r.body.item.id);
});
