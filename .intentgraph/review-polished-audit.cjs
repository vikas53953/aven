const { chromium } = require('C:/Users/vikasmit/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8767';
const evidenceDir = __dirname;
const report = {
  startedAt: new Date().toISOString(),
  candidate: {},
  checks: [],
  screenshots: [],
  pageErrors: [],
  consoleErrors: [],
  externalRequests: [],
  notes: []
};
const sentinels = {
  'aven-wireframe-preferences-v1': '{"preserve":"user preferences"}',
  'aven-wireframe-conversations-v1': '{"preserve":"user conversations"}',
  'intentgraph-visual-map-review-v08': '{"preserve":"user decisions"}'
};

for (const file of ['polished.html', 'polished.css', 'polished.js', 'prototype-review.html']) {
  const bytes = fs.readFileSync(path.join(root, file));
  report.candidate[file] = { sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(), bytes: bytes.length };
}

function record(name, status, detail, evidence = []) { report.checks.push({ name, status, detail, evidence }); }
async function run(name, fn) {
  try { const evidence = await fn(); record(name, 'PASS', 'Observed successfully.', evidence || []); }
  catch (error) { record(name, 'FAIL', error.message, []); }
}
async function capture(page, name) {
  const file = `review-polished-${name}.png`;
  await page.screenshot({ path: path.join(evidenceDir, file), fullPage: false });
  report.screenshots.push({ name, path: `.intentgraph/${file}` });
}
async function pageFor(browser, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/')) report.externalRequests.push({ url: request.url(), method: request.method() });
  });
  await page.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value); }, sentinels);
  await page.goto(base + '/polished.html', { waitUntil: 'networkidle' });
  await page.locator('#draft').waitFor();
  return page;
}
async function sentinelsUnchanged(page) {
  const actual = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(sentinels));
  assert.deepEqual(actual, sentinels);
}
async function clickCreate(page, type) {
  await page.locator('#quick-create').click();
  await page.locator(`[data-create="${type}"]`).click();
}
async function create(page, type, name, role = 'Review local network findings.') {
  await clickCreate(page, type);
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Create form should occupy the center, not a modal');
  await page.locator('#workspace-create-name').fill(name);
  if (type === 'agent') await page.locator('#workspace-create-role').fill(role);
  await page.locator('#finish-workspace-create').click();
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, ignoreDefaultArgs: ['--headless'], args: ['--headless=new'] });
  try {
    await run('P1 / J1 orientation and accepted placement', async () => {
      const page = await pageFor(browser);
      const toggle = await page.locator('#toggle').boundingBox();
      const createButton = await page.locator('#quick-create').boundingBox();
      const search = await page.locator('[data-destination="Search"]').boundingBox();
      assert(toggle && createButton && search);
      assert(toggle.x + toggle.width <= createButton.x + 1, 'Collapse control does not precede Create');
      assert(search.y > createButton.y, 'Search is not below Create');
      assert.equal(await page.locator('#agent-rail-add,#new-agent-shortcut').count(), 0, 'Agent plus remains in the rail');
      assert.match(await page.locator('body').innerText(), /Aven[\s\S]*Branch network review[\s\S]*Sample content is illustrative/);
      await page.locator('#avatar').click();
      assert(await page.locator('#right-pane').isVisible());
      await capture(page, '1440-orientation');
      await page.context().close();
      return ['.intentgraph/review-polished-1440-orientation.png'];
    });

    await run('P2 / J2 local conversation ownership, attachments and reload', async () => {
      const page = await pageFor(browser);
      await page.locator('#draft').fill('Keep this original draft');
      await clickCreate(page, 'agent');
      await page.locator('#cancel-workspace-create').click();
      assert.equal(await page.locator('#draft').inputValue(), 'Keep this original draft', 'Cancel lost the previous draft');
      await create(page, 'agent', 'Policy reviewer');
      await page.locator('#recipient-summary').click();
      const recipients = page.locator('#recipient-options input[type="checkbox"]');
      assert((await recipients.count()) >= 2, 'Created agent is not selectable');
      for (let i = 0; i < await recipients.count(); i++) await recipients.nth(i).check();
      await page.locator('#recipient-summary').click();
      await page.locator('#draft').fill('Review policy at https://example.test/guide');
      await page.locator('#file-picker').setInputFiles({ name: 'policy.txt', mimeType: 'text/plain', buffer: Buffer.from('local fixture') });
      await page.locator('#image-picker').setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wS8AAAAASUVORK5CYII=', 'base64') });
      await page.locator('#attachments img').waitFor();
      assert.equal(await page.locator('#attachments img').evaluate(node => node.complete && node.naturalWidth > 0), true, 'Image preview did not decode');
      await page.getByRole('button', { name: /Remove attachment diagram\.png/ }).click();
      assert.doesNotMatch(await page.locator('#attachments').innerText(), /diagram\.png/);
      await page.locator('#send').click();
      assert.match(await page.locator('#conversation').innerText(), /Review policy at/);
      assert.match(await page.locator('#conversation').innerText(), /Policy reviewer/);
      await page.locator('#new-chat').click();
      assert.doesNotMatch(await page.locator('#conversation').innerText(), /Review policy at/);
      await page.locator('#draft').fill('Independent draft');
      await page.reload();
      assert.equal(await page.locator('#draft').inputValue(), 'Independent draft');
      await page.locator('[data-destination="Search"]').click();
      await page.locator('#search-filters').getByRole('button', { name: 'Files', exact: true }).click();
      assert.match(await page.locator('#search-results').innerText(), /policy\.txt/);
      await sentinelsUnchanged(page);
      await capture(page, 'conversation-reload');
      await page.context().close();
      return ['.intentgraph/review-polished-conversation-reload.png'];
    });

    await run('P3 / J3 organization creation and cancellation', async () => {
      const page = await pageFor(browser);
      await page.locator('#draft').fill('Draft before organization');
      await create(page, 'project', 'Branch rollout');
      assert.match(await page.locator('#surface').innerText(), /Branch rollout/);
      await page.locator('[data-destination="Projects"]').click();
      assert.match(await page.locator('#chat-directory').innerText(), /Branch rollout/);
      await page.getByRole('button', { name: /Branch rollout/ }).click();
      await page.getByRole('button', { name: /\+ New channel/ }).click();
      await page.locator('#workspace-create-name').fill('Policies');
      await page.locator('#finish-workspace-create').click();
      assert.match(await page.locator('#surface').innerText(), /# Policies/);
      await page.getByRole('button', { name: /\+ New thread/ }).click();
      await page.locator('#cancel-workspace-create').click();
      assert.match(await page.locator('#surface').innerText(), /# Policies/);
      await page.locator('[data-destination="Chat"]').click();
      assert.match(await page.locator('#draft').inputValue(), /Draft before organization/);
      await sentinelsUnchanged(page);
      await page.context().close();
    });

    await run('P4 / J4 agent documents and profile ownership', async () => {
      const page = await pageFor(browser);
      await page.locator('#avatar').click();
      await page.locator('[data-doc="SOUL.md"]').click();
      await page.locator('#doc-textarea').fill('Companion-specific policy draft');
      await page.locator('#save-doc').click();
      await page.locator('#back-doc').click();
      const agents = await page.locator('#active-agent option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent })));
      assert(agents.length >= 2);
      await page.locator('#active-agent').selectOption(agents[1].value);
      await page.locator('[data-doc="SOUL.md"]').click();
      assert.notEqual(await page.locator('#doc-textarea').inputValue(), 'Companion-specific policy draft');
      const original = await page.locator('#doc-textarea').inputValue();
      await page.locator('#doc-textarea').fill('Discard this unsaved change');
      page.once('dialog', dialog => dialog.dismiss());
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#doc-textarea').inputValue(), 'Discard this unsaved change', 'Escape did not keep the edited document open');
      await page.locator('#cancel-doc').click();
      await page.locator('[data-doc="SOUL.md"]').click();
      assert.equal(await page.locator('#doc-textarea').inputValue(), original);
      await page.locator('#back-doc').click();
      await page.locator('#active-agent').selectOption(agents[0].value);
      await page.locator('[data-doc="SOUL.md"]').click();
      assert.equal(await page.locator('#doc-textarea').inputValue(), 'Companion-specific policy draft');
      await page.reload();
      await page.locator('#avatar').click();
      await page.locator('[data-doc="SOUL.md"]').click();
      assert.equal(await page.locator('#doc-textarea').inputValue(), 'Companion-specific policy draft');
      await sentinelsUnchanged(page);
      await capture(page, 'agent-document');
      await page.context().close();
      return ['.intentgraph/review-polished-agent-document.png'];
    });

    await run('P5 / J5 settings categories, persistence and focus return', async () => {
      const page = await pageFor(browser);
      const opener = page.locator('#settings');
      await opener.click();
      for (const name of ['General', 'Appearance', 'Agents', 'Models & providers', 'Connections', 'Privacy & data']) {
        await page.locator('#settings-nav').getByRole('button', { name, exact: true }).click();
        assert((await page.locator('#settings-content').innerText()).trim().length > 0, `${name} is empty`);
      }
      await page.locator('#settings-nav').getByRole('button', { name: 'Appearance', exact: true }).click();
      await page.locator('#pref-theme').selectOption('light');
      await page.locator('#save-settings').click();
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#settings').evaluate(node => node === document.activeElement), true, 'Settings focus did not return to opener');
      await page.reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      await page.locator('#settings').click();
      await page.keyboard.press('Escape');
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
      await sentinelsUnchanged(page);
      await capture(page, 'settings-light');
      await page.context().close();
      return ['.intentgraph/review-polished-settings-light.png'];
    });

    await run('P6 / J6 deterministic preview states and cancellation', async () => {
      const page = await pageFor(browser);
      for (const view of ['browser', 'plugins', 'computer']) {
        await page.locator(`[data-pane="${view}"]`).click();
        assert.match(await page.locator('#pane-content').innerText(), /preview only/);
        await page.locator('#run-tool').click();
        assert.match(await page.locator('#tool-state').innerText(), /Loading/);
        await page.locator('#tool-state.state-success').waitFor();
        await page.locator('#run-tool').click();
        await page.locator('#tool-state.state-error').waitFor();
        await page.locator('#retry-tool').click();
        await page.locator('#tool-state.state-success').waitFor();
        await page.locator('#reset-tool').click();
        await page.locator('#run-tool').click();
        assert.equal(await page.locator('#run-tool').isDisabled(), true);
        await page.locator('#cancel-tool').click();
        await page.waitForTimeout(800);
        assert.match(await page.locator('#tool-state').innerText(), /Idle/);
      }
      await sentinelsUnchanged(page);
      await capture(page, 'tool-preview');
      await page.context().close();
      return ['.intentgraph/review-polished-tool-preview.png'];
    });

    await run('P7 / J7 responsive geometry, keyboard and reduced motion', async () => {
      const page = await pageFor(browser, { width: 1440, height: 1000 });
      for (const width of [1920, 1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
        if (await page.locator('#right-pane').isVisible()) await page.locator('#close-pane').click();
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert(dimensions.scroll <= dimensions.viewport + 1, `Unexpected horizontal overflow at ${width}: ${dimensions.scroll}`);
        for (const selector of ['#quick-create', '#settings', '#composer', '#send']) {
          const box = await page.locator(selector).boundingBox();
          assert(box && box.x >= -1 && box.x + box.width <= width + 1, `${selector} clipped at ${width}`);
        }
        await page.locator('#avatar').click();
        const pane = await page.locator('#right-pane').boundingBox();
        assert(pane && pane.x >= -1 && pane.x + pane.width <= width + 1, `Right pane clipped at ${width}`);
        if (width <= 760) await page.locator('#close-pane').click();
        await capture(page, String(width));
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('#toggle').click();
      const reduced = await page.locator('#rail').evaluate(node => getComputedStyle(node).transitionDuration);
      assert(reduced.split(',').every(value => parseFloat(value) <= 0.01), `Reduced-motion transition remains: ${reduced}`);
      await sentinelsUnchanged(page);
      await page.context().close();
      return [
        '.intentgraph/review-polished-1920.png', '.intentgraph/review-polished-1440.png', '.intentgraph/review-polished-1024.png',
        '.intentgraph/review-polished-768.png', '.intentgraph/review-polished-390.png', '.intentgraph/review-polished-320.png'
      ];
    });

    await run('P8 / J8 reviewability links and evidence state', async () => {
      const page = await pageFor(browser);
      const review = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const reviewErrors = [];
      review.on('pageerror', error => reviewErrors.push(error.message));
      await review.goto(base + '/prototype-review.html', { waitUntil: 'networkidle' });
      assert.equal(await review.locator('a[href="polished.html"]').count(), 1);
      assert.equal(await review.locator('a[href="intent-map.html"]').count(), 1);
      assert.match(await review.locator('body').innerText(), /DESIGN GUIDANCE[\s\S]*EXPERIENCE COVERAGE[\s\S]*EVIDENCE REQUIREMENTS/);
      report.notes.push(`Review page polished-evidence.json fetch is ${fs.existsSync(path.join(evidenceDir, 'polished-evidence.json')) ? 'present' : 'absent'} at review time.`);
      if (reviewErrors.length) throw new Error(`Review page errors: ${reviewErrors.join('; ')}`);
      await review.close();
      await sentinelsUnchanged(page);
      await page.context().close();
    });

    report.notes.push(`Accepted wireframe baseline hashes are checked in polished-baseline-hashes.json; current candidate hashes were captured at ${report.startedAt}.`);
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, 'review-polished-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
