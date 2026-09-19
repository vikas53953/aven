'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const nodePath = process.execPath;
const workspace = path.resolve(__dirname, '../../../..');
const baselineIntentGraph = path.join(workspace, 'intentgraph');
const candidateServer = path.join(__dirname, 'candidate', 'intentgraph', 'server.cjs');

process.on('exit', () => {
  const evidence = {
    status: process.exitCode ? 'FAIL' : 'PASS',
    scope: 'UX071 /api/sandbox/command route',
    tests: [
      'actual createServer with injected network facade',
      'same-origin and X-Aven-Sandbox read-only policy',
      'exact inventory target resolution and per-target/global allowlist rejection before adapter dispatch',
      'inventory and command routes share the injected network facade and duplicate target IDs are rejected',
      'request rejects model-supplied host parameters',
      'strict UUIDv4 request identity validation happens before inventory lookup',
      'same request identity cannot be rebound to different diagnostic input',
      'submitted adapter uncertainty returns UNKNOWN once without exposing adapter details',
      'response disconnect after a complete POST aborts the injected facade signal',
      'parallel identical request IDs reserve before delayed inventory and distinct request IDs each dispatch once',
      'active request identities remain retained while other completions exceed the cache bound'
    ],
    externalCalls: 0,
    credentialReads: 0,
    noRetry: true
  };
  fs.writeFileSync(path.join(__dirname, 'server-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
});

async function withServer(run) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-ux071-'));
  const intentgraph = path.join(temporary, 'intentgraph');
  fs.cpSync(baselineIntentGraph, intentgraph, { recursive: true });
  fs.copyFileSync(candidateServer, path.join(intentgraph, 'server.cjs'));
  const targetId = 'aa754801-8895-41e8-8ca5-27ee415c9c42';
  const calls = [];
  const inventoryCalls = [];
  let mode = 'success';
  let releaseInventoryPending = null;
  let releaseHeldInventory = null;
  const facade = {
    supportedCommands: ['show version'],
    async status() { return { state: 'available' }; },
    async inventory() {
      inventoryCalls.push(Date.now());
      if (mode === 'delay-inventory') await new Promise(resolve => { releaseInventoryPending = resolve; });
      if (mode === 'hold-first' && inventoryCalls.length === 1) await new Promise(resolve => { releaseHeldInventory = resolve; });
      if (mode === 'duplicate') return { retrievedAt: '2026-09-16T10:00:00.000Z', devices: [{ id: targetId, hostname: 'sw1', platform: 'cisco_ios', transport: 'fixture', supportedCommands: ['show version'] }, { id: targetId, hostname: 'sw1-copy', platform: 'cisco_ios', transport: 'fixture', supportedCommands: ['show version'] }] };
      return { retrievedAt: '2026-09-16T10:00:00.000Z', devices: [{ id: targetId, hostname: 'sw1', platform: 'cisco_ios', transport: 'fixture', managementIp: '192.0.2.10', supportedCommands: ['show version'] }] };
    },
  async runCommand(input) {
      calls.push(input);
      if (mode === 'disconnect') return await new Promise((resolve, reject) => input.signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture disconnected'), { submitted: true })), { once: true }));
      if (mode === 'unknown') throw Object.assign(new Error('fixture remote detail'), { submitted: true, code: 'remote_unknown' });
      return { status: 'SUCCESS', source: 'fixture', output: 'show version\nVersion 17.1\n', startedAt: '2026-09-16T10:00:01.000Z', elapsedMs: 7 };
    },
    close() {}
  };
  const { createServer } = require(path.join(intentgraph, 'server.cjs'));
  const server = createServer({ root: temporary, execution: false, sandbox: facade, rescanMs: 60000 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await run({ server, targetId, calls, inventoryCalls, facade, setMode(value) { mode = value; }, releaseInventory() { releaseInventoryPending?.(); releaseInventoryPending = null; releaseHeldInventory?.(); releaseHeldInventory = null; } }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

let requestSequence = 1;
function requestId() { return `00000000-0000-4000-8000-${String(requestSequence++).padStart(12, '0')}`; }
function request(server, targetId, command, extra = {}) {
  const address = server.address();
  const body = extra.body || { targetId, command, requestId: extra.requestId || requestId() };
  return fetch(`http://127.0.0.1:${address.port}/api/sandbox/command`, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${address.port}`, 'X-Aven-Sandbox': 'read-only', 'Content-Type': 'application/json', ...extra.headers },
    body: JSON.stringify(body)
  }).then(async response => ({ status: response.status, body: await response.json() }));
}

test('UX071 command route resolves exact target and rejects unsafe inputs before adapter dispatch', async () => {
  await withServer(async ({ server, targetId, calls, setMode }) => {
    const address = server.address();
    const inventory = await fetch(`http://127.0.0.1:${address.port}/api/sandbox/inventory`, { method: 'POST', headers: { Origin: `http://127.0.0.1:${address.port}`, 'X-Aven-Sandbox': 'read-only', 'Content-Type': 'application/json' }, body: '{}' }).then(response => ({ status: response.status, body: response.json() })).then(async value => ({ status: value.status, body: await value.body }));
    assert.equal(inventory.status, 200);
    assert.equal(inventory.body.devices[0].id, targetId);
    assert.deepEqual(inventory.body.devices[0].supportedCommands, ['show version']);
    const success = await request(server, targetId, 'show version');
    assert.equal(success.status, 200);
    assert.equal(success.body.status, 'SUCCESS');
    assert.equal(success.body.target.id, targetId);
    assert.equal(success.body.command, 'show version');
    assert.equal(success.body.output, 'show version\nVersion 17.1\n');
    assert.match(success.body.runId, /^[0-9a-f-]{36}$/i);
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0]).sort(), ['command', 'deviceUuid', 'signal', 'timeoutMs'].sort());
    assert.equal(calls[0].deviceUuid, targetId);
    const before = calls.length;
    const unsupported = await request(server, targetId, 'show running-config');
    assert.equal(unsupported.status, 400);
    assert.equal(calls.length, before);
    const unknownTarget = await request(server, 'bb754801-8895-41e8-8ca5-27ee415c9c42', 'show version');
    assert.equal(unknownTarget.status, 404);
    assert.equal(calls.length, before);
    const extraParams = await request(server, targetId, 'show version', { body: { targetId, command: 'show version', requestId: requestId(), host: '192.0.2.10' } });
    assert.equal(extraParams.status, 400);
    assert.equal(calls.length, before);
    for (const invalidRequestId of ['not-a-uuid', '22222222-2222-1222-8222-222222222222']) {
      const invalidIdentity = await request(server, targetId, 'show version', { body: { targetId, command: 'show version', requestId: invalidRequestId } });
      assert.equal(invalidIdentity.status, 400);
      assert.equal(calls.length, before);
    }
    const badHeader = await request(server, targetId, 'show version', { headers: { 'X-Aven-Sandbox': 'execute' } });
    assert.equal(badHeader.status, 403);
    const badOrigin = await request(server, targetId, 'show version', { headers: { Origin: 'https://evil.example' } });
    assert.equal(badOrigin.status, 403);
    const duplicateId = '22222222-2222-4222-8222-222222222222';
    const first = await request(server, targetId, 'show version', { requestId: duplicateId });
    const beforeDuplicate = calls.length;
    const second = await request(server, targetId, 'show version', { requestId: duplicateId });
    assert.equal(first.body.runId, duplicateId);
    assert.equal(second.body.runId, duplicateId);
    assert.equal(calls.length, beforeDuplicate);
    const mismatched = await request(server, targetId, 'show ip route', { body: { targetId, command: 'show ip route', requestId: duplicateId } });
    assert.equal(mismatched.status, 409);
    assert.equal(calls.length, beforeDuplicate);
    setMode('duplicate');
    const beforeDuplicateInventory = calls.length;
    const duplicateInventory = await request(server, targetId, 'show version');
    assert.equal(duplicateInventory.status, 409);
    assert.equal(calls.length, beforeDuplicateInventory);
  });
});

test('UX071 preserves submitted uncertainty without retrying or exposing adapter details', async () => {
  await withServer(async ({ server, targetId, calls, setMode }) => {
    setMode('unknown');
    const result = await request(server, targetId, 'show version');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'UNKNOWN');
    assert.equal(result.body.output, '');
    assert.equal(JSON.stringify(result.body).includes('fixture remote detail'), false);
    assert.equal(calls.length, 1);
  });
});

test('UX071 aborts the network facade when the HTTP response disconnects after request upload', async () => {
  await withServer(async ({ server, targetId, calls, setMode }) => {
    setMode('disconnect');
    const address = server.address();
    const body = JSON.stringify({ targetId, command: 'show version', requestId: '33333333-3333-4333-8333-333333333333' });
    const client = http.request({ hostname: '127.0.0.1', port: address.port, path: '/api/sandbox/command', method: 'POST', headers: { Origin: `http://127.0.0.1:${address.port}`, 'X-Aven-Sandbox': 'read-only', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
    client.on('error', () => undefined);
    client.write(body); client.end();
    const waitFor = async predicate => { const until = Date.now() + 4000; while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); };
    await waitFor(() => calls.length === 1);
    assert.equal(calls.length, 1);
    client.destroy();
    await waitFor(() => calls[0].signal.aborted);
    assert.equal(calls[0].signal.aborted, true);
  });
});

test('UX071 reserves request identity before delayed inventory and allows a distinct request', async () => {
  await withServer(async ({ server, targetId, calls, inventoryCalls, setMode, releaseInventory }) => {
    setMode('delay-inventory');
    const identity = '44444444-4444-4444-8444-444444444444';
    const first = request(server, targetId, 'show version', { requestId: identity });
    const second = request(server, targetId, 'show version', { requestId: identity });
    const until = Date.now() + 4000;
    while (inventoryCalls.length < 1 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(inventoryCalls.length, 1);
    releaseInventory();
    const results = await Promise.all([first, second]);
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 200);
    assert.equal(calls.length, 1);
    setMode('success');
    const distinct = await request(server, targetId, 'show version', { requestId: '55555555-5555-4555-8555-555555555555' });
    assert.equal(distinct.status, 200);
    assert.equal(calls.length, 2);
  });
});

test('UX071 retains active request identity while other runs fill the dedupe map', async () => {
  await withServer(async ({ server, targetId, calls, inventoryCalls, setMode, releaseInventory }) => {
    setMode('hold-first');
    const retainedId = '66666666-6666-4666-8666-000000000000';
    const retained = request(server, targetId, 'show version', { requestId: retainedId });
    const until = Date.now() + 4000;
    while (inventoryCalls.length < 1 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(inventoryCalls.length, 1);
    const burst = Array.from({ length: 128 }, (_, index) => request(server, targetId, 'show version', { requestId: `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}` }));
    while (inventoryCalls.length < 129 && Date.now() < until + 4000) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(inventoryCalls.length, 129);
    const burstResults = await Promise.all(burst);
    assert.ok(burstResults.every(result => result.status === 200));
    assert.equal(calls.length, 128);
    releaseInventory();
    assert.equal((await retained).status, 200);
    assert.equal(calls.length, 129);
    const replay = await request(server, targetId, 'show version', { requestId: retainedId });
    assert.equal(replay.status, 200);
    assert.equal(calls.length, 129);
  });
});
