'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(path.resolve(__dirname, '..', '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));
const ROOT = process.env.UI_GAP_ROOT || path.resolve(__dirname, '..', 'ui-release', 'candidate');
const LABEL = process.env.UI_GAP_LABEL || 'run';
const OUT = __dirname;
const CHAT_KEY = 'aven-polished-chats-v1';
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
function fixture() {
  return {
    prefs: { theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Fixture', activeAgent: 'a', provider: 'Not connected', model: '', browser: false, computer: false, showEvidence: true, showInvestigation: true, showRunDetails: true, sections: [], agents: [
      { id: 'a', name: 'Firewall', role: 'Network security', description: 'Network security', notifications: true, timezone: 'Follow system', autoReview: false, hidden: false, archived: false, pinned: false, avatar: { style: 'firewall', color: '#45c9b0' } },
      { id: 'b', name: 'Router', role: 'Routing', description: 'Routing', notifications: true, timezone: 'Follow system', autoReview: false, hidden: false, archived: false, pinned: false, avatar: { style: 'router', color: '#80b7ff' } }
    ] },
    data: { activeChat: 'chat-a', projects: [], channels: [], chats: [
      { id: 'chat-a', title: 'Firewall work', projectId: null, channelId: null, recipients: ['a'], draft: '', pendingAttachmentNames: [], messages: [
        msg('m-a0', 'user', 'Question'), msg('m-a1', 'assistant', 'Firewall result', { runId: 'run-a', status: 'SUCCESS', evidence: [{ id: 'ev-a', command: 'show interfaces', target: 'sw-a', status: 'SUCCESS', output: 'raw output' }] })
      ], pendingQueue: [] },
      { id: 'chat-b', title: 'Router work', projectId: null, channelId: null, recipients: ['b'], draft: '', pendingAttachmentNames: [], messages: [msg('m-b0', 'assistant', 'Router result')], pendingQueue: [] }
    ], workspaceTools: { ideas: [], goals: [] } }
  };
}
async function open(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Not connected', model: 'Unavailable', configured: false }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/runs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
    return route.abort();
  });
  await page.goto(base + '/polished.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function (value) { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(value.prefs)); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(value.data)); }, fixture());
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(80);
  return { context, page };
}
async function main() {
  const server = serve(ROOT); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port; const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    let app = await open(browser, base); let p = app.page;
    try {
      await p.locator('[data-destination="Feed"]').click(); await p.locator('#commands-button').click(); await p.locator('#command-query').fill('find');
      const find = p.locator('[data-command="find"]'); const disabled = await find.isDisabled(); await p.keyboard.press('Escape');
      await p.locator('#account-button').click(); await p.locator('[data-account-action="help"]').click(); const help = await p.locator('#info-dialog-body').innerText();
      const advertisedOnFeed = /Ctrl \/ Cmd \+ F/.test(help); await p.locator('#info-ok').click();
      await p.locator('[data-direct-row="chat-a"] .direct-open').click(); await p.keyboard.press('Control+f'); const opensFind = await p.locator('#conversation-find').isVisible();
      results.push({ id: 'UX-065', status: disabled && !advertisedOnFeed && opensFind ? 'PASS' : 'FAIL', disabled, advertisedOnFeed, opensFind });
    } finally { await app.context.close(); }
    app = await open(browser, base); p = app.page;
    try {
      const opener = p.locator('[data-message-id="m-a1"] [aria-label="Message actions"]'); await opener.click({ force: true }); await p.getByRole('menuitem', { name: 'Compare diagnostic runs', exact: true }).click(); await p.locator('#pane-content').waitFor();
      await p.locator('#close-pane').click(); const focusReturned = await opener.evaluate(function (node) { return node === document.activeElement; });
      results.push({ id: 'UX-069', status: focusReturned ? 'PASS' : 'FAIL', focusReturned });
    } finally { await app.context.close(); }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const sourceHashes = {}; for (const file of ['polished.js', 'polished.html', 'polished.css']) sourceHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
  const out = { generatedAt: new Date().toISOString(), label: LABEL, root: ROOT, sourceHashes, results, scope: 'Fresh isolated Chromium context per target; local fixture storage and loopback status only.' };
  fs.writeFileSync(path.join(OUT, 'targeted-' + LABEL + '.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
  if (results.some(function (item) { return item.status === 'FAIL'; }) && LABEL === 'candidate') process.exitCode = 1;
}
main().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });
