'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const candidate = path.resolve(__dirname, 'candidate', 'polished.js');
const text = fs.readFileSync(candidate, 'utf8');
const replacements = [
  {
    old: 'const shortcuts=localActions().filter(a=>a.shortcut).map(a=>[a.shortcut,a.label]);',
    new: 'const shortcuts=localActions().filter(a=>a.shortcut&&!a.reason).map(a=>[a.shortcut,a.label]);',
    acceptance: 'UX-065'
  },
  {
    old: "document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.altKey&&!one('dialog[open]')){e.preventDefault();openCommands();}},true);",
    new: "document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&!one('dialog[open]')){if(e.key.toLowerCase()==='k'){e.preventDefault();openCommands();}else if(e.key.toLowerCase()==='f'&&currentView==='conversation'){e.preventDefault();openConversationFind();}}},true);",
    acceptance: 'UX-065'
  }
];
let next = text;
const proof = [];
for (const item of replacements) {
  const count = next.split(item.old).length - 1;
  if (count !== 1) throw new Error('expected one anchor for ' + item.acceptance + ', found ' + count);
  next = next.replace(item.old, item.new);
  proof.push({ file: 'polished.js', old: item.old, new: item.new, acceptance: item.acceptance, occurrences: count });
}
fs.writeFileSync(candidate, next);
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const packageRoot = path.dirname(candidate);
fs.writeFileSync(path.resolve(__dirname, 'replacement-proof.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'ui-release/candidate/polished.js',
  sourceSha256: sha(path.resolve(__dirname, '..', 'ui-release', 'candidate', 'polished.js')),
  candidateSha256: sha(candidate),
  replacements: proof,
  scope: 'UX-065 only; frozen v9.1 UI candidate copy'
}, null, 2));
console.log(JSON.stringify({ sourceSha256: sha(path.resolve(__dirname, '..', 'ui-release', 'candidate', 'polished.js')), candidateSha256: sha(candidate), replacements: proof.length }));
