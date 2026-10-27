import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
const region=process.env.AWS_REGION||'sa-east-1';
const ses=new SESv2Client({region,maxAttempts:2});
const db=DynamoDBDocumentClient.from(new DynamoDBClient({region,maxAttempts:2}));
export function alertSummary(event){
  if(event?.source==='aws.cloudwatch'&&event.detail?.state?.value==='ALARM'&&/^jp-entregaepi-security-/.test(event.detail.alarmName||''))return {title:'Limite de segurança atingido',operation:event.detail.alarmName,description:event.detail.state.reason||'Confira o painel CloudWatch.'};
  const d=event?.detail;
  if(event?.source==='aws.kms'&&d?.eventSource==='kms.amazonaws.com'&&['ScheduleKeyDeletion','DisableKey','DeleteImportedKeyMaterial','PutKeyPolicy','ImportKeyMaterial','CreateGrant'].includes(d.eventName))return {title:'Alteração no cofre de certificados',operation:d.eventName,description:'Uma operação administrativa foi registrada no KMS. Confira se corresponde a uma alteração autorizada no EntregaEPI.'};
  if(event?.source==='aws.cloudtrail'&&d?.eventSource==='cloudtrail.amazonaws.com'&&['StopLogging','DeleteTrail','UpdateTrail','PutEventSelectors'].includes(d.eventName))return {title:'Alteração na auditoria',operation:d.eventName,description:'A configuração da trilha de auditoria foi alterada. Verifique a continuidade da gravação dos eventos.'};
  if(event?.source==='aws.cognito-idp'&&d?.eventSource==='cognito-idp.amazonaws.com'&&['AdminSetUserMFAPreference','SetUserPoolMfaConfig','UpdateUserPool','UpdateUserPoolClient','AdminAddUserToGroup','AdminRemoveUserFromGroup','AdminDeleteUser'].includes(d.eventName))return {title:'Alteração nos controles de acesso',operation:d.eventName,description:'Uma configuração de MFA, perfil ou conta do EntregaEPI foi alterada no Cognito. Confira a autorização e o responsável no CloudTrail.'};
  if(event?.source==='jp.entregaepi.security'&&d?.type==='deployment-test')return {title:'Teste de alertas concluído',operation:'DEPLOYMENT_TEST',description:'O envio de alertas de segurança do EntregaEPI está funcionando. Este é um teste da atualização solicitada.'};
  return null;
}
export async function handler(event){
  const summary=alertSummary(event);if(!summary)return {ignored:true};
  const id=String(event.id||'');if(!/^[A-Za-z0-9_-]{8,128}$/.test(id))throw new Error('ALERT_ID');
  const table=process.env.SECURITY_TABLE,key={pk:'ALERT#'+id};
  try{await db.send(new PutCommand({TableName:table,Item:{...key,kind:'alert',operation:summary.operation,createdAt:new Date().toISOString(),expiresAtEpoch:Math.floor(Date.now()/1000)+7*86400},ConditionExpression:'attribute_not_exists(pk)'}));}
  catch(error){if(error.name==='ConditionalCheckFailedException')return {duplicate:true};throw error;}
  try{
    const text=[summary.description,'','Aplicativo: JP EntregaEPI','Operação: '+summary.operation,'Data do evento: '+(event.time||new Date().toISOString()),'Identificação: '+id,'','Console AWS: https://sa-east-1.console.aws.amazon.com/cloudwatch/home?region=sa-east-1#alarmsV2:','Trilha: jp-entregaepi-security','', 'Mensagem automática da segurança JP. Não contém certificados, senhas ou dados biométricos.'].join('\n');
    await ses.send(new SendEmailCommand({FromEmailAddress:process.env.ALERT_EMAIL,Destination:{ToAddresses:[process.env.ALERT_EMAIL]},Content:{Simple:{Subject:{Data:'[JP EntregaEPI] '+summary.title,Charset:'UTF-8'},Body:{Text:{Data:text,Charset:'UTF-8'}}}}}));
    console.log(JSON.stringify({event:'JP_SECURITY_ALERT',outcome:'sent',eventId:id,operation:summary.operation}));return {sent:true,eventId:id};
  }catch(error){await db.send(new DeleteCommand({TableName:table,Key:key}));throw new Error('ALERT_DELIVERY_FAILED');}
}
