'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'http://127.0.0.1:8767',
  'http://127.0.0.1:8768'
]);
const COMMANDS = Object.freeze({cisco_ios:Object.freeze(require('../network-commands.json').cisco_ios)});
const MAX_TEXT = 10000;
const MAX_SELECTOR = 500;
const MAX_OUTPUT = 200000;
const APPROVAL_TTL_MS = 60 * 1000;
const MAX_APPROVALS = 100;

function now() { return Date.now(); }

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return sha256(JSON.stringify(stable(value)));
}

function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}`;
}

function error(message, status) {
  const result = new Error(message);
  if (status !== undefined) result.status = status;
  return result;
}

function text(value, name, max = 500, required = true) {
  if (value === undefined || value === null) {
    if (!required) return '';
    throw error(`${name} is required`);
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw error(`${name} is invalid`);
  }
  return value.trim();
}

function boundedText(value, name, max = MAX_TEXT) {
  return text(value, name, max, false);
}

function numberInRange(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw error(`${name} is invalid`);
  return number;
}

function originOf(value) {
  if (typeof value !== 'string' || value.length > 300) throw error('browser origin is invalid');
  let parsed;
  try { parsed = new URL(value); } catch { throw error('browser origin is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw error('browser origin is invalid');
  }
  return parsed.origin;
}

function urlOf(value) {
  if (typeof value !== 'string' || value.length > 2000) throw error('browser URL is invalid');
  let parsed;
  try { parsed = new URL(value); } catch { throw error('browser URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw error('browser URL is invalid');
  return parsed.href;
}

function isAllowedUrl(value, allowedOrigins) {
  let parsed;
  try { parsed = new URL(value); } catch { return false; }
  return allowedOrigins.has(parsed.origin);
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function realPathInside(parent, target, { allowMissing = false } = {}) {
  const parentReal = fs.realpathSync(parent);
  const resolved = path.resolve(target);
  let targetReal;
  try {
    targetReal = fs.realpathSync(resolved);
  } catch (cause) {
    if (!allowMissing) throw cause;
    targetReal = resolved;
  }
  if (!isInside(parentReal, targetReal)) throw error('path is outside the managed directory');
  return targetReal;
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  ensureDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function safeArtifactPath(directory, prefix) {
  ensureDirectory(directory);
  return path.join(directory, `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.png`);
}

function explicitApproval(input) {
  return input && (input.explicit === true || input.confirmed === true || input.uiApproved === true || input.approved === true);
}

function cleanWindow(value) {
  if (!value || typeof value !== 'object') throw error('desktop window is invalid');
  const hwnd = numberInRange(value.hwnd, 'desktop hwnd', 1, 0x7fffffff);
  const pid = numberInRange(value.pid, 'desktop pid', 1, 0x7fffffff);
  const processCreationTime = text(String(value.processCreationTime ?? ''), 'desktop process creation time', 200);
  const title = boundedText(value.title, 'desktop title', 500);
  return {
    hwnd,
    pid,
    processCreationTime,
    title,
    className: boundedText(value.className, 'desktop class name', 300)
  };
}

function cleanControl(value) {
  if (!value || typeof value !== 'object') throw error('desktop target control is invalid');
  const controlKind = text(value.controlKind ?? value.control_type ?? value.controlType ?? value.kind, 'desktop control kind', 100);
  const title = boundedText(value.title ?? value.name, 'desktop control title', 500);
  const automationId = boundedText(value.automationId ?? value.automation_id, 'desktop automation id', 200);
  const className = boundedText(value.className ?? value.class_name, 'desktop control class name', 300);
  return { controlKind, title, automationId, className };
}

function validateActionText(value) {
  if (value !== undefined && typeof value !== 'string') throw error('action text is invalid');
  if (typeof value === 'string' && value.length > 2000) throw error('action text is invalid');
  return value === undefined ? undefined : value;
}

function validateNoCoordinates(input) {
  for (const key of ['x', 'y', 'left', 'top', 'right', 'bottom', 'coordinates', 'keys', 'keySequence']) {
    if (input && input[key] !== undefined) throw error('desktop coordinate and global key actions are not allowed');
  }
}

function commandFor(platform, command) {
  const normalizedPlatform = text(platform, 'network platform', 50);
  const allowed = COMMANDS[normalizedPlatform];
  if (!allowed || typeof command !== 'string' || !allowed.includes(command)) throw error('network command is not allowed');
  if (/\r|\n|[|;&`$<>]/.test(command)) throw error('network command is not allowed');
  return { platform: normalizedPlatform, command };
}

function validHost(host) {
  if (typeof host !== 'string' || host.length < 1 || host.length > 253 || /\s/.test(host)) return false;
  const candidate = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIP(candidate)) return true;
  if (candidate.includes('..') || candidate.startsWith('.') || candidate.endsWith('.')) return false;
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(candidate);
}

async function runPython({ pythonPath, scriptPath, root, payload, signal }) {
  signal?.throwIfAborted();
  if (!fs.existsSync(pythonPath)) throw error('python runtime unavailable');
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let timer;
    const child = spawn(pythonPath, [scriptPath], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child.kill(); } catch {}
      signal?.removeEventListener('abort', onAbort);
      reject(Object.assign(error(message), {submitted: payload.operation === 'read'}));
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) fail('python runtime returned malformed output');
    });
    child.stderr.resume();
    child.once('error', () => fail('python runtime unavailable'));
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) return fail('python runtime action failed');
      const trimmed = stdout.trim();
      if (!trimmed) return fail('python runtime returned malformed output');
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(parsed);
      } catch { fail('python runtime returned malformed output'); }
    });
    const onAbort = () => fail('python runtime cancelled');
    signal?.addEventListener('abort', onAbort, {once:true});
    child.stdin.on('error',()=>fail('python runtime unavailable'));
    try {
      child.stdin.end(`${JSON.stringify(payload)}\n`);
    } catch { fail('python runtime unavailable'); }
    timer = setTimeout(() => fail('python runtime timed out'), 30000);
  });
}

class ExecutionAdapters {
  constructor(options = {}) {
    if (!options || typeof options !== 'object') throw error('adapter options are required');
    this.root = fs.realpathSync(path.resolve(options.root || process.cwd()));
    this.runtimeDirectory = path.resolve(options.runtimeDirectory || path.join(this.root, '.intentgraph', 'runtime'));
    ensureDirectory(this.runtimeDirectory);
    this.adapterDirectory = path.join(this.runtimeDirectory, 'adapters');
    ensureDirectory(this.adapterDirectory);
    this.pythonPath = path.resolve(options.pythonPath || path.join(this.runtimeDirectory, 'python', 'Scripts', 'python.exe'));
    this.getSecret = typeof options.getSecret === 'function' ? options.getSecret : async () => undefined;
    this.pythonRunner = typeof options.pythonRunner === 'function' ? options.pythonRunner : null;
    this.browserExecutable = options.browserExecutable ? path.resolve(options.browserExecutable) : undefined;
    this.allowedOrigins = new Set((options.allowedOrigins || DEFAULT_ALLOWED_ORIGINS).map(originOf));
    this.pages = new Map();
    this.browser = null;
    this.browserContext = null;
    this.browserContextId = null;
    this.browserMutationPage = null;
    this.pending = new Map();
    this.desktopCatalog = new Map();
    this.selectedWindow = null;
    this.closed = false;
  }

  status() {
    let profileCount = 0;
    let profileError = false;
    try { profileCount = this.readProfiles().length; } catch { profileError = true; }
    return {
      browser: {
        available: this.playwrightAvailable(),
        connected: Boolean(this.browserContext),
        allowedOrigins: Array.from(this.allowedOrigins),
        pages: Array.from(this.pages.values()).map((entry) => {
          let url = '';
          try { url = entry.page.url(); } catch {}
          return { pageId: entry.pageId, url };
        })
      },
      desktop: {
        available: Boolean(this.pythonRunner || (process.platform === 'win32' && fs.existsSync(this.pythonPath))),
        selectedWindow: clone(this.selectedWindow),
        mode: 'selected-window-only'
      },
      network: {
        available: Boolean(this.pythonRunner || fs.existsSync(this.pythonPath)),
        framework: 'Nornir + Netmiko',
        connectionStatus: profileCount ? 'configured; SSH reachability not verified by status' : 'no SSH profiles configured',
        profileCount,
        profileError,
        supportedPlatforms: Object.keys(COMMANDS),
        mode: 'explicit-read-only'
      }
    };
  }

  playwrightAvailable() {
    try { require.resolve('playwright'); return true; } catch {
      try { require.resolve('playwright-core'); return true; } catch { return false; }
    }
  }

  async action(input = {}) {
    if (this.closed) throw error('execution adapters are closed');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('adapter action is invalid');
    const type = text(input.type, 'adapter action type', 100);
    switch (type) {
      case 'browser.open': return this.browserOpen(input);
      case 'browser.inspect': return this.browserInspect(input);
      case 'browser.preview': return this.browserPreview(input);
      case 'browser.execute': return this.browserExecute(input);
      case 'desktop.windows': return this.desktopWindows();
      case 'desktop.select': return this.desktopSelect(input);
      case 'desktop.inspect': return this.desktopInspect();
      case 'desktop.preview': return this.desktopPreview(input);
      case 'desktop.execute': return this.desktopExecute(input);
      case 'network.profiles': return this.networkProfiles();
      case 'network.profile.list': return this.networkProfiles();
      case 'network.profile.add': return this.networkProfileConfigure(input);
      case 'network.profile.configure': return this.networkProfileConfigure(input);
      case 'network.read': return this.networkRead(input);
      case 'network.run': return this.networkRead(input);
      case 'network.execute': return this.networkRead(input);
      default: throw error(`unsupported adapter action ${type}`);
    }
  }

  async ensureBrowserContext() {
    if (this.browserContext) return this.browserContext;
    let playwright;
    try { playwright = require('playwright'); } catch {
      try { playwright = require('playwright-core'); } catch { throw error('browser runtime unavailable'); }
    }
    if (!playwright || !playwright.chromium) throw error('browser runtime unavailable');
    try {
      const launchOptions = { headless: true };
      if (this.browserExecutable) {
        launchOptions.executablePath = this.browserExecutable;
        // Playwright 1.49 with installed Chrome can reject the legacy
        // headless flag. Keep the browser owned while using Chrome's current
        // headless mode for the explicitly supplied executable.
        launchOptions.ignoreDefaultArgs = ['--headless'];
        launchOptions.args = ['--headless=new'];
      }
      this.browser = await playwright.chromium.launch(launchOptions);
      this.browserContext = await this.browser.newContext({ storageState: undefined });
      this.browserContextId = randomId('browser-context');
      await this.browserContext.route('**/*', (route) => {
        const request = route.request();
        const requestUrl = request.url();
        if (!isAllowedUrl(requestUrl, this.allowedOrigins)) return route.abort('blockedbyclient');
        const method = request.method().toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
        try {
          if (this.browserMutationPage && request.frame().page() === this.browserMutationPage) return route.continue();
        } catch {}
        return route.abort('blockedbyclient');
      });
      return this.browserContext;
    } catch {
      try { await this.browserContext?.close(); } catch {}
      try { await this.browser?.close(); } catch {}
      this.browserContext = null;
      this.browser = null;
      this.browserContextId = null;
      throw error('browser runtime unavailable');
    }
  }

  trackPage(page) {
    const pageId = randomId('page');
    const entry = { pageId, page, contextId: this.browserContextId };
    this.pages.set(pageId, entry);
    page.once('close', () => this.pages.delete(pageId));
    return entry;
  }

  browserPage(input, required = true) {
    let pageId = input && input.pageId;
    if (!pageId && this.pages.size === 1) pageId = this.pages.keys().next().value;
    if (!pageId) { if (required) throw error('browser page is required'); return null; }
    const entry = this.pages.get(String(pageId));
    if (!entry || !entry.page || entry.page.isClosed() || entry.contextId !== this.browserContextId) throw error('browser page is unavailable');
    return entry;
  }

  async browserOpen(input) {
    const url = urlOf(input.url);
    if (!isAllowedUrl(url, this.allowedOrigins)) throw error('browser URL origin is not allowed');
    const context = await this.ensureBrowserContext();
    let page;
    try {
      page = await context.newPage();
      const entry = this.trackPage(page);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (!isAllowedUrl(page.url(), this.allowedOrigins)) throw error('browser navigation origin is not allowed');
      return { pageId: entry.pageId, url: page.url(), contextId: entry.contextId, mode: 'inspect-only' };
    } catch (cause) {
      try { await page?.close(); } catch {}
      if (cause && cause.message === 'browser navigation origin is not allowed') throw cause;
      throw error('browser navigation failed');
    }
  }

  async browserInspect(input) {
    const entry = this.browserPage(input);
    if (!isAllowedUrl(entry.page.url(), this.allowedOrigins)) throw error('browser page origin is not allowed');
    let html = '';
    let bodyText = '';
    try { html = (await entry.page.content()).slice(0, 50000); } catch { throw error('browser inspection failed'); }
    try { bodyText = (await entry.page.locator('body').innerText({ timeout: 2000 })).slice(0, MAX_TEXT); } catch {}
    const screenshotPath = safeArtifactPath(this.adapterDirectory, 'browser');
    try { await entry.page.screenshot({ path: screenshotPath, fullPage: false, timeout: 5000 }); } catch { throw error('browser inspection failed'); }
    return {
      pageId: entry.pageId,
      url: entry.page.url(),
      text: bodyText,
      dom: html,
      screenshotPath,
      bounded: { maxText: MAX_TEXT, maxDom: 50000 }
    };
  }

  async browserTarget(entry, input) {
    const kind = text(input.kind, 'browser action kind', 20);
    if (!['click', 'fill'].includes(kind)) throw error('browser action kind is invalid');
    const selector = text(input.selector, 'browser selector', MAX_SELECTOR);
    if (/javascript\s*:/i.test(selector)) throw error('browser selector is invalid');
    const actionText = validateActionText(input.text);
    if (kind === 'fill' && actionText === undefined) throw error('browser fill text is required');
    if (kind === 'click' && actionText !== undefined) throw error('browser click text is invalid');
    const locator = entry.page.locator(selector);
    let count;
    try { count = await locator.count(); } catch { throw error('browser target is unavailable'); }
    if (count !== 1) throw error('browser target must match exactly one element');
    const first = locator.first();
    let detail;
    try {
      const [visible, enabled, role, type, ariaLabel, title, value, label] = await Promise.all([
        first.isVisible().catch(() => false),
        first.isEnabled().catch(() => false),
        first.getAttribute('role'), first.getAttribute('type'), first.getAttribute('aria-label'),
        first.getAttribute('title'), first.getAttribute('value'), first.textContent().catch(() => '')
      ]);
      detail = {
        kind, selector, pageId: entry.pageId, url: entry.page.url(), matchCount: count,
        visible, enabled,
        element: {
          role: boundedText(role, 'browser role', 100),
          type: boundedText(type, 'browser type', 100),
          ariaLabel: boundedText(ariaLabel, 'browser aria label', 300),
          title: boundedText(title, 'browser title', 300),
          value: boundedText(value, 'browser value', 500),
          label: boundedText(label, 'browser label', 500)
        }
      };
    } catch { throw error('browser target inspection failed'); }
    return { kind, selector, text: actionText, detail };
  }

  async browserPreview(input) {
    const entry = this.browserPage(input);
    if (!isAllowedUrl(entry.page.url(), this.allowedOrigins)) throw error('browser page origin is not allowed');
    const target = await this.browserTarget(entry, input);
    const action = { adapter: 'browser', pageId: entry.pageId, contextId: entry.contextId, url: entry.page.url(), kind: target.kind, selector: target.selector, text: target.text };
    const approvalId = randomId('approval');
    const expiresAt = now() + APPROVAL_TTL_MS;
    const record = { approvalId, adapter: 'browser', action, actionDigest: digest(action), expiresAt };
    this.saveApproval(record);
    return { approvalId, token: approvalId, actionDigest: record.actionDigest, expiresAt, ttlMs: APPROVAL_TTL_MS, detail: { ...target.detail, actionText: target.text } };
  }

  saveApproval(record) {
    for (const [key, value] of this.pending) if (value.expiresAt <= now()) this.pending.delete(key);
    while (this.pending.size >= MAX_APPROVALS) this.pending.delete(this.pending.keys().next().value);
    this.pending.set(record.approvalId, record);
  }

  consumeApproval(input, adapter) {
    const approvalId = text(input.approvalId ?? input.token, 'approvalId', 200);
    const record = this.pending.get(approvalId);
    if (!record || record.adapter !== adapter) throw error('approval is invalid or expired');
    this.pending.delete(approvalId);
    if (record.expiresAt <= now()) throw error('approval is invalid or expired');
    return record;
  }

  async browserExecute(input) {
    const record = this.consumeApproval(input, 'browser');
    const entry = this.pages.get(record.action.pageId);
    if (!entry || entry.contextId !== this.browserContextId || entry.page.isClosed()) throw error('browser page is unavailable');
    if (entry.page.url() !== record.action.url || !isAllowedUrl(entry.page.url(), this.allowedOrigins)) throw error('browser approval context changed');
    const target = await this.browserTarget(entry, record.action);
    if (target.kind !== record.action.kind || target.selector !== record.action.selector || target.text !== record.action.text) throw error('browser approval target changed');
    const locator = entry.page.locator(record.action.selector).first();
    this.browserMutationPage = entry.page;
    try {
      if (record.action.kind === 'click') await locator.click({ timeout: 5000 });
      else await locator.fill(record.action.text, { timeout: 5000 });
    } catch { throw error('browser action failed'); }
    finally { this.browserMutationPage = null; }
    return { executed: true, adapter: 'browser', pageId: entry.pageId, kind: record.action.kind, actionDigest: record.actionDigest, url: entry.page.url() };
  }

  async python(worker, payload, signal) {
    signal?.throwIfAborted();
    const scriptPath = path.join(__dirname, worker);
    if (this.pythonRunner) {
      try { return await this.pythonRunner(worker, clone(payload)); } catch (cause) {
        if (cause && /^python runtime/.test(cause.message || '')) throw cause;
        throw error(`${worker.startsWith('desktop') ? 'desktop' : 'network'} runtime action failed`);
      }
    }
    return runPython({ pythonPath: this.pythonPath, scriptPath, root: this.root, payload, signal });
  }

  validatePythonResult(result, label) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw error(`${label} runtime returned malformed output`);
    if (result.ok !== true) throw error(`${label} runtime action failed`);
    return result;
  }

  async desktopWindows() {
    const result = this.validatePythonResult(await this.python('desktop.py', { operation: 'windows' }), 'desktop');
    if (!Array.isArray(result.windows) || result.windows.length > 100) throw error('desktop runtime returned malformed output');
    const windows = result.windows.map(cleanWindow);
    this.desktopCatalog.clear();
    for (const window of windows) this.desktopCatalog.set(this.windowKey(window), window);
    return { windows, bounded: { maxWindows: 100, titlesOnly: true } };
  }

  windowKey(window) { return `${window.hwnd}:${window.pid}:${window.processCreationTime}`; }

  async desktopSelect(input) {
    validateNoCoordinates(input);
    const candidate = cleanWindow(input.window || input);
    const listed = this.desktopCatalog.get(this.windowKey(candidate));
    if (!listed) throw error('desktop window is not owned by this adapter');
    const result = this.validatePythonResult(await this.python('desktop.py', { operation: 'select', window: listed }), 'desktop');
    const selected = cleanWindow(result.window || listed);
    if (this.windowKey(selected) !== this.windowKey(listed)) throw error('desktop window selection changed');
    this.selectedWindow = selected;
    return { selectedWindow: clone(selected) };
  }

  requireSelectedWindow() {
    if (!this.selectedWindow) throw error('desktop window is not selected');
    return this.selectedWindow;
  }

  async desktopInspect() {
    const selected = this.requireSelectedWindow();
    const screenshotPath = safeArtifactPath(this.adapterDirectory, 'desktop');
    const result = this.validatePythonResult(await this.python('desktop.py', { operation: 'inspect', window: selected, screenshotPath, artifactDirectory: this.adapterDirectory }), 'desktop');
    if (!Array.isArray(result.controls) || result.controls.length > 100) throw error('desktop runtime returned malformed output');
    const controls = result.controls.map((control) => {
      if (!control || typeof control !== 'object' || Array.isArray(control)) throw error('desktop runtime returned malformed output');
      const normalized = cleanControl(control);
      for (const key of ['enabled', 'visible']) if (control[key] !== undefined && typeof control[key] !== 'boolean') throw error('desktop runtime returned malformed output');
      return { ...normalized, enabled: control.enabled === true, visible: control.visible === true, depth: numberInRange(control.depth ?? 0, 'desktop control depth', 0, 10) };
    });
    const returnedScreenshot = result.screenshotPath || screenshotPath;
    let safeScreenshot;
    try { safeScreenshot = realPathInside(this.adapterDirectory, returnedScreenshot); } catch { throw error('desktop runtime returned malformed output'); }
    if (!fs.existsSync(safeScreenshot) || !fs.statSync(safeScreenshot).isFile() || path.extname(safeScreenshot).toLowerCase() !== '.png') throw error('desktop runtime returned malformed output');
    return { selectedWindow: clone(selected), controls, screenshotPath: safeScreenshot, bounded: { maxControls: 100 } };
  }

  async desktopPreview(input) {
    validateNoCoordinates(input);
    const selected = this.requireSelectedWindow();
    const control = cleanControl(input.targetControl || input.control || input);
    const actionKind = text(input.kind, 'desktop action kind', 20);
    if (!['click', 'fill'].includes(actionKind)) throw error('desktop action kind is invalid');
    const actionText = validateActionText(input.text);
    if (actionKind === 'fill' && actionText === undefined) throw error('desktop fill text is required');
    if (actionKind === 'click' && actionText !== undefined) throw error('desktop click text is invalid');
    const result = this.validatePythonResult(await this.python('desktop.py', { operation: 'preview', window: selected, control, kind: actionKind, text: actionText }), 'desktop');
    if (result.detail !== undefined && (!result.detail || typeof result.detail !== 'object' || Array.isArray(result.detail))) throw error('desktop runtime returned malformed output');
    const action = { adapter: 'desktop', window: selected, control, kind: actionKind, text: actionText };
    const approvalId = randomId('approval');
    const expiresAt = now() + APPROVAL_TTL_MS;
    const record = { approvalId, adapter: 'desktop', action, actionDigest: digest(action), expiresAt };
    this.saveApproval(record);
    return { approvalId, token: approvalId, actionDigest: record.actionDigest, expiresAt, ttlMs: APPROVAL_TTL_MS, detail: { ...(clone(result.detail || { window: selected, control, kind: actionKind })), actionText } };
  }

  async desktopExecute(input) {
    const record = this.consumeApproval(input, 'desktop');
    const selected = this.requireSelectedWindow();
    if (digest(selected) !== digest(record.action.window)) throw error('desktop approval window changed');
    const result = this.validatePythonResult(await this.python('desktop.py', {
      operation: 'execute', window: selected, control: record.action.control, kind: record.action.kind, text: record.action.text
    }), 'desktop');
    if (result.result !== undefined && (!result.result || typeof result.result !== 'object' || Array.isArray(result.result))) throw error('desktop runtime returned malformed output');
    return { executed: true, adapter: 'desktop', selectedWindow: clone(selected), actionDigest: record.actionDigest, result: clone(result.result || {}) };
  }

  profilesPath() { return path.join(this.adapterDirectory, 'profiles.json'); }

  readProfiles() {
    const filePath = this.profilesPath();
    if (!fs.existsSync(filePath)) return [];
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw error('network profiles are invalid');
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > 1024 * 1024) throw error('network profiles are invalid');
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw error('network profiles are invalid'); }
    const values = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.profiles) ? parsed.profiles : null;
    if (!values || values.length > 100) throw error('network profiles are invalid');
    return values.map((profile) => this.cleanProfile(profile));
  }

  cleanProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('network profile is invalid');
    const id = text(value.id, 'network profile id', 100);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id)) throw error('network profile id is invalid');
    const host = text(value.host, 'network host', 253);
    if (!validHost(host)) throw error('network host is invalid');
    const port = numberInRange(value.port ?? 22, 'network port', 1, 65535);
    const platform = text(value.platform, 'network platform', 50);
    if (!COMMANDS[platform]) throw error('network platform is unsupported');
    const username = text(value.username, 'network username', 200);
    const credentialRef = text(value.credentialRef, 'network credential reference', 300);
    if (!/^network-[a-z0-9-]+$/.test(credentialRef)) throw error('network credential reference is invalid');
    const knownHosts = text(value.knownHosts, 'network known hosts path', 1000);
    const resolvedKnownHosts = this.resolveKnownHosts(knownHosts);
    return { id, host, port, platform, username, credentialRef, knownHosts, resolvedKnownHosts };
  }

  resolveKnownHosts(value) {
    const candidates = path.isAbsolute(value)
      ? [path.resolve(value)]
      : [path.resolve(this.root, value), path.resolve(this.adapterDirectory, value)];
    let resolved;
    for (const candidate of candidates) {
      try {
        resolved = realPathInside(this.root, candidate);
        break;
      } catch {}
    }
    if (!resolved) throw error('network known hosts file is unavailable');
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw error('network known hosts file is unavailable');
    return resolved;
  }

  async networkProfiles() {
    const profiles = this.readProfiles();
    return { profiles: profiles.map(({ resolvedKnownHosts, ...profile }) => profile), explicitConfigurationRequired: true };
  }

  async networkProfileConfigure(input) {
    if (!explicitApproval(input)) throw error('network profile configuration requires explicit UI approval');
    const raw = input.profile || input;
    const profile = this.cleanProfile(raw);
    const profiles = this.readProfiles();
    const next = profiles.filter((item) => item.id !== profile.id).map(({ resolvedKnownHosts, ...item }) => item);
    const { resolvedKnownHosts, ...persisted } = profile;
    next.push(persisted);
    writeJsonAtomic(this.profilesPath(), { profiles: next });
    return { profile: persisted, profileCount: next.length };
  }

  async networkRead(input, {signal} = {}) {
    signal?.throwIfAborted();
    const profileId = text(input.profileId ?? input.profile, 'network profile id', 100);
    if (typeof input.command !== 'string' || input.command.length > 200 || input.command !== input.command.trim()) throw error('network command is not allowed');
    const command = input.command;
    const profiles = this.readProfiles();
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) throw error('network profile is unavailable');
    const selectedCommand = commandFor(profile.platform, command);
    let secret;
    try { secret = await this.getSecret(profile.credentialRef); } catch { throw error('network credential unavailable'); }
    if (typeof secret !== 'string' || !secret) throw error('network credential unavailable');
    const payload = {
      operation: 'read',
      profile: {
        host: profile.host, port: profile.port, platform: profile.platform,
        username: profile.username, knownHosts: profile.resolvedKnownHosts
      },
      command: selectedCommand.command,
      password: secret
    };
    let result;
    try {
      result = await this.python('network.py', payload, signal);
      if (result?.ok !== true) throw Object.assign(error('network runtime action failed'), {submitted:result?.submitted===true, status:result?.status});
    } finally { payload.password = ''; }
    if (typeof result.output !== 'string' || result.output.length > MAX_OUTPUT) throw Object.assign(error('network runtime returned malformed output'),{submitted:true});
    if (result.output.includes(secret)) throw Object.assign(error('network runtime returned malformed output'),{submitted:true});
    return { profileId: profile.id, platform: profile.platform, command: selectedCommand.command, output: result.output, bounded: { maxOutput: MAX_OUTPUT } };
  }

  async close() {
    this.closed = true;
    this.pending.clear();
    this.pages.clear();
    this.desktopCatalog.clear();
    this.selectedWindow = null;
    const context = this.browserContext;
    const browser = this.browser;
    this.browserContext = null;
    this.browser = null;
    this.browserContextId = null;
    this.browserMutationPage = null;
    try { await context?.close(); } catch {}
    try { await browser?.close(); } catch {}
  }
}

module.exports = {
  APPROVAL_TTL_MS,
  COMMANDS,
  DEFAULT_ALLOWED_ORIGINS,
  ExecutionAdapters,
  runPython,
  stable,
  digest
};
