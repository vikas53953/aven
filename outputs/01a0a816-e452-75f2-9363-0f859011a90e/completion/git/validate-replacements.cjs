'use strict';

// Verify the manifest against raw frozen-baseline bytes and prove sequential application.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const completion = path.resolve(here, '..');
const baselineRoot = path.join(completion, 'baseline');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'replacements.json'), 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const byFile = new Map();
for (const change of manifest.replacements) {
  if (!byFile.has(change.file)) byFile.set(change.file, []);
  byFile.get(change.file).push(change);
}

const files = {};
for (const [file, changes] of byFile) {
  const baseline = fs.readFileSync(path.join(baselineRoot, file));
  const expected = manifest.sourceFiles[file].baselineSHA256;
  if (sha256(baseline) !== expected) throw new Error(`${file}: baseline SHA mismatch`);
  let candidate = Buffer.from(baseline);
  const applied = [];
  for (const change of changes.sort((left, right) => left.sequence - right.sequence)) {
    if (change.sourceSHA !== expected) throw new Error(`${file}#${change.sequence}: source SHA mismatch`);
    const oldBytes = Buffer.from(change.old, 'utf8');
    const newBytes = Buffer.from(change.new, 'utf8');
    let first = candidate.indexOf(oldBytes);
    let count = 0;
    while (first !== -1) {
      count += 1;
      first = candidate.indexOf(oldBytes, first + 1);
    }
    if (count !== 1) throw new Error(`${file}#${change.sequence}: candidate anchor count=${count}`);
    const offset = candidate.indexOf(oldBytes);
    candidate = Buffer.concat([candidate.subarray(0, offset), newBytes, candidate.subarray(offset + oldBytes.length)]);
    applied.push({ sequence: change.sequence, label: change.label, offset, oldBytes: oldBytes.length, newBytes: newBytes.length });
  }
  files[file] = { baselineSHA256: expected, candidateSHA256: sha256(candidate), baselineBytes: baseline.length, candidateBytes: candidate.length, applied };
}
const proof = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  policy: 'raw UTF-8 bytes; unique anchors; sequential per-file application; frozen source hash required',
  files,
};
fs.writeFileSync(path.join(here, 'replacement-apply-proof.json'), JSON.stringify(proof, null, 2) + '\n', 'utf8');
process.stdout.write(`${Object.keys(files).length} files verified; ${manifest.replacements.length} replacements applied sequentially\n`);
