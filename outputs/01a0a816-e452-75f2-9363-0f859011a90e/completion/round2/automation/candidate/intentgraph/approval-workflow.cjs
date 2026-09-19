'use strict';

// Candidate-only clarification and approval state machine.  This module is
// intentionally independent from the HTTP/runtime path: it can describe and
// authorize a proposed change, but it cannot perform a provider or device
// operation unless a caller supplies an explicitly marked mock executor.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { DatabaseSync = null; }

const VERSION = 1;
const DEFAULT_QUESTION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_TEXT = 20_000;
const MAX_SCOPE_BYTES = 256 * 1024;
const MAX_CHOICES = 32;
const MAX_RECORDS = 500;

const QUESTION_STATUSES = new Set(['pending', 'answered', 'canceled', 'stale', 'expired']);
const PROPOSAL_STATUSES = new Set(['proposed', 'superseded', 'stale', 'canceled']);
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'denied', 'canceled', 'stale', 'expired', 'executing', 'executed', 'unknown', 'failed']);
const SENSITIVE_KEY = /(?:api[_-]?key|private[_-]?key|secret|password|passwd|credential|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret)/i;
const SENSITIVE_TEXT = /(?:-----BEGIN [^-]+-----|\b(?:api[_-]?key|private[_-]?key|password|passwd|secret|credential|authorization|access[_-]?token|refresh[_-]?token)\b\s*[:=]|\bBearer\s+[A-Za-z0-9._~+/=-]{12,})/i;

class WorkflowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.status = details.status || (code.includes('token') || code === 'approval_required' ? 403 : 409);
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new WorkflowError(code, message, details);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digest(value) {
  return sha256(JSON.stringify(stable(value)));
}

// Object key ordering is irrelevant to a scope, while array ordering remains
// significant.  This makes the digest stable without treating a reordered
// device list as silently equivalent to the reviewed selection.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) fail('invalid_scope', 'Scope contains a non-finite number.');
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    fail('invalid_scope', 'Scope contains an unsupported value.');
  }
  return value;
}

function requireText(value, name, max = MAX_TEXT) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid_input', `${name} is invalid.`);
  rejectCredentialPayload(value, name);
  return value.trim();
}

function optionalText(value, name, max = MAX_TEXT) {
  if (value === undefined || value === null) return null;
  return requireText(value, name, max);
}

function rejectCredentialPayload(value, name, seen = new Set()) {
  if (typeof value === 'string') {
    if (SENSITIVE_TEXT.test(value)) fail('credential_input', `${name} contains credential-bearing text.`);
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) fail('invalid_input', `${name} contains a cyclic value.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => rejectCredentialPayload(item, `${name}[${index}]`, seen));
  else for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail('credential_input', `${name}.${key} is not accepted in workflow state.`);
    rejectCredentialPayload(item, `${name}.${key}`, seen);
  }
  seen.delete(value);
  return value;
}

function requireJson(value, name, { object = false } = {}) {
  if (value === undefined || value === null || (object && (!value || typeof value !== 'object' || Array.isArray(value)))) {
    fail('invalid_input', `${name} is required.`);
  }
  const copy = clone(value);
  rejectCredentialPayload(copy, name);
  const normalized = stable(copy);
  let encoded;
  try { encoded = JSON.stringify(normalized); } catch { fail('invalid_input', `${name} is invalid.`); }
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_SCOPE_BYTES) fail('invalid_input', `${name} exceeds the size limit.`);
  return normalized;
}

function token() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(value) {
  return sha256(value);
}

function sameToken(value, expectedHash) {
  if (typeof value !== 'string' || !value || typeof expectedHash !== 'string') return false;
  const actual = Buffer.from(tokenHash(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowMs(clock) {
  const value = Number(clock());
  if (!Number.isFinite(value)) fail('clock_invalid', 'Workflow clock returned an invalid time.');
  return value;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function publicQuestion(question) {
  const result = clone(question);
  delete result.tokenHash;
  return result;
}

function publicProposal(proposal) {
  return clone(proposal);
}

function publicApproval(approval) {
  const result = clone(approval);
  delete result.decisionTokenHash;
  delete result.executionTokenHash;
  return result;
}

function publicReceipt(receipt) {
  return clone(receipt);
}

function createInitialState() {
  return { version: VERSION, revision: 0, questions: [], proposals: [], approvals: [], receipts: [], events: [], owners: [], runs: [] };
}

function ensureArray(value, name) {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) fail('state_invalid', `Persisted ${name} are invalid.`);
}

function validHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validatePersistedState(state) {
  if (!state || typeof state !== 'object' || state.version !== VERSION || !Number.isInteger(state.revision) || state.revision < 0) {
    fail('state_invalid', 'Persisted approval state is invalid.');
  }
  for (const key of ['questions', 'proposals', 'approvals', 'receipts', 'events']) ensureArray(state[key], key);
  if (state.owners === undefined) state.owners = [];
  ensureArray(state.owners, 'owners');
  const ownerKeys = new Set();
  for (const owner of state.owners) {
    if (!owner || !['question', 'proposal', 'approval'].includes(owner.kind) || typeof owner.id !== 'string' || typeof owner.runId !== 'string' || typeof owner.chatId !== 'string') fail('state_invalid', 'Persisted workflow ownership is invalid.');
    const key = `${owner.kind}:${owner.id}`;
    if (ownerKeys.has(key)) fail('state_invalid', 'Persisted workflow ownership is duplicated.');
    ownerKeys.add(key);
    rejectCredentialPayload(owner, 'workflow ownership');
  }
  if (state.runs === undefined) state.runs = [];
  ensureArray(state.runs, 'runs');
  const runIds = new Set();
  for (const run of state.runs) {
    if (!run || typeof run.runId !== 'string' || runIds.has(run.runId) || typeof run.chatId !== 'string' || !['inspect', 'plan'].includes(run.mode) || !['running', 'waiting-question', 'completed', 'failed', 'canceled', 'question-ended', 'restored-history'].includes(run.status) || (run.questionId !== null && run.questionId !== undefined && typeof run.questionId !== 'string')) fail('state_invalid', 'Persisted clarification run is invalid.');
    runIds.add(run.runId);
    if (run.selection !== null && run.selection !== undefined) requireJson(run.selection, 'run selection');
    rejectCredentialPayload(run, 'clarification run');
  }
  const questions = new Map();
  for (const question of state.questions) {
    if (!question || typeof question.id !== 'string' || questions.has(question.id) || !QUESTION_STATUSES.has(question.status) || !validHash(question.tokenHash) || typeof question.createdAt !== 'string' || !Number.isFinite(Number(question.expiresAt))) fail('state_invalid', 'Persisted question is invalid.');
    rejectCredentialPayload(question.prompt, 'question.prompt');
    rejectCredentialPayload(question.context, 'question.context');
    if (question.answer !== null && question.answer !== undefined) {
      if (!question.answer || typeof question.answer !== 'object' || Array.isArray(question.answer)) fail('state_invalid', 'Persisted question answer is invalid.');
      const hasChoice = typeof question.answer.choice === 'string' && question.answer.choice.length > 0;
      const hasText = typeof question.answer.text === 'string' && question.answer.text.trim().length > 0;
      if ((hasChoice ? 1 : 0) + (hasText ? 1 : 0) !== 1) fail('state_invalid', 'Persisted question answer is invalid.');
      rejectCredentialPayload(question.answer, 'question.answer');
    }
    questions.set(question.id, question);
  }
  for (const run of state.runs) {
    if (run.questionId !== null && run.questionId !== undefined && !questions.has(run.questionId)) fail('state_invalid', 'Persisted clarification run points to a missing question.');
  }
  const proposals = new Map();
  for (const proposal of state.proposals) {
    if (!proposal || typeof proposal.id !== 'string' || proposals.has(proposal.id) || !PROPOSAL_STATUSES.has(proposal.status) || !validHash(proposal.scopeDigest) || !validHash(proposal.actionDigest) || !Number.isInteger(proposal.revision)) fail('state_invalid', 'Persisted proposal is invalid.');
    const action = proposal.action;
    if (!action || typeof action !== 'object' || !action.target || !action.scope || typeof action.operation !== 'string' || !['plan', 'inspect', 'write'].includes(action.mode) || digest(action.scope) !== proposal.scopeDigest || digest(action) !== proposal.actionDigest) fail('state_invalid', 'Persisted proposal digest does not match its scope.');
    rejectCredentialPayload(action, 'proposal.action');
    if (proposal.questionId !== null && proposal.questionId !== undefined && (typeof proposal.questionId !== 'string' || !questions.has(proposal.questionId))) fail('state_invalid', 'Persisted proposal question binding is invalid.');
    proposals.set(proposal.id, proposal);
  }
  const approvals = new Map();
  for (const approval of state.approvals) {
    if (!approval || typeof approval.id !== 'string' || approvals.has(approval.id) || !APPROVAL_STATUSES.has(approval.status) || !validHash(approval.scopeDigest) || !validHash(approval.actionDigest) || !Number.isInteger(approval.proposalRevision)) fail('state_invalid', 'Persisted approval is invalid.');
    if (approval.decisionTokenHash !== null && approval.decisionTokenHash !== undefined && !validHash(approval.decisionTokenHash)) fail('state_invalid', 'Persisted approval decision token is invalid.');
    if (approval.executionTokenHash !== null && approval.executionTokenHash !== undefined && !validHash(approval.executionTokenHash)) fail('state_invalid', 'Persisted approval execution token is invalid.');
    const proposal = proposals.get(approval.proposalId);
    if (!proposal || proposal.revision !== approval.proposalRevision || proposal.scopeDigest !== approval.scopeDigest || proposal.actionDigest !== approval.actionDigest) fail('state_invalid', 'Persisted approval is not bound to its proposal.');
    if ((approval.questionId ?? null) !== (proposal.questionId ?? null)) fail('state_invalid', 'Persisted approval question binding is invalid.');
    if (approval.questionAnswerDigest !== null && approval.questionAnswerDigest !== undefined && !validHash(approval.questionAnswerDigest)) fail('state_invalid', 'Persisted approval answer binding is invalid.');
    if (approval.questionId) {
      const question = questions.get(approval.questionId);
      if (!question || question.status !== 'answered' || approval.questionAnswerDigest !== digest(question.answer)) fail('state_invalid', 'Persisted approval answer binding does not match.');
    } else if (approval.questionAnswerDigest !== null && approval.questionAnswerDigest !== undefined) fail('state_invalid', 'Persisted approval has an unexpected answer binding.');
    const activeTokenShape = approval.status === 'pending' && validHash(approval.decisionTokenHash) && (approval.executionTokenHash === null || approval.executionTokenHash === undefined)
      || approval.status === 'approved' && (approval.decisionTokenHash === null || approval.decisionTokenHash === undefined) && validHash(approval.executionTokenHash);
    const terminalTokenShape = !['pending', 'approved'].includes(approval.status) && (approval.decisionTokenHash === null || approval.decisionTokenHash === undefined) && (approval.executionTokenHash === null || approval.executionTokenHash === undefined);
    if (!activeTokenShape && !terminalTokenShape) fail('state_invalid', 'Persisted approval authorization state is invalid.');
    approvals.set(approval.id, approval);
  }
  for (const receipt of state.receipts) {
    const proposal = proposals.get(receipt?.proposalId);
    if (!receipt || typeof receipt.id !== 'string' || !receipt.scope || !receipt.action || !proposal || receipt.actionDigest !== proposal.actionDigest || receipt.scopeDigest !== proposal.scopeDigest || digest(receipt.scope) !== receipt.scopeDigest || digest(receipt.action) !== receipt.actionDigest) fail('state_invalid', 'Persisted review receipt is invalid.');
    rejectCredentialPayload(receipt, 'review receipt');
  }
  for (const event of state.events) {
    if (!event || typeof event.id !== 'string' || !Number.isInteger(event.revision) || event.revision < 1 || event.revision > state.revision) fail('state_invalid', 'Persisted workflow event is invalid.');
    rejectCredentialPayload(event, 'workflow event');
  }
  for (const owner of state.owners) {
    const exists = owner.kind === 'question' ? questions.has(owner.id) : owner.kind === 'proposal' ? proposals.has(owner.id) : approvals.has(owner.id);
    if (!exists || !runIds.has(owner.runId)) fail('state_invalid', 'Persisted workflow ownership points to a missing item or run.');
  }
  return state;
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readValidatedFile(filePath) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { fail('state_invalid', 'Persisted approval state cannot be read.'); }
  return validatePersistedState(parsed);
}

function openStateDatabase(filePath) {
  if (!DatabaseSync) fail('state_store_unavailable', 'The durable workflow store is unavailable.');
  const database = new DatabaseSync(`${filePath}.sqlite`);
  database.exec('PRAGMA busy_timeout = 2000; CREATE TABLE IF NOT EXISTS workflow_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL);');
  return database;
}

function statePayload(value) {
  return JSON.stringify(stable(value));
}

// SQLite is the sole authority for a file-backed workflow.  The adjacent
// JSON file is only an inspectable export and is never consulted once the
// SQLite row exists.  A JSON file from an older candidate is accepted once,
// validated, and migrated into the authoritative row.
function readDatabaseState(storagePath) {
  const database = openStateDatabase(storagePath);
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const row = database.prepare('SELECT revision, payload FROM workflow_state WHERE id = 1').get();
    let state;
    let migrated = false;
    if (row) {
      state = validatePersistedState(JSON.parse(row.payload));
      if (Number(row.revision) !== state.revision) fail('state_invalid', 'Authoritative workflow revision does not match its payload.');
    } else if (fs.existsSync(storagePath)) {
      state = readValidatedFile(storagePath);
      migrated = true;
      database.prepare('INSERT INTO workflow_state (id, revision, payload) VALUES (1, ?, ?)').run(state.revision, statePayload(state));
    } else {
      state = createInitialState();
      database.prepare('INSERT INTO workflow_state (id, revision, payload) VALUES (1, ?, ?)').run(state.revision, statePayload(state));
    }
    database.exec('COMMIT');
    inTransaction = false;
    return { state, migrated };
  } catch (error) {
    try { if (inTransaction) database.exec('ROLLBACK'); } catch {}
    if (error?.code === 'ERR_SQLITE_BUSY' || error?.code === 'SQLITE_BUSY') fail('state_conflict', 'Workflow state is busy or changed; reload before retrying.');
    throw error;
  } finally {
    try { database.close(); } catch {}
  }
}

function normalizeAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_input', 'A proposal action is required.');
  const target = requireJson(input.target, 'target');
  const operation = requireText(input.operation, 'operation', 500);
  const scope = requireJson(input.scope, 'scope', { object: true });
  const diff = input.diff === undefined || input.diff === null ? null : requireJson(input.diff, 'diff');
  const impact = input.impact === undefined || input.impact === null ? null : requireJson(input.impact, 'impact');
  const rollback = input.rollback === undefined || input.rollback === null ? null : requireJson(input.rollback, 'rollback');
  const mode = input.mode === undefined ? 'write' : requireText(input.mode, 'mode', 20);
  if (!['plan', 'inspect', 'write'].includes(mode)) fail('invalid_input', 'mode must be plan, inspect, or write.');
  return stable({ target, operation, scope, diff, impact, rollback, mode });
}

function normalizeChoices(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_CHOICES) fail('invalid_input', 'choices are invalid.');
  const choices = value.map((choice) => {
    if (typeof choice === 'string') return { id: requireText(choice, 'choice', 200), label: requireText(choice, 'choice', 200) };
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) fail('invalid_input', 'choice is invalid.');
    return { id: requireText(choice.id, 'choice id', 200), label: requireText(choice.label ?? choice.id, 'choice label', 500) };
  });
  const ids = new Set();
  for (const choice of choices) {
    if (ids.has(choice.id)) fail('invalid_input', 'choice ids must be unique.');
    ids.add(choice.id);
  }
  return choices;
}

class ApprovalWorkflow {
  constructor({ storagePath, clock = () => Date.now(), executor = null } = {}) {
    this.storagePath = storagePath ? path.resolve(storagePath) : null;
    this.clock = clock;
    this.executor = executor;
    // File backed connections are opened for one authoritative transaction at
    // a time. Keep an explicit lifecycle hook so an owning server can release
    // future/transport resources without treating the JSON mirror as state.
    this.closed = false;
    this.state = createInitialState();
    this.durableState = clone(this.state);
    this.lastReload = null;
    this.load();
    this.durableState = clone(this.state);
  }

  load({ explicit = false } = {}) {
    if (!this.storagePath) {
      this.lastReload = explicit ? { explicit: true, invalidatedApprovalIds: [] } : null;
      return this.snapshot();
    }
    const durable = readDatabaseState(this.storagePath);
    this.state = durable.state;
    // A reload begins from the durable state.  If authorization invalidation
    // below needs to commit, rollback must return to this exact state.
    this.durableState = clone(this.state);
    const invalidatedApprovalIds = [];
    const invalidatedQuestionIds = [];
    const invalidatedRunIds = [];
    for (const question of this.state.questions) {
      if (question.status === 'pending') {
        question.status = 'stale';
        question.staleReason = 'clarification invalidated on reload; ask the question again';
        question.resolvedAt = iso(nowMs(this.clock));
        invalidatedQuestionIds.push(question.id);
      }
    }
    for (const approval of this.state.approvals) {
      if (approval.status === 'pending' || approval.status === 'approved') {
        approval.status = 'stale';
        approval.staleReason = 'authorization invalidated on reload; fresh approval is required';
        approval.resolvedAt = iso(nowMs(this.clock));
        approval.decisionTokenHash = null;
        approval.executionTokenHash = null;
        invalidatedApprovalIds.push(approval.id);
      } else if (approval.status === 'executing') {
        approval.status = 'unknown';
        approval.failure = { code: 'reload_interrupted', message: 'Execution was in progress during reload; completion is unknown.' };
        approval.resolvedAt = iso(nowMs(this.clock));
        approval.decisionTokenHash = null;
        approval.executionTokenHash = null;
        invalidatedApprovalIds.push(approval.id);
      }
    }
    for (const run of this.state.runs) {
      if (['running', 'waiting-question'].includes(run.status)) {
        run.status = 'restored-history';
        run.interactive = false;
        run.restoredAt = iso(nowMs(this.clock));
        invalidatedRunIds.push(run.runId);
      }
    }
    this.lastReload = { explicit, invalidatedQuestionIds, invalidatedApprovalIds, invalidatedRunIds };
    if (invalidatedQuestionIds.length || invalidatedApprovalIds.length || invalidatedRunIds.length) this.commit({ type: 'state.reloaded', invalidatedQuestionIds, invalidatedApprovalIds, invalidatedRunIds });
    return this.snapshot();
  }

  reload() {
    return this.load({ explicit: true });
  }

  close() {
    // openStateDatabase() closes each transient SQLite handle in its finally
    // block. This idempotent hook is still part of the ownership contract for
    // callers that create and later dispose a server-owned workflow.
    this.closed = true;
  }

  persist(expectedRevision = this.state.revision) {
    if (!this.storagePath) return;
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    const database = openStateDatabase(this.storagePath);
    let inTransaction = false;
    try {
      database.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      const row = database.prepare('SELECT revision, payload FROM workflow_state WHERE id = 1').get();
      let current;
      if (row) {
        current = validatePersistedState(JSON.parse(row.payload));
        if (Number(row.revision) !== current.revision) fail('state_invalid', 'Authoritative workflow revision does not match its payload.');
      } else {
        current = fs.existsSync(this.storagePath) ? readValidatedFile(this.storagePath) : createInitialState();
      }
      if (current.revision !== expectedRevision) {
        this.state = current;
        fail('state_conflict', 'Workflow state changed in another owner; reload before retrying.');
      }
      const payload = statePayload(this.state);
      if (row) {
        const update = database.prepare('UPDATE workflow_state SET revision = ?, payload = ? WHERE id = 1 AND revision = ?').run(this.state.revision, payload, current.revision);
        if (Number(update.changes) !== 1) fail('state_conflict', 'Workflow state changed in another owner; reload before retrying.');
      } else database.prepare('INSERT INTO workflow_state (id, revision, payload) VALUES (1, ?, ?)').run(this.state.revision, payload);
      database.exec('COMMIT');
      inTransaction = false;
      try {
        writeJsonAtomic(this.storagePath, this.state);
      } catch { /* The mirror is best-effort; SQLite has already committed. */ }
    } catch (error) {
      try { if (inTransaction) database.exec('ROLLBACK'); } catch {}
      if (error?.code === 'ERR_SQLITE_BUSY' || error?.code === 'SQLITE_BUSY') fail('state_conflict', 'Workflow state is busy or changed; reload before retrying.');
      throw error;
    } finally {
      try { database.close(); } catch {}
    }
  }

  commit(event) {
    const before = clone(this.state);
    const baseRevision = this.state.revision;
    this.state.revision += 1;
    this.state.events.push({ id: id('event'), revision: this.state.revision, at: iso(nowMs(this.clock)), ...clone(event) });
    this.state.events = this.state.events.slice(-MAX_RECORDS);
    try {
      this.persist(baseRevision);
      this.durableState = clone(this.state);
    } catch (error) {
      if (error?.code === 'state_conflict' && this.storagePath) {
        try { this.state = readDatabaseState(this.storagePath).state; this.durableState = clone(this.state); } catch { /* Keep the original conflict when the authoritative store is unavailable. */ }
      } else {
        // Persistence failures must not leave a locally mutated authorization
        // state ahead of durable state. Callers can retry after the fault is
        // repaired without an in-memory approval becoming usable.
        this.state = clone(this.durableState || before);
      }
      throw error;
    }
  }

  snapshot() {
    return {
      version: this.state.version,
      revision: this.state.revision,
      questions: this.state.questions.map(publicQuestion),
      proposals: this.state.proposals.map(publicProposal),
      approvals: this.state.approvals.map(publicApproval),
      receipts: this.state.receipts.map(publicReceipt),
      ownership: clone(this.state.owners),
      runs: clone(this.state.runs),
      events: clone(this.state.events),
      reload: clone(this.lastReload)
    };
  }

  getQuestion(questionId) {
    const question = this.state.questions.find((item) => item.id === questionId);
    return question ? publicQuestion(question) : null;
  }

  getProposal(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    return proposal ? publicProposal(proposal) : null;
  }

  getApproval(approvalId) {
    const approval = this.state.approvals.find((item) => item.id === approvalId);
    return approval ? publicApproval(approval) : null;
  }

  setOwner(kind, entityId, runId, chatId) {
    if (!['question', 'proposal', 'approval'].includes(kind)) fail('invalid_input', 'Workflow ownership kind is invalid.');
    const idValue = requireText(entityId, 'owned workflow id', 200);
    const owner = { kind, id: idValue, runId: requireText(runId, 'runId', 100), chatId: requireText(chatId, 'chatId', 100) };
    const run = this.state.runs.find((item) => item.runId === owner.runId && item.chatId === owner.chatId);
    if (!run) fail('run_not_found', 'Workflow ownership requires an existing run and chat.');
    const existing = this.state.owners.find((item) => item.kind === kind && item.id === idValue);
    if (existing) {
      if (existing.runId !== owner.runId || existing.chatId !== owner.chatId) fail('ownership_mismatch', 'This workflow item belongs to another chat run.');
      return clone(existing);
    }
    this.state.owners.push(owner);
    this.commit({ type: 'workflow.owner_bound', ...owner });
    return clone(owner);
  }

  getOwner(kind, entityId) {
    return clone(this.state.owners.find((item) => item.kind === kind && item.id === entityId) || null);
  }

  upsertRun({ runId, chatId, mode, status, questionId = null, selection = null } = {}) {
    const record = {
      runId: requireText(runId, 'runId', 100), chatId: requireText(chatId, 'chatId', 100),
      mode: requireText(mode, 'run mode', 20), status: requireText(status, 'run status', 40),
      questionId: questionId === null || questionId === undefined ? null : requireText(questionId, 'questionId', 200),
      selection: selection === null || selection === undefined ? null : requireJson(selection, 'run selection'),
      updatedAt: iso(nowMs(this.clock))
    };
    if (!['inspect', 'plan'].includes(record.mode) || !['running', 'waiting-question', 'completed', 'failed', 'canceled', 'question-ended', 'restored-history'].includes(record.status)) fail('invalid_input', 'Run lifecycle state is invalid.');
    const existing = this.state.runs.find((item) => item.runId === record.runId);
    if (existing && (existing.chatId !== record.chatId || existing.mode !== record.mode)) fail('ownership_mismatch', 'This run belongs to another chat.');
    if (existing && JSON.stringify({ ...existing, updatedAt: undefined }) === JSON.stringify({ ...record, updatedAt: undefined })) return clone(existing);
    if (existing) Object.assign(existing, record);
    else this.state.runs.push(record);
    this.commit({ type: 'run.state', runId: record.runId, chatId: record.chatId, status: record.status, questionId: record.questionId });
    return clone(record);
  }

  getRunRecord(runId) {
    return clone(this.state.runs.find((item) => item.runId === runId) || null);
  }

  activeQuestion() {
    const question = this.state.questions.find((item) => item.status === 'pending');
    return question ? publicQuestion(question) : null;
  }

  expireQuestion(question) {
    if (question.status === 'pending' && nowMs(this.clock) >= question.expiresAt) {
      question.status = 'expired';
      question.resolvedAt = iso(nowMs(this.clock));
      this.commit({ type: 'question.expired', questionId: question.id });
      return true;
    }
    return false;
  }

  requireQuestion(questionId) {
    if (typeof questionId !== 'string' || !questionId) fail('question_not_found', 'Pending question was not found.');
    const question = this.state.questions.find((item) => item.id === questionId);
    if (!question) fail('question_not_found', 'Pending question was not found.');
    if (this.expireQuestion(question)) fail('question_expired', 'This question has expired.');
    if (question.status === 'stale') fail('stale_question', 'This question is stale and cannot authorize a later request.');
    if (question.status !== 'pending') fail('question_not_pending', `This question is ${question.status} and cannot be answered.`);
    return question;
  }

  requireQuestionToken(question, provided) {
    if (!sameToken(provided, question.tokenHash)) fail('invalid_question_token', 'Question token is invalid.');
  }

  createPendingQuestion({ prompt, choices, allowFreeText = true, context = null, ttlMs = DEFAULT_QUESTION_TTL_MS } = {}) {
    const questionPrompt = requireText(prompt, 'question prompt');
    const normalizedChoices = normalizeChoices(choices);
    if (typeof allowFreeText !== 'boolean') fail('invalid_input', 'allowFreeText is invalid.');
    if (context !== null) requireJson(context, 'question context');
    const ttl = Number(ttlMs);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 24 * 60 * 60 * 1000) fail('invalid_input', 'question ttl is invalid.');
    for (const previous of this.state.questions.filter((item) => item.status === 'pending')) {
      previous.status = 'stale';
      previous.staleReason = 'superseded by a newer pending question';
      previous.resolvedAt = iso(nowMs(this.clock));
    }
    const rawToken = token();
    const createdAt = nowMs(this.clock);
    const question = {
      id: id('question'), type: 'pending-question', status: 'pending', prompt: questionPrompt,
      choices: normalizedChoices, allowFreeText, context: context === null ? null : requireJson(context, 'question context'),
      createdAt: iso(createdAt), expiresAt: createdAt + ttl, expiresAtIso: iso(createdAt + ttl),
      tokenHash: tokenHash(rawToken), answer: null
    };
    this.state.questions.push(question);
    this.commit({ type: 'question.created', questionId: question.id, expiresAt: question.expiresAtIso });
    return { question: publicQuestion(question), token: rawToken };
  }

  answerQuestion({ questionId, questionToken, choice, text } = {}) {
    const question = this.requireQuestion(questionId);
    this.requireQuestionToken(question, questionToken);
    const hasChoice = choice !== undefined && choice !== null;
    const hasText = text !== undefined && text !== null && String(text).trim() !== '';
    if ((hasChoice ? 1 : 0) + (hasText ? 1 : 0) !== 1) fail('invalid_answer', 'Answer with exactly one choice or free-text response.');
    if (hasChoice) {
      const answerChoice = requireText(choice, 'choice', 200);
      if (!question.choices.some((item) => item.id === answerChoice)) fail('invalid_answer', 'Choice is not offered by this question.');
      question.answer = { choice: answerChoice, text: null };
    } else {
      if (!question.allowFreeText) fail('invalid_answer', 'This question accepts the listed choices only.');
      question.answer = { choice: null, text: requireText(text, 'answer text') };
    }
    question.status = 'answered';
    question.answeredAt = iso(nowMs(this.clock));
    question.tokenUsedAt = question.answeredAt;
    this.commit({ type: 'question.answered', questionId: question.id, answer: question.answer });
    return { question: publicQuestion(question), answer: clone(question.answer) };
  }

  cancelQuestion({ questionId, questionToken, reason = 'canceled by user' } = {}) {
    const question = this.requireQuestion(questionId);
    this.requireQuestionToken(question, questionToken);
    question.status = 'canceled';
    question.reason = requireText(reason, 'cancel reason', 1000);
    question.resolvedAt = iso(nowMs(this.clock));
    this.commit({ type: 'question.canceled', questionId: question.id });
    return { question: publicQuestion(question) };
  }

  abandonQuestion({ questionId, reason = 'abandoned after reload' } = {}) {
    const question = this.requireQuestion(questionId);
    question.status = 'canceled';
    question.reason = requireText(reason, 'abandon reason', 1000);
    question.resolvedAt = iso(nowMs(this.clock));
    this.commit({ type: 'question.abandoned', questionId: question.id });
    return { question: publicQuestion(question) };
  }

  renderQuestionCard(questionId) {
    const question = this.state.questions.find((item) => item.id === questionId);
    if (!question) fail('question_not_found', 'Pending question was not found.');
    this.expireQuestion(question);
    // Rendering is a pure projection: it does not answer, approve, execute,
    // refresh provider state, or call an injected executor.
    return {
      type: 'pending-question-card',
      executing: false,
      action: 'none',
      interactive: question.status === 'pending',
      question: publicQuestion(question)
    };
  }

  createProposal(input = {}) {
    const action = normalizeAction(input);
    const createdAt = nowMs(this.clock);
    const proposal = {
      id: id('proposal'), type: 'change-proposal', status: 'proposed', revision: this.state.revision + 1,
      action, scopeDigest: digest(action.scope), actionDigest: digest(action),
      questionId: input.questionId === undefined || input.questionId === null ? null : requireText(input.questionId, 'questionId', 200),
      createdAt: iso(createdAt), updatedAt: iso(createdAt)
    };
    this.state.proposals.push(proposal);
    this.commit({ type: 'proposal.created', proposalId: proposal.id, scopeDigest: proposal.scopeDigest, actionDigest: proposal.actionDigest });
    return { proposal: publicProposal(proposal) };
  }

  replaceProposal(proposalId, input = {}) {
    const previous = this.state.proposals.find((item) => item.id === proposalId);
    if (!previous) fail('proposal_not_found', 'Proposal was not found.');
    if (previous.status !== 'proposed') fail('proposal_stale', `Proposal is ${previous.status} and cannot be replaced.`);
    previous.status = 'superseded';
    previous.supersededAt = iso(nowMs(this.clock));
    for (const approval of this.state.approvals.filter((item) => item.proposalId === proposalId && ['pending', 'approved'].includes(item.status))) {
      approval.status = 'stale';
      approval.staleReason = 'proposal was superseded';
      approval.resolvedAt = previous.supersededAt;
      approval.decisionTokenHash = null;
      approval.executionTokenHash = null;
    }
    const next = this.createProposal({ ...input, questionId: input.questionId === undefined ? previous.questionId : input.questionId });
    const created = this.state.proposals.find((item) => item.id === next.proposal.id);
    created.supersedes = proposalId;
    this.commit({ type: 'proposal.replaced', proposalId, replacementId: created.id });
    return { proposal: publicProposal(created), previousProposal: publicProposal(previous) };
  }

  invalidateProposal(proposalId, reason = 'proposal invalidated') {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) fail('proposal_not_found', 'Proposal was not found.');
    if (proposal.status === 'proposed') {
      proposal.status = 'stale';
      proposal.staleReason = requireText(reason, 'stale reason', 1000);
      proposal.updatedAt = iso(nowMs(this.clock));
      for (const approval of this.state.approvals.filter((item) => item.proposalId === proposalId && ['pending', 'approved'].includes(item.status))) {
        approval.status = 'stale';
        approval.staleReason = proposal.staleReason;
        approval.resolvedAt = proposal.updatedAt;
        approval.decisionTokenHash = null;
        approval.executionTokenHash = null;
      }
      this.commit({ type: 'proposal.invalidated', proposalId });
    }
    return { proposal: publicProposal(proposal) };
  }

  requireProposal(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) fail('proposal_not_found', 'Proposal was not found.');
    if (proposal.status !== 'proposed') fail('proposal_stale', `Proposal is ${proposal.status} and cannot be used.`);
    return proposal;
  }

  buildReviewReceipt(proposal) {
    return {
      id: id('receipt'), type: 'change-review-receipt', proposalId: proposal.id,
      status: proposal.status, target: clone(proposal.action.target), operation: proposal.action.operation,
      scope: clone(proposal.action.scope), scopeDigest: proposal.scopeDigest, action: clone(proposal.action),
      actionDigest: proposal.actionDigest, diff: clone(proposal.action.diff), impact: clone(proposal.action.impact),
      rollback: clone(proposal.action.rollback), executionAllowed: proposal.action.mode !== 'plan',
      reviewedAt: iso(nowMs(this.clock))
    };
  }

  reviewProposal(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) fail('proposal_not_found', 'Proposal was not found.');
    const existing = this.state.receipts.find((item) => item.proposalId === proposalId && item.actionDigest === proposal.actionDigest);
    if (existing) return { receipt: publicReceipt(existing) };
    const receipt = this.buildReviewReceipt(proposal);
    this.state.receipts.push(receipt);
    this.commit({ type: 'proposal.reviewed', proposalId, receiptId: receipt.id, actionDigest: proposal.actionDigest });
    return { receipt: publicReceipt(receipt) };
  }

  renderProposal(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) fail('proposal_not_found', 'Proposal was not found.');
    const receipt = this.state.receipts.find((item) => item.proposalId === proposalId && item.actionDigest === proposal.actionDigest) || this.buildReviewReceipt(proposal);
    return {
      type: 'change-review-card', executing: false, action: 'none',
      interactive: proposal.status === 'proposed', executionAllowed: proposal.status === 'proposed' && proposal.action.mode !== 'plan',
      proposal: publicProposal(proposal), receipt: publicReceipt(receipt)
    };
  }

  requestApproval({ proposalId, questionId, ttlMs = DEFAULT_APPROVAL_TTL_MS } = {}) {
    const proposal = this.requireProposal(proposalId);
    const proposalQuestionId = proposal.questionId ?? null;
    if (questionId !== undefined && (questionId === null ? null : requireText(questionId, 'questionId', 200)) !== proposalQuestionId) {
      fail('question_binding_mismatch', 'Approval question must match the proposal question binding. Create a new proposal for a different answer.');
    }
    const boundQuestionId = proposalQuestionId;
    let questionAnswerDigest = null;
    if (boundQuestionId) {
      const question = this.state.questions.find((item) => item.id === boundQuestionId);
      if (!question) fail('question_not_found', 'Approval question was not found.');
      if (question.status === 'stale') fail('stale_question', 'Approval question is stale.');
      if (question.status !== 'answered') fail('approval_required', 'The pending question must be answered before approval.');
      questionAnswerDigest = digest(question.answer);
    }
    const existing = this.state.approvals.find((item) => item.proposalId === proposalId && item.actionDigest === proposal.actionDigest && ['pending', 'approved', 'executing', 'executed', 'unknown'].includes(item.status));
    if (existing) {
      fail('approval_exists', 'This proposal already has an active or completed approval. Review or create a new proposal before requesting another.');
    }
    const ttl = Number(ttlMs);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 24 * 60 * 60 * 1000) fail('invalid_input', 'approval ttl is invalid.');
    for (const previous of this.state.approvals.filter((item) => item.proposalId === proposalId && item.status === 'pending')) {
      previous.status = 'stale';
      previous.staleReason = 'superseded by a newer approval request';
      previous.resolvedAt = iso(nowMs(this.clock));
    }
    const decisionToken = token();
    const createdAt = nowMs(this.clock);
    const approval = {
      id: id('approval'), type: 'execution-approval', status: 'pending', proposalId: proposal.id,
      questionId: boundQuestionId || null, proposalRevision: proposal.revision,
      questionAnswerDigest,
      scopeDigest: proposal.scopeDigest, actionDigest: proposal.actionDigest,
      decisionTokenHash: tokenHash(decisionToken), executionTokenHash: null,
      createdAt: iso(createdAt), expiresAt: createdAt + ttl, expiresAtIso: iso(createdAt + ttl)
    };
    this.state.approvals.push(approval);
    const receipt = this.reviewProposal(proposalId).receipt;
    this.commit({ type: 'approval.requested', approvalId: approval.id, proposalId, scopeDigest: approval.scopeDigest, actionDigest: approval.actionDigest });
    return { approval: publicApproval(approval), token: decisionToken, receipt: publicReceipt(receipt) };
  }

  expireApproval(approval) {
    if (['pending', 'approved'].includes(approval.status) && nowMs(this.clock) >= approval.expiresAt) {
      approval.status = 'expired';
      approval.resolvedAt = iso(nowMs(this.clock));
      approval.decisionTokenHash = null;
      approval.executionTokenHash = null;
      this.commit({ type: 'approval.expired', approvalId: approval.id });
      return true;
    }
    return false;
  }

  requireApproval(approvalId) {
    const approval = this.state.approvals.find((item) => item.id === approvalId);
    if (!approval) fail('approval_not_found', 'Approval was not found.');
    if (this.expireApproval(approval)) fail('approval_expired', 'This approval has expired.');
    return approval;
  }

  requireCurrentApproval(approval, proposalId, expectedScope, expectedActionDigest) {
    const proposal = this.requireProposal(proposalId || approval.proposalId);
    if (proposal.id !== approval.proposalId || proposal.revision !== approval.proposalRevision) fail('stale_approval', 'Approval is stale for the current proposal.');
    if (proposal.scopeDigest !== approval.scopeDigest || proposal.actionDigest !== approval.actionDigest) fail('stale_approval', 'Approval digest no longer matches the proposal.');
    if ((proposal.questionId ?? null) !== (approval.questionId ?? null)) fail('stale_approval', 'Approval question binding no longer matches the proposal.');
    if (approval.questionId) {
      const question = this.state.questions.find((item) => item.id === approval.questionId);
      if (!question || question.status !== 'answered' || approval.questionAnswerDigest !== digest(question.answer)) fail('stale_approval', 'Approval is stale for the current clarification answer.');
    }
    if (expectedScope !== undefined && digest(requireJson(expectedScope, 'scope', { object: true })) !== approval.scopeDigest) fail('scope_mismatch', 'Approval scope does not match the reviewed scope.');
    if (expectedActionDigest !== undefined && expectedActionDigest !== approval.actionDigest) fail('scope_mismatch', 'Approval action digest does not match the reviewed action.');
    return proposal;
  }

  requireDecisionToken(approval, provided) {
    if (!approval.decisionTokenHash || !sameToken(provided, approval.decisionTokenHash)) fail('invalid_approval_token', 'Approval decision token is invalid.');
  }

  approveApproval({ approvalId, approvalToken, token: providedToken, proposalId, scope, actionDigest } = {}) {
    const approval = this.requireApproval(approvalId);
    if (approval.status !== 'pending') fail('approval_not_pending', `Approval is ${approval.status} and cannot be approved.`);
    this.requireDecisionToken(approval, approvalToken || providedToken);
    const proposal = this.requireCurrentApproval(approval, proposalId, scope, actionDigest);
    if (proposal.action.mode === 'plan') fail('plan_forbids_tools', 'Plan mode proposals cannot be approved for execution.');
    if (approval.questionId) {
      const question = this.state.questions.find((item) => item.id === approval.questionId);
      if (!question || question.status !== 'answered') fail('approval_required', 'The bound pending question is not answered.');
    }
    approval.status = 'approved';
    approval.approvedAt = iso(nowMs(this.clock));
    approval.decisionActor = 'local-owner';
    approval.decisionTokenUsedAt = approval.approvedAt;
    approval.decisionTokenHash = null;
    const executionToken = token();
    approval.executionTokenHash = tokenHash(executionToken);
    this.commit({ type: 'approval.approved', approvalId, proposalId: proposal.id, scopeDigest: approval.scopeDigest, actionDigest: approval.actionDigest });
    return { approval: publicApproval(approval), executionToken, receipt: publicReceipt(this.reviewProposal(proposal.id).receipt) };
  }

  approve(input) {
    return this.approveApproval(input);
  }

  denyApproval({ approvalId, approvalToken, token: providedToken, reason = 'denied by user' } = {}) {
    const approval = this.requireApproval(approvalId);
    if (approval.status !== 'pending') fail('approval_not_pending', `Approval is ${approval.status} and cannot be denied.`);
    this.requireDecisionToken(approval, approvalToken || providedToken);
    approval.status = 'denied';
    approval.reason = requireText(reason, 'denial reason', 1000);
    approval.deniedAt = iso(nowMs(this.clock));
    approval.decisionTokenUsedAt = approval.deniedAt;
    approval.decisionTokenHash = null;
    this.commit({ type: 'approval.denied', approvalId, reason: approval.reason });
    return { approval: publicApproval(approval) };
  }

  cancelApproval({ approvalId, approvalToken, token: providedToken, reason = 'canceled by user' } = {}) {
    const approval = this.requireApproval(approvalId);
    if (approval.status !== 'pending') fail('approval_not_pending', `Approval is ${approval.status} and cannot be canceled.`);
    this.requireDecisionToken(approval, approvalToken || providedToken);
    approval.status = 'canceled';
    approval.reason = requireText(reason, 'cancel reason', 1000);
    approval.canceledAt = iso(nowMs(this.clock));
    approval.decisionTokenUsedAt = approval.canceledAt;
    approval.decisionTokenHash = null;
    this.commit({ type: 'approval.canceled', approvalId, reason: approval.reason });
    return { approval: publicApproval(approval) };
  }

  renderApprovalCard(approvalId) {
    const approval = this.state.approvals.find((item) => item.id === approvalId);
    if (!approval) fail('approval_not_found', 'Approval was not found.');
    this.expireApproval(approval);
    const proposal = this.state.proposals.find((item) => item.id === approval.proposalId);
    const receipt = proposal
      ? (this.state.receipts.find((item) => item.proposalId === proposal.id && item.actionDigest === proposal.actionDigest) || this.buildReviewReceipt(proposal))
      : null;
    return {
      type: 'execution-approval-card', executing: false, action: 'none',
      interactive: approval.status === 'pending', executionAllowed: approval.status === 'approved' && proposal?.status === 'proposed' && proposal?.action?.mode !== 'plan',
      approval: publicApproval(approval), receipt: publicReceipt(receipt)
    };
  }

  async execute({ approvalId, executionToken, token: providedToken, proposalId, scope, actionDigest, executor = this.executor } = {}) {
    const approval = this.requireApproval(approvalId);
    if (approval.status !== 'approved') {
      if (['executed', 'executing', 'unknown', 'failed'].includes(approval.status)) fail('replay_rejected', 'This approval token has already been consumed.');
      if (approval.status === 'stale') fail('stale_approval', 'This approval is stale and cannot authorize execution.');
      fail('approval_required', `Approval is ${approval.status}; execution is not authorized.`);
    }
    const proposal = this.requireCurrentApproval(approval, proposalId || approval.proposalId, scope, actionDigest);
    if (proposal.action.mode === 'plan') fail('plan_forbids_tools', 'Plan mode cannot execute state-changing operations.');
    if (!executor || executor.kind !== 'mock' || typeof executor.execute !== 'function') fail('executor_unavailable', 'Execution requires an explicitly marked mock executor in this candidate workflow.');
    const supplied = executionToken || providedToken;
    if (!approval.executionTokenHash || !sameToken(supplied, approval.executionTokenHash)) fail('invalid_approval_token', 'Execution token is invalid.');

    // Consume before crossing the executor boundary. A timeout or thrown
    // executor error therefore cannot be retried with the same authorization.
    approval.status = 'executing';
    approval.executionStartedAt = iso(nowMs(this.clock));
    approval.executionTokenUsedAt = approval.executionStartedAt;
    approval.executionTokenHash = null;
    this.commit({ type: 'approval.execution.started', approvalId, proposalId: proposal.id, actionDigest: approval.actionDigest });
    let result;
    try {
      result = await executor.execute({
        proposal: publicProposal(proposal),
        scopeDigest: approval.scopeDigest,
        actionDigest: approval.actionDigest,
        approvalId
      });
      rejectCredentialPayload(result, 'mock executor result');
      approval.status = 'executed';
      approval.result = clone(result === undefined ? null : result);
      approval.completedAt = iso(nowMs(this.clock));
      this.commit({ type: 'approval.execution.completed', approvalId, proposalId: proposal.id, actionDigest: approval.actionDigest });
      return { executed: true, approval: publicApproval(approval), result: clone(approval.result), receipt: publicReceipt(this.reviewProposal(proposal.id).receipt) };
    } catch (error) {
      approval.status = 'unknown';
      approval.failure = { code: typeof error?.code === 'string' ? error.code.slice(0, 100) : 'mock_executor_failed', message: 'Mock executor did not establish completion.' };
      approval.completedAt = iso(nowMs(this.clock));
      this.commit({ type: 'approval.execution.unknown', approvalId, proposalId: proposal.id, actionDigest: approval.actionDigest });
      const failure = new WorkflowError('execution_unknown', 'Execution completion is unknown; the consumed approval cannot be retried.', { status: 502, approval: publicApproval(approval) });
      failure.cause = error;
      throw failure;
    }
  }
}

function createMockExecutor(handler = async () => ({ ok: true })) {
  if (typeof handler !== 'function') fail('invalid_input', 'Mock executor handler must be a function.');
  const calls = [];
  return {
    kind: 'mock', calls,
    async execute(input) {
      calls.push(clone(input));
      return handler(clone(input));
    }
  };
}

module.exports = {
  VERSION,
  DEFAULT_QUESTION_TTL_MS,
  DEFAULT_APPROVAL_TTL_MS,
  QUESTION_STATUSES,
  PROPOSAL_STATUSES,
  APPROVAL_STATUSES,
  WorkflowError,
  ApprovalWorkflow,
  createMockExecutor,
  stable,
  digest,
  sha256
};
