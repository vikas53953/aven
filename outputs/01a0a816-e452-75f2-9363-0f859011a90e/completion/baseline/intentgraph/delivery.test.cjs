'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { CATALOG_HASH, DeliveryGate } = require('./delivery.cjs');
const { sha256 } = require('./indexer.cjs');

function fixtureRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `intentgraph-delivery-${name}-`));
}

function mockEngine(root, task, allowed = false, options = {}) {
  const files = (task.files || []).map((filePath) => {
    const absolute = path.join(root, filePath);
    return { path: filePath, hash: sha256(fs.readFileSync(absolute)), bytes: fs.statSync(absolute).size };
  });
  let revision = 1;
  return {
    root,
    indexer: { root },
    async getIndex() { return { revision, files }; },
    async getState() { return { tasks: [task] }; },
    async getGate(taskId) { return { taskId, allowed, reasons: allowed ? [] : ['reviews are not complete'], revision }; },
    async refresh() {
      revision += 1;
      for (const filePath of [].concat(options.mutateOnRefresh || [])) fs.writeFileSync(path.join(root, filePath), 'module.exports = 99;\n');
    }
  };
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeTrustedEvidence(root, task) {
  const candidateFiles = task.files.map((filePath) => ({ path: filePath, hash: sha256(fs.readFileSync(path.join(root, filePath))) }));
  const evidenceDirectory = path.join(root, '.intentgraph', 'evidence');
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(evidenceDirectory, `delivery-${task.id}.json`), JSON.stringify({
    type: 'intentgraph.delivery.check',
    taskId: task.id,
    commandId: 'verify-intentgraph',
    commandCatalogHash: CATALOG_HASH,
    root: fs.realpathSync(root),
    candidateFiles,
    checksPassed: true,
    checks: [{ passed: true, exitCode: 0, timedOut: false, outputLimited: false, executable: process.execPath, cwd: fs.realpathSync(root), args: ['--test', 'intentgraph/backend.test.cjs', 'intentgraph/trace.test.cjs'] }],
    createdAt: new Date().toISOString()
  }));
}

test('status reports the non-Git workspace as blocked and pins the catalog', async () => {
  const root = fixtureRoot('status');
  try {
    fs.writeFileSync(path.join(root, 'candidate.js'), 'module.exports = 1;\n');
    const task = { id: 'task-1', files: ['candidate.js'] };
    const gate = new DeliveryGate({ root, engine: mockEngine(root, task) });
    const status = await gate.status();
    assert.equal(status.status, 'blocked');
    assert.equal(status.git.isRepository, false);
    assert.equal(status.catalog.hash, CATALOG_HASH);
    assert.equal(status.catalog.pinned, true);
    assert.match(status.reasons.join('\n'), /not a Git repository/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('run executes only the fixed syntax command, records bounded evidence, and never grants release', async () => {
  const root = fixtureRoot('run');
  try {
    fs.writeFileSync(path.join(root, 'candidate.js'), 'module.exports = 1;\n');
    const task = { id: 'task-1', files: ['candidate.js'] };
    const gate = new DeliveryGate({ root, engine: mockEngine(root, task, true) });
    const result = await gate.run({ taskId: task.id, commandId: 'check-candidate' });
    assert.equal(result.checksPassed, true);
    assert.equal(result.gateAllowed, true);
    assert.equal(result.ok, false, 'non-Git workspaces cannot be merge-ready');
    assert.equal(result.gatedStatus.build, 'passed');
    assert.equal(result.gatedStatus.release, 'blocked');
    assert.ok(result.evidence && result.evidence.path);
    assert.ok(fs.existsSync(path.join(root, result.evidence.path)));

    const injected = await gate.run({ taskId: task.id, commandId: 'node --eval' });
    assert.equal(injected.status, 'blocked');
    assert.match(injected.reasons.join('\n'), /unknown delivery command/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('setup pins transitive fixed-runner modules and run rechecks source and candidate hashes after the command', async () => {
    const root = fixtureRoot('post-check');
  try {
    fs.mkdirSync(path.join(root, 'intentgraph'), { recursive: true });
    fs.writeFileSync(path.join(root, 'candidate.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(root, 'intentgraph', 'delivery.cjs'), 'module.exports = 1;\n');
    const task = { id: 'task-1', files: ['candidate.js'] };
    const engine = mockEngine(root, task, true, { mutateOnRefresh: ['candidate.js', 'intentgraph/delivery.cjs'] });
    const gate = new DeliveryGate({ root, engine });
    const config = JSON.parse(fs.readFileSync(path.join(root, '.intentgraph', 'runtime', 'delivery-config.json'), 'utf8'));
    for (const fixedPath of ['intentgraph/execution-service.cjs', 'intentgraph/provider.cjs', 'intentgraph/vault.cjs', 'intentgraph/coordinator.cjs', 'intentgraph/coordination-schema.cjs', 'intentgraph/adapters/index.cjs', 'intentgraph/adapters/desktop.py', 'intentgraph/adapters/network.py', 'intentgraph/trace.cjs']) {
      assert.ok(Object.prototype.hasOwnProperty.call(config.protectedFiles, fixedPath));
    }
    for (const lockPath of ['package-lock.json', 'pnpm-lock.yaml', 'intentgraph/package-lock.json']) {
      assert.ok(Object.prototype.hasOwnProperty.call(config.protectedFiles, lockPath));
    }
    const result = await gate.run({ taskId: task.id, commandId: 'check-candidate' });
    assert.equal(result.checksPassed, true);
    assert.equal(result.allowed, false);
    assert.equal(result.sourceValidation.candidateStable, false);
    assert.match(result.reasons.join('\n'), /candidate changed while the delivery check ran/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('candidate files cannot include delivery runners, runtime, dependencies, or secrets', async () => {
  const root = fixtureRoot('candidate-boundary');
  try {
    fs.mkdirSync(path.join(root, 'intentgraph'), { recursive: true });
    fs.writeFileSync(path.join(root, 'intentgraph', 'backend.test.cjs'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(root, 'candidate.js'), 'module.exports = 1;\n');
    const engine = mockEngine(root, { id: 'task-1', files: ['candidate.js'] });
    const gate = new DeliveryGate({ root, engine });
    const deniedTask = { id: 'task-2', files: ['intentgraph/backend.test.cjs'] };
    engine.getState = async () => ({ tasks: [deniedTask] });
    const runner = await gate.run({ taskId: deniedTask.id, commandId: 'verify-intentgraph' });
    assert.equal(runner.status, 'blocked');
    assert.match(runner.reasons.join('\n'), /delivery tool/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('hook installation is explicit and the hook gate rejects staged files outside the reviewed task', async () => {
  const root = fixtureRoot('hooks');
  try {
    fs.writeFileSync(path.join(root, 'candidate.js'), 'module.exports = 1;\n');
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.name', 'IntentGraph Fixture');
    git(root, 'config', 'user.email', 'intentgraph-fixture@example.invalid');
    git(root, 'add', 'candidate.js');
    git(root, 'commit', '--quiet', '-m', 'fixture');
    const task = { id: 'task-1', files: ['candidate.js'], state: 'reviewing' };
    const gate = new DeliveryGate({ root, engine: mockEngine(root, task, true) });
    const installed = gate.installHooks({ repo: root });
    assert.deepEqual(installed.installed, ['pre-commit', 'pre-merge-commit', 'pre-push']);
    for (const hook of installed.installed) assert.ok(fs.existsSync(path.join(root, '.git', 'hooks', hook)));
    assert.throws(() => gate.installHooks({ repo: root }), /refusing to overwrite/);

    const withoutBuildEvidence = await gate.runHook({ hook: 'pre-commit' });
    assert.equal(withoutBuildEvidence.allowed, false);
    assert.match(withoutBuildEvidence.reasons.join('\n'), /successful verify-intentgraph evidence/);
    writeTrustedEvidence(root, task);
    const allowed = await gate.runHook({ hook: 'pre-commit' });
    assert.equal(allowed.allowed, true);
    fs.writeFileSync(path.join(root, 'outside.js'), 'module.exports = 2;\n');
    git(root, 'add', 'outside.js');
    const denied = await gate.runHook({ hook: 'pre-commit' });
    assert.equal(denied.allowed, false);
    assert.match(denied.reasons.join('\n'), /outside the active task/);

    git(root, 'commit', '--quiet', '--no-verify', '-m', 'historical outside change');
    const prePush = await gate.runHook({
      hook: 'pre-push',
      stdin: `refs/heads/main ${git(root, 'rev-parse', 'HEAD')} refs/heads/main ${'0'.repeat(40)}\n`
    });
    assert.equal(prePush.allowed, false, 'a pushed historical ref must be checked against its actual tree');
    assert.match(prePush.reasons.join('\n'), /pushed files are outside|pushed candidate differs|pre-push/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
