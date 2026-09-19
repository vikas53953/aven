'use strict';

// Parent-owned assembled-server acceptance. This test is intentionally kept in
// the round-2 handoff directory; it never edits the assembled candidate or
// starts a real provider/device adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const assembledRoot = path.resolve(__dirname, '..', '..', 'assembled-candidate', 'intentgraph');
const { start } = require(path.join(assembledRoot, 'server.cjs'));

const capabilities = {
  schemaVersion: 1,
  checkedAt: null,
  providers: [{
    id: 'opencode', label: 'OpenCode', status: 'configured', configured: true,
    connected: false, models: [{ id: 'mimo-v2.5', status: 'configured', efforts: ['none'] }]
  }]
};

function headers(extra = {}) {
  return {
    Origin: 'http://127.0.0.1:8767',
    'Content-Type': 'application/json',
    'X-Aven-Chat': 'text-only',
    ...extra
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('assembled HTTP clarification preserves run/selection and settles WAITING then SUCCESS', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-round2-workflow-'));
  const calls = [];
  const selection = { providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none' };
  const server = await start({
    root,
    port: 0,
    executionOptions: { provider: { status: () => ({}) }, coordinator: { close() {} }, adapters: { close() {} }, delivery: {} },
    providerCapabilities: capabilities,
    chatResponder: async (context) => {
      calls.push({ runId: context.runId, chatId: context.chatId, selection: context.selection, messages: context.messages });
      if (calls.length === 1) {
        return {
          tool_calls: [{ name: 'ask_clarification', args: { prompt: 'Which exact device?', choices: [{ id: 'edge-a', label: 'Edge A' }, { id: 'edge-b', label: 'Edge B' }], allow_free_text: false } }],
          source: 'provider-response', model: 'mock-model', provenance: { providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none', source: 'provider-response' }
        };
      }
      return { text: `Resumed on ${context.messages.at(-1).content}`, source: 'provider-response', model: 'mock-model', provenance: { providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none', source: 'provider-response' } };
    }
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const body = { chatId: 'assembled-http', agentName: 'Test', mode: 'inspect', selection, messages: [{ role: 'user', content: 'Inspect the branch.' }] };
    const initialResponse = await fetch(`${base}/api/chat`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const waiting = await initialResponse.json();
    assert.equal(initialResponse.status, 200, JSON.stringify(waiting));
    assert.equal(waiting.status, 'waiting-question');
    assert.equal(waiting.pendingQuestion.question.prompt, 'Which exact device?');
    assert.deepEqual(calls[0].selection, selection);

    const reliabilityAfterWait = server.intentGraph.reliability.getRun(waiting.runId);
    assert.equal(reliabilityAfterWait.status, 'WAITING', JSON.stringify(reliabilityAfterWait));

    const answerBody = {
      runId: waiting.runId,
      chatId: body.chatId,
      questionId: waiting.pendingQuestion.question.id,
      questionToken: waiting.pendingQuestion.token,
      choice: 'edge-a'
    };
    const resumedResponse = await fetch(`${base}/api/chat/workflow/answer`, { method: 'POST', headers: headers(), body: JSON.stringify(answerBody) });
    const completed = await resumedResponse.json();
    assert.equal(resumedResponse.status, 200, JSON.stringify(completed));
    assert.equal(completed.status, 'completed');
    assert.equal(completed.runId, waiting.runId);
    assert.match(completed.result.text, /edge-a/);
    assert.deepEqual(calls.map((call) => call.selection), [selection, selection]);

    const reliabilityAfterResume = server.intentGraph.reliability.getRun(waiting.runId);
    assert.equal(reliabilityAfterResume.status, 'SUCCESS', JSON.stringify(reliabilityAfterResume));

    const replay = await fetch(`${base}/api/chat/workflow/answer`, { method: 'POST', headers: headers(), body: JSON.stringify(answerBody) });
    assert.equal(replay.status, 409);
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assembled HTTP abandon releases a refreshed wait for a fresh same-chat request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-round2-abandon-'));
  let calls = 0;
  const server = await start({
    root,
    port: 0,
    executionOptions: { provider: { status: () => ({}) }, coordinator: { close() {} }, adapters: { close() {} }, delivery: {} },
    providerCapabilities: capabilities,
    chatResponder: async () => {
      calls += 1;
      return calls === 1 ? { content: JSON.stringify({ type: 'pending_question', prompt: 'Fresh scope?', choices: ['edge-a'], allow_free_text: false }) } : { text: 'fresh request completed' };
    }
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const startBody = { chatId: 'assembled-abandon', agentName: 'Test', mode: 'inspect', messages: [{ role: 'user', content: 'Need a bounded scope.' }] };
    const initial = await (await fetch(`${base}/api/chat`, { method: 'POST', headers: headers(), body: JSON.stringify(startBody) })).json();
    assert.equal(initial.status, 'waiting-question');
    const abandon = await fetch(`${base}/api/chat/workflow/abandon`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: initial.runId, chatId: startBody.chatId, questionId: initial.pendingQuestion.question.id }) });
    assert.equal(abandon.status, 200);
    assert.equal((await abandon.json()).status, 'canceled');
    const fresh = await fetch(`${base}/api/chat`, { method: 'POST', headers: headers(), body: JSON.stringify({ ...startBody, requestId: 'fresh-after-abandon' }) });
    const freshBody = await fresh.json();
    assert.equal(fresh.status, 200, JSON.stringify(freshBody));
    assert.equal(freshBody.text, 'fresh request completed');
  } finally {
    await closeServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
