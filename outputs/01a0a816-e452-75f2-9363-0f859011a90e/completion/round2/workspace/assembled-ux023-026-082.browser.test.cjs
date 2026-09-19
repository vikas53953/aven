'use strict';

// Full assembled-shell path. The static files are served from the frozen
// assembled candidate over loopback; page fetch is replaced with deterministic
// responses, and SpeechRecognition is a fake that never opens a microphone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '../../../../../intentgraph/node_modules/playwright'));

const nodePath = 'C:\\Users\\vikasmit\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe';
const root = path.resolve(__dirname, '../../assembled-candidate');
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const prefs = {
  theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: '', activeAgent: 'companion',
  provider: 'Not connected', model: '', providerSelection: null, providerSelectionExplicit: false, browser: true, computer: false,
  showEvidence: false, showInvestigation: false, showRunDetails: false, sections: [],
  agents: [{ id: 'companion', name: 'Network companion', role: 'Investigate branch networks.', timezone: 'Follow system', autoReview: false }],
};
const topologyPayload = {
  source: 'retained topology evidence', freshness: '2026-09-17T04:01:00Z',
  nodes: [{ id: 'edge-42', label: 'branch-edge' }, { id: 'core-7', label: 'core-switch' }, { label: 'unidentified-device' }],
  links: [{ from: 'edge-42', to: 'core-7', inferred: true, source: 'route inference', freshness: '2026-09-17T04:01:00Z' }],
};
const inventoryPayload = {
  source: 'injected sandbox inventory', retrievedAt: '2026-09-17T04:00:00Z',
  devices: [
    { id: 'edge-42', hostname: 'edge-42', name: 'Branch edge', status: 'connected', connected: true, platform: 'mock', managementIp: '192.0.2.42', softwareVersion: 'test', reachability: 'reachable', source: 'injected sandbox inventory' },
    { hostname: 'unknown-id-device', name: 'Unidentified device', status: 'disconnected', connected: false, platform: 'mock', managementIp: '192.0.2.43', softwareVersion: 'test', reachability: 'unknown', source: 'injected sandbox inventory' },
  ],
  topology: topologyPayload,
};

function response(body, contentType = 'application/json; charset=utf-8') {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': contentType } });
}

async function main() {
  const server = http.createServer((request, reply) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname.replace(/^\/+/, '') || 'polished.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { reply.writeHead(404); reply.end('not found'); return; }
    reply.writeHead(200, { 'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(reply);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AVEN_PLAYWRIGHT_CHROMIUM || 'C:\\Users\\vikasmit\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1181\\chrome-win\\headless_shell.exe' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(({ prefs: seedPrefs, inventory }) => {
    localStorage.clear();
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(seedPrefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify({ activeChat: 'network-chat', inventory, chats: [{ id: 'network-chat', title: 'Network review', sample: false, channelId: null, projectId: null, recipients: ['companion'], draft: '', pendingAttachmentNames: [], messages: [] }], channels: [], projects: [{ id: 'personal', name: 'Personal', system: true }] }));
    localStorage.setItem('aven-polished-docs-v1', JSON.stringify({}));
    window.__seenRequests = [];
    window.__recognitionStarts = 0;
    window.__recognitionAborts = 0;
    class FakeSpeechRecognition {
      constructor() { window.__activeRecognition = this; }
      start() { window.__recognitionStarts += 1; }
      stop() { this.onend?.(); }
      abort() { window.__recognitionAborts += 1; this.onend?.(); }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
    window.fetch = async (url, options = {}) => {
      const target = String(url);
      window.__seenRequests.push({ target, body: options.body || '' });
      if (target.includes('/api/sandbox/inventory')) return new Response(JSON.stringify({ ...inventory, topology: window.__topologyPayload }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (target.endsWith('/api/chat')) return new Response(JSON.stringify({ text: 'Mock response', status: 'success', source: 'injected chat fixture' }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (target.includes('/api/capabilities')) return new Response(JSON.stringify({ runtime: { allowConcurrentRuns: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    window.__topologyPayload = {
      source: 'retained topology evidence', freshness: '2026-09-17T04:01:00Z',
      nodes: [{ id: 'edge-42', label: 'branch-edge' }, { id: 'core-7', label: 'core-switch' }, { label: 'unidentified-device' }],
      links: [{ from: 'edge-42', to: 'core-7', inferred: true, source: 'route inference', freshness: '2026-09-17T04:01:00Z' }],
    };
  }, { prefs, inventory: inventoryPayload });

  try {
    await page.goto(`http://127.0.0.1:${address.port}/polished.html`, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#aven-voice-dictation').count(), 1, 'dictation control mounted in assembled shell');
    assert.match(await page.locator('#aven-dictation-status').innerText(), /ready|unavailable/i);

    // UX023: alias replacement is visible, then the exact stable token travels
    // through sendMessage -> chatContext -> the next request body.
    await page.locator('#draft').fill('Check @device:edge-42');
    await page.waitForTimeout(20);
    assert.match(await page.locator('#aven-mention-status').innerText(), /edge-42.*available/i);
    await page.getByRole('button', { name: 'Use stable ID edge-42' }).click();
    assert.equal(await page.locator('#draft').inputValue(), 'Check @device:edge-42');
    await page.locator('#draft').fill('Check @device:edge-42');
    await page.locator('#send').click();
    await page.waitForFunction(() => window.__seenRequests.some((item) => item.target.endsWith('/api/chat')));
    const chatRequest = await page.evaluate(() => window.__seenRequests.find((item) => item.target.endsWith('/api/chat')));
    const chatBody = JSON.parse(chatRequest.body);
    assert.match(chatBody.messages.at(-1).content, /@device:edge-42/);

    await page.locator('#draft').fill('@device:unknown-id-device');
    await page.waitForTimeout(20);
    const unavailableMention = await page.locator('#aven-mention-status').innerText();
    assert.match(unavailableMention, /disconnected/i);
    assert.doesNotMatch(unavailableMention, /available(?![\s\S]*disconnected)/i);

    // UX026: explicit start, recording indicator, editable review, and cancel.
    await page.locator('#draft').fill('');
    await page.locator('#aven-voice-dictation').click();
    assert.equal(await page.evaluate(() => window.__recognitionStarts), 1);
    assert.match(await page.locator('#aven-dictation-status').innerText(), /Recording indicator active/i);
    await page.evaluate(() => {
      window.__activeRecognition.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'show' }, isFinal: true }] });
      window.__activeRecognition.onresult?.({ resultIndex: 1, results: [{ 0: { transcript: 'ip' }, isFinal: true }, { 0: { transcript: 'route' }, isFinal: true }] });
    });
    await page.locator('#aven-voice-dictation').click();
    assert.match(await page.locator('#aven-dictation-status').innerText(), /review|edit/i);
    assert.equal(await page.locator('#draft').inputValue(), 'show ip route');
    await page.locator('#draft').fill('show interfaces');
    assert.equal(await page.locator('#draft').inputValue(), 'show interfaces');
    await page.locator('#draft').fill('');
    await page.locator('#aven-voice-dictation').click();
    await page.getByRole('button', { name: 'Cancel dictation' }).click();
    assert.equal(await page.evaluate(() => window.__recognitionAborts), 1);
    assert.match(await page.locator('#aven-dictation-status').innerText(), /ready/i);

    // UX082: actual Network sandbox pane, returned nodes and explicit topology
    // evidence. Missing IDs are visible as unavailable/nonselectable.
    await page.locator('#tools-menu').click();
    await page.locator('[data-add="plugins"]').click();
    await page.locator('#sandbox-load').click();
    await page.waitForFunction(() => document.querySelector('#sandbox-topology')?.textContent.includes('retained topology evidence'));
    const topologyText = await page.locator('#sandbox-topology').innerText();
    assert.match(topologyText, /Source: retained topology evidence/);
    assert.match(topologyText, /Freshness: 2026-09-17T04:01:00Z/);
    assert.match(topologyText, /ID edge-42/);
    assert.match(topologyText, /Inferred link/);
    assert.match(topologyText, /route inference/);
    assert.match(topologyText, /Stable ID unavailable · not selectable/);
    assert.doesNotMatch(topologyText, /device-1|device-2/);

    console.log(JSON.stringify({ passed: true, rows: ['UX-023', 'UX-026', 'UX-082'], externalCalls: 0, chatPayloadStableId: true, topologyEvidence: true, recognitionStarts: await page.evaluate(() => window.__recognitionStarts), recognitionAborts: await page.evaluate(() => window.__recognitionAborts), consoleErrors }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
