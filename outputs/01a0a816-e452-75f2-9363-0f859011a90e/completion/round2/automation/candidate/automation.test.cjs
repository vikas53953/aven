'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function findProjectRoot(start) {
  let current = path.resolve(start);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'intentgraph', 'node_modules'))) return current;
    current = path.dirname(current);
  }
  return path.resolve(start);
}
const project = findProjectRoot(__dirname);
const { chromium } = require(path.resolve(project, 'intentgraph', 'node_modules', 'playwright'));
const automation = require('./polished-automation.js');
const backup = require('./polished-backup.js');
const assembledServer = require('./intentgraph/server.cjs');

const candidate = __dirname;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'polished.html';
    const candidatePath = path.join(candidate, relative);
    const projectPath = path.join(project, relative);
    const file = fs.existsSync(candidatePath) ? candidatePath : projectPath;
    if (!file.startsWith(project) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const next = automation.nextRunAt({ cadence: 'daily', timezone: 'Asia/Kolkata', timeOfDay: '09:00', from: '2026-09-16T00:00:00.000Z' });
  assert.equal(next, '2026-09-16T03:30:00.000Z');
  assert.equal(automation.nextRunAt({ cadence: 'weekly', timezone: 'UTC', timeOfDay: '09:00', weekday: 2, from: '2026-09-16T00:00:00.000Z' }), '2026-09-22T09:00:00.000Z');
  assert.equal(automation.dueSchedules({ schedules: [{ id: 'disabled', enabled: false, nextRunAt: '2020-01-01T00:00:00.000Z' }] }, '2026-09-16T00:00:00.000Z').length, 0);
  const due = { version: 1, schedules: [{ id: 's', title: 'S', taskId: 'c', workflowId: 'evidence-review', workflowVersion: '1.0.0', cadence: 'daily', timezone: 'UTC', timeOfDay: '09:00', weekday: 1, enabled: true, nextRunAt: '2026-09-16T00:00:00.000Z', history: [{ id: 'h', runId: 'r0', status: 'SUCCESS', outputRef: { chatId: 'c', messageId: 'm' } }], failures: [] }] };
  let calls = 0;
  const dispatch = await automation.dispatchDue(due, { now: '2026-09-16T00:05:00.000Z', adapter: { authorized: true, dispatch: async () => { calls += 1; return { runId: 'r1' }; } } });
  assert.equal(calls, 1);
  const replayState = automation.normalizeState(dispatch.state); replayState.schedules[0].nextRunAt = due.schedules[0].nextRunAt;
  const replay = await automation.dispatchDue(replayState, { now: '2026-09-16T00:05:00.000Z', adapter: { authorized: true, dispatch: async () => { calls += 1; } } });
  assert.equal(calls, 1);
  assert.equal(replay.results[0].status, 'DEDUPED');
  const pausedFuture = automation.normalizeState({ ...due, schedules: due.schedules.map((schedule) => ({ ...schedule, enabled: false, nextRunAt: '2026-09-20T09:00:00.000Z', history: [], failures: [] })) });
  let manualCalls = 0;
  const manual = await automation.dispatchScheduleNow(pausedFuture, 's', { now: '2026-09-16T00:05:00.000Z', adapter: { authorized: true, dispatch: async () => { manualCalls += 1; return { runId: 'manual-run' }; } } });
  assert.equal(manualCalls, 1);
  assert.equal(manual.results[0].trigger, 'manual');
  assert.equal(manual.state.schedules[0].enabled, false);
  assert.equal(manual.state.schedules[0].nextRunAt, '2026-09-20T09:00:00.000Z');
  const twoPaused = automation.normalizeState({ ...pausedFuture, schedules: [pausedFuture.schedules[0], { ...pausedFuture.schedules[0], id: 's2', title: 'Second job' }] });
  let selectedCalls = 0;
  const selected = await automation.dispatchScheduleNow(twoPaused, 's', { now: '2026-09-16T00:06:00.000Z', adapter: { authorized: true, dispatch: async () => { selectedCalls += 1; return { runId: 'selected-run' }; } } });
  assert.equal(selectedCalls, 1);
  assert.equal(selected.results.length, 1);
  assert.equal(selected.state.schedules.find((schedule) => schedule.id === 's2').history.length, 0);
  let releaseManual;
  let latestManual = pausedFuture;
  const concurrentManual = automation.dispatchScheduleNow(latestManual, 's', { now: '2026-09-16T00:07:00.000Z', readState: () => latestManual, adapter: { authorized: true, dispatch: async () => new Promise((resolve) => { releaseManual = resolve; }) } });
  while (!releaseManual) await new Promise((resolve) => setTimeout(resolve, 0));
  latestManual = automation.updateSchedule(latestManual, 's', { title: 'Edited during manual run' }, '2026-09-16T00:07:01.000Z').state;
  releaseManual({ runId: 'edited-run' });
  const editedManual = await concurrentManual;
  assert.equal(editedManual.state.schedules[0].title, 'Edited during manual run');
  assert.equal(editedManual.state.schedules[0].history.length, 0);
  const failedManual = await automation.dispatchScheduleNow(pausedFuture, 's', { now: '2026-09-16T00:08:00.000Z', adapter: { authorized: true, dispatch: async () => { throw new Error('manual transport failure'); } } });
  assert.equal(failedManual.results[0].status, 'FAILED');
  assert.equal(failedManual.state.schedules[0].enabled, false);
  const failure = await automation.dispatchDue(due, { now: '2026-09-16T00:05:00.000Z', adapter: { authorized: true, dispatch: async () => { throw new Error('mock failure'); } } });
  assert.equal(failure.results[0].status, 'FAILED');
  assert.equal(failure.state.schedules[0].failures.at(-1).message, 'mock failure');
  const blocked = await automation.dispatchDue(due, { now: '2026-09-16T00:05:00.000Z' });
  assert.equal(blocked.results[0].status, 'BLOCKED');
  let latest = automation.normalizeState({ ...due, schedules: due.schedules.map((schedule) => ({ ...schedule, history: [], nextRunAt: '2026-09-16T00:00:00.000Z' })) });
  let releaseAdapter;
  const inFlight = automation.createScheduler({
    intervalMs: 100000,
    now: () => '2026-09-16T00:05:00.000Z',
    readState: () => latest,
    adapter: { authorized: true, dispatch: async () => new Promise((resolve) => { releaseAdapter = resolve; }) },
    onSave: (value) => { latest = value; return true; },
  });
  const pendingTick = inFlight.tick();
  while (!releaseAdapter) await new Promise((resolve) => setTimeout(resolve, 0));
  latest = automation.updateSchedule(latest, 's', { enabled: false }, '2026-09-16T00:05:01.000Z').state;
  releaseAdapter({ runId: 'race-run' });
  const disabledDuringDispatch = await pendingTick;
  assert.equal(disabledDuringDispatch.appliedResults, 0);
  assert.equal(latest.schedules[0].enabled, false);
  assert.equal(latest.schedules[0].history.length, 0);
  latest = automation.normalizeState({ ...due, schedules: due.schedules.map((schedule) => ({ ...schedule, history: [], nextRunAt: '2026-09-16T00:00:00.000Z' })) });
  let releaseDelete;
  const deleteScheduler = automation.createScheduler({
    intervalMs: 100000,
    now: () => '2026-09-16T00:05:00.000Z',
    readState: () => latest,
    adapter: { authorized: true, dispatch: async () => new Promise((resolve) => { releaseDelete = resolve; }) },
    onSave: (value) => { latest = value; return true; },
  });
  const deleteTick = deleteScheduler.tick();
  while (!releaseDelete) await new Promise((resolve) => setTimeout(resolve, 0));
  latest = { ...latest, schedules: [] };
  releaseDelete({ runId: 'deleted-run' });
  const deletedDuringDispatch = await deleteTick;
  assert.equal(deletedDuringDispatch.appliedResults, 0);
  assert.equal(latest.schedules.length, 0);
  latest = automation.normalizeState({ ...due, schedules: due.schedules.map((schedule) => ({ ...schedule, history: [], nextRunAt: '2026-09-16T00:00:00.000Z' })) });
  let saveAttempts = 0;
  const unsavedScheduler = automation.createScheduler({
    intervalMs: 100000,
    now: () => '2026-09-16T00:05:00.000Z',
    readState: () => latest,
    adapter: { authorized: true, dispatch: async () => ({ runId: 'unsaved-run' }) },
    onSave: () => { saveAttempts += 1; return false; },
  });
  const unsaved = await unsavedScheduler.tick();
  assert.equal(saveAttempts, 1);
  assert.equal(unsaved.persisted, false);
  assert.match(unsaved.saveError, /no automatic retry/);
  assert.equal(latest.schedules[0].history.length, 0);
  const unsavedAgain = await unsavedScheduler.tick();
  assert.equal(unsavedAgain.results.length, 0);
  assert.equal(saveAttempts, 1);
  const mergeLatest = automation.updateSchedule(due, 's', { title: 'Edited while running' }, '2026-09-16T00:05:01.000Z').state;
  const staleMerge = automation.mergeDispatchState(mergeLatest, dispatch);
  assert.equal(staleMerge.schedules[0].history.length, mergeLatest.schedules[0].history.length);
  const completeGoal = automation.goalCompletionCheck({ steps: [{ id: 's1', done: true, evidence: { chatId: 'c', messageId: 'm' } }], completionEvidence: { chatId: 'c', messageId: 'done' } }, ref => ref.chatId === 'c');
  assert.equal(completeGoal.ok, true);
  const incompleteGoal = automation.goalCompletionCheck({ steps: [{ id: 's1', done: true, evidence: { chatId: 'missing', messageId: 'm' } }], completionEvidence: { chatId: 'c', messageId: 'done' } }, ref => ref.chatId === 'c');
  assert.equal(incompleteGoal.ok, false);
  const muted = automation.recordNotification({ notifications: { muted: true, delivered: [] } }, { type: 'failure', taskId: 'chat-1', runId: 'r1', message: 'failed' });
  assert.equal(muted.delivered, false);
  const duplicate = automation.recordNotification(muted.state, { type: 'failure', taskId: 'chat-1', runId: 'r1', message: 'failed' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(automation.selectPlugin({ selectedPluginIds: [] }, 'catalyst-center').ok, false);
  assert.equal(automation.workflow('evidence-review', '0.0.1'), null);
  let dispatchedProcedure = null;
  const versioned = await automation.dispatchDue({ version: 1, schedules: [{ id: 'versioned', title: 'Versioned', taskId: 'c', workflowId: 'evidence-review', workflowVersion: '1.0.0', cadence: 'daily', timezone: 'UTC', timeOfDay: '09:00', weekday: 1, enabled: true, nextRunAt: '2026-09-16T00:00:00.000Z', history: [], failures: [] }] }, { now: '2026-09-16T00:05:00.000Z', adapter: { authorized: true, dispatch: async ({ procedure }) => { dispatchedProcedure = procedure; return { runId: 'versioned-run' }; } } });
  assert.deepEqual({ id: dispatchedProcedure.id, version: dispatchedProcedure.version }, { id: 'evidence-review', version: '1.0.0' });
  assert.equal(dispatchedProcedure.procedure, 'Open saved evidence, compare provenance, and record an explicit conclusion.');
  assert.deepEqual(dispatchedProcedure.requiredAccess, ['Local workspace']);
  assert.deepEqual(versioned.results[0].procedure, { id: 'evidence-review', version: '1.0.0' });
  assert.equal(versioned.state.schedules[0].history[0].workflowVersion, '1.0.0');
  let staleAdapterCalls = 0;
  const stale = await automation.dispatchDue({ version: 1, schedules: [{ id: 'stale', title: 'Stale', taskId: 'c', workflowId: 'evidence-review', workflowVersion: '9.9.9', cadence: 'daily', timezone: 'UTC', timeOfDay: '09:00', weekday: 1, enabled: true, nextRunAt: '2026-09-16T00:00:00.000Z', history: [], failures: [] }] }, { now: '2026-09-16T00:05:00.000Z', adapter: { authorized: true, dispatch: async () => { staleAdapterCalls += 1; } } });
  assert.equal(staleAdapterCalls, 0);
  assert.equal(stale.results[0].status, 'BLOCKED');
  assert.match(stale.results[0].error, /procedure version is unavailable/);
  assert.equal(stale.state.schedules[0].history[0].workflowVersion, '9.9.9');
  const staticSnapshot = automation.pluginRegistryFromSnapshot(null);
  assert.equal(staticSnapshot.ok, false);
  assert.match(staticSnapshot.error, /local capability status response/);
  const refreshed = automation.pluginRegistryFromSnapshot({ plugins: [{ id: 'catalyst-center', availability: 'available', connectionHealth: 'adapter-ready', availabilityReason: 'Injected test adapter is ready.', availabilitySource: 'isolated test adapter' }] });
  assert.equal(refreshed.ok, true);
  const catalyst = refreshed.registry.find((plugin) => plugin.id === 'catalyst-center');
  assert.equal(catalyst.availability, 'available');
  assert.equal(catalyst.connectionHealth, 'adapter-ready');
  assert.equal(catalyst.requiredPermissions.includes('approved adapter'), true);
  assert.equal(automation.selectPlugin({ selectedPluginIds: [] }, 'catalyst-center', true, refreshed.registry).state.selectedPluginIds.includes('catalyst-center'), true);
  assert.equal(automation.pluginRegistryFromSnapshot({ plugins: [{ id: 'catalyst-center', availability: 'available' }] }).registry.find((plugin) => plugin.id === 'catalyst-center').connectionHealth, 'unavailable');
  const hostSnapshot = automation.pluginRegistryFromSnapshot({ source: '/api/capabilities', providers: [{ id: 'opencode', status: 'connected', configured: true, connected: true, models: [{ id: 'mimo-v2.5', status: 'connected', efforts: ['none'] }] }], runtime: { dispatchAvailable: true, dispatch: true, deviceAdapterAvailable: false } });
  assert.equal(hostSnapshot.source, '/api/capabilities');
  assert.equal(hostSnapshot.registry.find((plugin) => plugin.id === 'opencode-runtime').availability, 'available');
  assert.equal(hostSnapshot.registry.find((plugin) => plugin.id === 'opencode-runtime').connectionHealth, 'connected');
  assert.equal(hostSnapshot.registry.find((plugin) => plugin.id === 'catalyst-center').availability, 'unavailable');
  const runtimeOnlySnapshot = automation.pluginRegistryFromSnapshot({ source: '/api/capabilities', providers: [{ id: 'opencode', reason: 'Provider status is unknown.' }], runtime: { dispatchAvailable: true, dispatch: true, deviceAdapterAvailable: false } });
  assert.equal(runtimeOnlySnapshot.registry.find((plugin) => plugin.id === 'opencode-runtime').availability, 'unavailable');
  let accessDispatches = 0;
  const accessBlocked = await automation.dispatchDue({ version: 1, schedules: [{ id: 'access', title: 'Network access', taskId: 'c', workflowId: 'network-health-check', workflowVersion: '1.0.0', cadence: 'daily', timezone: 'UTC', timeOfDay: '09:00', weekday: 1, enabled: true, nextRunAt: '2026-09-16T00:00:00.000Z', history: [], failures: [] }] }, { now: '2026-09-16T00:05:00.000Z', adapter: { authorized: true, access: ['Local workspace'], dispatch: async () => { accessDispatches += 1; } } });
  assert.equal(accessDispatches, 0);
  assert.equal(accessBlocked.results[0].status, 'BLOCKED');
  assert.match(accessBlocked.results[0].error, /An approved read-only network adapter/);
  const hostSource = fs.readFileSync(path.join(candidate, 'polished.js'), 'utf8');
  assert.match(hostSource, /api\/capabilities/);
  assert.match(hostSource, /scheduledProcedure/);
  assert.match(hostSource, /requiredAccess/);
  assert.match(hostSource, /tools:'disabled'/);

  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-automation-server-'));
  let actualServer;
  let actualResponderOptions;
  try {
    actualServer = await assembledServer.start({
      root: serverRoot,
      port: 0,
      getProviderCapabilities: async () => ({ schemaVersion: 1, checkedAt: new Date().toISOString(), providers: [{ id: 'opencode', status: 'connected', configured: true, connected: true, models: [{ id: 'mimo-v2.5', status: 'connected', efforts: ['none'] }] }] }),
      executionOptions: {
        provider: { status: async () => ({ last: { ok: true }, credentialStored: true }), complete: async () => ({ text: 'OK' }) },
        coordinator: { status: async () => ({}), close: async () => {} },
        adapters: { status: async () => ({ network: { available: false } }), close: async () => {} },
        delivery: { status: async () => ({}), close: async () => {} },
      },
      chatResponder: async (options) => { actualResponderOptions = options; return { text: 'Actual assembled server accepted the saved procedure.', source: 'isolated-server-test', mode: 'plan' }; },
    });
    const actualPort = actualServer.address().port;
    const actualContract = { id: 'evidence-review', name: 'Evidence review', version: '1.0.0', purpose: 'Review saved run evidence without issuing a new command.', inputs: ['conversation or run'], requiredAccess: ['Local workspace'], evidenceRequirements: ['Existing saved message or artifact reference'], procedure: 'Open saved evidence, compare provenance, and record an explicit conclusion.', mode: 'plan', tools: 'disabled', source: 'saved-conversation' };
    const actualResponse = await fetch(`http://127.0.0.1:${actualPort}/api/chat`, { method: 'POST', headers: { Origin: `http://127.0.0.1:${actualPort}`, 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only', Accept: 'application/json' }, body: JSON.stringify({ chatId: 'actual-chat', agentName: 'A', messages: [{ role: 'user', content: `Scheduled saved-conversation review: Evidence review · v1.0.0. The selected procedure contract is ${JSON.stringify(actualContract)}.` }], mode: 'plan', context: { windowMessages: 1, windowCharacters: 256, retainedMessages: 1, retainedCharacters: 256, omittedMessages: 0, totalMessages: 1 }, requestId: 'actual-server-request', idempotencyKey: 'actual-server-request' }) });
    assert.equal(actualResponse.status, 200);
    assert.equal((await actualResponse.json()).text, 'Actual assembled server accepted the saved procedure.');
    assert.equal(actualResponderOptions.context.scheduledProcedure, undefined);
    assert.match(actualResponderOptions.messages.at(-1).content, /"procedure":"Open saved evidence, compare provenance, and record an explicit conclusion\."/);
    assert.deepEqual(Object.keys(actualResponderOptions.context).sort(), ['omittedMessages', 'retainedCharacters', 'retainedMessages', 'totalMessages', 'windowCharacters', 'windowMessages']);
  } finally {
    if (actualServer) await new Promise((resolve) => actualServer.close(resolve));
    fs.rmSync(serverRoot, { recursive: true, force: true });
  }

  const envelope = { format: 'aven-workspace', version: 1, exportedAt: new Date().toISOString(), build: 'test', prefs: { activeAgent: 'a', agents: [{ id: 'a', name: 'A' }], sections: [] }, data: { activeChat: 'c', projects: [], channels: [], chats: [{ id: 'c', title: 'C', recipients: ['a'], messages: [], pendingQueue: [] }], workspaceTools: { ideas: [], goals: [], automation: due } }, docs: { a: { 'SOUL.md': '', 'MEMORY.md': '' } } };
  const imported = backup.parse(backup.serialize(envelope));
  assert.equal(imported.data.workspaceTools.automation.schedules.length, 1);
  assert.equal(imported.data.workspaceTools.automation.schedules[0].enabled, false);
  assert.equal(imported.data.workspaceTools.automation.schedules[0].reviewRequired, true);
  const merged = backup.mergeImported(envelope, envelope);
  assert.notEqual(merged.data.workspaceTools.automation.schedules.at(-1).taskId, 'c');
  assert.equal(merged.data.workspaceTools.automation.schedules.at(-1).enabled, false);
  assert.notEqual(merged.data.workspaceTools.automation.schedules.at(-1).history[0].outputRef.chatId, 'c');
  const storage = new Map(); const storageApi = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  backup.replace(storageApi, envelope, envelope, 'replace');
  assert.equal(JSON.parse(storage.get('aven-polished-chats-v1')).workspaceTools.automation.schedules[0].enabled, false);

  if (process.env.AVEN_SKIP_BROWSER === '1') {
    console.log(JSON.stringify({ pure: 'passed', backup: 'preserved', externalCalls: 0, disabledJobs: 'not executed', replayDedup: 'passed', failures: 'visible', staleVersion: 'blocked', unavailablePlugin: 'disabled' }));
    return;
  }
  const server = await serve();
  const address = server.address();
  let browser;
  try {
  browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let browserChatCalls = 0;
  let browserChatPayload;
  const fixtureCors = { 'access-control-allow-origin': `http://127.0.0.1:${address.port}`, 'access-control-allow-headers': 'X-Aven-Chat, Content-Type' };
  await page.route('http://127.0.0.1:8768/api/capabilities', async (route) => { await route.fulfill({ status: 200, headers: fixtureCors, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, source: '/api/capabilities', providers: [{ id: 'opencode', status: 'connected', configured: true, connected: true, models: [{ id: 'mimo-v2.5', status: 'connected', efforts: ['none'] }] }], runtime: { dispatchAvailable: true, dispatch: true, deviceAdapterAvailable: false } }) }); });
  await page.route('http://127.0.0.1:8768/api/chat', async (route) => { browserChatCalls += 1; browserChatPayload = route.request().postDataJSON(); await route.fulfill({ status: 200, headers: fixtureCors, contentType: 'application/json', body: JSON.stringify({ text: 'Saved mock evidence conclusion', source: 'local-test', mode: 'plan', runId: 'browser-run' }) }); });
  const uiData = JSON.parse(JSON.stringify(envelope.data)); uiData.chats[0].messages = [{ id: 'm1', role: 'assistant', text: 'Retained evidence message', createdAt: '2026-09-16T00:00:00.000Z' }]; uiData.workspaceTools.goals = [{ id: 'g1', title: 'Evidence goal', steps: [], completion: null }, { id: 'g2', title: 'Unresolved checklist', steps: [{ id: 'gs2', text: 'Needs retained proof', done: true }], completion: null }]; uiData.workspaceTools.automation = { version: 1, schedules: [], notifications: { muted: false, delivered: [] }, selectedPluginIds: [] };
  await page.addInitScript(({ prefs, data }) => { if (localStorage.getItem('aven-polished-chats-v1')) return; localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs)); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data)); localStorage.setItem('aven-polished-docs-v1', JSON.stringify({ a: { 'SOUL.md': '', 'MEMORY.md': '' } })); }, { prefs: { theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: '', activeAgent: 'a', provider: 'Not connected', model: '', browser: true, computer: false, sections: [], agents: [{ id: 'a', name: 'A', role: 'Review', timezone: 'Follow system', autoReview: false }] }, data: uiData });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/polished.html`); await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-destination="Goals"]').click(); await page.locator('.aven-workspace-tools-view').waitFor({ state: 'visible' });
  const unresolvedGoal = page.locator('[data-record-id="g2"]'); await unresolvedGoal.getByRole('button', { name: 'Edit' }).click(); await page.getByRole('button', { name: 'Save goal' }).click(); await page.getByText('Every checked step must cite an existing chat message as evidence.').waitFor({ state: 'visible' });
  const evidenceGoal = page.locator('[data-record-id="g1"]'); await evidenceGoal.getByRole('button', { name: 'Complete with evidence' }).click(); await page.locator('.aven-workspace-tools-evidence-picker').getByRole('button', { name: 'Use this evidence' }).click(); await page.waitForTimeout(100); await page.getByText('Manually completed', { exact: true }).waitFor({ state: 'visible' });
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await page.locator('[data-destination="Goals"]').click(); await page.locator('[data-record-id="g1"]').getByText('Manually completed', { exact: true }).waitFor({ state: 'visible' });
  await page.locator('#avatar').click(); await page.locator('[data-pane="automation"]').click();
  await assert.doesNotReject(async () => page.locator('.aven-automation-view').waitFor({ state: 'visible' }));
  assert.match(await page.locator('.aven-automation-description').textContent(), /only while Aven is open, using the selected local service and saved conversation/);
  assert.equal(await page.locator('[data-pane="automation"]').getAttribute('aria-selected'), 'true');
  const catalystCard = page.locator('.aven-automation-registry-card', { hasText: 'Catalyst Center' });
  assert.equal(await catalystCard.locator('input[type="checkbox"]').isDisabled(), true);
  assert.match(await catalystCard.textContent(), /Required access: Catalyst Center account/);
  assert.match(await catalystCard.textContent(), /Connection health: unavailable/);
  await page.getByRole('button', { name: 'Refresh availability' }).click();
  await page.getByText(/Availability refreshed from \/api\/capabilities/).waitFor({ state: 'visible' });
  const opencodeCard = page.locator('.aven-automation-registry-card', { hasText: 'OpenCode runtime' });
  assert.match(await opencodeCard.textContent(), /Available locally/);
  assert.match(await opencodeCard.textContent(), /Connection health: connected/);
  assert.match(await opencodeCard.textContent(), /Availability source: \/api\/capabilities/);
  assert.match(await catalystCard.textContent(), /Unavailable/);
  assert.match(await catalystCard.textContent(), /Connection health: adapter-unavailable/);
  assert.match(await catalystCard.textContent(), /Availability source: \/api\/capabilities/);
  const evidenceWorkflow = page.locator('.aven-automation-registry-card', { hasText: 'Evidence review' });
  assert.match(await evidenceWorkflow.textContent(), /Required access: Local workspace/);
  assert.match(await evidenceWorkflow.textContent(), /v1.0.0/);
  assert.equal(await page.locator('.aven-automation-view').getByRole('button', { name: 'Run now' }).count(), 0);
  await page.getByRole('button', { name: 'Add schedule' }).click(); await page.locator('#aven-automation-title').fill('Morning evidence review'); await page.locator('#aven-automation-cadence').selectOption('weekly'); await page.getByRole('button', { name: 'Save disabled schedule' }).click();
  assert.equal(await page.locator('.aven-automation-badge', { hasText: 'Disabled' }).count(), 1);
  assert.equal(await page.locator('[data-schedule-id]').getByRole('button', { name: 'Run now' }).isDisabled(), false);
  await page.locator('[data-schedule-id]').getByRole('button', { name: 'Run now' }).click();
  await page.getByText('Run recorded: Succeeded.').waitFor({ state: 'visible' });
  assert.equal(browserChatCalls, 1);
  assert.equal(browserChatPayload.mode, 'plan');
  assert.deepEqual(Object.keys(browserChatPayload.context).sort(), ['omittedMessages', 'retainedCharacters', 'retainedMessages', 'totalMessages', 'windowCharacters', 'windowMessages']);
  assert.equal(browserChatPayload.context.scheduledProcedure, undefined);
  const scheduledContent = browserChatPayload.messages.at(-1).content || browserChatPayload.messages.at(-1).text || '';
  assert.match(scheduledContent, /Evidence review · v1\.0\.0/);
  assert.match(scheduledContent, /"id":"evidence-review"/);
  assert.match(scheduledContent, /"version":"1\.0\.0"/);
  assert.match(scheduledContent, /"requiredAccess":\["Local workspace"\]/);
  assert.match(scheduledContent, /"procedure":"Open saved evidence, compare provenance, and record an explicit conclusion\."/);
  assert.match(scheduledContent, /"tools":"disabled"/);
  assert.equal(await page.locator('[data-schedule-id] .aven-automation-badge', { hasText: 'Disabled' }).count(), 1);
  assert.equal(await page.locator('[data-schedule-id]').getByRole('button', { name: /History \(1\)/ }).count(), 1);
  await page.locator('[data-schedule-id]').getByRole('button', { name: /History \(1\)/ }).click();
  assert.match(await page.locator('[data-schedule-id] .aven-automation-history').textContent(), /evidence-review · v1\.0\.0/);
  await page.locator('[data-schedule-id]').getByRole('button', { name: 'Enable' }).click();
  assert.equal(await page.locator('.aven-automation-badge', { hasText: 'Enabled' }).count(), 1);
  await page.locator('#close-pane').click(); await page.locator('#account-button').click(); await page.locator('[data-account-action="settings"]').click(); await page.locator('[data-category="automation"]').click();
  assert.equal(await page.locator('#settings-content .aven-automation-view').count(), 1);
  assert.equal(errors.length, 0, errors.join('; '));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(JSON.stringify({ pure: 'passed', backup: 'preserved', browser: 'passed', externalCalls: 0, disabledJobs: 'not executed', replayDedup: 'passed', failures: 'visible', staleVersion: 'blocked', unavailablePlugin: 'disabled' }));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
