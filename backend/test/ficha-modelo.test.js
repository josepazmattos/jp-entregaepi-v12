import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TERMO_LEGADO, MODELO_LEGADO_ID, modeloFichaParaItens } from '../src/services/ficha-modelo.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { equipmentCaLabel, classifyEquipment } from '../src/services/equipment-classification.js';

test('texto integral preserva o SHA256 do modelo aprovado JP-DOCX-11.10.6', () => {
  assert.equal(MODELO_LEGADO_ID, 'JP-DOCX-11.10.6');
  assert.equal(createHash('sha256').update(TERMO_LEGADO, 'utf8').digest('hex'), 'ae8f8fced55857cade534b19ed96614ef2be2c2d5c009abfadef53c288d74f18');
});

test('prévia e servidor concordam sobre entrega, devolução, instrumentos e movimentação mista',()=>{
  const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../../frontend/EntregaEPI/assets/ficha.js',import.meta.url),'utf8'),context);
  const epi={semCA:false,enquadramento:'epi',tipoMovimentacao:'Entrega'},instrument={semCA:true,enquadramento:'instrumento',tipoMovimentacao:'Entrega'};
  for(const items of [[epi],[instrument],[{...instrument,enquadramento:'acessorio'}],[epi,instrument],[{...epi,tipoMovimentacao:'Devolução'}],[epi,{...instrument,tipoMovimentacao:'Devolução'}]]){
    const backend=modeloFichaParaItens(items),frontend=context.JP_FICHA.createSnapshot({}, {}, items).modeloFicha;
    assert.deepEqual(JSON.parse(JSON.stringify(frontend)),backend);
    assert.equal(backend.termoResponsabilidade,modeloFichaParaItens([epi]).termoResponsabilidade);
    assert.ok(!backend.termoResponsabilidade.includes('recebidas na presente data'));
    assert.ok(!/certificado|anexo/i.test(backend.termoResponsabilidade));
  }
  assert.match(modeloFichaParaItens([epi]).termoResponsabilidade,/recebi gratuitamente.*fui orientado/is);
});

test('CA não aplicável exige classificação explícita de item não EPI',()=>{
  assert.equal(equipmentCaLabel({semCA:true}),'Sem CA');
  assert.equal(equipmentCaLabel({semCA:true,enquadramento:'instrumento'}),'CA não aplicável');
  assert.throws(()=>classifyEquipment({semCA:false},'instrumento'),{code:'ENQUADRAMENTO_INVALIDO'});
  assert.throws(()=>classifyEquipment({semCA:true},'epi'),{code:'ENQUADRAMENTO_INVALIDO'});
});

test('termo corresponde integralmente ao modelo aprovado e conserva a confirmação eletrônica',()=>{
 const model=modeloFichaParaItens([{tipoMovimentacao:'Entrega',enquadramento:'epi'}]);
 assert.equal(model.id,'JP-EPI-2026.11-v2');
 assert.equal(createHash('sha256').update(model.termoResponsabilidade).digest('hex'),'5ed3e0fbbcaf48a587166d9cb103fcc82c115222628ae8a87ab2d550960ccb4f');
 assert.match(model.termoAssinatura,/vinculada exclusivamente a esta ficha/);
});
