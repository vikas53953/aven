'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = MAX_BODY_BYTES;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TOKEN_TTL_MS = 90_000;
const GIT_HEADER_ARGS = Object.freeze([
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=',
  '-c', 'credential.helper=',
  '-c', 'diff.external=',
  '-c', 'diff.trustExitCode=false',
]);

class GitWorkspaceError extends Error {
  constructor(message, code = 'git_workspace_error', statusCode = 400, extra = {}) {
    super(message);
    this.name = 'GitWorkspaceError';
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, extra);
  }
}

function fail(message, code, statusCode = 400, extra) {
  throw new GitWorkspaceError(message, code, statusCode, extra);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sameBytes(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left ?? ''));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function text(value, field, max = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${field} is required`, 'invalid_request');
  return value;
}

function optionalText(value, field, max = 240) {
  if (value === undefined || value === null || value === '') return '';
  return text(value, field, max);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizeGitPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail('Git path is invalid', 'invalid_path');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('-')) fail(`Git path is not supported: ${value}`, 'unsafe_path');
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail(`Git path is not canonical: ${value}`, 'unsafe_path');
  if (parts.includes('.git')) fail('Git metadata paths cannot be selected', 'unsafe_path');
  return normalized;
}

function validBranch(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(value) && !value.includes('..') && !value.includes('@{') && !value.endsWith('/') && !value.endsWith('.') && !value.includes('//');
}

function validRemoteName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

function parseRemote(value) {
  const raw = String(value || '').trim();
  let host = '';
  let owner = '';
  let repo = '';
  try {
    if (!/^https:\/\//i.test(raw)) return null;
    const parsed = new URL(raw);
    if (parsed.username || parsed.password) return null;
    host = parsed.hostname.toLowerCase();
    const pieces = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    owner = pieces[0] || '';
    repo = pieces[1] || '';
  } catch { return null; }
  repo = repo.replace(/\.git$/, '');
  if (!host || !owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { host, owner, repo, fullName: `${owner}/${repo}`, url: raw };
}

function createSpawnRunner({ executable, defaultTimeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = MAX_OUTPUT_BYTES } = {}) {
  return ({ args, cwd, env, input, timeoutMs = defaultTimeoutMs, signal }) => new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const abort = () => { aborted = true; child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    const collect = (bucket) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { child.kill(); return; }
      bucket.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); } });
    child.once('close', (code, terminationSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (aborted) { const error = new Error('Git command was cancelled'); error.code = 'ABORT_ERR'; reject(error); return; }
      if (timedOut) { const error = new Error('Git command timed out'); error.code = 'ETIMEDOUT'; reject(error); return; }
      if (bytes > maxOutputBytes) { const error = new Error('Git output exceeded the safety limit'); error.code = 'E2BIG'; reject(error); return; }
      resolve({ code: code ?? 1, signal: terminationSignal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (input !== undefined && input !== null) child.stdin.end(input); else child.stdin.end();
  });
}

function safeEnvironment(overrides = {}) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_') && !name.startsWith('SSH_')));
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_NOGLOBAL: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    ...overrides,
  };
}

async function readRealPath(value) {
  try { return await fsp.realpath(value); } catch (error) { fail('Repository path is unavailable', 'repository_unavailable', 404, { cause: error }); }
}

async function rejectSymlinkPath(value) {
  const absolute = path.resolve(value);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try { stat = await fsp.lstat(current); } catch (error) { if (error.code === 'ENOENT') break; fail('Repository path is unavailable', 'repository_unavailable', 404, { cause: error }); }
    if (stat.isSymbolicLink()) fail('Symlink repository paths are not supported', 'unsupported_repository', 409);
  }
}

function parseStatus(buffer) {
  const entries = [];
  const records = Buffer.from(buffer).toString('utf8').split('\0');
  for (const record of records) {
    if (!record) continue;
    const code = record.slice(0, 2);
    const rawPath = record.slice(3);
    let filePath;
    try { filePath = normalizeGitPath(rawPath); } catch { filePath = rawPath; }
    entries.push({ path: filePath, code, staged: code[0] !== ' ', worktree: code[1] !== ' ', untracked: code === '??', conflict: code.includes('U') });
  }
  return entries;
}

function unsupportedPatch(patch) {
  return /^(?:GIT binary patch|Binary files |old mode |new mode |(?:new|deleted) file mode (?:120000|160000)|similarity index |rename from |rename to |copy from |copy to )/m.test(patch);
}

function parseNulNames(buffer) {
  return Buffer.from(buffer).toString('utf8').split('\0').filter(Boolean).map(normalizeGitPath);
}

function parseNulRawNames(buffer) {
  return Buffer.from(buffer).toString('utf8').split('\0').filter(Boolean);
}

function assertSupportedIndexModes(buffer) {
  for (const record of Buffer.from(buffer).toString('utf8').split('\0')) {
    if (!record) continue;
    const match = record.match(/^(\d{6})\s+[0-9a-f]{40,64}\s+\d\t/);
    if (match && (match[1] === '120000' || match[1] === '160000')) fail('Symlink and submodule index entries are unsupported for reviewed Git actions', 'unsupported_repository', 409);
  }
}

function tokenPayload(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

class GitWorkspace {
  constructor(options = {}) {
    this.runtimeDirectory = path.resolve(options.runtimeDirectory || path.join(os.tmpdir(), 'aven-git-runtime'));
    fs.mkdirSync(this.runtimeDirectory, { recursive: true });
    this.configPath = path.resolve(options.configPath || path.join(this.runtimeDirectory, 'git-workspace.json'));
    this.gitPath = options.gitPath || process.env.AVEN_GIT_PATH || 'git';
    this.ghPath = options.ghPath || process.env.AVEN_GH_PATH || 'gh';
    this.runner = options.runner || createSpawnRunner({ executable: this.gitPath, defaultTimeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes });
    this.remoteRunner = options.remoteRunner || null;
    this.ghRunner = options.ghRunner || null;
    this.clock = options.clock || (() => Date.now());
    this.tokenTtlMs = Math.max(1_000, Math.min(Number(options.tokenTtlMs || DEFAULT_TOKEN_TTL_MS), 10 * 60_000));
    this.tokens = new Map();
    this.repoLocks = new Map();
    this.events = [];
  }

  _record(action, outcome, details = {}) {
    this.events.push({ at: new Date(this.clock()).toISOString(), action, outcome, ...details });
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  async _run(args, cwd, options = {}) {
    const result = await this.runner({
      executable: this.gitPath,
      args: [...GIT_HEADER_ARGS, ...args],
      cwd,
      env: safeEnvironment(options.env),
      input: options.input,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    if (result.code !== 0) {
      const detail = Buffer.from(result.stderr || '').toString('utf8').trim();
      fail(detail || `Git command failed: ${args[0]}`, options.code || 'git_command_failed', options.statusCode || 409, { gitArgs: args });
    }
    return Buffer.from(result.stdout || '');
  }

  async _tryRun(args, cwd, options = {}) {
    try { return { ok: true, stdout: await this._run(args, cwd, options) }; }
    catch (error) { return { ok: false, error }; }
  }

  async _identity(repoPath) {
    const requested = text(repoPath, 'Repository path', 1_000);
    if (!path.isAbsolute(requested)) fail('Repository path must be absolute', 'invalid_path');
    await rejectSymlinkPath(requested);
    const root = await readRealPath(requested);
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) fail('Repository path must be a directory', 'invalid_repository', 409);
    const dotGit = path.join(root, '.git');
    const dotGitStat = await fsp.lstat(dotGit).catch(() => null);
    if (!dotGitStat) fail('Directory is not a Git repository', 'not_git_repository', 409);
    if (dotGitStat.isSymbolicLink() || dotGitStat.isFile()) fail('Linked worktrees and submodules are not supported', 'unsupported_repository', 409);
    const top = (await this._run(['rev-parse', '--show-toplevel'], root, { code: 'not_git_repository' })).toString('utf8').trim();
    const gitDir = await readRealPath(path.resolve(root, (await this._run(['rev-parse', '--git-dir'], root)).toString('utf8').trim()));
    const commonDir = await readRealPath(path.resolve(root, (await this._run(['rev-parse', '--git-common-dir'], root)).toString('utf8').trim()));
    const inside = (await this._run(['rev-parse', '--is-inside-work-tree'], root)).toString('utf8').trim();
    const bare = (await this._run(['rev-parse', '--is-bare-repository'], root)).toString('utf8').trim();
    if (path.resolve(top) !== root || inside !== 'true' || bare !== 'false') fail('Only ordinary non-bare Git repositories are supported', 'unsupported_repository', 409);
    if (gitDir !== commonDir || path.basename(gitDir).toLowerCase() !== '.git') fail('Linked Git worktrees are not supported', 'unsupported_repository', 409);
    const headRefResult = await this._tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
    if (!headRefResult.ok) fail('Detached HEAD is not supported', 'detached_head', 409);
    const branch = headRefResult.stdout.toString('utf8').trim();
    if (!validBranch(branch)) fail('Current branch name is not supported', 'unsupported_branch', 409);
    const headResult = await this._tryRun(['rev-parse', '--verify', 'HEAD^{commit}'], root);
    if (!headResult.ok) fail('Unborn HEAD is not supported', 'unborn_head', 409);
    const headOid = headResult.stdout.toString('utf8').trim();
    const indexPath = await readRealPath(path.resolve(root, (await this._run(['rev-parse', '--git-path', 'index'], root)).toString('utf8').trim()));
    if (!isInside(gitDir, indexPath) || path.basename(indexPath) !== 'index') fail('Git index location is unsupported', 'unsupported_repository', 409);
    return { root, gitDir, commonDir, branch, headOid, indexPath };
  }

  async _status(identity) {
    const output = await this._run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], identity.root);
    return parseStatus(output);
  }

  async _diff(identity, staged, paths = []) {
    const args = ['diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index', '--no-color'];
    if (paths.length) args.push('--', ...paths);
    return this._run(args, identity.root);
  }

  async _snapshot(identity) {
    const status = await this._status(identity);
    const tracked = parseNulRawNames(await this._run(['ls-files', '-z', '--'], identity.root));
    const untracked = parseNulRawNames(await this._run(['ls-files', '--others', '--exclude-standard', '-z', '--'], identity.root));
    await this._assertNoFilters(identity, [...new Set([...tracked, ...untracked, ...status.map((entry) => entry.path)])]);
    const indexEntries = await this._run(['ls-files', '--stage', '-z', '--'], identity.root);
    assertSupportedIndexModes(indexEntries);
    const [fullWorktreePatch, fullStagedPatch] = await Promise.all([
      this._diff(identity, false),
      this._diff(identity, true),
    ]);
    if (fullWorktreePatch.length > MAX_BODY_BYTES || fullStagedPatch.length > MAX_BODY_BYTES) fail('Git diff exceeds the reviewed-patch safety limit', 'patch_too_large', 413);
    const rawIndex = await fsp.readFile(identity.indexPath);
    const currentHead = (await this._run(['rev-parse', '--verify', 'HEAD^{commit}'], identity.root)).toString('utf8').trim();
    const currentBranch = (await this._run(['symbolic-ref', '--quiet', '--short', 'HEAD'], identity.root)).toString('utf8').trim();
    return {
      identity: { ...identity, headOid: currentHead, branch: currentBranch },
      status,
      indexDigest: sha256(rawIndex),
      worktreeDigest: sha256(fullWorktreePatch),
      stagedDigest: sha256(fullStagedPatch),
      worktreePatch: fullWorktreePatch,
      stagedPatch: fullStagedPatch,
    };
  }

  async _current(repoPath) {
    return this._snapshot(await this._identity(repoPath));
  }

  _configured() {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(raw);
      if (!config || config.version !== 1 || typeof config.repoPath !== 'string' || !path.isAbsolute(config.repoPath)) return null;
      return config;
    } catch { return null; }
  }

  async _saveConfig(config) {
    const temp = `${this.configPath}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temp, this.configPath);
  }

  _publicSnapshot(snapshot, config) {
    return {
      configured: true,
      state: 'ready',
      repository: { path: snapshot.identity.root, branch: snapshot.identity.branch, head: snapshot.identity.headOid },
      status: { clean: snapshot.status.length === 0, entries: snapshot.status.map((entry) => ({ path: entry.path, code: entry.code, staged: entry.staged, worktree: entry.worktree, untracked: entry.untracked, conflict: entry.conflict })) },
      remote: config?.remote || null,
      capabilities: { stage: true, unstage: true, commit: true, pullRequestReview: true, pullRequestPublish: true, push: false },
    };
  }

  async configure({ repoPath, remoteName = 'origin', baseRef = 'main' } = {}) {
    const snapshot = await this._current(repoPath);
    if (!validBranch(baseRef)) fail('Base branch is invalid', 'invalid_ref');
    if (!validRemoteName(remoteName)) fail('Remote name is invalid', 'invalid_ref');
    const remoteResult = await this._tryRun(['remote', 'get-url', remoteName], snapshot.identity.root);
    const remote = remoteResult.ok ? parseRemote(remoteResult.stdout.toString('utf8').trim()) : null;
    const config = { version: 1, repoPath: snapshot.identity.root, remoteName: text(remoteName, 'Remote name', 80), baseRef, remote: remote ? { host: remote.host, owner: remote.owner, repo: remote.repo } : null };
    await this._saveConfig(config);
    this._record('configure', 'success', { repository: snapshot.identity.root });
    return this._publicSnapshot(snapshot, config);
  }

  async status() {
    const config = this._configured();
    if (!config) return { configured: false, state: 'unconfigured', reason: 'Choose an ordinary local Git repository in Settings.' };
    try {
      const snapshot = await this._current(config.repoPath);
      return this._publicSnapshot(snapshot, config);
    } catch (error) {
      return { configured: true, state: 'unavailable', repository: { path: config.repoPath }, reason: error.message || 'Repository is unavailable.', code: error.code || 'repository_unavailable' };
    }
  }

  async _pathsFor(snapshot, requested) {
    const paths = Array.isArray(requested) && requested.length ? requested.map((value) => normalizeGitPath(value)) : snapshot.status.map((entry) => entry.path);
    const known = new Set(snapshot.status.map((entry) => entry.path));
    for (const selected of paths) {
      if (!known.has(selected)) fail(`Path is not currently changed: ${selected}`, 'stale_review', 409);
      const fullPath = path.resolve(snapshot.identity.root, selected);
      if (!isInside(snapshot.identity.root, fullPath)) fail('Selected path leaves the repository', 'unsafe_path');
      const stat = await fsp.lstat(fullPath).catch(() => null);
      if (stat?.isSymbolicLink()) fail(`Symlink paths cannot be selected: ${selected}`, 'unsafe_path', 409);
    }
    return [...new Set(paths)].sort();
  }

  async _assertNoFilters(identityOrSnapshot, paths) {
    const identity = identityOrSnapshot.identity || identityOrSnapshot;
    const selected = [...new Set(paths)].filter((value) => typeof value === 'string' && value);
    for (let offset = 0; offset < selected.length; offset += 256) {
      const output = await this._run(['check-attr', 'filter', '--', ...selected.slice(offset, offset + 256)], identity.root);
      for (const line of output.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const match = line.match(/: filter: (.+)$/);
        if (match && match[1] !== 'unspecified' && match[1] !== 'unset') fail('Git filter attributes are unsupported for reviewed patches', 'unsupported_filter', 409);
      }
    }
  }

  async review({ action, paths } = {}) {
    if (!['stage', 'unstage'].includes(action)) fail('Review action must be stage or unstage', 'invalid_action');
    const config = this._configured();
    if (!config) fail('Configure a repository first', 'unconfigured', 409);
    const snapshot = await this._current(config.repoPath);
    const selected = await this._pathsFor(snapshot, paths);
    const entries = snapshot.status.filter((entry) => selected.includes(entry.path));
    if (entries.some((entry) => entry.untracked || entry.conflict || entry.code.includes('R') || entry.code.includes('C'))) fail('Untracked, conflict, rename, and copy patches are unsupported in this review', 'unsupported_patch', 409);
    await this._assertNoFilters(snapshot, selected);
    const patch = await this._diff(snapshot.identity, action === 'unstage', selected);
    if (!patch.length) fail(`There is no ${action === 'stage' ? 'unstaged' : 'staged'} patch for the selected paths`, 'empty_patch', 409);
    const patchText = patch.toString('utf8');
    if (unsupportedPatch(patchText)) fail('Binary, mode, rename, and copy patches are unsupported in reviewed Git actions', 'unsupported_patch', 409);
    const payload = { repository: snapshot.identity.root, branch: snapshot.identity.branch, headOid: snapshot.identity.headOid, indexDigest: snapshot.indexDigest, worktreeDigest: snapshot.worktreeDigest, stagedDigest: snapshot.stagedDigest, action, paths: selected, patchDigest: sha256(patch) };
    const token = this._issueToken('patch', payload);
    this._record('review', 'success', { action, paths: selected });
    return { action, files: selected, patch: patchText, allSelectedHunks: true, token: token.value, expiresAt: token.expiresAt, repository: snapshot.identity.root, branch: snapshot.identity.branch, head: snapshot.identity.headOid, disclosure: 'The full canonical patch is shown. Applying it updates a private copy of the Git index and never edits the worktree.' };
  }

  _issueToken(kind, payload) {
    const value = crypto.randomBytes(32).toString('base64url');
    const expiresAt = this.clock() + this.tokenTtlMs;
    this.tokens.set(value, { kind, expiresAt, digest: tokenPayload(payload), payload });
    return { value, expiresAt };
  }

  _consumeToken(value, kind, payload) {
    if (typeof value !== 'string' || !value) fail('A reviewed one-use token is required', 'review_required', 409);
    const record = this.tokens.get(value);
    this.tokens.delete(value);
    if (!record || record.kind !== kind) { this._record('mutation', 'rejected', { reason: 'missing-or-replayed-token' }); fail('The review token is invalid, expired, or already used', 'stale_review', 409); }
    if (record.expiresAt <= this.clock()) { this._record('mutation', 'rejected', { reason: 'expired-token' }); fail('The review token expired; review the current repository again', 'expired_review', 409); }
    if (record.digest !== tokenPayload(payload)) { this._record('mutation', 'rejected', { reason: 'changed-review-payload' }); fail('The reviewed patch no longer matches the requested action', 'stale_review', 409); }
    return record.payload;
  }

  async _withRepositoryLock(repository, operation) {
    const prior = this.repoLocks.get(repository) || Promise.resolve();
    const current = prior.catch(() => undefined).then(operation);
    const tracked = current.then((value) => { if (this.repoLocks.get(repository) === tracked) this.repoLocks.delete(repository); return value; }, (error) => { if (this.repoLocks.get(repository) === tracked) this.repoLocks.delete(repository); return undefined; });
    this.repoLocks.set(repository, tracked);
    return current;
  }

  async _acquireIndexLock(identity) {
    const lockPath = path.join(identity.gitDir, 'index.lock');
    try { return { lockPath, handle: await fsp.open(lockPath, 'wx') }; }
    catch (error) { if (error.code === 'EEXIST') fail('Git is busy with another index operation; retry after it finishes', 'index_busy', 409); throw error; }
  }

  async _matchesPayload(config, payload, expectedPatch) {
    const current = await this._current(config.repoPath);
    const actual = { repository: current.identity.root, branch: current.identity.branch, headOid: current.identity.headOid, indexDigest: current.indexDigest, worktreeDigest: current.worktreeDigest, stagedDigest: current.stagedDigest, action: payload.action, paths: payload.paths, patchDigest: sha256(expectedPatch) };
    if (tokenPayload(actual) !== tokenPayload(payload)) fail('The repository changed after review; review again before applying', 'stale_review', 409);
    return current;
  }

  async _installIndex(lockPath, indexPath, candidateBytes) {
    const lockFile = await fsp.open(lockPath, 'r+');
    await lockFile.truncate(0);
    await lockFile.write(candidateBytes, 0, candidateBytes.length, 0);
    await lockFile.sync();
    await lockFile.close();
    if (process.platform !== 'win32') { await fsp.rename(lockPath, indexPath); return; }
    const backup = `${indexPath}.aven-backup-${crypto.randomUUID()}`;
    await fsp.rename(indexPath, backup);
    try {
      await fsp.rename(lockPath, indexPath);
      await fsp.unlink(backup);
    } catch (error) {
      await fsp.rename(backup, indexPath).catch(() => undefined);
      throw error;
    }
  }

  async apply({ token, action, patch } = {}) {
    const config = this._configured();
    if (!config) fail('Configure a repository first', 'unconfigured', 409);
    if (!['stage', 'unstage'].includes(action) || typeof patch !== 'string') fail('A reviewed patch action is required', 'invalid_request');
    const patchBytes = Buffer.from(patch, 'utf8');
    const record = this.tokens.get(token);
    if (!record) return this._consumeToken(token, 'patch', {});
    const payload = record.payload;
    this._consumeToken(token, 'patch', { ...payload, action, patchDigest: sha256(patchBytes) });
    return this._withRepositoryLock(config.repoPath, async () => {
      let lock;
      let tempDirectory;
      let installed = false;
      try {
        const current = await this._matchesPayload(config, payload, patchBytes);
        lock = await this._acquireIndexLock(current.identity);
        const checked = await this._matchesPayload(config, payload, patchBytes);
        tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aven-private-index-'));
        const privateIndex = path.join(tempDirectory, 'index');
        await fsp.copyFile(current.identity.indexPath, privateIndex);
        const applyArgs = ['apply', '--cached', '--binary', '--recount', '--whitespace=nowarn'];
        if (action === 'unstage') applyArgs.push('--reverse');
        await this._run(applyArgs, checked.identity.root, { input: patchBytes, env: { GIT_INDEX_FILE: privateIndex } });
        const candidateBytes = await fsp.readFile(privateIndex);
        await this._matchesPayload(config, payload, patchBytes);
        await this._installIndex(lock.lockPath, current.identity.indexPath, candidateBytes);
        installed = true;
        this._record(action, 'success', { repository: current.identity.root, paths: payload.paths });
        return { state: 'success', action, files: payload.paths, worktreeChanged: false, indexUpdated: true, disclosure: 'The worktree was not changed. Git hooks, filters, credential helpers, and external diff tools were disabled or rejected.' };
      } catch (error) {
        this._record(action, 'rejected', { reason: error.code || error.message });
        throw error;
      } finally {
        if (lock?.handle) await lock.handle.close().catch(() => undefined);
        if (lock && !installed) await fsp.unlink(lock.lockPath).catch(() => undefined);
        if (tempDirectory) await fsp.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  async commitReview({ message } = {}) {
    const config = this._configured();
    if (!config) fail('Configure a repository first', 'unconfigured', 409);
    const commitMessage = text(message, 'Commit message', 10_000).replace(/\r\n/g, '\n');
    const snapshot = await this._current(config.repoPath);
    if (!snapshot.stagedPatch.length) fail('There are no staged changes to commit', 'empty_commit', 409);
    const files = parseNulNames(await this._run(['diff', '--cached', '--name-only', '-z', '--no-renames', '--'], snapshot.identity.root));
    if (unsupportedPatch(snapshot.stagedPatch.toString('utf8'))) fail('Binary, mode, rename, and copy commits are unsupported', 'unsupported_patch', 409);
    const payload = { repository: snapshot.identity.root, branch: snapshot.identity.branch, headOid: snapshot.identity.headOid, indexDigest: snapshot.indexDigest, worktreeDigest: snapshot.worktreeDigest, stagedDigest: snapshot.stagedDigest, message: commitMessage };
    const issued = this._issueToken('commit', payload);
    return { token: issued.value, expiresAt: issued.expiresAt, message: commitMessage, files, stagedDiff: snapshot.stagedPatch.toString('utf8'), branch: snapshot.identity.branch, parent: snapshot.identity.headOid, worktreeChanged: false, disclosure: 'Commit preview shows the entire staged diff. Commit uses write-tree and commit-tree with no signing or hooks, then CAS-updates the current symbolic branch.' };
  }

  async commit({ token, message } = {}) {
    const config = this._configured();
    if (!config) fail('Configure a repository first', 'unconfigured', 409);
    const record = this.tokens.get(token);
    const payload = record?.payload;
    this._consumeToken(token, 'commit', payload || {});
    if (typeof message !== 'string' || message.replace(/\r\n/g, '\n') !== payload.message) fail('Commit message does not match the reviewed preview', 'stale_review', 409);
    return this._withRepositoryLock(config.repoPath, async () => {
      let lock;
      let tempDirectory;
      try {
        const current = await this._current(config.repoPath);
        const nowPayload = { repository: current.identity.root, branch: current.identity.branch, headOid: current.identity.headOid, indexDigest: current.indexDigest, worktreeDigest: current.worktreeDigest, stagedDigest: current.stagedDigest, message: payload.message };
        if (tokenPayload(nowPayload) !== tokenPayload(payload)) fail('The repository changed after commit review; preview it again', 'stale_review', 409);
        lock = await this._acquireIndexLock(current.identity);
        const checked = await this._current(config.repoPath);
        if (tokenPayload({ repository: checked.identity.root, branch: checked.identity.branch, headOid: checked.identity.headOid, indexDigest: checked.indexDigest, worktreeDigest: checked.worktreeDigest, stagedDigest: checked.stagedDigest, message: payload.message }) !== tokenPayload(payload)) fail('The repository changed during commit review', 'stale_review', 409);
        tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aven-private-commit-index-'));
        const privateIndex = path.join(tempDirectory, 'index');
        await fsp.copyFile(checked.identity.indexPath, privateIndex);
        const tree = (await this._run(['write-tree'], checked.identity.root, { env: { GIT_INDEX_FILE: privateIndex } })).toString('utf8').trim();
        let commitOid;
        try {
          commitOid = (await this._run(['commit-tree', tree, '-p', checked.identity.headOid, '--no-gpg-sign', '-m', payload.message], checked.identity.root)).toString('utf8').trim();
        } catch (error) {
          error.orphanObject = true;
          throw error;
        }
        const ref = `refs/heads/${checked.identity.branch}`;
        try {
          await this._run(['update-ref', '-m', 'Aven reviewed commit', ref, commitOid, checked.identity.headOid], checked.identity.root);
        } catch (error) {
          error.commitOid = commitOid;
          if (['ABORT_ERR', 'ETIMEDOUT', 'E2BIG'].includes(error.code)) {
            error.unknown = true;
            error.retry = false;
            error.orphanObject = false;
            this._record('commit', 'unknown', { reason: 'branch-update-unverified', commitOid });
          } else {
            error.orphanObject = true;
            this._record('commit', 'unknown', { reason: 'branch-update-conflict', commitOid });
          }
          throw error;
        }
        let after;
        try {
          after = await this._current(config.repoPath);
        } catch (error) {
          const unknown = new GitWorkspaceError('Commit was created but its final repository state could not be verified. Do not retry automatically.', 'unknown', 503, { unknown: true, retry: false, cause: error });
          unknown.commitOid = commitOid;
          unknown.orphanObject = false;
          this._record('commit', 'unknown', { reason: 'post-update-state-unverified', commitOid });
          throw unknown;
        }
        const worktreeChanged = after.worktreeDigest !== checked.worktreeDigest;
        const branchChanged = after.identity.branch !== checked.identity.branch || after.identity.headOid !== commitOid;
        if (worktreeChanged || branchChanged || after.indexDigest !== checked.indexDigest) {
          this._record('commit', 'unknown', { reason: 'post-update-state-changed', commitOid });
          return { state: 'unknown', commitOid, orphanObject: false, worktreeChanged, indexChanged: after.indexDigest !== checked.indexDigest, branchChanged, retry: false };
        }
        this._record('commit', 'success', { repository: checked.identity.root, commitOid });
        return { state: 'success', commitOid, branch: checked.identity.branch, parent: checked.identity.headOid, worktreeChanged: false, indexChanged: false, hooks: 'not run', signing: 'disabled', retry: false };
      } finally {
        if (lock?.handle) await lock.handle.close().catch(() => undefined);
        if (lock) await fsp.unlink(lock.lockPath).catch(() => undefined);
        if (tempDirectory) await fsp.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  async _remoteSnapshot(identity, config, head, base, options = {}) {
    const remoteName = config.remoteName || 'origin';
    if (!validRemoteName(remoteName)) fail('The configured remote name is invalid', 'pr_unavailable', 409);
    const transportConfig = await this._tryRun(['config', '--local', '--get-regexp', '^(core\.(sshcommand|gitproxy)|https?\.proxy|url\..*\.insteadof|remote\..*\.(uploadpack|receivepack))$'], identity.root);
    if (transportConfig.ok && transportConfig.stdout.toString('utf8').trim()) fail('Configured Git transport helpers and URL rewrites are unsupported for pull-request publishing', 'pr_unavailable', 409);
    const remoteResult = await this._tryRun(['remote', 'get-url', remoteName], identity.root);
    if (!remoteResult.ok) fail('A configured remote is required before pull-request review', 'pr_unavailable', 409);
    const remote = parseRemote(remoteResult.stdout.toString('utf8').trim());
    if (!remote) fail('The configured remote host and repository could not be verified', 'pr_unavailable', 409);
    const expected = config.remote;
    if (!expected || expected.host !== remote.host || expected.owner !== remote.owner || expected.repo !== remote.repo) fail('The configured remote host and repository no longer match', 'pr_unavailable', 409);
    if (!validBranch(head) || !validBranch(base)) fail('Pull-request refs must be simple local branch names', 'invalid_ref');
    const headOid = (await this._run(['rev-parse', '--verify', `refs/heads/${head}^{commit}`], identity.root, { code: 'pr_unavailable' })).toString('utf8').trim();
    const baseResult = await this._tryRun(['rev-parse', '--verify', `refs/heads/${base}^{commit}`], identity.root);
    if (!baseResult.ok) fail(`Base branch ${base} is not available locally`, 'pr_unavailable', 409);
    const upstreamResult = await this._tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${head}@{upstream}`], identity.root);
    if (!upstreamResult.ok) fail('The head branch has no upstream; pull-request publishing is unavailable', 'pr_unavailable', 409);
    const upstream = upstreamResult.stdout.toString('utf8').trim();
    const counts = (await this._run(['rev-list', '--left-right', '--count', `refs/heads/${head}...${upstream}`], identity.root)).toString('utf8').trim().split(/\s+/).map(Number);
    const ahead = Number(counts[0] || 0);
    const behind = Number(counts[1] || 0);
    if (ahead !== 0 || behind !== 0) fail('The local head is ahead, behind, or diverged from its configured upstream', 'pr_unavailable', 409);
    const payload = { repository: identity.root, branch: identity.branch, head, base, headOid, baseOid: baseResult.stdout.toString('utf8').trim(), remote: { host: remote.host, owner: remote.owner, repo: remote.repo }, title: options.title, body: options.body };
    return { remote, headOid, baseOid: payload.baseOid, upstream, ahead, behind, payload };
  }

  async prReview({ head, base, title, body } = {}) {
    const config = this._configured();
    if (!config) fail('Configure a repository first', 'unconfigured', 409);
    const snapshot = await this._current(config.repoPath);
    const selectedHead = head || snapshot.identity.branch;
    const selectedBase = base || config.baseRef || 'main';
    if (selectedHead !== snapshot.identity.branch) fail('Pull-request head must be the current symbolic branch', 'pr_unavailable', 409);
    const prTitle = text(title, 'Pull-request title', 300);
    const prBody = optionalText(body, 'Pull-request body', 20_000);
    const remote = await this._remoteSnapshot(snapshot.identity, config, selectedHead, selectedBase, { title: prTitle, body: prBody });
    const issued = this._issueToken('pr-publish', remote.payload);
    return { available: true, token: issued.value, expiresAt: issued.expiresAt, remote: { host: remote.remote.host, repository: remote.remote.fullName }, head: { ref: selectedHead, oid: remote.headOid }, base: { ref: selectedBase, oid: remote.baseOid }, upstream: remote.upstream, ahead: remote.ahead, behind: remote.behind, title: prTitle, body: prBody, canPublish: true, pushed: false, disclosure: 'Review is local and read-only. Publish performs an exact remote OID preflight and invokes gh only after explicit confirmation; it never pushes.' };
  }

  async _remoteRef(remote, ref, identity, signal) {
    if (this.remoteRunner) {
      const value = await this.remoteRunner({ remoteUrl: remote.url, host: remote.host, repository: remote.fullName, ref, cwd: identity.root, signal });
      if (value && typeof value === 'object') return String(value.oid || value.headOid || value.stdout || '').trim().toLowerCase() || null;
      return String(value || '').trim().toLowerCase() || null;
    }
    const result = await this._run(['ls-remote', '--heads', remote.url, ref], identity.root, { signal });
    const line = result.toString('utf8').trim().split(/\r?\n/).find(Boolean);
    if (!line) return null;
    const [oid] = line.split(/\s+/);
    return /^[0-9a-f]{40}$/i.test(oid) ? oid.toLowerCase() : null;
  }

  async prPublish({ token, signal } = {}) {
    const record = this.tokens.get(token);
    const payload = record?.payload;
    this._consumeToken(token, 'pr-publish', payload || {});
    const config = this._configured();
    if (!config) fail('Configure a repository first', 'unconfigured', 409);
    return this._withRepositoryLock(config.repoPath, async () => {
      let tempBody;
      try {
        const snapshot = await this._current(config.repoPath);
        if (snapshot.identity.root !== payload.repository || snapshot.identity.branch !== payload.branch) fail('The repository or symbolic branch changed after pull-request review', 'stale_review', 409);
        const remote = await this._remoteSnapshot(snapshot.identity, config, payload.head, payload.base, { title: payload.title, body: payload.body });
        if (remote.headOid !== payload.headOid) fail('The local head changed after pull-request review', 'stale_review', 409);
        const remoteHead = await this._remoteRef(remote.remote, `refs/heads/${payload.head}`, snapshot.identity, signal);
        if (!remoteHead || remoteHead !== payload.headOid.toLowerCase()) fail('Remote head does not exactly match the reviewed local head; publishing is unavailable', 'remote_mismatch', 409);
        const remoteBase = await this._remoteRef(remote.remote, `refs/heads/${payload.base}`, snapshot.identity, signal);
        if (!remoteBase || remoteBase !== payload.baseOid.toLowerCase()) fail('Remote base ref does not exactly match the reviewed base; publishing is unavailable', 'remote_mismatch', 409);
        tempBody = path.join(os.tmpdir(), `aven-pr-${crypto.randomUUID()}.md`);
        await fsp.writeFile(tempBody, payload.body || '', { encoding: 'utf8', mode: 0o600 });
        const args = ['pr', 'create', '--repo', remote.remote.fullName, '--head', payload.head, '--base', payload.base, '--title', payload.title, '--body-file', tempBody];
        const env = safeEnvironment({ GH_PROMPT_DISABLED: '1', CI: '1', ...(remote.remote.host !== 'github.com' ? { GH_HOST: remote.remote.host } : {}) });
        const result = this.ghRunner ? await this.ghRunner({ executable: this.ghPath, args, cwd: snapshot.identity.root, env, signal, remote: remote.remote }) : await new Promise((resolve, reject) => {
          const runner = createSpawnRunner({ executable: this.ghPath, defaultTimeoutMs: DEFAULT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES });
          runner({ args, cwd: snapshot.identity.root, env, signal }).then(resolve, reject);
        });
        if (result.code !== undefined && result.code !== 0) fail(Buffer.from(result.stderr || '').toString('utf8').trim() || 'gh could not create the pull request', 'pr_publish_failed', 502);
        this._record('pr-publish', 'success', { repository: remote.remote.fullName });
        return { state: 'success', url: Buffer.from(result.stdout || '').toString('utf8').trim(), pushed: false, ghCalled: true, remoteHead, remoteBase };
      } catch (error) {
        if (error.code === 'ABORT_ERR' || error.code === 'ETIMEDOUT') { this._record('pr-publish', 'unknown', { reason: error.code }); fail('Pull-request publish outcome is unknown after cancellation or timeout. Do not retry automatically.', 'unknown', 503, { unknown: true, retry: false }); }
        this._record('pr-publish', 'rejected', { reason: error.code || error.message, ghCalled: false });
        throw error;
      } finally { if (tempBody) await fsp.unlink(tempBody).catch(() => undefined); }
    });
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => { total += chunk.length; if (total > MAX_BODY_BYTES) { reject(new GitWorkspaceError('Request body exceeds the safety limit', 'request_too_large', 413)); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => { try { const raw = Buffer.concat(chunks).toString('utf8'); resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new GitWorkspaceError('Request body must be valid JSON', 'invalid_request', 400)); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function createGitWorkspaceApi({ workspace, origin = 'http://127.0.0.1:8767' } = {}) {
  if (!workspace) throw new Error('Git workspace is required');
  return {
    async handle(req, res) {
      const parsed = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (!parsed.pathname.startsWith('/api/git')) return false;
      const requestOrigin = req.headers.origin;
      if (requestOrigin !== origin) { sendJson(res, 403, { error: 'origin_not_allowed', reasons: ['Git workspace requests require the exact local Aven origin.'] }); return true; }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Git, Content-Type'); res.writeHead(204); res.end(); return true; }
      if (req.headers['x-aven-git'] !== 'workspace-v1') { sendJson(res, 403, { error: 'git_header_required', reasons: ['Git workspace request header required.'] }); return true; }
      try {
        let result;
        if (parsed.pathname === '/api/git/status' && req.method === 'GET') result = await workspace.status();
        else {
          if (req.method !== 'POST') { sendJson(res, 405, { error: 'method_not_allowed', reasons: ['Method not allowed.'] }); return true; }
          const body = await parseBody(req);
          if (parsed.pathname === '/api/git/configure') result = await workspace.configure(body);
          else if (parsed.pathname === '/api/git/review') result = await workspace.review(body);
          else if (parsed.pathname === '/api/git/apply') result = await workspace.apply(body);
          else if (parsed.pathname === '/api/git/commit/review') result = await workspace.commitReview(body);
          else if (parsed.pathname === '/api/git/commit') result = await workspace.commit(body);
          else if (parsed.pathname === '/api/git/pr/review') result = await workspace.prReview(body);
          else if (parsed.pathname === '/api/git/pr/publish') {
            const controller = new AbortController();
            const cancel = () => controller.abort();
            req.once('close', cancel);
            try { result = await workspace.prPublish({ ...body, signal: controller.signal }); }
            finally { req.removeListener('close', cancel); }
          }
          else { sendJson(res, 404, { error: 'route_not_found', reasons: ['Git workspace route not found.'] }); return true; }
        }
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendJson(res, error.statusCode || 400, { error: error.code || error.message || 'git_workspace_error', reasons: [error.message || 'Git workspace request failed.'], ...(error.unknown ? { unknown: true, retry: false } : {}), ...(error.commitOid ? { commitOid: error.commitOid } : {}), ...(error.orphanObject !== undefined ? { orphanObject: error.orphanObject } : {}) });
      }
      return true;
    },
  };
}

function createGitWorkspace(options) { return new GitWorkspace(options); }

module.exports = { GitWorkspace, GitWorkspaceError, createGitWorkspace, createGitWorkspaceApi, createSpawnRunner, normalizeGitPath, parseRemote, parseStatus, sha256, assertSupportedIndexModes, unsupportedPatch };
