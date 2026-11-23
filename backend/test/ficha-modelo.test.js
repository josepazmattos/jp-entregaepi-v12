import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TERMO_APROVADO, MODELO_FICHA_APROVADO } from '../src/services/ficha-modelo.js';

test('texto integral preserva o SHA256 do modelo aprovado JP-DOCX-11.10.6', () => {
  assert.equal(MODELO_FICHA_APROVADO.id, 'JP-DOCX-11.10.6');
  assert.equal(createHash('sha256').update(TERMO_APROVADO, 'utf8').digest('hex'), '5ed3e0fbbcaf48a587166d9cb103fcc82c115222628ae8a87ab2d550960ccb4f');
});
