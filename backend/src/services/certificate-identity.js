import { httpError } from '../middleware/auth.js';

export function normalizeCpf(value) {
  const cpf=String(value||'').replace(/[.\-\s]/g,'');
  if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))throw httpError(400,'Informe um CPF válido.','CERTIFICADO_CPF_INVALIDO');
  for(const length of [9,10]){const sum=[...cpf.slice(0,length)].reduce((n,c,i)=>n+Number(c)*(length+1-i),0),digit=(sum*10)%11%10;if(digit!==Number(cpf[length]))throw httpError(400,'Os dígitos verificadores do CPF são inválidos.','CERTIFICADO_CPF_INVALIDO');}
  return cpf;
}
export function employerIdentity(company) {
  return {companyId:company.id,registrationType:company.inscricaoTipo==='CAEPF'?'CAEPF':'CNPJ',registrationNumber:String(company.cnpj||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase()};
}
// DynamoDB maps do not retain insertion order. Signed content must use a fixed
// field order; identity equality must compare values, never JSON map order.
export function canonicalEmployerTarget(target) {
  return {companyId:target?.companyId,registrationType:target?.registrationType,registrationNumber:target?.registrationNumber};
}
export function sameEmployerTarget(left,right) {
  return ['companyId','registrationType','registrationNumber'].every(key=>typeof left?.[key]==='string'&&left[key]===right?.[key]);
}
