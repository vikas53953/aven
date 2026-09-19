'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const artifactRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(__dirname, '../../../../..');
const replacements = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'replacements.json'), 'utf8'));
const hashes = {};
const currentHashes = {};
const sourceModes = {};
const checkpointPath = path.join(artifactRoot, '..', 'ui-release', 'integration.json');
let checkpoint = null;
if (fs.existsSync(checkpointPath)) checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const sourceText = new Map();
for (const file of new Set(replacements.replacements.map(item => item.file))) {
  const sourcePath = path.join(projectRoot, file);
  const current = fs.readFileSync(sourcePath);
  const currentHash = crypto.createHash('sha256').update(current).digest('hex');
  currentHashes[file] = currentHash;
  const expected = replacements.sourceFiles?.[file]?.baselineSHA256;
  const acceptedCheckpoint = checkpoint?.files?.find(entry => entry.file === file && entry.after === currentHash);
  if (expected && currentHash === expected) {
    sourceText.set(file, current.toString('utf8'));
    hashes[file] = currentHash;
    sourceModes[file] = 'baseline-current';
  } else if (acceptedCheckpoint && fs.existsSync(path.join(artifactRoot, 'baseline', file))) {
    const frozen = fs.readFileSync(path.join(artifactRoot, 'baseline', file));
    const frozenHash = crypto.createHash('sha256').update(frozen).digest('hex');
    assert.equal(frozenHash, expected, `frozen baseline hash mismatch for ${file}`);
    sourceText.set(file, frozen.toString('utf8'));
    hashes[file] = frozenHash;
    sourceModes[file] = `frozen-baseline-for-${acceptedCheckpoint.after}`;
  } else {
    throw new Error(`${file}: current source hash ${currentHash} is neither the frozen baseline ${expected || '<unspecified>'} nor an accepted root checkpoint`);
  }
}
const missing = replacements.replacements.filter(item => !sourceText.get(item.file).includes(item.before));
assert.equal(missing.length, 0, `replacement anchors missing: ${missing.map(item => item.id).join(', ')}`);
const patched = {};
for (const file of new Set(replacements.replacements.map(item => item.file))) patched[file] = sourceText.get(file);
for (const item of replacements.replacements) {
  assert.ok(patched[item.file].includes(item.before), `replacement order or anchor failure: ${item.id}`);
  patched[item.file] = patched[item.file].replace(item.before, item.after);
}
new vm.Script(patched['polished.js'], { filename: 'polished.js (reliability candidate)' });
new vm.Script(patched['intentgraph/server.cjs'], { filename: 'intentgraph/server.cjs (reliability candidate)' });
assert.ok(fs.existsSync(path.join(artifactRoot, 'candidate', 'polished-reliability.js')));
assert.ok(fs.existsSync(path.join(artifactRoot, 'candidate', 'intentgraph', 'reliability.cjs')));
assert.ok(fs.existsSync(path.join(artifactRoot, 'candidate', 'intentgraph', 'reliability-storage.cjs')));
console.log(JSON.stringify({ replacementCount: replacements.replacements.length, baselineSHA256: hashes, currentSHA256: currentHashes, sourceModes, candidate: 'reliability primitives present', compiled: ['polished.js', 'intentgraph/server.cjs'], missing: [] }, null, 2));
