import {httpError} from '../middleware/auth.js';
export const TERMO_ASSINATURA_ID='JP-ASSINATURA-BIOMETRICA-20261030-v1';
export const TERMO_ASSINATURA='Após conferir os itens, quantidades, datas e declarações desta ficha, confirmo seu conteúdo e reconheço a captura biométrica realizada por mim, digital ou facial conforme o método registrado, como minha assinatura eletrônica deste documento. Esta confirmação é vinculada exclusivamente a esta ficha e às evidências de autoria e integridade registradas pelo sistema.';

export function acceptanceFor(ficha,body,actor,method,at=new Date().toISOString()){
  const model=ficha?.modeloFicha;
  if(!model?.termoAssinatura)return null;
  if(model.termoAssinaturaId!==TERMO_ASSINATURA_ID||model.termoAssinatura!==TERMO_ASSINATURA)throw httpError(409,'O termo desta ficha não corresponde à versão disponível. Atualize a ficha.','ASSINATURA_TERMO_DIVERGENTE');
  if(body?.aceiteTermo!==true||body?.termoAssinaturaId!==model.termoAssinaturaId)throw httpError(400,'O trabalhador deve conferir a ficha e confirmar o termo antes da captura.','ASSINATURA_ACEITE_OBRIGATORIO');
  return {versao:model.termoAssinaturaId,texto:model.termoAssinatura,confirmado:true,metodo:method,registradoPor:actor,registradoEm:at};
}
