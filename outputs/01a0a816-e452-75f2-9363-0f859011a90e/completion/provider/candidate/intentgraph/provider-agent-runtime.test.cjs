'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { respond } = require('./agent-runtime.cjs');
const { createProviderRuntimeConfig } = require('./provider-runtime-config.cjs');

test('agent runtime dispatches a configured OpenRouter selection through injected transport without modelFactory', async () => {
  const calls = [];
  const runtime = createProviderRuntimeConfig({
    providers: { openrouter: { status: 'configured', configured: true, models: [{ id: 'fixture/router', status: 'configured', efforts: ['none'] }] } },
    getKey: async (providerId) => { calls.push(['key', providerId]); return 'fixture-key'; },
    fetchImpl: async (url, init) => {
      calls.push(['fetch', url, JSON.parse(init.body)]);
      return { ok: true, status: 200, json: async () => ({ model: 'fixture/router', choices: [{ message: { content: 'fixture answer' } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }) };
    }
  });
  const selection = { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none' };
  const capabilities = await runtime.capabilities();
  const result = await respond({
    mode: 'plan',
    messages: [{ role: 'user', content: 'Answer with the fixture phrase.' }],
    agentName: 'Provider fixture',
    chatId: 'provider-runtime-test',
    selection,
    providerCapabilities: capabilities,
    getKey: runtime.getKey,
    providerFetch: (input, init) => runtime.fetch(selection.providerId, input, init)
  });

  assert.match(result.text, /fixture answer/);
  assert.deepEqual(result.requestedSelection, selection);
  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.model, 'fixture/router');
  assert.equal(result.effort, 'none');
  assert.equal(result.provenance.requested.providerId, 'openrouter');
  assert.equal(result.provenance.effective.modelId, 'fixture/router');
  assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
  assert.equal(calls[0][0], 'key');
  assert.equal(calls[1][0], 'fetch');
  assert.equal(calls[1][1], 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[1][2].model, 'fixture/router');
});

test('mixed provider config falls back to the selected adapter when another provider owns the factory', async () => {
  const calls = [];
  const runtime = createProviderRuntimeConfig({
    providers: {
      openrouter: { status: 'configured', configured: true, models: [{ id: 'fixture/router', status: 'configured', efforts: ['none'] }], modelFactory: () => ({ wrongProvider: true }) },
      openai: { status: 'configured', configured: true, models: [{ id: 'fixture/openai', status: 'configured', efforts: ['none'] }] }
    },
    getKey: async () => 'fixture-key',
    fetchImpl: async (url, init) => {
      calls.push([url, JSON.parse(init.body)]);
      return { ok: true, status: 200, json: async () => ({ model: 'fixture/openai', choices: [{ message: { content: 'mixed fixture answer' } }] }) };
    }
  });
  const selection = { providerId: 'openai', modelId: 'fixture/openai', effort: 'none' };
  const result = await respond({
    mode: 'plan',
    messages: [{ role: 'user', content: 'Answer with the mixed fixture phrase.' }],
    agentName: 'Mixed provider fixture',
    chatId: 'mixed-provider-test',
    selection,
    providerCapabilities: await runtime.capabilities(),
    getKey: runtime.getKey,
    modelFactory: runtime.modelFactory,
    providerFetch: (input, init) => runtime.fetch(selection.providerId, input, init)
  });

  assert.match(result.text, /mixed fixture answer/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0][1].model, 'fixture/openai');
});
