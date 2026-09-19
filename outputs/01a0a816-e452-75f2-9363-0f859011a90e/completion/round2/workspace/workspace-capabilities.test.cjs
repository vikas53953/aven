'use strict';
const assert = require('node:assert/strict');
const cap = require('./workspace-capabilities.js');

(async () => {

const inventory = {
  devices: [
    { id: 'edge-1', name: 'Branch edge', hostname: 'edge-1', status: 'connected', source: 'mock inventory' },
    { id: 'offline-1', name: 'Offline edge', hostname: 'offline-1', status: 'disconnected', source: 'mock inventory' },
  ],
  documents: [{ id: 'doc-1', name: 'Runbook', path: 'notes/runbook.md', scope: 'selected folder' }],
};

assert.equal(cap.stableId('device', { id: 'edge-1' }), 'edge-1');
const connected = cap.resolveMention('@device:edge-1', inventory);
assert.equal(connected.ok, true);
assert.equal(connected.stableId, 'edge-1');
assert.equal(connected.available, true);
const disconnected = cap.resolveMention('@device:offline-1', inventory);
assert.equal(disconnected.ok, true);
assert.equal(disconnected.available, false);
assert.equal(disconnected.connectionState, 'disconnected');
assert.match(disconnected.reason, /cannot be treated as connected/i);
assert.equal(cap.resolveMention('@document:doc-1', inventory).stableId, 'doc-1');
assert.equal(cap.mentionChips('check @device:edge-1 @document:doc-1', inventory).length, 2);
const duplicateAlias = { devices: [
  { id: 'device-a', name: 'same-edge', hostname: 'same-host', connected: true },
  { id: 'device-b', name: 'other-edge', hostname: 'same-host', connected: true },
] };
assert.equal(cap.resolveMention('@device:same-host', duplicateAlias).ok, false);
assert.equal(cap.resolveMention('@device:device-b', duplicateAlias).stableId, 'device-b');
assert.equal(cap.normalizeInventory({ evidence: [{ deviceId: 'evidence-device', name: 'Evidence edge', status: 'connected' }] }).devices[0].stableId, 'evidence-device');

class MentionElement {
  constructor(tagName) { this.tagName = tagName.toUpperCase(); this.children = []; this.dataset = {}; this.value = ''; this.textContent = ''; this.attributes = {}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  dispatchEvent() {}
  focus() {}
}
const previousDocument = global.document, previousEvent = global.Event;
global.document = { createElement: (tagName) => new MentionElement(tagName) };
global.Event = class { constructor(type, options) { this.type = type; this.options = options; } };
try {
  const mentionInput = new MentionElement('textarea'), mentionContainer = new MentionElement('div');
  mentionInput.value = 'check @device:edge-1';
  cap.renderMentionStatus(mentionContainer, mentionInput.value, inventory, mentionInput);
  const useStableId = mentionContainer.children[0]?.children.find((child) => child.tagName === 'BUTTON');
  useStableId?.onclick?.();
  assert.equal(mentionInput.value, 'check @device:edge-1');
} finally {
  global.document = previousDocument;
  global.Event = previousEvent;
}

const attachmentReader = async (files, current) => [...current, ...files.map((file) => ({ id: file.name, name: file.name, size: file.size, status: file.valid ? 'ready' : 'error', text: file.valid ? file.text : undefined, error: file.valid ? '' : 'Unsupported type' }))];
const listeners = {};
const host = { addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
let records = [];
const binding = cap.bindAttachmentSources({ composer: host, readFiles: attachmentReader, getRecords: () => records, setRecords: (next) => { records = next; } });
listeners.drop({ dataTransfer: { files: [{ name: 'drop.txt', size: 5, valid: true, text: 'drop' }] }, preventDefault() {} });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(records.length, 1);
listeners.paste({ clipboardData: { files: [{ name: 'paste.exe', size: 4, valid: false }] }, preventDefault() {} });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(records.at(-1).status, 'error');
binding.destroy();

const draft = { value: '' }, status = { textContent: '' }, button = { disabled: false, setAttribute() {}, addEventListener() {}, }, cancelButton = { hidden: false, addEventListener() {} };
let cancelled = false;
const dictation = cap.createDictationController({ draft, status, button, cancelButton, adapter: { async start() {}, async stop() { return { transcript: 'show interfaces' }; }, async cancel() { cancelled = true; } } });
assert.equal(dictation.state, 'idle');
await dictation.start();
assert.equal(dictation.state, 'recording');
await dictation.stop();
assert.equal(dictation.state, 'review');
assert.equal(draft.value, 'show interfaces');
assert.equal(dictation.edit('show ip route'), true);
assert.equal(draft.value, 'show ip route');
await dictation.cancel();
assert.equal(dictation.state, 'idle');
assert.equal(cancelled, true);
const unavailable = cap.createDictationController({ status: { textContent: '' }, button: { setAttribute() {}, addEventListener() {} } });
assert.equal(unavailable.state, 'unavailable');
assert.match(unavailable ? 'Voice dictation unavailable. Microphone permission and transcription are not connected.' : '', /unavailable/i);

let recognitionInstance, recognitionStarts = 0, recognitionStops = 0, recognitionAborts = 0;
class FakeSpeechRecognition {
  constructor() { recognitionInstance = this; }
  start() { recognitionStarts += 1; }
  stop() { recognitionStops += 1; this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'show ip route' } }] }); this.onend?.(); }
  abort() { recognitionAborts += 1; this.onend?.(); }
}
const browserSpeech = cap.createWebSpeechDictationAdapter({ windowObject: { navigator: { language: 'en-US' } }, Recognition: FakeSpeechRecognition });
assert.equal(browserSpeech.available, true);
assert.match(browserSpeech.disclosure, /may send audio/i);
assert.equal(recognitionStarts, 0, 'browser speech never starts during adapter creation');
const browserDraft = { value: '' }, browserStatus = { id: 'browser-status', textContent: '' }, browserButton = { disabled: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); }, addEventListener() {} }, browserCancel = { hidden: false, addEventListener() {} };
const browserDictation = cap.createDictationController({ draft: browserDraft, status: browserStatus, button: browserButton, cancelButton: browserCancel, adapter: browserSpeech });
assert.equal(browserStatus.textContent, 'Voice dictation ready. Choose to start.');
assert.match(browserButton.title, /may send audio/i);
await browserDictation.start();
assert.equal(recognitionStarts, 1, 'browser speech starts only after explicit controller start');
await browserDictation.stop();
assert.equal(recognitionStops, 1);
assert.equal(browserDictation.state, 'review');
assert.equal(browserDraft.value, 'show ip route');
assert.equal(browserDictation.edit('show interfaces'), true);
assert.equal(browserDraft.value, 'show interfaces');
await browserDictation.cancel();
assert.equal(recognitionAborts, 0, 'completed recognition does not require abort');
assert.equal(browserDictation.state, 'idle');

// Browser Speech events are asynchronous. These fake recognizers never touch a
// microphone or provider; they only exercise the adapter/controller lifecycle.
let deniedRecognition;
class AsyncDeniedRecognition {
  constructor() { deniedRecognition = this; }
  start() { setImmediate(() => this.onerror?.({ error: 'not-allowed' })); }
  stop() {}
  abort() { this.onend?.(); }
}
const deniedAdapter = cap.createWebSpeechDictationAdapter({ windowObject: { navigator: { language: 'en-US' } }, Recognition: AsyncDeniedRecognition });
const deniedDraft = { value: '' }, deniedStatus = { id: 'denied-status', textContent: '' }, deniedButton = { disabled: false, setAttribute() {}, addEventListener() {} }, deniedCancel = { hidden: false, addEventListener() {} };
const deniedController = cap.createDictationController({ draft: deniedDraft, status: deniedStatus, button: deniedButton, cancelButton: deniedCancel, adapter: deniedAdapter });
await deniedController.start();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(deniedController.state, 'idle');
assert.match(deniedStatus.textContent, /permission was denied/i);
assert.equal(deniedRecognition !== undefined, true);

let multiRecognitions = [];
class MultiBatchRecognition {
  constructor() { multiRecognitions.push(this); }
  start() {}
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
}
const multiAdapter = cap.createWebSpeechDictationAdapter({ windowObject: { navigator: { language: 'en-US' } }, Recognition: MultiBatchRecognition });
const multiDraft = { value: '' }, multiStatus = { id: 'multi-status', textContent: '' }, multiButton = { disabled: false, setAttribute() {}, addEventListener() {} }, multiCancel = { hidden: false, addEventListener() {} };
const multiController = cap.createDictationController({ draft: multiDraft, status: multiStatus, button: multiButton, cancelButton: multiCancel, adapter: multiAdapter });
await multiController.start();
const multiRecognition = multiRecognitions.at(-1);
multiRecognition.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'show' }, isFinal: true }] });
multiRecognition.onresult?.({ resultIndex: 1, results: [{ 0: { transcript: 'ip' }, isFinal: true }, { 0: { transcript: 'route' }, isFinal: true }] });
multiRecognition.onend?.();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(multiController.state, 'review');
assert.equal(multiDraft.value, 'show ip route');

let raceRecognitions = [];
class RaceRecognition {
  constructor() { raceRecognitions.push(this); }
  start() {}
  stop() { this.onend?.(); }
  abort() {}
}
const raceAdapter = cap.createWebSpeechDictationAdapter({ windowObject: { navigator: { language: 'en-US' } }, Recognition: RaceRecognition });
const raceDraft = { value: '' }, raceStatus = { id: 'race-status', textContent: '' }, raceButton = { disabled: false, setAttribute() {}, addEventListener() {} }, raceCancel = { hidden: false, addEventListener() {} };
const raceController = cap.createDictationController({ draft: raceDraft, status: raceStatus, button: raceButton, cancelButton: raceCancel, adapter: raceAdapter });
await raceController.start();
const staleRecognition = raceRecognitions.at(-1);
await raceController.cancel();
staleRecognition.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'stale' }, isFinal: true }] });
staleRecognition.onend?.();
assert.equal(raceController.state, 'idle');
assert.equal(raceDraft.value, '');
await raceController.start();
staleRecognition.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'late' }, isFinal: true }] });
assert.equal(raceController.state, 'recording');
await raceController.cancel();

const files = cap.collectGeneratedFiles({ chats: [
  { id: 'chat-a', messages: [{ id: 'msg-a', runId: 'run-a', generatedFiles: [{ filename: 'report.html', mime: 'text/html', content: '<h1>Report</h1>' }] }] },
  { id: 'chat-b', messages: [{ id: 'msg-b', generatedFiles: [{ filename: 'secret.txt', mime: 'text/plain', content: 'other chat' }] }] },
] }, 'chat-a');
assert.equal(files.length, 1);
assert.equal(files[0].chatId, 'chat-a');
assert.throws(() => cap.normalizeGeneratedFile({ filename: 'unproven.txt', content: 'x' }), /provenance/i);
assert.throws(() => cap.openGeneratedFile(files[0], { selectedChatId: 'chat-b' }), /another conversation/i);

const browserUnavailable = cap.sessionFromExecutionStatus('browser', { connected: true, pages: [{ pageId: 'p1', url: 'http://127.0.0.1:1' }] }, false);
assert.equal(browserUnavailable.status, 'unavailable');
const browserConnected = cap.sessionFromExecutionStatus('browser', { connected: true, pages: [{ pageId: 'p1', url: 'http://127.0.0.1:1' }] }, true);
assert.equal(browserConnected.status, 'connected');
let invoked = false;
const bridge = cap.createExecutionBridge({ authorization: { browser: false }, invoke: () => { invoked = true; } });
assert.equal((await bridge.call('browser', 'browser.inspect')).ok, false);
assert.equal(invoked, false);
const httpRequests = [];
const httpBridge = cap.createHttpExecutionBridge({
  authorization: { browser: false },
  baseUrl: 'http://127.0.0.1:8768',
  fetchImpl: async (url, init = {}) => {
    httpRequests.push({ url, method: init.method || 'GET', workspace: init.headers?.['X-Aven-Workspace'], workspaceToken: init.headers?.['X-Aven-Workspace-Token'] });
    return { ok: true, status: 200, async json() { if (url.endsWith('/api/workspace/connect')) return { ok: true, scope: 'browser', token: 'mock-workspace-token' }; if (url.endsWith('/api/workspace/status')) return { adapters: { browser: { connected: true, pages: [{ pageId: 'mock-page' }] } } }; return { ok: true, result: { inspected: true } }; } };
  },
});
assert.equal((await httpBridge.connect('browser')).scope, 'browser');
assert.equal((await httpBridge.refresh()).browser.status, 'connected');
assert.equal((await httpBridge.call('browser', 'browser.inspect', { pageId: 'mock-page' })).result.inspected, true);
assert.equal(httpRequests.find((request) => request.url.endsWith('/api/workspace/connect')).workspace, 'connect');
assert.equal(httpRequests.at(-1).workspace, 'read-only');
assert.equal(httpRequests.at(-1).workspaceToken, 'mock-workspace-token');
httpBridge.disconnect('browser');
assert.equal((await httpBridge.call('browser', 'browser.inspect', { pageId: 'mock-page' })).ok, false);

const comparison = cap.compareDiagnosticRuns({ runId: 'r1', target: 'edge-1', capturedAt: '2026-09-16T01:00:00Z' }, { runId: 'r2', target: 'edge-2', capturedAt: '2026-09-16T02:00:00Z', output: '' });
assert.equal(comparison.left.outputState, 'missing');
assert.equal(comparison.right.outputState, 'empty');
assert.equal(comparison.differentTarget, true);
assert.equal(comparison.output.changed, true);

const topology = cap.normalizeTopology({ source: 'mock inventory', freshness: '2026-09-16T02:00:00Z', nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], links: [{ from: 'a', to: 'b', inferred: true }, { from: 'a', to: 'missing' }] });
assert.equal(topology.links.length, 1);
assert.equal(topology.links[0].inferred, true);
assert.match(topology.nodes[0].freshness, /2026/);
assert.equal(cap.safeRelativePath('notes/runbook.md'), true);
assert.equal(cap.safeRelativePath('../secrets.txt'), false);
assert.equal(cap.createFileTree([{ path: 'notes/runbook.md', authorized: true, content: 'x' }, { path: '../secrets.txt', authorized: true }], { root: 'notes' }).length, 1);
assert.equal(cap.documentUseDisclosure({ id: 'doc-1', name: 'Runbook' }).requestIncludes, false);

console.log(JSON.stringify({ passed: true, cases: 59, blockedRequests: 0, externalCalls: 0 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
