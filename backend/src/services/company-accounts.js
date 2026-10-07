import {
  CognitoIdentityProviderClient, AdminGetUserCommand, AdminCreateUserCommand, AdminAddUserToGroupCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { httpError } from '../middleware/auth.js';
import { normalizeCnpj, normalizeCompanyLogin } from './empresa-validation.js';

// Public sign-in convention, not a secret. The user enters the eight CNPJ characters;
// the application maps an initial-password attempt to this policy-compliant value.
export const INITIAL_PASSWORD_PREFIX = 'JpEpi1-Inicial-';
export function companyTemporaryPassword(cnpj) {
  return INITIAL_PASSWORD_PREFIX + normalizeCnpj(cnpj).slice(0, 8);
}

function identity(user, companyClaim) {
  if (!user) return null;
  const attributes = Object.fromEntries((user.UserAttributes || user.Attributes || []).map(attribute => [attribute.Name, attribute.Value]));
  return {
    username: user.Username, sub: attributes.sub || '', companyId: attributes[companyClaim] || '',
    enabled: user.Enabled, status: user.UserStatus || ''
  };
}

export function createCognitoAccounts({ client, userPoolId, companyClaim = 'custom:empresa_id' } = {}) {
  function assertReady() {
    if (!client || !userPoolId || companyClaim !== 'custom:empresa_id') {
      throw httpError(503, 'O cadastro de acessos ainda não está configurado. Solicite ajuste ao administrador.', 'ACESSO_NAO_CONFIGURADO');
    }
  }
  async function inspect(login) {
    assertReady();
    try {
      return identity(await client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: normalizeCompanyLogin(login) })), companyClaim);
    } catch (error) {
      if (error.name === 'UserNotFoundException') return null;
      throw error;
    }
  }
  function assertBinding(account, { companyId, login, expectedSub }) {
    // Never adopt a pre-existing username based on login, CNPJ, e-mail or group alone.
    if (!account || account.companyId !== companyId || account.username !== login || !account.sub || expectedSub && account.sub !== expectedSub) {
      throw httpError(409, 'Este login já está vinculado a outro cadastro. O acesso existente foi preservado.', 'LOGIN_JA_UTILIZADO');
    }
    if (account.enabled !== true || !['FORCE_CHANGE_PASSWORD', 'CONFIRMED'].includes(account.status)) {
      throw httpError(409, 'A conta vinculada precisa de revisão administrativa antes de liberar o acesso.', 'ACESSO_REQUER_REVISAO');
    }
  }
  async function ensureCompanyAccess({ companyId, login, cnpj, expectedSub = '' }) {
    assertReady();
    login = normalizeCompanyLogin(login);
    let account = await inspect(login);
    if (!account) {
      if (expectedSub) throw httpError(409, 'A conta anteriormente vinculada não foi encontrada. Solicite revisão administrativa.', 'ACESSO_REQUER_REVISAO');
      try {
        const response = await client.send(new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: login,
          TemporaryPassword: companyTemporaryPassword(cnpj),
          UserAttributes: [{ Name: companyClaim, Value: companyId }],
          MessageAction: 'SUPPRESS',
          ForceAliasCreation: false
        }));
        account = identity(response.User, companyClaim);
      } catch (error) {
        if (error.name !== 'UsernameExistsException') throw error;
        // A concurrent attempt may have created this exact reserved company account.
        account = await inspect(login);
      }
    }
    assertBinding(account, { companyId, login, expectedSub });
    try {
      // Idempotent group membership; no password reset, user replacement or session revocation.
      await client.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: login, GroupName: 'EMPRESA' }));
    } catch (error) {
      error.accountIdentity = { sub: account.sub, status: account.status };
      throw error;
    }
    return { sub: account.sub, status: account.status, username: account.username };
  }
  return { assertReady, inspect, ensureCompanyAccess };
}

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'sa-east-1';
const userPoolId = process.env.COGNITO_USER_POOL_ID || (process.env.COGNITO_ISSUER || '').split('/').at(-1) || '';
export const companyAccounts = createCognitoAccounts({
  client: userPoolId ? new CognitoIdentityProviderClient({ region, maxAttempts: 3 }) : null,
  userPoolId,
  companyClaim: process.env.AUTH_COMPANY_CLAIM || ''
});
