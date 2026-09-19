'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { start } = require('./server.cjs');
const { buildIndex, clearParseCache, getParseCacheStats, IndexStore } = require('./indexer.cjs');
const { IntentEngine } = require('./engine.cjs');

async function responseJson(response) {
  return response.json();
}

test('bounded service enforces checkpoint, race, and confinement boundaries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-fixture-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.intentgraph'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export function main(){ return 1; }\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
  fs.writeFileSync(path.join(root, '.intentgraph', 'evidence.md'), 'evidence\n');
  fs.writeFileSync(path.join(root, '.env'), 'DO_NOT_INDEX=1\n');
  const server = await start({ root, port: 0, rescanMs: 60000 });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(`${baseUrl}/api/session`)).json();
  const headers = { 'Content-Type': 'application/json', 'X-IntentGraph-Token': session.token, Origin: baseUrl };
  const get = async (route) => {
    const response = await fetch(`${baseUrl}${route}`);
    return { status: response.status, body: await responseJson(response) };
  };
  const post = async (action) => {
    const response = await fetch(`${baseUrl}/api/action`, { method: 'POST', headers, body: JSON.stringify(action) });
    return { status: response.status, body: await responseJson(response) };
  };
  try {
    assert.equal((await get('/api/state')).body.events.length, 0, 'startup indexing must not seed fake events');
    const missingOrigin = await fetch(`${baseUrl}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-IntentGraph-Token': session.token }, body: '{}' });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await get('/api/source?path=.env')).status, 404);
    assert.equal((await get('/api/source?path=../outside.txt')).status, 404);

    const baselineResult = await post({ type: 'baseline.create', title: 'Fixture', intent: 'Exercise service', criteria: [{ id: 'c1', text: 'main is reviewed' }], referencePaths: ['README.md'] });
    assert.equal(baselineResult.status, 200);
    const baselineId = baselineResult.body.result.baseline.id;
    const deniedBeforeApproval = await get('/api/gate?taskId=missing');
    assert.equal(deniedBeforeApproval.body.allowed, false);
    assert.ok(deniedBeforeApproval.body.reasons.includes('task not found'));
    assert.equal((await post({ type: 'baseline.approve', baselineId })).status, 200);

    const ids = {};
    for (const role of ['orchestrator', 'planner', 'builder', 'reviewer', 'acceptance']) {
      ids[role] = (await post({ type: 'agent.register', id: role, name: role, role })).body.result.agent.id;
    }
    const task = (await post({ type: 'task.create', title: 'Fixture task', baselineId, builderId: ids.builder, plannerId: ids.planner, reviewerId: ids.reviewer, acceptanceId: ids.acceptance, files: ['src/main.ts'] })).body.result.task;
    const outsideEvidence = await post({ type: 'evidence.add', taskId: task.id, actorId: ids.builder, path: '../outside.txt', criteria: ['c1'] });
    assert.notEqual(outsideEvidence.status, 200);
    const evidence = (await post({ type: 'evidence.add', taskId: task.id, actorId: ids.builder, path: '.intentgraph/evidence.md', criteria: ['c1'] })).body.result.evidence;
    for (const [kind, actorId] of [['planning', ids.planner], ['engineering', ids.reviewer], ['experience', ids.acceptance]]) {
      assert.equal((await post({ type: 'review.add', taskId: task.id, actorId, kind, outcome: 'pass', criteria: ['c1'], evidenceIds: [evidence.id] })).status, 200);
    }
    assert.equal((await get(`/api/gate?taskId=${encodeURIComponent(task.id)}`)).body.allowed, true);

    await post({ type: 'agent.register', id: 'planner-2', name: 'planner-2', role: 'planner' });
    assert.equal((await post({ type: 'task.assign', taskId: task.id, plannerId: 'planner-2' })).status, 200);
    assert.equal((await get(`/api/gate?taskId=${encodeURIComponent(task.id)}`)).body.allowed, false);
    assert.equal((await post({ type: 'task.assign', taskId: task.id, plannerId: ids.planner })).status, 200);
    const restoredGate = await get(`/api/gate?taskId=${encodeURIComponent(task.id)}`);
    assert.equal(restoredGate.body.allowed, false, 'restoring an old actor must not resurrect old reviews');
    const reassignedEvidence = (await post({ type: 'evidence.add', taskId: task.id, actorId: ids.builder, path: '.intentgraph/evidence.md', criteria: ['c1'] })).body.result.evidence;
    for (const [kind, actorId] of [['planning', ids.planner], ['engineering', ids.reviewer], ['experience', ids.acceptance]]) {
      assert.equal((await post({ type: 'review.add', taskId: task.id, actorId, kind, outcome: 'pass', criteria: ['c1'], evidenceIds: [reassignedEvidence.id] })).status, 200);
    }
    assert.equal((await get(`/api/gate?taskId=${encodeURIComponent(task.id)}`)).body.allowed, true);

    const releases = await Promise.allSettled([post({ type: 'checkpoint.release', taskId: task.id }), post({ type: 'checkpoint.release', taskId: task.id })]);
    assert.equal(releases.filter((item) => item.status === 'fulfilled' && item.value.status === 200).length, 1, 'serialized release must admit only one checkpoint');
    assert.equal(releases.filter((item) => item.status === 'fulfilled' && item.value.status !== 200).length, 1);
    const completedByState = await post({ type: 'task.state', taskId: task.id, actorId: ids.builder, state: 'completed' });
    assert.notEqual(completedByState.status, 200);

    fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export function main(){ return 2; }\n');
    const changedGate = await get(`/api/gate?taskId=${encodeURIComponent(task.id)}`);
    assert.ok(changedGate.body.reasons.every((reason) => !reason.includes('baseline revision') && !reason.includes('candidate differs from the approved baseline')));
    const diff = await get('/api/diff?path=src%2Fmain.ts');
    assert.equal(diff.body.path, 'src/main.ts');
    assert.match(diff.body.before, /return 1/);
    assert.match(diff.body.after, /return 2/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parser cache reuses unchanged AST work and invalidates on content or path-set changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-cache-'));
  fs.writeFileSync(path.join(root, 'a.js'), 'export function a(){ return 1; }\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'export function b(){ return 2; }\n');
  try {
    clearParseCache();
    buildIndex(root, { revision: 1 });
    const first = getParseCacheStats();
    assert.equal(first.entries, 2);
    buildIndex(root, { revision: 2 });
    const unchanged = getParseCacheStats();
    assert.equal(unchanged.misses, first.misses);
    assert.equal(unchanged.hits, first.hits + 2);
    fs.writeFileSync(path.join(root, 'a.js'), 'export function a(){ return 3; }\n');
    buildIndex(root, { revision: 3 });
    const changed = getParseCacheStats();
    assert.equal(changed.misses, first.misses + 1, 'changed content must reparse only that file');
    fs.writeFileSync(path.join(root, 'c.js'), 'export function c(){ return 4; }\n');
    buildIndex(root, { revision: 4 });
    const added = getParseCacheStats();
    assert.equal(added.misses, changed.misses + 3, 'changed full path-set must invalidate prior local resolutions');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('symlink aliases cannot expose secret or ignored targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-links-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'credentials'), { recursive: true });
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(root, 'credentials', 'profile.ts'), 'export const secret = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'safe.ts'), 'export const safe = 1;\n');
  try {
    try {
      fs.symlinkSync(path.join(root, '.env'), path.join(root, 'src', 'secret-alias.ts'), 'file');
      fs.symlinkSync(path.join(root, 'credentials', 'profile.ts'), path.join(root, 'src', 'credentials-alias.ts'), 'file');
    } catch {
      return; // Symlink creation can be disabled by Windows test policy.
    }
    clearParseCache();
    const index = buildIndex(root, { revision: 1 }).index;
    assert.ok(index.files.some((file) => file.path === 'src/safe.ts'));
    assert.ok(!index.files.some((file) => file.path.includes('secret-alias') || file.path.includes('credentials-alias')));
    const runtime = path.join(root, '.intentgraph', 'runtime');
    const store = new IndexStore(root, runtime);
    store.scan({ reason: 'test' });
    const engine = new IntentEngine(root, store, runtime);
    assert.throws(() => engine.readEvidenceFile('src/secret-alias.ts'));
    assert.throws(() => engine.readEvidenceFile('src/credentials-alias.ts'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restart does not invent a before diff from current bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-restart-'));
  fs.writeFileSync(path.join(root, 'a.js'), 'export const value = 1;\n');
  const runtime = path.join(root, '.intentgraph', 'runtime');
  try {
    const first = new IndexStore(root, runtime);
    first.scan({ reason: 'startup' });
    fs.writeFileSync(path.join(root, 'a.js'), 'export const value = 2;\n');
    const restarted = new IndexStore(root, runtime);
    restarted.load();
    restarted.scan({ reason: 'startup' });
    const diff = restarted.getDiff('a.js');
    assert.equal(diff.before, null);
    assert.match(diff.after, /value = 2/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
