import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFicha } from '../src/services/ficha.service.js';
import { TERMO_APROVADO } from '../src/services/ficha-modelo.js';

test('emissão preserva matrícula eSocial alfanumérica acima do antigo limite de snapshot', () => {
  const matriculaESocial = '00Ab9Z'.repeat(600) + 'FINAL0';
  const empresa = { id: 'empresa-sintetica', nome: 'EMPRESA TESTE', cnpj: '00000000000000' };
  const trabalhador = { id: 'trabalhador-sintetico', empresaId: empresa.id, nomeCompleto: 'TRABALHADOR TESTE', funcao: 'FUNÇÃO TESTE', matriculaESocial };
  const ficha = buildFicha({ empresaId: empresa.id, empresa, trabalhador, items: [{ requested: { quantidade: 1 }, epi: { id: 'item-sintetico', descricao: 'EQUIPAMENTO TESTE', semCA: true } }], body: { tipo: 'Entrega' }, actor: 'ator-sintetico' });
  assert.equal(ficha.trabalhadorSnapshot.matriculaESocial, matriculaESocial);
  assert.equal(ficha.trabalhadorSnapshot.nomeCompleto, trabalhador.nomeCompleto);
  assert.equal(ficha.trabalhadorSnapshot.funcao, trabalhador.funcao);
  assert.equal(ficha.tipo, 'Entrega');
  assert.equal(ficha.modeloFicha.termoResponsabilidade, TERMO_APROVADO);
});
