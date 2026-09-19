'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { createGitWorkspace, createGitWorkspaceApi, parseRemote, assertSupportedIndexModes, unsupportedPatch, normalizeGitPath } = require('./git-workspace.cjs');

const gitPath = process.env.AVEN_GIT_PATH || 'C:\\Users\\vikasmit\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\git\\cmd\\git.exe';

function git(cwd, args) {
  return execFileSync(gitPath, args, { cwd, shell: false, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_NOGLOBAL: '1' } }).trim();
}

async function repo() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aven-git-workspace-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Aven Test']);
  git(root, ['config', 'user.email', 'aven@example.test']);
  await fsp.writeFile(path.join(root, 'network.txt'), 'line one\nline two\nline three\nline four\n');
  git(root, ['add', '--', 'network.txt']);
  git(root, ['commit', '-m', 'initial']);
  return root;
}

async function dispose(root) { await fsp.rm(root, { recursive: true, force: true }); }

function workspace(root, extra = {}) {
  return createGitWorkspace({ runtimeDirectory: path.join(os.tmpdir(), `aven-git-runtime-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`), gitPath, ...extra });
}

test('reviewed stage and unstage update only a private-index result', async () => {
  const root = await repo();
  try {
    const before = await fsp.readFile(path.join(root, 'network.txt'));
    await fsp.writeFile(path.join(root, 'network.txt'), 'line one changed\nline two\nline three changed\nline four\n');
    const worktree = await fsp.readFile(path.join(root, 'network.txt'));
    const service = workspace(root);
    const configured = await service.configure({ repoPath: root, baseRef: 'main' });
    assert.equal(configured.repository.branch, 'main');
    assert.equal(configured.status.clean, false);
    const review = await service.review({ action: 'stage', paths: ['network.txt'] });
    assert.equal(review.allSelectedHunks, true);
    assert.match(review.patch, /line one changed/);
    assert.match(review.patch, /line three changed/);
    const result = await service.apply({ token: review.token, action: 'stage', patch: review.patch });
    assert.equal(result.worktreeChanged, false);
    assert.deepEqual(await fsp.readFile(path.join(root, 'network.txt')), worktree);
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--']), 'network.txt');
    assert.equal(git(root, ['diff', '--name-only', '--']), '');
    assert.notDeepEqual(await fsp.readFile(path.join(root, 'network.txt')), before);
    const unstage = await service.review({ action: 'unstage', paths: ['network.txt'] });
    await service.apply({ token: unstage.token, action: 'unstage', patch: unstage.patch });
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--']), '');
    assert.equal(git(root, ['diff', '--name-only', '--']), 'network.txt');
  } finally { await dispose(root); }
});

test('commit preview and commit-tree preserve worktree and bypass hooks', async () => {
  const root = await repo();
  try {
    await fsp.writeFile(path.join(root, 'network.txt'), 'line one changed\nline two\nline three\nline four\n');
    const marker = path.join(root, 'hook-ran.marker');
    const hook = path.join(root, '.git', 'pre-commit');
    await fsp.writeFile(hook, `#! /bin/sh\necho hook > "${marker.replaceAll('\\', '/')}"\nexit 1\n`);
    if (process.platform !== 'win32') fs.chmodSync(hook, 0o755);
    const service = workspace(root);
    await service.configure({ repoPath: root, baseRef: 'main' });
    const stage = await service.review({ action: 'stage', paths: ['network.txt'] });
    await service.apply({ token: stage.token, action: 'stage', patch: stage.patch });
    const worktree = await fsp.readFile(path.join(root, 'network.txt'));
    const preview = await service.commitReview({ message: 'reviewed network change' });
    assert.match(preview.stagedDiff, /line one changed/);
    const result = await service.commit({ token: preview.token, message: preview.message });
    assert.equal(result.state, 'success');
    assert.equal(result.hooks, 'not run');
    assert.equal(result.signing, 'disabled');
    assert.deepEqual(await fsp.readFile(path.join(root, 'network.txt')), worktree);
    assert.equal(git(root, ['status', '--porcelain']), '');
    assert.equal(fs.existsSync(marker), false);
  } finally { await dispose(root); }
});

test('stale, replayed, expired, and concurrent reviews fail closed before mutation', async () => {
  const root = await repo();
  try {
    let now = Date.now();
    await fsp.writeFile(path.join(root, 'network.txt'), 'changed once\nline two\nline three\nline four\n');
    const service = workspace(root, { tokenTtlMs: 1_000, clock: () => now });
    await service.configure({ repoPath: root, baseRef: 'main' });
    const stale = await service.review({ action: 'stage', paths: ['network.txt'] });
    await fsp.writeFile(path.join(root, 'network.txt'), 'changed twice\nline two\nline three\nline four\n');
    await assert.rejects(() => service.apply({ token: stale.token, action: 'stage', patch: stale.patch }), (error) => error.code === 'stale_review');
    const fresh = await service.review({ action: 'stage', paths: ['network.txt'] });
    await service.apply({ token: fresh.token, action: 'stage', patch: fresh.patch });
    await assert.rejects(() => service.apply({ token: fresh.token, action: 'stage', patch: fresh.patch }), (error) => error.code === 'stale_review');
    const unstage = await service.review({ action: 'unstage', paths: ['network.txt'] });
    now += 1_001;
    await assert.rejects(() => service.apply({ token: unstage.token, action: 'unstage', patch: unstage.patch }), (error) => error.code === 'expired_review');
    await fsp.writeFile(path.join(root, 'network.txt'), 'changed three times\nline two\nline three\nline four\n');
    const concurrent = await service.review({ action: 'stage', paths: ['network.txt'] });
    git(root, ['commit', '-m', 'outside movement', '--allow-empty']);
    await assert.rejects(() => service.apply({ token: concurrent.token, action: 'stage', patch: concurrent.patch }), (error) => error.code === 'stale_review');
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--']), '');
    assert.equal(git(root, ['diff', '--name-only', '--']), 'network.txt');
  } finally { await dispose(root); }
});

test('filters, unsafe names, and unsupported repository identities are explicit', async () => {
  const root = await repo();
  try {
    const marker = path.join(root, 'filter-ran.marker');
    await fsp.writeFile(path.join(root, '.gitattributes'), 'danger.txt filter=secret\n');
    await fsp.writeFile(path.join(root, 'danger.txt'), 'safe\n');
    git(root, ['add', '--', '.gitattributes', 'danger.txt']);
    git(root, ['commit', '-m', 'filter fixture']);
    await fsp.writeFile(path.join(root, 'danger.txt'), 'unsafe\n');
    git(root, ['config', 'filter.secret.clean', `node -e "require('fs').writeFileSync('${marker.replaceAll('\\', '/')}', 'ran')"`]);
    git(root, ['config', 'filter.secret.process', `node -e "require('fs').writeFileSync('${marker.replaceAll('\\', '/')}', 'ran-process')"`]);
    const service = workspace(root);
    await assert.rejects(() => service.configure({ repoPath: root, baseRef: 'main' }), (error) => error.code === 'unsupported_filter');
    assert.equal(fs.existsSync(marker), false);
    assert.equal((await service.status()).state, 'unconfigured');
    assert.throws(() => normalizeGitPath('-danger.txt'), (error) => error.code === 'unsafe_path');
    const nonRepo = await fsp.mkdtemp(path.join(os.tmpdir(), 'aven-not-git-'));
    try { await assert.rejects(() => workspace(nonRepo).configure({ repoPath: nonRepo }), (error) => error.code === 'not_git_repository'); } finally { await dispose(nonRepo); }
  } finally { await dispose(root); }
});

test('index modes and patch markers reject symlink and gitlink state', () => {
  const oid = 'a'.repeat(40);
  assert.throws(() => assertSupportedIndexModes(Buffer.from(`120000 ${oid} 0\tsymlink\0`)), (error) => error.code === 'unsupported_repository');
  assert.throws(() => assertSupportedIndexModes(Buffer.from(`160000 ${oid} 0\tmodule\0`)), (error) => error.code === 'unsupported_repository');
  assert.equal(unsupportedPatch('deleted file mode 120000\n'), true);
  assert.equal(unsupportedPatch('new file mode 160000\n'), true);
});

test('Git environment redirection variables cannot move a fixed-root command', async () => {
  const root = await repo();
  const other = await repo();
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND };
  try {
    process.env.GIT_DIR = path.join(other, '.git');
    process.env.GIT_WORK_TREE = other;
    process.env.GIT_INDEX_FILE = path.join(other, '.git', 'index');
    process.env.GIT_SSH_COMMAND = 'node -e "process.exit(99)"';
    const service = workspace(root);
    const configured = await service.configure({ repoPath: root, baseRef: 'main' });
    assert.equal(configured.repository.path, root);
    assert.equal(configured.repository.branch, 'main');
  } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await dispose(root);
    await dispose(other);
  }
});

test('linked, detached, unborn, and symlink repository identities are unavailable', async () => {
  const root = await repo();
  const linked = path.join(os.tmpdir(), `aven-linked-${process.pid}-${Date.now()}`);
  const unborn = await fsp.mkdtemp(path.join(os.tmpdir(), 'aven-unborn-'));
  const symlink = path.join(os.tmpdir(), `aven-symlink-${process.pid}-${Date.now()}`);
  try {
    git(root, ['worktree', 'add', '--detach', linked]);
    await assert.rejects(() => workspace(linked).configure({ repoPath: linked }), (error) => error.code === 'unsupported_repository');
    git(root, ['checkout', '--detach']);
    await assert.rejects(() => workspace(root).configure({ repoPath: root }), (error) => error.code === 'detached_head');
    git(unborn, ['init', '-b', 'main']);
    await assert.rejects(() => workspace(unborn).configure({ repoPath: unborn }), (error) => error.code === 'unborn_head');
    try {
      await fsp.symlink(root, symlink, 'junction');
      await assert.rejects(() => workspace(symlink).configure({ repoPath: symlink }), (error) => error.code === 'unsupported_repository');
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    }
  } finally {
    await dispose(linked);
    await dispose(unborn);
    await dispose(symlink);
    await dispose(root);
  }
});

test('pull-request publish checks exact remote OIDs and never calls gh on mismatch', async () => {
  const root = await repo();
  try {
    const head = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', 'https://github.com/acme/network.git']);
    git(root, ['update-ref', 'refs/remotes/origin/main', head]);
    git(root, ['branch', '--set-upstream-to=origin/main', 'main']);
    let ghCalls = 0;
    git(root, ['config', 'core.sshCommand', 'node -e "process.exit(99)"']);
    const transportService = workspace(root, { remoteRunner: async () => head, ghRunner: async () => { ghCalls += 1; return { code: 0, stdout: '', stderr: '' }; } });
    await transportService.configure({ repoPath: root, baseRef: 'main' });
    await assert.rejects(() => transportService.prReview({ head: 'main', base: 'main', title: 'Blocked transport', body: 'Body' }), (error) => error.code === 'pr_unavailable');
    git(root, ['config', '--unset', 'core.sshCommand']);
    const service = workspace(root, {
      remoteRunner: async ({ ref }) => ref.endsWith('/main') ? `${'0'.repeat(40)}` : null,
      ghRunner: async () => { ghCalls += 1; return { code: 0, stdout: 'https://github.com/acme/network/pull/1', stderr: '' }; },
    });
    await service.configure({ repoPath: root, baseRef: 'main' });
    const review = await service.prReview({ head: 'main', base: 'main', title: 'Reviewed change', body: 'Body' });
    await assert.rejects(() => service.prPublish({ token: review.token }), (error) => error.code === 'remote_mismatch');
    assert.equal(ghCalls, 0);
    git(root, ['branch', 'base']);
    git(root, ['update-ref', 'refs/remotes/origin/base', head]);
    const baseMismatchService = workspace(root, {
      remoteRunner: async ({ ref }) => ref.endsWith('/main') ? head : `${'1'.repeat(40)}`,
      ghRunner: async () => { ghCalls += 1; return { code: 0, stdout: '', stderr: '' }; },
    });
    await baseMismatchService.configure({ repoPath: root, baseRef: 'base' });
    const baseMismatchReview = await baseMismatchService.prReview({ head: 'main', base: 'base', title: 'Reviewed change', body: 'Body' });
    await assert.rejects(() => baseMismatchService.prPublish({ token: baseMismatchReview.token }), (error) => error.code === 'remote_mismatch');
    assert.equal(ghCalls, 0);
    const serviceEqual = workspace(root, {
      remoteRunner: async ({ ref }) => ref.endsWith('/main') ? head : null,
      ghRunner: async ({ args, env }) => { ghCalls += 1; assert.equal(args.includes('--repo'), true); assert.equal(env.GH_PROMPT_DISABLED, '1'); assert.equal(env.CI, '1'); return { code: 0, stdout: 'https://github.com/acme/network/pull/2', stderr: '' }; },
    });
    await serviceEqual.configure({ repoPath: root, baseRef: 'main' });
    const equalReview = await serviceEqual.prReview({ head: 'main', base: 'main', title: 'Reviewed change', body: 'Body' });
    git(root, ['branch', 'side']);
    git(root, ['checkout', 'side']);
    await assert.rejects(() => serviceEqual.prPublish({ token: equalReview.token }), (error) => error.code === 'stale_review');
    git(root, ['checkout', 'main']);
    const equalReviewAfterBranchCheck = await serviceEqual.prReview({ head: 'main', base: 'main', title: 'Reviewed change', body: 'Body' });
    const published = await serviceEqual.prPublish({ token: equalReviewAfterBranchCheck.token });
    assert.equal(published.pushed, false);
    assert.equal(ghCalls, 1);
    assert.equal(parseRemote('git@github.com:acme/network.git'), null);
  } finally { await dispose(root); }
});

test('API requires the exact origin and custom Git header', async () => {
  const root = await repo();
  try {
    const service = workspace(root);
    const api = createGitWorkspaceApi({ workspace: service });
    const http = require('node:http');
    const server = http.createServer((req, res) => api.handle(req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (origin, header) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/git/status', method: 'GET', headers: { Origin: origin, 'X-Aven-Git': header } }, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) })); });
      req.on('error', reject); req.end();
    });
    assert.equal((await request('http://evil.test', 'workspace-v1')).status, 403);
    assert.equal((await request('http://127.0.0.1:8767', 'wrong')).status, 403);
    assert.equal((await request('http://127.0.0.1:8767', 'workspace-v1')).body.result.state, 'unconfigured');
    await new Promise((resolve) => server.close(resolve));
  } finally { await dispose(root); }
});
