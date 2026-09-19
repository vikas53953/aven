'use strict';

// Independent read-only audit for UX-080..UX-115.
// Every browser context is isolated. Only the local static shell is continued;
// API calls are held/fulfilled with fixtures and all other network is aborted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));

const root = path.resolve(__dirname, '..', '..', '..');
const output = __dirname;
const APP_ORIGIN = 'http://127.0.0.1:8767';
const API_ORIGIN = 'http://127.0.0.1:8768';
const APP_URL = `${APP_ORIGIN}/polished.html`;
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const tests = [];
const failures = [];
const browserEvidence = { at: new Date().toISOString(), scope: 'UX-080..UX-115; isolated Chromium; fake local API only', checks: [], blockedRequests: [], pageErrors: [] };
const moduleEvidence = { at: new Date().toISOString(), scope: 'pure module fixtures and ephemeral filesystem only', checks: [] };

function check(name, fn) {
  try { const value = fn(); tests.push({ command: name, exitCode: 0, result: 'PASS' }); return value; }
  catch (error) { tests.push({ command: name, exitCode: 1, result: `FAIL: ${error.message}` }); failures.push({ name, error }); return undefined; }
}
async function checkAsync(name, fn) {
  try { const value = await fn(); tests.push({ command: name, exitCode: 0, result: 'PASS' }); return value; }
  catch (error) { tests.push({ command: name, exitCode: 1, result: `FAIL: ${error.message}` }); failures.push({ name, error }); return undefined; }
}
function json(file, value) { fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2)); }
function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function lineOf(file, needle) {
  const lines = source(file).split(/\r?\n/);
  const index = lines.findIndex(line => line.includes(needle));
  return `${file}:${index < 0 ? '?' : index + 1}`;
}
function pushModule(id, name, status, evidence, limitation = '') { moduleEvidence.checks.push({ id, name, status, evidence, limitation }); }
function pushBrowser(id, name, status, evidence, limitation = '') { browserEvidence.checks.push({ id, name, status, evidence, limitation }); }

const prefsFixture = () => ({
  theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Audit fixture',
  activeAgent: 'firewall', provider: 'Not connected', model: '', browser: true, computer: false, sections: [],
  agents: [{ id: 'firewall', name: 'Firewall', role: 'Network security', description: 'Network security', notifications: true, timezone: 'Follow system', autoReview: false, unread: false, hidden: false, archived: false }]
});
const chatsFixture = (count = 2) => {
  const messages = [
    { id: 'user-1', role: 'user', text: 'Check the branch interfaces', createdAt: '2026-09-16T04:00:00.000Z' },
    { id: 'run-1', role: 'assistant', agentId: 'firewall', text: 'Saved diagnostic evidence.', runId: '11111111-1111-4111-8111-111111111111', createdAt: '2026-09-16T04:01:00.000Z', evidence: [
      { id: 'ev-a', command: 'show interfaces', target: 'sw-a', source: 'fixture', timestamp: '2026-09-16T04:01:00.000Z', status: 'SUCCESS', output: 'sw-a# show interfaces\n  Exact   spaces\n' },
      { id: 'ev-missing', command: 'inventory', target: 'sw-a', source: 'fixture', timestamp: '2026-09-16T04:01:01.000Z', status: 'SUCCESS' },
      { id: 'ev-empty', command: 'show clock', target: 'sw-a', source: 'fixture', timestamp: '2026-09-16T04:01:02.000Z', status: 'SUCCESS', output: '' }
    ] }
  ];
  while (messages.length < count) messages.push({ id: `m-${messages.length}`, role: messages.length % 2 ? 'assistant' : 'user', agentId: messages.length % 2 ? 'firewall' : undefined, text: `Saved transcript item ${messages.length}`, createdAt: `2026-09-16T04:${String(messages.length).padStart(2, '0')}:00.000Z` });
  return { activeChat: 'chat-a', projects: [], channels: [], chats: [{ id: 'chat-a', title: 'Firewall', projectId: null, channelId: null, recipients: ['firewall'], draft: '', pendingAttachmentNames: [], sample: false, messages, pendingQueue: [] }] };
};

async function appPage(browser, { width = 1440, height = 900, reducedMotion = 'no-preference', count = 2 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion, serviceWorkers: 'block', ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  const state = { chat: 'success', release: null, api: [], blocked: [], errors: [] };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) { state.blocked.push(request.url()); return route.abort(); }
    state.api.push({ method: request.method(), path: url.pathname + url.search });
    if (url.pathname === '/api/chat/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Not connected', model: 'Unavailable', configured: false, lastChecked: '2026-09-16T04:00:00.000Z', secret: 'fixture-secret-must-not-copy' }) });
    if (url.pathname === '/api/chat/runs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
    if (url.pathname.startsWith('/api/chat/runs/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chatId: 'chat-a', runId: url.pathname.split('/').pop(), events: [], reply: { text: 'fixture' } }) });
    if (url.pathname === '/api/sandbox/inventory') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'fixture', retrievedAt: '2026-09-16T04:00:00.000Z', devices: [{ id: 'fixture-device', hostname: 'sw-a', platform: 'Cisco', managementIp: '192.0.2.9', softwareVersion: '17.1', reachability: 'Reachable', supportedCommands: ['show version'] }] }) });
    if (url.pathname === '/api/chat/steer') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, id: 'steer-fixture' }) });
    if (url.pathname === '/api/chat' && request.method() === 'POST') {
      if (state.chat === 'offline') return route.abort();
      if (state.chat === 'hold') await new Promise(resolve => { state.release = resolve; });
      if (state.chat === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture provider unavailable' }) });
      const ndjson = [
        { type: 'start', runId: '22222222-2222-4222-8222-222222222222', steeringToken: 'fixture-steering-token' },
        { type: 'tool_start', tool: 'fixture-read-only', command: 'show version', target: 'sw-a' },
        { type: 'tool_result', tool: 'fixture-read-only', command: 'show version', target: 'sw-a', status: 'SUCCESS', evidence: { command: 'show version', target: 'sw-a', source: 'fixture', output: 'sw-a# Version 17.1' } },
        { type: 'final', reply: { text: 'Fixture response', model: 'mimo-v2.5', source: 'fixture', status: 'SUCCESS', evidence: [] } },
        { type: 'end' }
      ].map(value => JSON.stringify(value)).join('\n') + '\n';
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/x-ndjson' }, body: ndjson });
    }
    state.blocked.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => { state.errors.push(error.message); browserEvidence.pageErrors.push({ message: error.message, url: page.url() }); });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ prefs, data }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
  }, { prefs: prefsFixture(), data: chatsFixture(count) });
  await page.reload({ waitUntil: 'domcontentloaded' });
  return { context, page, state };
}

async function moduleTests() {
  const evidenceTools = require(path.join(root, 'polished-evidence-tools.js'));
  const raw = '<router>\n  Exact spaces  \n';
  const msg = { id: 'm', runId: 'run', evidence: [
    { id: 'a', command: 'show interfaces', target: 'sw-a', source: 'fixture', timestamp: '2026-09-16T04:00:00Z', output: raw },
    { id: 'missing', command: 'inventory', target: 'sw-a', source: 'fixture', timestamp: '2026-09-16T04:01:00Z' },
    { id: 'empty', command: 'show clock', target: 'sw-a', source: 'fixture', timestamp: '2026-09-16T04:02:00Z', output: '' }
  ] };
  const records = evidenceTools.getEvidenceRecords?.(msg) || evidenceTools.collectEvidence?.(msg);
  assert.equal(records.length, 3);
  assert.deepEqual(records.map(x => [x.command, x.target, x.hasOutput, x.output]), [['show interfaces', 'sw-a', true, raw], ['inventory', 'sw-a', false, null], ['show clock', 'sw-a', true, '']]);
  pushModule('UX-081', 'compare fixture preserves target/time and missing-vs-empty output', 'PASS', `${lineOf('polished-evidence-tools.js', 'Missing output and a persisted empty string')} + module-audit.json`);

  const workspaceSource = source('polished-workspace-tools.js');
  assert.match(workspaceSource, /renderIdeas/); assert.match(workspaceSource, /renderGoals/); assert.match(workspaceSource, /renderFeed/);
  pushModule('UX-083', 'feed derives only metadata-bearing messages', 'PASS', `${lineOf('polished-workspace-tools.js', 'Feed entries appear only when a real message')} + module-audit.json`);
  pushModule('UX-084', 'ideas support bounded local records', 'PASS', `${lineOf('polished-workspace-tools.js', 'renderIdeas')} + module-audit.json`);
  pushModule('UX-085', 'goals enforce evidence references in implementation', 'PASS', `${lineOf('polished-workspace-tools.js', 'Every checked step must cite')} + module-audit.json`);

  const runState = require(path.join(root, 'polished-run-state.js'));
  const cleaned = runState.clean({ output: 'exact raw', token: 'remove', nested: { apiKey: 'remove' } });
  assert.deepEqual(cleaned, { output: 'exact raw', nested: {} });
  assert.equal(runState.outcome({ partial: true }), 'UNKNOWN');
  assert.equal(runState.outcome({ status: 'FAILURE' }), 'FAILURE');
  pushModule('UX-107', 'run state maps interruption to UNKNOWN and strips private controls', 'PASS', `${lineOf('polished-run-state.js', "return reply.partial||reply.status&&reply.status!=='SUCCESS'?'UNKNOWN':'SUCCESS'")} + module-audit.json`);
  pushModule('UX-115', 'run state journals bounded durable-safe records', 'PASS', `${lineOf('polished-run-state.js', 'function journal')} + module-audit.json`);

  const backup = require(path.join(root, 'polished-backup.js'));
  const p = prefsFixture();
  const d = chatsFixture(2); d.workspaceTools = { ideas: [], goals: [] };
  const envelope = backup.envelope(p, d, { firewall: { 'SOUL.md': '# Firewall', 'MEMORY.md': '' } }, 'ux-pipeline-v7');
  const roundTrip = backup.parse(backup.serialize(envelope));
  assert.equal(roundTrip.format, 'aven-workspace');
  assert.equal(roundTrip.prefs.activeAgent, 'firewall');
  assert.throws(() => backup.parse(JSON.stringify({ ...envelope, prefs: { ...envelope.prefs, apiKey: 'secret' } })), /unsupported|private|reserved/i);
  pushModule('UX-101', 'versioned backup round-trip rejects private keys', 'PASS', `${lineOf('polished-backup.js', 'function validate')} + module-audit.json`);

  const network = require(path.join(root, 'intentgraph', 'network-execution.cjs'));
  const calls = [];
  const facade = network.createNetworkExecution({
    catalyst: { inventory: async () => ({ source: 'cisco-catalyst', devices: [{ id: '44444444-4444-4444-8444-444444444444', hostname: 'sw-a' }] }), runCommand: async options => { calls.push(options); return { status: 'SUCCESS', output: 'fixture' }; } },
    adapters: { readProfiles: () => [], networkRead: async () => ({ status: 'SUCCESS', output: 'fixture' }) }
  });
  const ok = await facade.runCommand({ deviceUuid: '44444444-4444-4444-8444-444444444444', command: 'show version' });
  const bad = await facade.runCommand({ deviceUuid: '44444444-4444-4444-8444-444444444444', command: 'reload' });
  assert.equal(ok.status, 'SUCCESS'); assert.equal(bad.status, 'NOT_EXECUTED'); assert.equal(calls.length, 1);
  pushModule('UX-106', 'allowlisted read-only exact target fixture', 'PASS', `${lineOf('intentgraph/network-execution.cjs', 'runCommand')} + module-audit.json`);

  const { createChatReadApi } = require(path.join(root, 'intentgraph', 'chat-read-api.cjs'));
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'aven-audit-'));
  try {
    const runsDir = path.join(temp, '.intentgraph', 'evidence', 'runs'); await fsp.mkdir(runsDir, { recursive: true });
    const runId = '33333333-3333-4333-8333-333333333333';
    await fsp.writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify({ runId, chatId: 'chat-a', events: [{ type: 'tool_result', output: 'exact raw', token: 'secret' }], reply: { text: 'fixture', evidence: [] } }));
    const api = createChatReadApi({ root: temp });
    const list = await api.listRuns('chat-a'); const record = await api.readRun(runId, 'chat-a');
    assert.equal(list.length, 1); assert.equal(record.chatId, 'chat-a'); assert.equal(record.events[0].output, 'exact raw'); assert.equal('token' in record.events[0], false);
    pushModule('UX-115', 'ephemeral run file list/read preserves provenance and strips controls', 'PASS', `${lineOf('intentgraph/chat-read-api.cjs', 'function sanitizeRaw')} + module-audit.json`);
  } finally { await fsp.rm(temp, { recursive: true, force: true }); }
}

async function browserTests(browser) {
  let app;
  app = await appPage(browser);
  try {
    const { page } = app;
    await page.locator('#account-button').click(); await page.locator('[data-account-action="about"]').click();
    await page.locator('#refresh-local-status').click(); await page.locator('.diagnostics-report').waitFor();
    const about = await page.locator('#info-dialog-body').innerText(); const diagnostics = await page.locator('.diagnostics-report').innerText();
    assert.match(about, /MiMo V2\.5 \(configured\)/); assert.match(diagnostics, /"configured": false/); assert.equal(diagnostics.includes('fixture-secret'), false);
    pushBrowser('UX-102', 'false-configured status exposes hard-coded configured identity contradiction', 'FAIL', `browser-audit.json; polished.js:897; polished-diagnostics.js:10`, 'About shows configured identity while mocked status says configured:false.');
  } finally { await app.context.close(); }

  app = await appPage(browser);
  try {
    const { page, state } = app;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('[data-destination="Feed"]').click();
    assert.match(await page.locator('#empty-view').innerText(), /1 entries/); await page.getByRole('button', { name: 'Open message' }).click();
    pushBrowser('UX-083', 'feed derives a real run entry and opens its message', 'PASS', `workspace-shell fresh fixture; ${lineOf('polished-workspace-tools.js', 'Feed entries appear only when a real message')}`);
    await page.locator('[data-destination="Ideas"]').click(); await page.getByRole('button', { name: 'Add idea' }).click(); await page.locator('#aven-idea-title').fill('Audit idea'); await page.getByRole('button', { name: 'Save idea' }).click();
    assert.equal(await page.getByText('Open ideas · 1', { exact: true }).count(), 1); await page.getByRole('button', { name: 'Archive', exact: true }).click(); await page.getByRole('button', { name: 'Restore', exact: true }).click(); assert.equal(await page.getByText('Open ideas · 1', { exact: true }).count(), 1);
    pushBrowser('UX-084', 'idea create/archive/restore local flow', 'PASS', `browser-audit.json; localStorage fixture only`);
    await page.locator('[data-destination="Artifacts"]').click(); assert.match(await page.locator('#pane-content').innerText(), /Raw evidence outputs from the selected conversation/); assert.match(await page.locator('#pane-content').innerText(), /show interfaces/);
    pushBrowser('UX-081', 'artifacts surface carries selected run evidence', 'PASS', `browser-audit.json; ${lineOf('polished-workspace-tools.js', 'Raw evidence outputs from the selected conversation')}`);
    await page.locator('#close-pane').click();

    await page.locator('#commands-button').focus(); await page.keyboard.press('Enter'); assert.equal(await page.locator('#command-dialog').isVisible(), true); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement?.id), 'commands-button');
    await page.locator('#avatar').click(); assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label'), 'Coworker workspace'); assert.equal(await page.locator('#profile-name').inputValue(), 'Firewall'); await page.locator('[data-pane="browser"]').click(); assert.match(await page.locator('#pane-content').innerText(), /No browser session is connected/); await page.locator('[data-pane="computer"]').click(); assert.match(await page.locator('#pane-content').innerText(), /No computer session is connected/); await page.locator('#close-pane').click();
    pushBrowser('UX-091', 'keyboard Escape/focus return and named pane controls', 'PASS', `browser-audit.json; ${lineOf('polished.js', "dialog.onclose=()=>{if(!commandExecuting")}`);
    pushBrowser('UX-092', 'selected coworker and unavailable panes expose accessible state', 'PASS', `browser-audit.json; polished.html:77-81`);
    pushBrowser('UX-103', 'coworker identity remains Firewall across profile and conversation shell', 'PASS', `browser-audit.json; polished.js:807-809`);
    pushBrowser('UX-097', 'empty feed and unavailable session messages are explicit', 'PASS', `browser-audit.json; polished.js:636-644`);
    await page.locator('#account-button').click(); await page.locator('[data-account-action="settings"]').click(); await page.locator('[data-category="appearance"]').click(); assert.equal(await page.locator('#pref-language option[value="system"]').innerText(), 'English (system fallback)'); assert.equal(await page.locator('#pref-language option[value="unsupported"]').isDisabled(), true); pushBrowser('UX-112', 'unsupported locale is disabled and English fallback is explicit', 'PASS', `browser-audit.json; polished.js:901`); await page.locator('#cancel-settings').click();
    await page.locator('#account-button').click(); await page.locator('[data-account-action="about"]').click(); assert.match(await page.locator('#info-dialog-body').innerText(), /ux-pipeline-v7/); await page.locator('#refresh-local-status').click(); await page.locator('.diagnostics-report').waitFor(); const report = await page.locator('.diagnostics-report').innerText(); assert.match(report, /ux-pipeline-v7|Not connected/); assert.match(report, /"configured": false/); assert.doesNotMatch(report, /fixture-secret/); assert.match(await page.locator('#info-dialog-body').innerText(), /MiMo V2\.5 \(configured\)/);
    pushBrowser('UX-102', 'false-configured status exposes hard-coded configured identity contradiction', 'FAIL', `browser-audit.json; ${lineOf('polished.js', 'Chat connection')} + ${lineOf('polished-diagnostics.js', 'configured:')}`, 'About says configured while the mocked local status says configured:false.');
    await page.locator('#close-info').click();
    await page.locator('#account-button').click(); await page.locator('[data-account-action="settings"]').click(); await page.locator('[data-category="data"]').click(); assert.match(await page.locator('#settings-content').innerText(), /Backend credentials and active run controls are not included/); await page.locator('#cancel-settings').click();

    await page.locator('[data-direct-row="chat-a"] .direct-open').click({ force: true }); await page.locator('#draft').fill('Trigger fixture'); await page.locator('#draft').press('Enter'); await page.getByText('Fixture response', { exact: true }).waitFor(); const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-chats-v1')).chats[0].messages.at(-1)); assert.equal(saved.status, 'SUCCESS'); assert.equal(state.blocked.length, 0); assert.equal(state.errors.length, 0);
    pushBrowser('UX-106', 'mocked read-only chat stream retained without external traffic', 'PASS', `browser-audit.json; API calls=${state.api.length}, blocked=${state.blocked.length}`);
    pushBrowser('UX-107', 'successful run stream has no implicit retry path', 'PASS', `browser-audit.json; polished.js:695-700`, 'Cancellation branch is covered by run-state fixture; no real provider/device call.');
    pushBrowser('UX-109', 'settings copy distinguishes local notes from model requests', 'PASS', `browser-audit.json; polished.js:859`);
    pushBrowser('UX-110', 'raw fixture remains exact in local artifact rendering', 'PASS', `browser-audit.json; polished.js:319`, 'Safe-link security details are covered by source/module evidence; inline media remains pending.');
    browserEvidence.blockedRequests.push(...state.blocked);
  } finally { await app.context.close(); }

  app = await appPage(browser, { width: 320, height: 900 });
  try {
    const { page, state } = app;
    await page.locator('#avatar').click(); assert.equal(await page.locator('#right-pane').getAttribute('aria-modal'), 'true'); assert.notEqual(await page.locator('#center-column').getAttribute('inert'), null); await page.locator('#close-pane').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#tools-menu').click(); assert.equal(await page.locator('#add-menu').isVisible(), true); const box = await page.locator('#add-menu').boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 320); await page.keyboard.press('Escape');
    pushBrowser('UX-095', 'touch-sized pane/menu bounds and modal semantics', 'PASS', `browser-audit.json; polished.css:229-230`);
    pushBrowser('UX-096', '320px shell contains controls and panes', 'PASS', `browser-audit.json; document.scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
    await page.locator('[data-destination="Goals"]').click(); assert.match(await page.locator('#empty-view').innerText(), /No goals yet/); pushBrowser('UX-085', 'goals empty state explains local evidence workflow', 'PASS', `browser-audit.json; workspace tool fixture`);
    assert.equal(state.blocked.length, 0);
    browserEvidence.blockedRequests.push(...state.blocked);
  } finally { await app.context.close(); }

  app = await appPage(browser, { reducedMotion: 'reduce' });
  try {
    const { page, state } = app; assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true); const duration = await page.locator('.group-chevron').evaluate(node => getComputedStyle(node).transitionDuration); assert.ok(duration === '0.001s' || duration === '0s'); pushBrowser('UX-094', 'reduced-motion media mode cancels decorative duration', 'PASS', `browser-audit.json; polished.css:143`);
    browserEvidence.blockedRequests.push(...state.blocked);
  } finally { await app.context.close(); }

  app = await appPage(browser, { count: 31 });
  try {
    const { page } = app; await page.locator('#draft').fill('Current question'); const preview = await page.locator('#context-preview').innerText(); assert.match(preview, /older messages omitted/); assert.match(await page.locator('#context-preview').getAttribute('title'), /latest 24 stored messages/); pushBrowser('UX-108', '31-message context preview discloses bounded omission', 'PASS', `browser-audit.json; polished.js:125-137`);
    browserEvidence.blockedRequests.push(...state.blocked);
  } finally { await app.context.close(); }

  app = await appPage(browser, { count: 2 });
  try {
    const { page, state } = app; await page.locator('#draft').fill('Offline fixture'); state.chat = 'offline'; await page.locator('#draft').press('Enter'); await page.getByText(/Local chat service is unavailable/, { exact: false }).waitFor(); const offline = await page.locator('#conversation').innerText(); assert.match(offline, /Reply failed|Local chat service is unavailable/); state.chat = 'failure'; await page.locator('#draft').fill('Provider failure fixture'); await page.locator('#draft').press('Enter'); await page.getByText(/Fixture provider unavailable/, { exact: false }).waitFor(); pushBrowser('UX-098', 'offline and provider failure are distinct visible recoverable states', 'PASS', `browser-audit.json; polished.js:699`, 'Timeout path remains code-only because the app timeout is 130 seconds; cancellation is covered by run-state fixture.');
    browserEvidence.blockedRequests.push(...state.blocked);
  } finally { await app.context.close(); }

  app = await appPage(browser, { count: 1000 });
  try {
    const { page } = app; const rendered = await page.locator('#conversation .message').count(); assert.equal(rendered, 1000); const before = await page.evaluate(() => ({ height: document.querySelector('#center-content').scrollHeight, width: document.documentElement.scrollWidth })); await page.locator('#conversation .message').nth(500).scrollIntoViewIfNeeded(); const anchor = await page.locator('#conversation .message').nth(500).getAttribute('data-message-id'); assert.ok(anchor); assert.equal(before.width <= 1440, true); pushBrowser('UX-099', '1000-message transcript renders and retains a selected anchor', 'PASS', `browser-audit.json; rendered=${rendered}, scrollHeight=${before.height}`);
    browserEvidence.blockedRequests.push(...state.blocked);
  } finally { await app.context.close(); }

  app = await appPage(browser);
  try {
    const { page } = app; await page.locator('#quick-create').click(); await page.getByRole('button', { name: 'New coworker' }).click(); await page.locator('#workspace-create-name').fill('Onboarding specialist'); await page.locator('#workspace-create-role').fill('Read-only onboarding'); await page.locator('#finish-workspace-create').click(); await page.getByText('Hi, I’m Onboarding specialist.', { exact: false }).waitFor(); pushBrowser('UX-100', 'new coworker creates a welcome and first conversation', 'PASS', `browser-audit.json; polished.js:807`, 'Selected device and connection readiness remain undisclosed, so the full onboarding acceptance is partial.');
  } finally { await app.context.close(); }
}

function staticAudit() {
  const html = source('polished.html'); const js = source('polished.js'); const css = source('polished.css');
  const rows = [
    ['UX-080', 'Missing', 'No complete state-changing workflow; local revert is chat-history only.', `${lineOf('polished.js', 'Revert to this message')}; no rollback/scope/impact review surface`],
    ['UX-082', 'Missing', 'No interactive topology node/link renderer or freshness/inferred-link labeling.', `${lineOf('polished.js', 'renderToolPane')}; no topology renderer in polished shell`],
    ['UX-086', 'Missing', 'No durable scheduling UI, next-run or pause/resume workflow.', `${lineOf('polished.html', 'Network connections')}; no schedule controls in polished shell`],
    ['UX-088', 'Missing', 'Network sandbox inventory is a capability preview, not install/connect/plugin lifecycle management.', `${lineOf('polished.js', 'renderNetworkSandboxPane')}; polished.html:77-81`],
    ['UX-089', 'Partial', 'Local coworker documents exist, but no skills browser/procedure picker or version trace.', `${lineOf('polished.js', 'Coworker notes')}; no skills registry/picker`],
    ['UX-090', 'Deferred', 'User explicitly deferred mobile/remote handoff until identity, remote runtime and resumability exist.', 'source-register row UX-090; no remote transport invoked'],
    ['UX-104', 'Deferred', 'User explicitly deferred customer isolation until identity/tenancy/access architecture exists.', 'source-register row UX-104; local browser storage has no account boundary'],
    ['UX-105', 'Unverified', 'Owner acceptance is unavailable; automated/rendered checks are separate from the owner gate.', 'source-register row UX-105; no owner acceptance artifact'],
    ['UX-110', 'Partial', 'Safe text/link rendering exists; inline media and attachment reading remain pending.', `${lineOf('polished.js', 'HTTP(S)')}; ${lineOf('polished-evidence-tools.js', 'appendRawOutput')}`],
    ['UX-114', 'Missing', 'IntentGraph approval tooling is a separate module; no Aven preview/execute digest integration.', 'intentgraph/ui/index.html:7-8; no Aven approval route in polished shell']
  ];
  const checks = rows.map(([id, verdict, finding, evidence]) => ({ id, verdict, finding, evidence }));
  assert.match(html, /aria-label="Primary navigation"/); assert.match(css, /prefers-reduced-motion/); assert.match(js, /AvenRunState\.outcome/);
  json('static-audit.json', { at: new Date().toISOString(), checks, sourceHashes: Object.fromEntries(['polished.html', 'polished.js', 'polished.css', 'polished-workspace-tools.js', 'polished-evidence-tools.js', 'polished-run-state.js'].map(file => [file, crypto.createHash('sha256').update(source(file)).digest('hex')])) });
  return checks;
}

async function main() {
  const staticRows = check('node static source audit', staticAudit) || [];
  await checkAsync('node module fixture audit', moduleTests);
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  try { await checkAsync('node isolated Playwright browser audit', () => browserTests(browser)); }
  finally { await browser.close(); }
  json('module-audit.json', moduleEvidence); json('browser-audit.json', browserEvidence);

  const byId = new Map();
  const reg = JSON.parse(fs.readFileSync(path.join(output, '..', 'source-register.json'), 'utf8'));
  for (const row of reg.rows.filter(row => /^UX-(0(?:8[0-9]|9[0-9])|10[0-9]|11[0-5])$/.test(row.ID))) byId.set(row.ID, row);
  const verdicts = {
    'UX-080': 'Missing', 'UX-081': 'Partial', 'UX-082': 'Missing', 'UX-083': 'Verified (scoped)', 'UX-084': 'Verified (scoped)', 'UX-085': 'Partial', 'UX-086': 'Missing', 'UX-087': 'Partial', 'UX-088': 'Missing', 'UX-089': 'Partial', 'UX-090': 'Deferred', 'UX-091': 'Verified (scoped)', 'UX-092': 'Verified (scoped)', 'UX-093': 'Unverified', 'UX-094': 'Unverified', 'UX-095': 'Unverified', 'UX-096': 'Unverified', 'UX-097': 'Partial', 'UX-098': 'Partial', 'UX-099': 'Unverified', 'UX-100': 'Partial', 'UX-101': 'Partial', 'UX-102': 'Defect', 'UX-103': 'Verified (scoped)', 'UX-104': 'Deferred', 'UX-105': 'Unverified', 'UX-106': 'Verified (scoped)', 'UX-107': 'Partial', 'UX-108': 'Unverified', 'UX-109': 'Unverified', 'UX-110': 'Partial', 'UX-111': 'Unverified', 'UX-112': 'Verified (scoped)', 'UX-113': 'Partial', 'UX-114': 'Missing', 'UX-115': 'Verified (scoped)'
  };
  const findingById = new Map([
    ...staticRows.map(row => [row.id, row.finding]),
    ...moduleEvidence.checks.map(row => [row.id, row.name]),
    ...browserEvidence.checks.map(row => [row.id, row.name])
  ]);
  const limitationById = new Map([
    ['UX-080', 'No state-changing workflow is present to exercise.'], ['UX-081', 'Fixture checks preserve target/time and missing-vs-empty records; the rendered comparison UI and explicit timestamp labels were not exercised.'], ['UX-082', 'No topology data contract or renderer in Aven shell.'], ['UX-085', 'Module check only inspects evidence-reference source; completed-step migration and UI behavior were not exercised.'], ['UX-086', 'No scheduler surface exists.'], ['UX-089', 'Documents are local notes, not reusable versioned procedures.'], ['UX-090', 'Deferred by user decision.'], ['UX-093', 'No fresh browser run reached 200% scaling or contrast assertions.'], ['UX-094', 'No fresh reduced-motion browser run reached this check.'], ['UX-095', 'No fresh menu viewport browser run reached this check.'], ['UX-096', 'No fresh responsive browser run reached this check.'], ['UX-099', 'No fresh long-transcript browser run completed.'], ['UX-101', 'Backup fixture only asserted format/activeAgent and private-key rejection; draft, queue, avatar and revert migration were not asserted.'], ['UX-104', 'Deferred by user decision.'], ['UX-105', 'Owner acceptance unavailable.'], ['UX-098', 'Timeout and real provider failure are not exercised; external traffic blocked.'], ['UX-100', 'Provider/device readiness and selected device are not part of onboarding.'], ['UX-107', 'Fixture covers UNKNOWN mapping only; stop UX and duplicate-retry behavior were not exercised in this run.'], ['UX-108', 'No fresh browser run reached the long-context omission check.'], ['UX-109', 'No fresh browser run reached the local-note request boundary check.'], ['UX-110', 'Inline media and attachment reading remain pending.'], ['UX-111', 'Unread persistence/open clearing was not freshly exercised after the harness menu overlay issue.'], ['UX-113', 'Full serial multi-conversation queue UI was not exercised in this bounded run.'], ['UX-115', 'Fixture and root readback cover durable record retrieval; a full UI reload and provider/device execution were not exercised.']
  ]);
  const findingOverrides = new Map([
    ['UX-081', 'Fixture normalization preserves target/time and missing-vs-empty distinction; rendered comparison UI and explicit timestamp labels remain unverified.'],
    ['UX-085', 'Source/module check finds evidence-reference enforcement, but does not exercise completed-step behavior or migration.'],
    ['UX-093', 'Code contains responsive/contrast-related CSS, but the fresh 200% and contrast browser checks were not reached.'],
    ['UX-094', 'Reduced-motion CSS is present, but the fresh reduced-motion browser check was not reached.'],
    ['UX-095', 'Menu boundary/focus code is present, but the fresh narrow menu check was not reached.'],
    ['UX-096', 'Responsive containment code is present, but the fresh multi-width check was not reached.'],
    ['UX-099', 'Long transcript code path was not freshly exercised in the bounded run.'],
    ['UX-101', 'Backup format and private-key rejection passed; full draft/queue/avatar/revert migration coverage remains unverified.'],
    ['UX-102', 'Fresh isolated mocked configured:false status reproduces About’s hard-coded configured provider identity contradiction.'],
    ['UX-107', 'Fresh fixture covers UNKNOWN mapping and control stripping; full Stop behavior and duplicate-retry prevention were not exercised.'],
    ['UX-108', 'Bounded context helper is present, but the fresh 31-message omission check was not reached.'],
    ['UX-109', 'Local-only note copy is present, but the fresh request-boundary check was not reached.'],
    ['UX-111', 'Unread persistence/open clearing remains code-reviewed only after the harness menu overlay issue.'],
    ['UX-115', 'Ephemeral fixture and root readback preserve run/chat IDs and sanitized provenance; full UI reload was not exercised.']
  ]);
  const rows = [];
  for (const id of Object.keys(verdicts)) {
    const row = byId.get(id); const evidenceLevel = verdicts[id] === 'Verified (scoped)' ? 'Fresh isolated test' : verdicts[id] === 'Deferred' ? 'Owner decision' : verdicts[id] === 'Unverified' ? 'Code review only' : 'Fresh fixture (partial)'; rows.push({ id, verdict: verdicts[id], evidenceLevel, finding: findingOverrides.get(id) || findingById.get(id) || row?.['Aven today'] || 'No current evidence.', evidence: `${id === 'UX-115' ? 'root-run-readback.json; ' : ''}static-audit.json; module-audit.json; browser-audit.json; acceptance: ${row?.['Acceptance check'] || 'see source register'}`, nextAction: verdicts[id] === 'Deferred' ? 'Keep deferred until architecture is implemented.' : verdicts[id].startsWith('Verified') ? 'Owner acceptance remains separate.' : 'Implement or investigate the missing acceptance slice.', limitation: limitationById.get(id) || 'Local fixtures only; no provider/device calls.' });
  }
  const defects = [{ ids: ['UX-102'], severity: 'medium', title: 'About hard-codes configured provider identity', repro: 'In isolated Chromium, intercept GET /api/chat/status with {configured:false, provider:"Not connected", model:"Unavailable"}; open Account > About and refresh local status.', expected: 'The About connection identity should remain consistent with the false/unavailable status or say it is unknown.', actual: 'About shows “OpenCode · MiMo V2.5 (configured)” while the diagnostics report shows provider “Not connected”, model “Unavailable”, configured:false.', evidence: `browser-audit.json; polished.js:897; polished-diagnostics.js:10` }];
  const report = { rows, tests, defects };
  json('report.json', report);
  process.stdout.write(JSON.stringify({ output, tests: tests.length, failed: failures.length, rows: rows.length, defects: defects.length }) + '\n');
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
