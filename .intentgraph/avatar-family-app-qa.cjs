const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const base = 'http://127.0.0.1:8767';
const outDir = path.join(__dirname, 'avatar-family-app-qa-screenshots');
const resultPath = path.join(__dirname, 'avatar-family-app-qa-results.json');
const PREF_KEY = 'aven-polished-preferences-v1';
const CHAT_KEY = 'aven-polished-chats-v1';
const DOC_KEY = 'aven-polished-docs-v1';
const sourceFiles = ['polished.html', 'polished.css', 'polished.js', 'polished-avatars.js', 'avatar-system/artwork.js', 'avatar-system/avatar.css'];
const styles = ['cloud', 'router', 'firewall', 'switch', 'load-balancer', 'wifi', 'dns-ddi', 'sd-wan', 'leaf', 'spine', 'server', 'storage', 'vpn', 'proxy', 'monitoring', 'controller'];
const amber = '#FAAE54';
const realUploadPath = path.join(root, '.intentgraph', 'avatar-four-320.png');
const existingPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

fs.mkdirSync(outDir, { recursive: true });
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const fingerprint = () => Object.fromEntries(sourceFiles.map(file => [file, sha256(file)]));
const report = {
  phase: 'polished-app',
  startedAt: new Date().toISOString(),
  base,
  sourceFiles,
  candidateStart: fingerprint(),
  candidateEnd: null,
  candidateStable: null,
  viewportRuns: [],
  checks: [],
  captures: [],
  errors: [],
  externalRequests: [],
  storageWrites: [],
  bugs: []
};
let browser;

function addCheck(name, status, detail) {
  const item = { name, status };
  if (detail) item.detail = detail;
  report.checks.push(item);
  console.log(`${status === 'PASS' ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

async function check(name, fn) {
  try { await fn(); addCheck(name, 'PASS'); }
  catch (error) {
    addCheck(name, 'FAIL', error.message);
    report.bugs.push({ name, detail: error.message });
  }
}

function basePrefs(agents) {
  return {
    theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: '', activeAgent: agents[0].id,
    provider: 'Not connected', model: '', browser: true, computer: false, sections: [], agents
  };
}

function baseChats(firstId) {
  return { activeChat: 'qa-chat', chats: [{ id: 'qa-chat', title: 'QA chat', sample: false, channelId: null, projectId: 'personal', recipients: [firstId], draft: '', pendingAttachmentNames: [], messages: [] }], channels: [], projects: [{ id: 'personal', name: 'Personal', system: true }] };
}

function seedSimple() {
  return {
    [PREF_KEY]: basePrefs([
      { id: 'companion', name: 'Network companion', role: 'Investigate branch networks.', timezone: 'Follow system', autoReview: false },
      { id: 'topology', name: 'Topology analyst', role: 'Map dependencies.', timezone: 'Follow system', autoReview: false }
    ]),
    [CHAT_KEY]: baseChats('companion'),
    [DOC_KEY]: {}
  };
}

function seedAliasesAndPhoto() {
  return {
    [PREF_KEY]: basePrefs([
      { id: 'companion', name: 'Network companion', role: 'Investigate branch networks.', avatar: { style: 'mesh', color: '#112233', seed: 1, image: '' } },
      { id: 'topology', name: 'Topology analyst', role: 'Map dependencies.', avatar: { style: 'rack', color: '#223344', seed: 2, image: existingPhoto } },
      { id: 'wireless', name: 'Wireless analyst', role: 'Review wireless paths.', avatar: { style: 'wireless', color: '#334455', seed: 3, image: '' } },
      { id: 'fiber', name: 'Fiber controller', role: 'Review fiber links.', avatar: { style: 'fiber', color: '#445566', seed: 4, image: '' } }
    ]),
    [CHAT_KEY]: baseChats('companion'),
    [DOC_KEY]: {}
  };
}

async function newPage(viewport, label, seed, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion });
  if (seed) {
    await context.addInitScript(({ values }) => {
      if (localStorage.getItem('__avatar_app_qa_seeded__') !== '1') {
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
        localStorage.setItem('__avatar_app_qa_seeded__', '1');
      }
    }, { values: seed });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push({ viewport: label, message: error.message }));
  page.on('request', request => {
    if (/^https?:/i.test(request.url()) && !request.url().startsWith(base + '/')) report.externalRequests.push({ viewport: label, url: request.url(), method: request.method() });
  });
  await page.goto(`${base}/polished.html`, { waitUntil: 'networkidle' });
  await page.locator('#composer').waitFor();
  return { page, context };
}

async function prefs(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PREF_KEY);
}

async function openProfile(page, id = 'companion') {
  const row = page.locator(`#agent-list [data-agent-open="${id}"]`);
  if (await row.count()) await row.click();
  await page.locator('#avatar').click();
  await page.locator('#right-pane:not([hidden])').waitFor();
  await page.locator('#edit-avatar').waitFor();
  await page.waitForTimeout(100);
}

async function refreshMotion(page) {
  await page.evaluate(() => globalThis.AvenAvatars?.refreshMotion());
  await page.waitForTimeout(100);
}

async function activeMotion(page) {
  return page.locator('.network-avatar.motion-active').evaluateAll(nodes => nodes.map(node => ({
    role: node.dataset.avatarRole || '',
    photo: node.classList.contains('is-photo'),
    insidePicker: !!node.closest('.avatar-style-grid,.avatar-colors'),
    profile: !!node.closest('#right-pane'),
    header: !!node.closest('#avatar'),
    sidebar: !!node.closest('#agent-list')
  })));
}

async function main() {
  browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, ignoreDefaultArgs: ['--headless'], args: ['--headless=new'] });
  try {
    await check('picker exposes all 16 styles and persists every choice immediately', async () => {
      const { page, context } = await newPage({ width: 1440, height: 960 }, 'picker-1440', seedSimple());
      try {
        await openProfile(page);
        await page.locator('#edit-avatar').click();
        await page.locator('[data-avatar-style]').first().waitFor();
        assert.equal(await page.locator('[data-avatar-style]').count(), 16);
        for (const style of styles) {
          await page.locator(`[data-avatar-style="${style}"]`).click();
          const saved = await prefs(page);
          assert.equal(saved.agents.find(a => a.id === 'companion').avatar.style, style, `${style} was not immediately persisted`);
          assert.equal(await page.locator('#edit-avatar .network-avatar').getAttribute('data-avatar-role'), style);
        }
        await page.screenshot({ path: path.join(outDir, 'app-1440-picker.png'), fullPage: true });
        report.captures.push('.intentgraph/avatar-family-app-qa-screenshots/app-1440-picker.png');
        await page.reload({ waitUntil: 'networkidle' });
        await openProfile(page);
        assert.equal((await prefs(page)).agents.find(a => a.id === 'companion').avatar.style, 'controller');
        assert.equal(await page.locator('#edit-avatar .network-avatar').getAttribute('data-avatar-role'), 'controller');
      } finally { await context.close(); }
    });

    await check('custom color persists across reload and new agents render cloud amber', async () => {
      const { page, context } = await newPage({ width: 1440, height: 960 }, 'new-agent-1440', seedSimple());
      try {
        await openProfile(page);
        await page.locator('#edit-avatar').click();
        await page.locator('#avatar-color-custom').waitFor();
        await page.locator('#avatar-color-custom').evaluate((input, color) => { input.value = color; input.dispatchEvent(new Event('input', { bubbles: true })); }, '#123456');
        assert.equal((await prefs(page)).agents.find(a => a.id === 'companion').avatar.color, '#123456');
        await page.reload({ waitUntil: 'networkidle' });
        await openProfile(page);
        await page.locator('#edit-avatar').click();
        await page.locator('#avatar-color-custom').waitFor();
        assert.equal(await page.locator('#avatar-color-custom').inputValue(), '#123456');
        await page.locator('#close-pane').click();
        await page.locator('#quick-create').click();
        await page.locator('#create-menu [data-create="agent"]').click();
        await page.locator('#workspace-create-name').fill('QA cloud default');
        await page.locator('#workspace-create-role').fill('Check default avatar rendering.');
        await page.locator('#finish-workspace-create').click();
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#avatar .network-avatar').getAttribute('data-avatar-role'), 'cloud');
        assert.equal(await page.locator('#avatar .network-avatar').evaluate(node => getComputedStyle(node).getPropertyValue('--avatar-color').trim()), amber);
        await page.screenshot({ path: path.join(outDir, 'app-1440-new-agent.png'), fullPage: true });
        report.captures.push('.intentgraph/avatar-family-app-qa-screenshots/app-1440-new-agent.png');
      } finally { await context.close(); }
    });

    await check('legacy aliases normalize on render while raw stored records remain unchanged', async () => {
      const { page, context } = await newPage({ width: 1440, height: 960 }, 'aliases-1440', seedAliasesAndPhoto());
      try {
        const before = await prefs(page);
        assert.deepEqual(Object.fromEntries(['companion', 'topology', 'wireless', 'fiber'].map(id => [id, before.agents.find(a => a.id === id).avatar.style])), { companion: 'mesh', topology: 'rack', wireless: 'wireless', fiber: 'fiber' });
        const expected = { companion: 'sd-wan', topology: 'server', wireless: 'wifi', fiber: 'controller' };
        for (const [id, role] of Object.entries(expected)) {
          assert.equal(await page.locator(`#agent-list [data-agent-open="${id}"] .network-avatar`).getAttribute('data-avatar-role'), role, id);
        }
        const after = await prefs(page);
        assert.deepEqual(Object.fromEntries(['companion', 'topology', 'wireless', 'fiber'].map(id => [id, after.agents.find(a => a.id === id).avatar.style])), { companion: 'mesh', topology: 'rack', wireless: 'wireless', fiber: 'fiber' });
      } finally { await context.close(); }
    });

    await check('existing photos and real file upload persist through reload', async () => {
      const { page, context } = await newPage({ width: 1440, height: 960 }, 'photos-1440', seedAliasesAndPhoto());
      try {
        await openProfile(page, 'topology');
        assert.equal(await page.locator('#edit-avatar .network-avatar.is-photo img').count(), 1);
        const topologyBefore = (await prefs(page)).agents.find(a => a.id === 'topology').avatar.image;
        await page.locator('#close-pane').click();
        await openProfile(page, 'companion');
        await page.locator('#edit-avatar').click();
        await page.locator('[data-avatar-tab="upload"]').click();
        await page.locator('#avatar-upload').setInputFiles(realUploadPath);
        await page.locator('#avatar-status').filter({ hasText: 'Image applied.' }).waitFor();
        assert.equal(await page.locator('#edit-avatar .network-avatar.is-photo img').count(), 1);
        const saved = await prefs(page);
        assert.match(saved.agents.find(a => a.id === 'companion').avatar.image, /^data:image\/webp;base64,/);
        assert.equal(saved.agents.find(a => a.id === 'topology').avatar.image, topologyBefore);
        await page.reload({ waitUntil: 'networkidle' });
        await openProfile(page, 'companion');
        assert.equal(await page.locator('#edit-avatar .network-avatar.is-photo img').count(), 1);
        const reloaded = await prefs(page);
        assert.match(reloaded.agents.find(a => a.id === 'companion').avatar.image, /^data:image\/webp;base64,/);
        assert.equal(reloaded.agents.find(a => a.id === 'topology').avatar.image, topologyBefore);
      } finally { await context.close(); }
    });

    await check('motion ownership follows profile, focused or selected sidebar, then header fallback', async () => {
      const { page, context } = await newPage({ width: 1440, height: 960 }, 'motion-1440', seedAliasesAndPhoto());
      try {
        await openProfile(page);
        let active = await activeMotion(page);
        assert.equal(active.length, 1);
        assert.equal(active[0].profile, true);
        await page.locator('#close-pane').click();
        await refreshMotion(page);
        active = await activeMotion(page);
        assert.equal(active.length, 1);
        assert.equal(active[0].sidebar, true);
        await page.locator('#agent-list [data-agent-open="companion"]').focus();
        await refreshMotion(page);
        active = await activeMotion(page);
        assert.equal(active.length, 1);
        assert.equal(active[0].sidebar, true);
        assert.equal(active[0].role, 'sd-wan');
        await page.evaluate(() => { document.activeElement?.blur(); document.querySelectorAll('.sidebar-row.is-active').forEach(node => node.classList.remove('is-active')); });
        await refreshMotion(page);
        active = await activeMotion(page);
        assert.equal(active.length, 1);
        assert.equal(active[0].header, true);
        await page.locator('#avatar').click();
        await page.locator('#right-pane:not([hidden])').waitFor();
        const before = await page.locator('#edit-avatar .network-avatar').boundingBox();
        const paneState = await page.evaluate(() => {
          const pane = document.querySelector('#pane-content');
          pane.scrollTop = pane.scrollHeight;
          return { scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, rect: document.querySelector('#edit-avatar .network-avatar').getBoundingClientRect().toJSON() };
        });
        await refreshMotion(page);
        const after = await page.locator('#edit-avatar .network-avatar').boundingBox();
        if (paneState.scrollHeight > paneState.clientHeight && after && (after.bottom <= 0 || after.top >= 960)) assert.equal((await activeMotion(page)).some(node => node.profile), false);
        assert.ok(before, 'profile avatar should be measurable before scroll');
        await page.locator('#close-pane').click();
        await refreshMotion(page);
        assert.equal(await page.locator('#right-pane .network-avatar.motion-active').count(), 0);
      } finally { await context.close(); }
    });

    await check('picker tiles and photos stay static, including reduced motion', async () => {
      const { page, context } = await newPage({ width: 1440, height: 960 }, 'static-1440', seedAliasesAndPhoto());
      try {
        await openProfile(page);
        await page.locator('#edit-avatar').click();
        await page.locator('[data-avatar-style]').first().waitFor();
        assert.equal(await page.locator('[data-avatar-style] .network-avatar.motion-active').count(), 0);
        await page.locator('#close-pane').click();
        await openProfile(page, 'topology');
        assert.equal(await page.locator('#edit-avatar .network-avatar.is-photo.motion-active').count(), 0);
        await page.locator('#edit-avatar').click();
        await page.locator('[data-avatar-tab="styles"]').click();
        assert.equal(await page.locator('[data-avatar-style] .network-avatar.motion-active').count(), 0);
      } finally { await context.close(); }
      const reduced = await newPage({ width: 1440, height: 960 }, 'reduced-1440', seedSimple(), 'reduce');
      try {
        await openProfile(reduced.page);
        const animation = await reduced.page.locator('#edit-avatar .cw-eyes').evaluate(node => getComputedStyle(node).animationName);
        assert.equal(animation, 'none');
      } finally { await reduced.context.close(); }
    });

    for (const width of [390, 320]) {
      await check(`responsive ${width}px app has no horizontal overflow and profile remains accessible`, async () => {
        const { page, context } = await newPage({ width, height: 920 }, `app-${width}`, seedSimple());
        try {
          const initial = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, bodyScrollWidth: document.body.scrollWidth, bodyClientWidth: document.body.clientWidth }));
          assert(initial.scrollWidth <= width + 1 && initial.bodyScrollWidth <= initial.bodyClientWidth + 1, JSON.stringify(initial));
          await page.screenshot({ path: path.join(outDir, `app-${width}-initial.png`), fullPage: true });
          await page.locator('#avatar').click();
          await page.locator('#right-pane:not([hidden])').waitFor();
          const profile = await page.locator('#edit-avatar').boundingBox();
          assert(profile && profile.x >= 0 && profile.x + profile.width <= width + 1, JSON.stringify(profile));
          const open = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, bodyScrollWidth: document.body.scrollWidth, bodyClientWidth: document.body.clientWidth }));
          assert(open.scrollWidth <= width + 1 && open.bodyScrollWidth <= open.bodyClientWidth + 1, JSON.stringify(open));
          await page.screenshot({ path: path.join(outDir, `app-${width}-profile.png`), fullPage: true });
          report.captures.push(`.intentgraph/avatar-family-app-qa-screenshots/app-${width}-initial.png`, `.intentgraph/avatar-family-app-qa-screenshots/app-${width}-profile.png`);
          report.viewportRuns.push({ width, initial, open, profile });
        } finally { await context.close(); }
      });
    }

    await check('existing composer, add menu, create menu and sidebar sections remain usable', async () => {
      const { page, context } = await newPage({ width: 1440, height: 960 }, 'composer-1440', seedSimple());
      try {
        assert.equal(await page.locator('#draft').isVisible(), true);
        assert.equal(await page.locator('#tools-menu').isVisible(), true);
        assert.equal(await page.locator('[data-sidebar-group]').count(), 3);
        await page.locator('#tools-menu').click();
        await page.locator('#add-menu:not([hidden])').waitFor();
        const menu = await page.locator('#add-menu').boundingBox();
        const composer = await page.locator('#composer').boundingBox();
        assert(menu && composer && menu.y + menu.height <= composer.y + 1, JSON.stringify({ menu, composer }));
        assert.equal(await page.locator('#add-menu button[data-add]').count(), 5);
        await page.locator('#quick-create').click();
        await page.locator('#create-menu:not([hidden])').waitFor();
        assert.equal(await page.locator('#create-menu [data-create]').count(), 3);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#create-menu').isHidden(), true);
      } finally { await context.close(); }
    });

    await check('no page errors or external requests during app QA', () => {
      assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
      assert.equal(report.externalRequests.length, 0, JSON.stringify(report.externalRequests));
    });
  } finally {
    report.candidateEnd = fingerprint();
    report.candidateStable = JSON.stringify(report.candidateStart) === JSON.stringify(report.candidateEnd);
    if (!report.candidateStable) report.bugs.push({ name: 'source stability', detail: 'QA source SHA changed during the run.' });
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));
    if (browser) await browser.close();
  }
}

main().catch(error => {
  report.fatal = error.stack || String(error);
  report.candidateEnd = fingerprint();
  report.candidateStable = JSON.stringify(report.candidateStart) === JSON.stringify(report.candidateEnd);
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));
  console.error(error.stack || error);
  process.exitCode = 1;
});
