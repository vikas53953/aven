'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(path.resolve(__dirname, '..', '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));

const ROOT = process.env.UI_GAP_ROOT || path.resolve(__dirname, '..', 'ui-release', 'candidate');
const OUT = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHAT_KEY = 'aven-polished-chats-v1';
const checks = [];
const state = { blocked: [], apiCalls: [], pageErrors: [], hold: false, release: null };

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname); } catch { response.writeHead(400).end(); return; }
    if (pathname === '/') pathname = '/polished.html';
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
}
const msg = (id, role, text, extra) => Object.assign({ id, role, text, createdAt: '2026-09-16T04:00:00.000Z' }, extra || {});
function seed(options) {
  const o = options || {};
  const evA = { id: 'ev-a', command: 'show interfaces', target: 'sw-a', source: 'fixture', status: 'SUCCESS', output: '\n  exact  output\n' };
  const evB = { id: 'ev-b', command: 'show version', target: 'sw-b', source: 'fixture', status: 'SUCCESS', output: 'version-output' };
  const chats = [
    { id: 'chat-a', title: 'Firewall work', projectId: null, channelId: null, recipients: ['a'], draft: '', pendingAttachmentNames: [], messages: [
      msg('m-a0', 'user', 'Question before the run'),
      msg('m-a1', 'assistant', 'Firewall result with raw output', { runId: 'run-a', status: 'SUCCESS', evidence: [evA], createdAt: '2026-09-16T04:01:00.000Z' }),
      msg('m-a2', 'assistant', 'Follow-up result', o.feed ? { runId: 'run-a2', events: [{ type: 'tool-result', status: 'SUCCESS', command: 'show route' }], createdAt: '2026-09-16T04:02:00.000Z' } : {})
    ], pendingQueue: [] },
    { id: 'chat-b', title: 'Router work', projectId: null, channelId: null, recipients: ['b'], draft: '', pendingAttachmentNames: [], messages: [
      msg('m-b0', 'assistant', 'Router result with a second artifact', o.feed ? { runId: 'run-b', evidence: [evB], createdAt: '2026-09-16T04:03:00.000Z' } : {})
    ], pendingQueue: [] }
  ];
  if (o.archived) chats.push({ id: 'chat-arch', title: 'Archived audit', projectId: null, channelId: null, recipients: ['a'], archived: true, draft: 'archived draft', pendingAttachmentNames: [], messages: [
    msg('m-arch-u', 'user', 'Archived question'),
    msg('m-arch-a', 'assistant', 'Archived evidence', { runId: 'arch-run', evidence: [evA], createdAt: '2026-09-16T04:04:00.000Z' })
  ], pendingQueue: [] });
  return {
    prefs: { theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Fixture',
      activeAgent: 'a', provider: 'Not connected', model: '', browser: false, computer: false,
      showEvidence: true, showInvestigation: true, showRunDetails: true, sections: [],
      agents: [
        { id: 'a', name: 'Firewall', role: 'Network security', description: 'Network security', notifications: true, timezone: 'Follow system', autoReview: false, unread: false, hidden: false, archived: false, pinned: false, avatar: { style: 'firewall', color: '#45c9b0' } },
        { id: 'b', name: 'Router', role: 'Routing', description: 'Routing', notifications: true, timezone: 'Follow system', autoReview: false, unread: false, hidden: false, archived: false, pinned: false, avatar: { style: 'router', color: '#80b7ff' } }
      ] },
    data: { activeChat: 'chat-a', projects: [], channels: [], chats: chats, workspaceTools: { ideas: [], goals: [] } }
  };
}
async function openApp(browser, base, fixture, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => state.pageErrors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Not connected', model: 'Unavailable', configured: false }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/runs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat' && request.method() === 'POST') {
      state.apiCalls.push(request.url());
      if (state.hold) await new Promise(resolve => { state.release = resolve; });
      const body = [{ type: 'start', runId: 'fixture-run' }, { type: 'final', reply: { text: 'Fixture response', status: 'SUCCESS', runId: 'fixture-run', source: 'fixture' } }, { type: 'end' }].map(item => JSON.stringify(item)).join('\n') + '\n';
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
    }
    state.blocked.push(request.url()); return route.abort();
  });
  await page.goto(base + '/polished.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function (value) {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(value.prefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(value.data));
    localStorage.removeItem('aven-feedback-v1');
  }, fixture);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(100);
  return { context: context, page: page };
}
async function run(id, name, fn, limitation) {
  try { await fn(); checks.push({ id: id, name: name, status: 'PASS', evidence: 'PASS', limitation: limitation || '' }); }
  catch (error) { checks.push({ id: id, name: name, status: 'FAIL', evidence: error.name + ': ' + error.message, limitation: limitation || '' }); }
}
async function openAccount(page) { await page.locator('#account-button').click(); await page.locator('#account-menu').waitFor(); }
async function closeInfo(page) { if (await page.locator('#info-dialog').isVisible()) await page.locator('#info-ok').click(); }
async function widthMatrix(browser, base) {
  for (const width of [1440, 1280, 1024, 900, 768, 540, 390, 320]) {
    const app = await openApp(browser, base, seed(), { width: width, height: 900 });
    try {
      const check = await app.page.evaluate(function () {
        const rect = function (n) { const r = n && n.getBoundingClientRect(); return r ? { left: r.left, right: r.right, width: r.width } : null; };
        return { inner: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth, shell: rect(document.querySelector('.app-shell')), rail: rect(document.querySelector('#rail')) };
      });
      assert.ok(check.html <= width && check.body <= width, 'overflow at ' + width + ': ' + JSON.stringify(check));
      assert.ok(check.shell.right <= width + 1 && check.rail.right <= width + 1, 'bounds at ' + width + ': ' + JSON.stringify(check));
      await app.page.locator('#toggle').click();
      const expanded = await app.page.evaluate(function () { return { html: document.documentElement.scrollWidth, body: document.body.scrollWidth, rail: document.querySelector('#rail').getBoundingClientRect().right }; });
      assert.ok(expanded.html <= width && expanded.body <= width, 'expanded overflow at ' + width + ': ' + JSON.stringify(expanded));
      if (width > 760) assert.ok(expanded.rail <= width + 1, 'expanded rail exceeds at ' + width);
    } finally { await app.context.close(); }
  }
}
async function main() {
  const server = serve(ROOT); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    await run('UX-002', 'desktop and narrow viewport matrix contains page/sidebar overflow', function () { return widthMatrix(browser, base); }, 'Eight widths from 1440 to 320; exact CLI copy remains covered by prior evidence.');
    let app = await openApp(browser, base, seed());
    let p = app.page;
    try {
      await run('UX-005', 'reaction row opens by keyboard and Escape returns to message actions', async function () {
        const actions = p.locator('[data-message-id="m-a1"] [aria-label="Message actions"]');
        await actions.click({ force: true }); const choices = p.locator('.message-emoji-row button');
        assert.ok(await choices.count() >= 3); await choices.first().focus(); await p.keyboard.press('ArrowRight');
        assert.equal(await choices.nth(1).evaluate(function (node) { return node === document.activeElement; }), true);
        await p.keyboard.press('Escape'); assert.equal(await actions.evaluate(function (node) { return node === document.activeElement; }), true);
      }, 'Local DOM/keyboard check; no visual reference or assistive technology certification.');
      await run('UX-046', 'active run disables history revert control', async function () {
        state.hold = true; await p.locator('#draft').fill('active request'); await p.locator('#draft').press('Enter'); await p.waitForTimeout(60);
        assert.ok(state.release, 'held fixture request did not start');
        await p.locator('[data-message-id="m-a1"] [aria-label="Message actions"]').click({ force: true });
        const revert = p.getByRole('menuitem', { name: 'Revert to this message', exact: true });
        assert.equal(await revert.isDisabled(), true);
        await p.keyboard.press('Escape'); if (state.release) state.release(); state.release = null; state.hold = false; await p.waitForTimeout(90);
      }, 'Held loopback request; no provider/device call.');
      await run('UX-050', 'archived restore preserves complete message and evidence payload', async function () {
        await app.context.close(); app = await openApp(browser, base, seed({ archived: true })); p = app.page;
        const before = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).chats.find(function (c) { return c.id === 'chat-arch'; }); }, CHAT_KEY);
        await openAccount(p); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="archived"]').click();
        await p.getByRole('button', { name: 'Restore Archived audit', exact: true }).click();
        const after = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).chats.find(function (c) { return c.id === 'chat-arch'; }); }, CHAT_KEY);
        assert.equal(after.archived, false); assert.deepEqual(after.messages, before.messages); assert.equal(after.draft, before.draft);
        assert.deepEqual(after.pendingAttachmentNames, before.pendingAttachmentNames); await p.locator('#cancel-settings').click();
      }, 'Local archive/restore transaction; no packaged/cross-device behavior.');
      await run('UX-051', 'conversation export has selected scope timestamps raw output and no credentials', async function () {
        await openAccount(p); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="data"]').click();
        const dl = await (async function () { const pending = p.waitForEvent('download'); await p.locator('#export-markdown').click(); return pending; })();
        const stream = await dl.createReadStream(); let text = ''; for await (const chunk of stream) text += chunk.toString('utf8');
        assert.match(text, /# Firewall work/); assert.match(text, /m-a1/); assert.match(text, /2026-09-16T04:01:00\.000Z/); assert.match(text, /show interfaces/); assert.match(text, /exact  output/);
        assert.doesNotMatch(text, /api[_-]?key|authorization|bearer|secret/i); assert.doesNotMatch(text, /# Router work|Router result/);
      }, 'Markdown export scoped to selected chat; loopback fixture only.');
      await run('UX-055', 'long coworker name persists after reload and remains selected-only', async function () {
        await p.locator('#cancel-settings').click(); await p.locator('#avatar').click();
        const value = 'Firewall specialist with a deliberately long network role';
        await p.locator('#profile-name').fill(value); await p.locator('#profile-name').blur();
        assert.equal(await p.locator('#surface').innerText(), value); assert.equal(await p.locator('[data-direct-row="chat-b"] .direct-name').innerText(), 'Router');
        await p.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await p.locator('#surface').innerText(), value); assert.equal(await p.locator('[data-direct-row="chat-b"] .direct-name').innerText(), 'Router');
      }, 'One local long profile fixture; no remote sync.');
      await run('UX-059', 'theme save persists across reload in light and dark modes', async function () {
        await openAccount(p); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="appearance"]').click();
        await p.locator('#pref-theme').selectOption('light'); await p.locator('#save-settings').click(); await p.waitForTimeout(150);
        assert.equal(await p.locator('html').getAttribute('data-theme'), 'light'); await p.reload({ waitUntil: 'domcontentloaded' });
        assert.equal(await p.locator('html').getAttribute('data-theme'), 'light');
        await openAccount(p); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="appearance"]').click();
        await p.locator('#pref-theme').selectOption('dark'); await p.locator('#save-settings').click(); await p.waitForTimeout(150);
        assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark'); await p.reload({ waitUntil: 'domcontentloaded' });
        assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark');
      }, 'Local preferences/reload; readability remains a separate visual check.');
      await run('UX-064', 'all help entries are useful and feedback storage failure is visible', async function () {
        await openAccount(p); await p.locator('[data-account-action="help"]').click();
        const help = await p.locator('#info-dialog-body').innerText(); assert.match(help, /Ctrl \/ Cmd \+ K/); assert.match(help, /Escape/); assert.match(help, /stay in this browser/);
        await closeInfo(p); await p.locator('#commands-button').click(); await p.locator('#command-query').fill('shortcuts'); await p.locator('[data-command="shortcuts"]').click();
        assert.match(await p.locator('#info-dialog-body').innerText(), /Commands open local controls/); await closeInfo(p);
        await openAccount(p); await p.locator('[data-account-action="feedback"]').click(); await p.locator('#feedback-text').fill('private fixture feedback');
        await p.evaluate(function () {
          window.__gapOriginalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) { if (key === 'aven-feedback-v1') throw new Error('quota'); return window.__gapOriginalSetItem.call(this, key, value); };
        });
        const apiBefore = state.apiCalls.length; await p.locator('#save-feedback').click(); assert.match(await p.locator('#feedback-status').innerText(), /Could not save to local storage/);
        assert.equal(await p.evaluate(function () { return localStorage.getItem('aven-feedback-v1'); }), null);
        await p.evaluate(function () { Storage.prototype.setItem = window.__gapOriginalSetItem; delete window.__gapOriginalSetItem; });
        assert.equal(state.apiCalls.length, apiBefore); await closeInfo(p);
      }, 'Feedback quota failure injected; no external/private-log request.');
      await run('UX-065', 'unavailable Find is omitted from help and Ctrl/Cmd+F opens find only in conversation', async function () {
        await p.locator('[data-destination="Feed"]').click(); await p.waitForTimeout(30); await p.locator('#commands-button').click(); await p.locator('#command-query').fill('find');
        assert.equal(await p.locator('[data-command="find"]').isDisabled(), true); await p.keyboard.press('Escape');
        await openAccount(p); await p.locator('[data-account-action="help"]').click(); assert.doesNotMatch(await p.locator('#info-dialog-body').innerText(), /Ctrl \/ Cmd \+ F/); await closeInfo(p);
        await p.locator('[data-direct-row="chat-a"] .direct-open').click(); await p.keyboard.press('Control+f');
        await p.locator('#conversation-find').waitFor(); assert.equal(await p.locator('#conversation-find-input').evaluate(function (node) { return node === document.activeElement; }), true); await p.keyboard.press('Escape');
      }, 'Browser-local shortcut check; native browser find is not used when unavailable.');
      await run('UX-069', 'evidence pane is readable across resize endpoints and close restores focus', async function () {
        const opener = p.locator('[data-message-id="m-a1"] [aria-label="Message actions"]'); await opener.click({ force: true }); await p.getByRole('menuitem', { name: 'Compare diagnostic runs', exact: true }).click();
        const resize = p.locator('#pane-resize'); const min = Number(await resize.getAttribute('aria-valuemin')); const max = Number(await resize.getAttribute('aria-valuemax')); for (const key of ['Home', 'ArrowRight', 'End']) { await resize.focus(); await p.keyboard.press(key); const value = Number(await resize.getAttribute('aria-valuenow')); assert.ok(value >= min && value <= max); }
        assert.match(await p.locator('#pane-content').innerText(), /Evidence|show interfaces|No comparable/i); await p.locator('#close-pane').click(); assert.equal(await opener.evaluate(function (node) { return node === document.activeElement; }), true);
      }, 'Endpoint keyboard resize and local evidence content.');
      await run('UX-073', 'annotation draft closes without saving and cannot drift', async function () {
        await p.locator('[data-message-id="m-a1"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Annotate evidence', exact: true }).click(); await p.locator('.aven-evidence-note').fill('draft annotation');
        p.once('dialog', function (dialog) { return dialog.accept(); }); await p.locator('#close-pane').click(); assert.equal(await p.locator('.aven-evidence-note').count(), 0);
        const notes = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).chats.find(function (c) { return c.id === 'chat-a'; }).messages.find(function (m) { return m.id === 'm-a1'; }).annotations || []; }, CHAT_KEY);
        assert.equal(notes.length, 0);
      }, 'Discard path only; stale rerun/save-failure need separate runtime hook.');
      await run('UX-083', 'every populated Feed entry opens its exact saved message', async function () {
        await app.context.close(); app = await openApp(browser, base, seed({ feed: true })); p = app.page;
        await p.locator('[data-destination="Feed"]').click(); await p.waitForTimeout(40);
        const cards = p.locator('.aven-workspace-tools-feed-item'); assert.equal(await cards.count(), 3);
        const keys = await cards.locator('button[data-aven-focus-key]').evaluateAll(function (buttons) { return buttons.map(function (b) { return b.dataset.avenFocusKey; }); });
        assert.deepEqual(keys, ['feed-open-chat-b-m-b0', 'feed-open-chat-a-m-a2', 'feed-open-chat-a-m-a1']);
        for (const item of [['feed-open-chat-b-m-b0', 'm-b0'], ['feed-open-chat-a-m-a2', 'm-a2'], ['feed-open-chat-a-m-a1', 'm-a1']]) {
          const button = p.locator('button[data-aven-focus-key="' + item[0] + '"]'); await button.click();
          assert.equal(await p.locator('[data-message-id="' + item[1] + '"]').evaluate(function (node) { return node === document.activeElement; }), true);
          await p.locator('[data-destination="Feed"]').click(); await p.waitForTimeout(20);
        }
      }, 'Populated local run/evidence entries; provider/device transport is not exercised.');
    } finally { await app.context.close(); }
  } finally {
    if (state.release) state.release(); await browser.close(); await new Promise(resolve => server.close(resolve));
  }
  const sourceHashes = {};
  for (const file of ['polished.html', 'polished.css', 'polished.js', 'polished-workspace-tools.js', 'polished-backup.js']) sourceHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
  const rows = {}; for (const check of checks) { if (!rows[check.id]) rows[check.id] = { id: check.id, status: 'PASS', evidence: [], limitations: [] }; rows[check.id].evidence.push(check.name + ': ' + check.evidence); rows[check.id].limitations.push(check.limitation); if (check.status === 'FAIL') rows[check.id].status = 'PARTIAL'; }
  const output = { generatedAt: new Date().toISOString(), build: 'ux-minimal-ui-v9.1', root: ROOT, sourceHashes: sourceHashes, checks: checks, rows: Object.values(rows), blockedRequests: state.blocked, apiCalls: state.apiCalls, pageErrors: state.pageErrors, scope: 'Isolated Chromium with local fixture storage and loopback API interception; no external calls or user data.' };
  fs.writeFileSync(path.join(OUT, 'gap-evidence.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(OUT, 'row-results.json'), JSON.stringify({ generatedAt: output.generatedAt, candidate: ROOT, rows: output.rows }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, passed: checks.filter(function (c) { return c.status === 'PASS'; }).length, failed: checks.filter(function (c) { return c.status === 'FAIL'; }).length, rows: output.rows.length, blockedRequests: state.blocked.length, apiCalls: state.apiCalls.length, pageErrors: state.pageErrors.length }));
  if (checks.some(function (c) { return c.status === 'FAIL'; })) process.exitCode = 1;
}
main().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });

