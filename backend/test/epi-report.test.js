import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {reportFixture} from './helpers/epi-report-fixture.js';
import {createReportCatalog} from '../src/services/epi-report.js';
const fixture=reportFixture(),catalog=createReportCatalog({filePath:fixture.filePath});after(fixture.cleanup);
const existing={id:'original',ca:'365',nomeCurto:'CAPACETE ORIGINAL',descricao:'DESCRIÇÃO ORIGINAL',fabricante:'FABRICANTE ORIGINAL',modelo:'M',tamanho:'G',empresaId:'privado',criadoPor:'privado'};
test('relatório pagina 15 itens, busca sem acentos e carrega detalhes sob demanda',()=>{
  const page=catalog.search([],{q:'oculos fabrica'});assert.equal(page.items.length,15);assert.equal(page.total,40);assert.equal(page.pages,3);
  assert.equal(page.items.some(item=>'descricao' in item),false);
  assert.equal(catalog.search([],{q:'CA 1.00'}).items[0].ca,'100');
  assert.equal(catalog.search([],{q:'oculos',page:3}).items.length,10);
  const full=catalog.get(fixture.id('100'));assert.ok(full.descricao.length>2400);assert.equal(full.tamanho,'');
});
test('cadastro anterior prevalece, não perde dados nem expõe dados privados',()=>{
  const before=structuredClone(existing),page=catalog.search([existing],{q:'365'});
  assert.equal(page.total,1);assert.equal(page.items[0].id,'original');assert.equal(page.items[0].modelo,'M');assert.equal(page.items[0].tamanho,'G');
  assert.equal(JSON.stringify(page).includes('privado'),false);assert.deepEqual(existing,before);assert.equal(catalog.summary([existing]).total,42);
});
test('CA divergente não é selecionado nem arbitrariamente escolhido; origem e situação filtram',()=>{
  assert.throws(()=>catalog.get(fixture.id('999')),error=>error.code==='EPI_RELATORIO_DIVERGENTE');
  assert.equal(catalog.get(fixture.id('999'),{allowAmbiguous:true}).variants.length,2);assert.equal(catalog.byCA('999'),null);
  assert.equal(catalog.search([],{status:'conferir dados'}).total,1);assert.equal(catalog.search([existing],{origin:'registered'}).total,1);
  assert.equal(catalog.search([existing],{origin:'report',q:'365'}).total,0);
  assert.equal(catalog.get('relatorio-aaaaaaaaaaaa-100'),null);
});
test('hash incorreto bloqueia importação e não permite ignorar a regra de CA único',()=>{
  const broken=reportFixture();try{
    writeFileSync(join(broken.folder,'index.json.gz'),'corrompido');const c=createReportCatalog({filePath:broken.filePath});
    assert.throws(()=>c.byCA('100'),error=>error.code==='EPI_RELATORIO_INDISPONIVEL');
    assert.equal(c.summary([existing]).total,1);assert.equal(c.search([existing],{origin:'registered'}).items[0].id,'original');
  }finally{broken.cleanup();}
});
test('filtros inválidos e caminhos maliciosos são recusados',()=>{
  for(const filter of [{page:0},{q:['100']},{origin:'inventada'},{status:'aprovado'},{field:'invalid'},{field:['name']}])assert.throws(()=>catalog.search([],filter));
  const bad=reportFixture();try{bad.manifest.index.file='../index.json.gz';writeFileSync(bad.filePath,JSON.stringify(bad.manifest));assert.throws(()=>createReportCatalog({filePath:bad.filePath}).metadata());}finally{bad.cleanup();}
});
test('busca por nome não confunde luvas com botas do fabricante Marluvas',()=>{
  const fixture=reportFixture({extraRecords:[
    {ca:'700',nomeCurto:'BOTA DE CANO LONGO',fabricante:'MARLUVAS EQUIPAMENTOS DE SEGURANÇA',modelo:'BOTA 50C32'},
    {ca:'701',nomeCurto:'LUVA PARA PROTEÇÃO CONTRA AGENTES MECÂNICOS',fabricante:'FÁBRICA ALFA',modelo:'TATO G07'},
    {ca:'702',nomeCurto:'LUVA ISOLANTE DE BORRACHA',fabricante:'FÁBRICA BETA',modelo:'ISOLANTE G08'}
  ]});
  try{
    const catalog=createReportCatalog({filePath:fixture.filePath});
    const manual=[{id:'sem-ca',tipo:'sem_ca',semCA:true,nomeCurto:'LUVA DE COBERTURA',descricao:'LUVA DE COBERTURA',fabricante:'OFICINA',modelo:'COBERTURA'}];
    for(const q of ['luva','LUVAS','luva de segu','luva de segurança','LUVA DE SEGURANCA']){
      const result=catalog.search(manual,{q,field:'name'});
      assert.equal(result.total,3,q);assert.ok(result.items.every(item=>item.nomeCurto.startsWith('LUVA')));
    }
    assert.equal(catalog.search([],{q:'luva isol',field:'name'}).items[0].ca,'702');
    assert.equal(catalog.search([],{q:'oculos',field:'name'}).total,40);
    assert.equal(catalog.search([],{q:'marluvas',field:'name'}).total,0);
    assert.equal(catalog.search([],{q:'marluvas',field:'manufacturer'}).items[0].ca,'700');
    assert.equal(catalog.search([],{q:'g07',field:'model'}).items[0].ca,'701');
    assert.equal(catalog.search([],{q:'CA 7.01',field:'name'}).items[0].ca,'701');
    assert.equal(catalog.search([],{q:'000701',field:'ca'}).items[0].ca,'701');
    assert.equal(catalog.search([],{q:'luva',field:'ca'}).total,0);
    assert.equal(catalog.search(manual,{q:'luva',field:'name',origin:'without-ca'}).items[0].id,'sem-ca');
    assert.equal(catalog.search([],{q:'inexistente',field:'name'}).total,0);
    assert.equal(catalog.search([],{q:'oculos fabrica',field:'all',page:2}).items.length,15);
    assert.equal(catalog.search([],{q:'oculos',field:'name',status:'valido'}).total,20);
  }finally{fixture.cleanup();}
});
