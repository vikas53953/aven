const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const base='http://127.0.0.1:8767';
const root=path.join(__dirname,'..');
const keys={prefs:'aven-polished-preferences-v1',data:'aven-polished-chats-v1',docs:'aven-polished-docs-v1'};
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
const fingerprint=()=>Object.fromEntries(['polished.html','polished.css','polished.js','prototype-review.html'].map(f=>[f,hash(f)]));
const report={baseline:'F07',startedAt:new Date().toISOString(),candidateStart:fingerprint(),checks:[],captures:[],errors:[],externalRequests:[]};
const sentinel={'unrelated-project-data':'KEEP RAW VALUE','aven-wireframe-conversations-v1':'{"untouched":true}'};
let browser;
async function run(name,fn){try{await fn();report.checks.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){report.checks.push({name,status:'FAIL',detail:e.message});console.error('FAIL '+name+': '+e.message);}}
async function pageFor(seed={}){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();p.setDefaultTimeout(6000);
 p.on('pageerror',e=>report.errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base+'/'))report.externalRequests.push(r.url());});
 await p.addInitScript(values=>{if(!sessionStorage.getItem('p2-test-seeded')){for(const [k,v]of Object.entries(values))localStorage.setItem(k,v);sessionStorage.setItem('p2-test-seeded','yes');}}, {...sentinel,...seed});
 await p.goto(base+'/polished.html');await p.locator('#draft').waitFor();return p;
}
async function stored(p,key){return p.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);}
async function screenshot(p,name){const file='p2-'+name+'.png';await p.screenshot({path:path.join(__dirname,file)});report.captures.push({label:name,path:'.intentgraph/'+file});}
async function unchanged(p){assert.deepEqual(await p.evaluate(ks=>Object.fromEntries(ks.map(k=>[k,localStorage.getItem(k)])),Object.keys(sentinel)),sentinel);}
async function dismissPane(p){if(await p.locator('#close-pane').isVisible())await p.locator('#close-pane').click();}
async function create(p,type,name){await p.locator('#quick-create').click();await p.locator(`[data-create="${type}"]`).click();assert(await p.locator('dialog[open]').count()>0,'Creation must be a popup');if(name)await p.locator('#workspace-create-name').fill(name);}
async function settings(p,page='appearance'){await dismissPane(p);await p.locator('#account-button').click();await p.locator('[data-account-action=settings]').click();await p.locator(`[data-category="${page}"]`).click();}
function lum(c){const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];}
function contrast(a,b){const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
async function bounded(p,selector,width,height){const b=await p.locator(selector).boundingBox();assert(b,selector+' visible');assert(b.x>=-1&&b.y>=-1&&b.x+b.width<=width+1&&b.y+b.height<=height+1,selector+' outside '+width+'x'+height+': '+JSON.stringify(b));}
async function main(){
 browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,ignoreDefaultArgs:['--headless'],args:['--headless=new']});
 try{
 await run('F07 preservation: idempotent migration and original storage backup',async()=>{
  const oldPrefs={theme:'light',displayName:'Preserved user',activeAgent:'companion',agents:[{id:'companion',name:'Saved companion',role:'Keep role'},{id:'custom',name:'Saved agent',role:'Custom role'}]};
  const oldData={activeChat:'orphan',projects:[{id:'existing-project',name:'Existing project'}],channels:[{id:'existing-channel',name:'Existing channel',projectId:'existing-project',recipients:['custom']}],chats:[{id:'orphan',title:'Unassigned draft',projectId:null,channelId:null,recipients:['companion','custom'],draft:'Do not lose my draft',pendingAttachmentNames:['pending.png'],messages:[{id:'m1',text:'Stored message https://example.test/',role:'user',attachments:['report.txt'],recipients:['custom']}]},{id:'channel-chat',title:'Channel draft',projectId:'existing-project',channelId:'existing-channel',recipients:['custom'],draft:'Second draft',pendingAttachmentNames:[],messages:[]}]};
  const oldDocs={companion:{'SOUL.md':'Original soul','MEMORY.md':''},custom:{'SOUL.md':'Custom soul','MEMORY.md':'Custom memory'}};
  const seed={[keys.prefs]:JSON.stringify(oldPrefs),[keys.data]:JSON.stringify(oldData),[keys.docs]:JSON.stringify(oldDocs)};
  const p=await pageFor(seed);const after=await stored(p,keys.data);assert.equal(after.chats.length,2);
  for(const old of oldData.chats){const next=after.chats.find(c=>c.id===old.id);for(const k of ['title','channelId','recipients','draft','pendingAttachmentNames','messages'])assert.deepEqual(next[k],old[k],k+' must survive');assert(next.projectId&&after.projects.some(x=>x.id===next.projectId));}
  assert.equal(after.chats[1].projectId,'existing-project');assert.deepEqual(await stored(p,keys.docs),oldDocs);
  const raw=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
  const backups=Object.entries(raw).filter(([k])=>/backup/i.test(k));assert(backups.length,'A raw migration backup is required');
  for(const [k,v]of Object.entries(seed))assert(backups.some(([,b])=>b.includes(JSON.stringify(v).slice(1,-1))||b.includes(v)||b===v),'Original raw '+k+' missing from backup');
  await p.reload();assert.deepEqual(await stored(p,keys.data),after,'Migration idempotent');assert.deepEqual(await stored(p,keys.docs),oldDocs);for(const [k,v]of backups)assert.equal(await p.evaluate(k=>localStorage.getItem(k),k),v,'Backup overwritten');
  assert.equal(await p.locator('#draft').inputValue(),'Do not lose my draft');await unchanged(p);await p.context().close();
 });
 await run('F07-01/02/03: popup creation, immediate conversation and channel/project ownership',async()=>{
  const p=await pageFor();assert.equal(await p.locator('[data-create="chat"],#new-chat,[data-destination="Chat"]').count(),0);
  const title=await p.locator('#surface').innerText();await p.locator('#draft').fill('Retain on cancel');await create(p,'agent','Cancelled');await screenshot(p,'create-agent');await p.locator('#cancel-workspace-create').click();assert.equal(await p.locator('#surface').innerText(),title);assert.equal(await p.locator('#draft').inputValue(),'Retain on cancel');
  await create(p,'project','Network operations');await p.locator('#finish-workspace-create').click();
  await create(p,'agent','Firewall analyst');await p.locator('#workspace-create-role').fill('Review routing and firewall policy.');
  if(await p.locator('#workspace-create-project').count())await p.locator('#workspace-create-project').selectOption({label:'Network operations'});
  await p.locator('#finish-workspace-create').click();assert(await p.locator('#composer').isVisible());
  let d=await stored(p,keys.data),prefs=await stored(p,keys.prefs);const a=prefs.agents.find(x=>x.name==='Firewall analyst');assert(a);const c=d.chats.find(x=>x.id===d.activeChat);assert(c.recipients.includes(a.id));assert.equal(d.projects.find(x=>x.id===c.projectId).name,'Network operations');
  await create(p,'channel','Change review');await p.locator('#workspace-create-project').selectOption({label:'Network operations'});
  await p.locator('#workspace-create-recipients input').evaluateAll(nodes=>nodes.length).then(n=>assert(n>=2));
  await p.locator('#workspace-create-recipients label').filter({hasText:'Firewall analyst'}).locator('input').check();await screenshot(p,'create-channel');await p.locator('#finish-workspace-create').click();
  d=await stored(p,keys.data);const ch=d.channels.find(x=>x.name==='Change review');assert(ch);assert.equal(d.projects.find(x=>x.id===ch.projectId).name,'Network operations');const cc=d.chats.find(x=>x.id===d.activeChat);assert.equal(cc.channelId,ch.id);assert.equal(cc.projectId,ch.projectId);assert(cc.recipients.includes(a.id));
  assert(await p.locator('#rail').getByText('Network operations',{exact:true}).count());await screenshot(p,'organization');await unchanged(p);await p.context().close();
 });
 await run('F07-04: Enter sends, Shift+Enter newline, IME never sends',async()=>{
  const p=await pageFor();const count=async()=>{const d=await stored(p,keys.data);return d.chats.find(c=>c.id===d.activeChat).messages.length;};const before=await count();
  await p.locator('#draft').fill('hi');await p.locator('#draft').press('Enter');assert.equal(await count(),before+1);assert.equal(await p.locator('#draft').inputValue(),'');assert.match(await p.locator('#conversation').innerText(),/hi/);
  await p.locator('#draft').fill('line one');await p.locator('#draft').press('Shift+Enter');await p.locator('#draft').press('x');assert.equal(await count(),before+1);assert.match(await p.locator('#draft').inputValue(),/line one\nx/);
  await p.locator('#draft').dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(await count(),before+1);assert.doesNotMatch(await p.locator('#toast').innerText(),/sent|saved/i);await p.context().close();
 });
 await run('F07-05/10: centered settings, theme, account actions and save/cancel',async()=>{
  const p=await pageFor();const initial=await stored(p,keys.prefs);await settings(p);await screenshot(p,'settings');await bounded(p,'#settings-dialog',1440,1000);const b=await p.locator('#settings-dialog').boundingBox();assert(Math.abs(b.x+b.width/2-720)<4&&Math.abs(b.y+b.height/2-500)<4,'Settings centered');
  await p.locator('#pref-theme').selectOption('light');await p.locator('#cancel-settings').click();assert.equal((await stored(p,keys.prefs)).theme,initial.theme);report.contrast=[];
  for(const theme of ['light','dark','system']){await settings(p);await p.locator('#pref-theme').selectOption(theme);assert(await p.locator('#pref-accent').count());assert(await p.locator('#pref-language').count());await p.locator('#save-settings').click();await p.locator('#settings-dialog').waitFor({state:'hidden'});await p.reload();assert.equal((await stored(p,keys.prefs)).theme,theme);if(theme==='system'){await p.emulateMedia({colorScheme:'light'});await p.waitForFunction(()=>document.documentElement.dataset.theme==='light');await p.emulateMedia({colorScheme:'dark'});await p.waitForFunction(()=>document.documentElement.dataset.theme==='dark');}else{const colors=await p.evaluate(()=>Object.fromEntries(['bg','surface','text','muted','faint','accent','on-accent','selected','focus'].map(k=>{const n=document.createElement('i');n.style.color=`var(--${k})`;document.body.append(n);const v=getComputedStyle(n).color;n.remove();return[k,v];})));for(const [fg,bg,min]of [['text','bg',4.5],['muted','surface',4.5],['faint','surface',4.5],['on-accent','accent',4.5],['text','selected',4.5],['focus','surface',3]]){const ratio=contrast(colors[fg],colors[bg]);report.contrast.push({theme,fg,bg,ratio});assert(ratio>=min,theme+' '+fg+'/'+bg+' contrast '+ratio);}await screenshot(p,theme);}}
  await p.locator('#account-button').click();await screenshot(p,'account-menu');for(const name of ['settings','about','help','feedback','logout'])assert(await p.locator('[data-account-action='+name+']').count(),name+' account action missing');await p.keyboard.press('Escape');await unchanged(p);await p.context().close();
 });
 await run('Preserved journeys: attachments, search, agent documents and tool states',async()=>{
  const p=await pageFor();await p.locator('#file-picker').setInputFiles({name:'network-note.txt',mimeType:'text/plain',buffer:Buffer.from('local test')});assert.match(await p.locator('#attachments').innerText(),/network-note.txt/);await p.locator('#draft').fill('Find policy evidence');await p.locator('#draft').press('Enter');
  await p.locator('[data-destination="Search"]').click();await p.locator('#global-search').fill('Find policy evidence');assert.match(await p.locator('#search-results').innerText(),/Find policy evidence/);await p.keyboard.press('Escape');
  await p.locator('#avatar').click();await p.locator('[data-doc="SOUL.md"]').click();await p.locator('#doc-textarea').fill('Per agent policy');await p.locator('#save-doc').click();await p.locator('#back-doc').click();
  const options=await p.locator('#active-agent option').evaluateAll(ns=>ns.map(n=>n.value));await p.locator('#active-agent').selectOption(options[1]);await p.locator('[data-doc="SOUL.md"]').click();assert.notEqual(await p.locator('#doc-textarea').inputValue(),'Per agent policy');await p.locator('#doc-textarea').fill('Unsaved');await p.locator('#cancel-doc').click();
  for(const view of ['browser','plugins','computer']){await p.locator(`[data-pane="${view}"]`).click();await p.locator('#run-tool').click();await p.locator('#tool-state.state-success').waitFor();await p.locator('#run-tool').click();await p.locator('#tool-state.state-error').waitFor();await p.locator('#retry-tool').click();await p.locator('#tool-state.state-success').waitFor();await p.locator('#run-tool').click();await p.locator('#cancel-tool').click();await p.waitForTimeout(750);assert.match(await p.locator('#tool-state').innerText(),/Idle/);}
  await unchanged(p);await p.context().close();
 });
 await run('F07 responsive: six widths, modal bounds, focus and reduced motion',async()=>{
  const p=await pageFor();for(const width of [1920,1440,1024,768,390,320]){const height=width<500?844:1000;await p.setViewportSize({width,height});await dismissPane(p);if(width<500&&await p.locator('#toggle').getAttribute('aria-expanded')==='true')await p.locator('#toggle').click();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow '+width);for(const sel of ['#quick-create','#account-button','#composer','#send'])await bounded(p,sel,width,height);await screenshot(p,String(width));await create(p,'agent');await bounded(p,'dialog[open]',width,height);await p.keyboard.press('Escape');await settings(p);await bounded(p,'#settings-dialog',width,height);await p.keyboard.press('Escape');}
  await p.locator('#avatar').click();assert.equal(await p.locator('#rail').evaluate(n=>n.inert),true);for(let i=0;i<14;i++){await p.keyboard.press('Tab');assert(await p.locator('#right-pane').evaluate(n=>n.contains(document.activeElement)),'Narrow focus escaped');}await p.keyboard.press('Escape');await p.emulateMedia({reducedMotion:'reduce'});const motion=await p.locator('#rail').evaluate(n=>getComputedStyle(n).transitionDuration);assert(motion.split(',').every(x=>parseFloat(x)<=.01));await p.context().close();
 });
 await run('F07-07: sidebar pointer/keyboard resize, collapse restoration and group context',async()=>{
  const p=await pageFor();const divider=p.locator('#sidebar-resize'),rail=p.locator('#rail');let b=await divider.boundingBox();assert(b);await p.mouse.move(b.x+b.width/2,b.y+90);await p.mouse.down();await p.mouse.move(b.x+70,b.y+90,{steps:6});await p.mouse.up();const resized=await rail.boundingBox();assert(resized.width>290&&resized.width<=381,'Drag must resize sidebar');
  await divider.focus();await p.keyboard.press('Home');assert(Math.abs((await rail.boundingBox()).width-220)<2);await p.keyboard.press('End');assert(Math.abs((await rail.boundingBox()).width-380)<2);await p.locator('#toggle').click();assert((await rail.boundingBox()).width<100);await p.locator('#toggle').click();assert(Math.abs((await rail.boundingBox()).width-380)<2,'Expanded width restored');
  const title=await p.locator('#surface').innerText();await p.locator('#draft').fill('Preserve grouping draft');for(const group of ['agents','channels','projects']){await p.locator(`[data-group-toggle="${group}"]`).click();assert.equal(await p.locator('#surface').innerText(),title);assert.equal(await p.locator('#draft').inputValue(),'Preserve grouping draft');await p.locator(`[data-group-toggle="${group}"]`).click();}await screenshot(p,'resized-sidebar');await p.context().close();
 });
 await run('F07-06/09: context actions, profile settings, project/section move and recovery',async()=>{
  const p=await pageFor();await create(p,'agent','Context agent');await p.locator('#workspace-create-role').fill('Preserve all evidence.');await p.locator('#finish-workspace-create').click();let pref=await stored(p,keys.prefs);const id=pref.agents.find(a=>a.name==='Context agent').id;const menu=async()=>{await p.locator('[data-agent-menu="'+id+'"]').click();};const agent=async()=>(await stored(p,keys.prefs)).agents.find(a=>a.id===id);
  await p.locator('[data-agent-row="'+id+'"]').click({button:'right'});await screenshot(p,'context-menu');await p.locator('[data-menu-action=pin]').click();assert.equal((await agent()).pinned,true);assert.match(await p.locator('#agent-list').innerText(),/Pinned/);
  await menu();await p.locator('[data-menu-action=unread]').click();assert.equal((await agent()).unread,true);await menu();await p.locator('[data-menu-action=edit]').click();await p.locator('#workspace-create-name').fill('Renamed agent');await p.locator('#workspace-create-timezone').selectOption('Asia/Kolkata');await p.locator('#workspace-create-auto-review').check();await p.locator('#finish-workspace-create').click();assert.equal((await agent()).name,'Renamed agent');assert.equal((await agent()).timezone,'Asia/Kolkata');assert.equal((await agent()).autoReview,true);
  await menu();await p.locator('[data-menu-action=move-section]').click();await p.locator('#move-target').selectOption('__new');await p.locator('#new-section-name').fill('Operations');await p.locator('#save-move').click();assert((await agent()).sectionId);await menu();await p.locator('[data-menu-action=pin]').click();assert.match(await p.locator('#agent-list').innerText(),/Operations/);
  await create(p,'project','Security');await p.locator('#finish-workspace-create').click();await menu();await p.locator('[data-menu-action=move-project]').click();await p.locator('#move-target').selectOption({label:'Security'});await p.locator('#save-move').click();let d=await stored(p,keys.data);const direct=d.chats.find(c=>c.recipients.length===1&&c.recipients[0]===id&&!c.channelId);assert.equal(d.projects.find(x=>x.id===direct.projectId).name,'Security');
  await menu();await p.locator('[data-menu-action=hide]').click();assert.equal(await p.locator('[data-agent-row="'+id+'"]').count(),0);await settings(p,'agents');await p.locator('[data-restore-agent="'+id+'"]').click();await p.locator('#save-settings').click();await p.locator('#settings-dialog').waitFor({state:'hidden'});assert.equal((await agent()).hidden,false,'Restore must not be overwritten by settings Save');
  const before=await stored(p,keys.data),docsBefore=await stored(p,keys.docs);await menu();p.once('dialog',x=>x.dismiss());await p.locator('[data-menu-action=delete]').click();assert.equal(!!(await agent()).archived,false);await menu();p.once('dialog',x=>x.accept());await p.locator('[data-menu-action=delete]').click();assert.equal((await agent()).archived,true);assert.deepEqual(await stored(p,keys.data),before);assert.deepEqual(await stored(p,keys.docs),docsBefore);await settings(p,'agents');await p.locator('[data-restore-agent="'+id+'"]').click();await p.locator('#cancel-settings').click();assert.equal((await agent()).archived,false);await p.reload();assert.equal((await agent()).name,'Renamed agent');await unchanged(p);await p.context().close();
 });
 await run('Protected wireframe unchanged',async()=>{const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'polished-baseline-hashes.json'),'utf8').replace(/^\uFEFF/,''));for(const f of expected)assert.equal(hash(f.path),f.sha256.toLowerCase(),f.path);});
 await run('No page errors or external runtime calls',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);});
 }finally{await browser.close();report.finishedAt=new Date().toISOString();report.candidateEnd=fingerprint();report.candidateStable=JSON.stringify(report.candidateStart)===JSON.stringify(report.candidateEnd);const json=JSON.stringify(report,null,2);fs.writeFileSync(path.join(__dirname,'p2-test-results.json'),json);fs.mkdirSync(path.join(__dirname,'p2-runs'),{recursive:true});fs.writeFileSync(path.join(__dirname,'p2-runs',report.startedAt.replace(/[:.]/g,'-')+'.json'),json);console.log('Stable candidate:',report.candidateStable);if(report.checks.some(x=>x.status==='FAIL')||!report.candidateStable)process.exitCode=1;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});



