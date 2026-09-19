const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const base = 'http://127.0.0.1:8767';
const root = path.join(__dirname, '..');
const reportPath = path.join(__dirname, 'p3-independent-results.json');
const sourceFiles = ['polished.html', 'polished.css', 'polished.js', 'polished-avatars.js', 'prototype-review.html'];
const keys = { prefs: 'aven-polished-preferences-v1', data: 'aven-polished-chats-v1', docs: 'aven-polished-docs-v1' };
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const fingerprints = () => Object.fromEntries(sourceFiles.map(file => [file, hashFile(file)]));
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const report = {
  baseline: 'F08-P3-independent', startedAt: new Date().toISOString(), sourceFiles,
  candidateStart: fingerprints(), candidateEnd: null, candidateStable: null,
  checks: [], findings: [], captures: [], errors: [], externalRequests: [], dialogs: []
};
let browser;

function fixture() {
  return {
    [keys.prefs]: {
      theme: 'dark', accent: 'black', displayName: 'Review user', activeAgent: 'alpha', sections: [],
      agents: [
        { id: 'alpha', name: 'Alpha agent', role: 'Alpha role', label: 'Core', description: 'Alpha description', notifications: true, avatar: { style: 'router', color: '#45c9b0', seed: 1, image: '' }, projectId: 'project-a', timezone: 'Follow system', autoReview: false, hidden: false, pinned: false, unread: false },
        { id: 'beta', name: 'Beta agent', role: 'Beta role', label: 'Backup', description: 'Beta description', notifications: false, avatar: { style: 'firewall', color: '#ec709b', seed: 2, image: '' }, projectId: 'project-a', timezone: 'UTC', autoReview: true, hidden: false, pinned: false, unread: false }
      ]
    },
    [keys.data]: {
      activeChat: 'chat-alpha',
      projects: [{ id: 'personal', name: 'Personal', system: true }, { id: 'project-a', name: 'Project A' }],
      channels: [],
      chats: [
        { id: 'chat-alpha', title: 'Alpha direct', autoTitle: false, sample: false, channelId: null, projectId: 'project-a', recipients: ['alpha'], draft: 'Alpha draft', pendingAttachmentNames: [], messages: [{ id: 'ma', role: 'user', text: 'Alpha evidence' }] },
        { id: 'chat-beta', title: 'Beta direct', autoTitle: false, sample: false, channelId: null, projectId: 'project-a', recipients: ['beta'], draft: 'Beta draft', pendingAttachmentNames: [], messages: [{ id: 'mb', role: 'user', text: 'Beta evidence' }] }
      ]
    },
    [keys.docs]: { alpha: { 'SOUL.md': 'Alpha soul', 'MEMORY.md': 'Alpha memory' }, beta: { 'SOUL.md': 'Beta soul', 'MEMORY.md': 'Beta memory' } }
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
async function stored(page, key) { return page.evaluate(k => JSON.parse(localStorage.getItem(k)), key); }
async function capture(page, label) {
  const file = `p3-independent-${label}.png`;
  await page.screenshot({ path: path.join(__dirname, file), fullPage: true });
  report.captures.push({ label, path: `.intentgraph/${file}` });
}
async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, status: 'PASS', evidence }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'FAIL', detail: error.message, stack: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function makePage(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  let nextDialog = 'dismiss';
  page.on('dialog', async dialog => {
    const action = nextDialog; nextDialog = 'dismiss';
    report.dialogs.push({ type: dialog.type(), message: dialog.message(), action });
    if (action === 'accept') await dialog.accept(); else await dialog.dismiss();
  });
  page.on('pageerror', error => report.errors.push({ message: error.message, url: page.url() }));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/')) report.externalRequests.push({ url: request.url(), method: request.method() });
  });
  page.setNextDialog = action => { nextDialog = action; };
  await page.addInitScript(values => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.clear();
  }, fixture());
  await page.goto(base + '/polished.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#draft').waitFor();
  return { page, context };
}
async function withPage(viewport, fn) {
  const { page, context } = await makePage(viewport);
  try { return await fn(page); } finally { await context.close(); }
}
async function openProfile(page, id) {
  await page.locator(`[data-agent-menu="${id}"]`).click();
  await page.locator('#agent-context-menu').waitFor({ state: 'visible' });
  await page.locator('[data-menu-action="edit"]').click();
  await page.locator('#profile-form').waitFor({ state: 'visible' });
}
async function openAvatarPicker(page) {
  await page.locator('#edit-avatar').click();
  await page.locator('#avatar-picker').waitFor({ state: 'visible' });
}
async function openAccount(page) {
  await page.locator('#account-button').click();
  await page.locator('#account-menu').waitFor({ state: 'visible' });
}
function boxWithin(box, width, height) {
  return box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
}

async function profileJourney() {
  await withPage({ width: 1440, height: 1000 }, async page => {
    const before = await stored(page, keys.prefs);
    const alphaAvatarBefore = clone(before.agents.find(a => a.id === 'alpha').avatar);
    const alphaChatBefore = await page.locator('#surface').innerText();
    await openProfile(page, 'beta');
    await capture(page, 'profile');
    const paneBox = await page.locator('#right-pane').boundingBox();
    assert(paneBox && paneBox.x > 700, `Profile workspace should open on right: ${JSON.stringify(paneBox)}`);
    assert.equal(await page.locator('#profile-name').inputValue(), 'Beta agent');
    assert.equal(await page.locator('#surface').innerText(), alphaChatBefore, 'Opening beta profile must preserve alpha conversation');
    const header = await page.evaluate(() => ({ svg: document.querySelector('#avatar svg')?.outerHTML || '', img: !!document.querySelector('#avatar img'), placeholder: document.querySelector('#draft').getAttribute('placeholder') }));
    const alphaConfig = await page.evaluate(() => AvenAvatars.config({ id: 'alpha', avatar: { style: 'router', color: '#45c9b0', seed: 1 } }));
    assert(header.svg.includes(alphaConfig.color), `Header avatar should remain alpha while beta profile is inspected: ${header.svg.slice(0, 180)}`);
    assert.match(header.placeholder, /Alpha agent/, `Composer placeholder should remain alpha: ${header.placeholder}`);

    await page.locator('#profile-description').fill('Unsaved beta edit');
    page.setNextDialog('dismiss');
    await page.locator('#close-pane').click();
    assert.equal(await page.locator('#right-pane').isHidden(), false, 'Canceling dirty close must preserve profile editor');
    assert.equal(await page.locator('#profile-description').inputValue(), 'Unsaved beta edit');
    page.setNextDialog('accept');
    await page.locator('#close-pane').click();
    assert.equal(await page.locator('#right-pane').isHidden(), true, 'Accepted dirty close should close profile editor');
    const afterDismiss = await stored(page, keys.prefs);
    assert.equal(afterDismiss.agents.find(a => a.id === 'beta').description, 'Beta description', 'Dirty close must not persist edits');

    await openProfile(page, 'beta');
    await page.locator('#profile-description').fill('Saved beta description');
    await page.locator('#save-profile').click();
    const saved = await stored(page, keys.prefs);
    assert.equal(saved.agents.find(a => a.id === 'beta').description, 'Saved beta description');
    assert.deepEqual(saved.agents.find(a => a.id === 'alpha').avatar, alphaAvatarBefore, 'Saving beta must not alter alpha');
    assert.equal((await stored(page, keys.data)).activeChat, 'chat-alpha');
    assert.deepEqual((await stored(page, keys.data)).chats.find(c => c.id === 'chat-alpha').recipients, ['alpha']);

    await openProfile(page, 'alpha');
    const alphaStoredBeforeCancel = await stored(page, keys.prefs);
    await page.locator('#profile-description').fill('Canceled alpha description');
    await page.locator('#cancel-profile').click();
    const afterCancel = await stored(page, keys.prefs);
    assert.deepEqual(afterCancel.agents.find(a => a.id === 'alpha'), alphaStoredBeforeCancel.agents.find(a => a.id === 'alpha'), 'Cancel must isolate unsaved alpha edits');
    return { pane: paneBox, preservedConversation: alphaChatBefore, headerPlaceholder: header.placeholder };
  });
}

async function avatarJourney() {
  await withPage({ width: 1440, height: 1000 }, async page => {
    await openProfile(page, 'beta');
    await openAvatarPicker(page);
    assert.equal(await page.locator('[data-avatar-style]').count(), 8, 'Network picker should offer eight motifs');
    assert.equal(await page.locator('[data-avatar-color]').count(), 8, 'Network picker should offer eight colors');
    await page.locator('[data-avatar-style="mesh"]').click();
    await page.locator('[data-avatar-color="#45c9b0"]').click();
    await capture(page, 'network');
    await page.locator('#save-profile').click();
    let prefs = await stored(page, keys.prefs);
    let beta = prefs.agents.find(a => a.id === 'beta');
    assert.equal(beta.avatar.style, 'mesh'); assert.equal(beta.avatar.color, '#45c9b0'); assert.equal(beta.avatar.image, '');
    await page.reload();
    await openProfile(page, 'beta');
    assert.equal(await page.locator('#edit-avatar svg').count(), 1, 'Saved network avatar should survive reload');
    await openAvatarPicker(page);
    await page.locator('[data-avatar-tab="generate"]').click();
    await page.locator('#avatar-prompt').fill('firewall guardian');
    await page.locator('#avatar-generate').click();
    assert.match(await page.locator('#avatar-status').innerText(), /Variation ready/i);
    await page.locator('#save-profile').click();
    prefs = await stored(page, keys.prefs); beta = prefs.agents.find(a => a.id === 'beta');
    assert.equal(beta.avatar.style, 'firewall', 'Generate prompt should produce deterministic local network style');
    assert.equal(beta.avatar.image, '', 'Generate must remain local procedural avatar');

    await openProfile(page, 'beta'); await openAvatarPicker(page); await page.locator('[data-avatar-tab="upload"]').click();
    await page.locator('#avatar-upload').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: tinyPng });
    await page.locator('#avatar-status').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#avatar-status')?.textContent.includes('Image ready'));
    assert.equal(await page.locator('#save-profile').isDisabled(), false);
    await page.locator('#save-profile').click();
    prefs = await stored(page, keys.prefs); beta = prefs.agents.find(a => a.id === 'beta');
    assert.match(beta.avatar.image, /^data:image\/webp;base64,/, 'Upload must validate and save local image data');
    const alpha = prefs.agents.find(a => a.id === 'alpha'); assert.equal(alpha.avatar.image, '', 'Upload must be per-agent');

    await openProfile(page, 'beta'); await openAvatarPicker(page); await page.locator('#avatar-reset').click();
    assert.equal(await page.locator('#edit-avatar img').count(), 0, 'Reset should remove uploaded image from draft');
    await page.locator('#save-profile').click();
    prefs = await stored(page, keys.prefs); beta = prefs.agents.find(a => a.id === 'beta');
    assert.equal(beta.avatar.image, '');
    await openProfile(page, 'beta'); await openAvatarPicker(page); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#avatar-picker').isHidden(), true, 'Escape should close avatar picker');
    assert.equal(await page.locator('#right-pane').isHidden(), false, 'Escape from picker should preserve profile pane');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#right-pane').isHidden(), true, 'Second Escape should close clean profile pane');
    return { motifs: 8, colors: 8, savedStyle: 'mesh', generatedStyle: 'firewall', upload: 'local webp data URL', reset: true };
  });
}

async function accountJourney() {
  await withPage({ width: 390, height: 320 }, async page => {
    await openAccount(page);
    const expected = ['settings', 'about', 'help', 'feedback', 'add-account', 'logout'];
    assert.deepEqual(await page.locator('[data-account-action]').evaluateAll(nodes => nodes.map(n => n.dataset.accountAction)), expected);
    assert.equal(await page.locator('[data-account-action] .icon').count(), 6, 'All account actions should have icons');
    const menuBox = await page.locator('#account-menu').boundingBox(); assert(boxWithin(menuBox, 390, 320), `Account menu clipped: ${JSON.stringify(menuBox)}`);
    await page.locator('[data-account-action="settings"]').click();
    const settingsBox = await page.locator('#settings-dialog').boundingBox();
    assert(settingsBox && Math.abs((settingsBox.x + settingsBox.width / 2) - 195) < 3, `Settings should be centered: ${JSON.stringify(settingsBox)}`);
    assert(boxWithin(settingsBox, 390, 320), `Settings outside viewport: ${JSON.stringify(settingsBox)}`);
    await page.locator('#cancel-settings').click();
    for (const action of ['about', 'help', 'add-account', 'logout']) {
      await openAccount(page); await page.locator(`[data-account-action="${action}"]`).click();
      assert.equal(await page.locator('#info-dialog').isVisible(), true, `${action} should open informational page`);
      assert.match(await page.locator('#info-dialog-body').innerText(), /local|not connected|no account|prototype/i, `${action} must state local/unconnected boundary`);
      await page.locator('#info-ok').click();
    }
    await openAccount(page); await page.locator('[data-account-action="feedback"]').click();
    await page.locator('#feedback-text').fill('Independent P3 review note'); await page.locator('#save-feedback').click();
    assert.match(await page.locator('#feedback-status').innerText(), /Saved locally/i); await page.locator('#info-ok').click();
    return { actions: expected, menu: menuBox, settings: settingsBox };
  });
}

async function visualAndKeyboardJourney() {
  await withPage({ width: 1440, height: 1000 }, async page => {
    await capture(page, 'main-1440');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const header = await page.locator('.center-header').boundingBox(); const title = await page.locator('#surface').boundingBox(); const avatar = await page.locator('#avatar').boundingBox();
    assert(header && title && avatar && avatar.x < title.x, 'Conversation avatar should precede title');
    await page.setViewportSize({ width: 390, height: 844 }); await capture(page, 'main-390');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '390px view should have no horizontal overflow');
    await page.locator('#avatar').focus(); await page.keyboard.press('Enter'); await page.locator('#right-pane').waitFor({ state: 'visible' });
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert(await page.locator('#right-pane').evaluate(n => n.contains(document.activeElement)), `Keyboard focus escaped right pane at step ${i + 1}`); }
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#right-pane').isHidden(), true);
    await page.locator('#account-button').focus(); await page.keyboard.press('Enter'); assert.equal(await page.locator('#account-menu').isVisible(), true);
    await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('#account-menu button').nth(1).evaluate(n => n === document.activeElement), true);
    return { main: ['1440x1000', '390x844'], keyboard: 'right pane focus trap and account menu keyboard entry' };
  });
}

async function main() {
  browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, ignoreDefaultArgs: ['--headless'], args: ['--headless=new'] });
  try {
    await check('P3 profile edit isolation, right pane, dirty-close and identity attribution', profileJourney);
    await check('P3 network avatar choices, generate, local upload, reset, reload and Escape', avatarJourney);
    await check('P3 six account actions/icons and centered settings at small height', accountJourney);
    await check('P3 1440/390 visual captures and keyboard access', visualAndKeyboardJourney);
    if (report.checks.find(c => c.name.startsWith('P3 profile'))?.status === 'FAIL') report.findings.push({ severity: 'blocker', area: 'profile/identity', detail: 'Profile journey failed; inspect check detail and profile screenshot.' });
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    report.candidateEnd = fingerprints();
    report.candidateStable = JSON.stringify(report.candidateStart) === JSON.stringify(report.candidateEnd);
    if (!report.candidateStable) report.findings.push({ severity: 'blocker', area: 'candidate-stability', detail: 'Reviewed source hashes changed during independent run.' });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    fs.mkdirSync(path.join(__dirname, 'p3-runs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'p3-runs', report.startedAt.replace(/[:.]/g, '-') + '-independent.json'), JSON.stringify(report, null, 2));
    console.log(`Stable candidate: ${report.candidateStable}`);
    console.log(`Results: ${reportPath}`);
    if (report.checks.some(c => c.status === 'FAIL') || report.errors.length || report.externalRequests.length || !report.candidateStable) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
