'use strict';
const conversationKey='aven-wireframe-conversations-v1';
let conversations, directoryContext=null, creationType='channel', sampleConversation,chatAttachments={};
function currentChat(){return conversations.chats.find(c=>c.id===conversations.activeChat);}
function saveConversations(){try{localStorage.setItem(conversationKey,JSON.stringify(conversations));}catch{el('chat-status').textContent='Local chat saving failed. Current changes remain in this session.';}}
function retainChat(){const c=currentChat();if(c){c.draft=el('draft').value;chatAttachments[c.id]=attachmentItems;}saveConversations();}
function syncRecipients(){
 const c=currentChat();c.recipients=c.recipients.filter(id=>preferences.agents.some(a=>a.id===id));
 if(!c.recipients.length)c.recipients=[preferences.activeAgent];
 const selected=preferences.agents.filter(a=>c.recipients.includes(a.id));
 el('recipient-summary').textContent='To: '+selected.map(a=>a.name).join(', ');
 el('recipient-options').replaceChildren(...preferences.agents.map(a=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=c.recipients.includes(a.id);input.onchange=()=>{c.recipients=input.checked?[...c.recipients,a.id]:c.recipients.filter(id=>id!==a.id);if(!c.recipients.length)c.recipients=[a.id];saveConversations();syncRecipients();};label.append(input,document.createTextNode(a.name));return label;}));
}
function showChat(id){
 if(conversations.activeChat)retainChat();
 conversations.activeChat=id;directoryContext=null;const c=currentChat();el('chat-directory').hidden=true;el('conversation').hidden=false;el('composer').hidden=false;el('chat-status').textContent='';
 el('surface').textContent=c.title;const ch=conversations.channels.find(x=>x.id===c.channelId),pr=conversations.projects.find(x=>x.id===c.projectId);
 el('chat-location').textContent=[pr?.name,ch?'# '+ch.name:'Direct chat'].filter(Boolean).join(' / ');
 el('conversation').replaceChildren();
 if(c.sample){el('conversation').innerHTML=sampleConversation;bindSampleTools();}
 for(const message of c.messages)appendStoredMessage(message);
 if(!c.sample&&!c.messages.length){const p=document.createElement('p');p.className='empty-chat muted';p.textContent='Choose one or more agents below, then start this conversation.';el('conversation').append(p);}
 el('draft').value=c.draft||'';attachmentItems=chatAttachments[c.id]||[];renderAttachments();syncRecipients();updateSend();saveConversations();
}
function bindSampleTools(){
 if(el('browser-request'))el('browser-request').onclick=()=>{show('tools',false);openPane('browser');};
 if(el('plugin-request'))el('plugin-request').onclick=()=>{show('tools',false);openPane('plugins');};
 if(el('computer-request'))el('computer-request').onclick=()=>{show('computer',false);openPane('computer');};
}
function appendStoredMessage(message){
 const row=document.createElement('div');row.className='message user-message';const to=document.createElement('small');to.className='message-recipient';to.textContent='To '+message.recipients.join(', ');row.append(to,document.createTextNode(message.text));
 for(const name of message.attachments){const line=document.createElement('div');line.textContent='Attachment: '+name;row.append(line);}el('conversation').append(row);
}
function newChat(channelId=null,projectId=null){
 retainChat();const channel=conversations.channels.find(c=>c.id===channelId);
 const c={id:crypto.randomUUID(),title:'New chat',channelId,projectId:channel?.projectId||projectId,recipients:[preferences.activeAgent],messages:[],draft:'',sample:false};conversations.chats.unshift(c);showChat(c.id);el('draft').focus();
}
function showDirectory(kind,entityId=null){
 retainChat();directoryContext={kind,entityId};el('right-pane').hidden=true;el('conversation').hidden=true;el('composer').hidden=true;el('chat-directory').hidden=false;el('chat-status').textContent='';
 const directory=el('chat-directory');directory.replaceChildren();
 let title=kind,description='';const entity=kind==='Channel'?conversations.channels.find(x=>x.id===entityId):kind==='Project'?conversations.projects.find(x=>x.id===entityId):null;
 if(entity)title=kind==='Channel'?'# '+entity.name:entity.name;
 el('surface').textContent=title;el('chat-location').textContent=kind==='Channel'?'Chat threads in this channel':kind==='Project'?'Channels and chats in this project':'Saved locally in this browser';
 const toolbar=document.createElement('div');toolbar.className='directory-toolbar';
 function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=fn;toolbar.append(b);}
 if(kind==='Channels')button('+ New channel',()=>openCreation('channel'));
 else if(kind==='Projects')button('+ New project',()=>openCreation('project'));
 else if(kind==='Channel')button('+ New thread',()=>newChat(entityId));
 else if(kind==='Project'){button('+ New chat',()=>newChat(null,entityId));button('+ New channel',()=>openCreation('channel',entityId));}
 else if(kind==='Chats')button('+ Start a chat',()=>newChat());
 directory.append(toolbar);
 if(kind==='Search'){
 const input=document.createElement('input');input.type='search';input.placeholder='Search chats, messages, channels, projects or agents';input.setAttribute('aria-label','Search workspace');directory.append(input);
 const results=document.createElement('div');directory.append(results);input.oninput=()=>renderSearch(input.value,results);input.focus();return;
 }
 const rows=[];
 const add=(title,detail,fn)=>{const b=document.createElement('button');b.className='directory-item';const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=title;small.textContent=detail;b.append(strong,small);b.onclick=fn;rows.push(b);};
 if(kind==='Projects')conversations.projects.forEach(p=>add(p.name,'Project',()=>showDirectory('Project',p.id)));
 if(kind==='Channels'||kind==='Project')conversations.channels.filter(c=>kind!=='Project'||c.projectId===entityId).forEach(c=>add('# '+c.name,conversations.chats.filter(t=>t.channelId===c.id).length+' threads',()=>showDirectory('Channel',c.id)));
 if(['Chats','Channel','Project'].includes(kind))conversations.chats.filter(c=>kind==='Chats'||(kind==='Channel'?c.channelId===entityId:c.projectId===entityId&&!c.channelId)).forEach(c=>add(c.title,c.messages.length+' local messages',()=>showChat(c.id)));
 if(!rows.length){const p=document.createElement('p');p.className='empty-chat muted';p.textContent='Nothing here yet. Create your first '+(kind==='Projects'?'project':kind==='Channels'?'channel':'chat thread')+'.';directory.append(p);}else directory.append(...rows);
}
function renderSearch(query,container){
 container.replaceChildren();const q=query.trim().toLowerCase();if(!q)return;
 const results=[
 ...conversations.chats.filter(c=>(c.title+' '+c.messages.map(m=>m.text).join(' ')).toLowerCase().includes(q)).map(c=>({name:c.title,type:'Chat',open:()=>showChat(c.id)})),
 ...conversations.channels.filter(c=>c.name.toLowerCase().includes(q)).map(c=>({name:c.name,type:'Channel',open:()=>showDirectory('Channel',c.id)})),
 ...conversations.projects.filter(c=>c.name.toLowerCase().includes(q)).map(c=>({name:c.name,type:'Project',open:()=>showDirectory('Project',c.id)})),
 ...preferences.agents.filter(a=>a.name.toLowerCase().includes(q)).map(a=>({name:a.name,type:'Agent',open:()=>{showChat(conversations.activeChat);preferences.activeAgent=a.id;savePreferences();applyPreferences();openPane('agent');}}))
 ];
 for(const r of results){const b=document.createElement('button');b.className='directory-item';b.textContent=r.type+' · '+r.name;b.onclick=r.open;container.append(b);}if(!results.length)container.textContent='No matching items.';
}
function openCreation(type,projectId=null){
 closeCreateMenu();if(type==='chat'){newChat();return;}if(type==='agent'){openSettings('agents');el('agent-name').focus();return;}
 creationType=type;el('create-title').textContent=type==='channel'?'New channel':'New project';el('create-name').value='';el('create-description').textContent=type==='channel'?'A channel groups related chat threads.':'A project groups related channels and direct chats.';
 el('create-project').innerHTML='<option value="">No project</option>'+conversations.projects.map(p=>'<option value="'+escapeHTML(p.id)+'">'+escapeHTML(p.name)+'</option>').join('');el('create-project').value=projectId||'';el('create-project').hidden=type!=='channel';document.querySelector('label[for=create-project]').hidden=type!=='channel';el('create-submit').textContent='Create '+type;el('create-dialog').showModal();el('create-name').focus();
}
function closeCreateMenu(){el('create-menu').hidden=true;el('quick-create').setAttribute('aria-expanded','false');}
function initializeConversations(){
 sampleConversation=el('conversation').innerHTML;
 try{const v=JSON.parse(localStorage.getItem(conversationKey)||'null');if(v&&Array.isArray(v.chats)&&v.chats.length&&Array.isArray(v.channels)&&Array.isArray(v.projects)&&v.chats.every(c=>Array.isArray(c.messages)&&Array.isArray(c.recipients)))conversations=v;}catch{}
 if(!conversations)conversations={projects:[],channels:[],activeChat:'initial',chats:[{id:'initial',title:'Incident investigation',sample:true,channelId:null,projectId:null,recipients:[preferences.activeAgent],messages:[],draft:el('draft').value}]};
 if(!currentChat())conversations.activeChat=conversations.chats[0].id;
 // Restore first without overwriting its saved draft from an empty DOM.
 const initial=conversations.activeChat;conversations.activeChat=null;showChat(initial);
 el('new-chat').onclick=()=>newChat(directoryContext?.kind==='Channel'?directoryContext.entityId:!directoryContext?currentChat().channelId:null,directoryContext?.kind==='Project'?directoryContext.entityId:!directoryContext?currentChat().projectId:null);
 document.querySelectorAll('[data-destination]').forEach(b=>{
 const destination=b.dataset.destination;
 if(['Chat','Channels','Projects','Search'].includes(destination))b.onclick=()=>{show('organization',false);showDirectory(destination==='Chat'?'Chats':destination);};
 else b.onclick=()=>{show('navigation',false);showDirectory('Chats');el('surface').textContent=destination;el('chat-location').textContent='Detailed view pending';const p=document.createElement('p');p.className='empty-chat muted';p.textContent=destination+' remains in the navigation. Its detailed experience is outside this conversation-organization iteration.';el('chat-directory').replaceChildren(p);};
 });

 el('quick-create').onclick=()=>{const menu=el('create-menu'),open=menu.hidden;menu.hidden=!open;el('quick-create').setAttribute('aria-expanded',String(open));if(open){const r=el('quick-create').getBoundingClientRect();menu.style.left=Math.min(innerWidth-230,r.right+8)+'px';menu.style.top=Math.max(8,Math.min(r.top,innerHeight-menu.offsetHeight-8))+'px';menu.querySelector('button').focus();}};
 document.querySelectorAll('[data-create]').forEach(b=>b.onclick=()=>openCreation(b.dataset.create));
 el('close-create').onclick=()=>el('create-dialog').close();
 el('create-form').onsubmit=e=>{e.preventDefault();const name=el('create-name').value.trim();if(!name)return;const list=creationType==='channel'?conversations.channels:conversations.projects;const projectId=creationType==='channel'?(el('create-project').value||null):null;if(list.some(x=>x.name.toLowerCase()===name.toLowerCase()&&(creationType!=='channel'||x.projectId===projectId))){el('create-description').textContent='That name already exists here. Choose another name.';return;}
 const entity={id:crypto.randomUUID(),name,...(creationType==='channel'?{projectId}:{})};list.push(entity);saveConversations();el('create-dialog').close();showDirectory(creationType==='channel'?'Channel':'Project',entity.id);};
 el('recipient-picker').addEventListener('toggle',()=>{if(el('recipient-picker').open)syncRecipients();});
 el('draft').oninput=()=>{updateSend();currentChat().draft=el('draft').value;saveConversations();};
 el('composer').onsubmit=e=>{e.preventDefault();const text=el('draft').value.trim();if(!text&&!attachmentItems.length)return;syncRecipients();const c=currentChat();const message={text,recipients:preferences.agents.filter(a=>c.recipients.includes(a.id)).map(a=>a.name),attachments:attachmentItems.map(x=>x.file.name)};
 c.messages.push(message);if(c.title==='New chat')c.title=text.slice(0,45)||'Attachments';for(const a of attachmentItems)if(a.url)URL.revokeObjectURL(a.url);attachmentItems=[];chatAttachments[c.id]=[];el('draft').value='';c.draft='';saveConversations();showChat(c.id);el('chat-status').textContent='Saved to this local chat for '+message.recipients.join(', ')+'. No agents invoked or files uploaded.';};
 document.addEventListener('pointerdown',e=>{if(!el('create-menu').contains(e.target)&&!el('quick-create').contains(e.target))closeCreateMenu();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('create-menu').hidden){closeCreateMenu();el('quick-create').focus();}});
 window.addEventListener('beforeunload',retainChat);
}
