import { createHash } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { httpError } from '../middleware/auth.js';

const region = process.env.AWS_REGION || 'sa-east-1';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 2 }));
let verifier;
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function bearer(headers = {}) {
  const value = headers.authorization || headers.Authorization || '';
  if (typeof value !== 'string' || !/^Bearer [A-Za-z0-9_.-]{50,16000}$/.test(value)) throw httpError(401, 'Entre novamente no aplicativo.', 'SESSAO_INVALIDA');
  return value.slice(7);
}
export async function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 16000) throw httpError(401, 'Sessão inválida.', 'SESSAO_INVALIDA');
  verifier ||= CognitoJwtVerifier.create({ userPoolId: process.env.COGNITO_USER_POOL_ID, tokenUse: 'id', clientId: process.env.COGNITO_CLIENT_ID });
  try { return await verifier.verify(token); }
  catch { throw httpError(401, 'Sessão inválida ou expirada.', 'SESSAO_INVALIDA'); }
}
export const isMaster = claims => Array.isArray(claims['cognito:groups']) && claims['cognito:groups'].includes('MASTER');
export function createMfaSessions({ client = db, table = process.env.SECURITY_TABLE, clock = () => Date.now() } = {}) {
  const ready = () => { if (!table) throw httpError(503, 'A verificação de segurança está indisponível.', 'SEGURANCA_INDISPONIVEL'); };
  return {
    async verified(token, claims) {
      ready();
      const item = (await client.send(new GetCommand({ TableName: table, Key: { pk: 'MFA#' + tokenHash(token) }, ConsistentRead: true }))).Item;
      return Boolean(item && item.kind === 'mfa' && item.sub === claims.sub && item.authTime === Number(claims.auth_time) && item.expiresAtEpoch > clock() / 1000 && Number(claims.exp) > clock() / 1000);
    },
    async record(token, claims) {
      ready();
      // Called only after Cognito accepts a supported MFA challenge. Never
      // accept a browser-supplied token or a browser claim as evidence of MFA.
      await client.send(new PutCommand({ TableName: table, Item: { pk: 'MFA#' + tokenHash(token), kind: 'mfa', sub: claims.sub, authTime: Number(claims.auth_time), expiresAtEpoch: Number(claims.exp) }, ConditionExpression: 'attribute_not_exists(pk)' }));
    }
  };
}
export const mfaSessions = createMfaSessions();
export async function requireVerifiedMaster(token, claims, { recent = false, sessions = mfaSessions } = {}) {
  if (!isMaster(claims)) throw httpError(403, 'Esta operação exige o perfil Master.', 'PERFIL_NAO_AUTORIZADO');
  if (!await sessions.verified(token, claims)) throw httpError(403, 'Confirme o código de acesso para entrar como Master.', 'MFA_REQUIRED');
  const age = Date.now() / 1000 - Number(claims.auth_time);
  if (recent && (!Number.isFinite(age) || age < -60 || age > 600)) throw httpError(401, 'Confirme novamente sua senha e o código de acesso.', 'CERTIFICADO_REAUTENTICAR');
}
export function securityEvent(action, outcome, details = {}) {
  // Whitelist metadata: no token, MFA code, PFX, private key or request body.
  const safe = Object.fromEntries(['actor','company','operation','code','documentId'].filter(k => typeof details[k] === 'string').map(k => [k, details[k].slice(0, 128)]));
  console.log(JSON.stringify({ event: 'JP_SECURITY', action, outcome, at: new Date().toISOString(), ...safe }));
}
