'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  atomicWrite,
  isInside,
  isSecretPath,
  normalizeRelative,
  sha256
} = require('./indexer.cjs');
const {
  MAX_PROPOSAL_FILE_BYTES,
  containsKeyPattern,
  normalizeCandidatePath,
  parseBuilderProposal,
  parsePlan,
  parseReviewResponse
} = require('./coordination-schema.cjs');

const MAX_FILES = 8;
const MAX_INPUT_BYTES = 128 * 1024;
const MAX_CALLS = 12;
const MAX_OUTPUT_TOKENS = 48_000;
const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_CORRECTIONS = 2;
const STATE_VERSION = 1;
const ACTIVE_STATES = new Set(['planning', 'building', 'awaiting-apply', 'applying', 'reviewing', 'correction-building', 'resumable']);
const TERMINAL_STATES = new Set(['awaiting-owner', 'failed', 'failed-review', 'blocked-unverified', 'cancelled', 'budget-exceeded', 'interrupted']);
const DENIED_COMPONENTS = new Set(['runtime', '.intentgraph', 'credentials', 'credential', 'intentgraph', 'implementation', 'check', 'checks', 'scripts', 'checkscripts']);
const ROLE_FIELDS = { planner: 'plannerId', builder: 'builderId', engineer: 'reviewerId', experience: 'acceptanceId' };
const ROLE_ASSIGNMENT_ROLES = { planner: 'planner', builder: 'builder', engineer: 'reviewer', experience: 'acceptance' };

function now() { return new Date().toISOString(); }

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function runId() {
  return `run-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

function text(value, name, maxBytes) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${name} must be bounded text`);
  return value;
}

function requiredText(value, name, maxBytes = 500) {
  text(value, name, maxBytes);
  if (!value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function normalizePath(value) {
  const normalized = normalizeCandidatePath(value);
  if (normalized.split('/').some((part) => DENIED_COMPONENTS.has(part.toLowerCase()))) throw new Error('path targets a protected coordination area');
  return normalized;
}

function redactText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|secret|password|private[_-]?key|authorization)\s*[:=]\s*["'])([^"'\r\n]+)(["'])/gi, '$1[REDACTED]$3')
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key|authorization)\s*[:=]\s*)(?!process\.env\b)[A-Za-z0-9._+/=-]{12,}/gi, '$1[REDACTED]')
    .replace(/(\b(?:bearer|token)\s+)([A-Za-z0-9._+/=-]{24,})/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|key|ghp|github_pat)-[A-Za-z0-9._-]{16,}\b/gi, '[REDACTED]');
}

function redactStructured(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactStructured);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStructured(item)]));
  return value;
}

function contentHash(content) { return sha256(Buffer.from(content, 'utf8')); }

function ensureConfinedDirectory(root, target) {
  if (!isInside(root, target)) throw new Error('runtimeDirectory must be inside workspace');
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('runtimeDirectory contains a symlink or non-directory component');
      const real = fs.realpathSync(current);
      const resolved = path.resolve(current);
      const samePath = process.platform === 'win32' ? real.toLowerCase() === resolved.toLowerCase() : real === resolved;
      if (!samePath || !isInside(root, real)) throw new Error('runtimeDirectory contains a symlink or junction component');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  fs.mkdirSync(target, { recursive: true });
}

function safeError(error) {
  const result = { code: error && error.code ? String(error.code).slice(0, 100) : 'coordination_error' };
  if (error && error.classification) result.classification = String(error.classification).slice(0, 20);
  if (error && error.status) result.status = Number(error.status);
  const message = error && error.message ? String(error.message) : 'coordination failed';
  result.message = redactText(message).slice(0, 500);
  return result;
}

function asProviderContent(response) {
  if (response && typeof response.content === 'string') return response.content;
  const choice = response && Array.isArray(response.choices) ? response.choices[0] : null;
  const content = choice && choice.message && choice.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part && typeof part.text === 'string' ? part.text : '').join('');
  throw new Error('provider returned no text content');
}

function usageTokens(response, content) {
  const usage = response && response.usage && typeof response.usage === 'object' ? response.usage : {};
  const explicit = Number(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.generated_tokens);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  return Math.max(1, Math.ceil(Buffer.byteLength(content, 'utf8') / 4));
}

class BudgetError extends Error {
  constructor(message = 'coordination budget exhausted') {
    super(message);
    this.code = 'coordination_budget_exceeded';
  }
}

class Coordinator {
  constructor({ root, engine, provider, runtimeDirectory } = {}) {
    if (!root || !engine || !provider) throw new TypeError('Coordinator requires root, engine, and provider');
    if (typeof engine.getState !== 'function' || typeof engine.getIndex !== 'function' || typeof engine.getSource !== 'function') throw new TypeError('engine must expose getState, getIndex, and getSource');
    if (typeof provider.complete !== 'function') throw new TypeError('provider must expose complete');
    this.root = fs.realpathSync(path.resolve(root));
    this.engine = engine;
    this.provider = provider;
    this.runtimeDirectory = path.resolve(runtimeDirectory || path.join(this.root, '.intentgraph', 'runtime'));
    if (!isInside(this.root, this.runtimeDirectory)) throw new Error('runtimeDirectory must be inside workspace');
    ensureConfinedDirectory(this.root, this.runtimeDirectory);
    this.statePath = path.join(this.runtimeDirectory, 'coordination.json');
    this.lockPath = path.join(this.runtimeDirectory, 'coordination.phase.lock');
    this.admissionPath = path.join(this.runtimeDirectory, 'coordination.admission.lock');
    this.instanceToken = `coord-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    this._preflightLocks();
    this._acquireOwnerLock();
    try {
      this.state = this._loadState();
      this.runs = new Map(this.state.runs.map((run) => [run.runId, run]));
      this.phaseQueue = Promise.resolve();
      this.admissionQueue = Promise.resolve();
      this.closed = false;
      this._recoverInterrupted();
    } catch (error) {
      this._releaseOwnedLock(this.admissionPath);
      throw error;
    }
  }

  _loadState() {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch { parsed = null; }
    if (!parsed || parsed.version !== STATE_VERSION || !Array.isArray(parsed.runs)) return { version: STATE_VERSION, runs: [] };
    return { version: STATE_VERSION, runs: parsed.runs.filter((run) => run && typeof run.runId === 'string') };
  }

  _persist() {
    this.state.runs = Array.from(this.runs.values()).map((run) => {
      const durable = clone(run);
      delete durable.abortController;
      delete durable.proposalPromise;
      delete durable.applyPromise;
      return durable;
    });
    atomicWrite(this.statePath, this.state);
  }

  _recoverInterrupted() {
    let changed = false;
    for (const run of this.runs.values()) {
      if (ACTIVE_STATES.has(run.status) || run.status === 'applying' || run.status === 'reviewing' || run.status === 'correction-building') {
        run.status = 'interrupted';
        run.interruptedAt = now();
        run.interruptedReason = 'service restarted during an active phase; manual resume required';
        run.updatedAt = run.interruptedAt;
        changed = true;
      }
    }
    if (changed) this._persist();
  }

  _preflightLocks() {
    this._clearStaleLock(this.lockPath);
    this._clearStaleLock(this.admissionPath);
  }

  _clearStaleLock(lockPath) {
    let lock;
    let raw;
    try { raw = fs.readFileSync(lockPath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; throw new Error(`coordination lock cannot be read: ${path.basename(lockPath)}`); }
    try { lock = JSON.parse(raw); } catch { throw new Error(`coordination lock is malformed: ${path.basename(lockPath)}`); }
    if (!lock || typeof lock !== 'object' || !Number.isInteger(Number(lock.pid)) || Number(lock.pid) <= 0 || typeof lock.instanceToken !== 'string' || !lock.instanceToken) throw new Error(`coordination lock is invalid: ${path.basename(lockPath)}`);
    if (Number(lock.pid) === process.pid) {
      throw new Error(`coordination lock is owned by a live local coordinator: ${path.basename(lockPath)}`);
    }
    try {
      process.kill(Number(lock.pid), 0);
    } catch (error) {
      if (error.code === 'ESRCH') { try { fs.rmSync(lockPath, { force: true }); } catch {} }
      else throw new Error(`coordination lock owner is unavailable: ${path.basename(lockPath)}`);
    }
  }

  _acquireOwnerLock() {
    let fd;
    try { fd = fs.openSync(this.admissionPath, 'wx'); }
    catch { throw new Error('another coordinator instance owns this runtime'); }
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, instanceToken: this.instanceToken, at: now(), kind: 'owner' }), 'utf8'); }
    catch (error) {
      try { fs.closeSync(fd); } catch {}
      throw error;
    }
    try { fs.closeSync(fd); } catch {}
  }

  _releaseOwnedLock(lockPath = this.lockPath) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (lock.instanceToken !== this.instanceToken) return;
    } catch { return; }
    try { fs.rmSync(lockPath, { force: true }); } catch {}
  }

  _activeRun() {
    return Array.from(this.runs.values()).find((run) => ACTIVE_STATES.has(run.status) || run.status === 'interrupted');
  }

  _getRun(runIdValue) {
    const value = requiredText(runIdValue, 'runId', 200);
    const run = this.runs.get(value);
    if (!run) throw new Error('run not found');
    return run;
  }

  _assertOpen() {
    if (this.closed) throw new Error('coordinator is closed');
  }

  _record(type, data = {}) {
    const payload = redactStructured({ type, ...data });
    if (typeof this.engine.recordEvent === 'function') {
      try { this.engine.recordEvent(payload); } catch {}
    }
  }

  _fail(run, error) {
    if (run.status === 'cancelled' || run.status === 'interrupted') return;
    run.status = error instanceof BudgetError || error.code === 'coordination_budget_exceeded' ? 'budget-exceeded' : 'failed';
    run.phase = run.status === 'budget-exceeded' ? 'budget' : 'error';
    run.error = safeError(error);
    run.updatedAt = now();
    this._persist();
    this._record('coordination.run.error', { runId: run.runId, taskId: run.taskId, error: safeError(error) });
  }

  _assertDuration(run) {
    const started = Date.parse(run.startedAt || run.createdAt || now());
    if (Number.isFinite(started) && Date.now() - started > MAX_DURATION_MS) throw new BudgetError('coordination duration budget exhausted');
  }

  _assertImmutable(run, context) {
    return this.engine.getState().then((state) => {
      const task = (state.tasks || []).find((item) => item.id === run.taskId);
      if (!task) throw new Error('task was removed while coordination was running');
      const baseline = (state.baselines || []).find((item) => item.id === run.snapshot.baselineId);
      if (!baseline) throw new Error('baseline was removed while coordination was running');
      const referencePaths = Array.isArray(baseline.referencePaths) ? baseline.referencePaths.map((value) => normalizeCandidatePath(value)) : [];
      const referenceHashes = this._referenceHashes(baseline, referencePaths);
      if (baseline.referenceHashes && JSON.stringify(referenceHashes) !== JSON.stringify(baseline.referenceHashes)) throw new Error(`baseline reference artifacts changed before ${context}`);
      const baselineHash = sha256(JSON.stringify(redactStructured({ id: baseline.id, title: baseline.title, intent: baseline.intent, criteria: baseline.criteria, referencePaths, referenceHashes, approved: Boolean(baseline.approved) })));
      if (baselineHash !== run.snapshot.baselineHash) throw new Error(`baseline changed before ${context}`);
      if (JSON.stringify(referenceHashes) !== JSON.stringify(run.snapshot.referenceHashes || {})) throw new Error(`baseline reference artifacts changed before ${context}`);
      if (Number(task.assignmentEpoch || 0) !== Number(run.snapshot.assignmentEpoch || 0)) throw new Error(`task assignments changed before ${context}`);
      for (const [role, field] of Object.entries(ROLE_FIELDS)) {
        if ((task[field] || null) !== (run.snapshot.assignments[field] || null)) throw new Error(`task assignments changed before ${context}`);
        const agent = (state.agents || []).find((item) => item.id === task[field]);
        if (!agent || agent.role !== ROLE_ASSIGNMENT_ROLES[role]) throw new Error(`${role} assignment changed before ${context}`);
      }
      const currentFiles = Array.isArray(task.files) ? task.files.map(normalizeCandidatePath) : [];
      if (JSON.stringify(currentFiles) !== JSON.stringify(run.snapshot.files)) throw new Error(`task file allowlist changed before ${context}`);
      return { state, task, baseline };
    });
  }

  _assertNotCancelled(run) {
    if (run.status === 'cancelled' || run.cancelledAt) throw new Error('run was cancelled');
    if (run.status === 'interrupted') throw new Error('run was interrupted; manual resume required');
  }

  _walkExistingPath(relativePath, options = {}) {
    const normalized = options.allowEvidence ? normalizeCandidatePath(relativePath) : normalizePath(relativePath);
    const parts = normalized.split('/');
    let current = this.root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!options.allowEvidence && DENIED_COMPONENTS.has(part.toLowerCase())) throw new Error('path targets a protected coordination area');
      if (options.allowEvidence && index === 0 && part.toLowerCase() !== '.intentgraph') throw new Error('evidence must stay under .intentgraph/evidence');
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) {
        if (options.allowEvidence && index === parts.length - 1 && error.code === 'ENOENT') return { absolute: current, normalized, missing: true };
        throw new Error('path does not exist');
      }
      if (stat.isSymbolicLink()) throw new Error('symlink or junction path component is not allowed');
      let real;
      try { real = fs.realpathSync(current); } catch { throw new Error('path realpath could not be verified'); }
      const resolvedCurrent = path.resolve(current);
      const samePath = process.platform === 'win32' ? real.toLowerCase() === resolvedCurrent.toLowerCase() : real === resolvedCurrent;
      if (!samePath || !isInside(this.root, real)) throw new Error('symlink or junction path component is not allowed');
    }
    return { absolute: current, normalized, missing: false };
  }

  async _readCandidate(relativePath) {
    const safe = this._walkExistingPath(relativePath);
    const stat = fs.statSync(safe.absolute);
    if (!stat.isFile()) throw new Error('task candidate must be an existing regular file');
    const buffer = fs.readFileSync(safe.absolute);
    if (buffer.includes(0)) throw new Error(`candidate file is not text: ${safe.normalized}`);
    if (isSecretPath(safe.normalized) || containsKeyPattern(buffer.toString('utf8'))) throw new Error(`candidate file contains a secret-like value: ${safe.normalized}`);
    return { path: safe.normalized, content: buffer.toString('utf8'), hash: contentHash(buffer.toString('utf8')), bytes: buffer.length };
  }

  _referenceHashes(baseline, paths) {
    const result = {};
    for (const relativePath of paths) {
      if (isSecretPath(relativePath)) throw new Error(`baseline reference is a secret path: ${relativePath}`);
      try {
        if (typeof this.engine.readEvidenceFile === 'function') {
          result[relativePath] = this.engine.readEvidenceFile(relativePath).hash;
          continue;
        }
        const allowEvidence = relativePath.toLowerCase().startsWith('.intentgraph/evidence/');
        const safe = this._walkExistingPath(relativePath, { allowEvidence });
        if (safe.missing) throw new Error('reference does not exist');
        const stat = fs.statSync(safe.absolute);
        if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('reference is not a bounded regular file');
        result[relativePath] = sha256(fs.readFileSync(safe.absolute));
      } catch (error) {
        throw new Error(`baseline reference is not readable: ${relativePath}`);
      }
    }
    return result;
  }

  async _snapshotTask(task, baseline, state) {
    const files = Array.isArray(task.files) ? task.files.map(normalizeCandidatePath) : [];
    if (files.length < 1 || files.length > MAX_FILES) throw new Error(`task must contain between 1 and ${MAX_FILES} candidate files`);
    const unique = Array.from(new Set(files));
    if (unique.length !== files.length) throw new Error('task candidate files must be unique');
    if (unique.some((file) => DENIED_COMPONENTS.has(file.split('/')[0].toLowerCase()) || file.split('/').some((part) => DENIED_COMPONENTS.has(part.toLowerCase())))) throw new Error('task contains a protected candidate path');
    const sources = [];
    let total = 0;
    for (const file of unique) {
      const source = await this._readCandidate(file);
      const indexed = await this.engine.getSource(file);
      if (!indexed || typeof indexed.content !== 'string') throw new Error(`candidate file is not an indexed text source: ${file}`);
      if (indexed.content !== source.content) throw new Error(`candidate source changed while taking snapshot: ${file}`);
      total += source.bytes;
      if (total > MAX_INPUT_BYTES) throw new Error(`task candidate sources exceed ${MAX_INPUT_BYTES} bytes`);
      sources.push(source);
    }
    const assignments = {};
    for (const field of Object.values(ROLE_FIELDS)) {
      const value = task[field] || null;
      if (!value || typeof value !== 'string') throw new Error(`task assignment ${field} is required`);
      assignments[field] = value;
    }
    if (new Set(Object.values(assignments)).size !== Object.values(assignments).length) throw new Error('planner, builder, reviewer, and acceptance assignments must be distinct');
    for (const [role, field] of Object.entries(ROLE_FIELDS)) {
      const agent = (state.agents || []).find((item) => item.id === assignments[field]);
      if (!agent || agent.role !== ROLE_ASSIGNMENT_ROLES[role]) throw new Error(`${field} must reference a registered ${ROLE_ASSIGNMENT_ROLES[role]} agent`);
    }
    const referencePaths = Array.isArray(baseline.referencePaths) ? baseline.referencePaths.map((value) => normalizeCandidatePath(value)) : [];
    const referenceHashes = this._referenceHashes(baseline, referencePaths);
    if (baseline.referenceHashes && JSON.stringify(referenceHashes) !== JSON.stringify(baseline.referenceHashes)) throw new Error('baseline reference artifacts changed since approval');
    const baselineView = redactStructured({ id: baseline.id, title: baseline.title, intent: baseline.intent, criteria: baseline.criteria, referencePaths, referenceHashes, approved: Boolean(baseline.approved) });
    if (!baselineView.approved) throw new Error('baseline must be explicitly approved before coordination');
    if (!Array.isArray(baselineView.criteria) || baselineView.criteria.length === 0 || baselineView.criteria.some((item) => !item || typeof item.id !== 'string')) throw new Error('baseline criteria are required');
    const baselineHash = sha256(JSON.stringify(baselineView));
    return {
      baselineId: baseline.id,
      baseline: baselineView,
      originalBaseline: clone(baselineView),
      baselineHash,
      referenceHashes,
      criteria: clone(baselineView.criteria),
      assignments,
      assignmentEpoch: Number(task.assignmentEpoch || 0),
      files: unique,
      sources: sources.map((source) => ({ path: source.path, content: source.content, hash: source.hash, bytes: source.bytes }))
    };
  }

  status() {
    let providerStatus = null;
    try { providerStatus = typeof this.provider.status === 'function' ? clone(this.provider.status()) : null; } catch { providerStatus = null; }
    return {
      activeRunId: (this._activeRun() || {}).runId || null,
      budget: { maxCalls: MAX_CALLS, maxOutputTokens: MAX_OUTPUT_TOKENS, maxDurationMs: MAX_DURATION_MS },
      provider: providerStatus,
      runs: clone(Array.from(this.runs.values()).map((run) => ({ ...run, id: run.runId, model: 'mimo-v2.5', abortController: undefined, proposalPromise: undefined, applyPromise: undefined })))
    };
  }

  async start({ taskId } = {}) {
    const operation = this.admissionQueue.then(() => this._start({ taskId }), () => this._start({ taskId }));
    this.admissionQueue = operation.catch(() => undefined);
    return operation;
  }

  async _start({ taskId } = {}) {
    this._assertOpen();
    const value = requiredText(taskId, 'taskId', 200);
    if (this._activeRun()) throw new Error('another coordination run is already active');
    const durable = this._loadState();
    if (durable.runs.some((item) => ACTIVE_STATES.has(item.status) || item.status === 'interrupted')) throw new Error('another coordination run is already active');
    const state = await this.engine.getState();
    const task = (state.tasks || []).find((item) => item.id === value);
    if (!task) throw new Error('task not found');
    const baseline = (state.baselines || []).find((item) => item.id === task.baselineId);
    if (!baseline) throw new Error('task baseline not found');
    const snapshot = await this._snapshotTask(task, baseline, state);
    const createdAt = now();
    const run = {
      runId: runId(), taskId: value, status: 'planning', phase: 'planning', round: 0,
      createdAt, startedAt: createdAt, updatedAt: createdAt, snapshot,
      calls: 0, outputTokens: 0, providerCalls: [], feedback: [], reviews: [],
      proposal: null, pendingProposal: null, plan: null, appliedVersions: [],
      sessionIds: {}, evidencePaths: [], engineEvidenceByRound: [],
      abortController: undefined
    };
    delete run.abortController;
    run.sessionIds.planner = `${run.runId}:planner`;
    run.sessionIds.builder = `${run.runId}:builder`;
    run.sessionIds.engineer = `${run.runId}:engineer`;
    run.sessionIds.experience = `${run.runId}:experience`;
    this.runs.set(run.runId, run);
    this._persist();
    this._record('coordination.run.start', { runId: run.runId, taskId: run.taskId, baselineId: snapshot.baselineId, files: snapshot.files, criteria: snapshot.criteria.map((item) => item.id) });
    run.abortController = new AbortController();
    run.proposalPromise = this._runPlanning(run).catch((error) => { this._fail(run, error); return null; });
    return { runId: run.runId, status: run.status };
  }

  async _withPhase(run, phase, operation) {
    const execute = async () => {
      this._assertOpen();
      this._assertNotCancelled(run);
      this._assertDuration(run);
      let fd;
      let ownsLock = false;
      try {
        fd = fs.openSync(this.lockPath, 'wx');
        ownsLock = true;
        fs.writeFileSync(fd, JSON.stringify({ runId: run.runId, phase, pid: process.pid, instanceToken: this.instanceToken, at: now() }), 'utf8');
        run.phase = phase;
        run.updatedAt = now();
        this._persist();
        this._record('coordination.phase.start', { runId: run.runId, taskId: run.taskId, phase, round: run.round });
        const result = await operation();
        this._record('coordination.phase.complete', { runId: run.runId, taskId: run.taskId, phase, round: run.round });
        return result;
      } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
        if (ownsLock) this._releaseOwnedLock();
      }
    };
    const result = this.phaseQueue.then(execute, execute);
    this.phaseQueue = result.catch(() => undefined);
    return result;
  }

  async _call(run, role, messages, maxTokens = 4096) {
    this._assertNotCancelled(run);
    this._assertDuration(run);
    if (run.calls >= MAX_CALLS || run.outputTokens >= MAX_OUTPUT_TOKENS) throw new BudgetError();
    const remaining = MAX_OUTPUT_TOKENS - run.outputTokens;
    const requested = Math.max(1, Math.min(Number(maxTokens) || 1, remaining));
    const sessionId = run.sessionIds[role] || `${run.runId}:${role}`;
    run.sessionIds[role] = sessionId;
    const callNumber = run.calls + 1;
    this._record('coordination.provider.call.start', { runId: run.runId, role, callNumber, sessionId, model: 'mimo-v2.5' });
    let response;
    try {
      response = await this.provider.complete({ messages, sessionId, maxTokens: requested, signal: run.abortController && run.abortController.signal });
    } catch (error) {
      run.calls = callNumber;
      run.providerCalls.push({ role, callNumber, sessionId, ok: false, error: safeError(error), at: now() });
      this._persist();
      this._record('coordination.provider.call.error', { runId: run.runId, role, callNumber, sessionId, error: safeError(error) });
      throw error;
    }
    const content = asProviderContent(response);
    const outputTokens = usageTokens(response, content);
    run.calls = callNumber;
    run.outputTokens += outputTokens;
    run.providerCalls.push({ role, callNumber, sessionId, ok: true, outputTokens, at: now() });
    this._persist();
    this._record('coordination.provider.call.complete', { runId: run.runId, role, callNumber, sessionId, outputTokens });
    if (run.outputTokens > MAX_OUTPUT_TOKENS) throw new BudgetError();
    return content;
  }

  _sourcePrompt(run, sources) {
    return sources.map((source) => ({ path: source.path, baseHash: source.hash, content: source.content }));
  }

  _baseMessages(run, role, extra = {}) {
    const task = {
      role,
      originalIntent: run.snapshot.baseline.intent || '',
      criteria: run.snapshot.criteria,
      files: run.snapshot.files,
      ...extra
    };
    return [
      { role: 'system', content: `You are the ${role} role in a bounded IntentGraph run. Preserve the original intent and criteria. Work only with the listed existing text files. Do not request, reveal, invent, or include secrets, credentials, runtime files, .intentgraph files, shell commands, tools, or network actions. Return only the requested response shape.` },
      { role: 'user', content: JSON.stringify(redactStructured(task)) }
    ];
  }

  async _runPlanning(run) {
    await this._withPhase(run, 'planning', async () => {
      await this._assertImmutable(run, 'planner model phase');
      const plannerInput = this._baseMessages(run, 'planner', { operation: 'plan', source: this._sourcePrompt(run, run.snapshot.sources) });
      const plannerContent = await this._call(run, 'planner', plannerInput, 4096);
      run.plan = parsePlan(plannerContent);
      run.status = 'building';
      run.phase = 'building';
      run.updatedAt = now();
      this._persist();
      await this._assertImmutable(run, 'builder model phase');
      const builderInput = this._baseMessages(run, 'builder', { operation: 'proposal', plan: run.plan, source: this._sourcePrompt(run, run.snapshot.sources), responseSchema: { summary: 'string', files: [{ path: 'string', baseHash: 'sha256', content: 'string' }] } });
      const builderContent = await this._call(run, 'builder', builderInput, 8192);
      const baseHashes = Object.fromEntries(run.snapshot.sources.map((source) => [source.path, source.hash]));
      const proposal = parseBuilderProposal(builderContent, run.snapshot.files, baseHashes);
      run.proposal = proposal;
      run.pendingProposal = proposal;
      run.status = 'awaiting-apply';
      run.phase = 'awaiting-apply';
      run.updatedAt = now();
      this._persist();
      this._record('coordination.proposal.ready', { runId: run.runId, taskId: run.taskId, round: run.round, files: proposal.files.map((file) => ({ path: file.path, baseHash: file.baseHash, contentHash: contentHash(file.content) })) });
    });
    return run.pendingProposal;
  }

  _currentProposalHash(proposal) {
    return sha256(JSON.stringify(proposal.files.map((file) => ({ path: file.path, baseHash: file.baseHash, contentHash: contentHash(file.content) }))));
  }

  async _writeProposal(run, proposal) {
    await this._assertImmutable(run, 'apply');
    const files = [];
    let total = 0;
    for (const item of proposal.files) {
      const safe = this._walkExistingPath(item.path);
      const stat = fs.statSync(safe.absolute);
      if (!stat.isFile()) throw new Error(`proposal target is not a regular file: ${item.path}`);
      const current = fs.readFileSync(safe.absolute);
      if (current.includes(0)) throw new Error(`proposal target is not text: ${item.path}`);
      const currentHash = contentHash(current.toString('utf8'));
      if (currentHash !== item.baseHash) throw new Error(`proposal CAS is stale for ${item.path}`);
      if (Buffer.byteLength(item.content, 'utf8') > MAX_PROPOSAL_FILE_BYTES) throw new Error(`proposal file exceeds ${MAX_PROPOSAL_FILE_BYTES} bytes: ${item.path}`);
      total += Buffer.byteLength(item.content, 'utf8');
      if (total > MAX_INPUT_BYTES) throw new Error('proposal output exceeds total file size cap');
      files.push({ ...item, absolute: safe.absolute, before: current.toString('utf8'), beforeHash: currentHash });
    }
    await this._assertImmutable(run, 'apply writes');
    const written = [];
    try {
      for (const file of files) {
        const check = this._walkExistingPath(file.path);
        if (check.absolute !== file.absolute) throw new Error('proposal path changed while applying');
        const current = fs.readFileSync(file.absolute);
        if (contentHash(current.toString('utf8')) !== file.beforeHash) throw new Error(`proposal CAS changed before write for ${file.path}`);
        atomicWrite(file.absolute, file.content);
        written.push(file);
      }
    } catch (error) {
      for (const file of written.reverse()) {
        try {
          const check = this._walkExistingPath(file.path);
          if (check.absolute === file.absolute) atomicWrite(file.absolute, file.before);
        } catch {}
      }
      throw error;
    }
    if (typeof this.engine.refresh === 'function') {
      try { await this.engine.refresh('coordination.apply'); } catch {}
    }
    const applied = { round: run.round, proposalHash: this._currentProposalHash(proposal), files: files.map((file) => ({ path: file.path, beforeHash: file.beforeHash, afterHash: contentHash(file.content) })), at: now() };
    run.appliedVersions.push(applied);
    run.pendingProposal = null;
    run.proposal = proposal;
    this._persist();
    for (const file of applied.files) this._record('coordination.file.applied', { runId: run.runId, round: run.round, path: file.path, beforeHash: file.beforeHash, afterHash: file.afterHash });
    return applied;
  }

  async _currentSources(run) {
    const sources = [];
    for (const file of run.snapshot.files) {
      const source = await this._readCandidate(file);
      const indexed = await this.engine.getSource(file);
      if (!indexed || indexed.content !== source.content) throw new Error(`source is unavailable for review: ${file}`);
      sources.push(source);
    }
    return sources;
  }

  _hasVisualReferences(run) {
    const references = run.snapshot.baseline && run.snapshot.baseline.referencePaths;
    return Array.isArray(references) && references.length > 0;
  }

  async _reviewRole(run, role, sources) {
    await this._assertImmutable(run, `${role} review`);
    const responseSchema = { outcome: 'pass|fail|unverified', criteria: run.snapshot.criteria.map((item) => item.id), findings: ['string'] };
    const content = await this._call(run, role, this._baseMessages(run, role, { operation: 'review', source: this._sourcePrompt(run, sources), responseSchema, round: run.round, proposal: run.proposal ? { summary: run.proposal.summary, files: run.proposal.files.map((file) => ({ path: file.path, baseHash: file.baseHash, contentHash: contentHash(file.content) })) } : null, feedback: run.feedback.map((item) => item.text) }), 4096);
    let review;
    try { review = parseReviewResponse(content, run.snapshot.criteria.map((item) => item.id)); }
    catch (error) { review = { outcome: 'unverified', criteria: [], findings: [`invalid ${role} review response`], parseError: safeError(error) }; }
    const allCriteria = run.snapshot.criteria.map((item) => item.id);
    if (review.outcome === 'pass' && new Set(review.criteria).size !== allCriteria.length) {
      review = { ...review, outcome: 'unverified', findings: Array.from(new Set(review.findings.concat('review did not cover every baseline criterion'))) };
    }
    if (role === 'experience' && review.outcome === 'pass' && this._hasVisualReferences(run)) {
      review = { ...review, outcome: 'unverified', findings: Array.from(new Set(review.findings.concat('visual references were not inspected by this coordinator'))) };
    }
    const record = { role, actorId: run.snapshot.assignments[ROLE_FIELDS[role]], round: run.round, outcome: review.outcome, criteria: review.criteria, findings: review.findings, at: now() };
    run.reviews.push(record);
    this._persist();
    this._record('coordination.review', { runId: run.runId, role, actorId: record.actorId, round: record.round, outcome: record.outcome, criteria: record.criteria, findings: record.findings });
    return record;
  }

  async _writeReviewEvidence(run) {
    const relative = `.intentgraph/evidence/${run.runId}-review.json`;
    const graphDir = path.join(this.root, '.intentgraph');
    const evidenceDir = path.join(graphDir, 'evidence');
    for (const directory of [graphDir, evidenceDir]) {
      try {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('evidence directory is not a regular directory');
        const real = fs.realpathSync(directory);
        if (!isInside(this.root, real)) throw new Error('evidence directory escapes workspace');
      } catch (error) {
        if (error.code === 'ENOENT') fs.mkdirSync(directory);
        else throw error;
      }
    }
    const target = this._walkExistingPath(relative, { allowEvidence: true });
    const evidence = {
      runId: run.runId, taskId: run.taskId, baselineId: run.snapshot.baselineId,
      criteria: run.snapshot.criteria.map((item) => item.id), round: run.round,
      reviews: run.reviews.filter((review) => review.round === run.round).map((review) => ({ role: review.role, actorId: review.actorId, outcome: review.outcome, criteria: review.criteria, findings: review.findings })),
      applied: run.appliedVersions[run.appliedVersions.length - 1] || null,
      generatedAt: now()
    };
    atomicWrite(target.absolute, evidence);
    if (!run.evidencePaths.includes(relative)) run.evidencePaths.push(relative);
    this._persist();
    this._record('coordination.evidence', { runId: run.runId, path: relative, round: run.round });
    return relative;
  }

  async _reviewRound(run) {
    run.status = 'reviewing';
    run.phase = 'reviewing';
    run.updatedAt = now();
    this._persist();
    const sources = await this._currentSources(run);
    const roles = ['engineer', 'planner', 'experience'];
    const results = [];
    for (const role of roles) {
      this._assertNotCancelled(run);
      results.push(await this._reviewRole(run, role, sources));
    }
    await this._writeReviewEvidence(run);
    await this._submitEngineReviews(run, results);
    const failed = results.filter((result) => result.outcome === 'fail');
    const unverified = results.filter((result) => result.outcome === 'unverified');
    if (unverified.length) {
      run.status = 'blocked-unverified';
      run.phase = 'review-complete';
      run.updatedAt = now();
      this._persist();
      return { status: run.status, reviews: results };
    }
    if (!failed.length) {
      run.status = 'awaiting-owner';
      run.phase = 'review-complete';
      run.updatedAt = now();
      this._persist();
      return { status: run.status, reviews: results };
    }
    if (run.round >= MAX_CORRECTIONS) {
      run.status = 'failed-review';
      run.phase = 'review-complete';
      run.updatedAt = now();
      this._persist();
      return { status: run.status, reviews: results };
    }
    run.round += 1;
    run.status = 'correction-building';
    run.phase = 'correction-building';
    run.updatedAt = now();
    this._persist();
    await this._assertImmutable(run, 'correction builder model phase');
    const correctionSources = await this._currentSources(run);
    const findings = failed.flatMap((result) => result.findings).slice(0, 100);
    const correctionContent = await this._call(run, 'builder', this._baseMessages(run, 'builder', { operation: 'correction-proposal', correctionRound: run.round, priorProposal: run.proposal ? { summary: run.proposal.summary, files: run.proposal.files.map((file) => ({ path: file.path, baseHash: file.baseHash, content: file.content })) } : null, findings, source: this._sourcePrompt(run, correctionSources), responseSchema: { summary: 'string', files: [{ path: 'string', baseHash: 'sha256', content: 'string' }] } }), 8192);
    const currentHashes = Object.fromEntries(correctionSources.map((source) => [source.path, source.hash]));
    run.pendingProposal = parseBuilderProposal(correctionContent, run.snapshot.files, currentHashes);
    run.proposal = run.pendingProposal;
    run.status = 'awaiting-apply';
    run.phase = 'awaiting-apply';
    run.updatedAt = now();
    this._persist();
    this._record('coordination.proposal.ready', { runId: run.runId, taskId: run.taskId, round: run.round, files: run.pendingProposal.files.map((file) => ({ path: file.path, baseHash: file.baseHash, contentHash: contentHash(file.content) })) });
    return { status: run.status, proposal: clone(run.pendingProposal), reviews: results };
  }

  async _submitEngineReviews(run, results) {
    run.engineEvidenceByRound = Array.isArray(run.engineEvidenceByRound) ? run.engineEvidenceByRound : [];
    if (typeof this.engine.action !== 'function' || run.engineEvidenceByRound.some((item) => item.round === run.round)) return;
    const evidencePath = run.evidencePaths[run.evidencePaths.length - 1];
    if (!evidencePath) return;
    try {
      if (typeof this.engine.refresh === 'function') await this.engine.refresh('coordination.review-evidence');
      const evidenceResult = await this.engine.action({
        type: 'evidence.add', taskId: run.taskId,
        actorId: run.snapshot.assignments.reviewerId,
        path: evidencePath,
        criteria: run.snapshot.criteria.map((item) => item.id)
      });
      const evidence = evidenceResult && evidenceResult.evidence;
      if (!evidence || !evidence.id) throw new Error('engine did not return review evidence');
      const reviewIds = [];
      const kinds = { engineer: 'engineering', planner: 'planning', experience: 'experience' };
      for (const review of results) {
        const criteria = review.criteria.length ? review.criteria : run.snapshot.criteria.map((item) => item.id);
        const result = await this.engine.action({
          type: 'review.add', taskId: run.taskId, actorId: review.actorId,
          kind: kinds[review.role], outcome: review.outcome, criteria, evidenceIds: [evidence.id],
          notes: `source-review: ${review.findings.join(' ').slice(0, 9000)}`
        });
        if (result && result.review && result.review.id) reviewIds.push(result.review.id);
      }
      run.engineEvidenceByRound.push({ round: run.round, path: evidencePath, evidenceId: evidence.id, reviewIds, at: now() });
      run.engineReviewPending = null;
      this._persist();
      this._record('coordination.engine-review.submitted', { runId: run.runId, round: run.round, path: evidencePath, evidenceId: evidence.id, reviewIds, provenance: 'source-review' });
    } catch (error) {
      run.engineReviewPending = {
        round: run.round,
        path: evidencePath,
        error: safeError(error),
        provenance: 'source-review',
        at: now()
      };
      run.updatedAt = now();
      this._persist();
      this._record('coordination.engine-review.pending', { runId: run.runId, round: run.round, path: evidencePath, error: safeError(error), provenance: 'source-review' });
    }
  }

  async apply({ runId: runIdValue } = {}) {
    this._assertOpen();
    const run = this._getRun(runIdValue);
    if (run.status === 'awaiting-owner' || run.status === 'blocked-unverified' || run.status === 'failed-review' || run.status === 'failed' || run.status === 'budget-exceeded' || run.status === 'cancelled') return { runId: run.runId, status: run.status, idempotent: true, applied: clone(run.appliedVersions) };
    if (run.applyPromise) return run.applyPromise;
    run.applyPromise = (async () => {
      if (run.proposalPromise) await run.proposalPromise;
      if (run.status === 'interrupted') throw new Error('run was interrupted; resume is required before apply');
      if (run.status !== 'awaiting-apply' || !run.pendingProposal) throw new Error('run has no proposal awaiting explicit apply');
      return this._withPhase(run, 'applying', async () => {
        await this._assertImmutable(run, 'apply');
        const proposal = parseBuilderProposal(run.pendingProposal, run.snapshot.files, Object.fromEntries((await this._currentSources(run)).map((source) => [source.path, source.hash])));
        await this._writeProposal(run, proposal);
        run.status = 'reviewing';
        run.phase = 'reviewing';
        run.updatedAt = now();
        this._persist();
        const result = await this._reviewRound(run);
        return { runId: run.runId, status: result.status, applied: clone(run.appliedVersions[run.appliedVersions.length - 1]), proposal: result.proposal || null, reviews: clone(result.reviews || []) };
      });
    })().catch((error) => {
      if (error instanceof BudgetError || error.code === 'coordination_budget_exceeded') {
        run.status = 'budget-exceeded';
        run.phase = 'budget';
      } else if (run.status !== 'cancelled') {
        run.status = 'failed';
        run.phase = 'error';
      }
      run.error = safeError(error);
      run.updatedAt = now();
      this._persist();
      this._record('coordination.run.error', { runId: run.runId, taskId: run.taskId, error: safeError(error) });
      throw error;
    }).finally(() => { delete run.applyPromise; });
    return run.applyPromise;
  }

  async resume({ runId: runIdValue } = {}) {
    this._assertOpen();
    const run = this._getRun(runIdValue);
    if (run.status !== 'interrupted') return { runId: run.runId, status: run.status, idempotent: true };
    await this._assertImmutable(run, 'resume');
    this._assertDuration(run);
    run.interruptedAt = null;
    run.interruptedReason = null;
    if (run.pendingProposal) {
      run.status = 'awaiting-apply';
      run.phase = 'awaiting-apply';
      run.updatedAt = now();
      this._persist();
      this._record('coordination.run.resume', { runId: run.runId, mode: 'awaiting-explicit-apply' });
      return { runId: run.runId, status: run.status, replayed: false };
    }
    run.status = 'resumable';
    run.phase = 'manual-resume-required';
    run.updatedAt = now();
    this._persist();
    this._record('coordination.run.resume', { runId: run.runId, mode: 'manual-restart-required' });
    return { runId: run.runId, status: run.status, replayed: false };
  }

  async cancel({ runId: runIdValue } = {}) {
    this._assertOpen();
    const run = this._getRun(runIdValue);
    if (run.status === 'cancelled') return { runId: run.runId, status: run.status, idempotent: true };
    if (TERMINAL_STATES.has(run.status) && run.status !== 'interrupted') return { runId: run.runId, status: run.status, idempotent: true };
    run.cancelledAt = now();
    run.status = 'cancelled';
    run.phase = 'cancelled';
    run.updatedAt = run.cancelledAt;
    try { run.abortController?.abort(); } catch {}
    this._persist();
    this._record('coordination.run.cancel', { runId: run.runId, taskId: run.taskId });
    return { runId: run.runId, status: run.status };
  }

  async feedback({ runId: runIdValue, text: value } = {}) {
    this._assertOpen();
    const run = this._getRun(runIdValue);
    const feedback = requiredText(value, 'feedback', 8 * 1024);
    if (containsKeyPattern(feedback)) throw new Error('feedback contains a key-like value');
    const item = { text: redactText(feedback), at: now() };
    run.feedback.push(item);
    run.feedback = run.feedback.slice(-100);
    run.updatedAt = item.at;
    this._persist();
    this._record('coordination.feedback', { runId: run.runId, text: item.text });
    return { runId: run.runId, feedback: clone(item), status: run.status };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const run of this.runs.values()) {
      if (ACTIVE_STATES.has(run.status) || run.status === 'applying' || run.status === 'reviewing' || run.status === 'correction-building') {
        try { run.abortController?.abort(); } catch {}
        run.status = 'interrupted';
        run.phase = 'interrupted';
        run.interruptedAt = now();
        run.interruptedReason = 'coordinator closed during an active phase; manual resume required';
        run.updatedAt = run.interruptedAt;
      }
    }
    this._releaseOwnedLock(this.lockPath);
    this._persist();
    this._releaseOwnedLock(this.admissionPath);
  }
}

module.exports = {
  Coordinator,
  BudgetError,
  MAX_FILES,
  MAX_INPUT_BYTES,
  MAX_CALLS,
  MAX_OUTPUT_TOKENS,
  MAX_DURATION_MS,
  MAX_CORRECTIONS
};
