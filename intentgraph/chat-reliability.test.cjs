'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('./server.cjs');

const headers = { Origin: 'http://127.0.0.1:8767', 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' };
const body = { chatId: 'chat-a', requestId: 'request-a', idempotencyKey: 'key-a', agentName: 'A', mode: 'plan', messages: [{ role: 'user', content: 'hello' }] };
const executionOptions = { provider: { status: () => ({}) }, coordinator: { close() {} }, adapters: { close() {} }, delivery: {} };
async function fixture(t, options = {}) {
  const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'aven-chat-receipts-'));
  const server = await start({ root, port: 0, sandbox: { close() {} }, executionOptions, ...options });
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await new Promise(r => server.close(r)); } };
  t.after(async () => { await close(); if (!options.root) fs.rmSync(root, { recursive: true, force: true }); });
  return { root, server, base, close,
    post: (value = body, suffix = '', extra = {}) => fetch(base + '/api/chat' + suffix, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) }),
    read: (chatId = body.chatId, requestId = body.requestId) => fetch(base + `/api/chat/receipt?chatId=${chatId}&requestId=${requestId}`, { headers }) };
}

test('actual API deduplicates concurrent, completed and restarted requests, preserving raw evidence', async t => {
  let calls = 0, finish;
  const raw = 'sw1# show version\r\nexact output\r\n';
  const f = await fixture(t, { chatResponder: async ({ mode }) => { calls++; assert.equal(mode, 'plan'); return new Promise(r => finish = () => r({ text: 'answer', evidence: [{ output: raw, status: 'FAILURE' }] })); } });
  const pending = f.post();
  while (!finish) await new Promise(r => setTimeout(r, 5));
  const duplicate = await (await f.post()).json();
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.receipt.state, 'admitted');
  const runId = duplicate.receipt.runId;
  assert.equal((await f.post({ ...body, messages: [{ role: 'user', content: 'changed' }] })).status, 409);
  assert.equal((await f.post({ ...body, chatId: 'chat-b' })).status, 409);
  assert.equal((await f.post({ ...body, chatId: 'chat-b', requestId: 'b', idempotencyKey: 'b' })).status, 409);
  assert.equal((await f.post({ chatId: body.chatId, requestId: body.requestId, runId }, '/recover')).status, 409);
  assert.equal((await f.read('wrong-chat')).status, 404);
  finish();
  const result = await (await pending).json();
  assert.equal(result.runId, runId); assert.equal(result.status, 'FAILURE');
  assert.equal(result.receipt.state, 'settled'); assert.equal(result.receipt.evidenceSaved, true);
  const receiptText = JSON.stringify(await (await f.read()).json());
  assert.doesNotMatch(receiptText, /owner|fingerprint|key-a|steeringToken/);
  const evidence = await (await fetch(f.base + `/api/chat/runs/${runId}?chatId=${body.chatId}`, { headers })).json();
  assert.equal(evidence.reply.evidence[0].output, raw);
  assert.equal((await (await f.post()).json()).duplicate, true);
  await f.close();
  const next = await fixture(t, { root: f.root, chatResponder: async () => { calls++; return { text: 'fresh' }; } });
  assert.equal((await (await next.post()).json()).receipt.runId, runId);
  assert.equal(calls, 1);
  assert.equal((await next.post({ ...body, requestId: 'fresh', idempotencyKey: 'fresh' })).status, 200);
  assert.equal(calls, 2);
  await next.close();
});

test('evidence persistence failure is visible, keeps admission blocked, and explicit recovery never dispatches', async t => {
  let calls = 0;
  const f = await fixture(t, { chatResponder: async () => { calls++; return { text: 'answer' }; }, persistChatEvidence: () => { throw Error('disk full'); } });
  const response = await f.post(body, '', { Accept: 'application/x-ndjson' });
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.some(e => e.type === 'final'), false);
  assert.equal(events.some(e => e.type === 'failed' && e.status === 'UNKNOWN'), true);
  const receipt = (await (await f.read()).json()).receipt;
  assert.equal(receipt.state, 'admitted'); assert.equal(receipt.recoverable, true);
  assert.equal((await f.post({ ...body, requestId: 'next', idempotencyKey: 'next' })).status, 409);
  assert.equal((await f.post({ chatId: 'other', requestId: body.requestId, runId: receipt.runId }, '/recover')).status, 404);
  const recovered = await (await f.post({ chatId: body.chatId, requestId: body.requestId, runId: receipt.runId }, '/recover')).json();
  assert.equal(recovered.receipt.outcome, 'UNKNOWN');
  assert.equal((await (await f.post()).json()).duplicate, true);
  assert.equal(calls, 1);
});

test('closed storage dispatches nothing; identity validation and read/recovery origins stay bounded', async t => {
  let calls = 0;
  const f = await fixture(t, { chatResponder: async () => { calls++; return { text: 'answer' }; } });
  for (const invalid of [{ ...body, requestId: undefined }, { ...body, idempotencyKey: '' }, { ...body, requestId: '../bad' }]) assert.equal((await f.post(invalid)).status, 400);
  assert.equal((await fetch(f.base + '/api/chat/receipt?chatId=chat-a&requestId=request-a', { headers: { ...headers, Origin: 'https://invalid.test' } })).status, 403);
  assert.equal((await f.post({ chatId: 'chat-a', requestId: 'request-a', runId: 'a'.repeat(36) }, '/recover', { Origin: 'https://invalid.test' })).status, 403);
  f.server.intentGraph.admission.close();
  assert.equal((await f.post()).status, 503);
  assert.equal((await f.read()).status, 503);
  assert.equal(calls, 0);
});

test('legacy clients remain serial but repeated identity-free submissions are explicitly distinct', async t => {
  let calls = 0;
  const f = await fixture(t, { chatResponder: async () => { calls++; return { text: 'legacy' }; } });
  const { requestId, idempotencyKey, ...legacy } = body;
  const first = await (await f.post(legacy)).json(), second = await (await f.post(legacy)).json();
  assert.notEqual(first.runId, second.runId); assert.notEqual(first.requestId, second.requestId); assert.equal(calls, 2);
});

test('lost streaming response and cancellation retain one receipt without a second responder call', async t => {
  let calls = 0, cancelled;
  const cancellation = new Promise(r => cancelled = r);
  const f = await fixture(t, { chatResponder: async ({ signal }) => {
    calls++;
    await new Promise(r => { if (signal.aborted) r(); else signal.addEventListener('abort', r, { once: true }); });
    cancelled();
    return { text: 'remote outcome is uncertain' };
  } });
  const controller = new AbortController();
  const response = await fetch(f.base + '/api/chat', { method: 'POST', headers: { ...headers, Accept: 'application/x-ndjson' }, body: JSON.stringify(body), signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read(); controller.abort(); await reader.cancel().catch(() => {});
  await cancellation;
  const receipt = (await (await f.read()).json()).receipt;
  assert.equal(receipt.outcome, 'UNKNOWN'); assert.equal(receipt.state, 'settled');
  const replay = await (await f.post()).json();
  assert.equal(replay.duplicate, true); assert.equal(replay.receipt.runId, receipt.runId); assert.equal(calls, 1);
});

test('receipt settlement failure cannot emit a final success even when raw evidence was saved', async t => {
  const f = await fixture(t, { chatResponder: async () => ({ text: 'answer' }) });
  f.server.intentGraph.admission.settle = () => { throw Error('receipt disk failure'); };
  const events = (await (await f.post(body, '', { Accept: 'application/x-ndjson' })).text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.some(e => e.type === 'final'), false);
  assert.match(events.find(e => e.type === 'failed').message, /could not be saved/);
  const receipt = (await (await f.read()).json()).receipt;
  assert.equal(receipt.state, 'admitted'); assert.equal(receipt.outcome, 'UNKNOWN');
  assert.equal(receipt.recoverable, true);
  assert.equal((await (await f.post()).json()).duplicate, true);
});
