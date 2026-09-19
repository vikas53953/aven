'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  MAX_FILE_BYTES,
  atomicWrite,
  isInside,
  isIgnoredResolvedPath,
  isSecretPath,
  normalizeRelative,
  sha256
} = require('./indexer.cjs');

const STATE_KEYS = ['agents', 'tasks', 'baselines', 'evidence', 'reviews', 'events', 'gateDecisions'];
const MAX_EVENTS = 500;
const MAX_GATE_DECISIONS = 100;
const MAX_MESSAGES = 500;
const SAFE_ARTIFACT_EXTENSIONS = new Set(['.png', '.json', '.md', '.txt', '.html', '.htm']);
const ROLES = new Set(['orchestrator', 'planner', 'builder', 'reviewer', 'acceptance']);
const TASK_STATES = new Set(['assigned', 'reading', 'editing', 'awaiting-review', 'reviewing', 'blocked', 'completed']);
const REVIEW_KINDS = new Set(['planning', 'engineering', 'experience']);

function now() { return new Date().toISOString(); }

function idFor(prefix) {
  return `${prefix}:${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function requireText(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalText(value, name, max = 20000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text`);
  return value;
}

function arrayOfText(value, name, max = 100) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)) throw new Error(`${name} must be a bounded string array`);
  return value.map((item) => item.trim());
}

function criteriaArray(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error('criteria must be a nonempty array');
  const seen = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`criteria[${index}] must be an object`);
    const id = requireText(item.id, `criteria[${index}].id`, 100);
    const text = requireText(item.text, `criteria[${index}].text`, 2000);
    if (seen.has(id)) throw new Error(`duplicate criterion ${id}`);
    seen.add(id);
    return { id, text };
  });
}

function normalizeFileList(value) {
  return Array.from(new Set(arrayOfText(value, 'files', 250).map(normalizeRelative).filter(Boolean)));
}

function unique(values) { return Array.from(new Set(values)); }

class IntentEngine {
  constructor(root, indexer, runtimeDirectory) {
    this.root = fs.realpathSync(root);
    this.indexer = indexer;
    this.runtimeDirectory = runtimeDirectory || path.join(this.root, '.intentgraph', 'runtime');
    this.statePath = path.join(this.runtimeDirectory, 'state.json');
    this.eventsPath = path.join(this.runtimeDirectory, 'events.jsonl');
    this.queue = Promise.resolve();
    this.listeners = new Set();
    this.state = this.loadState();
    this.indexer.onRefresh = (result) => this.onIndexRefresh(result);
  }

  loadState() {
    let state;
    try { state = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch { state = {}; }
    const result = {};
    for (const key of STATE_KEYS) result[key] = Array.isArray(state[key]) ? state[key] : [];
    // Older development runs could have recorded the initial index population
    // as file changes. Startup indexing is silent, so discard only those
    // explicitly marked synthetic records while preserving real watch events.
    result.events = result.events.filter((event) => !(event.type === 'file.change' && event.reason === 'startup'));
    return result;
  }

  persistState() {
    for (const key of STATE_KEYS) {
      if (!Array.isArray(this.state[key])) this.state[key] = [];
    }
    this.state.events = this.state.events.slice(-MAX_EVENTS);
    this.state.gateDecisions = this.state.gateDecisions.slice(-MAX_GATE_DECISIONS);
    atomicWrite(this.statePath, this.state);
    const eventLines = this.state.events.slice(-MAX_EVENTS).map((event) => JSON.stringify(event)).join('\n');
    atomicWrite(this.eventsPath, eventLines ? `${eventLines}\n` : '');
  }

  onIndexRefresh(result) {
    if (!result || result.reason === 'startup' || !result.changedPaths || result.changedPaths.length === 0) return;
    for (const changedPath of result.changedPaths) {
      this.recordEvent({
        type: 'file.change',
        path: changedPath,
        actorId: null,
        attribution: 'UNATTRIBUTED',
        selfReported: false,
        provenance: 'filesystem-watch',
        reason: result.reason || 'rescan'
      }, false);
    }
    this.persistState();
    this.notify({ type: 'refresh', revision: result.index && result.index.revision, changedPaths: result.changedPaths, reason: result.reason || 'rescan' });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(payload) {
    for (const listener of this.listeners) {
      try { listener(clone(payload)); } catch {}
    }
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  initialize() {
    return this.enqueue(async () => {
      this.indexer.load();
      // Reconcile persisted state with the real filesystem before the service
      // becomes observable. Startup reconciliation is intentionally silent;
      // it must not manufacture an attributed activity event.
      this.indexer.scan({ reason: 'startup' });
      this.persistState();
      return this.indexer.index;
    });
  }

  refresh(reason = 'rescan') {
    return this.enqueue(async () => this.indexer.scan({ reason }));
  }

  getState() {
    return this.enqueue(async () => clone(this.state));
  }

  getIndex() {
    return this.enqueue(async () => clone(this.indexer.index));
  }

  getSource(relativePath) {
    return this.enqueue(async () => this.indexer.getSource(relativePath));
  }

  getDiff(relativePath) {
    return this.enqueue(async () => this.indexer.getDiff(relativePath));
  }

  getCapabilities() {
    return { ai: { connected: false, provider: null, model: null }, runtime: { dispatch: false, shell: false, device: false } };
  }

  getGate(taskId) {
    return this.enqueue(async () => {
      this.indexer.scan({ reason: 'gate-refresh' });
      const decision = this.evaluateGateLocked(taskId, true);
      return { allowed: decision.allowed, reasons: decision.reasons, revision: decision.revision };
    });
  }

  action(input) {
    return this.enqueue(async () => {
      this.indexer.scan({ reason: 'action-refresh' });
      const result = this.performAction(input || {});
      this.persistState();
      return result;
    });
  }

  recordEvent(input, persist = true) {
    const event = {
      id: idFor('event'),
      at: now(),
      ...input
    };
    event.timestamp = event.at;
    this.state.events.push(event);
    this.state.events = this.state.events.slice(-MAX_EVENTS);
    this.notify(event);
    if (persist) this.persistState();
    return event;
  }

  findAgent(id) { return this.state.agents.find((agent) => agent.id === id); }
  findTask(id) { return this.state.tasks.find((task) => task.id === id); }
  findBaseline(id) { return this.state.baselines.find((baseline) => baseline.id === id); }

  currentSnapshotHash() {
    const files = (this.indexer.index && this.indexer.index.files || []).map((file) => ({ path: file.path, hash: file.hash, bytes: file.bytes }));
    return sha256(JSON.stringify(files));
  }

  currentArtifactHash(task) {
    const byPath = new Map((this.indexer.index && this.indexer.index.files || []).map((file) => [file.path, file]));
    const files = normalizeFileList(task.files).map((filePath) => {
      const file = byPath.get(filePath);
      return { path: filePath, hash: file ? file.hash : null, bytes: file ? file.bytes : null };
    });
    return sha256(JSON.stringify(files));
  }

  currentEvidenceHash(task, validOnly = false) {
    let records = this.state.evidence.filter((item) => item.taskId === task.id);
    if (validOnly) records = records.filter((item) => this.isEvidenceCurrent(item, task));
    const simplified = records.map((item) => ({ id: item.id, path: item.path, hash: item.contentHash, criteria: item.criteria, baselineId: item.baselineId, revision: item.revision, artifactHash: item.artifactHash })).sort((a, b) => a.id.localeCompare(b.id));
    return sha256(JSON.stringify(simplified));
  }

  referenceHashes(paths) {
    return Object.fromEntries(normalizeFileList(paths || []).map((relativePath) => {
      try { return [relativePath, this.readEvidenceFile(relativePath).hash]; }
      catch { return [relativePath, null]; }
    }));
  }

  assertKnownCandidateFiles(paths) {
    const known = new Set((this.indexer.index && this.indexer.index.files || []).map((file) => file.path));
    for (const relativePath of normalizeFileList(paths || [])) {
      if (!known.has(relativePath)) throw new Error(`candidate file is not an indexed workspace file: ${relativePath}`);
    }
  }

  isEvidenceCurrent(evidence, task) {
    if (evidence.taskId !== task.id || evidence.baselineId !== task.baselineId || Number(evidence.assignmentEpoch || 0) !== Number(task.assignmentEpoch || 0)) return false;
    if (evidence.revision !== this.indexer.index.revision || evidence.artifactHash !== this.currentArtifactHash(task)) return false;
    try {
      const current = this.readEvidenceFile(evidence.path);
      return current.hash === evidence.contentHash;
    } catch { return false; }
  }

  readEvidenceFile(relativePath) {
    const normalized = normalizeRelative(relativePath);
    if (!normalized || normalized.startsWith('../') || normalized.includes('/../') || isSecretPath(normalized)) throw new Error('evidence path is not allowed');
    const absolute = path.resolve(this.root, normalized);
    if (!isInside(this.root, absolute)) throw new Error('evidence path escapes workspace');
    const real = fs.realpathSync(absolute);
    if (!isInside(this.root, real)) throw new Error('evidence path escapes workspace');
    const realRelative = normalizeRelative(path.relative(this.root, real));
    if (isSecretPath(realRelative) || isIgnoredResolvedPath(realRelative)) throw new Error('evidence target is secret or ignored');
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('evidence must be a regular file under the size cap');
    const buffer = fs.readFileSync(real);
    const ext = path.extname(normalized).toLowerCase();
    const isBinary = buffer.includes(0);
    if (isBinary && !SAFE_ARTIFACT_EXTENSIONS.has(ext)) throw new Error('binary evidence is allowed only for known safe artifact extensions');
    return { path: normalized, content: buffer.toString('utf8'), hash: sha256(buffer), bytes: buffer.length };
  }

  performAction(input) {
    const type = requireText(input.type, 'action type', 100);
    switch (type) {
      case 'agent.register': return this.registerAgent(input);
      case 'task.create': return this.createTask(input);
      case 'task.assign': return this.assignTask(input);
      case 'task.state': return this.updateTaskState(input);
      case 'message': return this.addMessage(input);
      case 'baseline.create': return this.createBaseline(input);
      case 'baseline.approve': return this.approveBaseline(input);
      case 'evidence.add': return this.addEvidence(input);
      case 'review.add': return this.addReview(input);
      case 'checkpoint.release': return this.releaseCheckpoint(input);
      case 'activity.report': return this.reportActivity(input);
      case 'trace.span': return this.reportTraceSpan(input);
      default: throw new Error(`unsupported action type ${type}`);
    }
  }

  registerAgent(input) {
    const id = requireText(input.id, 'agent id', 150);
    const name = requireText(input.name || id, 'agent name', 200);
    const role = requireText(input.role, 'agent role', 50);
    if (!ROLES.has(role)) throw new Error('agent role is invalid');
    const existing = this.findAgent(id);
    if (existing) {
      existing.name = name;
      existing.role = role;
      existing.updatedAt = now();
      this.recordEvent({ type: 'agent.register', agentId: id, role, updated: true });
      return { agent: clone(existing) };
    }
    const agent = { id, name, role, createdAt: now() };
    this.state.agents.push(agent);
    this.recordEvent({ type: 'agent.register', agentId: id, role });
    return { agent: clone(agent) };
  }

  createBaseline(input) {
    const title = requireText(input.title, 'baseline title', 300);
    const intent = optionalText(input.intent, 'intent', 20000);
    const criteria = criteriaArray(input.criteria);
    const referencePaths = normalizeFileList(input.referencePaths || []);
    for (const referencePath of referencePaths) {
      try { this.readEvidenceFile(referencePath); } catch (error) { throw new Error(`reference path is not readable: ${referencePath}`); }
    }
    const baseline = {
      id: idFor('baseline'), title, intent, criteria, referencePaths,
      revision: this.indexer.index.revision,
      candidateHash: null,
      referenceHashes: this.referenceHashes(referencePaths),
      approved: false,
      createdAt: now(),
      approvedAt: null,
      approvalRecord: null
    };
    this.state.baselines.push(baseline);
    this.recordEvent({ type: 'baseline.create', baselineId: baseline.id, revision: baseline.revision, candidateHash: baseline.candidateHash });
    return { baseline: clone(baseline) };
  }

  approveBaseline(input) {
    const baselineId = requireText(input.baselineId, 'baselineId', 150);
    const baseline = this.findBaseline(baselineId);
    if (!baseline) throw new Error('baseline not found');
    const currentReferences = this.referenceHashes(baseline.referencePaths || []);
    if (JSON.stringify(currentReferences) !== JSON.stringify(baseline.referenceHashes || {})) throw new Error('reference artifacts changed since baseline creation');
    baseline.approved = true;
    baseline.approvedAt = now();
    baseline.approvalRecord = { actor: 'local-owner', revision: this.indexer.index.revision, referenceHashes: currentReferences, note: 'explicit local owner approval; API does not prove identity' };
    this.recordEvent({ type: 'baseline.approve', baselineId, revision: this.indexer.index.revision, approval: 'local-owner-record' });
    return { baseline: clone(baseline) };
  }

  createTask(input) {
    const title = requireText(input.title, 'task title', 300);
    const task = {
      id: idFor('task'), title,
      baselineId: input.baselineId ? requireText(input.baselineId, 'baselineId', 150) : null,
      builderId: input.builderId ? requireText(input.builderId, 'builderId', 150) : null,
      plannerId: input.plannerId ? requireText(input.plannerId, 'plannerId', 150) : null,
      reviewerId: input.reviewerId ? requireText(input.reviewerId, 'reviewerId', 150) : null,
      acceptanceId: input.acceptanceId ? requireText(input.acceptanceId, 'acceptanceId', 150) : null,
      files: normalizeFileList(input.files || []), state: 'assigned', stateHistory: [], assignmentEpoch: 0, release: null, createdAt: now(), updatedAt: now()
    };
    this.assertKnownCandidateFiles(task.files);
    this.state.tasks.push(task);
    this.recordEvent({ type: 'task.create', taskId: task.id, baselineId: task.baselineId, files: task.files });
    return { task: clone(task) };
  }

  assignTask(input) {
    const taskId = requireText(input.taskId, 'taskId', 150);
    const task = this.findTask(taskId);
    if (!task) throw new Error('task not found');
    if (task.state === 'completed' || task.release) throw new Error('completed task cannot change assignments');
    const assignments = [['builderId', 'builder'], ['plannerId', 'planner'], ['reviewerId', 'reviewer'], ['acceptanceId', 'acceptance']];
    let changed = false;
    const assigned = {};
    for (const [field, role] of assignments) {
      if (input[field] === undefined) continue;
      const raw = input[field];
      const id = raw === null || raw === '' ? null : requireText(raw, field, 150);
      if (id) {
        const agent = this.findAgent(id);
        if (!agent) throw new Error(`${field} must reference a registered agent`);
        if (agent.role !== role) throw new Error(`${field} must reference an agent with role ${role}`);
      }
      assigned[field] = id;
      if ((task[field] || null) !== id) changed = true;
    }
    if (!Object.keys(assigned).length) throw new Error('task.assign requires at least one assignment');
    for (const [field, id] of Object.entries(assigned)) task[field] = id;
    if (changed) task.assignmentEpoch = Number(task.assignmentEpoch || 0) + 1;
    task.updatedAt = now();
    this.recordEvent({ type: 'task.assign', taskId, assignments: assigned, assignmentEpoch: Number(task.assignmentEpoch || 0) });
    return { task: clone(task) };
  }

  updateTaskState(input) {
    const taskId = requireText(input.taskId, 'taskId', 150);
    const actorId = requireText(input.actorId, 'actorId', 150);
    const state = requireText(input.state, 'state', 50);
    if (!TASK_STATES.has(state)) throw new Error('task state is invalid');
    const task = this.findTask(taskId);
    if (!task) throw new Error('task not found');
    if (state === 'completed') throw new Error('completed state requires checkpoint.release');
    if (task.state === 'completed') throw new Error('completed task cannot change state');
    if (!this.findAgent(actorId)) throw new Error('actor is not registered');
    const files = normalizeFileList(input.files || []);
    this.assertKnownCandidateFiles(files);
    task.state = state;
    if (files.length) task.files = unique(task.files.concat(files));
    task.updatedAt = now();
    task.stateHistory.push({ state, actorId, files, at: task.updatedAt });
    this.recordEvent({ type: 'task.state', taskId, actorId, state, files });
    return { task: clone(task) };
  }

  addMessage(input) {
    const taskId = requireText(input.taskId, 'taskId', 150);
    if (!this.findTask(taskId)) throw new Error('task not found');
    const from = requireText(input.from, 'from', 150);
    const to = requireText(input.to, 'to', 150);
    const text = requireText(input.text, 'text', 10000);
    if (!this.findAgent(from) || !this.findAgent(to)) throw new Error('message participants must be registered agents');
    const message = { id: idFor('message'), taskId, from, to, text, at: now() };
    this.recordEvent({ type: 'message', taskId, from, to, text });
    return { message };
  }

  addEvidence(input) {
    const taskId = requireText(input.taskId, 'taskId', 150);
    const task = this.findTask(taskId);
    if (!task) throw new Error('task not found');
    const actorId = requireText(input.actorId, 'actorId', 150);
    if (!this.findAgent(actorId)) throw new Error('actor is not registered');
    const pathValue = requireText(input.path, 'path', 1000);
    const criteria = arrayOfText(input.criteria, 'criteria', 100);
    const baseline = this.findBaseline(task.baselineId);
    if (!baseline) throw new Error('task baseline not found');
    const criterionIds = new Set(baseline.criteria.map((item) => item.id));
    if (criteria.some((id) => !criterionIds.has(id))) throw new Error('evidence references an unknown criterion');
    const file = this.readEvidenceFile(pathValue);
    const evidence = {
      id: idFor('evidence'), taskId, path: file.path, criteria, actorId,
      contentHash: file.hash, bytes: file.bytes, baselineId: task.baselineId,
      revision: this.indexer.index.revision, artifactHash: this.currentArtifactHash(task), assignmentEpoch: Number(task.assignmentEpoch || 0), createdAt: now()
    };
    this.state.evidence.push(evidence);
    this.recordEvent({ type: 'evidence.add', taskId, evidenceId: evidence.id, path: file.path, actorId, revision: evidence.revision });
    return { evidence: clone(evidence) };
  }

  addReview(input) {
    const taskId = requireText(input.taskId, 'taskId', 150);
    const task = this.findTask(taskId);
    if (!task) throw new Error('task not found');
    const actorId = requireText(input.actorId, 'actorId', 150);
    const actor = this.findAgent(actorId);
    if (!actor) throw new Error('reviewer actor is not registered');
    const kind = requireText(input.kind, 'review kind', 50);
    if (!REVIEW_KINDS.has(kind)) throw new Error('review kind is invalid');
    const outcome = requireText(input.outcome, 'review outcome', 30);
    if (!['pass', 'fail', 'unverified'].includes(outcome)) throw new Error('review outcome is invalid');
    const criteria = arrayOfText(input.criteria, 'criteria', 100);
    const evidenceIds = arrayOfText(input.evidenceIds, 'evidenceIds', 100);
    if (!criteria.length || !evidenceIds.length) throw new Error('review requires criteria and evidenceIds');
    const baseline = this.findBaseline(task.baselineId);
    if (!baseline) throw new Error('task baseline not found');
    if (criteria.some((id) => !baseline.criteria.some((item) => item.id === id))) throw new Error('review references an unknown criterion');
    for (const evidenceId of evidenceIds) {
      const evidence = this.state.evidence.find((item) => item.id === evidenceId && item.taskId === taskId);
      if (!evidence) throw new Error(`evidence not found for review: ${evidenceId}`);
    }
    const review = {
      id: idFor('review'), taskId, actorId, kind, outcome, criteria, evidenceIds,
      notes: optionalText(input.notes, 'notes', 10000), baselineId: task.baselineId,
      revision: this.indexer.index.revision, artifactHash: this.currentArtifactHash(task),
      evidenceHash: this.currentEvidenceHash(task, true), assignmentEpoch: Number(task.assignmentEpoch || 0), createdAt: now()
    };
    this.state.reviews.push(review);
    this.recordEvent({ type: 'review.add', taskId, reviewId: review.id, actorId, kind, outcome, revision: review.revision });
    return { review: clone(review) };
  }

  reportActivity(input) {
    const actorId = requireText(input.actorId, 'actorId', 150);
    if (!this.findAgent(actorId)) throw new Error('actor is not registered');
    const taskId = input.taskId ? requireText(input.taskId, 'taskId', 150) : null;
    if (taskId && !this.findTask(taskId)) throw new Error('task not found');
    const pathValue = input.path ? normalizeRelative(requireText(input.path, 'path', 1000)) : null;
    const activity = {
      type: 'activity.report', actorId, taskId, path: pathValue,
      label: 'selfreported', attribution: actorId, details: optionalText(input.details, 'details', 10000), at: now()
    };
    this.recordEvent(activity);
    return { event: this.state.events[this.state.events.length - 1] };
  }

  reportTraceSpan(input) {
    const taskId = requireText(input.taskId, 'taskId', 150);
    if (!this.findTask(taskId)) throw new Error('task not found');
    const actorId = requireText(input.actorId, 'actorId', 150);
    if (!this.findAgent(actorId)) throw new Error('actor is not registered');
    const traceId = requireText(input.traceId, 'traceId', 200);
    const spanId = requireText(input.spanId, 'spanId', 200);
    const phase = requireText(input.phase, 'phase', 20);
    if (!['start', 'end', 'error'].includes(phase)) throw new Error('trace span phase is invalid');
    const file = normalizeRelative(requireText(input.file, 'file', 1000));
    if (!(this.indexer.index.files || []).some((item) => item.path === file)) throw new Error('trace span file is not an indexed workspace file');
    const symbol = input.symbol ? requireText(input.symbol, 'symbol', 500) : undefined;
    if (symbol && !(this.indexer.index.nodes || []).some((node) => node.type === 'symbol' && node.file === file && (node.id === symbol || node.name === symbol || node.id.endsWith(`#${symbol}`)))) throw new Error('trace span symbol is not known for the workspace file');
    const line = input.line === undefined || input.line === null ? undefined : Number(input.line);
    if (line !== undefined && (!Number.isInteger(line) || line < 1 || line > 1000000)) throw new Error('trace span line is invalid');
    const event = this.recordEvent({ type: 'trace.span', taskId, actorId, traceId, spanId, ...(input.parentSpanId ? { parentSpanId: requireText(input.parentSpanId, 'parentSpanId', 200) } : {}), phase, file, ...(symbol ? { symbol } : {}), ...(line !== undefined ? { line } : {}), provenance: 'client-instrumented' });
    return { event };
  }

  latestReview(taskId, kind, actorId) {
    const reviews = this.state.reviews.filter((review) => review.taskId === taskId && review.kind === kind && review.actorId === actorId);
    return reviews.length ? reviews[reviews.length - 1] : null;
  }

  evaluateGateLocked(taskId, recordDecision) {
    const task = this.findTask(taskId);
    const reasons = [];
    if (!task) {
      reasons.push('task not found');
      return this.finishGate(taskId, false, reasons, recordDecision);
    }
    const baseline = this.findBaseline(task.baselineId);
    const currentRevision = this.indexer.index.revision;
    const currentSnapshotHash = this.currentSnapshotHash();
    const currentArtifactHash = this.currentArtifactHash(task);
    if (!baseline) reasons.push('task has no existing baseline');
    else {
      if (!baseline.approved) reasons.push('baseline is not explicitly approved');
      const currentReferences = this.referenceHashes(baseline.referencePaths || []);
      if (JSON.stringify(currentReferences) !== JSON.stringify(baseline.referenceHashes || {})) reasons.push('approved reference artifacts changed');
    }
    const assignments = [task.builderId, task.plannerId, task.reviewerId, task.acceptanceId];
    if (assignments.some((value) => !value)) reasons.push('builder, planner, reviewer, and acceptance assignments are all required');
    if (unique(assignments.filter(Boolean)).length !== assignments.filter(Boolean).length) reasons.push('builder, planner, reviewer, and acceptance must be four distinct agents');
    const expectedRoles = [[task.builderId, 'builder'], [task.plannerId, 'planner'], [task.reviewerId, 'reviewer'], [task.acceptanceId, 'acceptance']];
    for (const [agentId, role] of expectedRoles) {
      const agent = agentId && this.findAgent(agentId);
      if (!agent) reasons.push(`${role} assignment is not a registered agent`);
      else if (agent.role !== role) reasons.push(`${role} assignment must use an agent with role ${role}`);
    }
    if (task.state === 'completed' && !task.release) reasons.push('completed state has no checkpoint release record');
    if (!task.files || task.files.length === 0) reasons.push('task must name at least one indexed candidate file');
    try { this.assertKnownCandidateFiles(task.files || []); } catch (error) { reasons.push(error.message); }
    const criteria = baseline ? baseline.criteria.map((item) => item.id) : [];
    const currentEvidence = this.state.evidence.filter((evidence) => this.isEvidenceCurrent(evidence, task));
    if (!currentEvidence.length) reasons.push('no current evidence exists for this task');
    const evidenceById = new Map(currentEvidence.map((item) => [item.id, item]));
    const allEvidenceCriteria = new Set(currentEvidence.flatMap((item) => item.criteria));
    for (const criterionId of criteria) if (!allEvidenceCriteria.has(criterionId)) reasons.push(`current evidence does not cover criterion ${criterionId}`);
    const evidenceHash = this.currentEvidenceHash(task, true);
    const reviewsByKind = [['planning', task.plannerId], ['engineering', task.reviewerId], ['experience', task.acceptanceId]];
    for (const [kind, actorId] of reviewsByKind) {
      if (!actorId) continue;
      const review = this.latestReview(task.id, kind, actorId);
      if (!review) { reasons.push(`no ${kind} review from assigned ${kind === 'planning' ? 'planner' : kind === 'engineering' ? 'reviewer' : 'acceptance'} agent`); continue; }
      if (review.actorId === task.builderId) reasons.push(`${kind} review is a self-review by the builder`);
      if (review.outcome !== 'pass') reasons.push(`latest ${kind} review outcome is ${review.outcome}`);
      if (review.baselineId !== task.baselineId || review.revision !== currentRevision || review.artifactHash !== currentArtifactHash || review.evidenceHash !== evidenceHash || Number(review.assignmentEpoch || 0) !== Number(task.assignmentEpoch || 0)) reasons.push(`${kind} review is stale for the current baseline, revision, artifact, evidence, or assignments`);
      const reviewCriteria = new Set(review.criteria);
      for (const criterionId of criteria) if (!reviewCriteria.has(criterionId)) reasons.push(`${kind} review does not cover criterion ${criterionId}`);
      if (!review.evidenceIds || review.evidenceIds.length === 0) reasons.push(`${kind} review has no evidence references`);
      else {
        const reviewEvidenceCriteria = new Set();
        for (const evidenceId of review.evidenceIds) {
          const evidence = evidenceById.get(evidenceId);
          if (!evidence) reasons.push(`${kind} review references stale or missing evidence ${evidenceId}`);
          else evidence.criteria.forEach((id) => reviewEvidenceCriteria.add(id));
        }
        for (const criterionId of criteria) if (!reviewEvidenceCriteria.has(criterionId)) reasons.push(`${kind} review evidence does not cover criterion ${criterionId}`);
      }
    }
    for (const review of this.state.reviews.filter((item) => item.taskId === task.id && item.actorId === task.builderId)) reasons.push(`builder self-review ${review.id} is not permitted`);
    const allowed = reasons.length === 0;
    return this.finishGate(taskId, allowed, unique(reasons), recordDecision, { revision: currentRevision, artifactHash: currentArtifactHash, evidenceHash });
  }

  finishGate(taskId, allowed, reasons, recordDecision, metadata = {}) {
    const gate = { taskId, allowed, reasons, revision: metadata.revision || (this.indexer.index && this.indexer.index.revision) || 0, artifactHash: metadata.artifactHash || null, evidenceHash: metadata.evidenceHash || null, at: now() };
    if (recordDecision) {
      this.state.gateDecisions.push({ id: idFor('gate'), ...gate });
      this.state.gateDecisions = this.state.gateDecisions.slice(-MAX_GATE_DECISIONS);
      this.persistState();
    }
    return clone(gate);
  }

  releaseCheckpoint(input) {
    const taskId = requireText(input.taskId, 'taskId', 150);
    const existingTask = this.findTask(taskId);
    if (!existingTask) throw new Error('task not found');
    if (existingTask.release || existingTask.state === 'completed') {
      const error = new Error('checkpoint has already been released for this task');
      error.reasons = ['task checkpoint is already released'];
      throw error;
    }
    const gate = this.evaluateGateLocked(taskId, true);
    if (!gate.allowed) {
      const error = new Error('checkpoint release denied');
      error.reasons = gate.reasons;
      error.gate = gate;
      throw error;
    }
    const task = this.findTask(taskId);
    task.release = { at: now(), revision: gate.revision, artifactHash: gate.artifactHash, evidenceHash: gate.evidenceHash, decision: 'allowed' };
    task.state = 'completed';
    task.updatedAt = task.release.at;
    task.stateHistory.push({ state: 'completed', actorId: 'checkpoint.release', files: task.files, at: task.updatedAt });
    this.recordEvent({ type: 'checkpoint.release', taskId, revision: gate.revision, artifactHash: gate.artifactHash });
    return { task: clone(task), gate };
  }
}

module.exports = { IntentEngine, STATE_KEYS };
