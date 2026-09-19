'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const UUID = '01a0a816-e452-75f2-9363-0f859011a90e';
const HEADER_DIR = __dirname;
const PROJECT_ROOT = path.resolve(HEADER_DIR, '../../../..');
const BASELINE_DIR = path.join(PROJECT_ROOT, 'outputs', UUID, 'fixes', 'baseline');
const BASELINE_JS = path.join(BASELINE_DIR, 'polished.js');
const CANDIDATE_JS = path.join(HEADER_DIR, 'candidate', 'polished.js');
const REPORT_OUT = path.join(HEADER_DIR, 'report.json');
const EVIDENCE_OUT = path.join(HEADER_DIR, 'evidence.json');
const INTEGRATED_REPORT_OUT = path.join(HEADER_DIR, 'report-integrated.json');
const INTEGRATED_EVIDENCE_OUT = path.join(HEADER_DIR, 'evidence-integrated.json');
const APP = 'polished.html';
const CHAT_KEY = 'aven-polished-chats-v1';
const PREF_KEY = 'aven-polished-preferences-v1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { chromium } = require(path.join(PROJECT_ROOT, 'intentgraph', 'node_modules', 'playwright'));

const message = (id, role, text) => ({ id, role, text, createdAt: '2026-09-16T00:00:00.000Z' });

function fixture() {
  return {
    prefs: {
      theme: 'dark', activeAgent: 'a',
      agents: [
        { id: 'a', name: 'Firewall', role: 'Network security', description: 'Network security', notifications: true },
        { id: 'b', name: 'Router', role: 'Routing', description: 'Routing', notifications: true },
      ],
      sections: [],
    },
    data: {
      activeChat: 'direct-a',
      projects: [{ id: 'ops', name: 'Operations', members: ['a', 'b'], collapsed: false, pinned: false }],
      channels: [],
      chats: [
        {
          id: 'direct-a', title: 'Network review', projectId: null, channelId: null, recipients: ['a'],
          draft: '', sample: false, messages: [message('a-user', 'user', 'Investigate the branch route'), message('a-assistant', 'assistant', 'The route evidence is retained.')], pendingQueue: [],
        },
        {
          id: 'direct-b', title: 'Router follow-up', projectId: null, channelId: null, recipients: ['b'],
          draft: '', sample: false, messages: [message('b-assistant', 'assistant', 'Router evidence is retained.')], pendingQueue: [],
        },
        {
          id: 'folder-a', title: 'Folder incident', projectId: 'ops', channelId: null, recipients: ['a', 'b'],
          draft: '', sample: false, messages: [message('f-user', 'user', 'Review the shared incident'), message('f-assistant', 'assistant', 'Shared evidence is retained.')], pendingQueue: [],
        },
      ],
    },
  };
}

function serve(root, jsPath) {
  const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  return http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { res.writeHead(400).end(); return; }
    if (pathname === '/') pathname = '/' + APP;
    if (pathname === '/polished.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      fs.createReadStream(jsPath).pipe(res);
      return;
    }
    const candidate = path.resolve(root, '.' + pathname);
    if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': contentTypes[path.extname(candidate)] || 'application/octet-stream' });
    fs.createReadStream(candidate).pipe(res);
  });
}

async function runSuite(mode, jsPath) {
  const server = serve(PROJECT_ROOT, jsPath);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const checks = [];
  const blockedRequests = [];
  const pageErrors = [];
  const apiCalls = [];

  const check = (id, passed, detail) => checks.push({ id, passed: !!passed, detail });

  async function pageFor() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(`${mode}: ${error.message}`));
    await page.route('**/*', async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.hostname === '127.0.0.1' && requestUrl.port === String(port)) return route.continue();
      if (requestUrl.pathname === '/api/chat') {
        apiCalls.push({ mode, body: route.request().postDataJSON() });
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '{"type":"final","reply":{"text":"Fixture response","status":"SUCCESS"}}\n{"type":"end"}\n' });
      }
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    return { context, page };
  }

  async function seed(page) {
    const value = fixture();
    await page.goto(`${base}/${APP}`);
    await page.evaluate(({ prefs, data, prefKey, chatKey }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(prefKey, JSON.stringify(prefs));
      localStorage.setItem(chatKey, JSON.stringify(data));
    }, { ...value, prefKey: PREF_KEY, chatKey: CHAT_KEY });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#surface')?.textContent === 'Firewall');
  }

  async function readState(page) {
    return page.evaluate(({ prefKey, chatKey }) => ({
      header: document.querySelector('#surface')?.textContent || '',
      context: document.querySelector('#surface-context')?.textContent || '',
      prefs: JSON.parse(localStorage.getItem(prefKey)),
      data: JSON.parse(localStorage.getItem(chatKey)),
      nav: JSON.parse(sessionStorage.getItem('aven-conversation-navigation-v1') || '{"entries":[],"index":0}'),
    }), { prefKey: PREF_KEY, chatKey: CHAT_KEY });
  }

  async function waitHeader(page, expected, expectedContext = '') {
    await page.waitForFunction(({ expectedTitle, expectedContext }) => document.querySelector('#surface')?.textContent === expectedTitle && (document.querySelector('#surface-context')?.textContent || '') === expectedContext, { expectedTitle: expected, expectedContext });
  }

  async function renameFromRow(page, selector, menuLabel, name) {
    const row = page.locator(selector);
    await row.hover();
    await row.locator('[aria-label*="Conversation actions"]').click({ force: true });
    await page.getByRole('menuitem', { name: menuLabel, exact: true }).click();
    await page.locator('#nav-name').fill(name);
    await page.locator('#nav-form-submit').click();
    await page.locator('#workspace-create-dialog').waitFor({ state: 'hidden' });
  }

  async function directScenario() {
    const { context, page } = await pageFor();
    try {
      await seed(page);
      await page.locator('#draft').fill('Keep direct draft');
      const before = await readState(page);
      const beforeChat = before.data.chats.find(chat => chat.id === 'direct-a');
      await renameFromRow(page, '[data-direct-row="direct-a"]', 'Rename conversation', 'Renamed direct');
      const afterRename = await readState(page);
      const renamedChat = afterRename.data.chats.find(chat => chat.id === 'direct-a');
      check('UX-011-direct-header', afterRename.header === 'Firewall', `${mode}: header after direct conversation rename is ${JSON.stringify(afterRename.header)}`);
      check('UX-011-direct-title', renamedChat.title === 'Renamed direct', `${mode}: stored title is ${JSON.stringify(renamedChat.title)}`);
      check('UX-011-direct-coworker', afterRename.prefs.agents.find(agent => agent.id === 'a')?.name === 'Firewall', `${mode}: stored coworker is ${JSON.stringify(afterRename.prefs.agents.find(agent => agent.id === 'a')?.name)}`);
      check('UX-011-direct-preservation', renamedChat.draft === 'Keep direct draft' && renamedChat.messages.map(message => message.id).join(',') === beforeChat.messages.map(message => message.id).join(','), `${mode}: direct draft/history preserved`);
      await page.locator('[data-direct-row="direct-b"] .direct-open').click();
      await waitHeader(page, 'Router');
      await page.locator('[data-direct-row="direct-a"] .direct-open').click();
      await waitHeader(page, 'Firewall');
      const afterSwitch = await readState(page);
      const switchHistory = afterSwitch.nav.entries.map(entry => entry.chatId).join(',');
      check('UX-011-direct-switch', afterSwitch.header === 'Firewall' && afterSwitch.data.activeChat === 'direct-a' && afterSwitch.data.chats.find(chat => chat.id === 'direct-a')?.draft === 'Keep direct draft' && switchHistory === 'direct-a,direct-b,direct-a', `${mode}: switch back preserves coworker header, draft, and navigation history (${switchHistory})`);
      await page.reload();
      await waitHeader(page, 'Firewall');
      const afterReload = await readState(page);
      const reloadedChat = afterReload.data.chats.find(chat => chat.id === 'direct-a');
      check('UX-011-direct-reload', afterReload.header === 'Firewall' && reloadedChat.title === 'Renamed direct' && reloadedChat.draft === 'Keep direct draft' && reloadedChat.messages.length === beforeChat.messages.length, `${mode}: reload preserves header/title/draft/history`);
    } finally { await context.close(); }
  }

  async function folderScenario() {
    const { context, page } = await pageFor();
    try {
      await seed(page);
      await page.locator('[data-conversation-row="folder-a"]').click();
      await waitHeader(page, 'Folder incident', 'Operations');
      await page.locator('#draft').fill('Keep folder draft');
      const before = await readState(page);
      const beforeChat = before.data.chats.find(chat => chat.id === 'folder-a');
      await renameFromRow(page, '#team-list .thread-row:has([data-conversation-row="folder-a"])', 'Rename', 'Renamed folder');
      const afterRename = await readState(page);
      const renamedChat = afterRename.data.chats.find(chat => chat.id === 'folder-a');
      check('UX-011-folder-header', afterRename.header === 'Renamed folder' && afterRename.context === 'Operations', `${mode}: folder header/context is ${JSON.stringify([afterRename.header, afterRename.context])}`);
      check('UX-011-folder-preservation', renamedChat.title === 'Renamed folder' && renamedChat.draft === 'Keep folder draft' && renamedChat.messages.map(message => message.id).join(',') === beforeChat.messages.map(message => message.id).join(','), `${mode}: folder title/draft/history preserved`);
      await page.locator('[data-direct-row="direct-a"] .direct-open').click();
      await waitHeader(page, 'Firewall');
      await page.locator('[data-conversation-row="folder-a"]').click();
      await waitHeader(page, 'Renamed folder', 'Operations');
      await page.reload();
      await waitHeader(page, 'Renamed folder', 'Operations');
      const afterReload = await readState(page);
      const reloadedChat = afterReload.data.chats.find(chat => chat.id === 'folder-a');
      check('UX-011-folder-reload', reloadedChat.title === 'Renamed folder' && reloadedChat.draft === 'Keep folder draft' && reloadedChat.messages.length === beforeChat.messages.length, `${mode}: folder reload preserves title/draft/history/context`);
    } finally { await context.close(); }
  }

  async function coworkerScenario() {
    const { context, page } = await pageFor();
    try {
      await seed(page);
      await page.locator('#draft').fill('Keep coworker draft');
      const before = await readState(page);
      const beforeChat = before.data.chats.find(chat => chat.id === 'direct-a');
      await renameFromRow(page, '[data-direct-row="direct-a"]', 'Rename coworker', 'Perimeter');
      const afterRename = await readState(page);
      const renamedChat = afterRename.data.chats.find(chat => chat.id === 'direct-a');
      check('UX-011-coworker-header', afterRename.header === 'Perimeter', `${mode}: coworker rename updates direct header to ${JSON.stringify(afterRename.header)}`);
      check('UX-011-coworker-state', afterRename.prefs.agents.find(agent => agent.id === 'a')?.name === 'Perimeter' && renamedChat.title === beforeChat.title, `${mode}: coworker identity persists while conversation title remains ${JSON.stringify(renamedChat.title)}`);
      check('UX-011-coworker-preservation', renamedChat.draft === 'Keep coworker draft' && renamedChat.messages.length === beforeChat.messages.length, `${mode}: coworker rename preserves draft/history`);
      await page.locator('[data-direct-row="direct-b"] .direct-open').click();
      await waitHeader(page, 'Router');
      await page.locator('[data-direct-row="direct-a"] .direct-open').click();
      await waitHeader(page, 'Perimeter');
      await page.reload();
      await waitHeader(page, 'Perimeter');
      const afterReload = await readState(page);
      check('UX-011-coworker-reload', afterReload.prefs.agents.find(agent => agent.id === 'a')?.name === 'Perimeter' && afterReload.data.chats.find(chat => chat.id === 'direct-a')?.draft === 'Keep coworker draft', `${mode}: coworker/header/draft persist after switch and reload`);
    } finally { await context.close(); }
  }

  try {
    await directScenario();
    await folderScenario();
    await coworkerScenario();
    return { mode, app: `${base}/${APP}`, checks, blockedRequests, pageErrors, apiCalls };
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const integrated = process.argv.includes('--integrated');
  const baseline = integrated ? null : await runSuite('baseline', BASELINE_JS);
  const candidate = integrated ? null : await runSuite('candidate', CANDIDATE_JS);
  const live = integrated ? await runSuite('integrated', path.join(PROJECT_ROOT, 'polished.js')) : null;
  const syntaxTarget = integrated ? path.join(PROJECT_ROOT, 'polished.js') : CANDIDATE_JS;
  execFileSync(process.execPath, ['--check', syntaxTarget], { stdio: 'pipe' });
  const focused = integrated ? live : candidate;
  const reportPath = integrated ? INTEGRATED_REPORT_OUT : REPORT_OUT;
  const evidencePath = integrated ? INTEGRATED_EVIDENCE_OUT : EVIDENCE_OUT;
  const tests = integrated ? [
    { name: 'integrated UX011 focused browser suite', command: 'node rename-header-test.cjs --integrated', mode: 'integrated', passed: focused.checks.every(check => check.passed), result: focused.checks.every(check => check.passed) ? 'PASS' : 'EXPECTED_FAIL_CURRENT_LIVE', checks: focused.checks.length, failed: focused.checks.filter(check => !check.passed).length, app: focused.app },
    { name: 'integrated JavaScript syntax', command: 'node --check polished.js', passed: true },
  ] : [
    { name: 'baseline UX011 focused browser suite', command: 'node rename-header-test.cjs', mode: 'baseline', passed: baseline.checks.filter(check => !check.passed).length === 1 && baseline.checks.find(check => check.id === 'UX-011-direct-header')?.passed === false, result: 'EXPECTED_FAIL', detail: 'Baseline reproduces the direct conversation header mismatch.', checks: baseline.checks.length, failed: baseline.checks.filter(check => !check.passed).length, app: baseline.app },
    { name: 'candidate UX011 focused browser suite', command: 'node rename-header-test.cjs', mode: 'candidate', passed: candidate.checks.every(check => check.passed), result: candidate.checks.every(check => check.passed) ? 'PASS' : 'FAIL', checks: candidate.checks.length, failed: candidate.checks.filter(check => !check.passed).length, app: candidate.app },
    { name: 'candidate JavaScript syntax', command: 'node --check candidate/polished.js', passed: true },
  ];
  const report = {
    generatedAt: new Date().toISOString(),
    files: [
      { file: 'polished.js', baseline: path.relative(PROJECT_ROOT, BASELINE_JS), candidate: path.relative(PROJECT_ROOT, CANDIDATE_JS), ...(integrated ? { integrated: path.relative(PROJECT_ROOT, path.join(PROJECT_ROOT, 'polished.js')) } : {}) },
    ],
    replacementsPath: path.relative(PROJECT_ROOT, path.join(HEADER_DIR, 'replacements.json')),
    tests,
    evidence: integrated ? { integrated: live } : { baseline, candidate },
    limitations: [
      'Chromium used a local static app server and fresh browser contexts.',
      'All non-loopback requests were blocked or locally fulfilled; no provider, device, credential, user storage, or external browser service was contacted.',
      ...(integrated ? ['Integrated mode serves the current live project files without modifying them.'] : ['The candidate is an overlay artifact; the live product files were not edited or integrated.']),
    ],
  };
  fs.writeFileSync(evidencePath, JSON.stringify({ ...(integrated ? live : candidate), ...(integrated ? {} : { baseline }), report }, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: integrated ? 'integrated' : 'before-after', baselineFailed: baseline?.checks.filter(check => !check.passed).length ?? null, candidateFailed: candidate?.checks.filter(check => !check.passed).length ?? null, integratedFailed: live?.checks.filter(check => !check.passed).length ?? null, focusedChecks: focused.checks.length, blocked: [baseline, candidate, live].filter(Boolean).reduce((total, suite) => total + suite.blockedRequests.length, 0), pageErrors: [baseline, candidate, live].filter(Boolean).reduce((total, suite) => total + suite.pageErrors.length, 0), report: reportPath, evidence: evidencePath }));
  if (tests.some(test => !test.passed) || [baseline, candidate, live].filter(Boolean).some(suite => suite.blockedRequests.length || suite.pageErrors.length)) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
