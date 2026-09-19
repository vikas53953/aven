(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const now = () => new Date().toISOString();
  const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `aven-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const paths = {
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    avatar: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    chat: '<path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 3v-4a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3Z"/>',
    channels: '<path d="M9 3 7 21M17 3l-2 18M3 9h18M2 15h18"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    feed: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    ideas: '<path d="M8 15a7 7 0 1 1 8 0l-1 3H9l-1-3ZM9 21h6M10 11l2 3 2-3"/>',
    goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    library: '<path d="M4 4v16M9 4v16M14 4v16m4-15 3 14"/>',
    settings: '<path d="M9.5 3h5l.7 2.6 2.3 1.3 2.6-.7 2.5 4.3-1.9 1.9v2.6l1.9 1.9-2.5 4.3-2.6-.7-2.3 1.3-.7 2.6h-5l-.7-2.6-2.3-1.3-2.6.7L1.4 17l1.9-1.9v-2.6l-1.9-1.9 2.5-4.3 2.6.7 2.3-1.3Z" transform="translate(1.4 -1) scale(.88)"/><circle cx="12" cy="11.4" r="3.2"/>',
    browser: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    plug: '<path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4"/>',
    computer: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    document: '<path d="M14 2H5v20h14V7l-5-5Z M14 2v6h5M8 12h8M8 16h6"/>',
    file: '<path d="M14 2H5v20h14V7l-5-5Z M14 2v6h5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.3"/><path d="m4 17 5-5 3 3 2-2 6 5"/>',
    newchat: '<path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 3v-4a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3Z"/><path d="M12 8v6M9 11h6"/>',
    send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    retry: '<path d="M20 11a8 8 0 1 0 1 4M20 4v7h-7"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    refresh: '<path d="M4 12a8 8 0 0 1 13.6-5.7L20 9M20 5v4h-4M20 12a8 8 0 0 1-13.6 5.7L4 15m0 4v-4h4"/>'
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.document}</svg>`;
  const setIcons = (root = document) => {
    all('[data-icon]', root).forEach((node) => {
      if (node.querySelector('.icon')) return;
      const svg = document.createRange().createContextualFragment(icon(node.dataset.icon));
      if (node.children.length || node.textContent.trim()) node.prepend(svg);
      else node.append(svg);
    });
  };

  const PREF_KEY = 'aven-polished-preferences-v1';
  const CHAT_KEY = 'aven-polished-chats-v1';
  const DOC_KEY = 'aven-polished-docs-v1';
  const defaultPrefs = {
    theme: 'dark', density: 'comfortable', displayName: '', activeAgent: 'companion',
    provider: 'Not connected', model: '', browser: true, computer: false,
    agents: [
      { id: 'companion', name: 'Network companion', role: 'Investigate branch networks and explain findings.' },
      { id: 'topology', name: 'Topology analyst', role: 'Map dependencies and surface the next useful signal.' }
    ]
  };
  const defaultData = {
    activeChat: 'sample-network',
    chats: [{ id: 'sample-network', title: 'Branch network review', sample: true, channelId: null, projectId: null, recipients: ['companion'], draft: '', pendingAttachmentNames: [], messages: [] }],
    channels: [], projects: []
  };
  let prefs = load(PREF_KEY, defaultPrefs);
  let data = load(CHAT_KEY, defaultData);
  let docs = load(DOC_KEY, {});
  let currentView = 'Chat';
  let directoryContext = null;
  let paneView = 'agent';
  let settingsDraft = null;
  let settingsPage = 'general';
  let settingsOpener = null;
  let searchOpener = null;
  let activeDoc = null;
  let paneOpener = null;
  let toolTimers = {};
  const toolStates = { browser: { status: 'idle', attempt: 0 }, plugins: { status: 'idle', attempt: 0 }, computer: { status: 'idle', attempt: 0 } };
  const sessionAttachments = new Map();
  let toastTimer;
  let toolContext = 0;
  let toolChatId = null;

  function load(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      if (parsed && typeof parsed === 'object') return mergeDefaults(fallback, parsed);
    } catch (_) { /* local storage is optional */ }
    return structuredClone(fallback);
  }
  function mergeDefaults(base, value) {
    if (Array.isArray(base)) return Array.isArray(value) ? value : structuredClone(base);
    const out = { ...structuredClone(base), ...value };
    if (base.agents && (!Array.isArray(out.agents) || !out.agents.length)) out.agents = structuredClone(base.agents);
    if (base.chats && (!Array.isArray(out.chats) || !out.chats.length)) out.chats = structuredClone(base.chats);
    if (base.channels && !Array.isArray(out.channels)) out.channels = [];
    if (base.projects && !Array.isArray(out.projects)) out.projects = [];
    return out;
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }
  function currentChat() { return data.chats.find((chat) => chat.id === data.activeChat) || data.chats[0]; }
  function agentById(id) { return prefs.agents.find((agent) => agent.id === id) || prefs.agents[0]; }
  function selectedAgents(chat = currentChat()) { return (chat?.recipients || [prefs.activeAgent]).map(agentById).filter(Boolean); }
  function saveData() { return save(CHAT_KEY, data); }
  function savePrefs() { return save(PREF_KEY, prefs); }
  function saveDocs() { return save(DOC_KEY, docs); }
  function notify(message) { const toast = byId('toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600); }

  function createAvatar(size = 'small') {
    const node = document.createElement('span');
    node.className = `avatar-art avatar-${size}`;
    node.setAttribute('aria-hidden', 'true');
    const left = document.createElement('i'); left.className = 'avatar-eye left';
    const right = document.createElement('i'); right.className = 'avatar-eye right';
    const smile = document.createElement('i'); smile.className = 'avatar-smile';
    node.append(left, right, smile);
    return node;
  }
  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.density = prefs.density || 'comfortable';
    const agent = agentById(prefs.activeAgent);
    const railAvatar = one('#avatar .agent-avatar');
    if (railAvatar) {
      const avatar = createAvatar('small');
      railAvatar.className = 'agent-avatar avatar-art avatar-small';
      railAvatar.replaceChildren(...avatar.childNodes);
    }
    if (byId('rail-agent-name')) byId('rail-agent-name').textContent = agent.name;
    byId('draft').placeholder = `Ask ${agent.name} about your network…`;
  }
  function retainDraft() {
    const chat = currentChat(); if (!chat || !byId('draft')) return;
    chat.draft = byId('draft').value;
    const attachments = sessionAttachments.get(chat.id) || [];
    chat.pendingAttachmentNames = attachments.map((item) => item.name);
    saveData();
  }
  function setSurface(title, location = '') {
    byId('surface').textContent = title;
    byId('chat-location').textContent = location;
  }
  function setActiveNav(destination) {
    all('[data-destination]').forEach((button) => {
      const active = button.dataset.destination === destination;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
  }
  function clearCenterSections() {
    byId('conversation').hidden = true;
    byId('chat-directory').hidden = true;
    byId('empty-view').hidden = true;
    byId('create-view').hidden = true;
  }
  function showChat(id = data.activeChat) {
    if (data.activeChat && data.activeChat !== id) retainDraft();
    const chat = data.chats.find((item) => item.id === id) || data.chats[0];
    if (!chat) return;
    if (toolChatId !== chat.id) { toolChatId = chat.id; resetToolContext(); }
    data.activeChat = chat.id; currentView = 'Chat'; directoryContext = null; saveData();
    clearCenterSections(); byId('conversation').hidden = false; byId('composer-wrap').hidden = false;
    setActiveNav('Chat');
    const channel = data.channels.find((item) => item.id === chat.channelId);
    const project = data.projects.find((item) => item.id === chat.projectId);
    setSurface(chat.title, [chat.sample ? 'Sample conversation' : project?.name, channel ? `# ${channel.name}` : (!project && !chat.sample ? 'Direct chat' : '')].filter(Boolean).join(' · ') || 'Local workspace');
    renderConversation(); renderComposer();
    if (window.innerWidth <= 760) closePane(true);
  }

  function appendTextMessage(message) {
    const row = document.createElement('article');
    row.className = `message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
    const label = document.createElement('span'); label.className = 'message-label'; label.textContent = message.role === 'assistant' ? agentById(message.agentId || 'companion').name : (message.recipientNames?.length ? `To ${message.recipientNames.join(', ')}` : 'You'); row.append(label);
    const body = document.createElement('span'); body.textContent = message.text || (message.attachments?.length ? 'Attachment' : ''); row.append(body);
    if (message.attachments?.length) message.attachments.forEach((name) => { const attachment = document.createElement('span'); attachment.className = 'attachment-in-message'; attachment.innerHTML = `${icon('file')}<span>${esc(name)}</span>`; row.append(attachment); });
    byId('conversation').append(row);
  }
  function renderSampleConversation() {
    const marker = document.createElement('div'); marker.className = 'sample-label'; marker.textContent = 'Sample conversation'; byId('conversation').append(marker);
    appendTextMessage({ role: 'user', text: 'We have intermittent packet loss at the branch network. Help me investigate the likely path.' });
    appendTextMessage({ role: 'assistant', agentId: 'companion', text: 'Let’s keep this investigation scoped. Start with the branch edge, then compare the uplink and the first shared hop. I can show the proposed checks here before anything could run.' });
    const card = document.createElement('section'); card.className = 'tool-card';
    const header = document.createElement('div'); header.className = 'tool-card-header'; header.innerHTML = '<span>Sample tool requests</span><span>Preview only</span>'; card.append(header);
    [['browser', 'Inspect a browser result', 'Review vendor documentation in the right workspace', 'browser'], ['plugins', 'Review plugin access', 'See requested network permissions before connecting', 'plug'], ['computer', 'Open computer preview', 'Inspect an illustrative desktop session', 'computer']].forEach(([view, title, detail, glyph]) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-request'; button.dataset.toolRequest = view; button.innerHTML = `${icon(glyph)}<span><strong>${title}</strong><small>${detail}</small></span>${icon('chevron')}`; card.append(button);
    });
    byId('conversation').append(card);
  }
  function renderConversation() {
    const chat = currentChat(); const container = byId('conversation'); container.replaceChildren();
    if (chat.sample) renderSampleConversation();
    chat.messages.forEach(appendTextMessage);
    if (!chat.sample && !chat.messages.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.innerHTML = `<div class="empty-icon">${icon('chat')}</div><h2>Start this conversation</h2><p>Choose one or more agents below, then write the first local message. Nothing will be sent to a model.</p>`; container.append(empty);
    }
    all('[data-tool-request]', container).forEach((button) => button.addEventListener('click', () => openPane(button.dataset.toolRequest)));
  }
  function renderAttachments() {
    const chat = currentChat(); if (!chat) return;
    const row = byId('attachments'); row.replaceChildren();
    const attached = sessionAttachments.get(chat.id) || [];
    attached.forEach((item) => {
      const chip = document.createElement('span'); chip.className = 'attachment-chip';
      if (item.url) { const img = document.createElement('img'); img.src = item.url; img.alt = `Preview of ${item.name}`; chip.append(img); }
      const name = document.createElement('span'); name.textContent = item.name; const remove = document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove attachment ${item.name}`); remove.textContent = '×'; remove.addEventListener('click', () => { if (item.url) URL.revokeObjectURL(item.url); const next = attached.filter((value) => value.id !== item.id); sessionAttachments.set(chat.id, next); chat.pendingAttachmentNames = next.map((value) => value.name); saveData(); renderAttachments(); updateSend(); }); chip.append(name, remove); row.append(chip);
    });
    if (!attached.length && chat.pendingAttachmentNames?.length) {
      chat.pendingAttachmentNames.forEach((name) => { const chip = document.createElement('span'); chip.className = 'attachment-chip pending'; chip.innerHTML = `${icon('file')}<span>${esc(name)}</span>`; row.append(chip); });
      const notice = document.createElement('span'); notice.className = 'attachment-notice'; notice.textContent = 'These filenames are from an earlier session. Reattach the files to send; file contents were not saved.'; row.append(notice);
    }
  }
  function renderComposer() {
    const chat = currentChat(); if (!chat) return;
    byId('draft').value = chat.draft || '';
    const chosen = selectedAgents(chat); byId('recipient-summary').textContent = `To: ${chosen.map((agent) => agent.name).join(', ')}`;
    const options = byId('recipient-options'); options.replaceChildren();
    prefs.agents.forEach((agent) => { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = chat.recipients.includes(agent.id); input.addEventListener('change', () => { if (input.checked) chat.recipients = [...new Set([...chat.recipients, agent.id])]; else if (chat.recipients.length > 1) chat.recipients = chat.recipients.filter((id) => id !== agent.id); else input.checked = true; saveData(); renderComposer(); }); label.append(input, document.createTextNode(agent.name)); options.append(label); });
    renderAttachments(); updateSend(); setIcons(byId('recipient-picker'));
  }
  function updateSend() { const chat = currentChat(); const attached = chat && (sessionAttachments.get(chat.id) || []).length; byId('send').disabled = !(byId('draft').value.trim() || attached); }

  function showDirectory(kind, entityId = null) {
    directoryContext = { kind, entityId };
    retainDraft(); resetToolContext(); currentView = kind; clearCenterSections(); byId('chat-directory').hidden = false; byId('composer-wrap').hidden = true;
    setActiveNav(kind === 'Channels' ? 'Channels' : kind === 'Projects' ? 'Projects' : 'Chat');
    const directory = byId('chat-directory'); directory.replaceChildren();
    let title = kind; let subtitle = 'Saved locally in this browser.';
    const entity = kind === 'Channel' ? data.channels.find((item) => item.id === entityId) : kind === 'Project' ? data.projects.find((item) => item.id === entityId) : null;
    if (entity) { title = kind === 'Channel' ? `# ${entity.name}` : entity.name; subtitle = kind === 'Channel' ? 'Threads in this channel.' : 'Chats and channels in this project.'; }
    setSurface(title, subtitle);
    const header = document.createElement('div'); header.className = 'directory-header'; header.innerHTML = `<div><h2>${esc(title)}</h2><p class="directory-subtitle">${esc(subtitle)}</p></div>`; const actions = document.createElement('div'); actions.className = 'directory-actions'; header.append(actions); directory.append(header);
    const action = (label, callback) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', callback); actions.append(button); };
    if (kind === 'Chat' || kind === 'Chats') action('+ Start a chat', () => createWorkspace('chat'));
    if (kind === 'Channels') action('+ New channel', () => createWorkspace('channel'));
    if (kind === 'Projects') action('+ New project', () => createWorkspace('project'));
    if (kind === 'Channel') action('+ New thread', () => createWorkspace('chat', { channelId: entityId }));
    if (kind === 'Project') { action('+ New chat', () => createWorkspace('chat', { projectId: entityId })); action('+ New channel', () => createWorkspace('channel', { projectId: entityId })); }
    const list = document.createElement('div'); list.className = 'directory-list';
    const addRow = (name, detail, callback) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'directory-item'; button.innerHTML = `<span><strong>${esc(name)}</strong><small>${esc(detail)}</small></span>${icon('chevron')}`; button.addEventListener('click', callback); list.append(button); };
    if (kind === 'Chat' || kind === 'Chats') data.chats.forEach((chat) => addRow(chat.title, `${chat.messages.length} local message${chat.messages.length === 1 ? '' : 's'}`, () => showChat(chat.id)));
    if (kind === 'Channels' || kind === 'Project') data.channels.filter((channel) => kind !== 'Project' || channel.projectId === entityId).forEach((channel) => addRow(`# ${channel.name}`, `${data.chats.filter((chat) => chat.channelId === channel.id).length} thread${data.chats.filter((chat) => chat.channelId === channel.id).length === 1 ? '' : 's'}`, () => showDirectory('Channel', channel.id)));
    if (kind === 'Projects') data.projects.forEach((project) => addRow(project.name, `${data.channels.filter((channel) => channel.projectId === project.id).length} channels · ${data.chats.filter((chat) => chat.projectId === project.id).length} chats`, () => showDirectory('Project', project.id)));
    if (kind === 'Channel') data.chats.filter((chat) => chat.channelId === entityId).forEach((chat) => addRow(chat.title, `${chat.messages.length} local message${chat.messages.length === 1 ? '' : 's'}`, () => showChat(chat.id)));
    if (kind === 'Project') data.chats.filter((chat) => chat.projectId === entityId && !chat.channelId).forEach((chat) => addRow(chat.title, 'Direct chat in this project', () => showChat(chat.id)));
    if (!list.children.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.innerHTML = `<div class="empty-icon">${icon(kind === 'Projects' ? 'folder' : kind === 'Channels' || kind === 'Channel' ? 'channels' : 'chat')}</div><h2>Nothing here yet</h2><p>Use the action above to create a local ${kind === 'Projects' ? 'project' : kind === 'Channels' || kind === 'Channel' ? 'channel' : 'chat'}.</p>`; list.append(empty); }
    directory.append(list);
  }
  function showEmpty(destination) {
    directoryContext = null;
    retainDraft(); resetToolContext(); currentView = destination; clearCenterSections(); byId('empty-view').hidden = false; byId('composer-wrap').hidden = true; setActiveNav(destination);
    const copy = { Feed: ['Feed', 'A quiet local record will appear here once this prototype has something to show.', 'feed'], Ideas: ['Ideas', 'Keep possible directions here when there is a question worth returning to.', 'ideas'], Goals: ['Goals', 'A focused place for goals is intentionally scoped for a later pass.', 'goals'] }[destination];
    setSurface(copy[0], 'Scope-limited empty state'); byId('empty-view').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon(copy[2])}</div><h2>${esc(copy[0])} is quiet</h2><p>${esc(copy[1])}</p></div>`;
  }

  function createWorkspace(type, context = {}) {
    const returnDirectory = directoryContext && { ...directoryContext };
    const returnView = currentView;
    const returnChat = data.activeChat;
    closePopovers(); retainDraft(); resetToolContext(); currentView = 'Create'; clearCenterSections(); byId('create-view').hidden = false; byId('composer-wrap').hidden = true; setActiveNav('Chat');
    const title = { chat: 'Start a new chat', agent: 'Create a local agent', channel: 'Create a channel', project: 'Create a project' }[type];
    const description = { chat: 'Give this conversation a name, then choose who it addresses.', agent: 'A profile for organizing future work. Creating it starts no live agent.', channel: 'Keep related threads together. Channels are local containers.', project: 'Group chats and channels under one local project.' }[type];
    const form = byId('create-view'); form.innerHTML = `<div class="create-view-header"><span class="eyebrow">CREATE</span><h2>${title}</h2><p>${description}</p></div><form class="workspace-form" id="workspace-create-form"><label for="workspace-create-name">Name</label><input id="workspace-create-name" maxlength="80" required placeholder="${type === 'agent' ? 'For example: Firewall specialist' : type === 'channel' ? 'For example: branch-rollout' : type === 'project' ? 'For example: Q4 network refresh' : 'For example: Branch packet loss'}"><p class="form-help">Saved to this browser only.</p>${type === 'agent' ? '<label for="workspace-create-role">What should this agent help with?</label><textarea id="workspace-create-role" maxlength="500" required placeholder="Describe its local role in your own words."></textarea>' : ''}${type === 'channel' ? `<label for="workspace-create-project">Project (optional)</label><select id="workspace-create-project"><option value="">No project</option>${data.projects.map((project) => `<option value="${esc(project.id)}">${esc(project.name)}</option>`).join('')}</select>` : ''}${type === 'chat' ? `<fieldset class="recipient-fieldset"><legend>Recipients</legend><div id="workspace-create-recipients" class="recipient-options"></div></fieldset>` : ''}<p id="workspace-create-status" class="form-status" role="status"></p><div class="form-actions"><button class="button-secondary" id="cancel-workspace-create" type="button">Cancel</button><button class="button-primary" id="finish-workspace-create" type="submit">Create ${type}</button></div></form>`;
    if (type === 'channel' && context.projectId) byId('workspace-create-project').value = context.projectId;
    if (type === 'chat') { const options = byId('workspace-create-recipients'); prefs.agents.forEach((agent) => { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = agent.id; input.checked = (context.recipients || [prefs.activeAgent]).includes(agent.id); label.append(input, document.createTextNode(agent.name)); options.append(label); }); }
    byId('cancel-workspace-create').addEventListener('click', () => {
      if (returnDirectory) showDirectory(returnDirectory.kind, returnDirectory.entityId);
      else if (['Feed', 'Ideas', 'Goals'].includes(returnView)) showEmpty(returnView);
      else showChat(returnChat);
    });
    byId('workspace-create-form').addEventListener('submit', (event) => { event.preventDefault(); finishWorkspaceCreate(type, context); });
    byId('workspace-create-name').focus();
  }
  function startNewChat(context = {}) {
    retainDraft();
    if (!context.channelId && !context.projectId && directoryContext) {
      if (directoryContext.kind === 'Channel') context = { ...context, channelId: directoryContext.entityId };
      else if (directoryContext.kind === 'Project') context = { ...context, projectId: directoryContext.entityId };
    }
    if (context.channelId) context = { ...context, projectId: data.channels.find(channel => channel.id === context.channelId)?.projectId || null };
    const chat = { id: uid(), title: 'New chat', sample: false, channelId: context.channelId || null, projectId: context.projectId || null, recipients: context.recipients || [prefs.activeAgent], draft: '', pendingAttachmentNames: [], messages: [] };
    data.chats.unshift(chat); data.activeChat = chat.id; saveData(); showChat(chat.id); byId('draft').focus();
  }
  function finishWorkspaceCreate(type, context) {
    if (context.channelId) context = { ...context, projectId: data.channels.find(channel => channel.id === context.channelId)?.projectId || null };
    const name = byId('workspace-create-name').value.trim(); const status = byId('workspace-create-status'); if (!name) return;
    if (type === 'agent') {
      const role = byId('workspace-create-role').value.trim(); if (!role) return;
      if (prefs.agents.some((agent) => agent.name.toLowerCase() === name.toLowerCase())) { status.textContent = 'Choose a different agent name.'; return; }
      const agent = { id: uid(), name, role }; prefs.agents.push(agent); prefs.activeAgent = agent.id; if (!docs[agent.id]) docs[agent.id] = { 'SOUL.md': `# ${name}\n\nDescribe this agent's tone and boundaries.`, 'MEMORY.md': 'Keep durable local notes here.' }; savePrefs(); saveDocs(); applyPrefs();
      const chat = { id: uid(), title: `Chat with ${name}`, sample: false, channelId: null, projectId: null, recipients: [agent.id], draft: '', pendingAttachmentNames: [], messages: [] }; data.chats.unshift(chat); data.activeChat = chat.id; saveData(); showChat(chat.id); openPane('agent'); notify('Agent profile created locally. No live agent started.'); return;
    }
    const list = type === 'channel' ? data.channels : type === 'project' ? data.projects : data.chats;
    if (list.some((item) => item.name?.toLowerCase() === name.toLowerCase() || item.title?.toLowerCase() === name.toLowerCase())) { status.textContent = 'Choose a different name.'; return; }
    if (type === 'chat') {
      const recipients = all('#workspace-create-recipients input:checked').map((input) => input.value); const chat = { id: uid(), title: name, sample: false, channelId: context.channelId || null, projectId: context.projectId || null, recipients: recipients.length ? recipients : [prefs.activeAgent], draft: '', pendingAttachmentNames: [], messages: [] }; data.chats.unshift(chat); data.activeChat = chat.id; saveData(); showChat(chat.id); return;
    }
    if (type === 'channel') { const projectId = byId('workspace-create-project').value || null; const channel = { id: uid(), name, projectId }; data.channels.push(channel); saveData(); showDirectory('Channel', channel.id); return; }
    const project = { id: uid(), name }; data.projects.push(project); saveData(); showDirectory('Project', project.id);
  }

  function resetToolContext() {
    toolContext += 1;
    Object.entries(toolStates).forEach(([view, state]) => { clearTimeout(toolTimers[view]); state.status = 'idle'; state.attempt = 0; });
  }

  function syncPaneModal() {
    const open = !byId('right-pane').hidden; const narrow = window.innerWidth <= 760;
    byId('right-pane').setAttribute('aria-modal', String(open && narrow));
    byId('center-column').inert = open && narrow;
    byId('rail').inert = open && narrow;
    one('.app-header').inert = open && narrow;
    if (open && narrow) { byId('right-pane').setAttribute('role', 'dialog'); if (!byId('right-pane').contains(document.activeElement)) byId('close-pane').focus(); }
  }

  function openPane(view = 'agent') {
    if (activeDoc && !confirmDiscardDoc()) return;
    if (paneView !== view) resetToolContext();
    if (byId('right-pane').hidden) paneOpener = document.activeElement;
    paneView = view; byId('right-pane').hidden = false; syncPaneModal();
    if (window.innerWidth <= 760) setTimeout(() => byId('close-pane').focus(), 0);
    const title = { agent: 'Agent', browser: 'Browser', plugins: 'Plugins', computer: 'Computer', artifacts: 'Artifacts' }[view] || 'Workspace'; byId('pane-title').textContent = title;
    all('[data-pane]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.pane === view)));
    if (view === 'agent') renderAgentPane(); else if (view === 'artifacts') renderArtifactsPane(); else renderToolPane(view);
  }
  function closePane(force = false) {
    if (!force && activeDoc && !confirmDiscardDoc()) return false;
    resetToolContext();
    activeDoc = null; byId('right-pane').hidden = true; syncPaneModal();
    const opener = paneOpener; paneOpener = null; if (opener?.isConnected && !opener.closest('#right-pane')) opener.focus(); else byId('avatar').focus(); return true;
  }
  function getDoc(agentId, name) {
    if (!docs[agentId]) docs[agentId] = {};
    if (typeof docs[agentId][name] !== 'string') docs[agentId][name] = name === 'SOUL.md' ? `# ${agentById(agentId).name}\n\nDescribe this agent's tone and boundaries.` : 'Keep durable local notes here.';
    return docs[agentId][name];
  }
  function renderAgentPane() {
    activeDoc = null; const agent = agentById(prefs.activeAgent); const pane = byId('pane-content'); pane.replaceChildren();
    const card = document.createElement('div'); card.className = 'avatar-card'; card.append(createAvatar('large')); const strong = document.createElement('strong'); strong.textContent = agent.name; const role = document.createElement('p'); role.className = 'muted-line'; role.textContent = agent.role; const tags = document.createElement('div'); tags.className = 'agent-meta'; tags.innerHTML = '<span class="status-tag sample-tag">local profile</span><span class="status-tag">no agent running</span>'; card.append(strong, role, tags); pane.append(card);
    const selectLabel = document.createElement('label'); selectLabel.className = 'field-label'; selectLabel.textContent = 'Active profile'; selectLabel.htmlFor = 'active-agent'; pane.append(selectLabel);
    const select = document.createElement('select'); select.id = 'active-agent'; select.setAttribute('aria-label', 'Active agent profile'); prefs.agents.forEach((item) => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = item.id === prefs.activeAgent; select.append(option); }); pane.append(select);
    const heading = document.createElement('h3'); heading.textContent = 'Agent documents'; pane.append(heading); const list = document.createElement('div'); list.className = 'pane-list'; [['SOUL.md', 'Tone, boundaries and purpose'], ['MEMORY.md', 'Durable local notes']].forEach(([name, detail]) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.doc = name; button.innerHTML = `${icon('document')}<span>${name}<small>${detail}</small></span>`; button.addEventListener('click', () => openDocument(name)); list.append(button); }); pane.append(list);
    const note = document.createElement('div'); note.className = 'pane-note'; note.textContent = 'Documents belong to the selected local profile. Save writes only to this browser.'; pane.append(note);
    select.addEventListener('change', () => { if (activeDoc && !confirmDiscardDoc()) { select.value = prefs.activeAgent; return; } prefs.activeAgent = select.value; savePrefs(); applyPrefs(); renderAgentPane(); });
  }
  function confirmDiscardDoc() { if (!activeDoc) return true; if (!activeDoc.dirty) { activeDoc = null; return true; } const leave = confirm('This document has unsaved changes. Discard them?'); if (leave) { activeDoc = null; return true; } return false; }
  function openDocument(name) {
    if (activeDoc && !confirmDiscardDoc()) return;
    const agentId = prefs.activeAgent; const original = getDoc(agentId, name); activeDoc = { agentId, name, original, dirty: false }; const pane = byId('pane-content'); pane.replaceChildren(); const wrap = document.createElement('div'); wrap.className = 'doc-editor'; wrap.innerHTML = `<label for="doc-textarea">${esc(name)} · ${esc(agentById(agentId).name)}</label><textarea id="doc-textarea" spellcheck="false"></textarea><div class="doc-actions"><button class="button-secondary" id="cancel-doc" type="button">Cancel</button><button class="button-primary" id="save-doc" type="button">Save</button></div><span class="doc-status" id="doc-status" role="status"></span><button class="button-secondary" id="back-doc" type="button" style="margin-top:12px">Back to agent</button>`; pane.append(wrap); byId('doc-textarea').value = original;
    byId('doc-textarea').addEventListener('input', () => { activeDoc.dirty = byId('doc-textarea').value !== activeDoc.original; });
    byId('save-doc').addEventListener('click', () => { docs[agentId][name] = byId('doc-textarea').value; activeDoc.original = docs[agentId][name]; activeDoc.dirty = false; saveDocs(); byId('doc-status').textContent = 'Saved locally to this agent profile.'; });
    byId('cancel-doc').addEventListener('click', () => { activeDoc = null; openPane('agent'); });
    byId('back-doc').addEventListener('click', () => { if (confirmDiscardDoc()) openPane('agent'); });
    byId('doc-textarea').focus();
  }
  function renderArtifactsPane() {
    activeDoc = null; const pane = byId('pane-content'); pane.replaceChildren(); const chat = currentChat();
    if (!chat?.sample) { pane.innerHTML = '<p class="pane-note">Artifacts in this prototype are scoped to the sample conversation. No output belongs to this chat yet.</p>'; return; }
    const intro = document.createElement('p'); intro.textContent = 'Sample outputs from this conversation.'; pane.append(intro); const list = document.createElement('div'); list.className = 'pane-list artifact-list'; [['Investigation.md', 'document'], ['Network report', 'browser']].forEach(([name, glyph]) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.previewArtifact = name; button.innerHTML = `${icon(glyph)}<span>${name}<small>Sample output</small></span>`; button.addEventListener('click', () => renderArtifact(name)); list.append(button); }); pane.append(list); const note = document.createElement('div'); note.className = 'pane-note'; note.textContent = 'These artifacts are illustrative and are not generated by a live agent.'; pane.append(note);
  }
  function renderArtifact(name) {
    const pane = byId('pane-content'); pane.replaceChildren(); const card = document.createElement('div'); card.className = 'artifact-preview'; card.innerHTML = `<h3>${esc(name)}</h3><p>Sample artifact preview</p><hr>${name === 'Network report' ? '<div class="viewport-bars"><i></i><i></i><i></i></div><p>Branch latency · illustrative result</p>' : '<p>1. Scope and symptoms</p><p>2. Evidence collected</p><p>3. Proposed next steps</p>'}`; pane.append(card); const back = document.createElement('button'); back.type = 'button'; back.className = 'button-secondary'; back.textContent = 'Back to artifacts'; back.style.marginTop = '13px'; back.addEventListener('click', renderArtifactsPane); pane.append(back);
  }
  function renderToolPane(view) {
    activeDoc = null; const state = toolStates[view]; const pane = byId('pane-content'); pane.replaceChildren(); const card = document.createElement('div'); card.className = 'preview-card'; card.dataset.toolView = view; card.innerHTML = `<div class="preview-url">${view === 'browser' ? 'Browser page · preview only' : view === 'plugins' ? 'Plugin access · preview only' : 'Computer session · preview only'}</div><h3>${view === 'browser' ? 'Inspect vendor documentation' : view === 'plugins' ? 'Review network plugin access' : 'Inspect a sample desktop'}</h3><p>${view === 'browser' ? 'A browser result would appear here while the request stays visible in chat.' : view === 'plugins' ? 'Review requested permissions before a future connection. No provider is connected.' : 'A selected desktop and proposed action would appear here. No screen access is active.'}</p>`;
    if (view === 'browser') { const vp = document.createElement('div'); vp.className = 'preview-viewport'; vp.innerHTML = '<div class="viewport-toolbar"><i></i><i></i><i></i></div><div class="viewport-body"><div class="viewport-heading"></div><div class="viewport-copy"></div><div class="viewport-bars"><i></i><i></i><i></i></div></div>'; card.append(vp); }
    if (view === 'computer') { const vp = document.createElement('div'); vp.className = 'desktop-viewport'; vp.innerHTML = '<div class="desktop-window"><div class="window-bar"><i></i><i></i><i></i></div><div class="desktop-lines"></div></div>'; card.append(vp); }
    if (view === 'plugins') { const permissions = document.createElement('div'); permissions.className = 'pane-note'; permissions.textContent = 'Requested access: read inventory and device status. Connection state is simulated only.'; card.append(permissions); }
    const stateRow = document.createElement('div'); stateRow.id = 'tool-state'; stateRow.className = `preview-state state-${state.status}`; stateRow.innerHTML = `<span><i class="state-dot"></i> <strong>${state.status === 'idle' ? 'Idle preview' : state.status === 'loading' ? 'Loading sample state' : state.status === 'success' ? 'Sample result ready' : 'Sample error'}</strong></span><span>${state.status === 'error' ? 'Try again' : 'No external request'}</span>`; card.append(stateRow);
    if (state.status === 'error') { const error = document.createElement('p'); error.className = 'tool-error'; error.textContent = 'The illustrative preview stopped safely. No browser, plugin or computer action occurred.'; card.append(error); }
    const actions = document.createElement('div'); actions.className = 'preview-actions'; const run = document.createElement('button'); run.type = 'button'; run.id = state.status === 'error' ? 'retry-tool' : 'run-tool'; run.className = 'run-tool'; run.dataset.toolAction = state.status === 'error' ? 'retry' : 'run'; run.innerHTML = `${icon(state.status === 'error' ? 'retry' : 'check')}<span>${state.status === 'error' ? 'Retry sample' : state.status === 'loading' ? 'Running…' : 'Run sample'}</span>`; run.disabled = state.status === 'loading'; actions.append(run); const cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'cancel-tool'; cancel.dataset.toolAction = 'cancel'; cancel.textContent = 'Cancel'; cancel.disabled = state.status !== 'loading'; actions.append(cancel); const reset = document.createElement('button'); reset.type = 'button'; reset.id = 'reset-tool'; reset.dataset.toolAction = 'reset'; reset.textContent = 'Reset'; actions.append(reset); card.append(actions); pane.append(card); all('[data-tool-action]', card).forEach((button) => button.addEventListener('click', () => toolAction(view, button.dataset.toolAction)));
  }
  function toolAction(view, action) {
    const state = toolStates[view]; if (action === 'run' || action === 'retry') { clearTimeout(toolTimers[view]); state.status = 'loading'; state.attempt += 1; renderToolPane(view); const token = state.attempt; const context = toolContext; toolTimers[view] = setTimeout(() => { if (paneView !== view || token !== state.attempt || context !== toolContext || byId('right-pane').hidden) return; state.status = state.attempt % 2 === 0 ? 'error' : 'success'; renderToolPane(view); }, 650); } else if (action === 'cancel') { clearTimeout(toolTimers[view]); state.attempt = 0; state.status = 'idle'; renderToolPane(view); } else if (action === 'reset') { clearTimeout(toolTimers[view]); state.attempt = 0; state.status = 'idle'; renderToolPane(view); }
  }

  function openSearch() {
    retainDraft(); searchOpener = document.activeElement; const dialog = byId('search-dialog'); const categories = ['All', 'Messages', 'Chats', 'Agents', 'Channels', 'Projects', 'Files', 'Links']; byId('search-filters').replaceChildren(...categories.map((category) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = category; button.dataset.searchCategory = category; button.setAttribute('aria-pressed', String(category === 'All')); button.addEventListener('click', () => { all('[data-search-category]').forEach((item) => item.setAttribute('aria-pressed', String(item === button))); renderSearch(); }); return button; })); byId('global-search').value = ''; renderSearch(); dialog.showModal(); byId('global-search').focus();
  }
  function renderSearch() {
    const query = byId('global-search').value.trim().toLowerCase(); const category = one('[data-search-category][aria-pressed="true"]')?.dataset.searchCategory || 'All'; const results = []; const matches = (name, detail = '') => !query || `${name} ${detail}`.toLowerCase().includes(query); const add = (kind, name, detail, callback) => { if ((category === 'All' || category === kind) && matches(name, detail)) results.push({ kind, name, detail, callback }); };
    data.chats.forEach((chat) => { add('Chats', chat.title, `${chat.messages.length} local messages`, () => showChat(chat.id)); chat.messages.forEach((message) => { add('Messages', message.text || 'Attachment message', chat.title, () => showChat(chat.id)); (message.attachments || []).forEach((name) => add('Files', name, `${chat.title} · filename only`, () => showChat(chat.id))); (message.text || '').match(/https?:\/\/[^\s<>]+/g)?.forEach((url) => add('Links', url, chat.title, () => showChat(chat.id))); }); });
    prefs.agents.forEach((agent) => add('Agents', agent.name, agent.role, () => { prefs.activeAgent = agent.id; savePrefs(); applyPrefs(); showChat(); openPane('agent'); })); data.channels.forEach((channel) => add('Channels', `# ${channel.name}`, 'Channel', () => showDirectory('Channel', channel.id))); data.projects.forEach((project) => add('Projects', project.name, 'Project', () => showDirectory('Project', project.id)));
    const list = byId('search-results'); list.replaceChildren(); if (!results.length) { const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = query ? `No matching ${category.toLowerCase()}.` : `No ${category.toLowerCase()} saved yet.`; list.append(empty); return; } results.forEach((result) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'search-result'; button.innerHTML = `<span><strong>${esc(result.name)}</strong><small>${esc(result.detail)}</small></span><span class="result-kind">${esc(result.kind)}</span>`; button.addEventListener('click', () => { byId('search-dialog').close(); result.callback(); }); list.append(button); });
  }

  function openSettings(page = 'general') {
    settingsOpener = document.activeElement; settingsDraft = structuredClone(prefs); settingsPage = page; const categories = [['general', 'General'], ['appearance', 'Appearance'], ['agents', 'Agents'], ['models', 'Models & providers'], ['connections', 'Connections'], ['data', 'Privacy & data']]; byId('settings-nav').replaceChildren(...categories.map(([id, label]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.category = id; button.setAttribute('aria-current', String(id === page)); button.addEventListener('click', () => { captureSettings(); settingsPage = id; renderSettingsPage(); }); return button; })); renderSettingsPage(); const dialog = byId('settings-dialog'); if (!dialog.open) dialog.showModal();
  }
  function captureSettings() { all('#settings-content [data-pref]').forEach((node) => { settingsDraft[node.dataset.pref] = node.type === 'checkbox' ? node.checked : node.value; }); }
  function renderSettingsPage() {
    all('[data-category]').forEach((button) => button.setAttribute('aria-current', String(button.dataset.category === settingsPage))); const pane = byId('settings-content'); pane.replaceChildren();
    if (settingsPage === 'general') pane.innerHTML = '<h2>General</h2><p>Keep your local workspace comfortable. Nothing here connects an account.</p><label for="pref-display-name">Display name</label><input id="pref-display-name" data-pref="displayName" maxlength="80" placeholder="Optional name"><p class="setting-help">Saved locally in this browser.</p>';
    if (settingsPage === 'appearance') pane.innerHTML = '<h2>Appearance</h2><p>Choose a calm workspace theme and spacing density.</p><label for="pref-theme">Theme</label><select id="pref-theme" data-pref="theme"><option value="dark">Dark</option><option value="light">Light</option></select><label for="pref-density">Spacing</label><select id="pref-density" data-pref="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><p class="setting-help">Save settings to apply the selection.</p>';
    if (settingsPage === 'models') pane.innerHTML = '<h2>Models &amp; providers</h2><p>Record a future preference without connecting a provider or collecting a key.</p><label for="pref-provider">Preferred provider</label><select id="pref-provider" data-pref="provider"><option>Not connected</option><option>OpenCode</option><option>OpenAI</option><option>Anthropic</option><option>OpenRouter</option></select><label for="pref-model">Preferred model</label><input id="pref-model" data-pref="model" placeholder="Optional model name"><div class="inline-note">No provider is connected. Aven will make no external request from this prototype.</div>';
    if (settingsPage === 'connections') pane.innerHTML = '<h2>Connections</h2><p>These toggles describe future capability preferences only.</p><label class="setting-check"><input type="checkbox" data-pref="browser"> Allow browser tasks after connection</label><label class="setting-check"><input type="checkbox" data-pref="computer"> Allow computer tasks after connection</label><div class="inline-note">No plugins, accounts or credentials are connected.</div>';
    if (settingsPage === 'data') pane.innerHTML = '<h2>Privacy &amp; data</h2><p>Chats, profiles, preferences and document text stay in this browser under the Aven local namespace.</p><div class="inline-note">Attachment contents last for this page session. Sent filenames are saved with messages; unsent files must be reattached after reload.</div>';
    if (settingsPage === 'agents') renderAgentsSettings();
    all('#settings-content [data-pref]').forEach((node) => { if (node.type === 'checkbox') node.checked = !!settingsDraft[node.dataset.pref]; else node.value = settingsDraft[node.dataset.pref] ?? ''; });
  }
  function renderAgentsSettings() {
    const pane = byId('settings-content'); pane.innerHTML = `<h2>Agents</h2><p>Profiles organize future conversations. Creating one starts no live agent.</p><div class="agent-settings-list">${prefs.agents.map((agent) => `<div class="agent-setting-card"><div><strong>${esc(agent.name)}</strong><p>${esc(agent.role)}</p></div><button type="button" data-select-agent="${esc(agent.id)}">${agent.id === prefs.activeAgent ? 'Selected' : 'Select'}</button>${agent.id === 'companion' ? '' : `<button type="button" data-remove-agent="${esc(agent.id)}">Remove</button>`}</div>`).join('')}</div><h3>New profile</h3><p class="setting-help">Use the central workspace when you are ready to name and describe an agent.</p><button class="button-secondary" id="settings-create-agent" type="button">Create an agent in workspace</button>`;
    all('[data-select-agent]', pane).forEach((button) => button.addEventListener('click', () => { prefs.activeAgent = button.dataset.selectAgent; settingsDraft.activeAgent = prefs.activeAgent; savePrefs(); applyPrefs(); renderAgentsSettings(); })); all('[data-remove-agent]', pane).forEach((button) => button.addEventListener('click', () => { const id = button.dataset.removeAgent; prefs.agents = prefs.agents.filter((agent) => agent.id !== id); if (prefs.activeAgent === id) prefs.activeAgent = 'companion'; settingsDraft.agents = structuredClone(prefs.agents); settingsDraft.activeAgent = prefs.activeAgent; savePrefs(); applyPrefs(); renderAgentsSettings(); }));
    byId('settings-create-agent').addEventListener('click', () => { byId('settings-dialog').close(); createWorkspace('agent'); });
  }

  function openPopover(which, anchor) { closePopovers(); const menu = byId(which); const rect = anchor.getBoundingClientRect(); menu.hidden = false; const width = menu.offsetWidth || 208; const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)); menu.style.left = `${left}px`; menu.style.top = `${which === 'create-menu' ? Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 7) : Math.max(8, rect.top - menu.offsetHeight - 7)}px`; anchor.setAttribute('aria-expanded', 'true'); const first = one('button', menu); first?.focus(); }
  function closePopovers() { ['add-menu', 'create-menu'].forEach((id) => { const menu = byId(id); menu.hidden = true; }); byId('tools-menu').setAttribute('aria-expanded', 'false'); byId('quick-create').setAttribute('aria-expanded', 'false'); }
  function addFiles(files) { const chat = currentChat(); if (!chat) return; const existing = sessionAttachments.get(chat.id) || []; [...files].forEach((file) => existing.push({ id: uid(), name: file.name, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })); sessionAttachments.set(chat.id, existing); chat.pendingAttachmentNames = existing.map((item) => item.name); saveData(); renderAttachments(); updateSend(); byId('chat-status').textContent = `${existing.length} attachment${existing.length === 1 ? '' : 's'} selected locally. Nothing uploaded.`; }
  function sendMessage(event) { event.preventDefault(); const chat = currentChat(); const text = byId('draft').value.trim(); const attachments = sessionAttachments.get(chat.id) || []; if (!text && !attachments.length) return; chat.messages.push({ id: uid(), role: 'user', text, attachments: attachments.map((item) => item.name), recipients: chat.recipients, recipientNames: selectedAgents(chat).map((agent) => agent.name), createdAt: now() }); attachments.forEach((item) => item.url && URL.revokeObjectURL(item.url)); sessionAttachments.delete(chat.id); chat.pendingAttachmentNames = []; chat.draft = ''; byId('draft').value = ''; saveData(); renderConversation(); renderComposer(); byId('chat-status').textContent = 'Message saved locally. No file upload or AI request occurred.'; }

  function init() {
    if (!prefs.agents.some((agent) => agent.id === prefs.activeAgent)) prefs.activeAgent = prefs.agents[0].id;
    if (!data.chats.some((chat) => chat.id === data.activeChat)) data.activeChat = data.chats[0].id;
    setIcons(); applyPrefs();
    byId('toggle').addEventListener('click', () => { const rail = byId('rail'); const expanded = rail.classList.toggle('expanded'); byId('toggle').setAttribute('aria-expanded', String(expanded)); byId('toggle').setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar'); byId('toggle').dataset.tip = expanded ? 'Collapse sidebar' : 'Expand sidebar'; });
    byId('quick-create').addEventListener('click', () => openPopover('create-menu', byId('quick-create'))); byId('tools-menu').addEventListener('click', () => openPopover('add-menu', byId('tools-menu')));
    all('[data-create]').forEach((button) => button.addEventListener('click', () => createWorkspace(button.dataset.create)));
    all('[data-add]').forEach((button) => button.addEventListener('click', () => { closePopovers(); const type = button.dataset.add; if (type === 'files' || type === 'images') byId(type === 'files' ? 'file-picker' : 'image-picker').click(); else openPane(type); }));
    byId('file-picker').addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; }); byId('image-picker').addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
    all('[data-destination]').forEach((button) => button.addEventListener('click', () => { const destination = button.dataset.destination; if (destination === 'Search') openSearch(); else if (destination === 'Chat') showDirectory('Chat'); else if (destination === 'Channels') showDirectory('Channels'); else if (destination === 'Projects') showDirectory('Projects'); else if (destination === 'Artifacts') { showChat(); openPane('artifacts'); } else showEmpty(destination); }));
    byId('avatar').addEventListener('click', () => openPane('agent')); byId('new-chat').addEventListener('click', () => startNewChat()); byId('composer').addEventListener('submit', sendMessage); byId('draft').addEventListener('input', () => { const chat = currentChat(); chat.draft = byId('draft').value; saveData(); updateSend(); });
    byId('recipient-picker').addEventListener('toggle', () => setIcons(byId('recipient-picker'))); byId('close-pane').addEventListener('click', () => closePane()); all('[data-pane]').forEach((button) => button.addEventListener('click', () => openPane(button.dataset.pane))); byId('settings').addEventListener('click', () => openSettings());
    byId('close-settings').addEventListener('click', () => byId('settings-dialog').close()); byId('cancel-settings').addEventListener('click', () => byId('settings-dialog').close()); byId('save-settings').addEventListener('click', () => { captureSettings(); prefs = { ...prefs, ...settingsDraft, agents: prefs.agents, activeAgent: prefs.activeAgent }; savePrefs(); applyPrefs(); byId('settings-status').textContent = 'Settings saved locally.'; setTimeout(() => byId('settings-dialog').close(), 250); }); byId('settings-dialog').addEventListener('close', () => { if (settingsOpener?.isConnected) settingsOpener.focus(); settingsOpener = null; });
    byId('global-search').addEventListener('input', renderSearch); byId('close-search').addEventListener('click', () => byId('search-dialog').close()); byId('search-dialog').addEventListener('close', () => { if (searchOpener?.isConnected) searchOpener.focus(); searchOpener = null; });
    document.addEventListener('pointerdown', (event) => { if (!event.target.closest('#add-menu, #create-menu, #tools-menu, #quick-create')) closePopovers(); });
    window.addEventListener('resize', syncPaneModal);
    document.addEventListener('keydown', (event) => {
      if (byId('settings-dialog').open || byId('search-dialog').open) return;
      if (event.key === 'Tab' && !byId('right-pane').hidden && window.innerWidth <= 760) {
        const focusable = all('button:not([disabled]), select, textarea, input, [href]', byId('right-pane')).filter((node) => node.offsetParent !== null);
        if (focusable.length) { const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
        return;
      }
      if (event.key !== 'Escape') return;
      if (!byId('add-menu').hidden || !byId('create-menu').hidden) { closePopovers(); return; }
      if (byId('right-pane').hidden) return; event.preventDefault(); closePane();
    });
    showChat(data.activeChat); if (window.innerWidth > 760) openPane('agent');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
