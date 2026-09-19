'use strict';
const el=id=>document.getElementById(id);
const key='intentgraph-visual-map-review-v07';
let map,current,decisions={},activePane='agent';
try{decisions=JSON.parse(localStorage.getItem(key)||'{}');if(!decisions||typeof decisions!=='object'||Array.isArray(decisions))decisions={};}catch{decisions={};}
const paths={
channels:'<path d="M9 3 7 21M17 3l-2 18M3 9h18M2 15h18"/>',
folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
newchat:'<path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 3v-4a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3Z"/><path d="M12 8v6M9 11h6"/>',
avatar:'<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
chat:'<path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 3v-4a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3Z"/>',
search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
feed:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
ideas:'<path d="M8 15a7 7 0 1 1 8 0l-1 3H9l-1-3ZM9 21h6M10 11l2 3 2-3"/>',
goals:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
library:'<path d="M4 4v16M9 4v16M14 4v16m4-15 3 14"/>',
settings:'<path d="M9.5 3h5l.7 2.6 2.3 1.3 2.6-.7 2.5 4.3-1.9 1.9v2.6l1.9 1.9-2.5 4.3-2.6-.7-2.3 1.3-.7 2.6h-5l-.7-2.6-2.3-1.3-2.6.7L1.4 17l1.9-1.9v-2.6l-1.9-1.9 2.5-4.3 2.6.7 2.3-1.3Z" transform="translate(1.4 -1) scale(.88)"/><circle cx="12" cy="11.4" r="3.2"/>',
browser:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
plug:'<path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4"/>',
document:'<path d="M14 2H5v20h14V7l-5-5Z M14 2v6h5M8 12h8M8 16h6"/>',
chevron:'<path d="m9 5 7 7-7 7"/>',
close:'<path d="m6 6 12 12M6 18 18 6"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
send:'<path d="M12 19V5m-6 6 6-6 6 6"/>',
computer:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
sidebar:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'
};
function icon(name){return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||paths.document)+'</svg>';}
function icons(root=document){root.querySelectorAll('[data-icon]').forEach(n=>{n.innerHTML=icon(n.dataset.icon);});}
function record(){return decisions[current.id]||{};}
function retainNote(){if(current)decisions[current.id]={...record(),note:el('feedback').value};}
function persist(message){try{localStorage.setItem(key,JSON.stringify(decisions));el('saved').textContent=message;}catch{el('saved').textContent='Storage unavailable. Export your review to keep it.';}}
function decisionUI(){const v=record().decision;el('matches').setAttribute('aria-pressed',String(v==='direction-matches'));el('correction').setAttribute('aria-pressed',String(v==='needs-correction'));el('decision').textContent=v==='direction-matches'?'Direction matches · evidence gaps stay open':v==='needs-correction'?'Correction requested':'Not reviewed for v0.7';}
function highlight(id){
 document.querySelectorAll('.selected-region').forEach(n=>n.classList.remove('selected-region'));
 const target={branding:'brand',avatar:'avatar',navigation:'rail',workspace:'right-pane',settings:'settings',composer:'composer',artifacts:'right-pane',tools:'right-pane',computer:'right-pane',agents:'avatar',organization:'rail'}[id];
 if(target)el(target).classList.add('selected-region');
}
function show(id,updateScene=true){
 retainNote();current=map.items.find(i=>i.id===id);
 document.querySelectorAll('#index button').forEach(b=>b.setAttribute('aria-current',String(b.dataset.id===id)));
 ['title','user','observed','mismatch','proposal','unknown','check','coverage'].forEach(k=>el(k).textContent=current[k]);
 el('source').textContent=current.time===null?'User-directed adaptation · reference ↗':'Reference '+current.timestamp+' ↗';
 el('source').href=map.reference+(current.time===null?'':'&t='+current.time+'s');
 if(current.referenceType==='native-grokbot'){el('source').textContent='Native Grokbot observation notes ↗';el('source').href='.intentgraph/reference-grokbot-01.md';}
 el('flow').replaceChildren(...current.flow.map((t,i)=>{const d=document.createElement('div');d.className='step';const s=document.createElement('span');s.textContent=['TRIGGER','RESULT','RETURN / NEXT'][i];d.append(s,document.createTextNode(t));return d;}));
 el('feedback').value=typeof record().note==='string'?record().note:'';el('saved').textContent='';decisionUI();
 if(updateScene){if(['avatar','workspace'].includes(id))openPane('agent');else if(id==='artifacts')openPane('artifacts');else if(id==='tools')openPane('browser');else if(id==='computer')openPane('computer');else if(id==='settings')openSettings();else if(id==='agents')openSettings('agents');else if(id==='organization')showDirectory('Channels');else el('right-pane').hidden=true;}
 highlight(id);
}
function openPane(view){
 activePane=view;el('right-pane').hidden=false;
 el('pane-title').textContent={agent:'Agent workspace',artifacts:'Artifacts',browser:'Browser workspace',plugins:'Plugin connection',computer:'Computer workspace'}[view];
 el('sketch-state').textContent='Conversation stays centered · '+el('pane-title').textContent+' on right';
 document.querySelectorAll('[data-pane]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pane===view)));
 const content=el('pane-content');
 const views={
 computer:'<div class="preview-url">Computer session · preview only</div><div class="desktop-preview"><div class="desktop-window"><div class="window-bar"><i></i><i></i><i></i></div><div class="desktop-lines"></div></div><div class="desktop-dock"></div></div><p class="muted">The selected desktop and agent actions would appear here. Browser tasks have their own separate view.</p><button id="computer-preview">Preview computer session</button><p class="muted" style="margin-top:12px">No screen access or desktop control is active.</p>',
 agent:'<div class="avatar-study">'+icon('avatar')+'</div><p class="muted">Avatar artwork and motion to agree</p><strong>Your network companion</strong><h3>Agent documents</h3><div class="pane-list"><button data-doc="SOUL.md">'+icon('document')+'SOUL.md</button><button data-doc="MEMORY.md">'+icon('document')+'MEMORY.md</button><button id="agent-settings">'+icon('settings')+'Agent settings</button></div>',
 artifacts:'<p class="muted">Outputs from this conversation</p><div class="pane-list"><button data-preview="document">'+icon('document')+'Investigation.md</button><button data-preview="web">'+icon('browser')+'Network report</button></div><p style="margin-top:16px">Select an output to preview it here. Chat and draft stay in place.</p>',
 browser:'<div class="preview-url">Browser task · preview</div><div class="preview-sheet"><h4>Inspect vendor documentation</h4><p>The browser page or captured result appears here while the request remains visible in chat.</p><button id="browser-preview">Show sample browser result</button></div><p class="muted" style="margin-top:12px">No browser task is running in this wireframe.</p>',
 plugins:'<div class="preview-sheet"><h4>Connect a network plugin</h4><p>Proposed access: read inventory and device status.</p><p>Show provider, permissions and connection state before granting access.</p><button id="plugin-preview">Preview connection state</button></div><p class="muted" style="margin-top:12px">No account or credentials are connected.</p>'
 };
 content.innerHTML=view==='artifacts'&&conversations&&!currentChat().sample?'<p class="muted">No artifacts in this chat yet.</p><p>Future generated outputs will be listed here for this conversation.</p>':views[view];
 if(view==='agent')renderAgentWorkspace();
 content.querySelectorAll('[data-doc]').forEach(b=>b.onclick=()=>documentView(b.dataset.doc));
 content.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>artifactView(b.dataset.preview));
 if(el('agent-settings'))el('agent-settings').onclick=()=>{show('agents',false);openSettings('agents');};
 if(el('computer-preview'))el('computer-preview').onclick=()=>{content.innerHTML='<div class="preview-url">Example session state</div><div class="desktop-preview"><div class="desktop-window"><div class="window-bar"><i></i><i></i><i></i></div><div class="desktop-lines"></div></div><div class="desktop-dock"></div></div><p>Selected window → inspect → proposed action → result</p><p class="muted">Illustrative sequence only. No computer action occurred.</p><button id="stop-computer-preview">Return to computer overview</button>';el('stop-computer-preview').onclick=()=>openPane('computer');};
 if(el('browser-preview'))el('browser-preview').onclick=()=>{content.innerHTML='<div class="preview-url">Sample documentation page</div><div class="preview-sheet"><h4>Network troubleshooting</h4><p>Browser content or evidence preview</p><hr><p>Selected findings remain linked to the request in chat.</p></div><p class="muted" style="margin-top:12px">Illustrative content only.</p>';el('chat-status').textContent='Browser result preview opened on the right.';};
 if(el('plugin-preview'))el('plugin-preview').onclick=()=>{content.innerHTML='<div class="preview-sheet"><h4>Connected state — example</h4><p>Network plugin · read-only access</p><p>Controls for managing or disconnecting access belong here.</p></div><p class="muted" style="margin-top:12px">This demonstrates a future state; no connection occurred.</p>';el('chat-status').textContent='Connection-state preview shown. No plugin connected.';};
}
function documentView(name){
 el('pane-title').textContent=name;
 const p=el('pane-content');p.innerHTML='<div class="preview-sheet"><h4></h4><p>Agent-owned document</p><hr><p>Document contents and editing controls occupy the right workspace.</p></div><p class="muted" style="margin-top:12px">Editor behavior will be demonstrated in the next prototype.</p><button id="back-doc">Back to agent</button>';
 p.querySelector('h4').textContent=name;el('back-doc').onclick=()=>openPane('agent');
}
function artifactView(type){
 el('pane-title').textContent=type==='web'?'Network report':'Investigation.md';
 el('pane-content').innerHTML=type==='web'?'<div class="preview-sheet"><h4>Network report</h4><div class="sample-web"><span></span><span></span><span></span></div><p>Web artifact preview · illustrative layout</p></div>':'<div class="preview-sheet"><h4>Investigation</h4><p>1. Scope and symptoms</p><p>2. Evidence collected</p><p>3. Proposed next steps</p><hr><p>Sample document output</p></div>';
 const back=document.createElement('button');back.textContent='Back to artifacts';back.style.marginTop='14px';back.onclick=()=>openPane('artifacts');el('pane-content').append(back);
}
fetch('.intentgraph/visual-map.json').then(r=>{if(!r.ok)throw Error('Map unavailable');return r.json();}).then(data=>{
 map=data;document.title='IntentGraph · Wireframe '+map.version;icons();
 map.items.forEach(item=>{const b=document.createElement('button');b.dataset.id=item.id;const n=document.createElement('span');n.className='num';n.textContent=item.number;b.append(n,document.createTextNode(item.title));b.onclick=()=>show(item.id);el('index').append(b);});
 document.querySelectorAll('[data-tip]').forEach(b=>{b.title=b.dataset.tip;if(!b.hasAttribute('aria-label'))b.setAttribute('aria-label',b.dataset.tip);const label=document.createElement('span');label.className='label';label.textContent=b.dataset.tip;b.append(label);});
 el('brand').onclick=()=>show('branding');el('avatar').onclick=()=>show('avatar');el('settings').onclick=()=>show('settings');el('artifacts').onclick=()=>show('artifacts');
 el('toggle').onclick=()=>{show('navigation',false);const expanded=el('rail').classList.toggle('expanded');el('toggle').setAttribute('aria-pressed',String(expanded));el('toggle').setAttribute('aria-label',expanded?'Collapse left sidebar':'Expand left sidebar');el('toggle').title=expanded?'Collapse left sidebar':'Expand left sidebar';el('toggle').dataset.tip=expanded?'Collapse sidebar':'Expand sidebar';el('toggle').querySelector('.label').textContent=expanded?'Collapse':'Expand sidebar';el('sketch-state').textContent=expanded?'Left sidebar expanded · right workspace unchanged':'Left sidebar collapsed · right workspace unchanged';};
 document.querySelectorAll('[data-destination]').forEach(b=>b.onclick=()=>{show('navigation');el('surface').textContent=b.dataset.destination==='Chat'?'Incident investigation':b.dataset.destination+' · navigation preview';el('chat-status').textContent=b.dataset.destination==='Chat'?'':'Destination selected; detailed page content is outside this wireframe.';});
 document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>{show({agent:'workspace',artifacts:'artifacts',browser:'tools',plugins:'tools',computer:'computer'}[b.dataset.pane],false);openPane(b.dataset.pane);});
 el('computer-request').onclick=()=>{show('computer',false);openPane('computer');};
 el('browser-request').onclick=()=>{show('tools',false);openPane('browser');};el('plugin-request').onclick=()=>{show('tools',false);openPane('plugins');};el('tools-menu').onclick=toggleAddMenu;
 document.querySelectorAll('[data-artifact]').forEach(b=>b.onclick=()=>{show('artifacts',false);openPane('artifacts');artifactView(b.dataset.artifact);});
 el('close-pane').onclick=()=>{el('right-pane').hidden=true;el('sketch-state').textContent='Conversation uses available width';el('avatar').focus();};
 el('draft').oninput=updateSend;
 el('composer').onsubmit=sendWireframeMessage;
 [['matches','direction-matches'],['correction','needs-correction'],['clear',null]].forEach(([id,value])=>el(id).onclick=()=>{retainNote();decisions[current.id]={...record(),decision:value,updatedAt:new Date().toISOString()};persist('Decision saved locally.');decisionUI();});
 el('save').onclick=()=>{retainNote();persist('Note saved locally.');};
 el('export').onclick=()=>{retainNote();const url=URL.createObjectURL(new Blob([JSON.stringify({mapVersion:map.version,reference:map.reference,exportedAt:new Date().toISOString(),scope:'Direction feedback only; reference gaps remain open.',decisions},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='intentgraph-review-v07.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 initializeControls();
 initializeConversations();
 initializeEntrypoints();
 show('workspace');
}).catch(e=>{document.querySelector('main').textContent='Could not load the wireframe. Open it through http://127.0.0.1:8767/intent-map.html. '+e.message;});
