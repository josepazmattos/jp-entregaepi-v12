import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

function unavailable() {
  return Object.assign(new Error('Base CAEPI indisponível. Consulte o portal do MTE ou tente novamente.'), { status: 503, code: 'CAEPI_BASE_INDISPONIVEL' });
}

export function createSnapshotReader({ filePath, normalize, cacheSize = 4 }) {
  const resolved = filePath instanceof URL ? fileURLToPath(filePath) : resolve(filePath);
  const folder = dirname(resolved);
  const cache = new Map();
  let metadata = {};
  let legacy = null;
  let shards = [];
  let byBucket;
  let failed = false;
  try {
    if (statSync(resolved).size > 16 * 1024 * 1024) throw unavailable();
    const payload = JSON.parse(readFileSync(resolved, 'utf8'));
    if (Array.isArray(payload?.shards)) {
      if (payload.schemaVersion !== 1 || payload.sourceKind !== 'official-snapshot' || !payload.shards.length) throw unavailable();
      metadata = payload;
      shards = payload.shards;
      byBucket = new Map();
      const files = new Set();
      for (const shard of shards) {
        if (!/^\d+$/.test(String(shard.bucket)) || !/^ca-\d+\.json\.gz$/.test(shard.file)
          || !/^[a-f0-9]{64}$/.test(shard.sha256) || !Number.isInteger(shard.count) || shard.count < 1 || shard.count > 1000
          || byBucket.has(String(shard.bucket)) || files.has(shard.file)) throw unavailable();
        byBucket.set(String(shard.bucket), shard);
        files.add(shard.file);
      }
      if (shards.reduce((total, shard) => total + shard.count, 0) !== metadata.total) throw unavailable();
      // Validate provenance using the same rules as individual records.
      const probe = normalize({ ...metadata, items: [{ ca: '1', name: 'provenance check' }] }).get('1');
      if (!probe?.officialSnapshot) throw unavailable();
      shards = [...shards].sort((a, b) => Number(a.bucket) - Number(b.bucket));
    } else {
      if (!Array.isArray(payload) && (!payload || typeof payload !== 'object' || !payload.items || typeof payload.items !== 'object')) throw unavailable();
      legacy = normalize(payload);
      metadata = Array.isArray(payload) ? {} : payload || {};
    }
  } catch {
    failed = true;
  }

  function load(shard) {
    if (failed) throw unavailable();
    if (cache.has(shard.file)) {
      const current = cache.get(shard.file);
      cache.delete(shard.file);
      cache.set(shard.file, current);
      return current;
    }
    try {
      const filename = join(folder, shard.file);
      if (statSync(filename).size > 8 * 1024 * 1024) throw unavailable();
      const bytes = readFileSync(filename);
      if (createHash('sha256').update(bytes).digest('hex') !== shard.sha256) throw unavailable();
      const payload = JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'));
      const raw = Array.isArray(payload) ? payload : payload.items;
      const items = normalize({ ...metadata, items: raw });
      if (items.size !== shard.count || [...items.keys()].some(ca => String(Math.floor(Number(ca) / 1000)) !== String(shard.bucket))) throw unavailable();
      cache.set(shard.file, items);
      while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      return items;
    } catch {
      failed = true;
      cache.clear();
      throw unavailable();
    }
  }

  function status() {
    const officialTotal = legacy ? [...legacy.values()].filter(item => item.officialSnapshot).length : Number(metadata.total) || 0;
    return {
      available: !failed,
      mode: byBucket ? 'official-shards' : 'local-snapshot',
      live: false,
      total: legacy ? legacy.size : Number(metadata.total) || 0,
      officialTotal,
      sourceKind: officialTotal > 0 ? 'official-snapshot' : 'local-complementar',
      downloadedAt: metadata.downloadedAt || null,
      sourceUpdatedAt: metadata.sourceUpdatedAt || null,
      ...(failed ? { code: 'CAEPI_BASE_INDISPONIVEL' } : {})
    };
  }

  function get(ca) {
    if (failed) throw unavailable();
    if (legacy) return legacy.get(ca) || null;
    const shard = byBucket.get(String(Math.floor(Number(ca) / 1000)));
    return shard ? load(shard).get(ca) || null : null;
  }

  function search(predicate, limit = 50) {
    if (failed) throw unavailable();
    const results = [];
    const batches = legacy ? [null] : shards;
    for (const shard of batches) {
      for (const item of (legacy || load(shard)).values()) {
        if (predicate(item)) results.push(item);
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  return { get, search, status };
}
