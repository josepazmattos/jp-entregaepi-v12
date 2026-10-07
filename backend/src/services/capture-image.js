import { inflateSync } from 'node:zlib';
import { httpError } from '../middleware/auth.js';

export const MAX_CAPTURE_BYTES = 150 * 1024;
export const MAX_CAPTURE_DIMENSION = 2048;
export const MAX_CAPTURE_PIXELS = 2048 * 2048;

function invalid(message = 'Envie uma imagem PNG ou JPEG estática, completa e válida.') {
  throw httpError(400, message, 'CAPTURA_INVALIDA');
}

function checkSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_CAPTURE_DIMENSION || height > MAX_CAPTURE_DIMENSION
    || width * height > MAX_CAPTURE_PIXELS) {
    invalid('A captura deve ter dimensões entre 1 e 2048 pixels e até 4.194.304 pixels no total.');
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// PNG critical chunks, CRC, compression and Adam7 scanline layout follow:
// https://www.w3.org/TR/png-3/
function validatePng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid();
  let offset = 8, header = null, palette = null, imageStarted = false, imageEnded = false, ended = false;
  const data = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalid();
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) invalid();
    const start = offset + 8, end = start + length;
    if (crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) invalid();
    if (!header && type !== 'IHDR') invalid();
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) invalid('Envie uma captura estática; imagens animadas não são aceitas.');
    if (type === 'IHDR') {
      if (header || offset !== 8 || length !== 13) invalid();
      const width = bytes.readUInt32BE(start), height = bytes.readUInt32BE(start + 4);
      checkSize(width, height);
      const depth = bytes[start + 8], color = bytes[start + 9], interlace = bytes[start + 12];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || interlace > 1) invalid();
      header = { width, height, depth, color, interlace, channels: { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color] };
    } else if (type === 'PLTE') {
      if (palette || imageStarted || !length || length % 3 !== 0 || length > 768 || [0, 4].includes(header.color)) invalid();
      palette = length / 3;
      if (header.color === 3 && palette > 2 ** header.depth) invalid();
    } else if (type === 'IDAT') {
      if (imageEnded || header.color === 3 && !palette) invalid();
      imageStarted = true;
      data.push(bytes.subarray(start, end));
    } else if (type === 'IEND') {
      if (length || !imageStarted || end + 4 !== bytes.length) invalid();
      ended = true;
    } else {
      if (/^[A-Z]/.test(type)) invalid(); // Unknown critical chunks cannot be ignored.
      if (type === 'tRNS' && (imageStarted || header.color === 0 && length !== 2
        || header.color === 2 && length !== 6 || header.color === 3 && (!palette || !length || length > palette)
        || [4, 6].includes(header.color))) invalid();
    }
    if (imageStarted && type !== 'IDAT') imageEnded = true;
    offset = end + 4;
    if (ended) break;
  }
  if (!ended || offset !== bytes.length) invalid();
  const { width, height, depth, channels, interlace } = header;
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows = passes.map(([x, y, dx, dy]) => ({
    width: Math.max(0, Math.ceil((width - x) / dx)),
    height: Math.max(0, Math.ceil((height - y) / dy))
  })).filter(pass => pass.width && pass.height).map(pass => ({ ...pass, rowBytes: Math.ceil(pass.width * channels * depth / 8) }));
  const expectedLength = rows.reduce((sum, pass) => sum + pass.height * (pass.rowBytes + 1), 0);
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(data), { maxOutputLength: expectedLength });
  } catch { invalid(); }
  if (inflated.length !== expectedLength) invalid();
  offset = 0;
  for (const pass of rows) {
    for (let row = 0; row < pass.height; row += 1) {
      if (inflated[offset] > 4) invalid();
      offset += pass.rowBytes + 1;
    }
  }
  return { width, height };
}

// Validate the complete marker/segment/scan structure, not just SOI/EOI bytes.
// Supports the static 8-bit Huffman JPEG formats browsers normally produce.
// JPEG marker definitions: https://www.w3.org/Graphics/JPEG/itu-t81.pdf (Annex B).
function validateJpeg(bytes) {
  if (bytes.length < 20 || bytes.readUInt16BE(0) !== 0xffd8) invalid();
  let offset = 2, frame = null, scans = 0, restartInterval = 0;
  const quantization = new Set(), huffman = new Set(), scannedComponents = new Set();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!frame || !scans || offset !== bytes.length || frame.components.size !== scannedComponents.size) invalid();
      return { width: frame.width, height: frame.height };
    }
    if (marker === 0 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) invalid();
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset), start = offset + 2, end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || length < 11 || bytes[start] !== 8) invalid();
      const height = bytes.readUInt16BE(start + 1), width = bytes.readUInt16BE(start + 3), count = bytes[start + 5];
      checkSize(width, height);
      if (count < 1 || count > 4 || length !== 8 + 3 * count) invalid();
      const components = new Map();
      let blocks = 0;
      for (let position = start + 6; position < end; position += 3) {
        const id = bytes[position], sampling = bytes[position + 1], table = bytes[position + 2];
        const horizontal = sampling >>> 4, vertical = sampling & 15;
        if (components.has(id) || horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4 || table > 3) invalid();
        components.set(id, { table, coefficients: new Int8Array(64).fill(-1) });
        blocks += horizontal * vertical;
      }
      if (blocks > 10) invalid();
      frame = { width, height, components, progressive: marker === 0xc2 };
    } else if (marker === 0xdb) {
      let position = start;
      while (position < end) {
        const info = bytes[position++], precision = info >>> 4, id = info & 15;
        if (precision > 1 || id > 3 || position + 64 * (precision + 1) > end) invalid();
        for (let item = 0; item < 64; item += 1) {
          const value = precision ? bytes.readUInt16BE(position) : bytes[position];
          if (!value) invalid();
          position += precision + 1;
        }
        quantization.add(id);
      }
      if (position === start) invalid();
    } else if (marker === 0xc4) {
      let position = start;
      while (position < end) {
        if (position + 17 > end) invalid();
        const info = bytes[position++], type = info >>> 4, id = info & 15;
        if (type > 1 || id > 3) invalid();
        let symbols = 0, available = 1;
        for (let bits = 0; bits < 16; bits += 1) {
          const count = bytes[position++];
          symbols += count;
          available = available * 2 - count;
          if (available < 0) invalid();
        }
        if (!symbols || symbols > 256 || position + symbols > end || available === 0) invalid();
        for (const symbol of bytes.subarray(position, position + symbols)) {
          if (type === 0 ? symbol > 11 : (symbol & 15) > 10) invalid();
        }
        position += symbols;
        huffman.add(`${type}:${id}`);
      }
      if (position === start) invalid();
    } else if (marker === 0xda) {
      if (!frame || length < 8) invalid();
      const count = bytes[start], selected = new Set();
      if (count < 1 || count > frame.components.size || length !== 6 + 2 * count) invalid();
      const spectralStart = bytes[end - 3], spectralEnd = bytes[end - 2], approximation = bytes[end - 1];
      if (frame.progressive) {
        if (spectralStart > spectralEnd || spectralEnd > 63 || spectralStart === 0 && spectralEnd !== 0
          || spectralStart > 0 && count !== 1 || (approximation >>> 4) > 13 || (approximation & 15) > 13
          || approximation >>> 4 && (approximation >>> 4) !== (approximation & 15) + 1) invalid();
      } else if (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0) invalid();
      for (let position = start + 1; position < end - 3; position += 2) {
        const id = bytes[position], tables = bytes[position + 1], component = frame.components.get(id);
        if (!component || selected.has(id) || !quantization.has(component.table) || (tables >>> 4) > 3 || (tables & 15) > 3) invalid();
        if ((!frame.progressive || spectralStart === 0 && (approximation >>> 4) === 0) && !huffman.has(`0:${tables >>> 4}`)) invalid();
        if ((!frame.progressive || spectralStart > 0) && !huffman.has(`1:${tables & 15}`)) invalid();
        if (spectralStart > 0 && component.coefficients[0] < 0) invalid();
        for (let coefficient = spectralStart; coefficient <= spectralEnd; coefficient += 1) {
          const prior = component.coefficients[coefficient], high = approximation >>> 4;
          if (high === 0 ? prior !== -1 : prior !== high) invalid();
          component.coefficients[coefficient] = approximation & 15;
        }
        selected.add(id);
        if (spectralStart === 0) scannedComponents.add(id);
      }
      offset = end;
      let entropy = 0, restart = 0;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; entropy += 1; continue; }
        const markerStart = offset;
        offset += 1;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) invalid();
        const next = bytes[offset];
        if (next === 0) { offset += 1; entropy += 1; continue; }
        if (next >= 0xd0 && next <= 0xd7) {
          if (!restartInterval || next !== 0xd0 + restart) invalid();
          restart = (restart + 1) & 7;
          offset += 1;
          continue;
        }
        offset = markerStart;
        break;
      }
      if (!entropy) invalid();
      scans += 1;
      continue;
    } else if (marker === 0xdd) {
      if (length !== 4) invalid();
      restartInterval = bytes.readUInt16BE(start);
    } else if (!(marker >= 0xe0 && marker <= 0xef || marker === 0xfe)) {
      invalid(); // Arithmetic, hierarchical, lossless and unknown modes are not accepted.
    }
    offset = end;
  }
  invalid();
}

export function validateCaptureImage(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4 + 30) {
    invalid('Imagem de captura inválida ou acima de 150 KB.');
  }
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) invalid();
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_CAPTURE_BYTES) invalid('Imagem de captura inválida ou acima de 150 KB.');
  if (bytes.toString('base64') !== match[2]) invalid();
  const dimensions = match[1] === 'png' ? validatePng(bytes) : validateJpeg(bytes);
  return { dataUrl: value, bytes, mime: `image/${match[1]}`, ...dimensions };
}
