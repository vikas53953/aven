'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { IndexStore, isInside, normalizeRelative } = require('./indexer.cjs');
const { IntentEngine } = require('./engine.cjs');
const { createChatReadApi } = require('./chat-read-api.cjs');
const { createAdmission, validIdentity, replyOutcome } = require('./reliability.cjs');
const { extractQuestion } = require('./clarification-workflow.cjs');

const DEFAULT_PORT = 8768;
const DEFAULT_HOST = '127.0.0.1';
const BODY_LIMIT = 2 * 1024 * 1024;
const MAX_STEERING_MESSAGES = 8;
const MAX_STEERING_MESSAGE_CHARS = 4000;
const CHAT_MODES = Object.freeze(['inspect', 'plan']);
const ALLOWED_STATIC_EXTENSIONS = new Set(['.html', '.css', '.js', '.cjs', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ico']);

function jsonHeaders() {
  return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...jsonHeaders(), 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res, status, error, reasons) {
  const list = reasons || error.reasons || (error.message ? [error.message] : ['request failed']);
  sendJson(res, status, { error: error.code || error.message || 'request failed', reasons: list });
}

function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const raw = String(hostHeader).trim();
  const host = raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : raw.split(':')[0];
  const normalized = host.toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function originAllowed(origin, req) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return false;
    const requestHost = String(req.headers.host || '').trim();
    const requestRaw = requestHost.startsWith('[') ? requestHost.slice(1, requestHost.indexOf(']')) : requestHost.split(':')[0];
    if (host !== requestRaw.toLowerCase()) return false;
    const port = parsed.port || '80';
    const localPort = String(req.socket.localPort || DEFAULT_PORT);
    return port === localPort;
  } catch { return false; }
}

function chatOriginAllowed(origin, req) {
  return origin === 'http://127.0.0.1:8767' || origin === `http://127.0.0.1:${req.socket.localPort}`;
}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSteeringRun(runId, chatId, steeringToken) {
  let phase = 'open';
  let acceptedCount = 0;
  const queue = [];
  return {
    runId,
    chatId,
    steeringToken,
    get phase() { return phase; },
    beginClosing() { if (phase === 'open') phase = 'closing'; },
    wait() { phase = 'waiting-question'; },
    drainSteering() {
      if (phase !== 'open' || !queue.length) return [];
      return queue.splice(0, queue.length);
    },
    close() {
      if (phase === 'closed') return [];
      phase = 'closed';
      return queue.splice(0, queue.length);
    },
    accept(text) {
      if (phase !== 'open') return { accepted: false, reason: 'closing' };
      if (acceptedCount >= MAX_STEERING_MESSAGES) return { accepted: false, reason: 'full' };
      const id = crypto.randomUUID();
      acceptedCount += 1;
      queue.push({ id, message: text });
      return { accepted: true, id };
    },
    matchesToken(value) { return sameSecret(value, steeringToken); }
  };
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.cjs': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        reject(Object.assign(new Error('request body exceeds size cap'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) { reject(Object.assign(new Error('request body must be valid JSON'), { statusCode: 400, cause: error })); }
    });
    req.on('error', reject);
  });
}

function createServer(options = {}) {
  const root = fs.realpathSync(path.resolve(options.root || path.resolve(__dirname, '..')));
  const runtimeDirectory = path.resolve(options.runtimeDirectory || path.join(root, '.intentgraph', 'runtime'));
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const admission = options.admission || createAdmission({ directory: runtimeDirectory });
  const hub = new Set();
  const token = crypto.randomBytes(32).toString('base64url');
  const indexer = new IndexStore(root, runtimeDirectory);
  const engine = new IntentEngine(root, indexer, runtimeDirectory);
  const ready = engine.initialize();
  const sandbox = options.sandbox || require('./catalyst.cjs').createCatalystClient({runtimeDirectory});
  const execution = options.execution === false ? null : require('./execution-service.cjs').createExecutionService({root,engine,runtimeDirectory,...(options.executionOptions||{})});
  const networkExecution = execution?.adapters ? require('./network-execution.cjs').createNetworkExecution({catalyst:sandbox,adapters:execution.adapters}) : sandbox;
  let watcher = null;
  let periodic = null;
  let debounce = null;
  const activeRuns = new Map();
  const waitingRuns = new Map();
  const chatReadApi = createChatReadApi({
    root,
    getExecutionStatus: () => execution ? execution.status() : null,
    getActiveRuns: () => Array.from(activeRuns.values()),
    getReceipt: (chatId, requestId) => admission.read(chatId, requestId),
    chatOriginAllowed
  });

  const publish = (event) => {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of hub) {
      try { response.write(message); } catch { hub.delete(response); }
    }
  };
  engine.subscribe(publish);

  function scheduleRefresh(reason) {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      engine.refresh(reason).catch(() => undefined);
    }, 250);
  }

  function startWatchers() {
    if (watcher || periodic) return;
    try {
      watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const normalized = normalizeRelative(String(filename));
        if (normalized.startsWith('.intentgraph/runtime/')) return;
        scheduleRefresh('watch');
      });
      watcher.on('error', () => { watcher = null; });
    } catch { watcher = null; }
    periodic = setInterval(() => scheduleRefresh('periodic-rescan'), Number(options.rescanMs || 5000));
    periodic.unref?.();
  }

  function closeWatchers() {
    if (debounce) clearTimeout(debounce);
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    if (periodic) clearInterval(periodic);
    periodic = null;
    for (const response of hub) { try { response.end(); } catch {} }
    hub.clear();
  }

  async function staticFile(res, requestPath) {
    const uiRoot = path.join(__dirname, 'ui');
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    if (requestPath.startsWith('/api/')) return false;
    const candidate = path.resolve(uiRoot, relative);
    if (!isInside(uiRoot, candidate) || !ALLOWED_STATIC_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return false;
    let real;
    try { real = fs.realpathSync(candidate); } catch { return false; }
    if (!isInside(uiRoot, real)) return false;
    let data;
    try { data = await fsp.readFile(real); } catch { return false; }
    res.writeHead(200, { 'Content-Type': mimeType(real), 'Cache-Control': 'no-store', 'Content-Length': data.length });
    res.end(data);
    return true;
  }

  async function dispatchChat(req, res, context) {
    const { request: body, receipt } = context, request = body, mode = body.mode;
      const controller = new AbortController();
      const streaming = req.headers.accept === 'application/x-ndjson';
      const runId = receipt.runId, steeringToken = crypto.randomBytes(32).toString('base64url'), events = context.events;
      const runState = createSteeringRun(runId, body.chatId, steeringToken);
      activeRuns.set(runId, runState);
      const disconnected = () => { if (!res.writableEnded) { runState.beginClosing(); controller.abort(); } }; res.once('close', disconnected);
      let completedReply = null, waiting = false;
      const emit = (event) => {
        const safe = { ...event, runId, at: new Date().toISOString() };
        const { steeringToken: _discardedToken, answerToken: _answerToken, ...persisted } = safe;
        if (events.length < 100) events.push(persisted);
        if (streaming && !res.destroyed) res.write(JSON.stringify(safe) + '\n');
      };
      runState.emit = emit;
      if (streaming) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      emit({ type: 'start', segmentId: context.segmentId || null, message: 'Starting network coworker investigation', mode, requestId: request.requestId, receipt, ...(streaming ? { steeringToken } : {}) });
      if (context.segmentId) emit({ type: 'question_answered', question: admission.workflow.read(body.chatId, request.requestId, runId) });
      let failure = null;
      try {
        const responder = context.responder;
        const reply = await responder({ provider: context.provider, runId, segmentId: context.segmentId || null, clarificationAnswered: Boolean(context.segmentId), sandbox: networkExecution, messages: body.messages, agentName: body.agentName, chatId: body.chatId, mode, signal: controller.signal, onEvent: emit, drainSteering: runState.drainSteering, onModelComplete: runState.beginClosing });
        if (controller.signal.aborted) throw Error('Run stopped');
        const question = extractQuestion(reply);
        if (question) {
          if (context.segmentId) throw Error('Only one clarification is supported per request');
          const pending = admission.workflow.waiting(receipt, question, mode, reply.model);
          context.question = pending.question;
          waitingRuns.set(runId, context);
          for (const queued of runState.close()) emit({ type: 'steer_pending', id: queued.id, message: queued.message });
          runState.wait(); waiting = true;
          emit({ type: 'question', ...pending, receipt });
          if (!streaming && !res.destroyed) sendJson(res, 200, { waiting: true, ...pending, receipt, runId, mode });
        } else completedReply = { ...reply, runId, mode, requestId: request.requestId, status: replyOutcome(reply, events, controller.signal.aborted) };
      } catch (error) {
        const messages = { provider_401: 'OpenCode authentication failed.', provider_429: 'OpenCode rate limit reached.', provider_timeout: 'OpenCode timed out.', provider_key_unavailable: 'OpenCode key is unavailable locally.' };
        failure = controller.signal.aborted ? 'Run cancelled; any submitted remote command may still finish.' : messages[error.code] || 'The agent run could not finish. Review the activity; submitted commands were not automatically retried.';
        emit({ type: 'failed', message: failure, status: 'UNKNOWN' });
      } finally {
        if (waiting) {
          // Ending this transport does not settle the run or release ownership.
          if (streaming && !res.destroyed) res.end();
          res.removeListener('close', disconnected);
        } else {
        runState.beginClosing();
        for (const pending of runState.close()) emit({ type: 'steer_pending', id: pending.id, message: pending.message });
        let settled;
        try {
          const dir = path.join(root, '.intentgraph', 'evidence', 'runs');
          fs.mkdirSync(dir, { recursive: true });
          const finalEvents = [...events, ...(completedReply ? [{ type: 'final', runId, at: new Date().toISOString(), reply: completedReply }] : []), { type: 'end', runId, at: new Date().toISOString() }];
          const record = { runId, chatId: body.chatId, requestId: request.requestId, events: finalEvents, reply: completedReply };
          if (options.persistChatEvidence) options.persistChatEvidence(record);
          else {
            const fd = fs.openSync(path.join(dir, runId + '.json'), 'wx', 0o600);
            try { fs.writeFileSync(fd, JSON.stringify(record, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          }
          settled = admission.settle(receipt, completedReply?.status || 'UNKNOWN', true);
        } catch {
          failure = 'Run completion could not be saved. Remote completion is unknown. Check the saved receipt before continuing; no request was retried.';
          emit({ type: 'failed', message: failure, status: 'UNKNOWN' });
        }
        if (settled && completedReply) {
          completedReply.receipt = settled;
          const question = admission.workflow.read(body.chatId, request.requestId, runId);
          if (question) completedReply.question = question;
          emit({ type: 'final', reply: completedReply });
          if (!streaming && !res.destroyed) sendJson(res, 200, completedReply);
        } else if (!streaming && !res.destroyed) sendJson(res, 502, { error: failure, receipt: settled || receipt });
        emit({ type: 'end', receipt: settled || receipt });
        if (streaming && !res.destroyed) res.end();
        res.removeListener('close', disconnected); activeRuns.delete(runId); waitingRuns.delete(runId); admission.release(runId);
      }
      }
  }

  async function route(req, res) {
    if (!isLoopbackHost(req.headers.host)) { sendError(res, 400, new Error('Host must be loopback')); return; }
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsed.pathname;
    if (await chatReadApi.handle(req, res)) return;
    if (['/api/chat/question', '/api/chat/question/answer', '/api/chat/question/cancel'].includes(pathname)) {
      const origin = req.headers.origin;
      if (!chatOriginAllowed(origin, req)) { sendError(res, 403, new Error('Chat origin is not allowed')); return; }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      const reading = pathname === '/api/chat/question';
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', reading ? 'GET' : 'POST'); res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Chat, Content-Type'); res.writeHead(204); res.end(); return; }
      if (req.method !== (reading ? 'GET' : 'POST')) { sendError(res, 405, new Error('Method not allowed')); return; }
      if (req.headers['x-aven-chat'] !== 'text-only') { sendError(res, 403, new Error('Chat request header required')); return; }
      try {
        const body = reading ? Object.fromEntries(parsed.searchParams) : await parseBody(req);
        const allowed = reading ? ['chatId','requestId','runId'] : ['chatId','requestId','runId','questionId','revision', ...(pathname.endsWith('/answer') ? ['answerToken','answer'] : [])];
        if (!body || Object.keys(body).some(k => !allowed.includes(k)) || reading && [...parsed.searchParams.keys()].length !== Object.keys(body).length || !validIdentity(body.chatId) || !validIdentity(body.requestId) || typeof body.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.runId) || !reading && (!validIdentity(body.questionId) || typeof body.revision !== 'string' || !/^[0-9a-f]{64}$/.test(body.revision))) { sendError(res, 400, new Error('The exact question and request scope is required')); return; }
        if (reading) {
          const question = admission.workflow.read(body.chatId, body.requestId, body.runId);
          if (!question) { sendError(res, 404, new Error('Question not found')); return; }
          sendJson(res, 200, { question, receipt: admission.read(body.chatId, body.requestId) }); return;
        }
        if (pathname.endsWith('/cancel')) {
          const question = admission.workflow.cancel(body);
          waitingRuns.delete(body.runId); activeRuns.delete(body.runId); admission.release(body.runId);
          sendJson(res, 200, { question, receipt: admission.read(body.chatId, body.requestId) }); return;
        }
        const context = waitingRuns.get(body.runId);
        let decision;
        try { decision = admission.workflow.answer(body, Boolean(context && !context.segmentId)); }
        catch (error) {
          // A commit may have succeeded even when its acknowledgement was lost.
          // Make accepted-but-undispatched state explicitly recoverable, not replayable.
          let saved;
          try { saved = admission.workflow.read(body.chatId, body.requestId, body.runId); } catch {}
          if (saved?.phase === 'answered' && context && !context.segmentId) {
            waitingRuns.delete(body.runId); activeRuns.delete(body.runId); admission.release(body.runId);
          }
          throw error;
        }
        if (decision.duplicate) { sendJson(res, 200, { ...decision, receipt: admission.read(body.chatId, body.requestId) }); return; }
        // No await between durable consume, in-memory invalidation and dispatch
        // fence. A lost response or second process can read but never replay.
        context.segmentId = decision.question.segmentId;
        waitingRuns.delete(body.runId);
        try { admission.workflow.dispatch(body); }
        catch (error) { activeRuns.delete(body.runId); admission.release(body.runId); throw error; }
        context.request = { ...context.request, messages: [...context.request.messages,
          { role: 'assistant', content: 'Clarification: ' + decision.question.prompt },
          { role: 'user', content: decision.question.answer.text }] };
        await dispatchChat(req, res, context);
      } catch (error) { if (!res.headersSent) sendError(res, error.statusCode || 503, error.statusCode ? error : new Error('Local question storage unavailable. Check saved state; no continuation was retried.')); else res.end(); }
      return;
    }
    if (pathname === '/api/chat/steer') {
      const origin = req.headers.origin;
      if (!chatOriginAllowed(origin, req)) { sendError(res, 403, new Error('Chat origin is not allowed')); return; }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Chat, Content-Type');
        res.writeHead(204); res.end(); return;
      }
      if (req.method !== 'POST') { sendError(res, 405, new Error('Method not allowed')); return; }
      if (req.headers['x-aven-chat'] !== 'text-only') { sendError(res, 403, new Error('Chat request header required')); return; }
      let body;
      try { body = await parseBody(req); } catch { sendError(res, 400, new Error('Invalid steering request')); return; }
      if (!body || Object.keys(body).some((key) => !['runId', 'chatId', 'steeringToken', 'text'].includes(key)) || typeof body.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.runId) || typeof body.chatId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.chatId) || typeof body.steeringToken !== 'string' || !body.steeringToken || typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_STEERING_MESSAGE_CHARS) {
        sendError(res, 400, new Error(`Steering requires a run, chat, token and text within ${MAX_STEERING_MESSAGE_CHARS} characters`)); return;
      }
      const run = activeRuns.get(body.runId);
      if (!run || run.chatId !== body.chatId || run.phase !== 'open') { sendError(res, 409, new Error('The chat run is closing or unavailable')); return; }
      if (!run.matchesToken(body.steeringToken)) { sendError(res, 403, new Error('Steering token is invalid')); return; }
      const accepted = run.accept(body.text);
      if (!accepted.accepted) { sendError(res, 409, new Error(accepted.reason === 'full' ? 'The steering queue is full' : 'The chat run is closing or unavailable')); return; }
      run.emit?.({ type: 'steer_received', id: accepted.id });
      sendJson(res, 200, { accepted: true, id: accepted.id });
      return;
    }
    if (pathname === '/api/chat/recover') {
      const origin = req.headers.origin;
      if (!chatOriginAllowed(origin, req)) { sendError(res, 403, new Error('Chat origin is not allowed')); return; }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Chat, Content-Type'); res.writeHead(204); res.end(); return; }
      if (req.method !== 'POST') { sendError(res, 405, new Error('Method not allowed')); return; }
      if (req.headers['x-aven-chat'] !== 'text-only') { sendError(res, 403, new Error('Chat request header required')); return; }
      let body;
      try { body = await parseBody(req); } catch { sendError(res, 400, new Error('Invalid recovery request')); return; }
      if (!body || Object.keys(body).some(k => !['chatId', 'requestId', 'runId'].includes(k)) || !validIdentity(body.chatId) || !validIdentity(body.requestId) || typeof body.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.runId)) { sendError(res, 400, new Error('Recovery requires the exact chat, request and run')); return; }
      try { sendJson(res, 200, { receipt: admission.recover(body.chatId, body.requestId, body.runId) }); }
      catch (error) { sendError(res, error.statusCode || 503, error.statusCode ? error : new Error('Local receipt storage unavailable. No work was retried.')); }
      return;
    }
    if (pathname === '/api/chat') {
      const origin = req.headers.origin;
      if (!chatOriginAllowed(origin, req)) { sendError(res, 403, new Error('Chat origin is not allowed')); return; }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Chat, Content-Type'); res.writeHead(204); res.end(); return; }
      if (req.method !== 'POST') { sendError(res, 405, new Error('Method not allowed')); return; }
      if (req.headers['x-aven-chat'] !== 'text-only') { sendError(res, 403, new Error('Chat request header required')); return; }
      let body;
      try { body = await parseBody(req); } catch { sendError(res, 400, new Error('Invalid chat request')); return; }
      const mode = body?.mode === undefined ? 'inspect' : body.mode;
      const hasIdentity = body?.requestId !== undefined || body?.idempotencyKey !== undefined;
      if (!body || Object.keys(body).some(k => !['chatId', 'agentName', 'messages', 'mode', 'requestId', 'idempotencyKey'].includes(k)) || !CHAT_MODES.includes(mode) || !validIdentity(body.chatId) || typeof body.agentName !== 'string' || body.agentName.length > 80 || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 24 || body.messages.some(m => !m || Object.keys(m).some(k => !['role', 'content'].includes(k)) || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) || body.messages.at(-1).role !== 'user' || body.messages.reduce((n, m) => n + m.content.length, 0) > 32000 || hasIdentity && (!validIdentity(body.requestId) || !validIdentity(body.idempotencyKey))) { sendError(res, 400, new Error('Chat requires up to 24 text messages, mode plan or inspect, and both request identity fields when supplied')); return; }
      if (!execution?.provider) { sendError(res, 503, new Error('Chat provider is unavailable')); return; }
      // Legacy clients remain accepted, but cannot claim replay protection.
      const request = { ...body, mode, requestId: hasIdentity ? body.requestId : crypto.randomUUID(), idempotencyKey: hasIdentity ? body.idempotencyKey : crypto.randomUUID() };
      let claim;
      try { claim = admission.claim(request); }
      catch (error) { sendError(res, error.statusCode || 503, error.statusCode ? error : new Error('Local receipt storage unavailable. No request was dispatched.')); return; }
      if (claim.duplicate) { sendJson(res, 200, { duplicate: true, receipt: admission.read(body.chatId, request.requestId) }); return; }
      const receipt = claim.receipt;
      await dispatchChat(req, res, { request, receipt, provider: execution.provider, responder: options.chatResponder || require('./agent-runtime.cjs').respond, events: [] });
      return;
    }
    if (pathname === '/api/sandbox/status' || pathname === '/api/sandbox/inventory') {
      const origin = req.headers.origin;
      if (origin !== 'http://127.0.0.1:8767' && origin !== `http://127.0.0.1:${req.socket.localPort}`) {
        sendError(res, 403, new Error('Sandbox origin is not allowed')); return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Sandbox, Content-Type');
        res.writeHead(204); res.end(); return;
      }
      try {
        if (pathname.endsWith('/status') && req.method === 'GET') { sendJson(res, 200, await sandbox.status()); return; }
        if (pathname.endsWith('/inventory') && req.method === 'POST') {
          if (req.headers['x-aven-sandbox'] !== 'read-only') { sendError(res, 403, new Error('Sandbox request header required')); return; }
          const body = await parseBody(req);
          if (Object.keys(body).length) { sendError(res, 400, new Error('Inventory accepts no parameters')); return; }
          sendJson(res, 200, await sandbox.inventory()); return;
        }
        sendError(res, 405, new Error('Method not allowed')); return;
      } catch { sendError(res, 502, new Error('Cisco sandbox unavailable. Check the local connection and approved certificate.')); return; }
    }
    if (req.method === 'GET') {
      try {
        await ready;
        if (pathname === '/api/session') { sendJson(res, 200, { token, csrfToken: token }); return; }
        if (pathname === '/api/capabilities') { const current=execution ? await execution.status() : null; sendJson(res, 200, {ai:{connected:Boolean(current?.provider?.last?.ok),configured:Boolean(current?.provider?.credentialStored),provider:current?'opencode-go':null,model:current?'mimo-v2.5':null},runtime:{dispatch:Boolean(current?.provider?.credentialStored && current?.provider?.last?.ok),dispatchAvailable:Boolean(current),shell:false,device:false,deviceAdapterAvailable:Boolean(current?.adapters?.network?.available)},execution:current}); return; }
        if (pathname === '/api/execution') { if(!execution)throw new Error('Execution is disabled for this service');sendJson(res,200,await execution.status());return; }
        if (pathname === '/api/execution/artifact') {
          const relative=parsed.searchParams.get('path')||'';
          const artifactRoot=path.join(runtimeDirectory,'adapters');
          const candidate=path.resolve(root,relative);
          const real=await fsp.realpath(candidate);
          if(!isInside(artifactRoot,real)||!['.png','.jpg','.jpeg','.webp'].includes(path.extname(real).toLowerCase()))throw Error('Artifact is not available');
          const stat=await fsp.stat(real);if(!stat.isFile()||stat.size>10*1024*1024)throw Error('Artifact exceeds size limit');
          const data=await fsp.readFile(real);res.writeHead(200,{'Content-Type':mimeType(real),'Cache-Control':'no-store','Content-Length':data.length});res.end(data);return;
        }
        if (pathname === '/api/index') { sendJson(res, 200, await engine.getIndex()); return; }
        if (pathname === '/api/state') { sendJson(res, 200, await engine.getState()); return; }
        if (pathname === '/api/source') { sendJson(res, 200, await engine.getSource(parsed.searchParams.get('path') || '')); return; }
        if (pathname === '/api/diff') { sendJson(res, 200, await engine.getDiff(parsed.searchParams.get('path') || '')); return; }
        if (pathname === '/api/gate') { sendJson(res, 200, await engine.getGate(parsed.searchParams.get('taskId') || '')); return; }
        if (pathname === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(': connected\n\n');
          const state = await engine.getState();
          for (const event of state.events.slice(-100)) res.write(`data: ${JSON.stringify(event)}\n\n`);
          hub.add(res);
          req.on('close', () => hub.delete(res));
          return;
        }
        if (await staticFile(res, pathname)) return;
        sendError(res, 404, new Error('route not found'));
      } catch (error) { sendError(res, error.statusCode || 404, error); }
      return;
    }
    if (req.method === 'POST') {
      if (pathname !== '/api/action') { sendError(res, 404, new Error('route not found')); return; }
      if (req.headers['x-intentgraph-token'] !== token) { sendError(res, 403, new Error('invalid intentgraph token')); return; }
      if (!originAllowed(req.headers.origin, req)) { sendError(res, 403, new Error('Origin must be the local IntentGraph origin')); return; }
      try {
        await ready;
        const body = await parseBody(req);
        const result = String(body.type||'').startsWith('execution.') ? await execution?.action(body) : await engine.action(body);
        if(String(body.type||'').startsWith('execution.')&&!execution)throw Error('Execution is disabled for this service');
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendError(res, error.statusCode || (error.gate ? 409 : 400), error, error.reasons || (error.gate && error.gate.reasons));
      }
      return;
    }
    sendError(res, 405, new Error('method not allowed'));
  }

  const server = http.createServer((req, res) => { route(req, res).catch((error) => sendError(res, 500, error)); });
  server.once('listening', startWatchers);
  server.once('close', () => { try { sandbox.close(); } finally { admission.close(); } });
  const originalClose = server.close.bind(server);
  server.close = (callback) => { closeWatchers(); if(execution){Promise.resolve(execution.close()).catch(()=>{}).finally(()=>originalClose(callback));return server;}return originalClose(callback); };
  server.intentGraph = { root, runtimeDirectory, token, engine, indexer, ready, startWatchers, closeWatchers, execution, admission };
  return server;
}

async function start(options = {}) {
  const server = createServer(options);
  await server.intentGraph.ready;
  const port = Number(options.port ?? DEFAULT_PORT);
  const host = options.host || DEFAULT_HOST;
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const portIndex = args.indexOf('--port');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : path.resolve(__dirname, '..');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : DEFAULT_PORT;
  start({ root, port }).then((server) => {
    process.stdout.write(`IntentGraph listening at http://127.0.0.1:${server.address().port}\n`);
  }).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}

module.exports = { createServer, start, isLoopbackHost, originAllowed, chatOriginAllowed, CHAT_MODES, MAX_STEERING_MESSAGES, MAX_STEERING_MESSAGE_CHARS };


