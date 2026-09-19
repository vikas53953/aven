const { chromium } = require('C:/Users/vikasmit/Downloads/vikas problems/netrok-muse/intentgraph/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = 'http://127.0.0.1:8767/polished.html?revision=minimal-ui-candidate';
const raw = 'interface Gi0/1\n  input errors 0\n  output errors 0';
const prefs = {
  theme: 'dark', accent: 'black', language: 'system', density: 'comfortable', displayName: '',
  activeAgent: 'companion', provider: 'Not connected', model: '', browser: true, computer: false,
  showEvidence: false, showInvestigation: false, showRunDetails: false, sections: [],
  agents: [{ id: 'companion', name: 'Network companion', role: 'Investigate branch networks and explain findings.', timezone: 'Follow system', autoReview: false }],
};
const assistant = {
  id: 'assistant-1', role: 'assistant', agentId: 'companion',
  text: '## Answer\nThe branch edge is responding normally.\n\n```text\n' + raw + '\n```',
  model: 'Unavailable', mode: 'inspect', status: 'SUCCESS', runId: 'run-1', usage: null,
  events: [{ type: 'tool_result', command: 'show interfaces', target: 'router-1', status: 'SUCCESS', output: raw }],
  evidence: [{ command: 'show interfaces', target: 'router-1', status: 'SUCCESS', output: raw }],
  createdAt: '2026-09-16T04:00:00.000Z',
};
const data = {
  activeChat: 'fixture-chat',
  chats: [{ id: 'fixture-chat', title: 'Fixture run', sample: false, channelId: null, projectId: null, recipients: ['companion'], draft: '', pendingAttachmentNames: [], pendingQueue: [], messages: [{ id: 'user-1', role: 'user', text: 'Check the branch edge.', mode: 'inspect', createdAt: '2026-09-16T03:59:00.000Z' }, assistant] }],
  channels: [], projects: [{ id: 'personal', name: 'Personal', system: true }],
};

function fail(message) { throw new Error(message); }
async function expect(condition, message) { if (!condition) fail(message); }
async function openSettings(page) {
  await page.locator('#account-button').click();
  await page.locator('#account-menu [data-account-action="settings"]').click();
  await page.locator('#settings-dialog').waitFor({ state: 'visible' });
  await page.locator('#settings-nav [data-category="presentation"]').click();
}
async function saveSettings(page, values) {
  for (const [id, value] of Object.entries(values)) {
    const input = page.locator(`#settings-content input[data-pref="${id}"]`);
    if ((await input.isChecked()) !== value) await input.click();
  }
  await page.locator('#save-settings').click();
  await page.waitForTimeout(120);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(({ prefs, data }) => {
    if (localStorage.getItem('aven-polished-preferences-v1')) return;
    localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
    localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
    localStorage.setItem('aven-polished-docs-v1', JSON.stringify({}));
    localStorage.setItem('aven-polished-direct-teams-migration-v4', 'v4');
  }, { prefs, data });
  const page = await context.newPage();
  const requests = [];
  const candidateRoot = path.join(__dirname, 'candidate');
  const candidateFiles = new Map(['polished.html', 'polished.css', 'polished.js', 'polished-workspace-tools.js'].map(name => [name, path.join(candidateRoot, name)]));
  await page.route('**/*', route => {
    const url = route.request().url();
    const file = path.posix.basename(new URL(url).pathname);
    if (candidateFiles.has(file)) return route.fulfill({ status: 200, contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(candidateFiles.get(file)) });
    if (url.startsWith('http://127.0.0.1:8767/')) { requests.push(url); return route.continue(); }
    return route.abort();
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await expect(await page.locator('#chat-mode').count() === 0, 'legacy inline mode picker is still present');
  await expect(await page.locator('#mode-scope').count() === 0, 'inline mode explanation is still present');
  await expect(!(await page.locator('body').innerText()).includes('Context preview'), 'verbose context preview copy is visible');
  await expect(!(await page.locator('body').innerText()).includes('OpenCode'), 'provider copy remains in normal chat');
  const ring = page.locator('#context-indicator');
  await expect(await ring.count() === 1, 'context ring is missing');
  await expect((await ring.getAttribute('title')).includes('unavailable'), 'context ring does not report unavailable capacity');
  await expect(!(await ring.getAttribute('title')).includes('%'), 'context ring fabricates a percentage');
  await expect(await page.locator('.message.assistant .message-body').innerText().then(t => t.includes('The branch edge is responding normally.')), 'main answer is not visible');
  await expect(await page.locator('.run-terminals').count() === 0, 'chat raw evidence is visible by default');
  await expect(await page.locator('.run-evidence').count() === 0, 'chat evidence/investigation is visible by default');
  await expect(await page.locator('.run-provenance').count() === 0, 'run details are visible by default');
  await page.screenshot({ path: 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/ui-release/candidate.png', fullPage: true });

  await openSettings(page);
  for (const id of ['showEvidence', 'showInvestigation', 'showRunDetails']) await expect(!(await page.locator(`#settings-content input[data-pref="${id}"]`).isChecked()), `${id} is not off by default`);
  await page.locator('#settings-content input[data-pref="showEvidence"]').click();
  await page.locator('#cancel-settings').click();
  await page.waitForTimeout(60);
  await expect(await page.locator('.run-terminals').count() === 0, 'Cancel committed evidence preference');

  await openSettings(page);
  await saveSettings(page, { showEvidence: true, showInvestigation: true, showRunDetails: true });
  await expect(await page.locator('.run-terminals').count() === 1, 'enabling evidence did not reveal raw output');
  await expect(await page.locator('.run-evidence.run-investigation').count() === 1, 'enabling investigation did not reveal activity');
  await expect(await page.locator('.run-evidence.run-evidence-summary').count() === 1, 'enabling evidence did not reveal evidence group');
  await expect(await page.locator('.run-provenance').count() === 1, 'enabling run details did not reveal provenance');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(await page.locator('.run-terminals').count() === 1, 'saved detail preferences did not survive reload');
  await openSettings(page);
  await saveSettings(page, { showEvidence: false, showInvestigation: true, showRunDetails: true });
  await expect(await page.locator('.run-terminals').count() === 0, 'disabling evidence did not restore minimal view');
  await expect(await page.locator('.run-investigation').count() === 1, 'investigation toggle was not independent');
  await expect(await page.locator('.run-provenance').count() === 1, 'run details toggle was not independent');

  await page.locator('#tools-menu').click();
  await expect(await page.locator('#add-menu [data-mode="inspect"]').innerText() === 'Agent', 'plus menu Agent label is not concise');
  await expect(await page.locator('#add-menu [data-mode="plan"]').innerText() === 'Plan', 'plus menu Plan label is not concise');
  await page.locator('#add-menu [data-mode="plan"]').click();
  let stored = JSON.parse(await page.evaluate(() => localStorage.getItem('aven-polished-chats-v1')));
  await expect(stored.chats.find(c => c.id === 'fixture-chat').mode === 'plan', 'Plan selection did not persist to chat mode');
  await page.locator('#tools-menu').click();
  await expect(await page.locator('#add-menu [data-mode="plan"]').getAttribute('aria-checked') === 'true', 'Plan selected state is not exposed');
  await page.locator('#add-menu [data-mode="inspect"]').click();
  stored = JSON.parse(await page.evaluate(() => localStorage.getItem('aven-polished-chats-v1')));
  await expect(stored.chats.find(c => c.id === 'fixture-chat').mode === 'inspect', 'Agent selection did not restore inspect mode');

  await page.locator('[data-destination="Artifacts"]').click();
  const artifact = page.locator('.aven-workspace-tools-artifact-details').first();
  await expect(await artifact.count() === 1, 'artifact detail card is missing');
  await expect(await artifact.getAttribute('open') === null, 'artifact output is open by default');
  await expect(await artifact.locator('summary').innerText().then(t => t.includes('show interfaces')), 'artifact summary is not concise/contextual');
  await artifact.locator('summary').click();
  await expect(await artifact.locator('.aven-workspace-tools-raw').innerText() === raw, 'expanded artifact output changed raw content');
  await expect(await artifact.locator('.aven-workspace-tools-provenance').count() === 1, 'expanded artifact is missing provenance');
  await artifact.locator('summary').click();
  await expect(await artifact.getAttribute('open') === null, 'artifact did not collapse again');

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(base, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  await expect(overflow.width <= overflow.client + 1, `narrow layout overflows horizontally: ${JSON.stringify(overflow)}`);
  await expect(await ring.count() === 1, 'context ring disappeared at narrow width');
  await page.screenshot({ path: 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/ui-release/candidate-mobile.png', fullPage: true });
  await browser.close();
  fs.writeFileSync('outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/ui-release/browser-evidence.json', JSON.stringify({ status: 'PASS', requests: requests.filter(url => !url.includes('favicon')), viewport: '1440x900 and 320x900', checks: 23 }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: 23 }));
})().catch(async error => { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; });
