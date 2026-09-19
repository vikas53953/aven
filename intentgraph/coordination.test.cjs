'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { IndexStore, sha256 } = require('./indexer.cjs');
const { IntentEngine } = require('./engine.cjs');
const { Coordinator } = require('./coordinator.cjs');
const { ENDPOINT, MODEL, USER_AGENT, createProvider } = require('./provider.cjs');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Map([['content-length', String(Buffer.byteLength(body))]]), text: async () => body };
}

function providerResponse(content, outputTokens = 10) {
  return { content, usage: { outputTokens } };
}

async function waitFor(check, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for test state');
}

async function fixture(providerFactory) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-coordination-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.intentgraph'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'export function main(){ return 1; }\n');
  const runtime = path.join(root, '.intentgraph', 'runtime');
  const indexer = new IndexStore(root, runtime);
  const engine = new IntentEngine(root, indexer, runtime);
  await engine.initialize();
  for (const role of ['planner', 'builder', 'reviewer', 'acceptance']) await engine.action({ type: 'agent.register', id: role, name: role, role });
  const baseline = (await engine.action({ type: 'baseline.create', title: 'Coordination fixture', intent: 'Keep the function behavior clear.', criteria: [{ id: 'behavior', text: 'main returns one' }] })).baseline;
  await engine.action({ type: 'baseline.approve', baselineId: baseline.id });
  const task = (await engine.action({ type: 'task.create', title: 'Update fixture', baselineId: baseline.id, plannerId: 'planner', builderId: 'builder', reviewerId: 'reviewer', acceptanceId: 'acceptance', files: ['src/main.js'] })).task;
  const provider = providerFactory ? providerFactory(root) : null;
  return { root, runtime, engine, task, provider };
}

function deterministicProvider({ failFirstEngineer = false, waitForCall = null } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async complete({ messages }) {
      calls += 1;
      if (waitForCall) await waitForCall(calls);
      const input = JSON.parse(messages[1].content);
      if (input.role === 'planner' && input.operation === 'plan') return providerResponse(JSON.stringify({ summary: 'Preserve behavior.', steps: ['Review the existing function.'] }));
      if (input.role === 'builder') {
        const source = input.source[0];
        const content = input.correctionRound ? source.content : source.content.replace('return 1', 'return 1');
        return providerResponse(JSON.stringify({ summary: 'Keep the existing behavior.', files: [{ path: source.path, baseHash: source.baseHash, content }] }));
      }
      const criteria = input.criteria.map((item) => item.id);
      if (failFirstEngineer && input.role === 'engineer' && !this.failed) { this.failed = true; return providerResponse(JSON.stringify({ outcome: 'fail', criteria, findings: ['Clarify the behavior.'] })); }
      return providerResponse(JSON.stringify({ outcome: 'pass', criteria, findings: [] }));
    },
    status() { return { model: MODEL }; }
  };
}

test('OpenCode provider pins endpoint/session, bounds requests, and classifies failures without retry', async () => {
  let request;
  let calls = 0;
  const provider = createProvider({ getKey: () => 'test-key', fetchImpl: async (...args) => { calls += 1; request = args; return response(JSON.stringify({ id: 'x', model: MODEL, choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 2, completion_tokens: 3 } })); } });
  const result = await provider.complete({ messages: [{ role: 'user', content: 'hello' }], sessionId: 'stable-run-role', maxTokens: 20 });
  assert.equal(result.content, 'ok');
  assert.equal(calls, 1);
  assert.equal(request[0], ENDPOINT);
  assert.equal(request[1].headers.authorization, 'Bearer test-key');
  assert.equal(request[1].headers['x-opencode-session'], 'stable-run-role');
  assert.equal(request[1].headers['user-agent'], USER_AGENT);
  assert.equal(request[1].redirect, 'error');
  assert.equal(JSON.parse(request[1].body).model, MODEL);

  for (const status of [401, 404, 429, 500]) {
    let failedCalls = 0;
    const failing = createProvider({ getKey: () => 'test-key', fetchImpl: async () => { failedCalls += 1; return response('{}', status); } });
    await assert.rejects(() => failing.complete({ messages: [{ role: 'user', content: 'hello' }], sessionId: 'stable' }), (error) => error.classification === (status >= 500 ? '5xx' : String(status)) && error.retryable === false);
    assert.equal(failedCalls, 1);
  }
  const controller = new AbortController();
  controller.abort();
  let keyCalls = 0;
  const cancelled = createProvider({ getKey: () => { keyCalls += 1; return 'test-key'; }, fetchImpl: async () => response('{}') });
  await assert.rejects(() => cancelled.complete({ messages: [{ role: 'user', content: 'hello' }], sessionId: 'stable', signal: controller.signal }), { code: 'provider_cancelled' });
  assert.equal(keyCalls, 0);
});

test('coordinator takes a durable snapshot, requires explicit apply, records evidence, and is idempotent', async () => {
  const provider = deterministicProvider();
  const fixtureData = await fixture(() => provider);
  const coordinator = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
  try {
    const started = await coordinator.start({ taskId: fixtureData.task.id });
    const proposal = await waitFor(() => coordinator.status().runs.find((run) => run.runId === started.runId && run.status === 'awaiting-apply'));
    assert.equal(proposal.proposal.files.length, 1);
    assert.match(fs.readFileSync(path.join(fixtureData.root, 'src', 'main.js'), 'utf8'), /return 1/);
    const applied = await coordinator.apply({ runId: started.runId });
    assert.equal(applied.status, 'awaiting-owner');
    assert.equal(fs.existsSync(path.join(fixtureData.root, '.intentgraph', 'evidence', `${started.runId}-review.json`)), true);
    const recorded = await fixtureData.engine.getState();
    assert.equal(recorded.evidence.length, 1);
    assert.equal(recorded.reviews.length, 3);
    const again = await coordinator.apply({ runId: started.runId });
    assert.equal(again.idempotent, true);
    const feedback = await coordinator.feedback({ runId: started.runId, text: 'Please retain the existing return behavior.' });
    assert.equal(feedback.status, 'awaiting-owner');
    assert.ok(coordinator.status().runs[0].feedback.length === 1);
  } finally {
    await coordinator.close();
    fs.rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test('engine review submission failures remain visible as a source-review handoff', async () => {
  const provider = deterministicProvider();
  const fixtureData = await fixture(() => provider);
  const originalAction = fixtureData.engine.action.bind(fixtureData.engine);
  fixtureData.engine.action = async (input) => {
    if (input.type === 'evidence.add') throw new Error('gate handoff unavailable');
    return originalAction(input);
  };
  const coordinator = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
  try {
    const started = await coordinator.start({ taskId: fixtureData.task.id });
    await waitFor(() => coordinator.status().runs.find((run) => run.runId === started.runId && run.status === 'awaiting-apply'));
    const applied = await coordinator.apply({ runId: started.runId });
    assert.equal(applied.status, 'awaiting-owner');
    const run = coordinator.status().runs.find((item) => item.runId === started.runId);
    assert.match(run.engineReviewPending.error.message, /gate handoff unavailable/);
    assert.equal(run.engineReviewPending.provenance, 'source-review');
    assert.equal((await fixtureData.engine.getState()).evidence.length, 0);
  } finally {
    await coordinator.close();
    fs.rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test('coordinator rejects traversal, protected files, symlinks, and stale CAS before writing', async () => {
  const provider = deterministicProvider();
  const fixtureData = await fixture(() => provider);
  try {
    const badEngine = {
      getState: async () => ({ tasks: [{ ...fixtureData.task, files: ['../outside.js'] }], baselines: [{ id: fixtureData.task.baselineId, approved: true, criteria: [{ id: 'behavior', text: 'x' }] }] }),
      getIndex: async () => ({ files: [] }),
      getSource: async () => ({ content: 'x', hash: sha256('x') })
    };
    const badCoordinator = new Coordinator({ root: fixtureData.root, engine: badEngine, provider, runtimeDirectory: fixtureData.runtime });
    await assert.rejects(() => badCoordinator.start({ taskId: fixtureData.task.id }), /traversal|relative|protected/i);
    await badCoordinator.close();
    const protectedEngine = {
      getState: async () => ({ tasks: [{ ...fixtureData.task, files: ['credentials/secret.js'] }], baselines: [{ id: fixtureData.task.baselineId, approved: true, criteria: [{ id: 'behavior', text: 'x' }] }], agents: [{ id: 'planner', role: 'planner' }, { id: 'builder', role: 'builder' }, { id: 'reviewer', role: 'reviewer' }, { id: 'acceptance', role: 'acceptance' }] }),
      getIndex: async () => ({ files: [] }),
      getSource: async () => ({ content: 'x', hash: sha256('x') })
    };
    const protectedCoordinator = new Coordinator({ root: fixtureData.root, engine: protectedEngine, provider, runtimeDirectory: fixtureData.runtime });
    await assert.rejects(() => protectedCoordinator.start({ taskId: fixtureData.task.id }), /protected|coordination area/i);
    await protectedCoordinator.close();
    try {
      fs.writeFileSync(path.join(fixtureData.root, 'outside.js'), 'outside');
      fs.symlinkSync(path.join(fixtureData.root, 'outside.js'), path.join(fixtureData.root, 'src', 'alias.js'), 'file');
      const symlinkEngine = {
        getState: async () => ({ tasks: [{ ...fixtureData.task, files: ['src/alias.js'] }], baselines: [{ id: fixtureData.task.baselineId, approved: true, criteria: [{ id: 'behavior', text: 'x' }] }], agents: [{ id: 'planner', role: 'planner' }, { id: 'builder', role: 'builder' }, { id: 'reviewer', role: 'reviewer' }, { id: 'acceptance', role: 'acceptance' }] }),
        getIndex: async () => ({ files: [] }),
        getSource: async () => ({ content: 'outside', hash: sha256('outside') })
      };
      const symlinkCoordinator = new Coordinator({ root: fixtureData.root, engine: symlinkEngine, provider, runtimeDirectory: fixtureData.runtime });
      await assert.rejects(() => symlinkCoordinator.start({ taskId: fixtureData.task.id }), /symlink|junction/i);
      await symlinkCoordinator.close();
    } catch (error) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
    }

    const coordinator = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
    const started = await coordinator.start({ taskId: fixtureData.task.id });
    await waitFor(() => coordinator.status().runs.find((run) => run.runId === started.runId && run.status === 'awaiting-apply'));
    fs.writeFileSync(path.join(fixtureData.root, 'src', 'main.js'), 'export function main(){ return 9; }\n');
    await assert.rejects(() => coordinator.apply({ runId: started.runId }), /CAS|changed|stale|base hash/i);
    assert.match(fs.readFileSync(path.join(fixtureData.root, 'src', 'main.js'), 'utf8'), /return 9/);
    await coordinator.close();
  } finally {
    fs.rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test('review corrections produce a new proposal that still requires explicit apply', async () => {
  const provider = deterministicProvider({ failFirstEngineer: true });
  const fixtureData = await fixture(() => provider);
  const coordinator = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
  try {
    const started = await coordinator.start({ taskId: fixtureData.task.id });
    await waitFor(() => coordinator.status().runs.find((run) => run.runId === started.runId && run.status === 'awaiting-apply'));
    const first = await coordinator.apply({ runId: started.runId });
    assert.equal(first.status, 'awaiting-apply');
    assert.equal(coordinator.status().runs.find((run) => run.runId === started.runId).round, 1);
    const contentBeforeCorrection = fs.readFileSync(path.join(fixtureData.root, 'src', 'main.js'), 'utf8');
    assert.match(contentBeforeCorrection, /return 1/);
    const second = await coordinator.apply({ runId: started.runId });
    assert.equal(second.status, 'awaiting-owner');
  } finally {
    await coordinator.close();
    fs.rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test('close marks an in-flight run interrupted and resume never replays a write', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const provider = deterministicProvider({ waitForCall: async (calls) => { if (calls === 1) await waiting; } });
  const fixtureData = await fixture(() => provider);
  const coordinator = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
  const started = await coordinator.start({ taskId: fixtureData.task.id });
  await coordinator.close();
  release();
  await new Promise((resolve) => setTimeout(resolve, 15));
  const restarted = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
  try {
    assert.equal(restarted.status().runs.find((run) => run.runId === started.runId).status, 'interrupted');
    const resumed = await restarted.resume({ runId: started.runId });
    assert.equal(resumed.replayed, false);
    assert.match(fs.readFileSync(path.join(fixtureData.root, 'src', 'main.js'), 'utf8'), /return 1/);
  } finally {
    await restarted.close();
    fs.rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test('a second coordinator cannot construct during an active run and malformed locks remain fail-closed', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const provider = deterministicProvider({ waitForCall: async (calls) => { if (calls === 1) await waiting; } });
  const fixtureData = await fixture(() => provider);
  const coordinator = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
  try {
    const started = await coordinator.start({ taskId: fixtureData.task.id });
    assert.equal(started.status, 'planning');
    const admissionLock = path.join(fixtureData.runtime, 'coordination.admission.lock');
    assert.equal(fs.existsSync(admissionLock), true);
    assert.throws(() => new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime }), /owned|coordinator instance/i);
    assert.equal(fs.existsSync(admissionLock), true);
    assert.equal(coordinator.status().runs.find((run) => run.runId === started.runId).status, 'planning');
    release();
    await waitFor(() => coordinator.status().runs.find((run) => run.runId === started.runId && run.status === 'awaiting-apply'));
  } finally {
    await coordinator.close();
    const malformed = path.join(fixtureData.runtime, 'coordination.admission.lock');
    fs.writeFileSync(malformed, '');
    assert.throws(() => new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime }), /malformed/i);
    assert.equal(fs.existsSync(malformed), true);
    fs.rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test('global admission permits only one durable run and enforces the output budget', async () => {
  const provider = deterministicProvider();
  const fixtureData = await fixture(() => provider);
  const coordinator = new Coordinator({ root: fixtureData.root, engine: fixtureData.engine, provider, runtimeDirectory: fixtureData.runtime });
  try {
    const results = await Promise.allSettled([
      coordinator.start({ taskId: fixtureData.task.id }),
      coordinator.start({ taskId: fixtureData.task.id })
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  } finally {
    await coordinator.close();
    fs.rmSync(fixtureData.root, { recursive: true, force: true });
  }

  const budgetFixture = await fixture(() => ({
    async complete({ messages }) {
      const input = JSON.parse(messages[1].content);
      if (input.operation === 'plan') return providerResponse(JSON.stringify({ summary: 'plan', steps: [] }), 48000);
      return providerResponse('{}', 1);
    },
    status() { return {}; }
  }));
  const budgetCoordinator = new Coordinator({ root: budgetFixture.root, engine: budgetFixture.engine, provider: budgetFixture.provider, runtimeDirectory: budgetFixture.runtime });
  try {
    const started = await budgetCoordinator.start({ taskId: budgetFixture.task.id });
    const run = await waitFor(() => budgetCoordinator.status().runs.find((item) => item.runId === started.runId && item.status === 'budget-exceeded'));
    assert.equal(run.calls, 1);
    assert.equal(run.outputTokens, 48000);
  } finally {
    await budgetCoordinator.close();
    fs.rmSync(budgetFixture.root, { recursive: true, force: true });
  }
});
