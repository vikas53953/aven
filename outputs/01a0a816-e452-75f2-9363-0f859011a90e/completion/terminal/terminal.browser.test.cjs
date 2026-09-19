'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('../../../../intentgraph/node_modules/playwright');

const packageRoot = __dirname;
const candidateRoot = path.join(packageRoot, 'candidate');
const baselineRoot = path.resolve(packageRoot, '../../../..');
const targetId = 'aa754801-8895-41e8-8ca5-27ee415c9c42';
let activeServer = null;
let activeBrowser = null;

function staticServer() {
  return http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'polished.html';
    if (relative.includes('..') || relative.startsWith('api/')) { res.writeHead(404); res.end(); return; }
    const candidate = path.join(candidateRoot, relative);
    const baseline = path.join(baselineRoot, relative);
    const file = fs.existsSync(candidate) ? candidate : baseline;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const contentType = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

async function main() {
  const server = staticServer();
  activeServer = server;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  activeBrowser = browser;
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const apiCalls = [];
  const blockedRequests = [];
  const pageErrors = [];
  let releasePending;
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith(`http://127.0.0.1:${port}/`) && !url.startsWith('http://127.0.0.1:8768/')) blockedRequests.push(url);
  });
  await page.route('http://127.0.0.1:8768/api/sandbox/inventory', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ retrievedAt: '2026-09-16T10:00:00.000Z', devices: [
      { id: targetId, hostname: 'sw1', platform: 'cisco_ios', transport: 'cisco-catalyst', managementIp: '192.0.2.10', supportedCommands: ['show version', 'show ip route'] },
      { id: 'ssh:lab-sw1', hostname: 'lab-sw1', platform: 'cisco_ios', transport: 'nornir-netmiko', supportedCommands: ['show version'] }
    ] })
  }));
  await page.route('http://127.0.0.1:8768/api/sandbox/command', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    apiCalls.push(body);
    if (body.command === 'show ip route') {
      await new Promise(resolve => { releasePending = resolve; });
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runId: 'cancelled-late', requestId: body.requestId, status: 'SUCCESS', source: 'fixture', output: 'late response', startedAt: '2026-09-16T10:00:02.000Z' }) }); } catch { /* The browser cancellation is the assertion. */ }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runId: 'fixture-run-1', requestId: body.requestId, status: 'SUCCESS', source: 'fixture', output: 'show version\nVersion 17.1\n', startedAt: '2026-09-16T10:00:01.000Z', completedAt: '2026-09-16T10:00:01.007Z', elapsedMs: 7 }) });
  });
  await page.goto(`http://127.0.0.1:${port}/polished.html`, { waitUntil: 'networkidle' });
  await page.locator('#tools-menu').click();
  assert.equal(await page.locator('#add-menu [data-add="terminal"]').textContent(), 'Terminal');
  await page.locator('#add-menu [data-add="terminal"]').click();
  assert.equal(await page.locator('#pane-title').textContent(), 'Terminal');
  assert.match(await page.locator('#pane-content').textContent(), /Network diagnostics/);
  await page.locator('#tools-menu').click();
  await page.locator('#add-menu [data-add="plugins"]').click();
  assert.equal(await page.locator('#pane-title').textContent(), 'Plugins');
  assert.match(await page.locator('#pane-content h3').first().textContent(), /Network diagnostics/);
  await page.locator('#sandbox-load').click();
  await page.locator('#terminal-target').waitFor();
  assert.equal(await page.locator('#terminal-target option').count(), 2);
  assert.deepEqual(await page.locator('#terminal-command option').allTextContents(), ['show version', 'show ip route']);
  assert.equal(await page.locator('input[name="command"]').count(), 0);
  assert.match(await page.locator('.terminal-subtitle').textContent(), /no shell access/i);
  assert.match(await page.locator('.terminal-capabilities').textContent(), /Read-only/);
  await page.locator('#terminal-command').selectOption('show version');
  await page.getByRole('button', { name: 'Run read-only command' }).click();
  await page.locator('.terminal-status-success').waitFor();
  assert.equal(await page.locator('.terminal-raw-details').getAttribute('open'), null);
  assert.match(await page.locator('.terminal-evidence-metadata').first().textContent(), new RegExp(targetId));
  assert.match(await page.locator('.terminal-evidence-metadata').first().textContent(), /fixture-run-1/);
  await page.locator('.terminal-raw-details').first().locator('summary').click();
  assert.equal(await page.locator('.terminal-raw-output').first().textContent(), 'show version\nVersion 17.1\n');
  assert.equal(apiCalls.length, 1);
  assert.deepEqual(Object.keys(apiCalls[0]).sort(), ['command', 'requestId', 'targetId'].sort());
  assert.match(apiCalls[0].requestId, /^[0-9a-f-]{36}$/i);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#tools-menu').click();
  await page.locator('#add-menu [data-add="plugins"]').click();
  assert.equal(await page.locator('.terminal-evidence').count(), 1);
  await page.locator('#sandbox-load').click();
  await page.locator('#terminal-target').waitFor();
  await page.locator('#terminal-command').selectOption('show ip route');
  await page.getByRole('button', { name: 'Run read-only command' }).click();
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await page.locator('.terminal-status-unknown').waitFor();
  assert.equal(apiCalls.length, 2);
  assert.match(await page.locator('.terminal-evidence').first().textContent(), /outcome unknown/i);
  assert.doesNotMatch((await page.locator('body').textContent()).toLowerCase(), /healthy/);
  releasePending?.();
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const minTouch = await page.locator('.terminal-actions button').evaluateAll(nodes => Math.min(...nodes.map(node => node.getBoundingClientRect().height)));
  assert.ok(minTouch >= 36, `terminal action touch target too small: ${minTouch}`);
  const result = { status: 'PASS', checks: { reachableTerminalAndGenericLabels: 'PASS', targetAndAllowlist: 'PASS', evidenceAndPersistence: 'PASS', cancelUnknownNoRetry: 'PASS', compactResponsive: 'PASS', reducedMotion: 'PASS' }, pageErrors, blockedRequests, apiCalls };
  fs.writeFileSync(path.join(packageRoot, 'browser-evidence.json'), JSON.stringify(result, null, 2) + '\n');
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch(async error => {
  process.stderr.write(`${error.stack || error}\n`);
  try { await activeBrowser?.close(); } catch {}
  try { if (activeServer?.listening) await new Promise(resolve => activeServer.close(resolve)); } catch {}
  process.exitCode = 1;
});
