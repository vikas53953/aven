'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const {
  ApprovalBridge,
  ReviewLedger,
  createAdapterStateProvider,
  createApprovalBridgeHttpApi,
  scopeKey,
  isDirectAdapterOperation,
  assertNoDirectAdapterBypass
} = require('./approval-bridge.cjs');
const { createApprovalBridgeClient, chatExecutionMode } = require('./approval-bridge-ui.js');

function operation(mode = 'browser', kind = 'click') {
  if (mode === 'browser') return { type: `browser.preview`, pageId: 'page-1', kind, selector: '#apply', ...(kind === 'fill' ? { text: 'bounded value' } : {}) };
  return { type: 'desktop.preview', kind, targetControl: { controlKind: 'Button', title: 'Apply', automationId: 'apply' }, ...(kind === 'fill' ? { text: 'bounded value' } : {}) };
}

function scope(mode = 'browser') {
  return mode === 'desktop'
    ? { targets: [{ window: { hwnd: 101, pid: 202, processCreationTime: '303' } }], purpose: 'review-only' }
    : { targets: [{ pageId: 'page-1' }], purpose: 'review-only' };
}

function createFacade({ failExecute = false, identity = 'adapter-v1' } = {}) {
  const calls = [];
  let currentIdentity = identity;
  return {
    calls,
    set identity(value) { currentIdentity = value; },
    adapterIdentity() { return currentIdentity; },
    async action(input) {
      calls.push(JSON.parse(JSON.stringify(input)));
      if (input.operation?.type?.endsWith('.preview')) {
        return {
          approvalId: 'adapter-token-once',
          token: 'adapter-secret-token',
          actionDigest: 'a'.repeat(64),
          ttlMs: 3000,
          detail: { element: { value: 'before-value' }, actionText: 'must-never-escape' }
        };
      }
      if (input.operation?.type?.endsWith('.execute')) {
        if (failExecute) throw new Error('transport interrupted after submission');
        assert.equal(input.operation.approvalId, 'adapter-token-once');
        assert.equal(input.operation.token, 'adapter-secret-token');
        return { executed: true, actionDigest: 'a'.repeat(64), detail: { text: 'must-never-escape' } };
      }
      throw new Error('unexpected operation');
    }
  };
}

function bridgeFixture(options = {}) {
  let current = 1_000;
  const facade = options.facade || createFacade(options);
  const bridge = new ApprovalBridge({
    executionFacade: facade,
    adapterState: options.adapterState || (() => ({ identity: facade.adapterIdentity(), sessionId: 'adapter-session-1', generation: 1, browserContextId: 'browser-context-test', selectedWindow: { hwnd: 101, pid: 202, processCreationTime: '303' }, selectedWindowFingerprint: 'selected-window-test' })),
    allowedOrigins: ['http://127.0.0.1:9876'],
    adapterIdentity: 'adapter-v1',
    tokenTtlMs: options.tokenTtlMs || 100,
    workflowTtlMs: options.workflowTtlMs || 100,
    now: () => current
  });
  return { bridge, facade, advance(ms) { current += ms; } };
}

function contextFromConnection(connection) {
  return {
    origin: connection.origin,
    header: 'approval-bridge',
    token: connection.token,
    sessionId: connection.sessionId,
    generation: connection.generation,
    connectionId: connection.connectionId,
    scopeKey: connection.scopeKey
  };
}

async function httpFixture() {
  let api;
  const server = http.createServer(async (req, res) => {
    let data = '';
    req.setEncoding('utf8');
    for await (const chunk of req) data += chunk;
    let body = {};
    if (data) {
      try { body = JSON.parse(data); } catch { body = {}; }
    }
    const outcome = await api.handle({ method: req.method, pathname: new URL(req.url, 'http://127.0.0.1').pathname, headers: req.headers, body });
    const encoded = JSON.stringify(outcome.body);
    res.writeHead(outcome.status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded), ...outcome.headers });
    res.end(encoded);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const facade = createFacade();
  const bridge = new ApprovalBridge({ executionFacade: facade, adapterState: () => ({ identity: facade.adapterIdentity(), sessionId: 'adapter-session-1', generation: 1, browserContextId: 'browser-context-http', selectedWindow: { hwnd: 101, pid: 202, processCreationTime: '303' }, selectedWindowFingerprint: 'selected-window-http' }), allowedOrigins: [origin], adapterIdentity: 'adapter-v1', tokenTtlMs: 5000, workflowTtlMs: 5000 });
  api = createApprovalBridgeHttpApi({ bridge });
  return { server, origin, facade, bridge };
}

async function request(origin, pathname, method, headers = {}, body) {
  const response = await fetch(`${origin}${pathname}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}

function requestHeaders(connection, overrides = {}) {
  return {
    Origin: connection.origin,
    'X-Aven-Approval': 'approval-bridge',
    'X-Aven-Approval-Token': connection.token,
    'X-Aven-Approval-Session': connection.sessionId,
    'X-Aven-Approval-Generation': String(connection.generation),
    'X-Aven-Approval-Connection': connection.connectionId,
    'X-Aven-Approval-Scope': connection.scopeKey,
    ...overrides
  };
}

test('actual HTTP bridge binds scoped token, origin, session, generation and scope on every review stage', async () => {
  const fixture = await httpFixture();
  try {
    const connected = await request(fixture.origin, '/api/approval-bridge/connect', 'POST', { Origin: fixture.origin, 'X-Aven-Approval': 'approval-bridge' }, { scope: scope(), adapterIdentity: 'adapter-v1', manualReviewOnly: true });
    assert.equal(connected.status, 200);
    const connection = connected.body;
    assert.ok(connection.token);
    const headers = requestHeaders(connection);
    const unguardedStatus = await request(fixture.origin, '/api/approval-bridge/status', 'GET');
    assert.notEqual(unguardedStatus.status, 200);
    const guardedStatus = await request(fixture.origin, '/api/approval-bridge/status', 'GET', headers);
    assert.equal(guardedStatus.status, 200);
    const preview = await request(fixture.origin, '/api/approval-bridge/preview', 'POST', headers, { mode: 'browser', targetScope: scope(), operation: operation() });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.currentValue.value, 'before-value');
    assert.match(preview.body.actionSummary, /browser/i);
    assert.match(preview.body.targetSummary, /browser page/i);
    assert.equal(preview.body.operation, undefined, 'engineering operation details stay out of the user review');
    assert.equal(preview.body.digest.length, 64);
    assert.equal(JSON.stringify(preview.body).includes('must-never-escape'), false, 'raw action text must not cross the bridge response');
    const reviewed = await request(fixture.origin, '/api/approval-bridge/review', 'POST', headers, { previewToken: preview.body.previewToken, digest: preview.body.digest });
    assert.equal(reviewed.status, 200);
    const approved = await request(fixture.origin, '/api/approval-bridge/approve', 'POST', headers, { previewToken: preview.body.previewToken, digest: preview.body.digest, approved: true });
    assert.equal(approved.status, 200);
    assert.ok(approved.body.approvalToken);
    const executed = await request(fixture.origin, '/api/approval-bridge/execute', 'POST', headers, { approvalToken: approved.body.approvalToken, digest: approved.body.digest });
    assert.equal(executed.status, 200, JSON.stringify(executed.body));
    assert.equal(executed.body.executed, true);
    const replay = await request(fixture.origin, '/api/approval-bridge/execute', 'POST', headers, { approvalToken: approved.body.approvalToken, digest: approved.body.digest });
    assert.equal(replay.status, 409);
    assert.equal(fixture.facade.calls.filter((call) => call.operation?.type === 'browser.execute').length, 1);
    assert.equal(fixture.facade.calls.some((call) => call.type !== 'execution.adapter'), false);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test('missing or stale origin/header/token/session/generation/connection/scope is rejected', async () => {
  const fixture = await httpFixture();
  try {
    const connected = await request(fixture.origin, '/api/approval-bridge/connect', 'POST', { Origin: fixture.origin, 'X-Aven-Approval': 'approval-bridge' }, { scope: scope(), adapterIdentity: 'adapter-v1' });
    const connection = connected.body;
    const base = requestHeaders(connection);
    for (const key of ['Origin', 'X-Aven-Approval', 'X-Aven-Approval-Token', 'X-Aven-Approval-Session', 'X-Aven-Approval-Generation', 'X-Aven-Approval-Connection', 'X-Aven-Approval-Scope']) {
      const headers = { ...base };
      delete headers[key];
      const result = await request(fixture.origin, '/api/approval-bridge/preview', 'POST', headers, { mode: 'browser', targetScope: scope(), operation: operation() });
      assert.notEqual(result.status, 200, key);
    }
    const wrongScope = await request(fixture.origin, '/api/approval-bridge/preview', 'POST', { ...base, 'X-Aven-Approval-Scope': scopeKey({ targets: [{ pageId: 'page-2' }] }) }, { mode: 'browser', targetScope: scope(), operation: operation() });
    assert.equal(wrongScope.status, 409);
    const wrongTarget = await request(fixture.origin, '/api/approval-bridge/preview', 'POST', base, { mode: 'browser', targetScope: { targets: [{ pageId: 'page-2' }] }, operation: operation() });
    assert.equal(wrongTarget.status, 403);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test('sensitive fills are rejected and arbitrary fill text is never returned or persisted', async () => {
  const fixture = await httpFixture();
  try {
    const connected = await request(fixture.origin, '/api/approval-bridge/connect', 'POST', { Origin: fixture.origin, 'X-Aven-Approval': 'approval-bridge' }, { scope: scope(), adapterIdentity: 'adapter-v1' });
    const connection = connected.body;
    const headers = requestHeaders(connection);
    const rejected = await request(fixture.origin, '/api/approval-bridge/preview', 'POST', headers, { mode: 'browser', targetScope: scope(), operation: { type: 'browser.preview', pageId: 'page-1', kind: 'fill', selector: '#password', text: 'super-secret-value' } });
    assert.equal(rejected.status, 422);
    assert.equal(fixture.facade.calls.length, 0);
    const accepted = await request(fixture.origin, '/api/approval-bridge/preview', 'POST', headers, { mode: 'browser', targetScope: scope(), operation: { type: 'browser.preview', pageId: 'page-1', kind: 'fill', selector: '#description', text: 'arbitrary fill text' } });
    assert.equal(accepted.status, 200);
    assert.equal(JSON.stringify(accepted.body).includes('arbitrary fill text'), false);
    const source = fs.readFileSync(path.join(__dirname, 'approval-bridge.cjs'), 'utf8');
    assert.doesNotMatch(source, /localStorage|writeFileSync/i);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test('rotation, reload, disconnect, expiry and adapter identity change revoke memory-only approvals', async () => {
  const fixture = bridgeFixture({ tokenTtlMs: 25, workflowTtlMs: 25 });
  const connection = fixture.bridge.connect({ origin: 'http://127.0.0.1:9876', scope: scope(), adapterIdentity: 'adapter-v1', manualReviewOnly: true });
  const context = contextFromConnection(connection);
  const preview = await fixture.bridge.preview(context, { mode: 'browser', targetScope: scope(), operation: operation() });
  const rotated = fixture.bridge.rotate(context);
    await assert.rejects(() => fixture.bridge.review(context, { previewToken: preview.previewToken, digest: preview.digest }), (cause) => ['APPROVAL_CONNECTION_STALE', 'APPROVAL_PREVIEW_INVALID'].includes(cause.code));
  assert.notEqual(rotated.token, connection.token);
  const newContext = contextFromConnection(rotated);
  const nextPreview = await fixture.bridge.preview(newContext, { mode: 'browser', targetScope: scope(), operation: operation() });
  fixture.facade.identity = 'adapter-v2';
  await assert.rejects(() => fixture.bridge.review(newContext, { previewToken: nextPreview.previewToken, digest: nextPreview.digest }), (cause) => cause.code === 'APPROVAL_ADAPTER_IDENTITY_CHANGED');
  const reconnected = fixture.bridge.connect({ origin: 'http://127.0.0.1:9876', scope: scope(), adapterIdentity: 'adapter-v2' });
  const reconnectedContext = contextFromConnection(reconnected);
  await fixture.bridge.preview(reconnectedContext, { mode: 'browser', targetScope: scope(), operation: operation() });
  fixture.advance(30);
  assert.equal(fixture.bridge.status().connected, false);
});

test('post-consumption adapter failure is terminal UNKNOWN and cannot be retried', async () => {
  const fixture = bridgeFixture({ facade: createFacade({ failExecute: true }) });
  const connection = fixture.bridge.connect({ origin: 'http://127.0.0.1:9876', scope: scope('desktop'), adapterIdentity: 'adapter-v1' });
  const context = contextFromConnection(connection);
  const preview = await fixture.bridge.preview(context, { mode: 'desktop', targetScope: scope('desktop'), operation: operation('desktop') });
  const approved = await fixture.bridge.approve(context, { previewToken: preview.previewToken, digest: preview.digest, approved: true });
  await assert.rejects(() => fixture.bridge.execute(context, { approvalToken: approved.approvalToken, digest: approved.digest }), (cause) => cause.code === 'APPROVAL_UNKNOWN' && cause.terminal === true && cause.retry === false);
  await assert.rejects(() => fixture.bridge.execute(context, { approvalToken: approved.approvalToken, digest: approved.digest }), (cause) => cause.code === 'APPROVAL_INVALID');
  assert.equal(fixture.facade.calls.filter((call) => call.operation?.type === 'desktop.execute').length, 1);
});

test('digest mismatch, direct action bypass, manual review and fixed rollback truth are guarded', async () => {
  const fixture = bridgeFixture();
  const connection = fixture.bridge.connect({ origin: 'http://127.0.0.1:9876', scope: scope(), adapterIdentity: 'adapter-v1', manualReviewOnly: true });
  const context = contextFromConnection(connection);
  const preview = await fixture.bridge.preview(context, { mode: 'browser', targetScope: scope(), operation: operation() });
  assert.equal(preview.rollback.available, false);
  assert.match(preview.rollback.reason, /Chat revert cannot roll back/);
  await assert.rejects(() => fixture.bridge.approve(context, { previewToken: preview.previewToken, digest: 'b'.repeat(64), approved: true }), (cause) => cause.code === 'APPROVAL_DIGEST_MISMATCH');
  assert.equal(isDirectAdapterOperation({ type: 'execution.adapter', operation: { type: 'browser.preview' } }), true);
  assert.throws(() => assertNoDirectAdapterBypass({ pathname: '/api/action', body: { type: 'execution.adapter', operation: { type: 'desktop.execute' } } }), (cause) => cause.code === 'APPROVAL_BRIDGE_REQUIRED' && cause.statusCode === 403);
  assert.equal(fixture.facade.calls.some((call) => call.type === 'manager.start' || call.type === 'model.dispatch'), false);
  assert.equal(fixture.bridge.status().manualReviewOnly, true);
  await assert.rejects(() => fixture.bridge.preview(context, { mode: 'network', executionMode: 'write', targetScope: scope(), operation: { type: 'network.preview', kind: 'write' } }), (cause) => cause.code === 'APPROVAL_DEVICE_WRITE_UNAVAILABLE');
});

test('actual adapter session identity changes revoke the connection and plan or inspect cannot prepare execution', async () => {
  const fixture = bridgeFixture();
  const adapterState = { identity: 'adapter-v1', sessionId: 'adapter-session-1', generation: 1, browserContextId: 'browser-context-session', selectedWindow: { hwnd: 101, pid: 202, processCreationTime: '303' }, selectedWindowFingerprint: 'selected-window-session' };
  const bridge = new ApprovalBridge({ executionFacade: fixture.facade, adapterState, allowedOrigins: ['http://127.0.0.1:9876'] });
  const connection = bridge.connect({ origin: 'http://127.0.0.1:9876', scope: scope(), adapterIdentity: 'adapter-v1' });
  const context = contextFromConnection(connection);
  await assert.rejects(() => bridge.preview(context, { mode: 'browser', executionMode: 'plan', targetScope: scope(), operation: operation() }), (cause) => cause.code === 'APPROVAL_EXECUTION_MODE_DENIED');
  adapterState.generation = 2;
  await assert.rejects(() => bridge.preview(context, { mode: 'browser', executionMode: 'write', targetScope: scope(), operation: operation() }), (cause) => cause.code === 'APPROVAL_ADAPTER_IDENTITY_CHANGED');
  assert.equal(bridge.status().connected, false);
});

test('production adapter state provider fingerprints actual browser context, page catalog and desktop selection', () => {
  const adapter = {
    browserContextId: 'browser-context-1',
    selectedWindow: null,
    pages: new Map([['page-1', { pageId: 'page-1', contextId: 'browser-context-1', page: { url: () => 'http://127.0.0.1:9876/' } }]]),
    status: () => ({ browser: { available: true, connected: true, pages: [] }, desktop: { selectedWindow: adapter.selectedWindow } }),
    constructor: { name: 'ExecutionAdapters' }
  };
  const state = createAdapterStateProvider(adapter);
  const first = state();
  assert.equal(first.identity.startsWith('execution-adapters:'), true);
  assert.equal(first.sessionId, 'browser-context-1');
  adapter.selectedWindow = { hwnd: 101, pid: 202, processCreationTime: '303' };
  const second = state();
  assert.equal(second.generation, first.generation + 1);
  adapter.browserContextId = 'browser-context-2';
  const third = state();
  assert.equal(third.sessionId, 'browser-context-2');
  assert.equal(third.generation, second.generation + 1);
});

test('durable review ledger keeps binding metadata and marks active receipts UNKNOWN on reload without raw tokens or fill text', async () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'approval-bridge-ledger-'));
  const storagePath = path.join(directory, 'approval-reviews.sqlite');
  try {
    const first = bridgeFixture();
    first.bridge.reviewLedger = new ReviewLedger({ storagePath, now: () => 1_000 });
    const connection = first.bridge.connect({ origin: 'http://127.0.0.1:9876', scope: scope(), adapterIdentity: 'adapter-v1' });
    const context = contextFromConnection(connection);
    const preview = await first.bridge.preview(context, { mode: 'browser', targetScope: scope(), operation: { ...operation('browser', 'fill'), selector: '#description', text: 'raw fill must not persist' } });
    const approved = await first.bridge.approve(context, { previewToken: preview.previewToken, digest: preview.digest, approved: true });
    const raw = fs.readFileSync(storagePath).toString('base64');
    assert.equal(raw.includes(approved.approvalToken), false);
    first.bridge.reviewLedger.close();
    const second = bridgeFixture();
    second.bridge.reviewLedger = new ReviewLedger({ storagePath, now: () => 1_100 });
    second.bridge.reviewLedger.markActiveUnknown();
    const rows = second.bridge.reviewLedger.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'unknown');
    assert.equal(JSON.stringify(rows).includes('raw fill must not persist'), false);
    assert.equal(JSON.stringify(rows).includes(approved.approvalToken), false);
    second.bridge.reviewLedger.close();
  } finally {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

test('UI client keeps scoped tokens in memory, maps chat mode, and sends exact bridge headers', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith('/connect')
      ? { token: 'scope.secret', sessionId: 'session-1', generation: 1, connectionId: 'connection-1', scopeKey: 'scope-key', origin: 'http://127.0.0.1:9876' }
      : { previewToken: 'preview.secret', digest: 'd'.repeat(64), status: 'previewed' };
    return { ok: true, json: async () => body };
  };
  let mode = 'Agent';
  const client = createApprovalBridgeClient({ fetchImpl: fakeFetch, origin: 'http://127.0.0.1:9876', getMode: () => mode });
  assert.equal(chatExecutionMode(() => 'Agent'), 'inspect');
  assert.equal(chatExecutionMode(() => 'Plan'), 'plan');
  await client.connect({ scope: scope(), adapterIdentity: 'adapter-v1' });
  await assert.rejects(() => client.preview({ mode: 'browser', targetScope: scope(), operation: operation() }), /explicit write review/);
  mode = 'write';
  await client.preview({ mode: 'browser', targetScope: scope(), operation: operation(), executionMode: 'write' });
  const previewCall = calls.at(-1);
  assert.equal(previewCall.options.headers['X-Aven-Approval'], 'approval-bridge');
  assert.equal(previewCall.options.headers['X-Aven-Approval-Token'], 'scope.secret');
  assert.equal(client.connection().token, undefined);

  let adapterCalls = [];
  const targetClient = createApprovalBridgeClient({
    fetchImpl: fakeFetch,
    origin: 'http://127.0.0.1:9876',
    getMode: () => 'write',
    adapterClient: {
      async openBrowser(url) { adapterCalls.push(['browser.open', url]); return { pageId: 'actual-page-1' }; },
      async inspectBrowser(pageId) { adapterCalls.push(['browser.inspect', pageId]); return { pageId }; }
    }
  });
  const opened = await targetClient.openBrowser('http://127.0.0.1:8767/');
  assert.equal(opened.pageId, 'actual-page-1');
  assert.deepEqual(targetClient.target(), { mode: 'browser', pageId: 'actual-page-1' });
  assert.deepEqual(adapterCalls, [['browser.open', 'http://127.0.0.1:8767/'], ['browser.inspect', 'actual-page-1']]);
});
