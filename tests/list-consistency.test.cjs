const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/EntregaEPI/assets/app.js', 'utf8');

test('novos cadastros continuam visíveis, isolados por sessão/empresa; biometria e cofre não recebem parâmetros novos', async () => {
  const requests = [];
  const context = vm.createContext({ window: { JP_CONFIG: { apiBaseUrl: 'https://synthetic.invalid' } }, Date, Map,
    sessionGeneration: 1, companyGeneration: 1, activeEmpresaId: 'A', getAuth: () => ({ idToken: 'synthetic' }),
    fetch: async (url, opts) => { requests.push({ url, opts }); return { status: 200, text: async () => JSON.stringify({ ok: true, item: { id: 'new-record' } }) }; }
  });
  vm.runInContext(source.slice(source.indexOf('const recentListWrites='), source.indexOf('function write(data)')), context);
  await vm.runInContext("api('/api/fichas',{method:'POST',body:'{}'})", context);
  await vm.runInContext("api('/api/fichas')", context);
  assert.match(requests[1].url, /recentIds=new-record$/);
  context.activeEmpresaId = 'B'; context.companyGeneration++;
  await vm.runInContext("api('/api/fichas')", context);
  assert.doesNotMatch(requests[2].url, /recentIds/);
  context.activeEmpresaId = 'A'; context.sessionGeneration++;
  await vm.runInContext("api('/api/fichas')", context);
  assert.doesNotMatch(requests[3].url, /recentIds/);
  for (const path of ['/api/biometria', '/api/jpged/documentos', '/api/fichas/new-record/biometria/desafio', '/api/fichas/new-record/assinar']) {
    await vm.runInContext(`api(${JSON.stringify(path)},{method:'POST',body:'{}'})`, context);
    assert.equal(requests.at(-1).url, 'https://synthetic.invalid' + path);
    assert.equal(requests.at(-1).opts.headers.Authorization, 'Bearer synthetic');
  }
});
