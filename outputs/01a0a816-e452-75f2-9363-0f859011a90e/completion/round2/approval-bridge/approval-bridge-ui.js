'use strict';

const APPROVAL_BRIDGE_MENU_ACTION = Object.freeze({
  id: 'approval-bridge-review',
  label: 'Review an adapter action',
  description: 'Inspect scope, impact and rollback limits before approving a browser or desktop adapter action.',
  opens: 'approval-bridge-pane',
  execution: 'explicit user approval only'
});

function chatExecutionMode(getMode) {
  const mode = typeof getMode === 'function' ? String(getMode() || '') : '';
  if (/^agent$/i.test(mode)) return 'inspect';
  if (/^plan$/i.test(mode)) return 'plan';
  return mode === 'write' ? 'write' : 'inspect';
}

function createApprovalBridgeClient({
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  basePath = '/api/approval-bridge',
  origin = typeof location === 'object' ? location.origin : '',
  currentChatId,
  getMode,
  adapterClient
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('approval bridge fetch implementation is required');
  let connection = null;
  let target = null;
  function headers() {
    if (!connection) throw new Error('Connect an adapter target before reviewing an action.');
    return {
      Origin: origin,
      'X-Aven-Approval': 'approval-bridge',
      'X-Aven-Approval-Token': connection.token,
      'X-Aven-Approval-Session': connection.sessionId,
      'X-Aven-Approval-Generation': String(connection.generation),
      'X-Aven-Approval-Connection': connection.connectionId,
      'X-Aven-Approval-Scope': connection.scopeKey
    };
  }
  async function call(path, body, { connect = false } = {}) {
    const response = await fetchImpl(`${basePath}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(connect ? { Origin: origin, 'X-Aven-Approval': 'approval-bridge' } : headers()) },
      body: JSON.stringify(body || {})
    });
    const result = await response.json();
    if (!response.ok) {
      const failure = new Error(result.reasons?.[0] || result.error || 'Approval bridge request failed.');
      Object.assign(failure, result);
      throw failure;
    }
    return result;
  }
  return {
    async connect({ scope, adapterIdentity, manualReviewOnly = true } = {}) {
      connection = await call('/connect', { scope, adapterIdentity, manualReviewOnly }, { connect: true });
      return { ...connection, token: undefined };
    },
    async disconnect() { const result = await call('/disconnect'); connection = null; return result; },
    async reload() { connection = await call('/reload'); return { ...connection, token: undefined }; },
    async rotate() { connection = await call('/rotate'); return { ...connection, token: undefined }; },
    async preview(request) {
      const executionMode = request.executionMode || chatExecutionMode(getMode);
      if (executionMode !== 'write') throw new Error('Agent and Plan chats can inspect or plan; choose an explicit write review to prepare an executable action.');
      return call('/preview', { ...request, executionMode, chatId: typeof currentChatId === 'function' ? currentChatId() : currentChatId });
    },
    async review(request) { return call('/review', request); },
    async approve(request) { return call('/approve', request); },
    async execute(request) { return call('/execute', request); },
    async cancel(request) { return call('/cancel', request); },
    async openBrowser(url) {
      if (!adapterClient?.openBrowser || !adapterClient?.inspectBrowser) throw new Error('Use the existing browser adapter opener to establish a target.');
      const opened = await adapterClient.openBrowser(url);
      if (!opened?.pageId) throw new Error('The browser adapter did not return an actual page target.');
      target = { mode: 'browser', pageId: opened.pageId };
      const inspection = await adapterClient.inspectBrowser(opened.pageId);
      return { ...opened, inspection };
    },
    async inspectBrowser(pageId) {
      if (!adapterClient?.inspectBrowser) throw new Error('Use the existing browser adapter inspector to establish a target.');
      if (!pageId) throw new Error('Choose an actual browser page returned by the adapter.');
      target = { mode: 'browser', pageId: String(pageId) };
      return adapterClient.inspectBrowser(pageId);
    },
    async listDesktopWindows() { if (!adapterClient?.listDesktopWindows) throw new Error('Use the existing desktop adapter window picker to establish a target.'); return adapterClient.listDesktopWindows(); },
    async selectDesktopWindow(window) {
      if (!adapterClient?.selectDesktopWindow || !window) throw new Error('Choose an actual desktop window returned by the adapter.');
      const selected = await adapterClient.selectDesktopWindow(window);
      target = { mode: 'desktop', selectedWindow: selected?.selectedWindow || window };
      return selected;
    },
    async inspectDesktop() {
      if (!adapterClient?.inspectDesktop) throw new Error('Use the existing desktop adapter inspector to establish a target.');
      if (!target || target.mode !== 'desktop') throw new Error('Choose a desktop window before inspecting it.');
      return adapterClient.inspectDesktop();
    },
    async connectCurrent({ scope, adapterIdentity, manualReviewOnly = true } = {}) {
      if (!target) throw new Error('Open a browser target or select a desktop window before connecting.');
      if (!scope || typeof scope !== 'object') throw new Error('A current reviewed scope is required before connecting.');
      return this.connect({ scope, adapterIdentity, manualReviewOnly });
    },
    connection: () => connection ? { ...connection, token: undefined } : null,
    target: () => target ? JSON.parse(JSON.stringify(target)) : null,
    executionMode: () => chatExecutionMode(getMode)
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function valueText(value) {
  if (!value || value.status !== 'available') return value?.reason || 'Unavailable';
  return value.value || '(empty)';
}

function affectedText(impact) {
  const targets = Array.isArray(impact?.affectedTargets) ? impact.affectedTargets.slice(0, 10) : [];
  if (!targets.length) return 'Unavailable';
  return targets.map((target) => {
    if (!target || typeof target !== 'object') return 'Selected target';
    return String(target.label || target.name || target.deviceId || target.title || 'Selected target');
  }).join(', ');
}

function browserTargetLabel(node) {
  const label = node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || node.getAttribute('name') || node.tagName;
  return String(label || 'Browser control').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Browser control';
}

function cssIdentifier(value) {
  const source = String(value || '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(source);
  return source.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function selectorForNode(node) {
  if (node.id) return `#${cssIdentifier(node.id)}`;
  const segments = [];
  let current = node;
  while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== 'html') {
    const tag = current.tagName.toLowerCase();
    let segment = tag;
    const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
    if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    segments.unshift(segment);
    current = current.parentElement;
  }
  return segments.join(' > ');
}

function browserTargetsFromInspection(inspection) {
  if (!inspection?.dom || typeof DOMParser === 'undefined') return [];
  let documentValue;
  try { documentValue = new DOMParser().parseFromString(inspection.dom, 'text/html'); } catch { return []; }
  return [...documentValue.querySelectorAll('button,input,textarea,select,a,[role="button"]')].slice(0, 100).flatMap((node) => {
    const type = String(node.getAttribute('type') || '').toLowerCase();
    const searchable = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''} ${node.getAttribute('name') || ''} ${node.textContent || ''}`;
    if (type === 'password' || /password|passcode|secret|token|credential|authorization|otp/i.test(searchable)) return [];
    const selector = selectorForNode(node);
    return selector ? [{ selector, label: browserTargetLabel(node), kind: node.matches('input,textarea,select') ? 'fill' : 'click' }] : [];
  });
}

function desktopControlLabel(control) {
  return String(control?.title || control?.automationId || control?.controlKind || 'Desktop control').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function mountApprovalBridgePane(container, bridgeClient, { getScope, adapterIdentity, getInventory } = {}) {
  if (!container || typeof container.replaceChildren !== 'function') throw new Error('approval bridge pane container is required');
  if (!bridgeClient || typeof bridgeClient.preview !== 'function') throw new Error('approval bridge client is required');
  const root = element('section', 'approval-bridge-pane');
  root.setAttribute('aria-label', 'Adapter action review');
  const header = element('header', 'approval-bridge-pane__header');
  header.append(element('p', 'approval-bridge-pane__eyebrow', 'ACTION REVIEW'), element('h2', '', 'Inspect before approval'));
  header.append(element('p', 'approval-bridge-pane__note', 'Establish a target with the existing browser opener or desktop window inspector, then connect this review session. The bridge never guesses a page, window or control.'));
  root.append(header);
  const setup = element('div', 'approval-bridge-pane__setup');
  const targetStatus = element('p', 'approval-bridge-pane__target-status', 'No adapter target established.');
  const browserUrl = element('input', 'approval-bridge-pane__url');
  browserUrl.type = 'url';
  browserUrl.placeholder = 'Approved browser URL';
  const openBrowser = element('button', '', 'Open and inspect browser');
  openBrowser.type = 'button';
  const desktopWindows = element('select', 'approval-bridge-pane__windows');
  desktopWindows.setAttribute('aria-label', 'Adapter desktop windows');
  const listWindows = element('button', '', 'List desktop windows');
  listWindows.type = 'button';
  const selectWindow = element('button', '', 'Select and inspect desktop window');
  selectWindow.type = 'button';
  const browserTargetSelect = element('select', 'approval-bridge-pane__targets');
  browserTargetSelect.setAttribute('aria-label', 'Inspected browser controls');
  const desktopControlSelect = element('select', 'approval-bridge-pane__controls');
  desktopControlSelect.setAttribute('aria-label', 'Inspected desktop controls');
  const actionKind = element('select', 'approval-bridge-pane__kind');
  actionKind.append(element('option', '', 'Click'), element('option', '', 'Fill'));
  actionKind.options[0].value = 'click';
  actionKind.options[1].value = 'fill';
  const actionText = element('input', 'approval-bridge-pane__text');
  actionText.type = 'text';
  actionText.placeholder = 'Optional bounded fill text';
  const reviewAction = element('button', '', 'Review action');
  reviewAction.type = 'button';
  const connectTarget = element('button', '', 'Connect this target');
  connectTarget.type = 'button';
  setup.append(targetStatus, browserUrl, openBrowser, browserTargetSelect, desktopWindows, listWindows, desktopControlSelect, selectWindow, actionKind, actionText, reviewAction, connectTarget);
  root.append(setup);
  const networkSetup = element('section', 'approval-bridge-pane__network');
  networkSetup.append(element('h3', '', 'Network review (read-only)'));
  networkSetup.append(element('p', 'approval-bridge-pane__note', 'Choose actual inventory devices and an allowlisted proposal. Device writes stay disabled until a network recovery contract is connected.'));
  const networkDevices = element('select', 'approval-bridge-pane__network-devices');
  networkDevices.multiple = true;
  networkDevices.size = 4;
  networkDevices.setAttribute('aria-label', 'Current network inventory devices');
  const loadInventory = element('button', '', 'Load current inventory');
  loadInventory.type = 'button';
  const networkOperation = element('select', 'approval-bridge-pane__network-operation');
  for (const [value, label] of [
    ['diagnostic-interface-summary', 'Read-only interface status'],
    ['diagnostic-route-summary', 'Read-only route summary'],
    ['proposed-config-change', 'Proposed config change (write unavailable)']
  ]) { const option = element('option', '', label); option.value = value; networkOperation.append(option); }
  const reviewNetwork = element('button', '', 'Review network proposal');
  reviewNetwork.type = 'button';
  const networkExecute = element('button', '', 'Execute network proposal');
  networkExecute.type = 'button';
  networkExecute.disabled = true;
  networkExecute.title = 'Disabled until a network write and recovery-plan contract exists.';
  const networkStatus = element('p', 'approval-bridge-pane__target-status', 'No network inventory loaded.');
  const networkReview = element('div', 'approval-bridge-pane__network-review');
  networkSetup.append(networkDevices, loadInventory, networkOperation, reviewNetwork, networkExecute, networkStatus, networkReview);
  root.append(networkSetup);
  const status = element('p', 'approval-bridge-pane__status', 'No preview is loaded.');
  status.setAttribute('role', 'status');
  root.append(status);
  const review = element('div', 'approval-bridge-pane__review');
  root.append(review);
  const actions = element('div', 'approval-bridge-pane__actions');
  const approve = element('button', '', 'Approve this preview');
  approve.type = 'button';
  approve.disabled = true;
  const execute = element('button', '', 'Execute approved action');
  execute.type = 'button';
  execute.disabled = true;
  const cancel = element('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.disabled = true;
  actions.append(approve, execute, cancel);
  root.append(actions);

  let current = null;
  let approval = null;
  let windows = [];
  let browserTargets = [];
  let desktopControlList = [];
  let paneApi = null;
  let inventoryDevices = [];
  openBrowser.addEventListener('click', async () => {
    try {
      const opened = await bridgeClient.openBrowser(browserUrl.value);
      browserTargets = browserTargetsFromInspection(opened.inspection);
      browserTargetSelect.replaceChildren(...browserTargets.map((target, index) => {
        const option = element('option', '', target.label);
        option.value = String(index);
        return option;
      }));
      targetStatus.textContent = browserTargets.length ? `Browser target established; choose an inspected control in the adapter-owned headless context.` : 'Browser target established, but no actionable controls were observed.';
    } catch (cause) { targetStatus.textContent = cause?.message || 'Browser target setup failed.'; }
  });
  const updateBrowserTargets = async () => {
    if (!bridgeClient.target?.() || bridgeClient.target().mode !== 'browser') { targetStatus.textContent = 'Open a browser target before inspecting controls.'; return; }
    try {
      const inspection = await bridgeClient.inspectBrowser(bridgeClient.target().pageId);
      browserTargets = browserTargetsFromInspection(inspection);
      browserTargetSelect.replaceChildren(...browserTargets.map((target, index) => { const option = element('option', '', target.label); option.value = String(index); return option; }));
      targetStatus.textContent = browserTargets.length ? 'Choose an inspected browser control.' : 'No actionable browser controls were observed.';
    } catch (cause) { targetStatus.textContent = cause?.message || 'Browser inspection failed.'; }
  };
  listWindows.addEventListener('click', async () => {
    try {
      const result = await bridgeClient.listDesktopWindows();
      windows = Array.isArray(result?.windows) ? result.windows : [];
      desktopWindows.replaceChildren(...windows.map((window, index) => {
        const option = element('option', '', `${window.title || 'Untitled window'}${window.processName ? ` · ${window.processName}` : ''}`);
        option.value = String(index);
        return option;
      }));
      targetStatus.textContent = windows.length ? 'Choose an adapter-listed desktop window.' : 'No accessible desktop windows.';
    } catch (cause) { targetStatus.textContent = cause?.message || 'Desktop window listing failed.'; }
  });
  selectWindow.addEventListener('click', async () => {
    const selected = windows[Number(desktopWindows.value)];
    if (!selected) { targetStatus.textContent = 'Choose a desktop window returned by the adapter.'; return; }
    try {
      await bridgeClient.selectDesktopWindow(selected);
      const inspection = await bridgeClient.inspectDesktop();
      desktopControlList = Array.isArray(inspection?.controls) ? inspection.controls : [];
      desktopControlSelect.replaceChildren(...desktopControlList.map((control, index) => { const option = element('option', '', desktopControlLabel(control)); option.value = String(index); return option; }));
      targetStatus.textContent = desktopControlList.length ? `Desktop target established; choose an inspected control in the adapter-owned window.` : 'Desktop target established, but no actionable controls were observed.';
    } catch (cause) { targetStatus.textContent = cause?.message || 'Desktop target setup failed.'; }
  });
  connectTarget.addEventListener('click', async () => {
    try {
      if (typeof bridgeClient.connectCurrent !== 'function') throw new Error('Bridge connection setup is unavailable.');
      const scope = typeof getScope === 'function' ? getScope() : undefined;
      await bridgeClient.connectCurrent({ scope, adapterIdentity, manualReviewOnly: true });
      targetStatus.textContent = 'Target connected for manual review.';
    } catch (cause) { targetStatus.textContent = cause?.message || 'Target connection failed.'; }
  });
  loadInventory.addEventListener('click', async () => {
    try {
      if (typeof getInventory !== 'function') throw new Error('Current adapter inventory is unavailable.');
      const result = await getInventory();
      const devices = Array.isArray(result) ? result : result?.devices;
      inventoryDevices = Array.isArray(devices) ? devices.filter((device) => device && typeof device === 'object' && (device.deviceId || device.id)).slice(0, 100) : [];
      networkDevices.replaceChildren(...inventoryDevices.map((device) => {
        const id = String(device.deviceId || device.id);
        const option = element('option', '', String(device.label || device.name || id).slice(0, 100));
        option.value = id;
        return option;
      }));
      networkStatus.textContent = inventoryDevices.length ? 'Choose one or more inventory devices.' : 'No current inventory devices were returned.';
    } catch (cause) { networkStatus.textContent = cause?.message || 'Inventory loading failed.'; }
  });
  reviewNetwork.addEventListener('click', () => {
    const ids = [...networkDevices.selectedOptions].map((option) => option.value).filter(Boolean);
    if (!ids.length) { networkStatus.textContent = 'Choose actual inventory devices before reviewing.'; return; }
    const operation = networkOperation.options[networkOperation.selectedIndex];
    networkReview.replaceChildren();
    for (const [label, value] of [
      ['Affected devices', ids.join(', ')],
      ['Proposed operation', operation?.textContent || 'Allowlisted read-only diagnostic'],
      ['Current value', 'Unavailable until a bounded device read is supplied'],
      ['Impact', 'Unavailable; no network write or provider call is made by this review'],
      ['Rollback', 'Unavailable; no recovery plan is configured']
    ]) {
      const row = element('div', 'approval-bridge-pane__row');
      row.append(element('dt', '', label), element('dd', '', value));
      networkReview.append(row);
    }
    networkStatus.textContent = 'Network proposal reviewed. Execute remains disabled until the network recovery contract exists.';
  });
  reviewAction.addEventListener('click', async () => {
    try {
      const target = bridgeClient.target?.();
      const connection = bridgeClient.connection?.();
      if (!target || !connection) throw new Error('Establish and connect an adapter target first.');
      const kind = actionKind.value === 'fill' ? 'fill' : 'click';
      const text = actionText.value;
      if (kind === 'fill' && !text.trim()) throw new Error('Enter bounded fill text or choose Click.');
      if (kind === 'click' && text) throw new Error('Clear fill text before choosing Click.');
      let request;
      if (target.mode === 'browser') {
        const selected = browserTargets[Number(browserTargetSelect.value)];
        if (!selected) throw new Error('Choose an inspected browser control first.');
        request = { mode: 'browser', executionMode: 'write', targetScope: connection.scope, operation: { type: 'browser.preview', pageId: target.pageId, kind, selector: selected.selector, ...(kind === 'fill' ? { text } : {}) } };
      } else {
        const selected = desktopControlList[Number(desktopControlSelect.value)];
        if (!selected) throw new Error('Choose an inspected desktop control first.');
        const targetControl = { controlKind: selected.controlKind, title: selected.title, ...(selected.automationId ? { automationId: selected.automationId } : {}), ...(selected.className ? { className: selected.className } : {}) };
        request = { mode: 'desktop', executionMode: 'write', targetScope: connection.scope, operation: { type: 'desktop.preview', kind, targetControl, ...(kind === 'fill' ? { text } : {}) } };
      }
      if (!paneApi) throw new Error('Review pane is still loading.');
      await paneApi.load(request);
    } catch (cause) { status.textContent = cause?.message || 'Action review failed.'; }
  });
  function show(record) {
    current = record;
    review.replaceChildren();
    if (!record) {
      status.textContent = 'No preview is loaded.';
      approve.disabled = true;
      execute.disabled = true;
      cancel.disabled = true;
      return;
    }
    const rows = [
      ['Adapter context', record.adapterOwnedContext || 'Adapter-owned context'],
      ['Action', record.actionSummary || 'Selected adapter action'],
      ['Target', record.targetSummary || 'Adapter-selected target'],
      ['Current value', valueText(record.currentValue)],
      ['Affected targets', affectedText(record.impact)],
      ['Impact', record.impact?.summary || 'Unavailable'],
      ['Rollback', record.rollback?.reason || 'Unavailable'],
      ['Expiry', record.expiresAt ? new Date(record.expiresAt).toISOString() : 'Unavailable']
    ];
    for (const [label, value] of rows) {
      const row = element('div', 'approval-bridge-pane__row');
      row.append(element('dt', '', label), element('dd', '', value));
      review.append(row);
    }
    const note = element('p', 'approval-bridge-pane__note', 'Chat revert changes conversation history; it cannot roll back an executed device, desktop or browser action. Sensitive fills are rejected.');
    review.append(note);
    status.textContent = record.status === 'approved' ? 'Approval is ready for one execution.' : 'Review the bounded scope before approving.';
    approve.disabled = record.status !== 'previewed';
    execute.disabled = record.status !== 'approved';
    cancel.disabled = false;
  }

  approve.addEventListener('click', async () => {
    if (!current) return;
    approve.disabled = true;
    try {
      approval = await bridgeClient.approve({ previewToken: current.previewToken, digest: current.digest, approved: true });
      show(approval);
    } catch (cause) {
      status.textContent = cause?.message || 'Approval failed.';
      approve.disabled = false;
    }
  });
  execute.addEventListener('click', async () => {
    if (!approval) return;
    execute.disabled = true;
    try {
      const result = await bridgeClient.execute({ approvalToken: approval.approvalToken, digest: approval.digest });
      show(null);
      status.textContent = result.unknown ? 'Execution state is UNKNOWN. Do not retry.' : 'Action executed once through the adapter.';
    } catch (cause) {
      status.textContent = cause?.unknown ? 'Execution state is UNKNOWN. Do not retry.' : (cause?.message || 'Execution failed.');
      execute.disabled = true;
    }
  });
  cancel.addEventListener('click', async () => {
    if (!current) return;
    try {
      const result = await bridgeClient.cancel({ previewToken: current.previewToken, approvalToken: approval?.approvalToken });
      if (!result?.cancelled) throw new Error('The review could not be cancelled.');
      approval = null;
      show(null);
      status.textContent = 'Preview cancelled.';
    } catch (cause) { status.textContent = cause?.message || 'Cancellation failed.'; }
  });
  container.replaceChildren(root);
  const load = async (request) => {
    const result = await bridgeClient.preview(request);
    approval = null;
    show(result);
    return result;
  };
  paneApi = { load };
  return {
    element: root,
    load,
    destroy: () => container.replaceChildren()
  };
}

const ApprovalBridgeUI = { APPROVAL_BRIDGE_MENU_ACTION, createApprovalBridgeClient, mountApprovalBridgePane, chatExecutionMode };
if (typeof module !== 'undefined') module.exports = ApprovalBridgeUI;
if (typeof globalThis !== 'undefined') globalThis.AvenApprovalBridgeUI = ApprovalBridgeUI;
