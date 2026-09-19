/* Provider/model/effort picker. The host owns persistence, capability loading and send. */
(function (root) {
  'use strict';
  const STATUS_LABELS = Object.freeze({
    connected: 'Connected',
    configured: 'Configured locally · connection not verified',
    unavailable: 'Unavailable',
    unknown: 'Availability not checked'
  });

  const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const statusLabel = status => STATUS_LABELS[status] || STATUS_LABELS.unknown;

  function providerFor(snapshot, id) {
    return (Array.isArray(snapshot?.providers) ? snapshot.providers : []).find(item => item?.id === id) || null;
  }

  function modelFor(provider, id) {
    return (Array.isArray(provider?.models) ? provider.models : []).find(item => item?.id === id) || null;
  }

  function selectionFrom(container) {
    return {
      providerId: container.querySelector('[data-provider-field="providerId"]')?.value || '',
      modelId: container.querySelector('[data-provider-field="modelId"]')?.value || '',
      effort: container.querySelector('[data-provider-field="effort"]')?.value || ''
    };
  }

  function validateSelection(selection, snapshot = {}) {
    const providerId = text(selection?.providerId);
    const modelId = text(selection?.modelId);
    const effort = text(selection?.effort);
    if (!providerId || !modelId || !effort) return { ok: false, code: 'invalid_selection', reason: 'Choose a provider, model, and effort.' };
    const provider = providerFor(snapshot, providerId);
    const providerReady = (provider?.status === 'connected' && provider.connected === true) || (provider?.status === 'configured' && provider.configured === true);
    if (!provider || !providerReady) return { ok: false, code: 'provider_unavailable', reason: provider?.reason || 'Configure this provider before selecting it.' };
    const model = modelFor(provider, modelId);
    if (!model || (model.status !== 'connected' && model.status !== 'configured')) return { ok: false, code: 'unsupported_model', reason: model?.reason || 'That model is not advertised by the provider.' };
    if (!Array.isArray(model.efforts) || !model.efforts.includes(effort)) return { ok: false, code: 'unsupported_combination', reason: 'That effort is not supported for the selected model.' };
    return { ok: true, selection: { providerId, modelId, effort }, provider, model };
  }

  function option(documentRef, value, label, disabled = false) {
    const item = documentRef.createElement('option');
    item.value = value;
    item.textContent = label;
    item.disabled = disabled;
    return item;
  }

  function render(container, { snapshot = {}, selection = {}, onChange, onSave, onCancel } = {}) {
    if (!container || !container.ownerDocument) throw new TypeError('Provider picker requires a DOM container.');
    const documentRef = container.ownerDocument;
    const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
    const selectedProviderId = text(selection.providerId, providers[0]?.id || '');
    const selectedProvider = providerFor(snapshot, selectedProviderId);
    const selectedModelId = text(selection.modelId, selectedProvider?.models?.[0]?.id || '');
    const selectedModel = modelFor(selectedProvider, selectedModelId);
    const selectedEffort = text(selection.effort, selectedModel?.efforts?.[0] || '');
    container.replaceChildren();
    const heading = documentRef.createElement('h3');
    heading.textContent = 'Provider and model';
    const note = documentRef.createElement('p');
    note.className = 'provider-picker-note';
    note.textContent = 'Only locally configured providers and their advertised model/effort combinations can be selected. Connection status stays explicit. Credentials stay out of this view.';
    const fields = documentRef.createElement('div');
    fields.className = 'provider-picker-fields';
    const providerSelect = documentRef.createElement('select');
    providerSelect.dataset.providerField = 'providerId';
    providerSelect.id = 'provider-select';
    providerSelect.setAttribute('aria-label', 'Provider');
    providers.forEach(provider => {
      const unavailable = !((provider.status === 'connected' && provider.connected === true) || (provider.status === 'configured' && provider.configured === true));
      const label = `${text(provider.label, provider.id)} · ${statusLabel(provider.status)}`;
      providerSelect.append(option(documentRef, provider.id, label, unavailable));
    });
    if (!providers.some(provider => provider.id === selectedProviderId)) providerSelect.append(option(documentRef, selectedProviderId, `${selectedProviderId} · unavailable`, true));
    providerSelect.value = selectedProviderId;
    const providerLabel = documentRef.createElement('label');
    providerLabel.textContent = 'Provider';
    providerLabel.append(providerSelect);
    fields.append(providerLabel);
    const modelSelect = documentRef.createElement('select');
    modelSelect.dataset.providerField = 'modelId';
    modelSelect.id = 'model-select';
    modelSelect.setAttribute('aria-label', 'Model');
    const models = Array.isArray(selectedProvider?.models) ? selectedProvider.models : [];
    models.forEach(model => modelSelect.append(option(documentRef, model.id, `${text(model.label, model.id)} · ${statusLabel(model.status)}`, model.status !== 'connected' && model.status !== 'configured')));
    if (!models.length) modelSelect.append(option(documentRef, '', 'No connected model advertised', true));
    else if (!models.some(model => model.id === selectedModelId)) modelSelect.append(option(documentRef, selectedModelId, `${selectedModelId} · unavailable`, true));
    modelSelect.value = selectedModelId;
    const modelLabel = documentRef.createElement('label');
    modelLabel.textContent = 'Model';
    modelLabel.append(modelSelect);
    fields.append(modelLabel);
    const effortSelect = documentRef.createElement('select');
    effortSelect.dataset.providerField = 'effort';
    effortSelect.id = 'effort-select';
    effortSelect.setAttribute('aria-label', 'Effort');
    const efforts = Array.isArray(selectedModel?.efforts) ? selectedModel.efforts : [];
    efforts.forEach(effort => effortSelect.append(option(documentRef, effort, effort === 'none' ? 'None' : effort[0].toUpperCase() + effort.slice(1), false)));
    if (!efforts.length) effortSelect.append(option(documentRef, '', 'No supported effort advertised', true));
    else if (!efforts.includes(selectedEffort)) effortSelect.append(option(documentRef, selectedEffort, `${selectedEffort} · unavailable`, true));
    effortSelect.value = selectedEffort;
    const effortLabel = documentRef.createElement('label');
    effortLabel.textContent = 'Effort';
    effortLabel.append(effortSelect);
    fields.append(effortLabel);
    const state = documentRef.createElement('p');
    state.className = 'provider-picker-status';
    state.setAttribute('role', 'status');
    state.textContent = selectedProvider ? `${text(selectedProvider.label, selectedProvider.id)}: ${statusLabel(selectedProvider.status)}${selectedProvider.reason ? ` · ${selectedProvider.reason}` : ''}` : 'Provider availability is unavailable.';
    const actions = documentRef.createElement('div');
    actions.className = 'provider-picker-actions';
    if (typeof onCancel === 'function') {
      const cancel = documentRef.createElement('button');
      cancel.type = 'button';
      cancel.className = 'button-secondary';
      cancel.textContent = 'Cancel';
      cancel.onclick = () => onCancel();
      actions.append(cancel);
    }
    if (typeof onSave === 'function') {
      const save = documentRef.createElement('button');
      save.type = 'button';
      save.className = 'button-primary';
      save.textContent = 'Save selection';
      save.onclick = () => onSave(selectionFrom(container));
      actions.append(save);
    }
    const notify = () => {
      const current = selectionFrom(container);
      const provider = providerFor(snapshot, current.providerId);
      const model = modelFor(provider, current.modelId);
      state.textContent = provider ? `${text(provider.label, provider.id)}: ${statusLabel(provider.status)}${provider.reason ? ` · ${provider.reason}` : ''}${model?.reason ? ` · ${model.reason}` : ''}` : 'Provider availability is unavailable.';
      if (typeof onChange === 'function') onChange(current);
    };
    providerSelect.onchange = () => { render(container, { snapshot, selection: { ...selectionFrom(container), providerId: providerSelect.value, modelId: '', effort: '' }, onChange, onSave, onCancel }); notify(); };
    modelSelect.onchange = () => { render(container, { snapshot, selection: { ...selectionFrom(container), modelId: modelSelect.value, effort: '' }, onChange, onSave, onCancel }); notify(); };
    effortSelect.onchange = notify;
    container.append(heading, note, fields, state, actions);
    return { selection: selectionFrom(container), status: selectedProvider?.status || 'unknown' };
  }

  root.AvenProviderPicker = { STATUS_LABELS, statusLabel, selectionFrom, validateSelection, render };
})(typeof window !== 'undefined' ? window : globalThis);
