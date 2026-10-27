import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { httpError } from '../middleware/auth.js';
const client = new LambdaClient({ region: process.env.AWS_REGION || 'sa-east-1', maxAttempts: 1 });
export async function invokeSecurity(functionName, payload) {
  if (!functionName) throw httpError(503, 'O serviço de segurança está indisponível.', 'SEGURANCA_INDISPONIVEL');
  const result = await client.send(new InvokeCommand({ FunctionName: functionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(payload)) }));
  if (result.FunctionError) throw httpError(503, 'O serviço de segurança não concluiu a operação.', 'SEGURANCA_INDISPONIVEL');
  let response;
  try { response = JSON.parse(Buffer.from(result.Payload).toString('utf8')); } catch { throw httpError(503, 'Resposta inválida do serviço de segurança.', 'SEGURANCA_INDISPONIVEL'); }
  if (!response.ok) throw httpError(response.status || 500, response.error || 'A operação não foi concluída.', response.code || 'SEGURANCA_ERRO');
  return response.data;
}
