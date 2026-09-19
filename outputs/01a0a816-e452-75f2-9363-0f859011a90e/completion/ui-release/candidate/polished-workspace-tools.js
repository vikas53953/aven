(() => {
  'use strict';

  const MAX_IDEA_RECORDS = 200;
  const MAX_GOAL_RECORDS = 100;
  const MAX_STEPS = 50;
  const MAX_TITLE = 160;
  const MAX_BODY = 8000;

  const clone = (value) => {
    if (value === undefined) return undefined;
    try {
      if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
    } catch (_) { /* Fall through to the JSON clone for plain workspace data. */ }
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };

  const stringValue = (value) => typeof value === 'string' ? value : value == null ? '' : String(value);
  const nonEmpty = (value) => stringValue(value).trim();
  const now = () => new Date().toISOString();
  const uid = () => globalThis.crypto?.randomUUID?.() || `aven-workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const create = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const button = (label, className, action) => {
    const node = create('button', className, label);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  };
  const labelFor = (label, control) => {
    const node = create('label', 'aven-workspace-label', label);
    node.htmlFor = control.id;
    return node;
  };
  const setValue = (node, value) => { node.value = stringValue(value); return node; };
  const timeValue = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const isoValue = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
  };
  const safeKey = (value) => stringValue(value).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'record';

  const readWorkspaceTools = (raw) => {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw) : {};
    const ideas = Array.isArray(source.ideas) ? source.ideas.map((item, index) => {
      const record = item && typeof item === 'object' && !Array.isArray(item) ? clone(item) : {};
      return {
        ...record,
        id: nonEmpty(record.id) || `legacy-idea-${index}`,
        title: stringValue(record.title),
        body: stringValue(record.body),
        archived: record.archived === true,
      };
    }) : [];
    const goals = Array.isArray(source.goals) ? source.goals.map((item, index) => {
      const record = item && typeof item === 'object' && !Array.isArray(item) ? clone(item) : {};
      const steps = Array.isArray(record.steps) ? record.steps.slice(0, MAX_STEPS).map((step, stepIndex) => {
        const value = step && typeof step === 'object' && !Array.isArray(step) ? clone(step) : { text: step };
        return {
          ...value,
          id: nonEmpty(value.id) || `legacy-goal-${index}-step-${stepIndex}`,
          text: stringValue(value.text),
          done: value.done === true,
        };
      }) : [];
      return {
        ...record,
        id: nonEmpty(record.id) || `legacy-goal-${index}`,
        title: stringValue(record.title),
        steps,
      };
    }) : [];
    return { ...source, ideas, goals };
  };

  const chatsOf = (data) => Array.isArray(data?.chats) ? data.chats.filter((chat) => chat && typeof chat === 'object') : [];
  const messagesOf = (chat) => Array.isArray(chat?.messages) ? chat.messages.filter((message) => message && typeof message === 'object') : [];
  const idEquals = (left, right) => nonEmpty(left) !== '' && nonEmpty(left) === nonEmpty(right);
  const resolveMessage = (data, chatId, messageId) => {
    const chat = chatsOf(data).find((item) => idEquals(item.id, chatId));
    if (!chat) return null;
    const message = messagesOf(chat).find((item) => idEquals(item.id, messageId));
    return message ? { chat, message } : null;
  };
  const chatTitle = (chat) => nonEmpty(chat?.title) || nonEmpty(chat?.name) || `Conversation ${stringValue(chat?.id) || 'unknown'}`;
  const messageText = (message) => nonEmpty(message?.text) || nonEmpty(message?.content) || 'Message has no text preview.';
  const snippet = (value, limit = 180) => {
    const text = stringValue(value).replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };

  const evidenceRef = (goal) => {
    const completion = goal?.completion && typeof goal.completion === 'object' ? goal.completion : null;
    const evidence = completion?.evidence || goal?.completionEvidence || goal?.evidenceRef;
    if (!evidence || typeof evidence !== 'object') return null;
    const chatId = nonEmpty(evidence.chatId);
    const messageId = nonEmpty(evidence.messageId);
    return chatId && messageId ? { chatId, messageId } : null;
  };
  const stepEvidenceRef = (step) => {
    const evidence = step?.evidence || step?.evidenceRef || step?.completionEvidence;
    if (!evidence || typeof evidence !== 'object') return null;
    const chatId = nonEmpty(evidence.chatId);
    const messageId = nonEmpty(evidence.messageId);
    return chatId && messageId ? { chatId, messageId } : null;
  };
  const isManualCompletion = (goal) => {
    const completion = goal?.completion && typeof goal.completion === 'object' ? goal.completion : null;
    if (completion) return !nonEmpty(completion.type) || completion.type === 'manual' || completion.label === 'Manually completed';
    return Boolean(goal?.completionEvidence || goal?.evidenceRef);
  };
  const hasRunEvidence = (message) => {
    const runId = nonEmpty(message?.runId);
    const events = Array.isArray(message?.events) && message.events.length > 0;
    const evidence = Array.isArray(message?.evidence) && message.evidence.length > 0;
    return Boolean(runId || events || evidence);
  };

  // A saved run keeps the same diagnostic result in two channels: the
  // tool-result event and the assistant message evidence. JSON persistence
  // gives those representations different object identities, so identity is
  // useful for cycle protection but cannot be the artifact identity.
  const ARTIFACT_ID_FIELDS = Object.freeze([
    'id', 'stableId', 'resultId', 'outputId', 'evidenceId', 'eventId',
    'invocationId', 'executionId', 'operationId', 'requestId', 'traceId',
    'attemptId', 'callId', 'toolCallId', 'runId', 'journalId',
  ]);
  const ARTIFACT_TIME_FIELDS = Object.freeze([
    'capturedAt', 'createdAt', 'updatedAt', 'timestamp', 'time', 'at',
    'retrievedAt', 'startedAt', 'completedAt', 'finishedAt', 'endedAt',
  ]);
  const ARTIFACT_PROVENANCE_FIELDS = Object.freeze({
    source: ['source', 'provenance', 'type'],
    command: ['command', 'operation'],
    target: ['target', 'hostname'],
    status: ['status'],
    filename: ['filename', 'name'],
  });
  // Carry run/provenance fields from an event wrapper to nested evidence.
  // Event-local ids such as toolId/eventId are intentionally excluded: they
  // identify the envelope, while the nested result is mirrored by evidence.
  // Envelope timestamps are also excluded because they describe the event,
  // not the captured output; result timestamps stay on the output item.
  const ARTIFACT_CONTEXT_FIELDS = Object.freeze([
    'runId', 'journalId', 'stableId', 'resultId', 'outputId', 'evidenceId',
    'invocationId', 'executionId', 'operationId', 'requestId', 'traceId',
    'attemptId', 'callId', 'source', 'provenance', 'command', 'operation',
    'target', 'hostname', 'status',
  ]);
  const artifactRaw = (value) => {
    const text = stringValue(value);
    return text.trim() ? text : '';
  };
  const artifactValues = (record, fields) => {
    const direct = [...new Set(fields.map((field) => artifactRaw(record?.item?.[field])).filter(Boolean))];
    return direct.length ? direct : [...new Set(fields.map((field) => artifactRaw(record?.context?.[field])).filter(Boolean))];
  };
  const artifactMap = (record, fields) => Object.fromEntries(fields.map((field) => [field, [...new Set([artifactRaw(record?.item?.[field]), artifactRaw(record?.context?.[field])].filter(Boolean))]]).filter(([, values]) => values.length));
  const artifactSetsEqual = (left, right) => left.length === right.length && left.every((value) => right.includes(value));
  const artifactMapsEqual = (left, right) => {
    const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => rightKeys.includes(key) && artifactSetsEqual(left[key], right[key]));
  };
  const artifactIdentity = (record) => {
    const ids = artifactMap(record, ARTIFACT_ID_FIELDS);
    const times = artifactMap(record, ARTIFACT_TIME_FIELDS);
    const provenance = Object.fromEntries(Object.entries(ARTIFACT_PROVENANCE_FIELDS).map(([name, fields]) => [name, artifactValues(record, fields)]));
    return { ids, times, provenance };
  };
  const artifactRecordsMatch = (left, right) => {
    if (!left || !right || left.value !== right.value) return false;
    const a = artifactIdentity(left), b = artifactIdentity(right);
    // A present identifier or timestamp must match exactly. Missing identity
    // stays unknown; it is never treated as a wildcard for a known value.
    if ((Object.keys(a.ids).length || Object.keys(b.ids).length) && !artifactMapsEqual(a.ids, b.ids)) return false;
    if ((Object.keys(a.times).length || Object.keys(b.times).length) && !artifactMapsEqual(a.times, b.times)) return false;
    let comparable = 0;
    for (const name of Object.keys(ARTIFACT_PROVENANCE_FIELDS)) {
      const leftValues = a.provenance[name], rightValues = b.provenance[name];
      if (!leftValues.length || !rightValues.length) continue;
      if (!artifactSetsEqual(leftValues, rightValues)) return false;
      comparable += 1;
    }
    // With no stable identity, at least two matching provenance dimensions
    // are required. This keeps an output-only pair from hiding two genuine
    // results whose provenance was not persisted.
    return comparable >= 2 || Boolean(Object.keys(a.ids).length || Object.keys(a.times).length) && comparable >= 1;
  };
  const mergeArtifactRecords = (primary, mirror) => {
    const item = { ...primary.item };
    const context = { ...(primary.context || {}) };
    Object.entries(mirror.item || {}).forEach(([key, value]) => {
      if (!artifactRaw(item[key]) && artifactRaw(value)) item[key] = value;
    });
    Object.entries(mirror.context || {}).forEach(([key, value]) => {
      if (!artifactRaw(context[key]) && artifactRaw(value)) context[key] = value;
    });
    return { ...primary, item, context };
  };
  const reconcileArtifactOutputs = (events, evidence) => {
    const mergedEvents = events.map((record) => ({ ...record }));
    const matchedEvents = new Set();
    const unmatchedEvidence = [];
    evidence.forEach((record) => {
      const candidates = [];
      events.forEach((event, index) => {
        if (!matchedEvents.has(index) && artifactRecordsMatch(event, record)) candidates.push(index);
      });
      // Matching is deliberately one-to-one. An ambiguous no-ID pair remains
      // visible so repeated identical invocations cannot be silently erased.
      if (candidates.length === 1) {
        const index = candidates[0];
        matchedEvents.add(index);
        mergedEvents[index] = mergeArtifactRecords(mergedEvents[index], record);
      } else unmatchedEvidence.push(record);
    });
    return mergedEvents.concat(unmatchedEvidence);
  };
  const collectOutputs = (value, output, seen, channel, context = {}) => {
    if (Array.isArray(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      value.forEach((item) => collectOutputs(item, output, seen, channel, context));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    const nextContext = { ...context };
    ARTIFACT_CONTEXT_FIELDS.forEach((field) => {
      if (artifactRaw(value[field])) nextContext[field] = value[field];
    });
    if (typeof value.output === 'string') output.push({ item: value, value: value.output, channel, context: nextContext });
    if (Array.isArray(value.evidence)) value.evidence.forEach((item) => collectOutputs(item, output, seen, channel, nextContext));
    else if (value.evidence && typeof value.evidence === 'object') collectOutputs(value.evidence, output, seen, channel, nextContext);
  };

  const feedEntries = (data) => {
    const entries = [];
    chatsOf(data).forEach((chat) => messagesOf(chat).forEach((message, index) => {
      if (!hasRunEvidence(message) || !nonEmpty(chat.id) || !nonEmpty(message.id)) return;
      entries.push({
        chatId: stringValue(chat.id),
        messageId: stringValue(message.id),
        chatTitle: chatTitle(chat),
        text: messageText(message),
        runId: nonEmpty(message.runId),
        eventCount: Array.isArray(message.events) ? message.events.length : 0,
        evidenceCount: Array.isArray(message.evidence) ? message.evidence.length : 0,
        at: message.createdAt || message.timestamp || message.updatedAt || chat.updatedAt || '',
        order: index,
      });
    }));
    return entries.sort((left, right) => {
      const a = isoValue(left.at), b = isoValue(right.at);
      if (a && b && a !== b) return b.localeCompare(a);
      if (a && !b) return -1;
      if (!a && b) return 1;
      return right.order - left.order;
    });
  };

  const artifactEntries = (data, selectedChatId) => {
    const chats = chatsOf(data).filter((chat) => !selectedChatId || idEquals(chat.id, selectedChatId));
    const entries = [];
    chats.forEach((chat) => messagesOf(chat).forEach((message) => {
      if (!nonEmpty(chat.id) || !nonEmpty(message.id)) return;
      const eventOutputs = [], evidenceOutputs = [], seen = new Set(), messageContext = { runId: nonEmpty(message.runId) };
      collectOutputs(message.events, eventOutputs, seen, 'events', messageContext);
      collectOutputs(message.evidence, evidenceOutputs, seen, 'evidence', messageContext);
      const outputs = reconcileArtifactOutputs(eventOutputs, evidenceOutputs);
      outputs.forEach(({ item, value }, index) => {
        const sourceName = nonEmpty(item.filename) || nonEmpty(item.name);
        const filename = sourceName ? sourceName.replace(/^.*[\\/]/, '') : `evidence-${safeKey(message.id)}-${index + 1}.txt`;
        entries.push({
          content: value,
          filename: filename || `evidence-${safeKey(message.id)}-${index + 1}.txt`,
          chatId: stringValue(chat.id),
          messageId: stringValue(message.id),
          chatTitle: chatTitle(chat),
          runId: nonEmpty(message.runId),
          source: nonEmpty(item.source) || nonEmpty(item.provenance) || nonEmpty(item.type),
          command: nonEmpty(item.command) || nonEmpty(item.operation),
          target: nonEmpty(item.target) || nonEmpty(item.hostname),
          status: nonEmpty(item.status),
          capturedAt: message.createdAt || message.timestamp || item.createdAt || item.timestamp || '',
        });
      });
    }));
    return entries;
  };

  function render(kind, container, options = {}) {
    const canonical = { ideas: 'Ideas', goals: 'Goals', feed: 'Feed', artifacts: 'Artifacts' }[stringValue(kind).toLowerCase()];
    if (!canonical) throw new TypeError(`Unsupported workspace tool: ${kind}`);
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('A DOM container is required.');

    const opts = options && typeof options === 'object' ? options : {};
    const data = opts.data && typeof opts.data === 'object' ? opts.data : {};
    let tools = readWorkspaceTools(data.workspaceTools);
    let formState = null;
    let evidenceState = null;
    let statusMessage = '';
    let pendingFocus = '';
    let destroyed = false;

    container.classList.add('aven-workspace-tools');
    container.dataset.workspaceTool = canonical.toLowerCase();

    const setStatus = (message) => { statusMessage = message; };
    const focusAfterRender = () => {
      if (!pendingFocus) return;
      const key = pendingFocus;
      pendingFocus = '';
      const target = [...container.querySelectorAll('[data-aven-focus-key]')].find((node) => node.dataset.avenFocusKey === key);
      target?.focus();
    };
    const resetTransient = () => { formState = null; evidenceState = null; };

    const commit = (next, successMessage, focusKey) => {
      let accepted = false;
      try {
        const payload = clone(next);
        accepted = typeof opts.onSave === 'function' && opts.onSave(clone(payload)) === true;
      } catch (error) {
        setStatus(`Could not save this change: ${error?.message || 'storage callback failed'}.`);
      }
      if (!accepted) {
        if (!statusMessage) setStatus('Could not save this change. The previous records are unchanged.');
        renderView();
        return false;
      }
      tools = clone(next);
      resetTransient();
      setStatus(successMessage);
      pendingFocus = focusKey || '';
      renderView();
      return true;
    };

    const makeHeader = (title, description, count) => {
      const header = create('header', 'aven-workspace-tools-header');
      const copy = create('div', 'aven-workspace-tools-heading');
      copy.append(create('p', 'aven-workspace-tools-eyebrow', 'LOCAL WORKSPACE'));
      copy.append(create('h2', '', title));
      copy.append(create('p', 'aven-workspace-tools-description', description));
      header.append(copy);
      if (count !== undefined) header.append(create('span', 'aven-workspace-tools-count', count));
      return header;
    };

    const makeStatus = () => {
      const status = create('p', 'aven-workspace-tools-status', statusMessage);
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      return status;
    };

    const makeActions = (saveLabel, onSaveForm, onCancel) => {
      const actions = create('div', 'aven-workspace-tools-form-actions');
      const cancel = button('Cancel', 'button-secondary', onCancel);
      const submit = button(saveLabel, 'button-primary');
      submit.type = 'submit';
      actions.append(cancel, submit);
      return actions;
    };

    const renderIdeaForm = () => {
      if (!formState || formState.type !== 'idea') return null;
      const form = create('form', 'aven-workspace-tools-form');
      form.noValidate = true;
      const title = setValue(create('input'), formState.title);
      title.id = 'aven-idea-title'; title.name = 'title'; title.maxLength = MAX_TITLE; title.required = true; title.autocomplete = 'off';
      const body = setValue(create('textarea'), formState.body);
      body.id = 'aven-idea-body'; body.name = 'body'; body.maxLength = MAX_BODY; body.rows = 7;
      const titleLabel = labelFor('Title', title), bodyLabel = labelFor('Notes', body);
      const help = create('p', 'aven-workspace-tools-help', `Title up to ${MAX_TITLE} characters. Notes up to ${MAX_BODY.toLocaleString()} characters.`);
      title.addEventListener('input', () => { formState.title = title.value; });
      body.addEventListener('input', () => { formState.body = body.value; });
      form.append(create('h3', '', formState.id ? 'Edit idea' : 'Add an idea'), titleLabel, title, bodyLabel, body, help);
      form.append(makeActions('Save idea', null, () => { resetTransient(); setStatus(''); renderView(); }));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const nextTitle = nonEmpty(formState.title), nextBody = stringValue(formState.body);
        if (!nextTitle) { setStatus('Add a title before saving the idea.'); renderView(); return; }
        if (nextTitle.length > MAX_TITLE) { setStatus(`Idea titles are limited to ${MAX_TITLE} characters.`); renderView(); return; }
        if (nextBody.length > MAX_BODY) { setStatus(`Idea notes are limited to ${MAX_BODY.toLocaleString()} characters.`); renderView(); return; }
        const next = clone(tools), timestamp = now();
        const record = formState.id ? next.ideas.find((item) => idEquals(item.id, formState.id)) : null;
        if (formState.id && !record) { setStatus('That idea no longer exists. Reload the workspace and try again.'); renderView(); return; }
        if (record) Object.assign(record, { title: nextTitle, body: nextBody, updatedAt: timestamp });
        else next.ideas.unshift({ id: uid(), title: nextTitle, body: nextBody, archived: false, createdAt: timestamp, updatedAt: timestamp });
        if (!record && next.ideas.length > MAX_IDEA_RECORDS) { setStatus(`You can keep up to ${MAX_IDEA_RECORDS} ideas.`); renderView(); return; }
        const savedId = record?.id || next.ideas[0].id;
        commit(next, 'Idea saved locally.', `idea-edit-${savedId}`);
      });
      return form;
    };

    const ideaCard = (idea) => {
      const card = create('article', 'aven-workspace-tools-card');
      card.dataset.recordId = stringValue(idea.id);
      const top = create('div', 'aven-workspace-tools-card-top');
      top.append(create('h3', '', idea.title || 'Untitled idea'));
      top.append(create('span', `aven-workspace-tools-badge${idea.archived ? ' is-muted' : ''}`, idea.archived ? 'Archived' : 'Open'));
      card.append(top);
      if (idea.body) card.append(create('p', 'aven-workspace-tools-body', idea.body));
      const meta = create('p', 'aven-workspace-tools-meta', idea.updatedAt || idea.createdAt ? `Updated ${timeValue(idea.updatedAt || idea.createdAt)}` : 'Saved locally');
      card.append(meta);
      const actions = create('div', 'aven-workspace-tools-card-actions');
      if (idea.archived) {
        const restore = button('Restore', 'button-secondary', () => {
          const next = clone(tools), record = next.ideas.find((item) => idEquals(item.id, idea.id));
          if (!record) { setStatus('That idea no longer exists.'); renderView(); return; }
          record.archived = false; record.updatedAt = now(); commit(next, 'Idea restored locally.', `idea-restore-${idea.id}`);
        });
        restore.dataset.avenFocusKey = `idea-restore-${idea.id}`; actions.append(restore);
      } else {
        const edit = button('Edit', 'button-secondary', () => { formState = { type: 'idea', id: idea.id, title: idea.title, body: idea.body }; setStatus(''); renderView(); });
        edit.dataset.avenFocusKey = `idea-edit-${idea.id}`;
        const archive = button('Archive', 'button-secondary', () => {
          const next = clone(tools), record = next.ideas.find((item) => idEquals(item.id, idea.id));
          if (!record) { setStatus('That idea no longer exists.'); renderView(); return; }
          record.archived = true; record.updatedAt = now(); commit(next, 'Idea archived locally.', `idea-restore-${idea.id}`);
        });
        actions.append(edit, archive);
      }
      card.append(actions);
      return card;
    };

    const renderIdeas = () => {
      const active = tools.ideas.filter((idea) => !idea.archived), archived = tools.ideas.filter((idea) => idea.archived);
      const section = create('section', 'aven-workspace-tools-view');
      section.append(makeHeader('Ideas', 'Capture local thoughts and return to them when the work is ready.', `${tools.ideas.length}/${MAX_IDEA_RECORDS}`));
      const add = button('Add idea', 'button-primary', () => { formState = { type: 'idea', id: '', title: '', body: '' }; setStatus(''); renderView(); });
      add.dataset.avenFocusKey = 'ideas-add';
      const toolbar = create('div', 'aven-workspace-tools-toolbar'); toolbar.append(add); section.append(toolbar);
      if (formState?.type === 'idea') section.append(renderIdeaForm());
      const activeSection = create('section', 'aven-workspace-tools-list'); activeSection.append(create('h3', 'aven-workspace-tools-section-title', `Open ideas · ${active.length}`));
      if (!active.length) activeSection.append(create('p', 'aven-workspace-tools-empty', 'No ideas yet. Add a local idea to start this list.'));
      else active.forEach((idea) => activeSection.append(ideaCard(idea)));
      section.append(activeSection);
      if (archived.length) {
        const archiveSection = create('section', 'aven-workspace-tools-list is-archived'); archiveSection.append(create('h3', 'aven-workspace-tools-section-title', `Archived ideas · ${archived.length}`));
        archived.forEach((idea) => archiveSection.append(ideaCard(idea))); section.append(archiveSection);
      }
      return section;
    };

    const goalFormState = (goal) => ({
      type: 'goal', id: goal?.id || '', title: goal?.title || '',
      steps: clone(Array.isArray(goal?.steps) ? goal.steps : []),
    });

    const renderGoalForm = () => {
      if (!formState || formState.type !== 'goal') return null;
      const form = create('form', 'aven-workspace-tools-form'); form.noValidate = true;
      const title = setValue(create('input'), formState.title); title.id = 'aven-goal-title'; title.maxLength = MAX_TITLE; title.required = true; title.autocomplete = 'off';
      title.addEventListener('input', () => { formState.title = title.value; });
      form.append(create('h3', '', formState.id ? 'Edit goal' : 'Add a goal'), labelFor('Title', title), title);
      const stepHead = create('div', 'aven-workspace-tools-subhead'); stepHead.append(create('h4', '', 'Checklist'));
      const addStep = button('Add step', 'button-secondary', () => {
        if (formState.steps.length >= MAX_STEPS) { setStatus(`Goals can have up to ${MAX_STEPS} steps.`); renderView(); return; }
        formState.steps.push({ id: uid(), text: '', done: false }); setStatus(''); renderView();
      });
      addStep.disabled = formState.steps.length >= MAX_STEPS; stepHead.append(addStep); form.append(stepHead);
      const steps = create('div', 'aven-workspace-tools-step-editor');
      if (!formState.steps.length) steps.append(create('p', 'aven-workspace-tools-help', 'Add checklist steps when the goal needs them.'));
      formState.steps.forEach((step, index) => {
        const row = create('div', 'aven-workspace-tools-step-row');
        const input = setValue(create('input'), step.text); input.type = 'text'; input.maxLength = MAX_BODY; input.id = `aven-goal-step-${index}`; input.required = true;
        input.addEventListener('input', () => { step.text = input.value; });
        const remove = button('Remove', 'button-quiet', () => { formState.steps.splice(index, 1); setStatus(''); renderView(); });
        row.append(labelFor(`Step ${index + 1}`, input), input, remove); steps.append(row);
      });
      form.append(steps, create('p', 'aven-workspace-tools-help', `Up to ${MAX_STEPS} steps. Completion still requires a real chat message as evidence.`));
      form.append(makeActions('Save goal', null, () => { resetTransient(); setStatus(''); renderView(); }));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const titleValue = nonEmpty(formState.title);
        if (!titleValue) { setStatus('Add a title before saving the goal.'); renderView(); return; }
        if (titleValue.length > MAX_TITLE) { setStatus(`Goal titles are limited to ${MAX_TITLE} characters.`); renderView(); return; }
        if (formState.steps.length > MAX_STEPS) { setStatus(`Goals can have up to ${MAX_STEPS} steps.`); renderView(); return; }
        const stepsValue = formState.steps.map((step) => ({ ...clone(step), text: nonEmpty(step.text) }));
        if (stepsValue.some((step) => !step.text)) { setStatus('Give every checklist step a label or remove the empty step.'); renderView(); return; }
        const invalidCheckedStep = stepsValue.find((step) => step.done && (!stepEvidenceRef(step) || !resolveMessage(data, stepEvidenceRef(step).chatId, stepEvidenceRef(step).messageId)));
        if (invalidCheckedStep) { setStatus('Every checked step must cite an existing chat message as evidence.'); renderView(); return; }
        const next = clone(tools), timestamp = now();
        const record = formState.id ? next.goals.find((item) => idEquals(item.id, formState.id)) : null;
        if (formState.id && !record) { setStatus('That goal no longer exists. Reload the workspace and try again.'); renderView(); return; }
        if (record) Object.assign(record, { title: titleValue, steps: stepsValue, updatedAt: timestamp });
        else next.goals.unshift({ id: uid(), title: titleValue, steps: stepsValue, createdAt: timestamp, updatedAt: timestamp, completion: null });
        if (!record && next.goals.length > MAX_GOAL_RECORDS) { setStatus(`You can keep up to ${MAX_GOAL_RECORDS} goals.`); renderView(); return; }
        const savedId = record?.id || next.goals[0].id;
        commit(next, 'Goal saved locally.', `goal-edit-${savedId}`);
      });
      return form;
    };

    const evidenceCandidates = () => {
      const candidates = [];
      chatsOf(data).forEach((chat) => messagesOf(chat).forEach((message) => {
        if (nonEmpty(chat.id) && nonEmpty(message.id)) candidates.push({ chat, message });
      }));
      return candidates;
    };

    const renderEvidenceChooser = () => {
      if (!evidenceState) return null;
      const panel = create('section', 'aven-workspace-tools-evidence-picker');
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Choose completion evidence');
      const isStep = Boolean(evidenceState.stepId);
      const head = create('div', 'aven-workspace-tools-card-top'); head.append(create('h3', '', isStep ? 'Choose step evidence' : 'Choose goal evidence')); head.append(button('Cancel', 'button-secondary', () => { evidenceState = null; setStatus(''); renderView(); })); panel.append(head);
      panel.append(create('p', 'aven-workspace-tools-help', isStep ? 'Choose an existing chat message for this checked step.' : 'Choose an existing chat message. This records a manual completion and does not execute an agent.'));
      const candidates = evidenceCandidates();
      if (!candidates.length) panel.append(create('p', 'aven-workspace-tools-empty', 'No real chat messages are available. This goal cannot be completed until a message exists.'));
      else {
        const list = create('div', 'aven-workspace-tools-evidence-list');
        candidates.forEach(({ chat, message }) => {
          const item = create('article', 'aven-workspace-tools-evidence-item');
          const copy = create('div', 'aven-workspace-tools-evidence-copy'); copy.append(create('strong', '', chatTitle(chat))); copy.append(create('span', '', snippet(messageText(message))));
          const choose = button('Use this evidence', 'button-secondary', () => chooseEvidence(evidenceState.goalId, evidenceState.stepId, chat.id, message.id));
          item.append(copy, choose); list.append(item);
        }); panel.append(list);
      }
      return panel;
    };

    const goalCard = (goal) => {
      const card = create('article', 'aven-workspace-tools-card'); card.dataset.recordId = stringValue(goal.id);
      const top = create('div', 'aven-workspace-tools-card-top'); top.append(create('h3', '', goal.title || 'Untitled goal'));
      const ref = evidenceRef(goal), manualCompletion = isManualCompletion(goal);
      const invalidCheckedSteps = goal.steps.filter((step) => step.done && (!stepEvidenceRef(step) || !resolveMessage(data, stepEvidenceRef(step).chatId, stepEvidenceRef(step).messageId)));
      const resolvedGoalEvidence = ref && manualCompletion ? resolveMessage(data, ref.chatId, ref.messageId) : null;
      const resolved = Boolean(resolvedGoalEvidence && invalidCheckedSteps.length === 0);
      if (resolved) top.append(create('span', 'aven-workspace-tools-badge is-success', 'Manually completed'));
      else if (ref || invalidCheckedSteps.length) top.append(create('span', 'aven-workspace-tools-badge is-danger', 'Completion blocked'));
      else top.append(create('span', 'aven-workspace-tools-badge is-muted', 'Open'));
      card.append(top);
      const steps = create('ul', 'aven-workspace-tools-checklist');
      if (!goal.steps.length) steps.append(create('li', 'aven-workspace-tools-empty', 'No checklist steps yet.'));
      goal.steps.forEach((step) => {
        const stepRef = stepEvidenceRef(step), stepResolved = stepRef ? resolveMessage(data, stepRef.chatId, stepRef.messageId) : null;
        const stepComplete = step.done === true && Boolean(stepResolved);
        const li = create('li', 'aven-workspace-tools-check-row');
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = stepComplete; input.id = `aven-goal-check-${safeKey(goal.id)}-${safeKey(step.id)}`; input.dataset.avenFocusKey = `goal-step-${goal.id}-${step.id}`; input.setAttribute('aria-label', `${stepComplete ? 'Uncheck' : 'Check'} ${step.text || 'step'} complete`);
        if (step.done && !stepComplete) input.setAttribute('aria-invalid', 'true');
        input.addEventListener('change', () => {
          if (input.checked && !stepResolved) { evidenceState = { goalId: goal.id, stepId: step.id }; setStatus('Choose a real message as evidence before this step can be marked complete.'); renderView(); return; }
          const next = clone(tools), record = next.goals.find((item) => idEquals(item.id, goal.id)), nextStep = record?.steps?.find((item) => idEquals(item.id, step.id));
          if (!record || !nextStep) { setStatus('That checklist step no longer exists.'); renderView(); return; }
          nextStep.done = input.checked; if (!input.checked) { nextStep.evidence = null; delete nextStep.evidenceRef; delete nextStep.completionEvidence; } nextStep.updatedAt = now(); record.updatedAt = now();
          commit(next, input.checked ? 'Step marked complete with message evidence.' : 'Checklist step reopened locally.', `goal-step-${goal.id}-${step.id}`);
        });
        const text = create('label', '', step.text || 'Untitled step'); text.htmlFor = input.id; li.append(input, text);
        if (step.done && !stepComplete) li.append(create('span', 'aven-workspace-tools-warning', 'Evidence needed'));
        if (stepResolved) { const evidence = button('Open evidence', 'button-quiet', () => openMessage(stepResolved.chat.id, stepResolved.message.id)); li.append(evidence); }
        steps.append(li);
      });
      card.append(steps);
      const progress = goal.steps.length ? `${goal.steps.filter((step) => step.done && stepEvidenceRef(step) && resolveMessage(data, stepEvidenceRef(step).chatId, stepEvidenceRef(step).messageId)).length}/${goal.steps.length} steps complete with evidence` : 'No steps';
      card.append(create('p', 'aven-workspace-tools-meta', progress));
      if (ref && !manualCompletion) {
        card.append(create('p', 'aven-workspace-tools-warning', 'Agent execution metadata is not a completion action here. Choose a real message to record Manually completed.'));
      } else if (ref && !resolvedGoalEvidence) {
        card.append(create('p', 'aven-workspace-tools-warning', `Dangling evidence reference · chat ${ref.chatId} · message ${ref.messageId}. Completion cannot be completed until you choose a current message.`));
      } else if (invalidCheckedSteps.length) {
        card.append(create('p', 'aven-workspace-tools-warning', 'Each checked step must link to a valid chat message before the goal can be completed.'));
      } else if (resolved) {
        const evidence = button('Open evidence message', 'button-quiet', () => openMessage(resolvedGoalEvidence.chat.id, resolvedGoalEvidence.message.id));
        card.append(evidence);
      }
      const actions = create('div', 'aven-workspace-tools-card-actions');
      const edit = button('Edit', 'button-secondary', () => { formState = goalFormState(goal); evidenceState = null; setStatus(''); renderView(); }); edit.dataset.avenFocusKey = `goal-edit-${goal.id}`; actions.append(edit);
      if (resolved) {
        const reopen = button('Reopen goal', 'button-secondary', () => {
          const next = clone(tools), record = next.goals.find((item) => idEquals(item.id, goal.id));
          if (!record) { setStatus('That goal no longer exists.'); renderView(); return; }
          record.completion = null; delete record.completionEvidence; delete record.evidenceRef; record.updatedAt = now(); commit(next, 'Goal reopened locally.', `goal-complete-${goal.id}`);
        }); reopen.dataset.avenFocusKey = `goal-reopen-${goal.id}`; actions.append(reopen);
      } else {
        const complete = button(ref ? 'Choose current evidence' : 'Complete with evidence', 'button-secondary', () => completeGoal(goal.id));
        complete.dataset.avenFocusKey = `goal-complete-${goal.id}`; complete.disabled = evidenceCandidates().length === 0; if (complete.disabled) complete.title = 'A real chat message is required before completion.'; actions.append(complete);
      }
      card.append(actions); return card;
    };

    function chooseEvidence(goalId, stepId, chatId, messageId) {
      const found = resolveMessage(data, chatId, messageId);
      if (!found) { setStatus('Evidence selection failed: that message no longer exists. Choose an existing message.'); renderView(); return; }
      const next = clone(tools), record = next.goals.find((item) => idEquals(item.id, goalId));
      if (!record) { setStatus('That goal no longer exists.'); renderView(); return; }
      if (stepId) {
        const step = record.steps.find((item) => idEquals(item.id, stepId));
        if (!step) { setStatus('That checklist step no longer exists.'); renderView(); return; }
        step.done = true; step.evidence = { chatId: stringValue(found.chat.id), messageId: stringValue(found.message.id) }; step.updatedAt = now(); record.updatedAt = now();
        commit(next, 'Step marked complete with message evidence.', `goal-step-${goalId}-${stepId}`);
        return;
      }
      completeGoal(goalId, found.chat.id, found.message.id);
    }

    function completeGoal(goalId, chatId, messageId) {
      const current = tools.goals.find((item) => idEquals(item.id, goalId));
      if (!current) { setStatus('That goal no longer exists.'); renderView(); return; }
      const invalidStep = current.steps.find((step) => step.done && (!stepEvidenceRef(step) || !resolveMessage(data, stepEvidenceRef(step).chatId, stepEvidenceRef(step).messageId)));
      if (invalidStep) {
        evidenceState = { goalId, stepId: invalidStep.id }; setStatus('Completion blocked: each checked step must cite an existing chat message first.'); renderView(); return;
      }
      const found = resolveMessage(data, chatId, messageId);
      if (!found) { evidenceState = { goalId }; setStatus('Completion blocked: that evidence reference is no longer valid. Choose an existing message.'); renderView(); return; }
      const next = clone(tools), record = next.goals.find((item) => idEquals(item.id, goalId));
      if (!record) { setStatus('That goal no longer exists.'); renderView(); return; }
      record.completion = { type: 'manual', label: 'Manually completed', evidence: { chatId: stringValue(found.chat.id), messageId: stringValue(found.message.id) }, completedAt: now() };
      record.updatedAt = now(); commit(next, 'Goal marked Manually completed with message evidence.', `goal-reopen-${goalId}`);
    }

    const renderGoals = () => {
      const section = create('section', 'aven-workspace-tools-view');
      section.append(makeHeader('Goals', 'Track local checklists. Completion always cites a real chat message.', `${tools.goals.length}/${MAX_GOAL_RECORDS}`));
      const add = button('Add goal', 'button-primary', () => { formState = goalFormState(null); setStatus(''); renderView(); }); add.dataset.avenFocusKey = 'goals-add';
      const toolbar = create('div', 'aven-workspace-tools-toolbar'); toolbar.append(add); section.append(toolbar);
      if (formState?.type === 'goal') section.append(renderGoalForm());
      if (evidenceState) section.append(renderEvidenceChooser());
      const list = create('section', 'aven-workspace-tools-list'); list.append(create('h3', 'aven-workspace-tools-section-title', `Goals · ${tools.goals.length}`));
      if (!tools.goals.length) list.append(create('p', 'aven-workspace-tools-empty', 'No goals yet. Add a local goal to define the next checkpoint.'));
      else tools.goals.forEach((goal) => list.append(goalCard(goal)));
      section.append(list); return section;
    };

    const openMessage = (chatId, messageId) => {
      if (typeof opts.onOpenMessage !== 'function') { setStatus('This message cannot be opened because no workspace opener is connected.'); renderView(); return; }
      try {
        if (opts.onOpenMessage(chatId, messageId) === false) throw new Error('workspace opener rejected the message');
        setStatus('Opened the source message.'); renderView();
      } catch (error) { setStatus(`Could not open the source message: ${error?.message || 'callback failed'}.`); renderView(); }
    };

    const renderFeed = () => {
      const entries = feedEntries(data), section = create('section', 'aven-workspace-tools-view');
      section.append(makeHeader('Feed', 'Run activity from saved chat messages. This view has no synthetic events.', `${entries.length} entries`));
      if (!entries.length) section.append(create('p', 'aven-workspace-tools-empty', 'No run activity is saved yet. Feed entries appear only when a real message has a runId, events, or evidence.'));
      else {
        const list = create('section', 'aven-workspace-tools-feed-list');
        entries.forEach((entry) => {
          const card = create('article', 'aven-workspace-tools-card aven-workspace-tools-feed-item');
          const top = create('div', 'aven-workspace-tools-card-top'); top.append(create('h3', '', entry.chatTitle)); top.append(create('time', 'aven-workspace-tools-meta', timeValue(entry.at))); card.append(top);
          card.append(create('p', 'aven-workspace-tools-body', snippet(entry.text, 320)));
          const parts = []; if (entry.runId) parts.push(`Run ${entry.runId}`); if (entry.eventCount) parts.push(`${entry.eventCount} event${entry.eventCount === 1 ? '' : 's'}`); if (entry.evidenceCount) parts.push(`${entry.evidenceCount} evidence item${entry.evidenceCount === 1 ? '' : 's'}`);
          card.append(create('p', 'aven-workspace-tools-meta', parts.join(' · ') || 'Saved run metadata'));
          const open = button('Open message', 'button-secondary', () => openMessage(entry.chatId, entry.messageId)); open.dataset.avenFocusKey = `feed-open-${entry.chatId}-${entry.messageId}`; card.append(open); list.append(card);
        }); section.append(list);
      }
      return section;
    };

    const provenance = (artifact) => ({ chatId: artifact.chatId, messageId: artifact.messageId, runId: artifact.runId, source: artifact.source, command: artifact.command, target: artifact.target, status: artifact.status, capturedAt: artifact.capturedAt });
    const renderArtifactCard = (artifact, index) => {
      const card = create('article', 'aven-workspace-tools-card aven-workspace-tools-artifact');
      const details = create('details', 'aven-workspace-tools-artifact-details');
      const summary = create('summary', 'aven-workspace-tools-artifact-summary');
      const summaryText = [artifact.command || 'Raw output', artifact.target, artifact.status && artifact.status !== 'SUCCESS' ? artifact.status : ''].filter(Boolean).join(' · ');
      summary.append(create('strong', '', summaryText));
      const filename = create('span', 'aven-workspace-tools-filename', artifact.filename); filename.title = artifact.filename; summary.append(filename);
      details.append(summary); card.append(details);
      const top = create('div', 'aven-workspace-tools-card-top'); top.append(create('h3', '', artifact.filename)); top.append(create('span', 'aven-workspace-tools-badge is-muted', 'Raw output')); details.append(top);
      const pre = create('pre', 'aven-workspace-tools-raw', artifact.content); pre.tabIndex = 0; details.append(pre);
      const dl = create('dl', 'aven-workspace-tools-provenance');
      [['Chat', artifact.chatTitle], ['Chat ID', artifact.chatId], ['Message ID', artifact.messageId], ['Run ID', artifact.runId], ['Source', artifact.source], ['Command', artifact.command], ['Target', artifact.target], ['Status', artifact.status], ['Captured', timeValue(artifact.capturedAt)]].forEach(([label, value]) => { if (nonEmpty(value)) { dl.append(create('dt', '', label), create('dd', '', value)); } }); details.append(dl);
      const actions = create('div', 'aven-workspace-tools-card-actions');
      const open = button('Open message', 'button-secondary', () => openMessage(artifact.chatId, artifact.messageId)); open.dataset.avenFocusKey = `artifact-open-${index}`;
      const download = button('Download', 'button-secondary', () => {
        if (typeof opts.onDownload !== 'function') { setStatus('Download is unavailable because no workspace download handler is connected.'); renderView(); return; }
        try {
          if (opts.onDownload(artifact.filename, artifact.content, provenance(artifact)) === false) throw new Error('download handler rejected the artifact');
          setStatus(`Download prepared: ${artifact.filename}`); renderView();
        } catch (error) { setStatus(`Could not prepare ${artifact.filename}: ${error?.message || 'callback failed'}.`); renderView(); }
      });
      download.dataset.avenFocusKey = `artifact-download-${index}`; actions.append(open, download); card.append(actions); return card;
    };

    const renderArtifacts = () => {
      const selectedChatId = nonEmpty(opts.selectedChatId), entries = artifactEntries(data, selectedChatId), section = create('section', 'aven-workspace-tools-view');
      section.append(makeHeader('Artifacts', selectedChatId ? 'Raw evidence outputs from the selected conversation.' : 'Raw evidence outputs saved on real chat messages.', `${entries.length} outputs`));
      section.append(create('p', 'aven-workspace-tools-scope', selectedChatId ? `Scope: selected conversation · ${selectedChatId}` : 'Scope: all conversations'));
      if (!entries.length) section.append(create('p', 'aven-workspace-tools-empty', 'No raw evidence outputs are saved yet. Artifacts never use sample content or external files.'));
      else {
        const list = create('section', 'aven-workspace-tools-artifact-list'); entries.forEach((artifact, index) => list.append(renderArtifactCard(artifact, index))); section.append(list);
      }
      return section;
    };

    function renderView() {
      if (destroyed) return;
      container.replaceChildren();
      const content = canonical === 'Ideas' ? renderIdeas() : canonical === 'Goals' ? renderGoals() : canonical === 'Feed' ? renderFeed() : renderArtifacts();
      container.append(makeStatus(), content);
      focusAfterRender();
    }

    const api = {
      refresh() { if (destroyed) return api; tools = readWorkspaceTools(data.workspaceTools); resetTransient(); setStatus(''); renderView(); return api; },
      getState() { return clone(tools); },
      getCounts() { return { ideas: tools.ideas.length, goals: tools.goals.length, feed: feedEntries(data).length, artifacts: artifactEntries(data, nonEmpty(opts.selectedChatId)).length }; },
      destroy() { destroyed = true; container.replaceChildren(); },
    };
    renderView();
    return api;
  }

  globalThis.AvenWorkspaceTools = Object.freeze({ render, MAX_IDEA_RECORDS, MAX_GOAL_RECORDS, MAX_STEPS, MAX_TITLE, MAX_BODY });
})();
