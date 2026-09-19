'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const {
  ApprovalWorkflow,
  WorkflowError,
  createMockExecutor,
  digest
} = require('./approval-workflow.cjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrok-approval-'));
  let time = Date.parse('2026-09-16T10:00:00.000Z');
  const clock = () => time;
  const executor = createMockExecutor(async ({ actionDigest }) => ({ ok: true, actionDigest }));
  const make = (extra = {}) => new ApprovalWorkflow({ storagePath: path.join(directory, 'workflow.json'), clock, executor, ...extra });
  return { directory, clock, executor, make, advance(ms) { time += ms; } };
}

async function assertCode(code, callback) {
  await assert.rejects(Promise.resolve().then(callback), (error) => error instanceof WorkflowError && error.code === code);
}

function proposalInput(overrides = {}) {
  return {
    target: { deviceId: 'device-17', hostname: 'edge-17' },
    operation: 'network.config.previewed-write',
    scope: { deviceIds: ['device-17'], commands: ['interface Gi1/0/1', 'description reviewed'] },
    diff: { before: 'description old', after: 'description new' },
    impact: { affectedDevices: ['device-17'], serviceRisk: 'review-required' },
    rollback: { available: false, limit: 'No device rollback is performed by this candidate.' },
    mode: 'write',
    ...overrides
  };
}

test('pending question maps one answer, stale cards cannot answer, and cancel persists', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const first = workflow.createPendingQuestion({ prompt: 'Which exact device should be reviewed?', choices: ['edge-17', 'edge-18'], allowFreeText: false });
    const beforeRender = workflow.snapshot().revision;
    const card = workflow.renderQuestionCard(first.question.id);
    assert.equal(card.type, 'pending-question-card');
    assert.equal(card.executing, false);
    assert.equal(card.action, 'none');
    assert.equal(workflow.snapshot().revision, beforeRender, 'question rendering is a pure projection');

    const second = workflow.createPendingQuestion({ prompt: 'Confirm the selected device.', choices: [{ id: 'confirm', label: 'Confirm device-17' }] });
    assert.equal(workflow.getQuestion(first.question.id).status, 'stale');
    await assertCode('stale_question', () => workflow.answerQuestion({ questionId: first.question.id, questionToken: first.token, choice: 'edge-17' }));
    const answered = workflow.answerQuestion({ questionId: second.question.id, questionToken: second.token, choice: 'confirm' });
    assert.equal(answered.question.status, 'answered');
    assert.deepEqual(answered.answer, { choice: 'confirm', text: null });
    await assertCode('question_not_pending', () => workflow.answerQuestion({ questionId: second.question.id, questionToken: second.token, choice: 'confirm' }));

    const cancel = workflow.createPendingQuestion({ prompt: 'Continue?', allowFreeText: true });
    const canceled = workflow.cancelQuestion({ questionId: cancel.question.id, questionToken: cancel.token, reason: 'scope needs review' });
    assert.equal(canceled.question.status, 'canceled');
    assert.match(canceled.question.reason, /scope/);
    assert.equal(JSON.stringify(workflow.snapshot()).includes(first.token), false, 'raw question tokens never enter state');
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('exact proposal scope/digest, receipt persistence, approval decisions, and one-time execution', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const proposal = workflow.createProposal(proposalInput()).proposal;
    assert.equal(proposal.scopeDigest, digest(proposal.action.scope));
    assert.equal(proposal.actionDigest, digest(proposal.action));
    const untouchedRevision = workflow.snapshot().revision;
    const rendered = workflow.renderProposal(proposal.id);
    assert.equal(rendered.executing, false);
    assert.equal(rendered.action, 'none');
    assert.equal(rendered.executionAllowed, true);
    assert.equal(workflow.snapshot().revision, untouchedRevision, 'proposal rendering cannot create an action');

    const receipt = workflow.reviewProposal(proposal.id).receipt;
    assert.equal(receipt.actionDigest, proposal.actionDigest);
    assert.deepEqual(receipt.scope, proposal.action.scope);
    const reloaded = f.make();
    assert.equal(reloaded.reviewProposal(proposal.id).receipt.id, receipt.id, 'review receipt survives reload');

    const pending = reloaded.requestApproval({ proposalId: proposal.id });
    assert.equal(pending.approval.status, 'pending');
    assert.equal(JSON.stringify(reloaded.snapshot()).includes(pending.token), false, 'raw approval decision tokens never persist');
    const approved = reloaded.approveApproval({ approvalId: pending.approval.id, approvalToken: pending.token, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest });
    assert.equal(approved.approval.status, 'approved');
    assert.equal(typeof approved.executionToken, 'string');
    await assertCode('approval_not_pending', () => reloaded.approveApproval({ approvalId: pending.approval.id, approvalToken: pending.token }));

    const executionReload = f.make();
    assert.deepEqual(executionReload.lastReload.invalidatedApprovalIds, [pending.approval.id], 'reload invalidates persisted authorization capabilities');
    await assertCode('stale_approval', () => executionReload.execute({ approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest }));
    const freshPending = executionReload.requestApproval({ proposalId: proposal.id });
    const freshApproved = executionReload.approve({ approvalId: freshPending.approval.id, token: freshPending.token, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest });
    const result = await executionReload.execute({ approvalId: freshPending.approval.id, executionToken: freshApproved.executionToken, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest });
    assert.equal(result.executed, true);
    assert.equal(f.executor.calls.length, 1);
    assert.equal(f.executor.calls[0].actionDigest, proposal.actionDigest);
    await assertCode('replay_rejected', () => executionReload.execute({ approvalId: freshPending.approval.id, executionToken: freshApproved.executionToken, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest }));
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('tampered scope and stale approval are rejected before executor boundary', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const proposal = workflow.createProposal(proposalInput()).proposal;
    const pending = workflow.requestApproval({ proposalId: proposal.id });
    await assertCode('scope_mismatch', () => workflow.approveApproval({ approvalId: pending.approval.id, approvalToken: pending.token, scope: { deviceIds: ['device-18'], commands: ['interface Gi1/0/1'] } }));
    const approved = workflow.approve({ approvalId: pending.approval.id, approvalToken: pending.token, scope: proposal.action.scope });
    assert.equal(approved.approval.status, 'approved');

    const replacement = workflow.replaceProposal(proposal.id, proposalInput({ scope: { deviceIds: ['device-18'], commands: ['interface Gi1/0/1'] } })).proposal;
    assert.notEqual(replacement.actionDigest, proposal.actionDigest);
    assert.equal(workflow.getApproval(pending.approval.id).status, 'stale');
    await assertCode('stale_approval', () => workflow.execute({ approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: replacement.id, scope: replacement.action.scope }));
    assert.equal(f.executor.calls.length, 0, 'stale approval cannot cross executor boundary');
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('deny, cancel, expiry, plan mode, and missing executor all fail closed', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const proposal = workflow.createProposal(proposalInput()).proposal;
    const denied = workflow.requestApproval({ proposalId: proposal.id });
    assert.equal(workflow.denyApproval({ approvalId: denied.approval.id, token: denied.token, reason: 'wrong target' }).approval.status, 'denied');
    await assertCode('approval_not_pending', () => workflow.denyApproval({ approvalId: denied.approval.id, token: denied.token }));

    const canceled = workflow.requestApproval({ proposalId: proposal.id });
    assert.equal(workflow.cancelApproval({ approvalId: canceled.approval.id, token: canceled.token }).approval.status, 'canceled');

    const plan = workflow.createProposal(proposalInput({ mode: 'plan' })).proposal;
    const planApproval = workflow.requestApproval({ proposalId: plan.id });
    await assertCode('plan_forbids_tools', () => workflow.approve({ approvalId: planApproval.approval.id, token: planApproval.token }));
    assert.equal(workflow.renderApprovalCard(planApproval.approval.id).executionAllowed, false);

    const expiring = workflow.createProposal(proposalInput({ scope: { deviceIds: ['device-expiring'] } })).proposal;
    const expiringApproval = workflow.requestApproval({ proposalId: expiring.id, ttlMs: 10 });
    f.advance(11);
    await assertCode('approval_expired', () => workflow.approve({ approvalId: expiringApproval.approval.id, token: expiringApproval.token }));

    const noExecutorWorkflow = new ApprovalWorkflow({ storagePath: path.join(f.directory, 'no-executor.json'), clock: f.clock });
    const noExecutorProposal = noExecutorWorkflow.createProposal(proposalInput({ scope: { deviceIds: ['device-no-executor'] } })).proposal;
    const noExecutorPending = noExecutorWorkflow.requestApproval({ proposalId: noExecutorProposal.id });
    const noExecutorApproved = noExecutorWorkflow.approve({ approvalId: noExecutorPending.approval.id, token: noExecutorPending.token });
    await assertCode('executor_unavailable', () => noExecutorWorkflow.execute({ approvalId: noExecutorPending.approval.id, executionToken: noExecutorApproved.executionToken }));
    assert.equal(noExecutorWorkflow.getApproval(noExecutorPending.approval.id).status, 'approved', 'unavailable executor does not consume approval');
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('rendering and proposal creation perform no executor or external calls', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const before = workflow.snapshot().revision;
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['device-render-only'] } })).proposal;
    workflow.renderProposal(proposal.id);
    const pending = workflow.requestApproval({ proposalId: proposal.id });
    workflow.renderApprovalCard(pending.approval.id);
    assert.equal(f.executor.calls.length, 0);
    assert.equal(workflow.snapshot().revision > before, true);
    assert.equal(workflow.getApproval(pending.approval.id).status, 'pending');
    await Promise.resolve();
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('a failed mock write is recorded as unknown and its token cannot be replayed', async () => {
  const f = fixture();
  const failingExecutor = createMockExecutor(async () => {
    const error = new Error('simulated transport interruption');
    error.code = 'mock_transport_interrupted';
    throw error;
  });
  try {
    const workflow = new ApprovalWorkflow({ storagePath: path.join(f.directory, 'unknown.json'), clock: f.clock, executor: failingExecutor });
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['device-unknown'] } })).proposal;
    const pending = workflow.requestApproval({ proposalId: proposal.id });
    const approved = workflow.approve({ approvalId: pending.approval.id, token: pending.token });
    await assertCode('execution_unknown', () => workflow.execute({ approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: proposal.id, scope: proposal.action.scope }));
    assert.equal(workflow.getApproval(pending.approval.id).status, 'unknown');
    assert.equal(failingExecutor.calls.length, 1);
    await assertCode('replay_rejected', () => workflow.execute({ approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: proposal.id, scope: proposal.action.scope }));
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('tampering the authoritative SQLite payload is detected before reload', async () => {
  const f = fixture();
  const statePath = path.join(f.directory, 'workflow.json');
  try {
    const workflow = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock });
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['device-persisted'] } })).proposal;
    const database = new DatabaseSync(`${statePath}.sqlite`);
    const row = database.prepare('SELECT revision, payload FROM workflow_state WHERE id = 1').get();
    const persisted = JSON.parse(row.payload);
    const record = persisted.proposals.find((item) => item.id === proposal.id);
    record.action.scope.deviceIds = ['device-tampered'];
    database.prepare('UPDATE workflow_state SET revision = ?, payload = ? WHERE id = 1').run(row.revision, JSON.stringify(persisted));
    database.close();
    await assertCode('state_invalid', () => new ApprovalWorkflow({ storagePath: statePath, clock: f.clock }));
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('file-backed owners use revision CAS and reject a stale writer', async () => {
  const f = fixture();
  const statePath = path.join(f.directory, 'cas.json');
  try {
    const first = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock });
    const second = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock });
    first.createProposal(proposalInput({ scope: { deviceIds: ['cas-first'] } }));
    await assertCode('state_conflict', () => second.createProposal(proposalInput({ scope: { deviceIds: ['cas-second'] } })));
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.deepEqual(persisted.proposals.map((item) => item.action.scope.deviceIds[0]), ['cas-first']);
    assert.equal(second.snapshot().proposals.length, 1, 'stale owner reloads before retry');
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('database failures never advance local authorization before retry', async () => {
  const f = fixture();
  const statePath = path.join(f.directory, 'faulted-commit.json');
  const databasePath = `${statePath}.sqlite`;
  const blockedPath = `${databasePath}.blocked`;
  const blockDatabase = () => {
    fs.renameSync(databasePath, blockedPath);
    fs.mkdirSync(databasePath);
  };
  const unblockDatabase = () => {
    fs.rmSync(databasePath, { recursive: true, force: true });
    fs.renameSync(blockedPath, databasePath);
  };
  try {
    const workflow = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock, executor: f.executor });
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['faulted-commit'] } })).proposal;
    const pending = workflow.requestApproval({ proposalId: proposal.id });
    blockDatabase();
    await assert.rejects(Promise.resolve().then(() => workflow.approve({ approvalId: pending.approval.id, token: pending.token, scope: proposal.action.scope })));
    assert.equal(workflow.getApproval(pending.approval.id).status, 'pending', 'failed approval commit cannot advance local authorization');
    unblockDatabase();
    const approved = workflow.approve({ approvalId: pending.approval.id, token: pending.token, scope: proposal.action.scope });
    blockDatabase();
    await assert.rejects(Promise.resolve().then(() => workflow.execute({ approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: proposal.id, scope: proposal.action.scope })));
    assert.equal(workflow.getApproval(pending.approval.id).status, 'approved', 'failed execution-start commit keeps the one-time token available for retry');
    assert.equal(f.executor.calls.length, 0, 'executor is not crossed when authorization persistence fails');
  } finally {
    if (fs.existsSync(databasePath) && fs.lstatSync(databasePath).isDirectory()) unblockDatabase();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('authoritative SQLite state survives a mirror crash and exact reopen', async () => {
  const f = fixture();
  const statePath = path.join(f.directory, 'mirror-crash.json');
  const originalRename = fs.renameSync;
  try {
    const workflow = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock, executor: f.executor });
    fs.renameSync = () => { throw Object.assign(new Error('simulated mirror crash'), { code: 'EIO' }); };
    const created = workflow.createProposal(proposalInput({ scope: { deviceIds: ['mirror-crash'] } })).proposal;
    fs.renameSync = originalRename;
    assert.equal(workflow.getProposal(created.id).action.scope.deviceIds[0], 'mirror-crash');
    const reopened = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock, executor: f.executor });
    assert.deepEqual(reopened.getProposal(created.id), workflow.getProposal(created.id), 'reopen reads the SQLite commit even when JSON export crashed');
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('one proposal has at most one active or completed approval', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['duplicate-approval'] } })).proposal;
    const pending = workflow.requestApproval({ proposalId: proposal.id });
    await assertCode('approval_exists', () => workflow.requestApproval({ proposalId: proposal.id }));
    const approved = workflow.approve({ approvalId: pending.approval.id, token: pending.token, scope: proposal.action.scope });
    await workflow.execute({ approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: proposal.id, scope: proposal.action.scope });
    await assertCode('approval_exists', () => workflow.requestApproval({ proposalId: proposal.id }));
    assert.equal(f.executor.calls.length, 1);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('stale owners cannot consume one approval or cross the executor twice', async () => {
  const f = fixture();
  const statePath = path.join(f.directory, 'owner-cas.json');
  try {
    const first = f.make();
    const second = f.make();
    const proposal = first.createProposal(proposalInput({ scope: { deviceIds: ['owner-cas'] } })).proposal;
    const pending = first.requestApproval({ proposalId: proposal.id });
    // Simulate two processes that read the same durable revision before either
    // decision. Each process has its own in-memory authorization copy.
    second.state = JSON.parse(JSON.stringify(first.state));
    second.durableState = JSON.parse(JSON.stringify(first.state));
    const firstApproval = first.approve({ approvalId: pending.approval.id, token: pending.token, scope: proposal.action.scope, actionDigest: proposal.actionDigest });
    await assertCode('state_conflict', () => second.approve({ approvalId: pending.approval.id, token: pending.token, scope: proposal.action.scope, actionDigest: proposal.actionDigest }));
    second.state = JSON.parse(JSON.stringify(first.state));
    second.durableState = JSON.parse(JSON.stringify(first.state));
    const executions = await Promise.allSettled([
      first.execute({ approvalId: pending.approval.id, executionToken: firstApproval.executionToken, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest }),
      second.execute({ approvalId: pending.approval.id, executionToken: firstApproval.executionToken, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest })
    ]);
    assert.equal(executions.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(f.executor.calls.length, 1, 'SQLite CAS allows one executor crossing');
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('credential-bearing workflow payloads are rejected before public or persisted state', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    await assertCode('credential_input', () => workflow.createPendingQuestion({ prompt: 'Which host?', context: { apiKey: 'secret-value' } }));
    const question = workflow.createPendingQuestion({ prompt: 'Which host?', allowFreeText: true });
    await assertCode('credential_input', () => workflow.answerQuestion({ questionId: question.question.id, questionToken: question.token, text: 'password: secret-value' }));
    await assertCode('credential_input', () => workflow.createProposal(proposalInput({ target: { deviceId: 'device-17', privateKey: '-----BEGIN PRIVATE KEY-----' } })));
    assert.equal(fs.existsSync(path.join(f.directory, 'workflow.json')), true);
    assert.equal(fs.readFileSync(path.join(f.directory, 'workflow.json'), 'utf8').includes('secret-value'), false);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('durable JSON and SQLite rows never contain raw workflow authorization tokens', async () => {
  const f = fixture();
  const statePath = path.join(f.directory, 'token-redaction.json');
  try {
    const workflow = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock, executor: f.executor });
    const question = workflow.createPendingQuestion({ prompt: 'Which host?', choices: ['edge-17'], allowFreeText: false });
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['token-redaction'] } })).proposal;
    const approval = workflow.requestApproval({ proposalId: proposal.id });
    const jsonMirror = fs.readFileSync(statePath, 'utf8');
    const database = new DatabaseSync(`${statePath}.sqlite`);
    const sqlitePayload = database.prepare('SELECT payload FROM workflow_state WHERE id = 1').get().payload;
    database.close();
    for (const rawToken of [question.token, approval.token]) {
      assert.equal(jsonMirror.includes(rawToken), false, 'JSON mirror does not contain raw tokens');
      assert.equal(sqlitePayload.includes(rawToken), false, 'SQLite payload does not contain raw tokens');
    }
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('rendered expired, stale, and terminal cards cannot advertise actionability', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const question = workflow.createPendingQuestion({ prompt: 'Confirm host?', ttlMs: 10 });
    f.advance(11);
    assert.equal(workflow.renderQuestionCard(question.question.id).interactive, false);
    assert.equal(workflow.getQuestion(question.question.id).status, 'expired');
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['render-stale'] } })).proposal;
    const pending = workflow.requestApproval({ proposalId: proposal.id, ttlMs: 10 });
    workflow.invalidateProposal(proposal.id, 'changed before approval');
    assert.equal(workflow.renderProposal(proposal.id).executionAllowed, false);
    assert.equal(workflow.renderApprovalCard(pending.approval.id).interactive, false);
    const freshProposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['render-expired'] } })).proposal;
    const expiring = workflow.requestApproval({ proposalId: freshProposal.id, ttlMs: 10 });
    f.advance(11);
    const card = workflow.renderApprovalCard(expiring.approval.id);
    assert.equal(card.approval.status, 'expired');
    assert.equal(card.executionAllowed, false);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('approval cannot override a proposal clarification binding', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const first = workflow.createPendingQuestion({ prompt: 'First answer?', allowFreeText: true });
    workflow.answerQuestion({ questionId: first.question.id, questionToken: first.token, text: 'first' });
    const second = workflow.createPendingQuestion({ prompt: 'Second answer?', allowFreeText: true });
    workflow.answerQuestion({ questionId: second.question.id, questionToken: second.token, text: 'second' });
    const proposal = workflow.createProposal(proposalInput({ questionId: first.question.id, scope: { deviceIds: ['binding'] } })).proposal;
    await assertCode('question_binding_mismatch', () => workflow.requestApproval({ proposalId: proposal.id, questionId: second.question.id }));
    const accepted = workflow.requestApproval({ proposalId: proposal.id });
    assert.equal(accepted.approval.questionId, first.question.id);
    assert.equal(accepted.approval.questionAnswerDigest, digest({ choice: null, text: 'first' }));
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('reload invalidates forged authorization while preserving review audit data', async () => {
  const f = fixture();
  const statePath = path.join(f.directory, 'reload-auth.json');
  try {
    const workflow = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock });
    const proposal = workflow.createProposal(proposalInput({ scope: { deviceIds: ['reload-auth'] } })).proposal;
    const pending = workflow.requestApproval({ proposalId: proposal.id });
    const pendingQuestion = workflow.createPendingQuestion({ prompt: 'Reload question?', allowFreeText: true });
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const record = state.approvals.find((item) => item.id === pending.approval.id);
    record.status = 'approved';
    record.decisionTokenHash = null;
    record.executionTokenHash = 'a'.repeat(64);
    const questionRecord = state.questions.find((item) => item.id === pendingQuestion.question.id);
    questionRecord.status = 'answered';
    questionRecord.answer = { choice: null, text: 'forged answer' };
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    const reloaded = new ApprovalWorkflow({ storagePath: statePath, clock: f.clock, executor: f.executor });
    assert.deepEqual(reloaded.lastReload.invalidatedApprovalIds, [pending.approval.id]);
    assert.deepEqual(reloaded.lastReload.invalidatedQuestionIds, [pendingQuestion.question.id]);
    assert.equal(reloaded.getQuestion(pendingQuestion.question.id).status, 'stale', 'reload invalidates forged clarification authorization');
    assert.equal(reloaded.getApproval(pending.approval.id).status, 'stale');
    assert.equal(reloaded.snapshot().receipts.length, 1, 'review receipt survives authorization invalidation');
    await assertCode('stale_approval', () => reloaded.execute({ approvalId: pending.approval.id, executionToken: 'a'.repeat(64), proposalId: proposal.id, scope: proposal.action.scope }));
    assert.equal(f.executor.calls.length, 0);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('answered clarification history and review receipts survive repeated reloads', async () => {
  const f = fixture();
  try {
    const workflow = f.make();
    const question = workflow.createPendingQuestion({ prompt: 'Which reviewed device?', choices: ['device-17'], allowFreeText: false });
    workflow.answerQuestion({ questionId: question.question.id, questionToken: question.token, choice: 'device-17' });
    const proposal = workflow.createProposal(proposalInput({ questionId: question.question.id })).proposal;
    const receipt = workflow.reviewProposal(proposal.id).receipt;
    const pending = workflow.requestApproval({ proposalId: proposal.id });
    const approved = workflow.approve({ approvalId: pending.approval.id, token: pending.token, scope: proposal.action.scope, actionDigest: proposal.actionDigest });
    assert.equal(approved.approval.status, 'approved');

    const firstReload = f.make();
    assert.equal(firstReload.getQuestion(question.question.id).status, 'answered', 'answered clarification remains historical');
    assert.equal(firstReload.reviewProposal(proposal.id).receipt.id, receipt.id);
    assert.equal(firstReload.getApproval(pending.approval.id).status, 'stale', 'reload invalidates the active approval token');

    const secondReload = f.make();
    assert.equal(secondReload.getQuestion(question.question.id).status, 'answered', 'second reload keeps the answer binding');
    assert.equal(secondReload.reviewProposal(proposal.id).receipt.id, receipt.id, 'review receipt remains readable after repeated reload');
    assert.equal(secondReload.getApproval(pending.approval.id).status, 'stale');
    await assertCode('stale_approval', () => secondReload.execute({ approvalId: pending.approval.id, executionToken: approved.executionToken, proposalId: proposal.id, scope: proposal.action.scope, actionDigest: proposal.actionDigest }));
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
