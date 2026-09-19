const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const out = path.resolve(__dirname);
const baselineRoot = path.resolve(__dirname, '..', 'baseline');
const candidateRoot = path.join(out, 'candidate');
const files = ['polished.js', 'polished.css'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();

function splitLines(source) {
  const result = []; let at = 0;
  while (at < source.length) {
    const lf = source.indexOf('\n', at);
    if (lf < 0) { result.push({ text: source.slice(at), eol: '' }); break; }
    const cr = lf > at && source[lf - 1] === '\r';
    result.push({ text: source.slice(at, cr ? lf - 1 : lf), eol: cr ? '\r\n' : '\n' }); at = lf + 1;
  }
  return result;
}
function lineSlice(source, start, count) {
  if (!count) return '';
  return splitLines(source).slice(Math.max(0, start - 1), Math.max(0, start - 1) + count).map(line => line.text + line.eol).join('');
}
function insertionAnchor(before, after, inserted) {
  const index = after.indexOf(inserted);
  if (index < 0) throw new Error('candidate insertion is missing');
  if (!index) return { old: '', new: inserted, beforeLine: 1 };
  const lineStart = after.lastIndexOf('\n', index - 2) + 1;
  const anchor = after.slice(lineStart, index);
  if (!anchor || before.indexOf(anchor) < 0) throw new Error('baseline insertion anchor is missing');
  return { old: anchor, new: anchor + inserted, beforeLine: before.slice(0, before.indexOf(anchor)).split(/\r?\n/).length };
}
function replacementsFor(file, before, after) {
  const diff = childProcess.spawnSync('git', ['diff', '--no-index', '--unified=0', '--', path.join(baselineRoot, file), path.join(candidateRoot, file)], { encoding: 'utf8' });
  if (diff.error) throw diff.error;
  const hunks = []; let current = null;
  const flush = () => {
    if (!current) return;
    let old = lineSlice(before, current.beforeLine, current.oldCount);
    let nu = lineSlice(after, current.afterLine, current.newCount);
    let beforeLine = current.beforeLine;
    if (!current.oldCount) ({ old, new: nu, beforeLine } = insertionAnchor(before, after, nu));
    const anchor = (old || nu).split(/\r?\n/).find(Boolean) || '';
    hunks.push({ file, beforeLine, afterLine: current.afterLine, anchor: anchor.trim().slice(0, 240), anchorSHA256: sha(anchor), old, new: nu, sourceSHA256Before: sha(before), sourceSHA256After: sha(after) });
  };
  for (const line of String(diff.stdout || '').split(/\r?\n/)) {
    if (!line.startsWith('@@ ')) continue;
    flush();
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    current = { beforeLine: Number(match[1]), oldCount: match[2] === undefined ? 1 : Number(match[2]), afterLine: Number(match[3]), newCount: match[4] === undefined ? 1 : Number(match[4]) };
  }
  flush(); return hunks;
}

const sourceFiles = {}; const replacements = [];
for (const file of files) {
  const before = fs.readFileSync(path.join(baselineRoot, file), 'utf8');
  const after = fs.readFileSync(path.join(candidateRoot, file), 'utf8');
  sourceFiles[file] = { baselinePath: `completion/baseline/${file}`, candidatePath: `completion/reaction-picker/candidate/${file}`, baselineSHA256: sha(before), candidateSHA256: sha(after) };
  replacements.push(...replacementsFor(file, before, after));
}
const manifest = { schemaVersion: 1, scope: 'UX049 searchable More reactions picker with contained keyboard navigation and local message-specific persistence.', touchedFiles: files.map(file => `completion/reaction-picker/candidate/${file}`), sourceFiles, replacements };
fs.writeFileSync(path.join(out, 'replacements.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', replacements: replacements.length, touchedFiles: files }, null, 2));
