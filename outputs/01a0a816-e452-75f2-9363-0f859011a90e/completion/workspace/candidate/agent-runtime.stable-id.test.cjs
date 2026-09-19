// Candidate-only runtime verification. It materializes the exact runtime
// replacements in a temporary fixture and uses injected inventory/command
// mocks; no provider, credential, network or device call is made.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { BaseChatModel } = require('../../../../../intentgraph/node_modules/@langchain/core/language_models/chat_models');
const { AIMessage } = require('../../../../../intentgraph/node_modules/@langchain/core/messages');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'replacements.json'), 'utf8'));

class ScriptedModel extends BaseChatModel {
  constructor({ steps, indexRef = { current: 0 }, tools = [] } = {}) { super({}); this.steps = steps; this.indexRef = indexRef; this.tools = tools; }
  _llmType() { return 'candidate-stable-id-test-model'; }
  _combineLLMOutput() { return {}; }
  bindTools(tools) { return new ScriptedModel({ steps: this.steps, indexRef: this.indexRef, tools: [...tools] }); }
  async _generate() { const step = this.steps[Math.min(this.indexRef.current++, this.steps.length - 1)]; const response = typeof step === 'function' ? await step() : step; const message = new AIMessage({ content: response.content || '', tool_calls: response.tool_calls || [] }); return { generations: [{ text: message.content, message }], llmOutput: {} }; }
}

async function runCase(runtime, inventory, args) {
  const calls = [];
  const sandbox = {
    supportedCommands: ['show version'],
    isDeviceId: (value) => /^[0-9a-f-]{36}$/iu.test(value),
    async inventory() { return inventory; },
    async runCommand(input) { calls.push(input); return { status: 'SUCCESS', output: 'fixture output', startedAt: '2026-09-16T00:00:00.000Z', elapsedMs: 1 }; },
  };
  const run = await runtime.respond({
    sandbox,
    messages: [{ role: 'user', content: 'inspect a device' }],
    modelFactory: async () => new ScriptedModel({ steps: [
      { tool_calls: [{ name: 'run_diagnostic', args, id: 'diagnostic-1', type: 'tool_call' }] },
      { content: 'fixture complete' },
    ] }),
    getKey: async () => 'fixture-key',
  });
  return { run, calls };
}

(async () => {
  const projectRoot = path.resolve(__dirname, '../../../../../');
  const baseline = fs.readFileSync(path.join(projectRoot, 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/baseline/intentgraph/agent-runtime.cjs'), 'utf8');
  let source = baseline;
  for (const replacement of manifest.replacements.filter((item) => item.file === 'intentgraph/agent-runtime.cjs')) {
    assert.equal(source.includes(replacement.old), true, 'runtime seam missing');
    source = source.replace(replacement.old, replacement.new);
  }
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), 'aven-stable-id-runtime-'));
  try {
    for (const name of ['catalyst.cjs', 'vault.cjs', 'network-commands.json']) await fsp.copyFile(path.join(projectRoot, 'intentgraph', name), path.join(fixture, name));
    await fsp.writeFile(path.join(fixture, 'agent-runtime.cjs'), source);
    process.env.NODE_PATH = path.join(projectRoot, 'intentgraph', 'node_modules');
    Module._initPaths();
    const runtime = require(path.join(fixture, 'agent-runtime.cjs'));
    const first = 'aa754801-8895-41e8-8ca5-27ee415c9c42';
    const second = 'bb754801-8895-41e8-8ca5-27ee415c9c42';
    const inventory = { source: 'fixture', devices: [{ id: first, hostname: 'same-host' }, { id: second, hostname: 'same-host' }] };
    const ambiguous = await runCase(runtime, inventory, { operation: 'show version', hostname: 'same-host' });
    assert.equal(ambiguous.calls.length, 0);
    assert.match(ambiguous.run.evidence[0].output, /stable device ID/i);
    const selected = await runCase(runtime, inventory, { operation: 'show version', deviceId: second });
    assert.equal(selected.calls.length, 1);
    assert.equal(selected.calls[0].deviceUuid, second);
    assert.equal(selected.run.evidence[0].targetId, second);
    assert.equal(selected.run.evidence[0].target, 'same-host');
    const mismatch = await runCase(runtime, inventory, { operation: 'show version', deviceId: second, hostname: 'other-host' });
    assert.equal(mismatch.calls.length, 0);
    assert.match(mismatch.run.evidence[0].output, /same inventory record/i);
    console.log(JSON.stringify({ passed: true, cases: 9, ambiguousRejected: true, selectedDeviceId: second, mismatchRejected: true, externalCalls: 0 }));
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
