'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const hash = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const baselinePath = path.join(root, 'baseline', 'polished.js');
const candidatePath = path.join(root, 'history-candidate', 'polished.js');
const outputPath = path.join(root, 'history-patched-from-baseline.js');
const entries = JSON.parse(fs.readFileSync(path.join(root, 'replacements.json'), 'utf8'));
let current = fs.readFileSync(baselinePath);
const applied = [];
const baselineSha256 = hash(current);
for (const [index, entry] of entries.entries()) {
  if (entry.sourceSHA !== baselineSha256) throw new Error(`replacement ${index} sourceSHA does not match immutable baseline`);
  const oldValue = Buffer.from(entry.old, 'utf8');
  const newValue = Buffer.from(entry.new, 'utf8');
  let count = 0, offset = -1, cursor = 0;
  while ((cursor = current.indexOf(oldValue, cursor)) !== -1) { count += 1; if (offset < 0) offset = cursor; cursor += oldValue.length || 1; }
  if (count !== 1) throw new Error(`replacement ${index} expected one byte match, got ${count}`);
  current = Buffer.concat([current.subarray(0, offset), newValue, current.subarray(offset + oldValue.length)]);
  applied.push({ index, file: entry.file, offset, oldBytes: oldValue.length, newBytes: newValue.length, oldSha256: hash(oldValue), newSha256: hash(newValue), matchCount: count });
}
const candidate = fs.readFileSync(candidatePath);
let firstCandidateDifference = 0;
while (firstCandidateDifference < Math.min(current.length, candidate.length) && current[firstCandidateDifference] === candidate[firstCandidateDifference]) firstCandidateDifference += 1;
const result = { baseline: 'completion/baseline/polished.js', sourceSHA256: baselineSha256, replacements: 'completion/replacements.json', applied, replacementSequenceExact: true, candidateEquivalent: current.equals(candidate), candidateSha256: hash(candidate), appliedSha256: hash(current), candidateDifference: current.equals(candidate) ? null : { firstByte: firstCandidateDifference, appliedBytes: current.length, candidateBytes: candidate.length, reason: 'history-candidate/polished.js also contains shared-agent changes; package proof covers only owned replacement hunks' }, generatedCheckFile: 'completion/history-patched-from-baseline.js', generatedCheckSha256: hash(current), syntax: 'checked separately with primary Node runtime' };
fs.writeFileSync(outputPath, current);
fs.writeFileSync(path.join(root, 'replacement-apply-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ applied: applied.length, replacementSequenceExact: result.replacementSequenceExact, candidateEquivalent: result.candidateEquivalent, sha256: result.appliedSha256 }));
