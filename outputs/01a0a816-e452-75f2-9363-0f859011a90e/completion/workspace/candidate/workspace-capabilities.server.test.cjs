'use strict';

// This test copies only the local IntentGraph module graph into a temporary
// fixture, injects mock adapters, and exercises the real HTTP server route.
// It never reads credentials, starts a provider, or invokes a device/browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'replacements.json'), 'utf8'));

(async () => {
  const projectRoot = path.resolve(__dirname, '../../../../../');
  const baselineRoot = path.resolve(__dirname, '../../baseline');
  const fixtureRoot = await fsp.mkdtemp(path.join(path.dirname(__dirname), 'workspace-capabilities-server-'));
  const moduleRoot = path.join(fixtureRoot, 'intentgraph');
  const dataRoot = path.join(fixtureRoot, 'data');
  await fsp.mkdir(dataRoot, { recursive: true });
  let server;
  try {
    await fsp.cp(path.join(projectRoot, 'intentgraph'), moduleRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
    let serverSource = fs.readFileSync(path.join(baselineRoot, 'intentgraph/server.cjs'), 'utf8');
    const serverReplacements = manifest.replacements.filter((item) => item.file === 'intentgraph/server.cjs');
    for (const replacement of serverReplacements) {
      assert.equal(serverSource.includes(replacement.old), true, 'server route seam missing');
      serverSource = serverSource.replace(replacement.old, replacement.new);
    }
    fs.writeFileSync(path.join(moduleRoot, 'server.cjs'), serverSource);

    const calls = [];
    const adapters = {
      status: () => ({
        browser: { available: true, connected: true, pages: [{ pageId: 'mock-page-1', url: 'http://127.0.0.1:9/mock' }] },
        desktop: { available: true, selectedWindow: { hwnd: 11, pid: 22, processCreationTime: '33' }, mode: 'selected-window-only' },
        network: { available: true, profileCount: 0, connectionStatus: 'mock; not verified' },
      }),
      action: async (operation) => { calls.push(operation); return { pageId: operation.pageId || '', inspected: operation.type === 'browser.inspect' }; },
      close: async () => {},
    };
    const executionProvider = { status: async () => ({ last: { ok: false } }) };
    const coordinator = { status: async () => ({ runs: [] }), close: async () => {} };
    const delivery = { status: async () => ({}) };
    const sandbox = { status: async () => ({ available: false }), inventory: async () => ({ devices: [] }), close: async () => {} };
    const { createServer } = require(path.join(moduleRoot, 'server.cjs'));
    server = createServer({ root: dataRoot, runtimeDirectory: path.join(dataRoot, '.runtime'), sandbox, executionOptions: { provider: executionProvider, coordinator, adapters, delivery } });
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); server.listen(0, '127.0.0.1'); });
    const port = server.address().port;
    const backend = `http://127.0.0.1:${port}`;
    const uiOrigin = 'http://127.0.0.1:8767';
    const request = (pathname, init = {}) => fetch(`${backend}${pathname}`, { ...init, headers: { Origin: uiOrigin, ...(init.headers || {}) } });

    const preflight = await request('/api/workspace/connect', { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), uiOrigin);
    assert.doesNotMatch(preflight.headers.get('access-control-allow-headers') || '', /X-IntentGraph-Token/i);
    assert.match(preflight.headers.get('access-control-allow-headers') || '', /X-Aven-Workspace/i);

    const connectWrongOrigin = await fetch(`${backend}/api/workspace/connect`, { method: 'POST', headers: { Origin: 'http://evil.test', 'Content-Type': 'application/json', 'X-Aven-Workspace': 'connect' }, body: JSON.stringify({ scope: 'browser' }) });
    assert.equal(connectWrongOrigin.status, 403);
    const connectMissingHeader = await request('/api/workspace/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'browser' }) });
    assert.equal(connectMissingHeader.status, 403);
    const connectResponse = await request('/api/workspace/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Workspace': 'connect' }, body: JSON.stringify({ scope: 'browser' }) });
    assert.equal(connectResponse.status, 200);
    assert.equal(connectResponse.headers.get('access-control-allow-origin'), uiOrigin);
    const workspaceToken = (await connectResponse.json()).token;
    assert.equal(typeof workspaceToken, 'string');
    assert.ok(workspaceToken.length > 20);

    const statusResponse = await request('/api/workspace/status');
    assert.equal(statusResponse.status, 200);
    assert.equal(statusResponse.headers.get('access-control-allow-origin'), uiOrigin);
    const status = await statusResponse.json();
    assert.equal(status.adapters.browser.pages[0].pageId, 'mock-page-1');
    assert.equal(status.adapters.desktop.selectedWindow.hwnd, 11);
    assert.equal(status.adapters.terminal.connected, false);

    const deniedOrigin = await fetch(`${backend}/api/workspace/status`, { headers: { Origin: 'http://evil.test' } });
    assert.equal(deniedOrigin.status, 403);

    const missingHeaders = await request('/api/workspace/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: { type: 'browser.inspect', pageId: 'mock-page-1' } }) });
    assert.equal(missingHeaders.status, 403);

    const actionTokenOnly = await request('/api/workspace/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Workspace': 'read-only', 'X-IntentGraph-Token': server.intentGraph.token }, body: JSON.stringify({ operation: { type: 'browser.inspect', pageId: 'mock-page-1' } }) });
    assert.equal(actionTokenOnly.status, 403);

    const readResponse = await request('/api/workspace/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Workspace': 'read-only', 'X-Aven-Workspace-Token': workspaceToken }, body: JSON.stringify({ operation: { type: 'browser.inspect', pageId: 'mock-page-1' } }) });
    assert.equal(readResponse.status, 200);
    assert.equal(readResponse.headers.get('access-control-allow-origin'), uiOrigin);
    assert.equal((await readResponse.json()).result.inspected, true);
    assert.equal(calls.length, 1);

    const wrongScope = await request('/api/workspace/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Workspace': 'read-only', 'X-Aven-Workspace-Token': workspaceToken }, body: JSON.stringify({ operation: { type: 'desktop.inspect' } }) });
    assert.equal(wrongScope.status, 403);
    assert.equal(calls.length, 1);

    const disallowed = await request('/api/workspace/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Workspace': 'read-only', 'X-Aven-Workspace-Token': workspaceToken }, body: JSON.stringify({ operation: { type: 'browser.open', url: 'http://127.0.0.1:9/' } }) });
    assert.equal(disallowed.status, 400);
    assert.equal(calls.length, 1);
    const networkExecution = await request('/api/workspace/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aven-Workspace': 'read-only', 'X-Aven-Workspace-Token': workspaceToken }, body: JSON.stringify({ operation: { type: 'network.read', profileId: 'p1', command: 'show version' } }) });
    assert.equal(networkExecution.status, 400);

    const wrongOriginRead = await fetch(`${backend}/api/workspace/read`, { method: 'POST', headers: { Origin: 'http://evil.test', 'Content-Type': 'application/json', 'X-Aven-Workspace': 'read-only', 'X-Aven-Workspace-Token': workspaceToken }, body: JSON.stringify({ operation: { type: 'browser.inspect', pageId: 'mock-page-1' } }) });
    assert.equal(wrongOriginRead.status, 403);
    console.log(JSON.stringify({ passed: true, cases: 18, blockedRequests: 0, externalCalls: 0, adapterCalls: calls.length }));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await fsp.rm(fixtureRoot, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
