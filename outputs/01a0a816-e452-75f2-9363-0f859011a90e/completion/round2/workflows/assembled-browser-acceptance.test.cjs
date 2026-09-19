'use strict';

// Root runs this file under the single browser-fixture lease. The server and
// responder are injected local fixtures; no provider or device is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require(path.resolve(__dirname, '../../../intentgraph/node_modules/playwright'));

const assembledRoot = path.resolve(__dirname, '..', '..', 'assembled-candidate');
const { start } = require(path.join(assembledRoot, 'intentgraph', 'server.cjs'));
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const capabilities = {
  schemaVersion: 1, checkedAt: null,
  providers: [{ id: 'opencode', label: 'OpenCode', status: 'configured', configured: true, connected: false, models: [{ id: 'mimo-v2.5', status: 'configured', efforts: ['none'] }] }]
};

test('assembled model/tool pending response renders one answerable UI card and resumes same run', async (t) => {
  if (!fs.existsSync(chrome)) return t.skip('Chrome executable is not installed');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-round2-browser-'));
  const server = await start({
    root,
    port: 0,
    executionOptions: { provider: { status: () => ({}) }, coordinator: { close() {} }, adapters: { close() {} }, delivery: {} },
    providerCapabilities: capabilities,
    chatResponder: async ({ messages }) => messages.length === 1
      ? { tool_calls: [{ name: 'ask_clarification', args: { prompt: 'Which exact device?', choices: [{ id: 'edge-a', label: 'Edge A' }], allow_free_text: false } }], source: 'provider-response', model: 'mock-model' }
      : { text: 'Resumed after Edge A', source: 'provider-response' }
  });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:8767', 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' },
      body: JSON.stringify({ chatId: 'assembled-browser', agentName: 'Test', mode: 'inspect', messages: [{ role: 'user', content: 'Inspect.' }] })
    });
    const waiting = await response.json();
    assert.equal(response.status, 200, JSON.stringify(waiting));
    assert.equal(waiting.status, 'waiting-question');

    const page = await browser.newPage();
    await page.setContent(`<main id="card"></main><script>${fs.readFileSync(path.join(assembledRoot, 'polished-approval-workflow.js'), 'utf8')}</script>`);
    await page.evaluate((state) => {
      window.answer = null;
      window.AvenApprovalWorkflow.renderConversationState(document.querySelector('#card'), state, { onAnswer: (value) => { window.answer = value; } });
    }, waiting);
    assert.equal(await page.locator('[data-workflow-card="pending-question"]').count(), 1);
    assert.equal(await page.getByText('Which exact device?').count(), 1);
    await page.locator('input[type="radio"]').check();
    await page.getByRole('button', { name: 'Answer' }).click();
    const answer = await page.evaluate(() => window.answer);
    assert.deepEqual(answer, { questionId: waiting.pendingQuestion.question.id, token: waiting.pendingQuestion.token, choice: 'edge-a' });

    const resumed = await fetch(`${base}/api/chat/workflow/answer`, {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:8767', 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' },
      body: JSON.stringify({ runId: waiting.runId, chatId: waiting.chatId, ...answer })
    });
    const completed = await resumed.json();
    assert.equal(resumed.status, 200, JSON.stringify(completed));
    assert.equal(completed.runId, waiting.runId);
    assert.equal(completed.status, 'completed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

