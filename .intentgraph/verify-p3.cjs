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
// Four reviewed source hashes are kept in the report. polished.js is tracked as
// a runtime hash as well so a concurrent product edit still invalidates evidence.
const sourceFiles = ['polished.html', 'polished.css', 'polished-avatars.js', 'prototype-review.html'];
const runtimeFile = 'polished.js';
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const fingerprint = () => Object.fromEntries(sourceFiles.map(file => [file, sha256(file)]));
const runtimeHash = () => sha256(runtimeFile);

const report = {
  baseline: 'F08-P3',
  startedAt: new Date().toISOString(),
  sourceFiles,
  candidateStart: fingerprint(),
  runtimeStart: runtimeHash(),
  checks: [],
  captures: [],
  errors: [],
  externalRequests: []
};

const sentinel = {
  'p3-unrelated-project-data': 'KEEP RAW VALUE',
  'aven-wireframe-conversations-v1': '{"untouched":true}'
};
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
let browser;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture({ title = 'Alpha direct', activeChat = 'direct-alpha' } = {}) {
  return {
    [keys.prefs]: {
      theme: 'dark', displayName: 'Review user', activeAgent: 'alpha', sections: [],
      agents: [
        { id: 'alpha', name: 'Alpha agent', role: 'Owns direct review', label: 'Core', description: 'Primary local reviewer', notifications: true, projectId: 'project-a', timezone: 'Follow system', autoReview: false, hidden: false, pinned: false, unread: false },
        { id: 'beta', name: 'Beta agent', role: 'Second reviewer', label: '', description: 'Backup reviewer', notifications: false, projectId: 'project-a', timezone: 'UTC', autoReview: true, hidden: false, pinned: false, unread: false }
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
    key,
    typeof value === 'string' ? value : JSON.stringify(value)
  ]));
}

async function pageFor(seed = {}, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/')) {
      report.externalRequests.push({ url: request.url(), method: request.method() });
    }
  });
  await page.addInitScript(values => {
    if (sessionStorage.getItem('p3-test-seeded')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    sessionStorage.setItem('p3-test-seeded', 'yes');
  }, encodeSeed(seed));
  await page.goto(base + '/polished.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#draft').waitFor();
  return { page, context };
}

async function withPage(seed, fn, viewport) {
  const { page, context } = await pageFor(seed, viewport);
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

async function stored(page, key) {
  return page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)), key);
}

async function rawStorage(page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
}

async function capture(page, label) {
  const file = `p3-${label}.png`;
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

async function openAccount(page) {
  await page.locator('#account-button').click();
  await page.locator('#account-menu').waitFor({ state: 'visible' });
}

async function openSettings(page, category = 'general') {
  await openAccount(page);
  await page.locator('[data-account-action="settings"]').click();
  await page.locator('#settings-dialog').waitFor({ state: 'visible' });
  if (category) await page.locator(`[data-category="${category}"]`).click();
}

async function create(page, type, name, role = 'Review local network evidence.') {
  await page.locator('#quick-create').click();
  await page.locator(`[data-create="${type}"]`).click();
  if (type === 'chat') return;
  await page.locator('dialog[open]').waitFor();
  if (name) await page.locator('#workspace-create-name').fill(name);
  if (type === 'agent' && await page.locator('#workspace-create-role').count()) await page.locator('#workspace-create-role').fill(role);
}

async function openContext(page, id = 'alpha') {
  await page.locator(`[data-agent-menu="${id}"]`).click();
  await page.locator('#agent-context-menu').waitFor({ state: 'visible' });
}

async function openProfile(page, id = 'alpha') {
  await openContext(page, id);
  await page.locator('[data-menu-action="edit"]').click();
  await page.locator('#right-pane').waitFor({ state: 'visible' });
  await page.locator('#profile-form').waitFor({ state: 'visible' });
}

async function bounded(page, selector, width, height) {
  const box = await page.locator(selector).boundingBox();
  assert(box, `${selector} is visible`);
  assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1,
    `${selector} outside ${width}x${height}: ${JSON.stringify(box)}`);
}

function luminance(color) {
  const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

async function themeColors(page) {
  return page.evaluate(() => Object.fromEntries(['bg', 'surface', 'text', 'muted', 'faint', 'accent', 'on-accent', 'selected', 'focus'].map(name => {
    const probe = document.createElement('i');
    probe.style.color = `var(--${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return [name, value];
  })));
}

async function main() {
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    ignoreDefaultArgs: ['--headless'],
    args: ['--headless=new']
  });
  try {
    await check('P3 preservation: migration backup, local records, drafts and idempotent reload', async () => {
      const before = fixture();
      await withPage(before, async page => {
        const after = await stored(page, keys.data);
        assert.equal(after.chats.length, before[keys.data].chats.length);
        for (const oldChat of before[keys.data].chats) {
          const next = after.chats.find(chat => chat.id === oldChat.id);
          assert(next, `Missing chat ${oldChat.id}`);
          for (const field of ['title', 'channelId', 'recipients', 'draft', 'pendingAttachmentNames', 'messages']) {
            assert.deepEqual(next[field], oldChat[field], `${field} must survive migration`);
          }
        }
        assert.deepEqual(await stored(page, keys.docs), before[keys.docs], 'SOUL/MEMORY data must survive');
        const raw = await rawStorage(page);
        const backups = Object.entries(raw).filter(([key]) => /backup/i.test(key));
        assert(backups.length, 'A raw migration backup is required');
        for (const key of [keys.prefs, keys.data, keys.docs]) {
          assert(backups.some(([, value]) => value.includes(key)), `Backup must mention ${key}`);
        }
        const saved = await stored(page, keys.data);
        await page.reload();
        assert.deepEqual(await stored(page, keys.data), saved, 'Migration must be idempotent');
        assert.equal(await page.locator('#draft').inputValue(), 'Keep this draft');
        await unchanged(page);
      });
    });

    await check('P3 composer, title, search, attachments and quiet navigation affordances', async () => {
      const fresh = fixture({ title: '' });
      fresh[keys.data].chats[0].messages = [];
      await withPage(fresh, async page => {
        assert.equal(await page.locator('#recipient-picker').count(), 0, 'Composer To selector must be removed');
        assert.equal(await page.locator('#composer').getByText('To:', { exact: false }).count(), 0);
        for (const selector of ['#tools-menu', '#draft', '#send']) assert.equal(await page.locator(`#composer ${selector}`).count(), 1, `${selector} remains in composer`);
        assert.equal(await page.locator('#center-eyebrow').count(), 0, 'Conversation eyebrow must be removed');
        assert.equal(await page.locator('#chat-location').count(), 0, 'Project/context header label must be removed');
        const headerOrder = await page.evaluate(() => {
          const avatar = document.getElementById('avatar');
          const surface = document.getElementById('surface');
          return !!avatar && !!surface && !!(avatar.compareDocumentPosition(surface) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        assert(headerOrder, 'Header avatar must precede the conversation title');
        const headerText = await page.locator('.center-header').innerText();
        assert.doesNotMatch(headerText, /CONVERSATION|local workspace|Personal\s*·/i);

        const searchBackground = await page.locator('#search-nav').evaluate(node => getComputedStyle(node).backgroundColor);
        const toggleBackground = await page.locator('#toggle').evaluate(node => getComputedStyle(node).backgroundColor);
        assert.notEqual(searchBackground, 'rgba(0, 0, 0, 0)', 'Search must have a persistent filled background');
        assert.equal(toggleBackground, 'rgba(0, 0, 0, 0)', 'Collapse control must stay quiet by default');
        assert.equal(await page.locator('#toggle.is-active, #toggle[aria-pressed="true"]').count(), 0);
        for (const chevron of await page.locator('.group-chevron').all()) {
          assert(Number(await chevron.evaluate(node => getComputedStyle(node).opacity)) <= .05, 'Chevron must be hidden at rest');
        }
        const firstGroup = page.locator('[data-group-toggle="agents"]');
        await firstGroup.hover();
        const chevronSelector = '[data-sidebar-group="agents"] .group-chevron';
        await page.waitForFunction(selector => Number(getComputedStyle(document.querySelector(selector)).opacity) > .9, chevronSelector);
        assert(Number(await page.locator(chevronSelector).evaluate(node => getComputedStyle(node).opacity)) > .9, 'Chevron must appear on hover');
        await page.mouse.move(1000, 20);
        await firstGroup.focus();
        await page.waitForFunction(selector => Number(getComputedStyle(document.querySelector(selector)).opacity) > .9, chevronSelector);
        assert(Number(await page.locator(chevronSelector).evaluate(node => getComputedStyle(node).opacity)) > .9, 'Chevron must appear on focus');

        const beforeMessages = (await stored(page, keys.data)).chats.find(chat => chat.id === 'direct-alpha').messages.length;
        const firstLine = 'Investigate the branch uplink and summarize the packet-loss evidence in this local thread. Extra words should be trimmed.';
        await page.locator('#draft').fill(`${firstLine}\nA second line is part of the message.`);
        await page.locator('#draft').press('Enter');
        const sent = await stored(page, keys.data);
        assert.equal(sent.chats.find(chat => chat.id === 'direct-alpha').messages.length, beforeMessages + 1, 'Enter must send');
        assert.equal(await page.locator('#draft').inputValue(), '');
        const autoTitle = await page.locator('#surface').innerText();
        assert(autoTitle.length > 0 && autoTitle.length <= 56, `Auto title length ${autoTitle.length}`);
        assert(autoTitle.startsWith(firstLine.trim().slice(0, Math.min(24, firstLine.length))), 'Auto title must derive from first message line');

        await page.locator('#draft').fill('line one');
        await page.locator('#draft').press('Shift+Enter');
        await page.locator('#draft').press('x');
        assert.equal((await stored(page, keys.data)).chats.find(chat => chat.id === 'direct-alpha').messages.length, beforeMessages + 1, 'Shift+Enter must not send');
        assert.match(await page.locator('#draft').inputValue(), /line one\nx/);
        await page.locator('#draft').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
        assert.equal((await stored(page, keys.data)).chats.find(chat => chat.id === 'direct-alpha').messages.length, beforeMessages + 1, 'IME Enter must not send');

        await page.locator('#file-picker').setInputFiles({ name: 'policy.txt', mimeType: 'text/plain', buffer: Buffer.from('local fixture') });
        assert.match(await page.locator('#attachments').innerText(), /policy\.txt/);
        await page.locator('#draft').fill('Find this policy evidence');
        await page.locator('#draft').press('Enter');
        await page.locator('#search-nav').click();
        await page.locator('#global-search').fill('Find this policy evidence');
        assert.match(await page.locator('#search-results').innerText(), /Find this policy evidence/);
        await page.keyboard.press('Escape');
        await capture(page, 'composer-search');
        await unchanged(page);
      });

      const custom = fixture({ title: 'Existing custom title' });
      custom[keys.data].chats[0].messages = [];
      await withPage(custom, async page => {
        await page.locator('#draft').fill('This must not rename a custom conversation');
        await page.locator('#draft').press('Enter');
        assert.equal(await page.locator('#surface').innerText(), 'Existing custom title', 'Custom title must be preserved');
      });
    });

    await check('P3 creation: fields, ownership, channel membership and right-side profile entrypoint', async () => {
      await withPage(fixture(), async page => {
        await create(page, 'project', 'Network operations');
        await page.locator('#finish-workspace-create').click();
        await create(page, 'agent', 'Firewall analyst');
        assert.equal(await page.locator('#workspace-create-name').count(), 1);
        assert.equal(await page.locator('#workspace-create-role').count(), 1);
        assert.equal(await page.locator('#workspace-create-project').count(), 1);
        assert.equal(await page.locator('#workspace-create-timezone, #workspace-create-auto-review').count(), 0, 'Create Agent must not duplicate behavior preferences');
        assert.doesNotMatch(await page.locator('#create-dialog-body').innerText(), /time zone|automatic review|auto-review/i);
        await page.locator('#workspace-create-project').selectOption({ label: 'Network operations' });
        await capture(page, 'create-agent');
        await page.locator('#finish-workspace-create').click();
        let prefs = await stored(page, keys.prefs);
        const agent = prefs.agents.find(value => value.name === 'Firewall analyst');
        assert(agent, 'Created agent must persist');
        let data = await stored(page, keys.data);
        const direct = data.chats.find(chat => chat.recipients?.length === 1 && chat.recipients[0] === agent.id);
        assert(direct, 'Created agent must open an immediate conversation');
        assert.equal(data.projects.find(project => project.id === direct.projectId).name, 'Network operations');

        await create(page, 'channel', 'Change review');
        await page.locator('#workspace-create-project').selectOption({ label: 'Network operations' });
        const members = page.locator('#workspace-create-recipients input[type="checkbox"]');
        assert((await members.count()) >= 2, 'Channel membership remains outside the composer');
        await page.locator('#workspace-create-recipients label').filter({ hasText: 'Firewall analyst' }).locator('input').check();
        await page.locator('#finish-workspace-create').click();
        data = await stored(page, keys.data);
        const channel = data.channels.find(value => value.name === 'Change review');
        assert(channel && channel.members.includes(agent.id));
        const channelChat = data.chats.find(chat => chat.channelId === channel.id);
        assert(channelChat && channelChat.recipients.includes(agent.id));

        await openContext(page, agent.id);
        await page.locator('[data-menu-action="edit"]').click();
        await page.locator('#profile-form').waitFor({ state: 'visible' });
        assert.equal(await page.locator('dialog[open]').count(), 0, 'Edit Profile must not block the center with a dialog');
        assert.match(await page.locator('#pane-title').innerText(), /profile|agent/i);
        assert.equal(await page.locator('#agent-timezone, #agent-auto-review').count(), 0);
        assert.doesNotMatch(await page.locator('#pane-content').innerText(), /time zone|automatic review|auto-review/i);
        await capture(page, 'profile-entrypoint');
        await page.locator('#cancel-profile').click();
        await page.locator('#edit-agent-profile').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[data-doc="SOUL.md"]').count(), 1);
        assert.equal(await page.locator('[data-doc="MEMORY.md"]').count(), 1);
        assert.equal(await page.locator('#edit-agent-profile').count(), 1);
      });
    });

    await check('P3 profile and avatar journey: local styles, generate, invalid/valid upload, isolation and reload', async () => {
      await withPage(fixture(), async page => {
        await openProfile(page);
        for (const selector of ['#profile-name', '#profile-label', '#profile-description', '#profile-notifications', '#save-profile', '#cancel-profile']) {
          assert.equal(await page.locator(selector).count(), 1, `${selector} missing`);
        }
        const originalPrefs = await stored(page, keys.prefs);
        const originalDescription = originalPrefs.agents.find(agent => agent.id === 'alpha').description;
        await page.locator('#profile-label').fill('Core network reviewer');
        await page.locator('#profile-description').fill('Keeps local routing investigations focused.');
        const notifications = page.locator('#profile-notifications');
        if (await notifications.getAttribute('type') === 'checkbox') await notifications.check();
        else await notifications.fill('true');

        await page.locator('#edit-avatar').click();
        await page.locator('#avatar-picker').waitFor({ state: 'visible' });
        for (const tab of ['styles', 'generate', 'upload']) assert.equal(await page.locator(`[data-avatar-tab="${tab}"]`).count(), 1, `${tab} avatar tab missing`);
        for (const style of ['router', 'switch', 'firewall', 'mesh', 'cloud', 'rack', 'wireless', 'fiber']) assert.equal(await page.locator(`[data-avatar-style="${style}"]`).count(), 1, `${style} avatar style missing`);
        assert(await page.locator('[data-avatar-color]').count() >= 4, 'Network palette is missing');
        await page.locator('[data-avatar-style="router"]').click();
        await page.locator('[data-avatar-color]').first().click();
        await page.locator('#avatar-color-custom').fill('#123456');
        await page.locator('#avatar-color-custom').dispatchEvent('input');
        await page.locator('[data-avatar-tab="generate"]').click();
        await page.locator('#avatar-prompt').fill('fiber router variation');
        await page.locator('#avatar-generate').click();
        await page.locator('#avatar-status').waitFor();
        await page.locator('[data-avatar-tab="styles"]').click();
        await page.locator('#avatar-reset').click();
        assert.equal(await page.locator('[data-avatar-style][aria-pressed="true"]').count(), 1, 'Reset must return to a deterministic network style');
        await page.locator('[data-avatar-style="router"]').click();
        await page.locator('#avatar-color-custom').fill('#123456');
        await page.locator('#avatar-color-custom').dispatchEvent('input');
        await page.locator('[data-avatar-tab="upload"]').click();
        await page.locator('#avatar-upload').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
        await page.waitForTimeout(100);
        assert.match(await page.locator('#avatar-status').innerText(), /PNG|JPEG|WebP|image|choose|invalid/i, 'Invalid avatar must be rejected');
        await page.locator('#avatar-upload').setInputFiles({ name: 'valid.png', mimeType: 'image/png', buffer: tinyPng });
        await page.waitForFunction(() => /ready|uploaded|saved|local/i.test(document.getElementById('avatar-status')?.innerText || ''), null, { timeout: 3000 });
        assert.match(await page.locator('#avatar-status').innerText(), /ready|uploaded|saved|local/i, 'Valid avatar upload must report local success');
        assert.equal(await page.locator('#avatar-reset').count(), 1);
        await capture(page, 'avatar-picker');
        await page.locator('#save-profile').click();
        const savedPrefs = await stored(page, keys.prefs);
        const savedAgent = savedPrefs.agents.find(agent => agent.id === 'alpha');
        assert.equal(savedAgent.label, 'Core network reviewer');
        assert.equal(savedAgent.description, 'Keeps local routing investigations focused.');
        assert(savedAgent.avatar && /^#[0-9a-f]{6}$/i.test(savedAgent.avatar.color || ''));
        assert(savedAgent.avatar.image, 'Valid upload must persist a local image');
        assert(await page.locator('.network-avatar').count() >= 3, 'Header, sidebar and profile must share network avatars');
        assert(await page.locator('.network-avatar img').count() >= 1, 'Uploaded image must render in avatar surfaces');

        await page.locator('#edit-agent-profile').click();
        await page.locator('#profile-description').fill('Unsaved profile edit');
        const afterSave = await stored(page, keys.prefs);
        await page.locator('#cancel-profile').click();
        assert.equal((await stored(page, keys.prefs)).agents.find(agent => agent.id === 'alpha').description, afterSave.agents.find(agent => agent.id === 'alpha').description, 'Cancel must isolate unsaved edits');
        await page.locator('#edit-agent-profile').click();
        await page.locator('#profile-description').fill('Guarded close edit');
        page.once('dialog', dialog => dialog.dismiss());
        await page.locator('#close-pane').click();
        assert.equal(await page.locator('#profile-form').count(), 1, 'Close guard must keep dirty profile open when dismissed');
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#close-pane').click();
        await page.locator('#right-pane').waitFor({ state: 'hidden' });
        await page.reload();
        await page.locator('#avatar').click();
        assert.equal((await stored(page, keys.prefs)).agents.find(agent => agent.id === 'alpha').avatar.image, savedAgent.avatar.image, 'Avatar must persist for the same agent after reload');
        assert.equal(await page.locator('#active-agent').inputValue(), 'alpha');
        await page.locator('#edit-agent-profile').click();
        assert.equal(await page.locator('#profile-description').inputValue(), 'Keeps local routing investigations focused.');
        assert.notEqual(originalDescription, 'Keeps local routing investigations focused.');
      });
    });

    await check('P3 context actions: pin, unread, section/project move, hide, delete and restore', async () => {
      await withPage(fixture(), async page => {
        const docsBefore = await stored(page, keys.docs);
        await openContext(page);
        await page.locator('[data-menu-action="pin"]').click();
        assert.equal((await stored(page, keys.prefs)).agents.find(agent => agent.id === 'alpha').pinned, true);
        await openContext(page);
        await page.locator('[data-menu-action="unread"]').click();
        assert.equal((await stored(page, keys.prefs)).agents.find(agent => agent.id === 'alpha').unread, true);
        await openContext(page);
        await page.locator('[data-menu-action="move-section"]').click();
        await page.locator('#move-target').selectOption('__new');
        await page.locator('#new-section-name').fill('Operations');
        await page.locator('#save-move').click();
        let prefs = await stored(page, keys.prefs);
        assert(prefs.agents.find(agent => agent.id === 'alpha').sectionId);
        await openContext(page);
        await page.locator('[data-menu-action="pin"]').click();
        assert.match(await page.locator('#agent-list').innerText(), /Operations/);
        await openContext(page);
        await page.locator('[data-menu-action="move-project"]').click();
        await page.locator('#move-target').selectOption('project-b');
        await page.locator('#save-move').click();
        let data = await stored(page, keys.data);
        assert.equal(data.chats.find(chat => chat.id === 'direct-alpha').projectId, 'project-b');
        assert.equal(data.chats.find(chat => chat.id === 'channel-chat').projectId, 'project-a', 'Channel ownership must remain fixed');
        const dataBeforeDelete = clone(data);
        await openContext(page);
        await page.locator('[data-menu-action="hide"]').click();
        assert.equal(await page.locator('[data-agent-row="alpha"]').count(), 0);
        await openSettings(page, 'agents');
        await page.locator('[data-restore-agent="alpha"]').click();
        await page.locator('#cancel-settings').click();
        assert.equal((await stored(page, keys.prefs)).agents.find(agent => agent.id === 'alpha').hidden, false);
        await openContext(page);
        page.once('dialog', dialog => dialog.dismiss());
        await page.locator('[data-menu-action="delete"]').click();
        assert.notEqual((await stored(page, keys.prefs)).agents.find(agent => agent.id === 'alpha').archived, true);
        await openContext(page);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('[data-menu-action="delete"]').click();
        prefs = await stored(page, keys.prefs);
        assert.equal(prefs.agents.find(agent => agent.id === 'alpha').archived, true);
        assert.deepEqual(await stored(page, keys.data), dataBeforeDelete, 'Delete must retain conversations');
        assert.deepEqual(await stored(page, keys.docs), docsBefore, 'Delete must retain documents');
        await openSettings(page, 'agents');
        await page.locator('[data-restore-agent="alpha"]').click();
        await page.locator('#cancel-settings').click();
        assert.equal((await stored(page, keys.prefs)).agents.find(agent => agent.id === 'alpha').archived, false);
        await capture(page, 'context-menu');
      });
    });

    await check('P3 agent details: SOUL/MEMORY, document isolation, files and deterministic tool states', async () => {
      await withPage(fixture(), async page => {
        await page.locator('#avatar').click();
        assert.match(await page.locator('#pane-content').innerText(), /SOUL\.md/);
        assert.match(await page.locator('#pane-content').innerText(), /MEMORY\.md/);
        assert.equal(await page.locator('#agent-timezone, #agent-auto-review').count(), 0);
        await page.locator('[data-doc="SOUL.md"]').click();
        await page.locator('#doc-textarea').fill('Alpha-specific local policy');
        await page.locator('#save-doc').click();
        await page.locator('#back-doc').click();
        await page.locator('#active-agent').selectOption('beta');
        await page.locator('[data-doc="SOUL.md"]').click();
        assert.notEqual(await page.locator('#doc-textarea').inputValue(), 'Alpha-specific local policy');
        await page.locator('#cancel-doc').click();
        await page.locator('#active-agent').selectOption('alpha');
        await page.locator('[data-doc="SOUL.md"]').click();
        assert.equal(await page.locator('#doc-textarea').inputValue(), 'Alpha-specific local policy');
        await page.locator('#back-doc').click();
        await page.locator('#file-picker').setInputFiles({ name: 'network-note.txt', mimeType: 'text/plain', buffer: Buffer.from('local test') });
        assert.match(await page.locator('#attachments').innerText(), /network-note\.txt/);
        for (const view of ['browser', 'plugins', 'computer']) {
          await page.locator(`[data-pane="${view}"]`).click();
          await page.locator('#run-tool').click();
          await page.locator('#tool-state.state-success').waitFor();
          await page.locator('#run-tool').click();
          await page.locator('#tool-state.state-error').waitFor();
          await capture(page, `tool-${view}-error`);
          await page.locator('#retry-tool').click();
          await page.locator('#tool-state.state-success').waitFor();
          await page.locator('#run-tool').click();
          await page.locator('#cancel-tool').click();
          await page.waitForTimeout(100);
          assert.match(await page.locator('#tool-state').innerText(), /Idle/);
        }
        await page.reload();
        await page.locator('#avatar').click();
        await page.locator('[data-doc="SOUL.md"]').click();
        assert.equal(await page.locator('#doc-textarea').inputValue(), 'Alpha-specific local policy');
        await unchanged(page);
      });
    });

    await check('P3 account menu, honest local actions, feedback and staged Agent behavior settings', async () => {
      await withPage(fixture(), async page => {
        await page.setViewportSize({ width: 390, height: 430 });
        await openAccount(page);
        const actions = ['settings', 'about', 'help', 'feedback', 'add-account', 'logout'];
        for (const action of actions) assert.equal(await page.locator(`[data-account-action="${action}"]`).count(), 1, `${action} action missing`);
        for (const item of await page.locator('#account-menu [role="menuitem"]').all()) {
          assert(await item.locator('svg.icon').count() >= 1, 'Account actions require consistent icons');
          await item.scrollIntoViewIfNeeded();
          const box = await item.boundingBox();
          assert(box && box.y >= -1 && box.y + box.height <= 431, 'Account action must remain reachable at small height');
        }
        await page.locator('[data-account-action="feedback"]').click();
        await page.locator('#feedback-text').fill('Keep the network workspace focused.');
        await page.locator('#save-feedback').click();
        const feedbackSaved = await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => /feedback/i.test(key) && value.includes('Keep the network workspace focused.')));
        assert(feedbackSaved, 'Feedback must save locally');
        await page.locator('#info-ok').click();
        for (const action of ['about', 'help', 'add-account', 'logout']) {
          await openAccount(page);
          await page.locator(`[data-account-action="${action}"]`).click();
          const body = await page.locator('#info-dialog').innerText();
          assert.match(body, /local|prototype|not connected|no account|nothing is sent/i, `${action} must be honest about local auth state`);
          if (await page.locator('#info-ok').isVisible().catch(() => false)) await page.locator('#info-ok').click();
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await openSettings(page, 'behavior');
        for (const selector of ['#behavior-agent', '#behavior-timezone', '#behavior-auto-review']) assert.equal(await page.locator(selector).count(), 1, `${selector} missing`);
        const before = await stored(page, keys.prefs);
        await page.locator('#behavior-timezone').selectOption({ index: 1 });
        if (await page.locator('#behavior-auto-review').getAttribute('type') === 'checkbox') await page.locator('#behavior-auto-review').check();
        await page.locator('#cancel-settings').click();
        assert.deepEqual(await stored(page, keys.prefs), before, 'Agent behavior Cancel must discard staged changes');
        await openSettings(page, 'behavior');
        await page.locator('#behavior-timezone').selectOption({ index: 1 });
        if (await page.locator('#behavior-auto-review').getAttribute('type') === 'checkbox') await page.locator('#behavior-auto-review').check();
        const savedTimezone = await page.locator('#behavior-timezone').inputValue();
        const savedAutoReview = await page.locator('#behavior-auto-review').isChecked().catch(() => false);
        await page.locator('#save-settings').click();
        await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
        await openSettings(page, 'behavior');
        assert.equal(await page.locator('#behavior-timezone').inputValue(), savedTimezone);
        if (await page.locator('#behavior-auto-review').getAttribute('type') === 'checkbox') assert.equal(await page.locator('#behavior-auto-review').isChecked(), savedAutoReview);
        await capture(page, 'settings-behavior');
        await page.locator('#cancel-settings').click();
      });
    });

    await check('P3 theme, contrast, responsive bounds, sidebar resize and group state preservation', async () => {
      await withPage(fixture(), async page => {
        const contrastRows = [];
        for (const theme of ['light', 'dark']) {
          await openSettings(page, 'appearance');
          await page.locator('#pref-theme').selectOption(theme);
          await page.locator('#save-settings').click();
          await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
          await page.reload();
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
          const colors = await themeColors(page);
          for (const [label, foreground, background, minimum] of [['text', 'text', 'bg', 4.5], ['muted', 'muted', 'surface', 4.5], ['faint', 'faint', 'surface', 4.5], ['accent', 'on-accent', 'accent', 4.5], ['focus', 'focus', 'surface', 3]]) {
            const ratio = contrast(colors[foreground], colors[background]);
            contrastRows.push({ theme, label, ratio: Number(ratio.toFixed(2)) });
            assert(ratio >= minimum, `${theme} ${label} contrast ${ratio.toFixed(2)} < ${minimum}`);
          }
          await capture(page, `theme-${theme}`);
        }
        report.contrast = contrastRows;
        await page.setViewportSize({ width: 1440, height: 1000 });
        const divider = page.locator('#sidebar-resize');
        await divider.focus();
        await page.keyboard.press('Home');
        assert(Math.abs((await page.locator('#rail').boundingBox()).width - 220) < 2);
        await page.keyboard.press('End');
        assert(Math.abs((await page.locator('#rail').boundingBox()).width - 380) < 2);
        await page.locator('#toggle').click();
        assert((await page.locator('#rail').boundingBox()).width < 100);
        await page.locator('#toggle').click();
        assert(Math.abs((await page.locator('#rail').boundingBox()).width - 380) < 2);
        await page.locator('#draft').fill('Preserve group state draft');
        const title = await page.locator('#surface').innerText();
        for (const group of ['agents', 'channels', 'projects']) {
          await page.locator(`[data-group-toggle="${group}"]`).click();
          assert.equal(await page.locator('#surface').innerText(), title);
          assert.equal(await page.locator('#draft').inputValue(), 'Preserve group state draft');
          await page.locator(`[data-group-toggle="${group}"]`).click();
        }
        for (const width of [1920, 1440, 1024, 768, 390, 320]) {
          const height = width < 500 ? 844 : 1000;
          await page.setViewportSize({ width, height });
          if (await page.locator('#close-pane').isVisible().catch(() => false)) await page.locator('#close-pane').click();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow at ${width}`);
          for (const selector of ['#quick-create', '#account-button', '#composer', '#send']) await bounded(page, selector, width, height);
          await capture(page, `responsive-${width}`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        if (await page.locator('#rail').evaluate(node => node.classList.contains('expanded'))) await page.locator('#toggle').click();
        await page.locator('#avatar').click();
        await bounded(page, '#right-pane', 390, 844);
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press('Tab');
          assert(await page.locator('#right-pane').evaluate(node => node.contains(document.activeElement)), 'Narrow focus escaped right pane');
        }
        await page.keyboard.press('Escape');
        await unchanged(page);
      });
    });

    await check('P3 protected wireframe sources and candidate stability', async () => {
      const expected = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'polished-baseline-hashes.json'), 'utf8').replace(/^\uFEFF/, ''));
      for (const file of expected) assert.equal(sha256(file.path), file.sha256.toLowerCase(), file.path);
    });

    await check('P3 no page errors or external runtime requests', async () => {
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.externalRequests, []);
    });
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    report.candidateEnd = fingerprint();
    report.runtimeEnd = runtimeHash();
    report.candidateStable = JSON.stringify(report.candidateStart) === JSON.stringify(report.candidateEnd) && report.runtimeStart === report.runtimeEnd;
    if (!report.candidateStable) report.checks.push({ name: 'Candidate stability', status: 'STALE', detail: 'Reviewed sources changed during the run.' });
    const output = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(evidenceDir, 'p3-test-results.json'), output);
    fs.mkdirSync(path.join(evidenceDir, 'p3-runs'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'p3-runs', report.startedAt.replace(/[:.]/g, '-') + '.json'), output);
    console.log(`Stable candidate: ${report.candidateStable}`);
    console.log(`Results: ${path.join(evidenceDir, 'p3-test-results.json')}`);
    if (report.checks.some(checkResult => checkResult.status === 'FAIL') || report.checks.some(checkResult => checkResult.status === 'STALE') || report.errors.length || report.externalRequests.length) process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
