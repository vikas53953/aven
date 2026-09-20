'use strict';

// Narrow adaptation of the reviewed workflow candidate: one question, one
// continuation, no approval/execution surface. All transitions share receipts' DB.
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

function validateQuestion(value) {
  if (!keys(value, ['prompt', 'reason', 'choices', 'allowFreeText']) || !text(value.prompt, 500) || value.reason !== undefined && !text(value.reason, 500) || typeof value.allowFreeText !== 'boolean' || !Array.isArray(value.choices) || value.choices.length > 4 || value.choices.length < 2 && !(value.choices.length === 0 && value.allowFreeText)) throw fail('Invalid structured clarification.', 400);
  const ids = new Set();
  for (const choice of value.choices) {
    if (!keys(choice, ['id', 'label']) || typeof choice.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(choice.id) || !text(choice.label, 200) || ids.has(choice.id)) throw fail('Invalid clarification choices.', 400);
    ids.add(choice.id);
  }
  return { prompt: value.prompt, ...(value.reason ? { reason: value.reason } : {}), choices: value.choices.map(({ id, label }) => ({ id, label })), allowFreeText: value.allowFreeText };
}
function extractQuestion(reply) {
  if (reply?.question !== undefined) return validateQuestion(reply.question);
  const raw = reply?.text;
  if (typeof raw !== 'string' || !raw.trimStart().startsWith('{')) return null;
  let envelope;
  try { envelope = JSON.parse(raw); } catch { if (/clarification/.test(raw)) throw fail('Malformed structured clarification.', 400); return null; }
  if (envelope?.type !== 'clarification') return null;
  if (!keys(envelope, ['type', 'question'])) throw fail('Invalid clarification envelope.', 400);
  return validateQuestion(envelope.question);
}
function answerFor(spec, answer) {
  if (keys(answer, ['choiceId']) && Object.keys(answer).length === 1) {
    const choice = spec.choices.find(choice => choice.id === answer.choiceId);
    if (choice) return { choiceId: choice.id, text: choice.label };
  }
  if (keys(answer, ['text']) && Object.keys(answer).length === 1 && spec.allowFreeText && text(answer.text, 2000)) return { text: answer.text };
  throw fail('Choose one offered option or enter a permitted answer of 1–2,000 characters.', 400);
}
function publicQuestion(row) {
  if (!row) return null;
  return { id: row.question_id, revision: row.revision, chatId: row.chat_id, requestId: row.request_id, runId: row.run_id,
    ...JSON.parse(row.spec), phase: row.phase, mode: row.mode, model: row.model,
    answer: row.answer_json ? JSON.parse(row.answer_json) : null,
    segmentId: row.segment_id, segmentState: row.segment_state, createdAt: row.created_at, updatedAt: row.updated_at };
}
function createWorkflow({ store, ownerId, active, ownerGone }) {
  const get = store.db.prepare('SELECT * FROM clarifications WHERE request_id=?');
  function scoped(scope) {
    const receipt = store.byRequest.get(scope.requestId), row = get.get(scope.requestId);
    if (!receipt || !row || receipt.chat_id !== scope.chatId || receipt.run_id !== scope.runId || row.question_id !== scope.questionId || row.revision !== scope.revision) throw fail('This question is no longer active for this request.', 409);
    return { receipt, row };
  }
  function read(chatId, requestId, runId) {
    store.ensureOpen(); const row = get.get(requestId);
    return row && row.chat_id === chatId && row.run_id === runId ? publicQuestion(row) : null;
  }
  function waiting(receipt, question, mode, model) {
    const spec = validateQuestion(question), token = crypto.randomBytes(32).toString('base64url');
    const result = store.transaction(() => {
      const row = store.byRequest.get(receipt.requestId);
      if (!row || row.owner_id !== ownerId || row.state !== 'admitted' || row.run_id !== receipt.runId || !active.has(row.run_id)) throw fail('Run ownership changed.');
      const at = new Date().toISOString();
      store.db.prepare(`INSERT INTO clarifications (request_id,chat_id,run_id,question_id,revision,spec,token_hash,phase,mode,model,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'waiting',?,?,?,?)`).run(receipt.requestId, receipt.chatId, receipt.runId, crypto.randomUUID(), digest(spec), JSON.stringify(spec), digest(token), mode, typeof model === 'string' ? model.slice(0,100) : 'unavailable', at, at);
      return publicQuestion(get.get(receipt.requestId));
    });
    return { question: result, answerToken: token };
  }
  function answer(scope, canContinue) {
    return store.transaction(() => {
      const { receipt, row } = scoped(scope);
      if (typeof scope.answerToken !== 'string' || scope.answerToken.length > 100 || digest(scope.answerToken) !== row.token_hash) throw fail('This tab cannot answer this question.', 403);
      const accepted = answerFor(JSON.parse(row.spec), scope.answer), answerHash = digest(scope.answer);
      if (row.answer_hash) {
        if (row.answer_hash !== answerHash) throw fail('An answer was already recorded; it cannot be changed.');
        return { duplicate: true, question: publicQuestion(row) };
      }
      if (row.phase !== 'waiting' || receipt.state !== 'admitted' || receipt.owner_id !== ownerId || !active.has(row.run_id) || !canContinue) throw fail('Continuation is unavailable. Cancel the waiting request and send a fresh request.');
      store.db.prepare("UPDATE clarifications SET phase='answered',answer_json=?,answer_hash=?,segment_id=?,segment_state='accepted',updated_at=? WHERE request_id=? AND phase='waiting'").run(JSON.stringify(accepted), answerHash, crypto.randomUUID(), new Date().toISOString(), scope.requestId);
      return { duplicate: false, question: publicQuestion(get.get(scope.requestId)) };
    });
  }
  function dispatch(scope) {
    return store.transaction(() => {
      const { receipt, row } = scoped(scope);
      if (receipt.owner_id !== ownerId || receipt.state !== 'admitted' || row.segment_state !== 'accepted') throw fail('Continuation cannot be dispatched again.');
      store.db.prepare("UPDATE clarifications SET segment_state='dispatched',updated_at=? WHERE request_id=?").run(new Date().toISOString(), scope.requestId);
    });
  }
  function cancel(scope) {
    return store.transaction(() => {
      const { receipt, row } = scoped(scope);
      if (row.phase === 'cancelled') return publicQuestion(row);
      if (row.phase !== 'waiting' || receipt.state !== 'admitted') throw fail('This question is no longer waiting. Refresh its saved state.');
      if (receipt.owner_id !== ownerId && !ownerGone(receipt)) throw fail('The original service still owns this request.');
      const at = new Date().toISOString();
      if (receipt.owner_id !== ownerId) {
        finish(scope.requestId, 'UNKNOWN');
        store.finish.run('unknown', 'UNKNOWN', receipt.evidence_saved, at, scope.requestId, scope.runId, receipt.owner_id);
        return publicQuestion(get.get(scope.requestId));
      }
      store.db.prepare("UPDATE clarifications SET phase='cancelled',updated_at=? WHERE request_id=?").run(at, scope.requestId);
      store.finish.run('settled', 'NOT_EXECUTED', 0, at, scope.requestId, scope.runId, receipt.owner_id);
      return publicQuestion(get.get(scope.requestId));
    });
  }
  // Called inside the admission transaction, never committed independently.
  function finish(requestId, outcome) {
    store.db.prepare("UPDATE clarifications SET phase=?,segment_state=CASE WHEN segment_id IS NULL THEN NULL ELSE ? END,updated_at=? WHERE request_id=? AND phase IN ('waiting','answered')").run(outcome === 'UNKNOWN' ? 'unknown' : 'completed', outcome === 'UNKNOWN' ? 'unknown' : 'completed', new Date().toISOString(), requestId);
  }
  return { read, waiting, answer, dispatch, cancel, finish };
}
module.exports = { createWorkflow, validateQuestion, extractQuestion, answerFor, publicQuestion };
