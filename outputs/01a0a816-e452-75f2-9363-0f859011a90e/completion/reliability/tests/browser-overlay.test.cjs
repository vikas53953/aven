'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require(path.resolve(__dirname, '../../../../../intentgraph/node_modules/playwright'));

const artifactRoot = path.resolve(__dirname, '..');
const overlayRoot = path.join(artifactRoot, 'candidate', 'overlay');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const origin = 'http://127.0.0.1:8767';

function contentType(file) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  }[path.extname(file).toLowerCase()] || 'application/octet-stream';
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}
function close(server) {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  return new Promise(resolve => server.close(() => resolve()));
}
function createStaticServer() {
  return http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    const file = path.resolve(overlayRoot, relative || 'polished.html');
    if (file !== overlayRoot && !file.startsWith(overlayRoot + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store', 'Content-Length': body.length });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
}
function createMockChatServer(state) {
  return http.createServer((req, res) => {
    const requestOrigin = req.headers.origin || origin;
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Aven-Chat');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && pathname === '/api/capabilities') {
      state.capabilityRequests += 1;
      const payload = JSON.stringify({ runtime: { allowConcurrentRuns: state.allowConcurrentRuns !== false, concurrency: state.allowConcurrentRuns === false ? 'single' : 'per-chat' } });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
      res.end(payload);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/chat/recovery') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
        if (body?.authorized !== true) { res.writeHead(403); res.end(JSON.stringify({ error: 'authorization required' })); return; }
        const payload = body.probe === true
          ? { probe: true, allowConcurrentRuns: state.allowConcurrentRuns !== false, activeRequestIds: [...state.activeRequestIds] }
          : { recovered: false, count: 0 };
        const encoded = JSON.stringify(payload);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) });
        res.end(encoded);
      });
      return;
    }
    if (req.method !== 'POST' || pathname !== '/api/chat') { res.writeHead(404); res.end(); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
      state.bodies.push(body);
      if (state.mode === 'error') {
        const payload = JSON.stringify({ error: 'Mock timeout' });
        res.writeHead(502, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
        res.end(payload);
        return;
      }
      const runId = '00000000-0000-4000-8000-' + String(state.bodies.length).padStart(12, '0');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      res.write(JSON.stringify({ type: 'start', runId, message: 'Mock started' }) + '\n');
      const finish = () => {
        const reply = state.mode === 'waiting'
          ? { status: 'waiting-question', pendingQuestion: { question: { id: 'site', prompt: 'Which site?', choices: ['Lab'] }, token: 'private-token' } }
          : { text: 'Mock final', evidence: [] };
        res.write(JSON.stringify({ type: 'final', runId, reply }) + '\n');
        res.write(JSON.stringify({ type: 'final', runId, reply }) + '\n');
        res.write(JSON.stringify({ type: 'end', runId }) + '\n');
        res.end();
      };
      if (state.mode === 'hold') state.releases.set(body.requestId, finish);
      else setTimeout(finish, 25);
    });
  });
}
function seededData(messageCount = 0, pendingQueue = []) {
  const messages = [];
  for (let i = 0; i < messageCount; i += 1) messages.push({ id: 'history-' + i, role: i % 2 ? 'assistant' : 'user', text: 'history ' + i, createdAt: new Date(1700000000000 + i * 1000).toISOString() });
  return {
    activeChat: 'chat-a',
    chats: [
      { id: 'chat-a', title: 'Chat A', projectId: 'team', channelId: null, recipients: ['companion'], draft: '', messages, pendingQueue, queuePaused: pendingQueue.length > 0 },
      { id: 'chat-b', title: 'Chat B', projectId: 'team', channelId: null, recipients: ['companion'], draft: '', messages: [], pendingQueue: [] }
    ],
    channels: [],
    projects: [{ id: 'personal', name: 'Personal', system: true }, { id: 'team', name: 'Test team', members: ['companion'], collapsed: false }]
  };
}
const prefs = {
  theme: 'light', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Test',
  activeAgent: 'companion', provider: 'Mock', model: 'mock', browser: false, computer: false, sections: [],
  agents: [{ id: 'companion', name: 'Network companion', role: 'Investigate branch networks.', timezone: 'Follow system' }]
};
async function seedPage(page, url, data) {
  await page.goto(url);
  await page.evaluate(({ preferences, chats }) => {
    localStorage.clear();
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(preferences));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(chats));
    localStorage.setItem('aven-polished-docs-v1', JSON.stringify({}));
  }, { preferences: prefs, chats: data });
  await page.reload();
  await page.locator('#draft').waitFor();
}
async function waitForBodies(count) {
  const deadline = Date.now() + 3000;
  while (mockState.bodies.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(mockState.bodies.length, count);
}

let browser;
let staticServer;
let mockServer;
let staticUrl;
const mockState = { mode: 'immediate', allowConcurrentRuns: true, capabilityRequests: 0, activeRequestIds: new Set(), bodies: [], releases: new Map() };

test.before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: chromePath });
  staticServer = createStaticServer();
  await listen(staticServer, 0);
  staticUrl = 'http://127.0.0.1:' + staticServer.address().port + '/polished.html';
  mockServer = createMockChatServer(mockState);
  await listen(mockServer, 8768);
});
test.after(async () => {
  await close(mockServer);
  await close(staticServer);
  await browser.close();
});
test.beforeEach(() => {
  mockState.mode = 'immediate';
  mockState.allowConcurrentRuns = true;
  mockState.capabilityRequests = 0;
  mockState.activeRequestIds.clear();
  mockState.bodies = [];
  mockState.releases.clear();
});

test('browser overlay keeps independent drafts across chat switching, reload, and 5k text', async () => {
  const page = await browser.newPage();
  try {
    await seedPage(page, staticUrl, seededData());
    const fiveK = 'A'.repeat(5000);
    await page.locator('#draft').fill(fiveK);
    await page.locator('[data-conversation-row="chat-b"]').click();
    await page.locator('#draft').fill('draft B');
    await page.locator('[data-conversation-row="chat-a"]').click();
    assert.equal(await page.locator('#draft').inputValue(), fiveK);
    await page.reload();
    assert.equal(await page.locator('#draft').inputValue(), fiveK);
    await page.locator('[data-conversation-row="chat-b"]').click();
    assert.equal(await page.locator('#draft').inputValue(), 'draft B');
    await page.locator('[data-conversation-row="chat-a"]').click();
    await page.locator('#draft').fill('X'.repeat(32001));
    await page.locator('[data-conversation-row="chat-b"]').click();
    assert.match(await page.locator('#chat-status').textContent(), /Draft storage is unavailable/);
    assert.equal(await page.locator('#surface').textContent(), 'Chat A');
    const savedLength = await page.evaluate(() => JSON.parse(localStorage.getItem('aven-reliability-v1:state')).drafts['chat-a'].length);
    assert.equal(savedLength, 5000);
  } finally {
    await page.close();
  }
});

test('browser overlay protects IME Enter, deduplicates final NDJSON, and records elapsed time', async () => {
  const page = await browser.newPage();
  try {
    await seedPage(page, staticUrl, seededData());
    const draft = page.locator('#draft');
    await draft.fill('composing message');
    await draft.dispatchEvent('compositionstart');
    await page.evaluate(() => document.querySelector('#draft').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(mockState.bodies.length, 0);
    await draft.dispatchEvent('compositionend');
    await draft.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#conversation .message.assistant:not(.working-message)').length === 1);
    assert.equal(mockState.bodies.length, 1);
    assert.equal(await page.locator('#conversation .message.assistant:not(.working-message)').count(), 1);
    assert.match(await page.locator('.message-duration').textContent(), /Took/);
    assert.equal(await page.locator('#conversation .run-evidence').count(), 1);
    assert.equal(await page.locator('#conversation .run-evidence p').filter({ hasText: 'final' }).count(), 0);
  } finally {
    await page.close();
  }
});

test('browser overlay dispatches queued messages FIFO and blocks unsafe retry after a 502', async () => {
  const page = await browser.newPage();
  try {
    await seedPage(page, staticUrl, seededData(0, [
      { id: 'queue-a', text: 'first queued', mode: 'inspect', createdAt: new Date().toISOString() },
      { id: 'queue-b', text: 'second queued', mode: 'inspect', createdAt: new Date().toISOString() }
    ]));
    await page.locator('#resume-queue').click();
    await page.waitForFunction(() => document.querySelectorAll('.message-duration').length >= 2);
    assert.deepEqual(mockState.bodies.map(body => body.messages.at(-1).content), ['first queued', 'second queued']);

    mockState.mode = 'error';
    await page.locator('#draft').fill('offline attempt');
    await page.locator('#draft').press('Enter');
    await page.locator('.chat-retry').waitFor();
    assert.equal(mockState.bodies.length, 3);
    await page.locator('.chat-retry').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(mockState.bodies.length, 3);
    const captureWarning = await page.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-chats-v1')).chats.find(chat => chat.id === 'chat-a').captureWarning || '');
    assert.match(captureWarning, /already claimed/);
  } finally {
    await page.close();
  }
});

test('browser overlay renders a 500-message transcript after reload within the bounded fixture', async () => {
  const page = await browser.newPage();
  try {
    await seedPage(page, staticUrl, seededData(500));
    assert.equal(await page.locator('#conversation .message').count(), 500);
    assert.equal(await page.locator('#conversation').isVisible(), true);
    const scrollable = await page.locator('#center-content').evaluate(node => node.scrollHeight > node.clientHeight);
    assert.equal(scrollable, true);
  } finally {
    await page.close();
  }
});

test('browser overlay pauses queued work for a waiting question without requiring reply text', async () => {
  const page = await browser.newPage();
  try {
    await seedPage(page, staticUrl, seededData(0, [
      { id: 'wait-a', text: 'needs clarification', mode: 'inspect', createdAt: new Date().toISOString() },
      { id: 'wait-b', text: 'must wait', mode: 'inspect', createdAt: new Date().toISOString() }
    ]));
    mockState.mode = 'waiting';
    await page.locator('#resume-queue').click();
    await page.waitForFunction(() => document.querySelector('.message.assistant:not(.working-message)')?.textContent.includes('Which site?'));
    assert.equal(mockState.bodies.length, 1);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-chats-v1')).chats.find(chat => chat.id === 'chat-a'));
    assert.equal(saved.queuePaused, true);
    assert.equal(saved.pendingQueue.length, 1);
    assert.equal(saved.pendingQueue[0].id, 'wait-b');
    assert.equal(saved.messages.at(-1).status, 'WAITING');
    assert.equal(JSON.stringify(saved).includes('private-token'), false);
  } finally {
    await page.close();
  }
});

test('browser overlay exposes guarded local recovery after reload without retrying abandoned work', async () => {
  const page = await browser.newPage();
  try {
    await seedPage(page, staticUrl, seededData());
    await page.evaluate(() => {
      const state = {
        version: 1,
        revision: 1,
        drafts: {},
        queues: {},
        runs: {
          'stale-run': {
            runId: 'stale-run',
            chatId: 'chat-a',
            requestId: 'stale-request',
            ownerId: 'browser-previous-tab',
            status: 'RUNNING',
            cancelRequested: false,
            startedAt: new Date(Date.now() - 60000).toISOString()
          }
        },
        receipts: {}
      };
      localStorage.setItem('aven-reliability-v1:state', JSON.stringify(state));
    });
    await page.reload();
    await page.locator('#chat-status').getByRole('button', { name: 'Recover abandoned local work' }).waitFor({ timeout: 5000 });
    assert.match(await page.locator('#chat-status').textContent(), /previous browser run needs review/);
    assert.equal(mockState.bodies.length, 0, 'recovery inspection must never dispatch the abandoned request');

    await page.locator('#chat-status').getByRole('button', { name: 'Recover abandoned local work' }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aven-reliability-v1:state')).runs['stale-run'].status === 'UNKNOWN');
    const saved = await page.evaluate(() => ({
      reliability: JSON.parse(localStorage.getItem('aven-reliability-v1:state')),
      chat: JSON.parse(localStorage.getItem('aven-polished-chats-v1')).chats.find(chat => chat.id === 'chat-a')
    }));
    assert.equal(saved.reliability.runs['stale-run'].status, 'UNKNOWN');
    assert.equal(saved.chat.queuePaused, true, 'recovery preserves the explicit resume gate');
    assert.equal(mockState.bodies.length, 0, 'recovering UNKNOWN work must not automatically retry it');
  } finally {
    await page.close();
  }
});

test('browser overlay preserves a run owned by another live tab during recovery inspection', async () => {
  const liveTab = await browser.newPage();
  const recoveryTab = await browser.newPage();
  try {
    await seedPage(liveTab, staticUrl, seededData());
    const liveOwner = await liveTab.evaluate(() => {
      const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find(key => key?.startsWith('aven-reliability-v1:lease:'));
      return key?.slice('aven-reliability-v1:lease:'.length);
    });
    assert.ok(liveOwner);
    await recoveryTab.goto(staticUrl);
    await recoveryTab.evaluate(owner => {
      localStorage.setItem('aven-reliability-v1:state', JSON.stringify({
        version: 1, revision: 1, drafts: {}, queues: {}, receipts: {},
        runs: {
          'live-run': {
            runId: 'live-run', chatId: 'chat-a', requestId: 'live-request', ownerId: owner,
            status: 'RUNNING', cancelRequested: false, startedAt: new Date().toISOString()
          }
        }
      }));
    }, liveOwner);
    await recoveryTab.reload();
    await recoveryTab.locator('#chat-status').waitFor();
    assert.equal(await recoveryTab.locator('#chat-status').getByRole('button', { name: 'Recover abandoned local work' }).count(), 0);
    const saved = await recoveryTab.evaluate(() => JSON.parse(localStorage.getItem('aven-reliability-v1:state')).runs['live-run']);
    assert.equal(saved.status, 'RUNNING', 'a live other-tab lease prevents local abandonment');
    assert.equal(mockState.bodies.length, 0);
  } finally {
    await recoveryTab.close();
    await liveTab.close();
  }
});

test('browser overlay keeps per-chat capacity independent and drains an eligible own-chat queue', async () => {
  const page = await browser.newPage();
  try {
    await seedPage(page, staticUrl, seededData());
    assert.ok(mockState.capabilityRequests > 0, 'browser initializes concurrency from /api/capabilities');
    mockState.mode = 'hold';

    await page.locator('#draft').fill('A first');
    await page.locator('#draft').press('Enter');
    await waitForBodies(1);
    const requestA = mockState.bodies[0].requestId;

    await page.locator('[data-conversation-row="chat-b"]').click();
    await page.locator('#draft').fill('B first');
    assert.equal(await page.locator('#send').getAttribute('aria-label'), 'Send message');
    await page.locator('#draft').press('Enter');
    await waitForBodies(2);
    const requestB = mockState.bodies[1].requestId;

    await page.locator('[data-conversation-row="chat-a"]').click();
    await page.locator('#draft').fill('A queued');
    await page.locator('#draft').press('Enter');
    assert.equal(await page.locator('#send').getAttribute('aria-label'), 'Queue message');
    assert.equal(await page.locator('.queue-item').count(), 1);
    assert.equal(mockState.bodies.length, 2);

    await page.locator('[data-conversation-row="chat-b"]').click();
    mockState.releases.get(requestB)();
    await page.waitForFunction(() => document.querySelector('.message.assistant:not(.working-message)')?.textContent.includes('Mock final'));
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(mockState.bodies.length, 2, 'B completion must not dispatch A while A is still active');

    await page.locator('[data-conversation-row="chat-a"]').click();
    mockState.releases.get(requestA)();
    await waitForBodies(3);
    assert.deepEqual(mockState.bodies.map(body => body.messages.at(-1).content), ['A first', 'B first', 'A queued']);
    const requestAQueued = mockState.bodies[2].requestId;
    mockState.releases.get(requestAQueued)();
    await page.waitForFunction(() => document.querySelectorAll('#conversation .message.assistant:not(.working-message)').length >= 2);
  } finally {
    await page.close();
  }
});
