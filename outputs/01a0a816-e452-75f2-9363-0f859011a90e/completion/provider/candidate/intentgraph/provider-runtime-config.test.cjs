'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProviderRuntimeConfig, CONFIG_FILENAME, readProviderConfig, writeProviderConfig, normalizeProviderConfigRequest, upsertProviderConfig } = require('./provider-runtime-config.cjs');

test('provider runtime config exposes only injected key, transport, model factory, and capabilities', async () => {
  const calls = [];
  const runtime = createProviderRuntimeConfig({
    providers: { openrouter: { status: 'configured', configured: true, models: [{ id: 'fixture/router', status: 'configured', efforts: ['none'] }] } },
    getKey: async (providerId) => { calls.push(['key', providerId]); return 'fixture-key'; },
    fetchImpl: async (input) => { calls.push(['fetch', input]); return { ok: true }; },
    modelFactory: (fields) => { calls.push(['model', fields.providerId]); return { fixture: true }; }
  });
  const capabilities = await runtime.capabilities();
  const provider = capabilities.providers.find((item) => item.id === 'openrouter');
  assert.equal(provider.status, 'configured');
  assert.equal(provider.connected, false);
  assert.equal(await runtime.getKey('openrouter'), 'fixture-key');
  assert.equal((await runtime.fetch('openrouter', 'https://openrouter.ai/api/v1')).ok, true);
  assert.deepEqual(runtime.modelFactory({ providerId: 'openrouter' }), { fixture: true });
  assert.equal(runtime.modelFactory.supportsProvider('openrouter'), true);
  assert.equal(runtime.modelFactory.supportsProvider('openai'), true);
  assert.deepEqual(calls, [['key', 'openrouter'], ['fetch', 'https://openrouter.ai/api/v1'], ['model', 'openrouter']]);
});

test('missing credential wiring remains unavailable while the host transport stays explicit', async () => {
  const runtime = createProviderRuntimeConfig({ providers: { anthropic: { status: 'configured', configured: true } } });
  await assert.rejects(runtime.getKey('anthropic'), /not configured/);
  assert.equal(typeof runtime.fetch, 'function');
  assert.equal(runtime.modelFactory, undefined);
});

test('provider config without a model factory leaves runtime construction to the selected built-in model path', () => {
  const runtime = createProviderRuntimeConfig({ providers: { openrouter: { status: 'configured', configured: true } }, fetchImpl: async () => ({ ok: true }) });
  assert.equal(runtime.modelFactory, undefined);
  assert.equal(typeof runtime.fetch, 'function');
});

test('provider-specific key and transport callbacks stay scoped to their provider', async () => {
  const calls = [];
  const runtime = createProviderRuntimeConfig({
    providers: {
      anthropic: {
        getKey: async (providerId) => { calls.push(['key', providerId]); return 'anthropic-fixture'; },
        fetchImpl: async (input) => { calls.push(['fetch', input]); return { ok: true }; }
      }
    },
    getKey: async () => { throw Error('global key must not be used'); },
    fetchImpl: async () => { throw Error('global transport must not be used'); }
  });
  assert.equal(await runtime.getKey('anthropic'), 'anthropic-fixture');
  assert.equal((await runtime.fetch('anthropic', 'https://api.anthropic.com/v1')).ok, true);
  assert.deepEqual(calls, [['key', 'anthropic'], ['fetch', 'https://api.anthropic.com/v1']]);
});

test('runtime loads and writes only nonsecret provider config with named vault references', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-provider-config-'));
  try {
    const saved = writeProviderConfig(directory, {
      openrouter: {
        status: 'configured', configured: true, credentialRef: 'router-fixture',
        models: [{ id: 'fixture/router', label: 'Router fixture', status: 'configured', efforts: ['none'] }],
        credential: 'must-not-persist'
      }
    });
    const raw = fs.readFileSync(path.join(directory, CONFIG_FILENAME), 'utf8');
    assert.doesNotMatch(raw, /must-not-persist/);
    const loaded = readProviderConfig(directory);
    assert.equal(loaded.loaded, true);
    const calls = [];
    const runtime = createProviderRuntimeConfig({
      runtimeDirectory: directory,
      getVaultKey: async (reference, providerId) => { calls.push([reference, providerId]); return 'fixture-key'; },
      fetchImpl: async () => ({ ok: true })
    });
    const capabilities = await runtime.capabilities();
    const provider = capabilities.providers.find((item) => item.id === 'openrouter');
    assert.equal(provider.status, 'configured');
    assert.equal(provider.models[0].id, 'fixture/router');
    assert.equal(await runtime.getKey('openrouter'), 'fixture-key');
    assert.deepEqual(calls, [['router-fixture', 'openrouter']]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('provider setup request is nonsecret, validates its named reference, and reloads capabilities', async () => {
  assert.deepEqual(normalizeProviderConfigRequest({ providerId: 'openrouter', modelId: 'fixture/router', effort: 'none', credentialRef: 'router-fixture' }), { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none', credentialRef: 'router-fixture' });
  assert.equal(normalizeProviderConfigRequest({ providerId: 'openrouter', modelId: 'fixture/router', effort: 'none', credentialRef: 'router-fixture', credential: 'secret' }), null);
  assert.throws(() => upsertProviderConfig({}, { providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'high', credentialRef: 'opencode-go' }), /only the None effort/);
  const applied = upsertProviderConfig({}, { providerId: 'openrouter', modelId: 'fixture/router', effort: 'none', credentialRef: 'router-fixture' });
  assert.equal(applied.providers.openrouter.status, 'configured');
  assert.equal(applied.providers.openrouter.connected, false);
  assert.equal(applied.providers.openrouter.models[0].id, 'fixture/router');
  const runtime = createProviderRuntimeConfig({ providers: {} });
  await runtime.reload(applied.providers);
  const provider = (await runtime.capabilities()).providers.find((item) => item.id === 'openrouter');
  assert.equal(provider.status, 'configured');
  assert.equal(provider.models[0].efforts[0], 'none');
});
