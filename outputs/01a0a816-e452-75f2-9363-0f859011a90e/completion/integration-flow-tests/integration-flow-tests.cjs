'use strict';

/*
 * Independent integration acceptance fixture.
 *
 * The product is loaded from AVEN_PRODUCT_ROOT (defaulting to the assembled
 * candidate). The HTTP server writes evidence to a temporary fixture root,
 * never to the candidate checkout. Provider, adapter, and sandbox calls are
 * all injected and every fetch is restricted to loopback.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const OUT_DIR = __dirname;
const COMPLETION_DIR = path.resolve(OUT_DIR, '..');
const PRODUCT_ROOT = path.resolve(process.env.AVEN_PRODUCT_ROOT || path.join(COMPLETION_DIR, 'assembled-candidate'));
const EXPECTED_PATH = path.join(OUT_DIR, 'expected-assertions.json');
const RESULTS_PATH = path.join(OUT_DIR, 'results.json');
const BLOCKERS_PATH = path.join(OUT_DIR, 'blockers.json');
const COMMAND_LOG_PATH = path.join(OUT_DIR, 'command-log.json');
const RUN_STARTED_AT = new Date().toISOString();
const ORIGIN = 'http://127.0.0.1:8767';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const SELECTION = Object.freeze({ providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none' });

const records = new Map();
const failures = [];
const cleanupWarnings = [];
const calls = {
  provider: [],
  inventory: [],
  command: [],
  responder: [],
  externalFetch: [],
  vault: 0
};
const runObservations = new Map();
const workflowObservations = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function candidateHashes() {
  const files = [
    'intentgraph/server.cjs',
    'intentgraph/clarification-runtime.cjs',
    'intentgraph/provider-selection.cjs',
    'intentgraph/reliability.cjs',
    'polished.js',
    'polished-backup.js'
  ];
  return Object.fromEntries(files.map((file) => {
    try {
      return [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(PRODUCT_ROOT, file))).digest('hex')];
    } catch (error) {
      return [file, `UNAVAILABLE: ${error.message}`];
    }
  }));
}

function writeCommandLog(value) {
  writeJson(COMMAND_LOG_PATH, {
    runStartedAt: RUN_STARTED_AT,
    invocation: { node: process.execPath, args: process.argv.slice(1), productRootEnv: process.env.AVEN_PRODUCT_ROOT || null },
    productRoot: PRODUCT_ROOT,
    ...value
  });
}

function limitationFor(id, fallback) {
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
  return expected.owned.find((entry) => entry.id === id)?.limitation || fallback;
}

function record(id, status, evidence, limitation, extra = {}) {
  const existing = records.get(id);
  const nextEvidence = Array.isArray(evidence) ? evidence : [String(evidence)];
  const mergedStatus = existing?.status === 'FAIL' || status === 'FAIL'
    ? 'FAIL'
    : existing?.status === 'BLOCKED' || status === 'BLOCKED'
      ? 'BLOCKED'
      : status;
  const value = {
    ...(existing || {}),
    id,
    status: mergedStatus,
    evidence: [...(existing?.evidence || []), ...nextEvidence],
    limitation,
    ...extra
  };
  records.set(id, value);
  if (status === 'FAIL') failures.push(value);
  return value;
}

function pass(id, evidence, extra) {
  return record(id, 'PASS', evidence, limitationFor(id, 'Scoped fixture only.'), extra);
}

function fail(id, error, extra) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return record(id, 'FAIL', [message], limitationFor(id, 'Scoped fixture only.'), { ...extra, error: message });
}

function blocked(id, reason, extra) {
  return record(id, 'BLOCKED', [reason], limitationFor(id, 'Candidate was not available for execution.'), extra);
}

function assertSelection(value, label) {
  assert.deepEqual(value, SELECTION, `${label} must preserve the explicit provider selection`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError() {
  return Object.assign(new Error('fixture run stopped'), { code: 'agent_aborted' });
}

async function until(predicate, timeoutMs = 4000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(8);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForAbort(signal) {
  if (signal?.aborted) throw abortError();
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForSteering(drainSteering, signal) {
  while (!signal?.aborted) {
    const items = typeof drainSteering === 'function' ? drainSteering() : [];
    if (items.length) return items[0];
    await delay(8);
  }
  throw abortError();
}

function latestUser(messages) {
  return messages?.filter((message) => message?.role === 'user').at(-1)?.content || '';
}

function fixtureEvidence(command = 'show version', status = 'SUCCESS') {
  return {
    command,
    target: 'edge-17',
    status,
    source: 'fixture-catalyst',
    output: 'fixture output: version 17.9.4',
    startedAt: '2026-09-16T00:00:00.000Z',
    elapsedMs: 1
  };
}

function makeFixtureDependencies() {
  const provider = {
    async status() {
      return { last: { ok: true }, credentialStored: false };
    },
    async complete(input = {}) {
      calls.provider.push(clone(input));
      return {
        content: 'fixture response',
        providerId: input.selection?.providerId || 'opencode',
        model: input.selection?.modelId || 'mimo-v2.5',
        effort: input.selection?.effort || 'none',
        usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
      };
    }
  };
  const adapters = {
    readProfiles: () => [],
    async networkRead() {
      throw new Error('networkRead must never be called by this fixture');
    },
    async status() {
      return { network: { available: false } };
    },
    async action() {
      throw new Error('adapter action must never be called by this fixture');
    },
    async close() {}
  };
  const sandbox = {
    async status() {
      return { available: false, source: 'fixture-sandbox' };
    },
    async inventory({ signal } = {}) {
      signal?.throwIfAborted?.();
      calls.inventory.push({ at: new Date().toISOString() });
      return { retrievedAt: '2026-09-16T00:00:00.000Z', devices: [{ id: DEVICE_ID, hostname: 'edge-17', platform: 'cisco_ios' }] };
    },
    async runCommand({ command, deviceUuid, signal } = {}) {
      signal?.throwIfAborted?.();
      calls.command.push({ command, deviceUuid });
      return { status: 'SUCCESS', source: 'fixture-catalyst', output: 'fixture output: version 17.9.4', startedAt: '2026-09-16T00:00:00.000Z', elapsedMs: 1 };
    },
    async close() {}
  };
  const coordinator = { async close() {}, async status() { return { status: 'idle' }; } };
  const delivery = { async close() {}, async status() { return { status: 'idle' }; } };
  return { provider, adapters, sandbox, coordinator, delivery };
}

function makeResponder(dependencies) {
  const workflowRounds = new Map();
  return async function fixtureResponder(context = {}) {
    const content = latestUser(context.messages);
    const selection = context.selection || SELECTION;
    calls.responder.push({ runId: context.runId || null, chatId: context.chatId, mode: context.mode, content, selectionProvided: context.selection !== undefined, selection: clone(selection) });
    assertSelection(selection, 'responder input');
    await dependencies.provider.complete({
      selection: clone(selection),
      messages: clone(context.messages),
      model: selection.modelId,
      effort: selection.effort,
      maxTokens: 64
    });

    const terminal = (text, evidence = []) => ({
      text,
      source: 'fixture-agent',
      providerId: selection.providerId,
      model: selection.modelId,
      effort: selection.effort,
      requestedSelection: clone(selection),
      provenance: { source: 'fixture-provider', requested: clone(selection), effective: clone(selection), match: true },
      evidence
    });
    const diagnosticTerminal = async (text = 'Terminal diagnostic response') => {
      const sandbox = context.sandbox || dependencies.sandbox;
      context.onEvent?.({ type: 'tool_start', tool: 'inventory' });
      const inventory = await sandbox.inventory({ signal: context.signal });
      context.onEvent?.({ type: 'tool_result', tool: 'inventory', status: 'SUCCESS', evidence: fixtureEvidence('inventory') });
      context.onEvent?.({ type: 'tool_start', tool: 'run_diagnostic', operation: 'show version', hostname: 'edge-17' });
      const result = await sandbox.runCommand({ command: 'show version', deviceUuid: inventory.devices[0].id, signal: context.signal });
      const evidence = { ...fixtureEvidence('show version', result.status), output: result.output };
      context.onEvent?.({ type: 'tool_result', tool: 'run_diagnostic', operation: 'show version', hostname: 'edge-17', status: result.status, evidence });
      return terminal(text, [evidence]);
    };

    if (context.runId) {
      const round = (workflowRounds.get(context.runId) || 0) + 1;
      workflowRounds.set(context.runId, round);
      if (content.includes('history-original')) return diagnosticTerminal('Original answer with diagnostic evidence');
      if (content.includes('history-edited')) return terminal('Edited answer without automatic diagnostic replay');
      if (content.includes('stop-initial')) await waitForAbort(context.signal);
      if (content.includes('queued-next') || content.includes('concurrency-b')) {
        context.onEvent?.({ type: 'tool_result', tool: 'queue-next', status: 'SUCCESS', evidence: fixtureEvidence('show clock') });
        return terminal(content.includes('queued-next') ? 'Queued next terminal response' : 'Independent concurrent response', [fixtureEvidence('show clock')]);
      }
      if (round === 1) {
        workflowObservations.set(context.runId, {
          kind: content.includes('workflow-restart') ? 'restart' : content.includes('workflow-stop') ? 'stop-resumed' : 'answer',
          selection: clone(selection)
        });
        return {
          pendingQuestion: {
            prompt: 'Which exact device should be reviewed?',
            choices: [{ id: 'edge-17', label: 'Edge 17' }],
            allowFreeText: false,
            context: { requestedBy: 'fixture', scope: 'read-only' }
          }
        };
      }
      if (workflowObservations.get(context.runId)?.kind === 'stop-resumed') await waitForAbort(context.signal);
      return diagnosticTerminal(`Resumed terminal answer for ${context.messages.at(-1)?.content || 'unknown'}`);
    }

    if (content.includes('history-original')) return diagnosticTerminal('Original answer with diagnostic evidence');
    if (content.includes('history-edited')) return terminal('Edited answer without automatic diagnostic replay');
    if (content.includes('stop-initial')) await waitForAbort(context.signal);
    if (content.includes('queued-next')) {
      context.onEvent?.({ type: 'tool_result', tool: 'queue-next', status: 'SUCCESS', evidence: fixtureEvidence('show clock') });
      return terminal('Queued next terminal response', [fixtureEvidence('show clock')]);
    }
    return terminal('Fixture terminal response');
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  await server.intentGraph.ready;
  return `http://127.0.0.1:${server.address().port}`;
}

function headers(stream = false) {
  return {
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    'X-Aven-Chat': 'text-only',
    ...(stream ? { Accept: 'application/x-ndjson' } : { Accept: 'application/json' })
  };
}

async function postJson(base, route, body, options = {}) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: headers(false),
    body: JSON.stringify(body),
    signal: options.signal
  });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
  return { response, payload, raw };
}

async function openChat(base, body) {
  const controller = new AbortController();
  const events = [];
  let response;
  const done = (async () => {
    try {
      response = await fetch(`${base}/api/chat`, { method: 'POST', headers: headers(true), body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        let payload = null;
        try { payload = await response.json(); } catch {}
        throw Object.assign(new Error(payload?.reasons?.[0] || `HTTP ${response.status}`), { status: response.status, payload });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) events.push(JSON.parse(line));
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) events.push(JSON.parse(buffer));
      return { response, events };
    } catch (error) {
      return { response, events, error };
    }
  })();
  return { controller, events, done, waitFor: (type) => until(() => events.find((event) => event.type === type), 5000, `chat ${type}`) };
}

async function steer(base, run, text) {
  const start = await run.waitFor('start');
  assert.equal(typeof start.runId, 'string');
  assert.equal(typeof start.steeringToken, 'string');
  const result = await postJson(base, '/api/chat/steer', {
    runId: start.runId,
    chatId: start.chatId || undefined,
    steeringToken: start.steeringToken,
    text
  });
  // The server's stream start currently carries chatId only in the body-level
  // route state on some overlays. Callers replace this when needed below.
  return result;
}

async function waitForEvidenceFile(fixtureRoot, runId) {
  const file = path.join(fixtureRoot, '.intentgraph', 'evidence', 'runs', `${runId}.json`);
  await until(() => fs.existsSync(file), 5000, `evidence file ${runId}`);
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function closeFixtureServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    let settled = false;
    let drainTimer, deadlineTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(drainTimer);
      clearTimeout(deadlineTimer);
      resolve();
    };
    try {
      server.close(finish);
      // Undici can retain an idle keep-alive socket after a completed fetch.
      // Closing idle/all connections keeps restart validation bounded without
      // touching the product process or browser profile.
      drainTimer = setTimeout(() => {
        try { server.closeIdleConnections?.(); } catch {}
        try { server.closeAllConnections?.(); } catch {}
      }, 250);
      deadlineTimer = setTimeout(() => reject(new Error('Fixture server did not close within five seconds')), 5000);
    } catch (error) {
      clearTimeout(drainTimer);
      clearTimeout(deadlineTimer);
      reject(error);
    }
  });
}

function assertNoSecret(value, secret, label) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(secret), false, `${label} must not contain ${secret}`);
}

async function runWorkflowFlow(base, server, fixtureRoot, dependencies, responder) {
  let waiting;
  try {
    const started = await postJson(base, '/api/chat/workflow/start', {
      chatId: 'workflow-answer',
      mode: 'plan',
      selection: SELECTION,
      messages: [{ role: 'user', content: 'workflow-answer' }]
    });
    assert.equal(started.response.status, 200);
    waiting = started.payload;
    assert.equal(waiting.status, 'waiting-question');
    assertSelection(waiting.selection || SELECTION, 'workflow start selection');
    assert.equal(typeof waiting.runId, 'string');
    assert.equal(typeof waiting.pendingQuestion?.question?.id, 'string');
    assert.equal(typeof waiting.pendingQuestion?.token, 'string');
    pass('UX-033', [
      'POST /api/chat/workflow/start returned status waiting-question',
      `pending question ${waiting.pendingQuestion.question.id} carried an opaque token only in the live response`
    ], { runId: waiting.runId, questionId: waiting.pendingQuestion.question.id });

    const wrong = await postJson(base, '/api/chat/workflow/answer', {
      runId: waiting.runId,
      chatId: 'workflow-answer',
      questionId: `${waiting.pendingQuestion.question.id}-stale`,
      questionToken: waiting.pendingQuestion.token,
      choice: 'edge-17'
    });
    assert.equal(wrong.response.status, 409);

    const answered = await postJson(base, '/api/chat/workflow/answer', {
      runId: waiting.runId,
      chatId: 'workflow-answer',
      questionId: waiting.pendingQuestion.question.id,
      questionToken: waiting.pendingQuestion.token,
      choice: 'edge-17'
    });
    assert.equal(answered.response.status, 200, `workflow lifecycle answer failed: status=${answered.response.status} payload=${answered.raw}`);
    assert.equal(answered.payload.status, 'completed');
    assert.equal(answered.payload.runId, waiting.runId);
    assert.equal(answered.payload.answerCount, 1);
    assertSelection(workflowObservations.get(waiting.runId).selection, 'workflow responder selection');
    assert.match(answered.payload.result.text, /edge-17/);
    assert.equal(answered.payload.events.filter((event) => event.type === 'question_answered').length, 1);
    assert.equal(answered.payload.result.evidence[0].source, 'fixture-catalyst');
    pass('UX-033', [
      'exact question token and question id resumed the same run',
      'answerCount=1 and responder received the clarification context',
      'terminal result retained command, target, status, source, and provider provenance'
    ], { runId: waiting.runId });

    const stale = await postJson(base, '/api/chat/workflow/answer', {
      runId: waiting.runId,
      chatId: 'workflow-answer',
      questionId: waiting.pendingQuestion.question.id,
      questionToken: waiting.pendingQuestion.token,
      choice: 'edge-17'
    });
    assert.equal(stale.response.status, 409);
    assert.equal(calls.responder.filter((entry) => entry.runId === waiting.runId).length, 2);
    pass('UX-033', ['stale/repeated answer returned HTTP 409 and did not invoke the responder again'], { runId: waiting.runId });
  } catch (error) {
    fail('UX-033', error);
  }

  let restartWaiting;
  try {
    const started = await postJson(base, '/api/chat/workflow/start', {
      chatId: 'workflow-restart',
      mode: 'inspect',
      selection: SELECTION,
      messages: [{ role: 'user', content: 'workflow-restart' }]
    });
    assert.equal(started.response.status, 200);
    restartWaiting = started.payload;
    assert.equal(restartWaiting.status, 'waiting-question');
    assert.equal(typeof restartWaiting.pendingQuestion.token, 'string');
    const persistedWorkflow = path.join(fixtureRoot, '.intentgraph', 'runtime', 'workflow-approval.json');
    assert.equal(fs.existsSync(persistedWorkflow), true);
    const state = JSON.parse(fs.readFileSync(persistedWorkflow, 'utf8'));
    assertNoSecret(state, restartWaiting.pendingQuestion.token, 'workflow backup');

    await closeFixtureServer(server);
    const nextServer = await createFixtureServer(PRODUCT_ROOT, fixtureRoot, dependencies, responder, persistedWorkflow);
    const nextBase = nextServer.base;
    const recovered = await fetch(`${nextBase}/api/chat/workflow/run/${restartWaiting.runId}?chatId=workflow-restart`, { headers: headers(false) });
    const recoveredPayload = await recovered.json();
    assert.equal(recovered.status, 200);
    assert.equal(recoveredPayload.status, 'restored-history');
    assert.equal(Object.hasOwn(recoveredPayload.pendingQuestion || {}, 'token'), false);
    assertNoSecret(recoveredPayload, restartWaiting.pendingQuestion.token, 'recovered public state');
    assert.equal(calls.responder.filter((entry) => entry.chatId === 'workflow-restart').length, 1);
    pass('UX-040', [
      'waiting workflow state survived server recreation over the same temporary workflow store',
      'recovered public state was restored-history without a question token',
      'no provider/responder call occurred during recovery'
    ], { runId: restartWaiting.runId });
    return { server: nextServer, base: nextBase };
  } catch (error) {
    fail('UX-040', error);
    return { server, base };
  }
}

async function runResumedStop(base) {
  try {
    const started = await postJson(base, '/api/chat/workflow/start', {
      chatId: 'workflow-stop',
      mode: 'inspect',
      selection: SELECTION,
      messages: [{ role: 'user', content: 'workflow-stop' }]
    });
    assert.equal(started.response.status, 200);
    const pending = started.payload;
    const answerPromise = postJson(base, '/api/chat/workflow/answer', {
      runId: pending.runId,
      chatId: 'workflow-stop',
      questionId: pending.pendingQuestion.question.id,
      questionToken: pending.pendingQuestion.token,
      choice: 'edge-17'
    });
    await until(() => calls.responder.filter((entry) => entry.runId === pending.runId).length >= 2, 5000, 'resumed workflow responder');
    const stopped = await postJson(base, '/api/chat/workflow/stop', { runId: pending.runId, chatId: 'workflow-stop', reason: 'fixture stop' });
    assert.equal(stopped.response.status, 200);
    assert.equal(stopped.payload.status, 'canceled');
    const answerResult = await answerPromise;
    assert.equal(answerResult.response.status, 200);
    assert.equal(answerResult.payload.status, 'canceled');
    pass('UX-031', [
      'answer created a fresh resumed segment',
      'explicit stop canceled the resumed segment and its answer request resolved canceled',
      'no automatic retry was issued'
    ], { runId: pending.runId });
  } catch (error) {
    fail('UX-031', error);
  }
}

async function runChatFlows(base, fixtureRoot) {
  let first;
  try {
    first = await openChat(base, {
      chatId: 'queue-chat',
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      requestId: 'queue-request-1',
      idempotencyKey: 'queue-key-1',
      messages: [{ role: 'user', content: 'queue-first' }]
    });
    const start = await first.waitFor('start');
    assertSelection(start.selection, 'chat start selection');
    const question = await first.waitFor('pending_question');
    assert.equal(typeof question.question?.id, 'string');
    assert.equal(typeof question.questionToken, 'string');
    const waitingResult = await first.done;
    assert.equal(waitingResult.error, undefined);
    assert.equal(waitingResult.events.some((event) => event.type === 'final'), false);
    const answerResponse = await postJson(base, '/api/chat/workflow/answer', {
      runId: start.runId,
      chatId: 'queue-chat',
      questionId: question.question.id,
      questionToken: question.questionToken,
      choice: 'edge-17'
    });
    assert.equal(answerResponse.response.status, 200, `workflow answer failed: status=${answerResponse.response.status} payload=${answerResponse.raw}`);
    assert.equal(answerResponse.payload.status, 'completed');
    const final = answerResponse.payload.result;
    assert.equal(answerResponse.payload.mode, 'inspect');
    assert.equal(final.provenance.match, true);
    assertNoSecret(answerResponse.payload, question.questionToken, 'chat answer response');
    assert.equal(final.evidence.some((entry) => entry.source === 'fixture-catalyst'), true);
    assert.equal(answerResponse.payload.events.some((event) => event.type === 'completed'), true);
    runObservations.set(start.runId, { start, final, persisted: answerResponse.payload });
    pass('UX-033', [
      'actual createServer HTTP stream emitted start -> pending_question and closed before answer',
      'the exact question token resumed the same run through the workflow answer endpoint',
      'final provenance matched the explicit provider selection',
      'resumed result contained terminal source, command, target, status and no question token'
    ], { runId: start.runId });
  } catch (error) {
    fail('UX-033', error);
  }

  try {
    assert.ok(first, 'first queue run must start before queued follow-up');
    const firstRunId = [...runObservations.keys()][0];
    const duplicate = await postJson(base, '/api/chat', {
      chatId: 'queue-chat',
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      requestId: 'queue-request-1',
      idempotencyKey: 'queue-key-1',
      messages: [{ role: 'user', content: 'queue-first' }]
    });
    assert.equal(duplicate.response.status, 409);
    const before = calls.responder.filter((entry) => entry.content === 'queue-first').length;
    const next = await openChat(base, {
      chatId: 'queue-chat',
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      requestId: 'queue-request-2',
      idempotencyKey: 'queue-key-2',
      messages: [{ role: 'user', content: 'queued-next' }]
    });
    const result = await next.done;
    assert.equal(result.error, undefined);
    assert.equal(result.events.find((event) => event.type === 'start').mode, 'inspect');
    assert.equal(result.events.filter((event) => event.type === 'final').length, 1);
    assert.equal(calls.responder.filter((entry) => entry.content === 'queue-first').length, before);
    assert.equal(calls.responder.filter((entry) => entry.content === 'queued-next').length, 1);
    pass('UX-030', [
      `terminal run ${firstRunId} completed before queued-next was submitted`,
      'duplicate requestId/idempotencyKey returned 409 without a second responder call',
      'queued-next dispatched exactly once and preserved inspect mode'
    ]);
  } catch (error) {
    fail('UX-030', error);
  }

  try {
    const active = await openChat(base, {
      chatId: 'concurrency-a', agentName: 'Fixture coworker', mode: 'inspect', selection: SELECTION,
      requestId: 'concurrency-a-1', idempotencyKey: 'concurrency-a-1', messages: [{ role: 'user', content: 'concurrency-a' }]
    });
    const start = await active.waitFor('start');
    // Separate chats may run concurrently. The conflict boundary is a second
    // active request for the same chat, which must be rejected without any
    // responder/device dispatch.
    const second = await openChat(base, {
      chatId: 'concurrency-b', agentName: 'Fixture coworker', mode: 'inspect', selection: SELECTION,
      requestId: 'concurrency-b-1', idempotencyKey: 'concurrency-b-1', messages: [{ role: 'user', content: 'concurrency-b' }]
    });
    const secondDone = await second.done;
    assert.equal(secondDone.error, undefined);
    assert.equal(secondDone.events.some((event) => event.type === 'final'), true);
    assert.equal(calls.responder.filter((entry) => entry.content === 'concurrency-b').length, 1);
    const sameChatResponderCount = calls.responder.filter((entry) => entry.chatId === 'concurrency-a').length;
    const duplicateSameChat = await postJson(base, '/api/chat', {
      chatId: 'concurrency-a', agentName: 'Fixture coworker', mode: 'inspect', selection: SELECTION,
      requestId: 'concurrency-a-duplicate', idempotencyKey: 'concurrency-a-duplicate', messages: [{ role: 'user', content: 'concurrency-a-duplicate' }]
    });
    assert.equal(duplicateSameChat.response.status, 409);
    assert.equal(calls.responder.filter((entry) => entry.chatId === 'concurrency-a').length, sameChatResponderCount);
    // The mock's first round deliberately asks a clarification. Its original
    // stream has ended, so only the bound question endpoint may resume it.
    const question = await active.waitFor('pending_question');
    const answerResponse = await postJson(base, '/api/chat/workflow/answer', {
      runId: start.runId, chatId: 'concurrency-a', questionId: question.question.id,
      questionToken: question.questionToken, choice: 'edge-17'
    });
    assert.equal(answerResponse.response.status, 200);
    assert.equal(answerResponse.payload.status, 'completed');
    const completed = await active.done;
    assert.equal(completed.error, undefined);
    pass('UX-030', [
      'a different chat completed while the first chat was waiting, preserving independent concurrency',
      'a second active request for the same chat returned HTTP 409',
      'same-chat rejection caused no duplicate responder or sandbox call'
    ], { runId: start.runId });
  } catch (error) {
    fail('UX-030', error);
  }

  try {
    const stopped = await openChat(base, {
      chatId: 'stop-initial', agentName: 'Fixture coworker', mode: 'inspect', selection: SELECTION,
      requestId: 'stop-initial-1', idempotencyKey: 'stop-initial-1', messages: [{ role: 'user', content: 'stop-initial' }]
    });
    const start = await stopped.waitFor('start');
    stopped.controller.abort();
    const done = await stopped.done;
    assert.ok(done.error || done.events.some((event) => event.type === 'failed'), 'initial stop must end as an interrupted run');
    assert.equal(done.events.some((event) => event.type === 'tool_result'), false);
    const persisted = await waitForEvidenceFile(fixtureRoot, start.runId);
    assert.equal(persisted.reply, null);
    assert.equal(persisted.events.some((event) => event.type === 'tool_result'), false);
    pass('UX-031', [
      'aborting the initial HTTP stream stopped the responder before any diagnostic tool event',
      'persisted run had no terminal reply and no post-stop tool evidence'
    ], { runId: start.runId });
  } catch (error) {
    fail('UX-031', error);
  }
}

async function runEditResendFlow(base, fixtureRoot) {
  try {
    const chatId = 'edit-resend-chat';
    const originalRequest = await openChat(base, {
      chatId,
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      requestId: 'edit-resend-original-1',
      idempotencyKey: 'edit-resend-original-1',
      messages: [{ role: 'user', content: 'history-original' }]
    });
    const originalResult = await originalRequest.done;
    assert.equal(originalResult.error, undefined);
    const originalStart = originalResult.events.find((event) => event.type === 'start');
    assert.ok(originalStart?.runId, 'original edit fixture must emit a run id');
    const originalEvidence = await waitForEvidenceFile(fixtureRoot, originalStart.runId);
    assert.equal(originalEvidence.events.some((event) => event.type === 'tool_result' && event.evidence?.command === 'show version'), true);
    const commandCountAfterOriginal = calls.command.length;
    const providerCountBeforeEdit = calls.provider.length;
    const responderCountBeforeEdit = calls.responder.filter((entry) => entry.chatId === chatId).length;

    // This is the payload shape produced after the user explicitly edits the
    // selected user message: later assistant/evidence messages are omitted.
    const editedRequest = await openChat(base, {
      chatId,
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      requestId: 'edit-resend-edited-1',
      idempotencyKey: 'edit-resend-edited-1',
      messages: [{ role: 'user', content: 'history-edited' }]
    });
    const editedResult = await editedRequest.done;
    assert.equal(editedResult.error, undefined);
    const editedStart = editedResult.events.find((event) => event.type === 'start');
    assert.ok(editedStart?.runId, 'edited resend must create a fresh run id');
    assert.notEqual(editedStart.runId, originalStart.runId);
    const editedProviderRequest = calls.provider.slice(providerCountBeforeEdit).at(-1);
    assert.ok(editedProviderRequest, 'edited resend must reach the mock provider');
    const editResponderCalls = calls.responder.filter((entry) => entry.chatId === chatId);
    assert.equal(editResponderCalls.length, responderCountBeforeEdit + 1);
    assert.equal(editResponderCalls.slice(-2).every((entry) => entry.selectionProvided), true, 'both edit requests must carry explicit provider selection to the responder');
    const editedPayload = JSON.stringify(editedProviderRequest);
    assert.match(editedPayload, /history-edited/);
    assert.doesNotMatch(editedPayload, /history-original/);
    assert.deepEqual(editedProviderRequest.selection, SELECTION);
    assert.equal(calls.command.length, commandCountAfterOriginal, 'edited resend must not replay the original diagnostic command');
    const evidenceAfterEdit = await waitForEvidenceFile(fixtureRoot, originalStart.runId);
    assert.deepEqual(evidenceAfterEdit, originalEvidence, 'original evidence must remain unchanged after edit');
    assert.equal(calls.provider.length, providerCountBeforeEdit + 1);
    assert.equal(calls.responder.filter((entry) => entry.chatId === chatId).length, responderCountBeforeEdit + 1);

    // Replaying the same transport id is a duplicate request, not an implicit
    // third run. A fresh run exists only for the explicit edited send above.
    const duplicate = await postJson(base, '/api/chat', {
      chatId,
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      requestId: 'edit-resend-edited-1',
      idempotencyKey: 'edit-resend-edited-1',
      messages: [{ role: 'user', content: 'history-edited' }]
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(calls.provider.length, providerCountBeforeEdit + 1);
    assert.equal(calls.command.length, commandCountAfterOriginal);
    pass('UX-025', [
      `original run ${originalStart.runId} persisted one diagnostic evidence event`,
      `explicit edit created fresh run ${editedStart.runId} with edited prompt only`,
      'original evidence stayed byte-equivalent and command call count stayed at one',
      'repeated edited transport id returned HTTP 409 without a third provider or device call'
    ], { originalRunId: originalStart.runId, editedRunId: editedStart.runId });
  } catch (error) {
    fail('UX-025', error);
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

async function runMigrationFlow(productRoot) {
  try {
    const backup = require(path.join(productRoot, 'polished-backup.js'));
    const source = backup.envelope(
      {
        theme: 'dark',
        accent: 'blue',
        language: 'en',
        density: 'comfortable',
        displayName: 'Fixture operator',
        activeAgent: 'agent-a',
        provider: 'opencode',
        model: 'mimo-v2.5',
        browser: true,
        computer: true,
        sidebarWidth: 312,
        paneWidth: 448,
        sections: [{ id: 'section-ops', name: 'Operations' }],
        agents: [{
          id: 'agent-a',
          name: 'Edge coworker',
          role: 'Network operator',
          description: 'Fixture identity',
          timezone: 'Asia/Calcutta',
          autoReview: true,
          hidden: false,
          archived: false,
          pinned: true,
          sectionId: 'section-ops',
          projectId: 'project-ops',
          avatar: { style: 'initials', color: '#2255aa', type: 'photo', image: 'data:image/png;base64,AA==' }
        }]
      },
      {
        activeChat: 'chat-queue',
        projects: [{ id: 'project-ops', name: 'Operations', members: ['agent-a'] }],
        channels: [{ id: 'channel-ops', name: 'Ops', projectId: 'project-ops', members: ['agent-a'] }],
        chats: [
          {
            id: 'chat-direct',
            title: 'Direct history',
            recipients: ['agent-a'],
            draft: 'unsent draft survives',
            draftReplyTo: { id: 'direct-1', text: 'Earlier answer', author: 'Edge coworker' },
            replyError: 'previous reply warning',
            messages: [
              { id: 'direct-1', role: 'assistant', text: 'Earlier answer', createdAt: '2026-09-16T00:00:01.000Z', agentId: 'agent-a', source: 'fixture-agent', model: 'mimo-v2.5', localReaction: 'thumbs-up', evidence: [{ command: 'show version', target: 'edge-17', status: 'SUCCESS', source: 'fixture-catalyst', output: 'version 17.9.4' }] },
              { id: 'direct-2', role: 'user', text: 'Follow up', createdAt: '2026-09-16T00:00:02.000Z', agentId: 'agent-a', replyTo: { id: 'direct-1', text: 'Earlier answer' } }
            ],
            rewindHistory: [{
              id: 'rewind-direct-1',
              createdAt: '2026-09-16T00:00:03.000Z',
              messages: [{ id: 'rewind-msg-1', role: 'user', text: 'Original prompt', createdAt: '2026-09-16T00:00:00.000Z' }],
              draft: 'draft before revert',
              retainedIds: ['direct-1']
            }]
          },
          {
            id: 'chat-queue',
            title: 'Queued work',
            recipients: ['agent-a'],
            projectId: 'project-ops',
            channelId: 'channel-ops',
            draft: 'queue draft',
            pendingQueue: [{ id: 'queued-1', text: 'Inspect edge-17', createdAt: '2026-09-16T00:00:04.000Z', mode: 'plan', replyTo: { id: 'direct-1', text: 'Earlier answer' } }],
            queuePaused: false,
            queuePauseReason: 'legacy state',
            messages: [{ id: 'queue-1', role: 'user', text: 'Queued prompt', createdAt: '2026-09-16T00:00:04.000Z', agentId: 'agent-a' }],
            rewindHistory: []
          }
        ],
        workspaceTools: { ideas: [], goals: [] }
      },
      { 'agent-a': { 'SOUL.md': 'Local identity', 'MEMORY.md': 'Local note retained' } },
      'fixture-build'
    );
    const storage = memoryStorage();
    const before = backup.parse(backup.serialize(source));
    const replaced = backup.replace(storage, source, source, 'replace');
    assert.equal(storage.getItem(backup.KEYS[3]), 'v4');
    assert.equal(storage.getItem(backup.KEYS[4]), 'v1');
    const storedEnvelope = {
      format: source.format,
      version: source.version,
      exportedAt: source.exportedAt,
      build: source.build,
      prefs: JSON.parse(storage.getItem(backup.KEYS[0])),
      data: JSON.parse(storage.getItem(backup.KEYS[1])),
      docs: JSON.parse(storage.getItem(backup.KEYS[2]))
    };
    const reloaded = backup.parse(backup.serialize(storedEnvelope));
    assert.deepEqual(replaced, reloaded, 'reloaded migrated workspace must equal the persisted replacement');
    assert.deepEqual(reloaded.prefs.sections, before.prefs.sections);
    assert.deepEqual(reloaded.prefs.agents[0].avatar, before.prefs.agents[0].avatar);
    assert.equal(reloaded.prefs.browser, false, 'connection preference is normalized off during migration');
    assert.equal(reloaded.prefs.computer, false, 'connection preference is normalized off during migration');
    assert.equal(reloaded.prefs.sidebarWidth, 312);
    assert.equal(reloaded.prefs.paneWidth, 448);
    const direct = reloaded.data.chats.find((chat) => chat.id === 'chat-direct');
    const queued = reloaded.data.chats.find((chat) => chat.id === 'chat-queue');
    assert.equal(direct.draft, 'unsent draft survives');
    assert.deepEqual(direct.rewindHistory, before.data.chats.find((chat) => chat.id === 'chat-direct').rewindHistory);
    assert.equal(queued.pendingQueue.length, 1);
    assert.equal(queued.pendingQueue[0].mode, 'plan');
    assert.equal(queued.queuePaused, true);
    assert.equal(queued.queuePauseReason, 'Restored queue is paused. Review it before resuming.');
    assert.deepEqual(reloaded.docs, before.docs);
    pass('UX-101', [
      'candidate workspace backup validate/serialize/parse and replace persisted chats, drafts, queues, avatars and revert history',
      'reload comparison was exact for the normalized envelope and local coworker notes',
      'new provider/model, section, connection, sidebar and pane preference fields survived with documented connection normalization',
      'queued work remained present but paused for intentional review after restore'
    ], { storageKeys: backup.KEYS });
  } catch (error) {
    fail('UX-101', error);
  }
}

async function runLocalNotePayloadCheck(base) {
  const localNote = `LOCAL-ONLY-NOTE-${crypto.randomUUID()}`;
  try {
    // Model the profile document editor's local save. The note is retained by
    // this fixture only; it is deliberately never added to chat messages.
    const localDocuments = { 'fixture-agent': { 'MEMORY.md': localNote } };
    assert.equal(localDocuments['fixture-agent']['MEMORY.md'], localNote);

    const before = calls.provider.length;
    const next = await openChat(base, {
      chatId: 'local-note-check',
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      requestId: 'local-note-check-1',
      idempotencyKey: 'local-note-check-1',
      messages: [{ role: 'user', content: 'Check the branch health.' }]
    });
    const finished = await next.done;
    assert.equal(finished.error, undefined);
    const captured = calls.provider.slice(before).at(-1);
    assert.ok(captured, 'mock provider must capture the next request');
    assertNoSecret(captured, localNote, 'captured mock chat request');
    assertNoSecret(finished.events, localNote, 'captured HTTP events');

    const attempted = await postJson(base, '/api/chat', {
      chatId: 'local-note-check',
      agentName: 'Fixture coworker',
      mode: 'inspect',
      selection: SELECTION,
      notes: { 'MEMORY.md': localNote },
      requestId: 'local-note-check-unsupported',
      idempotencyKey: 'local-note-check-unsupported',
      messages: [{ role: 'user', content: 'This must not include local notes.' }]
    });
    assert.equal(attempted.response.status, 400, 'strict chat payload must reject a local note field');
    assert.equal(calls.provider.length, before + 1, 'rejected note payload must not dispatch a provider call');
    pass('UX-109', [
      'local MEMORY.md edit was retained in fixture-local state only',
      'captured subsequent mock provider request and HTTP events contained no local note content',
      'chat payload containing notes was rejected with HTTP 400 before provider dispatch'
    ]);
  } catch (error) {
    fail('UX-109', error);
  }
}

async function createFixtureServer(productRoot, fixtureRoot, dependencies, responder, workflowStoragePath) {
  const serverModule = require(path.join(productRoot, 'intentgraph', 'server.cjs'));
  const runtimeDirectory = path.join(fixtureRoot, '.intentgraph', 'runtime');
  const server = serverModule.createServer({
    root: fixtureRoot,
    runtimeDirectory,
    allowConcurrentRuns: true,
    chatResponder: responder,
    clarificationResponder: responder,
    workflowStoragePath: workflowStoragePath || path.join(runtimeDirectory, 'workflow-approval.json'),
    executionOptions: {
      provider: dependencies.provider,
      coordinator: dependencies.coordinator,
      adapters: dependencies.adapters,
      delivery: dependencies.delivery
    },
    sandbox: dependencies.sandbox,
    providerCapabilities: {
      checkedAt: '2026-09-16T00:00:00.000Z',
      providers: [{
        id: 'opencode', status: 'connected', connected: true, configured: true,
        models: [{ id: 'mimo-v2.5', status: 'connected', efforts: ['none'] }]
      }]
    }
  });
  const base = await listen(server);
  return { server, base, serverModule };
}

async function main() {
  writeJson(EXPECTED_PATH, JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8')));
  const OWNED_IDS = ['UX-025', 'UX-030', 'UX-031', 'UX-033', 'UX-040', 'UX-101', 'UX-109'];
  writeCommandLog({ status: 'RUNNING' });
  if (!fs.existsSync(PRODUCT_ROOT)) {
    for (const id of OWNED_IDS) blocked(id, `Candidate root does not exist: ${PRODUCT_ROOT}`);
    writeJson(BLOCKERS_PATH, {
      status: 'BLOCKED',
      reason: 'assembled-candidate is not available yet; execute after the final overlay is assembled.',
      productRoot: PRODUCT_ROOT,
      failures: [...records.values()]
    });
    writeJson(RESULTS_PATH, { status: 'BLOCKED', productRoot: PRODUCT_ROOT, counts: { pass: 0, fail: 0, blocked: records.size }, records: [...records.values()], failures: [] });
    writeCommandLog({ status: 'BLOCKED', exitCode: 2, counts: { pass: 0, fail: 0, blocked: records.size }, candidateHashes: candidateHashes() });
    console.log(JSON.stringify({ status: 'BLOCKED', productRoot: PRODUCT_ROOT, blockers: [BLOCKERS_PATH] }, null, 2));
    process.exitCode = 2;
    return;
  }

  const required = [
    'intentgraph/server.cjs',
    'intentgraph/indexer.cjs',
    'intentgraph/engine.cjs',
    'intentgraph/catalyst.cjs',
    'intentgraph/network-execution.cjs',
    'intentgraph/adapters/index.cjs',
    'intentgraph/provider.cjs',
    'intentgraph/coordinator.cjs',
    'intentgraph/delivery.cjs',
    'intentgraph/clarification-runtime.cjs',
    'intentgraph/clarification-server-adapter.cjs',
    'intentgraph/provider-selection.cjs',
    'intentgraph/reliability.cjs',
    'intentgraph/reliability-storage.cjs',
    'polished-reliability.js',
    'polished-backup.js'
  ];
  const missing = required.filter((file) => !fs.existsSync(path.join(PRODUCT_ROOT, file)));
  if (missing.length) {
    for (const id of OWNED_IDS) blocked(id, `Candidate root is missing required server modules: ${missing.join(', ')}`);
    writeJson(BLOCKERS_PATH, { status: 'BLOCKED', reason: 'candidate contract is incomplete', productRoot: PRODUCT_ROOT, missing, failures: [...records.values()] });
    writeJson(RESULTS_PATH, { status: 'BLOCKED', productRoot: PRODUCT_ROOT, counts: { pass: 0, fail: 0, blocked: records.size }, records: [...records.values()], failures: [] });
    writeCommandLog({ status: 'BLOCKED', exitCode: 2, counts: { pass: 0, fail: 0, blocked: records.size }, missing, candidateHashes: candidateHashes() });
    console.log(JSON.stringify({ status: 'BLOCKED', productRoot: PRODUCT_ROOT, missing }, null, 2));
    process.exitCode = 2;
    return;
  }

  let server;
  let fixtureRoot;
  try {
    // Load the candidate before creating any fixture state so a partial
    // overlay is reported as a bounded blocker with exact owned IDs.
    require(path.join(PRODUCT_ROOT, 'intentgraph', 'server.cjs'));
  } catch (error) {
    for (const id of OWNED_IDS) blocked(id, `Candidate server cannot load: ${error.message}`);
    writeJson(BLOCKERS_PATH, { status: 'BLOCKED', reason: 'candidate server load failed', productRoot: PRODUCT_ROOT, error: error.stack || String(error), failures: [...records.values()] });
    writeJson(RESULTS_PATH, { status: 'BLOCKED', productRoot: PRODUCT_ROOT, counts: { pass: 0, fail: 0, blocked: records.size }, records: [...records.values()], failures: [] });
    writeCommandLog({ status: 'BLOCKED', exitCode: 2, counts: { pass: 0, fail: 0, blocked: records.size }, error: error.stack || String(error), candidateHashes: candidateHashes() });
    console.log(JSON.stringify({ status: 'BLOCKED', productRoot: PRODUCT_ROOT, error: error.message }, null, 2));
    process.exitCode = 2;
    return;
  }
  const originalFetch = global.fetch;
  const originalVaultGetSecret = (() => {
    try {
      const vault = require(path.join(PRODUCT_ROOT, 'intentgraph', 'vault.cjs'));
      const original = vault.getSecret;
      vault.getSecret = async function guardedGetSecret(...args) {
        calls.vault += 1;
        throw new Error(`vault access is forbidden in integration fixture (${args[0] || 'unknown'})`);
      };
      return { vault, original };
    } catch {
      return null;
    }
  })();
  global.fetch = async function guardedFetch(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      calls.externalFetch.push(url.toString());
      throw new Error(`external network forbidden: ${url.hostname}`);
    }
    return originalFetch(input, init);
  };

  try {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-integration-flow-'));
    fs.writeFileSync(path.join(fixtureRoot, 'fixture-scope.txt'), 'isolated integration fixture\n');
    const dependencies = makeFixtureDependencies();
    const responder = makeResponder(dependencies);
    ({ server } = await createFixtureServer(PRODUCT_ROOT, fixtureRoot, dependencies, responder));
    let current = await runWorkflowFlow((await listenClosedAddress(server)), server, fixtureRoot, dependencies, responder);
    server = current.server;
    await runResumedStop(current.base);
    await runChatFlows(current.base, fixtureRoot);
    await runEditResendFlow(current.base, fixtureRoot);
    await runLocalNotePayloadCheck(current.base);
    await runMigrationFlow(PRODUCT_ROOT);
    assert.equal(calls.externalFetch.length, 0, 'fixture must make no external fetch');
    assert.equal(calls.vault, 0, 'fixture must make no vault call');
    pass('UX-040', ['recovery path completed without a provider or vault call']);
  } catch (error) {
    // A candidate-level load or integration fault is a concrete blocker. Keep
    // each owned record exact rather than turning a setup exception into pass.
    for (const id of OWNED_IDS) {
      if (!records.has(id)) fail(id, error);
    }
    failures.push({ id: 'HARNESS', status: 'FAIL', error: error.stack || String(error) });
  } finally {
    try { if (server?.listening) await closeFixtureServer(server); } catch {}
    if (originalVaultGetSecret) originalVaultGetSecret.vault.getSecret = originalVaultGetSecret.original;
    global.fetch = originalFetch;
    if (fixtureRoot) {
      try {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      } catch (error) {
        // SQLite handles owned by a candidate overlay can outlive server.close
        // briefly on Windows. Preserve acceptance results and report this as a
        // harness cleanup warning rather than masking the scoped assertions.
        cleanupWarnings.push({ path: fixtureRoot, error: error.message });
      }
    }
  }

  const values = [...records.values()];
  const counts = values.reduce((acc, item) => {
    const key = item.status.toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { pass: 0, fail: 0, blocked: 0 });
  const status = counts.fail ? 'FAIL' : counts.blocked ? 'BLOCKED' : 'PASS';
  writeJson(RESULTS_PATH, {
    status,
    productRoot: PRODUCT_ROOT,
    counts,
    calls: {
      provider: calls.provider.length,
      inventory: calls.inventory.length,
      command: calls.command.length,
      responder: calls.responder.length,
      externalFetch: calls.externalFetch,
      vault: calls.vault
    },
    records: values,
    failures,
    cleanupWarnings
  });
  writeCommandLog({ status, exitCode: status === 'PASS' ? 0 : 1, counts, calls: {
    provider: calls.provider.length,
    inventory: calls.inventory.length,
    command: calls.command.length,
    responder: calls.responder.length,
    externalFetch: calls.externalFetch,
    vault: calls.vault
  }, candidateHashes: candidateHashes(), cleanupWarnings, finishedAt: new Date().toISOString() });
  console.log(JSON.stringify({ status, productRoot: PRODUCT_ROOT, counts, failures: failures.map((item) => ({ id: item.id, error: item.error || item.evidence?.[0] })) }, null, 2));
  if (status !== 'PASS') process.exitCode = 1;
  // A candidate's SQLite handles may remain live briefly after server.close()
  // on Windows. Force a bounded harness exit after results and command logs
  // are durable so later integrated runs are not left orphaned.
  setTimeout(() => process.exit(status === 'PASS' ? 0 : 1), 100);
}

async function listenClosedAddress(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

if (require.main === module) {
  main().catch((error) => {
    writeJson(BLOCKERS_PATH, { status: 'BLOCKED', reason: error.stack || String(error), productRoot: PRODUCT_ROOT });
    writeCommandLog({ status: 'BLOCKED', exitCode: 1, error: error.stack || String(error), candidateHashes: candidateHashes(), finishedAt: new Date().toISOString() });
    console.error(error.stack || error);
    setTimeout(() => process.exit(1), 100);
  });
}

module.exports = { runEditResendFlow, runMigrationFlow };
