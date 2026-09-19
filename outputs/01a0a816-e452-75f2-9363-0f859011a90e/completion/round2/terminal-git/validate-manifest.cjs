'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.resolve(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const completionRoot = path.resolve(__dirname, '..', '..');
const inputRoot = path.join(completionRoot, 'git');

function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); }
for (const [relative, entry] of Object.entries(manifest.sourceFiles)) {
  const input = fs.readFileSync(path.join(inputRoot, relative));
  const output = fs.readFileSync(path.join(__dirname, 'git', relative));
  if (hash(input) !== entry.inputSHA256) throw new Error(`input hash mismatch: ${relative}`);
  if (hash(output) !== entry.outputSHA256) throw new Error(`output hash mismatch: ${relative}`);
}
for (const relative of Object.keys(manifest.sourceFiles)) {
  const relevant = manifest.replacements.filter((item) => item.file === relative).sort((a, b) => a.sequence - b.sequence);
  let value = fs.readFileSync(path.join(inputRoot, relative), 'utf8');
  for (const item of relevant) {
    const occurrences = value.split(item.old).length - 1;
    if (occurrences !== 1) throw new Error(`${relative} replacement ${item.sequence} expected one match, got ${occurrences}`);
    value = value.replace(item.old, () => item.new);
  }
  const expected = fs.readFileSync(path.join(__dirname, 'git', relative), 'utf8');
  if (value !== expected) throw new Error(`replacement output mismatch: ${relative}`);
}
console.log(`validated ${Object.keys(manifest.sourceFiles).length} source hashes and ${manifest.replacements.length} exact replacements`);
