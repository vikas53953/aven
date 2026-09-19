const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const base = 'http://127.0.0.1:8767';
const keys = { prefs: 'aven-polished-preferences-v1', data: 'aven-polished-chats-v1', docs: 'aven-polished-docs-v1' };
const files = ['polished.html', 'polished.css', 'polished.js'];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const fingerprint = () => Object.fromEntries(files.map(file => [file, hash(file)]));
const report = { startedAt: new Date().toISOString(), candidateStart: fingerprint(), checks: [], captures: [], errors: [], externalRequests: [] };
const untouched = { 'review-unrelated-key': 'KEEP THIS RAW VALUE', 'aven-wireframe-conversations-v1': '{"untouched":true}' };

let browser;
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'FAIL', detail: error.message, stack: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function pageFor(seed, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/')) report.externalRequests.push(request.url());
  });
  await page.addInitScript(values => {
    if (sessionStorage.getItem('p2-review-seeded')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    sessionStorage.setItem('p2-review-seeded', 'yes');
  }, { ...untouched, ...seed });
  await page.goto(base + '/polished.html');
  await page.locator('#draft').waitFor();
  return { page, context };
}
async function stored(page, key) { return page.evaluate(k => JSON.parse(localStorage.getItem(k)), key); }
async function screenshot(page, label) {
  const file = `.intentgraph/p2-review-${label}.png`;
  await page.screenshot({ path: path.join(root, file), fullPage: true });
  report.captures.push(file);
}
function fixture() {
  return {
    [keys.prefs]: {
      theme: 'dark', displayName: 'Review user', activeAgent: 'alpha', sections: [],
      agents: [
        { id: 'alpha', name: 'Alpha agent', role: 'Owns direct review', projectId: 'project-a', timezone: 'Follow system', autoReview: false, hidden: false, pinned: false, unread: false },
        { id: 'beta', name: 'Beta agent', role: 'Second reviewer', projectId: 'project-a', timezone: 'UTC', autoReview: true, hidden: false, pinned: false, unread: false }
      ]
    },
    [keys.data]: {
      activeChat: 'direct-alpha',
      projects: [{ id: 'personal', name: 'Personal', system: true }, { id: 'project-a', name: 'Project A' }, { id: 'project-b', name: 'Project B' }],
      channels: [{ id: 'channel-one', name: 'Channel one', projectId: 'project-a', members: ['alpha', 'beta'] }],
      chats: [
        { id: 'direct-alpha', title: 'Alpha direct', sample: false, channelId: null, projectId: 'project-a', recipients: ['alpha'], draft: 'Keep this draft', pendingAttachmentNames: ['old.txt'], messages: [{ id: 'm-direct', role: 'user', text: 'Keep direct evidence', attachments: ['evidence.txt'] }] },
        { id: 'channel-chat', title: '# Channel one', sample: false, channelId: 'channel-one', projectId: 'project-a', recipients: ['alpha', 'beta'], draft: 'Channel draft', pendingAttachmentNames: [], messages: [{ id: 'm-channel', role: 'user', text: 'Keep channel evidence', attachments: [] }] },
        { id: 'multi-direct', title: 'Alpha and beta direct', sample: false, channelId: null, projectId: 'project-a', recipients: ['alpha', 'beta'], draft: 'Multi direct draft', pendingAttachmentNames: [], messages: [] }
      ]
    },
    [keys.docs]: { alpha: { 'SOUL.md': 'Alpha source', 'MEMORY.md': 'Alpha memory' }, beta: { 'SOUL.md': 'Beta source', 'MEMORY.md': 'Beta memory' } }
  };
}
async function openMenu(page, id = 'alpha') {
  await page.locator(`[data-agent-menu="${id}"]`).click();
  await page.locator('#agent-context-menu').waitFor();
}
async function closeSettings(page) {
  if (await page.locator('#settings-dialog').isVisible().catch(() => false)) {
    await page.locator('#cancel-settings').click();
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  }
}

async function main() {
  browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, ignoreDefaultArgs: ['--headless'], args: ['--headless=new'] });
  try {
    await check('fresh render at desktop and narrow widths', async () => {
      const { page, context } = await pageFor({});
      await screenshot(page, 'fresh-1440');
      assert.equal(await page.locator('#agent-context-menu').count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(100);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'fresh narrow render overflows');
      await screenshot(page, 'fresh-390');
      await context.close();
    });

    await check('context menu pointer and keyboard lifecycle', async () => {
      const { page, context } = await pageFor(fixture());
      const opener = page.locator('[data-agent-menu="alpha"]');
      await openMenu(page);
      assert.deepEqual(await page.locator('#agent-context-menu [role="menuitem"]').allTextContents(), ['Pin', 'Mark as unread', 'Edit profile', 'Move to project…', 'Move to section…', 'Hide from sidebar', 'Delete local profile']);
      assert.equal(await page.locator('#agent-context-menu [role="menuitem"]').first().evaluate(node => node === document.activeElement), true, 'menu must focus first item');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('#agent-context-menu [data-menu-action="unread"]').evaluate(node => node === document.activeElement), true, 'menu ArrowDown must move focus');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#agent-context-menu').count(), 0);
      assert.equal(await opener.evaluate(node => node === document.activeElement), true, 'Escape must restore context opener focus');
      await opener.click();
      await page.locator('[data-menu-action="pin"]').click();
      let prefs = await stored(page, keys.prefs);
      assert.equal(prefs.agents.find(agent => agent.id === 'alpha').pinned, true);
      assert.match(await page.locator('#agent-list').innerText(), /Pinned/);
      await openMenu(page); await page.locator('[data-menu-action="unread"]').click();
      prefs = await stored(page, keys.prefs);
      assert.equal(prefs.agents.find(agent => agent.id === 'alpha').unread, true);
      assert.equal(await page.locator('[data-agent-row="alpha"]').evaluate(node => node.classList.contains('is-unread')), true, 'unread must have a visible row state');
      await context.close();
    });

    await check('project move excludes channel data and keeps local evidence', async () => {
      const { page, context } = await pageFor(fixture());
      const before = await stored(page, keys.data); const docsBefore = await stored(page, keys.docs);
      await openMenu(page); await page.locator('[data-menu-action="move-project"]').click();
      await page.locator('#move-target').selectOption('project-b'); await page.locator('#save-move').click();
      const after = await stored(page, keys.data);
      assert.equal(after.chats.find(chat => chat.id === 'direct-alpha').projectId, 'project-b', 'direct chat should move');
      assert.equal(after.chats.find(chat => chat.id === 'channel-chat').projectId, 'project-a', 'channel chat must remain in its channel project');
      assert.equal(after.chats.find(chat => chat.id === 'multi-direct').projectId, 'project-a', 'multi-agent direct chat is not silently reassigned');
      assert.deepEqual(after.chats.find(chat => chat.id === 'direct-alpha').messages, before.chats.find(chat => chat.id === 'direct-alpha').messages);
      assert.deepEqual(await stored(page, keys.docs), docsBefore);
      await page.reload();
      const reloaded = await stored(page, keys.data);
      assert.equal(reloaded.chats.find(chat => chat.id === 'direct-alpha').projectId, 'project-b', 'move must survive reload');
      assert.equal(reloaded.chats.find(chat => chat.id === 'channel-chat').projectId, 'project-a');
      await context.close();
    });

    await check('section move, cancellation and stale state', async () => {
      const { page, context } = await pageFor(fixture());
      await openMenu(page); await page.locator('[data-menu-action="move-section"]').click();
      const before = await stored(page, keys.prefs);
      await page.locator('#move-target').selectOption('__new'); await page.locator('#new-section-name').fill('Operations');
      await page.locator('#cancel-move').click();
      assert.deepEqual(await stored(page, keys.prefs), before, 'cancelled section move must not mutate preferences');
      await openMenu(page); await page.locator('[data-menu-action="move-section"]').click();
      await page.locator('#move-target').selectOption('__new'); await page.locator('#new-section-name').fill('Operations'); await page.locator('#save-move').click();
      let prefs = await stored(page, keys.prefs); assert.equal(prefs.sections.length, 1); assert.equal(prefs.agents.find(agent => agent.id === 'alpha').sectionId, prefs.sections[0].id);
      assert.match(await page.locator('#agent-list').innerText(), /Operations/);
      await openMenu(page); await page.locator('[data-menu-action="hide"]').click();
      assert.equal(await page.locator('[data-agent-row="alpha"]').count(), 0, 'hidden agent should leave sidebar');
      assert.match(await page.locator('#surface').innerText(), /Alpha direct/, 'hiding current agent must preserve current conversation');
      await page.locator('#account-button').click(); await page.locator('[data-account-action="settings"]').click(); await page.locator('[data-category="agents"]').click();
      assert.equal(await page.locator('[data-restore-agent="alpha"]').count(), 1);
      await page.locator('[data-restore-agent="alpha"]').click(); await page.locator('#save-settings').click(); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
      prefs = await stored(page, keys.prefs); assert.equal(prefs.agents.find(agent => agent.id === 'alpha').hidden, false, 'settings Save must retain restore');
      assert.equal(await page.locator('[data-agent-row="alpha"]').count(), 1);
      await context.close();
    });

    await check('soft-delete confirmation and recovery retain data', async () => {
      const { page, context } = await pageFor(fixture());
      const dataBefore = await stored(page, keys.data); const docsBefore = await stored(page, keys.docs);
      await openMenu(page); page.once('dialog', dialog => dialog.dismiss()); await page.locator('[data-menu-action="delete"]').click();
      let prefs = await stored(page, keys.prefs); assert.equal(prefs.agents.find(agent => agent.id === 'alpha').archived, undefined, 'dismissed delete must not archive');
      await openMenu(page); page.once('dialog', dialog => dialog.accept()); await page.locator('[data-menu-action="delete"]').click();
      prefs = await stored(page, keys.prefs); const deleted = prefs.agents.find(agent => agent.id === 'alpha'); assert.equal(deleted.archived, true); assert.equal(deleted.hidden, true);
      assert.deepEqual(await stored(page, keys.data), dataBefore, 'delete must retain chats/messages'); assert.deepEqual(await stored(page, keys.docs), docsBefore, 'delete must retain docs');
      await page.locator('#account-button').click(); await page.locator('[data-account-action="settings"]').click(); await page.locator('[data-category="agents"]').click(); await page.locator('[data-restore-agent="alpha"]').click(); await page.locator('#cancel-settings').click();
      prefs = await stored(page, keys.prefs); const restored = prefs.agents.find(agent => agent.id === 'alpha'); assert.equal(restored.archived, false); assert.equal(restored.hidden, false);
      assert.equal(await page.locator('[data-agent-row="alpha"]').count(), 1);
      await context.close();
    });
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    report.candidateEnd = fingerprint();
    report.candidateStable = JSON.stringify(report.candidateStart) === JSON.stringify(report.candidateEnd);
    const out = path.join(root, '.intentgraph', 'p2-review-context-results.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`Stable candidate: ${report.candidateStable}`);
    console.log(`Results: ${out}`);
    if (report.checks.some(checkResult => checkResult.status === 'FAIL') || !report.candidateStable || report.errors.length || report.externalRequests.length) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
