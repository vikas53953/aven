'use strict';

const crypto = require('node:crypto');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { DatabaseSync = null; }

const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WORKFLOW_TTL_MS = 5 * 60 * 1000;
const MAX_SCOPE_BYTES = 16 * 1024;
const MAX_VALUE_CHARS = 500;
const ACTION_TYPES = Object.freeze(new Set([
  'browser.preview', 'browser.execute', 'desktop.preview', 'desktop.execute'
]));
const PREVIEW_TYPES = Object.freeze(new Set(['browser.preview', 'desktop.preview']));
const EXECUTE_TYPES = Object.freeze(new Set(['browser.execute', 'desktop.execute']));
const ADAPTER_INSTANCE_IDS = new WeakMap();
const SENSITIVE_RE = /(?:password|passcode|passwd|secret|token|credential|api[-_ ]?key|authorization|cookie|private[-_ ]?key|otp|one[-_ ]?time)/i;
const SENSITIVE_VALUE_RE = /(?:-----BEGIN [^-]+-----|\b(?:api[-_ ]?key|private[-_ ]?key|password|passwd|secret|credential|authorization|access[-_ ]?token|refresh[-_ ]?token)\b\s*[:=]|\bBearer\s+[A-Za-z0-9._~+/=-]{12,})/i;
const TOKEN_VALUE_RE = /\b(?:scope|preview|approval|session|connection)\.[A-Za-z0-9_-]{20,}\b/;

function error(message, status = 400, code = 'APPROVAL_BRIDGE_REQUEST_INVALID', details = {}) {
  const value = new Error(message);
  value.statusCode = status;
  value.code = code;
  Object.assign(value, details);
  return value;
}

function nowValue(now) {
  const value = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(value)) throw error('approval bridge clock is invalid', 500, 'APPROVAL_BRIDGE_CLOCK_INVALID');
  return Number(value);
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function randomToken(prefix) {
  return `${prefix}.${crypto.randomBytes(32).toString('base64url')}`;
}

function text(value, name, max = 500, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw error(`${name} is invalid`);
  }
  return value.trim();
}

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw error(`${name} is invalid`);
  return value;
}

function originOf(value) {
  const origin = text(value, 'origin', 300);
  let parsed;
  try { parsed = new URL(origin); } catch { throw error('origin is invalid', 403, 'APPROVAL_ORIGIN_DENIED'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw error('origin is invalid', 403, 'APPROVAL_ORIGIN_DENIED');
  }
  return parsed.origin;
}

function constantEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function scopeKey(scope) {
  const canonical = stableJson(scope);
  if (Buffer.byteLength(canonical, 'utf8') > MAX_SCOPE_BYTES) throw error('scope is too large', 400, 'APPROVAL_SCOPE_INVALID');
  return digest(scope);
}

function normalizeScope(value, name = 'scope') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(`${name} is invalid`, 400, 'APPROVAL_SCOPE_INVALID');
  const copy = clone(value);
  const key = scopeKey(copy);
  return { value: copy, key };
}

function sameScope(left, right) {
  return constantEqual(scopeKey(left), scopeKey(right));
}

function withinScope(parent, child) {
  if (sameScope(parent, child)) return true;
  if (Array.isArray(parent.targets) && Array.isArray(child.targets)) {
    const allowed = new Set(parent.targets.map((target) => stableJson(target)));
    return child.targets.every((target) => allowed.has(stableJson(target))) &&
      Object.entries(child).every(([key, value]) => key === 'targets' || key === 'adapterTarget' || key === 'adapterContext' || key === 'actualTarget' || stableJson(value) === stableJson(parent[key]));
  }
  return false;
}

function adapterIdentityOf(facade, fallback) {
  try {
    const state = facade && (facade.adapterState || facade.adapterStatus);
    if (state && typeof state === 'object' && state.identity !== undefined) return text(String(state.identity), 'adapter identity', 300);
    if (facade && typeof facade.adapterIdentity === 'function') return text(String(facade.adapterIdentity()), 'adapter identity', 300);
    if (facade && facade.adapterIdentity !== undefined) return text(String(facade.adapterIdentity), 'adapter identity', 300);
  } catch (cause) {
    throw error('adapter identity is unavailable', 409, 'APPROVAL_ADAPTER_IDENTITY_CHANGED', { cause });
  }
  return text(String(fallback || 'injected-execution-adapter'), 'adapter identity', 300);
}

// ExecutionAdapters.status() is synchronous and deliberately omits the private
// browser context id. This provider closes over the real adapter instance so a
// context, page catalog or selected desktop window change advances the adapter
// generation and invalidates every pending review.
function createAdapterStateProvider(adapters) {
  if (!adapters || typeof adapters.status !== 'function') throw error('actual execution adapter status is required', 500, 'APPROVAL_ADAPTER_STATUS_UNAVAILABLE');
  if (!ADAPTER_INSTANCE_IDS.has(adapters)) ADAPTER_INSTANCE_IDS.set(adapters, crypto.randomUUID());
  const adapterIdentity = `execution-adapters:${digest({ instanceId: ADAPTER_INSTANCE_IDS.get(adapters), adapterVersion: 'approval-bridge-v1' })}`;
  let lastFingerprint = '';
  let generation = 0;
  return () => {
    let status;
    try { status = adapters.status(); } catch (cause) { throw error('actual execution adapter status is unavailable', 409, 'APPROVAL_ADAPTER_STATUS_UNAVAILABLE', { cause }); }
    const browserContextId = String(adapters.browserContextId || 'none');
    const selectedWindow = adapters.selectedWindow ? clone(adapters.selectedWindow) : null;
    const pages = adapters.pages instanceof Map
      ? [...adapters.pages.values()].map((entry) => ({ pageId: entry.pageId, contextId: entry.contextId, url: (() => { try { return entry.page?.url?.() || ''; } catch { return ''; } })() }))
      : (status.browser?.pages || []);
    const fingerprint = digest({
      browserContextId,
      selectedWindow,
      pages,
      browserConnected: Boolean(status.browser?.connected),
      desktopSelected: status.desktop?.selectedWindow || null,
      closed: Boolean(adapters.closed)
    });
    if (fingerprint !== lastFingerprint) { generation += 1; lastFingerprint = fingerprint; }
    return {
      identity: adapterIdentity,
      sessionId: browserContextId === 'none' ? 'adapter-local-session' : browserContextId,
      generation,
      browserContextId,
      selectedWindow: selectedWindow ? {
        hwnd: selectedWindow.hwnd,
        pid: selectedWindow.pid,
        processCreationTime: selectedWindow.processCreationTime,
        title: selectedWindow.title,
        className: selectedWindow.className,
        processName: selectedWindow.processName
      } : null,
      selectedWindowFingerprint: selectedWindow ? digest(selectedWindow) : null
    };
  };
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  const value = key === undefined ? '' : headers[key];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function sanitizedDetail(value) {
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizedDetail);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, MAX_VALUE_CHARS) : value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:text|password|secret|token|approvalId|credential|fillText|steeringToken)$/i.test(key)) continue;
    result[key] = sanitizedDetail(child);
  }
  return result;
}

function boundedCurrentValue(result) {
  const element = result?.detail?.element || result?.detail?.control || result?.detail;
  if (element && [element.type, element.kind, element.title, element.ariaLabel, element.controlKind].some((field) => typeof field === 'string' && SENSITIVE_RE.test(field))) {
    return { status: 'unavailable', reason: 'Sensitive current values are not captured.' };
  }
  const candidates = [result?.currentValue, result?.detail?.currentValue, result?.detail?.element?.value];
  const candidate = candidates.find((value) => typeof value === 'string');
  if (candidate === undefined) return { status: 'unavailable', reason: 'Adapter did not provide a bounded live current value.' };
  return { status: 'available', value: candidate.slice(0, MAX_VALUE_CHARS), bounded: candidate.length <= MAX_VALUE_CHARS };
}

function sensitiveInput(operation) {
  if (!operation || typeof operation !== 'object') return false;
  if (operation.sensitive === true || operation.isSensitive === true) return true;
  const fields = [operation.selector, operation.name, operation.title, operation.ariaLabel,
    operation.targetControl?.title, operation.targetControl?.automationId,
    operation.targetControl?.className, operation.control?.title, operation.control?.automationId,
    operation.control?.className, operation.control?.kind];
  return fields.some((field) => typeof field === 'string' && SENSITIVE_RE.test(field));
}

function containsSensitivePayload(value, seen = new Set(), field = '') {
  if (typeof value === 'string') return SENSITIVE_VALUE_RE.test(value) || (!/^(?:sessionId|connectionId)$/i.test(field) && TOKEN_VALUE_RE.test(value));
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  const found = Array.isArray(value)
    ? value.some((item) => containsSensitivePayload(item, seen))
    : Object.entries(value).some(([key, child]) => SENSITIVE_RE.test(key) || containsSensitivePayload(child, seen, key));
  seen.delete(value);
  return found;
}

function validatePreviewOperation(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw error('preview request is invalid');
  const mode = text(request.mode, 'mode', 20);
  if (mode === 'network' || mode === 'device') throw error('Network and device writes require a separate recovery plan and are unavailable through this adapter bridge', 403, 'APPROVAL_DEVICE_WRITE_UNAVAILABLE');
  const executionMode = request.executionMode === undefined ? 'write' : text(request.executionMode, 'execution mode', 20);
  if (executionMode !== 'write') throw error('plan and inspect sessions cannot create executable adapter approvals', 403, 'APPROVAL_EXECUTION_MODE_DENIED');
  const operation = clone(request.operation);
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw error('adapter operation is invalid');
  const expected = `${mode}.preview`;
  if (!PREVIEW_TYPES.has(expected) || operation.type !== expected) throw error('mode and adapter operation do not match', 400, 'APPROVAL_OPERATION_INVALID');
  if (sensitiveInput(operation)) throw error('Sensitive fields cannot be previewed or filled', 422, 'APPROVAL_SENSITIVE_INPUT_REJECTED');
  if (operation.kind === 'fill' && typeof operation.text !== 'string') throw error('fill text is required', 400, 'APPROVAL_OPERATION_INVALID');
  return { mode, executionMode, operation };
}

function targetWithAdapterBinding(mode, operation, requested) {
  const normalized = normalizeScope(requested);
  const actual = mode === 'browser'
    ? { pageId: operation.pageId }
    : { control: operation.targetControl || operation.control };
  if (!actual.pageId && !actual.control) throw error('adapter target context is unavailable', 409, 'APPROVAL_TARGET_UNAVAILABLE');
  if (normalized.value.adapterTarget !== undefined && stableJson(normalized.value.adapterTarget) !== stableJson(actual)) {
    throw error('requested target scope does not match the adapter target context', 409, 'APPROVAL_TARGET_MISMATCH');
  }
  return normalizeScope({ ...normalized.value, adapterTarget: actual }).value;
}

function targetWithAdapterState(mode, operation, requested, adapterState) {
  const scopeTargets = Array.isArray(requested?.targets) ? requested.targets : [];
  const actualScopeTarget = mode === 'browser'
    ? { pageId: operation.pageId }
    : { window: adapterState?.selectedWindow || null };
  if (!actualScopeTarget.pageId && !actualScopeTarget.window) throw error('adapter target scope context is unavailable', 409, 'APPROVAL_TARGET_UNAVAILABLE');
  const matchesActualTarget = scopeTargets.some((candidate) => mode === 'browser'
    ? candidate && typeof candidate === 'object' && String(candidate.pageId || '') === String(actualScopeTarget.pageId)
    : candidate && typeof candidate === 'object' && candidate.window && windowIdentity(candidate.window) === windowIdentity(actualScopeTarget.window));
  if (!matchesActualTarget) throw error('requested target scope does not identify the active adapter target', 403, 'APPROVAL_TARGET_MISMATCH');
  const target = targetWithAdapterBinding(mode, operation, requested, adapterState);
  const context = mode === 'browser'
    ? { browserContextId: adapterState?.browserContextId || null }
    : { selectedWindowFingerprint: adapterState?.selectedWindowFingerprint || null };
  if (!context.browserContextId && !context.selectedWindowFingerprint) {
    throw error('adapter target session context is unavailable', 409, 'APPROVAL_TARGET_UNAVAILABLE');
  }
  const bound = { ...target, adapterContext: context, actualTarget: actualScopeTarget };
  if (target.adapterTarget !== undefined && requested?.adapterContext !== undefined && stableJson(requested.adapterContext) !== stableJson(context)) {
    throw error('requested adapter context does not match the active adapter context', 409, 'APPROVAL_TARGET_MISMATCH');
  }
  return normalizeScope(bound).value;
}

function humanAction(mode, operation) {
  const verb = operation?.kind === 'fill' ? 'Fill the selected field' : operation?.kind === 'click' ? 'Click the selected control' : 'Perform the selected adapter action';
  return mode === 'browser' ? `${verb} in the browser` : `${verb} in the desktop window`;
}

function safeTargetLabel(value, fallback) {
  const label = String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  return label && !SENSITIVE_RE.test(label) && !SENSITIVE_VALUE_RE.test(label) ? label : fallback;
}

function humanTarget(mode, operation, adapterResult, adapterState) {
  if (mode === 'browser') {
    let url = adapterResult?.detail?.url || adapterResult?.url;
    try {
      const parsed = new URL(String(url));
      url = `${parsed.origin}${parsed.pathname}`.slice(0, 180);
    } catch { url = ''; }
    return safeTargetLabel(url, 'The adapter-selected browser page');
  }
  const selected = adapterResult?.selectedWindow || adapterResult?.detail?.window || adapterState?.selectedWindow;
  return safeTargetLabel(selected?.title || selected?.processName, 'The adapter-selected desktop window and control');
}

function windowIdentity(value) {
  if (!value || typeof value !== 'object') return '';
  return stableJson({ hwnd: value.hwnd, pid: value.pid, processCreationTime: value.processCreationTime });
}

class ConnectionManager {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.tokenTtlMs = integer(options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS, 'token TTL', 1, 24 * 60 * 60 * 1000);
    this.allowedOrigins = new Set((options.allowedOrigins || ['http://127.0.0.1:8767', 'http://127.0.0.1:8768']).map(originOf));
    this.adapterIdentity = text(String(options.adapterIdentity || 'injected-execution-adapter'), 'adapter identity', 300);
    this.connection = null;
  }

  time() { return nowValue(this.now); }

  revoke(reason = 'revoked') {
    if (this.connection) {
      this.connection.revoked = true;
      this.connection.revokeReason = reason;
      this.connection.token = '';
    }
    this.connection = null;
  }

  connect({ origin, scope, adapterIdentity, adapterSessionId, adapterGeneration, manualReviewOnly = true } = {}) {
    const canonicalOrigin = originOf(origin);
    if (!this.allowedOrigins.has(canonicalOrigin)) throw error('origin is not allowed', 403, 'APPROVAL_ORIGIN_DENIED');
    const normalized = normalizeScope(scope);
    if (adapterIdentity !== undefined && String(adapterIdentity) !== this.adapterIdentity) {
      this.revoke('adapter identity changed');
      throw error('adapter identity changed', 409, 'APPROVAL_ADAPTER_IDENTITY_CHANGED');
    }
    this.revoke('reconnected');
    const now = this.time();
    const connection = {
      connectionId: randomToken('connection'),
      sessionId: randomToken('session'),
      generation: 1,
      origin: canonicalOrigin,
      scope: normalized.value,
      scopeKey: normalized.key,
      token: randomToken('scope'),
      expiresAt: now + this.tokenTtlMs,
      manualReviewOnly: manualReviewOnly !== false,
      adapterIdentity: this.adapterIdentity,
      adapterSessionId: adapterSessionId === undefined ? null : text(String(adapterSessionId), 'adapter session identity', 300),
      adapterGeneration: adapterGeneration === undefined || adapterGeneration === null ? null : integer(adapterGeneration, 'adapter generation', 0, Number.MAX_SAFE_INTEGER),
      revoked: false,
      revokeReason: ''
    };
    this.connection = connection;
    return this.publicContext(connection, true);
  }

  publicContext(connection = this.connection, includeToken = false) {
    if (!connection) throw error('approval connection is unavailable', 409, 'APPROVAL_CONNECTION_UNAVAILABLE');
    return {
      connectionId: connection.connectionId,
      sessionId: connection.sessionId,
      generation: connection.generation,
      origin: connection.origin,
      scope: clone(connection.scope),
      scopeKey: connection.scopeKey,
      expiresAt: connection.expiresAt,
      manualReviewOnly: connection.manualReviewOnly,
      adapterIdentity: connection.adapterIdentity,
      ...(connection.adapterSessionId === null ? {} : { adapterSessionId: connection.adapterSessionId }),
      ...(connection.adapterGeneration === null ? {} : { adapterGeneration: connection.adapterGeneration }),
      ...(includeToken ? { token: connection.token } : {})
    };
  }

  check(context, { requireToken = true, targetScope } = {}) {
    const connection = this.connection;
    if (!connection || connection.revoked) throw error('approval connection is unavailable', 409, 'APPROVAL_CONNECTION_UNAVAILABLE');
    const current = this.time();
    if (connection.expiresAt <= current) {
      this.revoke('expired');
      throw error('approval connection expired', 401, 'APPROVAL_CONNECTION_EXPIRED');
    }
    const request = context || {};
    if (originOf(request.origin) !== connection.origin) throw error('origin does not match connection', 403, 'APPROVAL_ORIGIN_MISMATCH');
    if (request.header !== 'approval-bridge') throw error('approval bridge header is required', 403, 'APPROVAL_HEADER_REQUIRED');
    if (requireToken && !constantEqual(request.token, connection.token)) throw error('scoped approval token is invalid', 403, 'APPROVAL_TOKEN_INVALID');
    if (String(request.sessionId) !== connection.sessionId) throw error('approval session is stale', 409, 'APPROVAL_SESSION_STALE');
    if (Number(request.generation) !== connection.generation) throw error('approval session generation is stale', 409, 'APPROVAL_GENERATION_STALE');
    if (String(request.connectionId) !== connection.connectionId) throw error('approval connection is stale', 409, 'APPROVAL_CONNECTION_STALE');
    if (String(request.scopeKey) !== connection.scopeKey) throw error('approval scope is stale', 409, 'APPROVAL_SCOPE_STALE');
    if (targetScope !== undefined && !withinScope(connection.scope, targetScope)) throw error('requested target scope exceeds the connected scope', 403, 'APPROVAL_SCOPE_EXCEEDED');
    return connection;
  }

  rotate(reason = 'rotated') {
    const old = this.connection;
    if (!old) throw error('approval connection is unavailable', 409, 'APPROVAL_CONNECTION_UNAVAILABLE');
    const now = this.time();
    old.token = '';
    old.revoked = true;
    const next = {
      ...old,
      connectionId: randomToken('connection'),
      generation: old.generation + 1,
      token: randomToken('scope'),
      expiresAt: now + this.tokenTtlMs,
      revoked: false,
      revokeReason: reason
    };
    this.connection = next;
    return this.publicContext(next, true);
  }

  reload() { return this.rotate('reloaded'); }

  disconnect(context) {
    this.check(context, { requireToken: true });
    this.revoke('disconnected');
    return { disconnected: true };
  }

  setAdapterIdentity(identity) {
    const next = text(String(identity), 'adapter identity', 300);
    if (next !== this.adapterIdentity) {
      this.adapterIdentity = next;
      this.revoke('adapter identity changed');
      return true;
    }
    return false;
  }

  status() {
    if (!this.connection) return { connected: false };
    try { this.check({ ...this.publicContext(this.connection), header: 'approval-bridge' }, { requireToken: false }); } catch { return { connected: false }; }
    return { connected: true, ...this.publicContext(this.connection, false) };
  }
}

// Review metadata is durable, while every authorization and adapter token stays
// in memory. A restart therefore keeps a truthful receipt of what was reviewed
// but cannot revive an action that could cross an adapter boundary.
class ReviewLedger {
  constructor({ storagePath, now = Date.now } = {}) {
    if (!storagePath) throw error('durable review ledger path is required', 500, 'APPROVAL_LEDGER_PATH_REQUIRED');
    if (!DatabaseSync) throw error('durable review ledger requires node:sqlite', 500, 'APPROVAL_LEDGER_UNAVAILABLE');
    this.storagePath = storagePath;
    this.now = now;
    this.database = new DatabaseSync(storagePath);
    this.database.exec('PRAGMA busy_timeout = 2000; CREATE TABLE IF NOT EXISTS approval_bridge_reviews (record_id TEXT PRIMARY KEY, adapter_digest TEXT NOT NULL, digest TEXT NOT NULL, mode TEXT NOT NULL, execution_mode TEXT NOT NULL, target_scope TEXT NOT NULL, scope_key TEXT NOT NULL, session_id TEXT NOT NULL, generation INTEGER NOT NULL, connection_id TEXT NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL, impact TEXT NOT NULL, rollback TEXT NOT NULL, updated_at INTEGER NOT NULL);');
  }

  close() { try { this.database.close(); } catch {} }

  publicRecord(record) {
    return {
      recordId: record.recordId,
      adapterDigest: record.adapterDigest,
      digest: record.digest,
      mode: record.mode,
      executionMode: record.executionMode,
      targetScope: clone(record.targetScope),
      scopeKey: record.scopeKey,
      sessionId: record.sessionId,
      generation: record.generation,
      connectionId: record.connectionId,
      expiresAt: record.expiresAt,
      status: record.status,
      impact: clone(record.impact),
      rollback: clone(record.rollback),
      updatedAt: nowValue(this.now)
    };
  }

  write(record) {
    const safe = this.publicRecord(record);
    if (containsSensitivePayload(safe)) throw error('review metadata contains sensitive payload', 422, 'APPROVAL_SENSITIVE_INPUT_REJECTED');
    this.database.prepare('INSERT INTO approval_bridge_reviews (record_id, adapter_digest, digest, mode, execution_mode, target_scope, scope_key, session_id, generation, connection_id, expires_at, status, impact, rollback, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET adapter_digest=excluded.adapter_digest, digest=excluded.digest, mode=excluded.mode, execution_mode=excluded.execution_mode, target_scope=excluded.target_scope, scope_key=excluded.scope_key, session_id=excluded.session_id, generation=excluded.generation, connection_id=excluded.connection_id, expires_at=excluded.expires_at, status=excluded.status, impact=excluded.impact, rollback=excluded.rollback, updated_at=excluded.updated_at').run(safe.recordId, safe.adapterDigest, safe.digest, safe.mode, safe.executionMode, stableJson(safe.targetScope), safe.scopeKey, safe.sessionId, safe.generation, safe.connectionId, safe.expiresAt, safe.status, stableJson(safe.impact), stableJson(safe.rollback), safe.updatedAt);
  }

  mark(record, status) { record.status = status; this.write(record); }

  markSession(sessionId, generation, status = 'stale') {
    if (!sessionId || !Number.isInteger(generation)) return;
    this.database.prepare("UPDATE approval_bridge_reviews SET status = ?, updated_at = ? WHERE session_id = ? AND generation = ? AND status IN ('previewed', 'approved')").run(status, nowValue(this.now), sessionId, generation);
  }

  markActiveUnknown() {
    this.database.prepare("UPDATE approval_bridge_reviews SET status = 'unknown', updated_at = ? WHERE status IN ('previewed', 'approved', 'consumed')").run(nowValue(this.now));
  }

  list() {
    return this.database.prepare('SELECT record_id AS recordId, adapter_digest AS adapterDigest, digest, mode, execution_mode AS executionMode, target_scope AS targetScope, scope_key AS scopeKey, session_id AS sessionId, generation, connection_id AS connectionId, expires_at AS expiresAt, status, impact, rollback, updated_at AS updatedAt FROM approval_bridge_reviews ORDER BY updated_at DESC LIMIT 500').all().map((row) => ({
      ...row,
      targetScope: JSON.parse(row.targetScope),
      impact: JSON.parse(row.impact),
      rollback: JSON.parse(row.rollback)
    }));
  }
}

class ApprovalBridge {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.executionFacade = options.executionFacade;
    if (!this.executionFacade || typeof this.executionFacade.action !== 'function') throw error('execution facade is required', 500, 'APPROVAL_EXECUTION_FACADE_REQUIRED');
    this.workflowTtlMs = integer(options.workflowTtlMs ?? DEFAULT_WORKFLOW_TTL_MS, 'workflow TTL', 1, 24 * 60 * 60 * 1000);
    this.adapterStateProvider = options.adapterState || this.executionFacade.adapterState || this.executionFacade.adapterStatus || null;
    let initialAdapterState = this.adapterStateProvider;
    if (typeof initialAdapterState === 'function') initialAdapterState = initialAdapterState();
    if (initialAdapterState && typeof initialAdapterState.then === 'function') throw error('adapter status must be synchronously available for approval checks', 409, 'APPROVAL_ADAPTER_STATUS_UNAVAILABLE');
    this.connectionManager = options.connectionManager || new ConnectionManager({
      now: this.now,
      allowedOrigins: options.allowedOrigins,
      tokenTtlMs: options.tokenTtlMs,
      adapterIdentity: adapterIdentityOf(this.executionFacade, initialAdapterState?.identity || options.adapterIdentity)
    });
    this.reviewLedger = options.reviewLedger || (options.storagePath ? new ReviewLedger({ storagePath: options.storagePath, now: this.now }) : null);
    this.reviewLedger?.markActiveUnknown();
    this.previews = new Map();
    this.approvals = new Map();
  }

  time() { return nowValue(this.now); }

  adapterIdentity() { return adapterIdentityOf(this.executionFacade, this.connectionManager.adapterIdentity); }

  adapterState() {
    let state = this.adapterStateProvider;
    if (typeof state === 'function') state = state();
    if (state && typeof state.then === 'function') throw error('adapter status must be synchronously available for approval checks', 409, 'APPROVAL_ADAPTER_STATUS_UNAVAILABLE');
    if (!state || typeof state !== 'object') state = {};
    return {
      identity: state.identity === undefined
        ? adapterIdentityOf(this.executionFacade, this.connectionManager.adapterIdentity)
        : text(String(state.identity), 'adapter identity', 300),
      sessionId: state.sessionId === undefined ? null : String(state.sessionId),
      generation: state.generation === undefined ? null : integer(Number(state.generation), 'adapter generation', 0, Number.MAX_SAFE_INTEGER),
      browserContextId: state.browserContextId === undefined ? null : text(String(state.browserContextId), 'browser context identity', 300, false) || null,
      selectedWindow: state.selectedWindow && typeof state.selectedWindow === 'object' ? clone(state.selectedWindow) : null,
      selectedWindowFingerprint: state.selectedWindowFingerprint === undefined ? null : text(String(state.selectedWindowFingerprint), 'selected window fingerprint', 300, false) || null
    };
  }

  ensureAdapterIdentity() {
    const state = this.adapterState();
    const connection = this.connectionManager.connection;
    const adapterSessionChanged = Boolean(connection && state.sessionId !== null && connection.adapterSessionId !== null && state.sessionId !== connection.adapterSessionId);
    const adapterGenerationChanged = Boolean(connection && state.generation !== null && connection.adapterGeneration !== null && state.generation !== connection.adapterGeneration);
    if (state.identity !== this.connectionManager.adapterIdentity || adapterSessionChanged || adapterGenerationChanged) {
      this.previews.clear();
      this.approvals.clear();
      this.reviewLedger?.markActiveUnknown();
      if (adapterSessionChanged || adapterGenerationChanged) this.connectionManager.revoke('adapter session changed');
      this.connectionManager.setAdapterIdentity(state.identity);
      throw error('adapter identity or adapter session changed; reconnect is required', 409, 'APPROVAL_ADAPTER_IDENTITY_CHANGED');
    }
    return state;
  }

  connect(input) {
    const state = this.adapterState();
    const identity = state.identity;
    if (input?.adapterIdentity !== undefined && String(input.adapterIdentity) !== identity) throw error('adapter identity changed', 409, 'APPROVAL_ADAPTER_IDENTITY_CHANGED');
    return this.connectionManager.connect({ ...input, adapterIdentity: identity, adapterSessionId: state.sessionId, adapterGeneration: state.generation });
  }

  context(context, targetScope) {
    this.ensureAdapterIdentity();
    return this.connectionManager.check(context, { targetScope });
  }

  purgeExpired(at = this.time()) {
    for (const [key, value] of this.previews) if (value.expiresAt <= at) { this.reviewLedger?.mark(value, 'expired'); this.previews.delete(key); }
    for (const [key, value] of this.approvals) if (value.expiresAt <= at) { this.reviewLedger?.mark(value, 'expired'); this.approvals.delete(key); }
  }

  boundedExpiry(adapterResult, now, connection) {
    const adapterExpiry = Number.isFinite(adapterResult?.expiresAt)
      ? adapterResult.expiresAt
      : (typeof adapterResult?.expiresAt === 'string' && Number.isFinite(Date.parse(adapterResult.expiresAt))
        ? Date.parse(adapterResult.expiresAt)
        : now + this.workflowTtlMs);
    const adapterTtl = Number.isFinite(adapterResult?.ttlMs) ? adapterResult.ttlMs : this.workflowTtlMs;
    return Math.min(adapterExpiry, now + adapterTtl, now + this.workflowTtlMs, connection.expiresAt);
  }

  publicReview(record) {
    return {
      reviewId: record.recordId,
      previewToken: record.previewToken,
      mode: record.mode,
      executionMode: record.executionMode,
      adapter: record.adapter,
      adapterOwnedContext: record.mode === 'browser' ? 'headless browser context owned by the adapter' : 'desktop window session owned by the adapter',
      actionSummary: record.actionSummary,
      targetSummary: record.targetSummary,
      digest: record.digest,
      adapterDigest: record.adapterDigest,
      targetScope: clone(record.targetScope),
      sessionId: record.sessionId,
      generation: record.generation,
      connectionId: record.connectionId,
      expiresAt: record.expiresAt,
      currentValue: clone(record.currentValue),
      impact: clone(record.impact),
      rollback: clone(record.rollback),
      status: record.status,
      approvalToken: record.status === 'approved' ? record.approvalToken : undefined,
      approvalExpiresAt: record.status === 'approved' ? record.expiresAt : undefined
    };
  }

  async preview(context, request) {
    const normalized = validatePreviewOperation(request);
    const adapterState = this.adapterState();
    const target = targetWithAdapterState(normalized.mode, normalized.operation, request.targetScope || context?.scope || {}, adapterState);
    const connection = this.context(context, target);
    this.purgeExpired();
    const adapterResult = await this.executionFacade.action({
      type: 'execution.adapter',
      operation: clone(normalized.operation)
    });
    // A disconnect, reload, rotation, expiry or adapter replacement can happen
    // while the existing adapter is producing its preview. Do not release the
    // newly-created adapter token into a stale bridge session.
    const currentConnection = this.context(context, target);
    if (currentConnection.connectionId !== connection.connectionId || currentConnection.generation !== connection.generation) {
      throw error('approval connection changed while previewing', 409, 'APPROVAL_CONNECTION_STALE');
    }
    const adapterDigest = text(String(adapterResult?.actionDigest || ''), 'adapter action digest', 200);
    const createdAt = this.time();
    const expiresAt = this.boundedExpiry(adapterResult, createdAt, connection);
    if (expiresAt <= createdAt) throw error('adapter approval is already expired', 409, 'APPROVAL_EXPIRED');
    const bound = { adapterDigest, mode: normalized.mode, executionMode: normalized.executionMode, targetScope: target, scopeKey: connection.scopeKey };
    const record = {
      previewToken: randomToken('preview'),
      mode: normalized.mode,
      executionMode: normalized.executionMode,
      adapter: normalized.mode,
      actionSummary: humanAction(normalized.mode, normalized.operation),
      targetSummary: humanTarget(normalized.mode, normalized.operation, adapterResult, adapterState),
      operation: normalized.operation,
      underlyingApprovalId: text(String(adapterResult?.approvalId || ''), 'adapter approval id', 500),
      underlyingToken: text(String(adapterResult?.token || ''), 'adapter approval token', 500),
      adapterDigest,
      digest: digest(bound),
      targetScope: target,
      sessionId: connection.sessionId,
      generation: connection.generation,
      connectionId: connection.connectionId,
      scopeKey: connection.scopeKey,
      expiresAt,
      currentValue: boundedCurrentValue(adapterResult),
      impact: {
        status: 'unavailable',
        summary: 'The adapter does not provide a bounded network or device impact analysis.',
        affectedTargets: clone(target.targets || [])
      },
      rollback: {
        available: false,
        status: 'unavailable',
        reason: 'Device rollback is unavailable for this adapter action. Chat revert cannot roll back an executed browser, desktop, or device action.'
      },
      status: 'previewed',
      approvalToken: '',
      consumed: false
    };
    record.recordId = `review-${crypto.randomUUID()}`;
    this.reviewLedger?.write(record);
    this.previews.set(record.previewToken, record);
    return this.publicReview(record);
  }

  getPreview(context, previewToken, expectedStatus) {
    const record = this.previews.get(text(previewToken, 'preview token', 500));
    if (!record) throw error('preview is unavailable or expired', 409, 'APPROVAL_PREVIEW_INVALID');
    const target = record.targetScope;
    const connection = this.context(context, target);
    if (record.sessionId !== connection.sessionId || record.generation !== connection.generation || record.connectionId !== connection.connectionId || record.scopeKey !== connection.scopeKey) {
      this.previews.delete(record.previewToken);
      throw error('preview session is stale', 409, 'APPROVAL_SESSION_STALE');
    }
    if (record.expiresAt <= this.time()) {
      this.previews.delete(record.previewToken);
      throw error('preview is expired', 409, 'APPROVAL_EXPIRED');
    }
    if (expectedStatus && record.status !== expectedStatus) throw error(`preview is not ${expectedStatus}`, 409, 'APPROVAL_STATE_INVALID');
    return record;
  }

  async review(context, request) {
    const record = this.getPreview(context, request?.previewToken);
    if (request?.digest !== undefined && !constantEqual(String(request.digest), record.digest)) {
      throw error('preview digest does not match the immutable review', 409, 'APPROVAL_DIGEST_MISMATCH');
    }
    return this.publicReview(record);
  }

  async approve(context, request) {
    const record = this.getPreview(context, request?.previewToken, 'previewed');
    if (request?.approved !== true) throw error('explicit approval is required', 403, 'APPROVAL_CONFIRMATION_REQUIRED');
    if (!constantEqual(String(request?.digest || ''), record.digest)) throw error('approval digest does not match the immutable review', 409, 'APPROVAL_DIGEST_MISMATCH');
    record.status = 'approved';
    record.approvalToken = randomToken('approval');
    this.approvals.set(record.approvalToken, record);
    this.reviewLedger?.mark(record, 'approved');
    return this.publicReview(record);
  }

  getApproval(context, approvalToken, digestValue) {
    const token = text(approvalToken, 'approval token', 500);
    const record = this.approvals.get(token) || [...this.previews.values()].find((item) => item.approvalToken === token);
    if (!record || record.status !== 'approved') throw error('approval is unavailable or expired', 409, 'APPROVAL_INVALID');
    const connection = this.context(context, record.targetScope);
    if (record.expiresAt <= this.time()) throw error('approval is expired', 409, 'APPROVAL_EXPIRED');
    if (digestValue !== undefined && (!constantEqual(String(digestValue), record.digest) || !constantEqual(String(digestValue), record.digest))) {
      record.status = 'unknown';
      record.consumed = true;
      this.reviewLedger?.mark(record, 'unknown');
      this.approvals.delete(token);
      throw error('approval digest mismatch; execution state is UNKNOWN and cannot be retried', 409, 'APPROVAL_UNKNOWN', { terminal: true, retry: false, unknown: true });
    }
    if (record.sessionId !== connection.sessionId || record.generation !== connection.generation || record.connectionId !== connection.connectionId || record.scopeKey !== connection.scopeKey) {
      throw error('approval session is stale', 409, 'APPROVAL_SESSION_STALE');
    }
    return record;
  }

  async execute(context, request) {
    this.purgeExpired();
    if (typeof request?.digest !== 'string' || !request.digest) throw error('execution requires the immutable approval digest', 409, 'APPROVAL_DIGEST_REQUIRED');
    const record = this.getApproval(context, request?.approvalToken, request?.digest);
    // Move to the consumed terminal state before crossing the adapter boundary.
    record.status = 'consumed';
    record.consumed = true;
    this.reviewLedger?.mark(record, 'consumed');
    this.approvals.delete(record.approvalToken);
    this.previews.delete(record.previewToken);
    const operation = {
      type: `${record.mode}.execute`,
      approvalId: record.underlyingApprovalId,
      token: record.underlyingToken
    };
    let result;
    try {
      result = await this.executionFacade.action({ type: 'execution.adapter', operation });
    } catch (cause) {
      this.reviewLedger?.mark(record, 'unknown');
      throw error('adapter execution state is UNKNOWN; the one-time approval was consumed and cannot be retried', 502, 'APPROVAL_UNKNOWN', { terminal: true, retry: false, unknown: true, cause });
    }
    try {
      const currentConnection = this.context(context, record.targetScope);
      if (record.expiresAt <= this.time() || currentConnection.expiresAt <= this.time() ||
        currentConnection.sessionId !== record.sessionId || currentConnection.generation !== record.generation ||
        currentConnection.connectionId !== record.connectionId || currentConnection.scopeKey !== record.scopeKey) {
        throw error('approval connection changed or expired during execution', 409, 'APPROVAL_CONNECTION_STALE');
      }
    } catch (cause) {
      this.reviewLedger?.mark(record, 'unknown');
      throw error('adapter execution state is UNKNOWN; the one-time approval was consumed and cannot be retried', 502, 'APPROVAL_UNKNOWN', { terminal: true, retry: false, unknown: true, cause });
    }
    if (!result || result.executed !== true || typeof result.actionDigest !== 'string' || !constantEqual(result.actionDigest, record.adapterDigest)) {
      this.reviewLedger?.mark(record, 'unknown');
      throw error('adapter execution state is UNKNOWN; the one-time approval was consumed and cannot be retried', 502, 'APPROVAL_UNKNOWN', { terminal: true, retry: false, unknown: true });
    }
    this.reviewLedger?.mark(record, 'executed');
    return {
      executed: true,
      mode: record.mode,
      adapterOwnedContext: record.mode === 'browser' ? 'headless browser context owned by the adapter' : 'desktop window session owned by the adapter',
      digest: record.digest,
      adapterDigest: record.adapterDigest,
      targetScope: clone(record.targetScope),
      rollback: clone(record.rollback),
      result: sanitizedDetail(result)
    };
  }

  cancel(context, request) {
    this.context(context);
    let removed = false;
    if (request?.previewToken) {
      const previewToken = String(request.previewToken);
      const preview = this.previews.get(previewToken);
      if (preview && ['previewed', 'approved'].includes(preview.status)) {
        preview.status = 'cancelled';
        this.reviewLedger?.mark(preview, 'cancelled');
        this.previews.delete(previewToken);
        if (preview.approvalToken) this.approvals.delete(preview.approvalToken);
        removed = true;
      }
    }
    if (request?.approvalToken) {
      const approvalToken = String(request.approvalToken);
      const approval = this.approvals.get(approvalToken) || [...this.previews.values()].find((item) => item.approvalToken === approvalToken);
      if (approval && approval.status === 'approved') {
        approval.status = 'cancelled';
        this.reviewLedger?.mark(approval, 'cancelled');
        this.approvals.delete(approvalToken);
        this.previews.delete(approval.previewToken);
        removed = true;
      }
    }
    return { cancelled: removed };
  }

  disconnect(context) {
    this.context(context);
    this.reviewLedger?.markSession(this.connectionManager.connection?.sessionId, this.connectionManager.connection?.generation, 'stale');
    this.previews.clear();
    this.approvals.clear();
    return this.connectionManager.disconnect(context);
  }

  reload(context) {
    this.context(context);
    this.reviewLedger?.markSession(this.connectionManager.connection?.sessionId, this.connectionManager.connection?.generation, 'stale');
    this.previews.clear();
    this.approvals.clear();
    return this.connectionManager.reload();
  }

  rotate(context) {
    this.context(context);
    this.reviewLedger?.markSession(this.connectionManager.connection?.sessionId, this.connectionManager.connection?.generation, 'stale');
    this.previews.clear();
    this.approvals.clear();
    return this.connectionManager.rotate();
  }

  status(context) {
    this.purgeExpired();
    if (context !== undefined) this.context(context);
    else if (this.connectionManager.connection) this.ensureAdapterIdentity();
    return { ...this.connectionManager.status(), pendingPreviews: this.previews.size, pendingApprovals: this.approvals.size, durableReviews: this.reviewLedger?.list() || [] };
  }

  close() {
    this.previews.clear();
    this.approvals.clear();
    this.reviewLedger?.close();
  }
}

function contextFromHeaders(headers) {
  return {
    origin: headerValue(headers, 'Origin'),
    header: headerValue(headers, 'X-Aven-Approval'),
    token: headerValue(headers, 'X-Aven-Approval-Token'),
    sessionId: headerValue(headers, 'X-Aven-Approval-Session'),
    generation: headerValue(headers, 'X-Aven-Approval-Generation'),
    connectionId: headerValue(headers, 'X-Aven-Approval-Connection'),
    scopeKey: headerValue(headers, 'X-Aven-Approval-Scope')
  };
}

function connectHeaders(headers) {
  return { origin: headerValue(headers, 'Origin'), header: headerValue(headers, 'X-Aven-Approval') };
}

function isDirectAdapterOperation(bodyOrOperation) {
  const input = bodyOrOperation && bodyOrOperation.type === 'execution.adapter'
    ? bodyOrOperation
    : bodyOrOperation?.operation && bodyOrOperation.operation.type === 'execution.adapter'
      ? bodyOrOperation.operation
      : null;
  return Boolean(input && ACTION_TYPES.has(input.operation?.type));
}

function assertNoDirectAdapterBypass({ pathname, body, headers } = {}) {
  if (pathname === '/api/action' && isDirectAdapterOperation(body)) {
    throw error('browser and desktop adapter preview/execute require the approval bridge', 403, 'APPROVAL_BRIDGE_REQUIRED', { bypass: true, origin: headerValue(headers, 'Origin') });
  }
  return true;
}

function response(status, body) { return { status, headers: { 'Cache-Control': 'no-store' }, body }; }

function createApprovalBridgeHttpApi({ bridge }) {
  if (!bridge || typeof bridge.connect !== 'function') throw error('approval bridge is required', 500, 'APPROVAL_BRIDGE_REQUIRED');
  return {
    async handle({ method, pathname, headers, body = {} }) {
      try {
        if (pathname === '/api/action') {
          assertNoDirectAdapterBypass({ pathname, body, headers });
          return response(404, { error: 'route not handled by approval bridge' });
        }
        if (pathname === '/api/approval-bridge/status' && method === 'GET') return response(200, bridge.status(contextFromHeaders(headers)));
        const connect = pathname === '/api/approval-bridge/connect';
        const context = connect ? connectHeaders(headers) : contextFromHeaders(headers);
        if (method !== 'POST') return response(405, { error: 'method not allowed' });
        if (connect) {
          if (context.header !== 'approval-bridge') throw error('approval bridge header is required', 403, 'APPROVAL_HEADER_REQUIRED');
          const result = bridge.connect({ ...body, origin: context.origin });
          return response(200, result);
        }
        const input = body || {};
        switch (pathname) {
          case '/api/approval-bridge/disconnect': return response(200, bridge.disconnect(context));
          case '/api/approval-bridge/reload': return response(200, bridge.reload(context));
          case '/api/approval-bridge/rotate': return response(200, bridge.rotate(context));
          case '/api/approval-bridge/preview': return response(200, await bridge.preview(context, input));
          case '/api/approval-bridge/review': return response(200, await bridge.review(context, input));
          case '/api/approval-bridge/approve': return response(200, await bridge.approve(context, input));
          case '/api/approval-bridge/execute': return response(200, await bridge.execute(context, input));
          case '/api/approval-bridge/cancel': return response(200, bridge.cancel(context, input));
          default: return response(404, { error: 'route not found' });
        }
      } catch (cause) {
        return response(Number(cause.statusCode || 400), {
          error: cause.code || 'APPROVAL_BRIDGE_REQUEST_INVALID',
          reasons: [cause.message || 'approval bridge request failed'],
          ...(cause.terminal ? { terminal: true, retry: false, unknown: true } : {})
        });
      }
    }
  };
}

module.exports = {
  ACTION_TYPES,
  PREVIEW_TYPES,
  EXECUTE_TYPES,
  DEFAULT_TOKEN_TTL_MS,
  ConnectionManager,
  ReviewLedger,
  createAdapterStateProvider,
  ApprovalBridge,
  createApprovalBridge: (options) => new ApprovalBridge(options),
  createApprovalBridgeHttpApi,
  contextFromHeaders,
  scopeKey,
  stable,
  digest,
  isDirectAdapterOperation,
  assertNoDirectAdapterBypass,
  sanitizedDetail,
  boundedCurrentValue,
  sensitiveInput
};
