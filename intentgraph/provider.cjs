'use strict';

const ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
const MODEL = 'mimo-v2.5';
const USER_AGENT = 'Aven-IntentGraph/0.2';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 1_024 * 1_024;
const MAX_REQUEST_BYTES = 2 * 1_024 * 1_024;
const MAX_OUTPUT_TOKENS = 8_192;

class ProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = details.code || 'provider_error';
    this.classification = details.classification || null;
    this.status = details.status || null;
    this.retryable = false;
  }
}

function classifyStatus(status) {
  if (status === 401) return '401';
  if (status === 404) return '404';
  if (status === 429) return '429';
  if (status >= 500 && status <= 599) return '5xx';
  return String(status);
}

function providerErrorForStatus(status) {
  const classification = classifyStatus(status);
  const code = classification === '5xx' ? 'provider_5xx' : `provider_${classification}`;
  const message = classification === '401' ? 'OpenCode provider authentication failed'
    : classification === '404' ? 'OpenCode provider endpoint or model was not found'
      : classification === '429' ? 'OpenCode provider rate limit reached'
        : classification === '5xx' ? 'OpenCode provider server error'
          : `OpenCode provider request failed (${classification})`;
  return new ProviderError(message, { code, classification, status });
}

function textContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part.text === 'string') return part.text;
    return '';
  }).join('');
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
    throw new ProviderError('messages must be a bounded nonempty array', { code: 'provider_invalid_request' });
  }
  let totalBytes = 0;
  const normalized = messages.map((message, index) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new ProviderError(`messages[${index}] must be an object`, { code: 'provider_invalid_request' });
    }
    const keys = Object.keys(message);
    if (keys.some((key) => !['role', 'content', 'name'].includes(key))) {
      throw new ProviderError(`messages[${index}] contains an unknown field`, { code: 'provider_invalid_request' });
    }
    if (typeof message.role !== 'string' || !message.role.trim() || message.role.length > 40) {
      throw new ProviderError(`messages[${index}].role is invalid`, { code: 'provider_invalid_request' });
    }
    if (typeof message.content !== 'string' && !Array.isArray(message.content)) {
      throw new ProviderError(`messages[${index}].content is invalid`, { code: 'provider_invalid_request' });
    }
    const content = textContent(message.content);
    if (Buffer.byteLength(content, 'utf8') > MAX_REQUEST_BYTES) {
      throw new ProviderError('provider request exceeds size cap', { code: 'provider_request_too_large' });
    }
    totalBytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
    if (totalBytes > MAX_REQUEST_BYTES) throw new ProviderError('provider request exceeds size cap', { code: 'provider_request_too_large' });
    const result = { role: message.role.trim(), content };
    if (message.name !== undefined) {
      if (typeof message.name !== 'string' || message.name.length > 100 || /[\r\n]/.test(message.name)) {
        throw new ProviderError(`messages[${index}].name is invalid`, { code: 'provider_invalid_request' });
      }
      result.name = message.name;
    }
    return result;
  });
  return normalized;
}

function validateSession(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256 || /[\r\n]/.test(sessionId)) {
    throw new ProviderError('sessionId is required and must be a stable header-safe value', { code: 'provider_invalid_request' });
  }
  return sessionId.trim();
}

async function responseText(response, signal) {
  const header = response && response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-length') : null;
  if (header && Number(header) > MAX_RESPONSE_BYTES) {
    throw new ProviderError('provider response exceeds size cap', { code: 'provider_response_too_large' });
  }
  if (response && response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        if (signal && signal.aborted) throw new ProviderError('provider request was cancelled', { code: 'provider_cancelled' });
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          try { await reader.cancel(); } catch {}
          throw new ProviderError('provider response exceeds size cap', { code: 'provider_response_too_large' });
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      try { reader.releaseLock?.(); } catch {}
    }
  }
  let value;
  try {
    value = response && typeof response.text === 'function' ? await response.text() : '';
  } catch (error) {
    throw new ProviderError('unable to read provider response', { code: 'provider_response_error', cause: error });
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new ProviderError('provider response exceeds size cap', { code: 'provider_response_too_large' });
  }
  return value;
}

function usageFrom(body) {
  const usage = body && body.usage && typeof body.usage === 'object' ? body.usage : {};
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.generated_tokens ?? 0);
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(inputTokens) && inputTokens >= 0 ? Math.floor(inputTokens) : 0,
    outputTokens: Number.isFinite(outputTokens) && outputTokens >= 0 ? Math.floor(outputTokens) : 0
  };
}

function createProvider(options = {}) {
  const getKey = options.getKey;
  if (typeof getKey !== 'function') throw new TypeError('createProvider requires getKey');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('createProvider requires fetchImpl when fetch is unavailable');
  let calls = 0;
  let keyState = null;
  let last = null;

  async function complete({ messages, sessionId, maxTokens = 2048, signal, thinking } = {}) {
    if(thinking!==undefined&&!['enabled','disabled'].includes(thinking))throw new ProviderError('Invalid thinking option',{code:'provider_invalid_request'});
    const normalizedMessages = validateMessages(messages);
    const stableSession = validateSession(sessionId);
    const boundedTokens = Number(maxTokens);
    if (!Number.isInteger(boundedTokens) || boundedTokens < 1 || boundedTokens > MAX_OUTPUT_TOKENS) {
      throw new ProviderError(`maxTokens must be an integer from 1 to ${MAX_OUTPUT_TOKENS}`, { code: 'provider_invalid_request' });
    }
    if (signal && signal.aborted) throw new ProviderError('provider request was cancelled', { code: 'provider_cancelled' });
    let key;
    try { key = await getKey(); } catch (error) {
      keyState = false;
      throw new ProviderError('OpenCode provider key is unavailable', { code: 'provider_key_unavailable', cause: error });
    }
    if (typeof key !== 'string' || !key.trim()) {
      keyState = false;
      throw new ProviderError('OpenCode provider key is unavailable', { code: 'provider_key_unavailable' });
    }
    key = key.trim();
    keyState = true;
    const body = JSON.stringify({ model: MODEL, messages: normalizedMessages, max_tokens: boundedTokens, ...(thinking?{thinking:{type:thinking}}:{}) });
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
      throw new ProviderError('provider request exceeds size cap', { code: 'provider_request_too_large' });
    }
    const timeoutController = new AbortController();
    const onAbort = () => timeoutController.abort();
    if (signal) {
      if (signal.aborted) throw new ProviderError('provider request was cancelled', { code: 'provider_cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    calls += 1;
    const startedAt = Date.now();
    try {
      let response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            'user-agent': USER_AGENT,
            'x-opencode-session': stableSession
          },
          body,
          redirect: 'error',
          signal: timeoutController.signal
        });
      } catch (error) {
        if (timeoutController.signal.aborted) {
          const code = signal?.aborted ? 'provider_cancelled' : 'provider_timeout';
          throw new ProviderError(code === 'provider_cancelled' ? 'provider request was cancelled' : 'provider request timed out', { code, cause: error });
        }
        throw new ProviderError('OpenCode provider request failed', { code: 'provider_network_error', cause: error });
      }
      const text = await responseText(response, timeoutController.signal);
      if (!response || !response.ok) {
        throw providerErrorForStatus(Number(response && response.status) || 0);
      }
      let parsed;
      try { parsed = JSON.parse(text); } catch (error) {
        throw new ProviderError('OpenCode provider returned invalid JSON', { code: 'provider_invalid_response', cause: error });
      }
      const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
      const content = textContent(choice && choice.message && choice.message.content);
      if (!content) throw new ProviderError('OpenCode provider returned no message content', { code: 'provider_invalid_response' });
      const usage = usageFrom(parsed);
      if (usage.outputTokens > boundedTokens || usage.outputTokens > MAX_OUTPUT_TOKENS) {
        throw new ProviderError('provider response exceeds token cap', { code: 'provider_response_too_large' });
      }
      last = { ok: true, status: Number(response.status) || 200, durationMs: Date.now() - startedAt };
      return { content, usage, model: parsed.model || MODEL, id: typeof parsed.id === 'string' ? parsed.id : null };
    } catch (error) {
      const normalized = error instanceof ProviderError ? error : new ProviderError('OpenCode provider request failed', { code: 'provider_error', cause: error });
      last = { ok: false, code: normalized.code, classification: normalized.classification, status: normalized.status, durationMs: Date.now() - startedAt };
      throw normalized;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  function status() {
    return {
      provider: 'opencode-go',
      connected: keyState === true,
      endpoint: ENDPOINT,
      model: MODEL,
      userAgent: USER_AGENT,
      configured: keyState,
      calls,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28, currency: 'USD' },
      privacy: { training: false, retention: '0 days', retentionDays: 0 },
      documentation: 'OpenCode Go: $0.14 input / $0.28 output per 1M tokens; no training; zero retention.',
      last
    };
  }

  return { complete, status };
}

module.exports = {
  ENDPOINT,
  MODEL,
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_OUTPUT_TOKENS,
  ProviderError,
  classifyStatus,
  createProvider
};
