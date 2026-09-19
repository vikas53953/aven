'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const candidate = path.resolve(__dirname, '..', '..', 'workflows', 'candidate');
const { ApprovalWorkflow, WorkflowError, createMockExecutor } = require(path.join(candidate, 'approval-workflow.cjs'));
const { ClarificationRunManager } = require(path.join(candidate, 'clarification-runtime.cjs'));
const { createWorkflowApi } = require(path.join(candidate, 'clarification-server-adapter.cjs'));

function assertCode(code, callback) {
  return assert.rejects(Promise.resolve().then(callback), (error) => error instanceof WorkflowError && error.code === code);
}

function proposalInput(overrides = {}) {
  return {
    target: { deviceId: 'edge-a', hostname: 'edge-a.example' }, operation: 'description update',
    scope: { deviceIds: ['edge-a'], commands: ['interface Gi1/0/1', 'description reviewed'] },
    diff: { before: 'old', after: 'new' }, impact: { affectedDevices: ['edge-a'] },
    rollback: { available: false, limit: 'Mock only; no device rollback.' }, mode: 'write', ...overrides
  };
}

test('tool-driven pending question reaches the HTTP card state and answers once on the same run', async () => {
  const manager = new ClarificationRunManager({
    responder: async ({ runId, messages, selection }) => messages.length === 1
      ? { tool_calls: [{ name: 'ask_clarification', args: { prompt: 'Which profile?', choices: ['edge-a', 'edge-b'], allow_free_text: false } }], source: 'provider-response', model: 'mock-model' }
      : { text: `${runId}:${selection.modelId}:${messages.at(-1).content}`, source: 'provider-response' }
  });
  const api = createWorkflowApi({ manager });
  const selection = { providerId: 'mock-provider', modelId: 'mock-model', effort: 'medium' };
  const waiting = await api.dispatch('/api/chat/workflow/start', 'POST', { chatId: 'tool-http', messages: [{ role: 'user', content: 'Inspect.' }], selection });
  assert.equal(waiting.status, 'waiting-question');
  assert.equal(waiting.pendingQuestion.question.prompt, 'Which profile?');
  const answer = await api.dispatch('/api/chat/workflow/answer', 'POST', { runId: waiting.runId, chatId: waiting.chatId, questionId: waiting.pendingQuestion.question.id, questionToken: waiting.pendingQuestion.token, choice: 'edge-a' });
  assert.equal(answer.status, 'completed');
  assert.equal(answer.runId, waiting.runId);
  assert.match(answer.result.text, /edge-a/);
  await assertCode('question_not_pending', () => api.dispatch('/api/chat/workflow/answer', 'POST', { runId: waiting.runId, chatId: waiting.chatId, questionId: waiting.pendingQuestion.question.id, questionToken: waiting.pendingQuestion.token, choice: 'edge-a' }));
});

test('receipt remains immutable when target/command changes and old approval cannot replay', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-round2-receipt-'));
  const executor = createMockExecutor(async ({ actionDigest }) => ({ ok: true, actionDigest }));
  try {
    const workflow = new ApprovalWorkflow({ storagePath: path.join(directory, 'workflow.json'), executor });
    const original = workflow.createProposal(proposalInput()).proposal;
    const receipt = workflow.reviewProposal(original.id).receipt;
    const pending = workflow.requestApproval({ proposalId: original.id });
    const replaced = workflow.replaceProposal(original.id, proposalInput({
      target: { deviceId: 'edge-b', hostname: 'edge-b.example' },
      operation: 'description update on replacement',
      scope: { deviceIds: ['edge-b'], commands: ['interface Gi1/0/2', 'description changed'] }
    })).proposal;
    assert.notEqual(replaced.actionDigest, original.actionDigest);
    assert.deepEqual(workflow.reviewProposal(original.id).receipt, receipt, 'the original receipt remains an immutable review record');
    assert.equal(workflow.getApproval(pending.approval.id).status, 'stale');
    await assertCode('stale_approval', () => workflow.execute({ approvalId: pending.approval.id, executionToken: 'a'.repeat(64), proposalId: replaced.id, scope: replaced.action.scope, actionDigest: replaced.actionDigest }));
    const newPending = workflow.requestApproval({ proposalId: replaced.id });
    const approved = workflow.approve({ approvalId: newPending.approval.id, token: newPending.token, proposalId: replaced.id, scope: replaced.action.scope, actionDigest: replaced.actionDigest });
    await assertCode('scope_mismatch', () => workflow.execute({ approvalId: newPending.approval.id, executionToken: approved.executionToken, proposalId: replaced.id, scope: proposalInput().scope, actionDigest: replaced.actionDigest }));
    const result = await workflow.execute({ approvalId: newPending.approval.id, executionToken: approved.executionToken, proposalId: replaced.id, scope: replaced.action.scope, actionDigest: replaced.actionDigest });
    assert.equal(result.executed, true);
    assert.equal(executor.calls.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

