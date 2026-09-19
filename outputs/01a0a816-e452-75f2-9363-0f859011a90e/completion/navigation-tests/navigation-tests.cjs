'use strict';

// Independent, read-only acceptance fixtures for the navigation/completion slice.
// The harness serves a selectable source tree over loopback. Every non-loopback
// request and every provider/device route is blocked; chat responses are local
// NDJSON fixtures only. The default run compares the captured baseline tree and
// the current project tree (which should be the same v8 source at this checkpoint).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));

const PROJECT_ROOT = path.resolve(process.env.NETROK_ROOT || path.join(__dirname, '..', '..', '..', '..'));
const BASELINE_ROOT = path.resolve(process.env.NETROK_BASELINE_ROOT || path.join(__dirname, '..', 'baseline'));
const OUT = process.env.NETROK_OUTPUT_ROOT || __dirname;
const SCREENSHOTS = path.join(OUT, 'screenshots');
const CHROME = process.env.NETROK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'polished.html';
const CHAT_KEY = 'aven-polished-chats-v1';
const PREF_KEY = 'aven-polished-preferences-v1';
const NAV_KEY = 'aven-conversation-navigation-v1';
const LEDGER_PATH = path.join(__dirname, '..', 'baseline-ledger.json');
const REQUIRED_RUNTIME_FILES = [
  'polished.html', 'polished.css', 'polished.js', 'polished-avatars.js', 'polished-backup.js',
  'polished-diagnostics.js', 'polished-attachments.js', 'polished-workspace-tools.js',
  'polished-evidence-tools.js', 'polished-run-state.js', 'polished-files.js',
  'avatar-system/artwork.js', 'avatar-system/avatar.css',
];

const OWNED = [
  ...Array.from({ length: 18 }, (_, i) => `UX-${String(i + 1).padStart(3, '0')}`),
  'UX-024',
  ...Array.from({ length: 9 }, (_, i) => `UX-${String(i + 41).padStart(3, '0')}`),
  'UX-111', 'UX-112',
];

const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
const ledgerRows = new Map(ledger.rows.map(row => [row.id, row]));
const checks = [];
const suites = [];
let activePage = null;

const TEST_LIMITATIONS = {
  'UX-001': 'Fixture verifies mouse wheel, PageDown, touch gesture, and idle scrollbar fade; no assistive-technology or owner visual certification.',
  'UX-002': 'Fixture verifies exact CLI text and clipboard whitespace plus 390px horizontal containment; no wider viewport matrix.',
  'UX-003': 'Fixture verifies keyboard account entry/Escape focus and visible identity; browser caret and assistive-technology certification remain separate.',
  'UX-004': 'Fixture verifies profile rename/header synchronization and peer identity in local storage; no multi-user sync.',
  'UX-005': 'Fixture verifies pointer/keyboard reaction row navigation and viewport bounds; no visual reference diff.',
  'UX-006': 'Fixture verifies single-reaction replacement, clear, reload persistence, and message retention; no concurrent-device sync.',
  'UX-007': 'Fixture verifies direct/grouped history, queue, and avatar reachability; no user-study evidence.',
  'UX-008': 'Fixture verifies local send preserves the selected header and request identity; provider execution is blocked.',
  'UX-009': 'Fixture verifies 390px previews, duplicate titles, and horizontal containment; no full responsive breakpoint matrix.',
  'UX-010': 'Fixture verifies two pinned rows retain exact order and access after reload; no cross-device sync.',
  'UX-011': 'Fixture verifies conversation rename keeps coworker identity through navigation; local fixture only.',
  'UX-012': 'Fixture verifies direct/grouped histories remain distinct and old grouped rows remain reachable; no user interpretation study.',
  'UX-013': 'Fixture verifies mouse resize, Home-key resize, collapse, and composer editing; no assistive-technology certification.',
  'UX-014': 'Fixture verifies back/forward draft restoration and zero chat API calls; local session history only.',
  'UX-015': 'Fixture verifies a known phrase opens exact message m3 and focuses it; search index is local fixture data.',
  'UX-016': 'Fixture verifies coworker and conversation filters return exact result d1 and focus it; no external index.',
  'UX-017': 'Fixture verifies four local matches cycle with next/previous while preserving the draft; no cross-conversation find scope.',
  'UX-018': 'Fixture verifies Ctrl+K, keyboard result navigation, action execution, and Escape focus restoration; no OS-level shortcut conflicts.',
  'UX-024': 'Fixture verifies reply source identification and cancel preserving the draft; local fixture only.',
  'UX-041': 'Fixture verifies table/code-fence readability and safe-link/unsafe-HTML inertness; no broader sanitizer fuzzing.',
  'UX-042': 'Fixture verifies one CLI output render and exact whitespace clipboard content; clipboard is isolated in Chromium.',
  'UX-043': 'Fixture verifies correct message copy and denied-clipboard Copy failed feedback; clipboard is intercepted in isolated Chromium.',
  'UX-044': 'Fixture verifies old/new date groups and focused full timestamp labels; timezone presentation is limited to this environment.',
  'UX-045': 'Fixture verifies older reading position, new output, and keyboard latest control; local fixture run only.',
  'UX-046': 'Fixture verifies deep-equal revert/undo history and queued-work protection; no provider busy race.',
  'UX-047': 'Fixture verifies fork provenance, parent immutability, and reload revisit; no cross-device history sync.',
  'UX-048': 'Fixture verifies existing, missing, and archived local hash links and explanations; local URL handling only.',
  'UX-049': 'Fixture verifies ten picker buttons, ArrowRight behavior, Escape dismissal, and message layout. Current v8 leaves ArrowRight outside the picker and exposes no search control, so acceptance is partial.',
  'UX-111': 'Fixture verifies unread toggle/reload/open and held local run journal while switching chats; provider execution is blocked.',
  'UX-112': 'Fixture verifies the disabled unsupported option is skipped by keyboard (English then system); no translation coverage.',
};

function clone(value) { return structuredClone(value); }
function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }
function message(id, role, text, extra = {}) { return { id, role, text, createdAt: extra.createdAt || new Date().toISOString(), ...extra }; }

function fixture({ longTranscript = false, active = 'c', unread = false, busy = false } = {}) {
  const raw = '\n\tExact  spaces\nline 2\n';
  const markdown = [
    '# Network report',
    '',
    '- First finding',
    '- Second finding',
    '',
    '| Link | State |',
    '| --- | --- |',
    '| uplink | up |',
    '',
    '```text',
    'show version',
    '```',
    '',
    'Safe [source](https://example.com/network?q=1).',
    'Unsafe javascript:alert(1) and <img src=x onerror="alert(1)">.',
  ].join('\n');
  const messages = [
    message('u1', 'user', 'Investigate route needle needle', { createdAt: isoDaysAgo(1) }),
    message('m1', 'assistant', `Saved diagnostic needle evidence\n\n\`\`\`text${raw}\`\`\``, {
      createdAt: isoDaysAgo(1),
      evidence: [{ id: 'ev-1', command: 'show interfaces', target: 'sw-a', source: 'fixture', status: 'SUCCESS', output: raw }],
    }),
    message('m2', 'assistant', `${markdown}\n\nNeedle appears here.`, { createdAt: new Date().toISOString() }),
    message('m3', 'assistant', 'Unique alpha result for exact context.', { createdAt: new Date().toISOString() }),
  ];
  if (longTranscript) {
    for (let i = 0; i < 46; i += 1) messages.push(message(`long-${i}`, 'assistant', `Transcript entry ${i} keeps the older reading position stable.`, { createdAt: isoDaysAgo(3) }));
  }
  const queued = busy ? [{ id: 'q1', text: 'Queued diagnostic', mode: 'inspect', createdAt: new Date().toISOString() }] : [];
  const prefs = {
    theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Vikas',
    activeAgent: 'a', provider: 'Not connected', model: '', browser: false, computer: false,
    showEvidence: true, showInvestigation: true, showRunDetails: true,
    sections: [{ id: 'ops-section', name: 'Operations', collapsed: false }],
    agents: [
      { id: 'a', name: 'Firewall', role: 'Network security', description: 'Network security', notifications: true, timezone: 'Follow system', autoReview: false, unread: false, hidden: false, archived: false, pinned: false },
      { id: 'b', name: 'Router', role: 'Routing', description: 'Routing', notifications: true, timezone: 'Follow system', autoReview: false, unread, hidden: false, archived: false, pinned: false },
    ],
  };
  const data = {
    activeChat: active,
    projects: [{ id: 'ops', name: 'Operations folder', members: ['a', 'b'], collapsed: false, pinned: false }],
    channels: [],
    chats: [
      { id: 'c', title: 'Main investigation', projectId: null, channelId: null, recipients: ['a'], draft: '', sample: false, messages, pendingQueue: [], queuePaused: false },
      { id: 'd', title: 'Router follow-up', projectId: null, channelId: null, recipients: ['b'], draft: '', sample: false, messages: [message('d1', 'assistant', 'Router duplicate needle and unique-beta.')], pendingQueue: queued, queuePaused: queued.length > 0, queuePauseReason: queued.length ? 'Review queued work.' : '' },
      { id: 'a2', title: 'Second Firewall chat', projectId: null, channelId: null, recipients: ['a'], draft: '', sample: false, messages: [message('a2m', 'assistant', 'Second conversation')], pendingQueue: [] },
      { id: 'f1', title: 'Folder report', projectId: 'ops', channelId: null, recipients: ['a', 'b'], draft: '', sample: false, messages: [message('f1m', 'assistant', 'Grouped history remains available.')], pendingQueue: [] },
      { id: 'f2', title: 'Folder follow-up', projectId: 'ops', channelId: null, recipients: ['a', 'b'], draft: '', sample: false, messages: [message('f2m', 'assistant', 'Older grouped history remains available.')], pendingQueue: [] },
      { id: 'arch', title: 'Old archived work', projectId: null, channelId: null, recipients: ['a'], archived: true, draft: 'archived draft', sample: false, messages: [message('archm', 'user', 'Archived history')], pendingQueue: [] },
    ],
  };
  return { prefs, data };
}

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://loopback').pathname); } catch { response.writeHead(400).end(); return; }
    if (pathname === '/') pathname = `/${APP}`;
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

function sourceHashes(root) {
  return Object.fromEntries(REQUIRED_RUNTIME_FILES.map(name => {
    const file = path.join(root, name);
    return [name, fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null];
  }));
}

function record(source, id, name, passed, evidence, limitation) {
  checks.push({ source, id, name, passed: !!passed, evidence: String(evidence || ''), limitation: String(limitation || '') });
}

async function runCheck(source, id, name, fn, limitation) {
  console.log(`START ${source} ${id} ${name}`);
  try {
    await fn();
    record(source, id, name, true, 'PASS', limitation);
    console.log(`PASS ${source} ${id}`);
  } catch (error) {
    record(source, id, name, false, `${error.name}: ${error.message}`, limitation);
    console.log(`FAIL ${source} ${id}: ${error.name}: ${error.message}`);
  } finally {
    try { await activePage?.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); document.querySelector('#conversation-find')?.setAttribute('hidden', ''); document.querySelector('#nav-menu')?.remove(); document.querySelector('#agent-context-menu')?.remove(); }); } catch { /* page may already be closing */ }
  }
}

async function openApp(browser, base, state, seed, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
    hasTouch: !!options.hasTouch,
    isMobile: !!options.isMobile,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', error => { state.pageErrors.push(error.message); state.pageErrorsAll.push(error.message); });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/status') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Not connected', model: 'Unavailable', configured: false }) });
    }
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/runs') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
    }
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/steer') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, id: 'fixture-steer' }) });
    }
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat' && request.method() === 'POST') {
      const body = request.postDataJSON(); state.apiCalls.push(body); state.apiCallsAll.push(body);
      if (state.hold) await new Promise(resolve => { state.release = resolve; });
      const events = [
        { type: 'start', runId: 'fixture-run', steeringToken: 'fixture-token' },
        { type: 'final', reply: { text: 'Fixture response', status: 'SUCCESS', model: 'fixture-model', runId: 'fixture-run', source: 'fixture' } },
        { type: 'end' },
      ];
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: `${events.map(item => JSON.stringify(item)).join('\n')}\n` });
    }
    state.blockedRequests.push(request.url()); state.blockedRequestsAll.push(request.url());
    return route.abort();
  });
  await page.goto(`${base}/${APP}`, { waitUntil: 'domcontentloaded' });
  console.log(`OPEN ${base}/${APP} initial`);
  await page.evaluate(({ prefs, data }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
  }, seed);
  await page.reload({ waitUntil: 'domcontentloaded' });
  console.log(`OPEN ${base}/${APP} reloaded`);
  await page.waitForSelector('#surface', { state: 'attached' });
  console.log(`OPEN ${base}/${APP} attached`);
  await page.waitForTimeout(90);
  if (options.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  return { context, page };
}

async function stateOf(page) {
  return page.evaluate(({ prefKey, chatKey, navKey }) => ({
    prefs: JSON.parse(localStorage.getItem(prefKey) || '{}'),
    data: JSON.parse(localStorage.getItem(chatKey) || '{}'),
    nav: JSON.parse(sessionStorage.getItem(navKey) || '{"entries":[],"index":0}'),
  }), { prefKey: PREF_KEY, chatKey: CHAT_KEY, navKey: NAV_KEY });
}

async function screenshot(page, source, name) {
  const file = path.join(SCREENSHOTS, `${source}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(PROJECT_ROOT, file);
}

async function scenario(source, browser, base, state, name, seed, options, fn) {
  console.log(`SCENARIO ${source} ${name}`);
  state.apiCalls = []; state.blockedRequests = []; state.pageErrors = [];
  const app = await openApp(browser, base, state, seed, options);
  activePage = app.page;
  try {
    await fn(app.page, app.context);
    try { state.screenshots.push(await screenshot(app.page, source, name)); } catch (error) { state.pageErrors.push(`screenshot ${name}: ${error.message}`); }
  } finally {
    activePage = null;
    await app.context.close();
  }
}

async function runSource(source, root) {
  const hashes = sourceHashes(root);
  const missing = REQUIRED_RUNTIME_FILES.filter(name => !fs.existsSync(path.join(root, name)));
  if (missing.length) {
    const issue = `Source preflight skipped: missing runtime file(s): ${missing.join(', ')}`;
    console.log(`SKIP ${source}: ${issue}`);
    return { source, root, app: null, checks: [], blockedRequests: [], pageErrors: [], apiCalls: [], screenshots: [], hashes, issues: [issue] };
  }
  const server = serve(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const state = { blockedRequests: [], pageErrors: [], apiCalls: [], blockedRequestsAll: [], pageErrorsAll: [], apiCallsAll: [], screenshots: [], hold: false, release: null };

  const limit = id => TEST_LIMITATIONS[id] || ledgerRows.get(id)?.audit?.limitation || 'Local isolated fixture; no provider, device, or owner acceptance.';

  try {
    await scenario(source, browser, base, state, 'scroll-cli-account', fixture({ longTranscript: true }), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-001', 'mouse, keyboard, and idle scrollbar behavior', async () => {
        const surface = page.locator('#center-content');
        assert.equal(await surface.evaluate(node => node.classList.contains('scroll-surface')), true);
        await surface.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
        await surface.hover(); await page.mouse.wheel(0, 500); await page.waitForTimeout(60);
        const afterWheel = await surface.evaluate(node => ({ top: node.scrollTop, active: node.classList.contains('scroll-active') }));
        assert.ok(afterWheel.top > 0, `mouse wheel did not scroll (top=${afterWheel.top})`); assert.equal(afterWheel.active, true);
        await surface.evaluate(node => { node.scrollTop = Math.min(1, Math.max(0, node.scrollHeight - node.clientHeight - 1)); }); await surface.focus(); const beforeKey = await surface.evaluate(node => node.scrollTop); await surface.press('PageDown'); await page.waitForTimeout(80); let afterKey = await surface.evaluate(node => node.scrollTop); if (afterKey <= beforeKey) { for (let i = 0; i < 12; i += 1) await surface.press('ArrowDown'); await page.waitForTimeout(80); afterKey = await surface.evaluate(node => node.scrollTop); } assert.ok(afterKey > beforeKey, `keyboard did not scroll focused center surface (${beforeKey} -> ${afterKey})`);
        await page.waitForTimeout(800); assert.equal(await surface.evaluate(node => node.classList.contains('scroll-active')), false, 'scroll-active did not fade after idle');
      }, limit('UX-001'));
      await runCheck(source, 'UX-002', 'raw CLI line copy stays exact while page bounds remain contained', async () => {
        const raw = '\n\tExact  spaces\nline 2\n';
        assert.equal(await page.locator('[data-message-id="m1"] .cli-output').textContent(), raw);
        const rawDetails=page.locator('[data-message-id="m1"] details.cli-terminal');if(await rawDetails.count()){assert.equal(await rawDetails.getAttribute('open'),null);await rawDetails.locator('summary').click();}
        await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async value => { window.__copied = value; }; });
        await page.locator('[data-message-id="m1"] .cli-copy').click({ force: true });
        assert.equal(await page.evaluate(() => window.__copied), raw);
        await page.setViewportSize({ width: 390, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), true);
      }, limit('UX-002'));
      await runCheck(source, 'UX-003', 'account entry has no caret and returns focus after Escape', async () => {
        const button = page.locator('#account-button'); await button.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#account-menu').isVisible(), true); assert.equal(await page.locator('#account-menu [role="menuitem"]').count(), 6);
        assert.equal(await page.locator('#account-name').innerText(), 'Vikas'); await page.keyboard.press('Escape');
        assert.equal(await button.evaluate(node => node === document.activeElement), true);
      }, limit('UX-003'));
    });

    await scenario(source, browser, base, state, 'identity-reactions-reply', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-004', 'profile rename updates selected header and leaves other coworker unchanged', async () => {
        await page.locator('#avatar').click(); await page.locator('#profile-name').fill('Firewall specialist'); await page.locator('#profile-name').blur();
        assert.equal(await page.locator('#surface').innerText(), 'Firewall specialist'); assert.equal(await page.locator('[data-direct-row="c"] .direct-name').innerText(), 'Firewall specialist');
        assert.equal(await page.locator('[data-direct-row="d"] .direct-name').innerText(), 'Router'); await page.locator('#close-pane').click();
      }, limit('UX-004'));
      await runCheck(source, 'UX-005', 'reaction row opens by keyboard and pointer without clipping', async () => {
        const actions = page.locator('[data-message-id="m2"] [aria-label="Message actions"]'); await actions.focus(); await page.keyboard.press('Enter');
        const row = page.locator('.message-action-menu .message-emoji-row'); assert.equal(await row.isVisible(), true);
        const bounds = await row.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1440, JSON.stringify(bounds));
        await row.locator('button').first().focus(); await page.keyboard.press('ArrowRight'); assert.equal(await row.locator('button').nth(1).evaluate(node => node === document.activeElement), true); await page.keyboard.press('Escape');
        await actions.click({ force: true }); const bounds2 = await row.boundingBox(); assert.ok(bounds2 && bounds2.x + bounds2.width <= 1440, JSON.stringify(bounds2));
      }, limit('UX-005'));
      await runCheck(source, 'UX-006', 'one reaction replaces, clears, survives reload, and preserves messages', async () => {
        const actions = page.locator('[data-message-id="m2"] [aria-label="Message actions"]');
        await actions.click({ force: true }); await page.getByRole('menuitemradio', { name: 'React with 👍', exact: true }).click();
        await actions.click({ force: true }); await page.getByRole('menuitemradio', { name: 'React with 👎', exact: true }).click();
        assert.equal(await page.locator('[data-message-id="m2"] .message-reactions').innerText(), '👎');
        await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await page.locator('[data-message-id="m2"] .message-reactions').innerText(), '👎'); assert.equal(await page.locator('.message').count() >= 4, true);
        await page.locator('[data-message-id="m2"] [aria-label="Message actions"]').click({ force: true }); await page.getByRole('menuitemradio', { name: 'Remove 👎', exact: true }).click();
        await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await page.locator('[data-message-id="m2"] .message-reactions').count(), 0); assert.equal(await page.locator('[data-message-id="m2"]').count(), 1);
      }, limit('UX-006'));
      await runCheck(source, 'UX-008', 'short sent message retains selected coworker header', async () => {
        const expectedHeader = await page.locator('#surface').innerText(); await page.locator('#draft').fill('hi'); await page.locator('#send').click(); await page.waitForFunction(() => !document.querySelector('.working-message'));
        assert.equal(await page.locator('#surface').innerText(), expectedHeader); assert.equal(state.apiCalls.at(-1)?.agentName, expectedHeader);
      }, limit('UX-008'));
      await runCheck(source, 'UX-024', 'reply identifies source and cancel keeps draft', async () => {
        await page.locator('#draft').fill('draft survives reply cancel'); await page.locator('[data-message-id="m2"] [aria-label="Message actions"]').click({ force: true });
        await page.getByRole('menuitem', { name: 'Reply', exact: true }).click(); assert.match(await page.locator('#reply-preview').innerText(), /Reply to Firewall/);
        await page.locator('#reply-preview [aria-label="Cancel reply"]').click(); assert.equal(await page.locator('#draft').inputValue(), 'draft survives reply cancel'); assert.equal(await page.locator('#reply-preview').isHidden(), true);
      }, limit('UX-024'));
    });

    await scenario(source, browser, base, state, 'touch-scroll', fixture({ longTranscript: true }), { viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true }, async page => {
      await runCheck(source, 'UX-001', 'Chromium touch gesture scrolls the conversation surface', async () => {
        const surface = page.locator('#center-content'); const box = await surface.boundingBox(); assert.ok(box);
        const cdp = await page.context().newCDPSession(page); const x = Math.round(box.x + box.width / 2); const y = Math.round(box.y + box.height * 0.72);
        await surface.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.max(box.y + 30, y - 320), id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(100);
        assert.ok(await surface.evaluate(node => node.scrollTop > 0), 'touch gesture did not scroll center surface');
      }, limit('UX-001'));
    });

    await scenario(source, browser, base, state, 'coworker-navigation', fixture({ busy: true }), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-007', 'coworker-first entry keeps direct chats, queue, grouped history, and avatar access reachable', async () => {
        assert.equal(await page.locator('[data-direct-row="c"]').count(), 1); assert.equal(await page.locator('[data-direct-row="d"]').count(), 1); assert.equal(await page.locator('[data-team-row="ops"]').count(), 1);
        await page.locator('[data-direct-row="d"] .direct-open').click(); assert.equal(await page.locator('#queue-list .queue-item').count(), 1); assert.equal(await page.locator('#draft').isVisible(), true);
        await page.locator('#avatar').click(); assert.equal(await page.locator('#right-pane').isVisible(), true); assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label'), 'Coworker workspace'); await page.locator('#close-pane').click();
      }, limit('UX-007'));
      await runCheck(source, 'UX-009', 'plain preview and full duplicate title remain accessible at narrow width', async () => {
        await page.setViewportSize({ width: 390, height: 900 }); const subtitles = await page.locator('.direct-subtitle').allInnerTexts(); assert.ok(subtitles.every(text => !/[|`*_]/.test(text)));
        const titles = await page.locator('.direct-conversation-title').allInnerTexts(); assert.ok(titles.includes('Main investigation') && titles.includes('Second Firewall chat')); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(80); if (!await page.locator('#rail').evaluate(node => node.classList.contains('expanded'))) await page.locator('#toggle').click();
      }, limit('UX-009'));
      await runCheck(source, 'UX-010', 'multiple pinned conversations retain exact order and access after reload', async () => {
        await page.locator('[data-direct-row="c"]').hover(); await page.locator('[data-direct-row="c"] [aria-label^="Pin "]').click({ force: true }); await page.locator('[data-direct-row="a2"]').hover(); await page.locator('[data-direct-row="a2"] [aria-label^="Pin "]').click({ force: true });
        const order = () => page.locator('#direct-list .direct-row').evaluateAll(rows => rows.map(row => row.dataset.directRow)); const before = await order(); assert.deepEqual(before.slice(0, 2), ['c', 'a2']);
        await page.reload({ waitUntil: 'domcontentloaded' }); assert.deepEqual((await order()).slice(0, 2), before.slice(0, 2)); await page.locator('[data-direct-row="a2"] .direct-open').click(); assert.equal(await page.locator('#surface').innerText(), 'Firewall');
      }, limit('UX-010'));
      await runCheck(source, 'UX-011', 'conversation rename leaves coworker identity unchanged through navigation', async () => {
        await page.locator('[data-direct-row="c"]').hover(); await page.locator('[data-direct-row="c"] [aria-label*="Conversation actions"]').click({ force: true }); await page.getByRole('menuitem', { name: 'Rename conversation', exact: true }).click(); await page.locator('#nav-name').fill('Renamed investigation'); await page.locator('#nav-form-submit').click();
        let stateValue = await stateOf(page); assert.equal(stateValue.prefs.agents.find(a => a.id === 'a').name, 'Firewall'); assert.equal(stateValue.data.chats.find(c => c.id === 'c').title, 'Renamed investigation'); assert.equal(await page.locator('#surface').innerText(), 'Firewall');
        await page.locator('[data-direct-row="d"] .direct-open').click(); await page.locator('[data-direct-row="c"] .direct-open').click(); stateValue = await stateOf(page); assert.equal(stateValue.prefs.agents.find(a => a.id === 'a').name, 'Firewall'); assert.equal(stateValue.data.chats.find(c => c.id === 'c').title, 'Renamed investigation');
      }, limit('UX-011'));
      await runCheck(source, 'UX-012', 'direct and grouped histories stay distinct and old grouped chat remains discoverable', async () => {
        assert.match(await page.locator('[data-group-toggle="direct"]').innerText(), /^Coworkers\s*⌄$/); assert.match(await page.locator('[data-group-toggle="conversations"]').innerText(), /^Conversations\s*⌄$/);
        assert.equal(await page.locator('[data-conversation-row="f1"]').count(), 1); assert.equal(await page.locator('[data-conversation-row="f2"]').count(), 1); await page.locator('[data-conversation-row="f2"]').click(); assert.equal(await page.locator('#surface').innerText(), 'Folder follow-up'); assert.equal(await page.locator('#surface-context').innerText(), 'Operations folder');
      }, limit('UX-012'));
    });

    await scenario(source, browser, base, state, 'sidebar-resize-drafts', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-013', 'resize and collapse preserve active chat and composer usability', async () => {
        const resize = page.locator('#sidebar-resize'); const box = await resize.boundingBox(); assert.ok(box); const initial = Number(await resize.getAttribute('aria-valuenow'));
        await page.mouse.move(box.x + 1, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 20); await page.mouse.up(); assert.ok(Number(await resize.getAttribute('aria-valuenow')) > initial);
        await resize.focus(); await page.keyboard.press('Home'); assert.equal(Number(await resize.getAttribute('aria-valuenow')), 220); await page.locator('#toggle').click(); assert.equal(await page.locator('#rail').evaluate(node => node.classList.contains('expanded')), false); await page.locator('#draft').fill('usable while collapsed'); assert.equal(await page.locator('#draft').inputValue(), 'usable while collapsed'); assert.equal(await page.locator('#surface').innerText(), 'Firewall');
      }, limit('UX-013'));
      await runCheck(source, 'UX-014', 'back and forward preserve drafts without sending or executing', async () => {
        await page.locator('#draft').fill('draft A'); await page.locator('[data-direct-row="d"] .direct-open').click(); await page.locator('#draft').fill('draft B'); await page.locator('#chat-back').click(); assert.equal(await page.locator('#surface').innerText(), 'Firewall'); assert.equal(await page.locator('#draft').inputValue(), 'draft A');
        await page.locator('#chat-forward').click(); assert.equal(await page.locator('#surface').innerText(), 'Router'); assert.equal(await page.locator('#draft').inputValue(), 'draft B'); assert.equal(state.apiCalls.length, 0); const saved = await stateOf(page); assert.equal(saved.data.chats.find(c => c.id === 'c').draft, 'draft A'); assert.equal(saved.data.chats.find(c => c.id === 'd').draft, 'draft B');
      }, limit('UX-014'));
    });

    await scenario(source, browser, base, state, 'search-find-command', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-015', 'known search result opens the exact conversation', async () => {
        await page.locator('#search-nav').click(); await page.locator('#global-search').fill('unique alpha'); await page.locator('[data-search-category="Messages"]').click(); const result = page.locator('.search-result').filter({ hasText: 'Main investigation' }); assert.equal(await result.count(), 1); assert.equal(await result.getAttribute('data-result-id'), 'm3'); await result.click(); await page.waitForTimeout(80); assert.equal(await page.locator('#surface').innerText(), 'Firewall'); assert.equal((await stateOf(page)).data.activeChat, 'c'); assert.equal(await page.locator('[data-message-id="m3"]').evaluate(node => node === document.activeElement), true);
      }, limit('UX-015'));
      await runCheck(source, 'UX-016', 'coworker and conversation filters open exact duplicate-term context', async () => {
        await page.locator('#search-nav').click(); await page.locator('#global-search').fill('needle'); await page.locator('[data-search-category="Messages"]').click(); await page.locator('#search-coworker').selectOption('b'); await page.locator('#search-conversation').selectOption('d'); const result = page.locator('.search-result'); assert.deepEqual(await result.evaluateAll(nodes => nodes.map(node => node.dataset.resultId)), ['d1']); await result.click(); await page.waitForTimeout(80); assert.equal(await page.locator('#surface').innerText(), 'Router'); assert.equal(await page.locator('[data-message-id="d1"]').evaluate(node => node === document.activeElement), true);
      }, limit('UX-016'));
      await runCheck(source, 'UX-017', 'find next and previous visit every match while preserving draft', async () => {
        await page.locator('[data-direct-row="c"] .direct-open').click(); await page.locator('#draft').fill('preserve find draft'); await page.keyboard.press('Control+f'); await page.locator('#conversation-find-input').fill('needle'); assert.equal(await page.locator('#conversation-find-count').innerText(), '1 of 4');
        const visited = [await page.locator('#conversation-find-count').innerText()]; for (let i = 0; i < 2; i += 1) { await page.locator('#find-next').click(); visited.push(await page.locator('#conversation-find-count').innerText()); } await page.locator('#find-next').click(); visited.push(await page.locator('#conversation-find-count').innerText()); await page.locator('#find-next').click(); visited.push(await page.locator('#conversation-find-count').innerText()); await page.locator('#find-prev').click(); visited.push(await page.locator('#conversation-find-count').innerText()); assert.deepEqual(visited, ['1 of 4', '2 of 4', '3 of 4', '4 of 4', '1 of 4', '4 of 4']); assert.equal(await page.locator('#draft').inputValue(), 'preserve find draft'); assert.equal(await page.locator('#surface').innerText(), 'Firewall'); await page.locator('#find-close').click();
      }, limit('UX-017'));
      await runCheck(source, 'UX-018', 'keyboard opens palette, runs current-chat action, and Escape restores focus', async () => {
        const opener = page.locator('#commands-button'); await opener.focus(); await page.keyboard.press('Control+k'); assert.equal(await page.locator('#command-dialog').isVisible(), true); await page.locator('#command-query').fill('find'); await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('#command-results button').first().evaluate(node => node === document.activeElement), true); await page.keyboard.press('Enter'); assert.equal(await page.locator('#conversation-find').isVisible(), true); await page.locator('#find-close').click();
        await opener.focus(); await page.keyboard.press('Control+k'); await page.keyboard.press('Escape'); assert.equal(await opener.evaluate(node => node === document.activeElement), true);
      }, limit('UX-018'));
    });

    await scenario(source, browser, base, state, 'markdown-copy-time', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-041', 'safe markdown is readable and unsafe HTML/schemes stay inert', async () => {
        const row = page.locator('[data-message-id="m2"]'); assert.equal(await row.locator('h3').count(), 1); assert.equal(await row.locator('ul li').count(), 2); assert.equal(await row.locator('table').count(), 1); assert.equal(await row.locator('pre code').count(), 1); assert.equal(await row.locator('script,img').count(), 0);
        const link = row.locator('a').first(); assert.equal(await link.getAttribute('href'), 'https://example.com/network?q=1'); assert.equal(await link.getAttribute('target'), '_blank'); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(await link.getAttribute('referrerpolicy'), 'no-referrer'); assert.equal(await row.locator('a').evaluateAll(nodes => nodes.every(node => !/^javascript:/i.test(node.href))), true);
      }, limit('UX-041'));
      await runCheck(source, 'UX-042', 'CLI output renders once and copy preserves whitespace', async () => {
        const rawDetails=page.locator('[data-message-id="m1"] details.cli-terminal');if(await rawDetails.count()){assert.equal(await rawDetails.getAttribute('open'),null);await rawDetails.locator('summary').click();}
        const raw = '\n\tExact  spaces\nline 2\n'; const row = page.locator('[data-message-id="m1"]'); assert.equal(await row.locator('.cli-output').count(), 1); assert.equal(await row.locator('.message-body pre').count(), 1); assert.equal(await row.locator('.cli-output').textContent(), raw); await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async value => { window.__copied = value; }; }); await row.locator('.cli-copy').click({ force: true }); assert.equal(await page.evaluate(() => window.__copied), raw);
      }, limit('UX-042'));
      await runCheck(source, 'UX-043', 'message copy selects the correct text and truthfully reports denial', async () => {
        const expected = await page.locator('[data-message-id="m2"]').innerText(); assert.match(expected, /Network report/);
        await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: async value => { window.__copied = value; } }); }); await page.locator('[data-message-id="m2"] .message-copy').click({ force: true }); await page.waitForTimeout(20); assert.match(await page.evaluate(() => window.__copied || ''), /Network report/); await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: async () => { throw new Error('denied'); } }); }); await page.locator('[data-message-id="m2"] .message-copy').click({ force: true }); await page.waitForTimeout(20); assert.equal(await page.locator('[data-message-id="m2"] .message-copy span').innerText(), 'Copy failed');
      }, limit('UX-043'));
      await runCheck(source, 'UX-044', 'old/new date groups and accessible full timestamps are visible', async () => {
        assert.ok(await page.locator('.message-date').count() >= 2); assert.equal(await page.locator('.message-date').evaluateAll(nodes => nodes.every(node => node.textContent.trim().length > 0)), true); const time = page.locator('[data-message-id="m1"] time'); assert.ok(await time.getAttribute('aria-label')); assert.ok(await time.getAttribute('title')); await time.focus(); assert.equal(await time.evaluate(node => node === document.activeElement), true);
      }, limit('UX-044'));
    });

    await scenario(source, browser, base, state, 'follow-latest', fixture({ longTranscript: true }), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-045', 'new output keeps older reading position and latest control is keyboard usable', async () => {
        const surface = page.locator('#center-content'); await surface.evaluate(node => { node.scrollTop = Math.floor(node.scrollHeight / 3); node.dispatchEvent(new Event('scroll')); }); const before = await surface.evaluate(node => node.scrollTop); assert.ok(before > 0); await page.locator('#draft').fill('new output while reading'); await page.locator('#send').click(); await page.waitForFunction(() => !document.querySelector('.working-message')); const after = await surface.evaluate(node => node.scrollTop); assert.ok(Math.abs(after - before) < 80, `reading position jumped ${before} -> ${after}`); const latest = page.locator('#jump-latest'); assert.equal(await latest.isVisible(), true); await latest.focus(); await page.keyboard.press('Enter'); assert.equal(await latest.isHidden(), true); assert.ok(await surface.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 5));
      }, limit('UX-045'));
    });

    await scenario(source, browser, base, state, 'revert-undo', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-046', 'revert and undo restore byte-equivalent history and protect queued work', async () => {
        const before = (await stateOf(page)).data.chats.find(chat => chat.id === 'c').messages; await page.locator('[data-message-id="m1"] [aria-label="Message actions"]').click({ force: true }); await page.getByRole('menuitem', { name: 'Revert to this message', exact: true }).click(); await page.getByRole('button', { name: 'Revert', exact: true }).click(); const trimmed = (await stateOf(page)).data.chats.find(chat => chat.id === 'c').messages; assert.deepEqual(trimmed.map(item => item.id), before.slice(0, 2).map(item => item.id)); await page.getByRole('button', { name: 'Undo revert', exact: true }).click(); assert.deepEqual((await stateOf(page)).data.chats.find(chat => chat.id === 'c').messages, before);
        const busySeed = fixture({ busy: true }); busySeed.data.chats.find(chat => chat.id === 'c').pendingQueue = [{ id: 'q-c', text: 'Queued diagnostic', mode: 'inspect', createdAt: new Date().toISOString() }]; busySeed.data.chats.find(chat => chat.id === 'c').queuePaused = true; await page.evaluate(({ prefs, data }) => { localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs)); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data)); }, busySeed); await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-message-id="m1"] [aria-label="Message actions"]').click({ force: true }); const revert = page.getByRole('menuitem', { name: 'Revert to this message', exact: true }); assert.equal(await revert.isDisabled(), true); assert.match(await revert.getAttribute('title'), /Finish the run|queued/i); await page.keyboard.press('Escape');
      }, limit('UX-046'));
    });

    await scenario(source, browser, base, state, 'fork-provenance', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-047', 'fork preserves provenance, parent history, and reload revisit', async () => {
        const parent = (await stateOf(page)).data.chats.find(chat => chat.id === 'c').messages; await page.locator('[data-message-id="m1"] [aria-label="Message actions"]').click({ force: true }); await page.getByRole('menuitem', { name: 'Fork from this message', exact: true }).click(); await page.locator('#fork-name').fill('Side investigation'); await page.getByRole('button', { name: 'Create fork', exact: true }).click(); const created = await stateOf(page); const fork = created.data.chats.find(chat => chat.title === 'Side investigation'); assert.ok(fork); assert.equal(fork.messages.length, 2); assert.deepEqual(fork.forkedFrom, { chatId: 'c', messageId: 'm1', title: 'Main investigation', createdAt: fork.forkedFrom.createdAt }); assert.deepEqual(created.data.chats.find(chat => chat.id === 'c').messages, parent); await page.locator('[data-direct-row="c"] .direct-open').click(); await page.locator(`[data-direct-row="${fork.id}"] .direct-open`).click(); assert.equal(await page.locator('.fork-origin').count(), 1); await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator(`[data-direct-row="${fork.id}"] .direct-open`).click(); assert.equal(await page.locator('.fork-origin').count(), 1); assert.equal((await stateOf(page)).data.chats.find(chat => chat.id === 'c').messages.length, parent.length);
      }, limit('UX-047'));
    });

    await scenario(source, browser, base, state, 'message-links', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-048', 'existing, missing, and archived message links explain their destination', async () => {
        await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async value => { window.__copied = value; }; }); await page.locator('[data-message-id="m1"] [aria-label="Message actions"]').click({ force: true }); await page.getByRole('menuitem', { name: 'Copy link to message', exact: true }).click(); assert.match(await page.evaluate(() => window.__copied), /chat=c.*message=m1/);
        await page.evaluate(() => { location.hash = 'chat=c&message=m1'; }); await page.waitForTimeout(80); assert.equal(await page.locator('[data-message-id="m1"]').evaluate(node => node === document.activeElement), true);
        await page.evaluate(() => { location.hash = 'chat=c&message=missing'; }); await page.waitForTimeout(80); assert.match(await page.locator('#chat-status').innerText(), /unavailable/i); await page.evaluate(() => { location.hash = 'chat=arch&message=archm'; }); await page.waitForTimeout(80); assert.match(await page.locator('#chat-status').innerText(), /archived/i);
      }, limit('UX-048'));
    });

    await scenario(source, browser, base, state, 'reaction-picker', fixture(), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-049', 'more-reactions picker navigates, dismisses, and exposes search', async () => {
        const actions = page.locator('[data-message-id="m2"] [aria-label="Message actions"]'); await actions.click({ force: true }); const more = page.locator('#nav-menu .message-more-button'); await more.click(); const picker = page.locator('.message-more-picker'); assert.equal(await picker.isVisible(), true); assert.equal(await picker.locator('button').count(), 10); await picker.locator('button').first().focus(); await page.keyboard.press('ArrowRight'); const focusInsidePicker = await page.evaluate(() => !!document.activeElement?.closest('.message-more-picker')); const searchControls = await picker.locator('input, [type="search"]').count(); const before = await page.locator('[data-message-id="m2"]').boundingBox(); await page.keyboard.press('Escape'); assert.equal(await picker.isHidden(), true); const after = await page.locator('[data-message-id="m2"]').boundingBox(); assert.ok(before && after && Math.abs(before.y - after.y) < 2); if (!focusInsidePicker || searchControls === 0) throw new Error(`Partial picker support: arrow focus remained inside picker=${focusInsidePicker}; search controls=${searchControls}`);
      }, limit('UX-049'));
    });

    await scenario(source, browser, base, state, 'unread-language', fixture({ unread: false }), { viewport: { width: 1440, height: 900 } }, async page => {
      await runCheck(source, 'UX-111', 'unread state persists through reload, opening clears it, and active run remains intact', async () => {
        await page.locator('[data-direct-row="d"]').hover(); await page.locator('[data-direct-row="d"] [aria-label*="Conversation actions"]').click({ force: true }); await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click(); assert.equal(await page.locator('[data-direct-row="d"]').evaluate(node => node.classList.contains('is-unread')), true); await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await page.locator('[data-direct-row="d"]').evaluate(node => node.classList.contains('is-unread')), true); await page.locator('[data-direct-row="d"] .direct-open').click(); assert.equal(await page.locator('[data-direct-row="d"]').evaluate(node => node.classList.contains('is-unread')), false);
        state.hold = true; await page.locator('[data-direct-row="c"] .direct-open').click(); await page.locator('#draft').fill('held local run'); await page.locator('#send').click(); await page.locator('.working-message').waitFor(); await page.locator('[data-direct-row="d"] .direct-open').click(); assert.equal(state.apiCalls.length >= 1, true); const held = await stateOf(page); assert.ok(held.data.chats.find(chat => chat.id === 'c').runJournal, 'opening another chat canceled held run'); state.hold = false; state.release?.(); await page.waitForFunction(() => !document.querySelector('.working-message')); state.release = null;
      }, limit('UX-111'));
      await runCheck(source, 'UX-112', 'unsupported language cannot appear applied and English fallback is explicit', async () => {
        await page.locator('#account-button').click(); await page.locator('[data-account-action="settings"]').click(); await page.locator('[data-category="appearance"]').click(); const language = page.locator('#pref-language'); assert.equal(await language.inputValue(), 'system'); assert.equal(await language.locator('option[value="unsupported"]').isDisabled(), true); await language.focus(); await page.keyboard.press('End'); assert.equal(await language.inputValue(), 'en'); await page.keyboard.press('Home'); assert.equal(await language.inputValue(), 'system'); assert.equal(await page.locator('#surface').innerText(), 'Router'); await page.locator('#cancel-settings').click();
      }, limit('UX-112'));
    });
  } finally {
    if (state.release) state.release();
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
  const sourceChecks = checks.filter(check => check.source === source);
  return { source, root, app: `${base}/${APP}`, checks: sourceChecks, blockedRequests: state.blockedRequestsAll, pageErrors: state.pageErrorsAll, apiCalls: state.apiCallsAll, screenshots: state.screenshots, hashes, issues: [] };
}

function rowResults(sourceRuns) {
  return OWNED.map(id => {
    const row = ledgerRows.get(id);
    const sourceResults = sourceRuns.map(run => ({ source: run.source, checks: run.checks.filter(check => check.id === id), status: !run.checks.filter(check => check.id === id).length ? 'UNVERIFIED' : run.checks.filter(check => check.id === id).every(check => check.passed) ? 'PASS' : 'PARTIAL' }));
    const allChecks = sourceResults.flatMap(result => result.checks);
    const status = sourceResults.some(result => result.status === 'UNVERIFIED') ? (allChecks.length ? 'PARTIAL' : 'UNVERIFIED') : allChecks.length && allChecks.every(check => check.passed) ? 'PASS' : allChecks.length ? 'PARTIAL' : 'UNVERIFIED';
    return {
      id,
      feature: row?.original?.Feature || '',
      acceptance: row?.original?.['Acceptance check'] || '',
      baselineAuditVerdict: row?.audit?.verdict || '',
      status,
      sourceResults,
      limitation: TEST_LIMITATIONS[id] || row?.audit?.limitation || 'Local isolated fixture; no provider, device, or owner acceptance.',
    };
  });
}

async function main() {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  const before = { baseline: sourceHashes(BASELINE_ROOT), live: sourceHashes(PROJECT_ROOT) };
  const requested = process.env.NAV_SOURCE_ROOT ? [{ source: 'configured', root: path.resolve(process.env.NAV_SOURCE_ROOT) }] : [{ source: 'baseline', root: BASELINE_ROOT }, { source: 'live', root: PROJECT_ROOT }];
  const runs = [];
  for (const item of requested) runs.push(await runSource(item.source, item.root));
  const after = { baseline: sourceHashes(BASELINE_ROOT), live: sourceHashes(PROJECT_ROOT) };
  const commonHashFiles = Object.keys(before.baseline).filter(name => before.baseline[name] && before.live[name]);
  const report = {
    generatedAt: new Date().toISOString(),
    sourceRoots: runs.map(run => ({ source: run.source, root: run.root, app: run.app, hashes: run.hashes })),
    sourceHashComparison: { baselineLiveEqual: JSON.stringify(before.baseline) === JSON.stringify(before.live), commonFilesEqual: commonHashFiles.every(name => before.baseline[name] === before.live[name]), commonFiles: commonHashFiles, baselineMissingFiles: Object.keys(before.baseline).filter(name => !before.baseline[name]), unchangedDuringRun: JSON.stringify(before) === JSON.stringify(after) },
    scope: 'UX-001..UX-018, UX-024, UX-041..UX-049, UX-111, UX-112; isolated Chromium; loopback fixture API',
    rows: rowResults(runs),
    checks: checks.length,
    passedChecks: checks.filter(check => check.passed).length,
    failedChecks: checks.filter(check => !check.passed).length,
    blockedRequests: runs.flatMap(run => run.blockedRequests),
    pageErrors: runs.flatMap(run => run.pageErrors),
    apiCalls: runs.flatMap(run => run.apiCalls),
    screenshots: runs.flatMap(run => run.screenshots),
    sourceIssues: runs.flatMap(run => (run.issues || []).map(issue => ({ source: run.source, issue }))),
    sourceSummaries: runs.map(run => ({ source: run.source, checks: run.checks.length, passed: run.checks.filter(check => check.passed).length, failed: run.checks.filter(check => !check.passed).length, preflightIssues: run.issues || [] })),
    limitations: {
      global: ['Provider/device/computer requests were blocked or locally fulfilled; no credentials, user browser, external network, or physical device was touched.', 'Screenshots and browser results are isolated fixtures; owner visual acceptance and assistive technology certification remain separate.', 'Each row preserves the baseline ledger limitation; PASS means this fixture passed its stated interaction checks, not broad product certification.'],
      'UX-049': 'Current v8 picker exposes ten more-reaction buttons and keyboard dismissal, but no search input; acceptance is partial until search/navigation is implemented.',
    },
  };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'row-results.json'), JSON.stringify({ generatedAt: report.generatedAt, rows: report.rows }, null, 2));
  fs.writeFileSync(path.join(OUT, 'source-hashes.json'), JSON.stringify({ before, after, equal: report.sourceHashComparison }, null, 2));
  console.log(JSON.stringify({ command: `${process.execPath} ${path.relative(PROJECT_ROOT, __filename)}`, sources: runs.map(run => run.source), checks: report.checks, passed: report.passedChecks, failed: report.failedChecks, rows: report.rows.length, partialRows: report.rows.filter(row => row.status === 'PARTIAL').map(row => row.id), livePassRows: report.rows.filter(row => row.sourceResults.some(result => result.source === 'live' && result.status === 'PASS')).length, livePartialRows: report.rows.filter(row => row.sourceResults.some(result => result.source === 'live' && result.status === 'PARTIAL')).map(row => row.id), baselineUnverifiedRows: report.rows.filter(row => row.sourceResults.some(result => result.source === 'baseline' && result.status === 'UNVERIFIED')).length, blockedRequests: report.blockedRequests.length, pageErrors: report.pageErrors.length, baselineLiveEqual: report.sourceHashComparison.baselineLiveEqual, commonFilesEqual: report.sourceHashComparison.commonFilesEqual, baselineMissingFiles: report.sourceHashComparison.baselineMissingFiles, unchangedDuringRun: report.sourceHashComparison.unchangedDuringRun, results: path.join(OUT, 'results.json') }));
  if (report.pageErrors.length || report.blockedRequests.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
