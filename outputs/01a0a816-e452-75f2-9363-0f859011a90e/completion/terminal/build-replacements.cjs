'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = __dirname;
const projectRoot = path.resolve(packageRoot, '../../../..');
const baselineRoot = path.join(projectRoot, 'outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/baseline');
const candidateRoot = path.join(packageRoot, 'candidate');
const sha = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const read = file => fs.readFileSync(file, 'utf8');
const lineNumber = (source, index) => source.slice(0, index).split('\n').length;
const anchorHash = value => sha(value);

function hunk(file, before, after, start, end, anchor) {
  const old = before.slice(start, end);
  const replacement = after.slice(start, end);
  return {
    file,
    beforeLine: lineNumber(before, start),
    afterLine: lineNumber(after, start),
    anchor,
    anchorSHA256: anchorHash(anchor),
    old,
    new: replacement,
    sourceSHA256Before: sha(before),
    sourceSHA256After: sha(after)
  };
}

function seamHunk(file, before, after, startNeedle, endNeedle, anchor, candidateStartNeedle = startNeedle) {
  const start = before.indexOf(startNeedle);
  const end = before.indexOf(endNeedle, start);
  const candidateStart = after.indexOf(candidateStartNeedle);
  const candidateEnd = after.indexOf(endNeedle, candidateStart);
  if (start < 0 || end < 0 || candidateStart < 0 || candidateEnd < 0) throw new Error(`Missing seam in ${file}`);
  return {
    file,
    beforeLine: lineNumber(before, start),
    afterLine: lineNumber(after, candidateStart),
    anchor,
    anchorSHA256: anchorHash(anchor),
    old: before.slice(start, end),
    new: after.slice(candidateStart, candidateEnd),
    sourceSHA256Before: sha(before),
    sourceSHA256After: sha(after)
  };
}

function insertionHunk(file, before, after, needle) {
  const start = before.indexOf(needle);
  if (start < 0) throw new Error(`Missing insertion anchor in ${file}`);
  const end = start + needle.length;
  const candidateNeedle = after.indexOf(needle);
  if (candidateNeedle < 0) throw new Error(`Missing candidate insertion anchor in ${file}`);
  const lineEnd = after.indexOf('\n', candidateNeedle + needle.length);
  const newEnd = lineEnd < 0 ? candidateNeedle + needle.length : lineEnd + 1;
  const old = before.slice(start, end);
  const replacement = after.slice(candidateNeedle, newEnd);
  return {
    file,
    beforeLine: lineNumber(before, start),
    afterLine: lineNumber(after, candidateNeedle),
    anchor: needle.trimEnd(),
    anchorSHA256: anchorHash(needle.trimEnd()),
    old,
    new: replacement,
    sourceSHA256Before: sha(before),
    sourceSHA256After: sha(after)
  };
}

const files = {
  'polished.html': {
    baseline: path.join(baselineRoot, 'polished.html'), candidate: path.join(candidateRoot, 'polished.html')
  },
  'polished.js': {
    baseline: path.join(baselineRoot, 'polished.js'), candidate: path.join(candidateRoot, 'polished.js')
  },
  'intentgraph/server.cjs': {
    baseline: path.join(baselineRoot, 'intentgraph/server.cjs'), candidate: path.join(candidateRoot, 'intentgraph/server.cjs')
  }
};
const sourceFiles = {};
for (const [file, pair] of Object.entries(files)) {
  const before = read(pair.baseline), after = read(pair.candidate);
  sourceFiles[file] = { baselinePath: `completion/baseline/${file}`, candidatePath: `completion/terminal/candidate/${file}`, baselineSHA256: sha(before), candidateSHA256: sha(after) };
}
const htmlBefore = read(files['polished.html'].baseline), htmlAfter = read(files['polished.html'].candidate);
const jsBefore = read(files['polished.js'].baseline), jsAfter = read(files['polished.js'].candidate);
const serverBefore = read(files['intentgraph/server.cjs'].baseline), serverAfter = read(files['intentgraph/server.cjs'].candidate);
const replacements = [
  insertionHunk('polished.html', htmlBefore, htmlAfter, '  <link rel="stylesheet" href="polished-files.css?revision=ux-audit-fixes-v8">\r\n'),
  insertionHunk('polished.html', htmlBefore, htmlAfter, '  <script src="polished-files.js?revision=ux-audit-fixes-v8"></script>\r\n'),
  seamHunk('polished.html', htmlBefore, htmlAfter, '  <div class="popover" id="add-menu"', '  <input type="file" id="file-picker"', 'div class="popover" id="add-menu"'),
  seamHunk('polished.js', jsBefore, jsAfter, "[['browser','Inspect a browser result','browser'],['plugins','Read Cisco inventory','plug'],['computer','Inspect a sample desktop','computer']]", 'let day=null;', 'Read Cisco inventory', "[['browser','Inspect a browser result','browser'],['plugins','Read network inventory','plug'],['computer','Inspect a sample desktop','computer']]") ,
  seamHunk('polished.js', jsBefore, jsAfter, "controller.signal.aborted?'Run stopped. A command already submitted to Cisco may still finish.':", "error.name==='TimeoutError'", 'Run stopped. A command already submitted to Cisco', "controller.signal.aborted?'Run stopped. A submitted network diagnostic command may still finish.':") ,
  seamHunk('polished.js', jsBefore, jsAfter, "  let sandboxResult = null, sandboxLoading = false, sandboxError = '';", '  async function addFiles(files){', "let sandboxResult = null, sandboxLoading = false, sandboxError = '';") ,
  insertionHunk('intentgraph/server.cjs', serverBefore, serverAfter, '  const activeRuns = new Map();\n'),
  seamHunk('intentgraph/server.cjs', serverBefore, serverAfter, "    if (pathname === '/api/sandbox/status' || pathname === '/api/sandbox/inventory') {", '    if (req.method === \'GET\') {', "if (pathname === '/api/sandbox/status' || pathname === '/api/sandbox/inventory') {", "    if (pathname === '/api/sandbox/status' || pathname === '/api/sandbox/inventory' || pathname === '/api/sandbox/command') {")
];
const standalone = ['polished-terminal.js', 'polished-terminal.css'].map(name => {
  const content = read(path.join(candidateRoot, name));
  return { candidatePath: `completion/terminal/candidate/${name}`, candidateSHA256: sha(content), bytes: Buffer.byteLength(content), purpose: 'UX071 standalone read-only diagnostic terminal surface' };
});
const manifest = {
  schemaVersion: 1,
  scope: 'UX071 local read-only diagnostic terminal with exact target and command resolution, immutable run evidence, and cancel-as-UNKNOWN semantics.',
  touchedFiles: Object.keys(files).map(file => `completion/terminal/candidate/${file}`).concat(standalone.map(file => file.candidatePath)),
  sourceFiles,
  replacements,
  newFiles: standalone
};
fs.writeFileSync(path.join(packageRoot, 'replacements.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: 'PASS', replacements: replacements.length, standalone: standalone.length, sourceFiles }, null, 2) + '\n');
