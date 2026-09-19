'use strict';

/*
 * Focused, offline acceptance fixtures for UX077, UX079, and UX106.
 *
 * This runner loads the actual agent-runtime/network-execution modules and
 * drives them with an injected LangChain model plus an injected network
 * facade.  It never reads credentials or opens a socket.  AVEN_PRODUCT_ROOT
 * may point at a final integrated checkout for a rerun.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const OUTPUT_ROOT = __dirname;
const DEFAULT_PRODUCT_ROOT = path.resolve(OUTPUT_ROOT, '..', '..', '..', '..');
const PRODUCT_ROOT = path.resolve(process.env.AVEN_PRODUCT_ROOT || DEFAULT_PRODUCT_ROOT);
process.env.NODE_PATH = [path.join(PRODUCT_ROOT, 'intentgraph', 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();

const { BaseChatModel } = require('@langchain/core/language_models/chat_models');
const { AIMessage } = require('@langchain/core/messages');

const { respond } = require(path.join(PRODUCT_ROOT, 'intentgraph', 'agent-runtime.cjs'));
const { createNetworkExecution } = require(path.join(PRODUCT_ROOT, 'intentgraph', 'network-execution.cjs'));
const { SUPPORTED_COMMANDS, isUuid } = require(path.join(PRODUCT_ROOT, 'intentgraph', 'catalyst.cjs'));
const networkCommands = require(path.join(PRODUCT_ROOT, 'intentgraph', 'network-commands.json'));

const DEVICE_ID = 'aa754801-8895-41e8-8ca5-27ee415c9c42';
const SNAPSHOT_TIME = '2026-09-15T00:00:00.000Z';
const CATALYST_DEVICE = {
  id: DEVICE_ID,
  hostname: 'sw1',
  managementIp: '192.0.2.9',
  platform: 'Cisco',
  softwareVersion: '17.1',
  reachability: 'Reachable'
};

class ScriptedModel extends BaseChatModel {
  constructor({ steps, indexRef = { current: 0 }, tools = [], onBind, onGenerate } = {}) {
    super({});
    this.steps = steps;
    this.indexRef = indexRef;
    this.tools = tools;
    this.onBind = onBind;
    this.onGenerate = onGenerate;
  }

  _llmType() { return 'offline-network-boundary-fixture'; }
  _combineLLMOutput() { return {}; }

  bindTools(tools) {
    this.onBind?.(tools);
    return new ScriptedModel({ steps: this.steps, indexRef: this.indexRef, tools: [...tools], onBind: this.onBind, onGenerate: this.onGenerate });
  }

  async _generate(messages) {
    const step = this.steps[Math.min(this.indexRef.current++, this.steps.length - 1)];
    this.onGenerate?.({ messages, tools: this.tools });
    const response = typeof step === 'function' ? await step(messages, this.tools) : step;
    const message = new AIMessage({ content: response?.content || '', tool_calls: response?.tool_calls || [] });
    return { generations: [{ text: message.content, message }], llmOutput: {} };
  }
}

function fixtureModel(steps, hooks = {}) {
  const model = new ScriptedModel({ steps, ...hooks });
  return {
    modelFactory: async () => model,
    getKey: async () => 'mock-boundary-key'
  };
}

function catalystFacade({ runResult, inventoryResult = { devices: [CATALYST_DEVICE], retrievedAt: SNAPSHOT_TIME }, inventoryError } = {}) {
  const calls = { inventory: 0, runCommand: 0, lastRun: null };
  const catalyst = {
    async inventory() {
      calls.inventory += 1;
      if (inventoryError) throw inventoryError;
      return { source: 'cisco-catalyst', retrievedAt: SNAPSHOT_TIME, ...inventoryResult };
    },
    async runCommand(input) {
      calls.runCommand += 1;
      calls.lastRun = input;
      if (typeof runResult === 'function') return runResult(input);
      return runResult || { status: 'SUCCESS', output: 'sw1# show version\nVersion 17.1', startedAt: SNAPSHOT_TIME, elapsedMs: 4 };
    }
  };
  const adapters = {
    readProfiles: () => [],
    networkRead: async () => { throw Error('unexpected adapter call'); }
  };
  return { sandbox: createNetworkExecution({ catalyst, adapters }), calls };
}

function sshFacade({ readResult, readError, profiles = [{ id: 'lab-sw1', host: '192.0.2.1', platform: 'cisco_ios' }] } = {}) {
  const calls = { inventory: 0, networkRead: 0, lastRead: null };
  const catalyst = {
    async inventory() {
      calls.inventory += 1;
      return { source: 'cisco-catalyst', retrievedAt: SNAPSHOT_TIME, devices: [] };
    }
  };
  const adapters = {
    readProfiles: () => profiles,
    async networkRead(input) {
      calls.networkRead += 1;
      calls.lastRead = input;
      if (readError) throw readError;
      return readResult || { output: 'lab-sw1# show version\nVersion 17.1' };
    }
  };
  return { sandbox: createNetworkExecution({ catalyst, adapters }), calls };
}

function sha256(filePath) {
  return fs.existsSync(filePath) ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase() : null;
}

function sourceInventory() {
  const candidateRoot = path.join(OUTPUT_ROOT, '..', 'minimal-ui', 'candidate');
  const paths = {
    liveHtml: path.join(PRODUCT_ROOT, 'polished.html'),
    liveJs: path.join(PRODUCT_ROOT, 'polished.js'),
    candidateHtml: path.join(candidateRoot, 'polished.html'),
    candidateJs: path.join(candidateRoot, 'polished.js'),
    agentRuntime: path.join(PRODUCT_ROOT, 'intentgraph', 'agent-runtime.cjs'),
    networkExecution: path.join(PRODUCT_ROOT, 'intentgraph', 'network-execution.cjs'),
    catalyst: path.join(PRODUCT_ROOT, 'intentgraph', 'catalyst.cjs'),
    networkCommands: path.join(PRODUCT_ROOT, 'intentgraph', 'network-commands.json'),
    acceptance: path.join(OUTPUT_ROOT, '..', 'acceptance.txt')
  };
  return Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, { path: filePath, sha256: sha256(filePath) }]));
}

function read(filePath) { return fs.readFileSync(filePath, 'utf8'); }

async function expectInvalidOperationIsBounded() {
  const { sandbox, calls } = catalystFacade();
  const events = [];
  let boundToolNames = [];
  let error = null;
  try {
    await respond({
      sandbox,
      messages: [{ role: 'user', content: 'Inspect sw1 with reload.' }],
      onEvent: event => events.push(event),
      ...fixtureModel([
        { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'reload', hostname: 'sw1' }, id: 'invalid-op', type: 'tool_call' }] },
        { content: 'The unsupported operation was not executed.' }
      ], { onBind: tools => { boundToolNames = tools.map(tool => tool.name); } })
    });
  } catch (caught) { error = caught; }
  assert.equal(calls.runCommand, 0, 'unsupported operation must never reach the device facade');
  assert.equal(calls.inventory, 0, 'schema rejection happens before inventory resolution');
  assert.deepEqual(boundToolNames, ['inventory', 'run_diagnostic']);
  return { status: 'PASS', detail: 'reload produced no device-side effect; only inventory and run_diagnostic tools were bound', errorCode: error?.code || error?.name || null, eventCount: events.length };
}

async function expectPlanHasNoTools() {
  const { sandbox, calls } = catalystFacade();
  let boundToolCount = null;
  const run = await respond({
    mode: 'plan',
    sandbox,
    messages: [{ role: 'user', content: 'Plan a diagnostic for sw1; do not run it yet.' }],
    ...fixtureModel([
      (messages, tools) => {
        boundToolCount = tools.length;
        return { content: 'Plan only: switch to inspect mode before reading current inventory.' };
      }
    ], { onBind: tools => { boundToolCount = tools.length; } })
  });
  assert.equal(boundToolCount, 0, 'plan mode must bind zero tools');
  assert.equal(calls.inventory, 0);
  assert.equal(calls.runCommand, 0);
  assert.deepEqual(run.evidence, []);
  return { status: 'PASS', detail: 'plan mode bound zero tools and produced no network evidence', modelTextIsClaim: false };
}

async function expectAllowedReadOnlyCommand() {
  const { sandbox, calls } = catalystFacade();
  const run = await respond({
    sandbox,
    messages: [{ role: 'user', content: 'Inspect the version on sw1.' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'show-version', type: 'tool_call' }] },
      { content: 'The returned version evidence is available for review.' }
    ])
  });
  assert.equal(calls.inventory, 1);
  assert.equal(calls.runCommand, 1);
  assert.equal(calls.lastRun.deviceUuid, DEVICE_ID);
  assert.equal(calls.lastRun.command, 'show version');
  assert.equal(run.evidence[0].status, 'SUCCESS');
  assert.match(run.evidence[0].output, /Version 17\.1/);
  return { status: 'PASS', detail: 'supported show version resolved the exact UUID and retained raw output', observedStatus: run.evidence[0].status };
}

async function expectUnknownTransportCannotBeHealthy() {
  const submitted = Object.assign(Error('fixture transport did not return a result'), { submitted: true });
  const { sandbox, calls } = sshFacade({ readError: submitted });
  const run = await respond({
    sandbox,
    messages: [{ role: 'user', content: 'Check lab-sw1.' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'lab-sw1' }, id: 'unknown-transport', type: 'tool_call' }] },
      { content: 'The device is healthy.' }
    ])
  });
  const evidence = run.evidence[0];
  assert.equal(calls.networkRead, 1);
  assert.equal(evidence.status, 'UNKNOWN');
  assert.equal(evidence.output, '');
  assert.match(run.text, /Observed operation status:[\s\S]*UNKNOWN/);
  assert.match(run.text, /healthy/i, 'fixture deliberately demonstrates that model text is not deterministic health truth');
  return {
    status: 'PARTIAL',
    detail: 'transport submission was UNKNOWN and surfaced in deterministic evidence; scripted model could still say healthy',
    observedStatus: evidence.status,
    limitation: 'respond appends status evidence but does not mechanically reject contradictory model health prose'
  };
}

async function expectFaultyRawSuccessCannotProveHealth() {
  const faultyOutput = 'sw1# show version\nVersion 17.1\n%FAN-3-FAIL: fan tray failed\nHealth: CRITICAL';
  const { sandbox, calls } = catalystFacade({ runResult: { status: 'SUCCESS', output: faultyOutput, startedAt: SNAPSHOT_TIME, elapsedMs: 8 } });
  const run = await respond({
    sandbox,
    messages: [{ role: 'user', content: 'Check whether sw1 is healthy.' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'faulty-success', type: 'tool_call' }] },
      { content: 'sw1 is healthy.' }
    ])
  });
  const evidence = run.evidence[0];
  assert.equal(calls.runCommand, 1);
  assert.equal(evidence.status, 'SUCCESS', 'transport success is the only status emitted by the current facade');
  assert.match(evidence.output, /FAN-3-FAIL/);
  assert.match(evidence.output, /CRITICAL/);
  assert.match(run.text, /healthy/i, 'fixture deliberately separates model prose from observed raw output');
  return {
    status: 'PARTIAL',
    detail: 'raw output retained fault markers while transport status was SUCCESS; no deterministic health classifier is present',
    observedStatus: evidence.status,
    limitation: 'UX079 requires UI/runtime interpretation to avoid treating command SUCCESS as device health; current respond contract exposes raw output but does not classify it'
  };
}

async function expectReadOnlyAllowlistAndFailedTransport() {
  const expected = [...new Set(Object.values(networkCommands).flat())];
  assert.deepEqual([...new Set(SUPPORTED_COMMANDS)], expected, 'Catalyst allowlist must be the read-only network command fixture');
  assert.equal(expected.includes('reload'), false);

  const ssh = sshFacade({ profiles: [{ id: 'lab-sw1', host: '192.0.2.1', platform: 'cisco_ios' }] });
  const inventory = await ssh.sandbox.inventory({});
  assert.equal(inventory.devices[0].transport, 'nornir-netmiko');
  assert.equal(inventory.devices[0].reachability, 'Not checked');
  assert.ok(inventory.devices[0].supportedCommands.includes('show version'));
  assert.equal(inventory.devices[0].supportedCommands.includes('reload'), false);
  const unsupported = await ssh.sandbox.runCommand({ command: 'reload', deviceUuid: 'ssh:lab-sw1' });
  assert.equal(unsupported.status, 'NOT_EXECUTED');
  assert.equal(ssh.calls.networkRead, 0);

  const catalyst = catalystFacade();
  const unsupportedCatalyst = await catalyst.sandbox.runCommand({ command: 'reload', deviceUuid: DEVICE_ID });
  assert.equal(unsupportedCatalyst.status, 'NOT_EXECUTED');
  assert.equal(catalyst.calls.runCommand, 0);
  return { status: 'PASS', detail: 'Catalyst and SSH paths reject reload; unsupported commands never reach the network facade', allowlistCount: expected.length };
}

async function expectScopeCopy() {
  const source = sourceInventory();
  const liveHtml = read(source.liveHtml.path);
  const candidateHtml = read(source.candidateHtml.path);
  const runtime = read(source.agentRuntime.path);
  const acceptance = read(source.acceptance.path);
  assert.match(liveHtml, /Read-only investigation/);
  assert.match(liveHtml, /Plan · no tools/);
  assert.match(candidateHtml, /Agent mode[^\n]*allowlisted read-only diagnostics/);
  assert.match(candidateHtml, /Plan mode[^\n]*proposals only, no tools/);
  assert.match(runtime, /Plan mode is proposal-only: no tools are available/);
  assert.match(runtime, /Never claim a command succeeded unless the tool result status is SUCCESS and includes raw output/);
  assert.match(acceptance, /UX-077[\s\S]*Read-only label agrees with enforced tool set/);
  assert.match(acceptance, /UX-079[\s\S]*Successful command on faulty device cannot appear as healthy/);
  assert.match(acceptance, /UX-106[\s\S]*Only supported read-only commands execute/);
  return { status: 'PASS', detail: 'live v8 and minimal UI candidate expose matching read-only/plan scope labels; runtime prompt states evidence boundaries', sourceHashes: { liveHtml: source.liveHtml.sha256, candidateHtml: source.candidateHtml.sha256, candidateJs: source.candidateJs.sha256 } };
}

const cases = [
  ['UX077-scope-copy', expectScopeCopy],
  ['UX077-plan-zero-tools', expectPlanHasNoTools],
  ['UX077-invalid-operation-boundary', expectInvalidOperationIsBounded],
  ['UX106-supported-read-only-allowlist', expectReadOnlyAllowlistAndFailedTransport],
  ['UX106-unknown-transport', expectUnknownTransportCannotBeHealthy],
  ['UX079-success-with-faulty-raw-output', expectFaultyRawSuccessCannotProveHealth],
  ['UX106-supported-command-success', expectAllowedReadOnlyCommand]
];

async function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const [id, execute] of cases) {
    const caseStartedAt = new Date().toISOString();
    try {
      const result = await execute();
      results.push({ id, ...result, startedAt: caseStartedAt, finishedAt: new Date().toISOString() });
    } catch (error) {
      results.push({ id, status: 'FAIL', detail: error.message, error: { name: error.name, code: error.code || null }, startedAt: caseStartedAt, finishedAt: new Date().toISOString() });
    }
  }
  const sourceHashes = sourceInventory();
  const report = {
    schemaVersion: 1,
    suite: 'network-boundary-tests',
    productRoot: PRODUCT_ROOT,
    startedAt,
    finishedAt: new Date().toISOString(),
    testCount: results.length,
    passCount: results.filter(result => result.status === 'PASS').length,
    partialCount: results.filter(result => result.status === 'PARTIAL').length,
    failCount: results.filter(result => result.status === 'FAIL').length,
    acceptanceRows: {
      'UX077': results.filter(result => result.id.startsWith('UX077-')).every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
      'UX079': results.some(result => result.id === 'UX079-success-with-faulty-raw-output' && result.status === 'PARTIAL') ? 'PARTIAL' : 'PASS',
      'UX106': results.filter(result => result.id.startsWith('UX106-')).every(result => result.status === 'PASS') ? 'PASS' : 'PARTIAL'
    },
    results,
    sourceHashes,
    noExternalCalls: true,
    noCredentials: true,
    deterministicBoundary: 'Tool schemas, facade statuses, raw evidence, and allowlist assertions are deterministic; model prose is fixture input and is not treated as health truth.'
  };
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'network-boundary-evidence.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'network-boundary-handoff.json'), JSON.stringify({
    schemaVersion: 1,
    suite: report.suite,
    command: `${process.execPath} ${path.relative(PRODUCT_ROOT, path.join(OUTPUT_ROOT, 'network-boundary.test.cjs'))}`,
    rerun: 'Set AVEN_PRODUCT_ROOT to the integrated checkout before invoking the command.',
    results: results.map(({ id, status, detail, limitation }) => ({ id, status, detail, ...(limitation ? { limitation } : {}) })),
    sourceHashes
  }, null, 2) + '\n');
  console.log(JSON.stringify({ suite: report.suite, testCount: report.testCount, passCount: report.passCount, partialCount: report.partialCount, failCount: report.failCount, evidence: path.join(OUTPUT_ROOT, 'network-boundary-evidence.json') }, null, 2));
  if (report.failCount) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
