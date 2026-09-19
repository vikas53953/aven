'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = __dirname;
const projectRoot = path.resolve(packageRoot, '../../../..');
const baselineRoot = path.join(projectRoot, 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/baseline');
const candidateRoot = path.join(packageRoot, 'candidate');
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'replacements.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const checks = [];
for (const [file, source] of Object.entries(manifest.sourceFiles)) {
  const baseline = fs.readFileSync(path.join(baselineRoot, file), 'utf8');
  const candidate = fs.readFileSync(path.join(candidateRoot, file), 'utf8');
  if (sha(baseline) !== source.baselineSHA256 || sha(candidate) !== source.candidateSHA256) throw new Error(`Source hash mismatch: ${file}`);
  let applied = baseline;
  for (const replacement of manifest.replacements.filter(item => item.file === file.replace(/^intentgraph\//, 'intentgraph/'))) {
    if (applied.split(replacement.old).length - 1 !== 1) throw new Error(`Old hunk is not unique: ${file}`);
    if (applied.split(replacement.anchor).length - 1 !== 1) throw new Error(`Anchor is not unique: ${file}`);
    applied = applied.replace(replacement.old, replacement.new);
  }
  if (applied !== candidate) throw new Error(`Candidate mismatch after exact replacements: ${file}`);
  checks.push({ file, status: 'PASS', appliedHunks: manifest.replacements.filter(item => item.file === file).length });
}
for (const entry of manifest.newFiles || []) {
  const content = fs.readFileSync(path.join(projectRoot, entry.candidatePath.replace(/^completion\/terminal\//, 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/terminal/')), 'utf8');
  if (sha(content) !== entry.candidateSHA256) throw new Error(`Standalone hash mismatch: ${entry.candidatePath}`);
  checks.push({ file: entry.candidatePath, status: 'PASS', standalone: true });
}
const result = { status: 'PASS', checks };
fs.writeFileSync(path.join(packageRoot, 'replacement-verification.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
