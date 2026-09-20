'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const { ReceiptStore } = require('./reliability-storage.cjs');

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const validIdentity = value => typeof value === 'string' && ID.test(value);
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

function fingerprint(body) {
  return crypto.createHash('sha256').update(JSON.stringify({
    chatId: body.chatId, agentName: body.agentName, mode: body.mode || 'inspect',
    messages: body.messages.map(({ role, content }) => ({ role, content })),
    // A request identity is bound to the provider/model choice as well as the
    // conversation. This prevents replaying one id with a changed adapter.
    ...(body.selection === undefined ? {} : { selection: body.selection })
  })).digest('hex');
}

function publicReceipt(row) {
  if (!row) return null;
  return {
    requestId: row.request_id, chatId: row.chat_id, runId: row.run_id,
    state: row.state, outcome: row.outcome, evidenceSaved: Boolean(row.evidence_saved),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function ownerGone(row) {
  if (row.owner_host !== os.hostname()) return false;
  try { process.kill(row.owner_pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

function replyOutcome(reply, events, aborted) {
  if (aborted || !reply || reply.partial || typeof reply.text !== 'string' || !reply.text.trim()) return 'UNKNOWN';
  const statuses = [];
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.status === 'string') statuses.push(item.status.toUpperCase());
    if (['failed', 'tool_error'].includes(item.type)) statuses.push('FAILURE');
    for (const key of ['evidence', 'events']) {
      const values = item[key];
      if (Array.isArray(values)) values.forEach(visit); else if (values) visit(values);
    }
  };
  visit(reply); events.forEach(visit);
  if (statuses.some(s => ['UNKNOWN', 'TIMEOUT', 'CANCELLED'].includes(s))) return 'UNKNOWN';
  if (statuses.some(s => ['FAILURE', 'FAILED', 'ERROR', 'BLOCKLISTED'].includes(s))) return 'FAILURE';
  if (statuses.includes('NOT_EXECUTED')) return 'NOT_EXECUTED';
  if (statuses.some(s => s !== 'SUCCESS')) return 'UNKNOWN';
  return 'SUCCESS'; // Responder fulfilled, evidence saved and no adverse status.
}

function createAdmission(options) {
  const store = options.store || new ReceiptStore(options.directory);
  const ownerId = crypto.randomUUID();
  const ownerPid = process.pid;
  const ownerHost = os.hostname();
  const active = new Set();

  const workflow = require('./clarification-workflow.cjs').createWorkflow({ store, ownerId, active, ownerGone });

  function claim(body) {
    const hash = fingerprint(body);
    const result = store.transaction(() => {
      const matches = store.byIdentity.all(body.requestId, body.idempotencyKey);
      if (matches.length) {
        const row = matches[0];
        if (matches.length !== 1 || row.request_id !== body.requestId || row.idem_key !== body.idempotencyKey || row.chat_id !== body.chatId || row.fingerprint !== hash) {
          throw fail('request_conflict', 'This request identity is already bound to different content.');
        }
        return { accepted: false, duplicate: true, receipt: publicReceipt(row) };
      }
      if (store.active.get()) throw fail('chat_busy', 'Another reply is active or awaiting recovery. Your message was not dispatched.');
      const at = new Date().toISOString();
      const runId = crypto.randomUUID();
      store.insert.run(body.requestId, body.idempotencyKey, body.chatId, hash, runId, ownerId, ownerPid, ownerHost, at, at);
      return { accepted: true, duplicate: false, receipt: publicReceipt(store.byRequest.get(body.requestId)) };
    });
    if (result.accepted) active.add(result.receipt.runId);
    return result;
  }

  function settle(receipt, outcome, evidenceSaved) {
    return store.transaction(() => {
      const changed = store.finish.run('settled', outcome, evidenceSaved ? 1 : 0, new Date().toISOString(), receipt.requestId, receipt.runId, ownerId);
      if (changed.changes !== 1) throw fail('owner_conflict', 'Receipt ownership changed; completion is unknown.');
      workflow.finish(receipt.requestId, outcome);
      return publicReceipt(store.byRequest.get(receipt.requestId));
    });
  }

  function read(chatId, requestId) {
    const row = store.read(requestId);
    if (!row || row.chat_id !== chatId) return null;
    return { ...publicReceipt(row), question: workflow.read(chatId, requestId, row.run_id), recoverable: row.state === 'admitted' && ((row.owner_id === ownerId && !active.has(row.run_id)) || ownerGone(row)) };
  }

  function recover(chatId, requestId, runId) {
    return store.transaction(() => {
      const row = store.byRequest.get(requestId);
      if (!row || row.chat_id !== chatId || row.run_id !== runId) throw fail('receipt_missing', 'Receipt not found.', 404);
      if (row.state !== 'admitted') return { ...publicReceipt(row), question: workflow.read(chatId, requestId, runId) };
      // No clock-based takeover. A reused PID or inaccessible process is treated
      // conservatively as live. Recovery NEVER returns dispatch eligibility.
      if (!(row.owner_id === ownerId && !active.has(runId)) && !ownerGone(row)) throw fail('owner_active', 'The original service still owns this request. Check again after it finishes.');
      workflow.finish(requestId, 'UNKNOWN');
      store.finish.run('unknown', 'UNKNOWN', row.evidence_saved, new Date().toISOString(), requestId, runId, row.owner_id);
      return { ...publicReceipt(store.byRequest.get(requestId)), question: workflow.read(chatId, requestId, runId) };
    });
  }

  return { claim, settle, read, recover, workflow, release: runId => active.delete(runId), close: () => store.close() };
}

module.exports = { createAdmission, fingerprint, validIdentity, publicReceipt, replyOutcome };
