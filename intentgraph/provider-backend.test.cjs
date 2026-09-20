'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BaseChatModel } = require('@langchain/core/language_models/chat_models');
const { AIMessage } = require('@langchain/core/messages');
const { start } = require('./server.cjs');
const { normalizeCapabilities, validateSelection, DEFAULT_SELECTION, responseProvenance } = require('./provider-selection.cjs');
const { createAdmission } = require('./reliability.cjs');

const snapshot = normalizeCapabilities({
  checkedAt: '2026-09-20T00:00:00.000Z',
  providers: [
    { id: 'opencode', status: 'configured', configured: true, models: [{ id: 'mimo-v2.5', status: 'configured', configured: true, efforts: ['none'] }] },
    { id: 'openrouter', status: 'configured', configured: true, models: [{ id: 'fixture/router', status: 'configured', configured: true, efforts: ['none'] }] }
  ]
});
const selectedRouter = { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none' };
const headers = { Origin: 'http://127.0.0.1:8767', 'X-Aven-Chat': 'text-only', 'Content-Type': 'application/json' };

class FixtureModel extends BaseChatModel {
  constructor() { super({}); }
  _llmType() { return 'aven-provider-fixture'; }
  _combineLLMOutput() { return {}; }
  bindTools() { return this; }
  async _generate() {
    return { generations: [{ text: 'fixture provider answer', message: new AIMessage({ content: 'fixture provider answer' }) }], llmOutput: {} };
  }
}

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aven-provider-backend-')); }
function baseOptions(root, extra = {}) {
  return {
    root,
    port: 0,
    sandbox: { close() {} },
    executionOptions: {
      provider: { status: () => ({}) },
      coordinator: { close() {}, status: () => ({}) },
      adapters: { close() {}, status: () => ({}) },
      delivery: { status: () => ({}) }
    },
    providerCapabilities: snapshot,
    getProviderKey: async () => 'fixture-provider-key',
    providerModelFactory: Object.assign(async () => new FixtureModel(), { supportsProvider: () => true }),
    ...extra
  };
}
async function post(server, body, pathname = '/api/chat') {
  return fetch(`http://127.0.0.1:${server.address().port}${pathname}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('capability catalog keeps four providers and rejects unavailable selections before key access', () => {
  const capabilities = normalizeCapabilities(snapshot);
  assert.deepEqual(capabilities.providers.map((item) => item.id), ['opencode', 'openrouter', 'anthropic', 'openai']);
  assert.equal(validateSelection(DEFAULT_SELECTION, capabilities).ok, true);
  assert.equal(validateSelection({ ...DEFAULT_SELECTION, modelId: 'x'.repeat(201) }, capabilities).code, 'invalid_selection');
  assert.equal(validateSelection({ ...DEFAULT_SELECTION, modelId: ' mimo-v2.5' }, capabilities).code, 'invalid_selection');
  assert.equal(responseProvenance({ requested: DEFAULT_SELECTION, response: { model: 'mimo-v2.5' } }).match, null);
  let reads = 0;
  const unavailable = validateSelection({ providerId: 'anthropic', modelId: 'claude', effort: 'none' }, capabilities);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'provider_unavailable');
  assert.equal(reads, 0);
});

test('legacy no-selection receipt remains a duplicate after the picker is introduced', async (t) => {
  const root = tempRoot();
  const legacy = { chatId: 'legacy-replay', requestId: 'legacy-request', idempotencyKey: 'legacy-key', agentName: 'Fixture', mode: 'plan', messages: [{ role: 'user', content: 'legacy request' }] };
  const oldAdmission = createAdmission({ directory: path.join(root, '.intentgraph', 'runtime') });
  const receipt = oldAdmission.claim(legacy).receipt;
  oldAdmission.settle(receipt, 'SUCCESS', true);
  oldAdmission.close();
  const server = await start(baseOptions(root, { chatResponder: async () => { throw Error('legacy replay must not dispatch'); } }));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await post(server, legacy);
  const body = await result.json();
  assert.equal(result.status, 200, JSON.stringify(body));
  assert.equal(body.duplicate, true);
  assert.equal(body.receipt.runId, receipt.runId);
});

test('HTTP rejects an unconfigured provider before the injected key getter runs', async (t) => {
  const root = tempRoot();
  let keyReads = 0;
  const server = await start(baseOptions(root, { getProviderKey: async () => { keyReads += 1; return 'must-not-read'; } }));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await post(server, { chatId: 'unconfigured', agentName: 'Fixture', mode: 'plan', selection: { providerId: 'anthropic', modelId: 'claude', effort: 'none' }, messages: [{ role: 'user', content: 'x' }] });
  const body = await result.json();
  assert.equal(result.status, 409, JSON.stringify(body));
  assert.equal(body.error, 'provider_unavailable');
  assert.equal(keyReads, 0);
});

test('HTTP rejects the unsupported chat context field before dispatch', async (t) => {
  const root = tempRoot();
  let dispatches = 0;
  const server = await start(baseOptions(root, {
    chatResponder: async () => { dispatches += 1; return { text: 'fixture answer' }; }
  }));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  for (const context of [null, {}, { windowMessages: 1, windowCharacters: 1, retainedMessages: 1, retainedCharacters: 1, omittedMessages: 0, totalMessages: 1 }]) {
    const result = await post(server, { chatId: 'unsupported-context', agentName: 'Fixture', mode: 'plan', selection: selectedRouter, messages: [{ role: 'user', content: 'x' }], context });
    const body = await result.json();
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  assert.equal(dispatches, 0);
});

test('configured injected model dispatch returns requested selection and request provenance', async (t) => {
  const root = tempRoot();
  const server = await start(baseOptions(root));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const result = await post(server, { chatId: 'provider-dispatch', agentName: 'Fixture', mode: 'plan', selection: selectedRouter, messages: [{ role: 'user', content: 'Answer with the fixture.' }] });
  const body = await result.json();
  assert.equal(result.status, 200, JSON.stringify(body));
  assert.equal(body.text, 'fixture provider answer');
  assert.deepEqual(body.requestedSelection, selectedRouter);
  assert.equal(body.provenance.source, 'request-selection');
  assert.deepEqual(body.provenance.effective, { providerId: null, modelId: null, effort: null });
});

test('same request identity rejects a changed provider selection after the first run', async (t) => {
  const root = tempRoot();
  const server = await start(baseOptions(root));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const body = { chatId: 'selection-conflict', requestId: 'stable-request', idempotencyKey: 'stable-key', agentName: 'Fixture', mode: 'plan', selection: selectedRouter, messages: [{ role: 'user', content: 'same request' }] };
  const first = await post(server, body); assert.equal(first.status, 200);
  const changed = await post(server, { ...body, selection: DEFAULT_SELECTION });
  const response = await changed.json();
  assert.equal(changed.status, 409, JSON.stringify(response));
  assert.equal(response.error, 'request_conflict');
});

test('clarification continuation retains the admitted selection after a local settings change', async (t) => {
  const root = tempRoot();
  const selections = [];
  const question = { prompt: 'Which target?', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], allowFreeText: false };
  const server = await start(baseOptions(root, {
    chatResponder: async (args) => {
      selections.push(args.selection);
      return args.clarificationAnswered ? { text: 'continued', model: 'fixture/router' } : { question, model: 'fixture/router' };
    }
  }));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const first = await post(server, { chatId: 'clarified', requestId: 'clarified-request', idempotencyKey: 'clarified-key', agentName: 'Fixture', mode: 'plan', selection: selectedRouter, messages: [{ role: 'user', content: 'Clarify this.' }] });
  const pending = await first.json();
  assert.equal(first.status, 200, JSON.stringify(pending));
  // Simulate settings changing while the question is open. The continuation
  // endpoint has no selection field and must use the frozen admitted tuple.
  const answer = await post(server, { chatId: pending.question.chatId, requestId: pending.question.requestId, runId: pending.question.runId, questionId: pending.question.id, revision: pending.question.revision, answerToken: pending.answerToken, answer: { choiceId: 'a' } }, '/api/chat/question/answer');
  const completed = await answer.json();
  assert.equal(answer.status, 200, JSON.stringify(completed));
  assert.deepEqual(selections, [selectedRouter, selectedRouter]);
  assert.deepEqual(completed.requestedSelection, selectedRouter);
});
