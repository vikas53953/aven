'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'replacements.json'), 'utf8'));
const baseRoot = path.resolve(__dirname, '..', '..', 'assembled-candidate');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const byFile = new Map();
for (const item of manifest.replacements) {
  if (!byFile.has(item.file)) byFile.set(item.file, []);
  byFile.get(item.file).push(item);
}
assert.equal(byFile.get('polished.js')?.length, 2, 'polished.js topology and dictation seams are present');
assert.equal(byFile.get('workspace-capabilities.js')?.length, 4, 'topology identity and dictation seams are present');
const transformedByFile = new Map();
for (const [file, items] of byFile) {
  const source = fs.readFileSync(path.join(baseRoot, file), 'utf8');
  assert.equal(hash(source), manifest.baseInput.files[file], `frozen input hash is unchanged: ${file}`);
  let transformed = source;
  for (const item of items) {
    assert.equal(hash(item.old), item.beforeSHA256, `replacement before hash: ${file}`);
    assert.equal(hash(item.new), item.afterSHA256, `replacement after hash: ${file}`);
    assert.equal(transformed.includes(item.old), true, `replacement seam is present: ${item.old.slice(0, 36)}`);
    transformed = transformed.replace(item.old, item.new);
  }
  transformedByFile.set(file, { source, transformed });
}
const polished = transformedByFile.get('polished.js').transformed;
const capabilities = transformedByFile.get('workspace-capabilities.js').transformed;
assert.equal((polished.match(/sandbox-topology/gu) || []).length, 1, 'topology host is mounted once');
assert.match(polished, /renderTopology\(topologyHost, topology\)/u);
assert.match(polished, /links: \[\]/u, 'inventory-derived fallback supplies no invented links');
assert.doesNotMatch(polished, /device-\$\{index \+ 1\}/u, 'topology does not invent target IDs');
assert.match(polished, /adapter:globalThis\.AvenDictationAdapter/u, 'dictation accepts only an injected adapter seam');
assert.match(polished, /createWebSpeechDictationAdapter/u, 'default dictation uses the bounded browser capability when available');
assert.match(capabilities, /input\.value=str\(input\.value\)\.replace/u, 'stable-ID action replaces the draft token');
assert.match(polished, /AvenAttachments\.compose\(byId\('draft'\)\.value\.trim\(\),items\)\.text/u, 'send path composes the edited draft text');
assert.match(polished, /messages\.unshift\(\{role:m\.role,content\}\)/u, 'next request serializes stored message content');
assert.doesNotThrow(() => new Function(polished), 'composed polished.js remains syntactically valid');
assert.match(capabilities, /Browser speech recognition may send audio/u, 'browser speech privacy disclosure is present');
assert.doesNotThrow(() => new Function(capabilities), 'composed capability module remains syntactically valid');

const cap = require('./workspace-capabilities.js');
const inventoryOnly = cap.normalizeTopology({
  source: 'Cisco sandbox inventory',
  freshness: '2026-09-17T04:00:00Z',
  nodes: [{ id: 'sw-1', label: 'branch-switch' }, { hostname: 'unnamed-id-device' }],
  links: []
});
assert.equal(inventoryOnly.nodes[0].stableId, 'sw-1');
assert.equal(inventoryOnly.nodes[1].identityAvailable, false);
assert.equal(inventoryOnly.nodes[1].stableId, '');
assert.equal(inventoryOnly.links.length, 0);
const supplied = cap.normalizeTopology({
  source: 'retained topology evidence',
  freshness: '2026-09-17T04:01:00Z',
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  links: [{ from: 'a', to: 'b', inferred: true, source: 'route inference' }]
});
assert.equal(supplied.links.length, 1);
assert.equal(supplied.links[0].inferred, true);
assert.equal(supplied.links[0].source, 'route inference');
assert.equal(supplied.links[0].freshness, '2026-09-17T04:01:00Z');
console.log(JSON.stringify({ passed: true, cases: 17, baseInput: hash(transformedByFile.get('polished.js').source), transformedSource: hash(polished), externalCalls: 0 }));
