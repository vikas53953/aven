'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));

const OUT = __dirname;
const PROJECT_ROOT = path.resolve(OUT, '..', '..', '..', '..');
const BASELINE_ROOT = path.join(OUT, '..', 'baseline');
const CANDIDATE_ROOT = path.join(OUT, 'candidate');
const CHROME = process.env.NETROK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHAT_KEY = 'aven-polished-chats-v1';
const PREF_KEY = 'aven-polished-preferences-v1';
const SCREENSHOT = path.join(OUT, 'candidate.png');

function message(id, role, text) { return { id, role, text, createdAt: '2026-09-16T04:00:00.000Z' }; }
function fixture() {
  const prefs = {
    theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: 'Reaction fixture',
    activeAgent: 'a', provider: 'Not connected', model: '', browser: false, computer: false,
    agents: [{ id: 'a', name: 'Firewall', role: 'Network security', timezone: 'Follow system', autoReview: false }], sections: [],
  };
  const data = {
    activeChat: 'reaction-chat', projects: [], channels: [],
    chats: [{ id: 'reaction-chat', title: 'Reaction fixture', projectId: null, channelId: null, recipients: ['a'], draft: '', pendingQueue: [], messages: [
      message('m1', 'assistant', 'First saved answer.'),
      message('m2', 'assistant', 'Second saved answer.'),
    ] }],
  };
  return { prefs, data };
}

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://loopback').pathname); } catch { response.writeHead(400).end(); return; }
    if (pathname === '/') pathname = '/polished.html';
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

async function main() {
  const server = serve(BASELINE_ROOT);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const blockedRequests = [];
  const pageErrors = [];
  const apiCalls = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base && url.pathname.endsWith('/polished.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(CANDIDATE_ROOT, 'polished.html')) });
    if (url.origin === base && url.pathname.endsWith('/polished.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(CANDIDATE_ROOT, 'polished.js')) });
    if (url.origin === base && url.pathname.endsWith('/polished.css')) return route.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(CANDIDATE_ROOT, 'polished.css')) });
    if (url.origin === base && url.pathname.startsWith('/avatar-system/')) { const avatarFile = path.join(CANDIDATE_ROOT, url.pathname.replace(/^\//, '').replaceAll('/', path.sep)); if (fs.existsSync(avatarFile)) return route.fulfill({ status: 200, body: fs.readFileSync(avatarFile) }); }
    if (url.origin === base) return route.continue();
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Not connected', model: 'Unavailable', configured: false }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/runs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat/steer') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, id: 'fixture-steer' }) });
    if (url.hostname === '127.0.0.1' && url.pathname === '/api/chat' && request.method() === 'POST') { apiCalls.push(request.postDataJSON()); return route.abort(); }
    blockedRequests.push(request.url()); return route.abort();
  });

  const checks = [];
  const run = async (id, name, fn, limitation) => {
    try { await fn(); checks.push({ id, name, passed: true, evidence: 'PASS', limitation }); }
    catch (error) { checks.push({ id, name, passed: false, evidence: `${error.name}: ${error.message}`, limitation }); }
  };
  try {
    await page.goto(`${base}/polished.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(({ prefs, data }) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs)); localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data)); }, fixture());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#surface', { state: 'attached' });
    await page.waitForTimeout(100);

    await run('UX049-search', 'More reactions exposes an accessible search and filters named reactions', async () => {
      const actions = page.locator('[data-message-id="m2"] [aria-label="Message actions"]');
      await actions.click({ force: true });
      assert.equal(await page.getByRole('menuitemradio', { name: 'React with 👍', exact: true }).count(), 1);
      const more = page.getByRole('menuitem', { name: 'More reactions', exact: true });
      await more.click();
      const search = page.getByRole('searchbox', { name: 'Search more reactions' });
      assert.equal(await search.isVisible(), true);
      assert.equal(await page.locator('.message-more-picker button').count(), 10);
      await search.fill('rocket');
      const visible = page.locator('.message-more-picker button:visible');
      assert.equal(await visible.count(), 1);
      assert.equal(await visible.first().getAttribute('aria-label'), 'React with Rocket');
      await page.screenshot({ path: path.join(OUT, 'candidate-picker.png'), fullPage: true });
    }, 'Local fixture only; search labels cover the built-in reaction set.')
      ;

    await run('UX049-keyboard', 'Picker arrow navigation stays inside and Escape returns focus in two steps', async () => {
      const messageRow = page.locator('[data-message-id="m2"]');
      const before = await messageRow.boundingBox();
      const search = page.getByRole('searchbox', { name: 'Search more reactions' });
      await search.fill('rocket');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('.message-more-picker button:visible').first().evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('.message-more-picker button:visible').first().evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.message-more-picker').isHidden(), true);
      assert.equal(await page.getByRole('menuitem', { name: 'More reactions', exact: true }).evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('#nav-menu').count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#nav-menu').count(), 0);
      assert.equal(await page.locator('[data-message-id="m2"] [aria-label="Message actions"]').evaluate(node => node === document.activeElement), true);
      const after = await messageRow.boundingBox();
      assert.ok(before && after && Math.abs(after.y - before.y) <= 1, `message moved from ${before?.y} to ${after?.y}`);
    }, 'Keyboard focus and dismissal are verified in Chromium; no screen-reader certification.')
      ;

    await run('UX049-persistence', 'Selected reaction remains attached to the correct message after reload', async () => {
      const actions = page.locator('[data-message-id="m2"] [aria-label="Message actions"]');
      await actions.click({ force: true }); await page.getByRole('menuitem', { name: 'More reactions', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search more reactions' }).fill('rocket');
      await page.getByRole('menuitemradio', { name: 'React with Rocket', exact: true }).click();
      assert.equal(await page.locator('[data-message-id="m2"] .message-reactions').innerText(), '🚀');
      assert.equal(await page.locator('[data-message-id="m1"] .message-reactions').count(), 0);
      let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CHAT_KEY);
      assert.equal(saved.chats[0].messages.find(item => item.id === 'm2').localReaction, '🚀');
      assert.equal(saved.chats[0].messages.find(item => item.id === 'm1').localReaction || null, null);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(80);
      assert.equal(await page.locator('[data-message-id="m2"] .message-reactions').innerText(), '🚀');
      assert.equal(await page.locator('[data-message-id="m1"] .message-reactions').count(), 0);
      await page.locator('[data-message-id="m1"] [aria-label="Message actions"]').click({ force: true }); await page.getByRole('menuitem', { name: 'More reactions', exact: true }).click(); await page.getByRole('searchbox', { name: 'Search more reactions' }).fill('fire'); await page.getByRole('menuitemradio', { name: 'React with Fire', exact: true }).click();
      assert.equal(await page.locator('[data-message-id="m1"] .message-reactions').innerText(), '🔥');
      assert.equal(await page.locator('[data-message-id="m2"] .message-reactions').innerText(), '🚀');
      saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), CHAT_KEY);
      assert.equal(saved.chats[0].messages.find(item => item.id === 'm1').localReaction, '🔥');
      assert.equal(saved.chats[0].messages.find(item => item.id === 'm2').localReaction, '🚀');
    }, 'LocalStorage persistence is checked per message; no multi-device synchronization.')
      ;

    await run('UX049-responsive', 'Picker remains contained at a compact touch-sized viewport', async () => {
      await page.setViewportSize({ width: 320, height: 700 });
      const actions = page.locator('[data-message-id="m2"] [aria-label="Message actions"]'); await actions.click({ force: true }); await page.getByRole('menuitem', { name: 'More reactions', exact: true }).click();
      const bounds = await page.locator('.message-more-picker').boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320, JSON.stringify(bounds));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    }, 'Single compact viewport smoke check; visual reference comparison remains separate.')
      ;

    await page.screenshot({ path: SCREENSHOT, fullPage: true });
  } finally {
    await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
  }

  const result = {
    status: checks.every(check => check.passed) && !pageErrors.length && !blockedRequests.length && !apiCalls.length ? 'PASS' : 'FAIL',
    checks, pageErrors, blockedRequests, apiCalls,
    candidate: path.relative(PROJECT_ROOT, path.join(CANDIDATE_ROOT, 'polished.js')),
    screenshots: [path.relative(PROJECT_ROOT, SCREENSHOT), path.relative(PROJECT_ROOT, path.join(OUT, 'candidate-picker.png'))],
  };
  fs.writeFileSync(path.join(OUT, 'browser-evidence.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (result.status !== 'PASS') process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
