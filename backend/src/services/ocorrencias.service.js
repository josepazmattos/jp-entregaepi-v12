import { createHash, randomUUID } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { httpError } from '../middleware/auth.js';
import { textField } from '../routes/_helpers.js';
import { workerDate } from './trabalhadores.service.js';
import { companyEmails } from './empresa-validation.js';

export const OCCURRENCE_EMAIL = 'sac@jptreinamentos.com.br';
const entity = 'ocorrencia_epi';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reasons = { perda:'Perda', extravio:'Extravio', dano:'Dano', mau_uso:'Suspeita de uso inadequado' };
const ses = new SESv2Client({ region:process.env.AWS_REGION || 'sa-east-1', maxAttempts:1 });
export async function sendOccurrenceEmail(item) {
  const url = `https://www.jptreinamentos.com.br/EntregaEPI/?vale=${encodeURIComponent(item.id)}&empresa=${encodeURIComponent(item.empresaId)}`;
  const text = [
    'VALE DE DESCONTO — ENCAMINHADO PARA ANÁLISE DO RH',
    `Registro: ${item.numero}`, `Empresa: ${item.empresaNome}`, `Trabalhador: ${item.trabalhadorNome}`,
    `EPI anterior: ${item.equipamento} · CA: ${item.ca || 'Não informado'}`, `Quantidade: ${item.quantidade}`,
    `Entrega de origem: ${item.fichaNumero}`, `Data da ocorrência: ${item.data}`,
    `Motivo relatado: ${reasons[item.motivo]}`, `Relato: ${item.descricao}`,
    `EPI recolhido fisicamente: ${item.recolhido ? 'Sim' : 'Não'}`,
    ...(item.valorCentavos == null ? [] : [`Valor informado para análise: R$ ${(item.valorCentavos / 100).toFixed(2).replace('.',',')}`]),
    ...(item.manifestacao ? [`Manifestação do trabalhador: ${item.manifestacao}`] : []),
    '', 'Consulte o vale, a ficha original e a reposição pelo acesso autenticado da empresa:', url,
    'Após entrar, abra Entrega de EPI e clique em Abrir vale do e-mail. A ficha original pode ser impressa ou baixada pelo fluxo habitual.',
    '', 'Este registro não autoriza desconto automático e não altera a ficha de entrega. O RH deve apurar o dano, a responsabilidade, o ajuste prévio quando exigível e as regras aplicáveis antes de decidir. A reposição do EPI não depende dessa apuração.'
  ].join('\n');
  const recipients=item.email.destinatarios;
  const result = await ses.send(new SendEmailCommand({FromEmailAddress:OCCURRENCE_EMAIL, Destination:{ToAddresses:recipients,...(recipients.some(x=>x.toLowerCase()===OCCURRENCE_EMAIL)?{}:{CcAddresses:[OCCURRENCE_EMAIL]})}, Content:{Simple:{Subject:{Data:`[EntregaEPI] ${item.numero} — análise do RH`,Charset:'UTF-8'},Body:{Text:{Data:text,Charset:'UTF-8'}}}}}), {abortSignal:AbortSignal.timeout(8000)});
  return result.MessageId;
}
export function publicOccurrence(item) {
  if(!item)return item;
  const {pk,sk,entity:kind,requestHash,...data}=item;
  return data;
}
export function createOccurrenceService(db, send=sendOccurrenceEmail) {
  async function register(ficha, body, actor) {
    const requestId=textField(body.requestId,{required:true,field:'Solicitação',max:100});
    const scope=`epi-occurrence:${ficha.empresaId}:${actor}`;
    const requestHash=hash({fichaId:ficha.id,indice:body.indice,quantidade:body.quantidade,motivo:body.motivo,data:body.data,descricao:body.descricao,manifestacao:body.manifestacao,recolhido:body.recolhido,valorCentavos:body.valorCentavos});
    const replay=async()=>{const receipt=await db.getReceipt(scope,requestId);if(!receipt)return null;if(receipt.result.hash!==requestHash)throw httpError(409,'Solicitação já utilizada com outros dados.');return db.get(entity,receipt.result.id);};
    const previous=await replay();if(previous)return previous;
    if(ficha.status==='cancelada')throw httpError(409,'A ficha de origem está cancelada.');
    const index=body.indice,item=Number.isSafeInteger(index)&&ficha.itens?.[index];
    if(!item || !['Entrega','Troca'].includes(item.tipoMovimentacao||ficha.tipo||'Entrega'))throw httpError(400,'Selecione um item de uma entrega anterior.');
    if(!Number.isSafeInteger(body.quantidade)||body.quantidade<1||body.quantidade>Number(item.quantidade))throw httpError(400,'Quantidade inválida para o item de origem.');
    if(!Object.hasOwn(reasons,body.motivo)||typeof body.recolhido!=='boolean')throw httpError(400,'Informe o motivo e se houve recolhimento físico.');
    if(['perda','extravio'].includes(body.motivo)&&body.recolhido)throw httpError(400,'Perda ou extravio não podem ser registrados como recolhimento físico.');
    const date=workerDate(body.data);if(!date||date>new Date().toISOString().slice(0,10))throw httpError(400,'Informe uma data válida, até hoje.');
    const delivered=workerDate(item.datasMovimentacao?.entrega||ficha.data);if(delivered&&date<delivered)throw httpError(400,'A ocorrência não pode anteceder a entrega de origem.');
    if(body.valorCentavos!=null&&(!Number.isSafeInteger(body.valorCentavos)||body.valorCentavos<0||body.valorCentavos>100000000))throw httpError(400,'Valor informado inválido.');
    const data={empresaId:ficha.empresaId,trabalhadorId:ficha.trabalhadorId,fichaId:ficha.id,fichaNumero:ficha.numero||ficha.id,indice:index,epiId:item.epiId||'',equipamento:item.epiNome||item.epiDescricao||'',ca:item.ca||'',empresaNome:ficha.empresaSnapshot?.nome||'',trabalhadorNome:ficha.trabalhadorSnapshot?.nomeCompleto||ficha.trabalhadorNome||'',quantidade:body.quantidade,motivo:body.motivo,data:date,descricao:textField(body.descricao,{required:true,field:'Relato',max:2000}),manifestacao:textField(body.manifestacao,{field:'Manifestação',max:2000}),recolhido:body.recolhido,valorCentavos:body.valorCentavos??null,status:'pendente_analise_rh',email:{destinatario:OCCURRENCE_EMAIL,status:'pendente'},criadoPor:actor};
    const balanceId=hash([ficha.id,index]);
    for(let attempt=0;attempt<3;attempt++){
      const existing=await replay();if(existing)return existing;
      const balance=await db.get('ocorrencia_saldo',balanceId),used=balance?.quantidade||0;
      if(used+data.quantidade>Number(item.quantidade))throw httpError(409,'Esta quantidade já foi vinculada a outro vale. Consulte os vales antes de registrar novamente.');
      const id=randomUUID();
      try{
        await db.transact({scope,expectedRevision:await db.readScope(scope),mutationId:requestId,operations:[{type:'create',entity,id,data:{...data,numero:`VALE-${new Date().getFullYear()}-${id.slice(0,8).toUpperCase()}`}},{type:balance?'update':'create',entity:'ocorrencia_saldo',id:balanceId,...(balance?{expectedVersion:balance._version}:{}),data:{empresaId:ficha.empresaId,quantidade:used+data.quantidade}}],result:{id,hash:requestHash}});
        return db.get(entity,id);
      }catch(error){const saved=await replay();if(saved)return saved;if(!['REGISTRO_ALTERADO','ConditionalCheckFailedException','TransactionCanceledException'].includes(error.code||error.name)||attempt===2)throw error;}
    }
  }
  async function notify(item, actor) {
    if(item.email?.status==='enviado')return item;
    if(['enviando','conferir_envio'].includes(item.email?.status))throw httpError(409,'O envio está em processamento ou requer conferência no SAC antes de repetir.');
    const company=await db.get('empresa',item.empresaId);
    if(!company||company.excluidaEm)throw httpError(403,'Empresa indisponível.');
    const addresses=companyEmails(company.email||'');
    const claimed=await db.update(entity,item.id,{email:{destinatarios:addresses.length?addresses:[OCCURRENCE_EMAIL],copia:addresses.some(x=>x.toLowerCase()===OCCURRENCE_EMAIL)?[]:addresses.length?[OCCURRENCE_EMAIL]:[],status:'enviando',iniciadoEm:new Date().toISOString(),solicitadoPor:actor}},{expectedVersion:item._version});
    let messageId;
    try{messageId=await send(claimed);}
    catch(error){
      // A timeout may mean SES accepted the message. Do not send it twice automatically.
      const definite=['MessageRejected','BadRequestException','MailFromDomainNotVerifiedException','AccountSuspendedException','SendingPausedException','AccessDeniedException','AccessDenied','TooManyRequestsException'].includes(error.name);
      return db.update(entity,item.id,{email:{...claimed.email,status:definite?'falha':'conferir_envio',erro:definite?'O serviço recusou o envio. Tente novamente após corrigir a causa.':'O resultado do envio precisa ser conferido no SAC antes de repetir.'}},{expectedVersion:claimed._version});
    }
    return db.update(entity,item.id,{email:{...claimed.email,status:'enviado',enviadoEm:new Date().toISOString(),messageId}},{expectedVersion:claimed._version});
  }
  async function link(item, replacement, actor) {
    if(replacement.empresaId!==item.empresaId||replacement.trabalhadorId!==item.trabalhadorId)throw httpError(403,'A reposição não pertence ao mesmo trabalhador e empresa.');
    if(replacement.id===item.fichaId||replacement.status==='cancelada'||!replacement.itens?.some(i=>['Entrega','Troca'].includes(i.tipoMovimentacao||replacement.tipo||'Entrega')))throw httpError(400,'Selecione a nova ficha de entrega para reposição.');
    if(item.reposicaoFichaId){if(item.reposicaoFichaId===replacement.id)return item;throw httpError(409,'O vale já possui uma ficha de reposição vinculada.');}
    return db.update(entity,item.id,{reposicaoFichaId:replacement.id,reposicaoNumero:replacement.numero||replacement.id,reposicaoVinculadaPor:actor,reposicaoVinculadaEm:new Date().toISOString()},{expectedVersion:item._version});
  }
  return {register,notify,link};
}
