import { CognitoIdentityProviderClient, RespondToAuthChallengeCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { verifyToken, mfaSessions, securityEvent, isMaster } from './session.js';
import { httpError } from '../middleware/auth.js';
const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'sa-east-1', maxAttempts: 1 });
export function createAuthSecurity({ cognito = client, verify = verifyToken, sessions = mfaSessions, pool = process.env.COGNITO_USER_POOL_ID, appClient = process.env.COGNITO_CLIENT_ID, log = securityEvent } = {}) {
  return async event => {
    try {
      if (event?.action === 'challenge') {
        const { username, session, code } = event;
        if (typeof username !== 'string' || !username || username.length > 128 || typeof session !== 'string' || session.length < 20 || session.length > 4096 || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw httpError(400, 'Informe o código de seis números do autenticador.', 'MFA_CODE_INVALID');
        const response = await cognito.send(new RespondToAuthChallengeCommand({ ClientId: appClient, ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: session, ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code } }));
        const result = response.AuthenticationResult;
        if (!result?.IdToken || response.ChallengeName) throw httpError(401, 'A autenticação não foi concluída.', 'MFA_NOT_COMPLETED');
        const claims = await verify(result.IdToken);
        await sessions.record(result.IdToken, claims);
        log('MFA_AUTHENTICATION', 'success', { actor: claims.sub });
        return { ok: true, data: { AuthenticationResult: result } };
      }
      if (event?.action === 'status') {
        const claims = await verify(event.token), master = isMaster(claims);
        if (!master) return { ok: true, data: { required: false, verified: true } };
        const verified = await sessions.verified(event.token, claims);
        const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: pool, Username: claims['cognito:username'] }));
        return { ok: true, data: { required: true, verified, enrolled: (user.UserMFASettingList || []).includes('SOFTWARE_TOKEN_MFA'), recent: verified && Date.now() / 1000 - Number(claims.auth_time) <= 600 } };
      }
      throw httpError(400, 'Operação de segurança inválida.', 'SECURITY_ACTION');
    } catch (error) {
      log('MFA_AUTHENTICATION', 'denied', { code: error.code || error.name });
      const userError = ['CodeMismatchException','ExpiredCodeException','NotAuthorizedException','TooManyRequestsException'].includes(error.name);
      return { ok: false, status: error.status || (userError ? 401 : 503), code: userError ? 'MFA_CODE_INVALID' : error.code || 'SEGURANCA_INDISPONIVEL', error: error.status ? error.message : userError ? 'Código inválido ou sessão expirada. Confira o autenticador ou entre novamente.' : 'Não foi possível verificar a autenticação.' };
    }
  };
}
export const handler = createAuthSecurity();
