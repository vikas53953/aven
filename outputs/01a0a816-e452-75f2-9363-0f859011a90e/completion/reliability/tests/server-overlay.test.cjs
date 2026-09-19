'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const test = require('node:test');

const overlay = path.resolve(__dirname, '..', 'candidate', 'overlay');
const { start } = require(path.join(overlay, 'intentgraph', 'server.cjs'));
const { createReliabilityLedger } = require(path.join(overlay, 'intentgraph', 'reliability.cjs'));
const { FileStorage } = require(path.join(overlay, 'intentgraph', 'reliability-storage.cjs'));

const headers = {
  Origin: 'http://127.0.0.1:8767',
  Accept: 'application/x-ndjson',
  'Content-Type': 'application/json',
  'X-Aven-Chat': 'text-only'
};
const bodyFor = (chatId, requestId) => ({
  chatId,
  agentName: 'Mock provider',
  messages: [{ role: 'user', content: 'verify reliability' }],
  mode: 'inspect',
  requestId,
  idempotencyKey: 'idem:' + requestId
});
const executionOptions = {
  provider: { status: () => ({ available: true, provider: 'mock' }) },
  coordinator: { status: () => ({ available: true }), close() {} },
  adapters: { status: () => ({ available: true }), close() {} },
  delivery: { status: () => ({ available: true }) }
};
const sandbox = {
  async status() { return { available: true }; },
  async inventory() { return { files: [] }; },
  close() {}
};
const waitFor = async (predicate, timeoutMs = 1500) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for mock provider');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const closeServer = server => new Promise(resolve => server.close(resolve));

test('overlay server uses durable receipt for duplicate dispatches', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-overlay-'));
  let calls = 0;
  let release;
  const server = await start({
    root,
    port: 0,
    sandbox,
    chatResponder: async () => {
      calls += 1;
      return new Promise(resolve => { release = () => resolve({ text: 'mock complete', evidence: [] }); });
    },
    executionOptions
  });
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/chat';
    const preflight = await fetch('http://127.0.0.1:' + server.address().port + '/api/capabilities', { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-Aven-Chat' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /GET/);
    const capabilitiesResponse = await fetch('http://127.0.0.1:' + server.address().port + '/api/capabilities', { method: 'GET', headers: { Origin: headers.Origin, 'X-Aven-Chat': 'text-only' } });
    assert.equal(capabilitiesResponse.status, 200);
    const capabilities = await capabilitiesResponse.json();
    assert.equal(capabilities.runtime.allowConcurrentRuns, true, 'default service enables per-chat concurrency');
    assert.equal(capabilities.runtime.concurrency, 'per-chat');
    const body = bodyFor('duplicate-chat', 'duplicate-request');
    const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(first.status, 200);
    await waitFor(() => calls === 1);
    const whileRunning = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(whileRunning.status, 409);
    release();
    const firstEvents = (await first.text()).trim().split('\n').map(JSON.parse);
    assert.deepEqual(firstEvents.map(event => event.type), ['start', 'final', 'end']);
    const afterCompletion = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(afterCompletion.status, 409);
    const conflictingBody = { ...body, messages: [{ role: 'user', content: 'different request data' }] };
    const conflict = await fetch(url, { method: 'POST', headers, body: JSON.stringify(conflictingBody) });
    assert.equal(conflict.status, 409);
    assert.match((await conflict.json()).error, /reused with different data/);
    assert.equal(calls, 1);
    assert.equal(fs.readdirSync(path.join(root, '.intentgraph', 'evidence', 'runs')).length, 1);
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay explicit single-flight opt-out is advertised by capabilities', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-single-flight-'));
  const server = await start({ root, port: 0, allowConcurrentRuns: false, sandbox, chatResponder: async () => ({ text: 'unused', evidence: [] }), executionOptions });
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/capabilities', { headers: { Origin: headers.Origin } });
    assert.equal(response.status, 200);
    const capabilities = await response.json();
    assert.equal(capabilities.runtime.allowConcurrentRuns, false);
    assert.equal(capabilities.runtime.concurrency, 'single');
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay parallel opt-in isolates independent chats and cancellation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-parallel-'));
  const calls = [];
  const releases = new Map();
  const aborts = new Set();
  const firstController = new AbortController();
  const server = await start({
    root,
    port: 0,
    allowConcurrentRuns: true,
    sandbox,
    chatResponder: async ({ chatId, signal }) => {
      calls.push(chatId);
      return new Promise((resolve, reject) => {
        releases.set(chatId, () => resolve({ text: chatId + ' complete', evidence: [] }));
        signal.addEventListener('abort', () => {
          aborts.add(chatId);
          reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
        }, { once: true });
      });
    },
    executionOptions
  });
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/chat';
    const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor('parallel-a', 'parallel-a-request')), signal: firstController.signal });
    const second = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor('parallel-b', 'parallel-b-request')) });
    await waitFor(() => calls.length === 2);
    assert.deepEqual(calls.slice().sort(), ['parallel-a', 'parallel-b']);
    const sameChat = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor('parallel-a', 'parallel-a-second')) });
    assert.equal(sameChat.status, 409);
    firstController.abort();
    await first.body.cancel().catch(() => undefined);
    releases.get('parallel-b')();
    assert.deepEqual((await second.text()).trim().split('\n').map(JSON.parse).map(event => event.type), ['start', 'final', 'end']);
    await waitFor(() => aborts.has('parallel-a'));
    assert.equal(fs.readdirSync(path.join(root, '.intentgraph', 'evidence', 'runs')).length, 2);
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }

  const cancelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-cancel-'));
  let cancelledRunId;
  const cancelServer = await start({
    root: cancelRoot,
    port: 0,
    allowConcurrentRuns: true,
    sandbox,
    chatResponder: async ({ chatId, signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborts.add(chatId);
        reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
      }, { once: true });
      void resolve;
    }),
    executionOptions
  });
  try {
    const url = 'http://127.0.0.1:' + cancelServer.address().port + '/api/chat';
    const controller = new AbortController();
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor('cancel-chat', 'cancel-request')), signal: controller.signal });
    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    cancelledRunId = new TextDecoder().decode(firstChunk.value).trim().split('\n').map(JSON.parse).find(event => event.type === 'start')?.runId;
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await waitFor(() => aborts.has('cancel-chat'));
    await new Promise(resolve => setTimeout(resolve, 20));
    const inspectionStorage = new FileStorage(path.join(cancelRoot, '.intentgraph', 'runtime', 'reliability'));
    const ledger = createReliabilityLedger({
      storage: inspectionStorage,
      namespace: 'chat',
      ownerId: 'inspection',
      concurrency: 'parallel'
    });
    const state = ledger.snapshot();
    assert.equal(state.runs[cancelledRunId].status, 'UNKNOWN');
    inspectionStorage.close();
  } finally {
    await closeServer(cancelServer);
    fs.rmSync(cancelRoot, { recursive: true, force: true });
  }
});

test('overlay derives durable outcome from nested diagnostics and waiting-question replies', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-outcome-'));
  let responseMode = 'failure';
  const server = await start({
    root,
    port: 0,
    sandbox,
    chatResponder: async () => responseMode === 'failure'
      ? { text: 'The command failed.', result: { status: 'FAILURE', command: 'show version' } }
      : { text: '', status: 'waiting-question', pendingQuestion: { question: { id: 'site', prompt: 'Site name', choices: ['Lab'] }, token: 'private-token' } },
    executionOptions
  });
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/chat';
    const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor('nested-failure', 'nested-failure-request')) });
    assert.equal(first.status, 200);
    await first.text();
    const inspectionStorage = new FileStorage(path.join(root, '.intentgraph', 'runtime', 'reliability'));
    const firstLedger = createReliabilityLedger({
      storage: inspectionStorage,
      namespace: 'chat', ownerId: 'inspection'
    });
    const firstRun = Object.values(firstLedger.snapshot().runs).find(run => run.chatId === 'nested-failure');
    assert.equal(firstRun.status, 'FAILURE');

    responseMode = 'waiting';
    const second = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor('waiting-chat', 'waiting-request')) });
    assert.equal(second.status, 200);
    const events = (await second.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events.find(event => event.type === 'final').reply.status, 'waiting-question');
    const secondRun = Object.values(firstLedger.snapshot().runs).find(run => run.chatId === 'waiting-chat');
    assert.equal(secondRun.status, 'WAITING');
    assert.equal(secondRun.result.pendingQuestion.prompt, 'Site name');
    assert.equal(JSON.stringify(secondRun.result).includes('private-token'), false);
    inspectionStorage.close();
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay recovery is an explicit owner-scoped operation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-recovery-'));
  const server = await start({ root, port: 0, sandbox, chatResponder: async () => ({ text: 'unused', evidence: [] }), executionOptions });
  try {
    const reliability = server.intentGraph.reliability;
    const abandoned = reliability.claimRun('abandoned-chat', {
      requestId: 'abandoned-request', idempotencyKey: 'abandoned-claim', ownerId: 'service-999999-previous-session'
    });
    const recoveryUrl = 'http://127.0.0.1:' + server.address().port + '/api/chat/recovery';
    const unauthorized = await fetch(recoveryUrl, { method: 'POST', headers, body: JSON.stringify({}) });
    assert.equal(unauthorized.status, 403);
    assert.equal(reliability.getRun(abandoned.run.runId).status, 'RUNNING');
    const probe = await fetch(recoveryUrl, { method: 'POST', headers, body: JSON.stringify({ authorized: true, probe: true }) });
    assert.equal(probe.status, 200);
    const probeResult = await probe.json();
    assert.equal(probeResult.probe, true);
    assert.ok(probeResult.activeRequestIds.includes('abandoned-request'));
    assert.equal(reliability.getRun(abandoned.run.runId).status, 'RUNNING', 'a probe never mutates an active run');
    const authorized = await fetch(recoveryUrl, { method: 'POST', headers, body: JSON.stringify({ authorized: true }) });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).count, 1);
    assert.equal(reliability.getRun(abandoned.run.runId).status, 'UNKNOWN');
    const claim = reliability.claimRun('recovery-chat', {
      requestId: 'recovery-request', idempotencyKey: 'recovery-claim', ownerId: reliability.ownerId
    });
    assert.equal(claim.run.status, 'RUNNING');
    assert.throws(() => server.intentGraph.recoverReliability(), error => error.code === 'recovery_authorization_required');
    assert.equal(reliability.getRun(claim.run.runId).status, 'RUNNING');
    const result = server.intentGraph.recoverReliability({ authorized: true, ownerId: reliability.ownerId });
    assert.deepEqual(result, { recovered: true, count: 1 });
    assert.equal(reliability.getRun(claim.run.runId).status, 'UNKNOWN');
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay server restart leaves a dead-owner run UNKNOWN until explicit recovery', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-restart-'));
  const helper = path.join(root, 'claim-and-exit.cjs');
  const serverModule = path.join(overlay, 'intentgraph', 'server.cjs');
  fs.writeFileSync(helper, `
const { start } = require(${JSON.stringify(serverModule)});
const root = process.argv[2];
const sandbox = { async status(){ return { available:true }; }, async inventory(){ return { files:[] }; }, close(){} };
const executionOptions = { provider:{ status:()=>({ available:true, provider:'mock' }) }, coordinator:{ close(){} }, adapters:{ close(){} }, delivery:{} };
(async()=>{ const server=await start({ root, port:0, sandbox, chatResponder:async()=>({ text:'unused', evidence:[] }), executionOptions }); const ownerId='service-'+process.pid+'-abandoned'; const claim=server.intentGraph.reliability.claimRun('restart-chat',{ requestId:'restart-request', idempotencyKey:'restart-claim', ownerId }); process.stdout.write(JSON.stringify({ port:server.address().port, runId:claim.run.runId, ownerId })+'\\n'); })().catch(error=>{ console.error(error); process.exitCode=1; });
`);
  const child = spawn(process.execPath, [helper, root], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  try {
    await waitFor(() => output.includes('"runId"'), 5000);
    const claimed = JSON.parse(output.trim().split(/\r?\n/)[0]);
    child.kill();
    await once(child, 'exit');

    const server = await start({ root, port: 0, sandbox, chatResponder: async () => ({ text: 'unused', evidence: [] }), executionOptions });
    try {
      const reliability = server.intentGraph.reliability;
      const recoveryUrl = 'http://127.0.0.1:' + server.address().port + '/api/chat/recovery';
      assert.equal(reliability.getRun(claimed.runId).status, 'RUNNING');
      const unauthorized = await fetch(recoveryUrl, { method: 'POST', headers, body: JSON.stringify({}) });
      assert.equal(unauthorized.status, 403);
      assert.equal(reliability.getRun(claimed.runId).status, 'RUNNING');
      const authorized = await fetch(recoveryUrl, { method: 'POST', headers, body: JSON.stringify({ authorized: true }) });
      assert.equal(authorized.status, 200);
      assert.equal((await authorized.json()).count, 1);
      assert.equal(reliability.getRun(claimed.runId).status, 'UNKNOWN');
    } finally {
      await closeServer(server);
    }
  } finally {
    if (!child.killed) child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay graceful close fences its own claims before same-process restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-graceful-restart-'));
  let server = await start({ root, port: 0, sandbox, chatResponder: async () => ({ text: 'unused', evidence: [] }), executionOptions });
  try {
    const firstReliability = server.intentGraph.reliability;
    const claim = firstReliability.claimRun('graceful-chat', {
      requestId: 'graceful-request', idempotencyKey: 'graceful-claim', ownerId: firstReliability.ownerId
    });
    assert.equal(claim.run.status, 'RUNNING');
    await closeServer(server);
    server = null;

    const inspectionStorage = new FileStorage(path.join(root, '.intentgraph', 'runtime', 'reliability'));
    const inspection = createReliabilityLedger({ storage: inspectionStorage, namespace: 'chat', ownerId: 'inspection' });
    assert.equal(inspection.getRun(claim.run.runId).status, 'UNKNOWN', 'graceful shutdown fences work owned by the closed service');
    inspectionStorage.close();

    server = await start({ root, port: 0, sandbox, chatResponder: async () => ({ text: 'unused', evidence: [] }), executionOptions });
    const resumed = server.intentGraph.reliability.claimRun('graceful-chat', {
      requestId: 'graceful-request-2', idempotencyKey: 'graceful-claim-2', ownerId: server.intentGraph.reliability.ownerId
    });
    assert.equal(resumed.accepted, true, 'a same-process restart can make a fresh claim after shutdown fencing');
  } finally {
    if (server) await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay steering is bound to the active run and applies before the mock next step', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-steer-'));
  const server = await start({
    root,
    port: 0,
    sandbox,
    chatResponder: async ({ drainSteering, onEvent }) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const steering = drainSteering();
        if (steering.length) {
          onEvent({ type: 'steer_applied', id: steering[0].id, message: steering[0].message });
          return { text: 'completed after correction', evidence: [] };
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      return { text: 'completed without correction', evidence: [] };
    },
    executionOptions
  });
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/chat';
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyFor('steer-chat', 'steer-request')) });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    const startEvent = new TextDecoder().decode(firstChunk.value).trim().split('\n').map(JSON.parse).find(event => event.type === 'start');
    assert.ok(startEvent?.runId && startEvent?.steeringToken);
    const steer = await fetch(url + '/steer', {
      method: 'POST',
      headers: { ...headers, Accept: 'application/json' },
      body: JSON.stringify({ runId: startEvent.runId, chatId: 'steer-chat', steeringToken: startEvent.steeringToken, text: 'Use the corrected site.' })
    });
    assert.equal(steer.status, 200);
    assert.equal((await steer.json()).accepted, true);
    const chunks = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    const events = new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.ok(events.some(event => event.type === 'steer_applied'));
    assert.ok(events.some(event => event.type === 'final'));
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay server fails closed before provider dispatch when runtime storage is unavailable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-storage-'));
  const brokenRuntime = path.join(root, 'runtime-file');
  fs.writeFileSync(brokenRuntime, 'occupied');
  let calls = 0;
  await assert.rejects(
    () => start({
      root,
      runtimeDirectory: brokenRuntime,
      port: 0,
      sandbox,
      chatResponder: async () => { calls += 1; return { text: 'unexpected', evidence: [] }; },
      executionOptions
    }),
    /ENOTDIR|not a directory|EEXIST/
  );
  assert.equal(calls, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
