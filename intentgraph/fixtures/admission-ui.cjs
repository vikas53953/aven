'use strict';
// Explicit loopback-only browser fixture. No provider, vault or device calls.
// Usage: node intentgraph/fixtures/admission-ui.cjs <disposable-directory>
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { start } = require('../server.cjs');
const root = path.resolve(process.argv[2] || '.audit/admission-ui');
const project = path.resolve(__dirname, '../..');
fs.mkdirSync(root, { recursive: true });
let calls = 0;
function settings() { try { return JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'))); } catch { return {}; } }
function stats() { fs.writeFileSync(path.join(root, 'stats.json'), JSON.stringify({ calls, providerCalls: 0, deviceCalls: 0 })); }
const vault = require('../vault.cjs');
vault.hasSecret = () => false;
vault.getSecret = () => { throw Error('Fixture prohibits credential access'); };
const blocked = () => { throw Error('Fixture prohibits device access'); };
const executionOptions = { provider: { status: () => ({ configured: false }) }, coordinator: { close() {}, status: () => ({}) }, adapters: { close() {}, status: () => ({}) }, delivery: { status: () => ({}) } };
const raw = Array.from({ length: 15 }, (_, i) => 'fixture line ' + (i + 1)).join('\n');
const staticServer = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1:8767').pathname;
  if (pathname === '/fixture-stats') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ calls, providerCalls: 0, deviceCalls: 0 })); return; }
  const relative = pathname === '/' ? 'polished.html' : pathname === '/docs/architecture/' ? 'docs/architecture/index.html' : pathname.slice(1);
  const file = path.resolve(project, relative);
  if (relative.split('/').includes('..') || !file.startsWith(project + path.sep) || !/^(?:polished[^/]*\.(?:js|css|html)|avatar-system\/[^.][^]*|docs\/architecture\/[^.][^]*)$/.test(relative) || !/\.(?:js|css|html|json|svg|png)$/.test(file)) { res.writeHead(404); res.end(); return; }
  try { const data = fs.readFileSync(file); res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' })[path.extname(file)] || 'image/png'); res.setHeader('Cache-Control', 'no-store'); res.end(data); } catch { res.writeHead(404); res.end(); }
});
const receiptStore = new (require('../reliability-storage.cjs').ReceiptStore)(path.join(root,'.intentgraph/runtime'));
const transact = receiptStore.transaction.bind(receiptStore);
receiptStore.transaction = work => { if(settings().failDatabase)throw Error('Injected database failure');return transact(work); };
const admission = require('../reliability.cjs').createAdmission({store:receiptStore});
start({ root, admission, port: 8768, sandbox: { close() {}, status: () => ({}), inventory: blocked, runCommand: blocked }, executionOptions,
  providerCapabilities: { providers: [{ id: 'opencode', status: 'configured', configured: true, reason: 'Offline test fixture only; no provider connection.', models: [
    { id: 'mimo-v2.5', label: 'Default fixture', status: 'configured', efforts: ['none'] },
    { id: 'fixture-alternate', label: 'Alternate fixture', status: 'configured', efforts: ['none', 'low'] }
  ] }] },
  providerModelFactory: () => { throw Error('Fixture prohibits model transport'); },
  persistChatEvidence: record => {
    if (settings().failPersistence) throw Error('Injected disk failure');
    const dir = path.join(root, '.intentgraph/evidence/runs'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, record.runId + '.json'), JSON.stringify(record));
  },
  chatResponder: async ({ mode, signal, clarificationAnswered, messages, onEvent, selection }) => {
    calls++; stats();
    await new Promise(resolve => {
      const deadline = Date.now() + (settings().delayMs ?? 500);
      let timer;
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const check = () => { if (signal.aborted || Date.now() >= deadline && !settings().hold) finish(); else timer = setTimeout(check, 25); };
      signal.addEventListener('abort', finish, { once: true }); check();
    });
    if (signal.aborted) throw Error('fixture cancelled');
    if (settings().questionEvidence && !clarificationAnswered) onEvent({type:'tool_result',name:'inventory',status:'SUCCESS',evidence:{command:'inventory',target:'fixture',status:'SUCCESS',output:'retained before question\r\n'}});
    if (settings().question && !clarificationAnswered && messages.at(-1).content.includes('clarification')) return { question: settings().question, mode, model: 'fixture' };
    return { text: 'Local admission fixture response.\n\n```text\n' + raw + '\n```', mode, providerId: selection?.providerId, model: selection?.modelId || 'fixture', effort: selection?.effort, evidence: [] };
  }
}).then(server => {
  staticServer.listen(8767, '127.0.0.1', () => console.log('Admission fixture: http://127.0.0.1:8767/polished.html'));
  const stop = () => staticServer.close(() => server.close(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}).catch(error => { console.error(error); process.exitCode = 1; });
