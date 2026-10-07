import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorization, gatewayClaimsKey, assertCompanyAccess } from '../src/middleware/auth.js';
import { empresaIdFrom } from '../src/routes/_helpers.js';

const issuer = 'https://cognito-idp.sa-east-1.amazonaws.com/test-pool';
const audience = 'synthetic-client';
const base = { sub: 'synthetic-user', iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1000) + 3600, token_use: 'id' };
const auth = createAuthorization({ issuer, audience, companyClaim: 'custom:empresa_id' });

function authorize(claims, middleware = auth, extra = {}) {
  const req = { headers: {}, query: {}, ...extra };
  if (claims) req[gatewayClaimsKey] = claims;
  let error;
  middleware(req, {}, value => { error = value; });
  return { req, error };
}

test('headers e body com claims alegados não substituem contexto verificado do gateway', () => {
  const { error } = authorize(null, auth, { headers: { authorization: 'Bearer synthetic', 'x-authorizer-claims': JSON.stringify({ ...base, 'cognito:groups': 'MASTER' }) }, body: { claims: base } });
  assert.equal(error.status, 401);
});

test('issuer, audience, token_use e prazo são verificados mesmo com contexto de gateway', () => {
  for (const change of [{ iss: 'another-issuer' }, { aud: 'another-client' }, { token_use: 'access' }, { exp: 1 }]) {
    assert.equal(authorize({ ...base, 'cognito:groups': 'MASTER', ...change }).error.status, 401);
  }
});

test('somente grupo MASTER confirmado concede acesso global; conta sem perfil continua bloqueada', () => {
  assert.equal(authorize({ ...base, 'cognito:groups': '[MASTER]' }).req.auth.master, true);
  assert.equal(authorize({ ...base, 'cognito:groups': 'NOT_MASTER' }).error.status, 403);
  assert.equal(authorize(base).error.code, 'PERFIL_NAO_CONFIGURADO');
});

test('EMPRESA sem vínculo confiável não ganha acesso, e não escolhe outra empresa no header', () => {
  assert.equal(authorize({ ...base, 'cognito:groups': 'EMPRESA' }).error.status, 403);
  const companyClaims = { ...base, 'cognito:groups': '[EMPRESA]', 'custom:empresa_id': 'company-A' };
  assert.equal(authorize(companyClaims, createAuthorization({ issuer, audience })).error.status, 403);
  const { req } = authorize(companyClaims);
  assert.equal(empresaIdFrom(req), 'company-A');
  assert.throws(() => assertCompanyAccess(req, 'company-B'), error => error.status === 403);
  req.headers['x-empresa-id'] = 'company-B';
  assert.throws(() => empresaIdFrom(req), error => error.status === 403);
});

test('requisição não pode misturar empresa de header, query e body', () => {
  const { req } = authorize({ ...base, 'cognito:groups': 'MASTER' });
  req.headers['x-empresa-id'] = 'company-A';
  req.body = { empresaId: 'company-B' };
  assert.throws(() => empresaIdFrom(req), error => error.status === 400);
});
