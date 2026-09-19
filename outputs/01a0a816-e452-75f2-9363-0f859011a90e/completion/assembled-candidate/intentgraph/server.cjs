'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { IndexStore, isInside, normalizeRelative } = require('./indexer.cjs');
const { IntentEngine } = require('./engine.cjs');
const { createChatReadApi } = require('./chat-read-api.cjs');
const { createGitWorkspace, createGitWorkspaceApi } = require('./git-workspace.cjs');
const { createClarificationRunManager } = require('./clarification-runtime.cjs');
const { createWorkflowApi } = require('./clarification-server-adapter.cjs');
const { createProviderSelection, resolveSelection, DEFAULT_SELECTION } = require('./provider-selection.cjs');
const { createProviderRuntimeConfig, readProviderConfig, writeProviderConfig, DEFAULT_CREDENTIAL_REFS, normalizeProviderConfigRequest } = require('./provider-runtime-config.cjs');
const { getSecret, setSecret, hasSecret } = require('./vault.cjs');
const { createReliabilityLedger } = require('./reliability.cjs');
const { FileStorage } = require('./reliability-storage.cjs');

const DEFAULT_PORT = 8768;
const DEFAULT_HOST = '127.0.0.1';
const BODY_LIMIT = 2 * 1024 * 1024;
const MAX_STEERING_MESSAGES = 8;
const MAX_STEERING_MESSAGE_CHARS = 4000;
const CHAT_MODES = Object.freeze(['inspect', 'plan']);
const ALLOWED_STATIC_EXTENSIONS = new Set(['.html', '.css', '.js', '.cjs', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ico']);

function jsonHeaders() {
  return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...jsonHeaders(), 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res, status, error, reasons) {
  const list = reasons || error.reasons || (error.message ? [error.message] : ['request failed']);
  sendJson(res, status, { error: error.code || error.message || 'request failed', reasons: list });
}

function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const raw = String(hostHeader).trim();
  const host = raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : raw.split(':')[0];
  const normalized = host.toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function originAllowed(origin, req) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return false;
    const requestHost = String(req.headers.host || '').trim();
    const requestRaw = requestHost.startsWith('[') ? requestHost.slice(1, requestHost.indexOf(']')) : requestHost.split(':')[0];
    if (host !== requestRaw.toLowerCase()) return false;
    const port = parsed.port || '80';
    const localPort = String(req.socket.localPort || DEFAULT_PORT);
    return port === localPort;
  } catch { return false; }
}

function chatOriginAllowed(origin, req) {
  return origin === 'http://127.0.0.1:8767' || origin === `http://127.0.0.1:${req.socket.localPort}`;
}
const WORKSPACE_UI_ORIGIN='http://127.0.0.1:8767';
const WORKSPACE_READ_OPERATIONS=new Set(['browser.inspect','desktop.windows','desktop.select','desktop.inspect','network.profiles']);
function workspaceOriginAllowed(origin,req){return origin===WORKSPACE_UI_ORIGIN||origin==='http://127.0.0.1:'+req.socket.localPort;}
function workspaceCors(req,res){const origin=req.headers.origin;if(!workspaceOriginAllowed(origin,req)){sendError(res,403,new Error('Workspace origin is not allowed'));return false;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','X-Aven-Workspace, X-Aven-Workspace-Token, Content-Type');res.writeHead(204);res.end();return false;}return true;}
function workspaceConnectCors(req,res){const origin=req.headers.origin;if(origin!==WORKSPACE_UI_ORIGIN){sendError(res,403,new Error('Workspace connection origin is not allowed'));return false;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','X-Aven-Workspace, Content-Type');res.writeHead(204);res.end();return false;}return true;}
function workspaceTokenAllowed(req,workspaceToken,expiresAt){return Number.isFinite(expiresAt)&&Date.now()<expiresAt&&sameSecret(req.headers['x-aven-workspace-token'],workspaceToken);}
function workspaceScopeAllowed(scope,type){const needed=type.startsWith('browser.')?'browser':type.startsWith('desktop.')?'computer':'workspace';return scope==='workspace'||scope===needed;}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSteeringRun(runId, chatId, steeringToken) {
  let phase = 'open';
  let acceptedCount = 0;
  const queue = [];
  return {
    runId,
    chatId,
    steeringToken,
    get phase() { return phase; },
    beginClosing() { if (phase === 'open') phase = 'closing'; },
    drainSteering() {
      if (phase !== 'open' || !queue.length) return [];
      return queue.splice(0, queue.length);
    },
    close() {
      if (phase === 'closed') return [];
      phase = 'closed';
      return queue.splice(0, queue.length);
    },
    accept(text) {
      if (phase !== 'open') return { accepted: false, reason: 'closing' };
      if (acceptedCount >= MAX_STEERING_MESSAGES) return { accepted: false, reason: 'full' };
      const id = crypto.randomUUID();
      acceptedCount += 1;
      queue.push({ id, message: text });
      return { accepted: true, id };
    },
    matchesToken(value) { return sameSecret(value, steeringToken); }
  };
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.cjs': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        reject(Object.assign(new Error('request body exceeds size cap'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) { reject(Object.assign(new Error('request body must be valid JSON'), { statusCode: 400, cause: error })); }
    });
    req.on('error', reject);
  });
}

function createServer(options = {}) {
  const root = fs.realpathSync(path.resolve(options.root || path.resolve(__dirname, '..')));
  const runtimeDirectory = path.resolve(options.runtimeDirectory || path.join(root, '.intentgraph', 'runtime'));
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const hub = new Set();
  const token = crypto.randomBytes(32).toString('base64url');
  let workspaceToken = '';
  let workspaceTokenExpiresAt = 0;
  let workspaceTokenScope = '';
  const indexer = new IndexStore(root, runtimeDirectory);
  const engine = new IntentEngine(root, indexer, runtimeDirectory);
  const ready = engine.initialize();
  const sandbox = options.sandbox || require('./catalyst.cjs').createCatalystClient({runtimeDirectory});
  const execution = options.execution === false ? null : require('./execution-service.cjs').createExecutionService({root,engine,runtimeDirectory,...(options.executionOptions||{})});
  const networkExecution = execution?.adapters ? require('./network-execution.cjs').createNetworkExecution({catalyst:sandbox,adapters:execution.adapters}) : sandbox;
  const persistedProviderConfig = readProviderConfig(runtimeDirectory);
  const configuredProviderRecords = options.providerConfigs === undefined ? persistedProviderConfig.providers : options.providerConfigs;
  const providerRuntimeOptions = { runtimeDirectory, getKey: options.getProviderKey, getVaultKey: async (credentialRef) => getSecret(credentialRef), fetchImpl: options.providerFetch, modelFactory: options.providerModelFactory };
  let providerRuntime = options.providerRuntime || ((options.providerConfigs !== undefined || persistedProviderConfig.loaded) ? createProviderRuntimeConfig({ ...providerRuntimeOptions, providers: configuredProviderRecords }) : null);
  const providerSelection = createProviderSelection({
    defaultSelection: DEFAULT_SELECTION,
    getCapabilities: async () => {
      if (typeof options.getProviderCapabilities === 'function') return options.getProviderCapabilities();
      if (providerRuntime?.capabilities) return providerRuntime.capabilities();
      if (options.providerCapabilities && typeof options.providerCapabilities === 'object') return options.providerCapabilities;
      const current = execution ? await execution.status() : null;
      const state = current?.provider || {};
      const connected = state.last?.ok === true;
      const configured = state.credentialStored === true;
      const status = connected ? 'connected' : configured ? 'configured' : 'unknown';
      return { checkedAt: connected || configured ? new Date().toISOString() : null, providers: [{ id: 'opencode', status, connected, configured, reason: connected ? '' : 'OpenCode connection has not been verified.', models: [{ id: 'mimo-v2.5', status, efforts: ['none'], reason: connected ? '' : 'Model availability follows the unverified OpenCode connection.' }] }] };
    }
  });
  let watcher = null;
  let periodic = null;
  let debounce = null;
  let chatPending = false;
  const concurrentRuns = options.allowConcurrentRuns !== false;
  const serverOwnerId=`service-${process.pid}-${crypto.randomUUID()}`;
  const reliabilityStorage=new FileStorage(path.join(runtimeDirectory,'reliability'));
  const reliability = createReliabilityLedger({storage:reliabilityStorage,namespace:'chat',ownerId:serverOwnerId,concurrency:concurrentRuns?'per-chat':'single'});
  const activeRuns = new Map();
  const sandboxCommandRuns = new Map();
  const ownerProcessAlive=ownerId=>{const match=/^service-(\d+)-/.exec(String(ownerId||''));if(!match)return true;try{process.kill(Number(match[1]),0);return true;}catch(error){return error.code==='EPERM';}};
  const recoverAbandonedReliability=()=>{const state=reliability.snapshot(),owners=new Set();for(const run of Object.values(state.runs))if(['RUNNING','CANCELLING','WAITING'].includes(run.status)&&/^service-\d+-/.test(run.ownerId)&&!ownerProcessAlive(run.ownerId))owners.add(run.ownerId);for(const queue of Object.values(state.queues))for(const item of queue.items)if(item.status==='claimed'&&/^service-\d+-/.test(item.claim?.ownerId||'')&&!ownerProcessAlive(item.claim.ownerId))owners.add(item.claim.ownerId);let count=0;for(const ownerId of owners)count+=reliability.recover({authorized:true,ownerId}).count;return {recovered:count>0,count,owners:[...owners]};};
  const recoverReliability=(recoveryOptions={})=>reliability.recover(recoveryOptions);
  const chatReadApi = createChatReadApi({
    root,
    getExecutionStatus: () => execution ? execution.status() : null,
    getActiveRuns: () => Array.from(activeRuns.values()),
    chatOriginAllowed
  });
  const trustedGitPaths = process.platform === 'win32' ? {gitPath:'C:/Program Files/Git/cmd/git.exe',ghPath:'C:/Program Files/GitHub CLI/gh.exe'} : {gitPath:'/usr/bin/git',ghPath:'/usr/bin/gh'};
  const gitWorkspace = options.gitWorkspace || createGitWorkspace({ runtimeDirectory, ...trustedGitPaths, ...(options.gitWorkspaceOptions || {}) });
  const gitApi = createGitWorkspaceApi({ workspace: gitWorkspace });

  const publish = (event) => {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of hub) {
      try { response.write(message); } catch { hub.delete(response); }
    }
  };
  const workflowManagerOwned = !options.clarificationManager;
  const workflowManager = options.clarificationManager || createClarificationRunManager({
    workflow: options.approvalWorkflow,
    workflowOptions: { storagePath: options.workflowStoragePath || path.join(runtimeDirectory, 'workflow-approval.json'), ...(options.workflowOptions || {}) },
    responder: options.clarificationResponder || options.chatResponder,
    onEvent: publish,
    onStatus: state=>{
      const prior=reliability.getRun(state.runId);
      if(state.terminal&&prior?.status==='WAITING'){
        const statuses=[];const visit=value=>{if(!value||typeof value!=='object')return;if(typeof value.status==='string')statuses.push(value.status.toUpperCase());for(const key of ['evidence','events'])if(Array.isArray(value[key]))value[key].forEach(visit);};visit(state.result);
        const status=state.status!=='completed'?'UNKNOWN':statuses.includes('UNKNOWN')?'UNKNOWN':statuses.some(x=>['FAILURE','BLOCKLISTED','NOT_EXECUTED'].includes(x))?'FAILURE':'SUCCESS';
        reliability.settleRun(state.runId,status,{chatId:state.chatId},{ownerId:serverOwnerId,idempotencyKey:'workflow.settle:'+state.runId+':'+status});
        try{
          const filename=path.join(root,'.intentgraph','evidence','runs',state.runId+'.json');
          const previous=JSON.parse(fs.readFileSync(filename,'utf8'));
          if(previous.runId!==state.runId||previous.chatId!==state.chatId)throw Error('Run evidence ownership mismatch');
          const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:token|credential|password|secret|authorization)$/i.test(key)).map(([key,item])=>[key,clean(item)])):value;
          const reply=clean({...state.result,runId:state.runId,mode:state.mode,status});
          const event={type:'workflow_settled',runId:state.runId,at:new Date().toISOString(),status,events:clean(state.events||[])};
          const next={...previous,initialReply:previous.initialReply||previous.reply,reply,events:[...(previous.events||[]),event].slice(-100)};
          const encoded=JSON.stringify(next,null,2);if(Buffer.byteLength(encoded)>8*1024*1024)throw Error('Run evidence storage limit exceeded');
          const temporary=filename+'.tmp-'+crypto.randomUUID();fs.writeFileSync(temporary,encoded,{flag:'wx'});fs.renameSync(temporary,filename);
        }catch(error){console.error('Workflow evidence could not be saved',error.code||error.message);}
      }
      options.onWorkflowStatus?.(state);
    }
  });
  const workflowApi = createWorkflowApi({ manager: workflowManager, originAllowed: chatOriginAllowed });
  engine.subscribe(publish);

  function scheduleRefresh(reason) {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      engine.refresh(reason).catch(() => undefined);
    }, 250);
  }

  function startWatchers() {
    if (watcher || periodic) return;
    try {
      watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const normalized = normalizeRelative(String(filename));
        if (normalized.startsWith('.intentgraph/runtime/')) return;
        scheduleRefresh('watch');
      });
      watcher.on('error', () => { watcher = null; });
    } catch { watcher = null; }
    periodic = setInterval(() => scheduleRefresh('periodic-rescan'), Number(options.rescanMs || 5000));
    periodic.unref?.();
  }

  function closeWatchers() {
    if (debounce) clearTimeout(debounce);
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    if (periodic) clearInterval(periodic);
    periodic = null;
    for (const response of hub) { try { response.end(); } catch {} }
    hub.clear();
  }

  async function staticFile(res, requestPath) {
    const uiRoot = path.join(__dirname, 'ui');
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    if (requestPath.startsWith('/api/')) return false;
    const candidate = path.resolve(uiRoot, relative);
    if (!isInside(uiRoot, candidate) || !ALLOWED_STATIC_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return false;
    let real;
    try { real = fs.realpathSync(candidate); } catch { return false; }
    if (!isInside(uiRoot, real)) return false;
    let data;
    try { data = await fsp.readFile(real); } catch { return false; }
    res.writeHead(200, { 'Content-Type': mimeType(real), 'Cache-Control': 'no-store', 'Content-Length': data.length });
    res.end(data);
    return true;
  }

  async function route(req, res) {
    if (!isLoopbackHost(req.headers.host)) { sendError(res, 400, new Error('Host must be loopback')); return; }
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsed.pathname;
    if (await workflowApi.handle(req, res)) return;
    if (await gitApi.handle(req, res)) return;
    if (await chatReadApi.handle(req, res)) return;
    if (pathname === '/api/workspace/connect') {
      if (!workspaceConnectCors(req, res)) return;
      if (req.method !== 'POST') { sendError(res, 405, new Error('Method not allowed')); return; }
      if (req.headers['x-aven-workspace'] !== 'connect') { sendError(res, 403, new Error('Workspace connection header required')); return; }
      let body;
      try { body = await parseBody(req); } catch { sendError(res, 400, new Error('Workspace connection must be valid JSON')); return; }
      const scope = body?.scope;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'scope') || !['browser', 'computer', 'workspace'].includes(scope)) { sendError(res, 400, new Error('Workspace connection scope is not allowed')); return; }
      workspaceToken = crypto.randomBytes(32).toString('base64url'); workspaceTokenExpiresAt = Date.now() + 900000; workspaceTokenScope = scope;
      sendJson(res, 200, { ok: true, scope, token: workspaceToken, expiresIn: Math.max(0, Math.ceil((workspaceTokenExpiresAt - Date.now()) / 1000)) });
      return;
    }
    if (pathname === '/api/workspace/status' || pathname === '/api/workspace/read') {
      if (!workspaceCors(req, res)) return;
      if (pathname.endsWith('/status')) {
        if (req.method !== 'GET') { sendError(res, 405, new Error('Method not allowed')); return; }
        await ready;
        if (!execution) { sendError(res, 503, new Error('Execution is disabled for this service')); return; }
        const current = await execution.status();
        const adapters = current?.adapters || {};
        sendJson(res, 200, { adapters: {
          browser: { available: Boolean(adapters.browser?.available), connected: Boolean(adapters.browser?.connected), pages: Array.isArray(adapters.browser?.pages) ? adapters.browser.pages.map((page) => ({ pageId: page.pageId, url: page.url })) : [] },
          desktop: { available: Boolean(adapters.desktop?.available), selectedWindow: adapters.desktop?.selectedWindow || null, mode: adapters.desktop?.mode || 'selected-window-only' },
          network: { available: Boolean(adapters.network?.available), profileCount: Number(adapters.network?.profileCount) || 0, connectionStatus: adapters.network?.connectionStatus || 'status unavailable' },
          terminal: { available: false, connected: false, reason: 'Interactive terminal adapter is not exposed by this service.' },
        }, observedAt: new Date().toISOString() });
        return;
      }
      if (req.method !== 'POST') { sendError(res, 405, new Error('Method not allowed')); return; }
      if (req.headers['x-aven-workspace'] !== 'read-only') { sendError(res, 403, new Error('Workspace read-only header required')); return; }
      if (!workspaceTokenAllowed(req, workspaceToken, workspaceTokenExpiresAt)) { sendError(res, 403, new Error('Invalid or expired workspace read-only token')); return; }
      let body;
      try { body = await parseBody(req); } catch { sendError(res, 400, new Error('Workspace request must be valid JSON')); return; }
      const operation = body?.operation, type = operation?.type, keys = operation && typeof operation === 'object' && !Array.isArray(operation) ? Object.keys(operation) : [], allowedKeys = type === 'browser.inspect' ? ['type', 'pageId'] : type === 'desktop.select' ? ['type', 'window', 'hwnd', 'pid', 'processCreationTime', 'title', 'className'] : ['type'];
      if (!operation || typeof operation !== 'object' || Array.isArray(operation) || Object.keys(body).some((key) => key !== 'operation') || !WORKSPACE_READ_OPERATIONS.has(type) || keys.some((key) => !allowedKeys.includes(key))) { sendError(res, 400, new Error('Workspace operation is not an allowed read-only adapter operation')); return; }
      if (!workspaceScopeAllowed(workspaceTokenScope, type)) { sendError(res, 403, new Error('Workspace token scope does not permit this adapter')); return; }
      if (type === 'browser.inspect' && (typeof operation.pageId !== 'string' || !operation.pageId.trim())) { sendError(res, 400, new Error('Browser inspection requires a page ID')); return; }
      await ready;
      if (!execution) { sendError(res, 503, new Error('Execution is disabled for this service')); return; }
      const result = await execution.action({ type: 'execution.adapter', operation });
      sendJson(res, 200, { ok: true, result });
      return;
    }
    if (pathname === '/api/chat/recovery') {
      const origin=req.headers.origin;if(!chatOriginAllowed(origin,req)){sendError(res,403,new Error('Chat origin is not allowed'));return;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','X-Aven-Chat, Content-Type');res.writeHead(204);res.end();return;}if(req.method!=='POST'||req.headers['x-aven-chat']!=='text-only'){sendError(res,405,new Error('Explicit recovery requires a text-only POST'));return;}let body;try{body=await parseBody(req);}catch{sendError(res,400,new Error('Invalid recovery request'));return;}if(!body||body.authorized!==true||Object.keys(body).some(key=>key!=='authorized'&&key!=='probe')){sendError(res,403,new Error('Explicit recovery authorization is required'));return;}try{if(body.probe===true){const state=reliability.snapshot(),activeRuns=Object.values(state.runs).filter(run=>['RUNNING','CANCELLING','WAITING'].includes(run.status));sendJson(res,200,{probe:true,allowConcurrentRuns:concurrentRuns,activeRequestIds:activeRuns.map(run=>run.requestId),activeRuns:activeRuns.map(run=>({runId:run.runId,chatId:run.chatId,requestId:run.requestId,status:run.status}))});return;}sendJson(res,200,recoverAbandonedReliability());}catch(error){sendError(res,503,error);}return;
    }
    if (pathname === '/api/chat/steer') {
      const origin = req.headers.origin;
      if (!chatOriginAllowed(origin, req)) { sendError(res, 403, new Error('Chat origin is not allowed')); return; }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Chat, Content-Type');
        res.writeHead(204); res.end(); return;
      }
      if (req.method !== 'POST') { sendError(res, 405, new Error('Method not allowed')); return; }
      if (req.headers['x-aven-chat'] !== 'text-only') { sendError(res, 403, new Error('Chat request header required')); return; }
      let body;
      try { body = await parseBody(req); } catch { sendError(res, 400, new Error('Invalid steering request')); return; }
      if (!body || Object.keys(body).some((key) => !['runId', 'chatId', 'steeringToken', 'text'].includes(key)) || typeof body.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.runId) || typeof body.chatId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.chatId) || typeof body.steeringToken !== 'string' || !body.steeringToken || typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_STEERING_MESSAGE_CHARS) {
        sendError(res, 400, new Error(`Steering requires a run, chat, token and text within ${MAX_STEERING_MESSAGE_CHARS} characters`)); return;
      }
      const run = activeRuns.get(body.runId);
      if (!run || run.chatId !== body.chatId || run.phase !== 'open') { sendError(res, 409, new Error('The chat run is closing or unavailable')); return; }
      if (!run.matchesToken(body.steeringToken)) { sendError(res, 403, new Error('Steering token is invalid')); return; }
      const accepted = run.accept(body.text);
      if (!accepted.accepted) { sendError(res, 409, new Error(accepted.reason === 'full' ? 'The steering queue is full' : 'The chat run is closing or unavailable')); return; }
      run.emit?.({ type: 'steer_received', id: accepted.id });
      sendJson(res, 200, { accepted: true, id: accepted.id });
      return;
    }
    if (pathname === '/api/provider-config') {
      const origin = req.headers.origin;
      if (!chatOriginAllowed(origin, req)) { sendError(res, 403, new Error('Provider configuration origin is not allowed')); return; }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Chat, Content-Type'); res.writeHead(204); res.end(); return; }
      if (req.method === 'GET') { const snapshot = await providerSelection.capabilities(); sendJson(res, 200, { schemaVersion: snapshot.schemaVersion, checkedAt: snapshot.checkedAt, providers: snapshot.providers }); return; }
      if (req.method !== 'POST' || req.headers['x-aven-chat'] !== 'text-only') { sendError(res, req.method === 'POST' ? 403 : 405, new Error(req.method === 'POST' ? 'Chat request header required' : 'Method not allowed')); return; }
      let body;
      try { body = await parseBody(req); } catch { sendError(res, 400, new Error('Invalid provider configuration')); return; }
      try {
        const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
        const { credential: submittedCredential, ...configBody } = source;
        const providerId = typeof configBody.providerId === 'string' ? configBody.providerId.trim() : '';
        const fixedCredentialRef = DEFAULT_CREDENTIAL_REFS[providerId];
        const request = normalizeProviderConfigRequest({ ...configBody, credentialRef: fixedCredentialRef });
        if (!request) throw Object.assign(Error('Provider setup requires a supported provider, model, and effort.'), { code: 'invalid_provider_config' });
        const credential = Object.hasOwn(source, 'credential') ? submittedCredential : undefined;
        if (credential !== undefined && (typeof credential !== 'string' || !credential || credential.length > 8192)) throw Object.assign(Error('Provider key is invalid.'), { code: 'provider_key_invalid' });
        if (credential === undefined && !(typeof hasSecret === 'function' && hasSecret(fixedCredentialRef))) throw Object.assign(Error('Enter a provider key to configure this provider.'), { code: 'provider_key_required' });
        if (credential !== undefined) await setSecret(fixedCredentialRef, credential);
        const { upsertProviderConfig } = require('./provider-runtime-config.cjs');
        const current = readProviderConfig(runtimeDirectory).providers;
        const applied = upsertProviderConfig(current, request);
        writeProviderConfig(runtimeDirectory, applied.providers);
        if (typeof providerRuntime?.reload === 'function') await providerRuntime.reload(applied.providers);
        else if (!providerRuntime) providerRuntime = createProviderRuntimeConfig({ ...providerRuntimeOptions, providers: applied.providers });
        const snapshot = await providerSelection.capabilities();
        sendJson(res, 200, { ok: true, selection: applied.selection, configured: true, connected: false, schemaVersion: snapshot.schemaVersion, checkedAt: snapshot.checkedAt, providers: snapshot.providers });
      } catch (error) { sendError(res, error.code === 'provider_key_required' ? 409 : 400, error); }
      return;
    }
    if (pathname === '/api/chat') {
      const origin=req.headers.origin;
      if(!chatOriginAllowed(origin, req)){sendError(res,403,new Error('Chat origin is not allowed'));return;}
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','X-Aven-Chat, Content-Type');res.writeHead(204);res.end();return;}
      if(req.method!=='POST'){sendError(res,405,new Error('Method not allowed'));return;}
      if(req.headers['x-aven-chat']!=='text-only'){sendError(res,403,new Error('Chat request header required'));return;}
      let body;
      try{body=await parseBody(req);}catch{sendError(res,400,new Error('Invalid chat request'));return;}
      const mode = body?.mode === undefined ? 'inspect' : body.mode;
      if(!body || Object.keys(body).some(k=>!['chatId','agentName','messages','mode','selection','context','requestId','idempotencyKey'].includes(k)) || (Object.hasOwn(body,'selection') && (!body.selection || typeof body.selection!=='object' || Array.isArray(body.selection))) || (Object.hasOwn(body,'context') && body.context!==null && (typeof body.context!=='object' || Array.isArray(body.context) || Object.keys(body.context).some(k=>!['windowMessages','windowCharacters','retainedMessages','retainedCharacters','omittedMessages','totalMessages'].includes(k)) || Object.values(body.context).some(value=>value!==null&&(!Number.isSafeInteger(value)||value<0)))) || !CHAT_MODES.includes(mode) || typeof body.chatId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.chatId) || typeof body.agentName!=='string' || body.agentName.length>80 || !Array.isArray(body.messages) || !body.messages.length || body.messages.length>24 || body.messages.some(m=>!m || Object.keys(m).some(k=>!['role','content'].includes(k)) || !['user','assistant'].includes(m.role) || typeof m.content!=='string' || !m.content.trim()) || body.messages.at(-1).role!=='user' || body.messages.reduce((n,m)=>n+m.content.length,0)>32000){sendError(res,400,new Error('Chat requires up to 24 text messages, mode plan or inspect, and a safe optional provider selection'));return;}
      const capabilities=await providerSelection.capabilities();
      const selected=resolveSelection({selection:Object.hasOwn(body,'selection')?body.selection:undefined,capabilities,defaultSelection:DEFAULT_SELECTION});
      if(!selected.ok){sendError(res,409,Object.assign(new Error(selected.reason),{code:selected.code}));return;}
      if(!execution?.provider){sendError(res,503,new Error('Chat provider is unavailable'));return;}      if(!concurrentRuns&&chatPending){sendError(res,409,new Error('Another reply is in progress. Try again when it finishes.'));return;}
      const requestId=typeof body.requestId==='string'&&body.requestId.trim()?body.requestId.trim():crypto.randomUUID();const idempotencyKey=typeof body.idempotencyKey==='string'&&body.idempotencyKey.trim()?body.idempotencyKey.trim():requestId;let claim;try{claim=reliability.claimRun(body.chatId,{requestId,idempotencyKey,ownerId:serverOwnerId,mode,fingerprint:crypto.createHash('sha256').update(JSON.stringify({chatId:body.chatId,agentName:body.agentName,mode,messages:body.messages,selection:selected.selection,context:body.context||null})).digest('hex')});}catch(error){sendError(res,error.code==='idempotency_conflict'?409:503,new Error(error.code==='idempotency_conflict'?'This request id was reused with different data.':'Reliable run storage is unavailable; no provider request was sent.'));return;}if(!claim.accepted){sendError(res,409,new Error('Another reply is in progress. Try again when it finishes.'));return;}if(claim.duplicate){sendError(res,409,new Error('This request was already claimed. Review the saved run; it was not submitted again.'));return;}if(!concurrentRuns)chatPending=true;
      const controller=new AbortController();
      const streaming=req.headers.accept==='application/x-ndjson';
      const runId=claim.run.runId,steeringToken=crypto.randomBytes(32).toString('base64url'),events=[];
      const runState=createSteeringRun(runId,body.chatId,steeringToken);
      activeRuns.set(runId,runState);
      const disconnected=()=>{if(!res.writableEnded){runState.beginClosing();controller.abort();}};res.once('close',disconnected);
      let completedReply=null;
      const emit=(event)=>{
        const safe={...event,runId,at:new Date().toISOString()};
        const { steeringToken: _discardedToken, questionToken: _discardedQuestionToken, ...persisted } = safe;
        if(events.length<100)events.push(persisted);
        if(streaming&&!res.destroyed)res.write(JSON.stringify(safe)+'\n');
      };
      runState.emit=emit;
      if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});}
      emit({type:'start',message:'Starting network coworker investigation',mode,selection:selected.selection,selectionSource:selected.source,...(streaming?{steeringToken}: {})});
      try{
        const responder=options.chatResponder||require('./agent-runtime.cjs').respond;
        const workflowRun=await workflowManager.start({runId,chatId:body.chatId,mode,messages:body.messages,selection:selected.selection,responder,onEvent:event=>{if(event.type!=='start'&&event.type!=='pending_question'&&event.type!=='completed')emit(event);},responderOptions:{provider:execution?.provider,sandbox:networkExecution,messages:body.messages,agentName:body.agentName,chatId:body.chatId,mode,selection:selected.selection,providerCapabilities:capabilities,context:body.context||null,getKey:providerRuntime?.getKey || (typeof options.getProviderKey==='function'?options.getProviderKey:undefined),modelFactory:providerRuntime?.modelFactory || (typeof options.providerModelFactory==='function'?options.providerModelFactory:undefined),providerFetch:providerRuntime?((input,init)=>providerRuntime.fetch(selected.selection.providerId,input,init)):(typeof options.providerFetch==='function'?options.providerFetch:undefined),signal:controller.signal,onEvent:emit,drainSteering:runState.drainSteering,onModelComplete:runState.beginClosing}});
        runState.beginClosing();
        if(workflowRun.status==='waiting-question'){
          completedReply={...workflowRun,runId,mode};
          const metadata=workflowRun.result||{};
          emit({type:'pending_question',mode,question:workflowRun.pendingQuestion.question,questionToken:workflowRun.pendingQuestion.token,...metadata});
        }else{
          completedReply={...workflowRun.result,runId,mode,workflowRunId:workflowRun.runId};
          emit({type:'final',reply:completedReply});
        }
        if(!streaming&&!res.destroyed)sendJson(res,200,completedReply);
      }catch(error){
        runState.beginClosing();
        const messages={provider_401:'The selected provider rejected authentication.',provider_429:'The selected provider reached its rate limit. Try again later.',provider_timeout:'The selected provider timed out. Review any captured results before retrying.',provider_key_unavailable:'The selected provider key is unavailable locally.'};
        const message=controller.signal.aborted?'Run cancelled; any submitted remote command may still finish.':messages[error.code]||'The agent run could not finish. Review the activity; submitted commands were not automatically retried.';
        emit({type:'failed',message});
        if(!streaming&&!res.destroyed)sendError(res,502,new Error(message));
      }finally{
        for (const pending of runState.close()) emit({ type: 'steer_pending', id: pending.id, message: pending.message });
        emit({type:'end'});
        try{const dir=path.join(root,'.intentgraph','evidence','runs');fs.mkdirSync(dir,{recursive:true});const persistedReply=completedReply?.pendingQuestion?{...completedReply,pendingQuestion:{...completedReply.pendingQuestion,token:undefined}}:completedReply;fs.writeFileSync(path.join(dir,runId+'.json'),JSON.stringify({runId,chatId:body.chatId,events,reply:persistedReply},null,2),{flag:'wx'});}catch{ /* Evidence persistence failure does not repeat tools. */ }
        if(streaming&&!res.destroyed)res.end();
        try{const statuses=[];const inspectStatus=value=>{if(!value||typeof value!=='object')return;if(typeof value.status==='string')statuses.push(value.status.toUpperCase());for(const key of ['evidence','events','reply','result','diagnostic','diagnostics']){const nested=value[key];if(Array.isArray(nested))nested.forEach(inspectStatus);else if(nested)inspectStatus(nested);}};inspectStatus(completedReply);const finalStatus=completedReply?.status==='waiting-question'?'WAITING':controller.signal.aborted?'UNKNOWN':statuses.some(status=>status==='UNKNOWN')?'UNKNOWN':statuses.some(status=>['FAILURE','BLOCKLISTED','NOT_EXECUTED'].includes(status))?'FAILURE':completedReply?'SUCCESS':'FAILURE';const question=completedReply?.pendingQuestion??completedReply?.question;const safeQuestion=typeof question==='string'?question.slice(0,4000):question&&typeof question==='object'?(()=>{const source=question.question&&typeof question.question==='object'?question.question:question;return typeof source.prompt==='string'?{id:typeof source.id==='string'?source.id.slice(0,200):'',prompt:source.prompt.slice(0,4000),choices:Array.isArray(source.choices)?source.choices.slice(0,20).map(choice=>typeof choice==='string'?choice:String(choice?.label||choice?.value||'')).filter(Boolean):[]}:null;})():null;reliability.settleRun(runId,finalStatus,{chatId:body.chatId,pendingQuestion:safeQuestion},{ownerId:serverOwnerId,idempotencyKey:`run.settle:${runId}:${finalStatus}`});}catch(error){console.error('Reliable run settlement failed',error.code||error.message);}res.removeListener('close',disconnected);activeRuns.delete(runId);if(!concurrentRuns)chatPending=false;
      }
      return;
    }
    if (pathname === '/api/sandbox/status' || pathname === '/api/sandbox/inventory' || pathname === '/api/sandbox/command') {
      const origin = req.headers.origin;
      if (origin !== 'http://127.0.0.1:8767' && origin !== `http://127.0.0.1:${req.socket.localPort}`) {
        sendError(res, 403, new Error('Sandbox origin is not allowed')); return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'X-Aven-Sandbox, Content-Type');
        res.writeHead(204); res.end(); return;
      }
      try {
        if (pathname.endsWith('/status') && req.method === 'GET') { sendJson(res, 200, await sandbox.status()); return; }
        if (pathname.endsWith('/inventory') && req.method === 'POST') {
          if (req.headers['x-aven-sandbox'] !== 'read-only') { sendError(res, 403, new Error('Sandbox request header required')); return; }
          const body = await parseBody(req);
          if (!body || Array.isArray(body) || Object.keys(body).length) { sendError(res, 400, new Error('Inventory accepts no parameters')); return; }
          sendJson(res, 200, await networkExecution.inventory()); return;
        }
        if (pathname.endsWith('/command') && req.method === 'POST') {
          if (req.headers['x-aven-sandbox'] !== 'read-only') { sendError(res, 403, new Error('Sandbox request header required')); return; }
          const body = await parseBody(req);
          const keys = body && !Array.isArray(body) && typeof body === 'object' ? Object.keys(body) : [];
          if (!body || Array.isArray(body) || keys.some(key => !['targetId', 'command', 'requestId'].includes(key)) || keys.length !== 3 ||
            typeof body.targetId !== 'string' || !body.targetId.trim() || body.targetId.length > 200 ||
            typeof body.command !== 'string' || !body.command.trim() || body.command.length > 200 ||
            typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
            sendError(res, 400, new Error('Read-only command requires an exact targetId, supported command and request identity')); return;
          }
          const sendOutcome = outcome => {
            if (res.writableEnded || res.destroyed) return;
            if (outcome.httpStatus === 200) sendJson(res, 200, outcome.payload);
            else sendError(res, outcome.httpStatus, new Error(outcome.message));
          };
          const previousRun = sandboxCommandRuns.get(body.requestId);
          if (previousRun) {
            if (previousRun.targetId !== body.targetId || previousRun.command !== body.command) { sendError(res, 409, new Error('Request identity is already bound to another diagnostic')); return; }
            sendOutcome(await previousRun.promise);
            return;
          }
          const startedAt = new Date().toISOString();
          const controller = new AbortController();
          const disconnected = () => { if (!res.writableEnded) controller.abort(); };
          const closeBeforeResponse = () => { if (!req.complete) disconnected(); };
          req.once('aborted', disconnected);
          req.once('close', closeBeforeResponse);
          res.once('close', disconnected);
          const entry = { targetId: body.targetId, command: body.command, active: true, promise: null };
          let settle;
          entry.promise = new Promise(resolve => { settle = resolve; });
          sandboxCommandRuns.set(body.requestId, entry);
          const execute = async () => {
            let target = null;
            const projectTarget = value => value ? { id: value.id, hostname: value.hostname || value.id, platform: value.platform || 'Unknown platform', transport: value.transport || 'network diagnostic', managementIp: value.managementIp || '' } : { id: body.targetId, hostname: body.targetId, platform: 'Unknown platform', transport: 'network diagnostic', managementIp: '' };
            const unknownOutcome = () => ({ httpStatus: 200, payload: { runId: body.requestId, requestId: body.requestId, target: projectTarget(target), command: body.command, status: 'UNKNOWN', source: target?.transport || 'network diagnostic', startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.max(0, Date.now() - Date.parse(startedAt)), output: '', outputTruncated: false } });
            try {
              const snapshot = await networkExecution.inventory({ signal: controller.signal });
              const devices = Array.isArray(snapshot?.devices) ? snapshot.devices : [];
              const ids = new Set();
              if (devices.some(device => {
                if (!device || typeof device.id !== 'string') return false;
                if (ids.has(device.id)) return true;
                ids.add(device.id); return false;
              })) return { httpStatus: 409, message: 'Inventory contains duplicate target IDs' };
              target = devices.find(device => device && typeof device.id === 'string' && device.id === body.targetId);
              if (!target) return { httpStatus: 404, message: 'Target is not present in the current inventory' };
              const targetCommands = Array.isArray(target.supportedCommands) ? target.supportedCommands : [];
              const globalCommands = Array.isArray(networkExecution.supportedCommands) ? networkExecution.supportedCommands : null;
              if (!targetCommands.includes(body.command) || (globalCommands && !globalCommands.includes(body.command))) return { httpStatus: 400, message: 'Command is not allowlisted for this target' };
              if (controller.signal.aborted) return unknownOutcome();
              const result = await networkExecution.runCommand({ deviceUuid: target.id, command: body.command, signal: controller.signal, timeoutMs: 60000 });
              if (controller.signal.aborted) return unknownOutcome();
              const completedAt = new Date().toISOString();
              const status = ['SUCCESS', 'FAILURE', 'UNKNOWN', 'NOT_EXECUTED'].includes(result?.status) ? result.status : 'UNKNOWN';
              const output = typeof result?.output === 'string' ? result.output : '';
              const outputTruncated = output.length > 512 * 1024;
              return { httpStatus: 200, payload: { runId: body.requestId, requestId: body.requestId, target: projectTarget(target), command: body.command, status, source: result?.source || target.transport || 'network diagnostic', startedAt: result?.startedAt || startedAt, completedAt, elapsedMs: Number.isFinite(result?.elapsedMs) ? result.elapsedMs : Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)), output: outputTruncated ? output.slice(0, 512 * 1024) : output, outputTruncated } };
            } catch (error) {
              if (controller.signal.aborted || error?.submitted) return unknownOutcome();
              return { httpStatus: 502, message: 'Network diagnostic service unavailable. Check the local connection and approved certificate.' };
            } finally {
              entry.active = false;
              req.removeListener('aborted', disconnected); req.removeListener('close', closeBeforeResponse); res.removeListener('close', disconnected);
            }
          };
          execute().then(settle, () => settle({ httpStatus: 502, message: 'Network diagnostic service unavailable. Check the local connection and approved certificate.' }));
          const outcome = await entry.promise;
          if (sandboxCommandRuns.size > 128) {
            for (const [id, item] of sandboxCommandRuns) {
              if (sandboxCommandRuns.size <= 128) break;
              if (!item.active && id !== body.requestId) sandboxCommandRuns.delete(id);
            }
          }
          sendOutcome(outcome);
          return;
        }
        sendError(res, 405, new Error('Method not allowed')); return;
      } catch (error) {
        if (!res.writableEnded) sendError(res, error.statusCode || 502, error.statusCode ? error : new Error('Network diagnostic service unavailable. Check the local connection and approved certificate.'));
        return;
      }
    }
    if (req.method === 'GET' || (req.method === 'OPTIONS' && pathname === '/api/capabilities')) {
      try {
        await ready;
        if (pathname === '/api/session') { sendJson(res, 200, { token, csrfToken: token }); return; }
if (pathname === '/api/capabilities') { const origin=req.headers.origin; if(origin&&!chatOriginAllowed(origin,req)){sendError(res,403,new Error('Capabilities origin is not allowed'));return;} if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');} if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET');res.setHeader('Access-Control-Allow-Headers','X-Aven-Chat');res.writeHead(204);res.end();return;}if(req.method!=='GET'){sendError(res,405,new Error('Method not allowed'));return;} const current=execution ? await execution.status() : null; const capabilities=await providerSelection.capabilities(); const defaultProvider=capabilities.providers.find(item=>item.id===DEFAULT_SELECTION.providerId); const defaultModel=defaultProvider?.models.find(item=>item.id===DEFAULT_SELECTION.modelId); sendJson(res,200,{schemaVersion:capabilities.schemaVersion,checkedAt:capabilities.checkedAt,providers:capabilities.providers,ai:{connected:defaultProvider?.connected===true,configured:defaultProvider?.configured===true,provider:defaultProvider?.id||null,model:defaultModel?.id||null},runtime:{dispatch:Boolean(current?.provider?.credentialStored && current?.provider?.last?.ok),dispatchAvailable:Boolean(current),shell:false,device:false,deviceAdapterAvailable:Boolean(current?.adapters?.network?.available),allowConcurrentRuns:concurrentRuns,concurrency:concurrentRuns?'per-chat':'single'},execution:current}); return; }
        if (pathname === '/api/execution') { if(!execution)throw new Error('Execution is disabled for this service');sendJson(res,200,await execution.status());return; }
        if (pathname === '/api/execution/artifact') {
          const relative=parsed.searchParams.get('path')||'';
          const artifactRoot=path.join(runtimeDirectory,'adapters');
          const candidate=path.resolve(root,relative);
          const real=await fsp.realpath(candidate);
          if(!isInside(artifactRoot,real)||!['.png','.jpg','.jpeg','.webp'].includes(path.extname(real).toLowerCase()))throw Error('Artifact is not available');
          const stat=await fsp.stat(real);if(!stat.isFile()||stat.size>10*1024*1024)throw Error('Artifact exceeds size limit');
          const data=await fsp.readFile(real);res.writeHead(200,{'Content-Type':mimeType(real),'Cache-Control':'no-store','Content-Length':data.length});res.end(data);return;
        }
        if (pathname === '/api/index') { sendJson(res, 200, await engine.getIndex()); return; }
        if (pathname === '/api/state') { sendJson(res, 200, await engine.getState()); return; }
        if (pathname === '/api/source') { sendJson(res, 200, await engine.getSource(parsed.searchParams.get('path') || '')); return; }
        if (pathname === '/api/diff') { sendJson(res, 200, await engine.getDiff(parsed.searchParams.get('path') || '')); return; }
        if (pathname === '/api/gate') { sendJson(res, 200, await engine.getGate(parsed.searchParams.get('taskId') || '')); return; }
        if (pathname === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(': connected\n\n');
          const state = await engine.getState();
          for (const event of state.events.slice(-100)) res.write(`data: ${JSON.stringify(event)}\n\n`);
          hub.add(res);
          req.on('close', () => hub.delete(res));
          return;
        }
        if (await staticFile(res, pathname)) return;
        sendError(res, 404, new Error('route not found'));
      } catch (error) { sendError(res, error.statusCode || 404, error); }
      return;
    }
    if (req.method === 'POST') {
      if (pathname !== '/api/action') { sendError(res, 404, new Error('route not found')); return; }
      if (req.headers['x-intentgraph-token'] !== token) { sendError(res, 403, new Error('invalid intentgraph token')); return; }
      if (!originAllowed(req.headers.origin, req)) { sendError(res, 403, new Error('Origin must be the local IntentGraph origin')); return; }
      try {
        await ready;
        const body = await parseBody(req);
        const result = String(body.type||'').startsWith('execution.') ? await execution?.action(body) : await engine.action(body);
        if(String(body.type||'').startsWith('execution.')&&!execution)throw Error('Execution is disabled for this service');
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendError(res, error.statusCode || (error.gate ? 409 : 400), error, error.reasons || (error.gate && error.gate.reasons));
      }
      return;
    }
    sendError(res, 405, new Error('method not allowed'));
  }

  const server = http.createServer((req, res) => { route(req, res).catch((error) => sendError(res, 500, error)); });
  server.once('listening', startWatchers);
  server.once('close', () => { try { reliability.recover({ authorized: true, ownerId: serverOwnerId }); } catch (error) { console.error('Reliable shutdown recovery failed', error.code || error.message); } try { if(workflowManagerOwned) workflowManager.close?.(); } finally { sandbox.close(); reliabilityStorage.close?.(); } });
  const originalClose = server.close.bind(server);
  server.close = (callback) => { closeWatchers(); if(execution){Promise.resolve(execution.close()).catch(()=>{}).finally(()=>originalClose(callback));return server;}return originalClose(callback); };
  server.intentGraph = { root, runtimeDirectory, token, engine, indexer, ready, startWatchers, closeWatchers, execution, reliability, recoverReliability, recoverAbandonedReliability, clarificationManager: workflowManager, workflowApi, gitWorkspace, gitApi };
  return server;
}

async function start(options = {}) {
  const server = createServer(options);
  await server.intentGraph.ready;
  const port = Number(options.port ?? DEFAULT_PORT);
  const host = options.host || DEFAULT_HOST;
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const portIndex = args.indexOf('--port');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : path.resolve(__dirname, '..');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : DEFAULT_PORT;
  start({ root, port }).then((server) => {
    process.stdout.write(`IntentGraph listening at http://127.0.0.1:${server.address().port}\n`);
  }).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}

module.exports = { createServer, start, isLoopbackHost, originAllowed, chatOriginAllowed, CHAT_MODES, MAX_STEERING_MESSAGES, MAX_STEERING_MESSAGE_CHARS };


