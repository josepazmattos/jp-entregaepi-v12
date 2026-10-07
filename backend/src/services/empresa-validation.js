import { httpError } from '../middleware/auth.js';
import { textField } from '../routes/_helpers.js';

export const MAX_LOGO_BYTES = 48 * 1024;
const MAX_LOGO_DIMENSION = 2048;

function invalid(field, message) {
  throw httpError(400, message || `${field} inválido.`, 'EMPRESA_CAMPO_INVALIDO');
}

export function normalizeCnpj(value) {
  const supplied = textField(value, { required: true, field: 'CNPJ', max: 30 }).toUpperCase();
  if (!/^[A-Z0-9.\/\-\s]+$/.test(supplied)) invalid('CNPJ', 'Informe um CNPJ com 14 caracteres, usando letras ou números nas primeiras 12 posições.');
  const cnpj = supplied.replace(/[.\/\-\s]/g, '');
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) invalid('CNPJ', 'Informe um CNPJ válido com 14 caracteres e dois dígitos verificadores numéricos.');
  // Receita Federal / Serpro: ASCII minus 48, modulo 11; this also preserves numeric CNPJs.
  // https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf
  const digit = base => {
    let weight = base.length - 7;
    const sum = [...base].reduce((total, number) => {
      const next = total + (number.charCodeAt(0) - 48) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return next;
    }, 0);
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const first = digit(cnpj.slice(0, 12));
  if (cnpj.slice(-2) !== first + digit(cnpj.slice(0, 12) + first)) invalid('CNPJ', 'Os dígitos verificadores do CNPJ são inválidos.');
  return cnpj;
}

export function normalizeCompanyLogin(value, fallback = '') {
  const login = textField(value || fallback, { required: true, field: 'Login da empresa', max: 80 }).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._@-]{2,79}$/.test(login)) invalid('Login', 'Use de 3 a 80 caracteres no login: letras sem acentos, números, ponto, hífen, sublinhado ou @.');
  return login;
}

function dimensions(buffer, mime) {
  if (mime === 'png') {
    if (buffer.length < 45 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
    if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
    let offset = 8, hasImage = false, ended = false;
    while (offset + 12 <= buffer.length) {
      const size = buffer.readUInt32BE(offset);
      if (size > buffer.length - offset - 12) return null;
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (type === 'acTL') return null;
      if (type === 'IDAT' && size > 0) hasImage = true;
      offset += size + 12;
      if (type === 'IEND') { ended = size === 0 && offset === buffer.length; break; }
    }
    if (!hasImage || !ended) return null;
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  }
  if (mime === 'jpeg') {
    if (buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) return null;
    let offset = 2;
    while (offset < buffer.length - 2) {
      if (buffer[offset++] !== 0xff) return null;
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > buffer.length) return null;
      const size = buffer.readUInt16BE(offset);
      if (size < 2 || offset + size > buffer.length) return null;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) return null;
        return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
      }
      offset += size;
    }
    return null;
  }
  if (mime === 'webp') {
    if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) return null;
    let offset = 12, sizeInfo = null, hasImage = false;
    while (offset + 8 <= buffer.length) {
      const type = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), start = offset + 8;
      if (size > buffer.length - start) return null;
      if (type === 'ANIM' || type === 'ANMF') return null;
      if (type === 'VP8X') {
        if (size !== 10 || buffer[start] & 0x02) return null;
        sizeInfo = [buffer.readUIntLE(start + 4, 3) + 1, buffer.readUIntLE(start + 7, 3) + 1];
      } else if (type === 'VP8L') {
        if (size < 5 || buffer[start] !== 0x2f) return null;
        const bits = buffer.readUInt32LE(start + 1);
        const frameSize = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
        if (sizeInfo && (frameSize[0] !== sizeInfo[0] || frameSize[1] !== sizeInfo[1])) return null;
        sizeInfo = frameSize; hasImage = true;
      } else if (type === 'VP8 ') {
        if (size < 10 || buffer[start] & 1 || !buffer.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return null;
        const frameSize = [buffer.readUInt16LE(start + 6) & 0x3fff, buffer.readUInt16LE(start + 8) & 0x3fff];
        if (sizeInfo && (frameSize[0] !== sizeInfo[0] || frameSize[1] !== sizeInfo[1])) return null;
        sizeInfo = frameSize; hasImage = true;
      }
      offset = start + size + (size & 1);
    }
    return offset === buffer.length && hasImage ? sizeInfo : null;
  }
  return null;
}

export function validateCompanyLogo(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 30) {
    throw httpError(413, 'A logo deve ter até 48 KB. Reduza a imagem antes de enviar.', 'LOGO_MUITO_GRANDE');
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) invalid('Logo', 'Envie uma imagem PNG, JPEG ou WebP válida.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_LOGO_BYTES) throw httpError(413, 'A logo deve ter até 48 KB.', 'LOGO_MUITO_GRANDE');
  if (bytes.toString('base64') !== match[2]) invalid('Logo', 'A imagem enviada está incompleta ou inválida.');
  const size = dimensions(bytes, match[1]);
  if (!size || size.some(value => value < 1 || value > MAX_LOGO_DIMENSION)) invalid('Logo', 'Envie uma imagem estática válida com até 2048 × 2048 pixels.');
  return value;
}

export function companyEditableFields(body, { requireName = false } = {}) {
  const fields = {};
  for (const [key, label, max] of [
    ['nome', 'Nome da empresa', 300], ['localidade', 'Localidade', 300],
    ['responsavel', 'Responsável', 200], ['email', 'E-mail', 254], ['telefone', 'Telefone', 50]
  ]) {
    if (key in body || key === 'nome' && requireName) fields[key] = textField(body[key], { field: label, max, required: key === 'nome' });
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) invalid('E-mail');
  if ('uf' in body) {
    fields.uf = textField(body.uf, { field: 'UF', max: 2 }).toUpperCase();
    if (fields.uf && !'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(fields.uf)) invalid('UF', 'Selecione uma UF válida.');
  }
  if ('logoDataUrl' in body) {
    fields.logoDataUrl = validateCompanyLogo(body.logoDataUrl);
    // An explicit replacement or removal also clears the older URL aliases.
    fields.logoUrl = '';
    fields.logo = '';
  }
  if (body.logoUrl) invalid('Logo', 'Use o envio da imagem para cadastrar a logo da empresa.');
  return fields;
}
