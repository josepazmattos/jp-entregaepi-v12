import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { WORKER_COLUMNS } from '../src/services/trabalhadores.service.js';
import { readWorkerXlsx, decodeXlsx, validateXlsxArchive } from '../src/services/trabalhadores-xlsx.service.js';

async function workbookFile(rows = [], change = () => {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Trabalhadores');
  sheet.addRow(WORKER_COLUMNS.map(column => column.label));
  sheet.columns.forEach(column => { column.numFmt = '@'; });
  rows.forEach(row => sheet.addRow(row));
  change(workbook, sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const row = ['TRABALHADOR SINTÉTICO', '529.982.247-25', '000001', 'FUNÇÃO SINTÉTICA', 'CIDADE SINTÉTICA'];

test('XLSX real é lido com zeros de matrícula, data, espaços e hyperlinks convertidos em texto', async () => {
  const bytes = await workbookFile([row], (workbook, sheet) => {
    sheet.getCell('G2').value = new Date('2026-10-07T00:00:00.000Z');
    sheet.getCell('G2').numFmt = 'dd/mm/yyyy';
    sheet.getCell('I2').value = { text: 'synthetic@example.invalid', hyperlink: 'mailto:synthetic@example.invalid' };
    sheet.getCell('L2').value = { richText: [{ text: 'Texto ' }, { text: 'sintético' }] };
    sheet.getRow(3).height = 30;
    workbook.addWorksheet('Instruções').getCell('A1').value = 'Orientações do modelo';
  });
  assert.deepEqual(decodeXlsx(bytes.toString('base64'), 'sintetico.xlsx'), bytes);
  const rows = await readWorkerXlsx(bytes);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].linha, 2);
  assert.equal(rows[0].data.matriculaESocial, '000001');
  assert.equal(rows[0].data.dataAdmissao, '2026-10-07');
  assert.equal(rows[0].data.email, 'synthetic@example.invalid');
  assert.equal(rows[0].data.observacoes, 'Texto sintético');
  assert.deepEqual(rows[0].erros, []);
});

test('matrícula numérica é aceita, CPF numérico restaura zeros e fórmulas são reportadas na linha', async () => {
  const bytes = await workbookFile([row], (workbook, sheet) => {
    sheet.getCell('B2').value = 1234567890;
    sheet.getCell('C2').value = 123;
    sheet.getCell('D2').value = { formula: 'CONCAT("cargo", " sintético")', result: 'Resultado não confiável' };
  });
  const [item] = await readWorkerXlsx(bytes);
  assert.equal(item.data.cpf, '01234567890');
  assert.equal(item.data.matriculaESocial, '123');
  assert.equal(item.erros.length, 1);
  assert.match(item.erros.join(' '), /fórmulas por valores/);
  assert.equal(item.data.funcao, undefined);
});

test('planilha sem aba/cabeçalho esperado, cabeçalho repetido ou células distantes é recusada', async () => {
  await assert.rejects(readWorkerXlsx(await workbookFile([row], (workbook, sheet) => { sheet.name = 'Outra'; })), error => error.code === 'PLANILHA_INVALIDA');
  await assert.rejects(readWorkerXlsx(await workbookFile([row], (workbook, sheet) => { sheet.getCell('C1').value = 'Coluna inventada'; })), error => error.code === 'PLANILHA_INVALIDA');
  await assert.rejects(readWorkerXlsx(await workbookFile([row], (workbook, sheet) => { sheet.getCell('D1').value = 'CPF'; })), error => error.code === 'PLANILHA_INVALIDA');
  await assert.rejects(readWorkerXlsx(await workbookFile([row], (workbook, sheet) => { sheet.getCell('A2001').value = 'Fora do modelo'; })), error => error.code === 'PLANILHA_INVALIDA');
});

test('conteúdo adulterado, base64 inválido, arquivo diferente de XLSX e expansão excessiva são recusados', async () => {
  const bytes = await workbookFile([row]);
  assert.throws(() => decodeXlsx(bytes.toString('base64'), 'sintetico.xlsm'), error => error.code === 'PLANILHA_INVALIDA');
  assert.throws(() => decodeXlsx('not base64', 'sintetico.xlsx'), error => error.code === 'PLANILHA_INVALIDA');
  assert.throws(() => validateXlsxArchive(Buffer.from('This is not an xlsx file')), error => error.code === 'PLANILHA_INVALIDA');
  const broken = Buffer.from(bytes);
  broken[100] ^= 255;
  assert.throws(() => validateXlsxArchive(broken), error => error.code === 'PLANILHA_INVALIDA');
  const expanded = Buffer.from(bytes);
  const central = expanded.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expanded.writeUInt32LE(20 * 1024 * 1024, central + 24);
  assert.throws(() => validateXlsxArchive(expanded), error => error.code === 'PLANILHA_INVALIDA');
});


test('matrículas aceitam células numéricas ou texto e preservam zeros explícitos sem alterar a planilha', async () => {
  const cases = [
    [1, 'General', '1'], [0, 'General', '0'], [123, '@', '123'],
    [123, '000000', '000123'], [123, '[Blue]000000', '000123'],
    [0, '00000;[Red]-00000;000000', '000000'],
    [123, '0.00', '123'], [123, '#,##0', '123'], [1200000, '0.00E+00', '1200000'],
    [12.5, 'General', '12.5'], [-12, 'General', '-12'],
    ['00001A', 'General', '00001A'], ['000123', '0', '000123'],
    ['000-RH/2026.12', '@', '000-RH/2026.12'],
    ['123456789012345678901234567890', 'General', '123456789012345678901234567890']
  ];
  const bytes = await workbookFile(cases.map(([value]) => [...row.slice(0, 2), value, ...row.slice(3)]), (workbook, sheet) => {
    cases.forEach(([, format], i) => { sheet.getCell(i + 2, 3).numFmt = format; });
  });
  const rows = await readWorkerXlsx(bytes);
  assert.deepEqual(rows.map(item => item.data.matriculaESocial), cases.map(item => item[2]));
  assert.ok(rows.every(item => item.erros.length === 0));
  const unsafe = await readWorkerXlsx(await workbookFile([[...row.slice(0, 2), 1e20, ...row.slice(3)]]));
  assert.match(unsafe[0].erros.join(' '), /precisão de leitura/);
});
