'use strict';

// Independent post-integration checks. This file is review evidence only; it
// never writes product files and permits requests only to the local fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(projectRoot, 'intentgraph', 'node_modules', 'playwright'));
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREF_KEY = 'aven-polished-preferences-v1';
const CHAT_KEY = 'aven-polished-chats-v1';
const DOC_KEY = 'aven-polished-docs-v1';
const MIGRATION_KEY = 'aven-polished-direct-teams-migration-v4';
const rawOutput = '\n Router#show interfaces\n\tGi0/1  up  up\n';
const timestamp = '2026-09-16T04:20:00.000Z';

function serveStatic() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url || '/', 'http://fixture').pathname);
        const relative = pathname.replace(/^\/+/, '') || 'polished.html';
        if (relative.includes('..')) { response.writeHead(403); response.end(); return; }
        const file = path.join(projectRoot, relative);
        if (!file.startsWith(projectRoot + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          response.writeHead(404); response.end(); return;
        }
        const ext = path.extname(file).toLowerCase();
        const contentType = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
        response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(response);
      } catch (error) { response.writeHead(500); response.end(String(error)); }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function seed() {
  return {
    prefs: {
      theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Independent audit',
      activeAgent: 'audit-agent', provider: 'Not connected', model: '', browser: true, computer: false, sections: [],
      agents: [{ id: 'audit-agent', name: 'Audit coworker', role: 'Network diagnostics', description: 'Fixture', label: 'Audit', notifications: true, timezone: 'Follow system', autoReview: false, hidden: false, archived: false, pinned: false, unread: false, sectionId: '' }],
    },
    data: {
      activeChat: 'audit-chat', projects: [], channels: [], workspaceTools: {},
      chats: [{
        id: 'audit-chat', title: 'Independent artifact audit', projectId: null, channelId: null, recipients: ['audit-agent'], draft: '', sample: false,
        messages: [{
          id: 'audit-message', role: 'assistant', agentId: 'audit-agent', text: 'Saved evidence', runId: 'run-9', createdAt: timestamp,
          events: [{ type: 'tool_result', runId: 'run-9', evidence: { id: 'result-9', output: rawOutput, source: 'mock-cli', command: 'show interfaces', target: 'router-9', status: 'SUCCESS', timestamp } }],
          evidence: [{ id: 'result-9', output: rawOutput, source: 'mock-cli', command: 'show interfaces', target: 'router-9', status: 'SUCCESS', timestamp }],
          pendingQueue: [],
        }],
      }],
    },
    docs: { 'audit-agent': { 'SOUL.md': '# Audit coworker', 'MEMORY.md': 'private fixture note' } },
  };
}

async function runAboutCheck(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const blocked = [], pageErrors = [], apiCalls = [];
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === 'http://127.0.0.1:8768' && url.pathname === '/api/chat/status' && request.method() === 'GET') {
      apiCalls.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify({ provider: 'NamedProvider', model: 'NamedModel', configured: false, lastChecked: timestamp, secret: 'must-not-copy' }) });
    }
    blocked.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${origin}/polished.html?independent=ux102`, { waitUntil: 'domcontentloaded' });
    await page.locator('#account-button').click();
    await page.locator('[data-account-action="about"]').click();
    const row = page.locator('#about-chat-connection');
    assert.equal(await row.innerText(), 'Unknown · local status not checked');
    await page.locator('#refresh-local-status').click();
    await page.locator('.diagnostics-report').waitFor();
    await page.locator('#local-status-result').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#local-status-result')?.textContent.includes('Provider credential not configured'));
    assert.equal(await row.innerText(), 'NamedProvider · NamedModel (not configured; reachability unverified)');
    const report = JSON.parse(await page.locator('.diagnostics-report').innerText());
    assert.equal(report.configured, false);
    assert.equal(report.provider, 'NamedProvider');
    assert.equal(report.model, 'NamedModel');
    assert.equal(report.secret, undefined);
    await page.locator('#copy-support-report').click();
    await page.waitForFunction(() => document.querySelector('#local-status-result')?.textContent.includes('Support report copied'));
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(copied.configured, false);
    assert.equal(copied.provider, 'NamedProvider');
    assert.equal(copied.secret, undefined);
    assert.deepEqual(apiCalls, ['/api/chat/status']);
    assert.deepEqual(blocked, []);
    assert.deepEqual(pageErrors, []);
    return { name: 'About false named snapshot and async support copy', passed: true, apiCalls, blocked, pageErrors, row: await row.innerText() };
  } finally { await context.close(); }
}

async function runArtifactCheck(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const blocked = [], pageErrors = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    blocked.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const fixture = seed();
    await page.goto(`${origin}/polished.html?independent=ux066`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ prefs, data, docs }) => {
      localStorage.clear();
      localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
      localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
      localStorage.setItem('aven-polished-docs-v1', JSON.stringify(docs));
      localStorage.setItem('aven-polished-direct-teams-migration-v4', 'v4');
    }, fixture);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const before = await page.evaluate((key) => localStorage.getItem(key), CHAT_KEY);
    await page.locator('[data-destination="Artifacts"]').click();
    await page.locator('.aven-workspace-tools-artifact').waitFor();
    const cards = await page.locator('.aven-workspace-tools-artifact').count();
    assert.equal(cards, 1);
    assert.equal(await page.locator('.aven-workspace-tools-raw').innerText(), rawOutput);
    const provenance = await page.locator('.aven-workspace-tools-provenance').innerText();
    for (const expected of ['run-9', 'mock-cli', 'show interfaces', 'router-9', 'SUCCESS']) assert.ok(provenance.includes(expected), `visible provenance missing ${expected}`);
    const after = await page.evaluate((key) => localStorage.getItem(key), CHAT_KEY);
    assert.equal(after, before, 'rendering artifacts changed the persisted chat record');
    const stored = JSON.parse(after);
    const storedOutput = stored.chats[0].messages[0].evidence[0];
    assert.deepEqual(storedOutput, { id: 'result-9', output: rawOutput, source: 'mock-cli', command: 'show interfaces', target: 'router-9', status: 'SUCCESS', timestamp });
    assert.deepEqual(blocked, []);
    assert.deepEqual(pageErrors, []);
    return { name: 'Artifact dedup, storage stability, and visible provenance', passed: true, cards, rawPreserved: true, metadataVisible: true, blocked, pageErrors };
  } finally { await context.close(); }
}

async function main() {
  const { server, origin } = await serveStatic();
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const results = [];
  try {
    results.push(await runAboutCheck(browser, origin));
    results.push(await runArtifactCheck(browser, origin));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  const record = { at: new Date().toISOString(), productBuild: 'ux-audit-fixes-v8', blockedPolicy: 'Only local static shell and mocked loopback status are allowed; no provider, device, credential, or user storage calls.', results };
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
