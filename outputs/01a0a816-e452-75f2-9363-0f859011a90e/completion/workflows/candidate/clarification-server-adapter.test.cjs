'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { ApprovalWorkflow, WorkflowError, createMockExecutor } = require('./approval-workflow.cjs');
const { ClarificationRunManager, extractPendingQuestion } = require('./clarification-runtime.cjs');
const { createWorkflowApi } = require('./clarification-server-adapter.cjs');

function assertCode(code, callback) {
  return assert.rejects(Promise.resolve().then(callback), (error) => error instanceof WorkflowError && error.code === code);
}

test('workflow API leaves unrelated routes untouched before applying origin policy', async () => {
  const manager = { start: async () => ({}) };
  const api = createWorkflowApi({ manager, originAllowed: () => false });
  const request = (url) => Object.assign(new EventEmitter(), { url, method: 'GET', headers: { origin: 'https://not-local', host: '127.0.0.1' } });
  const response = () => ({ status: null, body: null, setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = body; } });
  const unrelated = response();
  assert.equal(await api.handle(request('/api/state'), unrelated), false);
  assert.equal(unrelated.status, null);
  const workflow = response();
  assert.equal(await api.handle(request('/api/chat/workflow/run/run-1'), workflow), true);
  assert.equal(workflow.status, 403);
});

test('workflow API keeps structured pending question on the originating run', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrok-workflow-api-'));
  let calls = 0;
  try {
    const manager = new ClarificationRunManager({
      workflowOptions: { storagePath: path.join(directory, 'workflow.json') },
      responder: async ({ runId, messages }) => {
        calls += 1;
        if (calls === 1) return { toolResult: { type: 'pending_question', prompt: 'Which profile?', choices: ['branch-a', 'branch-b'], allowFreeText: false } };
        return { text: `${runId}:${messages.at(-1).content}`, source: 'mock-responder' };
      }
    });
    const api = createWorkflowApi({ manager });
    const waiting = await api.dispatch('/api/chat/workflow/start', 'POST', { chatId: 'chat-api', mode: 'inspect', messages: [{ role: 'user', content: 'Inspect branch.' }] });
    assert.equal(waiting.status, 'waiting-question');
    assert.equal(waiting.pendingQuestion.question.prompt, 'Which profile?');
    const answered = await api.dispatch('/api/chat/workflow/answer', 'POST', {
      runId: waiting.runId, chatId: 'chat-api', questionId: waiting.pendingQuestion.question.id,
      questionToken: waiting.pendingQuestion.token, choice: 'branch-a'
    });
    assert.equal(answered.runId, waiting.runId);
    assert.equal(answered.status, 'completed');
    await assertCode('question_not_pending', () => api.dispatch('/api/chat/workflow/answer', 'POST', {
      runId: waiting.runId, chatId: 'chat-api', questionId: waiting.pendingQuestion.question.id,
      questionToken: waiting.pendingQuestion.token, choice: 'branch-a'
    }));
    assert.deepEqual(extractPendingQuestion({ additional_kwargs: { pending_question: { prompt: 'Again?' } } }), {
      prompt: 'Again?', choices: undefined, allowFreeText: true, context: null, ttlMs: undefined
    });
    assert.equal(extractPendingQuestion({ toolResult: { pending_question: { prompt: 'Nested?' } } }).prompt, 'Nested?');
    assert.equal(extractPendingQuestion({ tool_calls: [{ name: 'ask_clarification', args: { prompt: 'Tool scope?' } }] }).prompt, 'Tool scope?');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('workflow API exposes review and requires the explicit mock executor boundary', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrok-workflow-api-approval-'));
  const executor = createMockExecutor(async ({ actionDigest }) => ({ ok: true, actionDigest }));
  try {
    const workflow = new ApprovalWorkflow({ storagePath: path.join(directory, 'workflow.json'), executor });
    const manager = new ClarificationRunManager({ workflow, responder: async () => ({ text: 'ready' }) });
    const api = createWorkflowApi({ manager });
    const run = await api.dispatch('/api/chat/workflow/start', 'POST', { chatId: 'chat-review', messages: [{ role: 'user', content: 'Prepare a change review.' }] });
    const created = await api.dispatch('/api/chat/workflow/proposal', 'POST', {
      runId: run.runId, chatId: run.chatId,
      input: { target: { deviceId: 'edge-17' }, operation: 'description update', scope: { deviceIds: ['edge-17'] }, diff: { before: 'old', after: 'new' }, impact: { affectedDevices: ['edge-17'] }, rollback: { available: false }, mode: 'write' }
    });
    const review = await api.dispatch('/api/chat/workflow/approval/review', 'POST', { runId: run.runId, chatId: run.chatId, proposalId: created.proposal.id });
    assert.equal(review.receipt.scopeDigest, created.proposal.scopeDigest);
    const pending = await api.dispatch('/api/chat/workflow/approval/request', 'POST', { runId: run.runId, chatId: run.chatId, input: { proposalId: created.proposal.id } });
    const approved = await api.dispatch('/api/chat/workflow/approval/approve', 'POST', { runId: run.runId, chatId: run.chatId, approvalId: pending.approval.id, token: pending.token, scope: created.proposal.action.scope });
    const executed = await api.dispatch('/api/chat/workflow/approval/execute', 'POST', { runId: run.runId, chatId: run.chatId, approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: created.proposal.id, scope: created.proposal.action.scope });
    assert.equal(executed.executed, true);
    assert.equal(executor.calls.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
