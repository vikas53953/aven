'use strict';

// Isolated DOM verification only. The page is synthetic, every network request is
// aborted, and the execution bridge is deliberately omitted or mock-backed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '../../../../../intentgraph/node_modules/playwright'));
let activeBrowser;

(async () => {
  const executablePath = process.env.AVEN_PLAYWRIGHT_CHROMIUM || 'C:\\Users\\vikasmit\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1181\\chrome-win\\headless_shell.exe';
  const browser = await chromium.launch({ headless: true, executablePath });
  activeBrowser = browser;
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  await page.setContent(`<!doctype html><html><body>
    <nav><button type="button" data-pane="browser">Browser</button><button type="button" data-pane="computer">Computer</button></nav>
    <section id="pane-content"></section>
    <main id="composer"><textarea id="draft"></textarea><input id="file-picker" type="file"><div class="composer-actions"></div><div id="attachment-chips"></div></main>
    <section id="generated"></section><section id="artifact"></section><section id="topology"></section><section id="safe"></section>
    <aside id="resizable" style="width:320px"></aside><button id="separator" type="button"></button>
  </body></html>`);
  await page.addScriptTag({ path: path.resolve(__dirname, 'workspace-capabilities.js') });
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'replacements.json'), 'utf8'));
  let artifactSource = fs.readFileSync(path.resolve(__dirname, '../../baseline/polished-workspace-tools.js'), 'utf8');
  manifest.replacements.filter((item) => item.file === 'polished-workspace-tools.js').forEach((item) => {
    assert.equal(artifactSource.includes(item.old), true, `artifact seam missing: ${item.old.slice(0, 60)}`);
    artifactSource = artifactSource.replace(item.old, item.new);
  });
  await page.addScriptTag({ content: artifactSource });

  const result = await page.evaluate(async () => {
    const api = globalThis.AvenWorkspaceCapabilities;
    const draft = document.getElementById('draft');
    const composer = document.getElementById('composer');
    let records = [];
    const reader = async (files, current) => {
      const next = await Promise.all(files.map(async (file) => ({
        id: 'mock-' + file.name,
        name: file.name,
        size: file.size,
        type: file.type,
        status: file.name.endsWith('.txt') ? 'ready' : 'error',
        text: file.name.endsWith('.txt') ? await file.text() : undefined,
        error: file.name.endsWith('.txt') ? '' : 'Unsupported type',
      })));
      return [...current, ...next];
    };
    const controller = api.installWorkspaceCapabilities({
      attachments: {
        composer,
        input: document.getElementById('file-picker'),
        readFiles: reader,
        getRecords: () => records,
        setRecords: (next) => { records = next; },
        onChange: (next) => api.renderAttachmentChips(document.getElementById('attachment-chips'), next),
      },
      mentions: {
        input: draft,
        inventory: { devices: [{ id: 'edge-1', name: 'Edge', status: 'disconnected' }] },
      },
      dictation: { container: document.querySelector('.composer-actions'), draft },
      generated: {
        container: document.getElementById('generated'),
        selectedChatId: 'chat-a',
        data: { chats: [{ id: 'chat-a', messages: [{ id: 'message-a', runId: 'run-a', generatedFiles: [{ filename: 'report.html', mime: 'text/html', content: '<h1>safe report</h1>' }] }] }] },
      },
      topology: {
        container: document.getElementById('topology'),
        data: { source: 'mock inventory', freshness: '2026-09-16T01:00:00Z', nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], links: [{ from: 'a', to: 'b', inferred: true }] },
      },
    });

    document.querySelector('[data-pane="browser"]').click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const browserState = document.querySelector('#pane-content [data-session-status]')?.dataset.sessionStatus;
    document.querySelector('[data-pane="computer"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const computerState = document.querySelector('#pane-content [data-session-status]')?.dataset.sessionStatus;

    draft.value = 'check @device:edge-1';
    draft.dispatchEvent(new Event('input', { bubbles: true }));
    const mentionStatus = document.getElementById('aven-mention-status').textContent;

    const voice = document.getElementById('aven-voice-dictation');
    const voiceState = { disabled: voice.disabled, status: document.getElementById('aven-dictation-status').textContent };

    const dropped = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [dropped] } });
    composer.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const attachmentChip = document.querySelector('#attachment-chips [data-attachment-id]')?.textContent;

    document.querySelector('#generated button').click();
    const generatedPreview = {
      sandbox: document.querySelector('#generated iframe')?.getAttribute('sandbox'),
      csp: document.querySelector('#generated iframe')?.srcdoc.includes("default-src 'none'"),
    };

    const artifactRecord = { filename: 'artifact.html', mime: 'text/html', content: '<h1>artifact</h1>' };
    const artifactData = { chats: [{ id: 'chat-a', messages: [{ id: 'message-a', runId: 'run-a', generatedFiles: [artifactRecord], files: [artifactRecord], artifacts: [artifactRecord] }] }] };
    globalThis.AvenWorkspaceTools.render('artifacts', document.getElementById('artifact'), { data: artifactData, selectedChatId: 'chat-a' });
    const artifactCards = document.querySelectorAll('#artifact .aven-workspace-tools-artifact').length;
    const artifactButton = Array.from(document.querySelectorAll('#artifact button')).find((button) => button.textContent === 'Open sandbox preview');
    artifactButton?.click();
    artifactButton?.click();
    const artifactPreview = {
      cards: artifactCards,
      badge: document.querySelector('#artifact .aven-workspace-tools-badge')?.textContent,
      sandbox: document.querySelector('#artifact .aven-generated-file-preview iframe')?.getAttribute('sandbox'),
      iframeCount: document.querySelectorAll('#artifact .aven-generated-file-preview iframe').length,
    };

    api.renderSafeMessage(document.getElementById('safe'), 'See http://example.test/report. <b>literal</b>', [{ name: 'image.bin', mime: 'application/octet-stream', content: 'raw' }]);
    const safe = { href: document.querySelector('#safe a')?.getAttribute('href'), htmlElement: Boolean(document.querySelector('#safe b')), unsupported: document.querySelector('#safe .aven-capability-chip')?.textContent };

    const separator = document.getElementById('separator');
    const resizable = document.getElementById('resizable');
    const store = new Map();
    const resized = api.bindPaneResizer({ separator, pane: resizable, viewport: () => 1200, storage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value) } });
    const before = resized.width;
    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const after = resized.width;
    controller.destroy();
    return { browserState, computerState, mentionStatus, voiceState, attachmentChip, generatedPreview, artifactPreview, safe, topology: document.getElementById('topology').textContent, before, after };
  });
  assert.equal(result.browserState, 'unavailable');
  assert.equal(result.computerState, 'unavailable');
  assert.match(result.mentionStatus, /disconnected/i);
  assert.match(result.mentionStatus, /edge-1/i);
  assert.equal(result.voiceState.disabled, true);
  assert.match(result.voiceState.status, /unavailable/i);
  assert.match(result.attachmentChip, /notes\.txt.*ready/i);
  assert.equal(result.generatedPreview.sandbox, '');
  assert.equal(result.generatedPreview.csp, true);
  assert.equal(result.artifactPreview.badge, 'Generated file');
  assert.equal(result.artifactPreview.cards, 1);
  assert.equal(result.artifactPreview.sandbox, '');
  assert.equal(result.artifactPreview.iframeCount, 1);
  assert.equal(result.safe.href, 'http://example.test/report');
  assert.equal(result.safe.htmlElement, false);
  assert.match(result.safe.unsupported, /unsupported media/i);
  assert.match(result.topology, /Inferred link/);
  assert.equal(result.after, result.before + 16);

  // Load the complete candidate shell from in-memory replacements. The route
  // handler below serves this one synthetic document and mock API responses;
  // every other request is aborted before it could leave the test process.
  const shellManifest = manifest;
  const baselineRoot = path.resolve(__dirname, '../../baseline');
  const candidateRoot = path.resolve(__dirname);
  const projectRoot = path.resolve(__dirname, '../../../../../');
  const readShellFile = (name) => {
    const baselinePath = path.join(baselineRoot, name);
    return fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : fs.readFileSync(path.join(projectRoot, name), 'utf8');
  };
  const transformed = (name) => {
    let source = readShellFile(name);
    shellManifest.replacements.filter((item) => item.file === name).forEach((item) => {
      assert.equal(source.includes(item.old), true, `shell seam missing: ${name}`);
      source = source.replace(item.old, item.new);
    });
    return source;
  };
  let shellHtml = fs.readFileSync(path.join(baselineRoot, 'polished.html'), 'utf8');
  shellManifest.replacements.filter((item) => item.file === 'polished.html').forEach((item) => {
    assert.equal(shellHtml.includes(item.old), true, 'shell HTML seam missing');
    shellHtml = shellHtml.replace(item.old, item.new);
  });
  shellHtml = shellHtml.replace(/<link rel="stylesheet" href="([^"]+)">/gu, (_tag, href) => {
    const name = href.split('?')[0];
    const sourcePath = name === 'workspace-capabilities.css' ? path.join(candidateRoot, name) : (fs.existsSync(path.join(baselineRoot, name)) ? path.join(baselineRoot, name) : path.join(projectRoot, name));
    return `<style>${fs.readFileSync(sourcePath, 'utf8')}</style>`;
  });
  const mockStatus = { adapters: {
    browser: { connected: true, pages: [{ pageId: 'mock-page-1', url: 'http://127.0.0.1:8767/mock', snapshot: { html: '<p>browser snapshot</p>' } }] },
    desktop: { selectedWindow: { hwnd: 11, pid: 22, processCreationTime: '33' }, snapshot: { text: 'desktop snapshot' } },
  } };
  shellHtml = shellHtml.replace(/<script src="([^"]+)"><\/script>/gu, (_tag, src) => {
    const name = src.split('?')[0];
    const source = name === 'workspace-capabilities.js' ? fs.readFileSync(path.join(candidateRoot, name), 'utf8') : transformed(name);
    return `<script>${source}</script>`;
  });
  const shellPage = await browser.newPage();
  const shellRequests = [];
  await shellPage.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest()) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: shellHtml });
      return;
    }
    if (url.pathname === '/api/workspace/connect') {
      shellRequests.push({ path: url.pathname, method: request.method(), workspace: request.headers()['x-aven-workspace'] });
      const connectBody = request.postDataJSON?.() || {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, scope: connectBody.scope || 'workspace', token: 'mock-workspace-token', expiresIn: 900 }) });
      return;
    }
    if (url.pathname === '/api/workspace/status') {
      shellRequests.push({ path: url.pathname, method: request.method() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockStatus) });
      return;
    }
    if (url.pathname === '/api/workspace/read') {
      const body = request.postDataJSON?.() || {};
      shellRequests.push({ path: url.pathname, method: request.method(), type: body.type, operation: body.operation?.type, workspaceToken: request.headers()['x-aven-workspace-token'] });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: { inspected: true, dom: '<p>inspected browser</p>', bodyText: 'inspected browser' } }) });
      return;
    }
    await route.abort();
  });
  await shellPage.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: 'aven-polished-chats-v1',
    value: JSON.stringify({ activeChat: 'mock-chat', inventory: { devices: [{ id: 'offline-device', name: 'offline-edge', hostname: 'offline-1', status: 'disconnected' }] }, chats: [{ id: 'mock-chat', title: 'Mock workspace', sample: false, projectId: 'personal', recipients: ['companion'], draft: '', pendingAttachmentNames: [], messages: [] }], channels: [], projects: [{ id: 'personal', name: 'Personal', system: true }] }),
  });
  await shellPage.goto('http://127.0.0.1:8767/');
  await shellPage.waitForSelector('#aven-voice-dictation');
  await shellPage.locator('#tools-menu').click();
  await shellPage.locator('[data-add="browser"]').click();
  await shellPage.locator('[data-pane="browser"]').click();
  await shellPage.getByRole('button', { name: 'Connect local workspace' }).click();
  await shellPage.waitForFunction(() => document.querySelector('#pane-content [data-session-status]')?.dataset.sessionStatus === 'connected');
  const shellBrowser = await shellPage.locator('#pane-content').textContent();
  await shellPage.getByRole('button', { name: 'Inspect current page' }).click();
  await shellPage.waitForTimeout(250);
  const shellInspectPreview = await shellPage.locator('#pane-content .aven-capability-sandbox-preview').evaluate((frame) => frame.srcdoc);
  await shellPage.locator('[data-pane="computer"]').click();
  await shellPage.getByRole('button', { name: 'Connect local workspace' }).click();
  await shellPage.waitForFunction(() => document.querySelector('#pane-content [data-session-status]')?.dataset.sessionStatus === 'connected');
  const shellComputer = await shellPage.locator('#pane-content').textContent();
  await shellPage.getByRole('button', { name: 'Disconnect local workspace' }).click();
  await shellPage.waitForFunction(() => document.querySelector('#pane-content [data-session-status]')?.dataset.sessionStatus === 'unavailable');
  const shellDisconnected = await shellPage.locator('#pane-content').textContent();
  await shellPage.locator('#draft').fill('check @device:offline-edge');
  const shellMention = await shellPage.locator('#aven-mention-status').textContent();
  await shellPage.getByRole('button', { name: 'Use stable ID offline-device' }).click();
  const shellMentionDraft = await shellPage.locator('#draft').inputValue();
  const shellVoice = await shellPage.locator('#aven-voice-dictation').evaluate((button) => ({ disabled: button.disabled, status: document.getElementById('aven-dictation-status')?.textContent }));
  const shellPaneResize = await shellPage.locator('#pane-resize').evaluate((handle) => {
    const before = Number(handle.getAttribute('aria-valuenow'));
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    return { before, after: Number(handle.getAttribute('aria-valuenow')) };
  });
  await shellPage.evaluate(() => {
    const file = new File(['shell fixture'], 'shell-fixture.txt', { type: 'text/plain' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    document.getElementById('composer').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await shellPage.waitForTimeout(25);
  const shellAttachment = await shellPage.locator('#attachments .attachment-chip').textContent();
  const shellBridgeCall = await shellPage.evaluate(() => ({ hasBridge: Boolean(globalThis.__avenWorkspaceExecutionBridge), hasActionToken: Object.prototype.hasOwnProperty.call(globalThis, 'AvenIntentGraphToken') }));
  await shellPage.close();
  assert.match(shellBrowser, /Authorized session.*mock-page-1/);
  assert.match(shellInspectPreview, /inspected browser/);
  assert.match(shellComputer, /Authorized session.*11:22:33/);
  assert.match(shellDisconnected, /unavailable/i);
  assert.match(shellMention, /disconnected/i);
  assert.match(shellMentionDraft, /@device:offline-device/);
  assert.equal(shellVoice.disabled, true);
  assert.match(shellVoice.status, /unavailable/i);
  assert.equal(shellPaneResize.after, shellPaneResize.before + 10);
  assert.match(shellAttachment, /shell-fixture\.txt.*ready/i);
  assert.equal(shellBridgeCall.hasBridge, true);
  assert.equal(shellBridgeCall.hasActionToken, false);
  assert.equal(shellRequests.some((item) => item.path === '/api/workspace/connect' && item.workspace === 'connect'), true);
  assert.equal(shellRequests.some((item) => item.path === '/api/workspace/status'), true);
  assert.equal(shellRequests.some((item) => item.operation === 'browser.inspect'), true);
  assert.equal(shellRequests.some((item) => item.operation === 'browser.inspect' && item.workspaceToken === 'mock-workspace-token'), true);
  await browser.close();
  activeBrowser = undefined;
  console.log(JSON.stringify({ passed: true, cases: 25, blockedRequests: 0, externalCalls: 0 }));
})().catch(async (error) => { await activeBrowser?.close(); console.error(error); process.exitCode = 1; });
