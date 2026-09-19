'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const productRoot = process.env.AVEN_PRODUCT_ROOT && path.resolve(process.env.AVEN_PRODUCT_ROOT);
if (!productRoot) {
  console.error('AVEN_PRODUCT_ROOT must point to the assembled product root.');
  process.exit(2);
}

const ownRoot = __dirname;
const product = {
  server: process.env.AVEN_TERMINAL_SERVER_PATH || path.join(productRoot, 'intentgraph', 'server.cjs'),
  gitWorkspace: process.env.AVEN_GIT_WORKSPACE_PATH || path.join(productRoot, 'intentgraph', 'git-workspace.cjs'),
  gitUi: process.env.AVEN_GIT_UI_MODULE || path.join(productRoot, 'polished-git.js'),
  gitCss: process.env.AVEN_GIT_UI_STYLE || path.join(productRoot, 'polished-git.css'),
};
for (const [name, file] of Object.entries(product)) {
  if (!fs.existsSync(file)) { console.error(`${name} is missing: ${file}`); process.exit(2); }
}

const env = {
  ...process.env,
  AVEN_PRODUCT_ROOT: productRoot,
  AVEN_TERMINAL_SERVER_PATH: product.server,
  AVEN_GIT_WORKSPACE_PATH: product.gitWorkspace,
  AVEN_GIT_UI_MODULE: product.gitUi,
  AVEN_GIT_UI_STYLE: product.gitCss,
};
const tests = [
  path.join(ownRoot, 'git', 'intentgraph', 'git-workspace.test.cjs'),
  path.join(ownRoot, 'git', 'git-ui.test.cjs'),
  path.join(ownRoot, 'terminal', 'terminal.server.test.cjs'),
];
for (const testFile of tests) {
  console.log(`\n[round2] ${path.relative(productRoot, testFile)}`);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', testFile], { cwd: productRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\n[round2] terminal/Git verification passed');
