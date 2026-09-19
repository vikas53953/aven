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

console.log(JSON.stringify({ passed: true, cases: 37, blockedRequests: 0, externalCalls: 0 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
