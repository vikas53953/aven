const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const base = 'http://127.0.0.1:8767';
const evidenceDir = __dirname;
const root = path.join(evidenceDir, '..');
const keys = {
  prefs: 'aven-polished-preferences-v1',
  data: 'aven-polished-chats-v1',
  docs: 'aven-polished-docs-v1'
};
const sourceFiles = ['polished.html', 'polished.css', 'polished.js', 'polished-avatars.js', 'prototype-review.html'];
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const fingerprint = () => Object.fromEntries(sourceFiles.map(file => [file, sha256(file)]));

const report = {
  baseline: 'F09-P4',
  startedAt: new Date().toISOString(),
  sourceFiles,
  candidateStart: fingerprint(),
  checks: [],
  captures: [],
  errors: [],
  externalRequests: []
};

const sentinel = {
  'p4-unrelated-project-data': 'KEEP RAW VALUE',
  'aven-wireframe-conversations-v1': '{"untouched":true}'
};
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const tinyDataUrl = 'data:image/webp;base64,UklGRiAAAABXRUJQVlA4IBQAAAAwAQCdASoQABAAPpE6r0iJAA==';
let browser;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function fixture({ title = 'Alpha direct', activeChat = 'direct-alpha', pinnedBeta = false } = {}) {
  return {
    [keys.prefs]: {
      theme: 'dark', displayName: 'Review user', activeAgent: 'alpha',
      sections: [
        { id: 'ops', name: 'Operations', collapsed: false },
        { id: 'other', name: 'Other', collapsed: false }
      ],
      agents: [
        { id: 'alpha', name: 'Alpha agent', role: 'Owns direct review', label: 'Core', description: 'Primary local reviewer', notifications: true, projectId: 'project-a', timezone: 'Follow system', autoReview: false, hidden: false, pinned: false, unread: false, sectionId: '' },
        { id: 'beta', name: 'Beta agent', role: 'Second reviewer', label: '', description: 'Backup reviewer', notifications: false, projectId: 'project-a', timezone: 'UTC', autoReview: true, hidden: false, pinned: pinnedBeta, unread: false, sectionId: 'ops' }
      ]
    },
    [keys.data]: {
      activeChat,
      projects: [{ id: 'personal', name: 'Personal', system: true }, { id: 'project-a', name: 'Project A' }, { id: 'project-b', name: 'Project B' }],
      channels: [{ id: 'channel-one', name: 'Channel one', projectId: 'project-a', members: ['alpha', 'beta'] }],
      chats: [
        { id: 'direct-alpha', title, autoTitle: !title, sample: false, channelId: null, projectId: 'project-a', recipients: ['alpha'], draft: 'Keep this draft', pendingAttachmentNames: ['old.txt'], messages: [{ id: 'm-direct', role: 'user', text: 'Keep direct evidence', attachments: ['evidence.txt'] }] },
        { id: 'channel-chat', title: '# Channel one', sample: false, channelId: 'channel-one', projectId: 'project-a', recipients: ['alpha', 'beta'], draft: 'Channel draft', pendingAttachmentNames: [], messages: [{ id: 'm-channel', role: 'user', text: 'Keep channel evidence', attachments: [] }] },
        { id: 'multi-direct', title: 'Alpha and beta direct', sample: false, channelId: null, projectId: 'project-a', recipients: ['alpha', 'beta'], draft: 'Multi draft', pendingAttachmentNames: [], messages: [] }
      ]
    },
    [keys.docs]: {
      alpha: { 'SOUL.md': 'Alpha source', 'MEMORY.md': 'Alpha memory' },
      beta: { 'SOUL.md': 'Beta source', 'MEMORY.md': 'Beta memory' }
    }
  };
}

function encodeSeed(values) {
  return Object.fromEntries(Object.entries({ ...sentinel, ...values }).map(([key, value]) => [
    key, typeof value === 'string' ? value : JSON.stringify(value)
  ]));
}

function trackPage(page) {
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/')) {
      report.externalRequests.push({ url: request.url(), method: request.method() });
    }
  });
}

async function pageFor(seed = {}, viewport = { width: 1440, height: 900 }, options = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: options.reducedMotion });
  const page = await context.newPage();
  trackPage(page);
  await page.addInitScript(values => {
    if (sessionStorage.getItem('p4-test-seeded')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    sessionStorage.setItem('p4-test-seeded', 'yes');
  }, encodeSeed(seed));
  await page.goto(base + '/polished.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#draft').waitFor();
  return { page, context };
}

async function withPage(seed, fn, viewport, options) {
  const { page, context } = await pageFor(seed, viewport, options);
  try { return await fn(page); } finally { await context.close(); }
}

async function stored(page, key) {
  return page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)), key);
}

async function rawStorage(page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
}

async function capture(page, label) {
  const file = `p4-${label}.png`;
  await page.screenshot({ path: path.join(evidenceDir, file), fullPage: true });
  report.captures.push({ label, path: `.intentgraph/${file}` });
}

async function check(name, fn) {
  try {
    await fn();
    report.checks.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, status: 'FAIL', detail: error.message, stack: error.stack });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function unchanged(page) {
  const actual = await page.evaluate(keysToRead => Object.fromEntries(keysToRead.map(key => [key, localStorage.getItem(key)])), Object.keys(sentinel));
  assert.deepEqual(actual, sentinel, 'Unrelated local data changed');
}

async function waitForStored(page, predicate, message = 'local value did not settle') {
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    if (predicate(await stored(page, keys.prefs))) return;
    await page.waitForTimeout(60);
  }
  throw new Error(message);
}

async function openProfileViaAvatar(page) {
  await page.locator('#avatar').click();
  await page.locator('#profile-form').waitFor({ state: 'visible' });
}

async function openAgentProfile(page, id = 'beta') {
  const menu = page.locator(`[data-agent-menu="${id}"]`);
  await menu.click();
  await page.locator('#agent-context-menu').waitFor({ state: 'visible' });
  const edit = page.locator('#agent-context-menu [data-menu-action="edit"]');
  if (await edit.count()) await edit.click();
  else await page.locator(`[data-agent-open="${id}"]`).click();
  await page.locator('#profile-form').waitFor({ state: 'visible' });
}

async function profileValues(page) {
  return page.evaluate(key => {
    const prefs = JSON.parse(localStorage.getItem(key));
    const agent = prefs.agents.find(a => a.id === 'beta');
    return { agent, sections: prefs.sections };
  }, keys.prefs);
}

async function bounded(page, selector, width, height) {
  const box = await page.locator(selector).boundingBox();
  assert(box, `${selector} is visible`);
  assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1,
    `${selector} outside ${width}x${height}: ${JSON.stringify(box)}`);
}

async function contextRename(page) {
  const toggle = page.locator('[data-section-toggle="ops"]');
  await toggle.click({ button: 'right' });
  await page.locator('#agent-context-menu').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-menu-action="rename-section"]').count(), 1, 'Rename section action missing');
  await page.locator('[data-menu-action="rename-section"]').click();
  await page.locator('#workspace-create-dialog').waitFor({ state: 'visible' });
}

async function main() {
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    ignoreDefaultArgs: ['--headless'],
    args: ['--headless=new']
  });
  try {
    await check('P4 direct profile entry, per-agent immediate avatar persistence, autosave and identity split', async () => {
      await withPage(fixture(), async page => {
        assert.equal(await page.locator('#edit-agent-profile').count(), 0, 'Redundant edit profile button remains');
        await openProfileViaAvatar(page);
        assert.equal(await page.locator('#save-profile, #cancel-profile').count(), 0, 'Profile Save/Cancel must be removed');
        assert.equal(await page.locator('#edit-avatar').count(), 1);
        await page.locator('#edit-avatar').click();
        await page.locator('#avatar-picker').waitFor({ state: 'visible' });
        for (const selector of ['[data-avatar-tab="styles"]', '[data-avatar-tab="generate"]', '[data-avatar-tab="upload"]', '#avatar-reset']) assert.equal(await page.locator(selector).count(), 1, `${selector} missing`);
        assert(await page.locator('[data-avatar-style]').count() >= 8, 'Network style choices missing');
        assert(await page.locator('[data-avatar-color]').count() >= 6, 'Avatar colors missing');
        await page.locator('[data-avatar-style="router"]').click();
        await waitForStored(page, value => value.agents.find(a => a.id === 'alpha')?.avatar?.style === 'router', 'Avatar style did not autosave for active agent');
        await page.locator('[data-avatar-color]').nth(1).click();
        const alphaSaved = await stored(page, keys.prefs);
        assert.equal(alphaSaved.agents.find(a => a.id === 'alpha').avatar.style, 'router');
        assert(alphaSaved.agents.find(a => a.id === 'alpha').avatar.color, 'Avatar color did not persist');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#avatar-picker').isVisible(), false, 'Avatar chooser did not close with Escape');
        assert.equal(await page.locator('#draft').inputValue(), 'Keep this draft', 'Draft was lost by profile entry');
        await page.locator('#close-pane').click();

        await openAgentProfile(page, 'beta');
        assert.equal(await page.locator('#profile-name').inputValue(), 'Beta agent');
        assert.match(await page.locator('#surface').innerText(), /Alpha direct/, 'Inspecting beta changed conversation A');
        assert.equal(await page.locator('#profile-name').inputValue(), 'Beta agent', 'Inspected profile is not beta');
        await page.locator('#edit-avatar').click();
        await page.locator('[data-avatar-style="switch"]').click();
        await waitForStored(page, value => value.agents.find(a => a.id === 'beta')?.avatar?.style === 'switch', 'Beta avatar did not persist immediately');
        const betaAvatar = await profileValues(page);
        const betaRowAvatar = page.locator('[data-agent-row="beta"] .network-avatar');
        assert.equal(await betaRowAvatar.count(), 1, 'Beta sidebar avatar missing');
        assert.equal(await betaRowAvatar.locator('svg').count(), 1, 'Beta sidebar avatar did not update to network artwork');
        assert.equal(betaAvatar.agent.avatar.style, 'switch');

        await page.keyboard.press('Escape');
        await page.locator('#profile-label').fill('Operations');
        await page.locator('#profile-label').blur();
        await page.locator('#profile-description').fill('Updated beta description');
        await page.locator('#profile-description').blur();
        await page.locator('#profile-notifications').check();
        await waitForStored(page, value => {
          const beta = value.agents.find(a => a.id === 'beta');
          return beta?.label === 'Operations' && beta?.description === 'Updated beta description' && beta?.notifications === true;
        }, 'Profile fields did not autosave');
        const beforeInvalid = await stored(page, keys.prefs);
        await page.locator('#profile-name').fill('  Alpha agent  ');
        await page.locator('#profile-name').blur();
        await page.waitForTimeout(80);
        assert(await page.locator('#profile-status').innerText(), 'Duplicate name error was not shown inline');
        const afterInvalid = await stored(page, keys.prefs);
        assert.equal(afterInvalid.agents.find(a => a.id === 'beta').name, beforeInvalid.agents.find(a => a.id === 'beta').name, 'Invalid duplicate name was stored');
        assert.equal(afterInvalid.agents.find(a => a.id === 'beta').avatar.style, 'switch', 'Valid avatar selection was lost after invalid name');

        const savedName = afterInvalid.agents.find(a => a.id === 'beta').name;
        const originalSetItem = await page.evaluate(() => {
          window.__p4OriginalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
          return String(window.__p4OriginalSetItem);
        });
        await page.locator('#profile-label').fill('Will not persist');
        await page.locator('#profile-label').blur();
        await page.waitForTimeout(100);
        assert.match(await page.locator('#profile-status').innerText(), /save|storage|full|quota|could not/i, 'Storage failure did not produce inline status');
        await page.evaluate(() => { Storage.prototype.setItem = window.__p4OriginalSetItem; });
        const afterQuota = await stored(page, keys.prefs);
        assert.equal(afterQuota.agents.find(a => a.id === 'beta').name, savedName, 'Saved name changed after quota failure');
        assert.equal(afterQuota.agents.find(a => a.id === 'beta').avatar.style, 'switch', 'Saved avatar changed after quota failure');
        assert(originalSetItem, 'Storage override was not installed');
      });
    });

    await check('P4 upload token ordering, uploaded-image integrity and motion/reduced-motion behavior', async () => {
      await withPage(fixture(), async page => {
        await openProfileViaAvatar(page);
        await page.locator('#edit-avatar').click();
        await page.locator('[data-avatar-tab="upload"]').click();
        await page.evaluate(() => {
          window.__p4OriginalUpload = window.AvenAvatars.upload;
          window.__p4LateUploadResolve = null;
          window.AvenAvatars.upload = () => new Promise(resolve => { window.__p4LateUploadResolve = resolve; });
        });
        await page.locator('#avatar-upload').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: tinyPng });
        await page.locator('[data-avatar-tab="styles"]').click();
        await page.locator('[data-avatar-style="firewall"]').click();
        await page.evaluate(data => window.__p4LateUploadResolve(data), tinyDataUrl);
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#edit-avatar img').count(), 0, 'Late upload overwrote a newer style selection');
        assert.equal(await page.locator('[data-avatar-style="firewall"]').getAttribute('aria-pressed'), 'true');

        await page.evaluate(() => { window.AvenAvatars.upload = window.__p4OriginalUpload; });
        await page.locator('[data-avatar-tab="upload"]').click();
        await page.locator('#avatar-upload').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: tinyPng });
        await page.locator('#edit-avatar img').waitFor({ state: 'visible', timeout: 5000 });
        const imageMotion = await page.locator('#edit-avatar img').evaluate(node => ({ animation: getComputedStyle(node).animationName, transform: getComputedStyle(node).transform }));
        assert.equal(imageMotion.animation, 'none', 'Uploaded image received a mascot animation');
        assert.equal(imageMotion.transform, 'none', 'Uploaded image was transformed');
        assert.equal(await page.locator('#profile-status').count(), 1);

        await page.locator('[data-avatar-tab="styles"]').click();
        await page.locator('[data-avatar-style="router"]').click();
        const motion = await page.evaluate(() => {
          const root = document.querySelector('#agent-list [data-agent-row="alpha"] .network-avatar');
          const eyes = root?.querySelector('.avatar-eyes');
          const antenna = root?.querySelector('.avatar-antenna');
          const waves = getComputedStyle(root, '::after');
          const animations = root ? root.getAnimations({ subtree: true }).map(a => ({ name: a.animationName, start: a.currentTime })) : [];
          return { eyes: !!eyes, antenna: !!antenna, waves: waves.animationName, animations };
        });
        assert(motion.eyes && motion.antenna, 'Mascot eye/antenna classes missing');
        assert.notEqual(motion.waves, 'none', 'Network signal wave animation missing');
        assert(motion.animations.length > 0, 'No mascot animation is running');
        await page.waitForTimeout(140);
        const progressed = await page.evaluate(() => document.querySelector('#edit-avatar .network-avatar')?.getAnimations({ subtree: true }).some(a => Number(a.currentTime || 0) > 0));
        assert(progressed, 'Mascot animation did not progress');
      });

      await withPage(fixture(), async page => {
        await openProfileViaAvatar(page);
        const reduced = await page.evaluate(() => {
          const root = document.querySelector('#agent-list [data-agent-row="alpha"] .network-avatar');
          return {
            root: getComputedStyle(root).animationName,
            after: getComputedStyle(root, '::after').animationName,
            animations: root.getAnimations({ subtree: true }).length
          };
        });
        assert.equal(reduced.root, 'none', 'Reduced motion did not disable root animation');
        assert.equal(reduced.after, 'none', 'Reduced motion did not disable signal pulse');
        assert.equal(reduced.animations, 0, 'Reduced motion left mascot animations running');
      }, { width: 1440, height: 900 }, { reducedMotion: 'reduce' });
    });

    await check('P4 avatar size and visible mascot coverage', async () => {
      await withPage(fixture(), async page => {
        const small = await page.locator('#agent-list [data-agent-row="alpha"] .network-avatar').boundingBox();
        assert(small, 'Sidebar avatar missing');
        assert(Math.abs(small.width - 44) < 1 && Math.abs(small.height - 44) < 1, `Sidebar avatar is not 44px: ${JSON.stringify(small)}`);
        const coverage = await page.locator('#agent-list [data-agent-row="alpha"] .network-avatar svg').boundingBox();
        assert(coverage && coverage.width >= 40 && coverage.height >= 40, 'Network artwork is not visibly larger inside sidebar box');
        const css = fs.readFileSync(path.join(root, 'polished.css'), 'utf8');
        assert.match(css, /\.network-avatar\.avatar-small\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s, '44px sidebar box CSS missing');
        assert.match(css, /\.avatar-eyes/);
        assert.match(css, /\.avatar-antenna/);
        assert.match(css, /\.network-avatar::after/);
        assert.match(css, /prefers-reduced-motion/);
      });
    });

    await check('P4 custom section collapse persistence, hover/focus chevron and rename validation', async () => {
      await withPage(fixture(), async page => {
        for (const id of ['ops', 'other']) {
          assert.equal(await page.locator(`[data-section-toggle="${id}"]`).count(), 1, `${id} section toggle missing`);
          assert.equal(await page.locator(`[data-section-body="${id}"]`).count(), 1, `${id} section body missing`);
        }
        assert.equal(await page.locator('[data-section-body="ops"] [data-agent-row="beta"]').count(), 1, 'Beta member missing from Operations');
        const toggle = page.locator('[data-section-toggle="ops"]');
        const chevron = toggle.locator('.section-chevron');
        assert.equal(await chevron.count(), 1, 'Section chevron missing');
        const initialChevron = await chevron.evaluate(node => ({ opacity: getComputedStyle(node).opacity, visibility: getComputedStyle(node).visibility }));
        await toggle.hover();
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-section-toggle="ops"] .section-chevron')).opacity) > 0.9, undefined, { timeout: 1500 });
        const hoveredChevron = await chevron.evaluate(node => ({ opacity: getComputedStyle(node).opacity, visibility: getComputedStyle(node).visibility }));
        assert(Number(hoveredChevron.opacity) > Number(initialChevron.opacity) || hoveredChevron.visibility !== initialChevron.visibility, 'Chevron is visible before hover or does not appear on hover');
        await page.mouse.move(2, 2);
        await page.waitForTimeout(180);
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-section-toggle="ops"] .section-chevron')).opacity) < 0.05, undefined, { timeout: 1500 });
        await toggle.focus();
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-section-toggle="ops"] .section-chevron')).opacity) > 0.9, undefined, { timeout: 1500 });
        const focusedChevron = await chevron.evaluate(node => ({ opacity: getComputedStyle(node).opacity, visibility: getComputedStyle(node).visibility }));
        assert(Number(focusedChevron.opacity) > Number(initialChevron.opacity) || focusedChevron.visibility !== initialChevron.visibility, 'Chevron does not appear on focus');

        await toggle.click();
        assert.equal(await page.locator('[data-section-body="ops"]').getAttribute('hidden'), '');
        await page.reload({ waitUntil: 'domcontentloaded' });
        assert.equal(await page.locator('[data-section-body="ops"]').getAttribute('hidden'), '', 'Collapsed section did not persist after reload');
        await page.locator('[data-section-toggle="ops"]').click();

        const before = await stored(page, keys.prefs);
        await contextRename(page);
        assert.equal(await page.locator('#workspace-create-dialog').count(), 1);
        for (const selector of ['#section-name', '#rename-section', '#cancel-section', '#section-status']) assert.equal(await page.locator(selector).count(), 1, `${selector} missing`);
        await page.locator('#section-name').fill(' ');
        await page.locator('#rename-section').click();
        assert(await page.locator('#section-status').innerText(), 'Blank section name was accepted');
        await page.locator('#section-name').fill('Other');
        await page.locator('#rename-section').click();
        assert.match(await page.locator('#section-status').innerText(), /already|duplicate|exists|uses that name/i, 'Duplicate section name was accepted');
        assert.equal(await page.locator('#workspace-create-dialog').isVisible(), true, 'Duplicate rename unexpectedly closed the dialog');
        await page.locator('#section-name').fill('Operations Updated');
        await page.locator('#rename-section').press('Enter');
        await page.locator('#workspace-create-dialog').waitFor({ state: 'hidden' });
        const after = await stored(page, keys.prefs);
        assert.equal(after.sections.find(s => s.id === 'ops').name, 'Operations Updated');
        assert.equal(after.agents.find(a => a.id === 'beta').sectionId, 'ops', 'Member assignment changed during rename');
        assert.equal(after.sections.find(s => s.id === 'ops').collapsed, before.sections.find(s => s.id === 'ops').collapsed, 'Collapse state changed during rename');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.sectionToggle), 'ops', 'Rename did not restore focus to section toggle');

        await contextRename(page);
        await page.locator('#section-name').fill('Cancelled name');
        await page.keyboard.press('Escape');
        await page.locator('#workspace-create-dialog').waitFor({ state: 'hidden' });
        assert.equal((await stored(page, keys.prefs)).sections.find(s => s.id === 'ops').name, 'Operations Updated', 'Escape did not cancel rename');
        await page.waitForFunction(() => document.activeElement?.dataset.sectionToggle === 'ops', undefined, { timeout: 1500 });
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.sectionToggle), 'ops', 'Escape did not restore section focus');
        await capture(page, 'sections-renamed');
      });

      await withPage(fixture({ pinnedBeta: true }), async page => {
        assert.equal(await page.locator('[data-section-body="ops"] [data-agent-row="beta"]').count(), 0, 'Pinned agent was duplicated in custom section');
        assert.equal(await page.locator('#agent-list [data-agent-row="beta"]').count(), 1, 'Pinned agent disappeared');
        const sidebarText = await page.locator('#agent-list').innerText();
        assert(sidebarText.indexOf('Pinned') >= 0 && sidebarText.indexOf('Beta agent') > sidebarText.indexOf('Pinned'), 'Pinned label/order missing');
        const betaSection = await page.locator('#agent-list [data-agent-row="beta"]').evaluate(node => node.closest('[data-section-body]')?.dataset.sectionBody || 'pinned');
        assert.equal(betaSection, 'pinned', 'Pinned placement did not take precedence');
      });
    });

    await check('P4 composer add menu stays above and accessible across desktop and mobile viewports', async () => {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
        await withPage(fixture(), async page => {
          const anchor = page.locator('#tools-menu');
          await anchor.click();
          const menu = page.locator('#add-menu');
          await menu.waitFor({ state: 'visible' });
          const menuBox = await menu.boundingBox();
          const composerBox = await page.locator('#composer').boundingBox();
          assert(menuBox && composerBox, 'Composer or add menu missing');
          assert(menuBox.y + menuBox.height <= composerBox.y - 4, `Menu is not above composer at ${viewport.width}x${viewport.height}`);
          assert(menuBox.x >= -1 && menuBox.y >= -1 && menuBox.x + menuBox.width <= viewport.width + 1 && menuBox.y + menuBox.height <= viewport.height + 1, `Add menu escapes viewport at ${viewport.width}x${viewport.height}`);
          assert(await page.locator('#draft').isVisible() && await page.locator('#send').isVisible() && await anchor.isVisible(), 'Composer controls were covered or hidden');
          assert.equal(await menu.locator('button[data-add]').count(), 5, 'Current add-menu item count changed');
          assert.deepEqual(await menu.locator('button[data-add]').evaluateAll(nodes => nodes.map(node => node.dataset.add)), ['files', 'images', 'browser', 'plugins', 'computer'], 'Current add-menu options changed');
          await page.keyboard.press('ArrowDown');
          assert(await menu.locator(':focus').count() === 1, 'Arrow key did not move focus in add menu');
          await page.keyboard.press('Escape');
          assert.equal(await menu.isVisible(), false, 'Escape did not dismiss add menu');
          assert.equal(await page.evaluate(() => document.activeElement?.id), 'tools-menu', 'Escape did not return focus to composer anchor');
          await anchor.click();
          await page.locator('#surface').click();
          assert.equal(await menu.isVisible(), false, 'Clickaway did not dismiss add menu');
          if (viewport.width <= 390) {
            if (await page.locator('#rail').evaluate(node => node.classList.contains('expanded'))) await page.locator('#toggle').click();
            await capture(page, `main-collapsed-${viewport.width}`);
          }
          await capture(page, `menu-${viewport.width}`);
        }, viewport);
      }
    });

    await check('P4 accepted settings, keyboard and local preservation regressions', async () => {
      await withPage(fixture({ title: '' }), async page => {
        const rawBefore = await rawStorage(page);
        await page.locator('#account-button').click();
        await page.locator('#account-menu').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#account-menu [role="menuitem"]').count(), 6, 'Account menu no longer has six items');
        await page.locator('[data-account-action="settings"]').click();
        await page.locator('#settings-dialog').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[data-category]').count(), 7, 'Settings categories regressed');
        await page.locator('#close-settings').click();

        const pendingBeforeSend = (await stored(page, keys.data)).chats.find(chat => chat.id === 'direct-alpha').pendingAttachmentNames;
        assert(pendingBeforeSend.includes('old.txt'), 'Fixture pending attachment metadata missing before keyboard test');
        const beforeMessages = await page.locator('#conversation .message').count();
        await page.locator('#draft').fill('First keyboard message');
        await page.locator('#draft').press('Shift+Enter');
        assert.match(await page.locator('#draft').inputValue(), /\n/, 'Shift+Enter did not insert a newline');
        await page.locator('#draft').fill('First keyboard message');
        await page.locator('#draft').press('Enter');
        assert.equal(await page.locator('#conversation .message').count(), beforeMessages + 1, 'Enter did not send locally');

        await page.locator('#quick-create').click();
        await page.locator('[data-create="agent"]').click();
        await page.locator('#workspace-create-dialog').waitFor({ state: 'visible' });
        for (const selector of ['#workspace-create-name', '#workspace-create-role', '#workspace-create-project']) assert.equal(await page.locator(selector).count(), 1, `${selector} creation field missing`);
        await page.locator('#close-workspace-create').click();
        assert.equal(await page.locator('#workspace-create-dialog').isVisible(), false);

        await openProfileViaAvatar(page);
        assert.equal(await page.locator('[data-doc="SOUL.md"]').count(), 1, 'SOUL.md document control missing');
        await page.locator('[data-doc="SOUL.md"]').click();
        assert.equal(await page.locator('#save-doc').count(), 1, 'Document Save control missing');
        await page.locator('#doc-textarea').fill('Changed only in regression check');
        await page.locator('#save-doc').click();
        assert.match(await page.locator('#doc-status').innerText(), /saved/i, 'Document Save did not remain explicit');
        await page.locator('#close-pane').click();
        const rawAfter = await rawStorage(page);
        for (const key of Object.keys(sentinel)) assert.equal(rawAfter[key], rawBefore[key], `${key} changed`);
        await capture(page, 'profile-and-regression');
      });
    });

    await check('P4 protected wireframe sources and candidate stability', async () => {
      const expectedPath = path.join(evidenceDir, 'polished-baseline-hashes.json');
      const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8').replace(/^\uFEFF/, ''));
      for (const file of expected) assert.equal(sha256(file.path), file.sha256.toLowerCase(), file.path);
    });

    await check('P4 no page errors or external runtime requests', async () => {
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.externalRequests, []);
    });
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    report.candidateEnd = fingerprint();
    report.candidateStable = JSON.stringify(report.candidateStart) === JSON.stringify(report.candidateEnd);
    if (!report.candidateStable) report.checks.push({ name: 'Candidate stability', status: 'STALE', detail: 'Reviewed sources changed during the run.' });
    const output = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(evidenceDir, 'p4-test-results.json'), output);
    console.log(`Stable candidate: ${report.candidateStable}`);
    console.log(`Results: ${path.join(evidenceDir, 'p4-test-results.json')}`);
    if (report.checks.some(result => result.status === 'FAIL') || report.checks.some(result => result.status === 'STALE') || report.errors.length || report.externalRequests.length) process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
