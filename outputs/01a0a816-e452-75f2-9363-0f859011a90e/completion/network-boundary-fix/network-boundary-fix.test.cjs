'use strict';

/* Offline adversarial fixtures for the candidate health/status boundary. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const FIX_ROOT = __dirname;
const COMPLETION_ROOT = path.resolve(FIX_ROOT, '..');
const PRODUCT_ROOT = path.resolve(process.env.AVEN_PRODUCT_ROOT || path.resolve(COMPLETION_ROOT, '..', '..', '..'));
const CANDIDATE_ROOT = path.join(FIX_ROOT, 'candidate');
const RUNTIME_PATH = path.resolve(process.env.AVEN_AGENT_RUNTIME_PATH || path.join(CANDIDATE_ROOT, 'intentgraph', 'agent-runtime.cjs'));
process.env.NODE_PATH = [path.join(PRODUCT_ROOT, 'intentgraph', 'node_modules'), path.join(COMPLETION_ROOT, 'baseline', 'intentgraph', 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();

const { BaseChatModel } = require('@langchain/core/language_models/chat_models');
const { AIMessage } = require('@langchain/core/messages');
const { respond, OPERATIONS } = require(RUNTIME_PATH);

const DEVICE_ID = 'aa754801-8895-41e8-8ca5-27ee415c9c42';
const SNAPSHOT_TIME = '2026-09-15T00:00:00.000Z';
const SNAPSHOT = {
  source: 'cisco-catalyst',
  retrievedAt: SNAPSHOT_TIME,
  devices: [{ id: DEVICE_ID, hostname: 'sw1', managementIp: '192.0.2.9', platform: 'Cisco', softwareVersion: '17.1', reachability: 'Reachable' }]
};

class ScriptedModel extends BaseChatModel {
  constructor({ steps, indexRef = { current: 0 }, tools = [], onBind } = {}) {
    super({});
    this.steps = steps;
    this.indexRef = indexRef;
    this.tools = tools;
    this.onBind = onBind;
  }
  _llmType() { return 'offline-health-boundary-fixture'; }
  _combineLLMOutput() { return {}; }
  bindTools(tools) {
    this.onBind?.(tools);
    return new ScriptedModel({ steps: this.steps, indexRef: this.indexRef, tools: [...tools], onBind: this.onBind });
  }
  async _generate(messages) {
    const step = this.steps[Math.min(this.indexRef.current++, this.steps.length - 1)];
    const response = typeof step === 'function' ? await step(messages, this.tools) : step;
    const message = new AIMessage({ content: response?.content || '', tool_calls: response?.tool_calls || [] });
    return { generations: [{ text: message.content, message }], llmOutput: {} };
  }
}

function fixtureModel(steps, hooks = {}) {
  return {
    modelFactory: async () => new ScriptedModel({ steps, ...hooks }),
    getKey: async () => 'offline-health-boundary-key'
  };
}

function sandbox({ inventory = SNAPSHOT, runCommandImpl } = {}) {
  const calls = { inventory: 0, runCommand: 0, lastCommand: null };
  return {
    calls,
    supportedCommands: [...OPERATIONS],
    async inventory() { calls.inventory += 1; return inventory; },
    async runCommand(input) {
      calls.runCommand += 1;
      calls.lastCommand = input;
      return runCommandImpl ? runCommandImpl(input) : { status: 'SUCCESS', output: 'sw1# show version\nVersion 17.1', startedAt: SNAPSHOT_TIME, elapsedMs: 4 };
    }
  };
}

function read(filePath) { return fs.readFileSync(filePath, 'utf8'); }
function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(); }

async function normalExplanation() {
  const device = sandbox();
  const run = await respond({ sandbox: device, messages: [{ role: 'user', content: 'What is a VLAN?' }], ...fixtureModel([{ content: 'A VLAN separates traffic into a logical broadcast domain.' }]) });
  assert.match(run.text, /VLAN/);
  assert.deepEqual(run.evidence, []);
  assert.equal(run.healthAssessment, undefined);
  assert.equal(run.advisoryText, undefined);
  assert.equal(device.calls.inventory, 0);
  assert.equal(device.calls.runCommand, 0);
  return { status: 'PASS', detail: 'normal explanation retained model response and did not create health metadata or network calls' };
}

async function unknownFailsClosed() {
  const submitted = Object.assign(Error('fixture transport did not return a result'), { submitted: true });
  const device = sandbox({ runCommandImpl: () => { throw submitted; } });
  const run = await respond({
    sandbox: device,
    messages: [{ role: 'user', content: 'Is sw1 healthy?' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'unknown', type: 'tool_call' }] },
      { content: 'sw1 is healthy.' }
    ])
  });
  assert.equal(run.evidence[0].status, 'UNKNOWN');
  assert.doesNotMatch(run.text, /healthy/i, 'authoritative response must not preserve adversarial health prose');
  assert.match(run.text, /show version on sw1: UNKNOWN/);
  assert.match(run.text, /Device health is not established by these checks\./);
  assert.match(run.advisoryText, /healthy/i, 'adversarial model text remains explicitly advisory only');
  assert.deepEqual(run.healthAssessment, { status: 'not_assessed', reason: 'Command completion is not a device health assessment.' });
  return { status: 'PASS', detail: 'UNKNOWN transport yields deterministic authoritative status; contradictory model prose is advisory only', authoritativeText: run.text, advisoryText: run.advisoryText };
}

async function failureFailsClosed() {
  const device = sandbox({ runCommandImpl: () => ({ status: 'FAILURE', output: '', startedAt: SNAPSHOT_TIME, elapsedMs: 3 }) });
  const run = await respond({
    sandbox: device,
    messages: [{ role: 'user', content: 'Check sw1.' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'failure', type: 'tool_call' }] },
      { content: 'The command completed successfully and the device is healthy.' }
    ])
  });
  assert.equal(run.evidence[0].status, 'FAILURE');
  assert.doesNotMatch(run.text, /successfully|healthy/i);
  assert.match(run.text, /show version on sw1: FAILURE/);
  assert.match(run.text, /Device health is not established by these checks\./);
  assert.match(run.advisoryText, /successfully|healthy/i);
  return { status: 'PASS', detail: 'FAILURE transport yields deterministic authoritative status and hides contradictory model prose', authoritativeText: run.text };
}

async function successHasUnassessedHealth() {
  const faultyOutput = 'sw1# show version\nVersion 17.1\n%FAN-3-FAIL: fan tray failed\nHealth: CRITICAL';
  const device = sandbox({ runCommandImpl: () => ({ status: 'SUCCESS', output: faultyOutput, startedAt: SNAPSHOT_TIME, elapsedMs: 7 }) });
  const run = await respond({
    sandbox: device,
    messages: [{ role: 'user', content: 'Check whether sw1 is healthy.' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'success-fault', type: 'tool_call' }] },
      { content: 'sw1 is healthy.' }
    ])
  });
  assert.equal(run.evidence[0].status, 'SUCCESS');
  assert.match(run.evidence[0].output, /FAN-3-FAIL/);
  assert.deepEqual(run.healthAssessment, { status: 'not_assessed', reason: 'Command completion is not a device health assessment.' });
  assert.doesNotMatch(JSON.stringify(run.healthAssessment), /healthy/i);
  assert.match(run.text, /healthy/i, 'all-success model interpretation remains allowed but is not the healthAssessment');
  return { status: 'PARTIAL', detail: 'SUCCESS retains raw fault evidence and exposes healthAssessment=not_assessed; an adversarial model may still make an untrusted health claim', limitation: 'A trusted raw-output health classifier is intentionally absent; command completion alone is never promoted to healthy.' };
}

async function successKeepsInterpretationAndMetadata() {
  const device = sandbox();
  const run = await respond({
    sandbox: device,
    messages: [{ role: 'user', content: 'Read the version on sw1.' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'success', type: 'tool_call' }] },
      { content: 'Version 17.1 was observed. Device health is not assessed by this command.' }
    ])
  });
  assert.equal(run.evidence[0].status, 'SUCCESS');
  assert.match(run.text, /Version 17\.1/);
  assert.deepEqual(run.healthAssessment, { status: 'not_assessed', reason: 'Command completion is not a device health assessment.' });
  return { status: 'PASS', detail: 'all-success diagnostic retains grounded model interpretation plus deterministic not_assessed metadata' };
}

async function planStillHasNoTools() {
  const device = sandbox();
  let boundToolCount = null;
  const run = await respond({ mode: 'plan', sandbox: device, messages: [{ role: 'user', content: 'Plan a check for sw1.' }], ...fixtureModel([(messages, tools) => { boundToolCount = tools.length; return { content: 'Plan only. Switch to inspect before reading current evidence.' }; }], { onBind: tools => { boundToolCount = tools.length; } }) });
  assert.equal(boundToolCount, 0);
  assert.deepEqual(run.evidence, []);
  assert.equal(device.calls.inventory, 0);
  assert.equal(device.calls.runCommand, 0);
  return { status: 'PASS', detail: 'plan mode remains zero-tool and has no health metadata' };
}

function staticUiLabels() {
  const uiPath = path.join(CANDIDATE_ROOT, 'polished.js');
  const ui = read(uiPath);
  assert.match(ui, /Execution: '\+String\(item\.status\|\|'UNKNOWN'\)/);
  assert.match(ui, /Execution status: '\+String\(item\.status\|\|'UNKNOWN'\)/);
  assert.match(ui, /healthAssessment:result\.healthAssessment/);
  assert.match(ui, /Execution status is separate from device health/);
  assert.match(ui, /Health: not assessed/);
  assert.match(ui, /Device health is not established by these checks/);
  assert.match(ui, /const failures=raw\.filter\(e=>e\.status&&e\.status!==\'SUCCESS\'\);const explanation=failures\.length\?\'\':rawTextForMessage\(m\)\.trim\(\);/);
  return { status: 'PASS', detail: 'candidate UI labels execution status explicitly and surfaces health only as not assessed in optional run details' };
}

function exactReplacementProof() {
  const manifest = JSON.parse(read(path.join(FIX_ROOT, 'replacements.json')));
  assert.equal(Array.isArray(manifest.replacements), true);
  for (const group of [
    { file: 'intentgraph/agent-runtime.cjs', candidate: path.join(CANDIDATE_ROOT, 'intentgraph', 'agent-runtime.cjs') },
    { file: 'polished.js', candidate: path.join(CANDIDATE_ROOT, 'frozen-v8', 'polished.js') }
  ]) {
    const originalPath = manifest.replacements.find(item => item.file === group.file).sourcePath;
    const original = read(originalPath);
    for (const hunk of manifest.replacements.filter(item => item.file === group.file)) assert.equal(original.split(hunk.old).length, 2, `${group.file}: baseline anchor is not unique`);
    let text = original;
    for (const hunk of manifest.replacements.filter(item => item.file === group.file)) {
      assert.equal(crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').toUpperCase(), hunk.sourceSHA256Before, `${group.file}: sequential source changed before hunk`);
      assert.equal(text.indexOf(hunk.old) >= 0, true, `${group.file}: exact old hunk missing`);
      text = text.replace(hunk.old, hunk.new);
      assert.equal(crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').toUpperCase(), hunk.sourceSHA256After);
    }
    assert.equal(sha256(group.candidate), crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').toUpperCase(), `${group.file}: candidate differs from sequential hunk application`);
  }
  return { status: 'PASS', detail: 'all runtime/UI replacements apply once in sequence with recorded SHA-256 before/after proofs', hunkCount: manifest.replacements.length };
}

function originalRuntimeRegression() {
  const candidateIntentgraph = path.join(CANDIDATE_ROOT, 'intentgraph');
  const testFiles = ['agent-runtime.test.cjs', 'chat-runtime.test.cjs'];
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: candidateIntentgraph,
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`.slice(-12000));
  return { status: 'PASS', detail: 'frozen agent-runtime.test.cjs and chat-runtime.test.cjs passed against the candidate overlay', outputTail: result.stdout.slice(-1200) };
}

const cases = [
  ['exact-baseline-apply', exactReplacementProof],
  ['original-runtime-regression', originalRuntimeRegression],
  ['normal-explanation', normalExplanation],
  ['unknown-fails-closed', unknownFailsClosed],
  ['failure-fails-closed', failureFailsClosed],
  ['success-fault-output-health-unassessed', successHasUnassessedHealth],
  ['success-interpretation-health-unassessed', successKeepsInterpretationAndMetadata],
  ['plan-zero-tools', planStillHasNoTools],
  ['ui-execution-health-labels', staticUiLabels]
];

async function main() {
  const results = [];
  for (const [id, execute] of cases) {
    const startedAt = new Date().toISOString();
    try { results.push({ id, ...(await execute()), startedAt, finishedAt: new Date().toISOString() }); }
    catch (error) { results.push({ id, status: 'FAIL', detail: error.message, error: { name: error.name, code: error.code || null }, startedAt, finishedAt: new Date().toISOString() }); }
  }
  const hashes = {
    liveAgentRuntime: sha256(path.join(PRODUCT_ROOT, 'intentgraph', 'agent-runtime.cjs')),
    frozenAgentRuntime: sha256(path.join(COMPLETION_ROOT, 'baseline', 'intentgraph', 'agent-runtime.cjs')),
    candidateAgentRuntime: sha256(path.join(CANDIDATE_ROOT, 'intentgraph', 'agent-runtime.cjs')),
    latestMinimalUiCandidate: sha256(path.join(COMPLETION_ROOT, 'minimal-ui', 'candidate', 'polished.js')),
    candidateFrozenV8PolishedJs: sha256(path.join(CANDIDATE_ROOT, 'frozen-v8', 'polished.js')),
    preservedMinimalUiPolishedJs: sha256(path.join(CANDIDATE_ROOT, 'minimal-ui-health', 'polished.js')),
    livePolishedJs: sha256(path.join(PRODUCT_ROOT, 'polished.js'))
  };
  const report = {
    schemaVersion: 1,
    suite: 'network-boundary-fix',
    productRoot: PRODUCT_ROOT,
    runtimePath: RUNTIME_PATH,
    testCount: results.length,
    passCount: results.filter(item => item.status === 'PASS').length,
    partialCount: results.filter(item => item.status === 'PARTIAL').length,
    failCount: results.filter(item => item.status === 'FAIL').length,
    results,
    acceptanceRows: { UX079: results.some(item => item.id === 'unknown-fails-closed' && item.status === 'PASS') && results.some(item => item.id === 'success-fault-output-health-unassessed' && item.status === 'PARTIAL') ? 'PARTIAL' : 'FAIL', UX106: results.some(item => item.id === 'unknown-fails-closed' && item.status === 'PASS') && results.some(item => item.id === 'failure-fails-closed' && item.status === 'PASS') ? 'PASS' : 'FAIL' },
    sourceHashes: hashes,
    noExternalCalls: true,
    noCredentials: true,
    limitation: 'Unknown/failure outcomes are fail-closed deterministically. All-success raw output remains health-unassessed; without a trusted classifier, an adversarial model interpretation is advisory only by contract but can still be semantically wrong.'
  };
  fs.writeFileSync(path.join(FIX_ROOT, 'fix-evidence.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(FIX_ROOT, 'fix-handoff.json'), JSON.stringify({ schemaVersion: 1, suite: report.suite, command: `${process.execPath} ${path.relative(PRODUCT_ROOT, __filename)}`, buildCommand: `${process.execPath} ${path.relative(PRODUCT_ROOT, path.join(FIX_ROOT, 'build-candidate.cjs'))}`, results: results.map(({ id, status, detail, limitation }) => ({ id, status, detail, ...(limitation ? { limitation } : {}) })), acceptanceRows: report.acceptanceRows, sourceHashes: hashes }, null, 2) + '\n');
  console.log(JSON.stringify({ suite: report.suite, testCount: report.testCount, passCount: report.passCount, partialCount: report.partialCount, failCount: report.failCount, acceptanceRows: report.acceptanceRows, evidence: path.join(FIX_ROOT, 'fix-evidence.json') }, null, 2));
  if (report.failCount) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
