'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ExecutionAdapters } = require('./adapters/index.cjs');

function serverAt(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('browser adapter bounds origins, produces local inspection artifacts, and requires one-use approval', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-adapter-browser-'));
  const redirectTarget = await serverAt((_req, res) => { res.end('<!doctype html><title>outside</title>outside'); });
  const redirectUrl = `http://127.0.0.1:${redirectTarget.address().port}`;
  const fixture = await serverAt((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Fixture</title><label for="name">Name</label><input id="name"><button id="save">Save locally</button>');
  });
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  const chrome = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const adapters = new ExecutionAdapters({ root, runtimeDirectory: path.join(root, '.intentgraph', 'runtime'), allowedOrigins: [origin], ...(fs.existsSync(chrome) ? { browserExecutable: chrome } : {}) });
  t.after(async () => { await adapters.close(); await closeServer(fixture); await closeServer(redirectTarget); fs.rmSync(root, { recursive: true, force: true }); });
  if (!adapters.status().browser.available) return t.skip('Playwright is not installed in this environment');
  if (!fs.existsSync(chrome)) {
    try {
      const { chromium } = require('playwright');
      if (!fs.existsSync(chromium.executablePath())) return t.skip('Playwright browser executable is not installed');
    } catch {
      return t.skip('Playwright browser executable is not installed');
    }
  }

  const opened = await adapters.action({ type: 'browser.open', url: `${origin}/` });
  const inspection = await adapters.action({ type: 'browser.inspect', pageId: opened.pageId });
  assert.equal(inspection.url, opened.url);
  assert.match(inspection.dom, /Fixture/);
  assert.equal(path.dirname(inspection.screenshotPath), path.join(root, '.intentgraph', 'runtime', 'adapters'));
  assert.ok(fs.statSync(inspection.screenshotPath).isFile());

  const preview = await adapters.action({ type: 'browser.preview', pageId: opened.pageId, kind: 'fill', selector: '#name', text: 'bounded value' });
  assert.equal(preview.ttlMs, 60000);
  assert.equal(preview.detail.selector, '#name');
  const executed = await adapters.action({ type: 'browser.execute', approvalId: preview.approvalId });
  assert.equal(executed.executed, true);
  await assert.rejects(() => adapters.action({ type: 'browser.execute', approvalId: preview.approvalId }), /approval is invalid or expired/);

  await assert.rejects(() => adapters.action({ type: 'browser.open', url: `${redirectUrl}/` }), /origin is not allowed/);
  await assert.rejects(() => adapters.action({ type: 'browser.open', url: `${origin}/redirect` }), /navigation/);
});

test('desktop adapter rejects unlisted windows and reuses no approval token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-adapter-desktop-'));
  const calls = [];
  const pythonRunner = async (worker, payload) => {
    calls.push({ worker, payload });
    if (payload.operation === 'windows') return { ok: true, windows: [{ hwnd: 101, pid: 202, processCreationTime: '303', title: 'Fixture', className: 'FixtureWindow' }] };
    if (payload.operation === 'select') return { ok: true, window: payload.window };
    if (payload.operation === 'inspect') return { ok: true, controls: [], screenshotPath: path.join(root, 'outside.png') };
    if (payload.operation === 'preview') return { ok: true, detail: { kind: payload.kind, control: { controlKind: 'Button', title: 'Run' } } };
    if (payload.operation === 'execute') return { ok: true, result: { kind: payload.kind } };
    return { ok: true };
  };
  const adapters = new ExecutionAdapters({ root, runtimeDirectory: path.join(root, '.intentgraph', 'runtime'), pythonRunner });
  try {
    const listing = await adapters.action({ type: 'desktop.windows' });
    await assert.rejects(() => adapters.action({ type: 'desktop.select', hwnd: 999, pid: 202, processCreationTime: '303', title: 'Other', className: 'FixtureWindow' }), /not owned/);
    await adapters.action({ type: 'desktop.select', ...listing.windows[0] });
    await assert.rejects(() => adapters.action({ type: 'desktop.inspect' }), /malformed output/);
    const preview = await adapters.action({ type: 'desktop.preview', kind: 'click', targetControl: { controlKind: 'Button', title: 'Run' } });
    assert.equal(preview.ttlMs, 60000);
    await adapters.action({ type: 'desktop.execute', approvalId: preview.approvalId });
    await assert.rejects(() => adapters.action({ type: 'desktop.execute', approvalId: preview.approvalId }), /approval is invalid or expired/);
    assert.equal(calls.at(-1).payload.operation, 'execute');
  } finally {
    await adapters.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('network adapter refuses unsupported commands, missing known-hosts, and malformed worker output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentgraph-adapter-network-'));
  const runtime = path.join(root, '.intentgraph', 'runtime');
  const knownHosts = path.join(root, 'known_hosts');
  fs.writeFileSync(knownHosts, '127.0.0.1 ssh-ed25519 AAAA\n');
  const profile = { id: 'cisco-sandbox', host: '127.0.0.1', port: 22, platform: 'cisco_ios', username: 'sandbox', credentialRef: 'network-cisco-sandbox', knownHosts };
  let nextResult = { ok: true, output: 'show version output' };
  const calls = [];
  const adapters = new ExecutionAdapters({
    root, runtimeDirectory: runtime, getSecret: async (ref) => ref === profile.credentialRef ? 'secret-never-returned' : undefined,
    pythonRunner: async (worker, payload) => { calls.push({ worker, payload }); return nextResult; }
  });
  try {
    await adapters.action({ type: 'network.profile.configure', explicit: true, profile });
    await assert.rejects(() => adapters.action({ type: 'network.profile.configure', explicit: true, profile: { ...profile, id: 'provider-key', credentialRef: 'opencode-go' } }), /credential reference/);
    await assert.rejects(() => adapters.action({ type: 'network.read', profileId: profile.id, command: 'show running-config' }), /command is not allowed/);
    await assert.rejects(() => adapters.action({ type: 'network.read', profileId: profile.id, command: 'show version\n' }), /command is not allowed/);
    const result = await adapters.action({ type: 'network.read', profileId: profile.id, command: 'show version' });
    assert.equal(result.output, 'show version output');
    assert.equal(calls.at(-1).payload.password, 'secret-never-returned');
    const missing = { ...profile, id: 'missing-hosts', knownHosts: path.join(root, 'does-not-exist') };
    await assert.rejects(() => adapters.action({ type: 'network.profile.configure', explicit: true, profile: missing }), /known hosts/);
    nextResult = { ok: true, output: { malformed: true } };
    await assert.rejects(() => adapters.action({ type: 'network.read', profileId: profile.id, command: 'show ip interface brief' }), /malformed output/);
  } finally {
    await adapters.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
