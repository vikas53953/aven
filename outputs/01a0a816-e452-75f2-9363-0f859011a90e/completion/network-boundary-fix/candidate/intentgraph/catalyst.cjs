'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const CATALYST_HOST = 'sandboxdnac.cisco.com';
const CATALYST_USERNAME = 'devnetuser';
const CATALYST_SECRET_REF = 'network-catalyst-shared';
const CATALYST_FINGERPRINT256 = '93:06:F1:B0:21:0E:FE:58:A2:89:B5:97:84:BB:D5:FD:94:D2:21:BF:DC:04:73:3B:0B:70:51:B8:89:83:CE:B7';
const CATALYST_TRUST_FILE = 'catalyst-trust.json';
const AUTH_PATH = '/dna/system/api/v1/auth/token';
const INVENTORY_PATH = '/dna/intent/api/v1/network-device?limit=25';
const COMMAND_REQUEST_PATH = '/dna/intent/api/v1/network-device-poller/cli/read-request';
const TASK_PATH_PREFIX = '/dna/intent/api/v1/task/';
const FILE_PATH_PREFIX = '/dna/intent/api/v1/file/';
const CACHE_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;
const MAX_DEVICES = 25;
const MAX_COMMAND_POLL_ATTEMPTS = 20;
const COMMAND_POLL_INTERVAL_MS = 1000;
const COMMAND_TIMEOUT_MS = 45 * 1000;
const SOURCE = 'cisco-catalyst';
const SUPPORTED_COMMANDS = Object.freeze(require('./network-commands.json').cisco_ios);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeError(message) {
  return new Error(message);
}

function clockNow(clock) {
  const value = typeof clock === 'function' ? clock() : Date.now();
  return value instanceof Date ? value.getTime() : Number(value);
}

function boundedString(value, max = 500) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function safeId(value) {
  return isUuid(value) ? value : '';
}

function fingerprint(value) {
  return boundedString(value, 200).trim().toUpperCase();
}

function safePathInside(parent, target) {
  const relative = path.relative(parent, target);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw safeError('Catalyst trust is unavailable');
  }
  return target;
}

function createPinnedAgent({ host, expectedFingerprint, tlsModule = tls, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const agent = new https.Agent({ keepAlive: false, maxSockets: 1, maxFreeSockets: 0 });
  agent.createConnection = (options, callback) => {
    const socket = tlsModule.connect({
      ...options,
      host,
      servername: host,
      rejectUnauthorized: false
    });
    let complete = false;
    const finish = (cause, value) => {
      if (complete) return;
      complete = true;
      callback(cause, value);
    };
    socket.once('secureConnect', () => {
      const peer = socket.getPeerCertificate();
      if (!peer || fingerprint(peer.fingerprint256) !== expectedFingerprint) {
        try { socket.destroy(); } catch {}
        finish(safeError('Catalyst TLS pin rejected'));
        return;
      }
      finish(null, socket);
    });
    socket.once('error', () => finish(safeError('Catalyst TLS connection failed')));
    socket.setTimeout(timeoutMs, () => {
      try { socket.destroy(); } catch {}
      finish(safeError('Catalyst request timed out'));
    });
  };
  return agent;
}

function requestWithHttps({ agent, method, route, headers, body, timeoutMs = REQUEST_TIMEOUT_MS, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const chunks = [];
    let absoluteTimer = null;
    const finish = (cause, value) => {
      if (settled) return;
      settled = true;
      if (absoluteTimer !== null) {
        clearTimeout(absoluteTimer);
        absoluteTimer = null;
      }
      if (cause) reject(cause);
      else resolve(value);
    };
    let payload = null;
    if (body !== undefined) {
      try { payload = JSON.stringify(body); } catch { finish(safeError('Catalyst request body was malformed')); return; }
      if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) { finish(safeError('Catalyst request exceeded size limit')); return; }
    }
    const requestHeaders = { ...(headers || {}) };
    if (payload !== null) {
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const request = https.request({
      hostname: CATALYST_HOST,
      servername: CATALYST_HOST,
      port: 443,
      path: route,
      method,
      agent,
      headers: requestHeaders,
      timeout: timeoutMs
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        try { response.destroy(); } catch {}
        try { request.destroy(); } catch {}
        finish(safeError('Catalyst redirect rejected'));
        return;
      }
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy();
          finish(safeError('Catalyst response exceeded size limit'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('error', () => finish(safeError('Catalyst response failed')));
      response.on('end', () => {
        if (settled) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finish(safeError('Catalyst response was malformed')); return; }
        finish(null, { status, body });
      });
    });
    absoluteTimer = setTimeout(() => {
      request.destroy();
      finish(safeError('Catalyst request timed out'));
    }, timeoutMs);
    const onAbort = () => {
      request.destroy();
      finish(Object.assign(safeError('Catalyst request cancelled'), { code: 'catalyst_aborted' }));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    request.on('error', () => { cleanup(); finish(safeError('Catalyst request failed')); });
    request.on('timeout', () => {
      request.destroy();
      cleanup();
      finish(safeError('Catalyst request timed out'));
    });
    request.once('close', cleanup);
    request.end(payload);
  });
}

class CatalystClient {
  constructor(options = {}) {
    this.runtimeDirectory = path.resolve(options.runtimeDirectory || path.join(process.cwd(), '.intentgraph', 'runtime'));
    this.trustPath = path.join(this.runtimeDirectory, CATALYST_TRUST_FILE);
    this.getSecret = typeof options.getSecret === 'function'
      ? options.getSecret
      : require('./vault.cjs').getSecret;
    this.clock = options.clock;
    this.requestInjection = options.request || options.requestImpl || options.transport?.request || null;
    this.connectInjection = options.connect || options.connectImpl || options.transport?.connect || null;
    this.tlsModule = options.tlsModule || tls;
    this.agent = null;
    this.cache = null;
    this.inFlight = null;
    this.closed = false;
  }

  trustState() {
    const disabled = (reason) => ({
      enabled: false,
      host: CATALYST_HOST,
      fingerprint256: CATALYST_FINGERPRINT256,
      trustPath: this.trustPath,
      reason
    });
    let stat;
    try { stat = fs.lstatSync(this.trustPath); } catch { return disabled('trust file missing'); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) return disabled('trust file invalid');
    let value;
    try { value = JSON.parse(fs.readFileSync(this.trustPath, 'utf8').replace(/^\uFEFF/, '')); } catch { return disabled('trust file invalid'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.host !== CATALYST_HOST || fingerprint(value.fingerprint256) !== CATALYST_FINGERPRINT256) {
      return disabled('trust fingerprint mismatch');
    }
    return { enabled: true, host: CATALYST_HOST, fingerprint256: CATALYST_FINGERPRINT256, trustPath: this.trustPath };
  }

  status() {
    const trust = this.trustState();
    return {
      enabled: trust.enabled && !this.closed,
      host: CATALYST_HOST,
      username: CATALYST_USERNAME,
      fingerprint256: CATALYST_FINGERPRINT256,
      cache: this.cache ? { retrievedAt: this.cache.result.retrievedAt, expiresAt: this.cache.expiresAt } : null,
      inFlight: Boolean(this.inFlight),
      reason: this.closed ? 'client closed' : (trust.enabled ? null : trust.reason)
    };
  }

  requireTrust() {
    if (this.closed) throw safeError('Catalyst client is closed');
    const trust = this.trustState();
    if (!trust.enabled) throw safeError('Catalyst trust is not configured');
    return trust;
  }

  async verifyInjectedPin() {
    if (!this.connectInjection) return;
    let result;
    try { result = await this.connectInjection({ host: CATALYST_HOST, fingerprint256: CATALYST_FINGERPRINT256 }); } catch { throw safeError('Catalyst TLS pin rejected'); }
    const observed = typeof result === 'string' ? result : result && (result.fingerprint256 || result.fingerprint);
    if (typeof observed !== 'string' || fingerprint(observed) !== CATALYST_FINGERPRINT256) throw safeError('Catalyst TLS pin rejected');
  }

  async request(phase, method, route, headers, body, options = {}) {
    if (this.requestInjection) {
      let result;
      try {
        result = await this.requestInjection({ phase, method, route, headers: { ...headers }, body, signal: options.signal, timeoutMs: options.timeoutMs, host: CATALYST_HOST, fingerprint256: CATALYST_FINGERPRINT256 });
      } catch (cause) {
        if (cause && cause.message === 'Catalyst TLS pin rejected') throw cause;
        if (cause && cause.code === 'catalyst_aborted') throw cause;
        throw safeError(`Catalyst ${phase} request failed`);
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw safeError('Catalyst response was malformed');
      if (result.pinVerified === false) throw safeError('Catalyst TLS pin rejected');
      const status = Number(result.status ?? result.statusCode ?? 0);
      if (status >= 300 && status < 400) throw safeError('Catalyst redirect rejected');
      if (!Number.isInteger(status) || status < 100 || status > 599 || !result.body || typeof result.body !== 'object') throw safeError('Catalyst response was malformed');
      const serialized = JSON.stringify(result.body);
      if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) throw safeError('Catalyst response exceeded size limit');
      return { status, body: result.body };
    }
    if (!this.agent) this.agent = createPinnedAgent({ host: CATALYST_HOST, expectedFingerprint: CATALYST_FINGERPRINT256, tlsModule: this.tlsModule });
    return requestWithHttps({ agent: this.agent, method, route, headers, body, signal: options.signal, timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS });
  }

  normalize(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.response)) throw safeError('Catalyst inventory response was malformed');
    const devices = body.response.slice(0, MAX_DEVICES).map((device) => {
      if (!device || typeof device !== 'object' || Array.isArray(device)) throw safeError('Catalyst inventory response was malformed');
      const id = safeId(device.id || device.uuid || device.deviceUuid || device.deviceId);
      return {
        ...(id ? { id } : {}),
        hostname: boundedString(device.hostname || device.name),
        platform: boundedString(device.platformId || device.platform),
        managementIp: boundedString(device.managementIpAddress || device.managementIp || device.managementIPAddress),
        softwareVersion: boundedString(device.softwareVersion || device.version),
        reachability: boundedString(device.reachabilityStatus || device.reachability)
      };
    });
    return { source: SOURCE, retrievedAt: new Date(clockNow(this.clock)).toISOString(), devices };
  }

  async fetchInventory(options = {}) {
    await this.verifyInjectedPin();
    let password = '';
    let token = '';
    try {
      try { password = await this.getSecret(CATALYST_SECRET_REF); } catch { throw safeError('Catalyst credential unavailable'); }
      if (typeof password !== 'string' || !password) throw safeError('Catalyst credential unavailable');
      const authorization = `Basic ${Buffer.from(`${CATALYST_USERNAME}:${password}`, 'utf8').toString('base64')}`;
      const auth = await this.request('authentication', 'POST', AUTH_PATH, { Authorization: authorization, Accept: 'application/json' }, undefined, options);
      if (auth.status !== 200 || typeof auth.body.Token !== 'string' || !auth.body.Token) throw safeError('Catalyst authentication failed');
      token = auth.body.Token;
      const inventory = await this.request('inventory', 'GET', INVENTORY_PATH, { 'X-Auth-Token': token, Accept: 'application/json' }, undefined, options);
      if (inventory.status !== 200) throw safeError('Catalyst inventory request failed');
      return this.normalize(inventory.body);
    } catch (cause) {
      if (cause && /^Catalyst /.test(cause.message || '')) throw cause;
      throw safeError('Catalyst request failed');
    } finally {
      password = '';
      token = '';
    }
  }

  async inventory(options = {}) {
    this.requireTrust();
    const now = clockNow(this.clock);
    if (this.cache && this.cache.expiresAt > now) return clone(this.cache.result);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchInventory(options).then((result) => {
      this.cache = { result: clone(result), expiresAt: clockNow(this.clock) + CACHE_MS };
      return clone(result);
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async runCommand({ command, deviceUuid, signal, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    this.requireTrust();
    if (!SUPPORTED_COMMANDS.includes(command)) throw Object.assign(safeError('Catalyst command is not allowed'), { code: 'catalyst_command_blocked', status: 'BLOCKLISTED' });
    if (!isUuid(deviceUuid)) throw Object.assign(safeError('Catalyst device id is invalid'), { code: 'catalyst_invalid_device_id' });
    const startedAt = new Date(clockNow(this.clock)).toISOString();
    const started = clockNow(this.clock);
    const deadline = started + Math.max(1, Number(timeoutMs) || COMMAND_TIMEOUT_MS);
    let token = '';
    let submittedTaskId = '';
    let submissionAttempted = false;
    const ensureDeadline = () => {
      if (Date.now() >= deadline) throw Object.assign(safeError('Catalyst command status timed out'), { code: 'catalyst_command_unknown', submitted: Boolean(submissionAttempted), taskId: submittedTaskId || undefined, startedAt, elapsedMs: Math.max(0, Date.now() - started) });
      if (signal?.aborted) throw Object.assign(safeError('Catalyst request cancelled'), { code: 'catalyst_aborted', submitted: Boolean(submissionAttempted), taskId: submittedTaskId || undefined, startedAt, elapsedMs: Math.max(0, Date.now() - started) });
    };
    const remaining = () => Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
    try {
      await this.verifyInjectedPin();
      ensureDeadline();
      let password = '';
      try {
        password = await this.getSecret(CATALYST_SECRET_REF);
        if (typeof password !== 'string' || !password) throw safeError('Catalyst credential unavailable');
        const authorization = `Basic ${Buffer.from(`${CATALYST_USERNAME}:${password}`, 'utf8').toString('base64')}`;
        const auth = await this.request('authentication', 'POST', AUTH_PATH, { Authorization: authorization, Accept: 'application/json' }, undefined, { signal, timeoutMs: remaining() });
        if (auth.status !== 200 || typeof auth.body.Token !== 'string' || !auth.body.Token) throw safeError('Catalyst authentication failed');
        token = auth.body.Token;
      } finally { password = ''; }
      ensureDeadline();
      submissionAttempted = true;
      const submission = await this.request('command submission', 'POST', COMMAND_REQUEST_PATH, { 'X-Auth-Token': token, Accept: 'application/json' }, { commands: [command], deviceUuids: [deviceUuid], timeout: Math.max(1, Math.ceil(remaining() / 1000)) }, { signal, timeoutMs: remaining() });
      if (submission.status < 200 || submission.status >= 300 || !submission.body.response || typeof submission.body.response !== 'object' || Array.isArray(submission.body.response)) throw safeError('Catalyst command submission failed');
      submittedTaskId = safeId(submission.body.response.taskId);
      if (!submittedTaskId) throw safeError('Catalyst command submission returned an invalid task id');
      for (let attempt = 0; attempt < MAX_COMMAND_POLL_ATTEMPTS; attempt += 1) {
        ensureDeadline();
        if (attempt) await delay(Math.min(COMMAND_POLL_INTERVAL_MS, remaining()), signal, submittedTaskId);
        ensureDeadline();
        const task = await this.request('command task', 'GET', `${TASK_PATH_PREFIX}${encodeURIComponent(submittedTaskId)}`, { 'X-Auth-Token': token, Accept: 'application/json' }, undefined, { signal, timeoutMs: remaining() });
        if (task.status !== 200 || !task.body.response || typeof task.body.response !== 'object' || Array.isArray(task.body.response)) throw safeError('Catalyst command task failed');
        const taskResponse = task.body.response;
        if (taskResponse.isError === true) return commandResult('FAILURE', '', startedAt, started, { taskId: submittedTaskId });
        let progress = null;
        if (typeof taskResponse.progress === 'string') { try { progress = JSON.parse(taskResponse.progress); } catch { progress = null; } }
        const fileId = safeId(progress?.fileId);
        if (!fileId) continue;
        const output = await this.request('command output', 'GET', `${FILE_PATH_PREFIX}${encodeURIComponent(fileId)}`, { 'X-Auth-Token': token, Accept: 'application/json' }, undefined, { signal, timeoutMs: remaining() });
        if (output.status !== 200) throw safeError('Catalyst command output failed');
        return parseCommandOutput(output.body, deviceUuid, command, startedAt, started, submittedTaskId);
      }
      throw Object.assign(safeError('Catalyst command status timed out'), { code: 'catalyst_command_unknown', submitted: true, taskId: submittedTaskId, startedAt, elapsedMs: Math.max(0, Date.now() - started) });
    } catch (error) {
      if (error?.code === 'catalyst_aborted' || error?.code === 'catalyst_command_unknown') throw error;
      if (error?.code === 'catalyst_command_blocked' || error?.code === 'catalyst_invalid_device_id') throw error;
      throw Object.assign(safeError(error?.message?.startsWith('Catalyst ') ? error.message : 'Catalyst command failed'), { code: 'catalyst_command_failed', submitted: Boolean(submissionAttempted), taskId: submittedTaskId || undefined, startedAt, elapsedMs: Math.max(0, Date.now() - started) });
    } finally { token = ''; }
  }

  command(options = {}) { return this.runCommand(options); }

  async close() {
    this.closed = true;
    this.cache = null;
    try { this.agent?.destroy(); } catch {}
    this.agent = null;
  }
}

function createCatalystClient(options = {}) {
  return new CatalystClient(options);
}

module.exports = {
  AUTH_PATH,
  COMMAND_REQUEST_PATH,
  COMMAND_POLL_INTERVAL_MS,
  COMMAND_TIMEOUT_MS,
  CACHE_MS,
  CATALYST_FINGERPRINT256,
  CATALYST_HOST,
  CATALYST_SECRET_REF,
  CATALYST_TRUST_FILE,
  INVENTORY_PATH,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_POLL_ATTEMPTS,
  MAX_RESPONSE_BYTES,
  SUPPORTED_COMMANDS,
  createCatalystClient,
  createPinnedAgent,
  isUuid
};

function commandResult(status, output, startedAt, started, extra = {}) {
  return { status, output, startedAt, elapsedMs: Math.max(0, clockNow() - started), ...extra };
}

function parseCommandOutput(body, deviceUuid, command, startedAt, started, taskId) {
  if (!Array.isArray(body)) throw safeError('Catalyst command output was malformed');
  const entry = body.find((item) => item && typeof item === 'object' && item.deviceUuid === deviceUuid);
  if (!entry || !entry.commandResponses || typeof entry.commandResponses !== 'object' || Array.isArray(entry.commandResponses)) throw safeError('Catalyst command output was malformed');
  const responses = entry.commandResponses;
  for (const status of ['BLOCKLISTED', 'BLACKLISTED', 'FAILURE']) {
    if (responses[status] && typeof responses[status] === 'object' && Object.hasOwn(responses[status], command)) {
      const value=responses[status][command];
      const output=typeof value==='string'?value:'';
      if(Buffer.byteLength(output,'utf8')>MAX_COMMAND_OUTPUT_BYTES)throw safeError('Catalyst command output exceeded size limit');
      return commandResult(status==='BLACKLISTED'?'BLOCKLISTED':status, output, startedAt, started, {taskId});
    }
  }
  const output = responses.SUCCESS && typeof responses.SUCCESS === 'object' ? responses.SUCCESS[command] : undefined;
  if (typeof output !== 'string') throw safeError('Catalyst command output was malformed');
  if (Buffer.byteLength(output, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) throw safeError('Catalyst command output exceeded size limit');
  return commandResult('SUCCESS', output, startedAt, started, { taskId });
}

function delay(ms, signal, taskId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(Object.assign(safeError('Catalyst request cancelled'), { code: 'catalyst_aborted', submitted: true, taskId })); };
    if (signal) {
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}
