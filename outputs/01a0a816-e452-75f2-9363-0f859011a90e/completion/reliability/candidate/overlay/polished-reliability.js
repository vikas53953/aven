/*
 * Bounded reliability primitives for the Aven preview.
 *
 * This module is deliberately transport agnostic. It owns durable intent,
 * claims, and recovery; callers still decide when a provider or device is
 * contacted. A claimed item is never implicitly re-dispatched after a crash.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AvenReliability = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_QUEUE_ITEMS = 8;
  const MAX_TEXT = 4000;
  const MAX_DRAFT = 32000;
  const ACTIVE_RUN_STATES = new Set(['RUNNING', 'CANCELLING', 'WAITING']);
  const QUEUE_STATES = new Set(['queued', 'claimed', 'acknowledged', 'failed', 'unknown']);
  const RUN_STATES = new Set(['RUNNING', 'CANCELLING', 'SUCCESS', 'FAILURE', 'UNKNOWN', 'WAITING']);

  class ReliabilityError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'ReliabilityError';
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const text = (value, label, max) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
      throw new ReliabilityError('invalid_input', `${label} is invalid.`);
    }
    return value;
  };
  const optionalText = (value, label, max) => {
    if (value === undefined || value === null || value === '') return '';
    return text(String(value), label, max);
  };
  const nowIso = () => new Date().toISOString();
  const defaultId = (prefix) => {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
  const byteLength = (value) => new TextEncoder().encode(value).length;
  const emptyState = () => ({ version: VERSION, revision: 0, drafts: {}, queues: {}, runs: {}, receipts: {} });

  function assertState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== VERSION || !Number.isInteger(state.revision) || state.revision < 0) {
      throw new ReliabilityError('storage_invalid', 'Reliability storage contains an unsupported state.');
    }
    for (const key of ['drafts', 'queues', 'runs', 'receipts']) {
      if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) throw new ReliabilityError('storage_invalid', `Reliability storage has an invalid ${key} map.`);
    }
    for (const [chatId, draft] of Object.entries(state.drafts)) {
      text(chatId, 'chat id', 160);
      if (typeof draft !== 'string' || draft.length > MAX_DRAFT) throw new ReliabilityError('storage_invalid', 'Reliability storage contains an invalid draft.');
    }
    for (const [chatId, queue] of Object.entries(state.queues)) {
      text(chatId, 'chat id', 160);
      if (!queue || !Number.isInteger(queue.nextSequence) || queue.nextSequence < 1 || !Array.isArray(queue.items) || queue.items.length > MAX_QUEUE_ITEMS || typeof queue.paused !== 'boolean') throw new ReliabilityError('storage_invalid', 'Reliability storage contains an invalid queue.');
      let previous = 0;
      for (const item of queue.items) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !Number.isInteger(item.sequence) || item.sequence <= previous || item.sequence >= queue.nextSequence || typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_TEXT || !QUEUE_STATES.has(item.status)) throw new ReliabilityError('storage_invalid', 'Reliability storage contains an invalid queue item.');
        previous = item.sequence;
        if (item.status === 'claimed' && (!item.claim || typeof item.claim.key !== 'string' || !item.claim.ownerId)) throw new ReliabilityError('storage_invalid', 'Claimed queue item has no durable claim.');
      }
    }
    for (const [runId, run] of Object.entries(state.runs)) {
      text(runId, 'run id', 160);
      if (!run || typeof run !== 'object' || typeof run.chatId !== 'string' || !RUN_STATES.has(run.status) || typeof run.requestId !== 'string' || !run.ownerId || typeof run.cancelRequested !== 'boolean' || (run.requestFingerprint !== undefined && (typeof run.requestFingerprint !== 'string' || run.requestFingerprint.length > 100000))) throw new ReliabilityError('storage_invalid', 'Reliability storage contains an invalid run.');
    }
    for (const [key, receipt] of Object.entries(state.receipts)) {
      text(key, 'idempotency key', 200);
      if (!receipt || typeof receipt !== 'object' || typeof receipt.kind !== 'string' || !('result' in receipt) || typeof receipt.createdAt !== 'string' || (receipt.fingerprint !== undefined && (typeof receipt.fingerprint !== 'string' || receipt.fingerprint.length > 100000))) throw new ReliabilityError('storage_invalid', 'Reliability storage contains an invalid receipt.');
    }
    return state;
  }

  function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(String(key)); },
      dump() { return Object.fromEntries(values); }
    };
  }

  function createReliabilityLedger(options = {}) {
    const storage = options.storage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new ReliabilityError('invalid_storage', 'A storage adapter with getItem, setItem and removeItem is required.');
    const namespace = text(String(options.namespace || 'aven-reliability-v1'), 'storage namespace', 160);
    const stateKey = `${namespace}:state`;
    const journalKey = `${namespace}:journal`;
    const lockKey = `${namespace}:lock`;
    const ownerId = text(String(options.ownerId || defaultId('owner')), 'owner id', 200);
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : (prefix) => defaultId(prefix);
    const clock = typeof options.now === 'function' ? options.now : () => Date.now();
    const concurrency = ['single', 'per-chat', 'parallel'].includes(options.concurrency) ? options.concurrency : 'single';
    const lockLeaseMs = Number.isFinite(options.lockLeaseMs) ? Math.max(50, options.lockLeaseMs) : 5000;

    function fail(code, message, cause) { throw new ReliabilityError(code, message, cause); }
    function rawState() {
      let raw;
      try { raw = storage.getItem(stateKey); } catch (error) { fail('storage_unavailable', 'Reliability storage could not be read.', error); }
      if (raw === null || raw === '') return emptyState();
      if (typeof raw !== 'string' || byteLength(raw) > MAX_BYTES) fail('storage_invalid', 'Reliability storage exceeds its safety limit.');
      try { return assertState(JSON.parse(raw)); } catch (error) { if (error instanceof ReliabilityError) throw error; fail('storage_invalid', 'Reliability storage is not valid JSON.', error); }
    }
    function recoverJournal() {
      let raw;
      try { raw = storage.getItem(journalKey); } catch (error) { fail('storage_recovery_failed', 'Reliability recovery could not inspect its journal.', error); }
      if (raw === null || raw === '') return false;
      let journal;
      try { journal = JSON.parse(raw); } catch (error) { fail('storage_recovery_failed', 'Reliability recovery journal is not valid JSON.', error); }
      if (!journal || journal.version !== VERSION || typeof journal.operationId !== 'string' || (journal.beforeRaw !== null && typeof journal.beforeRaw !== 'string')) fail('storage_recovery_failed', 'Reliability recovery journal is malformed.');
      if (journal.beforeRaw !== null) {
        try { assertState(JSON.parse(journal.beforeRaw)); } catch (error) { fail('storage_recovery_failed', 'Reliability recovery snapshot is invalid.', error); }
      }
      try {
        if (journal.beforeRaw === null) storage.removeItem(stateKey);
        else storage.setItem(stateKey, journal.beforeRaw);
        storage.removeItem(journalKey);
      } catch (error) { fail('storage_recovery_failed', 'Reliability storage could not be restored from its journal.', error); }
      return true;
    }
    function acquireLock() {
      let existing;
      try { existing = storage.getItem(lockKey); } catch (error) { fail('storage_unavailable', 'Reliability lock could not be read.', error); }
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          if (parsed.ownerId !== ownerId && Number(parsed.expiresAt) > clock()) fail('claim_conflict', 'Another client owns the reliability lock.');
        } catch (error) { fail('storage_recovery_failed', 'Reliability lock is malformed.', error); }
      }
      const lock = JSON.stringify({ version: VERSION, ownerId, expiresAt: clock() + lockLeaseMs });
      try {
        storage.setItem(lockKey, lock);
        const observed = storage.getItem(lockKey);
        if (observed !== lock) fail('claim_conflict', 'Another client won the reliability lock.');
      } catch (error) { if (error instanceof ReliabilityError) throw error; if (error.code === 'ELOCKED') fail('claim_conflict', 'Another client owns the reliability lock.'); fail('storage_unavailable', 'Reliability lock could not be acquired.', error); }
      return lock;
    }
    function releaseLock(lock) { try { if (storage.getItem(lockKey) === lock) storage.removeItem(lockKey, lock); } catch { /* preserve the durable state; next open will fail closed if needed */ } }
    function writeState(next) {
      assertState(next);
      const afterRaw = JSON.stringify(next);
      if (byteLength(afterRaw) > MAX_BYTES) fail('storage_full', 'Reliability state exceeds its safety limit.');
      let beforeRaw;
      try { beforeRaw = storage.getItem(stateKey); } catch (error) { fail('storage_unavailable', 'Reliability state could not be read before saving.', error); }
      const journal = JSON.stringify({ version: VERSION, operationId: idFactory('operation'), beforeRaw: beforeRaw || null, afterHash: byteLength(afterRaw) });
      try {
        storage.setItem(journalKey, journal);
        storage.setItem(stateKey, afterRaw);
        storage.removeItem(journalKey);
      } catch (error) {
        try { recoverJournal(); } catch (recoveryError) { fail('storage_recovery_failed', 'Reliability state could not be saved or restored.', recoveryError); }
        fail('storage_write_failed', 'Reliability state could not be saved; the previous state was restored.', error);
      }
    }
    function mutate(change) {
      const lock = acquireLock();
      try {
        recoverJournal();
        const state = rawState();
        const outcome = change(state) || {};
        state.revision += 1;
        writeState(state);
        return clone(Object.prototype.hasOwnProperty.call(outcome, 'result') ? outcome.result : outcome);
      } finally { releaseLock(lock); }
    }
    function read() {
      const lock = acquireLock();
      try { recoverJournal(); return clone(rawState()); }
      finally { releaseLock(lock); }
    }
    function receipt(state, key, kind, fingerprintValue) {
      const saved = state.receipts[key];
      if (!saved) return null;
      if (saved.kind !== kind) fail('idempotency_conflict', 'The idempotency key was already used for another operation.');
      if (fingerprintValue !== undefined && saved.fingerprint !== undefined && saved.fingerprint !== fingerprintValue) fail('idempotency_conflict', 'The idempotency key was reused with different request data.');
      return clone(saved.result);
    }
    function saveReceipt(state, key, kind, result, fingerprintValue) { state.receipts[key] = { kind, createdAt: nowIso(), ...(fingerprintValue === undefined ? {} : { fingerprint: fingerprintValue }), result: clone(result) }; }

    const api = {
      VERSION,
      MAX_BYTES,
      MAX_QUEUE_ITEMS,
      MAX_TEXT,
      ownerId,
      concurrency,
      snapshot: read,
      recover(options = {}) { if (options.authorized !== true) fail('recovery_authorization_required', 'Recovery requires explicit authorization.'); const targetOwner = options.ownerId ? text(String(options.ownerId), 'owner id', 200) : null; const changed = mutate((state) => { let count = 0; for (const run of Object.values(state.runs)) if (ACTIVE_RUN_STATES.has(run.status) && (!targetOwner || run.ownerId === targetOwner)) { run.status = 'UNKNOWN'; run.recoveredAt = nowIso(); run.cancelRequested = true; count += 1; } for (const queue of Object.values(state.queues)) { let queueChanged = false; for (const item of queue.items) if (item.status === 'claimed' && (!targetOwner || item.claim?.ownerId === targetOwner)) { item.status = 'unknown'; item.unknownAt = nowIso(); queueChanged = true; count += 1; } if (queueChanged) { queue.paused = true; queue.pauseReason = 'A claimed item was interrupted. Review it before explicit requeue.'; } } return { result: { recovered: count > 0, count } }; }); return changed; },
      getDraft(chatId) { text(chatId, 'chat id', 160); return read().drafts[chatId] || ''; },
      setDraft(chatId, value, idempotencyKey) {
        text(chatId, 'chat id', 160); if (typeof value !== 'string' || value.length > MAX_DRAFT) fail('invalid_input', 'Draft is invalid.'); const key = idempotencyKey ? text(idempotencyKey, 'idempotency key', 200) : null;
        return mutate((state) => { const prior = key ? receipt(state, key, 'draft.set') : null; if (prior) return { result: prior }; state.drafts[chatId] = value; const result = { chatId, value }; if (key) saveReceipt(state, key, 'draft.set', result); return { result }; });
      },
      enqueue(chatId, value, options = {}) {
        text(chatId, 'chat id', 160); if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT) fail('invalid_input', 'Queued message is invalid.'); const key = text(String(options.idempotencyKey || idFactory('queue')), 'idempotency key', 200);
        return mutate((state) => { const prior = receipt(state, key, 'queue.enqueue'); if (prior) return prior; const queue = state.queues[chatId] || (state.queues[chatId] = { nextSequence: 1, paused: false, pauseReason: '', items: [] }); queue.items = queue.items.filter(item => !['acknowledged', 'failed'].includes(item.status)); if (queue.items.length >= MAX_QUEUE_ITEMS) fail('queue_full', 'Queue is full.'); const item = { id: text(String(options.itemId || idFactory('queue-item')), 'queue item id', 200), chatId, sequence: queue.nextSequence++, text: value.trim(), createdAt: options.createdAt || nowIso(), mode: options.mode === 'plan' ? 'plan' : 'inspect', replyTo: options.replyTo || null, status: 'queued' }; queue.items.push(item); const result = { accepted: true, item: clone(item) }; saveReceipt(state, key, 'queue.enqueue', result); return { result }; });
      },
      cancelQueued(chatId, itemId, options = {}) {
        text(chatId, 'chat id', 160); text(itemId, 'queue item id', 200); const key = text(String(options.idempotencyKey || ''), 'idempotency key', 200);
        return mutate((state) => { const prior = receipt(state, key, 'queue.cancel'); if (prior) return prior; const queue = state.queues[chatId]; const index = queue?.items.findIndex(item => item.id === itemId) ?? -1; if (index < 0) fail('not_found', 'Queue item is unavailable.'); const item = queue.items[index]; if (item.status !== 'queued') fail('claim_conflict', 'Only an unclaimed queue item can be cancelled.'); queue.items.splice(index, 1); const result = { cancelled: true, itemId, chatId }; saveReceipt(state, key, 'queue.cancel', result); return { result }; });
      },
      editQueued(chatId, itemId, value, options = {}) {
        text(chatId, 'chat id', 160); text(itemId, 'queue item id', 200); if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT) fail('invalid_input', 'Queued message is invalid.'); const key = text(String(options.idempotencyKey || ''), 'idempotency key', 200);
        return mutate((state) => { const prior = receipt(state, key, 'queue.edit'); if (prior) return prior; const item = state.queues[chatId]?.items.find(candidate => candidate.id === itemId); if (!item || item.status !== 'queued') fail('claim_conflict', 'Only an unclaimed queue item can be edited.'); item.text = value.trim(); item.editedAt = nowIso(); const result = { edited: true, item: clone(item) }; saveReceipt(state, key, 'queue.edit', result); return { result }; });
      },
      listQueue(chatId) { text(chatId, 'chat id', 160); const queue = read().queues[chatId]; return queue ? { paused: queue.paused, pauseReason: queue.pauseReason || '', items: clone(queue.items).filter(item => item.status !== 'acknowledged').sort((a, b) => a.sequence - b.sequence) } : { paused: false, pauseReason: '', items: [] }; },
      setQueuePaused(chatId, paused, reason = '') { text(chatId, 'chat id', 160); return mutate((state) => { const queue = state.queues[chatId] || (state.queues[chatId] = { nextSequence: 1, paused: false, pauseReason: '', items: [] }); queue.paused = Boolean(paused); queue.pauseReason = queue.paused ? (String(reason || 'Queue paused. Resume explicitly to continue.').slice(0, 200)) : ''; return { result: { chatId, paused: queue.paused, pauseReason: queue.pauseReason } }; }); },
      claimNext(chatId, options = {}) {
        text(chatId, 'chat id', 160); const key = text(String(options.idempotencyKey || ''), 'idempotency key', 200); const consumer = text(String(options.consumerId || ownerId), 'consumer id', 200);
        return mutate((state) => { const prior = receipt(state, key, 'queue.claim'); if (prior) return { claimed: false, replayed: true, reason: 'already_claimed', itemId: prior.item?.id, ownerId: prior.item?.claim?.ownerId }; const queue = state.queues[chatId]; if (!queue || queue.paused) return { claimed: false, reason: 'paused' }; const claimed = queue.items.find(item => item.status === 'claimed'); if (claimed) return { claimed: false, reason: 'in_flight', itemId: claimed.id, ownerId: claimed.claim?.ownerId }; const item = queue.items.find(item => item.status === 'queued'); if (!item) return { claimed: false, reason: 'empty' }; item.status = 'claimed'; item.claim = { key, ownerId: consumer, claimedAt: nowIso() }; const result = { claimed: true, item: clone(item), receipt: key }; saveReceipt(state, key, 'queue.claim', result); return { result }; });
      },
      settleQueue(chatId, itemId, options = {}) {
        text(chatId, 'chat id', 160); text(itemId, 'queue item id', 200); const key = text(String(options.idempotencyKey || ''), 'idempotency key', 200); const status = options.status === 'acknowledged' ? 'acknowledged' : options.status === 'failed' ? 'failed' : 'unknown';
        const claimKey = text(String(options.claimKey || ''), 'claim key', 200); const consumer = text(String(options.consumerId || ownerId), 'consumer id', 200);
        return mutate((state) => { const prior = receipt(state, key, 'queue.settle'); if (prior) return prior; const item = state.queues[chatId]?.items.find(candidate => candidate.id === itemId); if (!item || !item.claim || item.claim.ownerId !== consumer) fail('claim_conflict', 'Queue item is not owned by this consumer.'); if (item.status === 'claimed') { if (item.claim.key !== claimKey) fail('claim_conflict', 'Queue item is not claimed by this receipt.'); } else if (item.status !== status) fail('claim_conflict', 'A settled queue item cannot change outcome.'); const result = { settled: true, item: clone(item) }; if (item.status === 'claimed') { item.status = status; item.settledAt = nowIso(); if (status !== 'acknowledged') item.failure = String(options.reason || 'Remote completion is unknown.'); result.item = clone(item); } saveReceipt(state, key, 'queue.settle', result); return { result }; });
      },
      requeue(chatId, itemId, options = {}) {
        text(chatId, 'chat id', 160); text(itemId, 'queue item id', 200); const key = text(String(options.idempotencyKey || ''), 'idempotency key', 200); if (options.authorized !== true) fail('recovery_authorization_required', 'Requeue requires explicit authorization.');
        return mutate((state) => { const prior = receipt(state, key, 'queue.requeue'); if (prior) return prior; const item = state.queues[chatId]?.items.find(candidate => candidate.id === itemId); if (!item || !['unknown', 'failed'].includes(item.status)) fail('claim_conflict', 'Only an unknown or failed item can be explicitly requeued.'); item.status = 'queued'; delete item.claim; item.requeuedAt = nowIso(); const result = { requeued: true, item: clone(item) }; saveReceipt(state, key, 'queue.requeue', result); return { result }; });
      },
      claimRun(chatId, options = {}) {
        text(chatId, 'chat id', 160); const requestId = text(String(options.requestId || ''), 'request id', 200); const key = text(String(options.idempotencyKey || requestId), 'idempotency key', 200); const owner = text(String(options.ownerId || ownerId), 'owner id', 200); const fingerprintValue = options.fingerprint === undefined ? JSON.stringify({ chatId, requestId, mode: options.mode === 'plan' ? 'plan' : 'inspect' }) : text(String(options.fingerprint), 'request fingerprint', 100000);
        return mutate((state) => { const prior = receipt(state, key, 'run.claim', fingerprintValue); if (prior) { prior.duplicate = true; prior.replayed = true; return { result: prior }; } const existingRequest = Object.values(state.runs).find(run => run.requestId === requestId); if (existingRequest) { if (fingerprintValue !== undefined && existingRequest.requestFingerprint !== undefined && existingRequest.requestFingerprint !== fingerprintValue) fail('idempotency_conflict', 'The request id was reused with different request data.'); const result = { accepted: true, duplicate: true, run: clone(existingRequest), receipt: key }; saveReceipt(state, key, 'run.claim', result, fingerprintValue); return { result }; } const active = Object.values(state.runs).filter(run => ACTIVE_RUN_STATES.has(run.status)); if ((concurrency === 'single' && active.length) || (concurrency === 'per-chat' && active.some(run => run.chatId === chatId))) return { accepted: false, reason: 'busy', activeRuns: active.map(run => ({ runId: run.runId, chatId: run.chatId, status: run.status })) }; const runId = text(String(options.runId || idFactory('run')), 'run id', 200); const run = { runId, chatId, requestId, ...(fingerprintValue === undefined ? {} : { requestFingerprint: fingerprintValue }), ownerId: owner, status: 'RUNNING', cancelRequested: false, startedAt: nowIso(), mode: options.mode === 'plan' ? 'plan' : 'inspect' }; state.runs[runId] = run; const result = { accepted: true, duplicate: false, run: clone(run), receipt: key }; saveReceipt(state, key, 'run.claim', result, fingerprintValue); return { result }; });
      },
      cancelRun(runId, options = {}) { text(runId, 'run id', 200); const key = text(String(options.idempotencyKey || ('run.cancel:' + runId)), 'idempotency key', 200); return mutate((state) => { const run = state.runs[runId]; if (!run) fail('not_found', 'Run is unavailable.'); const actor = text(String(options.ownerId || ownerId), 'owner id', 200); if (run.ownerId !== actor) fail('claim_conflict', 'Run is owned by another client.'); const prior = receipt(state, key, 'run.cancel'); if (prior) return prior; if (ACTIVE_RUN_STATES.has(run.status)) { run.cancelRequested = true; run.status = 'CANCELLING'; run.cancelRequestedAt = nowIso(); } const result = { accepted: true, run: clone(run) }; saveReceipt(state, key, 'run.cancel', result); return { result }; }); },
      settleRun(runId, status, resultValue = {}, options = {}) { text(runId, 'run id', 200); const normalized = status === 'CANCELLED' ? 'UNKNOWN' : status; if (!['SUCCESS', 'FAILURE', 'UNKNOWN', 'WAITING'].includes(normalized)) fail('invalid_input', 'Run settlement status is invalid.'); const actor = text(String(options.ownerId || ownerId), 'owner id', 200); const key = text(String(options.idempotencyKey || ('run.settle:' + runId + ':' + normalized)), 'idempotency key', 200); return mutate((state) => { const run = state.runs[runId]; if (!run) fail('not_found', 'Run is unavailable.'); if (run.ownerId !== actor) fail('claim_conflict', 'Run is owned by another client.'); const prior = receipt(state, key, 'run.settle'); if (prior) return prior; if (!['RUNNING', 'CANCELLING', 'WAITING'].includes(run.status)) { if (run.status !== normalized) fail('claim_conflict', 'A settled run cannot change outcome.'); const result = clone(run); saveReceipt(state, key, 'run.settle', result); return { result }; } if (run.status === 'WAITING' && normalized === 'WAITING') { const result = clone(run); saveReceipt(state, key, 'run.settle', result); return { result }; } run.status = normalized; if (normalized === 'WAITING') run.waitingAt = nowIso(); else run.settledAt = nowIso(); run.result = clone(resultValue); const result = clone(run); saveReceipt(state, key, 'run.settle', result); return { result }; }); },
      getRun(runId) { text(runId, 'run id', 200); return clone(read().runs[runId] || null); },
      activeRuns() { return Object.values(read().runs).filter(run => ACTIVE_RUN_STATES.has(run.status)); }
    };
    return api;
  }

  return { VERSION, MAX_BYTES, MAX_QUEUE_ITEMS, MAX_TEXT, MAX_DRAFT, ReliabilityError, createMemoryStorage, createReliabilityLedger, assertState };
}));
