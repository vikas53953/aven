'use strict';

// Candidate bridge for a chat/runtime owner. The bridge keeps a model run in
// a waiting state when the responder returns a structured clarification. It
// resumes only the run and chat that own the pending question. It does not
// choose a provider, call a provider, or dispatch a live device operation.

const crypto = require('node:crypto');
const { ApprovalWorkflow, WorkflowError } = require('./approval-workflow.cjs');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sanitizeEvent(value, depth = 0) {
  if (depth > 8) return '[event depth limited]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeEvent(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (key === 'token' || /Token(?:Hash)?$/.test(key)) continue;
    result[key] = sanitizeEvent(item, depth + 1);
  }
  return result;
}

function text(value, name, max = 20_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new WorkflowError('invalid_input', `${name} is invalid.`);
  return value.trim();
}

function safeRun(run) {
  return {
    runId: run.runId, chatId: run.chatId, status: run.status, mode: run.mode,
    events: clone(run.events), answerCount: run.answerCount,
    pendingQuestion: run.pending ? { question: clone(run.pending.question), ...(run.status === 'waiting-question' ? { token: run.pending.token } : {}) } : null,
    result: clone(run.result)
  };
}

function answerText(answer) {
  if (answer.choice) return `Selected choice: ${answer.choice}`;
  return `Free-text answer: ${answer.text}`;
}

function pendingMetadata(value) {
  const result = {};
  for (const key of ['source', 'model', 'mode']) {
    if (typeof value?.[key] === 'string' && value[key].length <= 200) result[key] = value[key];
  }
  const provenance = value?.provenance || value?.responseProvenance;
  if (provenance && typeof provenance === 'object' && !Array.isArray(provenance)) {
    const safeText = (candidate, max = 200) => typeof candidate === 'string' && candidate.length <= max ? candidate : undefined;
    const safeSelection = (candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
      const selection = {};
      for (const key of ['providerId', 'modelId', 'effort']) {
        const value = safeText(candidate[key]);
        if (value !== undefined) selection[key] = value;
      }
      return Object.keys(selection).length ? selection : undefined;
    };
    const safeUsage = (candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
      const usage = {};
      for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'input_tokens', 'output_tokens', 'total_tokens', 'prompt_tokens', 'completion_tokens']) {
        const value = candidate[key];
        if (Number.isSafeInteger(value) && value >= 0) usage[key] = value;
      }
      return Object.keys(usage).length ? usage : undefined;
    };
    const safe = {};
    if (Number.isSafeInteger(provenance.schemaVersion) && provenance.schemaVersion >= 1 && provenance.schemaVersion <= 10) safe.schemaVersion = provenance.schemaVersion;
    const requested = safeSelection(provenance.requested);
    const effective = safeSelection(provenance.effective);
    if (requested) safe.requested = requested;
    if (effective) safe.effective = effective;
    for (const key of ['providerId', 'modelId', 'effort']) {
      const value = safeText(provenance[key]);
      if (value !== undefined) safe[key] = value;
    }
    if (provenance.source === 'provider-response' || provenance.source === 'unavailable') safe.source = provenance.source;
    if (typeof provenance.match === 'boolean') safe.match = provenance.match;
    const usage = safeUsage(provenance.usage);
    if (usage) safe.usage = usage;
    if (Object.keys(safe).length) result.provenance = safe;
  }
  return result;
}

function parseStructured(value) {
  if (typeof value !== 'string' || value.length > 50_000) return value;
  try { return JSON.parse(value); } catch { return null; }
}

function clarificationToolCandidates(value) {
  const calls = Array.isArray(value?.tool_calls) ? value.tool_calls : [];
  const acceptedNames = new Set(['ask_clarification', 'pending_question', 'request_clarification', 'clarification_question']);
  const candidates = [];
  for (const call of calls) {
    const name = call?.name || call?.function?.name || call?.type;
    if (!acceptedNames.has(name)) continue;
    const args = call?.args ?? call?.input ?? call?.function?.arguments;
    const parsed = parseStructured(args);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) candidates.push(parsed);
  }
  return candidates;
}

// Accept the small structured shape emitted by a model adapter or a
// clarification tool. Keeping extraction here lets the runtime bridge and
// HTTP adapter share one contract without accepting arbitrary prose as a
// question.
function extractPendingQuestion(value) {
  const content = parseStructured(value?.content);
  const candidates = [value?.pendingQuestion, value?.pending_question,
    value?.toolResult?.pendingQuestion, value?.toolResult?.pending_question,
    value?.tool_result?.pendingQuestion, value?.tool_result?.pending_question,
    value?.toolResult, value?.tool_result, value?.additional_kwargs?.pending_question,
    value?.additional_kwargs?.pendingQuestion, value?.type === 'pending_question' ? value : null,
    content?.pendingQuestion, content?.pending_question, content?.type === 'pending_question' ? content : null,
    ...clarificationToolCandidates(value), ...clarificationToolCandidates(value?.toolResult), ...clarificationToolCandidates(value?.tool_result)];
  const input = candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item) && typeof item.prompt === 'string') || null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) return null;
  return {
    prompt: input.prompt,
    choices: input.choices,
    allowFreeText: input.allowFreeText ?? input.allow_free_text ?? true,
    context: input.context ?? null,
    ttlMs: input.ttlMs ?? input.ttl_ms
  };
}

class ClarificationRunManager {
  constructor({ workflow, workflowOptions, responder, clock = () => Date.now(), onEvent, onStatus } = {}) {
    this.clock = clock;
    this.responder = responder;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.ownsWorkflow = !workflow;
    this.workflow = workflow || new ApprovalWorkflow(workflowOptions);
    this.runs = new Map();
  }

  close() {
    for (const run of this.runs.values()) {
      try { run.segmentController?.abort(Object.assign(new Error('The workflow server is closing.'), { code: 'server_closing' })); } catch {}
    }
    this.runs.clear();
    if (this.ownsWorkflow) this.workflow.close?.();
  }

  emit(run, event) {
    const record = { runId: run.runId, at: new Date(Number(this.clock())).toISOString(), ...sanitizeEvent(event) };
    run.events.push(record);
    if (run.events.length > 100) run.events.splice(0, run.events.length - 100);
    try { (run.onEvent || this.onEvent)?.(record); } catch { /* observers cannot alter the run */ }
    return record;
  }

  recordResponderEvent(run, event) {
    const record = { runId: run.runId, at: new Date(Number(this.clock())).toISOString(), ...sanitizeEvent(event) };
    run.events.push(record);
    if (run.events.length > 100) run.events.splice(0, run.events.length - 100);
    return record;
  }

  requireRun(runId, chatId) {
    const run = this.runs.get(runId);
    if (!run || (chatId !== undefined && run.chatId !== chatId)) throw new WorkflowError('run_not_found', 'The chat run is unavailable for this conversation.');
    return run;
  }

  normalizeQuestion(value) {
    return extractPendingQuestion(value);
  }

  async dispatch(run) {
    const responder = run.responder || this.responder;
    if (typeof responder !== 'function') throw new WorkflowError('runtime_unavailable', 'A chat responder is unavailable.');
    // Waiting ends the original request segment. A resumed answer receives a
    // fresh controller and observer set so an aborted/closed first request
    // cannot poison the next model call.
    const segment = new AbortController();
    run.segmentController = segment;
    const responderOptions = { ...(run.responderOptions || {}) };
    const sourceSignal = run.segmentNumber === 0 ? responderOptions.signal : run.nextSignal;
    const sourceObserver = run.segmentNumber === 0 ? responderOptions.onEvent : null;
    delete responderOptions.signal;
    delete responderOptions.onEvent;
    responderOptions.onEvent = (event) => {
      const record = this.recordResponderEvent(run, event);
      const observer = sourceObserver || run.onEvent || this.onEvent;
      try { observer?.(record); } catch { /* observers cannot alter the run */ }
    };
    run.segmentNumber += 1;
    if (run.selection !== null) responderOptions.selection = clone(run.selection);
    else if (responderOptions.selection !== undefined) responderOptions.selection = clone(responderOptions.selection);
    else responderOptions.selection = null;
    responderOptions.signal = segment.signal;
    let detachSource = () => {};
    if (sourceSignal && typeof sourceSignal.addEventListener === 'function') {
      const abortSegment = () => { if (!segment.signal.aborted) segment.abort(sourceSignal.reason); };
      if (sourceSignal.aborted) abortSegment();
      else {
        sourceSignal.addEventListener('abort', abortSegment, { once: true });
        detachSource = () => sourceSignal.removeEventListener('abort', abortSegment);
      }
    }
    delete run.nextSignal;
    try {
      const result = await responder({
        ...responderOptions,
        runId: run.runId, chatId: run.chatId, mode: run.mode,
        messages: clone(run.messages), selection: clone(run.selection !== null ? run.selection : responderOptions.selection),
        // The responder may return { pendingQuestion: { prompt, choices } }.
        // A provider/tool adapter should produce that shape after validating
        // its own model/tool schema; this module only owns lifecycle state.
      });
      if (run.status === 'canceled') return safeRun(run);
      if (segment.signal.aborted) throw segment.signal.reason || new WorkflowError('run_canceled', 'The run was stopped.');
      const pendingSpec = this.normalizeQuestion(result);
      if (pendingSpec) {
        segment.abort();
        const pending = this.workflow.createPendingQuestion(pendingSpec);
        run.pending = { question: pending.question, token: pending.token };
        this.workflow.setOwner('question', pending.question.id, run.runId, run.chatId);
        run.status = 'waiting-question';
        // Preserve only provider response metadata alongside the waiting
        // card. The structured question itself is normalized into workflow
        // state, and no raw authorization token enters the run result.
        run.result = pendingMetadata(result);
        if (!Object.keys(run.result).length) run.result = null;
        this.persistRun(run);
        this.emit(run, { type: 'pending_question', question: clone(pending.question) });
        detachSource();
        return safeRun(run);
      }
      run.pending = null;
      run.status = 'completed';
      run.result = clone(result);
      this.persistRun(run);
      this.emit(run, { type: 'completed', result: clone(result) });
      detachSource();
      return safeRun(run);
    } catch (error) {
      if (run.status === 'canceled') return safeRun(run);
      run.status = 'failed';
      run.result = { error: error?.code || 'runtime_failed', message: error?.message || 'The run failed.' };
      try { this.persistRun(run); } catch { /* retain the original runtime failure */ }
      this.emit(run, { type: 'failed', error: run.result });
      throw error;
    } finally {
      detachSource();
    }
  }

  async start({ chatId, messages, mode = 'inspect', selection, runId, responder, responderOptions, onEvent } = {}) {
    const id = runId === undefined ? crypto.randomUUID() : text(runId, 'runId', 100);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new WorkflowError('invalid_input', 'runId is invalid.');
    const normalizedChatId = text(chatId, 'chatId', 100);
    if (!Array.isArray(messages) || !messages.length) throw new WorkflowError('invalid_input', 'messages are required.');
    if (!['inspect', 'plan'].includes(mode)) throw new WorkflowError('invalid_input', 'mode must be inspect or plan.');
    const run = {
      runId: id, chatId: normalizedChatId, mode, selection: selection === undefined ? null : clone(selection),
      messages: clone(messages), status: 'running', pending: null, result: null, events: [], answerCount: 0,
      responder, responderOptions, onEvent, segmentNumber: 0
    };
    this.persistRun(run);
    this.runs.set(id, run);
    this.emit(run, { type: 'start', mode });
    return this.dispatch(run);
  }

  async answer({ runId, chatId, questionId, questionToken, choice, text: freeText, signal } = {}) {
    const run = this.requireRun(runId, chatId);
    if (run.status !== 'waiting-question' || !run.pending) throw new WorkflowError('question_not_pending', 'This run is not waiting for a pending question.');
    if (run.pending.question.id !== questionId) throw new WorkflowError('stale_question', 'This question does not belong to the current waiting run.');
    const answered = this.workflow.answerQuestion({ questionId, questionToken, choice, text: freeText });
    const question = answered.question;
    const offered = Array.isArray(question.choices) && question.choices.length
      ? ` Options: ${question.choices.map((item) => `${item.id} (${item.label})`).join(', ')}.` : '';
    run.messages.push({ role: 'assistant', content: `Clarification needed: ${question.prompt}${offered}`, clarification: { questionId, type: 'pending-question' } });
    run.messages.push({ role: 'user', content: answerText(answered.answer), clarification: { questionId, answer: clone(answered.answer) } });
    run.answerCount += 1;
    run.pending = null;
    run.status = 'running';
    run.nextSignal = signal;
    this.persistRun(run);
    this.emit(run, { type: 'question_answered', questionId, answer: clone(answered.answer) });
    return this.dispatch(run);
  }

  cancel({ runId, chatId, questionId, questionToken, reason } = {}) {
    const run = this.requireRun(runId, chatId);
    if (run.status !== 'waiting-question' || !run.pending) throw new WorkflowError('question_not_pending', 'This run is not waiting for a pending question.');
    if (run.pending.question.id !== questionId) throw new WorkflowError('stale_question', 'This question does not belong to the current waiting run.');
    const result = this.workflow.cancelQuestion({ questionId, questionToken, reason });
    run.pending = null;
    run.status = 'canceled';
    run.result = { canceled: true, reason: result.question.reason };
    this.persistRun(run);
    this.emit(run, { type: 'canceled', questionId, reason: result.question.reason });
    return safeRun(run);
  }

  // A browser refresh deliberately discards the one-time question token. An
  // explicit, run/chat-scoped abandon action lets the user release the
  // server-side WAITING lease so a fresh request can be started. It only
  // cancels a pending question; it cannot answer, approve, or execute.
  abandon({ runId, chatId, questionId, reason = 'abandoned after reload' } = {}) {
    const run = this.requireRun(runId, chatId);
    if (run.status !== 'waiting-question' || !run.pending) throw new WorkflowError('question_not_pending', 'This run is not waiting for a pending question.');
    if (run.pending.question.id !== questionId) throw new WorkflowError('stale_question', 'This question does not belong to the current waiting run.');
    const result = this.workflow.abandonQuestion({ questionId, reason });
    run.pending = null;
    run.status = 'canceled';
    run.result = { canceled: true, reason: result.question.reason };
    this.persistRun(run);
    this.emit(run, { type: 'canceled', questionId, reason: result.question.reason, abandoned: true });
    return safeRun(run);
  }

  stop({ runId, chatId, reason = 'stopped by user' } = {}) {
    const run = this.requireRun(runId, chatId);
    if (run.status !== 'running') throw new WorkflowError('run_not_running', 'This run is not currently running.');
    run.segmentController?.abort(Object.assign(new Error('The network coworker run was stopped.'), { code: 'agent_aborted' }));
    run.status = 'canceled';
    run.result = { canceled: true, reason: text(reason, 'stop reason', 1000) };
    this.persistRun(run);
    this.emit(run, { type: 'stopped', reason: run.result.reason });
    return safeRun(run);
  }

  get(runId, chatId) {
    const current = this.runs.get(runId);
    if (current) return safeRun(this.syncQuestion(current.chatId === chatId ? current : this.requireRun(runId, chatId)));
    const restored = this.workflow.getRunRecord?.(runId);
    if (!restored || restored.chatId !== chatId) throw new WorkflowError('run_not_found', 'The chat run is unavailable for this conversation.');
    const question = restored.questionId ? this.workflow.getQuestion(restored.questionId) : null;
    return {
      runId: restored.runId, chatId: restored.chatId, mode: restored.mode, status: 'restored-history', events: [], answerCount: 0,
      pendingQuestion: question ? { question } : null, result: { error: 'restored_history', message: 'This run was restored as review history; ask a fresh question to continue.' }, restored: true
    };
  }

  persistRun(run) {
    this.workflow.upsertRun?.({ runId: run.runId, chatId: run.chatId, mode: run.mode, status: run.status, questionId: run.pending?.question.id ?? null, selection: run.selection });
    try { this.onStatus?.({ runId: run.runId, chatId: run.chatId, mode: run.mode, status: run.status, terminal: !['running', 'waiting-question'].includes(run.status), result: clone(run.result), events: clone(run.events.slice(-100)) }); } catch { /* status observers cannot alter the run */ }
  }

  syncQuestion(run) {
    if (run.status === 'waiting-question' && run.pending) {
      const card = this.workflow.renderQuestionCard(run.pending.question.id);
      if (!card.interactive) {
        run.status = 'question-ended';
        run.result = { error: 'question_no_longer_active', message: 'The clarification is no longer active; ask a fresh question.' };
        this.persistRun(run);
        this.emit(run, { type: 'question_ended', questionId: run.pending.question.id, status: card.question.status });
      }
    }
    return run;
  }

  requireOwner(kind, entityId, runId, chatId) {
    const owner = this.workflow.getOwner(kind, entityId);
    if (!owner || owner.runId !== runId || owner.chatId !== chatId) throw new WorkflowError('ownership_mismatch', 'This workflow item belongs to another chat run.');
    return owner;
  }

  renderQuestion(runId, chatId) {
    const run = this.syncQuestion(this.requireRun(runId, chatId));
    if (!run.pending) throw new WorkflowError('question_not_pending', 'This run has no pending question.');
    return {
      type: 'pending-question-card', action: 'none', executing: false,
      interactive: run.status === 'waiting-question', question: clone(run.pending.question)
    };
  }

  createProposal(runId, chatId, input) {
    const run = this.requireRun(runId, chatId);
    if (input?.questionId) this.requireOwner('question', input.questionId, runId, chatId);
    const result = this.workflow.createProposal({ ...input, questionId: input?.questionId ?? run.pending?.question.id ?? null });
    this.workflow.setOwner('proposal', result.proposal.id, runId, chatId);
    const receipt = this.workflow.reviewProposal(result.proposal.id).receipt;
    this.emit(run, { type: 'proposal_ready', proposalId: result.proposal.id, scopeDigest: result.proposal.scopeDigest, actionDigest: result.proposal.actionDigest });
    return { run: safeRun(run), proposal: result.proposal, receipt };
  }

  requestApproval(runId, chatId, input) {
    const run = this.requireRun(runId, chatId);
    this.requireOwner('proposal', input?.proposalId, runId, chatId);
    const result = this.workflow.requestApproval(input);
    this.workflow.setOwner('approval', result.approval.id, runId, chatId);
    this.emit(run, { type: 'approval_pending', approvalId: result.approval.id, proposalId: result.approval.proposalId, scopeDigest: result.approval.scopeDigest, actionDigest: result.approval.actionDigest });
    return { run: safeRun(run), ...result };
  }

  reviewProposal(proposalId, runId, chatId) {
    this.requireRun(runId, chatId);
    this.requireOwner('proposal', proposalId, runId, chatId);
    return this.workflow.reviewProposal(proposalId);
  }

  renderApproval(approvalId, runId, chatId) {
    this.requireRun(runId, chatId);
    this.requireOwner('approval', approvalId, runId, chatId);
    return this.workflow.renderApprovalCard(approvalId);
  }

  approve(input) {
    this.requireOwner('approval', input?.approvalId, input?.runId, input?.chatId);
    return this.workflow.approve(input);
  }

  deny(input) {
    this.requireOwner('approval', input?.approvalId, input?.runId, input?.chatId);
    return this.workflow.denyApproval(input);
  }

  cancelApproval(input) {
    this.requireOwner('approval', input?.approvalId, input?.runId, input?.chatId);
    return this.workflow.cancelApproval(input);
  }

  execute(input) {
    this.requireOwner('approval', input?.approvalId, input?.runId, input?.chatId);
    return this.workflow.execute(input);
  }
}

function createClarificationRunManager(options = {}) {
  return new ClarificationRunManager(options);
}

module.exports = { ClarificationRunManager, createClarificationRunManager, extractPendingQuestion, pendingMetadata, safeRun };
