'use strict';

const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('../../../../intentgraph/node_modules/playwright');

const outputDir=__dirname;
const projectRoot=path.resolve(__dirname,'..','..','..','..');
const baselineFile=path.resolve(__dirname,'..','baseline','polished.js');
const candidateFile=path.resolve(__dirname,'candidate','polished.js');
const keys={prefs:'aven-polished-preferences-v1',chat:'aven-polished-chats-v1',docs:'aven-polished-docs-v1',pending:'aven-polished-coworker-create-pending-v1'};
const mode=process.argv.includes('--integrated')?'integrated':process.argv.includes('--baseline')?'baseline':'candidate';
const override=mode==='candidate'?candidateFile:mode==='baseline'?baselineFile:null;
const read=(file)=>fs.readFileSync(file);
const richFixture={prefs:{theme:'system',accent:'black',language:'system',density:'comfortable',displayName:'Audit owner',activeAgent:'companion',provider:'Not connected',model:'',browser:true,computer:false,sections:[],agents:[{id:'companion',name:'Network companion',role:'Investigate branch networks and explain findings.',description:'Existing coworker',label:'',timezone:'Follow system',autoReview:false,hidden:false,archived:false,pinned:false,unread:false,sectionId:'',avatar:{style:'router',color:'#45c9b0',seed:17}},{id:'topology',name:'Topology analyst',role:'Map dependencies and surface the next useful signal.',timezone:'Follow system',autoReview:false,hidden:false,archived:false,pinned:false,unread:false,sectionId:'',avatar:{style:'dns-ddi',color:'#69a9f4',seed:23}}]},data:{activeChat:'sentinel-chat',chats:[{id:'sentinel-chat',title:'Existing network history',autoTitle:false,sample:false,channelId:null,projectId:null,recipients:['companion'],draft:'Keep this unsent draft',pendingAttachmentNames:[],messages:[{id:'sentinel-message',role:'user',agentId:'companion',text:'Existing history must survive failed creation.',createdAt:'2026-09-16T00:00:00.000Z'},{id:'sentinel-reply',role:'assistant',agentId:'companion',text:'Preserve queues and notes.',createdAt:'2026-09-16T00:01:00.000Z'}],pendingQueue:[{id:'sentinel-queue',text:'Queued validation that must remain paused.',mode:'inspect',replyTo:null,createdAt:'2026-09-16T00:02:00.000Z'}],queuePaused:true,queuePauseReason:'Paused for audit preservation'}],channels:[],projects:[{id:'personal',name:'Personal',system:true}]},docs:{companion:{'SOUL.md':'Existing coworker soul; preserve byte-for-byte.','MEMORY.md':'Existing coworker memory; preserve byte-for-byte.'}}};
const rawSnapshot=async(page)=>page.evaluate((keyset)=>{
  const raw=Object.fromEntries(Object.entries(keyset).map(([name,key])=>[name,localStorage.getItem(key)]));
  const parse=(value,fallback)=>{try{return value===null?fallback:JSON.parse(value);}catch{return fallback;}};
  const prefs=parse(raw.prefs,{agents:[]}),data=parse(raw.chat,{chats:[]}),docs=parse(raw.docs,{});
  const agent=prefs.agents.find(a=>a.name==='Creation audit coworker'),matching=agent?data.chats.filter(c=>(c.recipients||[]).includes(agent.id)):[],welcomes=matching.flatMap(c=>c.messages||[]).filter(m=>m.agentId===agent?.id&&m.welcome===true);
  const existingAgent=prefs.agents.find(a=>a.id==='companion'),existingChat=data.chats.find(c=>c.id==='sentinel-chat');
  return {raw,pending:raw.pending!==null,agent:agent?{id:agent.id,name:agent.name}:null,matchingChats:matching.length,matchingDocuments:agent?Object.prototype.hasOwnProperty.call(docs,agent.id):false,welcomeCount:welcomes.length,welcomeLocal:!!agent&&welcomes.length===1&&welcomes.every(m=>m.role==='assistant'&&!Object.prototype.hasOwnProperty.call(m,'model')&&!Object.prototype.hasOwnProperty.call(m,'runId')),existing:{draft:existingChat?.draft||'',queue:existingChat?.pendingQueue||[],messages:existingChat?.messages||[],avatar:existingAgent?.avatar||null,docs:docs.companion||null},sidebar:document.querySelector('#direct-list')?.textContent||'',status:document.querySelector('#chat-status')?.textContent||'',workspaceStatus:document.querySelector('#workspace-create-status')?.textContent||'',dialogOpen:!!document.querySelector('#workspace-create-dialog')?.open};
},keys);
const sameRaw=(before,after)=>['prefs','chat','docs'].every(name=>before.raw[name]===after.raw[name]);
const sameExisting=(before,after)=>JSON.stringify(before?.existing)===JSON.stringify(after?.existing);
function serve(){
  const server=http.createServer((request,response)=>{
    try{
      const url=new URL(request.url,`http://${request.headers.host}`);
      if(request.method!=='GET'){response.writeHead(405);response.end();return;}
      let file;
      if(override&&url.pathname==='/polished.js')file=override;
      else{
        const relative=decodeURIComponent(url.pathname).replace(/^\/+/,'')||'polished.html';
        file=path.resolve(projectRoot,relative);
        if(file!==projectRoot&&!file.startsWith(projectRoot+path.sep)){response.writeHead(403);response.end();return;}
      }
      if(!fs.existsSync(file)){response.writeHead(404);response.end();return;}
      const ext=path.extname(file),type=ext==='.html'?'text/html':ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.json'?'application/json':'application/octet-stream';
      response.writeHead(200,{'content-type':type});response.end(read(file));
    }catch(error){response.writeHead(500);response.end(String(error));}
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}
async function contextFor(server){
  const address=server.address(),origin=`http://127.0.0.1:${address.port}`,blocked=[];
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(({keyset,fixture})=>{if(localStorage.getItem(keyset.prefs)!==null)return;localStorage.setItem(keyset.prefs,JSON.stringify(fixture.prefs));localStorage.setItem(keyset.chat,JSON.stringify(fixture.data));localStorage.setItem(keyset.docs,JSON.stringify(fixture.docs));localStorage.setItem('aven-polished-direct-teams-migration-v4','v4');localStorage.setItem('aven-polished-local-reactions-v1','v1');},{keyset:keys,fixture:richFixture});
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin&&request.method()==='GET'&&!url.pathname.startsWith('/api/'))return route.continue();
    blocked.push({url:request.url(),method:request.method()});return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  await page.goto(`${origin}/polished.html?revision=ux-pipeline-v7`);await page.locator('#quick-create').waitFor();
  return{context,page,origin,blocked};
}
async function openCreate(page){
  if(await page.locator('#workspace-create-dialog').isVisible().catch(()=>false))await page.locator('#cancel-workspace-create').click();
  await page.locator('#quick-create').click();await page.locator('[data-create="agent"]').click();
  await page.locator('#workspace-create-name').fill('Creation audit coworker');
  await page.locator('#workspace-create-role').fill('Disposable local storage recovery fixture; no model request');
}
async function injectFailures(page,rules){
  await page.evaluate((config)=>{
    const original=Storage.prototype.setItem,counts={};
    window.__creationAuditStorage={original,counts};
    Storage.prototype.setItem=function(key,value){counts[key]=(counts[key]||0)+1;const rule=config.find(item=>item.key===key&&item.call===counts[key]);if(rule)throw new DOMException('Audit simulated storage failure','QuotaExceededError');return original.call(this,key,value);};
  },rules);
}
async function restoreStorage(page){await page.evaluate(()=>{if(window.__creationAuditStorage){Storage.prototype.setItem=window.__creationAuditStorage.original;delete window.__creationAuditStorage;}});}
async function runFailureScenario(server,label,rules){
  const run=await contextFor(server),before=await rawSnapshot(run.page);let error=null,after=null;
  try{await openCreate(run.page);await injectFailures(run.page,rules);await run.page.locator('#finish-workspace-create').click();after=await rawSnapshot(run.page);}catch(exception){error=String(exception);}finally{await restoreStorage(run.page).catch(()=>{});}
  const expected=mode==='baseline'?{persisted:true,rawUnchanged:false}:{persisted:false,rawUnchanged:true};
  const observed={persisted:!!after?.agent,matchingChats:after?.matchingChats||0,matchingDocuments:!!after?.matchingDocuments,rawUnchanged:!!after&&sameRaw(before,after),existingUnchanged:!!after&&sameExisting(before,after),pending:!!after?.pending,status:after?.status||'',dialogOpen:!!after?.dialogOpen};
  const passed=!error&&observed.persisted===expected.persisted&&observed.rawUnchanged===expected.rawUnchanged&&observed.existingUnchanged&&(!expected.persisted?observed.matchingChats===0&&observed.matchingDocuments===false:observed.matchingChats===0);
  await run.context.close();
  return{label,passed,before:before.raw,after:after?.raw||null,observed,expected,blockedRequests:run.blocked,error};
}
async function runRetryScenario(server){
  const run=await contextFor(server),before=await rawSnapshot(run.page);let error=null,failed=null,success=null,duplicate=null,reloaded=null;
  try{
    await openCreate(run.page);await injectFailures(run.page,[{key:keys.chat,call:1}]);await run.page.locator('#finish-workspace-create').click();failed=await rawSnapshot(run.page);await restoreStorage(run.page);
    await run.page.locator('#cancel-workspace-create').click();await openCreate(run.page);await run.page.locator('#finish-workspace-create').click();success=await rawSnapshot(run.page);
    await openCreate(run.page);await run.page.locator('#finish-workspace-create').click();duplicate={status:await run.page.locator('#workspace-create-status').textContent(),snapshot:await rawSnapshot(run.page)};await run.page.locator('#cancel-workspace-create').click();
    await run.page.reload();await run.page.locator('#quick-create').waitFor();reloaded=await rawSnapshot(run.page);
  }catch(exception){error=String(exception);}
  finally{await restoreStorage(run.page).catch(()=>{});await run.context.close();}
  const expectedMode=mode==='baseline';
  const expected=expectedMode?{retryCreated:false,duplicateMessage:false}:{retryCreated:true,duplicateMessage:true};
  const observed={failedPersisted:!!failed?.agent,failedRawUnchanged:!!failed&&sameRaw(before,failed),retryCreated:!!success?.agent&&success.matchingChats===1&&success.matchingDocuments===true&&success.welcomeCount===1,localWelcome:!!success?.welcomeLocal&&run.blocked.length===0,existingUnchangedAfterFailure:!!failed&&sameExisting(before,failed),existingUnchangedAfterSuccess:!!success&&sameExisting(before,success),duplicateMessage:/different name/i.test(duplicate?.status||''),postReloadCreated:!!reloaded?.agent,postReloadChats:reloaded?.matchingChats||0};
  const passed=!error&&observed.retryCreated===expected.retryCreated&&(!expectedMode?observed.localWelcome&&observed.duplicateMessage&&observed.failedPersisted===false&&observed.failedRawUnchanged&&observed.existingUnchangedAfterFailure&&observed.existingUnchangedAfterSuccess&&observed.postReloadCreated===true&&observed.postReloadChats===1:observed.duplicateMessage);
  return{label:'same-name retry, duplicate rejection, reload',passed,before:before.raw,failed:failed?.raw||null,success:success?.raw||null,duplicate:duplicate?.snapshot?.raw||null,reloaded:reloaded?.raw||null,observed,expected,blockedRequests:run.blocked,error,localWelcome:success?.agent?{welcomeCount:success.welcomeCount,welcomeLocal:success.welcomeLocal,modelHistory:false}:null};
}
async function runPersistentRollbackScenario(server){
  const run=await contextFor(server),before=await rawSnapshot(run.page);let error=null,after=null,blockedRetry=null,reloaded=null;
  try{
    await openCreate(run.page);
    await injectFailures(run.page,[{key:keys.docs,call:1},{key:keys.prefs,call:2},{key:keys.prefs,call:3},{key:keys.prefs,call:4}]);
    await run.page.locator('#finish-workspace-create').click();after=await rawSnapshot(run.page);await run.page.locator('#finish-workspace-create').click();blockedRetry=await rawSnapshot(run.page);await restoreStorage(run.page);
    await run.page.reload();await run.page.locator('#quick-create').waitFor();reloaded=await rawSnapshot(run.page);
  }catch(exception){error=String(exception);}finally{await restoreStorage(run.page).catch(()=>{});await run.context.close();}
  const expected={pendingAfterFailure:true,blockedRetryStillPending:true,recoveredAfterReload:true};
  const observed={pendingAfterFailure:!!after?.pending,persistedAfterFailure:!!after?.agent,rawChangedAfterFailure:!!after&&!sameRaw(before,after),existingUnchangedAfterFailure:!!after&&sameExisting(before,after),blockedRetryStillPending:!!blockedRetry?.pending,blockedRetryRawStable:!!blockedRetry&&!!after&&['prefs','chat','docs','pending'].every(name=>blockedRetry.raw[name]===after.raw[name]),blockedRetryMessage:/(pending coworker change|previous local creation)/i.test(blockedRetry?.workspaceStatus||''),recoveredAfterReload:!!reloaded&&!reloaded.agent&&!reloaded.pending&&reloaded.matchingChats===0,postReloadRawUnchanged:!!reloaded&&sameRaw(before,reloaded),existingUnchangedAfterReload:!!reloaded&&sameExisting(before,reloaded)};
  return{label:'persistent failure with rollback failure, blocked retry and startup recovery',passed:!error&&observed.pendingAfterFailure===expected.pendingAfterFailure&&observed.persistedAfterFailure===true&&observed.existingUnchangedAfterFailure&&observed.blockedRetryStillPending&&observed.blockedRetryRawStable&&observed.blockedRetryMessage&&observed.recoveredAfterReload===expected.recoveredAfterReload&&observed.postReloadRawUnchanged===expected.recoveredAfterReload&&observed.existingUnchangedAfterReload,before:before.raw,after:after?.raw||null,blockedRetry:blockedRetry?.raw||null,blockedRetryStatus:blockedRetry?.workspaceStatus||'',reloaded:reloaded?.raw||null,observed,expected,blockedRequests:run.blocked,error};
}
let browser,server;
(async()=>{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});server=await serve();
  const scenarios=[];
  scenarios.push(await runFailureScenario(server,'failure at preferences write',[{key:keys.prefs,call:1}]));
  scenarios.push(await runFailureScenario(server,'failure at chat write',[{key:keys.chat,call:1}]));
  scenarios.push(await runFailureScenario(server,'failure at documents write',[{key:keys.docs,call:1}]));
  scenarios.push(await runPersistentRollbackScenario(server));
  scenarios.push(await runRetryScenario(server));
  const report={mode,overlay:override,scope:'Isolated Chromium context; static local overlay; non-static requests blocked; no provider, device, credential or user-storage writes.',tests:scenarios,passed:scenarios.every(test=>test.passed),commands:{node:process.execPath,mode:process.argv.slice(2)}};
  fs.writeFileSync(path.join(outputDir,`creation-evidence-${mode}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({mode,passed:report.passed,tests:scenarios.map(test=>({label:test.label,passed:test.passed,observed:test.observed,error:test.error||null}))},null,2));
  process.exitCode=report.passed?0:1;
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(browser)await browser.close();});
