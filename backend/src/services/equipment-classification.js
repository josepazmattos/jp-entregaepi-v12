import { httpError } from '../middleware/auth.js';
export const NON_EPI = Object.freeze({instrumento:'Instrumento',uniforme:'Uniforme',acessorio:'Acessório',outro_nao_epi:'Outro equipamento (não EPI)'});
export function classifyEquipment(epi, requested) {
  const without = epi.semCA === true || epi.tipo === 'sem_ca';
  const value = requested || epi.enquadramento || (without ? 'nao_classificado' : 'epi');
  if (typeof value !== 'string' || !['epi','nao_classificado',...Object.keys(NON_EPI)].includes(value)
      || !without && value !== 'epi' || without && value === 'epi') {
    throw httpError(400, 'O enquadramento deve corresponder ao tipo do equipamento e ao CA.', 'ENQUADRAMENTO_INVALIDO');
  }
  return {enquadramento:value};
}
export const equipmentCaLabel = item => item.semCA ? (NON_EPI[item.enquadramento] ? 'CA não aplicável' : 'Sem CA') : item.ca;
export function equipmentPrintName(item) {
  const name = item.epiNome || item.epiDescricao || '';
  if (!item.enquadramento) return name;
  const detail = [NON_EPI[item.enquadramento] || (item.enquadramento === 'epi' ? 'EPI' : 'Enquadramento não informado'), item.fabricante, item.modelo, item.tamanho].filter(Boolean).join(' · ');
  return name + '\n' + detail;
}
