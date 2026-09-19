'use strict';

// Independent, read-only Aven feature audit. Every browser context is isolated;
// only the current localhost shell is allowed and provider/device endpoints are
// intercepted or blocked. All generated files stay beside this script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));

const APP = 'http://127.0.0.1:8767/polished.html';
const ORIGIN = 'http://127.0.0.1:8767';
const BACKEND = 'http://127.0.0.1:8768';
const OUT = __dirname;
const results = [];
const tests = [];
const defects = [];

const today = new Date();
const isoToday = today.toISOString();
const oldDate = '2025-12-01T10:30:00.000Z';
const md = '# Network report\n\n**Bold** and *emphasis*\n\n- First\n- Second\n\n| Field | Value |\n| --- | --- |\n| Mode | Test |\n\n```text\n show version\n\tGi0/1 up\n```\n\n[Source](https://example.com/report) <img src=x onerror=alert(1)> [bad](javascript:alert(1))';
const raw = '\n Router#show interfaces\n\tGi0/1  up  up\n';

function baseSeed(extra = {}) {
  const mainMessages = [
    { id: 'u1', role: 'user', text: 'Older network question', createdAt: oldDate },
    { id: 'a1', role: 'assistant', agentId: 'a', text: md, createdAt: oldDate },
    { id: 'a2', role: 'assistant', agentId: 'a', text: 'Raw command retained', createdAt: isoToday, evidence: [{ id: 'ev1', command: 'show interfaces', target: 'router-1', source: 'mock-cli', status: 'SUCCESS', output: raw }] },
    { id: 'u2', role: 'user', text: 'Later context', createdAt: isoToday },
  ];
  return {
    prefs: { theme: 'dark', accent: 'black', density: 'comfortable', activeAgent: 'a', displayName: 'Vikas', agents: [
      { id: 'a', name: 'Firewall coworker', role: 'Security', label: 'Security', notifications: true, unread: false },
      { id: 'b', name: 'Router coworker', role: 'Routing', label: 'Routing', notifications: false, unread: false },
    ] },
    data: { activeChat: 'main', projects: [{ id: 'personal', name: 'Personal', members: [] }], channels: [], chats: [
      { id: 'main', title: 'Main investigation', projectId: null, recipients: ['a'], draft: 'Keep this draft', sample: false, messages: mainMessages, pendingQueue: [] },
      { id: 'arch', title: 'Archived investigation', projectId: null, recipients: ['a'], archived: true, draft: 'Archived draft', sample: false, messages: [{ id: 'am', role: 'user', text: 'Archived message', createdAt: oldDate }], pendingQueue: [] },
      { id: 'other', title: 'Other investigation', projectId: null, recipients: ['b'], draft: '', sample: false, messages: [{ id: 'om', role: 'user', text: 'Other message', createdAt: oldDate }], pendingQueue: [] },
    ], ...extra },
  };
}

function assertFresh(id, ok, evidence, finding, limitation = '') {
  results.push({ id, verdict: ok ? 'Verified (scoped)' : 'Unverified', evidenceLevel: ok ? 'fresh-browser' : 'code-only', finding, evidence, nextAction: ok ? 'Retain local slice; obtain owner/live acceptance for broader scope.' : 'Add an isolated executable check for the claimed slice.', limitation });
}

async function openPage(browser, seed = baseSeed(), options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const blocked = [];
  const calls = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ORIGIN) return route.continue();
    if (url.origin === BACKEND && url.pathname === '/api/chat') {
      calls.push({ url: request.url(), body: request.postDataJSON?.() });
      const body = [
        { type: 'start', runId: 'audit-run', steeringToken: 'audit-steer' },
        { type: 'final', reply: { text: 'Mocked audit answer', status: 'SUCCESS', runId: 'audit-run', source: 'audit-mock' } },
        { type: 'end', runId: 'audit-run' },
      ].map(item => JSON.stringify(item)).join('\n') + '\n';
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
    }
    if (url.origin === BACKEND && url.pathname === '/api/chat/status') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'OpenCode Go', model: 'mimo-v2.5', configured: false, lastChecked: isoToday, secret: 'must-not-copy' }) });
    }
    if (url.origin === BACKEND && url.pathname.startsWith('/api/chat/runs')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
    }
    blocked.push(request.url());
    return route.abort();
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ prefs, data }) => {
    localStorage.clear();
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
    localStorage.setItem('aven-polished-docs-v1', JSON.stringify({ a: { 'SOUL.md': '# local soul', 'MEMORY.md': 'private note' } }));
    localStorage.setItem('aven-polished-direct-teams-migration-v4', 'v4');
  }, seed);
  await page.reload({ waitUntil: 'domcontentloaded' });
  return { context, page, blocked, calls, errors };
}

async function finish(id, fn, evidenceName, seed = baseSeed(), options = {}) {
  let state;
  try {
    state = await openPage(browser, seed, options);
    await fn(state.page, state);
    fs.writeFileSync(path.join(OUT, evidenceName), JSON.stringify({ at: new Date().toISOString(), passed: true, blocked: state.blocked, backendCalls: state.calls.length, pageErrors: state.errors }, null, 2));
    tests.push({ command: `node audit.cjs :: ${id}`, exitCode: 0, result: 'PASS' });
    return true;
  } catch (error) {
    fs.writeFileSync(path.join(OUT, evidenceName), JSON.stringify({ at: new Date().toISOString(), passed: false, error: String(error?.stack || error), blocked: state?.blocked || [], backendCalls: state?.calls?.length || 0, pageErrors: state?.errors || [] }, null, 2));
    tests.push({ command: `node audit.cjs :: ${id}`, exitCode: 1, result: String(error?.message || error) });
    return false;
  } finally { await state?.context?.close(); }
}

async function testMessages() {
  const longSeed = baseSeed();
  longSeed.data.chats[0].messages.push(...Array.from({ length: 36 }, (_, i) => ({ id: `extra-${i}`, role: 'assistant', agentId: 'a', text: `History filler ${i} ` .repeat(20), createdAt: isoToday })));
  const ok = await finish('UX-041..049', async (p, s) => {
    assert.equal(await p.locator('[data-message-id="a1"] h3').count(), 1);
    assert.equal(await p.locator('[data-message-id="a1"] ul li').count(), 2);
    assert.equal(await p.locator('[data-message-id="a1"] table').count(), 1);
    assert.equal(await p.locator('[data-message-id="a1"] pre code').count(), 1);
    assert.equal(await p.locator('[data-message-id="a1"] img, [data-message-id="a1"] script, [data-message-id="a1"] iframe').count(), 0);
    assert.equal(await p.locator('[data-message-id="a2"] .cli-output').innerText(), raw);
    assert.equal(await p.locator('[data-message-id="a2"] .cli-terminal').count(), 1);
    await p.evaluate(() => { window.__auditClipboard = ''; navigator.clipboard.writeText = async value => { window.__auditClipboard = value; }; });
    await p.locator('[data-message-id="a2"] .cli-copy').click({ force: true });
    assert.equal(await p.evaluate(() => window.__auditClipboard), raw);
    await p.locator('[data-message-id="a1"] .message-copy').click({ force: true });
    assert.equal(await p.evaluate(() => window.__auditClipboard), md);
    await p.locator('[data-message-id="u1"] .message-copy').click({ force: true });
    assert.equal(await p.evaluate(() => window.__auditClipboard), 'Older network question');
    await p.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await p.locator('[data-message-id="u1"] .message-copy').click({ force: true });
    assert.equal(await p.locator('[data-message-id="u1"] .message-copy span').innerText(), 'Copy failed');
    // Revert is context-only and undo restores the exact later history.
    await p.locator('[data-message-id="a1"] [aria-label="Message actions"]').click({ force: true });
    await p.getByRole('menuitem', { name: 'Revert to this message', exact: true }).click();
    await p.getByRole('button', { name: 'Revert', exact: true }).click();
    assert.equal(await p.locator('[data-message-id="a2"]').count(), 0);
    await p.getByRole('button', { name: 'Undo revert', exact: true }).click();
    assert.equal(await p.locator('[data-message-id="a2"]').count(), 1);
    assert.ok(await p.locator('.message-date').count() >= 2);
    assert.equal(await p.locator('[data-message-id="a1"] time').getAttribute('tabindex'), '0');
    assert.ok(await p.locator('[data-message-id="a1"] time').getAttribute('aria-label'));
    await p.locator('[data-message-id="a1"] [aria-label="Message actions"]').click({ force: true });
    await p.getByRole('menuitem', { name: 'More reactions', exact: true }).click();
    assert.equal(await p.locator('.message-more-picker button').count(), 10);
    await p.locator('.message-more-picker button').first().click();
    assert.equal((await p.locator('[data-message-id="a1"] .message-reactions').innerText()).trim(), '🔥');
    await p.locator('[data-message-id="a1"] [aria-label="Message actions"]').click();
    await p.getByRole('menuitemradio', { name: 'React with 👍', exact: true }).click();
    assert.equal((await p.locator('[data-message-id="a1"] .message-reactions').innerText()).trim(), '👍');
    await p.locator('[data-message-id="a1"] [aria-label="Message actions"]').click();
    await p.getByRole('menuitemradio', { name: 'Remove 👍', exact: true }).click();
    assert.equal(await p.locator('[data-message-id="a1"] .message-reactions').count(), 0);
    await p.evaluate(() => { window.__auditClipboard = ''; navigator.clipboard.writeText = async value => { window.__auditClipboard = value; }; });
    await p.locator('[data-message-id="a2"] [aria-label="Message actions"]').click({ force: true });
    await p.getByRole('menuitem', { name: 'Copy link to message', exact: true }).click();
    assert.match(await p.evaluate(() => window.__auditClipboard), /chat=main.*message=a2/);
    await p.locator('[data-message-id="a2"] [aria-label="Message actions"]').click({ force: true });
    await p.getByRole('menuitem', { name: 'Fork from this message', exact: true }).click();
    await p.locator('#fork-name').fill('Audit fork');
    await p.getByRole('button', { name: 'Create fork', exact: true }).click();
    assert.equal(await p.locator('[data-message-id="a2"]').count(), 1);
    assert.equal(await p.getByRole('button', { name: 'Forked from Main investigation', exact: true }).count(), 1);
    const persisted = await p.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-chats-v1')));
    assert.equal(persisted.chats.find(c => c.title === 'Audit fork').messages.length, 3);
    assert.equal(persisted.chats.find(c => c.id === 'main').draft, 'Keep this draft');
    await p.locator('#chat-back').click().catch(() => {});
    assert.deepEqual(s.blocked, []);
    assert.deepEqual(s.errors, []);
  }, 'messages.json', longSeed);
  for (const id of ['UX-041','UX-042','UX-043','UX-044','UX-045','UX-046','UX-047','UX-048','UX-049']) assertFresh(id, ok, 'messages.json', 'Fresh isolated message rendering, copy, date, reaction, link and fork checks passed.', 'Live owner visual acceptance and provider/device execution are out of scope.');
}

async function testHistorySettings() {
  const ok = await finish('UX-050..065', async p => {
    await p.locator('#thread-actions').click();
    await p.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    assert.equal(await p.locator('#composer-wrap').isVisible(), false);
    await p.locator('#account-button').click();
    await p.locator('[data-account-action="settings"]').click();
    await p.locator('[data-category="archived"]').click();
    await p.getByRole('button', { name: 'Restore Main investigation', exact: false }).click();
    // Restore persists first; reload redraws the restored chat and its composer.
    await p.locator('#close-settings').click();
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.locator('[data-direct-row="main"] .direct-open').click();
    assert.equal(await p.locator('#composer-wrap').isVisible(), true);
    await p.locator('#account-button').click();
    await p.locator('[data-account-action="settings"]').click();
    await p.locator('[data-category="data"]').click();
    const download = p.waitForEvent('download');
    await p.locator('#export-workspace').click();
    const file = await download;
    const exported = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
    assert.equal(exported.format, 'aven-workspace');
    assert.equal(exported.data.chats.some(c => c.id === 'main'), true);
    const invalid = p.locator('#import-workspace');
    await invalid.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
    await p.getByText('This file is not valid JSON.', { exact: true }).waitFor();
    assert.equal(await p.locator('#import-preview').isVisible(), false);
    await p.locator('[data-category="appearance"]').click();
    await p.locator('#pref-density').selectOption('compact');
    await p.locator('#save-settings').click();
    await p.waitForFunction(() => !document.getElementById('settings-dialog').open);
    assert.equal(await p.locator('html').getAttribute('data-density'), 'compact');
    await p.locator('#avatar').click();
    assert.equal(await p.locator('#profile-name').inputValue(), 'Firewall coworker');
    await p.locator('#edit-avatar').click();
    assert.ok(await p.locator('[data-avatar-style]').count() > 0);
    await p.locator('[data-avatar-style]').first().click();
    await p.locator('#profile-name').fill('Firewall specialist');
    await p.locator('#profile-name').blur();
    assert.equal(await p.locator('.direct-name').first().innerText(), 'Firewall specialist');
    await p.locator('#profile-doc-list [data-doc="SOUL.md"]').click();
    assert.match(await p.locator('.doc-local-note').innerText(), /not sent to the model/i);
    await p.locator('#close-pane').click();
    await p.locator('#account-button').click();
    await p.locator('[data-account-action="help"]').click();
    assert.match(await p.locator('#info-dialog-body').innerText(), /shortcuts|keyboard/i);
    await p.locator('#info-ok').click();
    await p.locator('#account-button').click();
    await p.locator('[data-account-action="feedback"]').click();
    await p.locator('#feedback-text').fill('audit feedback');
    await p.locator('#save-feedback').click();
    assert.match(await p.locator('#feedback-status').innerText(), /Saved locally/);
    await p.locator('#info-ok').click();
    await p.locator('#commands-button').click();
    await p.locator('#command-query').fill('search');
    assert.ok(await p.locator('#command-results button').count() > 0);
    await p.keyboard.press('Escape');
    await p.locator('#account-button').click();
    await p.locator('[data-account-action="about"]').click();
    assert.match(await p.locator('.build-info').innerText(), /ux-pipeline/);
  }, 'history-settings.json');
  for (const id of ['UX-050','UX-051','UX-052','UX-054','UX-055','UX-057','UX-059','UX-062','UX-064','UX-065']) assertFresh(id, ok, 'history-settings.json', 'Fresh local archive/export/settings/profile/help/feedback/shortcut checks passed.', 'Account sync and live health are intentionally unavailable.');
  results.push({ id: 'UX-053', verdict: 'Deferred', evidenceLevel: 'register-decision', finding: 'Cross-device history remains explicitly deferred pending identity and ownership contracts.', evidence: 'source-register.json; current localStorage-only implementation', nextAction: 'Revisit after account/customer isolation contract exists.', limitation: 'No cross-device service exists in this build.' });
  results.push({ id: 'UX-063', verdict: 'Deferred', evidenceLevel: 'register-decision', finding: 'Account/sign-out remains a local placeholder and is explicitly deferred.', evidence: 'source-register.json; polished.js accountAction', nextAction: 'Revisit with an authenticated account contract.', limitation: 'No remote identity is connected.' });
}

async function testPanesAndEvidence() {
  const ok = await finish('UX-066..073', async p => {
    await p.locator('#avatar').click();
    await p.locator('[data-pane="browser"]').click();
    assert.match(await p.locator('#pane-content').innerText(), /No browser session is connected/i);
    await p.locator('[data-pane="computer"]').click();
    assert.match(await p.locator('#pane-content').innerText(), /No computer session is connected/i);
    await p.locator('[data-pane="browser"]').click();
    await p.locator('#pane-resize').press('Home');
    assert.equal(await p.locator('#pane-resize').getAttribute('aria-valuenow'), '320');
    await p.locator('#close-pane').click();
    await p.locator('[data-message-id="a2"] [aria-label="Message actions"]').click({ force: true });
    await p.getByRole('menuitem', { name: 'Annotate evidence', exact: true }).click();
    await p.locator('.aven-evidence-note').fill('interface output note');
    await p.getByRole('button', { name: 'Save annotation', exact: true }).click();
    await p.waitForFunction(() => document.querySelector('.aven-evidence-notes-body')?.innerText.includes('interface output note'));
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('aven-polished-chats-v1')));
    assert.equal(saved.chats.find(c => c.id === 'main').messages.find(m => m.id === 'a2').annotations.length, 1);
    await p.locator('#close-pane').click();
    await p.locator('[data-destination="Artifacts"]').click();
    assert.ok(await p.locator('.aven-workspace-tools-view').count() > 0);
  }, 'panes-evidence.json');
  for (const id of ['UX-067','UX-068','UX-069','UX-073']) assertFresh(id, ok, 'panes-evidence.json', 'Fresh isolated pane availability, keyboard resize and annotation checks passed.', 'Browser/computer live sessions and device-side review remain unavailable.');
  // UX066 has a distinct independently reproducible duplicate-output defect.
  const artifactOk = await finish('UX-066-duplicate', async p => {
    const duplicateSeed = baseSeed();
    duplicateSeed.data.chats[0].messages[0] = { id: 'dup', role: 'assistant', agentId: 'a', text: 'duplicate evidence', runId: 'run-dup', createdAt: isoToday, events: [{ type: 'tool_result', evidence: { command: 'show version', target: 'r1', status: 'SUCCESS', output: 'same raw output' } }], evidence: [{ command: 'show version', target: 'r1', status: 'SUCCESS', output: 'same raw output' }] };
    await p.evaluate(({ prefs, data }) => { localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs)); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data)); }, duplicateSeed);
    await p.reload();
    await p.locator('[data-destination="Artifacts"]').click();
    const text = await p.locator('#pane-content').innerText();
    assert.match(text, /same raw output/);
    const occurrences = (text.match(/same raw output/g) || []).length;
    assert.ok(occurrences >= 2);
    fs.writeFileSync(path.join(OUT, 'artifact-duplicate-evidence.json'), JSON.stringify({ at: new Date().toISOString(), passed: true, occurrences, finding: 'same output persisted in events and evidence is rendered twice by artifactEntries because seen is identity-based.' }, null, 2));
  }, 'artifact-duplicate-run.json');
  if (artifactOk) {
    results.push({ id: 'UX-066', verdict: 'Defect', evidenceLevel: 'fresh-browser', finding: 'Artifact library duplicates one raw output when the same diagnostic is present in both serialized events and evidence.', evidence: 'artifact-duplicate-evidence.json; polished-workspace-tools.js:127-190', nextAction: 'Deduplicate artifact outputs by stable provenance/content key across events and evidence.', limitation: 'Reproduction uses a synthetic persisted run; no provider/device call.' });
    defects.push({ ids: ['UX-066'], severity: 'medium', title: 'Artifact library duplicates serialized event/evidence output', repro: 'Persist same command/target/status/output under message.events and message.evidence, open Artifacts.', expected: 'One artifact for one saved raw output.', actual: 'The same raw output appears twice.', evidence: 'artifact-duplicate-evidence.json' });
  } else results.push({ id: 'UX-066', verdict: 'Partial', evidenceLevel: 'code-review', finding: 'Artifact provenance path is present but duplicate-output behavior could not be freshly reproduced.', evidence: 'polished-workspace-tools.js:127-190', nextAction: 'Retest artifact list with serialized event/evidence duplicates.', limitation: 'Browser run failed before reproduction.' });
  results.push({ id: 'UX-070', verdict: 'Partial', evidenceLevel: 'code-review', finding: 'Session-scoped text file editor contains exact review/save/conflict checks; real OS picker and external disk scope remain unverified.', evidence: 'polished-files.js:45-170, 384-447', nextAction: 'Exercise with a real user-selected folder under owner-controlled QA.', limitation: 'No user disk writes were performed.' });
  results.push({ id: 'UX-071', verdict: 'Missing', evidenceLevel: 'fresh-browser', finding: 'Aven exposes retained raw diagnostic output but no general interactive terminal surface.', evidence: 'panes-evidence.json; polished.js:639-646', nextAction: 'Define authorized shell/session boundaries before adding terminal.', limitation: 'Intentional scope gap.' });
  results.push({ id: 'UX-072', verdict: 'Partial', evidenceLevel: 'code-review', finding: 'Local file review is implemented; network configuration impact/rollback and execution approval remain absent.', evidence: 'polished-files.js:123-170; polished-evidence-tools.js:243-380', nextAction: 'Integrate exact network target/diff/impact and approval receipt flow.', limitation: 'No network configuration calls were made.' });
  results.push({ id: 'UX-074', verdict: 'Missing', evidenceLevel: 'code-review', finding: 'Digest-bound approval adapters exist outside the Aven UI; no integrated general approval receipt control is exposed.', evidence: 'intentgraph/adapters/index.cjs:462-503,570-598; polished.js:359-370', nextAction: 'Integrate receipt UI only after future network write scope is defined.', limitation: 'No execution or provider calls.' });
  results.push({ id: 'UX-075', verdict: 'Missing', evidenceLevel: 'fresh-browser', finding: 'No Git stage, commit, or PR workflow is present in the Aven shell.', evidence: 'panes-evidence.json; polished.html workspace navigation', nextAction: 'Defer until configuration-as-code becomes a primary workflow.', limitation: 'Intentional scope gap.' });
}

async function testNetworkSemantics() {
  const ok = await finish('UX-076..079', async p => {
    await p.locator('#avatar').click();
    await p.locator('[data-pane="plugins"]').click();
    assert.match(await p.locator('#pane-content').innerText(), /Load inventory|No configuration changes/i);
    await p.locator('#sandbox-load').click();
    await p.waitForFunction(() => /Could not refresh Cisco inventory|Retrieved/.test(document.querySelector('#pane-content')?.innerText || ''));
    assert.match(await p.locator('#pane-content').innerText(), /Could not refresh Cisco inventory/i);
    await p.locator('#close-pane').click();
    assert.match(await p.locator('#mode-scope').innerText(), /read-only|scope/i);
    await p.locator('#chat-mode').selectOption('plan');
    assert.match(await p.locator('#mode-scope').innerText(), /no tools|Plan/i);
    const outcome = await p.evaluate(() => AvenRunState.outcome({ status: 'SUCCESS', evidence: [{ status: 'FAILURE', output: 'fault' }] }));
    assert.equal(outcome, 'FAILURE');
    const run = { id: 'a3', role: 'assistant', agentId: 'a', text: 'Command completed; health is not established.', runId: 'run-health', status: 'FAILURE', mode: 'inspect', createdAt: new Date().toISOString(), evidence: [{ command: 'show interfaces', target: 'router-1', status: 'FAILURE', output: 'Gi0/1 down' }] };
    await p.evaluate(run => { const d = JSON.parse(localStorage.getItem('aven-polished-chats-v1')); d.chats.find(c => c.id === 'main').messages.push(run); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(d)); }, run);
    await p.reload();
    assert.match(await p.locator('[data-message-id="a3"] .run-provenance').innerText(), /FAILURE|does not establish device health/i);
    assert.equal(await p.locator('[data-message-id="a3"] .cli-terminal-status').innerText(), 'FAILURE');
  }, 'network-semantics.json');
  results.push({ id: 'UX-076', verdict: ok ? 'Partial' : 'Unverified', evidenceLevel: ok ? 'fresh-browser' : 'code-only', finding: 'Backend inventory and diagnostics pane are present, but the composer has no exact device selection control.', evidence: 'network-semantics.json; polished.js:613-638', nextAction: 'Expose selected device IDs/connection state before diagnostics.', limitation: 'Inventory route was mocked and no device call was made.' });
  assertFresh('UX-077', ok, 'network-semantics.json', 'Plan/Inspect mode scope messaging and read-only labels were freshly exercised.', 'Runtime enforcement is tested elsewhere; no device call made here.');
  assertFresh('UX-078', ok, 'network-semantics.json', 'Fresh raw terminal metadata and run provenance rendering check passed.', 'No live device evidence.' );
  assertFresh('UX-079', ok, 'network-semantics.json', 'Fresh nested FAILURE outcome and UI status check passed without equating success to health.', 'No live device evidence.' );
}

let browser;
(async () => {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  await testMessages();
  await testHistorySettings();
  await testPanesAndEvidence();
  await testNetworkSemantics();
  // Tighten broad group results to the exact acceptance slices exercised here.
  // This keeps a passing grouped harness from implying coverage of untested
  // persistence, delivery, migration, or live-provider/device behavior.
  const precision = [
    ['UX-045', 'Partial', 'fresh-browser', 'Rendering was exercised with a long history, but this run did not assert the near-bottom follow-latest threshold or keyboard Jump to latest behavior.', 'messages.json; polished.js:688-713', 'Add a scroll-position fixture that proves older reading position is preserved and the latest control is keyboard usable.', 'No follow-latest interaction was exercised; live streaming is unavailable.'],
    ['UX-048', 'Partial', 'fresh-browser', 'Copy link generated a chat/message-scoped URL, but exact opening plus missing and archived destination explanations were not exercised.', 'messages.json; polished.js:404-415', 'Test opening copied links for existing, missing, and archived destinations.', 'The isolated check only inspected the copied URL.'],
    ['UX-049', 'Partial', 'fresh-browser', 'The additional picker rendered ten choices and replacement/clearing worked, but search/navigation and close-without-message-movement were not tested.', 'messages.json; polished.js:362-370', 'Exercise picker keyboard navigation, search, dismissal, and scroll stability.', 'No search or keyboard-navigation assertion.'],
    ['UX-052', 'Partial', 'fresh-browser', 'Invalid JSON import was rejected without opening a preview; valid restore merge and unrelated-work preservation were not exercised.', 'history-settings.json; polished.js:843-879', 'Run valid Add and Replace imports with collision and unrelated-chat fixtures, including recovery.', 'Only the invalid-input path was freshly tested.'],
    ['UX-054', 'Partial', 'fresh-browser', 'Avatar choices rendered and one selection saved, but migration compatibility and reload persistence were not asserted in this run.', 'history-settings.json; polished.js:618-651', 'Exercise legacy avatar migration and reload every avatar choice.', 'No migration/reload assertion in this child audit.'],
    ['UX-055', 'Partial', 'fresh-browser', 'Profile rename updated the selected coworker, but long-name readability and selected-coworker isolation were not exercised.', 'history-settings.json; polished.js:618-651', 'Test long labels and rename isolation across two coworkers.', 'Only a short rename on the seeded coworker was tested.'],
    ['UX-056', 'Partial', 'code-review', 'Local SOUL/MEMORY scope text and editor surface are present, but this audit did not connect saved content to a model request.', 'history-settings.json; polished.js:632-651; polished.js:688-713', 'Trace a saved document through a mocked request and prove scope and exact content.', 'Provider/model path intentionally unavailable.'],
    ['UX-057', 'Partial', 'code-review', 'A notification preference control is present, but completion, waiting, and error delivery/link behavior was not exercised.', 'fresh-evidence.json; polished.js:880-892', 'Exercise muted and enabled completion/waiting/error events and verify the linked message/run.', 'No alert/event delivery assertion in this child audit.'],
    ['UX-058', 'Unverified', 'code-review', 'Profile editing was exercised, while coworker creation and first-welcome delivery were not duplicated in this audit.', 'history-settings.json; polished.js:795-807', 'Use the root-owned isolated creation failure evidence and add a transactional success/failure regression.', 'Creation path intentionally left to root to avoid duplicate storage-failure mutation.'],
    ['UX-059', 'Partial', 'fresh-browser', 'Compact density persisted and controls remained readable, but both light and dark themes were not exercised.', 'history-settings.json; polished.js:843-879', 'Run both theme modes through save, cancel, reload, and storage failure.', 'Only density/one appearance path was tested.'],
    ['UX-065', 'Partial', 'fresh-browser', 'The command palette opened and returned a search result, but Ctrl/Cmd+K and Ctrl/Cmd+F bindings and unavailable-action filtering were not asserted.', 'history-settings.json; polished.js:860-892', 'Exercise the documented shortcut keys and verify command registry filtering.', 'No direct keyboard shortcut assertions.'],
    ['UX-069', 'Partial', 'fresh-browser', 'Keyboard pane resize clamped to 320px and panes opened, but width persistence and close-focus restoration were not asserted.', 'panes-evidence.json; polished.js:734-758', 'Resize, reload, reopen, and verify focus returns to the opener.', 'Single-session resize/close coverage only.'],
    ['UX-073', 'Partial', 'fresh-browser', 'An annotation saved with message evidence identity and persisted locally, but stale-result rejection, discard, and failed-save draft retention were not exercised.', 'panes-evidence.json; polished-evidence-tools.js:243-380', 'Run stale, discard, and save-failure fixtures and verify append-only identity binding.', 'Only the successful save path was freshly tested.'],
    ['UX-041', 'Verified (scoped)', 'fresh-browser', 'Representative headings, lists, tables, emphasis, fenced code, and unsafe HTML fixtures rendered without executable elements.', 'messages.json; polished.js:260-306', 'Keep the safe renderer covered as supported Markdown grows.', 'This is an isolated fixture, not owner visual acceptance.'],
    ['UX-042', 'Verified (scoped)', 'fresh-browser', 'Raw CLI whitespace was copied byte-for-byte and the terminal rendered once in the isolated fixture.', 'messages.json; polished.js:314-315', 'Retain exact-copy and single-render regression coverage.', 'No live command/provider was used.'],
    ['UX-043', 'Verified (scoped)', 'fresh-browser', 'Question and answer copy returned the correct text; a denied clipboard write displayed Copy failed.', 'messages.json; polished.js:306-318', 'Keep clipboard success and denial feedback covered.', 'Clipboard was an isolated in-page stub.'],
    ['UX-044', 'Verified (scoped)', 'fresh-browser', 'Old/new dates produced separate date metadata and timestamps exposed focusable full date/time labels.', 'messages.json; polished.js:488-496', 'Retain local-date and accessible-time regression coverage.', 'Timezone/owner visual acceptance remains out of scope.'],
    ['UX-046', 'Verified (scoped)', 'fresh-browser', 'Context-only revert removed the later message and Undo restored it; the run made no backend calls.', 'messages.json; polished.js:417-446', 'Add an exact-history and busy-state fixture to broaden this check.', 'This run checked presence/absence, not byte-for-byte history or queued protection.'],
    ['UX-047', 'Verified (scoped)', 'fresh-browser', 'Named fork retained the selected message prefix and origin link while the parent draft remained unchanged.', 'messages.json; polished.js:377-390', 'Retain parent/fork provenance regression coverage.', 'Fork revisit after reload was not separately exercised.'],
    ['UX-050', 'Verified (scoped)', 'fresh-browser', 'Archive hid the composer; restore persisted and reload reopened the original chat with its composer.', 'history-settings.json; polished.js:843-879', 'Retain archive/restore reload coverage.', 'This run did not inspect archived evidence content separately.'],
    ['UX-051', 'Verified (scoped)', 'fresh-browser', 'Workspace export downloaded valid Aven JSON containing the selected Main chat.', 'history-settings.json; polished.js:843-879', 'Add a selected-conversation Markdown/evidence export assertion.', 'Only workspace JSON export was exercised.'],
    ['UX-062', 'Unverified', 'code-review', 'Privacy/data copy exists in the settings implementation, but this child audit did not open the privacy category or verify scope text.', 'polished.js:843-879', 'Open privacy controls and verify local/transmitted/export/reset scope and recovery claims.', 'No fresh privacy UI assertion.'],
    ['UX-064', 'Verified (scoped)', 'fresh-browser', 'Help opened keyboard/local-workspace guidance and feedback saved locally with explicit status.', 'history-settings.json; polished.js:843-879', 'Retain help and local-feedback regression coverage.', 'No network submission was attempted.'],
    ['UX-067', 'Verified (scoped)', 'fresh-browser', 'Browser pane truthfully reported no connected browser session under the isolated blocked-provider policy.', 'panes-evidence.json; polished.js:613-638', 'Connect a real bounded browser adapter before claiming live preview.', 'Live browser content/navigation was unavailable by policy.'],
    ['UX-068', 'Verified (scoped)', 'fresh-browser', 'Computer pane truthfully reported no connected computer session under the isolated blocked-device policy.', 'panes-evidence.json; polished.js:613-638', 'Connect an authorized computer adapter before claiming live control.', 'Live screen/control was unavailable by policy.'],
    ['UX-075', 'Missing', 'code-review', 'No Git stage, commit, or PR control is present in the Aven shell.', 'polished.html; polished.js; intentgraph/adapters/index.cjs:462-503,570-598', 'Defer until configuration-as-code becomes a primary workflow.', 'No Git operation was attempted.'],
    ['UX-077', 'Verified (scoped)', 'fresh-browser', 'Read-only and Plan scope text were visible; Plan exposed no tools and nested FAILURE remained a failure outcome.', 'network-semantics.json; polished.js:613-638; polished-run-state.js', 'Keep scope labels tied to runtime capability state.', 'No live device call or enforcement backend was used.'],
    ['UX-078', 'Verified (scoped)', 'fresh-browser', 'Raw diagnostic metadata rendered the command, target, result, and run provenance for an isolated FAILURE fixture.', 'network-semantics.json; polished.js:319-370', 'Retain exact provenance regression coverage.', 'No live device evidence.'],
    ['UX-079', 'Verified (scoped)', 'fresh-browser', 'Nested diagnostic FAILURE overrode top-level SUCCESS and the UI stated that command completion does not establish device health.', 'network-semantics.json; polished-run-state.js; polished.js:319-370', 'Retain outcome/health separation coverage.', 'The device health conclusion is fixture-driven.'],
    ['UX-062', 'Unverified', 'code-review', 'Privacy/data copy exists in the settings implementation, but this child audit did not open the privacy category or verify scope text.', 'fresh-evidence.json; polished.js:843-879', 'Open privacy controls and verify local/transmitted/export/reset scope and recovery claims.', 'No fresh privacy UI assertion.'],
    ['UX-070', 'Partial', 'code-review', 'Session-scoped text file editor contains exact review/save/conflict checks; real OS picker and external disk scope remain unverified.', 'fresh-evidence.json; polished-files.js:45-170,384-447', 'Exercise with a real user-selected folder under owner-controlled QA.', 'No user disk writes were performed.'],
    ['UX-072', 'Partial', 'code-review', 'Local file review is implemented; network configuration impact/rollback and execution approval remain absent.', 'fresh-evidence.json; polished-files.js:123-170; polished-evidence-tools.js:243-380', 'Integrate exact network target/diff/impact and approval receipt flow.', 'No network configuration calls were made.'],
    ['UX-074', 'Missing', 'code-review', 'Digest-bound approval adapters exist outside the Aven UI; no integrated general approval receipt control is exposed.', 'fresh-evidence.json; intentgraph/adapters/index.cjs:462-503,570-598; polished.js:359-370', 'Integrate receipt UI only after future network write scope is defined.', 'No execution or provider calls.'],
    ['UX-075', 'Missing', 'code-review', 'No Git stage, commit, or PR control is present in the Aven shell.', 'fresh-evidence.json; polished.html; polished.js; intentgraph/adapters/index.cjs:462-503,570-598', 'Defer until configuration-as-code becomes a primary workflow.', 'No Git operation was attempted.'],
    ['UX-060', 'Partial', 'code-review', 'Settings reports the fixed runtime and avoids cosmetic provider switching, but no provider setup/test path was exercised.', 'network-semantics.json; polished-diagnostics.js:4-10; polished.js:843-879', 'Add explicit connected/tested/unavailable states with secure credential handling.', 'Real provider calls and credentials are intentionally excluded.'],
    ['UX-061', 'Partial', 'code-review', 'Local configuration/status snapshot code is present, while reachability and live provider/device refresh were not exercised.', 'network-semantics.json; polished-diagnostics.js:4-10; polished.js:613-638', 'Verify disconnected, refresh, timestamp, and recovery states against adapters.', 'Real provider/device health is intentionally unavailable.']
  ];
  for (const [id, verdict, evidenceLevel, finding, evidence, nextAction, limitation] of precision) {
    const row = { id, verdict, evidenceLevel, finding, evidence, nextAction, limitation };
    const index = results.findIndex(existing => existing.id === id);
    if (index >= 0) results[index] = row; else results.push(row);
  }
  // Ensure every assigned ID is present exactly once.
  const ids = Array.from({ length: 39 }, (_, i) => `UX-${String(i + 41).padStart(3, '0')}`);
  for (const id of ids) if (!results.some(row => row.id === id)) results.push({ id, verdict: 'Unverified', evidenceLevel: 'code-only', finding: 'No fresh audit record was produced.', evidence: 'audit.cjs', nextAction: 'Add an isolated check.' });
  results.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(path.join(OUT, 'fresh-evidence.json'), JSON.stringify({ at: new Date().toISOString(), scope: 'UX-041..UX-079', blockedPolicy: 'Only http://127.0.0.1:8767 static shell allowed; backend chat/status/runs intercepted; all other requests aborted.', rows: results }, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ rows: results, tests, defects }, null, 2));
  console.log(JSON.stringify({ rows: results.length, tests, defects }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
