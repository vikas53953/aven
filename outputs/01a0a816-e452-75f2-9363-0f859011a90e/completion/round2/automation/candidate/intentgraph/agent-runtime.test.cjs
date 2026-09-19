'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BaseChatModel } = require('@langchain/core/language_models/chat_models');
const { AIMessage } = require('@langchain/core/messages');
const { respond, MAX_TOOL_CALLS } = require('./agent-runtime.cjs');

const DEVICE_ID = 'aa754801-8895-41e8-8ca5-27ee415c9c42';
const SNAPSHOT = {
  source: 'cisco-catalyst',
  retrievedAt: '2026-09-15T00:00:00.000Z',
  devices: [{ id: DEVICE_ID, hostname: 'sw1', managementIp: '192.0.2.9', platform: 'Cisco', softwareVersion: '17.1', reachability: 'Reachable' }]
};

class ScriptedModel extends BaseChatModel {
  constructor({ steps, indexRef = { current: 0 }, tools = [] } = {}) {
    super({});
    this.steps = steps;
    this.indexRef = indexRef;
    this.tools = tools;
  }

  _llmType() { return 'scripted-langchain-test-model'; }
  _combineLLMOutput() { return {}; }

  bindTools(tools) {
    return new ScriptedModel({ steps: this.steps, indexRef: this.indexRef, tools: [...tools] });
  }

  async _generate(messages) {
    const step = this.steps[Math.min(this.indexRef.current++, this.steps.length - 1)];
    const response = typeof step === 'function' ? await step(messages, this.tools) : step;
    const message = new AIMessage({ content: response.content || '', tool_calls: response.tool_calls || [] });
    return { generations: [{ text: message.content, message }], llmOutput: {} };
  }
}

function makeSandbox({ inventory = SNAPSHOT, inventoryImpl, runCommandImpl } = {}) {
  const calls = { inventory: 0, runCommand: 0, lastCommand: null };
  return {
    calls,
    async inventory(options) {
      calls.inventory += 1;
      return inventoryImpl ? inventoryImpl(options) : inventory;
    },
    async runCommand(options) {
      calls.runCommand += 1;
      calls.lastCommand = options;
      return runCommandImpl ? runCommandImpl(options) : { status: 'SUCCESS', output: 'sw1# show version\nVersion 17.1', startedAt: '2026-09-15T00:00:00.000Z', elapsedMs: 4 };
    }
  };
}

function fixtureModel(steps, { getKey, onFactory } = {}) {
  const model = new ScriptedModel({ steps });
  return {
    modelFactory: async (fields) => {
      onFactory?.(fields);
      return model;
    },
    getKey: getKey || (async () => 'mock-opencode-key')
  };
}

test('LangGraph agent uses the inventory tool for a natural language fact and returns bounded evidence', async () => {
  const sandbox = makeSandbox();
  const events = [];
  let factoryFields;
  const run = await respond({
    sandbox,
    messages: [{ role: 'user', content: 'What management address belongs to sw1?' }],
    agentName: 'Test coworker',
    chatId: 'chat-1',
    onEvent: (event) => events.push(event),
    ...fixtureModel([
      { tool_calls: [{ name: 'inventory', args: {}, id: 'inventory-1', type: 'tool_call' }] },
      (messages) => ({ content: messages.at(-1).content.includes('192.0.2.9') ? 'sw1 management address is 192.0.2.9.' : 'No address was observed.' })
    ], { onFactory: (fields) => { factoryFields = fields; } })
  });

  assert.match(run.text, /192\.0\.2\.9/);
  assert.equal(run.model, 'mimo-v2.5');
  assert.match(run.runId, /^[0-9a-f-]{36}$/);
  assert.equal(run.evidence.length, 1);
  assert.deepEqual(run.evidence[0], {
    command: 'inventory', target: 'cisco-catalyst', status: 'SUCCESS',
    output: JSON.stringify({ source: 'cisco-catalyst', retrievedAt: SNAPSHOT.retrievedAt, devices: [{ id: DEVICE_ID, hostname: 'sw1', managementIp: '192.0.2.9', platform: 'Cisco', softwareVersion: '17.1', reachability: 'Reachable' }] }),
    time: SNAPSHOT.retrievedAt, startedAt: run.evidence[0].startedAt
  });
  assert.equal(sandbox.calls.inventory, 1);
  assert.equal(sandbox.calls.runCommand, 0);
  assert.equal(factoryFields.apiKey, 'mock-opencode-key');
  assert.equal(factoryFields.maxRetries, 0);
  assert.deepEqual(factoryFields.modelKwargs, { thinking: { type: 'disabled' } });
  assert.deepEqual(events.map((event) => event.type), ['tool_start', 'tool_result']);
  assert.equal(Object.hasOwn(events[1].evidence, 'output'), true);
  assert.doesNotMatch(JSON.stringify(events), /mock-opencode-key|https:\/\//);
});

test('natural language diagnostic resolves hostname and UUID server-side and dispatches one allowed operation', async () => {
  const sandbox = makeSandbox();
  const run = await respond({
    sandbox,
    messages: [{ role: 'user', content: 'Please inspect the version on switch sw1.' }],
    agentName: 'Diagnostics',
    chatId: 'chat-2',
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'sw1' }, id: 'diagnostic-1', type: 'tool_call' }] },
      { content: 'The version diagnostic completed with the returned command output.' }
    ])
  });

  assert.equal(sandbox.calls.inventory, 1, 'diagnostics must resolve inventory on each call');
  assert.equal(sandbox.calls.runCommand, 1);
  assert.equal(sandbox.calls.lastCommand.command, 'show version');
  assert.equal(sandbox.calls.lastCommand.deviceUuid, DEVICE_ID);
  assert.ok(sandbox.calls.lastCommand.signal);
  assert.equal(run.evidence.length, 1);
  assert.equal(run.evidence[0].command, 'show version');
  assert.equal(run.evidence[0].target, 'sw1');
  assert.equal(run.evidence[0].status, 'SUCCESS');
  assert.match(run.evidence[0].output, /Version 17\.1/);
});

test('general explanations do not invoke tools, and unknown host evidence is not success', async () => {
  const generalSandbox = makeSandbox();
  const general = await respond({
    sandbox: generalSandbox,
    messages: [{ role: 'user', content: 'What is the purpose of a VLAN?' }],
    ...fixtureModel([{ content: 'A VLAN separates traffic into a logical broadcast domain.' }])
  });
  assert.match(general.text, /VLAN/);
  assert.equal(generalSandbox.calls.inventory, 0);
  assert.equal(generalSandbox.calls.runCommand, 0);
  assert.deepEqual(general.evidence, []);

  const unknownSandbox = makeSandbox();
  const unknown = await respond({
    sandbox: unknownSandbox,
    messages: [{ role: 'user', content: 'Check the version on mystery.' }],
    ...fixtureModel([
      { tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: 'mystery' }, id: 'diagnostic-unknown', type: 'tool_call' }] },
      { content: 'The hostname had no exact inventory match, so the command was not executed.' }
    ])
  });
  assert.equal(unknownSandbox.calls.inventory, 1);
  assert.equal(unknownSandbox.calls.runCommand, 0);
  assert.equal(unknown.evidence[0].status, 'NOT_EXECUTED');
  assert.match(unknown.evidence[0].output, /not executed/);
  assert.doesNotMatch(unknown.text, /succeeded|completed successfully/i);
});

test('tool budget bounds backend calls and reports partial evidence without retrying duplicate diagnostics', async () => {
  const multiSnapshot = {
    ...SNAPSHOT,
    devices: Array.from({ length: MAX_TOOL_CALLS }, (_, index) => ({ ...SNAPSHOT.devices[0], id: DEVICE_ID.replace(/.$/, String(index + 1)), hostname: `sw${index + 1}` }))
  };
  const sandbox = makeSandbox({ inventory: multiSnapshot });
  const toolCalls = Array.from({ length: MAX_TOOL_CALLS + 1 }, (_, index) => ({
    tool_calls: [{ name: 'run_diagnostic', args: { operation: 'show version', hostname: `sw${index + 1}` }, id: `diagnostic-${index}`, type: 'tool_call' }]
  }));
  toolCalls.push({ content: 'The tool budget was reached; this is partial.' });
  const run = await respond({
    sandbox,
    messages: [{ role: 'user', content: 'Inspect these switches as far as the safety budget permits.' }],
    ...fixtureModel(toolCalls)
  });
  assert.equal(sandbox.calls.runCommand, MAX_TOOL_CALLS);
  assert.equal(sandbox.calls.inventory, MAX_TOOL_CALLS);
  assert.equal(run.partial, true);
  assert.equal(run.evidence.length, MAX_TOOL_CALLS);
  assert.ok(run.evidence.every((item) => item.status === 'SUCCESS'));
  assert.doesNotMatch(JSON.stringify(run.evidence), /mock-opencode-key|https:\/\//);
});

test('abort and timeout reject promptly and pass cancellation to backend', async () => {
  let resolveInventory;
  const sandbox = makeSandbox({ inventoryImpl: () => new Promise((resolve) => { resolveInventory = resolve; }) });
  const controller = new AbortController();
  const pending = respond({
    sandbox,
    messages: [{ role: 'user', content: 'Inspect sw1.' }],
    signal: controller.signal,
    ...fixtureModel([{ tool_calls: [{ name: 'inventory', args: {}, id: 'inventory-abort', type: 'tool_call' }] }])
  });
  for (let attempt = 0; !resolveInventory && attempt < 100; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'agent_aborted');
  resolveInventory?.(SNAPSHOT);

  const timeoutSandbox = makeSandbox({ inventoryImpl: () => new Promise(() => {}) });
  const startedAt = Date.now();
  await assert.rejects(respond({
    sandbox: timeoutSandbox,
    messages: [{ role: 'user', content: 'Inspect sw1.' }],
    timeoutMs: 20,
    ...fixtureModel([{ tool_calls: [{ name: 'inventory', args: {}, id: 'inventory-timeout', type: 'tool_call' }] }])
  }), (error) => error.code === 'agent_timeout');
  assert.ok(Date.now() - startedAt < 1000);
});

test('malformed and unsupported model tool arguments never reach the device adapter', async () => {
  for (const args of [
    {operation:'reload',hostname:'sw1'},
    {operation:'show version',hostname:'sw1',deviceUuid:DEVICE_ID},
    {operation:'show version',hostname:'sw1;reload'}
  ]) {
    const sandbox=makeSandbox();
    try { await respond({sandbox,messages:[{role:'user',content:'Inspect sw1'}],...fixtureModel([
      {tool_calls:[{name:'run_diagnostic',args,id:'bad',type:'tool_call'}]},
      {content:'This request could not be executed.'}
    ])}); } catch { /* Framework may reject schema errors rather than recover. */ }
    assert.equal(sandbox.calls.runCommand,0);
  }
});

test('unknown submission is not repeated and completed evidence survives a later model failure', async () => {
  const unknown=makeSandbox({runCommandImpl:async()=>{throw Object.assign(Error('remote secret detail'),{submitted:true});}});
  const call={tool_calls:[{name:'run_diagnostic',args:{operation:'show version',hostname:'sw1'},id:'one',type:'tool_call'}]};
  const run=await respond({sandbox:unknown,messages:[{role:'user',content:'Inspect sw1'}],...fixtureModel([call,{tool_calls:[{...call.tool_calls[0],id:'two'}]},{content:'Outcome unknown.'}])});
  assert.equal(unknown.calls.runCommand,1);
  assert.deepEqual(run.evidence.map(e=>e.status),['UNKNOWN','NOT_EXECUTED']);
  const events=[];
  await assert.rejects(respond({sandbox:makeSandbox(),messages:[{role:'user',content:'Inspect sw1'}],onEvent:e=>events.push(e),...fixtureModel([call,()=>{throw Error('model unavailable')}])}));
  const completed=events.find(e=>e.type==='tool_result');
  assert.equal(completed.evidence.status,'SUCCESS');assert.match(completed.evidence.output,/Version 17.1/);
});

test('framework exposes SSH-specific BGP operation and retains Nornir provenance',async()=>{
 const {createNetworkExecution}=require('./network-execution.cjs');let calls=0;
 const sandbox=createNetworkExecution({catalyst:{inventory:async()=>({devices:[]})},adapters:{readProfiles:()=>[{id:'lab-sw1',host:'192.0.2.1',platform:'cisco_ios'}],networkRead:async({profileId,command})=>{assert.equal(profileId,'lab-sw1');assert.equal(command,'show ip bgp summary');calls++;return {output:'Neighbor 192.0.2.2 Established'};}}});
 const run=await respond({sandbox,messages:[{role:'user',content:'Check BGP peers on lab-sw1'}],...fixtureModel([{tool_calls:[{name:'run_diagnostic',args:{operation:'show ip bgp summary',hostname:'lab-sw1'},id:'bgp',type:'tool_call'}]},{content:'The test peer is established.'}])});
 assert.equal(calls,1);assert.equal(run.evidence[0].source,'nornir-netmiko');assert.equal(run.evidence[0].status,'SUCCESS');
});
