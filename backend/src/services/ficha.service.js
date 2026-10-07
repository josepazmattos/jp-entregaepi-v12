import { equipmentName } from './equipment-name.js';
import { createHash, randomUUID } from 'node:crypto';
import { httpError } from '../middleware/auth.js';
import { textField } from '../routes/_helpers.js';
import { MODELO_FICHA_APROVADO, TERMO_APROVADO } from './ficha-modelo.js';
import { validateCaptureImage } from './capture-image.js';

export function fichaSnapshots(empresa, trabalhador) {
  return {
    empresaSnapshot: {
      nome: textField(empresa.nome || empresa.name),
      cnpj: textField(empresa.cnpj),
      localidade: textField(empresa.localidade || empresa.city),
      uf: textField(empresa.uf || empresa.UF),
      logoDataUrl: typeof empresa.logoDataUrl === 'string' ? empresa.logoDataUrl : '',
      logoUrl: typeof empresa.logoUrl === 'string' ? empresa.logoUrl : '',
      logo: typeof empresa.logo === 'string' ? empresa.logo : ''
    },
    trabalhadorSnapshot: {
      nomeCompleto: textField(trabalhador.nomeCompleto || trabalhador.nome || trabalhador.name),
      cpf: textField(trabalhador.cpf),
      funcao: textField(trabalhador.funcao || trabalhador.job || trabalhador.cargo),
      matriculaESocial: textField(trabalhador.matriculaESocial || trabalhador.matriculaEsocial || trabalhador.esocial, { field: 'Matrícula eSocial', max: Infinity }),
      localidade: textField(trabalhador.localidade || trabalhador.city)
    }
  };
}

function fichaDate(value) {
  if (!value) return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Campo_Grande' });
  const text = textField(value, { field: 'Data', max: 10 });
  const parts = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw httpError(400, 'Data da movimentação inválida.', 'DATA_INVALIDA');
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw httpError(400, 'Data da movimentação inválida.', 'DATA_INVALIDA');
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function buildFicha({ empresaId, empresa, trabalhador, items, body, actor }) {
  const tipo = body.tipo || 'Entrega';
  if (!['Entrega', 'Troca', 'Devolução'].includes(tipo)) throw httpError(400, 'Tipo da movimentação inválido.', 'MOVIMENTACAO_INVALIDA');
  const normalizedItems = items.map(({ requested, epi }) => {
    // The technical equipment catalog is shared. Workers and issued documents
    // remain company-scoped; their authorization is checked before this builder.
    if (!epi) throw httpError(404, 'Equipamento não encontrado no catálogo compartilhado.', 'EPI_NAO_ENCONTRADO');
    const quantidade = Number(requested.quantidade ?? 1);
    if (!Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > 100000) throw httpError(400, 'A quantidade deve ser um número inteiro maior que zero.', 'QUANTIDADE_INVALIDA');
    return {
      epiId: epi.id,
      epiNome: equipmentName(epi),
      epiDescricao: equipmentName(epi),
      ca: textField(epi.ca),
      semCA: epi.semCA === true || epi.tipo === 'sem_ca',
      fabricante: textField(epi.fabricante || epi.manufacturer),
      validade: textField(epi.validade || epi.validity),
      quantidade
    };
  });
  if (body.modeloFicha != null) {
    if (typeof body.modeloFicha !== 'object' || Array.isArray(body.modeloFicha) || body.modeloFicha.id !== 'JP-DOCX-11.10.6') {
      throw httpError(400, 'Modelo de ficha não reconhecido.', 'MODELO_FICHA_INVALIDO');
    }
    if (body.modeloFicha.termoResponsabilidade !== TERMO_APROVADO) throw httpError(400, 'O Termo de Responsabilidade diverge do modelo aprovado. Atualize o aplicativo para emitir a ficha.', 'TERMO_FICHA_DIVERGENTE');
  }
  return {
    numero: `EPI-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
    empresaId,
    trabalhadorId: trabalhador.id,
    trabalhadorNome: trabalhador.nomeCompleto || trabalhador.nome || trabalhador.name || '',
    ...fichaSnapshots(empresa, trabalhador),
    modeloFicha: { ...MODELO_FICHA_APROVADO },
    itens: normalizedItems,
    status: 'pendente',
    tipo,
    data: fichaDate(body.data),
    criadoPor: actor
  };
}

export function normalizeImageCapture(body, actor) {
  // Legacy readers use realFingerImage as a boolean and put the image in a separate field.
  const image = [body.realFingerImage, body.fingerImageDataUrl, body.imageDataUrl, body.image]
    .find(value => typeof value === 'string' && value.trim());
  if (typeof image !== 'string') throw httpError(400, 'Uma imagem da captura é obrigatória.', 'CAPTURA_AUSENTE');
  const capture = validateCaptureImage(image);
  const dedo = textField(body.dedo || body.fingerCode, { required: true, field: 'Dedo utilizado', max: 100 });
  let request = {};
  if (body.captureRequestId != null) {
    if (typeof body.captureRequestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.captureRequestId)) {
      throw httpError(400, 'Identificador da tentativa de captura inválido. Inicie uma nova captura.', 'CAPTURA_SOLICITACAO_INVALIDA');
    }
    request = {
      captureRequestId: body.captureRequestId.toLowerCase(),
      captureRequestHash: createHash('sha256').update(JSON.stringify([capture.mime, dedo])).update('\0').update(capture.bytes).digest('hex')
    };
  }
  return {
    realFingerImage: capture.dataUrl,
    dedo,
    ...request,
    id: randomUUID(),
    signedAt: new Date().toISOString(),
    capturadoPor: actor,
    metodo: 'captura_de_imagem',
    verificada: false,
    status: 'registrada_sem_verificacao_biometrica'
  };
}

export function isImageCaptureReplay(ficha, capture) {
  const previous = ficha?.assinaturaBiometrica;
  // The fetched ficha is the operation scope. The ID alone never authorizes
  // replay: actor and canonical image/finger content must also match.
  return Boolean(ficha?.status === 'assinada' && capture.captureRequestId
    && previous?.captureRequestId === capture.captureRequestId
    && previous.capturadoPor === capture.capturadoPor
    && previous.captureRequestHash === capture.captureRequestHash);
}
