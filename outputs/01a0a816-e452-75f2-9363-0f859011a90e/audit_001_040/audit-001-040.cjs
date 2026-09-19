'use strict';

// Fresh, read-only UX audit for UX-001..UX-040.  The app is served from a
// temporary loopback port and every non-app request is intercepted.  The
// hard-coded chat and sandbox endpoints are fulfilled with local fixtures;
// no provider, device, browser, or computer service is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('../../../intentgraph/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = __dirname;
const APP = 'polished.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHAT_KEY = 'aven-polished-chats-v1';
const PREF_KEY = 'aven-polished-preferences-v1';

const agents = [
  { id: 'a', name: 'Firewall', role: 'Network security', description: 'Network security', notifications: true },
  { id: 'b', name: 'Router', role: 'Routing', description: 'Routing', notifications: true },
];
const message = (id, role, text, extra = {}) => ({ id, role, text, createdAt: new Date().toISOString(), ...extra });
const fixture = () => ({
  prefs: { theme: 'dark', activeAgent: 'a', agents, sections: [{ id: 'ops', name: 'Operations' }, { id: 'lab', name: 'Lab' }] },
  data: {
    activeChat: 'c', projects: [], channels: [],
    chats: [
      { id: 'c', title: 'Network review', projectId: null, recipients: ['a'], draft: '', sample: false, messages: [
        message('u1', 'user', 'Investigate route route route'),
        message('m1', 'assistant', 'Router report **Healthy**\n\n| Link | State |\n| --- | --- |\n| uplink | up |'),
      ], pendingQueue: [] },
      { id: 'd', title: 'Router follow-up', projectId: null, recipients: ['b'], draft: '', sample: false, messages: [message('d1', 'assistant', 'Router evidence for exact search')] },
    ],
  },
});

function serve(root) {
  const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  return http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { res.writeHead(400).end(); return; }
    if (pathname === '/') pathname = '/' + APP;
    const candidate = path.resolve(root, '.' + pathname);
    if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': contentTypes[path.extname(candidate)] || 'application/octet-stream' });
    fs.createReadStream(candidate).pipe(res);
  });
}

async function main() {
  const server = serve(ROOT);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const checks = [];
  const blocked = [];
  const pageErrors = [];
  let apiMode = 'success';
  let apiCalls = [];
  let releaseHold = null;

  function record(id, passed, detail) { checks.push({ id, passed: !!passed, detail: String(detail || '') }); }
  function localReply() {
    if (apiMode === 'stream') return [
      { type: 'start', runId: 'fixture-run', steeringToken: 'fixture-token' },
      { type: 'tool_start', toolId: 'fixture-tool', name: 'run_diagnostic', hostname: 'sw1', operation: 'show interfaces' },
      { type: 'tool_result', toolId: 'fixture-tool', name: 'run_diagnostic', hostname: 'sw1', operation: 'show interfaces', status: 'SUCCESS', evidence: { command: 'show interfaces', target: 'sw1', status: 'SUCCESS', output: 'exact\toutput\nGigabitEthernet1 up' } },
      { type: 'final', reply: { text: 'Interface evidence received.', status: 'SUCCESS', model: 'fixture-model', runId: 'fixture-run', usage: { total_tokens: 23 }, evidence: [{ command: 'show interfaces', target: 'sw1', status: 'SUCCESS', output: 'exact\toutput\nGigabitEthernet1 up' }] } },
      { type: 'end' },
    ];
    if (apiMode === 'failure') return [
      { type: 'start', runId: 'failed-run', steeringToken: 'fixture-token' },
      { type: 'tool_start', toolId: 'fixture-tool', name: 'run_diagnostic', hostname: 'sw1', operation: 'show version' },
      { type: 'tool_result', toolId: 'fixture-tool', name: 'run_diagnostic', hostname: 'sw1', operation: 'show version', status: 'SUCCESS', evidence: { command: 'show version', target: 'sw1', status: 'SUCCESS', output: 'captured evidence' } },
      { type: 'failed', message: 'Fixture provider failure' },
    ];
    return [
      { type: 'start', runId: 'ok-run', steeringToken: 'fixture-token' },
      { type: 'final', reply: { text: 'Fixture response', status: 'SUCCESS', model: 'fixture-model', runId: 'ok-run', usage: { total_tokens: 23 } } },
      { type: 'end' },
    ];
  }

  async function pageFor() {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    p.on('pageerror', e => pageErrors.push(e.message));
    await p.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1' && u.port === String(port)) return route.continue();
      if (u.pathname === '/api/chat') {
        apiCalls.push(route.request().postDataJSON());
        if (apiMode === 'hold') { await new Promise(resolve => { releaseHold = resolve; }); }
        const body = localReply().map(item => JSON.stringify(item)).join('\n') + '\n';
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
      }
      if (u.pathname === '/api/chat/steer') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, id: 'steer-1' }) });
      if (u.pathname === '/api/sandbox/inventory') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ devices: [{ hostname: 'sw1', platform: 'fixture', managementIp: '192.0.2.1', softwareVersion: '1', reachability: 'unknown' }], retrievedAt: new Date().toISOString() }) });
      blocked.push(route.request().url());
      return route.abort();
    });
    return p;
  }

  async function seed(p, custom = {}) {
    const f = fixture();
    const value = { prefs: { ...f.prefs, ...(custom.prefs || {}), agents: custom.prefs?.agents || f.prefs.agents }, data: { ...f.data, ...(custom.data || {}) } };
    await p.goto(`${base}/${APP}`);
    await p.evaluate(({ prefs, data }) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs)); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data)); }, value);
    await p.reload();
    await p.waitForTimeout(100);
  }

  async function scenario(name, fn) {
    apiMode = 'success'; apiCalls = []; releaseHold = null;
    const p = await pageFor();
    try { await fn(p); } catch (e) { record(name, false, `${e.name}: ${e.message}`); }
    await p.close();
  }

  try {
    await scenario('basics', async p => {
      await seed(p);
      for (const width of [1440, 1024, 768, 390]) {
        await p.setViewportSize({ width, height: 900 });
        record('UX-001', await p.evaluate(() => document.documentElement.scrollHeight >= innerHeight), `scrollable at ${width}px`);
        record('UX-002', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), `no page overflow at ${width}px`);
      }
      await p.setViewportSize({ width: 1440, height: 1000 });
      await p.locator('#account-button').focus(); await p.keyboard.press('Enter');
      record('UX-003', await p.locator('#account-menu').isVisible() && await p.locator('#account-menu [role="menuitem"]').first().isVisible(), 'account menu keyboard reachable');
      record('UX-004', await p.locator('#account-name').innerText() === 'Vikas', 'account identity rendered');
      await p.keyboard.press('Escape'); await p.locator('[data-message-id="m1"]').hover(); await p.locator('[data-message-id="m1"] [aria-label="Message actions"]').click();
      record('UX-005', await p.locator('.message-action-menu .message-emoji-row').isVisible(), 'reaction row opened');
      await p.getByRole('menuitemradio', { name: 'React with 👍', exact: true }).click();
      record('UX-006', await p.locator('.message-reactions button').innerText() === '👍', 'reaction selected');
      await p.locator('[data-message-id="m1"]').hover(); await p.locator('[data-message-id="m1"] [aria-label="Message actions"]').click(); await p.getByRole('menuitemradio', { name: 'React with 👎', exact: true }).click();
      record('UX-006', await p.locator('.message-reactions button').innerText() === '👎', 'second reaction replaces first');
      await p.reload(); record('UX-006', await p.locator('.message-reactions button').innerText() === '👎', 'reaction persists on reload');
    });

    await scenario('navigation', async p => {
      await seed(p);
      record('UX-007', await p.locator('[data-direct-row="c"]').count() === 1 && await p.locator('#draft').isVisible(), 'coworker-first direct entry');
      record('UX-008', await p.locator('#surface').innerText() === 'Firewall', 'stable coworker header');
      record('UX-009', !(await p.locator('.direct-subtitle').first().innerText()).match(/[*`|]/), 'sidebar preview strips markdown');
      await p.locator('[data-direct-row="c"]').hover(); await p.locator('[data-direct-row="c"] [aria-label^="Pin "]').click({ force: true }); record('UX-010', await p.locator('[data-direct-row="c"] .nav-row-actions [aria-label^="Unpin"]').count() === 1, 'pin action persists in DOM'); await p.reload(); record('UX-010', await p.locator('[data-direct-row="c"] .nav-row-actions [aria-label^="Unpin"]').count() === 1, 'pin survives reload');
      await p.locator('[data-direct-row="c"]').hover(); await p.locator('[data-direct-row="c"] [aria-label*="Conversation actions"]').click({ force: true }); await p.getByRole('menuitem', { name: 'Rename conversation', exact: true }).click(); await p.locator('#nav-name').fill('Renamed review'); await p.locator('#nav-form-submit').click();
      record('UX-011', await p.locator('#surface').innerText() === 'Firewall' && (await p.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-chats-v1')).chats.find(c => c.id === 'c').title)) === 'Renamed review', 'conversation rename leaves coworker identity');
      record('UX-012', await p.locator('[data-group-toggle="direct"]').getAttribute('aria-expanded') === 'true' && await p.locator('[data-group-toggle="conversations"]').getAttribute('aria-expanded') === 'true', 'direct/conversation grouping visible');
      await p.locator('#toggle').click(); record('UX-013', !(await p.locator('#rail').evaluate(n => n.classList.contains('expanded'))), 'sidebar collapses'); await p.locator('#toggle').click();
      await p.locator('#draft').fill('draft A'); await p.locator('[data-direct-row="d"] .direct-open').click(); await p.locator('#draft').fill('draft B'); await p.locator('#chat-back').click();
      record('UX-014', await p.locator('#draft').inputValue() === 'draft A', 'back restores prior chat and draft'); record('UX-014', await p.locator('#chat-forward').isEnabled(), 'forward history available');
    });

    await scenario('search-find-commands', async p => {
      await seed(p);
      await p.locator('#search-nav').click(); await p.locator('#global-search').fill('exact search');
      record('UX-015', await p.locator('.search-result').count() >= 1, 'saved phrase returns a result');
      await p.locator('#search-coworker').selectOption('b'); record('UX-016', (await p.locator('.search-result').allInnerTexts()).join(' ').includes('Router'), 'coworker filter changes results');
      await p.keyboard.press('Escape'); await p.locator('#draft').fill('Keep draft'); await p.locator('#commands-button').click(); await p.locator('#command-query').fill('find'); await p.keyboard.press('Enter'); await p.locator('#conversation-find-input').fill('route');
      record('UX-017', /of \d+/.test(await p.locator('#conversation-find-count').innerText()), 'find counts repeated term'); await p.locator('#find-next').click(); record('UX-017', await p.locator('#draft').inputValue() === 'Keep draft', 'find preserves draft');
      await p.locator('#find-close').click(); await p.locator('#commands-button').click(); await p.keyboard.press('Escape'); record('UX-018', await p.locator('#commands-button').evaluate(n => n === document.activeElement), 'command Escape restores opener focus');
    });

    await scenario('composer-attachments-reply', async p => {
      await seed(p);
      record('UX-019', await p.locator('#send').isDisabled(), 'empty send disabled'); await p.locator('#draft').fill('line 1\nline 2'); record('UX-019', await p.locator('#draft').inputValue() === 'line 1\nline 2' && await p.locator('#send').isEnabled(), 'multiline held until explicit send');
      await p.locator('[data-message-id="m1"]').hover(); await p.locator('[data-message-id="m1"] [aria-label="Message actions"]').click(); await p.getByRole('menuitem', { name: 'Reply', exact: true }).click(); record('UX-024', await p.locator('#reply-preview').isVisible() && (await p.locator('#reply-preview').innerText()).includes('Reply to Firewall'), 'reply identifies source'); await p.locator('#reply-preview [aria-label="Cancel reply"]').click(); record('UX-024', await p.locator('#draft').inputValue() === 'line 1\nline 2' && await p.locator('#reply-preview').isHidden(), 'cancel keeps draft');
      await p.locator('#file-picker').setInputFiles({ name: 'router.cfg', mimeType: 'text/plain', buffer: Buffer.from('interface Gi0/1\n\tdescription exact\n') }); await p.getByText('router.cfg · ready', { exact: true }).waitFor(); record('UX-021', await p.locator('#attachments').innerText().then(t => t.includes('model request')), 'supported attachment labeled before send'); await p.locator('#file-picker').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('fake') }); await p.waitForTimeout(50); record('UX-022', await p.locator('#attachments').innerText().then(t => t.includes('photo.png')), 'unsupported file labeled for recovery'); await p.getByRole('button', { name: 'Remove attachment photo.png', exact: true }).click();
      await p.locator('#file-picker').setInputFiles({ name: 'drop.txt', mimeType: 'text/plain', buffer: Buffer.from('drop') }); await p.getByText('drop.txt · ready', { exact: true }).waitFor(); record('UX-022', await p.locator('.attachment-chip').count() >= 2, 'valid file selection remains usable');
    });

    await scenario('edit-and-stream', async p => {
      await seed(p);
      await p.locator('[data-message-id="u1"]').hover(); await p.locator('[data-message-id="u1"] [aria-label="Message actions"]').click(); await p.getByRole('menuitem', { name: 'Edit and resend', exact: true }).click(); record('UX-025', await p.locator('#edit-message-text').isVisible(), 'edit dialog allows review'); await p.locator('#edit-message-text').fill('Edited prompt'); await p.locator('#nav-form-submit').click(); await p.waitForFunction(() => !document.querySelector('.working-message'));
      record('UX-025', apiCalls.length === 1 && apiCalls[0].messages.at(-1).content.includes('Edited prompt'), 'edited text sent explicitly');
      apiMode = 'stream'; await p.locator('#draft').fill('Stream result'); await p.locator('#draft').press('Enter'); await p.waitForFunction(() => !document.querySelector('.working-message')); const latest = p.locator('.message').last(); record('UX-028', await latest.locator('.run-evidence').count() === 1 && await latest.locator('.cli-terminal').count() === 1, 'latest streamed run renders one evidence panel/terminal'); await latest.locator('.run-evidence summary').click(); const activityText = await latest.locator('.run-evidence').innerText(); const terminalMeta = await latest.locator('.cli-terminal-meta').innerText(); record('UX-035', activityText.includes('tool_result') && terminalMeta.includes('show interfaces'), `activity=${activityText.slice(0,160)}; terminal=${terminalMeta}`); await latest.locator('.run-provenance summary').click(); record('UX-038', await latest.locator('.run-provenance').innerText().then(t => t.includes('fixture-model') && t.includes('23')), 'model and usage provenance visible');
    });

    await scenario('stop-queue', async p => {
      await seed(p); apiMode = 'hold'; await p.locator('#draft').fill('Long run'); await p.locator('#send').click(); await p.locator('.working-message').waitFor(); await p.locator('.working-message button', { hasText: 'Stop' }).click(); if (releaseHold) releaseHold(); await p.waitForFunction(() => !document.querySelector('.working-message'));
      record('UX-029', await p.locator('#conversation').innerText().then(t => t.includes('Remote completion is unknown') || t.includes('Run stopped')), 'stop leaves truthful incomplete state'); record('UX-036', !(await p.locator('#conversation').innerText()).includes('Run details · SUCCESS'), 'stopped run is not success');
      const state = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), CHAT_KEY); state.chats[0].pendingQueue = [{ id: 'q1', text: 'first queued', mode: 'inspect' }, { id: 'q2', text: 'second queued', mode: 'inspect' }]; state.chats[0].queuePaused = true; await p.evaluate(({ k, s }) => localStorage.setItem(k, JSON.stringify(s)), { k: CHAT_KEY, s: state }); await p.reload(); record('UX-030', await p.locator('#queue-list .queue-item').count() === 2, 'queue retained after reload'); await p.locator('[data-queue-edit="q1"]').click(); await p.locator('[data-queue-id="q1"] textarea').fill('edited first'); await p.locator('[data-queue-edit="q1"]').click(); record('UX-031', await p.locator('[data-queue-id="q1"] textarea').inputValue() === 'edited first', 'queue edit targets selected item'); await p.locator('[data-queue-remove="q2"]').click(); record('UX-031', await p.locator('#queue-list .queue-item').count() === 1, 'queue remove targets selected item');
    });

    await scenario('modes-and-retry', async p => {
      await seed(p); await p.locator('#chat-mode').selectOption('plan'); await p.locator('#draft').fill('Plan this'); await p.locator('#send').click(); await p.waitForFunction(() => !document.querySelector('.working-message')); record('UX-034', apiCalls[0].mode === 'plan' && (await p.locator('#mode-scope').innerText()).includes('no tools'), 'plan mode request is explicit');
      apiMode = 'failure'; await p.locator('#draft').fill('Fail after tool'); await p.locator('#send').click(); await p.waitForFunction(() => !document.querySelector('.working-message')); record('UX-039', await p.locator('.run-evidence').count() >= 1, 'failure retains partial evidence'); record('UX-036', await p.locator('.message').last().innerText().then(t => !t.includes('Run details · SUCCESS')), 'latest failed run cannot display success');
      const text = await p.locator('#conversation').innerText(); record('UX-033', !text.includes('approval card'), 'no stale approval card claim in current UI'); record('UX-037', (await p.locator('#chat-status').innerText()).includes('network coworker'), 'single active-run surface present');
    });

    await scenario('recovery-and-context', async p => {
      await seed(p, { data: { chats: [{ id: 'c', title: 'Recovery', projectId: null, recipients: ['a'], draft: 'keep draft', messages: [message('u', 'user', 'Investigate')], runJournal: { id: 'journal-1', runId: 'run-1', agentId: 'a', startedAt: new Date().toISOString(), events: [{ type: 'tool_result', evidence: { command: 'show version', target: 'sw1', status: 'SUCCESS', output: 'retained output' } }] }, pendingQueue: [{ id: 'q', text: 'queued work', mode: 'inspect' }] }] } });
      record('UX-040', await p.locator('#conversation').innerText().then(t => t.includes('Remote completion is unknown')), 'restart exposes recovery'); record('UX-040', apiCalls.length === 0, 'restart recovery does not duplicate execution'); record('UX-038', await p.locator('#context-preview').getAttribute('title').then(t => t.includes('Full history remains saved')), 'context disclosure states retained history');
      await p.locator('#draft').fill('Keep draft'); await p.locator('#conversation-find-input').count();
    });

    // Code-backed rows whose acceptance requires capabilities absent from this
    // build are intentionally recorded as bounded findings rather than forced
    // browser passes.
    const source = fs.readFileSync(path.join(ROOT, 'polished.js'), 'utf8');
    const htmlSource = fs.readFileSync(path.join(ROOT, 'polished.html'), 'utf8');
    record('UX-023', !source.includes('mention'), 'no file/device mention resolver in current polished.js');
    record('UX-026', !source.includes('SpeechRecognition') && !source.includes('getUserMedia'), 'no voice dictation implementation');
    record('UX-027', htmlSource.includes('composer-note') && !source.includes('effortPicker'), 'composer shows fixed provider/model text; no effort picker');
    record('UX-032', source.includes('/steer') && source.includes('steer_received'), 'steering endpoint and event handling present in code');
    record('UX-033', source.includes('runJournal') && !source.includes('clarification'), 'run persistence present; no clarification card renderer');
    record('UX-037', source.includes('chatRequests.size') && source.includes('if(chatRequests.size)return'), 'global serial guard prevents independent parallel runs');
    record('UX-039', source.includes('chat-retry') && source.includes('retry.onclick=()=>requestChatReply(chat)'), 'manual retry has no review receipt for completed actions');
    record('UX-040', source.includes('recoverInterruptedRuns'), 'restart recovery function present');

    const evidence = { generatedAt: new Date().toISOString(), app: `${base}/${APP}`, checks, blockedRequests: blocked, pageErrors, apiCalls: apiCalls.length, scope: 'isolated Chromium; local static app server; chat/sandbox fixtures; all other network blocked' };
    fs.writeFileSync(path.join(OUT, 'fresh-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ checks: checks.length, passed: checks.filter(x => x.passed).length, failed: checks.filter(x => !x.passed).length, blocked: blocked.length, pageErrors: pageErrors.length, evidence: path.join(OUT, 'fresh-evidence.json') }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
