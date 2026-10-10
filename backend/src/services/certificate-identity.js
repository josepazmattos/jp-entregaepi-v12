import { httpError } from '../middleware/auth.js';

export function normalizeCpf(value) {
  const cpf=String(value||'').replace(/[.\-\s]/g,'');
  if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))throw httpError(400,'Informe um CPF válido.','REPRESENTANTE_CPF_INVALIDO');
  for(const length of [9,10]){const sum=[...cpf.slice(0,length)].reduce((n,c,i)=>n+Number(c)*(length+1-i),0),digit=(sum*10)%11%10;if(digit!==Number(cpf[length]))throw httpError(400,'Os dígitos verificadores do CPF são inválidos.','REPRESENTANTE_CPF_INVALIDO');}
  return cpf;
}
export function employerIdentity(company) {
  return {companyId:company.id,registrationType:company.inscricaoTipo==='CAEPF'?'CAEPF':'CNPJ',registrationNumber:String(company.cnpj||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase()};
}
export function representationActive(record,now=Date.now()) {
  return !!(record?.active&&record.checkedBy&&record.reference&&Number.isFinite(Date.parse(record.validUntil))&&Date.parse(record.validUntil)>now);
}
