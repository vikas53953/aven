const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const base='http://127.0.0.1:8767';
const evidenceDir=__dirname;
const report={startedAt:new Date().toISOString(),checks:[],screenshots:[],errors:[],externalRequests:[]};
const fingerprint=()=>Object.fromEntries(['polished.html','polished.css','polished.js','prototype-review.html'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(evidenceDir,'..',name))).digest('hex')]));
report.candidateStart=fingerprint();
const sentinels={'aven-wireframe-preferences-v1':'{"preserve":"user preferences"}','aven-wireframe-conversations-v1':'{"preserve":"user conversations"}','intentgraph-visual-map-review-v08':'{"preserve":"user decisions"}'};
let browser;
const record=(name,status,detail)=>report.checks.push({name,status,detail});
async function run(name,fn){try{await fn();record(name,'PASS','Executed successfully.');}catch(e){record(name,'FAIL',e.message);console.error(name,e.message);}}
async function pageFor(){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base+'/'))report.externalRequests.push({url:r.url(),method:r.method()});});
 await page.addInitScript(values=>{for(const [k,v]of Object.entries(values)){if(localStorage.getItem(k)===null)localStorage.setItem(k,v);}},sentinels);
 await page.goto(base+'/polished.html');await page.locator('#draft').waitFor();
 return page;
}
async function capture(p,name){const relative='.intentgraph/polished-'+name+'.png';await p.screenshot({path:path.join(evidenceDir,'polished-'+name+'.png')});report.screenshots.push({name,path:relative});}
async function oldDataUnchanged(p){const values=await p.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(sentinels));assert.deepEqual(values,sentinels);}
async function create(p,type,name){
 await p.locator('#quick-create').click();await p.locator('[data-create="'+type+'"]').click();
 if(type==='chat')return;
 assert.equal(await p.locator('dialog[open]').count(),0,'Creation must occupy center, not a modal');
 await p.locator('#workspace-create-name').fill(name);
 if(type==='agent')await p.locator('#workspace-create-role').fill('Review firewall changes and explain findings.');
 await p.locator('#finish-workspace-create').click();
}
function luminance(color){const nums=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*nums[0]+.7152*nums[1]+.0722*nums[2];}
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
(async()=>{
 browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,ignoreDefaultArgs:['--headless'],args:['--headless=new']});
 try{
 await run('P1/P7: accepted placement and six viewport widths',async()=>{
  const p=await pageFor();
  assert.equal(await p.locator('#agent-rail-add,#new-agent-shortcut').count(),0);
  let t=await p.locator('#toggle').boundingBox(),c=await p.locator('#quick-create').boundingBox(),s=await p.locator('[data-destination="Search"]').boundingBox();
  assert(t.x+t.width<=c.x+1&&Math.abs(t.y-c.y)<4,'Collapse precedes Create');assert(s.y>c.y,'Search is below Create');
  await capture(p,'desktop');
  for(const width of [1920,1440,1024,768,390,320]){
   await p.setViewportSize({width,height:width<500?844:1000});
   if(await p.locator('#close-pane').isVisible())await p.locator('#close-pane').click();
   const dims=await p.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dims.scroll<=dims.viewport+1,`Page overflow at ${width}`);
   for(const id of ['#quick-create','#settings','#composer','#send']){const box=await p.locator(id).boundingBox();assert(box&&box.x>=-1&&box.x+box.width<=width+1,`${id} clipped horizontally at ${width}`);assert(box.y>=-1&&box.y+box.height<=(width<500?844:1000)+1,`${id} clipped vertically at ${width}`);}
   await p.locator('#avatar').click();const box=await p.locator('#right-pane').boundingBox();assert(box&&box.x>=-1&&box.x+box.width<=width+1,`Right pane clipped at ${width}`);
   await capture(p,String(width));
  }
  await oldDataUnchanged(p);await p.context().close();
 });
 await run('P2/P3: create, cancel, attachments, search and isolated storage',async()=>{
  const p=await pageFor();
  await p.locator('#draft').fill('Keep this original draft');
  await p.locator('#quick-create').click();await p.locator('[data-create="agent"]').click();
  await p.locator('#cancel-workspace-create').click();assert.equal(await p.locator('#draft').inputValue(),'Keep this original draft');
  await create(p,'agent','Policy reviewer');
  await p.locator('#recipient-summary').click();
  const recipients=p.locator('#recipient-options input[type="checkbox"]');assert((await recipients.count())>=2,'Created profiles are selectable in chat');
  for(let i=0;i<await recipients.count();i++)await recipients.nth(i).check();
  await p.locator('#recipient-summary').click();
  await p.locator('#draft').fill('Review policy at https://example.test/guide');
  await p.locator('#file-picker').setInputFiles({name:'policy.txt',mimeType:'text/plain',buffer:Buffer.from('local fixture')});
  assert.match(await p.locator('#attachments').innerText(),/policy.txt/);
  await p.locator('#image-picker').setInputFiles({name:'diagram.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wS8AAAAASUVORK5CYII=','base64')});
  await p.locator('#attachments img').waitFor();assert.equal(await p.locator('#attachments img').evaluate(n=>n.complete&&n.naturalWidth>0),true,'Image preview decoded');
  await p.getByRole('button',{name:/Remove.*diagram.png/}).click();assert.doesNotMatch(await p.locator('#attachments').innerText(),/diagram.png/);
  await p.locator('#send').click();assert.match(await p.locator('#conversation').innerText(),/Review policy at/);
  assert.match(await p.locator('#conversation').innerText(),/Policy reviewer/);
  await p.locator('#new-chat').click();assert.doesNotMatch(await p.locator('#conversation').innerText(),/Review policy at/);
  await p.locator('#draft').fill('Independent draft');
  await p.reload();await p.locator('#draft').waitFor();assert.equal(await p.locator('#draft').inputValue(),'Independent draft');
  await p.locator('[data-destination="Search"]').click();
  for(const name of ['All','Messages','Chats','Agents','Channels','Projects','Files','Links'])assert.equal(await p.locator('#search-filters').getByRole('button',{name,exact:true}).count(),1);
  await p.locator('#search-filters').getByRole('button',{name:'Files',exact:true}).click();assert.match(await p.locator('#search-results').innerText(),/policy.txt/);
  await p.locator('#search-filters').getByRole('button',{name:'Messages',exact:true}).click();await p.locator('#global-search').fill('Review policy');await p.locator('#search-results button').first().click();assert.match(await p.locator('#conversation').innerText(),/Review policy at/);
  await create(p,'project','Branch rollout');
  await p.getByRole('button',{name:'+ New channel',exact:true}).click();await p.locator('#cancel-workspace-create').click();assert.equal(await p.locator('#surface').innerText(),'Branch rollout','Cancel must restore owning project');
  await p.getByRole('button',{name:'+ New channel',exact:true}).click();await p.locator('#workspace-create-name').fill('Policies');await p.locator('#finish-workspace-create').click();
  await p.getByRole('button',{name:'+ New thread',exact:true}).click();await p.locator('#cancel-workspace-create').click();assert.equal(await p.locator('#surface').innerText(),'# Policies','Cancel must restore owning channel');
  await p.getByRole('button',{name:'+ New thread',exact:true}).click();await p.locator('#workspace-create-name').fill('Review firewall change');await p.locator('#finish-workspace-create').click();assert.match(await p.locator('#chat-location').innerText(),/Branch rollout.*Policies/);
  await p.locator('[data-destination="Channels"]').click();await p.locator('#chat-directory .directory-item').filter({hasText:'# Policies'}).click();await p.locator('#new-chat').click();assert.match(await p.locator('#chat-location').innerText(),/Branch rollout.*Policies/,'Header new chat retains channel/project ownership');
  await oldDataUnchanged(p);await capture(p,'organization');await p.context().close();
 });
 await run('P4: agent document save/cancel/escape and ownership',async()=>{
  const p=await pageFor();
  await p.locator('[data-doc="SOUL.md"]').click();await p.locator('#doc-textarea').fill('Companion-specific policy draft');await p.locator('#save-doc').click();await p.locator('#back-doc').click();
  const agents=await p.locator('#active-agent option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent})));assert(agents.length>=2);
  await p.locator('#active-agent').selectOption(agents[1].value);await p.locator('[data-doc="SOUL.md"]').click();assert.notEqual(await p.locator('#doc-textarea').inputValue(),'Companion-specific policy draft');
  const original=await p.locator('#doc-textarea').inputValue();await p.locator('#doc-textarea').fill('Discard this unsaved change');
  p.once('dialog',d=>d.dismiss());await p.keyboard.press('Escape');assert.equal(await p.locator('#doc-textarea').inputValue(),'Discard this unsaved change');
  await p.locator('#cancel-doc').click();await p.locator('[data-doc="SOUL.md"]').click();assert.equal(await p.locator('#doc-textarea').inputValue(),original);
  await p.locator('#back-doc').click();await p.locator('#active-agent').selectOption(agents[0].value);await p.locator('[data-doc="SOUL.md"]').click();assert.equal(await p.locator('#doc-textarea').inputValue(),'Companion-specific policy draft');
  await p.reload();await p.locator('[data-doc="SOUL.md"]').click();assert.equal(await p.locator('#doc-textarea').inputValue(),'Companion-specific policy draft');await capture(p,'agent-document');
  await p.locator('#back-doc').click();await p.locator('[data-destination="Artifacts"]').click();assert.match(await p.locator('#pane-content').innerText(),/Investigation.md/);
  await p.locator('#new-chat').click();await p.locator('[data-destination="Artifacts"]').click();assert.doesNotMatch(await p.locator('#pane-content').innerText(),/Investigation.md/);
  await oldDataUnchanged(p);await p.context().close();
 });
 await run('P6: deterministic sample states, cancellation and context changes',async()=>{
  const p=await pageFor();
  for(const view of ['browser','plugins','computer']){
   await p.locator('[data-pane="'+view+'"]').click();assert.match(await p.locator('#pane-content').innerText(),/preview only/);
   await p.locator('#run-tool').click();assert.match(await p.locator('#tool-state').innerText(),/Loading/);await p.locator('#tool-state.state-success').waitFor();
   await p.locator('#run-tool').click();await p.locator('#tool-state.state-error').waitFor();await capture(p,view+'-error');
   await p.locator('#retry-tool').click();await p.locator('#tool-state.state-success').waitFor();
   await p.locator('#reset-tool').click();await p.locator('#run-tool').click();assert.equal(await p.locator('#run-tool').isDisabled(),true);await p.locator('#cancel-tool').click();await p.waitForTimeout(800);assert.match(await p.locator('#tool-state').innerText(),/Idle/);
   await p.locator('#run-tool').click();await p.locator('[data-pane="agent"]').click();await p.waitForTimeout(800);await p.locator('[data-pane="'+view+'"]').click();assert.match(await p.locator('#tool-state').innerText(),/Idle/,'Leaving preview must not retain stuck loading or stale result');
  }
  await p.locator('#run-tool').click();await p.locator('#new-chat').click();await p.locator('#avatar').click();await p.locator('[data-pane="computer"]').click();assert.match(await p.locator('#tool-state').innerText(),/Idle/);
  await oldDataUnchanged(p);await p.context().close();
 });
 await run('P5/P7: settings, keyboard, themes and contrast matrix',async()=>{
  const p=await pageFor();const matrix=[];
  for(const theme of ['dark','light']){
   await p.locator('#settings').click();
   for(const name of ['General','Appearance','Agents','Models & providers','Connections','Privacy & data']){await p.locator('#settings-nav').getByRole('button',{name,exact:true}).click();assert((await p.locator('#settings-content').innerText()).trim().length>0);}
   await p.locator('#settings-nav').getByRole('button',{name:'Appearance',exact:true}).click();await p.locator('#pref-theme').selectOption(theme);await p.locator('#save-settings').click();
   await p.locator('#settings-dialog').waitFor({state:'hidden'});await p.locator('#settings').click();await capture(p,'settings-'+theme);await p.keyboard.press('Escape');await p.locator('#settings-dialog').waitFor({state:'hidden'});assert.equal(await p.locator('#settings').evaluate(n=>n===document.activeElement),true);
   await p.reload();await p.locator('#draft').waitFor();
   const colors=await p.evaluate(()=>{const result={};for(const name of ['bg','surface','text','muted','faint','accent','on-accent','selected','focus','disabled']){const probe=document.createElement('span');probe.style.color=`var(--${name})`;document.body.append(probe);result[name]=getComputedStyle(probe).color;probe.remove();}return result;});
   for(const [label,fg,bg,min]of [['body','text','bg',4.5],['muted','muted','surface',4.5],['helper','faint','surface',4.5],['action','on-accent','accent',4.5],['selected','text','selected',4.5],['focus','focus','surface',3],['disabled','disabled','surface',0]]){const ratio=contrast(colors[fg],colors[bg]);matrix.push({theme,label,foreground:colors[fg],background:colors[bg],ratio:Number(ratio.toFixed(2)),target:min||'record only'});report.contrast=matrix;if(min)assert(ratio>=min,`${theme} ${label} contrast ${ratio.toFixed(2)} < ${min}`);}
   await capture(p,theme);
   const messageLabel=await p.locator('.message.user .message-label').first().evaluate(n=>({foreground:getComputedStyle(n).color,background:getComputedStyle(n.closest('.message.user')).backgroundColor}));
   const messageRatio=contrast(messageLabel.foreground,messageLabel.background);matrix.push({theme,label:'rendered user-message label',...messageLabel,ratio:Number(messageRatio.toFixed(2)),target:4.5});assert(messageRatio>=4.5,`${theme} user message label contrast ${messageRatio.toFixed(2)}`);
  }
  report.contrast=matrix;
  await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#toggle').click();assert.equal(await p.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  const motions=await p.locator('#rail,#right-pane').evaluateAll(nodes=>nodes.map(n=>({transition:getComputedStyle(n).transitionDuration,animation:getComputedStyle(n).animationDuration})));report.reducedMotion=motions;for(const m of motions)assert(m.transition.split(',').every(v=>parseFloat(v)<=.01),'Reduced-motion transition still active');
  await oldDataUnchanged(p);await p.context().close();
 });
 await run('P7: narrow dialogs, focus containment and resizing',async()=>{
  const p=await pageFor();await p.locator('#close-pane').click();await p.setViewportSize({width:390,height:844});
  await p.locator('#settings').click();const settingsBox=await p.locator('#settings-dialog').boundingBox();assert(settingsBox.x>=0&&settingsBox.y>=0&&settingsBox.x+settingsBox.width<=391&&settingsBox.y+settingsBox.height<=845);
  for(const name of ['General','Appearance','Agents','Models & providers','Connections','Privacy & data']){await p.locator('#settings-nav').getByRole('button',{name,exact:true}).click();const save=await p.locator('#save-settings').boundingBox();assert(save.y+save.height<=844,'Save settings inaccessible in '+name);}
  await p.keyboard.press('Escape');await p.locator('#settings-dialog').waitFor({state:'hidden'});
  await p.locator('[data-destination="Search"]').click();const searchBox=await p.locator('#search-dialog').boundingBox();assert(searchBox.x>=0&&searchBox.x+searchBox.width<=391);await p.keyboard.press('Escape');
  await p.locator('#avatar').click();assert.equal(await p.locator('#right-pane').getAttribute('role'),'dialog');assert.equal(await p.locator('#rail').evaluate(n=>n.inert),true);
  for(let i=0;i<16;i++){await p.keyboard.press('Tab');assert.equal(await p.locator('#right-pane').evaluate(n=>n.contains(document.activeElement)),true,'Focus left narrow modal');}
  await p.setViewportSize({width:1440,height:1000});await p.waitForFunction(()=>!document.getElementById('center-column').inert);await p.locator('#draft').fill('Draft survives responsive transition');
  await p.setViewportSize({width:390,height:844});await p.waitForFunction(()=>document.getElementById('center-column').inert);await p.keyboard.press('Escape');await p.locator('#right-pane').waitFor({state:'hidden'});assert.equal(await p.locator('#draft').inputValue(),'Draft survives responsive transition');
  await capture(p,'narrow-conversation');await oldDataUnchanged(p);await p.context().close();
 });
 await run('Protected accepted wireframe sources unchanged',async()=>{const expected=JSON.parse(fs.readFileSync(path.join(evidenceDir,'polished-baseline-hashes.json'),'utf8').replace(/^\uFEFF/,''));const crypto=require('node:crypto');for(const f of expected){const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(evidenceDir,'..',f.path))).digest('hex');assert.equal(hash.toLowerCase(),f.sha256.toLowerCase(),f.path);}});
 await run('No page errors or external runtime requests',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);});
 }finally{await browser.close();report.finishedAt=new Date().toISOString();report.candidateEnd=fingerprint();report.candidateStable=JSON.stringify(report.candidateStart)===JSON.stringify(report.candidateEnd);if(!report.candidateStable)record('Candidate stability','STALE','Sources changed during the run; these are exploratory results, not a final candidate verdict.');const json=JSON.stringify(report,null,2);fs.writeFileSync(path.join(evidenceDir,'polished-test-results.json'),json);const runDir=path.join(evidenceDir,'polished-runs');fs.mkdirSync(runDir,{recursive:true});fs.writeFileSync(path.join(runDir,report.startedAt.replace(/[:.]/g,'-')+'.json'),json);console.log(JSON.stringify(report,null,2));if(report.checks.some(c=>c.status==='FAIL')||!report.candidateStable)process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1;});
