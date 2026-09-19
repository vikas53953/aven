'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const { ApprovalWorkflow } = require('./approval-workflow.cjs');
const { ClarificationRunManager } = require('./clarification-runtime.cjs');
const { createWorkflowApi } = require('./clarification-server-adapter.cjs');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

test('normal chat start returns a pending card and answer resumes the same run with selection', async () => {
  const workflow = new ApprovalWorkflow();
  let calls = 0;
  const contexts = [];
  const manager = new ClarificationRunManager({
    workflow,
    responder: async (context) => {
      calls += 1; contexts.push(context);
      if (calls === 1) return { pendingQuestion: { prompt: 'Which read-only profile?', choices: ['branch-a', 'branch-b'], allowFreeText: false } };
      return { text: `Resumed ${context.runId} after ${context.messages.at(-1).content}.`, model: context.selection.modelId, source: 'provider-response', provenance: { ...context.selection, source: 'provider-response' } };
    }
  });
  const api = createWorkflowApi({ manager });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/chat') {
        const body = await readBody(req);
        const run = await manager.start({ runId: body.runId || crypto.randomUUID(), chatId: body.chatId, mode: body.mode, messages: body.messages, selection: body.selection });
        send(res, 200, run);
        return;
      }
      if (await api.handle(req, res)) return;
      send(res, 404, { error: 'not_found' });
    } catch (error) {
      send(res, error.status || 500, { error: error.code || 'failed', reasons: [error.message] });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const selection = { providerId: 'mock-provider', modelId: 'mock-model', effort: 'medium' };
    const startResponse = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' },
      body: JSON.stringify({ chatId: 'normal-chat', mode: 'inspect', messages: [{ role: 'user', content: 'Inspect branch.' }], selection })
    });
    const waiting = await startResponse.json();
    assert.equal(startResponse.status, 200);
    assert.equal(waiting.status, 'waiting-question');
    assert.equal(waiting.pendingQuestion.question.prompt, 'Which read-only profile?');
    const answerBody = {
      runId: waiting.runId, chatId: 'normal-chat', questionId: waiting.pendingQuestion.question.id,
      questionToken: waiting.pendingQuestion.token, choice: 'branch-a'
    };
    const answerResponse = await fetch(`${base}/api/chat/workflow/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' }, body: JSON.stringify(answerBody)
    });
    const completed = await answerResponse.json();
    assert.equal(answerResponse.status, 200);
    assert.equal(completed.runId, waiting.runId);
    assert.equal(completed.chatId, 'normal-chat');
    assert.equal(completed.status, 'completed');
    assert.match(completed.result.text, /branch-a/);
    assert.deepEqual(contexts.map((item) => item.selection), [selection, selection]);
    const replay = await fetch(`${base}/api/chat/workflow/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' }, body: JSON.stringify(answerBody)
    });
    assert.equal(replay.status, 409, 'one-time question token cannot resume twice');
    assert.equal(calls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('normal HTTP stop cancels both the first segment and a resumed segment', async () => {
  let calls = 0;
  const perChat = new Map();
  let resumed = false;
  const manager = new ClarificationRunManager({
    responder: async ({ chatId, signal }) => {
      calls += 1;
      const count = (perChat.get(chatId) || 0) + 1;
      perChat.set(chatId, count);
      if (chatId === 'stop-chat' || count > 1) { resumed = count > 1; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
      return { pendingQuestion: { prompt: 'Which profile?', choices: ['branch-a'], allowFreeText: false } };
    }
  });
  const api = createWorkflowApi({ manager });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/chat') {
        const body = await readBody(req);
        const run = await manager.start({ runId: body.runId || crypto.randomUUID(), chatId: body.chatId, mode: body.mode, messages: body.messages, selection: body.selection });
        send(res, 200, run); return;
      }
      if (await api.handle(req, res)) return;
      send(res, 404, { error: 'not_found' });
    } catch (error) { send(res, error.status || 500, { error: error.code || 'failed', reasons: [error.message] }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' };
    const firstRunId = crypto.randomUUID();
    const firstStart = fetch(`${base}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ runId: firstRunId, chatId: 'stop-chat', mode: 'inspect', messages: [{ role: 'user', content: 'Stop me.' }] }) });
    for (let attempt = 0; calls < 1 && attempt < 100; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    const observedBeforeStop = manager.get(firstRunId, 'stop-chat');
    assert.equal(observedBeforeStop.status, 'running', JSON.stringify(observedBeforeStop));
    const firstStop = await fetch(`${base}/api/chat/workflow/stop`, { method: 'POST', headers, body: JSON.stringify({ runId: firstRunId, chatId: 'stop-chat' }) });
    const firstStopBody = await firstStop.json();
    assert.equal(firstStopBody.status, 'canceled', JSON.stringify(firstStopBody));
    assert.equal((await (await firstStart).json()).status, 'canceled');

    const secondStart = await fetch(`${base}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ runId: crypto.randomUUID(), chatId: 'resume-stop-chat', mode: 'inspect', messages: [{ role: 'user', content: 'Need a choice.' }] }) });
    const waiting = await secondStart.json();
    assert.equal(secondStart.status, 200);
    const answerPromise = fetch(`${base}/api/chat/workflow/answer`, { method: 'POST', headers, body: JSON.stringify({ runId: waiting.runId, chatId: waiting.chatId, questionId: waiting.pendingQuestion.question.id, questionToken: waiting.pendingQuestion.token, choice: 'branch-a' }) });
    for (let attempt = 0; !resumed && attempt < 100; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    const resumedStop = await fetch(`${base}/api/chat/workflow/stop`, { method: 'POST', headers, body: JSON.stringify({ runId: waiting.runId, chatId: waiting.chatId }) });
    assert.equal((await resumedStop.json()).status, 'canceled');
    assert.equal((await (await answerPromise).json()).status, 'canceled');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
