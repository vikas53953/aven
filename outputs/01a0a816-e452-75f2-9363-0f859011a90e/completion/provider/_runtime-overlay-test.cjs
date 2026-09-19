'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = process.cwd();
const completion = path.join(root, 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion');
const base = path.join(completion, 'baseline/intentgraph');
const out = path.join(completion, 'provider/runtime-overlay/intentgraph');
fs.rmSync(path.dirname(out), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of ['agent-runtime.test.cjs', 'chat-runtime.test.cjs', 'agent-runtime.cjs', 'chat-runtime.cjs', 'catalyst.cjs', 'vault.cjs', 'network-commands.json', 'network-execution.cjs']) fs.copyFileSync(path.join(base, file), path.join(out, file));
fs.copyFileSync(path.join(completion, 'provider/candidate/intentgraph/provider-agent-runtime.test.cjs'), path.join(out, 'provider-agent-runtime.test.cjs'));
fs.mkdirSync(path.join(out, 'adapters'), { recursive: true });
fs.copyFileSync(path.join(base, 'adapters/index.cjs'), path.join(out, 'adapters/index.cjs'));
fs.copyFileSync(path.join(completion, 'provider/candidate/intentgraph/provider-selection.cjs'), path.join(out, 'provider-selection.cjs'));
fs.copyFileSync(path.join(completion, 'provider/candidate/intentgraph/provider-adapter.cjs'), path.join(out, 'provider-adapter.cjs'));
fs.copyFileSync(path.join(completion, 'provider/candidate/intentgraph/provider-runtime-config.cjs'), path.join(out, 'provider-runtime-config.cjs'));
const replacements = JSON.parse(fs.readFileSync(path.join(completion, 'provider/replacements.json'), 'utf8')).filter((item) => item.file === 'intentgraph/agent-runtime.cjs');
let runtime = fs.readFileSync(path.join(out, 'agent-runtime.cjs'), 'utf8');
for (const item of replacements) {
  if (runtime.split(item.old).length !== 2) throw new Error(`runtime anchor missing: ${item.old.slice(0, 50)}`);
  runtime = runtime.replace(item.old, item.new);
}
fs.writeFileSync(path.join(out, 'agent-runtime.cjs'), runtime);
const result = cp.spawnSync(process.execPath, ['--test', path.join(out, 'agent-runtime.test.cjs'), path.join(out, 'chat-runtime.test.cjs'), path.join(out, 'provider-agent-runtime.test.cjs')], {
  encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(root, 'intentgraph/node_modules') }
});
fs.writeFileSync(path.join(completion, 'provider/runtime-overlay-result.json'), JSON.stringify({ status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n');
console.log(result.stdout);
console.error(result.stderr);
process.exitCode = result.status;
