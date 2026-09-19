'use strict';
// Opt in with AVEN_BROWSER_TOOL=/absolute/path/to/an/isolated/chrome-devtools-axi.
// Browser operations use individual CLI commands; never the `run` helper.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const tool = process.env.AVEN_BROWSER_TOOL;
const enabled = Boolean(tool);
const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:8767/polished.html';
const key = 'aven-polished-chats-v1';
const results = [];
let directory, server;
const cli = (...args) => execFileSync(tool, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
function evaluate(source) {
  const output = cli('eval', source), line = output.match(/^result: (.+)$/m);
  assert.ok(line, output);
  const value = JSON.parse(line[1]);
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function waitFor(expression) {
  assert.equal(evaluate(`async () => { const end=Date.now()+6000; while(Date.now()<end){ if(${expression})return true; await new Promise(r=>setTimeout(r,30)); } return false; }`), true, expression);
}
function click(label) {
  evaluate(`() => {const b=[...document.querySelectorAll('.reply-error button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!b||b.disabled)throw Error('Unavailable control: '+${JSON.stringify(label)});b.click();return true;}`);
  waitFor(`![...document.querySelectorAll('.reply-error button')].some(b=>b.disabled)`);
}
function openChat(id) {
  evaluate(`() => {const b=document.querySelector('[data-conversation-row="'+${JSON.stringify(id)}+'"]');if(!b)throw Error('Chat missing');b.click();return true;}`);
}
function viewport(width,height){cli('emulate','--viewport',`${width}x${height}x1${width===390?',mobile,touch':''}`);assert.deepEqual(evaluate('() => ({width:innerWidth,height:innerHeight})'),{width,height});}
function configure(value) { fs.writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify(value)); }
function calls() { return evaluate('async () => (await (await fetch("/fixture-stats")).json()).calls'); }
function storageHash() { return evaluate(`async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(localStorage.getItem(${JSON.stringify(key)}))))).map(b=>b.toString(16).padStart(2,'0')).join('')`); }
function send(text) { evaluate(`() => {const d=document.querySelector('#draft');d.value=${JSON.stringify(text)};d.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit();return true;}`); }
function makeChat(suffix, pending = true) {
  const id = 'fixture-' + suffix + '-' + randomUUID(), requestId = randomUUID();
  const body = { chatId: id, requestId, idempotencyKey: randomUUID(), agentName: 'Network companion', mode: 'plan', messages: [{ role: 'user', content: 'Read-only recovery fixture ' + suffix }] };
  const submission = { agentId: 'companion', state: 'unknown', ownerSession: 'closed-tab-' + suffix, body };
  const raw = { command: 'show fixture', target: 'fixture', status: 'SUCCESS', output: 'retained\r\nraw ' + suffix + '\n' };
  return { id, title: suffix, projectId: 'fixture-project', channelId: null, recipients: ['companion'], sample: false, unread: false,
    draft: 'Keep draft ' + suffix, pendingAttachmentNames: [], mode: 'plan',
    messages: pending ? [{ id: 'user-' + id, role: 'user', text: body.messages[0].content, submission, createdAt: '2026-09-19T12:00:00Z' },
      { id: 'result-' + id, role: 'assistant', agentId: 'companion', requestId, status: 'UNKNOWN', text: 'Interrupted fixture', events: [{ type: 'tool_result', evidence: raw }], evidence: [raw], annotations: [{ id: 'note-' + id, text: 'Keep annotation', evidenceHash: 'fixture-hash' }], createdAt: '2026-09-19T12:00:01Z' }] : [],
    ...(pending ? { pendingAdmission: requestId, runJournal: { id: 'journal-' + id, requestId, runId: null, agentId: 'companion', startedAt: '2026-09-19T12:00:00Z', events: [], status: 'UNKNOWN' } } : {}),
    pendingQueue: pending ? [{ id: 'queue-' + id, text: 'Keep queued ' + suffix, createdAt: '2026-09-19T12:00:02Z', mode: 'plan', replyTo: null }] : [], queuePaused: pending, queuePauseReason: pending ? 'Fixture paused queue' : '', queueEditing: false };
}
function seed(chats) {
  configure({ delayMs: 40 });
  cli('open', url);
  evaluate(`() => { localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify({ activeChat: chats[0].id, chats, projects: [{ id: 'fixture-project', name: 'Recovery fixtures', members: ['companion'], collapsed: false }], channels: [] }))});localStorage.setItem('aven-polished-direct-teams-migration-v4','v4');return true;}`);
  cli('open', url);
  waitFor(`!!document.querySelector('#draft') && !!window.AvenAdmission`);
}
async function settle(chat) {
  const response = await fetch('http://127.0.0.1:8768/api/chat', { method: 'POST', headers: { Origin: 'http://127.0.0.1:8767', Connection: 'close', 'X-Aven-Chat': 'text-only', 'Content-Type': 'application/json' }, body: JSON.stringify(chat.messages[0].submission.body) });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.status, 'SUCCESS');
}
// Keep CLI output small: compare full retained values inside the mounted page.
function preserved(chat, resolved = false) {
  const expected = { id: chat.id, draft: chat.draft, pendingQueue: chat.pendingQueue, runJournal: chat.runJournal, pendingAdmission: chat.pendingAdmission, result: chat.messages[1] };
  const result = evaluate(`() => { const expected=${JSON.stringify(expected)},c=JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats.find(c=>c.id===expected.id);const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);const m=c.messages.find(m=>m.id===expected.result.id);return {draft:equal(c.draft,expected.draft),queue:equal(c.pendingQueue,expected.pendingQueue),paused:c.queuePaused,identity:!!m,annotations:equal(m?.annotations,expected.result.annotations),raw:expected.result.evidence.every(e=>m?.evidence?.some(x=>equal(e,x))),journal:${resolved ? '!c.runJournal&&!c.pendingAdmission' : 'equal(c.runJournal,expected.runJournal)&&c.pendingAdmission===expected.pendingAdmission'},statuses:c.messages.filter(m=>m.role==='assistant'&&m.requestId===expected.pendingAdmission).map(m=>m.status)};}`);
  for (const [name, value] of Object.entries(result)) if (name !== 'statuses') assert.equal(value, true, `${name}: ${JSON.stringify(result)}`);
  assert.deepEqual(result.statuses, [resolved ? 'SUCCESS' : 'UNKNOWN']);
}
function finish(chat, kind) {
  openChat(chat.id); click('Check saved run');
  if (kind === 'missing') {
    if(evaluate('() => innerWidth')===390){
      if(process.env.AVEN_UI_SCREENSHOTS){fs.mkdirSync(process.env.AVEN_UI_SCREENSHOTS,{recursive:true});cli('screenshot',path.join(process.env.AVEN_UI_SCREENSHOTS,'narrow-recovery.png'));}
      assert.equal(evaluate('() => {const bs=[...document.querySelectorAll(".reply-error button")];return bs.every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});}'),true);
      evaluate('() => {[...document.querySelectorAll(".reply-error button")].find(b=>b.textContent==="Retry saved request").focus();return true;}');cli('press','Enter');
    }else click('Retry saved request');
    waitFor(`!JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats.find(c=>c.id===${JSON.stringify(chat.id)}).pendingAdmission`); }
  preserved(chat, true);
}

before(async () => {
  if (!enabled) return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-mounted-'));
  configure({ delayMs: 40 });
  server = spawn(process.execPath, [path.join(__dirname, 'fixtures/admission-ui.cjs'), directory], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Fixture startup timed out')), 8000);
    let output = '';
    const read = chunk => { output += chunk; if (output.includes('Admission fixture:')) { clearTimeout(timer); resolve(); } };
    server.stdout.on('data', read); server.stderr.on('data', read);
    server.once('exit', code => { clearTimeout(timer); reject(Error('Fixture exited ' + code + ': ' + output)); });
  });
  const pages=cli('pages');if(!pages.match(/^\s*\d+,[^\n]+,true$/m)){const first=pages.match(/^\s*(\d+),/m);assert.ok(first);cli('selectpage',first[1]);}
  cli('open', url); viewport(1440,1000);
});
afterEach(async () => {
  if(enabled&&directory){configure({delayMs:30});await new Promise(resolve=>setTimeout(resolve,100));}
});
after(async () => {
  if (!enabled) return;
  if (process.env.AVEN_UI_EVIDENCE) fs.writeFileSync(process.env.AVEN_UI_EVIDENCE, JSON.stringify(results, null, 2) + '\n');
  if (server?.exitCode === null) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

for (const kinds of [['settled', 'settled'], ['missing', 'missing'], ['settled', 'missing']]) {
  test('mounted reload reconciles two pending chats independently: ' + kinds.join('/'), { skip: !enabled }, async () => {
    const chats = [makeChat('first'), makeChat('second')];
    for (let i = 0; i < chats.length; i++) if (kinds[i] === 'settled') await settle(chats[i]);
    seed(chats); if(kinds[0]==='settled'&&kinds[1]==='missing')viewport(390,844); const count = calls();
    const order = kinds[0] === 'settled' && kinds[1] === 'settled' ? [1, 0] : [0, 1];
    finish(chats[order[0]], kinds[order[0]]); preserved(chats[order[1]]); finish(chats[order[1]], kinds[order[1]]); preserved(chats[order[0]], true);
    assert.equal(calls() - count, kinds.filter(k => k === 'missing').length);
    results.push({ check: 'two pending ' + kinds.join('/'), passed: true, responderCalls: calls() - count, unrelatedJournalDraftQueueAndIdentityPreserved: true, narrowKeyboardRetry:kinds[0]==='settled'&&kinds[1]==='missing' });
    viewport(1440,1000);
  });
}

test('mounted outage then missing-receipt retry updates the existing UNKNOWN result', { skip: !enabled }, () => {
  const chat = makeChat('outage', false); seed([chat]); const count = calls();
  evaluate(`() => { const original=window.fetch;let outage=true;window.fetch=(...args)=>{if(outage&&String(args[0])==='http://127.0.0.1:8768/api/chat'&&args[1]?.method==='POST'){outage=false;return Promise.reject(new TypeError('Injected outage'));}return original(...args);};document.querySelector('#draft').value='Outage fixture request';document.querySelector('#draft').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit();return true;}`);
  waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats[0].messages.some(m=>m.status==='UNKNOWN')`);
  const captured = evaluate(`() => { const d=JSON.parse(localStorage.getItem(${JSON.stringify(key)})),c=d.chats[0],m=c.messages.find(m=>m.status==='UNKNOWN');m.annotations=[{id:'annotation',text:'Preserve captured note',evidenceHash:'captured-hash'}];m.evidence=[{command:'show fixture',target:'fixture',status:'SUCCESS',output:'captured exact\\r\\nraw\\n'}];m.events=[{type:'tool_result',evidence:m.evidence[0]}];localStorage.setItem(${JSON.stringify(key)},JSON.stringify(d));return {id:m.id,createdAt:m.createdAt,requestId:m.requestId,annotations:m.annotations,evidence:m.evidence,events:m.events};}`);
  cli('open', url); click('Check saved run'); click('Retry saved request');
  waitFor(`!JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats[0].pendingAdmission`);
  const actual = evaluate(`() => {const previous=${JSON.stringify(captured)},c=JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats[0],ms=c.messages.filter(m=>m.role==='assistant'&&m.requestId===previous.requestId),m=ms[0],equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);return {statuses:ms.map(m=>m.status),id:m.id===previous.id,createdAt:m.createdAt===previous.createdAt,annotations:equal(m.annotations,previous.annotations),raw:previous.evidence.every(e=>m.evidence.some(x=>equal(e,x))),events:previous.events.every(e=>m.events.some(x=>equal(e,x))),rendered:[...document.querySelectorAll('.message.assistant')].length};}`);
  assert.deepEqual(actual, { statuses: ['SUCCESS'], id: true, createdAt: true, annotations: true, raw: true, events: true, rendered: 1 });
  assert.equal(calls() - count, 1);
  results.push({ check: 'outage / missing / successful retry', passed: true, ...actual, responderCalls: 1 });
});

test('mounted recovery cannot interrupt a genuinely live writer in another tab', { skip: !enabled }, async () => {
  const chats = [makeChat('completed'), makeChat('live')]; await settle(chats[0]); seed(chats);
  configure({ delayMs: 30, hold: true });
  openChat(chats[1].id); click('Check saved run'); click('Retry saved request');
  waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats[1].messages[0].submission.receipt?.state==='admitted'`);
  const beforeHash = storageHash(), count = calls();
  const selected = cli('pages').match(/^\s*(\d+),[^\n]+,true$/m); assert.ok(selected); const first = selected[1];
  const beforePages = new Set([...cli('pages').matchAll(/^\s*(\d+),/gm)].map(m => m[1]));
  // The CLI can create a tab successfully and then fail its implicit snapshot
  // because no page is selected. Verify creation, then select explicitly.
  try{cli('newpage',url);}catch(error){if(!String(error.stdout).includes('No page is currently selected'))throw error;}
  const second = [...cli('pages').matchAll(/^\s*(\d+),/gm)].map(m => m[1]).find(id => !beforePages.has(id)); assert.ok(second);
  try {
    cli('selectpage', second); openChat(chats[0].id); click('Check saved run');
    assert.match(evaluate('() => document.querySelector(".reply-error").textContent'), /Another tab is still saving a run/);
    assert.equal(storageHash(), beforeHash, 'read/review must leave the live writer workspace byte-identical');
    openChat(chats[1].id); click('Check saved run');
    assert.match(evaluate('() => document.querySelector(".reply-error").textContent'), /still owns this request/);
    assert.equal(evaluate('() => [...document.querySelectorAll(".reply-error button")].some(b=>b.textContent.includes("Recover"))'), false);
    assert.equal(storageHash(), beforeHash);
    configure({ delayMs: 30 }); cli('selectpage', first);
    waitFor(`!JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats[1].pendingAdmission`);
    preserved(chats[1], true); preserved(chats[0]); assert.equal(calls(), count);
    results.push({ check: 'live other-tab ownership', passed: true, workspaceUnchangedDuringForeignReview: true, ownerFinishedSuccessfully: true });
  } finally { configure({ delayMs: 30 }); cli('closepage', second); cli('selectpage', first); }
});

test('mounted receipt reconciliation rejects a stale workspace snapshot', { skip: !enabled }, async () => {
  const chats = [makeChat('stale'), makeChat('untouched')]; await settle(chats[0]); seed(chats);
  evaluate(`() => {const d=JSON.parse(localStorage.getItem(${JSON.stringify(key)}));d.chats[0].draft='Newer other-tab draft';d.externalEdit='retain';localStorage.setItem(${JSON.stringify(key)},JSON.stringify(d));return true;}`);
  const beforeHash = storageHash(), count = calls(); click('Check saved run');
  assert.equal(storageHash(), beforeHash);
  assert.match(evaluate('() => document.querySelector(".reply-error").textContent'), /could not be stored/);
  preserved(chats[1]); assert.equal(calls(), count);
  results.push({ check: 'stale snapshot', passed: true, newerWorkspacePreserved: true, responderCalls: 0 });
});

test('mounted writer release preserves FIFO, exact code and desktop/narrow UI', { skip: !enabled }, () => {
  const chats = [makeChat('fifo', false), makeChat('draft', false)]; seed(chats); configure({ hold: true, delayMs: 30 }); const count = calls();
  send('FIFO first'); waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats[0].messages[0]?.submission?.receipt?.state==='admitted'`);
  send('FIFO second'); send('FIFO third'); openChat(chats[1].id);
  evaluate('() => {const d=document.querySelector("#draft");d.value="Keep unrelated draft";d.dispatchEvent(new Event("input",{bubbles:true}));return true;}');
  configure({ delayMs: 30 });
  waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).chats[0].messages.filter(m=>m.role==='assistant'&&m.status==='SUCCESS').length===3`);
  const value = evaluate(`() => {const d=JSON.parse(localStorage.getItem(${JSON.stringify(key)})),c=d.chats[0];return {texts:c.messages.filter(m=>m.role==='user').map(m=>m.text),identities:new Set(c.messages.filter(m=>m.role==='user').map(m=>m.submission.body.requestId)).size,queue:c.pendingQueue.length,draft:d.chats[1].draft,pending:!!c.pendingAdmission};}`);
  assert.deepEqual(value, { texts: ['FIFO first', 'FIFO second', 'FIFO third'], identities: 3, queue: 0, draft: 'Keep unrelated draft', pending: false });
  assert.equal(calls() - count, 3); openChat(chats[0].id);
  const raw = Array.from({ length: 15 }, (_, i) => 'fixture line ' + (i + 1)).join('\n');
  assert.equal(evaluate(`() => [...document.querySelectorAll('.message.assistant details')].filter(d=>d.querySelector('pre')).length===3&&[...document.querySelectorAll('.message.assistant details')].filter(d=>d.querySelector('pre')).every(d=>!d.open&&d.querySelector('pre').textContent.trim()===${JSON.stringify(raw)})`), true);
  const files = ['polished.html', 'polished.js', 'polished-admission.js', 'polished-run-state.js', 'polished-backup.js', 'polished.css', 'polished-workspace-tools.js'];
  const hashes = evaluate(`async () => {const out={};for(const name of ${JSON.stringify(files)}){const r=await fetch('/'+name,{cache:'no-store'});if(!r.ok)throw Error(name);out[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');}return out;}`);
  const { createHash } = require('node:crypto'); for (const [file, hash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash);
  if (process.env.AVEN_UI_SCREENSHOTS) { fs.mkdirSync(process.env.AVEN_UI_SCREENSHOTS, { recursive: true }); cli('screenshot', path.join(process.env.AVEN_UI_SCREENSHOTS, 'desktop.png')); }
  viewport(390,844);
  assert.equal(evaluate('() => document.documentElement.scrollWidth<=innerWidth'), true);
  if (process.env.AVEN_UI_SCREENSHOTS) cli('screenshot', path.join(process.env.AVEN_UI_SCREENSHOTS, 'narrow.png'));
  const consoleOutput = cli('console'); assert.doesNotMatch(consoleOutput, /(?:TypeError|ReferenceError|SyntaxError|Uncaught)/);
  results.push({ check: 'FIFO and visual regressions', passed: true, ...value, responderCalls: 3, exactCollapsedCodeBlocks: 3, desktop: [1440, 1000], narrow: [390, 844], servedHashes: hashes, console: consoleOutput });
  viewport(1440,1000);
});
