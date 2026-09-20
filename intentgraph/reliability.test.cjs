'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { ReceiptStore, assertRuntime } = require('./reliability-storage.cjs');
const { createAdmission, replyOutcome } = require('./reliability.cjs');

const body = { chatId: 'chat-a', requestId: 'request-a', idempotencyKey: 'key-a', agentName: 'A', mode: 'plan', messages: [{ role: 'user', content: 'hello' }] };
const resources = new Map();
function tracked(root, resource) { resources.get(root).push(resource); return resource; }
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-admission-'));
  resources.set(root, []);
  t.after(() => { for (const resource of resources.get(root)) resource.close(); resources.delete(root); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function service(t, root) {
  const admission = tracked(root, createAdmission({ directory: root }));
  t.after(() => admission.close());
  return admission;
}

test('durable identity binds exact payload and global serial slot across connections', t => {
  const root = directory(t), a = service(t, root), b = service(t, root);
  const first = a.claim(body);
  assert.equal(first.accepted, true);
  assert.deepEqual(b.claim(body), { accepted: false, duplicate: true, receipt: first.receipt });
  for (const changed of [{ mode: 'inspect' }, { chatId: 'chat-b' }, { agentName: 'B' }, { messages: [{ role: 'user', content: 'different' }] }, { requestId: 'other' }, { idempotencyKey: 'other' }]) {
    assert.throws(() => b.claim({ ...body, ...changed }), { code: 'request_conflict' });
  }
  assert.throws(() => b.claim({ ...body, requestId: 'new', idempotencyKey: 'new' }), { code: 'chat_busy' });
  assert.throws(() => b.settle(first.receipt, 'SUCCESS', true), { code: 'owner_conflict' });
  assert.throws(() => b.recover(body.chatId, body.requestId, first.receipt.runId), { code: 'owner_active' });
  assert.equal(b.read('another-chat', body.requestId), null);
  a.settle(first.receipt, 'FAILURE', true); a.release(first.receipt.runId); a.close();
  const reopened = service(t, root);
  assert.equal(reopened.claim(body).receipt.outcome, 'FAILURE');
  assert.equal(reopened.claim(body).accepted, false);
  assert.throws(() => a.settle(first.receipt, 'SUCCESS', true));
  assert.equal(reopened.claim({ ...body, requestId: 'new', idempotencyKey: 'new' }).accepted, true);
});

test('storage corruption, deletion, write denial and unsupported runtimes fail closed', t => {
  const root = directory(t), store = tracked(root, new ReceiptStore(root)), a = createAdmission({ store });
  t.after(() => a.close());
  store.db.exec('PRAGMA query_only=ON');
  assert.throws(() => a.claim(body));
  store.db.exec('PRAGMA query_only=OFF');
  assert.equal(a.read(body.chatId, body.requestId), null);
  fs.renameSync(store.file, store.file + '.removed');
  assert.throws(() => a.claim(body)); a.close();
  assert.throws(() => new ReceiptStore(root), /missing/);
  fs.writeFileSync(store.file, 'corrupt database');
  assert.throws(() => new ReceiptStore(root));
  assert.throws(() => assertRuntime('20.20.0'), /24.16/);
  assert.throws(() => assertRuntime('24.15.0'), /24.16/);
  assert.doesNotThrow(() => assertRuntime('24.16.0'));
});

test('ambiguous commit preserves identity and inactive own receipt needs explicit recovery', t => {
  const root = directory(t), store = tracked(root, new ReceiptStore(root)), a = createAdmission({ store });
  t.after(() => a.close());
  const transaction = store.transaction.bind(store);
  store.transaction = fn => { transaction(fn); throw Error('lost commit acknowledgement'); };
  assert.throws(() => a.claim(body), /lost commit/);
  store.transaction = transaction;
  const replay = a.claim(body);
  assert.equal(replay.accepted, false);
  assert.equal(a.read(body.chatId, body.requestId).recoverable, true);
  const recovered = a.recover(body.chatId, body.requestId, replay.receipt.runId);
  assert.equal(recovered.state, 'unknown'); assert.equal(recovered.outcome, 'UNKNOWN');
  assert.equal(a.claim(body).accepted, false);
  assert.throws(() => a.settle(replay.receipt, 'SUCCESS', true), { code: 'owner_conflict' });
  assert.equal(a.claim({ ...body, requestId: 'fresh', idempotencyKey: 'fresh' }).accepted, true);
});

test('adverse evidence and cancellation cannot be reported as success', () => {
  assert.equal(replyOutcome({ text: 'fine', evidence: [{ status: 'FAILURE' }] }, [], false), 'FAILURE');
  assert.equal(replyOutcome({ text: 'fine' }, [{ status: 'TIMEOUT' }], false), 'UNKNOWN');
  assert.equal(replyOutcome({ text: 'fine', status: 'UNRECOGNIZED' }, [], false), 'UNKNOWN');
  assert.equal(replyOutcome({ text: 'fine' }, [], true), 'UNKNOWN');
  assert.equal(replyOutcome(null, [], false), 'UNKNOWN');
  assert.equal(replyOutcome({}, [], false), 'UNKNOWN');
});

// The archived variant is a regression oracle only. Setting this variable runs
// the same before-commit schedule against the audited candidate and MUST fail.
const archived = process.env.AVEN_ADMISSION_TEST_CANDIDATE === '1';
const worker = `
const fs=require('node:fs'),path=require('node:path');
const [root,phase,variant,base]=process.argv.slice(1);
const body=${JSON.stringify(body)};
let store,admission;
if(variant==='archived'){
 const candidate=path.join(base,'../outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/reliability/candidate');
 store=new(require(path.join(candidate,'intentgraph/reliability-storage.cjs')).FileStorage)(root);
 const ledger=require(path.join(candidate,'polished-reliability.js')).createReliabilityLedger({storage:store,namespace:'probe',ownerId:phase,lockLeaseMs:50});
 const get=store.getItem.bind(store); let once=false;
 store.getItem=k=>{const value=get(k);if(phase==='before'&&k==='probe:state'&&!once){once=true;pause();}return value;};
 admission={claim:()=>ledger.claimRun(body.chatId,{requestId:body.requestId,idempotencyKey:body.idempotencyKey,fingerprint:'same-body'})};
}else{
 store=new(require(path.join(base,'reliability-storage.cjs')).ReceiptStore)(root);
 admission=require(path.join(base,'reliability.cjs')).createAdmission({store});
 if(phase==='before'){const read=store.byIdentity.all.bind(store.byIdentity);store.byIdentity.all=(...args)=>{const rows=read(...args);pause();return rows;};}
 if(phase==='after'){const tx=store.transaction.bind(store);store.transaction=fn=>{const result=tx(fn);pause();return result;};}
}
function pause(){fs.writeFileSync(path.join(root,'paused'),'1');const limit=Date.now()+10000;while(!fs.existsSync(path.join(root,'resume'))){if(Date.now()>limit)throw Error('test release timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}
try{console.log(JSON.stringify(admission.claim(body)));}catch(e){console.log(JSON.stringify({accepted:false,error:e.message}));}finally{store.close();}
`;

for (const phase of archived ? ['before'] : ['before', 'after']) {
  test(`suspended owner ${phase} commit cannot produce a second dispatchable claim`, { timeout: 15000 }, async t => {
    const root = directory(t);
    // Initialize before suspending the child so B needs no schema write.
    if (!archived) new ReceiptStore(root).close();
    const args = ['-e', worker, root, phase, archived ? 'archived' : 'active', __dirname];
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let out = '', err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    const completed = new Promise(resolve => child.once('exit', resolve));
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(path.join(root, 'paused'))) {
      assert.ok(Date.now() < deadline, 'worker reached its pause: ' + err);
      await new Promise(r => setTimeout(r, 10));
    }
    // More than the candidate's 50 ms lease; active storage has no lease expiry.
    await new Promise(r => setTimeout(r, 100));
    const other = spawnSync(process.execPath, ['-e', worker, root, 'second', archived ? 'archived' : 'active', __dirname], { encoding: 'utf8', timeout: 5000 });
    fs.writeFileSync(path.join(root, 'resume'), '1');
    assert.equal(await completed, 0, err);
    assert.equal(other.status, 0, other.stderr);
    const a = JSON.parse(out), b = JSON.parse(other.stdout);
    assert.equal(a.accepted, true);
    assert.equal(b.accepted, false, 'Only the original owner can dispatch; an expired lease must not create a second claim');
    const reopened = service(t, root);
    assert.equal(reopened.claim(body).accepted, false);
    const receipt = reopened.read(body.chatId, body.requestId);
    assert.equal(receipt.recoverable, true, 'child owner exited');
    assert.equal(reopened.recover(body.chatId, body.requestId, receipt.runId).outcome, 'UNKNOWN');
    assert.equal(reopened.claim(body).accepted, false, 'recovery does not retry work');
  });
}
