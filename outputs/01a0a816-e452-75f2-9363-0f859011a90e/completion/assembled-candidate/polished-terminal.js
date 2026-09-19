(function terminalSurface(global) {
  'use strict';

  const STORAGE_VERSION = 1;
  const DEFAULT_STORAGE_KEY = 'aven-terminal-evidence-v1';
  const MAX_RECORDS = 8;
  const STATUSES = new Set(['SUCCESS', 'FAILURE', 'UNKNOWN', 'NOT_EXECUTED']);
  const terminalText = value => value === undefined || value === null ? '' : String(value);
  const requestIdentity = () => {
    if (typeof global.crypto?.randomUUID === 'function') return global.crypto.randomUUID();
    if (typeof global.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16); global.crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return '';
  };

  function normalizedDevice(device) {
    if (!device || typeof device !== 'object' || typeof device.id !== 'string' || !device.id.trim()) return null;
    const commands = Array.isArray(device.supportedCommands)
      ? [...new Set(device.supportedCommands.filter(command => typeof command === 'string' && command.trim()))]
      : [];
    return {
      id: device.id,
      hostname: terminalText(device.hostname || device.id),
      platform: terminalText(device.platform || 'Unknown platform'),
      transport: terminalText(device.transport || 'network diagnostic'),
      managementIp: terminalText(device.managementIp),
      reachability: terminalText(device.reachability || 'Reachability unverified'),
      supportedCommands: commands
    };
  }

  function normalizeInventory(snapshot) {
    const devices = [];
    const seen = new Set();
    for (const raw of Array.isArray(snapshot?.devices) ? snapshot.devices : []) {
      const device = normalizedDevice(raw);
      if (device && !seen.has(device.id)) { seen.add(device.id); devices.push(device); }
    }
    return { devices, retrievedAt: terminalText(snapshot?.retrievedAt) };
  }

  function normalizedRecord(record) {
    const target = normalizedDevice(record?.target || { id: terminalText(record?.targetId) }) || {
      id: 'unknown', hostname: 'Unknown target', platform: 'Unknown platform', transport: 'network diagnostic',
      managementIp: '', reachability: 'Reachability unverified', supportedCommands: []
    };
    const status = STATUSES.has(record?.status) ? record.status : 'UNKNOWN';
    const output = typeof record?.output === 'string' ? record.output : '';
    const value = {
      runId: terminalText(record?.runId || record?.requestId || 'unavailable'), requestId: terminalText(record?.requestId || record?.runId), target, command: terminalText(record?.command), status,
      source: terminalText(record?.source || 'network diagnostic'), startedAt: terminalText(record?.startedAt),
      completedAt: terminalText(record?.completedAt), elapsedMs: Number.isFinite(record?.elapsedMs) ? record.elapsedMs : null,
      output, outputTruncated: record?.outputTruncated === true, cancelled: record?.cancelled === true,
      createdAt: terminalText(record?.createdAt || new Date().toISOString())
    };
    Object.freeze(value.target);
    return Object.freeze(value);
  }

  function readEvidence(storage, key, scope) {
    if (!storage) return [];
    try {
      const saved = JSON.parse(storage.getItem(key) || '{}');
      const records = saved?.version === STORAGE_VERSION && saved.scopes && Array.isArray(saved.scopes[scope])
        ? saved.scopes[scope] : [];
      return records.map(normalizedRecord).slice(0, MAX_RECORDS);
    } catch { return []; }
  }

  function writeEvidence(storage, key, scope, records) {
    if (!storage) return false;
    try {
      const saved = JSON.parse(storage.getItem(key) || '{}');
      const scopes = saved?.version === STORAGE_VERSION && saved.scopes && typeof saved.scopes === 'object'
        ? saved.scopes : {};
      scopes[scope] = records.slice(0, MAX_RECORDS);
      storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, scopes }));
      return true;
    } catch { return false; }
  }

  function element(tag, className, label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  }

  function field(label, value, className) {
    const wrapper = element('div', className || 'terminal-field');
    wrapper.append(element('dt', '', label), element('dd', '', value || 'Unavailable'));
    return wrapper;
  }

  function displayTime(value) {
    if (!value) return 'Unavailable';
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
  }

  function statusSummary(record) {
    if (record.cancelled) return 'Run cancelled · outcome unknown';
    if (record.status === 'SUCCESS') return 'Command result captured · SUCCESS';
    if (record.status === 'FAILURE') return 'Command failed · FAILURE';
    if (record.status === 'NOT_EXECUTED') return 'Command was not executed';
    return 'Outcome unknown · remote completion unverified';
  }

  function mount(container, options = {}) {
    if (!container) throw new Error('A terminal container is required');
    const storage = options.storage === undefined ? global.localStorage : options.storage;
    const storageKey = terminalText(options.storageKey || DEFAULT_STORAGE_KEY);
    const scope = terminalText(options.scopeKey || 'workspace');
    const endpoint = terminalText(options.endpoint || 'http://127.0.0.1:8768/api/sandbox/command');
    const fetchImpl = options.fetchImpl || global.fetch?.bind(global);
    let inventory = normalizeInventory(options.inventory);
    let records = readEvidence(storage, storageKey, scope);
    let selectedTargetId = inventory.devices[0]?.id || '';
    let selectedCommand = inventory.devices[0]?.supportedCommands?.[0] || '';
    let running = false;
    let cancelRequested = false;
    let controller = null;
    let statusMessage = '';
    let storageWarning = false;

    function currentTarget() {
      return inventory.devices.find(device => device.id === selectedTargetId) || null;
    }

    function commit(record, notice) {
      const safe = normalizedRecord(record);
      records = [safe, ...records.filter(item => item.runId !== safe.runId || item.createdAt !== safe.createdAt)].slice(0, MAX_RECORDS);
      storageWarning = !writeEvidence(storage, storageKey, scope, records);
      statusMessage = notice || statusSummary(safe);
      options.onRecord?.(safe);
      render();
    }

    function renderEvidence(list) {
      list.replaceChildren();
      const heading = element('h3', 'terminal-evidence-title', 'Run evidence');
      list.append(heading);
      if (!records.length) {
        list.append(element('p', 'pane-note', 'No diagnostic runs captured in this conversation.'));
        return;
      }
      records.forEach(record => {
        const article = element('article', 'terminal-evidence');
        article.dataset.terminalRunId = record.runId;
        const top = element('div', 'terminal-evidence-top');
        top.append(element('strong', `terminal-status terminal-status-${record.status.toLowerCase()}`, statusSummary(record)));
        top.append(element('time', 'terminal-evidence-time', displayTime(record.completedAt || record.createdAt)));
        article.append(top);
        const metadata = element('dl', 'terminal-evidence-metadata');
        metadata.append(field('Target', `${record.target.hostname} · ${record.target.id}`));
        metadata.append(field('Run', record.runId));
        metadata.append(field('Command', record.command));
        metadata.append(field('Started', displayTime(record.startedAt)));
        metadata.append(field('Completed', displayTime(record.completedAt)));
        article.append(metadata);
        const details = element('details', 'terminal-raw-details');
        const summary = element('summary', '', record.output ? 'Show raw output' : 'Show raw output · empty');
        details.append(summary);
        const raw = element('pre', 'terminal-raw-output', record.output || 'No output was returned.');
        raw.tabIndex = 0;
        details.append(raw);
        if (record.outputTruncated) details.append(element('p', 'terminal-output-note', 'The local service capped this output; the retained text is unchanged.'));
        if (record.output) {
          const copy = element('button', 'button-secondary terminal-copy', 'Copy raw output');
          copy.type = 'button';
          copy.addEventListener('click', async () => {
            try { await global.navigator?.clipboard?.writeText(record.output); copy.textContent = 'Copied'; }
            catch { copy.textContent = 'Copy unavailable'; }
          });
          details.append(copy);
        }
        article.append(details);
        list.append(article);
      });
    }

    function render() {
      const current = currentTarget();
      if (!current) {
        selectedTargetId = inventory.devices[0]?.id || '';
        selectedCommand = inventory.devices[0]?.supportedCommands?.[0] || '';
      } else if (!current.supportedCommands.includes(selectedCommand)) {
        selectedCommand = current.supportedCommands[0] || '';
      }
      const target = currentTarget();
      container.replaceChildren();
      const section = element('section', 'terminal-surface');
      section.setAttribute('aria-labelledby', 'terminal-title');
      const heading = element('div', 'terminal-heading');
      const title = element('h2', '', 'Read-only diagnostic terminal');
      title.id = 'terminal-title';
      heading.append(title, element('p', 'terminal-subtitle', 'Network diagnostics only · allowlisted commands · no shell access'));
      section.append(heading);

      const capabilities = element('dl', 'terminal-capabilities');
      capabilities.append(field('Target', target ? `${target.hostname} · ${target.id}` : 'Choose an inventory target', 'terminal-capability'));
      capabilities.append(field('Session', target ? `${target.transport} · target selected` : 'Inventory required', 'terminal-capability'));
      capabilities.append(field('Permissions', 'Read-only · allowlisted commands', 'terminal-capability'));
      section.append(capabilities);

      const form = element('form', 'terminal-controls');
      form.noValidate = true;
      const targetLabel = element('label', 'terminal-control', 'Target');
      const targetSelect = element('select');
      targetSelect.id = 'terminal-target'; targetSelect.name = 'targetId'; targetSelect.setAttribute('aria-label', 'Diagnostic target');
      inventory.devices.forEach(device => {
        const option = element('option', '', `${device.hostname} · ${device.id}`);
        option.value = device.id; option.selected = device.id === selectedTargetId; targetSelect.append(option);
      });
      if (!inventory.devices.length) {
        const option = element('option', '', 'Load inventory to choose a target'); option.value = ''; targetSelect.append(option);
      }
      targetSelect.disabled = running || !inventory.devices.length;
      targetLabel.append(targetSelect);
      const commandLabel = element('label', 'terminal-control', 'Command');
      const commandSelect = element('select');
      commandSelect.id = 'terminal-command'; commandSelect.name = 'command'; commandSelect.setAttribute('aria-label', 'Supported diagnostic command');
      (target?.supportedCommands || []).forEach(command => {
        const option = element('option', '', command); option.value = command; option.selected = command === selectedCommand; commandSelect.append(option);
      });
      if (!target?.supportedCommands?.length) {
        const option = element('option', '', 'No allowlisted commands for this target'); option.value = ''; commandSelect.append(option);
      }
      commandSelect.disabled = running || !target?.supportedCommands?.length;
      commandLabel.append(commandSelect);
      form.append(targetLabel, commandLabel);
      const actions = element('div', 'terminal-actions');
      const run = element('button', 'button-primary', running ? 'Running…' : 'Run read-only command');
      run.type = 'submit'; run.disabled = running || !target || !selectedCommand;
      actions.append(run);
      if (running) {
        const cancel = element('button', 'button-secondary', 'Cancel run');
        cancel.type = 'button'; cancel.addEventListener('click', () => {
          cancelRequested = true; statusMessage = 'Cancelling run…'; controller?.abort(); render();
        });
        actions.append(cancel);
      }
      form.append(actions);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const chosenTarget = inventory.devices.find(device => device.id === targetSelect.value);
        const command = commandSelect.value;
        if (running || !chosenTarget || !chosenTarget.supportedCommands.includes(command)) {
          statusMessage = 'Choose an exact inventory target and allowlisted command.'; render(); return;
        }
        if (typeof fetchImpl !== 'function') { statusMessage = 'The local diagnostic service is unavailable.'; render(); return; }
        selectedTargetId = chosenTarget.id; selectedCommand = command; running = true; cancelRequested = false;
        controller = new AbortController();
        const requestId = requestIdentity();
        if (!requestId) { running = false; controller = null; statusMessage = 'The local service cannot create a run identity.'; render(); return; }
        const startedAt = new Date().toISOString();
        statusMessage = `Running ${command} on ${chosenTarget.hostname}…`; render();
        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'X-Aven-Sandbox': 'read-only', 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ targetId: chosenTarget.id, command, requestId }), signal: controller.signal
          });
          let payload = {};
          try { payload = await response.json(); } catch { payload = {}; }
          if (cancelRequested) {
            commit({ runId: requestId, requestId, target: chosenTarget, command, status: 'UNKNOWN', source: 'local diagnostic', output: '', startedAt, completedAt: new Date().toISOString(), cancelled: true }, 'Run cancelled; remote outcome is unknown. No retry was sent.');
          } else if (!response.ok) {
            throw new Error('The local diagnostic service rejected this run.');
          } else {
            commit({ ...payload, target: chosenTarget, command, startedAt: payload.startedAt || startedAt, completedAt: payload.completedAt || new Date().toISOString() });
          }
        } catch (error) {
          if (cancelRequested || error?.name === 'AbortError') {
            commit({ runId: requestId, requestId, target: chosenTarget, command, status: 'UNKNOWN', source: 'local diagnostic', output: '', startedAt, completedAt: new Date().toISOString(), cancelled: true }, 'Run cancelled; remote outcome is unknown. No retry was sent.');
          } else {
            commit({ runId: 'unavailable', target: chosenTarget, command, status: 'FAILURE', source: 'local diagnostic', output: '', startedAt, completedAt: new Date().toISOString() }, 'Diagnostic service failed; no retry was sent.');
          }
        } finally {
          running = false; controller = null; cancelRequested = false; render();
        }
      });
      targetSelect.addEventListener('change', () => { selectedTargetId = targetSelect.value; selectedCommand = inventory.devices.find(device => device.id === selectedTargetId)?.supportedCommands?.[0] || ''; render(); });
      commandSelect.addEventListener('change', () => { selectedCommand = commandSelect.value; });
      section.append(form);
      const status = element('p', 'terminal-status-message', statusMessage || (storageWarning ? 'Run evidence could not be saved locally; this page still retains it.' : 'Select a target and command to capture read-only evidence.'));
      status.id = 'terminal-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      section.append(status);
      const evidence = element('section', 'terminal-evidence-list'); evidence.setAttribute('aria-label', 'Diagnostic run evidence'); renderEvidence(evidence); section.append(evidence);
      container.append(section);
    }

    const controllerApi = {
      setInventory(snapshot) { inventory = normalizeInventory(snapshot); if (!inventory.devices.some(device => device.id === selectedTargetId)) selectedTargetId = inventory.devices[0]?.id || ''; selectedCommand = currentTarget()?.supportedCommands?.[0] || ''; render(); },
      destroy() { container.replaceChildren(); running = false; controller?.abort(); controller = null; },
      getRecords() { return records.slice(); }
    };
    render();
    return controllerApi;
  }

  global.AvenTerminal = Object.freeze({ mount, normalizeInventory, normalizeRecord: normalizedRecord });
})(window);
