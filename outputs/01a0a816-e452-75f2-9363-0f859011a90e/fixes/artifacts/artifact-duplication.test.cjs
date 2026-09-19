'use strict';

// UX066 artifact reconciliation check. Each mode gets an isolated browser
// context and each fixture resets local storage; only the local static shell
// is allowed to load. The workspace-tools script is overlaid from an exact
// baseline or candidate artifact for comparison.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '..', '..', '..', '..', 'intentgraph', 'node_modules', 'playwright'));

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const outputDir = __dirname;
const baselinePath = path.join(repo, 'outputs', '01a0a816-e452-75f2-9363-0f859011a90e', 'fixes', 'baseline', 'polished-workspace-tools.js');
const candidatePath = path.join(outputDir, 'candidate', 'polished-workspace-tools.js');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const nodePath = 'C:/Users/vikasmit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const tests = [];

const raw = '\n Router#show interfaces\n\tGi0/1  up  up\n';
const iso = '2026-09-16T03:21:09.088Z';

function baseSeed(message) {
  return {
    prefs: {
      theme: 'dark', accent: 'black', density: 'comfortable', activeAgent: 'a', displayName: 'Vikas',
      agents: [
        { id: 'a', name: 'Firewall coworker', role: 'Security', label: 'Security', notifications: true, unread: false },
        { id: 'b', name: 'Router coworker', role: 'Routing', label: 'Routing', notifications: false, unread: false },
      ],
    },
    data: {
      activeChat: 'main', projects: [], channels: [], workspaceTools: {},
      chats: [{ id: 'main', title: 'Artifact duplication fixture', projectId: null, recipients: ['a'], draft: '', sample: false, messages: [message], pendingQueue: [] }],
    },
  };
}

function messageWith(events, evidence, extra = {}) {
  return { id: 'm-artifact', role: 'assistant', agentId: 'a', text: 'Artifact fixture', runId: 'message-run', createdAt: iso, events, evidence, ...extra };
}

function output(fields = {}) {
  return { command: 'show version', target: 'router-1', status: 'SUCCESS', source: 'mock-cli', output: raw, ...fields };
}

function cases() {
  const mirror = output();
  return [
    {
      id: 'mirror',
      message: messageWith([{ type: 'tool_result', runId: 'message-run', evidence: mirror }], [output()]),
      expected: { baseline: 2, candidate: 1 },
      output: [raw],
    },
    {
      id: 'empty-vs-missing',
      message: messageWith([{ evidence: output({ output: undefined }) }, { evidence: output({ output: '' }) }], [output({ output: undefined }), output({ output: '' })]),
      expected: { baseline: 2, candidate: 1 },
      output: [''],
    },
    {
      id: 'distinct-source',
      message: messageWith([{ evidence: output({ source: 'mock-cli-a' }) }], [output({ source: 'mock-cli-b' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'distinct-run',
      message: messageWith([{ evidence: output({ runId: 'run-a' }) }], [output({ runId: 'run-b' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'distinct-parent-run',
      message: messageWith([{ runId: 'run-a', target: 'router-1', evidence: output({ target: undefined }) }], [{ runId: 'run-b', target: 'router-2', evidence: output({ target: undefined }) }]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'actual-backend-shaped-mirror',
      message: messageWith([
        { runId: 'message-run', type: 'tool_result', toolId: '1', name: 'run_diagnostic', operation: 'show_version', hostname: 'router-1', status: 'SUCCESS', at: '2026-09-16T03:21:10.000Z', evidence: output({ time: '2026-09-16T03:21:09.000Z', startedAt: '2026-09-16T03:21:00.000Z' }) },
      ], [output({ time: '2026-09-16T03:21:09.000Z', startedAt: '2026-09-16T03:21:00.000Z' })]),
      expected: { baseline: 2, candidate: 1 },
      output: [raw],
    },
    {
      id: 'distinct-target',
      message: messageWith([{ evidence: output({ target: 'router-1' }) }], [output({ target: 'router-2' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'distinct-command',
      message: messageWith([{ evidence: output({ command: 'show version' }) }], [output({ command: 'show interfaces' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'distinct-output',
      message: messageWith([{ evidence: output({ output: raw }) }], [output({ output: `${raw}second result\n` })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'distinct-provenance',
      message: messageWith([{ evidence: output({ source: undefined, provenance: 'adapter-a' }) }], [output({ source: undefined, provenance: 'adapter-b' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'distinct-stable-id',
      message: messageWith([{ evidence: output({ id: 'result-a' }) }], [output({ id: 'result-b' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'swapped-identity-fields',
      message: messageWith([{ evidence: output({ id: 'result-a', runId: 'run-b' }) }], [output({ id: 'result-b', runId: 'run-a' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'distinct-timestamp',
      message: messageWith([{ evidence: output({ time: '2026-09-16T03:21:00.000Z' }) }], [output({ time: '2026-09-16T03:22:00.000Z' })]),
      expected: { baseline: 2, candidate: 2 },
    },
    {
      id: 'repeated-genuine-invocation',
      message: messageWith([{ evidence: output() }, { evidence: output() }], [output(), output()]),
      expected: { baseline: 4, candidate: 4 },
    },
    {
      id: 'order-and-one-to-one',
      message: messageWith([{ evidence: output({ output: 'first\n' }) }, { evidence: output({ output: 'second\n' }) }], [output({ output: 'second\n' }), output({ output: 'third\n' })]),
      expected: { baseline: 4, candidate: 3 },
      output: ['first\n', 'second\n', 'third\n'],
    },
    {
      id: 'ambiguous-no-identity',
      message: messageWith([{ evidence: output() }, { evidence: output() }], [output()]),
      expected: { baseline: 3, candidate: 3 },
    },
    {
      id: 'merge-provenance',
      message: messageWith([{ evidence: output({ source: undefined }) }], [output({ source: 'mock-cli' })]),
      expected: { baseline: 2, candidate: 1 },
      output: [raw],
    },
  ];
}

function serveStatic(root) {
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404); response.end(); return;
      }
      const extension = path.extname(file).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(response);
    } catch (_) { response.writeHead(400); response.end(); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function checkManifest() {
  const baseline = fs.readFileSync(baselinePath, 'utf8');
  const candidate = fs.readFileSync(candidatePath, 'utf8');
  const manifestPath = path.join(outputDir, 'replacements.json');
  const replacements = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(replacements) || !replacements.length) throw new Error('Replacement manifest is empty.');
  for (const replacement of replacements) {
    if (replacement.file !== 'polished-workspace-tools.js' || !baseline.includes(replacement.old) || !candidate.includes(replacement.new)) throw new Error('Replacement manifest does not contain exact baseline/candidate blocks.');
  }
  return replacements.length;
}

async function createHarness(browser, origin, mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const blocked = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const isStatic = requestUrl.origin === origin && !requestUrl.pathname.startsWith('/api/');
    if (!isStatic) { blocked.push(requestUrl.href); return route.abort(); }
    if (mode !== 'integrated' && requestUrl.pathname === '/polished-workspace-tools.js') {
      const sourcePath = mode === 'baseline' ? baselinePath : candidatePath;
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(sourcePath, 'utf8') });
    }
    return route.continue();
  });
  return { context, page, blocked, pageErrors, loaded: false };
}

async function runCase(harness, origin, fixture, mode) {
  const { page, blocked, pageErrors } = harness;
  blocked.length = 0;
  pageErrors.length = 0;
  try {
    if (!harness.loaded) { await page.goto(`${origin}/polished.html`, { waitUntil: 'domcontentloaded' }); harness.loaded = true; }
    await page.evaluate(({ prefs, data }) => {
      localStorage.clear();
      localStorage.setItem('aven-polished-preferences-v1', JSON.stringify(prefs));
      localStorage.setItem('aven-polished-chats-v1', JSON.stringify(data));
      localStorage.setItem('aven-polished-docs-v1', JSON.stringify({ a: { 'SOUL.md': '# local soul', 'MEMORY.md': 'private note' } }));
      localStorage.setItem('aven-polished-direct-teams-migration-v4', 'v4');
    }, baseSeed(fixture.message));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-destination="Artifacts"]').click();
    await page.locator('#pane-content .aven-workspace-tools-view').waitFor();
    const cards = await page.locator('#pane-content .aven-workspace-tools-artifact').count();
    const outputs = await page.locator('#pane-content .aven-workspace-tools-raw').evaluateAll((nodes) => nodes.map((node) => node.textContent));
    return { id: fixture.id, mode, expected: fixture.expected[mode] ?? fixture.expected.candidate, cards, outputs, blocked, pageErrors, passed: cards === (fixture.expected[mode] ?? fixture.expected.candidate) && (!fixture.output || JSON.stringify(outputs) === JSON.stringify(fixture.output)) };
  } catch (error) {
    return { id: fixture.id, mode, expected: fixture.expected[mode] ?? fixture.expected.candidate, error: String(error?.stack || error), blocked, pageErrors, passed: false };
  }
}

async function run() {
  const integrated = process.argv.includes('--integrated');
  const modes = integrated ? ['integrated'] : ['baseline', 'candidate'];
  const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice('--only='.length);
  const manifestCount = checkManifest();
  tests.push({ name: 'replacement manifest exactness', command: `${nodePath} artifact-duplication.test.cjs`, exitCode: 0, result: `PASS: ${manifestCount} exact baseline blocks and candidate replacements` });
  const staticServer = await serveStatic(repo);
  const origin = `http://127.0.0.1:${staticServer.port}`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const evidence = [];
  try {
    for (const mode of modes) {
      const harness = await createHarness(browser, origin, mode);
      try {
        for (const fixture of cases().filter((item) => !only || item.id === only)) evidence.push(await runCase(harness, origin, fixture, mode));
      } finally { await harness.context.close(); }
      const modeResults = evidence.filter((result) => result.mode === mode);
      tests.push({ mode, command: `${nodePath} artifact-duplication.test.cjs${integrated ? ' --integrated' : ''}`, exitCode: modeResults.every((result) => result.passed && result.blocked.length === 0 && result.pageErrors.length === 0) ? 0 : 1, result: modeResults.every((result) => result.passed) ? 'PASS' : 'FAIL' });
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => staticServer.server.close(resolve));
  }
  const record = { at: new Date().toISOString(), integrated, blockedPolicy: 'Only local static shell traffic is allowed; API and every non-static origin are aborted; no provider, device, or user storage is used.', tests, evidence };
  const suffix = integrated ? 'integrated' : 'comparison';
  fs.writeFileSync(path.join(outputDir, `evidence-${suffix}.json`), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  if (tests.some((test) => test.exitCode !== 0)) process.exitCode = 1;
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
