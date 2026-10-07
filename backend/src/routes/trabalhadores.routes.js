import { Router } from 'express';
import { create, list, get } from '../db/store.js';
import { ok, fail, empresaIdFrom, objectBody, textField, pickText } from './_helpers.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('trabalhador', empresaIdFrom(req)) }));

router.post('/', async (req, res) => {
  const body = objectBody(req);
  const empresaId = empresaIdFrom(req);
  if (!empresaId) return fail(res, 400, 'empresaId é obrigatório');
  if (!await get('empresa', empresaId)) return fail(res, 404, 'Empresa não encontrada');
  const nomeCompleto = textField(body.nomeCompleto || body.nome, { required: true, field: 'Nome completo', max: 300 });
  const matriculaESocial = textField(body.matriculaESocial || body.matriculaEsocial, { required: true, field: 'Matrícula eSocial', max: 100 });
  const cpf = textField(body.cpf, { required: true, field: 'CPF', max: 20 });
  const funcao = textField(body.funcao, { required: true, field: 'Função', max: 300 });
  const localidade = textField(body.localidade, { required: true, field: 'Localidade', max: 300 });
  if (body.status && !['Ativo', 'Inativo'].includes(body.status)) return fail(res, 400, 'Status do trabalhador inválido');

  const item = await create('trabalhador', {
    ...pickText(body, ['setor', 'dataAdmissao', 'rg', 'email', 'telefone', 'observacoes']),
    nomeCompleto,
    nome: nomeCompleto,
    matriculaESocial,
    cpf,
    funcao,
    localidade,
    empresaId,
    status: body.status || 'Ativo',
    criadoPor: req.auth.sub
  });
  ok(res, { item });
});

export default router;
