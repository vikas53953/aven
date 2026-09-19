'use strict';

(function () {
  const DEFAULT_API = 'http://127.0.0.1:8768/api/git';

  function node(tag, className, label) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (label !== undefined) item.textContent = label;
    return item;
  }

  function button(label, className = 'button-secondary') {
    const item = node('button', className, label);
    item.type = 'button';
    return item;
  }

  function callout(text, kind = 'note') {
    const item = node('p', `git-callout git-callout-${kind}`, text);
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    return item;
  }

  function mount(container, options = {}) {
    const api = String(options.apiBase || DEFAULT_API).replace(/\/$/, '');
    const state = { snapshot: null, selected: new Set(), review: null, commitReview: null, prReview: null, busy: false, requestSequence: 0 };
    container.replaceChildren();
    const root = node('div', 'git-settings');
    const header = node('div', 'git-settings-header');
    header.append(node('h2', '', 'Git workspace'), node('p', '', 'Review local changes, stage or unstage exact patches, and create a local commit. Pull-request publishing is a separate explicit action and never pushes automatically.'));
    root.append(header);

    const configure = node('form', 'git-repository-form');
    const repoLabel = node('label', '', 'Repository path');
    const repoPath = node('input');
    repoPath.id = 'git-repository-path';
    repoPath.name = 'repoPath';
    repoPath.type = 'text';
    repoPath.autocomplete = 'off';
    repoPath.spellcheck = false;
    repoPath.placeholder = 'C:\\work\\my-repository';
    repoLabel.htmlFor = repoPath.id;
    const configureButton = button('Configure repository', 'button-primary');
    configureButton.type = 'submit';
    configureButton.id = 'git-configure-repository';
    configure.append(repoLabel, repoPath, configureButton);
    root.append(configure);

    const help = node('p', 'git-settings-help', 'Only ordinary local repositories are supported. Linked worktrees, submodules, symlink paths, detached or unborn HEADs, filters, binary patches, hooks, and credential helpers are rejected or disabled.');
    root.append(help);
    const status = node('div', 'git-settings-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(status);

    const workspace = node('div', 'git-workspace-body');
    workspace.hidden = true;
    const identity = node('section', 'git-identity-card');
    const identityTitle = node('h3', '', 'Repository');
    const identityValue = node('p', 'git-identity-value');
    identity.append(identityTitle, identityValue);
    workspace.append(identity);

    const changes = node('section', 'git-changes');
    const changesHeader = node('div', 'git-section-heading');
    changesHeader.append(node('h3', '', 'Changed files'), node('span', 'git-selection-count'));
    changes.append(changesHeader);
    const selectAllLabel = node('label', 'git-select-all');
    const selectAll = node('input');
    selectAll.type = 'checkbox';
    selectAll.id = 'git-select-all';
    selectAllLabel.htmlFor = selectAll.id;
    selectAllLabel.append(selectAll, node('span', '', 'Select all changed files'));
    changes.append(selectAllLabel);
    const fileList = node('div', 'git-file-list');
    changes.append(fileList);
    const fileActions = node('div', 'git-actions');
    const reviewStage = button('Review stage', 'button-secondary');
    const reviewUnstage = button('Review unstage', 'button-secondary');
    fileActions.append(reviewStage, reviewUnstage);
    changes.append(fileActions);
    workspace.append(changes);

    const patchReview = node('section', 'git-review-card');
    patchReview.hidden = true;
    const patchHeading = node('div', 'git-section-heading');
    const patchTitle = node('h3', '', 'Patch review');
    patchHeading.append(patchTitle);
    patchReview.append(patchHeading);
    patchReview.append(node('p', 'git-review-description', 'Every hunk in the selected canonical patch is shown below. Applying requires a fresh one-use review token.'));
    const patchPre = node('pre', 'git-patch');
    patchPre.tabIndex = 0;
    patchReview.append(patchPre);
    const patchActions = node('div', 'git-actions');
    const applyPatch = button('Apply reviewed patch', 'button-primary');
    const cancelPatch = button('Cancel review');
    patchActions.append(cancelPatch, applyPatch);
    patchReview.append(patchActions);
    workspace.append(patchReview);

    const commit = node('section', 'git-commit-card');
    commit.append(node('h3', '', 'Commit')); 
    commit.append(node('p', 'git-review-description', 'Preview the complete staged diff and commit message before creating a local commit. Hooks and signing are disabled for this reviewed path.'));
    const messageLabel = node('label', '', 'Commit message');
    const message = node('textarea');
    message.id = 'git-commit-message';
    message.rows = 3;
    message.maxLength = 10000;
    message.placeholder = 'Describe the reviewed change';
    messageLabel.htmlFor = message.id;
    commit.append(messageLabel, message);
    const commitActions = node('div', 'git-actions');
    const reviewCommitButton = button('Review commit', 'button-secondary');
    commitActions.append(reviewCommitButton);
    commit.append(commitActions);
    const commitReview = node('div', 'git-commit-review');
    commitReview.hidden = true;
    const commitPre = node('pre', 'git-patch');
    commitPre.tabIndex = 0;
    const commitConfirm = button('Create reviewed commit', 'button-primary');
    const commitCancel = button('Cancel commit review');
    const commitReviewActions = node('div', 'git-actions');
    commitReviewActions.append(commitCancel, commitConfirm);
    commitReview.append(node('p', 'git-review-description', 'The commit preview includes every staged path and hunk.'), commitPre, commitReviewActions);
    commit.append(commitReview);
    workspace.append(commit);

    const pr = node('section', 'git-pr-card');
    pr.append(node('h3', '', 'Pull request')); 
    pr.append(node('p', 'git-review-description', 'Review checks local refs and the configured remote identity. Publishing performs a second exact remote OID check, then invokes gh only after you press Publish.'));
    const prGrid = node('div', 'git-pr-fields');
    const headLabel = node('label', '', 'Head branch');
    const head = node('input');
    head.id = 'git-pr-head';
    head.autocomplete = 'off';
    headLabel.htmlFor = head.id;
    headLabel.append(head);
    const baseLabel = node('label', '', 'Base branch');
    const base = node('input');
    base.id = 'git-pr-base';
    base.value = 'main';
    base.autocomplete = 'off';
    baseLabel.htmlFor = base.id;
    baseLabel.append(base);
    const titleLabel = node('label', '', 'Title');
    const title = node('input');
    title.id = 'git-pr-title';
    title.autocomplete = 'off';
    titleLabel.htmlFor = title.id;
    titleLabel.append(title);
    const bodyLabel = node('label', '', 'Description');
    const body = node('textarea');
    body.id = 'git-pr-body';
    body.rows = 4;
    bodyLabel.htmlFor = body.id;
    bodyLabel.append(body);
    prGrid.append(headLabel, baseLabel, titleLabel, bodyLabel);
    pr.append(prGrid);
    const prActions = node('div', 'git-actions');
    const reviewPr = button('Review pull request', 'button-secondary');
    prActions.append(reviewPr);
    pr.append(prActions);
    const prReview = node('div', 'git-pr-review');
    prReview.hidden = true;
    const prSummary = node('p', 'git-review-description');
    const publishPr = button('Publish pull request', 'button-primary');
    publishPr.disabled = true;
    prReview.append(prSummary, publishPr);
    pr.append(prReview);
    workspace.append(pr);
    root.append(workspace);
    container.append(root);

    function setStatus(message, kind = 'normal') {
      status.replaceChildren();
      if (message) status.append(callout(message, kind === 'error' ? 'error' : 'note'));
    }

    async function request(pathname, payload, method = 'POST') {
      const response = await fetch(`${api}${pathname}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Aven-Git': 'workspace-v1' }, body: method === 'GET' ? undefined : JSON.stringify(payload || {}) });
      let result;
      try { result = await response.json(); } catch { throw new Error('Git workspace returned an unreadable response.'); }
      if (!response.ok) { const error = new Error(result.reasons?.[0] || result.error || 'Git workspace request failed.'); error.code = result.error; throw error; }
      return result.result;
    }

    function selectedPaths() { return [...state.selected].sort(); }
    function clearReviews() { state.review = null; state.commitReview = null; state.prReview = null; patchReview.hidden = true; commitReview.hidden = true; prReview.hidden = true; publishPr.disabled = true; }

    function renderFiles() {
      fileList.replaceChildren();
      const entries = state.snapshot?.status?.entries || [];
      if (!entries.length) fileList.append(node('p', 'git-empty', 'Working tree is clean.'));
      for (const entry of entries) {
        const label = node('label', 'git-file-row');
        const checkbox = node('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.selected.has(entry.path);
        checkbox.dataset.gitPath = entry.path;
        checkbox.addEventListener('change', () => { if (checkbox.checked) state.selected.add(entry.path); else state.selected.delete(entry.path); renderFiles(); });
        const pathText = node('span', 'git-file-path', entry.path);
        const code = node('code', 'git-file-code', entry.code);
        label.append(checkbox, pathText, code);
        fileList.append(label);
      }
      const total = entries.length;
      const selected = entries.filter((entry) => state.selected.has(entry.path)).length;
      selectAll.checked = total > 0 && selected === total;
      selectAll.indeterminate = selected > 0 && selected < total;
      changesHeader.querySelector('.git-selection-count').textContent = `${selected} of ${total} selected`;
      reviewStage.disabled = state.busy || selected === 0;
      reviewUnstage.disabled = state.busy || selected === 0;
    }

    function renderSnapshot() {
      const snapshot = state.snapshot;
      workspace.hidden = !snapshot || snapshot.state !== 'ready';
      if (!snapshot || snapshot.state !== 'ready') return;
      repoPath.value = snapshot.repository.path;
      identityValue.textContent = `${snapshot.repository.path} · ${snapshot.repository.branch} · ${snapshot.repository.head.slice(0, 12)}`;
      head.value = snapshot.repository.branch;
      renderFiles();
    }

    async function refresh() {
      const requestId = ++state.requestSequence;
      state.busy = true;
      renderFiles();
      try { const snapshot = await request('/status', undefined, 'GET'); if (requestId !== state.requestSequence) return; state.snapshot = snapshot; renderSnapshot(); setStatus(state.snapshot.state === 'ready' ? 'Repository status refreshed locally.' : state.snapshot.reason || 'Repository is unavailable.', state.snapshot.state === 'ready' ? 'normal' : 'error'); }
      catch (error) { if (requestId === state.requestSequence) { state.snapshot = null; renderSnapshot(); setStatus(error.message, 'error'); } }
      finally { if (requestId === state.requestSequence) { state.busy = false; renderFiles(); } }
    }

    async function configureRepository(event) {
      event.preventDefault();
      state.requestSequence += 1;
      clearReviews();
      state.snapshot = null;
      state.selected.clear();
      renderSnapshot();
      state.busy = true;
      configureButton.disabled = true;
      try { state.snapshot = await request('/configure', { repoPath: repoPath.value.trim(), baseRef: base.value.trim() || 'main' }); state.selected.clear(); state.review = null; renderSnapshot(); setStatus('Repository configured. Review changed files before every local action.'); }
      catch (error) { setStatus(error.message, 'error'); }
      finally { state.busy = false; configureButton.disabled = false; renderFiles(); }
    }

    async function reviewPatch(action) {
      state.busy = true;
      renderFiles();
      try { state.review = await request('/review', { action, paths: selectedPaths() }); patchTitle.textContent = action === 'stage' ? 'Stage patch review' : 'Unstage patch review'; patchPre.textContent = state.review.patch; patchReview.hidden = false; applyPatch.textContent = action === 'stage' ? 'Stage reviewed changes' : 'Unstage reviewed changes'; setStatus('Review ready. No repository state changed.'); }
      catch (error) { setStatus(error.message, 'error'); }
      finally { state.busy = false; renderFiles(); }
    }

    async function applyReviewedPatch() {
      if (!state.review) return;
      state.busy = true;
      applyPatch.disabled = true;
      try { await request('/apply', { token: state.review.token, action: state.review.action, patch: state.review.patch }); state.review = null; patchReview.hidden = true; await refresh(); setStatus('Reviewed patch applied to the Git index. The worktree is unchanged.'); }
      catch (error) { state.review = null; patchReview.hidden = true; setStatus(error.message, 'error'); }
      finally { state.busy = false; applyPatch.disabled = false; renderFiles(); }
    }

    async function reviewCommitAction() {
      state.busy = true;
      reviewCommitButton.disabled = true;
      try { state.commitReview = await request('/commit/review', { message: message.value }); commitPre.textContent = state.commitReview.stagedDiff; commitReview.hidden = false; setStatus('Commit preview ready. The branch and worktree are unchanged.'); }
      catch (error) { setStatus(error.message, 'error'); }
      finally { state.busy = false; reviewCommitButton.disabled = false; }
    }

    async function createCommit() {
      if (!state.commitReview) return;
      state.busy = true;
      commitConfirm.disabled = true;
      try { const result = await request('/commit', { token: state.commitReview.token, message: state.commitReview.message }); state.commitReview = null; commitReview.hidden = true; await refresh(); setStatus(`Local commit created at ${result.commitOid.slice(0, 12)}. No hooks or signing were run.`); }
      catch (error) { state.commitReview = null; commitReview.hidden = true; setStatus(error.message, 'error'); }
      finally { state.busy = false; commitConfirm.disabled = false; }
    }

    async function reviewPullRequest() {
      state.busy = true;
      reviewPr.disabled = true;
      try { state.prReview = await request('/pr/review', { head: head.value.trim(), base: base.value.trim(), title: title.value.trim(), body: body.value }); prSummary.textContent = `${state.prReview.remote.repository}: ${state.prReview.head.ref} ${state.prReview.head.oid.slice(0, 12)} → ${state.prReview.base.ref} ${state.prReview.base.oid.slice(0, 12)}. Remote preflight still runs only when Publish is pressed.`; prReview.hidden = false; publishPr.disabled = !state.prReview.canPublish; setStatus('Pull-request review is ready. Nothing was pushed or published.'); }
      catch (error) { state.prReview = null; prReview.hidden = true; publishPr.disabled = true; setStatus(error.message, 'error'); }
      finally { state.busy = false; reviewPr.disabled = false; }
    }

    async function publishPullRequest() {
      if (!state.prReview) return;
      state.busy = true;
      publishPr.disabled = true;
      try { const result = await request('/pr/publish', { token: state.prReview.token }); state.prReview = null; prReview.hidden = true; setStatus(result.url ? `Pull request created: ${result.url}` : 'Pull request created. No push was performed.'); }
      catch (error) { state.prReview = null; prReview.hidden = true; setStatus(error.message, 'error'); }
      finally { state.busy = false; }
    }

    configure.addEventListener('submit', configureRepository);
    selectAll.addEventListener('change', () => { for (const entry of state.snapshot?.status?.entries || []) { if (selectAll.checked) state.selected.add(entry.path); else state.selected.delete(entry.path); } renderFiles(); });
    reviewStage.addEventListener('click', () => reviewPatch('stage'));
    reviewUnstage.addEventListener('click', () => reviewPatch('unstage'));
    applyPatch.addEventListener('click', applyReviewedPatch);
    cancelPatch.addEventListener('click', () => { state.review = null; patchReview.hidden = true; setStatus('Patch review cancelled.'); });
    reviewCommitButton.addEventListener('click', reviewCommitAction);
    commitConfirm.addEventListener('click', createCommit);
    commitCancel.addEventListener('click', () => { state.commitReview = null; commitReview.hidden = true; setStatus('Commit review cancelled.'); });
    reviewPr.addEventListener('click', reviewPullRequest);
    publishPr.addEventListener('click', publishPullRequest);
    refresh();
    return { refresh, state };
  }

  globalThis.AvenGitWorkspace = Object.freeze({ mount });
})();
