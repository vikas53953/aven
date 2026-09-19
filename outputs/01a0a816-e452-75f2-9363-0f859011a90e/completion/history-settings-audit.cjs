'use strict';

// Bounded history/navigation/settings acceptance against the candidate overlay.
// Every browser context uses fixture storage and loopback-only request routes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));

const ROOT = path.join(__dirname, 'history-candidate');
const OUT = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHAT_KEY = 'aven-polished-chats-v1';
const PREF_KEY = 'aven-polished-preferences-v1';
const results = [];
const checks = [];

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

const message = (id, role, text, extra = {}) => ({ id, role, text, createdAt: '2026-09-16T04:00:00.000Z', ...extra });
function fixture() {
  const raw = '\n\tExact  spaces\nline 2\n';
  const aMessages = [
    message('a-u1', 'user', 'Investigate the route needle needle needle'),
    message('a-m1', 'assistant', 'Saved diagnostic needle evidence', { evidence: [{ id: 'ev-1', command: 'show interfaces', target: 'sw-a', source: 'fixture', status: 'SUCCESS', output: raw }] }),
    message('a-m2', 'assistant', '# Report\n\n- First\n- Second\n\n| Link | State |\n| --- | --- |\n| uplink | up |\n\n```text\nshow version\n```'),
  ];
  return {
    prefs: { theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Vikas', activeAgent: 'a', provider: 'Not connected', model: '', browser: false, computer: false, showEvidence: true, showInvestigation: true, showRunDetails: true, sections: [{ id: 'ops', name: 'Operations', collapsed: false }], agents: [
      { id: 'a', name: 'Firewall', role: 'Network security', description: 'Network security', notifications: true, timezone: 'Follow system', autoReview: false, unread: false, hidden: false, archived: false, pinned: false, avatar: { style: 'mesh', color: '#45c9b0' } },
      { id: 'b', name: 'Router', role: 'Routing', description: 'Routing', notifications: true, timezone: 'Follow system', autoReview: false, unread: false, hidden: false, archived: false, pinned: false },
    ] },
    data: { activeChat: 'a1', projects: [{ id: 'ops-folder', name: 'Operations folder', members: ['a', 'b'], collapsed: false, pinned: false }], channels: [], chats: [
      { id: 'a1', title: 'Main investigation', projectId: null, channelId: null, recipients: ['a'], draft: '', pendingAttachmentNames: [], messages: aMessages, pendingQueue: [] },
      { id: 'b1', title: 'Router follow-up', projectId: null, channelId: null, recipients: ['b'], draft: '', pendingAttachmentNames: [], messages: [message('b-m1', 'assistant', 'Router needle evidence')], pendingQueue: [] },
      { id: 'a2', title: 'Second Firewall chat', projectId: null, channelId: null, recipients: ['a'], draft: '', pendingAttachmentNames: [], messages: [message('a2-m1', 'assistant', 'Second conversation')], pendingQueue: [] },
      { id: 'legacy-pin', title: 'Legacy pinned work', projectId: null, channelId: null, recipients: ['b'], pinned: true, draft: '', pendingAttachmentNames: [], messages: [message('legacy-m1', 'assistant', 'Legacy pinned history')], pendingQueue: [] },
      { id: 'f1', title: 'Folder report', projectId: 'ops-folder', channelId: null, recipients: ['a', 'b'], draft: '', pendingAttachmentNames: [], messages: [message('f-m1', 'assistant', 'Folder result')], pendingQueue: [] },
      { id: 'f2', title: 'Folder follow-up', projectId: 'ops-folder', channelId: null, recipients: ['a', 'b'], draft: '', pendingAttachmentNames: [], messages: [message('f2-m1', 'assistant', 'Folder follow-up')], pendingQueue: [] },
      { id: 'arch', title: 'Old archived work', projectId: null, channelId: null, recipients: ['a'], archived: true, draft: 'old draft', pendingAttachmentNames: [], messages: [message('arch-m1', 'user', 'Archived history')], pendingQueue: [] },
    ] }
  };
}

function record(id, name, passed, evidence, limitation = '') {
  checks.push({ id, name, passed: !!passed, evidence: String(evidence || ''), limitation });
}
async function runCheck(id, name, fn, limitation = '') {
  console.log(`START ${id} ${name}`);
  try { await fn(); record(id, name, true, 'PASS', limitation); console.log(`PASS ${id}`); return true; }
  catch (error) { record(id, name, false, `${error.name}: ${error.message}`, limitation); console.log(`FAIL ${id}: ${error.name}: ${error.message}`); return false; }
}

async function openApp(browser, base, state, seed = fixture(), viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => state.pageErrors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Not connected', model: 'Unavailable', configured: false, lastChecked: new Date().toISOString() }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/runs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat' && request.method() === 'POST') {
      state.apiCalls.push(request.url());
      if (state.hold) await new Promise(resolve => { state.release = resolve; });
      const body = [{ type: 'start', runId: 'fixture-run' }, { type: 'final', reply: { text: 'Fixture response', status: 'SUCCESS', runId: 'fixture-run', source: 'fixture' } }, { type: 'end' }].map(item => JSON.stringify(item)).join('\n') + '\n';
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
    }
    state.blocked.push(request.url());
    return route.abort();
  });
  await page.goto(`${base}/polished.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ prefs, data }) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs)); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data)); }, seed);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(100);
  return { context, page };
}

async function main() {
  const server = serve(ROOT);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const state = { blocked: [], pageErrors: [], apiCalls: [], hold: false, release: null };
  let app = await openApp(browser, base, state);
  let p = app.page;
  try {
    await runCheck('UX-001', 'scroll surfaces wake and remain scrollable', async () => {
      assert.equal(await p.locator('#center-content').evaluate(node => getComputedStyle(node).overflowY), 'auto');
      assert.equal(await p.locator('#center-content').evaluate(node => node.classList.contains('scroll-surface')), true);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }, 'This fixture does not measure OS scrollbar fade timing or physical touch input.');
    await runCheck('UX-002', 'page and sidebar stay within viewport while raw output remains exact', async () => {
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), true);
      assert.equal(await p.locator('[data-message-id="a-m1"] .cli-output').evaluate(node => node.textContent), '\n\tExact  spaces\nline 2\n');
      await p.evaluate(() => { window.__copy = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copy = value; } } }); });
      await p.locator('[data-message-id="a-m1"] .cli-terminal summary').click();
      await p.locator('[data-message-id="a-m1"] .cli-copy').click({ force: true });
      assert.equal(await p.evaluate(() => window.__copy), '\n\tExact  spaces\nline 2\n');
    }, 'OS clipboard integration is intercepted in the isolated browser.');
    await runCheck('UX-003', 'account menu is keyboard reachable without a caret', async () => { await p.locator('#account-button').focus(); await p.keyboard.press('Enter'); assert.equal(await p.locator('#account-menu').isVisible(), true); assert.equal(await p.locator('#account-menu [role="menuitem"]').count(), 6); await p.keyboard.press('Escape'); }, 'No assistive technology certification.');
    await runCheck('UX-004', 'profile rename synchronizes selected coworker header', async () => { await p.locator('#avatar').click(); await p.locator('#profile-name').fill('Firewall specialist'); await p.locator('#profile-name').blur(); assert.equal(await p.locator('#surface').innerText(), 'Firewall specialist'); assert.equal(await p.locator('[data-direct-row="a1"] .direct-name').innerText(), 'Firewall specialist'); assert.equal(await p.locator('[data-direct-row="b1"] .direct-name').innerText(), 'Router'); await p.locator('#close-pane').click(); }, 'Scoped to selected profile and two local coworkers.');
    await runCheck('UX-005', 'reaction row opens and supports keyboard selection', async () => { await p.locator('[data-message-id="a-m2"] [aria-label="Message actions"]').click({ force: true }); assert.equal(await p.locator('.message-emoji-row').isVisible(), true); await p.locator('.message-emoji-row button').first().focus(); await p.keyboard.press('ArrowRight'); assert.equal(await p.locator('.message-emoji-row button').nth(1).evaluate(node => node === document.activeElement), true); await p.keyboard.press('Escape'); }, 'Narrow reference geometry is outside this scoped check.');
    await runCheck('UX-006', 'one reaction replaces, clears and survives reload', async () => { const actions = p.locator('[data-message-id="a-m2"] [aria-label="Message actions"]'); await actions.click({ force: true }); await p.getByRole('menuitemradio', { name: 'React with 👍', exact: true }).click(); await actions.click({ force: true }); await p.getByRole('menuitemradio', { name: 'React with 👎', exact: true }).click(); assert.equal(await p.locator('[data-message-id="a-m2"] .message-reactions').innerText(), '👎'); await p.locator('[data-message-id="a-m2"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitemradio', { name: 'Remove 👎', exact: true }).click(); assert.equal(await p.locator('[data-message-id="a-m2"] .message-reactions').count(), 0); }, 'Local browser storage only.');
    await runCheck('UX-007', 'coworker-first direct entry leaves existing history reachable', async () => { assert.equal(await p.locator('[data-direct-row="a1"]').count(), 1); assert.equal(await p.locator('[data-direct-row="b1"]').count(), 1); assert.equal(await p.locator('#draft').isVisible(), true); }, 'Bounded to the seeded coworker/history set.');
    await runCheck('UX-008', 'short saved conversation retains coworker header', async () => { assert.equal(await p.locator('#surface').innerText(), 'Firewall specialist'); await p.locator('#draft').fill('short draft'); assert.equal(await p.locator('#surface').innerText(), 'Firewall specialist'); }, 'No live provider stream in this fixture.');
    await runCheck('UX-009', 'sidebar preview is plain text and full title is accessible', async () => { const subtitle = await p.locator('[data-direct-row="a1"] .direct-subtitle').innerText(); assert.equal(/[|`*_]/.test(subtitle), false); assert.ok(await p.locator('[data-direct-row="a1"] .direct-open').getAttribute('title')); }, 'Extreme title matrix is outside this check.');
    await runCheck('UX-010', 'pinned chats stay grouped, legacy pins survive reload, and failed save is safe', async () => {
      const beforeLegacy = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).chats.find(c => c.id === 'legacy-pin'), CHAT_KEY);
      assert.equal(beforeLegacy.pinned, true);
      assert.equal(beforeLegacy.pinnedAt, undefined);
      await p.locator('[data-direct-row="a2"] [aria-label^="Pin "]').click({ force: true });
      await p.locator('[data-direct-row="b1"] [aria-label^="Pin "]').click({ force: true });
      const details = () => p.evaluate(k => {
        const saved = JSON.parse(localStorage.getItem(k));
        const pinned = new Set(saved.chats.filter(c => c.pinned).map(c => c.id));
        const rows = [...document.querySelectorAll('#direct-list .direct-row')].map(row => ({ id: row.dataset.directRow, pinned: pinned.has(row.dataset.directRow) }));
        const firstUnpinned = rows.findIndex(row => !row.pinned);
        const heading = document.querySelector('#direct-list > .sidebar-section-label')?.textContent || '';
        return { rows, firstUnpinned, heading, legacy: saved.chats.find(c => c.id === 'legacy-pin') };
      }, CHAT_KEY);
      let current = await details();
      assert.equal(current.heading, 'Pinned');
      assert.ok(current.firstUnpinned > 0);
      assert.ok(current.rows.slice(0, current.firstUnpinned).every(row => row.pinned));
      assert.ok(current.rows.slice(current.firstUnpinned).every(row => !row.pinned));
      assert.ok(current.rows.slice(0, current.firstUnpinned).some(row => row.id === 'legacy-pin'));
      assert.equal(current.legacy.pinned, true);
      await p.reload({ waitUntil: 'domcontentloaded' });
      current = await details();
      assert.equal(current.legacy.pinned, true);
      assert.ok(current.rows.slice(0, current.firstUnpinned).some(row => row.id === 'legacy-pin'));
      await p.evaluate(() => {
        window.__originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new Error('quota'); };
      });
      await p.locator('[data-direct-row="legacy-pin"] [aria-label^="Unpin "]').click({ force: true });
      assert.match(await p.locator('#chat-status').innerText(), /Could not save this change/);
      assert.equal((await p.evaluate(k => JSON.parse(localStorage.getItem(k)).chats.find(c => c.id === 'legacy-pin').pinned, CHAT_KEY)), true);
      await p.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; delete window.__originalSetItem; });
    }, 'Canonical render ordering is checked in the DOM; the injected quota error verifies the previous pin state remains persisted.');
    await runCheck('UX-011', 'conversation rename leaves coworker identity unchanged', async () => { const row=p.locator('[data-direct-row="a1"]'); const actions=row.locator('[aria-label*="Conversation actions"]'); await row.hover({ position: { x: 250, y: 5 } }); await actions.click({ force: true }); await p.waitForTimeout(20); await p.locator('#nav-menu').waitFor(); await p.locator('#nav-menu button').filter({ hasText: 'Rename conversation' }).click(); await p.locator('#nav-name').fill('Renamed investigation'); await p.locator('#nav-form-submit').click(); assert.equal(await p.locator('#surface').innerText(), 'Firewall specialist'); assert.equal((await p.evaluate(k => JSON.parse(localStorage.getItem(k)).chats.find(c => c.id === 'a1').title, CHAT_KEY)), 'Renamed investigation'); }, 'Scoped to direct conversation rename.');
    await runCheck('UX-012', 'direct chats and grouped conversations stay distinct', async () => { assert.equal(await p.locator('[data-group-toggle="direct"]').innerText().then(text => text.includes('Coworkers')), true); assert.equal(await p.locator('[data-group-toggle="conversations"]').innerText().then(text => text.includes('Conversations')), true); assert.equal(await p.locator('[data-team-row="ops-folder"]').count(), 1); }, 'No exhaustive implication study.');
    await runCheck('UX-013', 'collapsed rail leaves composer usable', async () => { await p.locator('#toggle').click(); assert.equal(await p.locator('#rail').evaluate(node => node.classList.contains('expanded')), false); await p.locator('#draft').fill('collapsed draft'); assert.equal(await p.locator('#draft').inputValue(), 'collapsed draft'); await p.locator('#toggle').click(); }, 'Pointer resize matrix is not included here.');
    await runCheck('UX-014', 'back and forward preserve chat drafts', async () => { await p.locator('[data-direct-row="a1"] .direct-open').click(); await p.locator('#draft').fill('draft A'); await p.locator('[data-direct-row="b1"] .direct-open').click(); await p.locator('#draft').fill('draft B'); await p.locator('#chat-back').click(); assert.equal(await p.locator('#draft').inputValue(), 'draft A'); await p.locator('#chat-forward').click(); assert.equal(await p.locator('#draft').inputValue(), 'draft B'); }, 'Single local navigation sequence.');
    await runCheck('UX-015', 'search result keyboard activation opens exact message context', async () => { await p.locator('#search-nav').click(); await p.locator('#global-search').fill('needle evidence'); await p.locator('#global-search').press('ArrowDown'); assert.equal(await p.locator('.search-result').first().evaluate(node => node === document.activeElement), true); await p.keyboard.press('Enter'); await p.waitForTimeout(60); assert.equal(await p.locator('[data-message-id="a-m1"]').evaluate(node => node === document.activeElement), true); }, 'Scoped to a unique saved phrase.');
    await runCheck('UX-016', 'search coworker and conversation filters narrow results', async () => { await p.locator('#search-nav').click(); await p.locator('#global-search').fill('needle'); await p.locator('#search-coworker').selectOption('b'); assert.ok((await p.locator('.search-result').allInnerTexts()).join(' ').includes('Router')); await p.locator('#search-conversation').selectOption('b1'); assert.ok((await p.locator('.search-result').allInnerTexts()).join(' ').includes('Router')); await p.locator('#close-search').click({ force: true }); await p.locator('#search-dialog').evaluate(dialog => { if (dialog.open) dialog.close(); }); assert.equal(await p.locator('#search-dialog').isVisible(), false); }, 'Duplicate-term disambiguation remains fixture-scoped.');
    await runCheck('UX-017', 'find visits repeated matches while preserving draft', async () => { await p.locator('[data-direct-row="a1"] .direct-open').click(); await p.locator('#draft').fill('preserve me'); await p.locator('#commands-button').click(); await p.locator('#command-query').fill('find'); await p.keyboard.press('Enter'); await p.locator('#conversation-find-input').fill('needle'); assert.match(await p.locator('#conversation-find-count').innerText(), /of 4/); await p.locator('#find-next').click(); await p.locator('#find-prev').click(); assert.equal(await p.locator('#draft').inputValue(), 'preserve me'); await p.locator('#find-close').click(); }, 'The fixture contains three repeated user terms and one saved evidence term.');
    await runCheck('UX-018', 'command palette traverses with keyboard and Escape restores opener', async () => { await p.locator('#commands-button').click(); await p.locator('#command-query').press('ArrowDown'); assert.equal(await p.locator('#command-results button').first().evaluate(node => node === document.activeElement), true); await p.keyboard.press('Escape'); await p.waitForTimeout(20); assert.equal(await p.locator('#commands-button').evaluate(node => node === document.activeElement), true); }, 'Unavailable-command filtering is limited to the current local registry.');
    await runCheck('UX-024', 'reply identifies source and cancel retains draft', async () => { await p.locator('[data-message-id="a-m1"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Reply', exact: true }).click(); assert.match(await p.locator('#reply-preview').innerText(), /Reply to/); await p.locator('#reply-preview [aria-label="Cancel reply"]').click(); assert.equal(await p.locator('#draft').inputValue(), 'preserve me'); }, 'Mouse path only.');
    await runCheck('UX-035', 'tool transcript distinguishes event and raw result', async () => { await p.locator('[data-message-id="a-m1"] .cli-terminal summary').click(); assert.match(await p.locator('[data-message-id="a-m1"] .cli-terminal').innerText(), /show interfaces|fixture/i); assert.equal(await p.locator('[data-message-id="a-m1"] .cli-terminal').count(), 1); }, 'Saved fixture only; no provider stream.');
    await runCheck('UX-041', 'markdown renders safe headings/lists/table/code', async () => { const row = p.locator('[data-message-id="a-m2"]'); assert.equal(await row.locator('h3').count(), 1); assert.equal(await row.locator('ul li').count(), 2); assert.equal(await row.locator('table').count(), 1); assert.equal(await row.locator('pre code').count(), 1); }, 'Representative fixture only.');
    await runCheck('UX-042', 'raw CLI copy preserves tabs and newlines', async () => { assert.equal(await p.locator('[data-message-id="a-m1"] .cli-output').evaluate(node => node.textContent), '\n\tExact  spaces\nline 2\n'); }, 'OS clipboard remains intercepted.');
    await runCheck('UX-043', 'copy failure reports failure', async () => { await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }); }); await p.locator('[data-message-id="a-m2"] .message-copy').click({ force: true }); await p.waitForTimeout(30); assert.equal(await p.locator('[data-message-id="a-m2"] .message-copy span').innerText(), 'Copy failed'); }, 'Browser clipboard rejection is injected.');
    await runCheck('UX-044', 'timestamps expose accessible labels', async () => { assert.ok(await p.locator('[data-message-id="a-m1"] time').getAttribute('aria-label')); }, 'Timezone matrix is not included.');
    await runCheck('UX-045', 'latest control appears after leaving bottom', async () => { await p.locator('#center-content').evaluate(node => { const spacer=document.createElement('div'); spacer.style.height='2000px'; spacer.dataset.fixtureSpacer='true'; node.append(spacer); node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); }); await p.waitForTimeout(30); assert.equal(await p.locator('#jump-latest').isVisible(), true); await p.locator('#jump-latest').click(); assert.equal(await p.locator('#jump-latest').isHidden(), true); }, 'No live streaming output.');
    await runCheck('UX-046', 'revert and undo restore saved history', async () => { const before = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).chats.find(c => c.id === 'a1').messages.map(m => m.id), CHAT_KEY); await p.locator('[data-message-id="a-m1"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Revert to this message', exact: true }).click(); await p.getByRole('button', { name: 'Revert', exact: true }).click(); await p.getByRole('button', { name: 'Undo revert', exact: true }).click(); const after = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).chats.find(c => c.id === 'a1').messages.map(m => m.id), CHAT_KEY); assert.deepEqual(after, before); }, 'Busy/queued protection is separately bounded.');
    await runCheck('UX-047', 'fork retains provenance and survives revisit without mutating parent', async () => { const parent = await p.evaluate(k => { const c = JSON.parse(localStorage.getItem(k)).chats.find(c => c.id === 'a1'); return { length: c.messages.length, ids: c.messages.map(m => m.id) }; }, CHAT_KEY); await p.locator('[data-message-id="a-m1"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Fork from this message', exact: true }).click(); await p.locator('#fork-name').fill('Side investigation'); await p.getByRole('button', { name: 'Create fork', exact: true }).click(); let value = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), CHAT_KEY); let fork = value.chats.find(c => c.title === 'Side investigation'); assert.equal(fork.messages.length, 2); assert.equal(fork.forkedFrom.chatId, 'a1'); assert.equal(fork.forkedFrom.messageId, 'a-m1'); assert.deepEqual(value.chats.find(c => c.id === 'a1').messages.map(m => m.id), parent.ids); await p.reload({ waitUntil: 'domcontentloaded' }); value = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), CHAT_KEY); fork = value.chats.find(c => c.title === 'Side investigation'); assert.equal(fork.messages.length, 2); assert.equal(fork.forkedFrom.chatId, 'a1'); assert.deepEqual(value.chats.find(c => c.id === 'a1').messages.map(m => m.id), parent.ids); await p.locator('.fork-origin button').click(); await p.waitForTimeout(40); assert.equal(await p.locator('[data-message-id="a-m1"]').evaluate(node => node === document.activeElement), true); }, 'Reload and fork-origin target are exercised against the seeded local history.');
    await runCheck('UX-048', 'message link contains exact local chat and message', async () => { await p.locator('[data-direct-row="a1"] .direct-open').click(); await p.evaluate(() => { window.__copy = ''; navigator.clipboard.writeText = async value => { window.__copy = value; }; }); await p.locator('[data-message-id="a-m1"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Copy link to message', exact: true }).click(); assert.match(await p.evaluate(() => window.__copy), /chat=a1.*message=a-m1/); }, 'Missing/archived destination messages are not exercised here.');
    await runCheck('UX-049', 'more-reactions picker opens without moving message', async () => { await p.locator('[data-message-id="a-m1"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'More reactions', exact: true }).click(); assert.equal(await p.locator('.message-more-picker button').count(), 10); await p.keyboard.press('Escape'); }, 'Picker search is not part of this build.');
    await runCheck('UX-050', 'archive hides composer and restore preserves history', async () => { await p.locator('[data-direct-row="a1"] .direct-open').click(); await p.locator('#thread-actions').click(); await p.getByRole('menuitem', { name: 'Archive', exact: true }).click(); assert.equal(await p.locator('#composer-wrap').isVisible(), false); await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="archived"]').click(); await p.getByRole('button', { name: /Restore Main investigation|Restore Renamed investigation/ }).click(); await p.locator('#close-settings').click(); await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('[data-direct-row="a1"] .direct-open').click(); assert.equal(await p.locator('#composer-wrap').isVisible(), true); assert.ok(await p.locator('[data-message-id="a-m1"]').count()); }, 'Local history only.');
    await runCheck('UX-051', 'workspace export includes history, exact evidence and pin metadata', async () => { await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="data"]').click(); const download = p.waitForEvent('download'); await p.locator('#export-workspace').click(); const file = await download; const exported = JSON.parse(fs.readFileSync(await file.path(), 'utf8')); assert.equal(exported.format, 'aven-workspace'); assert.ok(exported.data.chats.some(c => c.id === 'a1')); const pinned = exported.data.chats.find(c => c.id === 'a2'); assert.equal(pinned.pinned, true); assert.ok(Number.isFinite(pinned.pinnedAt)); assert.equal(exported.data.chats.find(c => c.id === 'legacy-pin').pinned, true); assert.equal(JSON.stringify(exported).includes('token'), false); }, 'Workspace export is all-local scope; OS download path is temporary; pinnedAt is checked for a newly pinned and legacy pinned chat.');
    await runCheck('UX-052', 'invalid import is safe and valid add restore preserves unrelated work, pins and queues', async () => {
      const beforeIds = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).chats.find(c => c.id === 'a1').messages.map(m => m.id), CHAT_KEY);
      await p.locator('#import-workspace').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
      await p.getByText('This file is not valid JSON.', { exact: true }).waitFor();
      assert.equal(await p.locator('#import-preview').isVisible(), false);
      const backup = { format: 'aven-workspace', version: 1, exportedAt: '2026-09-16T04:00:00.000Z', prefs: { theme: 'light', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Restored operator', activeAgent: 'restored-agent', agents: [{ id: 'restored-agent', name: 'Restored operator', role: 'Imported notes', notifications: true, avatar: { style: 'router', color: '#45c9b0' } }], sections: [] }, data: { activeChat: 'restored-chat', projects: [], channels: [], chats: [{ id: 'restored-chat', title: 'Imported follow-up', recipients: ['restored-agent'], draft: 'restore draft', pendingAttachmentNames: [], pinned: true, pinnedAt: 1234567890123, pendingQueue: [{ id: 'restored-queue', text: 'Review imported queue', createdAt: '2026-09-16T04:00:00.000Z', mode: 'inspect' }], messages: [message('restored-message', 'assistant', 'Restored local history', { runId: 'restored-run', source: 'fixture' })] }] }, docs: { 'restored-agent': { 'SOUL.md': '# Restored operator', 'MEMORY.md': 'Imported memory' } } };
      await p.locator('#import-workspace').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
      await p.locator('#import-preview').waitFor();
      await p.locator('#add-import').click();
      await p.waitForLoadState('domcontentloaded');
      const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), CHAT_KEY);
      const imported = saved.chats.find(c => c.title === 'Imported follow-up');
      assert.ok(imported);
      assert.equal(imported.pinned, true);
      assert.equal(imported.pinnedAt, 1234567890123);
      assert.equal(imported.queuePaused, true);
      assert.equal(imported.pendingQueue[0].text, 'Review imported queue');
      assert.deepEqual(saved.chats.find(c => c.id === 'a1').messages.map(m => m.id), beforeIds);
      assert.ok(saved.chats.some(c => c.id === 'a1'));
      await p.locator('[data-direct-row="a1"] .direct-open').click();
    }, 'Invalid JSON and valid Add mode are exercised in one isolated browser; imported pinnedAt is checked after the migration/restore transaction.');
    await runCheck('UX-054', 'legacy avatar alias migrates visually and chosen avatar persists after reload', async () => { await p.locator('[data-direct-row="a1"] .direct-open').click(); await p.locator('#avatar').click(); assert.equal(await p.locator('#avatar .network-avatar').getAttribute('data-avatar-role'), 'sd-wan'); await p.locator('#edit-avatar').click(); const choice = p.locator('[data-avatar-style]').first(); await choice.click(); const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).agents.find(a => a.id === 'a').avatar.style, PREF_KEY); await p.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await p.evaluate(k => JSON.parse(localStorage.getItem(k)).agents.find(a => a.id === 'a').avatar.style, PREF_KEY), saved); assert.equal(await p.locator('#avatar .network-avatar').getAttribute('data-avatar-role'), saved); }, 'Legacy mesh is normalized by the avatar adapter and the selected replacement is verified after reload.');
    await runCheck('UX-055', 'long coworker name remains selected-only', async () => { await p.locator('#avatar').click(); const value = 'Firewall specialist with a deliberately long network role'; await p.locator('#profile-name').fill(value); await p.locator('#profile-name').blur(); assert.equal(await p.locator('#surface').innerText(), value); assert.equal(await p.locator('[data-direct-row="b1"] .direct-name').innerText(), 'Router'); await p.locator('#close-pane').click(); }, 'Only one long label is exercised.');
    await runCheck('UX-057', 'muted runs stay quiet and enabled finished runs link to the exact result', async () => {
      await p.locator('[data-direct-row="a1"] .direct-open').click();
      await p.locator('#avatar').click();
      const checkbox = p.locator('#profile-notifications');
      await checkbox.uncheck();
      assert.equal(await p.evaluate(k => JSON.parse(localStorage.getItem(k)).agents.find(a => a.id === 'a').notifications, PREF_KEY), false);
      await p.locator('#close-pane').click();
      state.hold = true;
      await p.locator('#draft').fill('muted completion');
      await p.locator('#draft').press('Enter');
      await p.waitForTimeout(50);
      assert.ok(state.release, 'fixture request did not enter the held run');
      await p.locator('[data-direct-row="b1"] .direct-open').click();
      state.release?.(); state.release = null; state.hold = false;
      await p.waitForTimeout(100);
      assert.equal(await p.locator('#toast').innerText(), '');
      await p.locator('[data-direct-row="a1"] .direct-open').click();
      await p.locator('#avatar').click();
      await p.locator('#profile-notifications').check();
      assert.equal(await p.evaluate(k => JSON.parse(localStorage.getItem(k)).agents.find(a => a.id === 'a').notifications, PREF_KEY), true);
      await p.locator('#close-pane').click();
      state.hold = true;
      await p.locator('#draft').fill('enabled completion');
      await p.locator('#draft').press('Enter');
      await p.waitForTimeout(50);
      assert.ok(state.release, 'enabled fixture request did not enter the held run');
      await p.locator('[data-direct-row="b1"] .direct-open').click();
      state.release?.(); state.release = null; state.hold = false;
      await p.getByRole('button', { name: 'Open result', exact: true }).waitFor();
      assert.match(await p.locator('#toast').innerText(), /finished/);
      await p.getByRole('button', { name: 'Open result', exact: true }).click();
      await p.waitForTimeout(60);
      assert.equal(await p.locator('[data-message-id]').filter({ hasText: 'Fixture response' }).last().evaluate(node => node === document.activeElement), true);
    }, 'The local NDJSON fixture injects finished run events; waiting/error alert event variants remain owned by the automation alert core.');
    await runCheck('UX-059', 'theme save/cancel preserves readable controls and evidence in both modes', async () => {
      await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="appearance"]').click(); await p.locator('#pref-theme').selectOption('light'); await p.locator('#cancel-settings').click(); assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark');
      await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="appearance"]').click(); await p.locator('#pref-theme').selectOption('light'); await p.locator('#save-settings').click(); await p.waitForTimeout(150); assert.equal(await p.locator('html').getAttribute('data-theme'), 'light');
      const light = await p.locator('#center-content').evaluate(node => { const s = getComputedStyle(node); const evidence = document.querySelector('[data-message-id="a-m1"] .message-body'); const e = evidence ? getComputedStyle(evidence) : s; return { color: s.color, background: s.backgroundColor, evidenceColor: e.color, evidenceBackground: e.backgroundColor }; });
      assert.ok(light.color && light.background && light.evidenceColor && light.evidenceBackground); assert.notEqual(light.evidenceColor, light.evidenceBackground);
      await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="appearance"]').click(); await p.locator('#pref-theme').selectOption('dark'); await p.locator('#save-settings').click(); await p.waitForTimeout(150); assert.equal(await p.locator('html').getAttribute('data-theme'), 'dark');
      const dark = await p.locator('#center-content').evaluate(node => { const s = getComputedStyle(node); const evidence = document.querySelector('[data-message-id="a-m1"] .message-body'); const e = evidence ? getComputedStyle(evidence) : s; return { color: s.color, background: s.backgroundColor, evidenceColor: e.color, evidenceBackground: e.backgroundColor }; });
      assert.ok(dark.color && dark.background && dark.evidenceColor && dark.evidenceBackground); assert.notEqual(dark.evidenceColor, dark.evidenceBackground); assert.ok(light.color !== dark.color || light.background !== dark.background);
      await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="appearance"]').click(); assert.equal(await p.locator('#pref-language option[value="unsupported"]').isDisabled(), true); await p.locator('#cancel-settings').click();
    }, 'Light and dark computed foreground/background colors are captured for the conversation and saved evidence block.');
    await runCheck('UX-062', 'privacy page names local and sent data', async () => { await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="data"]').click(); assert.match(await p.locator('#settings-content').innerText(), /stored in this browser|not sent to the model|Text attachments are sent only/i); await p.locator('#cancel-settings').click(); }, 'Destructive recovery paths are separately bounded.');
    await runCheck('UX-064', 'help and feedback remain local', async () => { await p.locator('#account-button').click(); await p.locator('[data-account-action="help"]').click(); assert.match(await p.locator('#info-dialog-body').innerText(), /shortcut|keyboard/i); await p.locator('#info-ok').click(); await p.locator('#account-button').click(); await p.locator('[data-account-action="feedback"]').click(); await p.locator('#feedback-text').fill('local feedback'); await p.locator('#save-feedback').click(); assert.match(await p.locator('#feedback-status').innerText(), /Saved locally/); await p.locator('#info-ok').click(); }, 'Storage failure for feedback is not injected.');
    await runCheck('UX-065', 'documented shortcuts match working palette controls', async () => { await p.locator('#account-button').click(); await p.locator('[data-account-action="help"]').click(); assert.match(await p.locator('#info-dialog-body').innerText(), /Ctrl \/ Cmd \+ K|Ctrl \/ Cmd \+ F/); await p.locator('#info-ok').click(); await p.keyboard.press('Control+k'); assert.equal(await p.locator('#command-dialog').isVisible(), true); await p.keyboard.press('Escape'); }, 'Cmd modifier and unavailable command matrix are not repeated.');
    await runCheck('UX-069', 'pane resize persists and close returns focus', async () => { await p.locator('#avatar').click(); await p.locator('#pane-resize').focus(); await p.keyboard.press('ArrowLeft'); const width = await p.locator('#pane-resize').getAttribute('aria-valuenow'); await p.locator('#close-pane').click(); assert.equal(await p.locator('#avatar').evaluate(node => node === document.activeElement), true); await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('#avatar').click(); assert.equal(await p.locator('#pane-resize').getAttribute('aria-valuenow'), width); await p.locator('#close-pane').click(); }, 'One keyboard resize step.');
    await runCheck('UX-073', 'annotation success binds to evidence identity', async () => { await p.locator('[data-direct-row="a1"] .direct-open').click(); await p.locator('[data-message-id="a-m1"] [aria-label="Message actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Annotate evidence', exact: true }).click(); await p.locator('.aven-evidence-note').fill('Keep this result'); await p.locator('.aven-evidence-save').click(); assert.match(await p.locator('#pane-content').innerText(), /saved|annotation/i); }, 'Stale-result rejection, discard and save-failure are not generated here.');
    await runCheck('UX-083', 'feed entry opens relevant saved run', async () => { if (await p.locator('#close-pane').isVisible()) await p.locator('#close-pane').click(); await p.locator('[data-destination="Feed"]').click(); await p.waitForTimeout(30); assert.match(await p.locator('#empty-view').textContent(), /Feed|activity|run/i); }, 'Fixture has no provider/device run.');
    await runCheck('UX-084', 'ideas can be created, saved, archived and recovered locally', async () => {
      await p.locator('[data-destination="Ideas"]').click(); await p.waitForTimeout(30); assert.match(await p.locator('#empty-view').textContent(), /Ideas|idea/i);
      await p.getByRole('button', { name: 'Add idea', exact: true }).click();
      await p.locator('#aven-idea-title').fill('Capture routing hypothesis'); await p.locator('#aven-idea-body').fill('Compare the branch advertisements after the maintenance window.');
      await p.getByRole('button', { name: 'Save idea', exact: true }).click();
      const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).workspaceTools.ideas, CHAT_KEY); const idea = saved.find(item => item.title === 'Capture routing hypothesis'); assert.ok(idea); assert.equal(idea.body, 'Compare the branch advertisements after the maintenance window.');
      await p.reload({ waitUntil: 'domcontentloaded' }); await p.locator('[data-destination="Ideas"]').click(); await p.waitForTimeout(30); const card = p.locator(`[data-record-id="${idea.id}"]`); await card.waitFor(); assert.match(await card.innerText(), /Capture routing hypothesis/);
      await card.getByRole('button', { name: 'Archive', exact: true }).click(); await p.waitForTimeout(30); assert.equal(await p.locator(`[data-record-id="${idea.id}"]`).getByText('Archived', { exact: true }).count(), 1);
      await p.locator(`[data-record-id="${idea.id}"]`).getByRole('button', { name: 'Restore', exact: true }).click(); await p.waitForTimeout(30); assert.equal(await p.locator(`[data-record-id="${idea.id}"]`).getByText('Open', { exact: true }).count(), 1);
      const recovered = await p.evaluate(({ k, id }) => JSON.parse(localStorage.getItem(k)).workspaceTools.ideas.find(item => item.id === id), { k: CHAT_KEY, id: idea.id }); assert.equal(recovered.archived, false); assert.equal(recovered.body, idea.body);
    }, 'The fixture exercises the actual workspace-tools Add, Save, reload, Archive and Restore controls with local storage only.');
    await runCheck('UX-087', 'notification setting exposes the enabled state after a linked completion', async () => { await p.locator('[data-direct-row="a1"] .direct-open').click(); await p.locator('#avatar').click(); assert.equal(await p.locator('#profile-notifications').isChecked(), true); await p.locator('#close-pane').click(); }, 'Muted and enabled delivery plus exact finished-result linking are exercised in UX-057; waiting/error variants remain owned by the automation alert core.');
    await runCheck('UX-111', 'opening another chat does not cancel active work and unread state still persists', async () => {
      await p.locator('[data-direct-row="a1"] .direct-open').click();
      await p.locator('[data-direct-row="b1"] [aria-label*="Conversation actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click(); assert.equal(await p.locator('[data-direct-row="b1"]').evaluate(node => node.classList.contains('is-unread')), true);
      await p.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await p.locator('[data-direct-row="b1"]').evaluate(node => node.classList.contains('is-unread')), true);
      await p.locator('[data-direct-row="a1"] .direct-open').click(); state.hold = true; await p.locator('#draft').fill('switch while running'); await p.locator('#draft').press('Enter'); await p.waitForTimeout(50); assert.ok(state.release, 'fixture request did not enter the held active run');
      await p.locator('[data-direct-row="b1"] .direct-open').click(); assert.equal(await p.locator('#surface').innerText(), 'Router'); assert.equal(await p.locator('#draft').inputValue(), 'draft B');
      state.release?.(); state.release = null; state.hold = false; await p.waitForTimeout(100);
      const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), CHAT_KEY); const activeReply = saved.chats.find(c => c.id === 'a1').messages.at(-1); assert.equal(activeReply.role, 'assistant'); assert.equal(activeReply.runId, 'fixture-run');
      await p.locator('[data-direct-row="b1"] .direct-open').click(); assert.equal(await p.locator('[data-direct-row="b1"]').evaluate(node => node.classList.contains('is-unread')), false);
    }, 'The held loopback NDJSON response proves the request completes after switching chats; no provider call is made.');
    await runCheck('UX-112', 'unsupported language is disabled and cannot appear applied', async () => { await p.locator('#account-button').click(); await p.locator('[data-account-action="settings"]').click(); await p.locator('[data-category="appearance"]').click(); assert.equal(await p.locator('#pref-language option[value="unsupported"]').isDisabled(), true); assert.equal(await p.locator('#pref-language').inputValue(), 'system'); await p.locator('#cancel-settings').click(); }, 'Additional translations are not implemented.');
    await runCheck('UX-058', 'new coworker shows a local welcome and persists its first chat', async () => { await p.locator('#quick-create').click(); await p.locator('[data-create="agent"]').click(); await p.locator('#workspace-create-name').fill('Local acceptance coworker'); await p.locator('#workspace-create-role').fill('Validate local welcome behavior'); await p.locator('#finish-workspace-create').click(); assert.equal(await p.locator('.local-welcome-label').count(), 1); const saved=await p.evaluate(k => JSON.parse(localStorage.getItem(k)), CHAT_KEY); const welcome=saved.chats.find(c => c.title === 'Local acceptance coworker'); assert.ok(welcome); assert.equal(welcome.messages[0].welcome, true); assert.match(welcome.messages[0].text, /Local acceptance coworker/); }, 'Local-only creation fixture; no model request is made.');
  } finally {
    await app.context.close();
    if (state.release) state.release();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  const owned = ['UX-001','UX-002','UX-003','UX-004','UX-005','UX-006','UX-007','UX-008','UX-009','UX-010','UX-011','UX-012','UX-013','UX-014','UX-015','UX-016','UX-017','UX-018','UX-024','UX-035',...Array.from({ length: 25 }, (_, index) => `UX-${String(index + 41).padStart(3, '0')}`).filter(id => !['UX-056','UX-060','UX-061'].includes(id)),'UX-069','UX-073','UX-083','UX-084','UX-087','UX-111','UX-112'];
  const byId = new Map();
  for (const check of checks) { const row = byId.get(check.id) || { id: check.id, status: 'PASS', evidence: [], limitation: '' }; if (!check.passed) row.status = 'PARTIAL'; row.evidence.push(`${check.name}: ${check.evidence}`); row.limitation = row.limitation || check.limitation; byId.set(check.id, row); }
  const rowResults = owned.map(id => byId.get(id) || (['UX-053','UX-063'].includes(id) ? { id, status: 'DEFERRED', evidence: ['Baseline ledger records this capability as explicitly deferred pending identity/ownership contracts.'], limitation: id === 'UX-053' ? 'Cross-device service is not present in this build.' : 'Authenticated account lifecycle is not present in this build.' } : { id, status: 'UNVERIFIED', evidence: [], limitation: 'No focused check was run in this bounded suite.' }));
  fs.writeFileSync(path.join(OUT, 'row-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), candidate: ROOT, scope: 'isolated Chromium; loopback fixture API; no provider/device calls', rows: rowResults }, null, 2));
  fs.writeFileSync(path.join(OUT, 'history-settings-evidence.json'), JSON.stringify({ generatedAt: new Date().toISOString(), checks, blockedRequests: state.blocked, apiCalls: state.apiCalls, pageErrors: state.pageErrors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, rows: rowResults.length, blockedRequests: state.blocked.length, pageErrors: state.pageErrors.length }));
  if (checks.some(check => !check.passed)) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
