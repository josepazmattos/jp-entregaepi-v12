import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { MAX_CAPTURE_BYTES, validateCaptureImage } from '../src/services/capture-image.js';
import { normalizeImageCapture } from '../src/services/ficha.service.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
// Static RGB JPEG generated from a synthetic 32 x 18 solid-color image.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAASACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDz+iiiszxAooooAKKKKACiiigD/9k=';
const toUrl = (bytes, mime = 'png') => `data:image/${mime};base64,${bytes.toString('base64')}`;
const fromUrl = value => Buffer.from(value.split(',')[1], 'base64');
const rejectsImage = value => assert.throws(() => validateCaptureImage(value), error => error.status === 400 && error.code === 'CAPTURA_INVALIDA');

// Fixture construction is independent of the production CRC implementation.
function chunk(type, data = Buffer.alloc(0)) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
  prefix.writeUInt32BE(data.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([prefix, payload, suffix]);
}

function png({ width = 1, height = 1, pixels = Buffer.from([0, 128]), extra = [], interlace = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[12] = interlace;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...extra, chunk('IDAT', deflateSync(pixels)), chunk('IEND')]);
}

test('captura aceita PNG completo e JPEG com quadro, tabelas e scan', () => {
  const pngImage = validateCaptureImage(PNG), jpegImage = validateCaptureImage(JPEG);
  assert.equal(pngImage.dataUrl, PNG);
  assert.equal(pngImage.width, 1); assert.equal(pngImage.height, 1);
  assert.equal(jpegImage.dataUrl, JPEG);
  assert.equal(jpegImage.width, 32); assert.equal(jpegImage.height, 18);
  assert.equal(validateCaptureImage(toUrl(png({ interlace: 1 }))).width, 1, 'PNG Adam7 de um pixel é válido');
});

test('captura mantém aliases legados e ignora alegações de identidade e data', () => {
  const capture = normalizeImageCapture({ realFingerImage: true, fingerImageDataUrl: PNG, fingerCode: 'R_INDEX', verificada: true, matchScore: 100, capturadoPor: 'outro', signedAt: 'falso', id: 'falso' }, 'ator-autenticado');
  assert.equal(capture.realFingerImage, PNG);
  assert.equal(capture.dedo, 'R_INDEX');
  assert.equal(capture.capturadoPor, 'ator-autenticado');
  assert.equal(capture.verificada, false);
  assert.equal(capture.metodo, 'captura_de_imagem');
  assert.equal(capture.matchScore, undefined);
  assert.equal(capture.captureRequestId, undefined);
  assert.notEqual(capture.id, 'falso');
  assert.notEqual(capture.signedAt, 'falso');
});

test('PNG rejeita apenas cabeçalho, truncamento, CRC incorreto e dados após IEND', () => {
  const incomplete = Buffer.alloc(33); fromUrl(PNG).subarray(0, 8).copy(incomplete);
  const crc = fromUrl(PNG); crc[crc.length - 5] ^= 1;
  for (const bytes of [incomplete, fromUrl(PNG).subarray(0, -5), crc, Buffer.concat([fromUrl(PNG), Buffer.from([0])])]) rejectsImage(toUrl(bytes));
  rejectsImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBxkAAAAASUVORK5CYII=');
});

test('PNG rejeita scanlines incompatíveis, filtros inválidos, animação e bomba de descompressão', () => {
  for (const bytes of [
    png({ pixels: Buffer.from([5, 128]) }),
    png({ pixels: Buffer.from([0]) }),
    png({ pixels: Buffer.from([0, 128, 0]) }),
    png({ pixels: Buffer.alloc(1024 * 1024) }),
    png({ extra: [chunk('acTL', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]))] })
  ]) rejectsImage(toUrl(bytes));
});

test('captura aplica dimensões antes de descompactar e permite o limite documentado', () => {
  for (const dimensions of [{ width: 0 }, { height: 0 }, { width: 2049 }, { height: 2049 }, { width: 0xffffffff, height: 0xffffffff }]) rejectsImage(toUrl(png(dimensions)));
  const boundary = validateCaptureImage(toUrl(png({ width: 2048, height: 2048, pixels: Buffer.alloc(2049 * 2048) })));
  assert.equal(boundary.width * boundary.height, 4194304);
  const jpeg = fromUrl(JPEG), sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  jpeg.writeUInt16BE(2049, sof + 7);
  rejectsImage(toUrl(jpeg, 'jpeg'));
});

test('captura exige base64 canônico e MIME compatível; não aceita URL externa, SVG ou BMP', () => {
  const noncanonical = PNG.slice(0, -2) + 'J='; // Same decoded bytes, nonzero padding bits.
  assert.deepEqual(fromUrl(noncanonical), fromUrl(PNG));
  for (const value of [
    PNG + '\n', PNG.slice(0, -1), noncanonical, PNG.replace(';base64,', ';base64, '),
    PNG.replace('image/png', 'image/jpeg'), PNG.replace('image/png', 'image/bmp'),
    'https://example.invalid/fingerprint.png', 'data:image/svg+xml;base64,PHN2Zy8+', fromUrl(PNG).toString('base64')
  ]) rejectsImage(value);
});

test('captura permite exatamente 150 KB e recusa um byte a mais', () => {
  const base = png(), paddingLength = MAX_CAPTURE_BYTES - base.length - 12;
  const boundary = png({ extra: [chunk('tEXt', Buffer.concat([Buffer.from('Note\0'), Buffer.alloc(paddingLength - 5, 65)]))] });
  assert.equal(boundary.length, MAX_CAPTURE_BYTES);
  assert.equal(validateCaptureImage(toUrl(boundary)).bytes.length, MAX_CAPTURE_BYTES);
  const tooBig = png({ extra: [chunk('tEXt', Buffer.concat([Buffer.from('Note\0'), Buffer.alloc(paddingLength - 4, 65)]))] });
  rejectsImage(toUrl(tooBig));
});

test('JPEG aceita tons de cinza e progressivo completos sem confundi-los com animação', () => {
  const images = [
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAQABABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACiiiv/Z',
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAADBP/aAAwDAQACEAMQAAABgBo//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABBQIf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQAGPwIf/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPyEf/9oADAMBAAIAAwAAABAH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPxAf/9k='
  ];
  for (const base64 of images) {
    const result = validateCaptureImage(`data:image/jpeg;base64,${base64}`);
    assert.equal(result.width, 16); assert.equal(result.height, 16);
  }
});

test('JPEG rejeita cabeçalho sem imagem, quadro sem scan, scan vazio, truncamento e tabelas inválidas', () => {
  const bytes = fromUrl(JPEG), sos = bytes.indexOf(Buffer.from([0xff, 0xda]));
  const headerEnd = sos + 2 + bytes.readUInt16BE(sos + 2);
  const emptyScan = Buffer.concat([bytes.subarray(0, headerEnd), Buffer.from([0xff, 0xd9])]);
  const noScan = Buffer.concat([bytes.subarray(0, sos), Buffer.from([0xff, 0xd9])]);
  const badTable = Buffer.from(bytes), dqt = badTable.indexOf(Buffer.from([0xff, 0xdb]));
  badTable[dqt + 5] = 0;
  for (const malformed of [Buffer.from([255, 216, 0, 0, 255, 217]), noScan, emptyScan, bytes.subarray(0, -1), badTable, Buffer.concat([bytes, Buffer.from([0])])]) rejectsImage(toUrl(malformed, 'jpeg'));
});

test('captureRequestId precisa ser UUID; hash é calculado da imagem e dedo, não do valor alegado', () => {
  const captureRequestId = randomUUID(), payload = { image: PNG, dedo: 'R_INDEX', captureRequestId };
  const first = normalizeImageCapture(payload, 'ator'), repeat = normalizeImageCapture({ ...payload, captureRequestId: captureRequestId.toUpperCase(), captureRequestHash: 'forjado' }, 'ator');
  assert.equal(first.captureRequestId, captureRequestId);
  assert.equal(first.captureRequestHash, repeat.captureRequestHash);
  assert.match(first.captureRequestHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.id, repeat.id, 'Somente a rota decide replay, sem fabricar a identidade da assinatura.');
  assert.notEqual(first.captureRequestHash, normalizeImageCapture({ ...payload, dedo: 'L_INDEX' }, 'ator').captureRequestHash);
  for (const invalidId of ['', 'teste', 123, {}, '00000000-0000-0000-0000-000000000000']) {
    assert.throws(() => normalizeImageCapture({ ...payload, captureRequestId: invalidId }, 'ator'), error => error.code === 'CAPTURA_SOLICITACAO_INVALIDA');
  }
});
