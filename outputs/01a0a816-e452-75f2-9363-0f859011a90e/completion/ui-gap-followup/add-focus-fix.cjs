'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const candidate = path.resolve(__dirname, 'candidate', 'polished.js');
let text = fs.readFileSync(candidate, 'utf8');
const replacements = [
  {
    old: 'function openEvidencePane(kind,c,m){',
    new: 'function openEvidencePane(kind,c,m,opener=null){',
    acceptance: 'UX-069'
  },
  {
    old: '\n    resetToolContext();if(byId(\'right-pane\').hidden)paneOpener=document.activeElement;',
    new: '\n    resetToolContext();if(byId(\'right-pane\').hidden)paneOpener=opener||document.activeElement;',
    acceptance: 'UX-069'
  },
  {
    old: 'run:()=>openEvidencePane(\'annotate\',c,m)}',
    new: 'run:()=>openEvidencePane(\'annotate\',c,m,opener)}',
    acceptance: 'UX-069'
  },
  {
    old: 'run:()=>openEvidencePane(\'compare\',c,m)}',
    new: 'run:()=>openEvidencePane(\'compare\',c,m,opener)}',
    acceptance: 'UX-069'
  }
];
const proof = [];
for (const item of replacements) {
  const count = text.split(item.old).length - 1;
  if (count !== 1) throw new Error('expected one anchor for ' + item.acceptance + ', found ' + count + ': ' + item.old);
  text = text.replace(item.old, item.new);
  proof.push({ file: 'polished.js', old: item.old, new: item.new, acceptance: item.acceptance, occurrences: count });
}
fs.writeFileSync(candidate, text);
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const source = path.resolve(__dirname, '..', 'ui-release', 'candidate', 'polished.js');
const out = path.resolve(__dirname, 'replacement-proof.json');
const prior = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
fs.writeFileSync(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'ui-release/candidate/polished.js',
  sourceSha256: sha(source),
  candidateSha256: sha(candidate),
  replacements: (prior.replacements || []).concat(proof),
  scope: 'UX-065 and UX-069 only; frozen v9.1 UI candidate copy'
}, null, 2));
console.log(JSON.stringify({ sourceSha256: sha(source), candidateSha256: sha(candidate), added: proof.length }));
