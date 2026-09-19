'use strict';

/*
 * A transport boundary for provider selection. The caller injects both the
 * credential and fetch implementation; this module never looks up secrets,
 * probes a provider, or falls back to the process-wide fetch.
 */
const {
  PROVIDER_IDS,
  DEFAULT_SELECTION,
  normalizeSelection,
  validateSelection,
  normalizeUsage,
  responseProvenance
} = require('./provider-selection.cjs');

const DEFAULT_ENDPOINTS = Object.freeze({
  opencode: 'https://opencode.ai/zen/go/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1'
});

const THINKING_BUDGET = Object.freeze({ low: 1024, medium: 2048, high: 4096, max: 8192 });

function safeUrl(providerId, value) {
  let url;
  try { url = new URL(String(value)); } catch { throw Object.assign(Error('Provider endpoint is invalid.'), { code: 'provider_endpoint_invalid' }); }
  if (url.protocol !== 'https:') throw Object.assign(Error('Provider endpoint must use HTTPS.'), { code: 'provider_endpoint_invalid' });
  const expected = new URL(DEFAULT_ENDPOINTS[providerId]);
  if (url.username || url.password || url.search || url.hash || url.hostname !== expected.hostname || url.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) {
    throw Object.assign(Error('Provider endpoint is not an approved official endpoint.'), { code: 'provider_endpoint_invalid' });
  }
  return url.toString().replace(/\/$/, '');
}

function httpError(status) {
  const code = status === 401 || status === 403 ? 'provider_401' : status === 429 ? 'provider_429' : status >= 500 ? 'provider_5xx' : 'provider_request_failed';
  return Object.assign(Error(`Provider request failed (${status}).`), { code, status });
}

function responseText(body, providerId) {
  if (providerId === 'anthropic') {
    const blocks = Array.isArray(body?.content) ? body.content : [];
    return blocks.map((block) => typeof block === 'string' ? block : block?.text || block?.refusal).filter(Boolean).join('');
  }
  const content = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === 'string' ? item : item?.text).filter(Boolean).join('');
  return typeof messageRefusal(body, providerId) === 'string' ? messageRefusal(body, providerId) : '';
}

function messageRefusal(body, providerId) {
  if (providerId === 'anthropic') {
    const block = Array.isArray(body?.content) ? body.content.find((item) => item?.type === 'refusal' && typeof item?.refusal === 'string') : null;
    return block?.refusal || null;
  }
  const refusal = body?.choices?.[0]?.message?.refusal;
  return typeof refusal === 'string' && refusal.trim() ? refusal : null;
}

function validToolCall(value) {
  const argumentsValue = value?.function?.arguments;
  let parsedArguments = argumentsValue;
  if (typeof argumentsValue === 'string') {
    try { parsedArguments = JSON.parse(argumentsValue || '{}'); } catch { return false; }
  }
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim()
    && (value.type === 'function' || value.type === 'custom')
    && value.function && typeof value.function === 'object'
    && typeof value.function.name === 'string' && value.function.name.trim()
    && parsedArguments && typeof parsedArguments === 'object' && !Array.isArray(parsedArguments));
}

function validOpenAIContent(value) {
  if (typeof value === 'string') return Boolean(value.trim());
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' ? Boolean(item.trim()) : item && typeof item.text === 'string' && item.text.trim());
}

function validResponseBody(body, providerId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (providerId === 'anthropic') {
    if (!Array.isArray(body.content) || !body.content.length) return false;
    return body.content.every((block) => {
      if (!block || typeof block !== 'object') return false;
      if (block.type === 'text') return typeof block.text === 'string' && Boolean(block.text.trim());
      if (block.type === 'refusal') return typeof block.refusal === 'string' && Boolean(block.refusal.trim());
      if (block.type === 'tool_use') return typeof block.id === 'string' && Boolean(block.id.trim()) && typeof block.name === 'string' && Boolean(block.name.trim()) && block.input && typeof block.input === 'object' && !Array.isArray(block.input);
      return false;
    });
  }
  const message = body.choices?.[0]?.message;
  if (!message || typeof message !== 'object') return false;
  return validOpenAIContent(message.content)
    || (typeof message.refusal === 'string' && Boolean(message.refusal.trim()))
    || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && message.tool_calls.every(validToolCall));
}

function responseToolCalls(body, providerId) {
  if (providerId === 'anthropic') return Array.isArray(body?.content) ? body.content.filter((item) => item?.type === 'tool_use') : [];
  return Array.isArray(body?.choices?.[0]?.message?.tool_calls) ? body.choices[0].message.tool_calls : [];
}

function responseSelection(body, providerId) {
  const rawEffort = body?.effort || body?.reasoning_effort || body?.thinking?.effort;
  return {
    providerId: typeof body?.providerId === 'string' ? body.providerId : null,
    modelId: typeof body?.model === 'string' ? body.model : null,
    effort: typeof rawEffort === 'string' ? rawEffort : null,
    usage: normalizeUsage(body?.usage)
  };
}

function providerTools(providerId, tools) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  if (providerId !== 'anthropic') return tools;
  return tools.map((tool) => {
    const fn = tool?.function || tool;
    return { name: fn?.name, description: fn?.description, input_schema: fn?.parameters || fn?.input_schema || { type: 'object', properties: {} } };
  });
}

function requestFor(providerId, selection, messages, maxTokens, tools) {
  const system = providerId === 'anthropic' ? messages.filter((message) => message?.role === 'system').map((message) => String(message.content || '')).filter(Boolean).join('\n') : '';
  const requestMessages = providerId === 'anthropic' ? messages.filter((message) => message?.role !== 'system') : messages;
  const common = { model: selection.modelId, messages: requestMessages, max_tokens: maxTokens, stream: false, ...(system ? { system } : {}), ...(providerTools(providerId, tools) ? { tools: providerTools(providerId, tools) } : {}) };
  if (providerId === 'anthropic') {
    return selection.effort === 'none'
      ? common
      : { ...common, thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET[selection.effort] } };
  }
  if (providerId === 'opencode') {
    return selection.effort === 'none'
      ? common
      : { ...common, thinking: { type: 'enabled' } };
  }
  return selection.effort === 'none' ? common : { ...common, reasoning_effort: selection.effort };
}

function createProviderAdapter({ providerId, endpoint, credential, fetchImpl, capabilities, defaultSelection = DEFAULT_SELECTION, maxTokens = 2048, requestHeaders = {} } = {}) {
  if (!PROVIDER_IDS.includes(providerId)) throw new TypeError('Unknown provider adapter.');
  const baseUrl = safeUrl(providerId, endpoint || DEFAULT_ENDPOINTS[providerId]);
  if (typeof fetchImpl !== 'function') throw Object.assign(Error('Provider adapter requires an injected fetch implementation.'), { code: 'provider_fetch_unavailable' });
  if (credential !== undefined && (typeof credential !== 'string' || !credential.trim())) throw Object.assign(Error('Provider credential must be supplied by the caller.'), { code: 'provider_key_unavailable' });
  const hasCredential = typeof credential === 'string' && Boolean(credential.trim());
  const selectionDefault = normalizeSelection(defaultSelection) || DEFAULT_SELECTION;
  let lastStatus = null;

  function status() {
    return {
      id: providerId,
      configured: hasCredential,
      connected: lastStatus?.ok === true,
      status: lastStatus?.ok === true ? 'connected' : hasCredential ? 'configured' : 'unknown',
      reason: lastStatus?.ok === true ? '' : hasCredential ? 'Configured locally; connection has not been verified.' : 'Provider credential is unavailable locally.',
      models: []
    };
  }

  async function complete({ selection = selectionDefault, messages, signal, tools } = {}) {
    const chosen = normalizeSelection(selection);
    if (!chosen || chosen.providerId !== providerId) throw Object.assign(Error('Selected provider does not match this adapter.'), { code: 'provider_adapter_mismatch' });
    const validation = validateSelection(chosen, capabilities);
    if (!validation.ok) throw Object.assign(Error(validation.reason), { code: validation.code });
    if (!hasCredential) throw Object.assign(Error('Provider credential is unavailable locally.'), { code: 'provider_key_unavailable' });
    if (!Array.isArray(messages) || messages.length === 0) throw Object.assign(Error('Provider request requires messages.'), { code: 'invalid_messages' });
    const path = providerId === 'anthropic' ? '/messages' : '/chat/completions';
    const headers = { ...(requestHeaders && typeof requestHeaders === 'object' ? requestHeaders : {}), 'content-type': 'application/json', accept: 'application/json' };
    if (providerId === 'opencode') headers['user-agent'] = 'netrok/1';
    if (providerId === 'anthropic') {
      headers['x-api-key'] = credential.trim();
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers.authorization = `Bearer ${credential.trim()}`;
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(requestFor(providerId, chosen, messages, maxTokens, tools)), signal, redirect: 'error' });
    } catch (error) {
      lastStatus = { ok: false, reason: 'Provider request could not be completed.' };
      throw Object.assign(Error('Provider request could not be completed.'), { code: 'provider_request_failed', cause: error });
    }
    if (!response || response.ok !== true) {
      lastStatus = { ok: false, reason: 'Provider request was rejected.' };
      throw httpError(Number(response?.status) || 0);
    }
    let body;
    try { body = await response.json(); } catch (error) { throw Object.assign(Error('Provider returned invalid JSON.'), { code: 'provider_response_invalid', cause: error }); }
    if (!validResponseBody(body, providerId)) {
      lastStatus = { ok: false, reason: 'Provider returned an invalid successful response.' };
      throw Object.assign(Error('Provider returned an invalid successful response.'), { code: 'provider_response_invalid' });
    }
    const actual = responseSelection(body, providerId);
    const provenance = responseProvenance({ requested: chosen, response: { ...actual, model: actual.modelId, usage: actual.usage }, providerId });
    lastStatus = { ok: true };
    return {
      text: responseText(body, providerId),
      providerId: provenance.providerId || providerId,
      modelId: provenance.modelId || chosen.modelId,
      model: provenance.modelId || chosen.modelId,
      effort: provenance.effort || chosen.effort,
      usage: provenance.usage,
      refusal: messageRefusal(body, providerId),
      toolCalls: responseToolCalls(body, providerId),
      requestedSelection: chosen,
      provenance
    };
  }

  return { providerId, endpoint: baseUrl, status, complete };
}

function createLangChainModel({ providerId, credential, fetchImpl, capabilities, selection = DEFAULT_SELECTION, maxTokens = 2048, requestHeaders = {} } = {}) {
  // Loaded lazily so the transport contract remains testable without making
  // the provider SDK a module-load requirement for settings/capabilities.
  const { BaseChatModel } = require('@langchain/core/language_models/chat_models');
  const { AIMessage } = require('@langchain/core/messages');
  const adapter = createProviderAdapter({ providerId, credential, fetchImpl, capabilities, defaultSelection: selection, maxTokens, requestHeaders });
  const toRequestMessages = (messages) => messages.map((message) => ({
    role: message?.type === 'human' ? 'user' : message?.type === 'system' ? 'system' : message?.type === 'tool' ? 'tool' : 'assistant',
    content: typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '')
  }));
  const toToolCalls = (calls, source) => (Array.isArray(calls) ? calls : []).map((call) => source === 'anthropic'
    ? { id: call.id, name: call.name, args: call.input || {}, type: 'tool_call' }
    : { id: call.id, name: call.function.name, args: typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : (call.function.arguments || {}), type: 'tool_call' });
  class InjectedProviderModel extends BaseChatModel {
    constructor(fields = {}) { super({}); this.selection = fields.selection; this.tools = fields.tools || []; this.adapter = fields.adapter || adapter; }
    _llmType() { return `aven-${providerId}`; }
    _combineLLMOutput() { return {}; }
    bindTools(tools) { return new InjectedProviderModel({ adapter: this.adapter, selection: this.selection, tools }); }
    async _generate(messages, options) {
      const response = await this.adapter.complete({ selection: this.selection, messages: toRequestMessages(messages), tools: this.tools, signal: options?.signal });
      const effective = response.provenance?.effective || {};
      const content = response.text || response.refusal || '';
      const toolCalls = toToolCalls(response.toolCalls, providerId);
      const message = new AIMessage({ content, tool_calls: toolCalls, response_metadata: { providerId: effective.providerId, modelId: effective.modelId, effort: effective.effort, usage: response.usage } });
      return { generations: [{ text: content, message }], llmOutput: response.usage ? { usage: response.usage } : {} };
    }
  }
  return new InjectedProviderModel({ adapter, selection });
}

module.exports = { DEFAULT_ENDPOINTS, THINKING_BUDGET, createProviderAdapter, createLangChainModel, requestFor, responseText, validResponseBody };
