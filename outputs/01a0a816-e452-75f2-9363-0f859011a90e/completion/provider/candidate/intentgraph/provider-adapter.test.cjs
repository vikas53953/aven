'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_PATH = require('path').join(process.cwd(), 'intentgraph', 'node_modules');
require('module').Module._initPaths();
const { createProviderAdapter, createLangChainModel } = require('./provider-adapter.cjs');

const connected = (providerId, modelId, efforts) => ({
  providers: [{ id: providerId, status: 'connected', connected: true, configured: true, models: [{ id: modelId, status: 'connected', efforts }] }]
});

test('OpenRouter sends selected model and supported effort through injected fetch', async () => {
  let call;
  const adapter = createProviderAdapter({
    providerId: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', credential: 'fixture-key',
    capabilities: connected('openrouter', 'anthropic/claude-sonnet', ['none', 'high']),
    fetchImpl: async (url, init) => {
      call = { url, init };
      return { ok: true, status: 200, json: async () => ({ model: 'anthropic/claude-sonnet', choices: [{ message: { content: 'fixture reply' } }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } }) };
    }
  });
  const result = await adapter.complete({ selection: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet', effort: 'high' }, messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'anthropic/claude-sonnet');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(call.init.headers.authorization, 'Bearer fixture-key');
  assert.equal(result.text, 'fixture reply');
  assert.deepEqual(result.requestedSelection, { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet', effort: 'high' });
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 3, totalTokens: 7 });
});

test('Anthropic uses its injected adapter path and does not read credentials', async () => {
  let calls = 0;
  const adapter = createProviderAdapter({
    providerId: 'anthropic', endpoint: 'https://api.anthropic.com/v1', credential: 'fixture-key',
    capabilities: connected('anthropic', 'claude-3-7-sonnet', ['none', 'medium']),
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'claude-3-7-sonnet');
      assert.equal(body.system, 'system fixture');
      assert.equal(body.messages.some((message) => message.role === 'system'), false);
      assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 2048 });
      assert.equal(init.headers['x-api-key'], 'fixture-key');
      return { ok: true, status: 200, json: async () => ({ model: 'claude-3-7-sonnet', content: [{ type: 'text', text: 'anthropic fixture' }], usage: { input_tokens: 2, output_tokens: 5 } }) };
    }
  });
  const result = await adapter.complete({ selection: { providerId: 'anthropic', modelId: 'claude-3-7-sonnet', effort: 'medium' }, messages: [{ role: 'system', content: 'system fixture' }, { role: 'user', content: 'hello' }] });
  assert.equal(calls, 1);
  assert.equal(result.text, 'anthropic fixture');
  assert.equal(result.effort, 'medium');
});

test('unsupported selections and missing injected fetch fail before transport', async () => {
  let calls = 0;
  const adapter = createProviderAdapter({
    providerId: 'openai', endpoint: 'https://api.openai.com/v1', credential: 'fixture-key',
    capabilities: connected('openai', 'gpt-fixture', ['none']),
    fetchImpl: async () => { calls += 1; throw new Error('must not run'); }
  });
  await assert.rejects(adapter.complete({ selection: { providerId: 'openai', modelId: 'gpt-fixture', effort: 'max' }, messages: [{ role: 'user', content: 'x' }] }), /effort is not supported/);
  assert.equal(calls, 0);
  assert.throws(() => createProviderAdapter({ providerId: 'openai', credential: 'fixture-key', capabilities: connected('openai', 'gpt-fixture', ['none']) }), /injected fetch/);
});

test('adapter rejects a selection for a different provider before adding auth headers', async () => {
  let calls = 0;
  const adapter = createProviderAdapter({
    providerId: 'openai', credential: 'fixture-key', capabilities: { providers: [
      { id: 'openai', status: 'configured', configured: true, models: [{ id: 'gpt-fixture', status: 'configured', configured: true, efforts: ['none'] }] },
      { id: 'openrouter', status: 'configured', configured: true, models: [{ id: 'router-fixture', status: 'configured', configured: true, efforts: ['none'] }] }
    ] },
    fetchImpl: async () => { calls += 1; throw new Error('must not run'); }
  });
  await assert.rejects(adapter.complete({ selection: { providerId: 'openrouter', modelId: 'router-fixture', effort: 'none' }, messages: [{ role: 'user', content: 'x' }] }), /does not match/);
  assert.equal(calls, 0);
});

test('adapter accepts only the official provider origin and exact base path', () => {
  for (const endpoint of ['https://evil.example.test/v1', 'https://openrouter.ai/api/v1?leak=1', 'https://user:pass@openrouter.ai/api/v1', 'https://openrouter.ai/api/v1#leak', 'http://openrouter.ai/api/v1']) {
    assert.throws(() => createProviderAdapter({ providerId: 'openrouter', endpoint, credential: 'fixture-key', fetchImpl: async () => ({ ok: true }), capabilities: connected('openrouter', 'fixture/open-model', ['none']) }), /approved official endpoint|HTTPS/);
  }
});

test('2xx empty responses are invalid and do not mark the adapter connected', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai', credential: 'fixture-key', capabilities: connected('openai', 'gpt-fixture', ['none']),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });
  await assert.rejects(adapter.complete({ selection: { providerId: 'openai', modelId: 'gpt-fixture', effort: 'none' }, messages: [{ role: 'user', content: 'x' }] }), /invalid successful response/);
  assert.equal(adapter.status().connected, false);
  const refusalAdapter = createProviderAdapter({
    providerId: 'openai', credential: 'fixture-key', capabilities: connected('openai', 'gpt-fixture', ['none']),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { refusal: 'fixture refusal' } }] }) })
  });
  const refusal = await refusalAdapter.complete({ selection: { providerId: 'openai', modelId: 'gpt-fixture', effort: 'none' }, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(refusal.refusal, 'fixture refusal');
});

test('OpenCode sends its stable session and user-agent headers', async () => {
  let request;
  const adapter = createProviderAdapter({
    providerId: 'opencode', credential: 'fixture-key', requestHeaders: { 'x-opencode-session': 'aven-chat-fixture' }, capabilities: connected('opencode', 'mimo-v2.5', ['none']),
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, json: async () => ({ model: 'mimo-v2.5', choices: [{ message: { content: 'opencode fixture' } }] }) };
    }
  });
  await adapter.complete({ selection: { providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none' }, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(request.url, 'https://opencode.ai/zen/go/v1/chat/completions');
  assert.equal(request.init.headers['x-opencode-session'], 'aven-chat-fixture');
  assert.equal(request.init.headers['user-agent'], 'netrok/1');
});

test('malformed successful tool results are rejected', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai', credential: 'fixture-key', capabilities: connected('openai', 'gpt-fixture', ['none']),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'fixture', arguments: '{bad-json' } }] } }] }) })
  });
  await assert.rejects(adapter.complete({ selection: { providerId: 'openai', modelId: 'gpt-fixture', effort: 'none' }, messages: [{ role: 'user', content: 'x' }] }), /invalid successful response/);
  assert.equal(adapter.status().connected, false);
});

test('injected transport is a usable LangChain model for a configured provider', async () => {
  const model = createLangChainModel({
    providerId: 'openai', credential: 'fixture-key', capabilities: connected('openai', 'gpt-fixture', ['none']),
    selection: { providerId: 'openai', modelId: 'gpt-fixture', effort: 'none' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ model: 'gpt-fixture', choices: [{ message: { content: 'langchain fixture' } }] }) })
  });
  const result = await model.invoke([{ role: 'user', content: 'hello' }]);
  assert.equal(result.content, 'langchain fixture');
  assert.deepEqual(result.response_metadata, { providerId: null, modelId: 'gpt-fixture', effort: null, usage: null });
});
