'use strict';

// UX-102 isolated regression: serve the static baseline/candidate overlay and
// intercept only the local status endpoint. Every case gets a fresh context.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.join(
  path.resolve(__dirname, '..', '..', '..', '..', '..'),
  'intentgraph',
  'node_modules',
  'playwright',
));

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const baselineRoot = path.join(projectRoot, 'outputs', '01a0a816-e452-75f2-9363-0f859011a90e', 'fixes', 'baseline');
const candidateRoot = __dirname;
const apiOrigin = 'http://127.0.0.1:8768';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const integrated = process.argv.includes('--integrated');
const outputRoot = path.resolve(__dirname, '..');
const reportPath = path.join(outputRoot, integrated ? 'report-integrated.json' : 'report.json');
const candidateReportPath = path.join(candidateRoot, integrated ? 'ux102-integrated-test-report.json' : 'ux102-test-report.json');

const results = [];
const evidence = { cases: [], blockedRequests: [], pageErrors: [] };

function record(name, status, detail) {
  results.push({ command: name, exitCode: status === 'PASS' || status === 'EXPECTED_FAIL' ? 0 : 1, result: status, detail });
}

function readStatic(root, pathname) {
  const relative = pathname.replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return null;
  const candidate = path.join(root, relative);
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

function startStaticServer(mode) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const file = mode === 'candidate'
      ? readStatic(candidateRoot, pathname) || readStatic(baselineRoot, pathname) || readStatic(projectRoot, pathname)
      : mode === 'baseline' ? readStatic(baselineRoot, pathname) || readStatic(projectRoot, pathname) : readStatic(projectRoot, pathname);
    if (!file) { response.writeHead(404); response.end('Not found'); return; }
    const type = path.extname(file) === '.html' ? 'text/html; charset=utf-8' :
      path.extname(file) === '.js' ? 'text/javascript; charset=utf-8' :
        path.extname(file) === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function fixtureFor(kind) {
  if (kind === 'true') return { provider: 'FixtureProvider', model: 'FixtureModel', configured: true, lastChecked: '2026-09-16T04:00:00.000Z', secret: 'fixture-secret-must-not-copy' };
  if (kind === 'malformed') return { provider: 'FixtureProvider', model: 'FixtureModel', secret: 'fixture-secret-must-not-copy' };
  return { provider: 'Not connected', model: 'Unavailable', configured: false, lastChecked: '2026-09-16T04:00:00.000Z', secret: 'fixture-secret-must-not-copy' };
}

async function runCase(browser, { name, kind, mode, expectedBefore, expectedAfter, baseline, sequence, staleAfter, lifecycle }) {
  const { server, origin } = await startStaticServer(mode);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const state = { api: [], blocked: [], errors: [], release: null };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== apiOrigin) { state.blocked.push(request.url()); return route.abort(); }
    state.api.push({ method: request.method(), path: url.pathname });
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'X-Aven-Chat', 'access-control-allow-methods': 'GET, OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/api/chat/status' && request.method() === 'GET') {
      const reads = state.api.filter(item => item.path === '/api/chat/status' && item.method === 'GET').length;
      const responseKind = sequence?.[Math.min(reads - 1, sequence.length - 1)] || kind;
      if (lifecycle && reads === 1) await new Promise(resolve => { state.release = resolve; });
      if (responseKind === 'failure') return route.fulfill({ status: 503, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'fixture endpoint failure', secret: 'fixture-secret-must-not-copy' }) });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fixtureFor(responseKind)) });
    }
    state.blocked.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => { state.errors.push(error.message); evidence.pageErrors.push({ case: name, message: error.message }); });
  try {
    await page.goto(`${origin}/polished.html?ux102=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#account-button').click();
    await page.locator('[data-account-action="about"]').click();
    const row = baseline ? page.locator('.build-info dd').nth(3) : page.locator('#about-chat-connection');
    assert.equal(await row.innerText(), expectedBefore, `${name}: pre-check state`);
    if (lifecycle) {
      const responseDone = page.waitForResponse(response => response.url() === `${apiOrigin}/api/chat/status`);
      await page.locator('#refresh-local-status').click();
      await page.getByText('Reading local configuration…', { exact: true }).waitFor();
      await page.locator('#close-info').click();
      await page.locator('#account-button').click();
      await page.locator('[data-account-action="about"]').click();
      assert.equal(await page.locator('#about-chat-connection').innerText(), expectedBefore, `${name}: new About starts unknown`);
      assert.ok(state.release, `${name}: delayed status request was not held`);
      state.release();
      await responseDone;
      assert.equal(await page.locator('#about-chat-connection').innerText(), expectedBefore, `${name}: closed About callback did not update new About`);
      assert.equal(await page.locator('.diagnostics-report').isVisible(), false);
      record(name, 'PASS', 'Delayed status from a closed About instance did not update the newly opened instance.');
    } else if (baseline) {
      await page.locator('#refresh-local-status').click();
      await page.locator('.diagnostics-report').waitFor();
      const about = await page.locator('#info-dialog-body').innerText();
      const report = JSON.parse(await page.locator('.diagnostics-report').innerText());
      assert.equal(report.configured, false);
      assert.match(about, /MiMo V2\.5 \(configured\)/);
      assert.match(about, /"configured": false/);
      record(name, 'EXPECTED_FAIL', 'Baseline reproduces hard-coded configured identity beside configured:false.');
    } else {
      assert.doesNotMatch(await page.locator('#info-dialog-body').innerText(), /OpenCode|MiMo V2\.5/);
      await page.locator('#refresh-local-status').click();
      if (kind === 'failure' || kind === 'malformed') {
        await page.getByText('Local status unavailable.', { exact: false }).waitFor();
        assert.equal(await row.innerText(), expectedAfter);
        assert.equal(await page.locator('.diagnostics-report').isVisible(), false);
        assert.equal(await page.locator('#copy-support-report').isDisabled(), true);
        assert.doesNotMatch(await page.locator('#info-dialog-body').innerText(), /FixtureProvider|FixtureModel|fixture-secret/);
      } else {
        await page.locator('.diagnostics-report').waitFor();
        assert.equal(await row.innerText(), expectedAfter);
        const about = await page.locator('#info-dialog-body').innerText();
        const report = JSON.parse(await page.locator('.diagnostics-report').innerText());
        const aboutBuild = await page.locator('.build-info dd').first().innerText();
        assert.equal(report.build, aboutBuild, `${name}: support report uses the About build`);
        assert.doesNotMatch(about, /OpenCode · MiMo V2\.5 \(configured\)/);
        assert.doesNotMatch(about, /fixture-secret/);
        assert.equal(report.secret, undefined);
        await page.locator('#copy-support-report').click();
        await page.locator('#local-status-result').filter({hasText:'Support report copied'}).waitFor({state:'visible',timeout:5000});
        assert.match(await page.locator('#local-status-result').innerText(), /Support report copied/);
        const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
        assert.equal(copied.build, report.build);
        assert.equal(copied.secret, undefined);
        if (staleAfter) {
          await page.locator('#refresh-local-status').click();
          await page.getByText('Local status unavailable.', { exact: false }).waitFor();
          assert.equal(await row.innerText(), staleAfter);
          assert.equal(await page.locator('.diagnostics-report').isVisible(), false);
          assert.equal(await page.locator('#copy-support-report').isDisabled(), true);
          assert.doesNotMatch(await page.locator('#info-dialog-body').innerText(), /FixtureProvider|FixtureModel|fixture-secret/);
        }
      }
      record(name, 'PASS', `About state=${await row.innerText()}; API status calls=${state.api.filter(item => item.path === '/api/chat/status').length}.`);
    }
    assert.equal(state.blocked.length, 0, `${name}: unexpected network request`);
    assert.equal(state.errors.length, 0, `${name}: page error`);
    evidence.cases.push({ name, mode, api: state.api, blocked: state.blocked, pageErrors: state.errors });
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  try {
    if (integrated) {
      await runCase(browser, { name: 'UX102 integrated false status', kind: 'false', mode: 'integrated', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'Not connected · Unavailable (not configured; reachability unverified)' });
      await runCase(browser, { name: 'UX102 integrated true status', kind: 'true', mode: 'integrated', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'FixtureProvider · FixtureModel (configured; reachability unverified)' });
      await runCase(browser, { name: 'UX102 integrated malformed status', kind: 'malformed', mode: 'integrated', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'Unavailable · local status unavailable' });
      await runCase(browser, { name: 'UX102 integrated endpoint failure', kind: 'failure', mode: 'integrated', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'Unavailable · local status unavailable' });
      await runCase(browser, { name: 'UX102 integrated stale success then failure', kind: 'true', mode: 'integrated', sequence: ['true', 'failure'], staleAfter: 'Unavailable · local status unavailable', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'FixtureProvider · FixtureModel (configured; reachability unverified)' });
      await runCase(browser, { name: 'UX102 integrated closed About callback', kind: 'true', mode: 'integrated', lifecycle: true, expectedBefore: 'Unknown · local status not checked' });
    } else {
      await runCase(browser, { name: 'UX102 baseline false status', kind: 'false', mode: 'baseline', expectedBefore: 'OpenCode · MiMo V2.5 (configured)', baseline: true });
      await runCase(browser, { name: 'UX102 candidate false status', kind: 'false', mode: 'candidate', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'Not connected · Unavailable (not configured; reachability unverified)' });
      await runCase(browser, { name: 'UX102 candidate true status', kind: 'true', mode: 'candidate', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'FixtureProvider · FixtureModel (configured; reachability unverified)' });
      await runCase(browser, { name: 'UX102 candidate malformed status', kind: 'malformed', mode: 'candidate', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'Unavailable · local status unavailable' });
      await runCase(browser, { name: 'UX102 candidate endpoint failure', kind: 'failure', mode: 'candidate', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'Unavailable · local status unavailable' });
      await runCase(browser, { name: 'UX102 candidate stale success then failure', kind: 'true', mode: 'candidate', sequence: ['true', 'failure'], staleAfter: 'Unavailable · local status unavailable', expectedBefore: 'Unknown · local status not checked', expectedAfter: 'FixtureProvider · FixtureModel (configured; reachability unverified)' });
      await runCase(browser, { name: 'UX102 candidate closed About callback', kind: 'true', mode: 'candidate', lifecycle: true, expectedBefore: 'Unknown · local status not checked' });
    }
  } finally {
    await browser.close();
  }
  const report = {
    files: ['polished.js', 'polished-diagnostics.js'],
    replacementsPath: path.join(outputRoot, 'replacements.json'),
    tests: results,
    evidence,
    limitations: ['Local status is fixture-backed and reachability remains explicitly unverified.', 'This isolated test covers the static About/diagnostics surface; it does not exercise a real provider or device.'],
  };
  fs.writeFileSync(candidateReportPath, JSON.stringify({ at: new Date().toISOString(), tests: results, evidence }, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (results.some(item => item.exitCode !== 0)) process.exitCode = 1;
}

main().catch(error => {
  record('UX102 isolated browser test', 'FAIL', error.message);
  fs.writeFileSync(reportPath, JSON.stringify({ files: ['polished.js', 'polished-diagnostics.js'], replacementsPath: path.join(outputRoot, 'replacements.json'), tests: results, evidence, limitations: ['Test process failed before all cases completed.'] }, null, 2));
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
