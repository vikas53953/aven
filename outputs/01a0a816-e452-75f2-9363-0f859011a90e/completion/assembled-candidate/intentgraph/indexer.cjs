'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 1500;
const MAX_DIFFS = 64;
const MAX_PARSE_CACHE = 2048;
const ALLOWED_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.html', '.htm',
  '.css', '.md', '.markdown', '.json'
]);
const LANGUAGE_BY_EXTENSION = {
  '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.html': 'html', '.htm': 'html',
  '.css': 'css', '.md': 'markdown', '.markdown': 'markdown', '.json': 'json'
};
const SECRET_NAME = /(^|[._-])(env|secret|secrets|credential|credentials|password|passwd|token|private|id_rsa|pem|key)([._-]|$)/i;
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der']);
const LOCKFILE_NAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);
const IGNORED_DIR_NAMES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', 'test-results', 'testresults',
  'screenshots', 'baselines', 'logs', 'credentials', 'secrets', 'secret', '__snapshots__', 'capture-profile',
  '.cache', '.tmp', 'tmp'
]);

// Parsing is the expensive part of a rescan. File bytes are still read and
// hashed on every scan; only deterministic parse output is reused. The full
// indexed path-set is part of the key because local import resolution changes
// when a file is added or removed.
const parseCache = new Map();
let parseCacheHits = 0;
let parseCacheMisses = 0;

function clearParseCache() {
  parseCache.clear();
  parseCacheHits = 0;
  parseCacheMisses = 0;
}

function getParseCacheStats() {
  return { entries: parseCache.size, hits: parseCacheHits, misses: parseCacheMisses };
}

function cacheParsedResult(key, parsed) {
  parseCache.set(key, safeJson(parsed));
  while (parseCache.size > MAX_PARSE_CACHE) parseCache.delete(parseCache.keys().next().value);
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function fileId(relativePath) {
  return `file:${normalizeRelative(relativePath)}`;
}

function safeJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const data = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  fs.writeFileSync(tempPath, data, 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Windows can reject replacing an existing file. Keep the write recoverable
    // and avoid leaving a half-written JSON document behind.
    try { fs.rmSync(filePath, { force: true }); } catch {}
    fs.renameSync(tempPath, filePath);
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isSecretPath(relativePath) {
  const base = path.basename(relativePath);
  const lower = base.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.') || SECRET_NAME.test(base) || SECRET_EXTENSIONS.has(path.extname(lower));
}

function shouldIgnoreDirectory(relativePath, name) {
  if (IGNORED_DIR_NAMES.has(name.toLowerCase())) return true;
  const normalized = normalizeRelative(relativePath).toLowerCase();
  if (normalized === '.intentgraph/runtime' || normalized.startsWith('.intentgraph/runtime/')) return true;
  if (normalized.includes('/.intentgraph/capture-profile')) return true;
  return false;
}

function shouldIndexPath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  const base = path.basename(normalized);
  const ext = path.extname(base).toLowerCase();
  const lowerBase = base.toLowerCase();
  if (LOCKFILE_NAMES.has(lowerBase) || !ALLOWED_EXTENSIONS.has(ext) || isSecretPath(normalized)) return false;
  const parts = normalized.split('/');
  if (parts.some((part) => IGNORED_DIR_NAMES.has(part.toLowerCase()))) return false;
  if (parts.some((part) => part.toLowerCase() === 'runtime') && parts.includes('.intentgraph')) return false;
  const lowerNormalized = normalized.toLowerCase();
  if (lowerNormalized.includes('/test-results/') || lowerNormalized.includes('/test-result/') || lowerNormalized.includes('/coverage/') || lowerNormalized.includes('/logs/') || lowerBase.includes('test-results') || lowerBase.includes('testresults') || lowerBase.includes('test-result')) return false;
  return true;
}

function isIgnoredResolvedPath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  const parts = normalized.split('/');
  return parts.some((part) => IGNORED_DIR_NAMES.has(part.toLowerCase())) ||
    normalized === '.intentgraph/runtime' || normalized.startsWith('.intentgraph/runtime/');
}

function lineOf(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function endLineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(Math.max(node.end - 1, node.pos)).line + 1;
}

function scriptKindFor(relativePath, ts) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.ts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function declarationName(node, ts) {
  if (node.name && typeof node.name.getText === 'function') return node.name.getText();
  if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

function declarationKind(node, ts) {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property';
  if (ts.isVariableDeclaration(node)) return 'variable';
  if (ts.isGetAccessorDeclaration(node)) return 'getter';
  if (ts.isSetAccessorDeclaration(node)) return 'setter';
  return 'declaration';
}

function parseTypeScript(relativePath, content, file, filesByPath, ts, coverage) {
  const symbols = [];
  const edges = [];
  const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, scriptKindFor(relativePath, ts));
  const declarationsByNode = new Map();
  const symbolsByQualifiedName = new Map();
  const scopesByNode = new Map();
  const unresolved = new Set();

  function isScopeNode(node) {
    return node === sourceFile || ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) ||
      ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
  }

  function addSymbol(node, name, qualifiedName) {
    if (!name) return null;
    let uniqueName = qualifiedName;
    if (symbolsByQualifiedName.has(uniqueName)) uniqueName = `${qualifiedName}@${lineOf(sourceFile, node.pos)}`;
    const id = `symbol:${normalizeRelative(relativePath)}#${uniqueName}`;
    const symbol = {
      id,
      type: 'symbol',
      file: file.path,
      name: uniqueName,
      line: lineOf(sourceFile, node.pos),
      endLine: endLineOf(sourceFile, node)
    };
    symbols.push(symbol);
    symbolsByQualifiedName.set(uniqueName, symbol);
    declarationsByNode.set(node, symbol);
    return symbol;
  }

  function visitDeclarations(node, parents, parentScope) {
    let scope = parentScope;
    if (isScopeNode(node)) {
      scope = { parent: parentScope || null, bindings: new Map() };
      scopesByNode.set(node, scope);
    }
    let nextParents = parents;
    const named = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ||
      ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isVariableDeclaration(node);
    if (named) {
      const name = declarationName(node, ts);
      if (name && name !== 'default') {
        const qualifiedName = parents.concat(name).join('.');
        const symbol = addSymbol(node, name, qualifiedName);
        if (scope) scope.bindings.set(name, symbol);
        // Function/class names are visible in their enclosing scope as well as
        // their own scope (recursive calls), while nested declarations remain
        // correctly shadowable through the scope chain.
        if (parentScope && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))) parentScope.bindings.set(name, symbol);
        nextParents = parents.concat(name);
      }
    }
    ts.forEachChild(node, (child) => visitDeclarations(child, nextParents, scope));
  }
  visitDeclarations(sourceFile, [], null);

  function resolveBareName(name, scope) {
    let current = scope;
    while (current) {
      if (current.bindings.has(name)) return current.bindings.get(name);
      current = current.parent;
    }
    return null;
  }

  function resolveImport(specifier) {
    if (!specifier.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(relativePath)), specifier));
    const candidates = [base, ...Array.from(ALLOWED_EXTENSIONS).map((ext) => `${base}${ext}`), ...Array.from(ALLOWED_EXTENSIONS).map((ext) => `${base}/index${ext}`)];
    return candidates.find((candidate) => filesByPath.has(normalizeRelative(candidate))) || null;
  }

  function addCallEdge(sourceSymbol, target, kind, provenance) {
    edges.push({
      source: sourceSymbol ? sourceSymbol.id : file.id,
      target,
      kind,
      provenance
    });
  }

  function walk(node, currentSymbol, currentScope) {
    let activeSymbol = currentSymbol;
    let activeScope = currentScope;
    if (scopesByNode.has(node)) activeScope = scopesByNode.get(node);
    if (declarationsByNode.has(node)) activeSymbol = declarationsByNode.get(node);
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const resolved = resolveImport(specifier);
      if (resolved) {
        edges.push({ source: file.id, target: fileId(resolved), kind: 'import', provenance: 'static:typescript-ast' });
      } else {
        const target = `external:${specifier}`;
        edges.push({ source: file.id, target, kind: 'import', provenance: 'static:unresolved-external-path' });
        unresolved.add(specifier);
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      let name = null;
      const expression = node.expression;
      if (expression && ts.isIdentifier(expression)) name = expression.text;
      else if (expression && ts.isPropertyAccessExpression(expression)) name = expression.getText(sourceFile);
      if (name) {
        // A property access such as renderProfile.select is intentionally left
        // unresolved unless a type checker can prove its receiver. Mapping it
        // to a same-named declaration elsewhere creates false graph edges.
        const targetSymbol = expression && ts.isIdentifier(expression) ? resolveBareName(name, activeScope) : null;
        const target = targetSymbol ? targetSymbol.id : `external-call:${name}`;
        addCallEdge(activeSymbol, target, ts.isNewExpression(node) ? 'construct' : 'call', targetSymbol ? 'static:typescript-ast' : 'static:unresolved-call');
        if (!targetSymbol) unresolved.add(name);
      }
    }
    if (ts.isCallExpression(node) && node.arguments.length && ts.isIdentifier(node.expression) &&
      ['require', 'import'].includes(node.expression.text) && ts.isStringLiteral(node.arguments[0])) {
      const specifier = node.arguments[0].text;
      const resolved = resolveImport(specifier);
      if (resolved) edges.push({ source: activeSymbol ? activeSymbol.id : file.id, target: fileId(resolved), kind: 'import', provenance: 'static:typescript-ast-require' });
      else {
        edges.push({ source: activeSymbol ? activeSymbol.id : file.id, target: `external:${specifier}`, kind: 'import', provenance: 'static:unresolved-external-path' });
        unresolved.add(specifier);
      }
    }
    ts.forEachChild(node, (child) => walk(child, activeSymbol, activeScope));
  }
  walk(sourceFile, null, scopesByNode.get(sourceFile));
  coverage.unresolvedExternalPaths.push(...Array.from(unresolved).map((value) => `${relativePath}:${value}`));
  return { symbols, edges };
}

function parseWithFallback(relativePath, content, file, filesByPath, coverage) {
  const symbols = [];
  const edges = [];
  const lines = content.split(/\r?\n/);
  const declarations = new Map();
  const declarationPattern = /\b(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  lines.forEach((line, index) => {
    let match;
    while ((match = declarationPattern.exec(line))) {
      const name = match[1] || match[2];
      const qualifiedName = declarations.has(name) ? `${name}@${index + 1}` : name;
      const symbol = { id: `symbol:${normalizeRelative(relativePath)}#${qualifiedName}`, type: 'symbol', file: file.path, name: qualifiedName, line: index + 1, endLine: index + 1 };
      symbols.push(symbol);
      declarations.set(name, symbol);
    }
    const importMatch = line.match(/(?:from|import\s*\(|require\s*\()\s*["']([^"']+)["']/);
    if (importMatch) {
      const specifier = importMatch[1];
      const normalized = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(relativePath)), specifier)) : null;
      const resolved = normalized && ([normalized, `${normalized}.js`, `${normalized}.ts`, `${normalized}.tsx`, `${normalized}.jsx`, `${normalized}.cjs`, `${normalized}.mjs`, `${normalized}/index.js`].find((candidate) => filesByPath.has(candidate)));
      if (resolved) edges.push({ source: file.id, target: fileId(resolved), kind: 'import', provenance: 'static:regex-fallback' });
      else {
        edges.push({ source: file.id, target: `external:${specifier}`, kind: 'import', provenance: 'static:unresolved-external-path' });
        coverage.unresolvedExternalPaths.push(`${relativePath}:${specifier}`);
      }
    }
  });
  return { symbols, edges };
}

function resolveLocalPath(relativePath, specifier, filesByPath) {
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(relativePath)), specifier));
  const candidates = [normalized, ...Array.from(ALLOWED_EXTENSIONS).map((ext) => `${normalized}${ext}`), ...Array.from(ALLOWED_EXTENSIONS).map((ext) => `${normalized}/index${ext}`)];
  return candidates.find((candidate) => filesByPath.has(normalizeRelative(candidate))) || null;
}

function parseHtml(relativePath, content, file, filesByPath, coverage) {
  const edges = [];
  const patterns = [
    { regex: /<script\b[^>]*\bsrc=["']([^"']+)["']/gi, kind: 'html-script' },
    { regex: /<link\b[^>]*\bhref=["']([^"']+)["']/gi, kind: 'html-link' }
  ];
  for (const entry of patterns) {
    let match;
    while ((match = entry.regex.exec(content))) {
      const specifier = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(specifier)) continue;
      const resolved = resolveLocalPath(relativePath, specifier, filesByPath);
      if (resolved) edges.push({ source: file.id, target: fileId(resolved), kind: entry.kind, provenance: 'static:html-attribute' });
      else {
        edges.push({ source: file.id, target: `external:${specifier}`, kind: entry.kind, provenance: 'static:unresolved-external-path' });
        coverage.unresolvedExternalPaths.push(`${relativePath}:${specifier}`);
      }
    }
  }
  return { symbols: [], edges };
}

function parseCss(relativePath, content, file, filesByPath, coverage) {
  const edges = [];
  const regex = /@import\s+(?:url\()?\s*["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(content))) {
    const specifier = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(specifier)) continue;
    const resolved = resolveLocalPath(relativePath, specifier, filesByPath);
    if (resolved) edges.push({ source: file.id, target: fileId(resolved), kind: 'css-import', provenance: 'static:css-attribute' });
    else {
      edges.push({ source: file.id, target: `external:${specifier}`, kind: 'css-import', provenance: 'static:unresolved-external-path' });
      coverage.unresolvedExternalPaths.push(`${relativePath}:${specifier}`);
    }
  }
  return { symbols: [], edges };
}

function parseMarkdown(relativePath, content, file, filesByPath, coverage) {
  const edges = [];
  const regex = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match;
  while ((match = regex.exec(content))) {
    const specifier = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(specifier)) continue;
    const resolved = resolveLocalPath(relativePath, specifier, filesByPath);
    if (resolved) edges.push({ source: file.id, target: fileId(resolved), kind: 'markdown-link', provenance: 'static:markdown-link' });
    else {
      edges.push({ source: file.id, target: `external:${specifier}`, kind: 'markdown-link', provenance: 'static:unresolved-external-path' });
      coverage.unresolvedExternalPaths.push(`${relativePath}:${specifier}`);
    }
  }
  return { symbols: [], edges };
}

function collectFiles(root) {
  const rootReal = fs.realpathSync(root);
  const files = [];
  const skipped = [];
  const queue = [''];
  while (queue.length) {
    const relativeDirectory = queue.shift();
    const absoluteDirectory = path.join(rootReal, relativeDirectory);
    let entries;
    try { entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true }); } catch (error) {
      skipped.push({ path: normalizeRelative(relativeDirectory), reason: `read-error:${error.code || 'unknown'}` });
      continue;
    }
    for (const entry of entries) {
      const relativePath = normalizeRelative(path.join(relativeDirectory, entry.name));
      const absolutePath = path.join(rootReal, relativePath);
      let stat;
      try { stat = fs.lstatSync(absolutePath); } catch { skipped.push({ path: relativePath, reason: 'stat-error' }); continue; }
      if (stat.isSymbolicLink()) {
        let target;
        try { target = fs.realpathSync(absolutePath); } catch { skipped.push({ path: relativePath, reason: 'broken-symlink' }); continue; }
        if (!isInside(rootReal, target)) skipped.push({ path: relativePath, reason: 'symlink-escapes-root' });
        else if (stat.isDirectory()) queue.push(relativePath);
        else if (shouldIndexPath(relativePath)) {
          const targetRelative = normalizeRelative(path.relative(rootReal, target));
          if (!shouldIndexPath(targetRelative) || isIgnoredResolvedPath(targetRelative)) {
            skipped.push({ path: relativePath, reason: 'symlink-target-ignored-or-secret' });
            continue;
          }
          if (files.length >= MAX_FILES) skipped.push({ path: relativePath, reason: 'file-count-cap' });
          else files.push({ relativePath, absolutePath: target });
        }
        continue;
      }
      if (stat.isDirectory()) {
        if (!shouldIgnoreDirectory(relativePath, entry.name)) queue.push(relativePath);
        continue;
      }
      if (!stat.isFile() || !shouldIndexPath(relativePath)) continue;
      if (files.length >= MAX_FILES) {
        skipped.push({ path: relativePath, reason: 'file-count-cap' });
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({ path: relativePath, reason: 'file-size-cap', bytes: stat.size });
        continue;
      }
      files.push({ relativePath, absolutePath });
    }
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { rootReal, files, skipped };
}

function buildIndex(root, options = {}) {
  const rootReal = fs.realpathSync(root);
  const collected = collectFiles(rootReal);
  const files = [];
  const contents = new Map();
  const filesByPath = new Map();
  const coverage = {
    maxFiles: MAX_FILES,
    maxFileBytes: MAX_FILE_BYTES,
    scannedFiles: 0,
    indexedFiles: 0,
    skippedFiles: collected.skipped.length,
    skipped: collected.skipped.slice(0, 250),
    truncatedFiles: [],
    unresolvedExternalPaths: [],
    gaps: []
  };

  for (const item of collected.files) {
    let buffer;
    try { buffer = fs.readFileSync(item.absolutePath); } catch (error) {
      coverage.skippedFiles += 1;
      coverage.skipped.push({ path: item.relativePath, reason: `read-error:${error.code || 'unknown'}` });
      continue;
    }
    coverage.scannedFiles += 1;
    if (buffer.length > MAX_FILE_BYTES) {
      coverage.truncatedFiles.push(item.relativePath);
      coverage.skippedFiles += 1;
      continue;
    }
    const relativePath = normalizeRelative(item.relativePath);
    const file = {
      id: fileId(relativePath),
      path: relativePath,
      hash: sha256(buffer),
      bytes: buffer.length,
      language: LANGUAGE_BY_EXTENSION[path.extname(relativePath).toLowerCase()] || 'text'
    };
    files.push(file);
    contents.set(relativePath, buffer.toString('utf8'));
    filesByPath.set(relativePath, file);
  }
  coverage.indexedFiles = files.length;
  if (coverage.skippedFiles) coverage.gaps.push('Some files were excluded by size, count, ignore, symlink, or read-error policy.');

  const nodes = files.map((file) => ({ id: file.id, type: 'file', file: file.path, name: file.path, line: 1, endLine: Math.max(1, (contents.get(file.path).match(/\r?\n/g) || []).length + 1) }));
  const edges = [];
  const filePathSetHash = sha256(files.map((file) => file.path).join('\n'));
  let ts;
  try { ts = require('typescript'); } catch { ts = null; }
  for (const file of files) {
    const content = contents.get(file.path);
    const ext = path.extname(file.path).toLowerCase();
    let parsed = { symbols: [], edges: [] };
    const cacheKey = `${file.path}\0${file.hash}\0${filePathSetHash}\0${file.language}`;
    const cached = parseCache.get(cacheKey);
    if (cached) {
      parseCacheHits += 1;
      parsed = safeJson(cached.parsed);
      coverage.unresolvedExternalPaths.push(...(cached.unresolvedExternalPaths || []));
      coverage.gaps.push(...(cached.gaps || []));
    } else {
      parseCacheMisses += 1;
      const localCoverage = { unresolvedExternalPaths: [], gaps: [] };
      try {
        if (['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'].includes(ext)) {
          parsed = ts ? parseTypeScript(file.path, content, file, filesByPath, ts, localCoverage) : parseWithFallback(file.path, content, file, filesByPath, localCoverage);
          if (!ts) localCoverage.gaps.push('TypeScript package unavailable; JavaScript/TypeScript symbols use regex fallback.');
        } else if (['.html', '.htm'].includes(ext)) parsed = parseHtml(file.path, content, file, filesByPath, localCoverage);
        else if (ext === '.css') parsed = parseCss(file.path, content, file, filesByPath, localCoverage);
        else if (ext === '.md' || ext === '.markdown') parsed = parseMarkdown(file.path, content, file, filesByPath, localCoverage);
      } catch (error) {
        localCoverage.gaps.push(`${file.path}: parser error ${error.message}`);
      }
      const cacheValue = { parsed, unresolvedExternalPaths: localCoverage.unresolvedExternalPaths, gaps: localCoverage.gaps };
      cacheParsedResult(cacheKey, cacheValue);
      coverage.unresolvedExternalPaths.push(...localCoverage.unresolvedExternalPaths);
      coverage.gaps.push(...localCoverage.gaps);
    }
    nodes.push(...parsed.symbols);
    edges.push(...parsed.edges);
  }
  const uniqueExternal = Array.from(new Set(coverage.unresolvedExternalPaths));
  coverage.unresolvedExternalPaths = uniqueExternal.slice(0, 500);
  if (uniqueExternal.length > 500) coverage.gaps.push('Unresolved external paths were capped at 500 entries.');
  const index = {
    revision: Number(options.revision || 1),
    indexedAt: new Date().toISOString(),
    rootLabel: path.basename(rootReal),
    files,
    nodes,
    edges,
    coverage
  };
  return { index, contents };
}

class IndexStore {
  constructor(root, runtimeDirectory, onRefresh) {
    this.root = fs.realpathSync(root);
    this.runtimeDirectory = runtimeDirectory || path.join(this.root, '.intentgraph', 'runtime');
    this.indexPath = path.join(this.runtimeDirectory, 'index.json');
    this.diffsPath = path.join(this.runtimeDirectory, 'diffs.json');
    this.onRefresh = onRefresh;
    this.index = null;
    this.diffs = {};
    this.contents = new Map();
  }

  load() {
    try { this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); } catch { this.index = null; }
    try { this.diffs = JSON.parse(fs.readFileSync(this.diffsPath, 'utf8')); } catch { this.diffs = {}; }
    if (this.index && Array.isArray(this.index.files)) {
      for (const file of this.index.files) {
        try {
          const buffer = fs.readFileSync(path.join(this.root, file.path));
          // Do not claim a before version after downtime when the persisted
          // index hash no longer matches the real file. A missing before is
          // honest; inventing one from today's bytes would make a false diff.
          if (sha256(buffer) === file.hash) this.contents.set(file.path, buffer.toString('utf8'));
        } catch {}
      }
    }
    return this.index;
  }

  scan(meta = {}) {
    const nextRevision = this.index && Number.isInteger(this.index.revision) ? this.index.revision + 1 : 1;
    const built = buildIndex(this.root, { revision: nextRevision });
    const previousFiles = new Map((this.index && this.index.files || []).map((file) => [file.path, file]));
    const previousContents = this.contents;
    const nextContents = built.contents;
    const changedPaths = new Set();
    for (const file of built.index.files) {
      const previous = previousFiles.get(file.path);
      if (!previous || previous.hash !== file.hash) changedPaths.add(file.path);
    }
    for (const previous of previousFiles.values()) {
      if (!built.index.files.some((file) => file.path === previous.path)) changedPaths.add(previous.path);
    }
    if (this.index && changedPaths.size === 0) built.index.revision = this.index.revision;
    for (const relativePath of changedPaths) {
      const before = previousContents.has(relativePath) ? previousContents.get(relativePath) : null;
      const after = nextContents.has(relativePath) ? nextContents.get(relativePath) : null;
      this.diffs[relativePath] = { path: relativePath, before, after, revision: built.index.revision, changedAt: built.index.indexedAt };
    }
    const diffEntries = Object.entries(this.diffs).sort((a, b) => String(b[1].changedAt).localeCompare(String(a[1].changedAt))).slice(0, MAX_DIFFS);
    this.diffs = Object.fromEntries(diffEntries);
    this.index = built.index;
    this.contents = nextContents;
    atomicWrite(this.indexPath, this.index);
    atomicWrite(this.diffsPath, this.diffs);
    const result = { index: this.index, changedPaths: Array.from(changedPaths), reason: meta.reason || 'rescan' };
    if (this.onRefresh) this.onRefresh(result);
    return result;
  }

  getSource(relativePath) {
    const normalized = normalizeRelative(relativePath || '');
    const file = (this.index && this.index.files || []).find((item) => item.path === normalized);
    if (!file) throw new Error('source path is not indexed');
    if (!shouldIndexPath(normalized)) throw new Error('source path is not allowed');
    const absolute = path.resolve(this.root, normalized);
    if (!isInside(this.root, absolute)) throw new Error('source path escapes workspace');
    const real = fs.realpathSync(absolute);
    if (!isInside(this.root, real)) throw new Error('source path escapes workspace');
    const realRelative = normalizeRelative(path.relative(this.root, real));
    if (!shouldIndexPath(realRelative) || isIgnoredResolvedPath(realRelative)) throw new Error('source target is not allowed');
    const buffer = fs.readFileSync(real);
    if (buffer.length > MAX_FILE_BYTES) throw new Error('source exceeds size cap');
    return { path: normalized, content: buffer.toString('utf8'), hash: sha256(buffer) };
  }

  getDiff(relativePath) {
    const normalized = normalizeRelative(relativePath || '');
    return this.diffs[normalized] || { path: normalized, before: null, after: null };
  }
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_FILES,
  ALLOWED_EXTENSIONS,
  atomicWrite,
  buildIndex,
  clearParseCache,
  fileId,
  getParseCacheStats,
  isInside,
  isIgnoredResolvedPath,
  isSecretPath,
  normalizeRelative,
  shouldIndexPath,
  IndexStore,
  sha256
};
