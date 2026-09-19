const { chromium } = require('C:/Users/vikasmit/Downloads/vikas problems/netrok-muse/intentgraph/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve('outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/minimal-ui');
const base = 'http://127.0.0.1:8767/polished.html?revision=minimal-ui-quality-candidate';
const raw = 'interface Gi0/1\n  input errors 0\n  output errors 0';
const prefs = {
  theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: '',
  activeAgent: 'companion', provider: 'Not connected', model: '', browser: true, computer: false,
  showEvidence: false, showInvestigation: false, showRunDetails: false, sections: [],
  agents: [{ id: 'companion', name: 'Network companion', role: 'Investigate branch networks and explain findings.', timezone: 'Follow system', autoReview: false }],
};
const assistant = {
  id: 'assistant-quality', role: 'assistant', agentId: 'companion',
  text: '## Answer\nThe branch edge is responding normally.\n\n```text\n' + raw + '\n```',
  model: 'Unavailable', mode: 'inspect', status: 'SUCCESS', runId: 'quality-run', usage: null,
  events: [{ type: 'tool_result', command: 'show interfaces', target: 'router-1', status: 'SUCCESS', output: raw }, { type: 'progress', text: 'Read-only investigation complete.' }],
  evidence: [{ command: 'show interfaces', target: 'router-1', status: 'SUCCESS', output: raw }],
  createdAt: '2026-09-16T04:00:00.000Z',
};
const failureAssistant = {
  id: 'assistant-failure-quality', role: 'assistant', agentId: 'companion',
  text: '## Answer\nThe provider returned an error while checking the branch edge.\n\n```text\n' + raw + '\n```',
  model: 'Fixture model', mode: 'inspect', status: 'FAILURE', runId: 'quality-failure', usage: null,
  events: [{ type: 'tool_result', command: 'show interfaces', target: 'router-1', status: 'FAILURE', output: raw }],
  evidence: [{ command: 'show interfaces', target: 'router-1', status: 'FAILURE', output: raw }],
  createdAt: '2026-09-16T04:01:00.000Z',
};
const data = {
  activeChat: 'quality-chat',
  chats: [{ id: 'quality-chat', title: 'Quality fixture', sample: false, channelId: null, projectId: null, recipients: ['companion'], draft: '', pendingAttachmentNames: [], pendingQueue: [], messages: [{ id: 'user-quality', role: 'user', text: 'Check the branch edge.', mode: 'inspect', createdAt: '2026-09-16T03:59:00.000Z' }, assistant] }],
  channels: [], projects: [{ id: 'personal', name: 'Personal', system: true }],
};

function fail(message) { throw new Error(message); }
function expect(condition, message) { if (!condition) fail(message); }
async function waitForPaint(page) { await page.waitForTimeout(160); }
async function openSettings(page) {
  await page.locator('#account-button').click();
  await page.locator('#account-menu [data-account-action="settings"]').click();
  await page.locator('#settings-dialog').waitFor({ state: 'visible' });
  await page.locator('#settings-nav [data-category="presentation"]').click();
  await waitForPaint(page);
}
function parseColor(value) {
  const m = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function contrast(foreground, background) {
  const lum = rgb => rgb.map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const a = lum(foreground), b = lum(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(({ prefs, data }) => {
    if (localStorage.getItem('quality-fixture-seeded') === '1') return;
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
    localStorage.setItem('aven-polished-docs-v1', JSON.stringify({}));
    localStorage.setItem('aven-polished-direct-teams-migration-v4', 'v4');
    localStorage.setItem('quality-fixture-seeded', '1');
  }, { prefs, data });
  const page = await context.newPage();
  const requests = [];
  let streamFixture = false;
  const candidateRoot = path.join(outputDir, 'candidate');
  const candidateFiles = new Map(['polished.html', 'polished.css', 'polished.js', 'polished-workspace-tools.js'].map(name => [name, path.join(candidateRoot, name)]));
  await page.route('**/*', async route => {
    const url = route.request().url();
    const file = path.posix.basename(new URL(url).pathname);
    if (candidateFiles.has(file)) return route.fulfill({ status: 200, contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(candidateFiles.get(file)) });
    if (streamFixture && url.endsWith('/api/chat')) {
      await new Promise(resolve => setTimeout(resolve, 900));
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: [
        JSON.stringify({ type: 'start', runId: 'quality-stream' }),
        JSON.stringify({ type: 'tool_start', command: 'show interfaces', target: 'router-1', status: 'RUNNING' }),
        JSON.stringify({ type: 'tool_result', command: 'show interfaces', target: 'router-1', status: 'SUCCESS', output: raw }),
        JSON.stringify({ type: 'final', reply: { text: 'The branch edge is responding normally.', model: 'Fixture model', mode: 'inspect', evidence: [] } }),
      ].join('\n') + '\n' });
    }
    if (url.startsWith('http://127.0.0.1:8767/')) { requests.push(url); return route.continue(); }
    return route.abort();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await waitForPaint(page);
  const checks = [];
  const check = async (id, fn) => { try { await fn(); checks.push({ id, status: 'PASS' }); } catch (error) { checks.push({ id, status: 'FAIL', error: error.message }); } };

  await check('UX-091-plus-menu-keyboard', async () => {
    const tools = page.locator('#tools-menu'); await tools.focus(); await page.keyboard.press('Enter');
    const menu = page.locator('#add-menu'); await expect(await menu.isVisible(), 'plus menu did not open from Enter');
    await expect(await page.evaluate(() => document.activeElement?.dataset.mode) === 'inspect', 'Agent was not first keyboard item');
    await page.keyboard.press('ArrowDown'); await expect(await page.evaluate(() => document.activeElement?.dataset.mode) === 'plan', 'ArrowDown did not move to Plan');
    await page.keyboard.press('Enter'); await waitForPaint(page);
    await expect(await menu.isHidden(), 'Enter did not close the plus menu');
    await expect(await page.evaluate(() => document.activeElement?.id) === 'tools-menu', 'focus did not return to plus button');
    await tools.focus(); await page.keyboard.press('Space'); await page.keyboard.press('Escape');
    await expect(await menu.isHidden(), 'Escape did not close the plus menu');
    await expect(await page.evaluate(() => document.activeElement?.id) === 'tools-menu', 'Escape did not restore plus-button focus');
  });

  await check('UX-091-settings-keyboard', async () => {
    await openSettings(page); const evidence = page.locator('#settings-content input[data-pref="showEvidence"]');
    await evidence.focus(); await page.keyboard.press('Space'); await expect(await evidence.isChecked(), 'Space did not toggle evidence setting');
    await page.keyboard.press('Escape'); await waitForPaint(page); await expect(await page.locator('#settings-dialog').isHidden(), 'Escape did not close settings');
    await expect(await page.locator('.run-terminals').count() === 0, 'Escape committed settings unexpectedly');
    await openSettings(page); const toggle = page.locator('#settings-content input[data-pref="showEvidence"]'); await toggle.focus(); await page.keyboard.press('Space');
    await page.locator('#save-settings').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(220);
    await expect(await page.locator('#settings-dialog').isHidden(), 'keyboard Save did not close settings');
    await expect(await page.locator('.run-terminals').count() === 1, 'keyboard Save did not commit evidence setting');
  });

  await check('UX-092-accessible-names-and-state', async () => {
    await page.locator('#tools-menu').focus(); await page.keyboard.press('Enter');
    await expect(await page.locator('#add-menu').getAttribute('role') === 'menu', 'plus menu role missing');
    await expect(await page.locator('#add-menu [data-mode="inspect"]').getAttribute('role') === 'menuitemradio', 'Agent role missing');
    const selectedModes = await page.locator('#add-menu [data-mode][aria-checked="true"]').count();
    await expect(selectedModes === 1, `selected mode state is ambiguous (${selectedModes} selected)`);
    await page.keyboard.press('Escape');
    await expect((await page.locator('#context-indicator').getAttribute('aria-label')).includes('unavailable'), 'context unavailable label missing');
    await expect(await page.locator('#tools-menu').getAttribute('aria-label'), 'plus accessible name missing');
  });

  await check('UX-093-contrast-and-text-stress', async () => {
    const answer = page.locator('.message.assistant .message-body').first();
    const measured = await answer.evaluate(node => {
      const fg = getComputedStyle(node).color;
      let parent = node; let bg = 'rgba(0, 0, 0, 0)';
      while (parent && bg.includes('0, 0, 0, 0')) { bg = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
      return { fg, bg };
    });
    const fg = parseColor(measured.fg), bg = parseColor(measured.bg); await expect(fg && bg, `could not measure colors: ${JSON.stringify(measured)}`);
    await expect(contrast(fg, bg) >= 4.5, `answer contrast below 4.5: ${contrast(fg, bg).toFixed(2)}`);
    await page.setViewportSize({ width: 320, height: 900 }); await page.addStyleTag({ content: 'html { font-size: 200% !important; }' }); await waitForPaint(page);
    const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    await expect(bounds.width <= bounds.client + 1, `200% text stress overflows: ${JSON.stringify(bounds)}`);
  });

  await check('UX-094-reduced-motion', async () => {
    await expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'reduced-motion media was not emulated');
    const animations = await page.evaluate(() => [...document.querySelectorAll('.network-avatar, .working-dots i')].map(node => { const style = getComputedStyle(node); return { name: style.animationName, duration: Number.parseFloat(style.animationDuration) || 0, iterations: style.animationIterationCount }; }));
    await expect(animations.every(item => item.name === 'none' || (item.duration <= 0.001 && (item.iterations === '1' || item.iterations === '0'))), `decorative animation remained active: ${JSON.stringify(animations)}`);
  });

  await check('UX-095-touch-targets', async () => {
    const sizes = await page.evaluate(() => ['#tools-menu', '#context-indicator', '#send'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, width: r.width, height: r.height }; }));
    await expect(sizes.every(item => item.width >= 24 && item.height >= 24), `compact controls below 24px target: ${JSON.stringify(sizes)}`);
  });

  await check('UX-096-responsive-pane', async () => {
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); await page.setViewportSize({ width: 320, height: 900 }); await page.reload({ waitUntil: 'domcontentloaded' }); await waitForPaint(page);
    await page.locator('#avatar').click(); await waitForPaint(page);
    await expect(await page.locator('#right-pane').isVisible(), 'right pane did not open at 320px');
    const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    await expect(bounds.width <= bounds.client + 1, `320px pane layout overflows: ${JSON.stringify(bounds)}`);
    await page.keyboard.press('Escape'); await expect(await page.locator('#right-pane').isHidden(), 'Escape did not close narrow pane');
  });

  await check('UX-097-truthful-unavailable', async () => {
    const ring = page.locator('#context-indicator'); const title = await ring.getAttribute('title');
    await expect(title.includes('unavailable'), 'context state does not explain unavailable capacity');
    await expect(!title.includes('%'), 'context state fabricates a percentage');
    await expect(await page.locator('.operation-notice').count() === 0, 'fixture unexpectedly changed into an error');
  });

  await check('UI-05-failure-cue-with-details-off', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(({ prefs, data, failure }) => {
      localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
      const next = structuredClone(data); next.chats[0].messages.push(failure);
      localStorage.setItem('aven-polished-chats-v1', JSON.stringify(next));
    }, { prefs, data, failure: failureAssistant });
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitForPaint(page);
    const body = await page.locator('.message.assistant .message-body').last().innerText();
    await expect(body.includes('provider returned an error'), 'failure explanation is not visible');
    await expect(await page.locator('.message.assistant .operation-notice').last().innerText().then(text => text.includes('Run failed')), 'failure cue is hidden with details off');
    await expect(await page.locator('.message.assistant .run-terminals').count() === 0, 'failure raw output leaked with details off');
  });

  await check('UI-02-active-run-minimal-default', async () => {
    await page.evaluate(({ prefs, data }) => {
      localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
      localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
    }, { prefs, data });
    streamFixture = true;
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitForPaint(page);
    await page.locator('#draft').fill('Run the branch check.'); await page.keyboard.press('Enter'); await page.waitForTimeout(180);
    await expect(await page.locator('.working-message').count() === 1, 'working state did not remain visible while stream was held');
    await expect(await page.locator('.working-message .message-copy').filter({ hasText: 'Stop' }).count() === 1, 'Stop control is not visible during active run');
    await expect(await page.locator('.working-message .live-run-terminals').count() === 0, 'active raw output leaked with details off');
    await expect(await page.locator('.working-message .run-activity').count() === 0, 'active investigation leaked with details off');
    await page.waitForTimeout(1100); streamFixture = false; await waitForPaint(page);
  });

  await page.screenshot({ path: path.join(outputDir, 'quality-mobile.png'), fullPage: true });
  await browser.close();
  const failed = checks.filter(item => item.status === 'FAIL');
  const evidence = { status: failed.length ? 'FAIL' : 'PASS', checks, requestCount: requests.filter(url => !url.includes('favicon')).length, viewport: '1440x900, 320x900, 200% root text stress', externalRequests: 0, liveProductFilesEdited: false };
  fs.writeFileSync(path.join(outputDir, 'quality-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  process.exitCode = failed.length ? 1 : 0;
})().catch(error => { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; });
