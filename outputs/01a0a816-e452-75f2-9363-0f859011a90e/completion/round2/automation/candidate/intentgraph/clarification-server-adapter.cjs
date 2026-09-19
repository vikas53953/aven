'use strict';

// Candidate HTTP boundary for the clarification and approval lifecycle. The
// host server owns origin/auth policy and can mount handle(req, res) after its
// existing chat-read routes. This adapter never selects a provider and never
// performs a live device or network write.

const { WorkflowError } = require('./approval-workflow.cjs');

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
});

function safeClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function asError(error) {
  const code = error?.code || 'workflow_request_failed';
  const status = {
    invalid_input: 400,
    run_not_found: 404,
    question_not_pending: 409,
    stale_question: 409,
    question_expired: 409,
    token_invalid: 403,
    invalid_question_token: 403,
    invalid_approval_token: 403,
    approval_not_pending: 409,
    approval_exists: 409,
    approval_expired: 409,
    approval_not_approved: 409,
    stale_approval: 409,
    ownership_mismatch: 409,
    run_not_running: 409,
    replay_rejected: 409,
    scope_mismatch: 409,
    action_mismatch: 409,
    question_binding_mismatch: 409,
    state_conflict: 409,
    credential_input: 400,
    execution_unknown: 502,
    proposal_not_found: 404,
    approval_not_found: 404,
    plan_execution_forbidden: 409,
    executor_unavailable: 503,
    state_invalid: 409,
    state_store_unavailable: 503
  }[code] || 400;
  return { status, body: { error: code, reasons: [error?.message || 'Workflow request failed.'] } };
}

function readJson(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let raw = '';
    req.setEncoding?.('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) reject(Object.assign(new Error('Workflow request is too large.'), { code: 'invalid_input' }));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Workflow request JSON is invalid.'), { code: 'invalid_input' })); }
    });
    req.on('error', reject);
  });
}

function createWorkflowApi({ manager, originAllowed, requestHeader = 'text-only', pathPrefix = '/api/chat/workflow' } = {}) {
  if (!manager || typeof manager.start !== 'function') throw new TypeError('A clarification run manager is required.');

  const routeNames = Object.freeze({
    start: `${pathPrefix}/start`,
    answer: `${pathPrefix}/answer`,
    cancel: `${pathPrefix}/cancel`,
    abandon: `${pathPrefix}/abandon`,
    stop: `${pathPrefix}/stop`,
    run: `${pathPrefix}/run`,
    proposal: `${pathPrefix}/proposal`,
    review: `${pathPrefix}/approval/review`,
    approvalRequest: `${pathPrefix}/approval/request`,
    approve: `${pathPrefix}/approval/approve`,
    deny: `${pathPrefix}/approval/deny`,
    approvalCancel: `${pathPrefix}/approval/cancel`,
    execute: `${pathPrefix}/approval/execute`
  });

  async function dispatch(pathname, method, body = {}) {
    if (method !== 'POST' && !(method === 'GET' && pathname.startsWith(routeNames.run))) {
      throw Object.assign(new Error('Workflow endpoint requires POST.'), { code: 'method_not_allowed' });
    }
    if (pathname === routeNames.start) return manager.start(body);
    if (pathname === routeNames.answer) return manager.answer(body);
    if (pathname === routeNames.cancel) return manager.cancel(body);
    if (pathname === routeNames.abandon) return manager.abandon(body);
    if (pathname === routeNames.stop) return manager.stop(body);
    if (pathname.startsWith(`${routeNames.run}/`)) {
      const runId = pathname.slice(`${routeNames.run}/`.length);
      return manager.get(runId, body.chatId);
    }
    if (pathname === routeNames.proposal) return manager.createProposal(body.runId, body.chatId, body.input || body);
    if (pathname === routeNames.review) return manager.reviewProposal(body.proposalId, body.runId, body.chatId);
    if (pathname === routeNames.approvalRequest) return manager.requestApproval(body.runId, body.chatId, body.input || body);
    if (pathname === routeNames.approve) return manager.approve(body);
    if (pathname === routeNames.deny) return manager.deny(body);
    if (pathname === routeNames.approvalCancel) return manager.cancelApproval(body);
    if (pathname === routeNames.execute) return manager.execute(body);
    throw Object.assign(new Error('Workflow endpoint not found.'), { code: 'route_not_found' });
  }

  async function handle(req, res) {
    const parsed = new URL(req.url, `http://${req.headers?.host || '127.0.0.1'}`);
    const isWorkflowRoute = Object.values(routeNames).some((route) => parsed.pathname === route || parsed.pathname.startsWith(`${route}/`));
    // Leave unrelated host routes entirely untouched. Origin and header
    // policy applies only after the adapter has positively matched one of its
    // own paths; otherwise it can turn an unrelated API request into 403.
    if (!isWorkflowRoute) return false;
    const origin = req.headers?.origin;
    if (typeof originAllowed === 'function' && !originAllowed(origin, req)) {
      res.writeHead(403, JSON_HEADERS); res.end(JSON.stringify({ error: 'origin_not_allowed', reasons: ['Workflow origin is not allowed.'] })); return true;
    }
    if (origin) {
      res.setHeader?.('Access-Control-Allow-Origin', origin);
      res.setHeader?.('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader?.('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader?.('Access-Control-Allow-Headers', 'X-Aven-Chat, Content-Type');
      res.writeHead(204); res.end(); return true;
    }
    if (req.headers?.['x-aven-chat'] !== requestHeader) {
      res.writeHead(403, JSON_HEADERS); res.end(JSON.stringify({ error: 'chat_header_required', reasons: ['Chat request header required.'] })); return true;
    }
    try {
      const body = req.method === 'GET' ? Object.fromEntries(parsed.searchParams.entries()) : await readJson(req);
      const result = await dispatch(parsed.pathname, req.method, body);
      const payload = safeClone(result);
      const data = JSON.stringify(payload);
      res.writeHead(200, { ...JSON_HEADERS, 'Content-Length': Buffer.byteLength(data) }); res.end(data);
    } catch (error) {
      const result = error?.code === 'method_not_allowed' ? { status: 405, body: { error: error.code, reasons: [error.message] } } : asError(error);
      res.writeHead(result.status, JSON_HEADERS); res.end(JSON.stringify(result.body));
    }
    return true;
  }

  return Object.freeze({ dispatch, handle, routes: routeNames });
}

module.exports = { createWorkflowApi, readJson, asError };
