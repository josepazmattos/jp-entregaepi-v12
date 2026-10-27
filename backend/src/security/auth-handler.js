import { CognitoIdentityProviderClient, RespondToAuthChallengeCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { verifyToken, mfaSessions, securityEvent, isMaster } from './session.js';
import { httpError } from '../middleware/auth.js';
const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'sa-east-1', maxAttempts: 1 });
export function createAuthSecurity({ cognito = client, verify = verifyToken, sessions = mfaSessions, pool = process.env.COGNITO_USER_POOL_ID, appClient = process.env.COGNITO_CLIENT_ID, log = securityEvent } = {}) {
  return async event => {
    try {
      if (event?.action === 'challenge') {
        const { username, session, code, challengeName = 'SOFTWARE_TOKEN_MFA' } = event;
        // EMAIL_OTP is a second factor here: the pool permits only PASSWORD as
        // the first factor. Do not enable passwordless USER_AUTH on this client.
        const codeField = challengeName === 'EMAIL_OTP' ? 'EMAIL_OTP_CODE' : challengeName === 'SOFTWARE_TOKEN_MFA' ? 'SOFTWARE_TOKEN_MFA_CODE' : null;
        if (!codeField) throw httpError(400, 'Método de verificação inválido.', 'MFA_METHOD_INVALID');
        if (typeof username !== 'string' || !username || username.length > 128 || typeof session !== 'string' || session.length < 20 || session.length > 4096 || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw httpError(400, 'Informe o código de seis números.', 'MFA_CODE_INVALID');
        const response = await cognito.send(new RespondToAuthChallengeCommand({ ClientId: appClient, ChallengeName: challengeName, Session: session, ChallengeResponses: { USERNAME: username, [codeField]: code } }));
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
        const methods = user.UserMFASettingList || [], method = methods.includes('EMAIL_OTP') ? 'email' : methods.includes('SOFTWARE_TOKEN_MFA') ? 'authenticator' : null;
        return { ok: true, data: { required: true, verified, enrolled: Boolean(method), method, recent: verified && Date.now() / 1000 - Number(claims.auth_time) <= 600 } };
      }
      throw httpError(400, 'Operação de segurança inválida.', 'SECURITY_ACTION');
    } catch (error) {
      log('MFA_AUTHENTICATION', 'denied', { code: error.code || error.name });
      const userError = ['CodeMismatchException','ExpiredCodeException','NotAuthorizedException','TooManyRequestsException'].includes(error.name);
      return { ok: false, status: error.status || (userError ? 401 : 503), code: userError ? 'MFA_CODE_INVALID' : error.code || 'SEGURANCA_INDISPONIVEL', error: error.status ? error.message : userError ? 'Código inválido ou expirado. Use o código deste acesso ou volte e entre novamente para receber outro.' : 'Não foi possível verificar a autenticação.' };
    }
  };
}
export const handler = createAuthSecurity();
