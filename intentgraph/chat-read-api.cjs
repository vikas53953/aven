'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { validIdentity } = require('./reliability.cjs');

const CHAT_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RUN_FILE_RE = new RegExp(`^(${RUN_ID_PATTERN})\\.json$`, 'i');
const MAX_RUN_SCAN = 500;
const MAX_RUN_LIST = 50;
const MAX_RUN_FILE_BYTES = 8 * 1024 * 1024;

const PRIVATE_CONTROL_KEYS = new Set([
  'abort', 'abortcontroller', 'authorization', 'credential', 'credentialref',
  'headers', 'internal', 'password', 'pending', 'promise', 'request',
  'response', 'secret', 'signal', 'socket', 'steeringtoken', 'token',
  'controller', 'private', 'control', 'proto', 'apikey', 'permission', 'permissions', 'constructor', 'prototype'
]);

function isPrivateControlKey(key) {
  const normalized = String(key).toLowerCase().replace(/[_-]/g,'');
  return String(key).startsWith('_') || normalized.startsWith('$') ||
    PRIVATE_CONTROL_KEYS.has(normalized) ||
    /(?:secret|password|credential|authorization|steeringtoken|token)$/.test(normalized);
}

// Evidence output is deliberately treated as opaque text. Only object keys
// that carry private/control state are removed; raw strings are never edited.
function sanitizeRaw(value) {
  if (Array.isArray(value)) return value.map(sanitizeRaw);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (isPrivateControlKey(key)) continue;
    Object.defineProperty(output, key, {
      value: sanitizeRaw(child), enumerable: true, writable: true, configurable: true
    });
  }
  return output;
}

function jsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...jsonHeaders(), 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res, status, error) {
  sendJson(res, status, { error });
}

function isSamePath(left, right) {
  const normalize = (value) => path.normalize(value).replace(/[\\/]$/, '');
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function validChatId(value) {
  return typeof value === 'string' && CHAT_ID_RE.test(value);
}

function validRunId(value) {
  return typeof value === 'string' && RUN_ID_RE.test(value);
}

function eventTimestamp(event) {
  return typeof event?.at === 'string' && event.at ? event.at : null;
}

function metadataFor(record, file) {
  const events = Array.isArray(record.events) ? record.events : [];
  const failed = events.some((event) => event && event.type === 'failed');
  const startedAt = events.map(eventTimestamp).find(Boolean) || null;
  const endedAt = [...events].reverse().map(eventTimestamp).find(Boolean) || null;
  const reply = record.reply && typeof record.reply === 'object' ? record.reply : null;
  return {
    runId: record.runId,
    chatId: record.chatId,
    status: failed ? 'failed' : (reply ? 'completed' : 'incomplete'),
    startedAt,
    endedAt,
    model: typeof reply?.model === 'string' ? reply.model : null,
    source: typeof reply?.source === 'string' ? reply.source : null,
    evidenceCount: Array.isArray(reply?.evidence) ? reply.evidence.length : 0,
    lastModified: new Date(file.mtimeMs).toISOString()
  };
}

function projectProviderCheck(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const projected = {};
  for (const key of ['ok', 'at', 'code', 'classification', 'status', 'durationMs']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) projected[key] = value[key];
  }
  return Object.keys(projected).length ? projected : null;
}

function projectActiveRuns(value) {
  let runs;
  try { runs = typeof value === 'function' ? value() : value; } catch { return []; }
  if (!Array.isArray(runs)) return [];
  return runs.map((run) => {
    try {
      if (!validChatId(run?.chatId) || !validRunId(run?.runId) || typeof run?.phase !== 'string') return null;
      return { chatId: run.chatId, runId: run.runId, phase: run.phase };
    } catch { return null; }
  }).filter(Boolean);
}

function extractRunId(fileName) {
  const match = RUN_FILE_RE.exec(fileName);
  return match ? match[1] : null;
}

function createChatReadApi(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const runsDirectory = path.join(root, '.intentgraph', 'evidence', 'runs');
  const getExecutionStatus = options.getExecutionStatus || (async () => null);
  const getActiveRuns = options.getActiveRuns || (() => []);
  const chatOriginAllowed = options.chatOriginAllowed || (() => false);
  const fileOps = {
    readdir: options.fileOps?.readdir || fsp.readdir,
    lstat: options.fileOps?.lstat || fsp.lstat,
    realpath: options.fileOps?.realpath || fsp.realpath,
    readFile: options.fileOps?.readFile || fsp.readFile
  };

  async function inspectCandidate(fileName, expectedRunId) {
    const runId = extractRunId(fileName);
    if (!runId || (expectedRunId && runId.toLowerCase() !== expectedRunId.toLowerCase())) return null;
    const candidate = path.join(runsDirectory, fileName);
    let stat;
    try {
      stat = await fileOps.lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RUN_FILE_BYTES) return null;
      const real = await fileOps.realpath(candidate);
      if (!isSamePath(candidate, real)) return null;
      const data = await fileOps.readFile(candidate);
      if (data.length > MAX_RUN_FILE_BYTES) return null;
      const record = JSON.parse(data.toString('utf8'));
      if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
      if (typeof record.runId !== 'string' || record.runId.toLowerCase() !== runId.toLowerCase()) return null;
      if (!validChatId(record.chatId)) return null;
      return { record, file: { mtimeMs: stat.mtimeMs, size: data.length }, runId };
    } catch { return null; }
  }

  async function listRuns(chatId) {
    let entries;
    try { entries = await fileOps.readdir(runsDirectory); } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const candidates = [];
    let scanned = 0;
    for (const fileName of entries) {
      if (!extractRunId(fileName)) continue;
      if (scanned >= MAX_RUN_SCAN) break;
      scanned += 1;
      const inspected = await inspectCandidate(fileName);
      if (inspected) candidates.push({ ...inspected, fileName });
    }
    candidates.sort((left, right) => right.file.mtimeMs - left.file.mtimeMs);
    return candidates.filter((item) => item.record.chatId === chatId)
      .slice(0, MAX_RUN_LIST)
      .map((item) => metadataFor(item.record, item.file));
  }

  async function readRun(runId, chatId) {
    const inspected = await inspectCandidate(`${runId}.json`, runId);
    if (!inspected || inspected.record.chatId !== chatId) return null;
    return sanitizeRaw(inspected.record);
  }

  function routeKind(pathname) {
    if (pathname === '/api/chat/status') return { type: 'status' };
    if (pathname === '/api/chat/receipt') return { type: 'receipt' };
    if (pathname === '/api/chat/runs') return { type: 'list' };
    if (pathname.startsWith('/api/chat/runs/')) {
      const suffix = pathname.slice('/api/chat/runs/'.length);
      if (!validRunId(suffix)) return { type: 'invalid-run' };
      return { type: 'run', runId: suffix };
    }
    return null;
  }

  async function handle(req, res) {
    const parsed = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const kind = routeKind(parsed.pathname);
    if (!kind) return false;

    const origin = req.headers.origin;
    if (!chatOriginAllowed(origin, req)) {
      sendError(res, 403, 'Forbidden');
      return true;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Chat');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(204);
      res.end();
      return true;
    }
    if (req.method !== 'GET') {
      sendError(res, 405, 'Method not allowed');
      return true;
    }
    if (req.headers['x-aven-chat'] !== 'text-only') {
      sendError(res, 403, 'Forbidden');
      return true;
    }
    if (kind.type === 'invalid-run') {
      sendError(res, 404, 'Run not found');
      return true;
    }
    try {
      if (kind.type === 'status') {
        const execution = await getExecutionStatus();
        const provider = execution?.provider || {};
        const providerLastCheck = projectProviderCheck(execution?.providerLastCheck ?? execution?.lastConnection ?? provider.last);
        sendJson(res, 200, {
          provider: 'OpenCode Go',
          model: 'mimo-v2.5',
          configured: Boolean(provider.credentialStored ?? provider.configured),
          providerLastCheck,
          lastChecked: new Date().toISOString(),
          reachability: 'unverified',
          serial: { activeRuns: projectActiveRuns(getActiveRuns) }
        });
        return true;
      }

      const chatId = parsed.searchParams.get('chatId');
      if (!validChatId(chatId) || parsed.searchParams.getAll('chatId').length !== 1) {
        sendError(res, 400, 'Invalid chat id');
        return true;
      }
      if (kind.type === 'receipt') {
        const requestId = parsed.searchParams.get('requestId');
        if (!validIdentity(requestId) || parsed.searchParams.getAll('requestId').length !== 1) { sendError(res, 400, 'Invalid request id'); return true; }
        const receipt = options.getReceipt?.(chatId, requestId);
        if (!receipt) { sendError(res, 404, 'Receipt not found'); return true; }
        sendJson(res, 200, { receipt });
        return true;
      }
      if (kind.type === 'list') {
        sendJson(res, 200, { chatId, runs: await listRuns(chatId) });
        return true;
      }
      const record = await readRun(kind.runId, chatId);
      if (!record) {
        sendError(res, 404, 'Run not found');
        return true;
      }
      sendJson(res, 200, record);
      return true;
    } catch {
      sendError(res, 503, 'Local status unavailable');
      return true;
    }
  }

  return { handle, listRuns, readRun, sanitizeRaw, runsDirectory };
}

module.exports = {
  CHAT_ID_RE,
  RUN_ID_RE,
  MAX_RUN_SCAN,
  MAX_RUN_LIST,
  MAX_RUN_FILE_BYTES,
  createChatReadApi,
  sanitizeRaw
};
