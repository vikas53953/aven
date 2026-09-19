'use strict';

const fs = require('node:fs');
const path = require('node:path');

const artifactRoot = path.resolve(__dirname, '..');
const overlayRoot = path.join(artifactRoot, 'candidate', 'overlay');
const replacements = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'replacements.json'), 'utf8'));
const files = new Set(replacements.replacements.map(item => item.file));
for (const file of files) {
  const target = path.join(overlayRoot, file);
  const frozenBaseline = path.join(artifactRoot, 'baseline', file);
  let source = fs.readFileSync(fs.existsSync(frozenBaseline) ? frozenBaseline : target, 'utf8');
  for (const item of replacements.replacements.filter(entry => entry.file === file)) {
    const count = source.split(item.before).length - 1;
    if (count !== 1) throw new Error(item.id + ': expected one overlay anchor, got ' + count);
    source = source.replace(item.before, item.after);
  }
  fs.writeFileSync(target, source);
  console.log('patched ' + file);
}
