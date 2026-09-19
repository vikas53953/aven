const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const out = __dirname;
const baselineRoot = path.resolve(out, '..', 'baseline');
const candidateRoot = path.join(out, 'candidate');
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'replacements.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const results = [];
for (const file of Object.keys(manifest.sourceFiles)) {
  let source = fs.readFileSync(path.join(baselineRoot, file), 'utf8');
  const candidate = fs.readFileSync(path.join(candidateRoot, file), 'utf8');
  const hunks = manifest.replacements.filter(item => item.file === file);
  if (sha(source) !== manifest.sourceFiles[file].baselineSHA256) throw new Error(`${file}: baseline hash mismatch`);
  for (const hunk of hunks) {
    const count = hunk.old ? source.split(hunk.old).length - 1 : 0;
    if (count !== 1) throw new Error(`${file}: expected one exact old anchor at ${hunk.beforeLine}, got ${count}`);
    source = source.replace(hunk.old, hunk.new);
  }
  if (source !== candidate || sha(source) !== manifest.sourceFiles[file].candidateSHA256) throw new Error(`${file}: reconstructed candidate differs`);
  results.push({ file, replacements: hunks.length, exact: true, candidateSHA256: sha(source) });
}
const evidence = { status: 'PASS', schemaVersion: 1, results, sourceFiles: manifest.sourceFiles };
fs.writeFileSync(path.join(out, 'replacement-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
