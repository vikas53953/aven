'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_SELECTION,
  EFFORTS,
  normalizeCapabilities,
  createProviderSelection,
  resolveSelection,
  validateSelection,
  normalizeUsage,
  responseProvenance,
  createSelectionStore
} = require('./provider-selection.cjs');

function connectedSnapshot(extra = {}) {
  return normalizeCapabilities({
    checkedAt: '2026-09-16T00:00:00.000Z',
    providers: [
      { id: 'opencode', status: 'connected', connected: true, models: [{ id: 'mimo-v2.5', label: 'MiMo V2.5', status: 'connected', efforts: ['none', 'low'] }] },
      { id: 'openrouter', status: 'connected', connected: true, models: [{ id: 'fixture/open-model', status: 'connected', efforts: ['low', 'high'] }] },
      { id: 'anthropic', status: 'connected', connected: true, models: [{ id: 'fixture-claude', status: 'connected', efforts: ['none', 'high'] }] },
      { id: 'openai', status: 'connected', connected: true, models: [{ id: 'fixture-gpt', status: 'connected', efforts: ['none', 'medium'] }] }
    ],
    ...extra
  });
}

test('catalog keeps four first-class providers and does not infer availability', () => {
  const snapshot = normalizeCapabilities();
  assert.deepEqual(snapshot.providers.map((item) => item.id), ['opencode', 'openrouter', 'anthropic', 'openai']);
  assert.equal(snapshot.providers.find((item) => item.id === 'opencode').status, 'unknown');
  assert.equal(snapshot.providers.find((item) => item.id === 'openrouter').models.length, 0);
  assert.equal(snapshot.checkedAt, null);
});

test('explicit selection requires a configured provider, advertised model, and supported effort', () => {
  const capabilities = connectedSnapshot();
  assert.equal(validateSelection({ providerId: 'openrouter', modelId: 'fixture/open-model', effort: 'high' }, capabilities).ok, true);
  assert.equal(validateSelection({ providerId: 'openrouter', modelId: 'fixture/open-model', effort: 'max' }, capabilities).code, 'unsupported_combination');
  assert.equal(validateSelection({ providerId: 'anthropic', modelId: 'fixture-claude', effort: 'low' }, capabilities).code, 'unsupported_combination');
  assert.equal(validateSelection({ providerId: 'openai', modelId: 'unknown', effort: 'none' }, capabilities).code, 'unsupported_model');
  const unavailable = validateSelection(DEFAULT_SELECTION, normalizeCapabilities());
  assert.equal(unavailable.code, 'provider_unavailable');
  const unknownModelSnapshot = normalizeCapabilities({ providers: [{ id: 'openrouter', status: 'connected', connected: true, models: [{ id: 'fixture/unknown', efforts: ['none'] }] }] });
  assert.equal(unknownModelSnapshot.providers.find((item) => item.id === 'openrouter').models[0].status, 'unknown');
  assert.equal(validateSelection({ providerId: 'openrouter', modelId: 'fixture/unknown', effort: 'none' }, unknownModelSnapshot).code, 'model_unavailable');
  const configured = normalizeCapabilities({ providers: [{ id: 'opencode', status: 'configured', configured: true, models: [{ id: 'mimo-v2.5', status: 'configured', configured: true, efforts: ['none'] }] }] });
  const firstUse = validateSelection(DEFAULT_SELECTION, configured);
  assert.equal(firstUse.ok, true);
  assert.equal(firstUse.provider.connected, false);
});

test('legacy requests validate the configured default at dispatch', () => {
  const configured = normalizeCapabilities({ providers: [{ id: 'opencode', status: 'configured', configured: true, models: [{ id: 'mimo-v2.5', status: 'configured', configured: true, efforts: ['none'] }] }] });
  const resolved = resolveSelection({ capabilities: configured });
  assert.deepEqual(resolved.selection, DEFAULT_SELECTION);
  assert.equal(resolved.legacy, true);
  assert.equal(resolved.source, 'configured-default');
  assert.equal(resolveSelection({ capabilities: normalizeCapabilities() }).code, 'provider_unavailable');
  assert.equal(resolveSelection({}).ok, true);
});

test('injected capability source is the only source used to enable a provider', async () => {
  let reads = 0;
  const contract = createProviderSelection({ getCapabilities: async () => { reads += 1; return connectedSnapshot(); } });
  const resolved = await contract.resolve({ providerId: 'anthropic', modelId: 'fixture-claude', effort: 'high' });
  assert.equal(reads, 1);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.source, 'explicit-selection');
});

test('response provenance distinguishes provider metadata from request selection and missing usage', () => {
  const requested = { providerId: 'openrouter', modelId: 'fixture/open-model', effort: 'high' };
  const actual = responseProvenance({ requested, response: { providerId: 'openrouter', model: 'fixture/open-model', effort: 'high', usage: { input_tokens: 12, output_tokens: 4 } } });
  assert.equal(actual.source, 'provider-response');
  assert.equal(actual.match, true);
  assert.deepEqual(actual.usage, { inputTokens: 12, outputTokens: 4 });
  const missing = responseProvenance({ requested, response: {} });
  assert.equal(missing.source, 'request-selection');
  assert.equal(missing.match, null);
  assert.equal(missing.modelId, null);
  assert.equal(missing.usage, null);
  assert.equal(normalizeUsage({ input_tokens: null, output_tokens: '', total_tokens: false }), null);
  assert.deepEqual(normalizeUsage({ input_tokens: '12', output_tokens: 0 }), { inputTokens: 12, outputTokens: 0 });
});

test('selection store persists only a validated selection and cancel restores committed state', () => {
  const values = new Map(), writes = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); values.set(key, value); }
  };
  const store = createSelectionStore({ storage });
  store.read();
  const next = { providerId: 'openai', modelId: 'fixture-gpt', effort: 'medium' };
  assert.deepEqual(store.setDraft(next).selection, next);
  assert.equal(store.save(connectedSnapshot()).ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(store.committed, next);
  const unsupported = { providerId: 'openai', modelId: 'fixture-gpt', effort: 'max' };
  store.setDraft(unsupported);
  const rejected = store.save(connectedSnapshot());
  assert.equal(rejected.code, 'unsupported_combination');
  assert.equal(writes.length, 1);
  assert.deepEqual(store.committed, next);
  store.setDraft({ providerId: 'anthropic', modelId: 'fixture-claude', effort: 'high' });
  assert.equal(store.cancel().cancelled, true);
  assert.deepEqual(store.draft, next);
});

test('unavailable provider leaves previous persisted selection unchanged', () => {
  const values = new Map([['aven-provider-selection-v1', JSON.stringify(DEFAULT_SELECTION)]]), writes = 0;
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: () => { writes += 1; } };
  const store = createSelectionStore({ storage });
  store.read();
  store.setDraft({ providerId: 'anthropic', modelId: 'fixture-claude', effort: 'high' });
  const result = store.save(normalizeCapabilities());
  assert.equal(result.code, 'provider_unavailable');
  assert.equal(writes, 0);
  assert.deepEqual(store.committed, DEFAULT_SELECTION);
});

assert.ok(EFFORTS.includes('none'));
