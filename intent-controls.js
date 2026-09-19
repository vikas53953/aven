'use strict';
const preferencesKey='aven-wireframe-preferences-v1';
const defaultPreferences={name:'',theme:'dark',density:'comfortable',provider:'Not connected',model:'',browser:true,computer:false,activeAgent:'companion',agents:[{id:'companion',name:'Network companion',role:'Help investigate networks and explain findings.'}]};
let preferences=structuredClone(defaultPreferences),settingsDraft,settingsPage='general',settingsOpener,attachmentItems=[];
try{const saved=JSON.parse(localStorage.getItem(preferencesKey)||'null');if(saved&&Array.isArray(saved.agents)&&saved.agents.length&&saved.agents.every(a=>typeof a.id==='string'&&typeof a.name==='string'&&typeof a.role==='string'))preferences={...preferences,...saved};}catch{}
if(!preferences.agents.some(a=>a.id===preferences.activeAgent))preferences.activeAgent=preferences.agents[0].id;
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function savePreferences(){try{localStorage.setItem(preferencesKey,JSON.stringify(preferences));return true;}catch{el('settings-status').textContent='Could not save locally. Browser storage is unavailable.';return false;}}
function applyPreferences(){document.querySelector('.canvas').dataset.theme=preferences.theme;document.querySelector('.canvas').dataset.density=preferences.density;el('avatar').title=preferences.agents.find(a=>a.id===preferences.activeAgent).name;el('draft').placeholder='Message '+preferences.agents.find(a=>a.id===preferences.activeAgent).name+'…';}
function selectedAgent(){return preferences.agents.find(a=>a.id===preferences.activeAgent);}
function renderAgentWorkspace(){
 const agent=selectedAgent(),p=el('pane-content');
 p.innerHTML='<div class="agent-select-row"><label for="active-agent">Active agent</label><button id="new-agent-shortcut" aria-label="Create another agent" title="Create another agent">+</button></div><select id="active-agent" aria-label="Active agent">'+preferences.agents.map(a=>'<option value="'+escapeHTML(a.id)+'">'+escapeHTML(a.name)+'</option>').join('')+'</select><div class="avatar-study" style="margin-top:14px">'+icon('avatar')+'</div><strong>'+escapeHTML(agent.name)+'</strong><p class="muted">'+escapeHTML(agent.role)+'</p><p class="muted">Local profile · no agent running</p><h3>Agent documents</h3><div class="pane-list"><button data-doc="SOUL.md">'+icon('document')+'SOUL.md</button><button data-doc="MEMORY.md">'+icon('document')+'MEMORY.md</button><button id="agent-settings">'+icon('settings')+'Manage agents</button></div>';
 el('active-agent').value=agent.id;
 el('active-agent').onchange=e=>{preferences.activeAgent=e.target.value;savePreferences();applyPreferences();openPane('agent');};
 el('new-agent-shortcut').onclick=()=>{show('agents',false);openSettings('agents');el('agent-name').focus();};
}
function openSettings(page='general'){
 settingsOpener=document.activeElement;settingsDraft=structuredClone(preferences);settingsPage=page;
 const categories=[['general','General'],['appearance','Appearance'],['agents','Agents'],['models','Models & providers'],['connections','Connections'],['data','Privacy & data']];
 el('settings-nav').replaceChildren(...categories.map(([id,title])=>{const b=document.createElement('button');b.textContent=title;b.dataset.category=id;b.onclick=()=>{captureSettings();settingsPage=id;renderSettingsPage();};return b;}));
 el('settings-status').textContent='Proposed settings structure · review in this wireframe';
 renderSettingsPage();if(!el('settings-dialog').open)el('settings-dialog').showModal();
}
function captureSettings(){
 document.querySelectorAll('#settings-content [data-pref]').forEach(n=>settingsDraft[n.dataset.pref]=n.type==='checkbox'?n.checked:n.value);
}
function renderSettingsPage(){
 document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.category===settingsPage)));
 const p=el('settings-content');
 const pages={
 general:'<h2>General</h2><p>Your display name belongs to you; agent names are managed separately.</p><label for="pref-name">Your display name</label><input id="pref-name" data-pref="name" maxlength="80" placeholder="Your name"><p class="setting-help">Saved locally in this browser.</p>',
 appearance:'<h2>Appearance</h2><p>Choose how the application canvas looks.</p><label for="pref-theme">Theme</label><select id="pref-theme" data-pref="theme"><option value="dark">Dark</option><option value="light">Light</option></select><label for="pref-density">Spacing</label><select id="pref-density" data-pref="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><p class="setting-help">Save to apply this to the wireframe canvas.</p>',
 models:'<h2>Models & providers</h2><p>Choose a preferred provider for the future runtime.</p><label for="pref-provider">Preferred provider</label><select id="pref-provider" data-pref="provider"><option>Not connected</option><option>OpenCode</option><option>OpenAI</option><option>Anthropic</option><option>OpenRouter</option></select><label for="pref-model">Preferred model</label><input id="pref-model" data-pref="model" placeholder="Optional model name"><p class="setting-help">Preference only. No provider is connected and no API key is collected here.</p>',
 connections:'<h2>Connections</h2><p>Set proposed access preferences for the future application.</p><label class="check-row"><input type="checkbox" data-pref="browser"> Allow browser tasks after connection</label><label class="check-row"><input type="checkbox" data-pref="computer"> Allow computer tasks after connection</label><p class="setting-help">These saved preferences do not grant access or activate tools.</p><h3>Plugins</h3><p>No plugins connected.</p><button id="inspect-plugins-settings">View plugin connection wireframe</button>',
 data:'<h2>Privacy & data</h2><p>Settings and agent profiles are stored in this browser. Chat text and attachment filenames are saved locally. Selected attachment contents last only for the current page session.</p><p>Selected files stay local. This wireframe uploads nothing and sends no model requests.</p><button id="export-preferences">Export saved preferences</button><p class="setting-help">Export contains your saved display name, preferences and agent profiles. It excludes attachment contents.</p>'
 };
 if(settingsPage==='agents'){renderAgentsSettings();return;}
 p.innerHTML=pages[settingsPage];
 p.querySelectorAll('[data-pref]').forEach(n=>{if(n.type==='checkbox')n.checked=!!settingsDraft[n.dataset.pref];else n.value=settingsDraft[n.dataset.pref]||'';});
 if(el('inspect-plugins-settings'))el('inspect-plugins-settings').onclick=()=>{captureSettings();el('settings-dialog').close();show('tools',false);openPane('plugins');};
 if(el('export-preferences'))el('export-preferences').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(preferences,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='aven-preferences.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
}
function renderAgentsSettings(){
 const p=el('settings-content');
 p.innerHTML='<h2>Agents</h2><p>Create separate local profiles, then choose who you want to work with. Live execution comes later.</p><div class="agent-list">'+preferences.agents.map(a=>'<div class="agent-setting-card"><div><strong>'+escapeHTML(a.name)+'</strong><p>'+escapeHTML(a.role)+'</p></div><button data-select-agent="'+escapeHTML(a.id)+'">'+(a.id===preferences.activeAgent?'Selected':'Select')+'</button>'+(a.id==='companion'?'':'<button data-remove-agent="'+escapeHTML(a.id)+'" aria-label="Remove '+escapeHTML(a.name)+'">Remove</button>')+'</div>').join('')+'</div><form id="create-agent-form"><h3>+ Create agent</h3><label for="agent-name">Agent name</label><input id="agent-name" required maxlength="60" placeholder="For example: Firewall specialist"><label for="agent-role">What should this agent help with?</label><textarea id="agent-role" maxlength="500" required placeholder="Describe its role in your own words."></textarea><button type="submit">Create agent</button><span id="agent-create-status" role="status"></span></form>';
 p.querySelectorAll('[data-select-agent]').forEach(b=>b.onclick=()=>{preferences.activeAgent=b.dataset.selectAgent;settingsDraft.activeAgent=preferences.activeAgent;savePreferences();applyPreferences();renderAgentsSettings();if(activePane==='agent')openPane('agent');});
 p.querySelectorAll('[data-remove-agent]').forEach(b=>b.onclick=()=>{preferences.agents=preferences.agents.filter(a=>a.id!==b.dataset.removeAgent);if(preferences.activeAgent===b.dataset.removeAgent)preferences.activeAgent='companion';settingsDraft.agents=structuredClone(preferences.agents);settingsDraft.activeAgent=preferences.activeAgent;savePreferences();applyPreferences();renderAgentsSettings();if(activePane==='agent')openPane('agent');});
 el('create-agent-form').onsubmit=e=>{
 e.preventDefault();const name=el('agent-name').value.trim(),role=el('agent-role').value.trim();if(!name||!role)return;
 if(preferences.agents.some(a=>a.name.toLowerCase()===name.toLowerCase())){el('agent-create-status').textContent='Choose a different agent name.';return;}
 const item={id:crypto.randomUUID(),name,role};preferences.agents.push(item);preferences.activeAgent=item.id;settingsDraft.agents=structuredClone(preferences.agents);settingsDraft.activeAgent=item.id;
 const saved=savePreferences();applyPreferences();renderAgentsSettings();if(activePane==='agent')openPane('agent');el('settings-status').textContent=saved?'Agent profile created locally. No live agent started.':'Profile created for this session; local saving failed.';
 };
}
function toggleAddMenu(){
 const menu=el('add-menu'),opening=menu.hidden;menu.hidden=!opening;el('tools-menu').setAttribute('aria-expanded',String(opening));
 if(opening){const r=el('tools-menu').getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left,innerWidth-230))+'px';menu.style.top=Math.max(8,r.top-menu.offsetHeight-8)+'px';menu.querySelector('button').focus();}
}
function closeAddMenu(){el('add-menu').hidden=true;el('tools-menu').setAttribute('aria-expanded','false');}
function updateSend(){el('send').disabled=!el('draft').value.trim()&&!attachmentItems.length;}
function attachSelectedFiles(files){
 for(const file of files){const id=crypto.randomUUID();attachmentItems.push({id,file,url:file.type.startsWith('image/')?URL.createObjectURL(file):null});}
 renderAttachments();updateSend();el('chat-status').textContent=attachmentItems.length+' attachment(s) selected locally. Nothing uploaded.';
}
function renderAttachments(){
 el('attachments').replaceChildren(...attachmentItems.map(item=>{const chip=document.createElement('div');chip.className='attachment-chip';if(item.url){const img=document.createElement('img');img.src=item.url;img.alt='Preview of '+item.file.name;chip.append(img);}const name=document.createElement('span');name.textContent=item.file.name;const b=document.createElement('button');b.type='button';b.textContent='×';b.setAttribute('aria-label','Remove attachment '+item.file.name);b.onclick=()=>{if(item.url)URL.revokeObjectURL(item.url);attachmentItems=attachmentItems.filter(x=>x.id!==item.id);renderAttachments();updateSend();};chip.append(name,b);return chip;}));
}
function sendWireframeMessage(e){
 e.preventDefault();const value=el('draft').value.trim();if(!value&&!attachmentItems.length)return;
 const message=document.createElement('div');message.className='message user-message';message.textContent=value;
 for(const item of attachmentItems){const label=document.createElement('div');label.textContent='Attachment: '+item.file.name;message.append(label);if(item.url)URL.revokeObjectURL(item.url);}
 el('conversation').append(message);attachmentItems=[];renderAttachments();el('draft').value='';updateSend();el('chat-status').textContent='Message shown locally. No file upload or AI request occurred.';message.scrollIntoView({block:'nearest'});
}
function initializeControls(){
 applyPreferences();
 el('close-settings').onclick=()=>el('settings-dialog').close();
 el('settings-dialog').addEventListener('close',()=>{if(settingsOpener&&settingsOpener.isConnected)settingsOpener.focus();});
 el('save-settings').onclick=()=>{captureSettings();preferences={...settingsDraft,agents:preferences.agents,activeAgent:preferences.activeAgent};const ok=savePreferences();applyPreferences();if(ok)el('settings-status').textContent='Settings saved locally.';};
 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{closeAddMenu();const action=b.dataset.add;if(action==='files'||action==='images')el(action==='files'?'file-picker':'image-picker').click();else{show(action==='computer'?'computer':'tools',false);openPane(action);} });
 for(const id of ['file-picker','image-picker'])el(id).onchange=e=>{attachSelectedFiles(e.target.files);e.target.value='';};
 document.addEventListener('pointerdown',e=>{if(!el('add-menu').contains(e.target)&&!el('tools-menu').contains(e.target))closeAddMenu();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('add-menu').hidden){closeAddMenu();el('tools-menu').focus();}});
}
