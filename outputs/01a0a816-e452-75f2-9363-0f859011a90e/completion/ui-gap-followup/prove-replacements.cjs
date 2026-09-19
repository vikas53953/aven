'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = __dirname;
const sourcePath = path.resolve(dir, '..', 'ui-release', 'candidate', 'polished.js');
const candidatePath = path.resolve(dir, 'candidate', 'polished.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const candidate = fs.readFileSync(candidatePath, 'utf8');
const proof = JSON.parse(fs.readFileSync(path.resolve(dir, 'replacement-proof.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
let current = source;
const steps = [];
for (const item of proof.replacements) {
  const occurrences = current.split(item.old).length - 1;
  if (occurrences !== 1) throw new Error('anchor count ' + occurrences + ' for ' + item.acceptance);
  const before = sha(current);
  current = current.replace(item.old, item.new);
  steps.push({ acceptance: item.acceptance, file: item.file, occurrences, beforeSha256: before, afterSha256: sha(current) });
}
if (sha(current) !== sha(candidate)) throw new Error('sequential output does not equal candidate');
const output = {
  generatedAt: new Date().toISOString(),
  baseline: 'ui-release/candidate (ux-minimal-ui-v9.1)',
  sourcePath: 'ui-release/candidate/polished.js',
  sourceSha256: sha(source),
  candidatePath: 'ui-gap-followup/candidate/polished.js',
  candidateSha256: sha(candidate),
  replacements: proof.replacements.map(item => ({ file: item.file, old: item.old, new: item.new, acceptance: item.acceptance })),
  sequentialSteps: steps,
  touchedFiles: ['polished.js'],
  liveFilesModified: [],
  scope: 'UX-065 unavailable shortcut advertising and Ctrl/Cmd+F binding; UX-069 evidence pane focus return'
};
fs.writeFileSync(path.resolve(dir, 'replacements.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ sourceSha256: output.sourceSha256, candidateSha256: output.candidateSha256, steps: steps.length, equivalent: true }));
