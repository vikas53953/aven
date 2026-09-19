'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const admission = require('../polished-admission.js');
const { journal } = require('../polished-run-state.js');
function fixture() {
  const message = { id: 'message-a', role: 'user', text: 'same text' };
  const chat = { id: 'chat-a', messages: [message], draft: 'keep this draft', pendingQueue: [{ id: 'queue-a', text: 'next' }] };
  const options = { agentId: 'agent-a', agentName: 'A', mode: 'plan', messages: [{ role: 'user', content: message.text }] };
  message.submission = admission.prepare(chat, message, options);
  chat.pendingAdmission = message.submission.body.requestId;
  return { chat, message, options, submission: message.submission };
}

test('retry keeps exact persisted context and mode; intentional new turn or fork receives fresh identity', () => {
  const { chat, message, options, submission } = fixture();
  const reloaded = JSON.parse(JSON.stringify(chat)), pending = admission.pending(reloaded);
  assert.deepEqual(admission.prepare(reloaded, pending.message, { ...options, mode: 'inspect', agentName: 'renamed', messages: [{ role: 'user', content: 'changed history' }] }), submission);
  const next = admission.prepare(chat, { id: 'another', role: 'user', text: message.text }, options);
  assert.notEqual(next.body.requestId, submission.body.requestId);
  assert.notEqual(next.body.idempotencyKey, submission.body.idempotencyKey);
  const fork = admission.prepare({ ...chat, id: 'fork' }, message, options);
  assert.notEqual(fork.body.requestId, submission.body.requestId);
  assert.equal(fork.body.chatId, 'fork');
  message.submission.body.messages[0].content = '';
  assert.equal(admission.pending(chat), null);
  assert.throws(() => admission.prepare(chat, message, options), /invalid/);
});

test('receipt reconciliation preserves one result, raw evidence, message identity, draft and paused queue', () => {
  const { chat, submission } = fixture();
  chat.runJournal = { id: 'journal' };
  chat.messages.push({ id: 'captured', role: 'assistant', requestId: submission.body.requestId, status: 'UNKNOWN', text: 'interrupted', events: [{ output: 'earlier raw' }] });
  const receipt = { chatId: chat.id, requestId: submission.body.requestId, runId: 'run-a', state: 'settled', outcome: 'FAILURE', updatedAt: '2026-09-19T00:00:00Z' };
  const record = { chatId: chat.id, requestId: receipt.requestId, runId: receipt.runId, reply: { text: 'exact result', evidence: [{ status: 'FAILURE', output: 'a\r\nb\n' }] }, events: [] };
  const result = admission.applyReceipt(chat, submission, receipt, record);
  assert.equal(result.id, 'captured'); assert.equal(result.status, 'FAILURE'); assert.equal(result.evidence[0].output, 'a\r\nb\n');
  admission.applyReceipt(chat, submission, receipt, record);
  assert.equal(chat.messages.length, 2); assert.equal(chat.draft, 'keep this draft'); assert.equal(chat.pendingQueue.length, 1); assert.equal(chat.queuePaused, true);
  assert.equal(chat.runJournal, undefined); assert.equal(chat.pendingAdmission, undefined);
});

test('active or unrelated receipt cannot clear local ownership; recovery remains UNKNOWN without evidence', () => {
  const { chat, submission } = fixture();
  const receipt = { chatId: chat.id, requestId: submission.body.requestId, runId: 'run-a', state: 'admitted', outcome: 'UNKNOWN' };
  const original = structuredClone(chat);
  assert.throws(() => admission.applyReceipt(chat, submission, receipt));
  assert.throws(() => admission.applyReceipt(chat, submission, { ...receipt, state: 'settled', chatId: 'other' }));
  assert.deepEqual(chat, original);
  const result = admission.applyReceipt(chat, submission, { ...receipt, state: 'unknown' });
  assert.equal(result.status, 'UNKNOWN'); assert.match(result.text, /No request was retried/);
});

test('browser journal retains request identity without steering controls or outgoing context', () => {
  const saved = journal({ journalId: 'journal', requestId: 'request', agentId: 'a', startedAt: '2026-09-19T00:00:00Z', events: [], steeringToken: 'private', submission: { body: { messages: ['private context'] } } });
  assert.equal(saved.requestId, 'request');
  assert.doesNotMatch(JSON.stringify(saved), /private|submission|messages/);
});

test('backup round trip preserves pending identity; Add restore cannot inherit original run ownership', () => {
  const backup = require('../polished-backup.js');
  const { chat, submission } = fixture();
  Object.assign(chat, { title: 'Test', recipients: ['agent-a'] });
  const prefs = { activeAgent: 'agent-a', agents: [{ id: 'agent-a', name: 'A' }], sections: [] };
  const data = { activeChat: chat.id, chats: [chat], projects: [], channels: [] };
  const original = backup.envelope(prefs, data, {}, 'admission-test');
  const restored = backup.parse(backup.serialize(original));
  assert.equal(admission.pending(restored.data.chats[0]).submission.body.requestId, submission.body.requestId);
  const merged = backup.mergeImported(original, restored);
  assert.equal(merged.data.chats[0].pendingAdmission, submission.body.requestId);
  const copy = merged.data.chats[1];
  assert.notEqual(copy.id, chat.id); assert.equal(copy.pendingAdmission, undefined);
  assert.equal(copy.queuePaused, true); assert.equal(copy.pendingQueue.length, 1);
  assert.equal(admission.pending(copy), null);
});
