'use strict';
let searchCategory='All',searchOpener,creationReturnId;
const entryOriginalAgent=renderAgentWorkspace;
renderAgentWorkspace=function(){entryOriginalAgent();const plus=el('new-agent-shortcut');if(plus)plus.remove();};
const entryOriginalSettings=openSettings;
openSettings=function(page='general'){
 entryOriginalSettings(page);
 const r=document.querySelector('.canvas').getBoundingClientRect(),dialog=el('settings-dialog');
 dialog.classList.add('settings-drawer');
 dialog.style.right=Math.max(12,innerWidth-r.right)+'px';
 dialog.style.top=Math.max(12,Math.min(r.top,innerHeight-420))+'px';
 dialog.style.width=Math.min(760,innerWidth-32,Math.max(420,r.width-50))+'px';
};
const entryOriginalAgentsSettings=renderAgentsSettings;
renderAgentsSettings=function(){
 entryOriginalAgentsSettings();const form=el('create-agent-form');if(form){const action=document.createElement('button');action.textContent='Create agent in workspace';action.onclick=()=>{el('settings-dialog').close();openCreation('agent');};form.replaceWith(action);}
};
openCreation=function(type,projectId=null){
 closeCreateMenu();if(type==='chat'){newChat();return;}
 retainChat();show(type==='agent'?'agents':'organization',false);creationReturnId=conversations.activeChat;directoryContext={kind:'Create',entityId:null};
 el('conversation').hidden=true;el('composer').hidden=true;el('chat-directory').hidden=false;el('right-pane').hidden=true;
 const label=type==='agent'?'agent':type==='channel'?'channel':'project';
 el('sketch-state').textContent='Create '+label+' in the central workspace';
 el('surface').textContent='Create '+label;el('chat-location').textContent='Set up your '+label+' in the workspace';el('chat-status').textContent='';
 const content=el('chat-directory');
 content.innerHTML='<div class="central-create"><div class="creation-symbol">'+icon(type==='agent'?'avatar':type==='channel'?'channels':'folder')+'</div><h2>A new '+label+'</h2><p class="muted">'+(type==='agent'?'Give your agent a name and describe the work it should help with.':type==='channel'?'Bring related conversations together. Each topic becomes a thread.':'Give related channels and chats a shared home.')+'</p><form id="workspace-create-form"><label for="workspace-create-name">'+(type==='agent'?'Agent name':'Name')+'</label><input id="workspace-create-name" required maxlength="80" placeholder="'+(type==='agent'?'For example, Firewall specialist':type==='channel'?'For example, Branch networks':'For example, Datacenter upgrade')+'">'+(type==='agent'?'<label for="workspace-create-role">What should this agent help with?</label><textarea id="workspace-create-role" required maxlength="500" placeholder="Describe the role in your own words"></textarea>':type==='channel'?'<label for="workspace-create-project">Project (optional)</label><select id="workspace-create-project"><option value="">No project</option>'+conversations.projects.map(p=>'<option value="'+escapeHTML(p.id)+'">'+escapeHTML(p.name)+'</option>').join('')+'</select>':'')+'<div class="creation-actions"><button type="button" id="cancel-workspace-create">Cancel</button><button type="submit" id="finish-workspace-create">Create '+label+'</button></div><p id="workspace-create-status" role="status"></p></form></div>';
 if(type==='channel')el('workspace-create-project').value=projectId||'';
 el('cancel-workspace-create').onclick=()=>showChat(creationReturnId);
 el('workspace-create-form').onsubmit=e=>{
 e.preventDefault();const name=el('workspace-create-name').value.trim();if(!name)return;
 if(type==='agent'){
 const role=el('workspace-create-role').value.trim();if(!role)return;
 if(preferences.agents.some(a=>a.name.toLowerCase()===name.toLowerCase())){el('workspace-create-status').textContent='Choose a different agent name.';return;}
 const agent={id:crypto.randomUUID(),name,role};preferences.agents.push(agent);preferences.activeAgent=agent.id;savePreferences();applyPreferences();newChat();currentChat().title='Chat with '+name;saveConversations();showChat(currentChat().id);openPane('agent');el('chat-status').textContent='Local agent profile created. This chat addresses '+name+'; no live agent is running.';return;
 }
 const list=type==='channel'?conversations.channels:conversations.projects,project=type==='channel'?(el('workspace-create-project').value||null):null;
 if(list.some(x=>x.name.toLowerCase()===name.toLowerCase()&&(type!=='channel'||x.projectId===project))){el('workspace-create-status').textContent='That name already exists here.';return;}
 const item={id:crypto.randomUUID(),name,...(type==='channel'?{projectId:project}:{})};list.push(item);saveConversations();showDirectory(type==='channel'?'Channel':'Project',item.id);
 };
 el('workspace-create-name').focus();
};
function openGlobalSearch(){
 retainChat();searchOpener=document.activeElement;searchCategory='All';el('global-search').value='';
 const categories=['All','Messages','Chats','Agents','Channels','Projects','Files','Links'];
 el('search-filters').replaceChildren(...categories.map(name=>{const b=document.createElement('button');b.textContent=name;b.dataset.searchCategory=name;b.onclick=()=>{searchCategory=name;updateGlobalSearch();};return b;}));
 updateGlobalSearch();el('search-dialog').showModal();el('global-search').focus();
}
function updateGlobalSearch(){
 const q=el('global-search').value.trim().toLowerCase(),results=[];
 const matches=s=>!q||String(s).toLowerCase().includes(q);
 const add=(category,name,detail,open)=>{if((searchCategory==='All'||searchCategory===category)&&matches(name+' '+detail))results.push({category,name,detail,open});};
 for(const c of conversations.chats){
 add('Chats',c.title,c.messages.length+' messages',()=>showChat(c.id));
 for(const [i,m] of c.messages.entries()){
 if(q)add('Messages',m.text||'Attachment message',c.title,()=>{showChat(c.id);const row=el('conversation').querySelectorAll('.message.user-message')[i+(c.sample?1:0)];if(row){row.classList.add('search-hit');row.scrollIntoView({block:'nearest'});}});
 for(const name of m.attachments)add('Files',name,c.title+' · filename only',()=>showChat(c.id));
 for(const url of m.text.match(/https?:\/\/[^\s<>]+/g)||[])add('Links',url,c.title,()=>showChat(c.id));
 }
 }
 for(const a of preferences.agents)add('Agents',a.name,a.role,()=>{preferences.activeAgent=a.id;savePreferences();applyPreferences();showChat(conversations.activeChat);openPane('agent');});
 for(const c of conversations.channels)add('Channels','# '+c.name,'Channel',()=>showDirectory('Channel',c.id));
 for(const p of conversations.projects)add('Projects',p.name,'Project',()=>showDirectory('Project',p.id));
 document.querySelectorAll('[data-search-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.searchCategory===searchCategory)));
 const container=el('search-results');container.replaceChildren(...results.map(r=>{const b=document.createElement('button');b.className='search-result';const body=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small'),tag=document.createElement('span');strong.textContent=r.name;small.textContent=r.detail;tag.textContent=r.category;tag.className='result-kind';body.append(strong,small);b.append(body,tag);b.onclick=()=>{el('search-dialog').close();r.open();};return b;}));
 if(!results.length){const p=document.createElement('p');p.className='search-empty';p.textContent=!q&&searchCategory==='Messages'?'Type to find messages across your chats.':q?'No matching '+searchCategory.toLowerCase()+'.':'No '+searchCategory.toLowerCase()+' saved yet.';container.append(p);}
}
function initializeEntrypoints(){
 document.querySelector('[data-destination=Search]').onclick=openGlobalSearch;
 el('global-search').oninput=updateGlobalSearch;el('close-search').onclick=()=>el('search-dialog').close();
 el('search-dialog').addEventListener('close',()=>{if(searchOpener?.isConnected)searchOpener.focus();});
 el('quick-create').onclick=()=>{const menu=el('create-menu'),opening=menu.hidden;menu.hidden=!opening;el('quick-create').setAttribute('aria-expanded',String(opening));if(opening){const r=el('quick-create').getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left,innerWidth-230))+'px';menu.style.top=Math.min(r.bottom+6,innerHeight-menu.offsetHeight-8)+'px';menu.querySelector('button').focus();}};
 const obsolete=el('create-dialog');if(obsolete)obsolete.remove();
}
