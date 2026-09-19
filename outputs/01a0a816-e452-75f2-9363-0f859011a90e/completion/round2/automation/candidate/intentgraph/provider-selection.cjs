'use strict';

/*
 * Provider selection is a data contract. It deliberately does not read
 * credentials, probe a provider, or persist anything by itself. The host
 * supplies capability/status snapshots and (when it is ready to send) an
 * adapter. This keeps configured, connected, and response provenance
 * separate.
 */

const SELECTION_SCHEMA_VERSION = 1;
const PROVIDER_IDS = Object.freeze(['opencode', 'openrouter', 'anthropic', 'openai']);
const EFFORTS = Object.freeze(['none', 'low', 'medium', 'high', 'max']);
const PROVIDER_STATUSES = Object.freeze(['connected', 'configured', 'unavailable', 'unknown']);
const DEFAULT_SELECTION = Object.freeze({ providerId: 'opencode', modelId: 'mimo-v2.5', effort: 'none' });

const PROVIDER_CATALOG = Object.freeze([
  {
    id: 'opencode', label: 'OpenCode',
    // The existing OpenCode integration only sends the disabled-thinking
    // setting. Advertise that confirmed combination until the adapter reports
    // additional support explicitly.
    models: Object.freeze([{ id: 'mimo-v2.5', label: 'MiMo V2.5', efforts: Object.freeze(['none']) }])
  },
  { id: 'openrouter', label: 'OpenRouter', models: Object.freeze([]) },
  { id: 'anthropic', label: 'Anthropic', models: Object.freeze([]) },
  { id: 'openai', label: 'OpenAI', models: Object.freeze([]) }
]);

function text(value, max = 256) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function statusFor(record) {
  if (!record || typeof record !== 'object') return 'unknown';
  if (PROVIDER_STATUSES.includes(record.status)) return record.status;
  if (record.connected === true) return 'connected';
  if (record.configured === true) return 'configured';
  if (record.unavailable === true) return 'unavailable';
  return 'unknown';
}

function normalizeEfforts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => EFFORTS.includes(item)))];
}

function normalizeModel(model, fallbackProviderStatus = 'unknown') {
  if (!model || typeof model !== 'object') return null;
  const id = text(model.id || model.modelId, 200);
  if (!id) return null;
  const efforts = normalizeEfforts(model.efforts);
  const available = model.available === true || model.connected === true || model.status === 'connected';
  const status = PROVIDER_STATUSES.includes(model.status)
    ? model.status
    : available ? 'connected' : (model.configured === true ? 'configured' : fallbackProviderStatus);
  return {
    id,
    label: text(model.label, 200) || id,
    status,
    efforts,
    reason: text(model.reason, 400) || (status === 'unknown' ? 'Availability has not been checked.' : status === 'unavailable' ? 'Model is unavailable.' : '')
  };
}

function catalogFor(providerId) {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId) || null;
}

function normalizeCapabilities(snapshot = {}) {
  const supplied = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
  const suppliedById = new Map(supplied.filter((item) => item && typeof item === 'object').map((item) => [item.id, item]));
  const providers = PROVIDER_CATALOG.map((catalog) => {
    const record = suppliedById.get(catalog.id) || {};
    const status = statusFor(record);
    const suppliedModels = Array.isArray(record.models) ? record.models : [];
    const modelSource = suppliedModels.length ? suppliedModels : catalog.models;
    // A supplied model without its own availability signal is unknown. Only
    // the built-in catalog is allowed to inherit the provider's configured or
    // connected state because that model is a declared product capability.
    const modelFallback = suppliedModels.length ? 'unknown' : status;
    const models = modelSource.map((model) => normalizeModel(model, modelFallback)).filter(Boolean);
    const reason = text(record.reason, 400)
      || (status === 'unknown' ? 'Availability has not been checked.' : status === 'configured' ? 'Configured locally; connection has not been verified.' : status === 'unavailable' ? 'Provider is unavailable.' : '');
    return {
      id: catalog.id,
      label: catalog.label,
      status,
      configured: record.configured === true || status === 'configured' || status === 'connected',
      connected: record.connected === true || status === 'connected',
      reason,
      models
    };
  });
  return {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    checkedAt: text(snapshot?.checkedAt, 80) || null,
    providers
  };
}

function invalid(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}

function normalizeSelection(selection) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return null;
  const providerId = text(selection.providerId, 80);
  const modelId = text(selection.modelId, 200);
  const effort = text(selection.effort, 32);
  return providerId && modelId && effort ? { providerId, modelId, effort } : null;
}

function validateSelection(selection, capabilities) {
  if (selection && typeof selection === 'object' && !Array.isArray(selection) && Object.keys(selection).some((key) => !['providerId', 'modelId', 'effort'].includes(key))) {
    return invalid('invalid_selection', 'Provider selection contains an unsupported field.');
  }
  const normalized = normalizeSelection(selection);
  if (!normalized) return invalid('invalid_selection', 'Choose a provider, model, and effort.');
  if (!PROVIDER_IDS.includes(normalized.providerId)) return invalid('unknown_provider', 'That provider is not supported.');
  if (!EFFORTS.includes(normalized.effort)) return invalid('unsupported_effort', 'That effort is not supported.');
  const snapshot = normalizeCapabilities(capabilities);
  const provider = snapshot.providers.find((item) => item.id === normalized.providerId);
  if (!provider) return invalid('unknown_provider', 'That provider is not supported.');
  const providerReady = (provider.status === 'connected' && provider.connected === true)
    || (provider.status === 'configured' && provider.configured === true);
  if (!providerReady) {
    return invalid('provider_unavailable', provider.reason || 'Connect this provider before selecting it.', { provider, selection: normalized });
  }
  const model = provider.models.find((item) => item.id === normalized.modelId);
  if (!model) return invalid('unsupported_model', 'That model is not advertised by the connected provider.', { provider, selection: normalized });
  if (model.status !== 'connected' && model.status !== 'configured') return invalid('model_unavailable', model.reason || 'That model is unavailable.', { provider, model, selection: normalized });
  if (!model.efforts.includes(normalized.effort)) {
    return invalid('unsupported_combination', 'That effort is not supported for the selected model.', { provider, model, selection: normalized });
  }
  return { ok: true, selection: normalized, provider, model, capabilities: snapshot };
}

function resolveSelection({ selection, capabilities, defaultSelection = DEFAULT_SELECTION } = {}) {
  // Existing clients omit selection. Preserve the configured OpenCode default
  // while clearly identifying this as a legacy/default route in provenance.
  if (selection === undefined) {
    const fallback = normalizeSelection(defaultSelection) || clone(DEFAULT_SELECTION);
    // Runtime tests and direct legacy callers may omit a capability snapshot;
    // the HTTP dispatch path always supplies one and therefore validates the
    // configured default before starting a run.
    if (capabilities === undefined) return { ok: true, selection: fallback, legacy: true, source: 'configured-default' };
    const validation = validateSelection(fallback, capabilities);
    return validation.ok
      ? { ...validation, legacy: true, source: 'configured-default' }
      : { ...validation, legacy: true, source: 'configured-default' };
  }
  const result = validateSelection(selection, capabilities);
  return result.ok ? { ...result, legacy: false, source: 'explicit-selection' } : result;
}

function createProviderSelection({ getCapabilities, defaultSelection = DEFAULT_SELECTION } = {}) {
  async function capabilities() {
    try {
      const value = typeof getCapabilities === 'function' ? await getCapabilities() : {};
      return normalizeCapabilities(value);
    } catch {
      return normalizeCapabilities({ providers: [], checkedAt: null });
    }
  }
  async function resolve(selection) {
    const snapshot = await capabilities();
    return resolveSelection({ selection, capabilities: snapshot, defaultSelection });
  }
  return { capabilities, resolve };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const tokenCount = (value) => {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
      const parsed = Number(value.trim());
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }
    return null;
  };
  const aliases = [['inputTokens', ['inputTokens', 'input_tokens', 'prompt_tokens']], ['outputTokens', ['outputTokens', 'output_tokens', 'completion_tokens', 'generated_tokens']], ['totalTokens', ['totalTokens', 'total_tokens']]];
  const result = {};
  for (const [target, keys] of aliases) {
    const key = keys.find((candidate) => Object.hasOwn(usage, candidate));
    const value = key === undefined ? null : tokenCount(usage[key]);
    if (value !== null) result[target] = value;
  }
  return Object.keys(result).length ? result : null;
}

function responseProvenance({ requested, response = {}, providerId } = {}) {
  const requestedSelection = normalizeSelection(requested);
  const actualProviderId = text(response.providerId, 80) || null;
  const actualModelId = text(response.modelId || response.model, 200) || null;
  const actualEffort = text(response.effort, 32) || null;
  const effective = { providerId: actualProviderId, modelId: actualModelId, effort: actualEffort };
  const hasActual = Object.values(effective).some(Boolean);
  const match = Boolean(requestedSelection && actualProviderId && actualModelId && actualEffort
    && requestedSelection.providerId === actualProviderId
    && requestedSelection.modelId === actualModelId
    && requestedSelection.effort === actualEffort);
  return {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    requested: requestedSelection,
    effective,
    source: hasActual ? 'provider-response' : 'request-selection',
    match: hasActual ? match : null,
    usage: normalizeUsage(response.usage),
    providerId: actualProviderId,
    modelId: actualModelId,
    effort: actualEffort
  };
}

function createSelectionStore({ storage, key = 'aven-provider-selection-v1', defaultSelection = DEFAULT_SELECTION } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new TypeError('createSelectionStore requires storage');
  let committed = normalizeSelection(defaultSelection) || clone(DEFAULT_SELECTION);
  let draft = committed;
  function read() {
    try {
      const raw = storage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      const value = normalizeSelection(parsed);
      if (value) committed = value;
    } catch { /* Invalid or unavailable storage leaves the in-memory default. */ }
    draft = committed;
    return { ok: true, selection: clone(committed), draft: clone(draft) };
  }
  function setDraft(value) {
    const normalized = normalizeSelection(value);
    if (!normalized) return invalid('invalid_selection', 'Choose a provider, model, and effort.');
    draft = normalized;
    return { ok: true, selection: clone(draft) };
  }
  function cancel() {
    draft = committed;
    return { ok: true, selection: clone(draft), cancelled: true };
  }
  function save(capabilities) {
    const validation = validateSelection(draft, capabilities);
    if (!validation.ok) return validation;
    try {
      storage.setItem(key, JSON.stringify(draft));
      committed = draft;
      return { ok: true, selection: clone(committed), persisted: true };
    } catch {
      draft = committed;
      return invalid('persist_failed', 'Could not save the provider selection locally. The previous selection is retained.');
    }
  }
  return { read, setDraft, cancel, save, get committed() { return clone(committed); }, get draft() { return clone(draft); } };
}

module.exports = {
  SELECTION_SCHEMA_VERSION,
  PROVIDER_IDS,
  EFFORTS,
  PROVIDER_STATUSES,
  DEFAULT_SELECTION,
  PROVIDER_CATALOG,
  normalizeCapabilities,
  normalizeSelection,
  validateSelection,
  resolveSelection,
  createProviderSelection,
  normalizeUsage,
  responseProvenance,
  createSelectionStore
};
