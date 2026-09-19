'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BaseChatModel } = require('@langchain/core/language_models/chat_models');
const { AIMessage, HumanMessage } = require('@langchain/core/messages');
const { start } = require('./server.cjs');
const { respond, MAX_COMMAND_EVIDENCE_BYTES, MAX_TOOL_CONTEXT_BYTES } = require('./agent-runtime.cjs');

const DEVICE_ID = 'aa754801-8895-41e8-8ca5-27ee415c9c42';
const SNAPSHOT = {
  source: 'cisco-catalyst',
  retrievedAt: '2026-09-15T00:00:00.000Z',
  devices: [{ id: DEVICE_ID, hostname: 'sw1', managementIp: '192.0.2.9', platform: 'Cisco', softwareVersion: '17.1', reachability: 'Reachable' }]
};

class ScriptedModel extends BaseChatModel {
  constructor({ steps, indexRef = { current: 0 }, tools = [], onMessages } = {}) {
    super({});
    this.steps = steps;
    this.indexRef = indexRef;
    this.tools = tools;
    this.onMessages = onMessages;
  }

  _llmType() { return 'steering-test-model'; }
  _combineLLMOutput() { return {}; }

  bindTools(tools) {
    return new ScriptedModel({ steps: this.steps, indexRef: this.indexRef, tools: [...tools], onMessages: this.onMessages });
  }

  async _generate(messages) {
    this.onMessages?.(messages);
    const step = this.steps[Math.min(this.indexRef.current++, this.steps.length - 1)];
    const response = typeof step === 'function' ? await step(messages, this.tools) : step;
    const message = new AIMessage({ content: response.content || '', tool_calls: response.tool_calls || [] });
    return { generations: [{ text: message.content, message }], llmOutput: {} };
  }
}

function makeSandbox({ inventory = SNAPSHOT, inventoryImpl, runCommandImpl } = {}) {
  return {
    async inventory(options) { return inventoryImpl ? inventoryImpl(options) : inventory; },
    async runCommand(options) { return runCommandImpl ? runCommandImpl(options) : { status: 'SUCCESS', output: 'sw1# show version', startedAt: '2026-09-15T00:00:00.000Z', elapsedMs: 1 }; }
  };
}

function eventReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  return {
    async next() {
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) return JSON.parse(line);
        }
        if (done) return null;
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) buffer += decoder.decode(chunk.value, { stream: !done });
      }
    }
  };
}

function chatHeaders() {
  return { Origin: 'http://127.0.0.1:8767', Accept: 'application/x-ndjson', 'Content-Type': 'application/json', 'X-Aven-Chat': 'text-only' };
}

test('steering is authorized to one active run and pending IDs survive close exactly once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-steering-'));
  let release;
  const server = await start({
    root,
    port: 0,
    chatResponder: async () => new Promise((resolve) => { release = () => resolve({ text: 'done', evidence: [] }); }),
    executionOptions: { provider: { status: () => ({}) }, coordinator: { close() {} }, adapters: { close() {} }, delivery: {} }, providerCapabilities: { schemaVersion: 1, checkedAt: null, providers: [{ id: 'opencode', label: 'OpenCode', status: 'configured', configured: true, connected: false, models: [{ id: 'mimo-v2.5', status: 'configured', efforts: ['none'] }] }] }
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const body = { chatId: 'chat-a', agentName: 'Test', messages: [{ role: 'user', content: 'check interfaces' }] };
  let stream;
  try {
    stream = eventReader(await fetch(`${url}/api/chat`, { method: 'POST', headers: chatHeaders(), body: JSON.stringify(body) }));
    const startEvent = await stream.next();
    assert.equal(startEvent.type, 'start');
    assert.match(startEvent.runId, /^[0-9a-f-]{36}$/i);
    assert.equal(typeof startEvent.steeringToken, 'string');
    assert.ok(startEvent.steeringToken.length >= 32);

    const steer = (input) => fetch(`${url}/api/chat/steer`, { method: 'POST', headers: chatHeaders(), body: JSON.stringify(input) });
    const valid = (text) => ({ runId: startEvent.runId, chatId: body.chatId, steeringToken: startEvent.steeringToken, text });
    assert.equal((await steer(valid('late focus'))).status, 200);
    assert.equal((await steer({ ...valid('wrong chat'), chatId: 'chat-b' })).status, 409);
    assert.equal((await steer({ ...valid('wrong token'), steeringToken: `${startEvent.steeringToken}x` })).status, 403);
    assert.equal((await steer(valid('x'.repeat(4001)))).status, 400);

    const accepted = [];
    for (let index = 0; index < 7; index += 1) {
      const response = await steer(valid(`queued-${index}`));
      assert.equal(response.status, 200);
      accepted.push((await response.json()).id);
    }
    assert.equal((await steer(valid('overflow'))).status, 409, 'eight total accepted messages is the per-run cap');
    release();
    const events = [];
    for (let event; (event = await stream.next());) events.push(event);
    const received = events.filter((event) => event.type === 'steer_received');
    const pending = events.filter((event) => event.type === 'steer_pending');
    assert.equal(received.length, 8);
    assert.equal(pending.length, 8);
    assert.equal(events.at(-1).type, 'end');
    for (const id of accepted.concat(received.map((event) => event.id))) {
      assert.equal(received.filter((event) => event.id === id).length, 1);
      assert.equal(pending.filter((event) => event.id === id).length, 1);
    }
    const runEvidence = JSON.parse(fs.readFileSync(path.join(root, '.intentgraph', 'evidence', 'runs', `${startEvent.runId}.json`), 'utf8'));
    assert.doesNotMatch(JSON.stringify(runEvidence), new RegExp(startEvent.steeringToken));
    assert.equal((await steer(valid('after end'))).status, 409);
  } finally {
    release?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('late steering is rejected after the final model boundary and before final event', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-steering-close-'));
  let release;
  const server = await start({
    root,
    port: 0,
    chatResponder: async ({ onModelComplete }) => {
      onModelComplete?.();
      return new Promise((resolve) => { release = () => resolve({ text: 'done', evidence: [] }); });
    },
    executionOptions: { provider: { status: () => ({}) }, coordinator: { close() {} }, adapters: { close() {} }, delivery: {} }, providerCapabilities: { schemaVersion: 1, checkedAt: null, providers: [{ id: 'opencode', label: 'OpenCode', status: 'configured', configured: true, connected: false, models: [{ id: 'mimo-v2.5', status: 'configured', efforts: ['none'] }] }] }
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const streamResponse = await fetch(`${url}/api/chat`, { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ chatId: 'late', agentName: 'Test', messages: [{ role: 'user', content: 'hello' }] }) });
    const stream = eventReader(streamResponse);
    const startEvent = await stream.next();
    const response = await fetch(`${url}/api/chat/steer`, { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ runId: startEvent.runId, chatId: 'late', steeringToken: startEvent.steeringToken, text: 'too late' }) });
    assert.equal(response.status, 409);
    release();
    const events = [];
    for (let event; (event = await stream.next());) events.push(event);
    assert.equal(events.at(-1).type, 'end');
    assert.equal(events.some((event) => event.type === 'steer_received'), false);
  } finally {
    release?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('beforeModel drains steering into the next model messages and emits applied once', async () => {
  let resolveInventory;
  let inventoryStarted;
  const started = new Promise((resolve) => { inventoryStarted = resolve; });
  const sandbox = makeSandbox({ inventoryImpl: () => { inventoryStarted(); return new Promise((resolve) => { resolveInventory = resolve; }); } });
  const queue = [];
  const events = [];
  let modelCalls = 0;
  const model = new ScriptedModel({
    steps: [
      { tool_calls: [{ name: 'inventory', args: {}, id: 'inventory-1', type: 'tool_call' }] },
      (messages) => {
        modelCalls += 1;
        assert.ok(messages.some((message) => HumanMessage.isInstance(message) && message.content === 'focus on sw1'), 'steering must be a HumanMessage at the next model boundary');
        return { content: 'Applied the requested focus.' };
      }
    ]
  });
  const running = respond({ sandbox, model, messages: [{ role: 'user', content: 'inspect the switch' }], chatId: 'boundary', onEvent: (event) => events.push(event), drainSteering: () => queue.splice(0, queue.length) });
  await started;
  queue.push({ id: 'steer-1', message: 'focus on sw1' });
  resolveInventory(SNAPSHOT);
  const result = await running;
  assert.equal(modelCalls, 1);
  assert.match(result.text, /Applied/);
  assert.deepEqual(events.filter((event) => event.type === 'steer_applied').map((event) => ({ id: event.id, message: event.message })), [{ id: 'steer-1', message: 'focus on sw1' }]);
});

test('tool result events retain bounded raw output and model tool context stays bounded', async () => {
  const raw = 'failure-output-'.repeat(Math.ceil((MAX_COMMAND_EVIDENCE_BYTES + 100) / 15));
  const events = [];
  let modelToolMessage;
  const model = new ScriptedModel({
    steps: [
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'diagnostic-1', type: 'tool_call' }] },
      (messages) => { modelToolMessage = messages.at(-1); return { content: 'The command returned a failure status with retained output.' }; }
    ]
  });
  const result = await respond({
    sandbox: makeSandbox({ runCommandImpl: async () => ({ status: 'FAILURE', source: 'nornir-netmiko', output: raw, startedAt: SNAPSHOT.retrievedAt, elapsedMs: 2 }) }),
    model,
    messages: [{ role: 'user', content: 'inspect sw1' }],
    onEvent: (event) => events.push(event)
  });
  const evidence = result.evidence.find((item) => item.command === 'show version');
  const toolResult = events.find((event) => event.type === 'tool_result' && event.name === 'run_diagnostic');
  assert.equal(evidence.status, 'FAILURE');
  assert.equal(evidence.output, raw.slice(0, MAX_COMMAND_EVIDENCE_BYTES));
  assert.equal(evidence.outputTruncated, true);
  assert.equal(toolResult.evidence.output, evidence.output);
  assert.equal(toolResult.evidence.outputTruncated, true);
  assert.ok(Buffer.byteLength(modelToolMessage.content, 'utf8') <= MAX_TOOL_CONTEXT_BYTES);
  assert.match(modelToolMessage.content, /outputTruncated/);
});
