'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const root = process.cwd();
process.env.NODE_PATH = path.join(root, 'intentgraph', 'node_modules');
require('module').Module._initPaths();
const completion = path.join(root, 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion');
const baseIntentgraph = path.join(completion, 'baseline', 'intentgraph');
const baselineRoot = path.join(completion, 'baseline');
const replacements = JSON.parse(fs.readFileSync(path.join(completion, 'provider', 'replacements.json'), 'utf8'));

function applyFileOverlay(source, file) {
  let result = fs.readFileSync(path.join(baselineRoot, file), 'utf8');
  for (const item of replacements.filter((entry) => entry.file === file)) {
    if (result.split(item.old).length !== 2) throw new Error(`missing ${file} anchor: ${item.old.slice(0, 50)}`);
    result = result.replace(item.old, item.new);
  }
  fs.writeFileSync(path.join(source, file), result);
}

function request(port, body, pathname = '/api/chat') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'POST', headers: { Origin: 'http://127.0.0.1:8767', 'X-Aven-Chat': 'text-only', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('fresh server startup loads nonsecret provider config and dispatches selected provider via vault and default transport', async () => {
  const overlay = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-provider-server-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-provider-project-'));
  const moduleRoot = path.join(overlay, 'intentgraph');
  fs.cpSync(baseIntentgraph, moduleRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) });
  fs.copyFileSync(path.join(completion, 'provider/candidate/intentgraph/provider-selection.cjs'), path.join(moduleRoot, 'provider-selection.cjs'));
  fs.copyFileSync(path.join(completion, 'provider/candidate/intentgraph/provider-adapter.cjs'), path.join(moduleRoot, 'provider-adapter.cjs'));
  fs.copyFileSync(path.join(completion, 'provider/candidate/intentgraph/provider-runtime-config.cjs'), path.join(moduleRoot, 'provider-runtime-config.cjs'));
  applyFileOverlay(overlay, 'intentgraph/server.cjs');
  applyFileOverlay(overlay, 'intentgraph/agent-runtime.cjs');
  assert.match(fs.readFileSync(path.join(moduleRoot, 'server.cjs'), 'utf8'), /safe optional provider selection/);
  const vaultCalls = [];
  const vaultSetCalls = [];
  fs.writeFileSync(path.join(moduleRoot, 'vault.cjs'), `'use strict'; const calls = ${JSON.stringify(vaultCalls)}; const setCalls = ${JSON.stringify(vaultSetCalls)}; module.exports = { calls, setCalls, getSecret: async (reference) => { calls.push(reference); return 'fixture-vault-key'; }, setSecret: async (reference, value) => { setCalls.push([reference, value]); }, hasSecret: () => false };`);
  const runtimeDirectory = path.join(projectRoot, '.intentgraph', 'runtime');
  const originalFetch = globalThis.fetch;
  const transportCalls = [];
  globalThis.fetch = async (url, init) => {
    transportCalls.push({ url, init: { ...init, headers: { ...init.headers }, body: JSON.parse(init.body) } });
    return { ok: true, status: 200, json: async () => ({ model: 'fixture/router', choices: [{ message: { content: 'server fixture answer' } }] }) };
  };
  let server;
  try {
    const { start } = require(path.join(moduleRoot, 'server.cjs'));
    server = await start({ root: projectRoot, runtimeDirectory, port: 0, host: '127.0.0.1', rescanMs: 60000 });
    const setupWithoutKey = await request(server.address().port, { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none' }, '/api/provider-config');
    assert.equal(setupWithoutKey.status, 409);
    assert.match(setupWithoutKey.body.error, /provider_key_required/);
    assert.equal(transportCalls.length, 0);
    const setup = await request(server.address().port, { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none', credential: 'fixture-vault-key' }, '/api/provider-config');
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    assert.equal(setup.body.configured, true);
    assert.equal(setup.body.connected, false);
    assert.equal(setup.body.providers.find((provider) => provider.id === 'openrouter').models[0].id, 'fixture/router');
    const savedConfig = fs.readFileSync(path.join(runtimeDirectory, 'provider-config.json'), 'utf8');
    assert.doesNotMatch(savedConfig, /fixture-vault-key/);
    assert.match(savedConfig, /openrouter-api/);
    assert.deepEqual(require(path.join(moduleRoot, 'vault.cjs')).setCalls, [['openrouter-api', 'fixture-vault-key']]);
    assert.equal(transportCalls.length, 0);
    const result = await request(server.address().port, { chatId: 'server-provider-test', agentName: 'Provider fixture', mode: 'plan', selection: { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none' }, messages: [{ role: 'user', content: 'Answer with the server fixture phrase.' }] });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(result.body.text, /server fixture answer/);
    assert.deepEqual(result.body.requestedSelection, { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none' });
    assert.equal(transportCalls.length, 1);
    assert.equal(transportCalls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(transportCalls[0].init.body.model, 'fixture/router');
    assert.deepEqual(require(path.join(moduleRoot, 'vault.cjs')).calls, ['openrouter-api']);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(overlay, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
