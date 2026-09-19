'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PROVIDER_IDS, EFFORTS, normalizeCapabilities } = require('./provider-selection.cjs');

const CONFIG_SCHEMA_VERSION = 1;
const CONFIG_FILENAME = 'provider-config.json';
const DEFAULT_CREDENTIAL_REFS = Object.freeze({ opencode: 'opencode-go', openrouter: 'openrouter-api', anthropic: 'anthropic-api', openai: 'openai-api' });

function safeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const output = {};
  for (const key of ['status', 'configured', 'connected', 'reason']) {
    if (typeof record[key] === 'string' || typeof record[key] === 'boolean') output[key] = record[key];
  }
  if (typeof record.credentialRef === 'string' && /^[a-z][a-z0-9-]{1,60}$/.test(record.credentialRef)) output.credentialRef = record.credentialRef;
  if (Array.isArray(record.models)) {
    output.models = record.models.map((model) => {
      if (!model || typeof model !== 'object' || Array.isArray(model) || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 200) return null;
      const item = { id: model.id.trim() };
      for (const key of ['label', 'status', 'reason']) if (typeof model[key] === 'string') item[key] = model[key].slice(0, 400);
      if (Array.isArray(model.efforts)) item.efforts = model.efforts.filter((effort) => typeof effort === 'string').slice(0, 5);
      return item;
    }).filter(Boolean);
  }
  return output;
}

function readProviderConfig(runtimeDirectory, fsImpl = fs) {
  if (typeof runtimeDirectory !== 'string' || !runtimeDirectory) return { loaded: false, providers: {} };
  const filename = path.join(path.resolve(runtimeDirectory), CONFIG_FILENAME);
  let parsed;
  try { parsed = JSON.parse(fsImpl.readFileSync(filename, 'utf8')); } catch { return { loaded: false, providers: {}, filename }; }
  if (!parsed || parsed.schemaVersion !== CONFIG_SCHEMA_VERSION || !parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) return { loaded: false, providers: {}, filename };
  const providers = {};
  for (const providerId of PROVIDER_IDS) {
    const record = safeRecord(parsed.providers[providerId]);
    if (record) providers[providerId] = record;
  }
  return { loaded: Object.keys(providers).length > 0, providers, filename };
}

function writeProviderConfig(runtimeDirectory, providers, fsImpl = fs) {
  if (typeof runtimeDirectory !== 'string' || !runtimeDirectory) throw new TypeError('Provider config requires a runtime directory.');
  const sanitized = {};
  for (const providerId of PROVIDER_IDS) {
    const record = safeRecord(providers?.[providerId]);
    if (record) sanitized[providerId] = record;
  }
  const directory = path.resolve(runtimeDirectory);
  const filename = path.join(directory, CONFIG_FILENAME);
  fsImpl.mkdirSync(directory, { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  fsImpl.writeFileSync(temporary, JSON.stringify({ schemaVersion: CONFIG_SCHEMA_VERSION, providers: sanitized }, null, 2) + '\n', { mode: 0o600 });
  fsImpl.renameSync(temporary, filename);
  return { schemaVersion: CONFIG_SCHEMA_VERSION, providers: sanitized, filename };
}

function normalizeProviderConfigRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !['providerId', 'modelId', 'effort', 'credentialRef'].includes(key))) return null;
  const providerId = typeof value.providerId === 'string' ? value.providerId.trim() : '';
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  const effort = typeof value.effort === 'string' ? value.effort.trim() : '';
  const credentialRef = typeof value.credentialRef === 'string' ? value.credentialRef.trim() : '';
  if (!PROVIDER_IDS.includes(providerId) || !modelId || modelId.length > 200 || !EFFORTS.includes(effort) || !/^[a-z][a-z0-9-]{1,60}$/.test(credentialRef)) return null;
  return { providerId, modelId, effort, credentialRef };
}

function upsertProviderConfig(providers, request) {
  const normalized = normalizeProviderConfigRequest(request);
  if (!normalized) throw Object.assign(Error('Provider setup requires a supported provider, model, effort, and named credential reference.'), { code: 'invalid_provider_config' });
  if (normalized.providerId === 'opencode' && normalized.effort !== 'none') throw Object.assign(Error('OpenCode currently advertises only the None effort.'), { code: 'unsupported_effort' });
  const next = {};
  for (const providerId of PROVIDER_IDS) {
    const record = safeRecord(providers?.[providerId]);
    if (record) next[providerId] = record;
  }
  const current = next[normalized.providerId] || {};
  const models = Array.isArray(current.models) ? current.models : [];
  const model = models.find((item) => item.id === normalized.modelId) || { id: normalized.modelId };
  model.status = 'configured';
  model.reason = 'Configured locally; connection has not been verified.';
  model.efforts = [...new Set([...(Array.isArray(model.efforts) ? model.efforts : []), normalized.effort].filter((item) => EFFORTS.includes(item)))];
  next[normalized.providerId] = {
    ...current,
    status: 'configured',
    configured: true,
    connected: false,
    reason: 'Configured locally; connection has not been verified.',
    credentialRef: normalized.credentialRef,
    models: [...models.filter((item) => item.id !== normalized.modelId), model]
  };
  return { providers: next, selection: { providerId: normalized.providerId, modelId: normalized.modelId, effort: normalized.effort } };
}

/*
 * Explicit host wiring for provider adapters. This object contains function
 * references and non-secret capability metadata only. It never reads an env
 * var, vault, browser store, or provider endpoint on its own.
 */
function createProviderRuntimeConfig({ providers, runtimeDirectory, getVaultKey, getKey, fetchImpl = globalThis.fetch, modelFactory } = {}) {
  const persisted = providers === undefined ? readProviderConfig(runtimeDirectory) : { providers: {} };
  let configured = (providers === undefined ? persisted.providers : providers) && typeof (providers === undefined ? persisted.providers : providers) === 'object' ? (providers === undefined ? persisted.providers : providers) : {};
  const recordFor = (providerId) => configured[providerId] && typeof configured[providerId] === 'object' ? configured[providerId] : null;

  async function capabilities() {
    const records = PROVIDER_IDS.map((providerId) => {
      const record = recordFor(providerId) || {};
      const provider = { id: providerId, status: record.status, configured: record.configured === true, connected: record.connected === true, reason: record.reason, models: record.models };
      return Object.fromEntries(Object.entries(provider).filter(([, value]) => value !== undefined));
    });
    return normalizeCapabilities({ checkedAt: null, providers: records });
  }

  async function keyFor(providerId) {
    const record = recordFor(providerId);
    const getter = record?.getKey || getKey || (typeof getVaultKey === 'function' ? (credentialRef) => getVaultKey(credentialRef, providerId) : null);
    if (typeof getter !== 'function') throw Object.assign(Error('Provider credential is not configured by the host.'), { code: 'provider_key_unavailable' });
    if (record?.getKey || getKey) return getter(providerId);
    return getter(record?.credentialRef || DEFAULT_CREDENTIAL_REFS[providerId]);
  }

  function fetchFor(providerId, input, init) {
    const record = recordFor(providerId);
    const transport = record?.fetchImpl || fetchImpl;
    if (typeof transport !== 'function') throw Object.assign(Error('Provider transport is not configured by the host.'), { code: 'provider_fetch_unavailable' });
    return transport(input, init);
  }

  function modelFor(fields) {
    const providerId = fields?.providerId;
    const record = recordFor(providerId);
    const factory = record?.modelFactory || modelFactory;
    return typeof factory === 'function' ? factory(fields) : undefined;
  }
  modelFor.supportsProvider = (providerId) => typeof recordFor(providerId)?.modelFactory === 'function' || typeof modelFactory === 'function';

  const runtime = { capabilities, getKey: keyFor, fetch: fetchFor, reload: (nextProviders) => { configured = nextProviders && typeof nextProviders === 'object' ? nextProviders : {}; return capabilities(); } };
  if (typeof modelFactory === 'function' || PROVIDER_IDS.some((providerId) => typeof recordFor(providerId)?.modelFactory === 'function')) runtime.modelFactory = modelFor;
  return runtime;
}

module.exports = { CONFIG_SCHEMA_VERSION, CONFIG_FILENAME, DEFAULT_CREDENTIAL_REFS, readProviderConfig, writeProviderConfig, normalizeProviderConfigRequest, upsertProviderConfig, createProviderRuntimeConfig };
