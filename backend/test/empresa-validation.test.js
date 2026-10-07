import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCnpj, normalizeCompanyLogin, validateCompanyLogo, companyEditableFields } from '../src/services/empresa-validation.js';

// Small raster fixtures generated locally, without business records or remote images.
const logos = {"png": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAAIUlEQVR4nGMUDTdnoCVgoqnpoxaMWjBqwagFoxaMWgAFANggAMdjh1zKAAAAAElFTkSuQmCC", "jpeg": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAASACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDz+iiiszxAooooAKKKKACiiigD/9k=", "webp": "data:image/webp;base64,UklGRj4AAABXRUJQVlA4IDIAAADwAgCdASogABIAPm0ylUekIyIhKAgAgA2JZQAAQnjkAAD+8ut9N6//i37R/e2FAAAAAA=="};

test('cadastro de empresa: CNPJ normaliza pontuação e preserva zeros, recusando número inválido', () => {
  assert.equal(normalizeCnpj('04.252.011/0001-10'), '04252011000110');
  assert.equal(normalizeCnpj('11222333000181'), '11222333000181');
  // Official Receita Federal / Serpro worked example: first DV=3, second DV=5.
  assert.equal(normalizeCnpj('12.ABC.345/01DE-35'), '12ABC34501DE35');
  assert.equal(normalizeCnpj('12.abc.345/01de-35'), '12ABC34501DE35');
  for (const invalid of ['04.252.011/0001-11', '11111111111111', '00000000000000', '04252011', '04252011000110<script>', '12ABC34501DE34', '12ABC34501DEAB', '12ÁBC34501DE35']) {
    assert.throws(() => normalizeCnpj(invalid), error => error.status === 400);
  }
});

test('login da empresa é canônico e não aceita espaços, controles ou caracteres de marcação', () => {
  assert.equal(normalizeCompanyLogin(' Empresa.Teste '), 'empresa.teste');
  assert.equal(normalizeCompanyLogin('', '04252011000110'), '04252011000110');
  assert.equal(normalizeCompanyLogin('EMPRESA@EXEMPLO.TEST'), 'empresa@exemplo.test');
  for (const invalid of ['a', 'Empresa Teste', '<empresa>', 'emp\nresa', 'çompanhia']) assert.throws(() => normalizeCompanyLogin(invalid), error => error.status === 400);
});

test('logo aceita raster PNG, JPEG e WebP e permite remoção explícita', () => {
  for (const logo of Object.values(logos)) assert.equal(validateCompanyLogo(logo), logo);
  assert.equal(validateCompanyLogo(''), '');
  assert.equal(validateCompanyLogo(null), '');
});

test('logo bloqueia SVG, URLs externas, MIME falso, imagem truncada e base64 não canônico', () => {
  const invalid = [
    'https://external.invalid/logo.png', 'javascript:alert(1)',
    'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>').toString('base64'),
    logos.png.replace('image/png', 'image/jpeg'), logos.png.slice(0, -16),
    'data:image/png;base64,aGVsbG8=', logos.png + '\n',
    'data:image/png;base64,____', 'data:image/png;base64,AB=='
  ];
  for (const value of invalid) assert.throws(() => validateCompanyLogo(value), error => error.status === 400);
});

test('logo recusa dimensões excessivas e carga acima do limite de armazenamento', () => {
  const bytes = Buffer.from(logos.png.split(',')[1], 'base64');
  bytes.writeUInt32BE(10000, 16);
  assert.throws(() => validateCompanyLogo('data:image/png;base64,' + bytes.toString('base64')), error => error.status === 400);
  const oversized = 'data:image/png;base64,' + Buffer.alloc(49 * 1024).toString('base64');
  assert.throws(() => validateCompanyLogo(oversized), error => error.status === 413 && error.code === 'LOGO_MUITO_GRANDE');
});

test('edição de empresa mantém lista explícita de campos, valida contatos e recusa URL de logo', () => {
  const result = companyEditableFields({ nome: 'EMPRESA SINTÉTICA', uf: 'ms', email: 'teste@exemplo.test', logoDataUrl: logos.png, status: 'Ativa', criadoPor: 'injetado', cognitoSub: 'injetado', masterUsuario: 'injetado', login: 'injetado' }, { requireName: true });
  assert.deepEqual(Object.keys(result).sort(), ['email', 'logo', 'logoDataUrl', 'logoUrl', 'nome', 'uf']);
  assert.equal(result.uf, 'MS');
  assert.equal(result.logoUrl, '');
  assert.equal(result.logo, '');
  assert.deepEqual(companyEditableFields({ logoDataUrl: '' }), { logoDataUrl: '', logoUrl: '', logo: '' });
  assert.throws(() => companyEditableFields({}, { requireName: true }), error => error.status === 400);
  assert.throws(() => companyEditableFields({ uf: 'ZZ' }), error => error.status === 400);
  assert.throws(() => companyEditableFields({ email: 'invalido' }), error => error.status === 400);
  assert.throws(() => companyEditableFields({ logoUrl: 'https://external.invalid/logo.png' }), error => error.status === 400);
});
