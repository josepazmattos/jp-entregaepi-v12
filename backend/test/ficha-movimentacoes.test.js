import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFicha } from '../src/services/ficha.service.js';

const empresa={id:'EMPRESA-SINTETICA',nome:'EMPRESA SINTÉTICA'},trabalhador={id:'TRABALHADOR-SINTETICO',empresaId:empresa.id,nomeCompleto:'TRABALHADOR SINTÉTICO',status:'Ativo'};
const comCA={id:'EPI-CA',nomeCurto:'CAPACETE',ca:'365'},semCA={id:'EPI-SEM-CA',nomeCurto:'UNIFORME',tipo:'sem_ca',semCA:true};
const build=(itens,body={},worker=trabalhador)=>buildFicha({empresaId:empresa.id,empresa,trabalhador:worker,actor:'MASTER-SINTETICO',body:{data:'10/10/2026',...body},items:itens.map((requested,index)=>({requested,epi:index%2?semCA:comCA}))});

test('ficha mista mantém ordem, repetições, quantidades e somente a data de cada movimentação',()=>{
  for(const tipos of [['Entrega','Devolução','Entrega','Devolução'],['Devolução','Entrega','Devolução','Entrega']]){
    const quantidades=[1,7,100000,23];
    const ficha=build(tipos.map((tipoMovimentacao,index)=>({tipoMovimentacao,quantidade:quantidades[index],datasMovimentacao:{entrega:'DATA FALSA',devolucao:'DATA FALSA'}})));
    assert.equal(ficha.tipo,'Entrega e Devolução');assert.equal(ficha.status,'pendente');assert.equal(ficha.assinaturaBiometrica,undefined);
    assert.equal(ficha.itens.length,4);assert.equal(ficha.itens[0].epiId,ficha.itens[2].epiId);
    ficha.itens.forEach((item,index)=>{
      assert.equal(item.tipoMovimentacao,tipos[index]);assert.equal(item.quantidade,quantidades[index]);assert.equal(item.semCA,index%2===1);
      assert.deepEqual(item.datasMovimentacao,{entrega:tipos[index]==='Entrega'?ficha.data:'',devolucao:tipos[index]==='Devolução'?ficha.data:''});
    });
  }
});
test('tipo geral não pode esconder uma entrega para trabalhador inativo',()=>{
  const worker={...trabalhador,status:'Inativo'};
  assert.throws(()=>build([{tipoMovimentacao:'Devolução'},{tipoMovimentacao:'Entrega'}],{tipo:'Devolução'},worker),error=>error.status===409);
  const returned=build([{tipoMovimentacao:'Devolução'},{tipoMovimentacao:'Devolução'}],{},worker);
  assert.equal(returned.tipo,'Devolução');assert.equal(returned.datasMovimentacao.entrega,'');
});
test('dados inválidos em qualquer item recusam toda a ficha',()=>{
  for(const invalid of [{tipoMovimentacao:'Inventado'},{tipoMovimentacao:'sem_ca'},{quantidade:0},{quantidade:-1},{quantidade:1.5},{quantidade:100001}]){
    assert.throws(()=>build([{tipoMovimentacao:'Entrega'},invalid]),error=>error.status===400);
  }
});
test('requisições anteriores sem tipo por item continuam aceitando entrega, troca e devolução',()=>{
  for(const tipo of ['Entrega','Troca','Devolução']){
    const ficha=build([{quantidade:2,tipo:'epi_ca'},{quantidade:3,tipo:'sem_ca'}],{tipo});
    assert.equal(ficha.tipo,tipo);assert.ok(ficha.itens.every(item=>item.tipoMovimentacao===tipo));
  }
});
