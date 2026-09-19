'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..');
const runtimePath = path.join(root, 'intentgraph', 'agent-runtime.cjs');
const manifestPath = path.join(__dirname, '..', 'replacements.json');
const projectRequire = Module.createRequire(runtimePath);
const { BaseChatModel } = projectRequire('@langchain/core/language_models/chat_models');
const { AIMessage } = projectRequire('@langchain/core/messages');

function candidateRespond() {
  let source = fs.readFileSync(runtimePath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).filter((item) => item.file === 'intentgraph/agent-runtime.cjs');
  for (const hunk of manifest) {
    assert.equal(source.split(hunk.old).length - 1, 1, `candidate hunk must match the baseline once: ${hunk.old.slice(0, 48)}`);
    source = source.replace(hunk.old, hunk.new);
  }
  // The candidate bridge lives beside its own approval module while the
  // remaining runtime imports continue resolving from the baseline project.
  source = source.replace("require('./clarification-runtime.cjs')", `require(${JSON.stringify(path.join(__dirname, 'clarification-runtime.cjs'))})`);
  const filename = path.join(root, 'intentgraph', '.workflow-agent-runtime-test.cjs');
  const candidateModule = new Module(filename, module.parent);
  candidateModule.filename = filename;
  candidateModule.paths = Module._nodeModulePaths(path.dirname(filename));
  candidateModule._compile(source, filename);
  return candidateModule.exports.respond;
}

class StructuredModel extends BaseChatModel {
  constructor(response, tools = []) { super({}); this.response = response; this.tools = tools; }
  _llmType() { return 'structured-clarification-test-model'; }
  _combineLLMOutput() { return {}; }
  bindTools(tools) { return new StructuredModel(this.response, tools); }
  async _generate() {
    const message = new AIMessage({ content: this.response.content || '', additional_kwargs: this.response.additional_kwargs || {}, ...(this.response.tool_calls ? { tool_calls: this.response.tool_calls } : {}) });
    return { generations: [{ text: message.content, message }], llmOutput: {} };
  }
}

test('normal model content pauses agent-runtime with a typed clarification contract', async () => {
  const respond = candidateRespond();
  let fields;
  const result = await respond({
    sandbox: { inventory: async () => ({ devices: [] }), runCommand: async () => ({ status: 'NOT_EXECUTED', output: '' }) },
    messages: [{ role: 'user', content: 'Inspect the branch device.' }],
    mode: 'inspect',
    chatId: 'model-contract-chat',
    getKey: async () => 'test-only-key',
    modelFactory: async (factoryFields) => { fields = factoryFields; return new StructuredModel({
      content: JSON.stringify({ type: 'pending_question', prompt: 'Which exact device?', choices: [{ id: 'edge-a', label: 'Edge A' }], allow_free_text: false, context: { missing: 'device scope' } })
    }); }
  });
  assert.equal(result.pendingQuestion.prompt, 'Which exact device?');
  assert.deepEqual(result.pendingQuestion.choices, [{ id: 'edge-a', label: 'Edge A' }]);
  assert.equal(result.pendingQuestion.allowFreeText, false);
  assert.deepEqual(result.pendingQuestion.context, { missing: 'device scope' });
  assert.equal(result.source, 'unavailable', 'no provider response is fabricated by the fixture');
  assert.equal(fields.model, 'mimo-v2.5');
});

test('model content and plan response envelopes reach the same pending-question contract', async () => {
  const respond = candidateRespond();
  const base = {
    sandbox: { inventory: async () => ({ devices: [] }), runCommand: async () => ({ status: 'NOT_EXECUTED', output: '' }) },
    messages: [{ role: 'user', content: 'Review the branch.' }], chatId: 'tool-contract-chat', getKey: async () => 'test-only-key'
  };
  const contentResult = await respond({ ...base, mode: 'inspect', modelFactory: async () => new StructuredModel({ content: JSON.stringify({ type: 'pending_question', prompt: 'Choose the branch profile.', choices: [{ id: 'branch-a', label: 'Branch A' }], allow_free_text: false }) }) });
  assert.equal(contentResult.pendingQuestion.prompt, 'Choose the branch profile.');
  assert.equal(contentResult.pendingQuestion.allowFreeText, false);
  const planResult = await respond({ ...base, chatId: 'plan-contract-chat', mode: 'plan', modelFactory: async () => new StructuredModel({ content: JSON.stringify({ type: 'pending_question', prompt: 'Which plan scope?', choices: ['branch-a'], allow_free_text: false }) }) });
  assert.equal(planResult.pendingQuestion.prompt, 'Which plan scope?');
  assert.equal(planResult.pendingQuestion.allowFreeText, false);
});
