import { Router } from 'express';
import { create, list, get } from '../db/store.js';
import { ok, fail, empresaIdFrom, objectBody, textField, pickText } from './_helpers.js';
import { consultarCA, normalizarCA } from '../services/caepi.service.js';

const router = Router();

router.get('/', async (req, res) => ok(res, { items: await list('epi', empresaIdFrom(req)) }));
router.get('/ca/:ca', async (req, res) => ok(res, { item: await consultarCA(req.params.ca) }));

router.post('/', async (req, res) => {
  const body = objectBody(req);
  const empresaId = empresaIdFrom(req);
  if (!empresaId) return fail(res, 400, 'empresaId é obrigatório');
  if (!await get('empresa', empresaId)) return fail(res, 404, 'Empresa não encontrada');
  const ca = normalizarCA(body.ca);
  if (!ca) return fail(res, 400, 'Informe um número de CA válido');
  const descricao = textField(body.descricao || body.description || body.name, { required: true, field: 'Descrição do EPI', max: 2000 });
  const item = await create('epi', {
    ...pickText(body, ['observacoes', 'modelo', 'tamanho', 'lote']),
    empresaId,
    ca,
    descricao,
    name: descricao,
    fabricante: textField(body.fabricante || body.manufacturer),
    validade: textField(body.validade || body.validity),
    situacao: textField(body.situacao || body.status) || 'Conferência necessária',
    origemCadastro: 'informado_pelo_usuario',
    criadoPor: req.auth.sub
  });
  ok(res, { item });
});

export default router;
