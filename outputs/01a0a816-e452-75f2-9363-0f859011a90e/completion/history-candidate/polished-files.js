(() => {
  'use strict';

  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_DIRECTORY_ITEMS = 200;
  const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.log', '.yaml', '.yml', '.xml', '.ini', '.cfg', '.conf', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.py', '.ps1', '.sh']);

  const create = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const makeButton = (label, className, action) => {
    const node = create('button', className, label);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  };
  const valueOf = (value) => typeof value === 'string' ? value : value == null ? '' : String(value);
  const extensionOf = (name) => {
    const value = valueOf(name);
    const dot = value.lastIndexOf('.');
    return dot < 0 ? '' : value.slice(dot).toLowerCase();
  };
  const isTextFile = (name) => TEXT_EXTENSIONS.has(extensionOf(name));
  const isAbort = (error) => error?.name === 'AbortError';
  const sameNumber = (left, right) => Number(left) === Number(right);

  const bytesToHex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const sha256 = async (bytes) => bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
  const encodeText = (text) => new TextEncoder().encode(valueOf(text));
  const hashText = (text) => sha256(encodeText(text));
  const decodeText = (bytes) => {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      throw new Error('The file is not valid UTF-8 text.');
    }
    if (text.includes('\u0000')) throw new Error('The file contains a NUL byte and cannot be opened as text.');
    return text;
  };

  function render(container, options = {}) {
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('A DOM container is required.');
    const opts = options && typeof options === 'object' ? options : {};
    let destroyed = false;
    let rootHandle = null;
    let trail = [];
    let entries = [];
    let listingState = 'idle';
    let listingNotice = '';
    let selected = null;
    let originalText = '';
    let originalHash = '';
    let originalSize = 0;
    let originalMtime = 0;
    let draft = '';
    let reviewToken = null;
    let generation = 0;
    let listGeneration = 0;
    let operation = '';
    let statusText = '';
    let pendingFocusKey = '';

    container.classList.add('aven-files');

    const currentDirectory = () => trail.at(-1)?.handle || null;
    const relativeDirectory = () => trail.slice(1).map((part) => valueOf(part.name));
    const relativePath = (fileName) => [...relativeDirectory(), valueOf(fileName)].join('/');
    const dirty = () => Boolean(selected && draft !== originalText);
    const notifyStatus = (message) => {
      statusText = valueOf(message);
      const status = container.querySelector('[data-aven-files-status]');
      if (status) status.textContent = statusText;
      try { opts.onStatus?.(statusText); } catch (_) { /* Status reporting must not break the file session. */ }
    };
    const clearSelectionState = () => {
      selected = null; originalText = ''; originalHash = ''; originalSize = 0; originalMtime = 0; draft = ''; reviewToken = null;
    };
    const confirmDiscard = () => {
      if (!dirty()) return true;
      let accepted = false;
      try { accepted = window.confirm('Discard this unsaved file draft?'); } catch (_) { accepted = false; }
      if (!accepted) notifyStatus('Unsaved changes kept.');
      return accepted;
    };
    const invalidateDraftReview = (message) => {
      generation += 1;
      reviewToken = null;
      if (message) notifyStatus(message);
      refreshReviewSlot();
    };
    const setPendingFocus = (key) => { pendingFocusKey = key || ''; };
    const focusAfterRender = () => {
      if (!pendingFocusKey) return;
      const key = pendingFocusKey;
      pendingFocusKey = '';
      [...container.querySelectorAll('[data-aven-focus-key]')].find((node) => node.dataset.avenFocusKey === key)?.focus();
    };
    const controlsDisabled = () => Boolean(operation);

    const readSnapshot = async (fileHandle) => {
      const file = await fileHandle.getFile();
      const declaredSize = Number(file.size);
      if (!Number.isFinite(declaredSize) || declaredSize > MAX_FILE_BYTES) throw new Error('This text file is larger than 1 MiB.');
      const raw = await file.arrayBuffer();
      const bytes = new Uint8Array(raw);
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('This text file is larger than 1 MiB.');
      const text = decodeText(bytes);
      return { bytes, text, hash: await sha256(bytes), size: bytes.byteLength, mtime: Number(file.lastModified) || 0 };
    };
    const currentReview = (token, expectedDraft) => Boolean(
      reviewToken === token &&
      generation === token.generation &&
      selected?.handle === token.fileHandle &&
      currentDirectory() === token.directoryHandle &&
      selected?.path === token.relativePath &&
      draft === expectedDraft,
    );

    const saveReviewedFile = async () => {
      if (operation) return;
      const token = reviewToken;
      const expectedDraft = draft;
      if (!token || !currentReview(token, expectedDraft)) {
        notifyStatus('Review is required again before saving.');
        refreshReviewSlot();
        return;
      }
      if (expectedDraft.includes('\u0000')) {
        notifyStatus('The draft contains a NUL byte and cannot be saved as text.');
        return;
      }
      operation = 'save';
      notifyStatus('Checking the file before saving…');
      renderView();
      let writable = null;
      try {
        const before = await readSnapshot(token.fileHandle);
        if (!currentReview(token, expectedDraft)) throw new Error('The draft changed while the file was being checked. Review again.');
        if (before.hash !== token.originalHash || !sameNumber(before.mtime, token.originalMtime) || before.size !== token.originalSize) {
          reviewToken = null;
          notifyStatus('Save conflict: the file changed externally. No overwrite was made; review the current file again.');
          return;
        }
        const permission = await token.fileHandle.requestPermission({ mode: 'readwrite' });
        if (!currentReview(token, expectedDraft)) throw new Error('The draft changed while permission was requested. Review again.');
        if (permission !== 'granted') {
          notifyStatus('Write permission was denied. The draft is kept.');
          return;
        }
        writable = await token.fileHandle.createWritable();
        if (!currentReview(token, expectedDraft)) throw new Error('The draft changed before the write. Review again.');
        const output = encodeText(expectedDraft);
        await writable.write(output);
        if (!currentReview(token, expectedDraft)) {
          try { await writable.abort?.(); } catch (_) { /* Best effort only; the draft remains local. */ }
          writable = null;
          throw new Error('The draft changed during the write. The save was cancelled.');
        }
        await writable.close();
        writable = null;
        const after = await readSnapshot(token.fileHandle);
        if (!currentReview(token, expectedDraft)) throw new Error('The draft changed before the save could be verified.');
        const outputHash = await sha256(output);
        if (after.hash !== outputHash || after.size !== output.byteLength) {
          reviewToken = null;
          notifyStatus('Save not verified: the file bytes after writing did not match the reviewed draft. The draft is kept.');
          return;
        }
        originalText = expectedDraft;
        originalHash = after.hash;
        originalSize = after.size;
        originalMtime = after.mtime;
        draft = expectedDraft;
        reviewToken = null;
        generation += 1;
        setPendingFocus(`file-${selected.index}`);
        notifyStatus('File saved and verified locally.');
      } catch (error) {
        if (writable) { try { await writable.abort?.(); } catch (_) { /* Best effort only. */ } }
        reviewToken = null;
        notifyStatus(`Save not verified: ${error?.message || 'the write failed'}. The draft is kept.`);
      } finally {
        operation = '';
        renderView();
      }
    };

    const reviewChanges = async () => {
      if (operation || !selected) return;
      if (draft.includes('\u0000')) { notifyStatus('The draft contains a NUL byte and cannot be reviewed as text.'); return; }
      operation = 'review';
      notifyStatus('Reading the current file for review…');
      renderView();
      const reviewGeneration = generation;
      const handle = selected.handle;
      const path = selected.path;
      try {
        const snapshot = await readSnapshot(handle);
        const draftHash = await hashText(draft);
        if (generation !== reviewGeneration || selected?.handle !== handle || selected?.path !== path) {
          notifyStatus('Review expired because the selected file changed.');
          return;
        }
        originalText = snapshot.text;
        originalHash = snapshot.hash;
        originalSize = snapshot.size;
        originalMtime = snapshot.mtime;
        reviewToken = {
          generation: reviewGeneration,
          directoryHandle: currentDirectory(),
          fileHandle: handle,
          relativePath: path,
          originalHash: snapshot.hash,
          originalMtime: snapshot.mtime,
          originalSize: snapshot.size,
          draftSha256: draftHash,
        };
        notifyStatus('Review ready. Confirm the full before and after text before saving.');
      } catch (error) {
        reviewToken = null;
        notifyStatus(error?.message || 'Could not read the file for review.');
      } finally {
        operation = '';
        renderView();
      }
    };

    const selectFile = async (entry) => {
      if (operation) return;
      if (!confirmDiscard()) return;
      generation += 1;
      clearSelectionState();
      selected = { handle: entry.handle, name: valueOf(entry.name), path: relativePath(entry.name), index: entry.index };
      notifyStatus(`Reading ${selected.path}…`);
      renderView();
      const selectionGeneration = generation;
      try {
        const snapshot = await readSnapshot(entry.handle);
        if (generation !== selectionGeneration || selected?.handle !== entry.handle) return;
        originalText = snapshot.text;
        originalHash = snapshot.hash;
        originalSize = snapshot.size;
        originalMtime = snapshot.mtime;
        draft = snapshot.text;
        notifyStatus(`Loaded ${selected.path}.`);
      } catch (error) {
        if (generation === selectionGeneration && selected?.handle === entry.handle) {
          clearSelectionState();
          notifyStatus(error?.message || 'Could not open this file as text.');
        }
      } finally {
        if (!destroyed) renderView();
      }
    };

    const loadDirectory = async (directory) => {
      const requestGeneration = ++listGeneration;
      listingState = 'loading';
      listingNotice = '';
      notifyStatus(`Reading ${valueOf(directory.name) || 'folder'}…`);
      renderView();
      try {
        const found = [];
        let truncated = false;
        for await (const entry of directory.values()) {
          if (found.length >= MAX_DIRECTORY_ITEMS) { truncated = true; break; }
          if (!entry || !valueOf(entry.name)) continue;
          found.push({ handle: entry, name: valueOf(entry.name), kind: entry.kind === 'directory' ? 'directory' : 'file', index: found.length });
        }
        if (requestGeneration !== listGeneration || currentDirectory() !== directory) return;
        found.sort((left, right) => (left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1));
        entries = found;
        listingNotice = truncated ? `Showing the first ${MAX_DIRECTORY_ITEMS} items in this folder.` : '';
        listingState = 'ready';
        notifyStatus(`${found.length} item${found.length === 1 ? '' : 's'} in ${valueOf(directory.name) || 'folder'}.`);
      } catch (error) {
        if (requestGeneration !== listGeneration) return;
        entries = [];
        listingState = 'error';
        listingNotice = '';
        notifyStatus(error?.message || 'Could not read this folder.');
      } finally {
        if (!destroyed && requestGeneration === listGeneration) renderView();
      }
    };

    const navigateTrail = async (nextTrail) => {
      if (operation || !nextTrail.length || !confirmDiscard()) return;
      generation += 1;
      clearSelectionState();
      trail = nextTrail;
      entries = [];
      await loadDirectory(currentDirectory());
    };

    const pickFolder = async () => {
      if (operation) return;
      if (typeof window.showDirectoryPicker !== 'function') {
        rootHandle = null; trail = []; entries = []; clearSelectionState(); generation += 1; listingState = 'idle';
        notifyStatus('Folder access is not supported in this browser. Local file state was cleared.');
        renderView();
        return;
      }
      if (!confirmDiscard()) return;
      operation = 'pick';
      notifyStatus('Choose a folder to read for this session.');
      renderView();
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        rootHandle = handle;
        trail = [{ handle, name: valueOf(handle.name) || 'Selected folder' }];
        generation += 1;
        clearSelectionState();
        entries = [];
        listingState = 'idle';
      } catch (error) {
        if (!isAbort(error)) notifyStatus(error?.message || 'Could not choose that folder.');
      } finally {
        operation = '';
        if (rootHandle) await loadDirectory(currentDirectory());
        else renderView();
      }
    };

    const renderStatus = () => {
      const node = create('p', 'aven-files-status', statusText);
      node.dataset.avenFilesStatus = 'true';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      return node;
    };
    const renderBreadcrumbs = () => {
      const nav = create('nav', 'aven-files-breadcrumbs');
      nav.setAttribute('aria-label', 'Current folder');
      trail.forEach((part, index) => {
        const crumb = makeButton(valueOf(part.name), 'aven-files-breadcrumb', () => navigateTrail(trail.slice(0, index + 1)));
        crumb.disabled = controlsDisabled() || index === trail.length - 1;
        crumb.dataset.avenFocusKey = `breadcrumb-${index}`;
        nav.append(crumb);
        if (index < trail.length - 1) nav.append(create('span', 'aven-files-breadcrumb-separator', '/'));
      });
      if (trail.length > 1) {
        const up = makeButton('Up', 'button-secondary aven-files-up', () => navigateTrail(trail.slice(0, -1)));
        up.disabled = controlsDisabled(); up.setAttribute('aria-label', 'Go up one folder'); nav.append(up);
      }
      return nav;
    };
    const renderDirectoryList = () => {
      const section = create('section', 'aven-files-directory-section');
      section.append(create('h3', '', 'Current folder'));
      if (listingState === 'loading') { section.append(create('p', 'aven-files-empty', 'Reading folder…')); return section; }
      if (listingState === 'error') { section.append(create('p', 'aven-files-empty', 'This folder could not be read. Choose another folder or try again.')); return section; }
      if (!entries.length) { section.append(create('p', 'aven-files-empty', 'This folder has no entries. Choose a text file from another folder.')); return section; }
      const list = create('div', 'aven-files-list');
      entries.forEach((entry) => {
        const row = create('div', `aven-files-entry ${entry.kind === 'directory' ? 'is-directory' : 'is-file'}`);
        if (entry.kind === 'directory') {
          const open = makeButton(`Open folder ${entry.name}`, 'aven-files-entry-button', () => navigateTrail([...trail, { handle: entry.handle, name: entry.name }]));
          open.dataset.avenFocusKey = `entry-${entry.index}`; open.disabled = controlsDisabled(); row.append(open, create('span', 'aven-files-entry-meta', 'Folder'));
        } else if (isTextFile(entry.name)) {
          const select = makeButton(`Select ${entry.name}`, 'aven-files-entry-button', () => selectFile(entry));
          select.dataset.avenFocusKey = `file-${entry.index}`; select.disabled = controlsDisabled(); row.append(select, create('span', 'aven-files-entry-meta', extensionOf(entry.name)));
        } else {
          row.append(create('span', 'aven-files-entry-name', entry.name), create('span', 'aven-files-entry-meta', 'Unsupported file type'));
        }
        list.append(row);
      });
      section.append(list);
      if (listingNotice) section.append(create('p', 'aven-files-help', listingNotice));
      return section;
    };

    const refreshReviewSlot = () => {
      const slot = container.querySelector('[data-aven-review-slot]');
      if (!slot) return;
      slot.replaceChildren(reviewToken ? renderReviewPanel() : create('p', 'aven-files-help', 'Review is required before saving.'));
      const save = slot.querySelector('[data-aven-save]');
      if (save) save.disabled = controlsDisabled() || !reviewToken;
    };
    const renderReviewPanel = () => {
      const panel = create('section', 'aven-files-review');
      panel.setAttribute('aria-label', 'Review file changes');
      panel.append(create('h3', '', 'Review changes'));
      panel.append(create('p', 'aven-files-review-path', `Relative path: ${selected?.path || ''}`));
      const compare = create('div', 'aven-files-compare');
      const before = create('section', 'aven-files-compare-pane'); before.append(create('h4', '', 'Before')); const beforeText = create('pre', '', originalText); before.append(beforeText);
      const after = create('section', 'aven-files-compare-pane'); after.append(create('h4', '', 'After')); const afterText = create('pre', '', draft); after.append(afterText);
      compare.append(before, after); panel.append(compare);
      const meta = create('p', 'aven-files-help', `Original SHA-256: ${reviewToken?.originalHash || ''} · Draft SHA-256: ${reviewToken?.draftSha256 || ''}`); panel.append(meta);
      const actions = create('div', 'aven-files-actions');
      const save = makeButton('Save reviewed file', 'button-primary', saveReviewedFile); save.dataset.avenSave = 'true'; save.disabled = controlsDisabled() || !reviewToken; actions.append(save); panel.append(actions);
      return panel;
    };
    const renderEditor = () => {
      if (!selected) return null;
      const section = create('section', 'aven-files-editor');
      section.append(create('h3', '', 'Draft')); section.append(create('p', 'aven-files-review-path', `Relative path: ${selected.path}`));
      const textarea = create('textarea', '', draft); textarea.id = 'aven-file-draft'; textarea.setAttribute('aria-label', `Draft contents for ${selected.path}`); textarea.spellcheck = false; textarea.disabled = operation === 'save';
      textarea.addEventListener('input', () => {
        draft = textarea.value;
        invalidateDraftReview('Review required after edits.');
        const current = container.querySelector('[data-aven-save]'); if (current) current.disabled = true;
      });
      section.append(textarea);
      const actions = create('div', 'aven-files-actions');
      const review = makeButton('Review changes', 'button-secondary', reviewChanges); review.disabled = controlsDisabled(); review.dataset.avenFocusKey = 'review'; actions.append(review);
      const reload = makeButton('Discard draft', 'button-quiet', () => { if (!confirmDiscard()) return; draft = originalText; generation += 1; reviewToken = null; notifyStatus('Draft discarded.'); renderView(); }); reload.disabled = controlsDisabled() || !dirty(); actions.append(reload);
      section.append(actions);
      const slot = create('div', 'aven-files-review-slot'); slot.dataset.avenReviewSlot = 'true'; slot.append(reviewToken ? renderReviewPanel() : create('p', 'aven-files-help', 'Review is required before saving.')); section.append(slot);
      return section;
    };
    const renderView = () => {
      if (destroyed) return;
      container.replaceChildren();
      const view = create('section', 'aven-files-view');
      const header = create('header', 'aven-files-header');
      const heading = create('div', 'aven-files-heading'); heading.append(create('p', 'aven-files-eyebrow', 'LOCAL FILES')); heading.append(create('h2', '', 'Open a file for review')); heading.append(create('p', 'aven-files-description', 'Read a text file from a folder chosen for this session. Writes require an explicit review and a second permission check.')); header.append(heading);
      const choose = makeButton(rootHandle ? 'Choose another folder' : 'Choose folder', 'button-primary', pickFolder); choose.disabled = controlsDisabled(); choose.dataset.avenFocusKey = 'choose-folder'; header.append(choose); view.append(header, renderBreadcrumbs());
      if (!rootHandle) view.append(create('p', 'aven-files-empty', typeof window.showDirectoryPicker === 'function' ? 'No folder is open. Choose a folder to list its immediate contents.' : 'Folder access is not supported in this browser. Local file state is clear.'));
      else { view.append(renderDirectoryList()); const editor = renderEditor(); if (editor) view.append(editor); }
      view.append(create('p', 'aven-files-help', 'Only these extensions can be opened: .txt, .md, .csv, .json, .log, .yaml, .yml, .xml, .ini, .cfg, .conf, .js, .cjs, .mjs, .ts, .tsx, .jsx, .css, .html, .py, .ps1, .sh. Files are limited to 1 MiB and must be valid UTF-8 without NUL bytes.'));
      container.append(renderStatus(), view);
      focusAfterRender();
    };

    const api = {
      hasUnsavedChanges: () => dirty() || Boolean(operation),
      isBusy: () => Boolean(operation),
      destroy: () => {
        if (operation) {
          notifyStatus('A file operation is in progress. Wait for it to finish before leaving this pane.');
          return false;
        }
        destroyed = true;
        container.replaceChildren();
        return true;
      },
    };
    renderView();
    return api;
  }

  globalThis.AvenFiles = Object.freeze({ render, MAX_FILE_BYTES, MAX_DIRECTORY_ITEMS, TEXT_EXTENSIONS: Object.freeze([...TEXT_EXTENSIONS]) });
})();
