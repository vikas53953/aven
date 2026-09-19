'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.resolve(__dirname, 'polished-git.js');
const stylePath = path.resolve(__dirname, 'polished-git.css');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

test('browser reaches repository selection, full patch review, and explicit stage result', async (t) => {
  let playwright;
  try { playwright = require(path.resolve(__dirname, '..', '..', 'node_modules', 'playwright')); } catch (error) { t.skip(`Playwright unavailable: ${error.message}`); return; }
  if (!fs.existsSync(chrome)) { t.skip('Chrome is unavailable'); return; }
  const server = http.createServer((req, res) => {
    if (req.url === '/polished-git.js') { const data = fs.readFileSync(modulePath); res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(data); return; }
    if (req.url === '/polished-git.css') { const data = fs.readFileSync(stylePath); res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(data); return; }
    const html = '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/polished-git.css"></head><body><main id="settings"></main><script src="/polished-git.js"></script><script>window.AvenGitWorkspace.mount(document.getElementById("settings"), { apiBase: "http://127.0.0.1:8768/api/git" });</script></body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await playwright.chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.addInitScript(() => {
      const calls = [];
      let configured = false;
      let reviewed = false;
      window.__gitCalls = calls;
      window.fetch = async (url, options = {}) => {
        const pathname = String(url).split('/api/git')[1] || '';
        calls.push({ pathname, method: options.method || 'GET' });
        let result;
        if (pathname === '/status') result = configured ? { configured: true, state: 'ready', repository: { path: 'C:/work/network', branch: 'main', head: '0123456789abcdef0123456789abcdef01234567' }, status: { clean: false, entries: [{ path: 'network.txt', code: ' M', staged: false, worktree: true }] } } : { configured: false, state: 'unconfigured', reason: 'Choose an ordinary local Git repository in Settings.' };
        else if (pathname === '/configure') { configured = true; result = { configured: true, state: 'ready', repository: { path: 'C:/work/network', branch: 'main', head: '0123456789abcdef0123456789abcdef01234567' }, status: { clean: false, entries: [{ path: 'network.txt', code: ' M', staged: false, worktree: true }] } }; }
        else if (pathname === '/review') { reviewed = true; result = { action: 'stage', files: ['network.txt'], patch: 'diff --git a/network.txt b/network.txt\n@@ -1 +1 @@\n-old\n+new\n', allSelectedHunks: true, token: 'review-token', expiresAt: Date.now() + 60000 }; }
        else if (pathname === '/apply') { result = { state: 'success', action: 'stage', files: ['network.txt'], worktreeChanged: false, indexUpdated: true }; }
        else result = {};
        return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      window.__gitFlags = () => ({ configured, reviewed });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.getByLabel('Repository path').fill('C:/work/network');
    await page.getByRole('button', { name: 'Configure repository' }).click();
    await page.locator('input[data-git-path="network.txt"]').check();
    await page.getByRole('button', { name: 'Review stage' }).click();
    await page.waitForSelector('.git-review-card:not([hidden])');
    assert.equal(await page.locator('pre.git-patch').first().textContent(), 'diff --git a/network.txt b/network.txt\n@@ -1 +1 @@\n-old\n+new\n');
    const beforeApply = await page.evaluate(() => window.__gitCalls.map((entry) => entry.pathname));
    assert.equal(beforeApply.includes('/apply'), false);
    await page.getByRole('button', { name: 'Stage reviewed changes' }).click();
    await page.waitForFunction(() => document.querySelector('.git-settings-status')?.textContent.includes('Reviewed patch applied'));
    const calls = await page.evaluate(() => window.__gitCalls);
    assert.equal(calls.some((entry) => entry.pathname === '/apply'), true);
    assert.deepEqual(await page.evaluate(() => window.__gitFlags()), { configured: true, reviewed: true });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
