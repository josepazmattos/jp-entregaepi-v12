// Whitelist printable metadata; templates, keys and proof payloads never leave here.
export function companyForReport(company) {
  return Object.fromEntries(['id','nome','cnpj','inscricaoTipo','localidade','uf','logoDataUrl'].map(key => [key, company[key] || '']));
}
export function workerForReport(worker) {
  return {id:worker.id, empresaId:worker.empresaId, nome:worker.nomeCompleto || worker.nome || '',
    cpf:worker.cpf || '', funcao:worker.funcao || '', matriculaESocial:worker.matriculaESocial || '', status:worker.status || 'Ativo'};
}
export function workerEnrollmentSummary(worker) {
  const fingers = Object.entries(worker.biometrias || {}).filter(([finger]) => /^(R|L)_(THUMB|INDEX|MIDDLE|RING|LITTLE)$/.test(finger))
    .map(([fingerCode, item]) => ({fingerCode, enrolledAt:item.enrolledAt || ''}));
  return {...workerForReport(worker), fingers};
}
