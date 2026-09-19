/* Evidence inspection tools. They render persisted raw evidence only. */
(() => {
  'use strict';

  const MAX_NOTE_LENGTH = 4000;
  const MAX_NOTES = 100;
  const KINDS = new Set(['annotate', 'compare']);

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function firstValue(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== '') return String(value);
    }
    return '';
  }

  function nullableValue(...values) {
    const value = firstValue(...values);
    return value || null;
  }

  function messageRunId(message) {
    return nullableValue(message?.runId);
  }

  function recordRunId(item, message) {
    return nullableValue(item?.runId, item?.run?.id, messageRunId(message));
  }

  function recordSourceId(item, path) {
    return firstValue(item?.id, item?.evidenceId, item?.sourceId, path);
  }

  function rawCommand(item) {
    return firstValue(item?.command, item?.operation, item?.name);
  }

  function rawTarget(item) {
    return firstValue(item?.target, item?.hostname);
  }

  function rawOutputKey(record) {
    // Missing output and a persisted empty string must remain different.
    return JSON.stringify([record.command, record.target, record.hasOutput, record.hasOutput ? record.output : null]);
  }

  function list(value) {
    return Array.isArray(value) ? value : isObject(value) ? [value] : [];
  }

  function collectEvidence(message) {
    const byKey = new Map();
    const visited = new WeakSet();

    function add(item, path, sourceKind) {
      if (!isObject(item) || visited.has(item)) return;
      visited.add(item);
      const hasOutput = typeof item.output === 'string';
      const nested = Array.isArray(item.evidence)
        ? item.evidence
        : isObject(item.evidence) ? [item.evidence] : [];

      // A top-level message.evidence entry is a record even when it is an
      // inventory observation without an output. Event wrappers are not.
      if (hasOutput || sourceKind === 'evidence') {
        const record = {
          sourceId: recordSourceId(item, path),
          command: rawCommand(item),
          target: rawTarget(item),
          source: firstValue(item.source, item.origin, item.transport, message?.source),
          time: firstValue(item.createdAt, item.timestamp, item.time, message?.createdAt),
          runId: recordRunId(item, message),
          status: firstValue(item.status),
          hasOutput,
          output: hasOutput ? item.output : null,
          original: item
        };
        const key = rawOutputKey(record);
        if (!byKey.has(key)) byKey.set(key, record);
      }

      nested.forEach((child, index) => add(child, `${path}.evidence[${index}]`, 'evidence'));
    }

    list(message?.evidence)
      .forEach((item, index) => add(item, `message.evidence[${index}]`, 'evidence'));
    list(message?.events)
      .forEach((item, index) => add(item, `message.events[${index}]`, 'event'));

    return [...byKey.values()].map((record, evidenceIndex) => ({ ...record, evidenceIndex }));
  }

  function getChats(options) {
    const value = options.getChats();
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.chats)) return value.chats;
    return [];
  }

  function snapshot(options) {
    const chats = getChats(options);
    const chat = chats.find(item => String(item?.id) === String(options.chatId));
    const message = chat && Array.isArray(chat.messages)
      ? chat.messages.find(item => String(item?.id) === String(options.messageId))
      : null;
    return { chats, chat, message, records: message ? collectEvidence(message) : [] };
  }

  function notesFor(message) {
    if (Array.isArray(message?.annotations)) return message.annotations;
    if (Array.isArray(message?.notes)) return message.notes;
    return [];
  }

  function currentRunId(record, message) {
    return record?.runId || messageRunId(message);
  }

  function sameRecord(expected, actual, expectedMessage, actualMessage) {
    if (!expected || !actual || !actualMessage) return false;
    return expected.sourceId === actual.sourceId
      && expected.command === actual.command
      && expected.target === actual.target
      && expected.source === actual.source
      && expected.hasOutput === actual.hasOutput
      && expected.output === actual.output
      && currentRunId(expected, expectedMessage) === currentRunId(actual, actualMessage)
      && messageRunId(expectedMessage) === messageRunId(actualMessage);
  }

  function browserCrypto() {
    const value = typeof globalThis === 'object' ? globalThis.crypto : null;
    if (!value?.subtle) throw new Error('SHA-256 is unavailable in this browser context.');
    return value;
  }

  async function hashOutput(output) {
    const digest = await browserCrypto().subtle.digest('SHA-256', new TextEncoder().encode(output));
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function uuid() {
    const crypto = browserCrypto();
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto.getRandomValues !== 'function') throw new Error('UUID generation is unavailable.');
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function element(doc, tag, className = '', text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(doc, className, label) {
    const node = element(doc, 'button', className, label);
    node.type = 'button';
    return node;
  }

  function recordLabel(record, index) {
    const command = record.command || 'Unnamed evidence';
    const target = record.target || 'No target';
    const state = !record.hasOutput ? 'missing output' : record.output === '' ? 'empty output' : 'raw output';
    return `${index + 1}. ${command} · ${target} · ${state}`;
  }

  function appendMetadata(doc, parent, record) {
    const list = element(doc, 'dl', 'aven-evidence-metadata');
    [
      ['Run', record.runId || 'Unavailable'],
      ['Target', record.target || 'Unavailable'],
      ['Command', record.command || 'Unavailable'],
      ['Source', record.source || 'Unavailable'],
      ['Time', record.time || 'Unavailable']
    ].forEach(([label, value]) => {
      list.append(element(doc, 'dt', '', label), element(doc, 'dd', '', value));
    });
    parent.append(list);
  }

  function appendRawOutput(doc, parent, record) {
    const state = !record.hasOutput ? 'Missing raw output' : record.output === '' ? 'Empty raw output' : 'Raw output';
    parent.append(element(doc, 'p', 'aven-evidence-output-state', state));
    const pre = element(doc, 'pre', 'aven-evidence-raw-output');
    // Empty output intentionally remains an empty <pre>; its state label above
    // distinguishes it from a record with no output field.
    if (record.hasOutput) pre.textContent = record.output;
    parent.append(pre);
  }

  async function noteMatches(note, record, message) {
    if (!record || !record.hasOutput || typeof note?.outputHash !== 'string') return false;
    if (note.sourceId && note.sourceId !== record.sourceId) return false;
    if (String(note.evidenceIndex) !== String(record.evidenceIndex)) return false;
    if (String(note.command || '') !== record.command || String(note.target || '') !== record.target) return false;
    if ((note.runId || null) !== (currentRunId(record, message) || null)) return false;
    return note.outputHash === await hashOutput(record.output);
  }

  async function renderNotes(doc, parent, message, records) {
    parent.replaceChildren();
    const notes = notesFor(message).slice(0, MAX_NOTES);
    if (!notes.length) {
      parent.append(element(doc, 'p', 'aven-evidence-notes-empty', 'No annotations saved for this message.'));
      return;
    }

    const list = element(doc, 'ul', 'aven-evidence-notes-list');
    const pending = notes.map(async note => {
      const item = element(doc, 'li', 'aven-evidence-annotation');
      const label = element(doc, 'strong', '', 'Checking annotation…');
      const body = element(doc, 'p', '', typeof note.text === 'string' ? note.text : '');
      const hash = typeof note.outputHash === 'string' ? note.outputHash : 'Unavailable';
      const detail = element(doc, 'small', '', `Hash ${hash}`);
      item.append(label, body, detail);
      list.append(item);
      let current = null;
      try {
        const index = Number(note.evidenceIndex);
        current = Number.isInteger(index) ? records[index] : null;
        const valid = await noteMatches(note, current, message);
        label.textContent = valid
          ? `Annotation · ${current.command || 'Unnamed evidence'} · ${current.target || 'No target'}`
          : `Stale annotation · ${String(note.command || 'Unnamed evidence')} · ${String(note.target || 'No target')}`;
      } catch {
        label.textContent = `Stale annotation · ${String(note.command || 'Unnamed evidence')} · ${String(note.target || 'No target')}`;
      }
    });
    parent.append(list);
    await Promise.all(pending);
  }

  function renderAnnotate(doc, root, options, controller, state) {
    const panel = element(doc, 'section', 'aven-evidence-tool aven-evidence-annotate');
    panel.append(element(doc, 'h2', '', 'Annotate persisted evidence'));
    panel.append(element(doc, 'p', 'aven-evidence-help', 'Select a saved raw evidence record. Empty output is valid; records without an output cannot be annotated.'));

    if (!state.message) {
      panel.append(element(doc, 'p', 'aven-evidence-status', 'Message was not found in the saved conversation.'));
      root.append(panel);
      return Promise.resolve();
    }
    if (!state.records.length) {
      panel.append(element(doc, 'p', 'aven-evidence-status', 'This message has no persisted evidence records.'));
      root.append(panel);
      return Promise.resolve();
    }

    const selectLabel = element(doc, 'label', 'aven-evidence-select-label', 'Evidence record');
    const select = element(doc, 'select', 'aven-evidence-record-select');
    state.records.forEach((record, index) => {
      const option = element(doc, 'option', '', recordLabel(record, index));
      option.value = String(index);
      select.append(option);
    });
    selectLabel.append(select);
    panel.append(selectLabel);

    const output = element(doc, 'section', 'aven-evidence-selected');
    const metadata = element(doc, 'div', 'aven-evidence-selected-metadata');
    const raw = element(doc, 'div', 'aven-evidence-selected-raw');
    output.append(metadata, raw);
    panel.append(output);

    const noteLabel = element(doc, 'label', 'aven-evidence-note-label', 'Annotation');
    const textarea = element(doc, 'textarea', 'aven-evidence-note');
    textarea.maxLength = MAX_NOTE_LENGTH;
    textarea.required = true;
    textarea.rows = 5;
    textarea.placeholder = 'Add a short note about this evidence…';
    noteLabel.append(textarea);
    const actions = element(doc, 'div', 'aven-evidence-actions');
    const save = button(doc, 'aven-evidence-save', 'Save annotation');
    const status = element(doc, 'p', 'aven-evidence-status');
    status.setAttribute('role', 'status');
    actions.append(save, status);
    panel.append(noteLabel, actions);

    const notesPanel = element(doc, 'section', 'aven-evidence-notes');
    notesPanel.append(element(doc, 'h3', '', 'Saved annotations'));
    const notesBody = element(doc, 'div', 'aven-evidence-notes-body');
    notesPanel.append(notesBody);
    panel.append(notesPanel);
    root.append(panel);

    let selectedIndex = 0;
    const selectedRecord = () => state.records[selectedIndex] || null;
    const updateSelection = () => {
      selectedIndex = Number(select.value);
      const record = selectedRecord();
      metadata.replaceChildren();
      raw.replaceChildren();
      if (!record) {
        status.textContent = 'Evidence record is unavailable.';
        save.disabled = true;
        return;
      }
      appendMetadata(doc, metadata, record);
      appendRawOutput(doc, raw, record);
      save.disabled = !record.hasOutput || textarea.value.length > MAX_NOTE_LENGTH;
      status.textContent = record.hasOutput ? '' : 'This record has no raw output and cannot be annotated.';
    };
    select.addEventListener('change', updateSelection);
    textarea.addEventListener('input', () => {
      const record = selectedRecord();
      save.disabled = !record?.hasOutput || textarea.value.length > MAX_NOTE_LENGTH;
      if (textarea.value.length > MAX_NOTE_LENGTH) status.textContent = `Annotation must be ${MAX_NOTE_LENGTH} characters or fewer.`;
      else if (record?.hasOutput) status.textContent = '';
    });
    save.addEventListener('click', async () => {
      const expected = selectedRecord();
      const expectedMessage = state.message;
      const noteText = textarea.value;
      if (!expected?.hasOutput) {
        status.textContent = 'This record has no raw output and cannot be annotated.';
        return;
      }
      if (!noteText.trim()) { status.textContent = 'Enter an annotation before saving.'; textarea.focus(); return; }
      if (noteText.length > MAX_NOTE_LENGTH) {
        status.textContent = `Annotation must be ${MAX_NOTE_LENGTH} characters or fewer.`;
        return;
      }
      let before;
      try {
        before = snapshot(options);
      } catch {
        status.textContent = 'Could not revalidate the saved message.';
        return;
      }
      if (!before.message || !sameRecord(expected, before.records[selectedIndex], expectedMessage, before.message)) {
        status.textContent = 'Evidence changed; reload the tool before annotating.';
        return;
      }

      let outputHash;
      try {
        outputHash = await hashOutput(expected.output);
      } catch (error) {
        status.textContent = error.message || 'Could not hash this evidence.';
        return;
      }

      let after;
      try {
        after = snapshot(options);
      } catch {
        status.textContent = 'Could not revalidate the saved message after hashing.';
        return;
      }
      if (!after.message || !sameRecord(expected, after.records[selectedIndex], expectedMessage, after.message)) {
        status.textContent = 'Evidence changed while it was being hashed; nothing was saved.';
        return;
      }
      if (notesFor(after.message).length >= MAX_NOTES) {
        status.textContent = `A message can have at most ${MAX_NOTES} annotations.`;
        return;
      }

      const note = {
        id: uuid(),
        messageId: String(options.messageId),
        runId: currentRunId(expected, expectedMessage) || null,
        command: expected.command,
        target: expected.target,
        evidenceIndex: selectedIndex,
        outputHash,
        text: noteText,
        createdAt: new Date().toISOString(),
        sourceId: expected.sourceId
      };
      let saved = false;
      try {
        saved = options.onAppendAnnotation(options.chatId, options.messageId, note) === true;
      } catch {
        saved = false;
      }
      if (!saved) {
        status.textContent = 'Could not save the annotation. Your note is still here.';
        return;
      }
      textarea.value = '';
      status.textContent = 'Annotation saved.';
      try {
        const latest = snapshot(options);
        void renderNotes(doc, notesBody, latest.message, latest.records);
      } catch {
        // The persistence callback already succeeded; leave the success state
        // visible until the owning pane asks the controller to refresh.
      }
    });

    updateSelection();
    return renderNotes(doc, notesBody, state.message, state.records);
  }

  function renderCompare(doc, root, state) {
    const panel = element(doc, 'section', 'aven-evidence-tool aven-evidence-compare');
    panel.append(element(doc, 'h2', '', 'Compare persisted evidence'));
    panel.append(element(doc, 'p', 'aven-evidence-help', 'Choose two saved evidence records to inspect their full raw outputs side by side. This view does not infer device health.'));
    if (!state.message || !state.records.length) {
      panel.append(element(doc, 'p', 'aven-evidence-status', state.message ? 'This message has no persisted evidence records.' : 'Message was not found in the saved conversation.'));
      root.append(panel);
      return Promise.resolve();
    }

    const controls = element(doc, 'div', 'aven-evidence-compare-controls');
    const leftLabel = element(doc, 'label', '', 'Evidence A');
    const rightLabel = element(doc, 'label', '', 'Evidence B');
    const left = element(doc, 'select', 'aven-evidence-compare-select');
    const right = element(doc, 'select', 'aven-evidence-compare-select');
    const addOptions = select => {
      state.records.forEach((record, index) => {
        const option = element(doc, 'option', '', recordLabel(record, index));
        option.value = String(index);
        select.append(option);
      });
      if (state.records.length < 2) {
        const option = element(doc, 'option', '', 'No second evidence record');
        option.value = 'none';
        option.selected = true;
        select.append(option);
      }
    };
    addOptions(left);
    addOptions(right);
    right.value = state.records.length > 1 ? '1' : 'none';
    leftLabel.append(left);
    rightLabel.append(right);
    controls.append(leftLabel, rightLabel);
    panel.append(controls);

    const grid = element(doc, 'div', 'aven-evidence-compare-grid');
    const leftPanel = element(doc, 'article', 'aven-evidence-compare-side');
    const rightPanel = element(doc, 'article', 'aven-evidence-compare-side');
    grid.append(leftPanel, rightPanel);
    panel.append(grid);
    root.append(panel);

    const renderSide = (target, value, heading) => {
      target.replaceChildren(element(doc, 'h3', '', heading));
      const index = Number(value);
      const record = Number.isInteger(index) ? state.records[index] : null;
      if (!record) {
        target.append(element(doc, 'p', 'aven-evidence-status', 'No evidence selected.'));
        return;
      }
      appendMetadata(doc, target, record);
      appendRawOutput(doc, target, record);
    };
    const update = () => {
      renderSide(leftPanel, left.value, 'Evidence A');
      renderSide(rightPanel, right.value, 'Evidence B');
    };
    left.addEventListener('change', update);
    right.addEventListener('change', update);
    update();
    return Promise.resolve();
  }

  function render(kind, container, options = {}) {
    if (!KINDS.has(kind)) throw new Error(`Unknown evidence tool: ${kind}.`);
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('A render container is required.');
    if (typeof options.getChats !== 'function') throw new TypeError('getChats must be a function.');
    const doc = container.ownerDocument || globalThis.document;
    if (!doc?.createElement) throw new TypeError('A DOM render container is required.');
    const normalized = {
      ...options,
      onAppendAnnotation: typeof options.onAppendAnnotation === 'function' ? options.onAppendAnnotation : () => false
    };
    const root = container;
    const controller = { ready: Promise.resolve(), refresh: () => {}, destroy: () => {} };
    let destroyed = false;

    const draw = () => {
      if (destroyed) return Promise.resolve();
      root.replaceChildren();
      let state;
      try {
        state = snapshot(normalized);
      } catch {
        root.append(element(doc, 'p', 'aven-evidence-status', 'Could not read the saved conversation.'));
        return Promise.resolve();
      }
      const frame = element(doc, 'div', 'aven-evidence-tools-frame');
      root.append(frame);
      return kind === 'annotate'
        ? renderAnnotate(doc, frame, normalized, controller, state)
        : renderCompare(doc, frame, state);
    };
    controller.refresh = () => {
      controller.ready = draw();
      return controller.ready;
    };
    controller.destroy = () => {
      destroyed = true;
      root.replaceChildren();
    };
    controller.ready = draw();
    return controller;
  }

  const api = Object.freeze({ render, getEvidenceRecords: collectEvidence, MAX_NOTE_LENGTH, MAX_NOTES });
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  const browserGlobal = typeof window === 'object' && window ? window : globalThis;
  if (browserGlobal) browserGlobal.AvenEvidenceTools = api;
  if (typeof globalThis === 'object' && globalThis && globalThis !== browserGlobal) globalThis.AvenEvidenceTools = api;
})();
