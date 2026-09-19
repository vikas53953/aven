'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('../../intentgraph/node_modules/playwright');
const out=__dirname;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const blocked=[];
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin==='http://127.0.0.1:8767'&&route.request().method()==='GET'&&!u.pathname.startsWith('/api/'))return route.continue();
  blocked.push(u.origin+u.pathname);return route.abort();
 });
 try{
  const p=await context.newPage();p.setDefaultTimeout(10000);
  await p.goto('http://127.0.0.1:8767/polished.html?revision=ux-pipeline-v7');
  await p.locator('#quick-create').click();
  await p.locator('[data-create="agent"]').click();
  await p.locator('#workspace-create-name').fill('Audit atomic creation');
  await p.locator('#workspace-create-role').fill('Disposable fixture coworker; no model request');
  await p.evaluate(()=>{
    window.auditOriginalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(k==='aven-polished-chats-v1')throw new DOMException('Audit simulated quota failure','QuotaExceededError');return window.auditOriginalSetItem.call(this,k,v);};
  });
  await p.locator('#finish-workspace-create').click();
  const afterFailure=await p.evaluate(()=>{
   const prefs=JSON.parse(localStorage.getItem('aven-polished-preferences-v1'));
   const chats=JSON.parse(localStorage.getItem('aven-polished-chats-v1'));
   const docs=JSON.parse(localStorage.getItem('aven-polished-docs-v1')||'{}');
   const created=prefs.agents.find(a=>a.name==='Audit atomic creation');
   return {status:document.querySelector('#chat-status').textContent,persistedCoworker:!!created,matchingChats:chats.chats.filter(c=>c.recipients.includes(created?.id)).length,matchingDocuments:!!docs[created?.id],dialogOpen:document.querySelector('#workspace-create-dialog').open};
  });
  await p.evaluate(()=>{Storage.prototype.setItem=window.auditOriginalSetItem;});
  await p.reload();
  const afterReload=await p.evaluate(()=>{
    const prefs=JSON.parse(localStorage.getItem('aven-polished-preferences-v1'));
    const chats=JSON.parse(localStorage.getItem('aven-polished-chats-v1'));
    const created=prefs.agents.find(a=>a.name==='Audit atomic creation');
    return {persistedCoworker:!!created,matchingChats:chats.chats.filter(c=>c.recipients.includes(created?.id)).length,sidebarContainsCoworker:document.querySelector('#direct-list').textContent.includes('Audit atomic creation')};
  });
  await p.locator('#quick-create').click();await p.locator('[data-create="agent"]').click();
  await p.locator('#workspace-create-name').fill('Audit atomic creation');await p.locator('#workspace-create-role').fill('Retry failed local creation');
  await p.locator('#finish-workspace-create').click();
  const retryMessage=await p.locator('#workspace-create-status').textContent();
  await p.screenshot({path:path.join(out,'root-storage-defect.png')});
  const result={scope:'Isolated Chromium context; real current frontend; simulated localStorage chat write failure; all non-static requests blocked',afterFailure,afterReload,retryMessage,blockedRequests:blocked,defectReproduced:afterFailure.persistedCoworker&&afterFailure.matchingChats===0&&/different name/i.test(retryMessage)};
  fs.writeFileSync(path.join(out,'root-storage-evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
