'use strict';

// Delivery integration deliberately lives beside the IntentGraph service.  It
// consumes the service's read APIs and owns only fixed, reviewable delivery
// commands; callers cannot supply a shell command or a model generated argv.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { isSecretPath, normalizeRelative, sha256 } = require('./indexer.cjs');

const DELIVERY_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const EVIDENCE_DIRECTORY = path.join('.intentgraph', 'evidence');
const DELIVERY_RUNTIME_DIRECTORY = path.join('.intentgraph', 'runtime');
const HOOK_NAMES = ['pre-commit', 'pre-merge-commit', 'pre-push'];
const JS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const LOCK_NAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);

function frozenCommand(command) {
  return Object.freeze({ ...command, args: Object.freeze([...command.args]) });
}

// This is the only command catalog.  Its serialized hash is pinned in the
// local runtime setup record, so a candidate cannot replace command argv.
const COMMAND_CATALOG = Object.freeze({
  'verify-intentgraph': frozenCommand({
    id: 'verify-intentgraph',
    kind: 'fixed',
    description: 'Run the existing IntentGraph backend and trace test suites.',
    executable: 'node',
    args: ['--test', 'intentgraph/backend.test.cjs', 'intentgraph/trace.test.cjs']
  }),
  'check-candidate': frozenCommand({
    id: 'check-candidate',
    kind: 'candidate-syntax',
    description: 'Parse each JavaScript candidate with node --check.',
    executable: 'node',
    args: ['--check']
  }),
  // Keep a descriptive alias for callers that use the command name from the
  // CLI contract.  It has the same fixed implementation and restrictions.
  'syntax-check': frozenCommand({
    id: 'syntax-check',
    kind: 'candidate-syntax',
    description: 'Parse each JavaScript candidate with node --check.',
    executable: 'node',
    args: ['--check']
  })
});

function stableJson(value) {
  return JSON.stringify(value);
}

const CATALOG_HASH = sha256(stableJson(Object.fromEntries(
  Object.entries(COMMAND_CATALOG).map(([id, command]) => [id, {
    id: command.id,
    kind: command.kind,
    executable: command.executable,
    args: command.args
  }])
)));

// Files that form the delivery runner, its service, or its test/dependency
// definitions are never candidate files.  This prevents a task from changing
// the command runner and then asking that runner to certify itself.
const FIXED_RUNNER_PATHS = Object.freeze([
  'intentgraph/delivery.cjs',
  'intentgraph/backend.test.cjs',
  'intentgraph/trace.test.cjs',
  'intentgraph/engine.cjs',
  'intentgraph/indexer.cjs',
  'intentgraph/server.cjs',
  'intentgraph/chat-read-api.cjs',
  'intentgraph/catalyst.cjs',
  'intentgraph/chat-runtime.cjs',
  'intentgraph/agent-runtime.cjs',
  'intentgraph/network-execution.cjs',
  'intentgraph/network-commands.json',
  'intentgraph/adapters/requirements-network.txt',
  'intentgraph/agent-runtime.mjs',
  'intentgraph/cli.cjs',
  'intentgraph/execution-service.cjs',
  'intentgraph/provider.cjs',
  'intentgraph/vault.cjs',
  'intentgraph/coordinator.cjs',
  'intentgraph/coordination-schema.cjs',
  'intentgraph/adapters/index.cjs',
  'intentgraph/adapters/desktop.py',
  'intentgraph/adapters/network.py',
  'intentgraph/trace.cjs'
]);

const DEPENDENCY_DEFINITION_PATHS = Object.freeze([
  'package.json',
  'intentgraph/package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'intentgraph/package-lock.json',
  'intentgraph/npm-shrinkwrap.json',
  'intentgraph/yarn.lock',
  'intentgraph/pnpm-lock.yaml',
  'intentgraph/bun.lockb'
]);

const PROTECTED_CANDIDATE_PATHS = new Set([...FIXED_RUNNER_PATHS, ...DEPENDENCY_DEFINITION_PATHS]);
const PROTECTED_BASELINE_PATHS = Object.freeze([...FIXED_RUNNER_PATHS, ...DEPENDENCY_DEFINITION_PATHS]);

const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  'CI', 'ComSpec', 'LANG', 'LC_ALL', 'NODE_ENV', 'OS', 'PATH', 'Path',
  'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'WINDIR'
]);

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function text(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required`);
  return value.trim();
}

function safeEnvironment() {
  const result = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === 'string') result[key] = process.env[key];
  }
  // This marker is useful to a trusted test command and makes the execution
  // context explicit.  No credential-bearing environment key is forwarded.
  result.INTENTGRAPH_DELIVERY = '1';
  return result;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function realPathIfExists(candidate) {
  try { return fs.realpathSync(candidate); } catch { return null; }
}

function normalizeCandidate(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('candidate file path is required');
  const raw = value.trim().replaceAll('\\', '/');
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) throw new Error(`candidate file path must be relative: ${value}`);
  const normalized = normalizeRelative(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error(`candidate file path escapes workspace: ${value}`);
  return normalized;
}

function isRuntimeOrToolPath(relativePath) {
  const parts = relativePath.toLowerCase().split('/');
  if (parts.includes('.git') || parts.includes('node_modules') || parts.includes('runtime')) return true;
  if (parts.includes('.intentgraph')) return true;
  const base = parts[parts.length - 1];
  return LOCK_NAMES.has(base) || base === 'package.json' || base === 'npm-shrinkwrap.json';
}

function readHash(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) return null;
    return sha256(fs.readFileSync(absolutePath));
  } catch { return null; }
}

function writeExclusiveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now().toString(36)}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const handle = fs.openSync(temporary, 'wx');
  try {
    fs.writeFileSync(handle, payload, 'utf8');
    fs.closeSync(handle);
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.closeSync(handle); } catch {}
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function parseNulList(value) {
  return String(value || '').split('\0').filter(Boolean);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function executeProcess(executable, args, cwd) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(executable, args, {
      cwd,
      env: safeEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let outputLimited = false;
    let timedOut = false;
    let settled = false;
    let timer;

    const append = (target, chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - outputBytes);
      const accepted = buffer.subarray(0, remaining);
      outputBytes += accepted.length;
      if (accepted.length < buffer.length) outputLimited = true;
      return target + accepted.toString('utf8');
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); if (outputLimited) child.kill('SIGTERM'); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); if (outputLimited) child.kill('SIGTERM'); });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref?.();
    }, DEFAULT_TIMEOUT_MS);
    const finish = (error, code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        executable,
        args: [...args],
        cwd,
        exitCode: typeof code === 'number' ? code : null,
        signal: signal || null,
        timedOut,
        outputLimited,
        stdout,
        stderr,
        error: error ? String(error.message || error) : null,
        durationMs: Date.now() - startedAt,
        passed: !error && !timedOut && !outputLimited && code === 0
      });
    };
    child.once('error', (error) => finish(error, null, null));
    child.once('close', (code, signal) => finish(null, code, signal));
  });
}

class DeliveryGate {
  constructor(options = {}) {
    if (!options.root) throw new Error('DeliveryGate root is required');
    const resolvedRoot = realPathIfExists(path.resolve(options.root));
    if (!resolvedRoot) throw new Error('DeliveryGate root must exist');
    this.root = resolvedRoot;
    this.engine = options.engine || null;
    this.runtimeDirectory = path.resolve(options.runtimeDirectory || path.join(this.root, DELIVERY_RUNTIME_DIRECTORY));
    if (!this._insideRoot(this.runtimeDirectory)) throw new Error('runtimeDirectory must be inside the delivery root');
    const runtimeReal = realPathIfExists(this.runtimeDirectory);
    if (runtimeReal && !this._insideRoot(runtimeReal)) throw new Error('runtimeDirectory resolves outside the delivery root');
    this.configPath = path.join(this.runtimeDirectory, 'delivery-config.json');
    this.lockPath = path.join(this.runtimeDirectory, 'delivery.lock');
    this.configuration = this.ensureConfiguration();
  }

  _insideRoot(candidate) {
    const relative = path.relative(this.root, path.resolve(candidate));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  _baselineFiles() {
    return Object.fromEntries(PROTECTED_BASELINE_PATHS.map((relativePath) => {
      const absolute = path.join(this.root, relativePath);
      const real = realPathIfExists(absolute);
      return [relativePath, real && this._insideRoot(real) ? readHash(real) : null];
    }));
  }

  _bindingHash(protectedFiles) {
    return sha256(stableJson({ version: DELIVERY_VERSION, root: this.root, catalogHash: CATALOG_HASH, protectedFiles }));
  }

  ensureConfiguration() {
    fs.mkdirSync(this.runtimeDirectory, { recursive: true });
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch {}
    if (parsed) return parsed;
    const protectedFiles = this._baselineFiles();
    const config = {
      version: DELIVERY_VERSION,
      root: this.root,
      catalogHash: CATALOG_HASH,
      protectedFiles,
      bindingHash: this._bindingHash(protectedFiles),
      createdAt: new Date().toISOString()
    };
    try { writeExclusiveJson(this.configPath, config); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    try { return JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch { return config; }
  }

  _configurationReasons() {
    const config = this.configuration;
    const reasons = [];
    if (!config || typeof config !== 'object') return ['delivery setup record is unreadable'];
    if (config.version !== DELIVERY_VERSION) reasons.push('delivery setup version is unsupported');
    if (typeof config.root !== 'string' || !samePath(config.root, this.root)) reasons.push('delivery setup is bound to a different workspace root');
    if (config.catalogHash !== CATALOG_HASH) reasons.push('fixed delivery command catalog hash does not match its setup baseline');
    if (!config.protectedFiles || config.bindingHash !== this._bindingHash(config.protectedFiles)) reasons.push('delivery setup binding is invalid');
    for (const relativePath of PROTECTED_BASELINE_PATHS) {
      const expected = config.protectedFiles && Object.prototype.hasOwnProperty.call(config.protectedFiles, relativePath)
        ? config.protectedFiles[relativePath] : undefined;
      const actual = readHash(path.join(this.root, relativePath));
      if (expected !== actual) reasons.push(`protected delivery file changed: ${relativePath}`);
    }
    return reasons;
  }

  async _serviceStatus() {
    const service = { available: false, root: this.engine && this.engine.root ? String(this.engine.root) : null, rootMatches: false, revision: null };
    const reasons = [];
    if (!this.engine) return { service, reasons: ['IntentGraph service engine is unavailable'] };
    const engineRoot = this.engine.root ? realPathIfExists(this.engine.root) : null;
    service.root = engineRoot || service.root;
    service.rootMatches = Boolean(engineRoot && samePath(engineRoot, this.root));
    if (!service.rootMatches) reasons.push('IntentGraph service root does not match the delivery workspace root');
    if (this.engine.indexer && this.engine.indexer.root && !samePath(this.engine.indexer.root, this.root)) reasons.push('IntentGraph index root does not match the delivery workspace root');
    try {
      const index = await this.engine.getIndex();
      service.available = Boolean(index && Array.isArray(index.files));
      service.revision = index && Number.isFinite(Number(index.revision)) ? Number(index.revision) : null;
      if (!service.available) reasons.push('IntentGraph service index is unavailable');
    } catch (error) { reasons.push(`IntentGraph service status failed: ${error.message}`); }
    return { service, reasons };
  }

  _git(args) {
    return execFileSync('git', args, { cwd: this.root, env: safeEnvironment(), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  gitStatus() {
    try {
      const gitRootRaw = this._git(['rev-parse', '--show-toplevel']).trim();
      const gitRoot = realPathIfExists(gitRootRaw);
      const gitDirectoryRaw = this._git(['rev-parse', '--git-dir']).trim();
      const gitDirectory = path.resolve(this.root, gitDirectoryRaw);
      const hooksRaw = this._git(['rev-parse', '--git-path', 'hooks']).trim();
      const hooksDirectory = path.resolve(this.root, hooksRaw);
      const rootMatches = Boolean(gitRoot && samePath(gitRoot, this.root));
      const hooks = Object.fromEntries(HOOK_NAMES.map((name) => [name, fs.existsSync(path.join(hooksDirectory, name))]));
      return { available: true, isRepository: true, root: gitRoot, rootMatches, gitDirectory, hooksDirectory, hooks };
    } catch (error) {
      return { available: false, isRepository: false, root: null, rootMatches: false, hooks: {}, error: String(error.message || error) };
    }
  }

  async _task(taskId) {
    if (!taskId) return null;
    if (!this.engine || typeof this.engine.getState !== 'function') return null;
    const state = await this.engine.getState();
    return (state.tasks || []).find((task) => task.id === taskId) || null;
  }

  async _taskGate(taskId) {
    if (!taskId || !this.engine || typeof this.engine.getGate !== 'function') return null;
    try { return clone(await this.engine.getGate(taskId)); } catch (error) { return { taskId, allowed: false, reasons: [error.message] }; }
  }

  async status(options = {}) {
    const taskId = options.taskId ? text(options.taskId, 'taskId', 150) : null;
    const configReasons = this._configurationReasons();
    const { service, reasons: serviceReasons } = await this._serviceStatus();
    const git = this.gitStatus();
    const reasons = [...configReasons, ...serviceReasons];
    if (!git.isRepository) reasons.push('workspace is not a Git repository');
    if (!git.rootMatches && git.isRepository) reasons.push('Git repository root does not match the delivery workspace root');
    const taskGate = taskId ? await this._taskGate(taskId) : null;
    if (taskGate && !taskGate.allowed) reasons.push(...(taskGate.reasons || ['task delivery gate is denied']));
    const allowed = reasons.length === 0;
    return {
      version: DELIVERY_VERSION,
      root: this.root,
      status: allowed ? 'ready' : 'blocked',
      ok: allowed,
      allowed,
      reasons: Array.from(new Set(reasons)),
      catalog: {
        hash: CATALOG_HASH,
        pinned: configReasons.length === 0,
        commands: Object.keys(COMMAND_CATALOG),
        definitions: Object.fromEntries(Object.entries(COMMAND_CATALOG).map(([id, command]) => [id, {
          kind: command.kind,
          description: command.description,
          executable: command.executable,
          args: command.args
        }]))
      },
      service,
      taskId,
      taskGate,
      git
    };
  }

  _candidateFiles(task) {
    const rawFiles = Array.isArray(task && task.files) ? task.files : [];
    const files = [];
    const reasons = [];
    const seen = new Set();
    for (const raw of rawFiles) {
      let relativePath;
      try { relativePath = normalizeCandidate(raw); } catch (error) { reasons.push(error.message); continue; }
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);
      const lower = relativePath.toLowerCase();
      if (PROTECTED_CANDIDATE_PATHS.has(lower) || isRuntimeOrToolPath(relativePath) || isSecretPath(relativePath)) {
        reasons.push(`candidate file is a delivery tool, runtime, dependency definition, or secret: ${relativePath}`);
        continue;
      }
      const absolute = path.resolve(this.root, relativePath);
      if (!this._insideRoot(absolute)) { reasons.push(`candidate file escapes workspace: ${relativePath}`); continue; }
      const real = realPathIfExists(absolute);
      if (!real || !this._insideRoot(real)) { reasons.push(`candidate file is missing or escapes workspace: ${relativePath}`); continue; }
      if (!samePath(real, absolute)) { reasons.push(`candidate file symlinks are not allowed: ${relativePath}`); continue; }
      let stat;
      try { stat = fs.statSync(real); } catch { stat = null; }
      if (!stat || !stat.isFile()) { reasons.push(`candidate file is not a regular file: ${relativePath}`); continue; }
      files.push({ path: relativePath, absolute: real, hash: readHash(real) });
    }
    if (!files.length) reasons.push('task must name at least one allowed candidate file');
    return { files, reasons };
  }

  async _validateCandidates(task) {
    const result = this._candidateFiles(task);
    if (!this.engine || typeof this.engine.getIndex !== 'function') return { ...result, reasons: [...result.reasons, 'IntentGraph service index is unavailable'] };
    try {
      const index = await this.engine.getIndex();
      const known = new Set();
      for (const item of index && index.files || []) {
        try { known.add(normalizeCandidate(item.path)); } catch {}
      }
      for (const candidate of result.files) if (!known.has(candidate.path)) result.reasons.push(`candidate file is not indexed by IntentGraph: ${candidate.path}`);
    } catch (error) { result.reasons.push(`candidate file validation failed: ${error.message}`); }
    return result;
  }

  _acquireLock() {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    try {
      const handle = fs.openSync(this.lockPath, 'wx');
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(handle);
      return () => { try { fs.rmSync(this.lockPath, { force: true }); } catch {} };
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('delivery gate is busy');
      throw error;
    }
  }

  async _runChecks(command, candidates) {
    if (command.kind === 'fixed') return [await executeProcess(process.execPath, command.args, this.root)];
    const checks = [];
    for (const candidate of candidates) {
      checks.push(await executeProcess(process.execPath, [...command.args, candidate.path], this.root));
    }
    return checks;
  }

  _evidencePath() {
    return path.join(this.root, EVIDENCE_DIRECTORY, `delivery-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.json`);
  }

  _trustedCheckEvidence(task, candidateResult) {
    const directory = path.join(this.root, EVIDENCE_DIRECTORY);
    const reasons = [];
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => path.join(directory, entry.name))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    } catch { entries = []; }
    const currentFiles = Object.fromEntries(candidateResult.files.map((candidate) => [candidate.path, candidate.hash]));
    for (const evidencePath of entries) {
      let evidence;
      try { evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')); } catch { continue; }
      if (!evidence || evidence.type !== 'intentgraph.delivery.check' || evidence.taskId !== task.id) continue;
      if (evidence.commandId !== 'verify-intentgraph' || evidence.commandCatalogHash !== CATALOG_HASH || typeof evidence.root !== 'string' || !samePath(evidence.root, this.root) || evidence.checksPassed !== true) continue;
      const recordedFiles = Object.fromEntries((Array.isArray(evidence.candidateFiles) ? evidence.candidateFiles : []).map((candidate) => [candidate.path, candidate.hash]));
      if (JSON.stringify(recordedFiles) !== JSON.stringify(currentFiles)) continue;
      if (!Array.isArray(evidence.checks) || evidence.checks.length === 0 || evidence.checks.some((check) => check.passed !== true || check.exitCode !== 0 || check.timedOut || check.outputLimited || check.executable !== process.execPath || check.cwd !== this.root || JSON.stringify(check.args) !== JSON.stringify(COMMAND_CATALOG['verify-intentgraph'].args))) continue;
      return { allowed: true, path: normalizeRelative(path.relative(this.root, evidencePath)), createdAt: evidence.createdAt, commandId: evidence.commandId };
    }
    reasons.push('no current successful verify-intentgraph evidence exists for the task');
    return { allowed: false, reasons };
  }

  async run(options = {}) {
    const taskId = text(options.taskId, 'taskId', 150);
    const commandId = text(options.commandId || 'verify-intentgraph', 'commandId', 100);
    const command = COMMAND_CATALOG[commandId];
    const baseStatus = await this.status({ taskId: null });
    const task = await this._task(taskId);
    const denied = (reasons, checks = [], extra = {}) => ({
      version: DELIVERY_VERSION,
      taskId,
      commandId,
      status: 'blocked',
      ok: false,
      allowed: false,
      checksPassed: false,
      gateAllowed: false,
      reasons: Array.from(new Set(reasons)),
      checks,
      actualChecks: checks,
      evidence: null,
      evidencePath: null,
      gate: null,
      gatedStatus: { build: 'not-run', release: 'blocked' },
      ...extra
    });
    if (!command) return denied([`unknown delivery command: ${commandId}`]);
    const preflightConfigReasons = this._configurationReasons();
    const preflightReasons = [...preflightConfigReasons];
    if (!baseStatus.service.available || baseStatus.service.rootMatches !== true) preflightReasons.push(...baseStatus.reasons.filter((reason) => reason.toLowerCase().includes('service') || reason.toLowerCase().includes('root')));
    if (!task) preflightReasons.push('task not found');
    if (preflightReasons.length) return denied(preflightReasons, [], { service: baseStatus.service, git: baseStatus.git });
    // Refresh the service index before validating candidate paths.  The
    // engine gate is intentionally advisory here: builds may run before
    // reviews are complete, but a just-created candidate must be visible to
    // the same service snapshot used for the later gate decision.
    await this._taskGate(taskId);
    const candidateResult = await this._validateCandidates(task);
    if (candidateResult.reasons.length) return denied(candidateResult.reasons, [], { service: baseStatus.service, git: baseStatus.git });
    if (command.kind === 'candidate-syntax' && candidateResult.files.some((candidate) => !JS_EXTENSIONS.has(path.extname(candidate.path).toLowerCase()))) {
      return denied(['candidate syntax checks accept only .js, .cjs, and .mjs files'], [], { service: baseStatus.service, git: baseStatus.git });
    }
    let releaseLock;
    try { releaseLock = this._acquireLock(); } catch (error) { return denied([error.message], [], { service: baseStatus.service, git: baseStatus.git }); }
    try {
      const gateBefore = await this._taskGate(taskId);
      const checks = await this._runChecks(command, candidateResult.files);
      let checksPassed = checks.length > 0 && checks.every((check) => check.passed);
      const evidencePath = this._evidencePath();
      const evidence = {
        schemaVersion: 1,
        type: 'intentgraph.delivery.check',
        taskId,
        commandId,
        commandCatalogHash: CATALOG_HASH,
        root: this.root,
        candidateFiles: candidateResult.files.map((candidate) => ({ path: candidate.path, hash: candidate.hash })),
        gateBefore,
        checks: checks.map((check) => ({ ...check })),
        checksPassed,
        createdAt: new Date().toISOString()
      };
      let evidenceRecord = null;
      try {
        writeExclusiveJson(evidencePath, evidence);
        evidenceRecord = { path: normalizeRelative(path.relative(this.root, evidencePath)), hash: readHash(evidencePath), bytes: fs.statSync(evidencePath).size };
      } catch (error) {
        checks.push({ passed: false, error: `evidence capture failed: ${error.message}` });
      }
      try { if (typeof this.engine.refresh === 'function') await this.engine.refresh('delivery-check'); } catch (error) { checks.push({ passed: false, error: `IntentGraph refresh failed: ${error.message}` }); }
      checksPassed = checks.length > 0 && checks.every((check) => check.passed);
      const postConfigurationReasons = this._configurationReasons();
      const postCandidateResult = await this._validateCandidates(task);
      const preCandidateHashes = new Map(candidateResult.files.map((candidate) => [candidate.path, candidate.hash]));
      const candidateHashReasons = [];
      for (const candidate of postCandidateResult.files) {
        if (preCandidateHashes.get(candidate.path) !== candidate.hash) candidateHashReasons.push(`candidate changed while the delivery check ran: ${candidate.path}`);
      }
      for (const reason of postCandidateResult.reasons) candidateHashReasons.push(reason);
      const gateAfter = await this._taskGate(taskId);
      const gateAllowed = Boolean(gateAfter && gateAfter.allowed);
      const finalGit = this.gitStatus();
      const reasons = [];
      if (!checksPassed) reasons.push('one or more delivery checks failed');
      reasons.push(...postConfigurationReasons);
      reasons.push(...candidateHashReasons);
      if (!gateAllowed) reasons.push(...((gateAfter && gateAfter.reasons) || ['task delivery gate is denied']));
      if (!evidenceRecord) reasons.push('delivery check evidence was not captured');
      const finalAllowed = checksPassed && postConfigurationReasons.length === 0 && candidateHashReasons.length === 0 && gateAllowed && Boolean(evidenceRecord) && finalGit.isRepository && finalGit.rootMatches;
      if (!finalGit.isRepository) reasons.push('workspace is not a Git repository');
      if (finalGit.isRepository && !finalGit.rootMatches) reasons.push('Git repository root does not match the delivery workspace root');
      return {
        version: DELIVERY_VERSION,
        taskId,
        commandId,
        status: finalAllowed ? 'ready' : checksPassed ? 'blocked' : 'failed',
        ok: finalAllowed,
        allowed: finalAllowed,
        checksPassed,
        gateAllowed,
        reasons: Array.from(new Set(reasons)),
        checks,
        actualChecks: checks,
        evidence: evidenceRecord,
        evidencePath: evidenceRecord && evidenceRecord.path,
        gateBefore,
        gateAfter,
        gate: gateAfter,
        sourceValidation: {
          before: { configuration: preflightConfigReasons, candidateHashes: Object.fromEntries(candidateResult.files.map((candidate) => [candidate.path, candidate.hash])) },
          after: { configuration: postConfigurationReasons, candidateHashes: Object.fromEntries(postCandidateResult.files.map((candidate) => [candidate.path, candidate.hash])) },
          candidateStable: candidateHashReasons.length === 0
        },
        service: baseStatus.service,
        git: finalGit,
        gatedStatus: { build: checksPassed ? 'passed' : 'failed', release: gateAllowed && finalAllowed ? 'ready' : 'blocked' }
      };
    } finally { releaseLock(); }
  }

  _stagedTree() {
    const tree = this._git(['write-tree']).trim();
    return { tree, blobs: this._treeBlobs(tree) };
  }

  _treeBlobs(revision) {
    const listing = this._git(['ls-tree', '-r', '-z', revision]);
    const blobs = new Map();
    for (const entry of parseNulList(listing)) {
      const tab = entry.indexOf('\t');
      if (tab < 0) continue;
      const header = entry.slice(0, tab).split(/\s+/);
      const relativePath = normalizeRelative(entry.slice(tab + 1));
      if (header[1] === 'blob' && header[2]) blobs.set(relativePath, header[2]);
    }
    return blobs;
  }

  _stagedChangedPaths() {
    return parseNulList(this._git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACDMRTUXB'])).map(normalizeRelative);
  }

  _reviewedTreeCheck(tasks) {
    const staged = this._stagedTree();
    const changed = this._stagedChangedPaths();
    const allowedPaths = new Set(tasks.flatMap((task) => (Array.isArray(task.files) ? task.files : []).map(normalizeCandidate)));
    const outside = changed.filter((relativePath) => !allowedPaths.has(relativePath));
    const mismatches = [];
    for (const task of tasks) {
      for (const rawPath of task.files || []) {
        let relativePath;
        try { relativePath = normalizeCandidate(rawPath); } catch (error) { mismatches.push(error.message); continue; }
        const oid = staged.blobs.get(relativePath);
        let stagedHash = null;
        if (oid) {
          try { stagedHash = sha256(execFileSync('git', ['cat-file', 'blob', oid], { cwd: this.root, env: safeEnvironment(), encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })); } catch { stagedHash = null; }
        }
        const currentHash = readHash(path.join(this.root, relativePath));
        if (!oid || stagedHash !== currentHash) mismatches.push(`staged candidate differs from the working reviewed candidate: ${relativePath}`);
      }
    }
    const reasons = [];
    if (outside.length) reasons.push(`staged files are outside the active task candidates: ${outside.join(', ')}`);
    reasons.push(...mismatches);
    return { allowed: reasons.length === 0, tree: staged.tree, changed, outside, mismatches, reasons };
  }

  _pushedTreeCheck(tasks, stdin) {
    const lines = String(stdin || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return { allowed: false, refs: [], changed: [], outside: [], mismatches: [], reasons: ['pre-push requires Git pushed-ref input'] };
    const refs = [];
    const changed = new Set();
    const mismatches = [];
    const allowedPaths = new Set(tasks.flatMap((task) => (Array.isArray(task.files) ? task.files : []).map(normalizeCandidate)));
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) { mismatches.push('pre-push input contained an invalid ref line'); continue; }
      const [localRef, localOid, remoteRef, remoteOid] = parts;
      const oidValid = (oid) => /^(?:0{40,64}|[0-9a-fA-F]{40,64})$/.test(oid);
      if (!oidValid(localOid) || !oidValid(remoteOid)) { mismatches.push(`pre-push input has an invalid object id for ${localRef || remoteRef}`); continue; }
      if (/^0+$/.test(localOid)) { mismatches.push(`pre-push deletion is not a delivery push: ${localRef}`); continue; }
      refs.push({ localRef, localOid, remoteRef, remoteOid });
      let blobs;
      try { blobs = this._treeBlobs(localOid); } catch (error) { mismatches.push(`cannot inspect pushed ref ${localRef}: ${error.message}`); continue; }
      for (const task of tasks) {
        for (const rawPath of task.files || []) {
          let relativePath;
          try { relativePath = normalizeCandidate(rawPath); } catch (error) { mismatches.push(error.message); continue; }
          const oid = blobs.get(relativePath);
          let pushedHash = null;
          if (oid) {
            try { pushedHash = sha256(execFileSync('git', ['cat-file', 'blob', oid], { cwd: this.root, env: safeEnvironment(), encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })); } catch {}
          }
          const currentHash = readHash(path.join(this.root, relativePath));
          if (!oid || pushedHash !== currentHash) mismatches.push(`pushed candidate differs from the working reviewed candidate: ${relativePath}`);
        }
      }
      let diff;
      try {
        diff = /^0+$/.test(remoteOid)
          ? this._git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', localOid])
          : this._git(['diff', '--name-only', '-z', `${remoteOid}..${localOid}`]);
        for (const changedPath of parseNulList(diff)) changed.add(normalizeRelative(changedPath));
      } catch (error) { mismatches.push(`cannot inspect pushed ref changes for ${localRef}: ${error.message}`); }
    }
    if (!refs.length && !mismatches.length) mismatches.push('pre-push contained no non-deletion refs');
    const outside = [...changed].filter((relativePath) => !allowedPaths.has(relativePath));
    const reasons = [];
    if (outside.length) reasons.push(`pushed files are outside the active task candidates: ${outside.join(', ')}`);
    reasons.push(...mismatches);
    return { allowed: reasons.length === 0, refs, changed: [...changed], outside, mismatches, reasons };
  }

  async runHook(options = {}) {
    const hook = text(options.hook, 'hook', 50);
    if (!HOOK_NAMES.includes(hook)) return { ok: false, allowed: false, status: 'blocked', reasons: [`unsupported Git hook: ${hook}`] };
    const base = await this.status();
    const reasons = [...base.reasons.filter((reason) => reason !== 'workspace is not a Git repository')];
    if (!base.git.isRepository) reasons.push('workspace is not a Git repository');
    if (!base.git.rootMatches) reasons.push('Git repository root does not match the delivery workspace root');
    let tasks = [];
    try {
      const state = await this.engine.getState();
      tasks = (state.tasks || []).filter((task) => !task.release && task.state !== 'completed');
    } catch (error) { reasons.push(`task state unavailable: ${error.message}`); }
    if (!tasks.length) reasons.push('no active delivery task is registered');
    const taskResults = [];
    for (const task of tasks) {
      const gate = await this._taskGate(task.id);
      taskResults.push({ taskId: task.id, gate });
      if (!gate || !gate.allowed) reasons.push(...((gate && gate.reasons) || ['task delivery gate is denied']));
      const candidateResult = await this._validateCandidates(task);
      if (candidateResult.reasons.length) reasons.push(...candidateResult.reasons);
      const trustedCheck = this._trustedCheckEvidence(task, candidateResult);
      taskResults[taskResults.length - 1].trustedCheck = trustedCheck;
      if (!trustedCheck.allowed) reasons.push(...trustedCheck.reasons);
    }
    let tree = null;
    if (!reasons.length) {
      try {
        tree = hook === 'pre-push' ? this._pushedTreeCheck(tasks, options.stdin) : this._reviewedTreeCheck(tasks);
        reasons.push(...tree.reasons);
      } catch (error) { reasons.push(`Git reviewed candidate check failed: ${error.message}`); }
    }
    return { version: DELIVERY_VERSION, hook, root: this.root, status: reasons.length ? 'blocked' : 'ready', ok: reasons.length === 0, allowed: reasons.length === 0, reasons: Array.from(new Set(reasons)), taskResults, tree, git: base.git, service: base.service };
  }

  installHooks(options = {}) {
    if (!options.repo) throw new Error('hook installation requires an explicit --repo path');
    const repo = realPathIfExists(path.resolve(options.repo));
    if (!repo || !samePath(repo, this.root)) throw new Error('hook installation repo must match the DeliveryGate root');
    const git = this.gitStatus();
    if (!git.isRepository) throw new Error('hook installation requires a Git repository');
    if (!git.rootMatches) throw new Error('Git repository root does not match the DeliveryGate root');
    const hooksDirectory = git.hooksDirectory;
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const targets = HOOK_NAMES.map((name) => path.join(hooksDirectory, name));
    const existing = targets.filter((target) => fs.existsSync(target));
    if (existing.length) throw new Error(`refusing to overwrite existing Git hook(s): ${existing.map((target) => path.basename(target)).join(', ')}`);
    const created = [];
    // Git for Windows executes hooks through a POSIX shell.  A Windows
    // process.execPath (for example, C:\\Program Files\\nodejs\\node.exe)
    // is not a valid shell command there, while `node` is on Git's normal
    // hook PATH.  cygpath converts the absolute script path for Git Bash;
    // the hook's working directory is the repository root by Git contract.
    const deliveryScript = path.join(__dirname, 'delivery.cjs').replaceAll('\\', '/');
    const windowsScriptPath = deliveryScript;
    try {
      for (const hook of HOOK_NAMES) {
        const script = [
          '#!/bin/sh',
          'set -eu',
          `DELIVERY_SCRIPT=${shellQuote(windowsScriptPath)}`,
          'if command -v cygpath >/dev/null 2>&1; then DELIVERY_SCRIPT=$(cygpath -u "$DELIVERY_SCRIPT"); fi',
          `exec node "$DELIVERY_SCRIPT" hook --root . --hook ${shellQuote(hook)} "$@"`,
          ''
        ].join('\n');
        const target = path.join(hooksDirectory, hook);
        const handle = fs.openSync(target, 'wx');
        try { fs.writeFileSync(handle, script, 'utf8'); } finally { fs.closeSync(handle); }
        if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
        created.push(target);
      }
    } catch (error) {
      for (const target of created) { try { fs.rmSync(target, { force: true }); } catch {} }
      throw error;
    }
    return { installed: HOOK_NAMES, hooksDirectory, root: this.root, warning: 'Git hooks are a convenience gate and can be bypassed with --no-verify or manual Git operations.' };
  }
}

async function createLocalGate(root) {
  const { IndexStore } = require('./indexer.cjs');
  const { IntentEngine } = require('./engine.cjs');
  const resolvedRoot = realPathIfExists(path.resolve(root));
  if (!resolvedRoot) throw new Error('workspace root must exist');
  const runtimeDirectory = path.join(resolvedRoot, DELIVERY_RUNTIME_DIRECTORY);
  const indexer = new IndexStore(resolvedRoot, runtimeDirectory);
  const engine = new IntentEngine(resolvedRoot, indexer, runtimeDirectory);
  await engine.initialize();
  return new DeliveryGate({ root: resolvedRoot, engine, runtimeDirectory });
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  process.stderr.write('Usage: delivery.cjs status [--root PATH] [--task TASK] | run [--root PATH] --task TASK [--command COMMAND] | hooks install --repo PATH [--root PATH] | hook --root PATH --hook HOOK\n');
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (!command) { usage(); return 1; }
  if (command === 'hooks' && argv[1] !== 'install') { usage(); return 1; }
  const repo = argumentValue(argv, '--repo');
  const root = path.resolve(argumentValue(argv, '--root') || repo || process.cwd());
  const gate = await createLocalGate(root);
  if (command === 'status') {
    const result = await gate.status({ taskId: argumentValue(argv, '--task') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.allowed ? 0 : 2;
  }
  if (command === 'run') {
    const result = await gate.run({ taskId: argumentValue(argv, '--task'), commandId: argumentValue(argv, '--command') || 'verify-intentgraph' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : (result.status === 'failed' ? 1 : 2);
  }
  if (command === 'hooks') {
    if (!repo) { usage(); return 1; }
    const result = gate.installHooks({ repo });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (command === 'hook') {
    const hook = argumentValue(argv, '--hook');
    const stdin = hook === 'pre-push' ? await readStdin() : '';
    const result = await gate.runHook({ hook, stdin });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.allowed ? 0 : 2;
  }
  usage();
  return 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DeliveryGate,
  createDeliveryGate: (options) => new DeliveryGate(options),
  createLocalGate,
  COMMAND_CATALOG,
  CATALOG_HASH,
  DELIVERY_VERSION,
  HOOK_NAMES,
  MAX_OUTPUT_BYTES,
  main
};
