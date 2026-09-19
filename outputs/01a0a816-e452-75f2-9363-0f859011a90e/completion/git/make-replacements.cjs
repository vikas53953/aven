'use strict';

// Build the Git candidate's byte-exact integration manifest from completion/baseline.
// This deliberately reads raw bytes so CRLF/mixed-ending source files are retained.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const completion = path.resolve(here, '..');
const baselineRoot = path.join(completion, 'baseline');
const outputPath = path.join(here, 'replacements.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const sourceText = file => fs.readFileSync(path.join(baselineRoot, file), 'utf8');
const newline = (text, index) => text.startsWith('\r\n', index) ? '\r\n' : text.startsWith('\n', index) ? '\n' : '\r\n';

const changes = [];
function add(file, old, makeNew, label) {
  const text = sourceText(file);
  const count = text.split(old).length - 1;
  if (!old || count !== 1) throw new Error(`${file}: ${label} anchor count=${count}`);
  const sourceBytes = Buffer.from(text, 'utf8');
  const index = text.indexOf(old);
  const next = typeof makeNew === 'function' ? makeNew(old, text, index) : makeNew;
  changes.push({ file, sourceSHA: sha256(sourceBytes), sequence: changes.length + 1, label, old, new: next });
}

add('polished.html',
  '  <link rel="stylesheet" href="polished-files.css?revision=ux-audit-fixes-v8">',
  old => `${old}\r\n  <link rel="stylesheet" href="polished-git.css?revision=ux075-git-v1">`,
  'load Git pane styles');
add('polished.html',
  '  <script src="polished-files.js?revision=ux-audit-fixes-v8"></script>',
  old => `${old}\r\n  <script src="polished-git.js?revision=ux075-git-v1"></script>`,
  'load Git pane controls');

const renderGitSettings = `  function renderGitSettings(container){if(globalThis.AvenGitWorkspace?.mount){globalThis.AvenGitWorkspace.mount(container,{apiBase:'http://127.0.0.1:8768/api/git'});}else{container.innerHTML='<h2>Git workspace</h2><p>Git controls are unavailable until the local Git workspace module loads.</p>';}}`;
add('polished.js', '  function renderSettingsPage(){',
  (old, text, index) => `${renderGitSettings}${newline(text, index + old.length)}${old}`,
  'mount Git pane from Settings');
add('polished.js', "if(settingsPage==='models'||settingsPage==='connections')renderLocalDiagnostics(p);",
  old => `${old}if(settingsPage==='git')renderGitSettings(p);`,
  'render Git pane for Git category');
add('polished.js', "['archived','Archived chats']",
  old => `${old},['git','Git']`,
  'add Git Settings category');

add('intentgraph/server.cjs', "const { createChatReadApi } = require('./chat-read-api.cjs');",
  (old, text, index) => `${old}${newline(text, index + old.length)}const { createGitWorkspace, createGitWorkspaceApi } = require('./git-workspace.cjs');`,
  'load Git backend');
const chatReadBlock = `  const chatReadApi = createChatReadApi({\n    root,\n    getExecutionStatus: () => execution ? execution.status() : null,\n    getActiveRuns: () => Array.from(activeRuns.values()),\n    chatOriginAllowed\n  });`;
add('intentgraph/server.cjs', chatReadBlock,
  old => `${old}\n  const gitWorkspace = options.gitWorkspace || createGitWorkspace({ runtimeDirectory, ...(options.gitWorkspaceOptions || {}) });\n  const gitApi = createGitWorkspaceApi({ workspace: gitWorkspace });`,
  'construct Git API beside chat API');
add('intentgraph/server.cjs', '    if (await chatReadApi.handle(req, res)) return;',
  old => `    if (await gitApi.handle(req, res)) return;\n${old}`,
  'route Git requests before chat');
add('intentgraph/server.cjs',
  '  server.intentGraph = { root, runtimeDirectory, token, engine, indexer, ready, startWatchers, closeWatchers, execution };',
  old => old.replace(', execution };', ', execution, gitWorkspace, gitApi };'),
  'expose Git workspace for injected tests');

const manifest = {
  schemaVersion: 1,
  scope: 'UX075 Git Settings pane and secure local stage, unstage, commit, and explicit PR controls; apply only to frozen completion/baseline v8 sources.',
  bytePolicy: 'old/new strings are UTF-8 byte exact; each frozen-baseline anchor is unique and entries apply in sequence order; no newline normalization.',
  touchedFiles: ['polished.html', 'polished.js', 'intentgraph/server.cjs'],
  sourceFiles: Object.fromEntries([...new Set(changes.map(change => change.file))].map(file => {
    const bytes = fs.readFileSync(path.join(baselineRoot, file));
    return [file, { baselinePath: `completion/baseline/${file}`, baselineSHA256: sha256(bytes) }];
  })),
  replacements: changes,
};
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
process.stdout.write(`wrote ${changes.length} byte-exact replacements to ${outputPath}\n`);
