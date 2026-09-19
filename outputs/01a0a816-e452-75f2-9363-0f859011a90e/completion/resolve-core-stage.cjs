'use strict';
// Root-reviewed composition of fields that independent owners add to one seam.
// This edits only root-stage; unresolved overlaps remain explicit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.join(__dirname,'root-stage'),conflicts=JSON.parse(fs.readFileSync(path.join(__dirname,'stage-conflicts.json'),'utf8'));
const resolved=[],pending=[];
function patch(file,old,next,reason){const p=path.join(dir,file),s=fs.readFileSync(p,'utf8');if(!old||s.split(old).length!==2)throw Error('Composition anchor missing/ambiguous: '+reason);fs.writeFileSync(p,s.replace(old,next));resolved.push({file,reason,old,new:next});}
for(const e of conflicts){
 if(e.owner==='reliability'&&e.file==='polished.js'&&e.old.includes("const modePicker=byId('chat-mode')")){
  patch(e.file,'modePicker.disabled=chatRequests.size>0||!!currentChat()?.pendingQueue?.length;',"modePicker.disabled=(globalThis.AvenRuntimeCapabilities?.allowConcurrentRuns===true?chatRequests.has(currentChat()?.id):chatRequests.size>0)||!!currentChat()?.pendingQueue?.length;",'Keep compact mode display and capability-aware per-chat concurrency');
 }else if(e.owner==='automation'&&e.old==='activeDoc=null,composition=false;'){
  patch(e.file,'activeDoc=null,composition=false,','activeDoc=null,composition=false,automationController=null,automationScheduler=null,','Retain provider state alongside automation controllers');
 }else if(e.owner==='automation'&&e.old.includes('function renderSettingsPage()')){
  const declaration=e.new.slice(0,e.new.indexOf('  function renderSettingsPage()'));
  patch(e.file,'  function renderSettingsPage()',declaration+'  function renderSettingsPage()','Add automation settings helper without replacing provider settings');
 }else if(e.owner==='provider'&&e.file==='polished.html'&&e.old.includes('composer-note')){
  const anchor='<button class="icon-button" id="tools-menu" type="button" aria-label="Add attachments or tools" title="Add attachments or tools" aria-expanded="false" data-icon="plus"></button>';
  patch(e.file,anchor,anchor+'\r\n'+e.new,'Place compact model picker beside plus, preserve footer removal');
 }else if(e.owner==='provider'&&e.file==='polished.js'&&e.old.startsWith('const defaultPrefs=')){
  patch(e.file,"model:'',browser:true","model:'',providerSelection:null,providerSelectionExplicit:false,browser:true",'Merge model selection defaults with minimal presentation preferences');
 }else if(e.owner==='provider'&&e.file==='polished.js'&&e.old.trim().startsWith('return {messages,characters,')){
  const old='return {messages,characters,omitted,total,windowMessages:messages.length,windowCharacters:characters,retainedMessages:messages.length,retainedCharacters:characters,omittedMessages:omitted,totalMessages:total};';
  const next='return {messages,characters,omitted,total,windowMessages:messages.length,windowCharacters:characters,retainedMessages:messages.length,retainedCharacters:characters,omittedMessages:omitted,totalMessages:total,metadata:{windowMessages:24,windowCharacters:32000,retainedMessages:messages.length,retainedCharacters:characters,omittedMessages:omitted,totalMessages:total}};';
  patch(e.file,old,next,'Keep local context counts and add bounded request window metadata');
 }else if(e.owner==='provider'&&e.file==='polished.js'&&e.old.startsWith('const started=performance.now()')){
  patch(e.file,'appliedSteerIds:new Set(),reliabilityRunId:','appliedSteerIds:new Set(),requestedSelection:selection,context,selectionExplicit,reliabilityRunId:','Preserve durable pending run fields and append requested selection');
 }else if(e.owner==='provider'&&e.file==='polished.js'&&e.old.startsWith('body:JSON.stringify({chatId:')){
  patch(e.file,'messages,mode:modeFor(requestMode),requestId:pending.reliabilityRequestId','messages,mode:modeFor(requestMode),context,...(selectionExplicit?{selection}:{}),requestId:pending.reliabilityRequestId','Send selection/context and reliability identifiers together');
 }else if(e.owner==='provider'&&e.file==='intentgraph/server.cjs'&&e.old.includes('const mode = body?.mode')){
  const old=e.old.replace("['chatId','agentName','messages','mode']","['chatId','agentName','messages','mode','requestId','idempotencyKey']");
  const next=e.new.replace("['chatId','agentName','messages','mode','selection','context']","['chatId','agentName','messages','mode','selection','context','requestId','idempotencyKey']");
  patch(e.file,old,next,'Validate combined selected-provider and idempotent request contract');
 }else if(e.owner==='workspace'&&e.file==='polished-workspace-tools.js'&&e.old.includes('const top = create(')){
  patch(e.file,e.old.replace('card.append(top);','details.append(top);'),e.new.replace('card.append(top);','details.append(top);'),'Keep generated-file badge inside collapsed artifact details');
  patch(e.file,"artifact.command || 'Raw output'","artifact.command || (artifact.generatedFile ? 'Generated file' : 'Raw output')",'Truthful compact generated-file summary');
 }else if(e.owner==='workspace'&&e.file==='polished-workspace-tools.js'&&e.old.includes('const pre = create(')){
  patch(e.file,e.old.replace('card.append(pre);','details.append(pre);'),e.new.replace('card.append(pre);','details.append(pre);'),'Keep raw artifact content collapsed and explicit preview action available');
 }else if(e.owner==='workflows'&&e.file==='polished.js'&&e.old==='if(chatRequests.size||c.queuePaused||c.pendingQueue?.length){'){
  patch(e.file,'if((globalThis.AvenRuntimeCapabilities?.allowConcurrentRuns===true?chatRequests.has(c.id):chatRequests.size>0)||c.queuePaused||c.pendingQueue?.length){',"if((globalThis.AvenRuntimeCapabilities?.allowConcurrentRuns===true?chatRequests.has(c.id):chatRequests.size>0)||c.queuePaused||c.pendingQueue?.length||c.workflowState?.status==='waiting-question'){",'Pause only this chat queue while its clarification is pending');
 }else if(e.owner==='workflows'&&e.file==='polished.js'&&e.old.startsWith('if(!c||c.archived||chatRequests.size||c.queuePaused')){
  patch(e.file,'if(!c||c.archived||(globalThis.AvenRuntimeCapabilities?.allowConcurrentRuns===true?chatRequests.has(c.id):chatRequests.size>0)||c.queuePaused||c.queueEditing||!c.pendingQueue?.length)return false;',"if(!c||c.archived||(globalThis.AvenRuntimeCapabilities?.allowConcurrentRuns===true?chatRequests.has(c.id):chatRequests.size>0)||c.queuePaused||c.queueEditing||c.workflowState?.status==='waiting-question'||!c.pendingQueue?.length)return false;",'Preserve per-chat concurrency and prevent dispatch through a pending question');
 }else if(e.owner==='history'&&e.file==='polished.js'&&e.old.includes("byId('chat-mode').onchange")){
  const current=fs.readFileSync(path.join(dir,e.file),'utf8');
  if(!current.includes("const legacyModePicker=byId('chat-mode');if(legacyModePicker)legacyModePicker.onchange=e=>setChatMode(e.target.value);"))throw Error('Minimal UI mode guard missing');
  resolved.push({file:e.file,reason:'History null guard superseded by minimal UI guarded legacy picker and shared plus-menu mode setter',owner:e.owner,index:e.index});
 }else pending.push(e);
}
patch('polished.js',"body===wanted||wanted.startsWith(body)||body.startsWith(wanted)?'':whole","body.replace(/\\r\\n/g,'\\n').replace(/^\\n+|\\n+$/g,'')===wanted.replace(/\\r\\n/g,'\\n').replace(/^\\n+|\\n+$/g,'')?'':whole",'Remove duplicate fenced evidence across Markdown boundary newlines without changing retained raw bytes');
patch('polished.js',"n.textContent=code.join('\\n');pre.append(n);parent.append(pre);continue;","n.textContent=code.join('\\n');pre.append(n);if(code.length>12){const details=document.createElement('details');details.className='message-code-fold';const summary=document.createElement('summary');const language=line.trim().slice(3).trim();summary.textContent=(language||'Code')+' · '+code.length+' lines';pre.tabIndex=0;details.append(summary,pre);parent.append(details);}else parent.append(pre);continue;",'Fold long generated code while retaining explanation and exact source');
fs.appendFileSync(path.join(dir,'polished.css'),'\n.message-code-fold{margin:12px 0;border:1px solid var(--border);border-radius:10px;overflow:hidden}.message-code-fold>summary{cursor:pointer;padding:10px 12px;color:var(--muted);font-size:12px}.message-code-fold>pre{margin:0;border:0;border-radius:0}\n');
const report={at:new Date().toISOString(),resolved,pending:pending.map(({old,new:next,...entry})=>entry)};
fs.writeFileSync(path.join(__dirname,'root-core-resolutions.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({resolved:resolved.length,pending:report.pending},null,2));
