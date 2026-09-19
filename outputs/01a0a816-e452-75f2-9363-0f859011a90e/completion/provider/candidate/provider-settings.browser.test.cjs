'use strict';

// Isolated first-run Settings flow. The shell is assembled from frozen v8
// sources plus this slice's exact replacements. Only local static files and
// mocked localhost capability/config responses are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '../../../../../intentgraph/node_modules/playwright'));

const root = path.resolve(__dirname, '../../../../../');
const completion = path.resolve(__dirname, '..', '..');
const baseline = path.join(completion, 'baseline');
const manifest = JSON.parse(fs.readFileSync(path.join(completion, 'provider', 'replacements.json'), 'utf8'));
let APP_ORIGIN = '';
const API_ORIGIN = 'http://127.0.0.1:8768';
const executablePath = process.env.AVEN_PLAYWRIGHT_CHROMIUM || 'C:\\Users\\vikasmit\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1181\\chrome-win\\headless_shell.exe';

function transform(name) {
  let source = fs.readFileSync(path.join(baseline, name), 'utf8');
  manifest.filter((item) => item.file === name).forEach((item) => {
    assert.equal(source.split(item.old).length, 2, `missing ${name} replacement anchor`);
    source = source.replace(item.old, item.new);
  });
  return source;
}

function readShellAsset(name) {
  const relative = name.replace(/^[/\\]+/u, '');
  const baselineAsset = path.resolve(baseline, relative);
  const productAsset = path.resolve(root, relative);
  const baselineRoot = path.resolve(baseline);
  const productRoot = path.resolve(root);
  if (baselineAsset.startsWith(`${baselineRoot}${path.sep}`) && fs.existsSync(baselineAsset) && fs.statSync(baselineAsset).isFile()) return fs.readFileSync(baselineAsset, 'utf8');
  if (productAsset.startsWith(`${productRoot}${path.sep}`) && fs.existsSync(productAsset) && fs.statSync(productAsset).isFile()) return fs.readFileSync(productAsset, 'utf8');
  throw new Error(`missing shell asset ${name}`);
}

function shellHtml() {
  let source = transform('polished.html');
  source = source.replace(/<link rel="stylesheet" href="([^"]+)">/gu, (_tag, href) => `<style>${readShellAsset(href.split('?')[0])}</style>`);
  source = source.replace(/<script src="([^"]+)"><\/script>/gu, (_tag, src) => {
    const name = src.split('?')[0];
    const script = name === 'provider-picker.js'
      ? fs.readFileSync(path.join(completion, 'provider', 'candidate', name), 'utf8')
      : fs.existsSync(path.join(baseline, name)) ? transform(name) : readShellAsset(name);
    return `<script>${script}</script>`;
  });
  return source;
}

function serveShell() {
  const html = shellHtml();
  const server = http.createServer((request, response) => {
    if (request.url?.split('?')[0] === '/polished.html' || request.url?.split('?')[0] === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html);
      return;
    }
    const pathname = decodeURIComponent(request.url?.split('?')[0] || '/');
    const relative = pathname.replace(/^\/+/, '');
    const baselineCandidate = path.resolve(baseline, relative);
    const productCandidate = path.resolve(root, relative);
    const candidate = baselineCandidate.startsWith(`${path.resolve(baseline)}${path.sep}`) && fs.existsSync(baselineCandidate) ? baselineCandidate : productCandidate;
    if (!candidate.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'cache-control': 'no-store' });
    fs.createReadStream(candidate).pipe(response);
  });
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('fixture server did not expose a TCP port'));
    APP_ORIGIN = `http://127.0.0.1:${address.port}`;
    resolve(server);
  }).once('error', reject));
}

const unknownSnapshot = {
  schemaVersion: 1,
  checkedAt: null,
  providers: ['opencode', 'openrouter', 'anthropic', 'openai'].map((id) => ({ id, label: id === 'openrouter' ? 'OpenRouter' : id[0].toUpperCase() + id.slice(1), status: 'unknown', configured: false, connected: false, models: [], reason: 'Availability has not been checked.' }))
};
const configuredSnapshot = {
  schemaVersion: 1,
  checkedAt: null,
  providers: [
    { id: 'opencode', label: 'OpenCode', status: 'unknown', configured: false, connected: false, models: [], reason: 'Availability has not been checked.' },
    { id: 'openrouter', label: 'OpenRouter', status: 'configured', configured: true, connected: false, reason: 'Configured locally; connection has not been verified.', models: [
      { id: 'fixture/router', label: 'Fixture Router', status: 'configured', efforts: ['none'] },
      { id: 'fixture/other', label: 'Fixture Other', status: 'configured', efforts: ['none'] }
    ] },
    { id: 'anthropic', label: 'Anthropic', status: 'unknown', configured: false, connected: false, models: [], reason: 'Availability has not been checked.' },
    { id: 'openai', label: 'OpenAI', status: 'unknown', configured: false, connected: false, models: [], reason: 'Availability has not been checked.' }
  ]
};

async function run() {
  const server = await serveShell();
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const state = { configRequests: [], blocked: [], pageErrors: [], savedKey: false };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) { state.blocked.push(request.url()); return route.abort(); }
    if (url.pathname === '/api/capabilities' && request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.configRequests.length ? configuredSnapshot : unknownSnapshot) });
    if (url.pathname === '/api/provider-config' && request.method() === 'POST') {
      const body = request.postDataJSON() || {};
      state.configRequests.push(body);
      if (!body.credential && !state.savedKey) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'provider_key_required', reasons: ['Enter the provider key to configure this provider.'] }) });
      if (body.credential) state.savedKey = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, selection: { providerId: body.providerId, modelId: body.modelId, effort: body.effort }, configured: true, connected: false, schemaVersion: configuredSnapshot.schemaVersion, checkedAt: null, providers: configuredSnapshot.providers }) });
    }
    state.blocked.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => state.pageErrors.push(error.message));
  try {
    const openModelsSettings = async () => {
      await page.locator('#account-button').click();
      await page.locator('#account-menu [data-account-action="settings"]').click();
      await page.locator('#settings-nav [data-category="models"]').click();
      await page.locator('#provider-config-save').waitFor();
    };
    await page.goto(`${APP_ORIGIN}/polished.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('aven-polished-preferences-v1', JSON.stringify({ theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Fixture', activeAgent: 'firewall', providerSelection: { providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none' }, providerSelectionExplicit: false, agents: [{ id: 'firewall', name: 'Firewall', role: 'Network', description: 'Network', notifications: true, timezone: 'Follow system', autoReview: false, unread: false, hidden: false, archived: false, pinned: false, sectionId: '' }], sections: [] }));
      localStorage.setItem('aven-polished-chats-v1', JSON.stringify({ activeChat: 'fixture-chat', projects: [], chats: [{ id: 'fixture-chat', title: 'Firewall', recipients: ['firewall'], draft: '', pendingAttachmentNames: [], messages: [], pendingQueue: [] }], activeChat: 'fixture-chat' }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openModelsSettings();
    assert.equal(await page.locator('#provider-config-key').getAttribute('type'), 'password');

    await page.locator('#provider-config-save').click();
    await page.locator('#provider-config-status').waitFor({ state: 'visible' });
    await page.waitForFunction(() => /Enter the provider key/.test(document.querySelector('#provider-config-status')?.textContent || ''));
    assert.equal(state.configRequests.length, 1);
    assert.equal(Object.hasOwn(state.configRequests[0], 'credential'), false);

    await page.locator('#provider-config-provider').selectOption('openrouter');
    await page.locator('#provider-config-model').fill('fixture/router');
    await page.locator('#provider-config-effort').selectOption('none');
    await page.locator('#provider-config-key').fill('fixture-secret');
    await page.locator('#provider-config-save').click();
    await page.waitForFunction(() => /Configured; connection not verified/.test(document.querySelector('#provider-config-status')?.textContent || ''));
    assert.equal(state.configRequests.length, 2);
    assert.equal(state.configRequests[1].credential, 'fixture-secret');
    assert.equal(Object.hasOwn(state.configRequests[1], 'credentialRef'), false);
    assert.equal(await page.locator('#provider-config-key').inputValue(), '');
    assert.equal(await page.locator('#provider-picker #provider-select').inputValue(), 'openrouter');
    assert.equal(await page.locator('#provider-picker #model-select').inputValue(), 'fixture/router');

    await page.locator('#save-settings').click();
    await page.waitForFunction(() => !document.querySelector('#settings-dialog')?.open);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-preferences-v1')));
    assert.deepEqual(saved.providerSelection, { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none' });
    assert.doesNotMatch(JSON.stringify(saved), /fixture-secret/);

    await openModelsSettings();
    await page.locator('#provider-config-provider').selectOption('openrouter');
    await page.locator('#provider-config-model').fill('fixture/router');
    await page.locator('#provider-config-effort').selectOption('none');
    await page.locator('#provider-config-save').click();
    await page.waitForFunction(() => /Configured; connection not verified/.test(document.querySelector('#provider-config-status')?.textContent || ''));
    assert.equal(state.configRequests.length, 3);
    assert.equal(Object.hasOwn(state.configRequests[2], 'credential'), false);

    await page.locator('#provider-picker #model-select').selectOption('fixture/other');
    await page.locator('#cancel-settings').click();
    await page.waitForFunction(() => !document.querySelector('#settings-dialog')?.open);
    await openModelsSettings();
    assert.equal(await page.locator('#provider-picker #model-select').inputValue(), 'fixture/router');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-preferences-v1')).providerSelection), { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none' });
    assert.deepEqual(state.blocked, []);
    assert.deepEqual(state.pageErrors, []);
    return { status: 'passed', configRequests: state.configRequests.map((body) => ({ providerId: body.providerId, modelId: body.modelId, effort: body.effort, hasCredential: Object.hasOwn(body, 'credential') })), blocked: state.blocked, pageErrors: state.pageErrors };
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) run().then((result) => { const out = path.resolve(__dirname, '..', 'settings-browser-result.json'); fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result)); }).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { run, transform, shellHtml };
