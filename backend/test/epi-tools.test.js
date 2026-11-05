import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { createStore } from '../src/db/store.js';
import { createGedStorage } from '../src/db/jpged.js';
import { createKitsRouter } from '../src/routes/kits.routes.js';
import { createReportsRouter } from '../src/routes/relatorios.routes.js';
import { buildFicha } from '../src/services/ficha.service.js';
import { buildReport } from '../src/services/relatorios.service.js';
import { reportXlsx, reportPdf, fichasZip } from '../src/services/relatorios-export.js';
import { sha256, documentHash } from '../src/services/document-integrity.js';
import { TERMO_APROVADO, TERMO_ATUAL } from '../src/services/ficha-modelo.js';
import { createGedService } from '../src/services/jpged.service.js';

const company={id:'A',nome:'EMPRESA EXEMPLO',cnpj:'00000000000000',endereco:'Rua de Teste, 100',localidade:'Dourados',uf:'MS'};
const worker={id:'W',empresaId:'A',nomeCompleto:'COLABORADOR SINTÉTICO',cpf:'00000000000',matriculaESocial:'0001A',funcao:'Instalador',setor:'Fibra',dataAdmissao:'2026-01-02',status:'Ativo'};
const epi={id:'E',nomeCurto:'Óculos de segurança',ca:'123',fabricante:'EXEMPLO',modelo:'Teste',tamanho:'M'};
function ficha(id='F',extra={}){return {id,...buildFicha({empresaId:'A',empresa:company,trabalhador:worker,items:[{requested:{quantidade:2,tamanho:'G'},epi}],body:{data:'05/11/2026'},actor:'test'}),numero:'EPI-'+id,...extra};}

test('ficha revisada preserva snapshots e termo anterior sem inventar orientação',()=>{
 const f=ficha();assert.equal(f.empresaSnapshot.endereco,company.endereco);assert.equal(f.trabalhadorSnapshot.setor,'Fibra');assert.equal(f.itens[0].tamanho,'G');assert.equal(f.modeloFicha.termoResponsabilidade,TERMO_ATUAL);assert.equal(f.orientacao.confirmada,false);
 assert.match(TERMO_ATUAL,/art. 462/);assert.doesNotMatch(TERMO_ATUAL,/palestra realizada|ensejadora da rescisão/);
 const hash=documentHash(f);f.orientacao={confirmada:true,data:'05/11/2026',responsavel:'INSTRUTOR SINTÉTICO'};assert.notEqual(documentHash(f),hash);
 const legacy={id:'old',modeloFicha:{id:'JP-DOCX-11.10.6',termoResponsabilidade:TERMO_APROVADO}};assert.equal(legacy.modeloFicha.termoResponsabilidade,TERMO_APROVADO);
 assert.throws(()=>buildFicha({empresaId:'A',empresa:company,trabalhador:worker,items:[{requested:{},epi}],body:{orientacao:{confirmada:true}},actor:'test'}),/data da orientação/);
});
test('relatório pesquisa todo histórico, separa movimentos, canceladas, duplicidades e inativos',()=>{
 const fs=Array.from({length:56},(_,i)=>ficha('F'+i,{data:`${String(i%28+1).padStart(2,'0')}/10/2026`,itens:[{epiId:'E',epiNome:i===55?'Luva especial':'Óculos',ca:'123',quantidade:2,tipoMovimentacao:i===54?'Devolução':'Entrega'}]}));fs[0].status='cancelada';
 let result=buildReport({empresa:company,workers:[{...worker,status:'Inativo'},{id:'N',nomeCompleto:'SEM REGISTRO',status:'Ativo'}],fichas:fs});assert.equal(result.rows.length,55);assert.equal(result.summary.entregas,108);assert.equal(result.summary.devolucoes,2);assert.ok(result.rows.some(r=>r.pendencias.includes('Possível duplicidade: conferir fichas')));assert.equal(result.semMovimentacao.length,1);
 result=buildReport({empresa:company,workers:[worker],fichas:fs,filters:{equipamento:'especial'}});assert.equal(result.rows.length,1);assert.equal(result.rows[0].fichaId,'F55');
 result=buildReport({empresa:company,workers:[worker],fichas:fs,filters:{canceladas:true}});assert.equal(result.rows.length,56);assert.equal(result.summary.entregas,108);assert.equal(result.summary.canceladas,1);
 assert.throws(()=>buildReport({empresa:company,workers:[],fichas:[ficha('X',{empresaId:'B'})]}),/outra empresa/);
 assert.throws(()=>buildReport({empresa:company,workers:[],fichas:[],filters:{inicio:'2026-12-01',fim:'2026-01-01'}}),/data inicial/);
});
test('Excel preserva identificadores e texto literal; PDF e ZIP preservam originais e registram faltas',async()=>{
 const f=ficha(),report=buildReport({empresa:company,workers:[worker],fichas:[f]});report.rows[0].equipamento='=HYPERLINK("https://example.invalid")';
 const book=new ExcelJS.Workbook();await book.xlsx.load(await reportXlsx(report));assert.equal(book.getWorksheet('Movimentações').getRow(2).getCell(6).value,'0001A');assert.equal(typeof book.getWorksheet('Movimentações').getRow(2).getCell(11).value,'string');
 const pdf=await PDFDocument.load(await reportPdf(report));assert.ok(pdf.getPageCount()>0);
 const ged=createGedStorage({memory:true}),original=Buffer.from('%PDF-synthetic-original');await ged.saveBlob('documents/A/job/hash.pdf',original);await ged.put('A','DOC','D',{fichaId:'SIGNED',path:'documents/A/job/hash.pdf',pdfHash:sha256(original)});
 const signed=ficha('SIGNED',{status:'assinada',assinaturaBiometrica:{verificada:true},certificacao:{documentId:'D',status:'certificado'}}),missing=ficha('MISSING',{status:'assinada',assinaturaBiometrica:{verificada:true},certificacao:{documentId:'missing',status:'certificado'}});
 const bundle=await fichasZip({fichas:[signed,missing,f],ged,empresaId:'A'}),zip=await JSZip.loadAsync(bundle.bytes);assert.equal(bundle.incluidas,2);assert.equal(bundle.pendencias.length,1);const name=Object.keys(zip.files).find(n=>n.startsWith('original_certificado/')&&n.endsWith('.pdf'));assert.deepEqual(await zip.file(name).async('nodebuffer'),original);assert.equal(JSON.parse(await zip.file('Indice_das_fichas.json').async('string')).completo,false);
});
test('rotas de relações e relatórios isolam empresa, paginação e arquivos por usuário',async()=>{
 const db=createStore({allowMemory:true}),ged=createGedStorage({memory:true});const a=await db.create('empresa',{nome:'EMPRESA A',cnpj:'00000000000000'}),b=await db.create('empresa',{nome:'EMPRESA B'}),e=await db.create('epi',epi),w=await db.create('trabalhador',{...worker,empresaId:a.id});
 for(let i=0;i<55;i++)await db.create('ficha',{...ficha('R'+i),empresaId:a.id,trabalhadorId:w.id});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={sub:req.headers['x-test-user']||'actor',master:false,empresaIds:[a.id]};next();});app.use('/kits',createKitsRouter(db));app.use('/reports',createReportsRouter(db,ged));app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,method='GET',body,headers={})=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 try{
 const kit=await request('/kits','POST',{nome:'Admissão',itens:[{epiId:e.id,quantidade:2,tamanho:'G'}]});assert.equal(kit.status,200);assert.equal(kit.body.item.empresaId,a.id);
 assert.equal((await request('/kits?empresaId='+b.id)).status,403);
 assert.equal((await request('/kits/'+kit.body.item.id,'PATCH',{_version:999,nome:'Alterada',itens:[{epiId:e.id,quantidade:1}]})).status,409);
 const first=await request('/reports'),next=await request('/reports?page=2');assert.equal(first.body.total,55);assert.equal(first.body.rows.length,50);assert.equal(next.body.rows.length,5);assert.equal((await request('/reports/fichas')).body.items.length,55);
 const foreign=await db.create('ficha',{...ficha('foreign'),empresaId:b.id});assert.equal((await request('/reports/pacote','POST',{ids:[foreign.id]})).status,403);
 const exp=await request('/reports/exportar','POST',{formato:'xlsx',filters:{}});assert.equal(exp.status,200);assert.equal((await request('/reports/arquivos/'+exp.body.arquivo.id,'GET',null,{'x-test-user':'another'})).status,404);assert.equal((await request('/reports/arquivos/'+exp.body.arquivo.id)).status,200);
 }finally{server.close();await once(server,'close');}
});
test('JPGED procura além da primeira página sem expor caminho privado',async()=>{
 let calls=0;const service=createGedService({store:{},ged:{get:async()=>null,list:async(company,type,cursor)=>{calls++;return cursor?{items:[{trabalhadorNome:'Maria',numero:'OLD',path:'private',evidencePath:'secret'}],cursor:''}:{items:[{trabalhadorNome:'João',numero:'NEW'}],cursor:'next'};}}});const result=await service.documents('A','','maria');assert.equal(calls,2);assert.equal(result.items.length,1);assert.equal(result.items[0].path,undefined);
});
