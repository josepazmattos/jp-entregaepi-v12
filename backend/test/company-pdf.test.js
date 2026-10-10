import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCompany, validCnpj } from '../../frontend/EntregaEPI/assets/company-pdf.mjs';
const cell = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
const page = () => [cell('NUMERO DE INSCRICAO', 40, 740), cell('11.222.333/0001-81', 40, 720), cell('NOME EMPRESARIAL', 40, 680), cell('EMPRESA SINTETICA', 40, 660), cell('MUNICIPIO', 40, 620), cell('UF', 440, 620), cell('CIDADE EXEMPLO', 40, 600), cell('MS', 440, 600)];
test('cartão CNPJ extrai razão social e município/UF respeitando colunas e valida DV', () => {
  const result = extractCompany([page()]);
  assert.deepEqual(result.fields, { nome: 'EMPRESA SINTETICA', cnpj: '11.222.333/0001-81', localidade: 'CIDADE EXEMPLO/MS' });
  assert.deepEqual(result.warnings, []); assert.equal(validCnpj('00000000000000'), false); assert.equal(validCnpj('11222333000182'), false);
});
test('cartão com múltiplos CNPJs não mistura empresas e PDF sem texto mantém cadastro manual', () => {
  assert.deepEqual(extractCompany([[...page(), cell('11.444.777/0001-61', 40, 100)]]).fields, {});
  assert.match(extractCompany([[]]).warnings.join(' '), /PDF pesquisável/);
});
test('cartão aceita rótulos inline e CNPJ alfanumérico já suportado pelo cadastro', () => {
  assert.equal(validCnpj('12.ABC.345/01DE-35'), true);
  const result = extractCompany([[cell('CNPJ: 12.ABC.345/01DE-35', 0, 10), cell('RAZAO SOCIAL: EMPRESA SINTETICA', 0, 0)]]);
  assert.equal(result.fields.cnpj, '12.ABC.345/01DE-35'); assert.equal(result.fields.nome, 'EMPRESA SINTETICA');
});
