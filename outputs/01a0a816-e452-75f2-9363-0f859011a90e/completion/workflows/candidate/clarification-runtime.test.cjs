'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApprovalWorkflow, WorkflowError, createMockExecutor } = require('./approval-workflow.cjs');
const { ClarificationRunManager } = require('./clarification-runtime.cjs');

function assertCode(code, callback) {
  return assert.rejects(Promise.resolve().then(callback), (error) => error instanceof WorkflowError && error.code === code);
}

test('structured model clarification pauses and resumes the same run after one answer', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrok-clarification-'));
  let responseCount = 0;
  const events = [];
  const statuses = [];
  try {
    const workflow = new ApprovalWorkflow({ storagePath: path.join(directory, 'workflow.json') });
    const manager = new ClarificationRunManager({
      workflow,
      onEvent: (event) => events.push(event),
      onStatus: (status) => statuses.push(status),
      responder: async ({ messages, runId }) => {
        responseCount += 1;
        if (responseCount === 1) return { pendingQuestion: { prompt: 'Which exact device should be reviewed?', choices: ['edge-17', 'edge-18'], allowFreeText: false }, model: 'mock-clarification-model', source: 'provider-response', provenance: { providerId: 'mock-provider', modelId: 'mock-clarification-model', effort: 'medium', source: 'provider-response' } };
        return { text: `Resumed ${runId} with ${messages.at(-1).content}.`, source: 'mock-responder' };
      }
    });
    const waiting = await manager.start({ chatId: 'chat-a', mode: 'inspect', messages: [{ role: 'user', content: 'Review the edge.' }] });
    assert.equal(waiting.status, 'waiting-question');
    assert.match(waiting.pendingQuestion.question.prompt, /exact device/);
    assert.equal(waiting.result.model, 'mock-clarification-model');
    assert.deepEqual(waiting.result.provenance, { providerId: 'mock-provider', modelId: 'mock-clarification-model', effort: 'medium', source: 'provider-response' });
    assert.equal(events.filter((event) => event.type === 'pending_question').length, 1);
    const runId = waiting.runId;
    const questionId = waiting.pendingQuestion.question.id;
    const questionToken = waiting.pendingQuestion.token;
    await assertCode('run_not_found', () => manager.answer({ runId, chatId: 'wrong-chat', questionId, questionToken, choice: 'edge-17' }));
    const completed = await manager.answer({ runId, chatId: 'chat-a', questionId, questionToken, choice: 'edge-17' });
    assert.equal(completed.runId, runId, 'answer resumes the originating run');
    assert.equal(completed.chatId, 'chat-a');
    assert.equal(completed.status, 'completed');
    assert.equal(responseCount, 2);
    assert.deepEqual(statuses.map((item) => item.status), ['running', 'waiting-question', 'running', 'completed']);
    assert.equal(statuses.find((item) => item.status === 'waiting-question').terminal, false, 'waiting never settles reliability as SUCCESS');
    assert.match(completed.result.text, /edge-17/);
    assert.equal(events.filter((event) => event.type === 'question_answered').length, 1);
    assert.equal(events.at(-1).runId, runId);
    await assertCode('question_not_pending', () => manager.answer({ runId, chatId: 'chat-a', questionId, questionToken, choice: 'edge-17' }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('answer context includes the question and resumed segment gets a fresh cancellable signal', async () => {
  const ended = new AbortController();
  const signals = [];
  let calls = 0;
  let release;
  const observed = [];
  const managerWithEvents = new ClarificationRunManager({ onEvent: (event) => observed.push(event) });
  const responder = async ({ messages, signal, onEvent }) => {
    calls += 1;
    signals.push(signal);
    onEvent?.({ type: `segment-${calls}`, token: `raw-token-${calls}` });
    assert.equal(signal.aborted, false, 'an ended request signal is never reused');
    if (calls === 1) return { pendingQuestion: { prompt: 'Which exact profile?', choices: [{ id: 'edge-a', label: 'Edge A' }], allowFreeText: false } };
    assert.match(messages.at(-2).content, /Which exact profile\?/);
    assert.match(messages.at(-2).content, /edge-a \(Edge A\)/);
    assert.match(messages.at(-1).content, /edge-a/);
    await new Promise((resolve, reject) => {
      release = resolve;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return { text: 'resumed' };
  };
  const waiting = await managerWithEvents.start({ chatId: 'chat-fresh', messages: [{ role: 'user', content: 'Review profile.' }], responder, responderOptions: { signal: ended.signal } });
  ended.abort();
  const answerPromise = managerWithEvents.answer({ runId: waiting.runId, chatId: waiting.chatId, questionId: waiting.pendingQuestion.question.id, questionToken: waiting.pendingQuestion.token, choice: 'edge-a' });
  for (let attempt = 0; !release && attempt < 100; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1], 'resume owns a new request segment');
  const stopped = managerWithEvents.stop({ runId: waiting.runId, chatId: waiting.chatId });
  assert.equal(stopped.status, 'canceled');
  const result = await answerPromise;
  assert.equal(result.status, 'canceled');
  assert.equal(result.events.some((event) => event.type === 'segment-2'), true, 'resumed responder events remain on the same run');
  assert.equal(JSON.stringify(result).includes('raw-token-2'), false, 'resumed event auth tokens are sanitized');
  assert.equal(observed.some((event) => event.type === 'segment-2'), true, 'resumed responder events reach the host observer');
  release?.();
});

test('pending response metadata is whitelisted before it reaches the public waiting result', async () => {
  const manager = new ClarificationRunManager({ responder: async () => ({
    pendingQuestion: { prompt: 'Which scope?', choices: ['edge-a'], allowFreeText: false },
    model: 'provider-model', source: 'provider-response', provenance: {
      schemaVersion: 1,
      requested: { providerId: 'requested-provider', modelId: 'requested-model', effort: 'medium' },
      effective: { providerId: 'provider', modelId: 'provider-model', effort: 'low' },
      source: 'provider-response', match: false,
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20, apiKey: 'must-not-leak' },
      apiKey: 'must-not-leak'
    }
  }) });
  const waiting = await manager.start({ chatId: 'metadata-chat', messages: [{ role: 'user', content: 'Inspect.' }] });
  assert.deepEqual(waiting.result.provenance, {
    schemaVersion: 1,
    requested: { providerId: 'requested-provider', modelId: 'requested-model', effort: 'medium' },
    effective: { providerId: 'provider', modelId: 'provider-model', effort: 'low' },
    source: 'provider-response', match: false, usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }
  });
  assert.equal(JSON.stringify(waiting).includes('must-not-leak'), false);
});

test('explicit abandon after refresh releases WAITING and permits a fresh same-chat request', async () => {
  const statuses = [];
  let calls = 0;
  const manager = new ClarificationRunManager({
    onStatus: (value) => statuses.push(value),
    responder: async () => {
      calls += 1;
      return calls === 1 ? { pendingQuestion: { prompt: 'Which scope?', choices: ['edge-a'], allowFreeText: false } } : { text: 'fresh request completed' };
    }
  });
  const waiting = await manager.start({ chatId: 'refresh-chat', messages: [{ role: 'user', content: 'Inspect.' }] });
  await assertCode('run_not_found', () => manager.abandon({ runId: waiting.runId, chatId: 'other-chat', questionId: waiting.pendingQuestion.question.id }));
  const abandoned = manager.abandon({ runId: waiting.runId, chatId: waiting.chatId, questionId: waiting.pendingQuestion.question.id });
  assert.equal(abandoned.status, 'canceled');
  assert.equal(statuses.at(-1).status, 'canceled');
  assert.equal(statuses.at(-1).terminal, true);
  const fresh = await manager.start({ chatId: 'refresh-chat', messages: [{ role: 'user', content: 'Start fresh.' }] });
  assert.equal(fresh.status, 'completed');
  assert.equal(fresh.result.text, 'fresh request completed');
});

test('manager refresh makes an expired waiting card non-actionable', async () => {
  let now = Date.parse('2026-09-16T10:00:00.000Z');
  const workflow = new ApprovalWorkflow({ clock: () => now });
  const manager = new ClarificationRunManager({ workflow, responder: async () => ({ pendingQuestion: { prompt: 'Expires quickly', ttlMs: 10 } }) });
  const waiting = await manager.start({ chatId: 'chat-expiry', messages: [{ role: 'user', content: 'Need scope.' }] });
  now += 11;
  const ended = manager.get(waiting.runId, waiting.chatId);
  assert.equal(ended.status, 'question-ended');
  assert.equal(manager.renderQuestion(waiting.runId, waiting.chatId).interactive, false);
});

test('restart restores waiting history as a non-interactive run with no token', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrok-clarification-restart-'));
  const statePath = path.join(directory, 'workflow.json');
  try {
    const first = new ClarificationRunManager({ workflowOptions: { storagePath: statePath }, responder: async () => ({ pendingQuestion: { prompt: 'Restart-safe scope?', choices: ['edge-a'], allowFreeText: false } }) });
    const waiting = await first.start({ chatId: 'restart-chat', messages: [{ role: 'user', content: 'Review.' }] });
    const restartedWorkflow = new ApprovalWorkflow({ storagePath: statePath });
    const restarted = new ClarificationRunManager({ workflow: restartedWorkflow });
    const history = restarted.get(waiting.runId, waiting.chatId);
    assert.equal(history.status, 'restored-history');
    assert.equal(history.pendingQuestion.question.prompt, 'Restart-safe scope?');
    assert.equal(Object.hasOwn(history.pendingQuestion, 'token'), false, 'restart never rehydrates a question token');
    assert.equal(restartedWorkflow.snapshot().reload.invalidatedRunIds.includes(waiting.runId), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('run manager keeps proposal review separate and crosses only an explicit mock approval boundary', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrok-clarification-approval-'));
  const executor = createMockExecutor(async ({ actionDigest }) => ({ ok: true, actionDigest }));
  try {
    const workflow = new ApprovalWorkflow({ storagePath: path.join(directory, 'workflow.json'), executor });
    const manager = new ClarificationRunManager({ workflow, responder: async () => ({ text: 'done' }) });
    const run = await manager.start({ chatId: 'chat-review', messages: [{ role: 'user', content: 'Prepare a review.' }] });
    const proposal = manager.createProposal(run.runId, run.chatId, {
      target: { deviceId: 'edge-17' }, operation: 'description update',
      scope: { deviceIds: ['edge-17'] }, diff: { before: 'old', after: 'new' },
      impact: { affectedDevices: ['edge-17'] }, rollback: { available: false }, mode: 'write'
    });
    assert.equal(proposal.receipt.actionDigest, proposal.proposal.actionDigest);
    const pending = manager.requestApproval(run.runId, run.chatId, { proposalId: proposal.proposal.id });
    assert.equal(manager.renderApproval(pending.approval.id, run.runId, run.chatId).executing, false);
    const approved = manager.approve({ runId: run.runId, chatId: run.chatId, approvalId: pending.approval.id, token: pending.token, scope: proposal.proposal.action.scope });
    const result = await manager.execute({ runId: run.runId, chatId: run.chatId, approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: proposal.proposal.id, scope: proposal.proposal.action.scope });
    assert.equal(result.executed, true);
    assert.equal(executor.calls.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('proposal and approval operations require the owning run and chat', async () => {
  const workflow = new ApprovalWorkflow();
  const manager = new ClarificationRunManager({ workflow, responder: async () => ({ text: 'ready' }) });
  const run = await manager.start({ chatId: 'owner-chat', messages: [{ role: 'user', content: 'Prepare a review.' }] });
  const proposal = manager.createProposal(run.runId, run.chatId, {
    target: { deviceId: 'edge-17' }, operation: 'description update', scope: { deviceIds: ['edge-17'] }, mode: 'write'
  });
  await assertCode('run_not_found', () => manager.reviewProposal(proposal.proposal.id, run.runId, 'other-chat'));
  await assertCode('run_not_found', () => manager.requestApproval(run.runId, 'other-chat', { proposalId: proposal.proposal.id }));
  const pending = manager.requestApproval(run.runId, run.chatId, { proposalId: proposal.proposal.id });
  await assertCode('ownership_mismatch', () => manager.approve({ runId: run.runId, chatId: 'other-chat', approvalId: pending.approval.id, token: pending.token, scope: proposal.proposal.action.scope }));
});

test('closing an owned manager permits durable reopen and leaves an injected workflow owned by its caller', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrok-clarification-close-'));
  const statePath = path.join(directory, 'workflow.json');
  try {
    const owned = new ClarificationRunManager({ workflowOptions: { storagePath: statePath } });
    assert.equal(owned.ownsWorkflow, true);
    owned.close();
    assert.equal(owned.workflow.closed, true);
    const reopened = new ApprovalWorkflow({ storagePath: statePath });
    assert.equal(reopened.snapshot().revision >= 0, true);
    reopened.close();

    const shared = new ApprovalWorkflow({ storagePath: statePath });
    const injected = new ClarificationRunManager({ workflow: shared });
    assert.equal(injected.ownsWorkflow, false);
    injected.close();
    assert.equal(shared.closed, false, 'an injected workflow remains owned by its caller');
    shared.createPendingQuestion({ prompt: 'Still available after manager close?' });
    shared.close();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
