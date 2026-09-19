(() => {
  "use strict";

  const STORAGE = {
    theme: "netrok-muse-theme",
    agentName: "netrok-muse-agent-name",
    draft: "netrok-muse-draft",
    messages: "netrok-muse-messages",
    activity: "netrok-muse-activity",
    goals: "netrok-muse-goals",
    plans: "netrok-muse-plans",
    currentPlan: "netrok-muse-current-plan",
    feedback: "netrok-muse-feedback"
  };

  const seedMessages = [
    {
      id: "seed-user",
      role: "user",
      text: "Help me understand why the Mumbai branch is slow.",
      seeded: true,
      createdAt: "2026-09-10T05:30:00.000Z"
    },
    {
      id: "seed-assistant",
      role: "assistant",
      label: "SAMPLE ANALYSIS",
      seeded: true,
      createdAt: "2026-09-10T05:30:02.000Z",
      text: "A useful first frame is to check where latency begins to build along the branch path. In this sample lab, the handoff between the branch edge and transit is the place to inspect first.",
      secondText: "That is a lead to verify, not a live finding. The two synthetic artifacts below show the kind of evidence a read-only review could bring together."
    }
  ];

  const seedGoals = [
    { id: "goal-path", title: "Understand the Mumbai branch path", description: "Trace the sample route from the branch edge to its upstream handoff.", checked: false },
    { id: "goal-errors", title: "Check interface health signals", description: "Compare synthetic error counters before drawing a conclusion.", checked: false },
    { id: "goal-plan", title: "Keep every next step reviewable", description: "Make a read-only plan visible before a decision is recorded.", checked: false }
  ];

  const seedPlans = [
    {
      id: "plan-1",
      title: "Inspect the branch edge handoff",
      target: "lab-edge-02",
      operation: "Inspect interface counters and error rate",
      reason: "The sample path shows latency beginning near the branch-to-transit handoff.",
      decision: null,
      result: ""
    }
  ];

  const seedActivity = [
    {
      id: "activity-started",
      kind: "system",
      label: "Sample lab opened",
      detail: "Synthetic evidence and draft goals are available locally.",
      createdAt: new Date().toISOString()
    }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readJSON(key, fallback, validate) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return clone(fallback);
      const value = JSON.parse(raw);
      return validate && !validate(value) ? clone(fallback) : value;
    } catch (_error) {
      return clone(fallback);
    }
  }

  function readText(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch (_error) {
      // The prototype still works if storage is unavailable.
    }
  }

  function validTheme(value) {
    return value === "light" || value === "dark" || value === "system";
  }

  function validMessages(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string");
  }

  function validGoals(value) {
    return Array.isArray(value) && value.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.checked === "boolean");
  }

  function validPlans(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => item &&
      ["id", "title", "target", "operation", "reason", "result"].every((field) => typeof item[field] === "string") &&
      [null, "approved", "rejected"].includes(item.decision)) && new Set(value.map((item) => item.id)).size === value.length;
  }

  function validActivity(value) {
    return Array.isArray(value) && value.every((item) => item && typeof item.label === "string" && typeof item.detail === "string");
  }

  const storedTheme = readText(STORAGE.theme, "light");
  const state = {
    theme: validTheme(storedTheme) ? storedTheme : "light",
    agentName: readText(STORAGE.agentName, "Atlas").trim().slice(0, 32) || "Atlas",
    draft: readText(STORAGE.draft, ""),
    messages: readJSON(STORAGE.messages, seedMessages, validMessages),
    goals: readJSON(STORAGE.goals, seedGoals, validGoals),
    plans: readJSON(STORAGE.plans, seedPlans, validPlans),
    activity: readJSON(STORAGE.activity, seedActivity, validActivity),
    feedback: readText(STORAGE.feedback, ""),
    currentPlanId: readText(STORAGE.currentPlan, ""),
    drawerTab: "evidence",
    activeView: "conversation"
  };

  if (!state.plans.some((plan) => plan.id === state.currentPlanId)) {
    state.currentPlanId = state.plans[state.plans.length - 1].id;
  }

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
  const elements = {
    body: document.body,
    app: $(".app-shell"),
    sidebar: $("#sidebar"),
    messageList: $("#message-list"),
    composerForm: $("#composer-form"),
    composerInput: $("#composer-input"),
    drawer: $("#detail-drawer"),
    drawerBody: $("#drawer-body"),
    drawerScrim: $("#drawer-scrim"),
    toast: $("#toast"),
    goalsList: $("#goals-list"),
    activityList: $("#activity-list"),
    settingsModal: $("#settings-modal"),
    feedbackModal: $("#feedback-modal"),
    agentName: $("#agent-name"),
    feedbackInput: $("#feedback-input"),
    feedbackStatus: $("#feedback-save-status")
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatText(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function avatarMarkup(className = "assistant-avatar", label = state.agentName) {
    return `<div class="avatar ${className}" role="img" aria-label="${escapeHtml(label)} avatar"><svg viewBox="0 0 48 48" role="presentation"><defs><linearGradient id="assistant-avatar-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ec6ff"/><stop offset="1" stop-color="#4b79eb"/></linearGradient></defs><circle cx="24" cy="24" r="24" fill="url(#assistant-avatar-gradient)"/><path d="M14 18.5c1.8-6 6.5-8.8 11.4-8.8 5.8 0 9.5 3.8 9.9 8.6-3.8-1.2-7-2.8-10.9-3-3.5 2.5-6.8 3.4-10.4 3.2Z" fill="#f9fbff"/><path d="M15 29.5c1.7-4.6 5-6.9 9-6.9 4.4 0 7.4 2.2 9 6.9v7H15v-7Z" fill="#f3f7ff"/><circle cx="20.2" cy="22.6" r="1.35" fill="#2f4d9f"/><circle cx="28.1" cy="22.6" r="1.35" fill="#2f4d9f"/><path d="M21 27c1.5 1.1 3.3 1.1 4.9 0" fill="none" stroke="#2f4d9f" stroke-linecap="round" stroke-width="1.35"/></svg></div>`;
  }

  function artifactMarkup(artifact) {
    if (artifact === "topology") {
      return `<button type="button" class="artifact-card" data-open-drawer="evidence" aria-label="Open sample path and topology evidence"><div class="artifact-visual topology"><span class="topology-node one"></span><span class="topology-node two"></span><span class="topology-node three"></span></div><span><span class="artifact-title">Path / topology</span><span class="artifact-meta">sample lab · synthetic path</span></span><span class="artifact-arrow" aria-hidden="true">↗</span></button>`;
    }
    return `<button type="button" class="artifact-card" data-open-drawer="evidence" aria-label="Open sample interface error evidence"><div class="artifact-visual errors"><span></span><span></span><span></span><span></span><span></span><span></span></div><span><span class="artifact-title">Interface errors</span><span class="artifact-meta">sample counters · read-only</span></span><span class="artifact-arrow" aria-hidden="true">↗</span></button>`;
  }

  function renderMessages() {
    elements.messageList.innerHTML = state.messages.map((message) => {
      if (message.role === "user") {
        return `<article class="message-row user"><div class="message-content"><div class="message-bubble">${formatText(message.text)}</div><div class="message-meta">${message.seeded ? "Sample question" : "Saved locally"}</div></div></article>`;
      }
      const label = message.label || "LOCAL NOTE";
      const artifacts = message.id === "seed-assistant" ? `<div class="artifact-grid">${artifactMarkup("topology")}${artifactMarkup("errors")}</div><button type="button" class="review-button" data-open-drawer="plan">Review investigation plan ${icon("arrow")}</button>` : "";
      return `<article class="message-row assistant">${avatarMarkup()}<div class="message-content"><div class="message-label">${escapeHtml(label)}</div><div class="message-bubble"><p>${formatText(message.text)}</p>${message.secondText ? `<p>${formatText(message.secondText)}</p>` : ""}</div>${artifacts}</div></article>`;
    }).join("");
    requestAnimationFrame(() => { elements.messageList.scrollTop = elements.messageList.scrollHeight; });
  }

  function renderGoals() {
    elements.goalsList.innerHTML = state.goals.map((goal) => `<article class="goal-card ${goal.checked ? "is-done" : ""}"><input class="goal-check" type="checkbox" data-goal-id="${escapeHtml(goal.id)}" ${goal.checked ? "checked" : ""} aria-label="Mark ${escapeHtml(goal.title)} complete"><div><h3>${escapeHtml(goal.title)}</h3><p>${escapeHtml(goal.description)}</p></div><span class="goal-tag">Sample goal</span></article>`).join("");
  }

  function activityIcon(kind) {
    if (kind === "decision") return "check";
    if (kind === "goal") return "target";
    if (kind === "message") return "chat";
    return "spark";
  }

  function formatTime(value) {
    try {
      return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
    } catch (_error) {
      return "now";
    }
  }

  function renderActivity() {
    if (!state.activity.length) {
      elements.activityList.innerHTML = `<div class="empty-state">Your local choices will appear here.</div>`;
      return;
    }
    elements.activityList.innerHTML = [...state.activity].reverse().map((item) => `<article class="activity-item"><div class="activity-marker">${icon(activityIcon(item.kind))}</div><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><time datetime="${escapeHtml(item.createdAt)}">${formatTime(item.createdAt)}</time></article>`).join("");
  }

  function persistState() {
    write(STORAGE.theme, state.theme);
    write(STORAGE.agentName, state.agentName);
    write(STORAGE.draft, state.draft);
    write(STORAGE.messages, state.messages);
    write(STORAGE.activity, state.activity);
    write(STORAGE.goals, state.goals);
    write(STORAGE.plans, state.plans);
    write(STORAGE.currentPlan, state.currentPlanId);
    write(STORAGE.feedback, state.feedback);
  }

  function applyTheme() {
    if (state.theme === "system") {
      elements.body.removeAttribute("data-theme");
    } else {
      elements.body.dataset.theme = state.theme;
    }
    $$('input[name="theme"]').forEach((input) => { input.checked = input.value === state.theme; });
  }

  function updateAgentName() {
    const safeName = escapeHtml(state.agentName);
    $("#side-agent-name").textContent = state.agentName;
    $("#conversation-heading").textContent = `Investigate with ${state.agentName}.`;
    elements.agentName.value = state.agentName;
    document.title = `Netrok Muse · ${state.agentName}`;
    // The message avatar is a shared visual identity, so rerendering updates its accessible label too.
    renderMessages();
    void safeName;
  }

  function addActivity(label, detail, kind = "system") {
    state.activity.push({ id: `activity-${Date.now()}-${Math.random().toString(16).slice(2)}`, label, detail, kind, createdAt: new Date().toISOString() });
    persistState();
    renderActivity();
  }

  let toastTimer;
  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2800);
  }

  let drawerOpener = null;
  let modalOpener = null;
  const overlayViewport = window.matchMedia("(max-width: 1099px)");

  function syncBackgroundAccess() {
    const modalOpen = !elements.settingsModal.hidden || !elements.feedbackModal.hidden;
    const overlayOpen = elements.app.classList.contains("drawer-open") && overlayViewport.matches;
    elements.app.inert = modalOpen;
    elements.sidebar.inert = overlayOpen;
    $(".main-pane").inert = overlayOpen;
  }
  overlayViewport.addEventListener("change", syncBackgroundAccess);

  function openDrawer(tab = "evidence") {
    if (!elements.app.classList.contains("drawer-open")) drawerOpener = document.activeElement;
    state.drawerTab = tab === "plan" ? "plan" : "evidence";
    elements.app.classList.add("drawer-open");
    elements.drawer.setAttribute("aria-hidden", "false");
    elements.drawer.inert = false;
    syncBackgroundAccess();
    renderDrawer();
    const closeButton = $("#close-drawer");
    if (closeButton) closeButton.focus();
  }

  function closeDrawer() {
    elements.app.classList.remove("drawer-open");
    elements.drawer.setAttribute("aria-hidden", "true");
    elements.drawer.inert = true;
    syncBackgroundAccess();
    if (drawerOpener && drawerOpener.isConnected) drawerOpener.focus();
  }

  function currentPlan() {
    return state.plans.find((plan) => plan.id === state.currentPlanId) || state.plans[0];
  }

  function renderTopology() {
    return `<figure class="topology-figure" aria-label="Synthetic sample topology from Mumbai branch to upstream"><svg viewBox="0 0 320 150" role="img"><path d="M55 74h85M175 74h90" stroke="currentColor" opacity=".35"/><path d="M140 74 175 74" stroke="var(--blue)" stroke-dasharray="4 4"/><circle cx="48" cy="74" r="16" fill="var(--surface)" stroke="var(--blue)"/><circle cx="160" cy="74" r="17" fill="var(--surface)" stroke="var(--blue)"/><circle cx="273" cy="74" r="16" fill="var(--surface)" stroke="var(--green)"/><circle cx="160" cy="74" r="24" fill="none" stroke="var(--blue)" opacity=".2"/><text x="48" y="108" text-anchor="middle">Mumbai edge</text><text x="160" y="108" text-anchor="middle">Transit</text><text x="273" y="108" text-anchor="middle">Upstream</text><text x="160" y="48" text-anchor="middle" fill="var(--blue)">inspect handoff</text></svg></figure>`;
  }

  function renderEvidence() {
    elements.drawerBody.innerHTML = `<p class="drawer-lead">Two synthetic artifacts frame the sample question. They suggest a place to look while keeping the conclusion open.</p><p class="drawer-section-label">Sample path / topology</p>${renderTopology()}<div class="drawer-artifact"><div><strong>Branch edge → transit → upstream</strong><span>Illustrative path · no devices connected</span></div>${icon("arrow")}</div><p class="drawer-section-label">Sample interface signals</p><div class="drawer-artifact"><div><strong>Error counters rise at handoff</strong><span>Illustrative counters · read-only</span></div>${icon("activity")}</div><p class="drawer-footer-note">Evidence in this drawer is synthetic and is included to explore the review experience. Open the plan to see what an explicit simulated decision looks like.</p><button class="button-primary" type="button" data-drawer-tab="plan">Open investigation plan ${icon("arrow")}</button>`;
  }

  function renderPlan() {
    const plan = currentPlan();
    const decisionLabel = plan.decision === "approved" ? "Approved" : plan.decision === "rejected" ? "Rejected" : "Draft";
    const decisionClass = ["approved", "rejected"].includes(plan.decision) ? plan.decision : "";
    const disabled = plan.decision ? "disabled" : "";
    const result = plan.result ? `<div class="decision-result ${plan.decision === "rejected" ? "rejected" : ""}">${escapeHtml(plan.result)}</div>` : "";
    elements.drawerBody.innerHTML = `<p class="drawer-lead">A plan is shown before any action. In this prototype, approve and reject only record your choice locally.</p><div class="plan-card"><div class="plan-kicker"><span>Investigation plan</span><span class="decision-badge ${decisionClass}">${decisionLabel}</span></div><h3>${escapeHtml(plan.title)}</h3><dl class="plan-detail"><dt>Target</dt><dd>${escapeHtml(plan.target)}</dd><dt>Operation</dt><dd>${escapeHtml(plan.operation)}</dd><dt>Why this</dt><dd>${escapeHtml(plan.reason)}</dd></dl><div class="simulation-note">${icon("info")}<span>Read-only simulated check. No command will run and no network call will be made.</span></div><div class="decision-actions"><button class="button-primary" type="button" data-plan-action="approve" ${disabled}>Approve simulation</button><button class="button-danger" type="button" data-plan-action="reject" ${disabled}>Reject plan</button></div>${result}</div><button class="button-secondary alternate-plan" type="button" data-plan-action="alternate">Request another plan</button><p class="drawer-footer-note">Requesting another plan creates a second local proposal and preserves this decision in Activity history.</p>`;
  }

  function renderDrawer() {
    $$('[data-drawer-tab]').forEach((button) => { button.setAttribute("aria-selected", button.dataset.drawerTab === state.drawerTab ? "true" : "false"); });
    if (state.drawerTab === "plan") renderPlan(); else renderEvidence();
  }

  function decidePlan(decision) {
    const plan = currentPlan();
    if (!plan || plan.decision) return;
    plan.decision = decision;
    plan.result = decision === "approved" ? "Simulation recorded locally. No network call was made." : "Rejection recorded locally. Nothing was run.";
    addActivity(decision === "approved" ? "Approved a simulated check" : "Rejected a simulated check", `${plan.title} · ${plan.target}`, "decision");
    persistState();
    renderDrawer();
    showToast(decision === "approved" ? "Simulation recorded locally." : "Rejection recorded locally.");
  }

  function requestAlternatePlan() {
    const number = state.plans.length + 1;
    const alternate = {
      id: `plan-${Date.now()}`,
      title: "Compare the upstream handoff",
      target: "lab-edge-02",
      operation: "Inspect a read-only path latency sample",
      reason: "A second framing tests the handoff from the transit side without changing the first proposal.",
      decision: null,
      result: ""
    };
    state.plans.push(alternate);
    state.currentPlanId = alternate.id;
    addActivity("Requested another investigation plan", `Alternate proposal ${number} created locally.`, "system");
    persistState();
    renderDrawer();
    showToast("A second plan is ready for review.");
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modalOpener = document.activeElement;
    modal.hidden = false;
    syncBackgroundAccess();
    if (id === "settings-modal") {
      elements.agentName.value = state.agentName;
      $$('input[name="theme"]').forEach((input) => { input.checked = input.value === state.theme; });
      window.setTimeout(() => elements.agentName.focus(), 0);
    } else {
      elements.feedbackInput.value = state.feedback;
      window.setTimeout(() => elements.feedbackInput.focus(), 0);
    }
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.hidden = true;
    syncBackgroundAccess();
    if (modalOpener && modalOpener.isConnected) modalOpener.focus();
  }

  function setView(view) {
    const validViews = ["conversation", "goals", "activity"];
    if (!validViews.includes(view)) return;
    state.activeView = view;
    $$(".view").forEach((section) => { section.hidden = section.id !== `view-${view}`; section.classList.toggle("is-visible", section.id === `view-${view}`); });
    $$(".nav-item").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    elements.app.classList.remove("sidebar-open");
    $("#toggle-sidebar").setAttribute("aria-expanded", "false");
  }

  function resizeComposer() {
    elements.composerInput.style.height = "auto";
    elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 132)}px`;
  }

  function submitMessage() {
    const text = elements.composerInput.value.trim();
    if (!text) return;
    const now = new Date().toISOString();
    state.messages.push({ id: `user-${Date.now()}`, role: "user", text, createdAt: now });
    state.messages.push({ id: `local-note-${Date.now()}`, role: "assistant", label: "LOCAL NOTE", text: "Saved in this prototype. A live agent is not connected yet.", createdAt: new Date().toISOString() });
    state.draft = "";
    elements.composerInput.value = "";
    resizeComposer();
    persistState();
    addActivity("Saved a local message", "The message was added to this prototype; no agent was contacted.", "message");
    renderMessages();
    showToast("Saved locally. No live agent was contacted.");
  }

  function downloadFeedback() {
    const exportData = { exportedAt: new Date().toISOString(), product: "Netrok Muse local prototype", theme: state.theme, agentName: state.agentName, feedback: state.feedback, goals: state.goals, activity: state.activity, plans: state.plans };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "netrok-muse-feedback.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("Feedback JSON downloaded.");
  }

  elements.composerInput.value = state.draft;
  applyTheme();
  updateAgentName();
  renderGoals();
  renderActivity();
  resizeComposer();

  $$(".nav-item").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.view === "settings") { openModal("settings-modal"); return; }
    setView(button.dataset.view);
  }));
  $("#top-settings").addEventListener("click", () => openModal("settings-modal"));
  $("#toggle-sidebar").addEventListener("click", () => {
    const open = elements.app.classList.toggle("sidebar-open");
    $("#toggle-sidebar").setAttribute("aria-expanded", String(open));
  });
  $("#open-feedback").addEventListener("click", () => openModal("feedback-modal"));
  $("#close-drawer").addEventListener("click", closeDrawer);
  elements.drawerScrim.addEventListener("click", closeDrawer);
  elements.composerInput.addEventListener("input", () => { state.draft = elements.composerInput.value; write(STORAGE.draft, state.draft); resizeComposer(); });
  elements.composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitMessage(); }
  });
  elements.composerForm.addEventListener("submit", (event) => { event.preventDefault(); submitMessage(); });

  document.addEventListener("click", (event) => {
    const openTarget = event.target.closest("[data-open-drawer]");
    if (openTarget) { openDrawer(openTarget.dataset.openDrawer); return; }
    const tabTarget = event.target.closest("[data-drawer-tab]");
    if (tabTarget) { state.drawerTab = tabTarget.dataset.drawerTab; renderDrawer(); return; }
    const planAction = event.target.closest("[data-plan-action]");
    if (planAction) {
      if (planAction.dataset.planAction === "approve") decidePlan("approved");
      if (planAction.dataset.planAction === "reject") decidePlan("rejected");
      if (planAction.dataset.planAction === "alternate") requestAlternatePlan();
      return;
    }
    const closeTarget = event.target.closest("[data-close-modal]");
    if (closeTarget) closeModal(closeTarget.dataset.closeModal);
  });

  elements.goalsList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-goal-id]");
    if (!checkbox) return;
    const goal = state.goals.find((item) => item.id === checkbox.dataset.goalId);
    if (!goal) return;
    goal.checked = checkbox.checked;
    persistState();
    renderGoals();
    addActivity(goal.checked ? "Marked a sample goal complete" : "Reopened a sample goal", goal.title, "goal");
  });

  $("#save-settings").addEventListener("click", () => {
    const nextName = elements.agentName.value.trim().slice(0, 32);
    state.agentName = nextName || "Atlas";
    const selectedTheme = $("input[name=theme]:checked");
    state.theme = selectedTheme && validTheme(selectedTheme.value) ? selectedTheme.value : "system";
    applyTheme();
    updateAgentName();
    persistState();
    addActivity("Updated local settings", `${state.agentName} · ${state.theme} appearance`, "system");
    closeModal("settings-modal");
    showToast("Settings saved on this device.");
  });
  elements.feedbackInput.addEventListener("input", () => { state.feedback = elements.feedbackInput.value; write(STORAGE.feedback, state.feedback); elements.feedbackStatus.textContent = "Saved locally as you type."; });
  $("#download-feedback").addEventListener("click", downloadFeedback);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      const boundary = !elements.settingsModal.hidden ? elements.settingsModal :
        !elements.feedbackModal.hidden ? elements.feedbackModal :
        elements.app.classList.contains("drawer-open") && overlayViewport.matches ? elements.drawer : null;
      if (boundary) {
        const controls = $$("button:not([disabled]), input:not([disabled]), textarea, select, a[href], [tabindex='0']", boundary)
          .filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (first && (!boundary.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }
    if (event.key !== "Escape") return;
    if (!elements.settingsModal.hidden) { closeModal("settings-modal"); return; }
    if (!elements.feedbackModal.hidden) { closeModal("feedback-modal"); return; }
    if (elements.app.classList.contains("drawer-open")) { closeDrawer(); return; }
    if (elements.app.classList.contains("sidebar-open")) { elements.app.classList.remove("sidebar-open"); $("#toggle-sidebar").setAttribute("aria-expanded", "false"); }
  });
})();
