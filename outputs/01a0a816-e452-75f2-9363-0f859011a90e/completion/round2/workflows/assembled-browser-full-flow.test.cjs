'use strict';

// Full assembled-app browser acceptance. This serves the assembled polished
// page and proxies its fixed local API origin to an isolated assembled server;
// the responder and execution surface remain deterministic local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require(path.resolve(__dirname, '../../../../../intentgraph/node_modules/playwright'));

const assembledRoot = path.resolve(__dirname, '..', '..', 'assembled-candidate');
const { start } = require(path.join(assembledRoot, 'intentgraph', 'server.cjs'));
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const capabilities = {
  schemaVersion: 1,
  checkedAt: null,
  providers: [{
    id: 'opencode', label: 'OpenCode', status: 'configured', configured: true,
    connected: false, models: [{ id: 'mimo-v2.5', status: 'configured', efforts: ['none'] }]
  }]
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
  });
}

function staticFixtureServer() {
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://fixture').pathname);
      const relative = pathname === '/' ? 'polished.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(assembledRoot, relative);
      if (!file.startsWith(`${assembledRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const contentType = file.endsWith('.html') ? 'text/html; charset=utf-8'
        : file.endsWith('.css') ? 'text/css; charset=utf-8'
          : file.endsWith('.js') ? 'application/javascript; charset=utf-8'
            : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(400); res.end('Bad request');
    }
  });
  return server;
}

function browserStorage() {
  return {
    prefs: {
      activeAgent: 'fixture-agent',
      providerSelection: { providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none' },
      providerSelectionExplicit: true,
      browser: true,
      computer: false,
      agents: [{ id: 'fixture-agent', name: 'Fixture coworker', role: 'Answer deterministic acceptance requests.' }]
    },
    data: {
      activeChat: 'fixture-chat',
      chats: [{ id: 'fixture-chat', title: 'Workflow fixture', sample: false, projectId: 'personal',
        channelId: null, recipients: ['fixture-agent'], draft: '', pendingQueue: [], messages: [] }],
      channels: [],
      projects: [{ id: 'personal', name: 'Personal', system: true }]
    }
  };
}

async function createFixture({ chatResponder }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-round2-browser-full-'));
  const api = await start({
    root,
    port: 0,
    executionOptions: { provider: { status: () => ({}) }, coordinator: { close() {} }, adapters: { close() {} }, delivery: {} },
    providerCapabilities: capabilities,
    chatResponder
  });
  const fixture = staticFixtureServer();
  const staticPort = await listen(fixture);
  const apiPort = api.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const page = await browser.newPage();
  const apiRequests = [];
  await page.route('http://127.0.0.1:8768/api/**', async (route) => {
    const request = route.request();
    const sourceUrl = new URL(request.url());
    const target = `http://127.0.0.1:${apiPort}${sourceUrl.pathname}${sourceUrl.search}`;
    const headers = { ...request.headers(), origin: `http://127.0.0.1:${apiPort}`, host: `127.0.0.1:${apiPort}` };
    delete headers['content-length'];
    delete headers['accept-encoding'];
    const requestBody = ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postDataBuffer();
    const response = await fetch(target, {
      method: request.method(),
      headers,
      body: requestBody
    });
    const body = Buffer.from(await response.arrayBuffer());
    apiRequests.push({ method: request.method(), pathname: sourceUrl.pathname, status: response.status,
      requestBody: requestBody?.toString('utf8') || '', body: body.toString('utf8') });
    const responseHeaders = Object.fromEntries(response.headers.entries());
    delete responseHeaders['content-length'];
    delete responseHeaders['content-encoding'];
    delete responseHeaders['transfer-encoding'];
    delete responseHeaders.connection;
    responseHeaders['access-control-allow-origin'] = `http://127.0.0.1:${staticPort}`;
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  });
  await page.addInitScript((storage) => {
    // Seed only a new fixture context. Reload must retain the workflow state
    // written by the assembled UI so review-only recovery is testable.
    if (localStorage.getItem('aven-polished-preferences-v1')) return;
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(storage.prefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(storage.data));
    localStorage.setItem('aven-polished-docs-v1', JSON.stringify({}));
  }, browserStorage());
  await page.goto(`http://127.0.0.1:${staticPort}/polished.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#draft').waitFor({ state: 'visible' });
  return {
    page,
    browser,
    api,
    fixture,
    root,
    staticPort,
    apiRequests,
    async dispose() {
      await browser.close();
      await close(fixture);
      await close(api);
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function questionResponse() {
  return {
    tool_calls: [{ name: 'ask_clarification', args: {
      prompt: 'Which exact device?',
      choices: [{ id: 'edge-a', label: 'Edge A' }],
      allow_free_text: false
    } }],
    source: 'provider-response', model: 'mock-model'
  };
}

async function submit(page, text) {
  await page.locator('#draft').fill(text);
  await page.locator('#draft').press('Enter');
}

async function waitForText(page, text) {
  await page.locator('#conversation').getByText(text, { exact: true }).last().waitFor({ state: 'visible', timeout: 10000 });
}

test('assembled polished app answers model clarification, resumes same run, and dispatches queued follow-up', async (t) => {
  if (!fs.existsSync(chrome)) return t.skip('Chrome executable is not installed');
  let calls = 0;
  let resumeStarted;
  const resumed = new Promise((resolve) => { resumeStarted = resolve; });
  let releaseResume;
  const resumeGate = new Promise((resolve) => { releaseResume = resolve; });
  const fixture = await createFixture({
    chatResponder: async () => {
      calls += 1;
      if (calls === 1) return questionResponse();
      if (calls === 2) {
        resumeStarted();
        await resumeGate;
        return { text: 'Resumed after Edge A', source: 'provider-response', model: 'mock-model' };
      }
      return { text: 'Queued follow-up completed', source: 'provider-response', model: 'mock-model' };
    }
  });
  try {
    const { page } = fixture;
    await submit(page, 'Inspect branch device.');
    await page.locator('[data-workflow-card="pending-question"]').waitFor({ state: 'visible' });
    await waitForText(page, 'Which exact device?');

    await page.locator('[data-workflow-card="pending-question"] input[type="radio"]').check();
    await page.getByRole('button', { name: 'Answer', exact: true }).click();
    await resumed;

    // This send occurs while the resumed model segment is still held. It must
    // enter the durable queue and dispatch only after the resumed result.
    await submit(page, 'Follow up during resume.');
    await page.locator('#pending-queue').waitFor({ state: 'visible' });
    const queued = page.locator('#pending-queue .queue-item textarea');
    await queued.waitFor({ state: 'visible' });
    assert.equal(await queued.inputValue(), 'Follow up during resume.');

    releaseResume();
    await waitForText(page, 'Resumed after Edge A');
    await waitForText(page, 'Queued follow-up completed');
    assert.equal(calls, 3, 'answer and queued follow-up must each use the assembled responder');
    assert.equal(await page.locator('#pending-queue').isHidden(), true);
    assert.equal(await page.locator('[data-workflow-card="pending-question"]').count(), 0);
  } finally {
    await fixture.dispose();
  }
});

test('assembled polished app exposes Stop while resuming and settles the canceled run', async (t) => {
  if (!fs.existsSync(chrome)) return t.skip('Chrome executable is not installed');
  let calls = 0;
  let resumeStarted;
  const resumed = new Promise((resolve) => { resumeStarted = resolve; });
  const fixture = await createFixture({
    chatResponder: async ({ signal }) => {
      calls += 1;
      if (calls === 1) return questionResponse();
      resumeStarted();
      return new Promise((resolve) => {
        if (signal?.aborted) return resolve({ text: 'stopped before completion' });
        signal?.addEventListener('abort', () => resolve({ text: 'stopped before completion' }), { once: true });
      });
    }
  });
  try {
    const { page } = fixture;
    await submit(page, 'Inspect before stop.');
    await page.locator('[data-workflow-card="pending-question"]').waitFor({ state: 'visible' });
    await page.locator('[data-workflow-card="pending-question"] input[type="radio"]').check();
    await page.getByRole('button', { name: 'Answer', exact: true }).click();
    await resumed;
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByText('This question is no longer active.', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(calls, 2);
    const stopped = fixture.apiRequests.filter((item) => item.pathname === '/api/chat/workflow/stop');
    assert.equal(stopped.length, 1, 'Stop must reach the assembled workflow endpoint');
    assert.equal(JSON.parse(stopped[0].requestBody).reason, 'stopped while resuming');
  } finally {
    await fixture.dispose();
  }
});

test('assembled polished app reloads as review-only and abandons stale question before a fresh same-chat request', async (t) => {
  if (!fs.existsSync(chrome)) return t.skip('Chrome executable is not installed');
  let calls = 0;
  const fixture = await createFixture({
    chatResponder: async () => {
      calls += 1;
      return calls === 1 ? questionResponse() : { text: 'Fresh request completed', source: 'provider-response', model: 'mock-model' };
    }
  });
  try {
    const { page } = fixture;
    await submit(page, 'Ask a question that will be reloaded.');
    await page.locator('[data-workflow-card="pending-question"]').waitFor({ state: 'visible' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#draft').waitFor({ state: 'visible' });
    const fresh = page.getByRole('button', { name: 'Start fresh request', exact: true });
    await fresh.waitFor({ state: 'visible', timeout: 10000 }).catch(async (error) => {
      const state = await page.evaluate(() => ({ html: document.querySelector('#conversation')?.innerHTML || '', data: localStorage.getItem('aven-polished-chats-v1') }));
      console.error('RELOAD_STATE', JSON.stringify(state));
      error.message += `\nReloaded conversation state: ${JSON.stringify(state)}`;
      throw error;
    });
    await fresh.click();
    await page.getByText('This question is no longer active.', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await submit(page, 'Fresh request after abandon.');
    await waitForText(page, 'Fresh request completed').catch(async (error) => {
      const state = await page.evaluate(() => ({ html: document.querySelector('#conversation')?.innerHTML || '', data: localStorage.getItem('aven-polished-chats-v1') }));
      console.error('FRESH_STATE', JSON.stringify({ calls, state, apiRequests: fixture.apiRequests }));
      throw error;
    });
    assert.equal(calls, 2);
    const abandoned = fixture.apiRequests.filter((item) => item.pathname === '/api/chat/workflow/abandon');
    assert.equal(abandoned.length, 1, 'reload recovery must release the server-side waiting lease');
  } finally {
    await fixture.dispose();
  }
});
