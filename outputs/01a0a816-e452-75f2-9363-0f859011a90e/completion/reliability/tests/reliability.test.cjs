'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ReliabilityError,
  createMemoryStorage,
  createReliabilityLedger
} = require('../candidate/polished-reliability.js');
const { FileStorage } = require('../candidate/intentgraph/reliability-storage.cjs');

function ledger(storage, options = {}) {
  return createReliabilityLedger({
    storage,
    ownerId: options.ownerId || 'test-owner',
    idFactory: (() => { let i = 0; return (prefix) => `${prefix}-${++i}`; })(),
    now: () => 1700000000000,
    ...options
  });
}

test('drafts are keyed by chat and survive a fresh ledger instance', () => {
  const storage = createMemoryStorage();
  const first = ledger(storage);
  first.setDraft('chat-a', 'draft A');
  first.setDraft('chat-b', 'draft B');

  const afterReload = ledger(storage, { ownerId: 'reloaded-owner' });
  assert.equal(afterReload.getDraft('chat-a'), 'draft A');
  assert.equal(afterReload.getDraft('chat-b'), 'draft B');
  afterReload.setDraft('chat-a', 'updated A');
  assert.equal(afterReload.getDraft('chat-a'), 'updated A');
  assert.equal(afterReload.getDraft('chat-b'), 'draft B');
});

test('queue claims are FIFO, idempotent and never auto-dispatch after recovery', () => {
  const storage = createMemoryStorage();
  const first = ledger(storage);
  const a = first.enqueue('chat-a', 'first', { idempotencyKey: 'enqueue-a', itemId: 'item-a' });
  const duplicate = first.enqueue('chat-a', 'first', { idempotencyKey: 'enqueue-a', itemId: 'wrong-item' });
  assert.deepEqual(duplicate, a);
  first.enqueue('chat-a', 'second', { idempotencyKey: 'enqueue-b', itemId: 'item-b' });
  assert.equal(first.editQueued('chat-a', 'item-b', 'second edited', { idempotencyKey: 'edit-b' }).item.text, 'second edited');

  const claimA = first.claimNext('chat-a', { idempotencyKey: 'claim-a', consumerId: 'worker-a' });
  assert.equal(claimA.claimed, true);
  assert.equal(claimA.item.sequence, 1);
  assert.equal(first.claimNext('chat-a', { idempotencyKey: 'claim-a', consumerId: 'worker-a' }).reason, 'already_claimed');
  const competing = ledger(storage, { ownerId: 'other-owner' });
  assert.equal(competing.claimNext('chat-a', { idempotencyKey: 'claim-other', consumerId: 'worker-b' }).reason, 'in_flight');
  assert.throws(() => competing.settleQueue('chat-a', 'item-a', { claimKey: 'claim-a', idempotencyKey: 'settle-wrong', status: 'acknowledged', consumerId: 'worker-b' }), error => error.code === 'claim_conflict');
  first.settleQueue('chat-a', 'item-a', { claimKey: 'claim-a', idempotencyKey: 'settle-a', status: 'acknowledged', consumerId: 'worker-a' });

  const claimB = competing.claimNext('chat-a', { idempotencyKey: 'claim-b', consumerId: 'worker-b' });
  assert.equal(claimB.item.id, 'item-b');
  assert.equal(claimB.item.text, 'second edited');
  competing.settleQueue('chat-a', 'item-b', { claimKey: 'claim-b', idempotencyKey: 'settle-b', status: 'acknowledged', consumerId: 'worker-b' });

  const interrupted = first.enqueue('chat-a', 'third', { idempotencyKey: 'enqueue-c', itemId: 'item-c' });
  assert.equal(interrupted.item.sequence, 3);
  const claimC = first.claimNext('chat-a', { idempotencyKey: 'claim-c', consumerId: 'worker-a' });
  assert.equal(claimC.item.id, 'item-c');
  const afterRestart = ledger(storage, { ownerId: 'restart-owner' });
  assert.throws(() => afterRestart.recover(), error => error.code === 'recovery_authorization_required');
  assert.equal(afterRestart.recover({ authorized: true, ownerId: 'worker-a' }).recovered, true);
  assert.equal(afterRestart.listQueue('chat-a').paused, true);
  assert.equal(afterRestart.listQueue('chat-a').items.find(item => item.id === 'item-c').status, 'unknown');
  assert.equal(afterRestart.claimNext('chat-a', { idempotencyKey: 'claim-after-restart' }).reason, 'paused');
  assert.equal(afterRestart.requeue('chat-a', 'item-c', { idempotencyKey: 'requeue-c', authorized: true }).requeued, true);
  afterRestart.setQueuePaused('chat-a', false);
  assert.equal(afterRestart.claimNext('chat-a', { idempotencyKey: 'claim-c-retry' }).item.id, 'item-c');
  assert.equal(interrupted.item.status, 'queued');
});

test('run claims deduplicate request IDs, preserve per-run cancellation and gate concurrency', () => {
  const serial = ledger(createMemoryStorage(), { concurrency: 'single' });
  const runA = serial.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', runId: 'run-a' });
  assert.equal(runA.accepted, true);
  assert.equal(serial.claimRun('chat-b', { requestId: 'request-b', idempotencyKey: 'run-b', runId: 'run-b' }).reason, 'busy');
  const serialReplay = serial.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', runId: 'other' });
  assert.equal(serialReplay.duplicate, true);
  assert.equal(serialReplay.run.runId, runA.run.runId);

  const parallelStorage = createMemoryStorage();
  const parallel = ledger(parallelStorage, { concurrency: 'parallel' });
  const independentA = parallel.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', runId: 'run-a' });
  const independentB = parallel.claimRun('chat-b', { requestId: 'request-b', idempotencyKey: 'run-b', runId: 'run-b' });
  assert.equal(independentA.accepted, true);
  assert.equal(independentB.accepted, true);
  const outsider = ledger(parallelStorage, { ownerId: 'outsider', concurrency: 'parallel' });
  assert.throws(() => outsider.cancelRun('run-b'), error => error.code === 'claim_conflict');
  assert.throws(() => outsider.settleRun('run-b', 'SUCCESS'), error => error.code === 'claim_conflict');
  const cancelled = parallel.cancelRun('run-a', { idempotencyKey: 'cancel-a' });
  assert.equal(cancelled.run.status, 'CANCELLING');
  assert.equal(parallel.getRun('run-b').status, 'RUNNING');
  assert.equal(parallel.settleRun('run-a', 'CANCELLED').status, 'UNKNOWN');
  assert.equal(parallel.settleRun('run-b', 'SUCCESS', { text: 'ok' }).status, 'SUCCESS');
  assert.throws(() => parallel.settleRun('run-b', 'FAILURE'), error => error.code === 'claim_conflict');
});

test('run idempotency receipts replay as non-dispatchable and bind request data', () => {
  const safe = ledger(createMemoryStorage());
  const first = safe.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', fingerprint: 'payload-a' });
  const replay = safe.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', fingerprint: 'payload-a' });
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.runId, first.run.runId);
  assert.throws(() => safe.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', fingerprint: 'payload-b' }), error => error.code === 'idempotency_conflict');
});

test('malformed or failed storage recovery fails closed and preserves the prior snapshot', () => {
  const malformed = createMemoryStorage({ 'aven-reliability-v1:journal': '{bad' });
  const safe = ledger(malformed);
  assert.throws(() => safe.snapshot(), (error) => error instanceof ReliabilityError && error.code === 'storage_recovery_failed');

  class FailingStorage {
    constructor() { this.values = new Map(); this.failed = false; }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { if (key.endsWith(':state') && !this.failed) { this.failed = true; throw Error('quota'); } this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }
  const failing = ledger(new FailingStorage());
  assert.throws(() => failing.setDraft('chat-a', 'draft'), (error) => error instanceof ReliabilityError && error.code === 'storage_write_failed');
  assert.equal(failing.getDraft('chat-a'), '');
});

test('restart recovery marks active runs unknown without issuing a retry', () => {
  const storage = createMemoryStorage();
  const running = ledger(storage);
  running.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', runId: 'run-a' });
  const restarted = ledger(storage, { ownerId: 'restart-owner' });
  const result = restarted.recover({ authorized: true, ownerId: 'test-owner' });
  assert.equal(result.recovered, true);
  assert.equal(restarted.getRun('run-a').status, 'UNKNOWN');
  assert.deepEqual(restarted.activeRuns(), []);
});

test('explicit run recovery scopes one abandoned run without touching a sibling run', () => {
  const storage = createMemoryStorage();
  const worker = ledger(storage, { ownerId: 'browser-old', concurrency: 'per-chat' });
  worker.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', runId: 'run-a' });
  worker.claimRun('chat-b', { requestId: 'request-b', idempotencyKey: 'run-b', runId: 'run-b' });
  const result = worker.recover({ authorized: true, ownerId: 'browser-old', runId: 'run-a' });
  assert.deepEqual(result, { recovered: true, count: 1 });
  assert.equal(worker.getRun('run-a').status, 'UNKNOWN');
  assert.equal(worker.getRun('run-b').status, 'RUNNING');
});

test('file storage keeps claims durable across fresh service instances', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-file-'));
  const firstStorage = new FileStorage(directory);
  const first = ledger(firstStorage, { ownerId: 'service-a' });
  first.enqueue('chat-a', 'once', { idempotencyKey: 'enqueue-once', itemId: 'item-once' });
  const claim = first.claimNext('chat-a', { idempotencyKey: 'claim-once', consumerId: 'service-a' });
  const afterRestartStorage = new FileStorage(directory);
  const afterRestart = ledger(afterRestartStorage, { ownerId: 'service-b' });
  const replay = afterRestart.claimNext('chat-a', { idempotencyKey: 'claim-once', consumerId: 'service-b' });
  assert.equal(replay.reason, 'already_claimed');
  assert.equal(replay.ownerId, 'service-a');
  assert.equal(afterRestart.claimNext('chat-a', { idempotencyKey: 'different-claim', consumerId: 'service-b' }).reason, 'in_flight');
  firstStorage.close();
  afterRestartStorage.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('terminal queue retention does not consume pending capacity', () => {
  const storage = createMemoryStorage();
  const owner = ledger(storage, { ownerId: 'queue-worker' });
  for (let i = 0; i < 9; i += 1) {
    const itemId = `completed-${i}`;
    owner.enqueue('chat-a', itemId, { idempotencyKey: `enqueue-${itemId}`, itemId });
    const claim = owner.claimNext('chat-a', { idempotencyKey: `claim-${itemId}`, consumerId: 'queue-worker' });
    owner.settleQueue('chat-a', itemId, {
      claimKey: `claim-${itemId}`,
      idempotencyKey: `settle-${itemId}`,
      status: 'acknowledged',
      consumerId: 'queue-worker'
    });
    assert.equal(claim.item.id, itemId);
  }
  for (let i = 0; i < 8; i += 1) {
    owner.enqueue('chat-a', `pending-${i}`, { idempotencyKey: `pending-${i}`, itemId: `pending-${i}` });
  }
  assert.throws(
    () => owner.enqueue('chat-a', 'ninth-pending', { idempotencyKey: 'ninth-pending', itemId: 'ninth-pending' }),
    error => error.code === 'queue_full'
  );
  assert.equal(owner.listQueue('chat-a').items.filter(item => item.status === 'queued').length, 8);
});

test('a fresh tab cannot recover another owner active work without explicit scoped authorization', () => {
  const storage = createMemoryStorage();
  const firstTab = ledger(storage, { ownerId: 'tab-a' });
  firstTab.claimRun('chat-a', { requestId: 'request-a', idempotencyKey: 'run-a', runId: 'run-a' });
  const secondTab = ledger(storage, { ownerId: 'tab-b' });
  assert.throws(() => secondTab.recover(), error => error.code === 'recovery_authorization_required');
  assert.equal(secondTab.getRun('run-a').status, 'RUNNING');
  assert.deepEqual(secondTab.recover({ authorized: true, ownerId: 'tab-b' }), { recovered: false, count: 0 });
  assert.equal(secondTab.getRun('run-a').status, 'RUNNING');
});

test('waiting runs are durable pauses and cannot be overwritten by a later terminal outcome', () => {
  const storage = createMemoryStorage();
  const worker = ledger(storage, { ownerId: 'worker-a' });
  const claim = worker.claimRun('chat-a', {
    requestId: 'waiting-request',
    idempotencyKey: 'waiting-claim',
    runId: 'waiting-run'
  });
  const waiting = worker.settleRun('waiting-run', 'WAITING', { pendingQuestion: 'Which site?' }, {
    ownerId: 'worker-a',
    idempotencyKey: 'waiting-settle'
  });
  assert.equal(claim.run.status, 'RUNNING');
  assert.equal(waiting.status, 'WAITING');
  assert.equal(waiting.result.pendingQuestion, 'Which site?');
  assert.equal(worker.claimRun('chat-a', { requestId: 'competing-request', idempotencyKey: 'competing-claim' }).reason, 'busy');
  assert.deepEqual(worker.settleRun('waiting-run', 'WAITING', { ignored: true }, {
    ownerId: 'worker-a',
    idempotencyKey: 'waiting-settle-replay'
  }), waiting);
  const resumed = worker.settleRun('waiting-run', 'SUCCESS', { text: 'answered' }, {
    ownerId: 'worker-a',
    idempotencyKey: 'waiting-success'
  });
  assert.equal(resumed.status, 'SUCCESS');
  assert.throws(() => worker.settleRun('waiting-run', 'FAILURE', {}, {
    ownerId: 'worker-a',
    idempotencyKey: 'waiting-failure'
  }), error => error.code === 'claim_conflict');
});

test('file lock stale takeover cannot be removed by the expired owner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-lock-'));
  const first = new FileStorage(directory);
  const second = new FileStorage(directory);
  const key = 'chat:lock';
  const oldLock = JSON.stringify({ version: 1, ownerId: 'old-owner', expiresAt: 0 });
  const newLock = JSON.stringify({ version: 1, ownerId: 'new-owner', expiresAt: Date.now() + 5000 });
  first.setItem(key, oldLock);
  second.setItem(key, newLock);
  first.removeItem(key, oldLock);
  assert.equal(second.getItem(key), newLock);
  second.removeItem(key, newLock);
  first.close();
  second.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('sqlite lock compare-and-swap permits one stale-lock taker across processes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-reliability-process-lock-'));
  const seed = new FileStorage(directory);
  seed.setItem('chat:lock', JSON.stringify({ version: 1, ownerId: 'expired', expiresAt: 0 }));
  seed.close();
  const childScript = `
    const fs=require('node:fs');
    const {FileStorage}=require(${JSON.stringify(path.resolve(__dirname, '../candidate/intentgraph/reliability-storage.cjs'))});
    const [directory,owner,ready,go,result]=process.argv.slice(1);
    const storage=new FileStorage(directory);
    fs.writeFileSync(ready,owner);
    const attempt=()=>{if(!fs.existsSync(go)){setTimeout(attempt,1);return;}try{storage.setItem('chat:lock',JSON.stringify({version:1,ownerId:owner,expiresAt:Date.now()+5000}));fs.writeFileSync(result,JSON.stringify({owner,status:'ok',value:storage.getItem('chat:lock')}));}catch(error){fs.writeFileSync(result,JSON.stringify({owner,status:'error',code:error.code}));}finally{storage.close();}};
    attempt();
  `;
  const workers = ['process-a', 'process-b'].map(owner => {
    const ready = path.join(directory, owner + '.ready');
    const result = path.join(directory, owner + '.result');
    const child = spawn(process.execPath, ['-e', childScript, directory, owner, ready, path.join(directory, 'go'), result], { stdio: 'ignore' });
    return { owner, ready, result, child };
  });
  try {
    const deadline = Date.now() + 10000;
    while (!workers.every(worker => fs.existsSync(worker.ready))) {
      if (Date.now() > deadline) throw new Error('lock worker startup timed out');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    fs.writeFileSync(path.join(directory, 'go'), 'go');
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
      worker.child.once('error', reject);
      worker.child.once('exit', code => code === 0 ? resolve() : reject(new Error(`lock worker exited ${code}`)));
    })));
    const results = workers.map(worker => JSON.parse(fs.readFileSync(worker.result, 'utf8')));
    assert.equal(results.filter(result => result.status === 'ok').length, 1);
    assert.equal(results.filter(result => result.status === 'error' && result.code === 'ELOCKED').length, 1);
  } finally {
    for (const worker of workers) if (worker.child.exitCode === null) worker.child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
