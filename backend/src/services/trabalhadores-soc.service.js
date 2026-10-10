import ExcelJS from 'exceljs';
import { httpError } from '../middleware/auth.js';
import { normalizeCnpj } from './empresa-validation.js';
import { plainCell, validateXlsxArchive } from './trabalhadores-xlsx.service.js';
import { WORKER_IMPORT_LIMIT } from './trabalhadores.service.js';

const fold = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const invalid = message => httpError(400, message, 'SOC_PLANILHA_INVALIDA');
const names = {
  nomeCompleto: ['nomefuncionario', 'nomecompleto'], cpf: ['cpf'],
  matricula: ['matricula'], matriculaRH: ['matricularh'],
  cargo: ['nomecargo'], funcao: ['funcao'], setor: ['nomesetor'],
  cidade: ['cidadeunidade'], uf: ['estadounidade', 'ufunidade'],
  cnpjUnidade: ['cnpjunidade'], cnpj: ['cnpj'],
  dataAdmissao: ['dtadmissao', 'dataadmissao'], status: ['situacao'],
  rg: ['rg'], email: ['email'], telefone: ['telefonecelular', 'tel']
};

// Only this allowlist is converted. The workbook and its other columns are never persisted.
export async function readSocXlsx(bytes, { companyCnpj, matriculaColumn = 'matricula' } = {}) {
  if (!['matricula', 'matriculaRH'].includes(matriculaColumn)) throw invalid('Escolha Matrícula ou Matrícula RH como origem da matrícula eSocial.');
  let selectedCnpj;
  try { selectedCnpj = normalizeCnpj(companyCnpj); }
  catch { throw invalid('Complete o CNPJ válido da empresa antes de importar o SOC.'); }
  validateXlsxArchive(bytes, { soc: true });
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes, { ignoreNodes: ['drawing', 'picture', 'conditionalFormatting', 'dataValidations', 'extLst'] }); }
  catch { throw invalid('Não foi possível ler o arquivo SOC. Exporte novamente no formato .xlsx.'); }
  const candidates = [];
  for (const sheet of workbook.worksheets) {
    for (let number = 1; number <= Math.min(10, sheet.rowCount); number++) {
      const row = sheet.getRow(number), columns = new Map();
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const label = fold(cell.text);
        if (!columns.has(label)) columns.set(label, []);
        columns.get(label).push(column);
      });
      if (names.nomeCompleto.some(n => columns.has(n)) && columns.has('cpf') && columns.has('matricula')) candidates.push({ sheet, number, columns });
    }
  }
  if (candidates.length !== 1) throw invalid(candidates.length ? 'Há mais de uma relação de trabalhadores. Envie uma aba SOC por vez.' : 'Não foi encontrado o cabeçalho do SOC Modelo 1 com Nome Funcionário, CPF e Matrícula.');
  const { sheet, number, columns } = candidates[0];
  const mapped = {};
  for (const [key, aliases] of Object.entries(names)) {
    mapped[key] = aliases.flatMap(alias => columns.get(alias) || []);
    if (aliases.some(alias => (columns.get(alias) || []).length > 1)) throw invalid(`Cabeçalho repetido no campo ${key}. Confira a planilha SOC.`);
  }
  for (const key of ['nomeCompleto', 'cpf', matriculaColumn, 'cidade', 'uf', 'status']) {
    if (!mapped[key].length) throw invalid(`Coluna obrigatória do SOC ausente: ${key === 'matriculaRH' ? 'Matrícula RH' : names[key][0]}.`);
  }
  if (!mapped.cargo.length && !mapped.funcao.length) throw invalid('A planilha SOC deve conter Nome Cargo ou Função.');
  if (!mapped.cnpjUnidade.length && !mapped.cnpj.length) throw invalid('A planilha SOC deve conter CNPJ Unidade ou CNPJ para conferir o vínculo da empresa.');
  const rows = [];
  for (let line = number + 1; line <= sheet.rowCount; line++) {
    const row = sheet.getRow(line);
    if (!['nomeCompleto', 'cpf', matriculaColumn].some(key => mapped[key].some(col => row.getCell(col).value != null && row.getCell(col).value !== ''))) continue;
    const errors = [], data = {};
    const value = (key, target = key) => {
      for (const col of mapped[key] || []) {
        try { const text = plainCell(row.getCell(col), target); if (text) return text; }
        catch (error) { errors.push(`${sheet.getRow(number).getCell(col).text}: ${error.message}`); return ''; }
      }
      return '';
    };
    for (const key of ['nomeCompleto', 'cpf', 'setor', 'dataAdmissao', 'rg', 'email', 'telefone']) {
      const text = value(key); if (text) data[key] = text;
    }
    data.matriculaESocial = value(matriculaColumn, 'matriculaESocial');
    data.funcao = value('cargo', 'funcao') || value('funcao');
    const city = value('cidade'), state = value('uf').toUpperCase();
    data.localidade = [city, state].filter(Boolean).join('/');
    if (!city || !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(state)) errors.push('Confira Cidade Unidade e Estado Unidade para preencher a localidade de trabalho.');
    const situation = fold(value('status'));
    if (['s', 'ativo'].includes(situation)) data.status = 'Ativo';
    else if (['n', 'inativo'].includes(situation)) data.status = 'Inativo';
    else errors.push('Situação SOC sem equivalência automática. Use S/Ativo ou N/Inativo; para outros casos, confira o status pelo cadastro manual ou modelo EntregaEPI.');
    const sourceCnpj = value('cnpjUnidade') || value('cnpj');
    try { if (normalizeCnpj(sourceCnpj) !== selectedCnpj) errors.push('CNPJ da unidade diferente da empresa selecionada. Separe a relação por empresa antes de importar.'); }
    catch { errors.push('CNPJ da unidade ausente ou inválido na planilha SOC.'); }
    rows.push({ linha: line, data, erros: errors });
    if (rows.length > WORKER_IMPORT_LIMIT) throw invalid(`Cada importação admite até ${WORKER_IMPORT_LIMIT} trabalhadores. Divida a relação em arquivos menores.`);
  }
  return rows;
}
