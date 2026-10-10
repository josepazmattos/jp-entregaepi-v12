const ExcelJS = require('../../backend/node_modules/exceljs');
const CNPJ = '11222333000181';
async function socFile({ change, rows = 1, wide = true } = {}) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Modelo1');
  sheet.addRow(['Modelo 1']);
  const headers = ['Nome Funcionário', 'CPF', 'Matrícula', 'Matrícula RH', 'Nome Cargo', 'Função', 'Nome Setor', 'Cidade Unidade', 'Estado Unidade', 'CNPJ Unidade', 'Situação', 'Dt.Admissão', 'Rg', 'E-mail', 'Tel', 'Tipo Sanguíneo', 'Remuneração Mensal (R$)'];
  if (wide) while (headers.length < 118) headers.push('Campo ignorado ' + headers.length);
  sheet.addRow(headers);
  for (let i = 0; i < rows; i++) sheet.addRow(['PESSOA SINTÉTICA ' + (i + 1), i ? '11144477735' : '52998224725', i ? '00002B' : '00001A', 'RH-000' + (i + 1), 'TÉCNICO', 'DESCRIÇÃO ALTERNATIVA', 'OPERAÇÕES', 'CIDADE EXEMPLO', 'MS', CNPJ, 'S', '10/10/2020', 'RG-SINTETICO', 'exemplo@example.invalid', '67999990000', 'NAO_ARMAZENAR_SANGUE', 'NAO_ARMAZENAR_SALARIO']);
  if (change) change(sheet, book);
  return Buffer.from(await book.xlsx.writeBuffer());
}
function companyPdf({ scanned = false, cnpj = '11.222.333/0001-81', multiple = false } = {}) {
  const entries = [['COMPROVANTE DE INSCRICAO E SITUACAO CADASTRAL', 40, 780], ['NUMERO DE INSCRICAO', 40, 740], [cnpj, 40, 720], ['NOME EMPRESARIAL', 40, 680], ['EMPRESA SINTETICA LTDA', 40, 660], ['MUNICIPIO', 40, 620], ['UF', 440, 620], ['CIDADE EXEMPLO', 40, 600], ['MS', 440, 600], ['ENDERECO ELETRONICO', 40, 560], ['TELEFONE', 350, 560], ['CONTATO@EXAMPLE.INVALID', 40, 540], ['67 99999-0000', 350, 540]];
  if (multiple) entries.push(['11.444.777/0001-61', 40, 500]);
  const stream = scanned ? 'q Q' : entries.map(([text, x, y]) => `BT /F1 11 Tf ${x} ${y} Td (${text}) Tj ET`).join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
module.exports = { socFile, companyPdf, CNPJ };
