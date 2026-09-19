'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const project=path.resolve(__dirname,'../../..');
const {chromium}=require(path.join(project,'intentgraph/node_modules/playwright'));
const candidate=process.env.AVEN_UI_ROOT||path.join(__dirname,'minimal-ui/candidate');
const out=process.env.AVEN_UI_REPORT||path.join(__dirname,'root-ui-boundaries.json');
const sourceHashes=Object.fromEntries(['polished.html','polished.js','polished.css'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(candidate,file))).digest('hex')]));
const raw='Gi0/1 input errors 999';
const prefs={theme:'dark',activeAgent:'companion',agents:[{id:'companion',name:'Network companion',role:'Diagnose networks'}],showEvidence:false,showInvestigation:false,showRunDetails:false};
const results=[],errors=[];
let browser;
async function pageFor(messages){
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({prefs,messages,raw})=>{
  localStorage.setItem('aven-polished-preferences-v1',JSON.stringify(prefs));
  localStorage.setItem('aven-polished-chats-v1',JSON.stringify({activeChat:'qa',chats:[{id:'qa',title:'QA',sample:false,recipients:['companion'],messages,draft:'',pendingQueue:[]}],projects:[{id:'personal',name:'Personal',system:true}],channels:[]}));
  localStorage.setItem('aven-polished-direct-teams-migration-v4','v4');
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   if(String(input).endsWith('/api/chat')&&init?.method==='POST'){
    window.__qaRequest=JSON.parse(init.body);
    const encoder=new TextEncoder();
    return new Response(new ReadableStream({start(controller){
     controller.enqueue(encoder.encode(JSON.stringify({type:'start',runId:'qa-run',steeringToken:'qa-steer'})+'\n'));
     controller.enqueue(encoder.encode(JSON.stringify({type:'tool_result',command:'show interfaces',target:'router-1',status:'SUCCESS',output:raw})+'\n'));
     window.__qaFinish=()=>{controller.enqueue(encoder.encode(JSON.stringify({type:'final',reply:{text:'The command completed; device health is not established.',status:'SUCCESS',runId:'qa-run'}})+'\n'));controller.close();};
     init.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
    }}),{headers:{'Content-Type':'application/x-ndjson'}});
   }
   return original(input,init);
  };
 },{prefs,messages,raw});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='http://127.0.0.1:8767')return route.abort();
  const rel=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(rel.split('/').includes('..'))return route.abort();
  const file=[path.join(candidate,rel),path.join(project,rel)].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
  if(!file)return route.abort();
  const contentType=rel.endsWith('.html')?'text/html':rel.endsWith('.css')?'text/css':rel.endsWith('.js')?'text/javascript':rel.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
  return route.fulfill({status:200,contentType,body:fs.readFileSync(file)});
 });
 await page.goto('http://127.0.0.1:8767/polished.html',{waitUntil:'domcontentloaded'});
 return {page,context};
}
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 await check('Failure with raw output stays visible when diagnostics are off',async()=>{
  const {page,context}=await pageFor([{id:'failed',role:'assistant',agentId:'companion',text:'The diagnostic returned a result.',status:'FAILURE',runId:'failed-run',evidence:[{command:'show interfaces',target:'router-1',status:'FAILURE',output:raw}],createdAt:new Date().toISOString()}]);
  try{const visible=await page.locator('#conversation').innerText();assert.match(visible,/failure|failed/i);assert.ok(!visible.includes(raw));}finally{await context.close();}
 });
 await check('Active raw output and investigation stay hidden while Stop remains visible',async()=>{
  const {page,context}=await pageFor([]);
  try{
   await page.locator('#draft').fill('Check router-1');await page.locator('#send').click();
   await page.locator('.working-message').waitFor({state:'visible'});
   await page.waitForFunction(()=>!!window.__qaFinish);
   await page.waitForTimeout(180);
   const visible=await page.locator('#conversation').innerText();
   assert.match(visible,/Stop/);assert.ok(!visible.includes(raw),'raw output leaks into active minimal conversation');assert.ok(!visible.includes('tool result'),'optional investigation leaks into active minimal conversation');
   await page.evaluate(()=>window.__qaFinish());
  }finally{await context.close();}
 });
 await check('Long generated code is folded without hiding the explanation or changing code',async()=>{
  const generated=Array.from({length:24},(_,i)=>'<div>Exact  '+i+'</div>').join('\n');
  const {page,context}=await pageFor([{id:'generated',role:'assistant',agentId:'companion',text:'Here is the dashboard.\n\n```html\n'+generated+'\n```',createdAt:new Date().toISOString()}]);
  try{const details=page.locator('.message-code-fold');assert.equal(await details.count(),1);assert.equal(await details.getAttribute('open'),null);assert.match(await page.locator('#conversation').innerText(),/Here is the dashboard/);assert.ok(!(await page.locator('#conversation').innerText()).includes('Exact  0'));await details.locator('summary').click();assert.equal(await details.locator('pre code').textContent(),generated);assert.equal(await details.locator('script,iframe').count(),0);}finally{await context.close();}
 });
 await browser.close();
 fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),candidate,sourceHashes,results,pageErrors:errors,externalCalls:0,passed:results.every(r=>r.passed)&&errors.length===0},null,2));
 console.log(JSON.stringify({results,pageErrors:errors}));process.exitCode=results.every(r=>r.passed)&&errors.length===0?0:1;
})().catch(async e=>{await browser?.close();console.error(e);process.exitCode=1;});
