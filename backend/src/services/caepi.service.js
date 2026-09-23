import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src', 'data', 'caepi-db.json');
let db = null;
function load() {
  if (!db) db = JSON.parse(fs.readFileSync(file, 'utf8'));
  return db;
}

export async function consultarCA(ca) {
  const key = String(ca || '').replace(/\D/g, '');
  const data = load();
  const item = data.items?.[key] || null;
  if (!item) return { ca: key, found: false, status: 'Consultar MTE' };
  return { found: true, ...item };
}

export async function buscarPorNome(q) {
  const termo = String(q || '').toLowerCase();
  if (!termo) return [];
  const data = load();
  return Object.values(data.items || {}).filter(x => String(x.name || x.description || '').toLowerCase().includes(termo)).slice(0, 20);
}
