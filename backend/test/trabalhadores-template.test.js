import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { WORKER_COLUMNS, WORKER_IMPORT_LIMIT, validateWorker } from '../src/services/trabalhadores.service.js';
import { readWorkerXlsx, decodeXlsx } from '../src/services/trabalhadores-xlsx.service.js';

const templateUrl = new URL('../../frontend/EntregaEPI/assets/modelo-trabalhadores.xlsx', import.meta.url);
const cleanHeader = value => String(value || '').replace(/\s*\*\s*$/, '').trim();

async function template() {
  const bytes = await readFile(templateUrl);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return { bytes, workbook, sheet: workbook.getWorksheet('Trabalhadores') };
}

test('modelo XLSX publicado corresponde às colunas do importador e oferece 500 linhas vazias com formatos/Status corretos', async () => {
  const { bytes, sheet, workbook } = await template();
  assert.ok(sheet, 'A aba Trabalhadores deve existir no arquivo entregue ao usuário.');
  assert.ok(workbook.getWorksheet('Instruções'), 'O modelo deve manter as instruções de preenchimento.');
  assert.equal(WORKER_IMPORT_LIMIT, 500);
  assert.equal(sheet.rowCount, WORKER_IMPORT_LIMIT + 1);
  assert.equal(sheet.columnCount, WORKER_COLUMNS.length);
  assert.deepEqual(WORKER_COLUMNS.map((column, index) => cleanHeader(sheet.getCell(1, index + 1).text)), WORKER_COLUMNS.map(column => column.label));
  for (let row = 2; row <= WORKER_IMPORT_LIMIT + 1; row++) {
    for (let column = 1; column <= WORKER_COLUMNS.length; column++) {
      assert.ok(sheet.getCell(row, column).value == null || sheet.getCell(row, column).value === '', `A célula ${sheet.getCell(row, column).address} deve estar vazia.`);
    }
    for (const key of ['cpf', 'matriculaESocial', 'rg', 'telefone']) {
      const column = WORKER_COLUMNS.findIndex(item => item.key === key) + 1;
      assert.equal(sheet.getCell(row, column).numFmt, '@', `${key} deve usar formato Texto na linha ${row}.`);
    }
    const statusColumn = WORKER_COLUMNS.findIndex(item => item.key === 'status') + 1;
    const validation = sheet.getCell(row, statusColumn).dataValidation;
    assert.equal(validation.type, 'list', `Status deve oferecer uma lista na linha ${row}.`);
    assert.deepEqual(validation.formulae, ['"Ativo,Inativo"']);
  }
  assert.deepEqual(decodeXlsx(bytes.toString('base64'), 'modelo-trabalhadores.xlsx'), bytes);
  assert.deepEqual(await readWorkerXlsx(bytes), [], 'As células formatadas e a aba Instruções não devem produzir trabalhadores.');
});

test('cópia preenchida do modelo publicado preserva matrícula com zeros, data e ignora a aba Instruções', async () => {
  const { bytes, sheet, workbook } = await template();
  const person = {
    nomeCompleto: 'TRABALHADOR SINTÉTICO DO MODELO', cpf: '529.982.247-25', matriculaESocial: '000007',
    funcao: 'FUNÇÃO SINTÉTICA', localidade: 'CIDADE SINTÉTICA', setor: 'SETOR SINTÉTICO',
    dataAdmissao: new Date('2026-10-07T00:00:00.000Z'), rg: '00001234',
    email: 'synthetic@example.invalid', telefone: '067999990000', status: 'Ativo', observacoes: 'Somente dados de teste.'
  };
  WORKER_COLUMNS.forEach((column, index) => { sheet.getCell(2, index + 1).value = person[column.key]; });
  const dateColumn = WORKER_COLUMNS.findIndex(column => column.key === 'dataAdmissao') + 1;
  assert.match(sheet.getCell(2, dateColumn).numFmt, /d.*m.*y/i);
  // Fill only a disposable in-memory copy, exactly through the workbook's normal XLSX save path.
  const filled = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await readWorkerXlsx(filled);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].linha, 2);
  assert.deepEqual(rows[0].erros, []);
  assert.equal(rows[0].data.matriculaESocial, '000007');
  assert.equal(rows[0].data.dataAdmissao, '2026-10-07');
  assert.equal(rows[0].data.rg, '00001234');
  assert.equal(rows[0].data.telefone, '067999990000');
  assert.equal(rows[0].data.nomeCompleto, person.nomeCompleto);
  assert.deepEqual(validateWorker(rows[0].data).errors, []);
  assert.deepEqual(await readFile(templateUrl), bytes, 'O modelo original deve permanecer vazio e inalterado.');
});
