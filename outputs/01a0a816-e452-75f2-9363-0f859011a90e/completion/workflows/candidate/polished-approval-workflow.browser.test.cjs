'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require(path.resolve(__dirname, '../../../../../intentgraph/node_modules/playwright'));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('workflow cards show exact review data and invoke only explicit UI callbacks', async (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome executable is not installed');
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  try {
    const page = await browser.newPage();
    const script = fs.readFileSync(path.join(__dirname, 'polished-approval-workflow.js'), 'utf8');
    await page.setContent(`<main id="card"></main><script>${script}</script>`);
    const pending = {
      type: 'pending-question-card', interactive: true, executing: false, action: 'none',
      question: { id: 'question-1', prompt: 'Which exact device?', choices: [{ id: 'edge-17', label: 'Edge 17' }], allowFreeText: true }
    };
    await page.evaluate((card) => {
      window.answer = null;
      window.AvenApprovalWorkflow.render(document.querySelector('#card'), card, { onAnswer: (value) => { window.answer = value; }, token: 'question-token' });
    }, pending);
    assert.equal(await page.locator('[data-workflow-card="pending-question"]').count(), 1);
    assert.equal(await page.getByText('Which exact device?').count(), 1);
    await page.locator('input[type="radio"]').check();
    await page.getByRole('button', { name: 'Answer' }).click();
    assert.deepEqual(await page.evaluate(() => window.answer), { questionId: 'question-1', token: 'question-token', choice: 'edge-17' });

    await page.evaluate(() => {
      window.stopped = null;
      window.AvenApprovalWorkflow.renderConversationState(document.querySelector('#card'), {
        status: 'running', pendingQuestion: { question: { id: 'resumed-question', prompt: 'Resuming scope?', choices: ['edge-17'] } }
      }, { onStop: (value) => { window.stopped = value; } });
    });
    assert.equal(await page.getByRole('button', { name: 'Stop' }).isVisible(), true);
    await page.getByRole('button', { name: 'Stop' }).click();
    assert.deepEqual(await page.evaluate(() => window.stopped), { questionId: 'resumed-question' });

    await page.evaluate(() => {
      window.answer = null;
      window.AvenApprovalWorkflow.renderConversationState(document.querySelector('#card'), {
        status: 'waiting-question',
        pendingQuestion: { question: { id: 'expired-question', prompt: 'Expired scope?', choices: ['edge-17'], expiresAt: Date.now() - 1 } }
      }, { onAnswer: (value) => { window.answer = value; }, token: 'expired-token' });
    });
    assert.equal(await page.getByRole('button', { name: 'Answer' }).isDisabled(), true, 'expired question cannot be answered from the card');
    assert.equal(await page.evaluate(() => window.answer), null);

    await page.evaluate(() => {
      window.abandoned = null;
      window.AvenApprovalWorkflow.renderConversationState(document.querySelector('#card'), {
        status: 'restored-history',
        pendingQuestion: { question: { id: 'restored-question', prompt: 'Refresh-safe scope?', choices: ['edge-17'] } }
      }, { onAbandon: (value) => { window.abandoned = value; } });
    });
    await page.getByRole('button', { name: 'Start fresh request' }).click();
    assert.deepEqual(await page.evaluate(() => window.abandoned), { questionId: 'restored-question' });

    const approval = {
      type: 'execution-approval-card', interactive: true, executionAllowed: true, executing: false,
      approval: { id: 'approval-1', status: 'pending', actionDigest: 'a'.repeat(64) },
      receipt: {
        target: { deviceId: 'edge-17' }, operation: 'description update', scope: { deviceIds: ['edge-17'] },
        scopeDigest: 'b'.repeat(64), action: { mode: 'write' }, actionDigest: 'a'.repeat(64),
        diff: { before: 'old', after: 'new' }, impact: { affectedDevices: ['edge-17'] }, rollback: { available: false }
      }
    };
    await page.evaluate((card) => {
      window.approve = null;
      window.AvenApprovalWorkflow.render(document.querySelector('#card'), card, { onApprove: (value) => { window.approve = value; }, token: 'approval-token' });
    }, approval);
    assert.equal(await page.getByText('Exact change review').count(), 1);
    assert.equal(await page.getByText('b'.repeat(64)).count(), 1);
    assert.equal(await page.getByText('Rollback limits').count(), 1);
    await page.getByRole('button', { name: 'Approve' }).click();
    assert.deepEqual(await page.evaluate(() => window.approve), { approvalId: 'approval-1', token: 'approval-token', actionDigest: 'a'.repeat(64), scope: { deviceIds: ['edge-17'] } });

    await page.evaluate((state) => {
      window.executed = null;
      window.AvenApprovalWorkflow.renderConversationState(document.querySelector('#card'), state, { onExecute: (value) => { window.executed = value; } });
    }, {
      status: 'approved',
      approval: { id: 'approval-1', status: 'approved', actionDigest: 'a'.repeat(64) },
      executionToken: 'execution-token', receipt: approval.receipt
    });
    assert.equal(await page.getByText('Approved · mock execution only. No live provider or device write is implied.').count(), 1);
    await page.getByRole('button', { name: 'Run approved mock' }).click();
    assert.deepEqual(await page.evaluate(() => window.executed), { approvalId: 'approval-1', token: 'execution-token', actionDigest: 'a'.repeat(64), scope: { deviceIds: ['edge-17'] } });

    await page.evaluate((state) => window.AvenApprovalWorkflow.renderConversationState(document.querySelector('#card'), state), {
      status: 'approved', executionAllowed: true,
      approval: { id: 'approval-1', status: 'approved', actionDigest: 'a'.repeat(64), expiresAt: Date.now() - 1 }, receipt: approval.receipt
    });
    assert.equal(await page.getByRole('button', { name: 'Run approved mock' }).count(), 0, 'expired approval cannot expose an execution action');

    await page.evaluate((state) => window.AvenApprovalWorkflow.renderConversationState(document.querySelector('#card'), state), {
      status: 'restored-history', mode: 'write', proposal: { status: 'proposed' }, receipt: approval.receipt
    });
    assert.equal(await page.getByText('Restored review · fresh request required').count(), 1);
    assert.equal(await page.getByText('Restored history cannot authorize an action.').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Approve' }).count(), 0);
  } finally {
    await browser.close();
  }
});
