(() => {
  'use strict';
  const CREATE_PENDING_KEY='aven-polished-coworker-create-pending-v1';
  const CREATE_KEYS=['aven-polished-preferences-v1','aven-polished-chats-v1','aven-polished-docs-v1'];
  const CREATE_TX_VERSION=1;
  function recoverPendingCoworkerCreate(storage){
    try{
      const pending=storage.getItem(CREATE_PENDING_KEY);
      if(!pending)return{ok:true,recovered:false};
      const transaction=JSON.parse(pending),before=transaction?.before;
      if(transaction?.version!==CREATE_TX_VERSION||typeof transaction.transactionId!=='string'||!transaction.transactionId||!before||typeof before!=='object'||CREATE_KEYS.some(key=>!Object.hasOwn(before,key)||(before[key]!==null&&typeof before[key]!=='string')))throw Error('Invalid coworker creation recovery journal.');
      for(const key of CREATE_KEYS){const previous=before[key],current=storage.getItem(key);if(current===previous)continue;if(previous===null)storage.removeItem(key);else storage.setItem(key,previous);}
      storage.removeItem(CREATE_PENDING_KEY);
      return{ok:true,recovered:true};
    }catch(error){return{ok:false,recovered:false,error};}
  }
  function persistCoworkerCreation(storage,next){
    let before;
    try{
      before=Object.fromEntries(CREATE_KEYS.map(key=>[key,storage.getItem(key)]));
      const transaction={version:CREATE_TX_VERSION,transactionId:globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`aven-create-${Date.now()}-${Math.random().toString(16).slice(2)}`,createdAt:new Date().toISOString(),before};
      storage.setItem(CREATE_PENDING_KEY,JSON.stringify(transaction));
      const values=[JSON.stringify(next.prefs),JSON.stringify(next.data),JSON.stringify(next.docs)];
      CREATE_KEYS.forEach((key,index)=>storage.setItem(key,values[index]));
      storage.removeItem(CREATE_PENDING_KEY);
      return{ok:true,recovered:false,pending:false};
    }catch(error){
      const recovery=recoverPendingCoworkerCreate(storage);
      return{ok:false,recovered:recovery.ok,pending:!recovery.ok,error,recovery};
    }
  }
  const creationRecovery=recoverPendingCoworkerCreate(localStorage);
  const startupRecovery=creationRecovery.ok?AvenWorkspaceBackup.recoverPending(localStorage):creationRecovery;
  let coworkerCreationRecoveryBlocked=!creationRecovery.ok;
  const byId = id => document.getElementById(id);
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const now = () => new Date().toISOString();
  const uid = () => globalThis.crypto?.randomUUID ? crypto.randomUUID() : `aven-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const paths = {
    about:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.6 2.6 0 0 1 5 1c0 2-2.5 2-2.5 4m0 3v.1"/>',feedback:'<path d="m3 10 18-7-7 18-3-8-8-3Zm8 3 10-10"/>',account:'<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2m3-13v8m-4-4h8"/>',logout:'<path d="M10 3H4v18h6m4-13 5 4-5 4m-6-4h11"/>',edit:'<path d="m4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4"/>',bell:'<path d="M6 9a6 6 0 0 1 12 0v7l2 2H4l2-2V9m4 12h4"/>',
    feed:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>', ideas:'<path d="M8 15a7 7 0 1 1 8 0l-1 3H9l-1-3ZM9 21h6"/>', goals:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', check:'<path d="m5 12 4.5 4.5L19 7"/>', retry:'<path d="M20 11a8 8 0 1 0 1 4M20 4v7h-7"/>',
    sidebar:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>', plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', avatar:'<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    chat:'<path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 3v-4a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3Z"/>', channels:'<path d="M9 3 7 21M17 3l-2 18M3 9h18M2 15h18"/>', folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', library:'<path d="M4 4v16M9 4v16M14 4v16m4-15 3 14"/>',
    settings:'<path d="M9.5 3h5l.7 2.6 2.3 1.3 2.6-.7 2.5 4.3-1.9 1.9v2.6l1.9 1.9-2.5 4.3-2.6-.7-2.3 1.3-.7 2.6h-5l-.7-2.6-2.3-1.3-2.6.7L1.4 17l1.9-1.9v-2.6l-1.9-1.9 2.5-4.3 2.6.7 2.3-1.3Z" transform="translate(1.4 -1) scale(.88)"/><circle cx="12" cy="11.4" r="3.2"/>', browser:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>', plug:'<path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4"/>', computer:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>', document:'<path d="M14 2H5v20h14V7l-5-5Z M14 2v6h5M8 12h8M8 16h6"/>', file:'<path d="M14 2H5v20h14V7l-5-5Z M14 2v6h5"/>', image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.3"/><path d="m4 17 5-5 3 3 2-2 6 5"/>', send:'<path d="M12 19V5m-6 6 6-6 6 6"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>', chevron:'<path d="m9 5 7 7-7 7"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.document}</svg>`;
  const setIcons = (root = document) => all('[data-icon]', root).forEach(node => { if (!node.querySelector('.icon')) node.prepend(document.createRange().createContextualFragment(icon(node.dataset.icon))); });

  const PREF_KEY='aven-polished-preferences-v1', CHAT_KEY='aven-polished-chats-v1', DOC_KEY='aven-polished-docs-v1', BACKUP_KEY='aven-polished-p1-raw-backup-v1', MIGRATION_KEY='aven-polished-direct-teams-migration-v4', MIGRATION_BACKUP_KEY='aven-polished-direct-teams-raw-backup-v1', REACTION_BACKUP_KEY='aven-polished-local-reactions-raw-backup-v1', REACTION_MIGRATION_KEY='aven-polished-local-reactions-v1';
  const UI_BUILD='ux-minimal-ui-v9.4-clarification',UI_BUILD_DATE='2026-09-19';
  const CHAT_API='http://127.0.0.1:8768/api/chat';
  const MAX_QUEUE_ITEMS=8, MAX_QUEUE_TEXT=4000, MAX_RAW_OUTPUT=512*1024, MAX_STREAM_BYTES=8*1024*1024;
  const defaultPrefs={theme:'system',accent:'black',language:'system',density:'comfortable',displayName:'',activeAgent:'companion',provider:'Not connected',model:'',browser:true,computer:false,showEvidence:false,showInvestigation:false,showRunDetails:false,sections:[],agents:[{id:'companion',name:'Network companion',role:'Investigate branch networks and explain findings.',timezone:'Follow system',autoReview:false},{id:'topology',name:'Topology analyst',role:'Map dependencies and surface the next useful signal.',timezone:'Follow system',autoReview:false}]};
  const defaultData={activeChat:'sample-network',chats:[{id:'sample-network',title:'Branch network review',sample:true,channelId:null,projectId:'personal',recipients:['companion'],draft:'',pendingAttachmentNames:[],messages:[]}],channels:[],projects:[{id:'personal',name:'Personal',system:true}]};
  const clone=value=>structuredClone(value);
  function parse(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):clone(fallback);}catch(_){return clone(fallback);}}
  function merge(base,value){const out={...clone(base),...(value&&typeof value==='object'?value:{})};for(const k of ['agents','sections'])if(!Array.isArray(out[k]))out[k]=clone(base[k]||[]);return out;}
  function backupRawOnce(){const raw=[PREF_KEY,CHAT_KEY,DOC_KEY].map(k=>`${k}=${localStorage.getItem(k)||''}`).join('\n');try{if(!localStorage.getItem(BACKUP_KEY))localStorage.setItem(BACKUP_KEY,`Aven P1 raw backup · ${now()}\n${raw}`);if(!localStorage.getItem(MIGRATION_BACKUP_KEY))localStorage.setItem(MIGRATION_BACKUP_KEY,`Direct + Teams raw backup · ${now()}\n${raw}`);return Boolean(localStorage.getItem(MIGRATION_BACKUP_KEY));}catch(_){return false;} }
  const LOCAL_REACTIONS=['👍','👎','❤️','😂','🎉','😮'];
  const MORE_REACTIONS=['🔥','👏','✅','🙏','🚀','💯','🤔','😢','😡','🤯'];
  const ALL_REACTIONS=[...LOCAL_REACTIONS,...MORE_REACTIONS];
  const REACTION_NAMES={
    '👍':'Thumbs up','👎':'Thumbs down','❤️':'Heart','😂':'Laughing','🎉':'Celebration','😮':'Surprised',
    '🔥':'Fire','👏':'Clapping','✅':'Check mark','🙏':'Thanks','🚀':'Rocket','💯':'Hundred points','🤔':'Thinking','😢':'Sad','😡':'Angry','🤯':'Mind blown'
  };
  const reactionName=emoji=>REACTION_NAMES[emoji]||emoji;
  const reactionSearchText=emoji=>`${emoji} ${reactionName(emoji)}`.toLocaleLowerCase();
  function backupLocalReactionSource(){try{if(!localStorage.getItem(REACTION_BACKUP_KEY))localStorage.setItem(REACTION_BACKUP_KEY,localStorage.getItem(CHAT_KEY)||'');return Boolean(localStorage.getItem(REACTION_BACKUP_KEY)!==null);}catch(_){return false;}}
  function normalizeLocalReactions(d){
    let changed=false,needsBackup=false;
    for(const chat of d.chats||[])for(const message of chat.messages||[]){
      if(!message||typeof message!=='object')continue;
      const legacy=Array.isArray(message.reactions)?message.reactions.filter(value=>ALL_REACTIONS.includes(value)):[];
      const current=ALL_REACTIONS.includes(message.localReaction)?message.localReaction:'';
      const next=current||legacy.at(-1)||'';
      if(Array.isArray(message.reactions))needsBackup=true;
      if(message.localReaction!==next){message.localReaction=next||null;changed=true;}
      if(!Array.isArray(message.reactions)||message.reactions.length!==Number(Boolean(next))||message.reactions[0]!==next){message.reactions=next?[next]:[];changed=true;}
    }
    return{changed,needsBackup};
  }
  function normalizeQueueItem(item){
    if(!item||typeof item!=='object')return null;
    const text=typeof item.text==='string'?item.text.trim():'';
    if(!text||text.length>MAX_QUEUE_TEXT)return null;
    return {id:typeof item.id==='string'&&item.id?item.id:uid(),text,createdAt:typeof item.createdAt==='string'?item.createdAt:now(),mode:item.mode==='plan'?'plan':'inspect',replyTo:normalizeReply(item.replyTo)};
  }
  function migrate(){
    const rawPrefs=parse(PREF_KEY,defaultPrefs),rawChats=parse(CHAT_KEY,defaultData),docs=parse(DOC_KEY,{}),alreadyMigrated=(()=>{try{return localStorage.getItem(MIGRATION_KEY)==='v4';}catch(_){return false;}})();
    const normalizePrefs=value=>{const p=merge(defaultPrefs,value);p.agents=p.agents.map(a=>({timezone:'Follow system',autoReview:false,hidden:false,archived:false,pinned:false,unread:false,sectionId:'',...a}));if(!p.agents.length)p.agents=clone(defaultPrefs.agents);if(!p.agents.some(a=>a.id===p.activeAgent))p.activeAgent=p.agents[0].id;return p;};
    const normalizeData=(value,p)=>{const raw=value&&typeof value==='object'?value:{};const d={...clone(defaultData),...raw,chats:Array.isArray(raw.chats)?raw.chats:[],channels:Array.isArray(raw.channels)?raw.channels:[],projects:Array.isArray(raw.projects)?raw.projects:[]};if(!d.projects.some(pj=>pj.id==='personal'))d.projects.unshift(clone(defaultData.projects[0]));d.chats=d.chats.map(c=>{const pending=Array.isArray(c.pendingQueue)?c.pendingQueue.map(normalizeQueueItem).filter(Boolean).slice(0,MAX_QUEUE_ITEMS):[];return {draft:'',pendingAttachmentNames:[],messages:[],recipients:[p.activeAgent],pendingQueue:pending,queuePaused:false,queuePauseReason:'',...c,projectId:Object.prototype.hasOwnProperty.call(c,'projectId')?(c.projectId===undefined?'personal':c.projectId):'personal',queueEditing:false,channelId:c.channelId||null,messages:Array.isArray(c.messages)?c.messages:[],pendingQueue:pending,queuePaused:Boolean(c.queuePaused)||pending.length>0,queuePauseReason:pending.length?(c.queuePauseReason||'Resume to continue queued messages.'):(c.queuePauseReason||'')};});d.projects=d.projects.map(team=>({...team,members:Array.isArray(team.members)?team.members:[]}));d.channels=d.channels.map(c=>({...c,projectId:c.projectId||'personal',members:Array.isArray(c.members)?c.members:[]}));if(!d.chats.length)d.chats=clone(defaultData.chats);if(!d.chats.some(c=>c.id===d.activeChat))d.activeChat=d.chats[0].id;return d;};
    const p=normalizePrefs(rawPrefs),d=normalizeData(clone(rawChats),p),reactionState=normalizeLocalReactions(d);
    if(reactionState.needsBackup&&!localStorage.getItem(REACTION_BACKUP_KEY)&&!backupLocalReactionSource())return{prefs:clone(p),data:normalizeData(clone(rawChats),p),docs:clone(docs),migrationFailed:true};
    const before={prefs:clone(p),data:clone(d),docs:clone(docs)};
    const transform=()=>{const channelTeams=new Map();for(const channel of d.channels){const members=Array.isArray(channel.members)?[...new Set(channel.members.filter(id=>p.agents.some(a=>a.id===id)))]:[];const teamId=channel.migratedToTeamId||uid();channelTeams.set(channel.id,teamId);if(!d.projects.some(team=>team.id===teamId))d.projects.push({id:teamId,name:channel.name||'Untitled conversation folder',members,collapsed:false,pinned:false,legacyChannelId:channel.id});else{const team=d.projects.find(item=>item.id===teamId);team.members=[...new Set([...(team.members||[]),...members])];}channel.migratedToTeamId=teamId;channel.legacy=true;d.chats.filter(chat=>chat.channelId===channel.id).forEach(chat=>{chat.projectId=teamId;chat.channelId=null;if(!Array.isArray(chat.recipients)||!chat.recipients.length)chat.recipients=[...members];});}d.chats.forEach(chat=>{if(!chat.projectId&&!chat.channelId&&chat.recipients?.length>1){const team={id:uid(),name:chat.title||'Shared conversation',members:[...chat.recipients]};d.projects.push(team);chat.projectId=team.id;}if(chat.projectId==='personal'&&!chat.channelId&&chat.recipients?.length===1)chat.projectId=null;const team=d.projects.find(item=>item.id===chat.projectId);if(team)team.members=[...new Set([...(team.members||[]),...(chat.recipients||[])])];});};
    const persist=()=>{const keys=[PREF_KEY,CHAT_KEY,DOC_KEY],previous=new Map(keys.map(k=>[k,localStorage.getItem(k)])),flag=localStorage.getItem(MIGRATION_KEY);try{localStorage.setItem(PREF_KEY,JSON.stringify(p));localStorage.setItem(CHAT_KEY,JSON.stringify(d));localStorage.setItem(DOC_KEY,JSON.stringify(docs));localStorage.setItem(MIGRATION_KEY,'v4');return true;}catch(_){try{for(const key of keys){const value=previous.get(key);if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}if(flag===null)localStorage.removeItem(MIGRATION_KEY);else localStorage.setItem(MIGRATION_KEY,flag);}catch(__){}return false;}};
    if(!alreadyMigrated){if(!backupRawOnce())return{prefs:before.prefs,data:before.data,docs:before.docs,migrationFailed:true};transform();if(!persist())return{prefs:before.prefs,data:before.data,docs:before.docs,migrationFailed:true};}
    else if(!d.chats.some(c=>c.pendingAdmission)&&!persist())return{prefs:before.prefs,data:before.data,docs:before.docs,migrationFailed:true};
    if(reactionState.changed){try{localStorage.setItem(REACTION_MIGRATION_KEY,'v1');}catch(_){} }
    return{prefs:p,data:d,docs};
  }
  if(startupRecovery.ok&&!localStorage.getItem('aven-polished-p2-backup-v1')){try{localStorage.setItem('aven-polished-p2-backup-v1',JSON.stringify(Object.fromEntries([PREF_KEY,CHAT_KEY,DOC_KEY].map(k=>[k,localStorage.getItem(k)]))));}catch{}}
  let {prefs,data,docs,migrationFailed}=startupRecovery.ok?migrate():{prefs:clone(defaultPrefs),data:clone(defaultData),docs:{},migrationFailed:true};
  let renderedChatId=null, currentView='conversation', toolContext=0, toolChatId=null, createSucceeded=false, createOpener=null, contextOpener=null, expandedWidth=260;
  const collapsedProjects=new Set();
  const chatRequests=new Map(),chatErrors=new Map(),receiptViews=new Map();
  const browserSession=uid();let receiptSavePermit=null,admissionWriter=null;
  let savedWorkspace=localStorage.getItem(CHAT_KEY);
  const captureKeys=['pendingAdmission','messages','runJournal','queueDispatching','pendingQueue','queuePaused','queuePauseReason'];
  const savedCapture=c=>JSON.stringify(captureKeys.map(key=>c[key]));
  let savedChatSnapshots=new Map(data.chats.map(c=>[c.id,savedCapture(c)]));
  async function withAdmissionWriter(chatId,work){
    if(!navigator.locks?.request)throw Error('This browser cannot coordinate saved runs. Use a browser with Web Locks support.');
    return navigator.locks.request('aven-polished-admission-writer-v1',{ifAvailable:true},async lock=>{
      if(!lock)throw Error('Another tab is still saving a run. Let it finish before recovering or retrying here.');
      admissionWriter=chatId;try{return await work();}finally{admissionWriter=null;}
    });
  }
  function saveWorkspace(unrelatedSaveLocked=false){
    try{
      if(localStorage.getItem(CHAT_KEY)!==savedWorkspace){toast('Workspace changed in another tab. Keep your draft and reload before saving or recovering.');return false;}
      const stored=JSON.parse(savedWorkspace||'{"chats":[]}'),protectedChats=new Map();
      for(const previous of stored.chats){
        if(!previous.pendingAdmission||AvenAdmission.pending(previous)?.submission.ownerSession===browserSession)continue;
        if(previous.id===admissionWriter&&previous.pendingAdmission===receiptSavePermit)continue;
        const current=data.chats.find(c=>c.id===previous.id);
        if((!admissionWriter&&!unrelatedSaveLocked)||!current||savedCapture(current)!==savedChatSnapshots.get(previous.id)){
          toast('Another session has a saved request. Check its result before changing captured work.');return false;
        }
        const protectedChat={...current};for(const key of captureKeys){if(Object.hasOwn(previous,key))protectedChat[key]=previous[key];else delete protectedChat[key];}
        protectedChats.set(previous.id,protectedChat);
      }
      const next=protectedChats.size?{...data,chats:data.chats.map(c=>protectedChats.get(c.id)||c)}:data;
      if(!save(CHAT_KEY,next))return false;
      savedWorkspace=localStorage.getItem(CHAT_KEY);savedChatSnapshots=new Map(data.chats.map(c=>[c.id,savedCapture(c)]));return true;
    }catch{return false;}
  }
  let unrelatedSave=Promise.resolve();
  function saveUnrelatedData(){
    if(admissionWriter||!data.chats.some(c=>c.pendingAdmission&&AvenAdmission.pending(c)?.submission.ownerSession!==browserSession))return saveData();
    // Navigation and drafts may outlive a writer, but must not invalidate a live
    // writer's snapshot. Recheck storage and capture inside the same Web Lock.
    if(!navigator.locks?.request){toast('This browser cannot coordinate saved runs. Your draft is kept in this tab only.');return;}
    // Serialize this tab's saves so they cannot contend with one another.
    unrelatedSave=unrelatedSave.then(()=>navigator.locks.request('aven-polished-admission-writer-v1',{ifAvailable:true},lock=>{
      if(!lock){toast('Another tab is still saving a run. Your draft is kept in this tab only; copy it before reloading.');return;}
      saveWorkspace(true);
    })).catch(()=>toast('Could not save this change. Your draft is kept in this tab only.'));
  }
  function toast(text){byId('chat-status').textContent=text;}
  let profileDraft=null,profileAgentId=null,profileOriginal='',profileGeneration=0,profileAvatarBusy=false,avatarTab='styles',settingsBehavior=new Map(),behaviorAgentId=null;
  let paneView='agent',paneOpener=null,settingsDraft=null,settingsPage='general',settingsOpener=null,searchOpener=null,createReturnChat=null,contextAgentId=null,contextChatId=null,activeDoc=null,composition=false;
  const sessionAttachments=new Map(),toolStates={browser:{status:'idle',attempt:0},plugins:{status:'idle',attempt:0},computer:{status:'idle',attempt:0}};let toolTimers={};
  const save=(k,v)=>{if(coworkerCreationRecoveryBlocked)return false;try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(_){return false;}};const savePrefs=()=>save(PREF_KEY,prefs),saveData=()=>saveWorkspace(),saveDocs=()=>save(DOC_KEY,docs);const currentChat=()=>data.chats.find(c=>c.id===data.activeChat)||data.chats[0];const agentById=id=>prefs.agents.find(a=>a.id===id)||prefs.agents[0];const selectedAgents=(chat=currentChat())=>(chat?.recipients||[prefs.activeAgent]).map(agentById).filter(Boolean);const projectById=id=>data.projects.find(p=>p.id===id);const activeProject=chat=>projectById(chat?.projectId)||projectById('personal');
  function createAvatar(size='small',agent=agentById(prefs.activeAgent)){return AvenAvatars.make(size,agent);}
  function resolvedTheme(){return prefs.theme==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):prefs.theme;}
  function applyPrefs(){document.documentElement.dataset.theme=resolvedTheme();document.documentElement.dataset.accent=prefs.accent||'black';document.documentElement.dataset.density=prefs.density||'comfortable';const recipientIds=currentChat()?.recipients||[prefs.activeAgent],a=agentById(recipientIds[0]);byId('avatar').replaceChildren(createAvatar('small',a));byId('draft').placeholder='Message '+recipientIds.map(id=>agentById(id).name).join(', ')+'…';byId('account-name').textContent=prefs.displayName||'Vikas';}
  function retainDraft(){const c=data.chats.find(x=>x.id===renderedChatId);if(!c||!byId('draft')||byId('composer-wrap').hidden)return;c.draft=byId('draft').value;if(sessionAttachments.has(c.id))c.pendingAttachmentNames=sessionAttachments.get(c.id).map(i=>i.name);saveUnrelatedData();}
  function clearCenter(){byId('jump-latest').hidden=true;for(const id of ['conversation','chat-directory','empty-view','create-view'])if(byId(id))byId(id).hidden=true;}
  
  const navGlyphs={plus:'<path d="M12 5v14M5 12h14"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',reactionMore:'<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/>',pin:'<path d="m9 3 6 0-1 6 4 4H6l4-4-1-6Zm3 10v8"/>',archive:'<path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',edit:'<path d="m4 16 12-12 4 4-12 12H4z"/>',move:'<path d="M4 5h6l2 3h8v12H4zM9 14h7m-3-3 3 3-3 3"/>',restore:'<path d="M4 4v6h6M4 10a8 8 0 1 1 0 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>'};
  function navIcon(name){return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(navGlyphs[name]||navGlyphs.more)+'</svg>';}
  function navButton(label,glyph,action){const b=document.createElement('button');b.type='button';b.className='nav-icon';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=navIcon(glyph);b.onclick=e=>{e.stopPropagation();action(b);};return b;}
  function navCommit(change){const before=clone(data);change();if(!saveData()){data=before;renderSidebar();if(currentView==='conversation'){renderConversation();renderComposer();}toast('Could not save this change. Please free local storage and try again.');return false;}renderSidebar();return true;}
  let pinSequence=Date.now();
  const pinTimestamp=item=>{const value=Number(item?.pinnedAt);return Number.isFinite(value)&&value>0?value:Number.MAX_SAFE_INTEGER;};
  const pinComparator=(left,right)=>Number(left?.pinned!==true)-Number(right?.pinned!==true)||pinTimestamp(left)-pinTimestamp(right);
  const setPinned=(item,value)=>{item.pinned=Boolean(value);if(item.pinned){const existing=[...data.chats,...data.projects,...prefs.agents].map(x=>Number(x?.pinnedAt)).filter(Number.isFinite);pinSequence=Math.max(pinSequence,...existing)+1;item.pinnedAt=pinSequence;}else delete item.pinnedAt;};
  const directPinTimestamp=chat=>{const owner=directOwner(chat);return Math.min(pinTimestamp(chat),pinTimestamp(owner));};
  const directPinComparator=(left,right)=>Number(!(left?.pinned===true||directOwner(left)?.pinned===true))-Number(!(right?.pinned===true||directOwner(right)?.pinned===true))||directPinTimestamp(left)-directPinTimestamp(right);
  function savedWaitingChat(){return data.chats.find(c=>c.pendingAdmission&&c.messages.some(m=>m.requestId===c.pendingAdmission&&m.question?.phase==='waiting'&&!m.question.inert));}
  function chatBusy(c){return !!c.pendingAdmission||chatRequests.has(c.id)||(c.pendingQueue||[]).length>0;}
  let navMenuCleanup=null;
  function closeNavMenu(restore=true){const active=byId('nav-menu'),opener=active?._opener;active?.remove();navMenuCleanup?.();navMenuCleanup=null;if(restore&&opener?.isConnected)opener.focus();}
  function navMenu(opener,items,point){closeNavMenu(false);closeContextMenu(false);closePopovers();const menu=document.createElement('div');menu.id='nav-menu';menu.className='nav-menu';menu.setAttribute('role','menu');menu._opener=opener;
    items.forEach(item=>{if(!item){menu.append(document.createElement('hr'));return;}const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.innerHTML=navIcon(item.icon||'more');const label=document.createElement('span');label.textContent=item.label;b.append(label);b.disabled=!!item.disabled;if(item.reason)b.title=item.reason;b.onclick=()=>{closeNavMenu(false);item.run();};menu.append(b);});document.body.append(menu);const r=opener.getBoundingClientRect(),x=point?.x??r.right-menu.offsetWidth,y=point?.y??r.bottom+5;menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';
    const keys=e=>{const buttons=[...menu.querySelectorAll('button:not(:disabled)')],emojiButtons=[...menu.querySelectorAll('.message-emoji-button:not(:disabled)')];if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeNavMenu();}else if(['ArrowRight','ArrowLeft'].includes(e.key)&&emojiButtons.length){e.preventDefault();const i=emojiButtons.indexOf(document.activeElement);emojiButtons[i<0?0:(i+(e.key==='ArrowRight'?1:-1)+emojiButtons.length)%emojiButtons.length]?.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}else if(e.key==='Tab')closeNavMenu(false);};const outside=e=>{if(!menu.contains(e.target)&&!opener.contains(e.target))closeNavMenu(false);};document.addEventListener('keydown',keys,true);document.addEventListener('pointerdown',outside,true);navMenuCleanup=()=>{document.removeEventListener('keydown',keys,true);document.removeEventListener('pointerdown',outside,true);};menu.querySelector('button:not(:disabled)')?.focus();
  }
  function navDialog(title,fields,submitLabel,onSubmit){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;const dialog=byId('workspace-create-dialog');byId('workspace-create-title').textContent=title;const body=byId('create-dialog-body');body.replaceChildren();const form=document.createElement('form');form.className='workspace-form';fields.forEach(f=>{const label=document.createElement('label');label.htmlFor=f.id;label.textContent=f.label;const input=document.createElement(f.options?'select':f.multiline?'textarea':'input');input.id=f.id;if(f.options)f.options.forEach(([value,text])=>{const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);});else{input.maxLength=f.maxLength||80;input.required=true;if(f.multiline)input.rows=7;}input.value=f.value||'';form.append(label,input);});const status=document.createElement('p');status.id='nav-form-status';status.setAttribute('role','status');const actions=document.createElement('div');actions.className='form-actions';const cancel=document.createElement('button');cancel.type='button';cancel.className='button-secondary';cancel.textContent='Cancel';cancel.onclick=()=>dialog.close();const submit=document.createElement('button');submit.type='submit';submit.id='nav-form-submit';submit.className='button-primary';submit.textContent=submitLabel;actions.append(cancel,submit);form.append(status,actions);form.onsubmit=e=>{e.preventDefault();onSubmit(status,dialog);};body.append(form);byId('close-workspace-create').onclick=()=>dialog.close();dialog.onclose=()=>byId('thread-actions')?.focus();dialog.showModal();form.querySelector('input,select,textarea')?.focus();}
  
  
  
  function archiveNavChat(c){if(chatBusy(c)){toast('Finish the run and clear queued messages before archiving.');return;}if(navCommit(()=>{c.archived=true;})){if(data.activeChat===c.id)showChat(c.id);}}
  
  
  function projectNavMenu(p,opener,point){const chats=data.chats.filter(c=>c.projectId===p.id&&!c.channelId&&!c.archived);navMenu(opener,[{label:'New conversation',icon:'plus',run:()=>newProjectChat(p)},{label:'Rename folder',icon:'edit',run:()=>renameNav('project',p)},{label:p.pinned?'Unpin folder':'Pin folder',icon:'pin',run:()=>navCommit(()=>{setPinned(p,!p.pinned);})},null,{label:'Archive conversations',icon:'archive',disabled:chats.some(chatBusy)||!chats.length,reason:'Finish active runs and clear queued messages first.',run:()=>{if(chats.some(chatBusy))return;if(navCommit(()=>{chats.forEach(c=>c.archived=true);})){showChat();}}},{label:'Archived conversations',icon:'restore',run:()=>showArchived(p)}],point);}
  

  
  
  function moveSection(id,direction){
    const index=prefs.sections.findIndex(item=>item.id===id),target=index+direction;
    if(index<0||target<0||target>=prefs.sections.length)return;
    const next=clone(prefs);[next.sections[index],next.sections[target]]=[next.sections[target],next.sections[index]];
    if(!save(PREF_KEY,next)){toast('Could not save section order. The previous order is unchanged.');}else{prefs=next;renderSidebar();}
    one('[data-section-menu="'+CSS.escape(id)+'"]')?.focus();
  }
  function showSectionMenu(id,x,y,opener){
    const index=prefs.sections.findIndex(item=>item.id===id);if(index<0)return;
    navMenu(opener,[{label:'Rename section',icon:'edit',run:()=>openRenameSection(id)},{label:'Move section up',icon:'move',disabled:index===0,run:()=>moveSection(id,-1)},{label:'Move section down',icon:'move',disabled:index===prefs.sections.length-1,run:()=>moveSection(id,1)}],{x,y});
  }
  function openRenameSection(id){
    const sec=prefs.sections.find(s=>s.id===id);if(!sec)return;const dialog=byId('workspace-create-dialog');byId('workspace-create-title').textContent='Rename section';byId('create-dialog-body').innerHTML='<form id="section-form" class="workspace-form"><label for="section-name">Section name</label><input id="section-name" maxlength="60" autocomplete="off"><p id="section-status" role="status"></p><div class="form-actions"><button type="button" id="cancel-section" class="button-secondary">Cancel</button><button type="submit" id="rename-section" class="button-primary">Rename</button></div></form>';byId('section-name').value=sec.name;byId('cancel-section').onclick=()=>dialog.close();byId('close-workspace-create').onclick=()=>dialog.close();dialog.onclose=()=>all('[data-section-toggle]').find(n=>n.dataset.sectionToggle===id)?.focus();byId('section-form').onsubmit=e=>{e.preventDefault();const name=byId('section-name').value.trim();if(!name){byId('section-status').textContent='Enter a section name.';return;}if(prefs.sections.some(s=>s.id!==id&&s.name.trim().toLowerCase()===name.toLowerCase())){byId('section-status').textContent='Another section uses that name.';return;}const next=clone(prefs);next.sections.find(s=>s.id===id).name=name;if(!save(PREF_KEY,next)){byId('section-status').textContent='Could not save. The previous name is unchanged.';return;}prefs=next;renderSidebar();dialog.close();};dialog.showModal();byId('section-name').focus();byId('section-name').select();
  }
  
  function normalizeReply(value){
    if(!value||typeof value.id!=='string'||typeof value.text!=='string')return null;
    return {id:value.id.slice(0,100),author:String(value.author||'Message').slice(0,80),text:value.text.slice(0,1000),truncated:!!value.truncated};
  }
  function contextMessage(m){
    const reply=normalizeReply(m.replyTo);
    return reply?'Quoted earlier message from '+reply.author+':\n> '+reply.text.replace(/\n/g,'\n> ')+(reply.truncated?'\n[Quote shortened]':'')+'\n\nReply:\n'+m.text:String(m.text||'');
  }
  function chatContext(c,draft=null){
    const history=draft?[...c.messages,draft]:c.messages;
    const eligible=history.filter(m=>!m.welcome&&['user','assistant'].includes(m.role)&&m.text?.trim());
    const messages=[];let characters=0;
    for(const m of history.slice(-24).reverse()){
      if(m.welcome||!['user','assistant'].includes(m.role)||!m.text?.trim())continue;
      const content=contextMessage(m);if(characters+content.length>32000)break;
      messages.unshift({role:m.role,content});characters+=content.length;
    }
    const omitted=eligible.length-messages.length,total=eligible.length;
    return {messages,characters,omitted,total,windowMessages:messages.length,windowCharacters:characters,retainedMessages:messages.length,retainedCharacters:characters,omittedMessages:omitted,totalMessages:total};
  }
  function updateContextIndicator(){
    const c=currentChat(),node=byId('context-indicator');if(!c||!node)return;
    const text=byId('draft').value.trim(),ctx=chatContext(c,text?{role:'user',text,replyTo:c.draftReplyTo}:null);
    if(text&&contextMessage({text,replyTo:c.draftReplyTo}).length>32000){
      node.dataset.contextState='over-limit';node.setAttribute('aria-label','Context draft is over the local 32,000 character limit');node.title='This draft and its quote exceed the local 32,000 character limit. Shorten the draft before sending.';return;
    }
    node.dataset.contextState='unknown';node.setAttribute('aria-label','Context capacity unavailable');
    node.title='Context capacity unavailable until the selected model reports its limit. '+ctx.messages.length+' message'+(ctx.messages.length===1?'':'s')+' currently fit the local window'+(ctx.omitted?'; '+ctx.omitted+' older message'+(ctx.omitted===1?'':'s')+' omitted':'')+'.';
  }
  function jumpToReply(reply){
    const target=one('[data-message-id="'+CSS.escape(reply.id)+'"]');
    if(!target){toast('The quoted message is not in the current conversation history. The saved quote is still available.');return;}
    target.scrollIntoView({block:'center',behavior:'auto'});target.tabIndex=-1;target.focus({preventScroll:true});
  }
  function startReply(c,m){
    if(c.archived)return;
    const raw=evidenceItems(m.events,m.evidence),text=raw.length?raw.map(e=>e.output).join('\n\n'):String(m.text||'');
    const previous=c.draftReplyTo;
    c.draftReplyTo=normalizeReply({id:m.id,author:m.role==='user'?'You':agentById(m.agentId||c.recipients?.[0]).name,text,truncated:text.length>1000});
    if(!saveData()){c.draftReplyTo=previous;toast('Could not save the reply selection.');return;}
    renderReplyPreview(c);updateContextIndicator();byId('draft').focus();
  }
  function renderReplyPreview(c){
    const box=byId('reply-preview');if(!box)return;box.replaceChildren();const reply=normalizeReply(c.draftReplyTo);box.hidden=!reply;if(!reply)return;
    const quote=document.createElement('button');quote.type='button';quote.className='reply-quote';quote.textContent='Reply to '+reply.author+' · '+reply.text;quote.onclick=()=>jumpToReply(reply);
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='×';cancel.setAttribute('aria-label','Cancel reply');cancel.onclick=()=>{const old=c.draftReplyTo;delete c.draftReplyTo;if(!saveData()){c.draftReplyTo=old;toast('Could not save this change.');return;}renderReplyPreview(c);updateContextIndicator();byId('draft').focus();};box.append(quote,cancel);
  }
  function appendReplyQuote(row,m){
    const reply=normalizeReply(m.replyTo);if(!reply)return;const b=document.createElement('button');b.type='button';b.className='message-reply-quote';b.textContent='Reply to '+reply.author+' · '+reply.text;b.onclick=()=>jumpToReply(reply);row.append(b);
  }
  let findMatches=[],findPosition=0,findOpener=null;
  function closeConversationFind(restore=true){
    const bar=byId('conversation-find');if(!bar)return;bar.hidden=true;findMatches=[];if(!restore)byId('conversation-find-input').value='';
    CSS.highlights?.delete('aven-find');CSS.highlights?.delete('aven-find-active');
    if(restore&&findOpener?.isConnected)findOpener.focus();
  }
  function selectFindMatch(delta=0){
    if(!findMatches.length){byId('conversation-find-count').textContent='No matches';return;}
    findPosition=(findPosition+delta+findMatches.length)%findMatches.length;
    const range=findMatches[findPosition],element=range.startContainer.parentElement;
    for(let n=element;n&&n!==byId('conversation');n=n.parentElement)if(n.tagName==='DETAILS')n.open=true;
    element.scrollIntoView({block:'center',behavior:'auto'});
    if(CSS.highlights)CSS.highlights.set('aven-find-active',new Highlight(range));
    byId('conversation-find-count').textContent=(findPosition+1)+' of '+findMatches.length;
  }
  function refreshConversationFind(){
    if(!byId('conversation-find')||byId('conversation-find').hidden)return;
    const query=byId('conversation-find-input').value;findMatches=[];findPosition=0;
    CSS.highlights?.delete('aven-find');CSS.highlights?.delete('aven-find-active');
    if(!query){byId('conversation-find-count').textContent='Enter text';byId('find-prev').disabled=byId('find-next').disabled=true;return;}
    for(const body of all('#conversation .message-body')){
      const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('button,summary')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
      const nodes=[];let text='',node;while((node=walker.nextNode())){nodes.push({node,start:text.length});text+=node.textContent;}
      const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
      for(const match of text.matchAll(pattern)){
        const offset=match.index,end=offset+match[0].length,startNode=nodes.findLast(n=>n.start<=offset),endNode=nodes.findLast(n=>n.start<end);
        if(startNode&&endNode){const range=document.createRange();range.setStart(startNode.node,offset-startNode.start);range.setEnd(endNode.node,end-endNode.start);findMatches.push(range);}
      }
    }
    if(CSS.highlights)CSS.highlights.set('aven-find',new Highlight(...findMatches));
    byId('find-prev').disabled=byId('find-next').disabled=!findMatches.length;selectFindMatch();
  }
  function openConversationFind(){
    if(currentView!=='conversation')return;closeNavMenu(false);findOpener=document.activeElement===document.body?byId('thread-actions'):document.activeElement;byId('conversation-find').hidden=false;
    byId('conversation-find-input').focus();byId('conversation-find-input').select();refreshConversationFind();
  }
  function plainPreview(text){
    return String(text||'').replace(/```[^\n]*\n?/g,' ').replace(/!?(\[([^\]]+)\])\([^)]*\)/g,'$2').replace(/^\s*[| :\-]+$/gm,' ').replace(/^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm,'').replace(/[*_~`|]/g,' ').replace(/\s+/g,' ').trim();
  }
  let commandOpener=null,commandExecuting=false;
  function localActions(){
    const conversation=currentView==='conversation'&&!!currentChat();
    return [
      {id:'commands',label:'Open commands',shortcut:'Ctrl / Cmd + K',run:openCommands},
      {id:'find',label:'Find in conversation',shortcut:'Ctrl / Cmd + F',reason:conversation?'':'Open a conversation first.',run:openConversationFind},
      {id:'new',label:'New coworker',run:()=>createWorkspace('agent')},
      {id:'search',label:'Search saved conversations',run:openSearch},
      {id:'profile',label:'Open coworker profile',reason:conversation?'':'Open a conversation first.',run:()=>openProfile(currentChat().recipients?.[0]||prefs.activeAgent)},
      {id:'settings',label:'Open Settings',run:()=>openSettings()},
      {id:'archived',label:'View archived conversations',run:()=>openSettings('archived')},
      {id:'sidebar',label:byId('rail').classList.contains('expanded')?'Collapse sidebar':'Expand sidebar',run:()=>byId('toggle').click()},
      {id:'shortcuts',label:'Keyboard shortcuts and help',run:showShortcutReference}
    ];
  }
  function executeLocalAction(action){
    if(action.reason)return;commandExecuting=true;byId('command-dialog').close();action.run();
  }
  function renderCommands(){
    const query=byId('command-query').value.trim().toLocaleLowerCase(),box=byId('command-results');box.replaceChildren();
    const actions=localActions().filter(a=>a.id!=='commands'&&a.label.toLocaleLowerCase().includes(query));
    for(const action of actions){
      const button=document.createElement('button');button.type='button';button.dataset.command=action.id;button.disabled=!!action.reason;
      const label=document.createElement('span');label.textContent=action.label;button.append(label);
      if(action.reason||action.shortcut){const hint=document.createElement('small');hint.textContent=action.reason||action.shortcut;button.append(hint);}
      button.onclick=()=>executeLocalAction(action);box.append(button);
    }
    if(!actions.length){const p=document.createElement('p');p.className='command-empty';p.textContent='No matching commands. Try “settings” or “coworker”.';box.append(p);}
  }
  function openCommands(){
    const dialog=byId('command-dialog');if(one('dialog[open]')&& !dialog.open)return;
    closeNavMenu(false);closePopovers();commandOpener=document.activeElement===document.body?byId('commands-button'):document.activeElement;commandExecuting=false;
    byId('command-query').value='';renderCommands();if(!dialog.open)dialog.showModal();byId('command-query').focus();
  }
  function showShortcutReference(){
    const shortcuts=localActions().filter(a=>a.shortcut).map(a=>[a.shortcut,a.label]);
    shortcuts.push(['Enter','Send or queue the composer message'],['Shift + Enter','Add a new line in the composer'],['Enter / Shift + Enter','Next / previous match while finding'],['Escape','Close the current menu, find bar, or dialog']);
    showInfo('Help and keyboard shortcuts','<p>Use + to create a coworker. Organize existing history under Conversations. Your drafts and chats stay in this browser.</p><table class="shortcut-table"><tbody>'+shortcuts.map(([key,label])=>'<tr><th><kbd>'+esc(key)+'</kbd></th><td>'+esc(label)+'</td></tr>').join('')+'</tbody></table><p class="setting-help">Commands open local controls. Sending a message is a separate action. Shortcuts do not override an open settings or editing dialog.</p>');
  }
  function wireCommands(){
    const dialog=byId('command-dialog');byId('commands-button').onclick=openCommands;byId('close-commands').onclick=()=>dialog.close();byId('command-query').oninput=renderCommands;
    dialog.onclose=()=>{if(!commandExecuting&&commandOpener?.isConnected)commandOpener.focus();commandExecuting=false;};
    dialog.addEventListener('keydown',e=>{
      const buttons=all('#command-results button:not(:disabled)');
      if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const i=buttons.indexOf(document.activeElement);buttons[i<0?(e.key==='ArrowDown'?0:buttons.length-1):(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(e.key==='Enter'&&e.target===byId('command-query')){e.preventDefault();buttons[0]?.click();}
    });
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.altKey&&!one('dialog[open]')){e.preventDefault();openCommands();}},true);
  }
  function durationLabel(ms){const seconds=Math.max(0,Math.round(ms/1000));return seconds<60?seconds+'s':Math.floor(seconds/60)+'m '+seconds%60+'s';}
  function inlineMessage(parent,text){
    const parts=String(text).split(/(`[^`]+`|!?\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*|https?:\/\/[^\s<>]+)/g);
    for(const part of parts){
      if(!part)continue;
      if(part.startsWith('`')&&part.endsWith('`')){const code=document.createElement('code');code.textContent=part.slice(1,-1);parent.append(code);continue;}
      const link=part.match(/^(!?)\[([^\]]+)\]\(([^)]+)\)$/),bare=/^https?:\/\//i.test(part);
      if(link||bare){
        const raw=link?link[3]:part.replace(/[.,;!?]+$/,'');let url;
        try{url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||/[\u0000-\u0020\u007f]/.test(raw))url=null;}catch{url=null;}
        if(url){const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';a.title=url.href;a.textContent=link?(link[1]?'Image: '+link[2]+' (open)':link[2]):raw;parent.append(a);if(bare&&raw.length<part.length)parent.append(document.createTextNode(part.slice(raw.length)));continue;}
      }
      const kind=part.startsWith('**')&&part.endsWith('**')?'strong':part.startsWith('~~')&&part.endsWith('~~')?'del':part.startsWith('*')&&part.endsWith('*')?'em':null;
      if(kind){const node=document.createElement(kind),trim=kind==='em'?1:2;node.textContent=part.slice(trim,-trim);parent.append(node);}else parent.append(document.createTextNode(part));
    }
  }
  function renderMessageText(parent,text){
    const lines=String(text).split(/\r?\n/);let paragraph=[],list=null;
    const flush=()=>{if(paragraph.length){const p=document.createElement('p');inlineMessage(p,paragraph.join('\n'));parent.append(p);paragraph=[];}list=null;};
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(line.trim().startsWith('```')){flush();const code=[];while(++i<lines.length&&!lines[i].trim().startsWith('```'))code.push(lines[i]);const pre=document.createElement('pre'),n=document.createElement('code');n.textContent=code.join('\n');pre.append(n);if(code.length>12){const details=document.createElement('details');details.className='message-code-fold';const summary=document.createElement('summary');const language=line.trim().slice(3).trim();summary.textContent=(language||'Code')+' · '+code.length+' lines';pre.tabIndex=0;details.append(summary,pre);parent.append(details);}else parent.append(pre);continue;}
      if(/^\s*#{1,6}\s/.test(line)){flush();const h=document.createElement('h3');inlineMessage(h,line.replace(/^\s*#{1,6}\s+/,''));parent.append(h);continue;}
      if(/^\s*[-*_]{3,}\s*$/.test(line)){flush();parent.append(document.createElement('hr'));continue;}
      if(line.includes('|')&&i+1<lines.length&&/^\s*\|?[ :|-]+\|[ :|-]*$/.test(lines[i+1])){
        flush();const table=document.createElement('table'),wrap=document.createElement('div');wrap.className='message-table';
        const row=(value,head)=>{const tr=document.createElement('tr');value.trim().replace(/^\||\|$/g,'').split('|').forEach(cell=>{const td=document.createElement(head?'th':'td');inlineMessage(td,cell.trim());tr.append(td);});table.append(tr);};
        row(line,true);i++;while(i+1<lines.length&&lines[i+1].includes('|'))row(lines[++i],false);wrap.append(table);parent.append(wrap);continue;
      }
      const match=line.match(/^\s*(?:[-*]\s+|\d+[.)]\s+)(.+)$/);
      if(match){if(paragraph.length)flush();const type=/^\s*\d/.test(line)?'ol':'ul';if(!list||list.tagName.toLowerCase()!==type){list=document.createElement(type);parent.append(list);}const li=document.createElement('li');inlineMessage(li,match[1]);list.append(li);continue;}
      if(!line.trim()){flush();continue;}
      if(list)list=null;paragraph.push(line);
    }flush();
  }
  function evidenceItems(events=[],evidence=[]){
    const byKey=new Map(), add=(item,prefer=false)=>{
      if(!item||typeof item!=='object')return;
      const nested=Array.isArray(item.evidence)?item.evidence:[item.evidence].filter(Boolean);
      if(nested.length){nested.forEach(x=>add(x,prefer));return;}
      const output=typeof item.output==='string'?item.output:'';
      if(!output)return;
      const command=String(item.command||item.operation||'');const target=String(item.target||item.hostname||'');const name=String(item.name||'');
      const inventory=command.toLowerCase()==='inventory'||name.toLowerCase()==='inventory';
      const key=`${command}\u0000${target}\u0000${String(item.status||'')}\u0000${output}`;
      const outputTruncated=output.length>MAX_RAW_OUTPUT;const next={...item,command:command||name,target,output:output.slice(0,MAX_RAW_OUTPUT),outputTruncated:outputTruncated||item.outputTruncated===true,inventory};const old=byKey.get(key);
      if(!old||prefer||next.output.length>old.output.length)byKey.set(key,next);
    };
    (events||[]).forEach(e=>add(e,false));(evidence||[]).forEach(e=>add(e,true));return [...byKey.values()].filter(item=>!item.inventory);
  }
  function inventoryEvidenceItems(events=[],evidence=[]){
    const out=[];const add=item=>{if(!item||typeof item!=='object')return;const nested=Array.isArray(item.evidence)?item.evidence:[item.evidence].filter(Boolean);if(nested.length){nested.forEach(add);return;}const command=String(item.command||item.operation||item.name||'');if(command.toLowerCase()==='inventory')out.push(item);};
    (events||[]).forEach(add);(evidence||[]).forEach(add);return out;
  }
  function rawTextForMessage(m){
    const raw=evidenceItems(m?.events,m?.evidence);if(!raw.length)return String(m?.text||'');let text=String(m?.text||'');
    for(const item of raw){const wanted=item.output;text=text.replace(/```[^\n]*\n([\s\S]*?)\n```/g,(whole,body)=>body.replace(/\r\n/g,'\n').replace(/^\n+|\n+$/g,'')===wanted.replace(/\r\n/g,'\n').replace(/^\n+|\n+$/g,'')?'':whole);}return text;
  }
  function copyOutputButton(output){
    const copy=navButton('Copy output','copy',async()=>{try{await navigator.clipboard.writeText(output);copy.title='Copied';copy.setAttribute('aria-label','Copied');copy.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';setTimeout(()=>{if(copy.isConnected){copy.innerHTML=navIcon('copy');copy.title='Copy output';copy.setAttribute('aria-label','Copy output');}},1600);}catch{copy.title='Copy failed. Select the terminal text to copy it.';copy.setAttribute('aria-label','Copy failed');}});copy.classList.add('message-copy','cli-copy');return copy;
  }
  function appendRawTerminals(parent,items,live=false){
    if(!items?.length)return;const wrap=document.createElement('div');wrap.className=live?'live-run-terminals':'run-terminals';
    items.forEach(item=>{const terminal=live?document.createElement('section'):document.createElement('details');terminal.className='cli-terminal';terminal.dataset.status=String(item.status||'UNKNOWN');if(!live){const summary=document.createElement('summary');summary.textContent=[item.command||item.operation||'Raw CLI output',item.target||item.hostname,item.status&&item.status!=='SUCCESS'?item.status:''].filter(Boolean).join(' · ');terminal.append(summary);}const header=document.createElement('div');header.className='cli-terminal-header';const title=document.createElement('strong');title.textContent='Raw CLI output';const status=document.createElement('span');status.className='cli-terminal-status';status.textContent=String(item.status||'UNKNOWN');header.append(title);if(item.status!=='SUCCESS')header.append(status);header.append(copyOutputButton(item.output));terminal.append(header);const meta=document.createElement('div');meta.className='cli-terminal-meta';meta.textContent=[item.command||item.operation,item.target||item.hostname,item.source].filter(Boolean).join(' · ');if(meta.textContent)terminal.append(meta);const pre=document.createElement('pre');pre.className='cli-output scroll-surface';pre.tabIndex=0;pre.textContent=item.output;terminal.append(pre);if(item.outputTruncated===true){const notice=document.createElement('small');notice.className='cli-truncation-note';notice.textContent='Output truncated at the 512 KiB display limit.';terminal.append(notice);}wrap.append(terminal);});parent.append(wrap);
  }
  let evidenceController=null,fileController=null,evidenceGeneration=0;
  function hasUnsavedPaneChanges(){return !!(activeDoc||profileDraft||document.querySelector('.aven-evidence-note')?.value.trim()||fileController?.hasUnsavedChanges());}
  function appendEvidenceAnnotation(chatId,messageId,note){
    const c=data.chats.find(x=>x.id===chatId),m=c?.messages.find(x=>x.id===messageId);
    if(!m||c.archived||note.messageId!==messageId||!Number.isInteger(note.evidenceIndex))return false;
    const r=AvenEvidenceTools.getEvidenceRecords(m)[note.evidenceIndex];
    if(!r||!r.hasOutput||r.runId!==note.runId||r.sourceId!==note.sourceId||r.command!==note.command||r.target!==note.target||!/^[a-f0-9]{64}$/.test(note.outputHash)||typeof note.text!=='string'||!note.text.trim()||note.text.length>4000||!/^[a-f0-9-]{36}$/.test(note.id))return false;
    const notes=m.annotations===undefined?[]:m.annotations;
    if(!Array.isArray(notes)||notes.length>=100||notes.some(n=>n.id===note.id))return false;
    const before=structuredClone(m);m.annotations=[...notes,structuredClone(note)];
    if(!saveData()){Object.keys(m).forEach(k=>delete m[k]);Object.assign(m,before);return false;}return true;
  }
  function openEvidencePane(kind,c,m){
    if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;
    resetToolContext();if(byId('right-pane').hidden)paneOpener=document.activeElement;
    paneView=kind;byId('right-pane').hidden=false;syncPaneModal();
    byId('pane-title').textContent=kind==='annotate'?'Annotate evidence':'Compare diagnostic runs';
    all('[data-pane]').forEach(b=>b.setAttribute('aria-selected','false'));
    const generation=evidenceGeneration;evidenceController=AvenEvidenceTools.render(kind,byId('pane-content'),{getChats:()=>data.chats,chatId:c.id,messageId:m.id,onAppendAnnotation:(...args)=>generation===evidenceGeneration&&appendEvidenceAnnotation(...args)});
  }
  function messageActionMenu(opener,c,m,react){
    closeNavMenu(false);closeContextMenu(false);closePopovers();
    const menu=document.createElement('div');menu.id='nav-menu';menu.className='nav-menu message-action-menu';menu.setAttribute('role','menu');menu._opener=opener;
    const emojiRow=document.createElement('div');emojiRow.className='message-emoji-row';emojiRow.setAttribute('role','group');emojiRow.setAttribute('aria-label','React to message');
    const current=ALL_REACTIONS.includes(m.localReaction)?m.localReaction:(Array.isArray(m.reactions)?m.reactions.find(value=>ALL_REACTIONS.includes(value)):'');
    const addReactionButton=(parent,emoji)=>{const b=document.createElement('button');b.type='button';b.className='message-emoji-button';b.textContent=emoji;b.dataset.reaction=emoji;b.dataset.reactionName=reactionName(emoji);const accessibleName=MORE_REACTIONS.includes(emoji)?reactionName(emoji):emoji;b.setAttribute('aria-label',(current===emoji?'Remove ':'React with ')+accessibleName);b.title=reactionName(emoji);b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(current===emoji));b.disabled=!!c.archived;b.onclick=()=>{closeNavMenu(false);react(emoji);};parent.append(b);return b;};
    LOCAL_REACTIONS.forEach(emoji=>addReactionButton(emojiRow,emoji));
    const more=document.createElement('button');more.type='button';more.className='message-emoji-button message-more-button';more.setAttribute('aria-label','More reactions');more.title='More reactions';more.setAttribute('role','menuitem');more.setAttribute('aria-haspopup','true');more.setAttribute('aria-expanded','false');more.innerHTML=navIcon('reactionMore');emojiRow.append(more);
    const picker=document.createElement('div');picker.className='message-more-picker';picker.setAttribute('role','group');picker.setAttribute('aria-label','More reactions');picker.hidden=true;
    const reactionSearch=document.createElement('input');reactionSearch.type='search';reactionSearch.className='message-reaction-search';reactionSearch.setAttribute('aria-label','Search more reactions');reactionSearch.placeholder='Search reactions';reactionSearch.autocomplete='off';reactionSearch.spellcheck=false;
    const noResults=document.createElement('div');noResults.className='message-reaction-empty';noResults.setAttribute('role','status');noResults.textContent='No matching reactions';noResults.hidden=true;
    const moreButtons=MORE_REACTIONS.map(emoji=>addReactionButton(picker,emoji));
    const renderMoreReactions=()=>{const query=reactionSearch.value.trim().toLocaleLowerCase();let count=0;moreButtons.forEach(button=>{const match=!query||reactionSearchText(button.dataset.reaction).includes(query);button.hidden=!match;button.setAttribute('aria-hidden',String(!match));if(match)count+=1;});noResults.hidden=count>0;};
    picker.prepend(reactionSearch);picker.append(noResults);
    const place=()=>{const r=opener.getBoundingClientRect();const x=r.right-menu.offsetWidth,y=r.bottom+5;menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';};
    const closePicker=(restoreFocus=true)=>{if(picker.hidden)return false;picker.hidden=true;more.setAttribute('aria-expanded','false');reactionSearch.value='';renderMoreReactions();if(restoreFocus)more.focus();place();return true;};
    more.onclick=()=>{const open=picker.hidden;picker.hidden=!open;more.setAttribute('aria-expanded',String(open));if(open){reactionSearch.value='';renderMoreReactions();reactionSearch.focus();}else{reactionSearch.value='';renderMoreReactions();more.focus();}place();};
    reactionSearch.addEventListener('input',()=>{renderMoreReactions();place();});
    menu.append(emojiRow,picker,document.createElement('hr'));
    const actions=[{label:'Reply',icon:'restore',disabled:!!c.archived,run:()=>startReply(c,m)},...(m.role==='user'?[{label:'Edit and resend',icon:'edit',disabled:!!c.archived||chatRequests.size>0||chatBusy(c),reason:'Finish active and queued work first.',run:()=>editAndResend(c,m)}]:[]),{label:'Revert to this message',icon:'restore',disabled:!!c.archived||chatBusy(c)||c.messages.indexOf(m)===c.messages.length-1,reason:'Finish the run and clear queued messages first. There must be later messages to revert.',run:()=>revertMessage(c,m)},{label:'Fork from this message',icon:'copy',run:()=>forkConversation(c,m)},{label:'Copy link to message',icon:'copy',run:async()=>{try{const url=new URL(location.href);url.hash=new URLSearchParams({chat:c.id,message:m.id}).toString();await navigator.clipboard.writeText(url.href);toast('Local message link copied. It opens in this browser workspace.');}catch{toast('Could not copy the link.');}}},{label:'Copy message',icon:'copy',run:async()=>{try{const raw=evidenceItems(m.events,m.evidence);await navigator.clipboard.writeText(raw.length?raw.map(e=>e.output).join('\n\n'):String(m.text||''));}catch{toast('Could not access the clipboard.');}}}];
    if(m.role==='assistant')actions.push({label:'Annotate evidence',icon:'edit',disabled:!!c.archived,run:()=>openEvidencePane('annotate',c,m)},{label:'Compare diagnostic runs',icon:'search',run:()=>openEvidencePane('compare',c,m)});
    actions.forEach(item=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.innerHTML=navIcon(item.icon||'more');const label=document.createElement('span');label.textContent=item.label;b.append(label);b.disabled=!!item.disabled;if(item.reason)b.title=item.reason;b.onclick=()=>{closeNavMenu(false);item.run();};menu.append(b);});
    document.body.append(menu);place();
    const visible=selector=>[...menu.querySelectorAll(selector)].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);
    const pickerChoices=()=>visible('.message-more-picker button');
    const focusPickerChoice=key=>{const choices=pickerChoices();if(!choices.length)return false;const currentIndex=choices.indexOf(document.activeElement);let index=currentIndex<0?(key==='ArrowUp'||key==='ArrowLeft'?choices.length-1:0):currentIndex;if(key==='Home')index=0;else if(key==='End')index=choices.length-1;else if(key==='ArrowDown'||key==='ArrowRight')index=(index+1)%choices.length;else if(key==='ArrowUp'||key==='ArrowLeft')index=(index-1+choices.length)%choices.length;choices[index]?.focus();return true;};
    const keys=e=>{const pickerOpen=!picker.hidden,withinPicker=pickerOpen&&(picker.contains(document.activeElement)||document.activeElement===more);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(withinPicker)closePicker();else closeNavMenu();}else if(withinPicker&&['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){if(focusPickerChoice(e.key)){e.preventDefault();e.stopPropagation();}}else{const buttons=visible('button'),rowButtons=visible('.message-emoji-row button');if(['ArrowRight','ArrowLeft'].includes(e.key)&&rowButtons.length){e.preventDefault();const i=rowButtons.indexOf(document.activeElement);rowButtons[i<0?0:(i+(e.key==='ArrowRight'?1:-1)+rowButtons.length)%rowButtons.length]?.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(['ArrowUp'].includes(e.key)?-1:1)+buttons.length)%buttons.length]?.focus();}else if(e.key==='Tab')closeNavMenu(false);}};
    const outside=e=>{if(!menu.contains(e.target)&&!opener.contains(e.target))closeNavMenu(false);};document.addEventListener('keydown',keys,true);document.addEventListener('pointerdown',outside,true);navMenuCleanup=()=>{document.removeEventListener('keydown',keys,true);document.removeEventListener('pointerdown',outside,true);};menu.querySelector('button:not(:disabled)')?.focus();
  }
  function messageActions(row,footer,m){
    const c=currentChat();if(!c?.messages.includes(m))return;
    if(!m.id){m.id=uid();saveData();}row.dataset.messageId=m.id;
    const react=emoji=>{if(c.archived||!ALL_REACTIONS.includes(emoji))return;if(navCommit(()=>{const current=ALL_REACTIONS.includes(m.localReaction)?m.localReaction:(Array.isArray(m.reactions)?m.reactions.find(value=>ALL_REACTIONS.includes(value)):'' );const next=current===emoji?'':emoji;m.localReaction=next||null;m.reactions=next?[next]:[];})){renderConversation();requestAnimationFrame(()=>one(`[data-message-id="${CSS.escape(m.id)}"] [aria-label="Message actions"]`)?.focus());}};
    const more=navButton('Message actions','more',b=>messageActionMenu(b,c,m,react));footer.append(more);row.oncontextmenu=e=>{if(getSelection()?.toString())return;e.preventDefault();more.click();};
    const reaction=ALL_REACTIONS.includes(m.localReaction)?m.localReaction:(Array.isArray(m.reactions)?m.reactions.find(value=>ALL_REACTIONS.includes(value)):'');
    if(reaction){const reactions=document.createElement('div');reactions.className='message-reactions';const b=document.createElement('button');b.type='button';b.textContent=reaction;b.setAttribute('aria-label','Remove '+reaction+' reaction');b.setAttribute('aria-pressed','true');b.disabled=!!c.archived;b.onclick=()=>react(reaction);reactions.append(b);row.append(reactions);}
  }
  function openMessageContext(chatId,messageId){
    if(!showChat(chatId))return false;
    requestAnimationFrame(()=>{
      if(currentView!=='conversation'||currentChat()?.id!==chatId)return;
      const target=one('[data-message-id="'+CSS.escape(String(messageId))+'"]');
      if(!target){toast('This message is no longer in the saved conversation.');return;}
      followingLatest=false;target.tabIndex=-1;target.scrollIntoView({block:'center',behavior:'auto'});target.focus({preventScroll:true});updateLatestControl();
    });
    return true;
  }
  function forkConversation(c,m){
    if(activeDoc||profileDraft){toast('Save or close the profile editor first.');return;}
    navDialog('Fork conversation',[{id:'fork-name',label:'Conversation name',value:(c.title+' · fork').slice(0,80),maxLength:80}],'Create fork',(status,dialog)=>{
      const name=byId('fork-name').value.trim(),index=c.messages.findIndex(item=>item.id===m.id);
      if(!name||index<0){status.textContent='Enter a name and choose a saved message.';return;}
      const fork={id:uid(),title:name,autoTitle:false,projectId:c.projectId,channelId:c.channelId,recipients:clone(c.recipients),sample:false,draft:'',messages:clone(c.messages.slice(0,index+1)),pendingQueue:[],pendingAttachmentNames:[],forkedFrom:{chatId:c.id,messageId:m.id,title:c.title,createdAt:now()}};
      data.chats.unshift(fork);
      if(!saveData()){data.chats.shift();status.textContent='Could not save the fork. The original conversation is unchanged.';return;}
      dialog.close();showChat(fork.id);byId('draft').focus();
    });
    const note=document.createElement('p');note.className='form-help';note.textContent='Copy the saved conversation through this message into a separate conversation. Original evidence is retained. Drafts, queued work and active runs stay in the original. Creating a fork does not send a message or run commands.';one('form',byId('create-dialog-body')).prepend(note);
  }
  function renderForkOrigin(c,box){
    if(!c.forkedFrom)return;const note=document.createElement('div');note.className='fork-origin';
    const button=document.createElement('button');button.type='button';button.textContent='Forked from '+c.forkedFrom.title;
    button.onclick=()=>{if(!data.chats.some(chat=>chat.id===c.forkedFrom.chatId)){toast('The original conversation is not available in this browser.');return;}openMessageContext(c.forkedFrom.chatId,c.forkedFrom.messageId);};note.append(button);box.append(note);
  }
  function editAndResend(c,m){
    if(c.archived||m.role!=='user'||chatRequests.size||chatBusy(c))return;
    navDialog('Edit and resend',[{id:'edit-message-text',label:'Message',value:m.text,multiline:true,maxLength:32000}],'Resend',(status,dialog)=>{
      if(c.archived||chatRequests.size||chatBusy(c)){status.textContent='Finish active and queued work first.';return;}
      const text=byId('edit-message-text').value.trim(),index=c.messages.findIndex(item=>item.id===m.id);
      if(index<0){status.textContent='This message is no longer in the conversation.';return;}
      if(!text||contextMessage({...m,text}).length>32000){status.textContent='Enter a message within 32,000 characters including its quote.';return;}
      const previous={messages:c.messages,rewindHistory:c.rewindHistory,replyError:c.replyError};
      const kept=c.messages.slice(0,index+1);kept[index]={...m,text,editedAt:now()};delete kept[index].submission;
      c.rewindHistory=[...(c.rewindHistory||[]),{id:uid(),kind:'edit',createdAt:now(),messages:clone(c.messages),draft:c.draft||'',retainedIds:kept.map(item=>item.id),replyError:c.replyError||''}];c.messages=kept;c.replyError='';
      if(!saveData()){Object.assign(c,previous);status.textContent='Could not save the edit. Original history and draft are unchanged.';return;}
      dialog.close();renderConversation();renderComposer();renderSidebar();requestChatReply(c);
    });
    const note=document.createElement('p');note.className='form-help';note.textContent='Resend replaces this prompt and removes later messages from the new request. Original history is saved for recovery. Commands already executed are unchanged. Your unsent composer draft is kept.';
    one('form',byId('create-dialog-body'))?.prepend(note);
  }
  function openOriginalHistory(c,snapshot){
    const existing=data.chats.find(chat=>chat.id===snapshot.recoveryChatId);if(existing){showChat(existing.id);return;}
    const recovered={id:uid(),title:c.title+' · original history',projectId:c.projectId,channelId:c.channelId,recipients:clone(c.recipients),sample:false,draft:snapshot.draft||'',messages:clone(snapshot.messages),pendingQueue:[],recoveredFrom:c.id};
    data.chats.unshift(recovered);snapshot.recoveryChatId=recovered.id;
    if(!saveData()){data.chats.shift();delete snapshot.recoveryChatId;toast('Could not save the history copy. Original evidence is still retained.');return;}
    showChat(recovered.id);
  }
  function revertMessage(c,m){
    if(chatBusy(c)||c.archived)return;const index=c.messages.indexOf(m);if(index<0||index>=c.messages.length-1)return;
    navDialog('Revert conversation',[],'Revert',(status,dialog)=>{
      if(chatBusy(c)||c.archived){status.textContent='Finish the run and clear queued messages first.';return;}
      const at=c.messages.findIndex(x=>x.id===m.id);if(at<0)return;
      if(navCommit(()=>{c.rewindHistory=Array.isArray(c.rewindHistory)?c.rewindHistory:[];c.rewindHistory.push({id:uid(),createdAt:now(),messages:clone(c.messages),retainedIds:c.messages.slice(0,at+1).map(x=>x.id),replyError:c.replyError||''});c.messages=c.messages.slice(0,at+1);c.replyError='';})){
        chatErrors.delete(c.id);dialog.close();renderConversation();renderComposer();
      }
    });
    const p=document.createElement('p');p.className='revert-explanation';p.textContent='Keep this message and everything before it as the conversation context. Later messages are saved for undo. Commands already executed on network devices are not undone. Nothing will run automatically.';one('form',byId('create-dialog-body')).prepend(p);
  }
  function renderRewindNotice(c,box){
    const last=c.rewindHistory?.at(-1);if(!last||last.restoredAt)return;
    const same=JSON.stringify(c.messages.map(x=>x.id))===JSON.stringify(last.retainedIds);
    const note=document.createElement('div');note.className='rewind-notice';const text=document.createElement('span');text.textContent=same?(last.kind==='edit'?'Prompt edited. Original history is saved.':'Conversation reverted. Executed actions are unchanged.'):'Earlier messages are retained in local history.';note.append(text);
    if(same){const undo=document.createElement('button');undo.type='button';undo.textContent=last.kind==='edit'?'Undo edit':'Undo revert';undo.disabled=chatBusy(c)||!!c.archived;undo.onclick=()=>{if(chatBusy(c)||c.archived)return;if(navCommit(()=>{c.messages=clone(last.messages);c.replyError=last.replyError;last.restoredAt=now();})){renderConversation();renderComposer();}};note.append(undo);}else{const restore=document.createElement('button');restore.type='button';restore.textContent='Open original history';restore.onclick=()=>openOriginalHistory(c,last);note.append(restore);}box.append(note);
  }
  function appendMessage(m){
    const row=document.createElement('article');row.className=`message ${m.role==='assistant'?'assistant':'user'}`;
    const label=document.createElement('span');label.className='message-label';label.textContent=m.role==='assistant'?agentById(m.agentId||'companion').name:(m.recipientNames?.length?`To ${m.recipientNames.join(', ')}`:'You');row.append(label);if(m.welcome){const local=document.createElement('span');local.className='local-welcome-label';local.textContent='Local welcome · not a model response';row.append(local);}appendReplyQuote(row,m);
    if(m.question)row.append(renderQuestion(m));
    const raw=m.role==='assistant'?evidenceItems(m.events,m.evidence):[];
    const body=document.createElement('div');body.className='message-body';
    if(raw.length){
      row.classList.add('has-cli');
      const explanation=rawTextForMessage(m).trim();
      if(explanation)renderMessageText(body,explanation);
      else {const summary=document.createElement('p');summary.className='operation-summary';summary.textContent=raw.map(item=>[item.command||item.operation||'Command',item.target||item.hostname,item.status||'UNKNOWN'].filter(Boolean).join(' · ')).join('; ');body.append(summary);}
      if(prefs.showEvidence)appendRawTerminals(body,raw);
      const failures=raw.filter(e=>e.status&&e.status!=='SUCCESS');if(failures.length||m.status==='FAILURE'){const notice=document.createElement('p');notice.className='operation-notice';const labels=failures.map(e=>[e.command,e.target,e.status].filter(Boolean).join(' · ')).filter(Boolean);notice.textContent=(labels.length?labels.join('; ')+' · ':'')+'Run failed. Review captured evidence; no automatic retry.';body.append(notice);}
    }else if(m.role==='assistant')renderMessageText(body,m.text||'');else body.textContent=m.text||(m.attachments?.length?'Attachment':'');row.append(body);
    (m.attachments||[]).forEach(name=>{const at=document.createElement('span');at.className='attachment-in-message';at.textContent=name;row.append(at);});
    if(m.status==='UNKNOWN'){const warning=document.createElement('p');warning.className='operation-notice';warning.textContent='Remote completion is unknown. Review captured evidence; no request was retried.';row.append(warning);}appendRunEvidence(row,m.events,m.evidence,false);if((m.runId||m.journalId)&&prefs.showRunDetails){const provenance=document.createElement('details');provenance.className='run-provenance';const summary=document.createElement('summary');summary.textContent='Run details · '+(m.status||'Status unavailable');const info=document.createElement('p');info.textContent='Mode: '+(m.mode||'Unavailable')+' · Model: '+(m.model||'Unavailable')+' · Run: '+(m.runId||'Not assigned')+' · Usage: '+(m.usage?JSON.stringify(m.usage):'Unavailable')+'. Execution status does not establish device health.';if(m.requestedSelection){const requested=m.requestedSelection,effective=m.provenance?.effective;info.textContent+=' Requested: '+requested.providerId+' / '+requested.modelId+' / '+requested.effort+'. Reported: '+(effective?.providerId||'provider unavailable')+' / '+(effective?.modelId||'model unavailable')+' / '+(effective?.effort||'effort unavailable')+'.';}provenance.append(summary,info);row.append(provenance);}
    const footer=document.createElement('div');footer.className='message-meta';
    const date=new Date(m.createdAt);if(m.createdAt&&Number.isFinite(date.getTime())){const time=document.createElement('time');time.dateTime=date.toISOString();time.textContent=date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});time.title=date.toLocaleString();time.tabIndex=0;time.setAttribute('aria-label',date.toLocaleString());footer.append(time);}
    if(m.role==='assistant'&&Number.isFinite(m.durationMs)){const duration=document.createElement('span');duration.className='message-duration';duration.textContent='Took '+durationLabel(m.durationMs);duration.title='Elapsed time from sending the request to receiving the reply';footer.append(duration);}
    const copy=document.createElement('button');copy.type='button';copy.className='message-copy';copy.setAttribute('aria-label',m.role==='assistant'?'Copy answer':'Copy question');copy.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy</span>';
    copy.onclick=async()=>{const text=String(m.text||'');try{await navigator.clipboard.writeText(text);copy.querySelector('span').textContent='Copied';setTimeout(()=>{if(copy.isConnected)copy.querySelector('span').textContent='Copy';},1800);}catch{copy.querySelector('span').textContent='Copy failed';copy.title='Clipboard access was denied. Select the message text to copy it.';}};if(!raw.length)footer.append(copy);row.append(footer);messageActions(row,footer,m);byId('conversation').append(row);
  }
  function renderReceiptReview(c){
    const pending=AvenAdmission.pending(c),view=receiptViews.get(c.id)||{};
    if(!view.note&&c.messages.some(m=>m.question?.phase==='waiting'&&m.requestId===c.pendingAdmission))return;
    const row=document.createElement('article');row.className='message assistant reply-error';row.setAttribute('role','status');
    const note=document.createElement('p');note.textContent=view.note||c.replyError||'A previous request needs review. Check its saved result before sending again. No work will be retried automatically.';row.append(note);
    if(!pending){note.textContent='Saved request identity is unavailable. Keep your workspace backup before continuing.';byId('conversation').append(row);return;}
    const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.className='chat-retry';b.textContent=label;b.disabled=!!view.busy||chatRequests.size>0;b.onclick=action;row.append(b);};
    button('Check saved run',()=>reviewReceipt(c));
    if(view.receipt?.recoverable)button('Recover interrupted run',()=>reviewReceipt(c,true));
    if(view.notFound)button('Retry saved request',()=>requestChatReply(c,pending.submission.body.mode,pending));
    byId('conversation').append(row);
  }
  async function reviewReceipt(c,recover=false){
    const pending=AvenAdmission.pending(c);if(!pending||chatRequests.size)return;
    const previous=receiptViews.get(c.id)||{};receiptViews.set(c.id,{...previous,busy:true});renderConversation();
    try{
      const headers={'X-Aven-Chat':'text-only'},signal=AbortSignal.timeout(10000),query=new URLSearchParams({chatId:c.id,requestId:pending.submission.body.requestId});
      const response=await fetch(recover?CHAT_API+'/recover':CHAT_API+'/receipt?'+query,recover?{method:'POST',signal,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({chatId:c.id,requestId:pending.submission.body.requestId,runId:previous.receipt?.runId})}:{headers,signal});
      const value=await response.json();
      if(response.status===404&&!recover){receiptViews.set(c.id,{notFound:true,note:'No receipt is available for this saved request. Retry only this saved request if you want to submit it; its original identity will be reused.'});return;}
      if(!response.ok)throw Error(value.error||'Saved run is unavailable.');
      const receipt=value.receipt;
      if(receipt.question){const m=c.messages.find(m=>m.requestId===receipt.requestId&&m.role==='assistant');if(m)m.question=receipt.question;}
      if(receipt.state==='admitted'){receiptViews.set(c.id,{receipt,note:receipt.recoverable?'The original run is no longer owned. Recover it as unknown to review the interruption; this does not retry work.':'The local service still owns this request. Check again after it finishes; its saved capture has been left intact.'});return;}
      let record;
      if(receipt.evidenceSaved){const saved=await fetch(CHAT_API+'/runs/'+encodeURIComponent(receipt.runId)+'?chatId='+encodeURIComponent(c.id),{headers,signal});if(!saved.ok)throw Error('The receipt is saved, but its evidence is unavailable. Keep the captured result and check again.');record=await saved.json();}
      await withAdmissionWriter(c.id,()=>{
        const before=clone(c);AvenAdmission.applyReceipt(c,pending.submission,receipt,record);
        receiptSavePermit=receipt.requestId;const reviewSaved=saveData();receiptSavePermit=null;
        if(!reviewSaved){Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,before);throw Error('The saved result could not be stored in this tab. Keep your draft and reload after checking browser storage or other tabs.');}
      });
      chatErrors.delete(c.id);receiptViews.delete(c.id);toast('Saved run reviewed. No request was retried.');
    }catch(error){receiptViews.set(c.id,{...previous,note:error.message});}
    finally{const view=receiptViews.get(c.id);if(view)view.busy=false;renderConversation();renderPendingQueue(c);updateSend();requestAnimationFrame(()=>{const next=one('.reply-error button:not(:disabled)');(next||byId('draft')).focus();});}
  }
  function renderWorking(chat){
    const pending=chatRequests.get(chat.id);if(!pending){if(chat.pendingAdmission){renderReceiptReview(chat);return;}const error=chatErrors.get(chat.id)||chat.replyError;if(error){const row=document.createElement('article');row.className='message assistant reply-error';row.setAttribute('role','alert');const text=document.createElement('p');text.textContent='Reply failed: '+error;row.append(text);const retry=document.createElement('button');retry.type='button';retry.className='chat-retry';retry.textContent='Retry reply';retry.disabled=chatRequests.size>0;retry.onclick=()=>requestChatReply(chat);row.append(retry);byId('conversation').append(row);}return;}
    if(pending.waiting)return;
    const row=document.createElement('article');row.className='message assistant working-message';row.dataset.workingChat=chat.id;
    const text=document.createElement('span');text.textContent=pending.name+' is working…';text.setAttribute('role','status');row.append(text);
    const dots=document.createElement('span');dots.className='working-dots';dots.setAttribute('aria-hidden','true');dots.innerHTML='<i></i><i></i><i></i>';row.append(dots);
    const elapsed=document.createElement('span');elapsed.className='working-elapsed';elapsed.textContent=durationLabel(performance.now()-pending.started);row.append(elapsed);
    const stop=document.createElement('button');stop.type='button';stop.className='message-copy';stop.textContent='Stop';stop.onclick=()=>pending.controller?.abort();row.append(stop);
    const steerState=document.createElement('span');steerState.className='steer-state';steerState.textContent=pending.steeringMessage||'Steering applies at the next step.';row.append(steerState);
    if(prefs.showInvestigation){const activity=document.createElement('div');activity.className='run-activity';activity.setAttribute('role','status');row.append(activity);}const liveNotice=document.createElement('p');liveNotice.className='operation-notice run-live-notice';liveNotice.hidden=true;liveNotice.setAttribute('role','alert');row.append(liveNotice);if(prefs.showEvidence){const terminals=document.createElement('div');terminals.className='live-run-terminals';row.append(terminals);}byId('conversation').append(row);updateRunActivity(chat.id);
  }
  function updateRunActivity(chatId){const pending=chatRequests.get(chatId),row=one(`[data-working-chat="${CSS.escape(String(chatId))}"]`),box=row?.querySelector('.run-activity');if(!pending||!row||currentChat()?.id!==chatId)return;if(box){box.hidden=!prefs.showInvestigation;box.replaceChildren();if(prefs.showInvestigation)for(const e of (pending.events||[]).filter(e=>e.type.startsWith('tool_')||e.type.startsWith('steer_')).slice(-8)){const line=document.createElement('div');line.textContent=[e.type.replaceAll('_',' '),e.tool||e.name,e.target||e.hostname,e.command||e.operation,e.status,e.message].filter(Boolean).join(' · ');box.append(line);}}const steer=row.querySelector('.steer-state');if(steer)steer.textContent=pending.steeringMessage||'Steering applies at the next step.';const failedStatuses=new Set(['FAILURE','ERROR','FAILED','UNKNOWN','TIMEOUT','CANCELLED']);const failedEvents=(pending.events||[]).filter(e=>failedStatuses.has(String(e.status||'').toUpperCase())||['error','failed','tool_error'].includes(String(e.type||'').toLowerCase()));const liveNotice=row.querySelector('.run-live-notice');if(liveNotice){liveNotice.hidden=!pending.captureError&&!failedEvents.length;if(!liveNotice.hidden){const labels=failedEvents.map(e=>[e.command||e.operation,e.target||e.hostname,e.status||e.type,e.message].filter(Boolean).join(' · '));liveNotice.textContent=(pending.captureError||labels.join('; ')||'Run reported an error.')+' Automatic retry is disabled.';}}const terminals=row.querySelector('.live-run-terminals');if(terminals){terminals.hidden=!prefs.showEvidence;terminals.replaceChildren();if(prefs.showEvidence)appendRawTerminals(terminals,evidenceItems(pending.events,[]),true);}}
  function appendRunEvidence(parent,events=[],evidence=[],includeRaw=true){
    if(!events?.length&&!evidence?.length)return;
    const activity=(events||[]).filter(e=>e.type!=='final').slice(0,100),inventory=inventoryEvidenceItems(events,evidence),records=(evidence||[]).filter(e=>typeof e==='object');
    if(prefs.showInvestigation&&activity.length){
      const panel=document.createElement('details');panel.className='run-evidence run-investigation';const heading=document.createElement('summary');heading.textContent='Investigation activity';panel.append(heading);
      for(const e of activity){const line=document.createElement('p');line.textContent=[e.type,e.tool||e.name,e.target||e.hostname,e.command||e.operation,e.status,e.message].filter(Boolean).join(' · ');panel.append(line);}parent.append(panel);
    }
    if(prefs.showEvidence&&(inventory.length||records.length)){
      const panel=document.createElement('details');panel.className='run-evidence run-evidence-summary';const heading=document.createElement('summary');heading.textContent='Evidence';panel.append(heading);
      for(const e of inventory){const title=document.createElement('p');title.textContent=[e.target||e.hostname,e.command||e.operation,e.status].filter(Boolean).join(' · ');panel.append(title);const code=document.createElement('pre');code.textContent='Inventory observation retained with this run.';panel.append(code);}
      for(const e of records){const command=String(e.command||e.operation||e.name||'').toLowerCase();if(command!=='inventory'&&typeof e.output==='string'&&e.output){const title=document.createElement('p');title.textContent=[e.target||e.hostname,e.command||e.operation,e.status,'output in terminal'].filter(Boolean).join(' · ');panel.append(title);}}
      parent.append(panel);
    }
    if(includeRaw&&prefs.showEvidence)appendRawTerminals(parent,evidenceItems(events,evidence));
  }
  const LATEST_THRESHOLD=120;
  let followingLatest=true;
  function updateLatestControl(){
    const scroll=byId('center-content');
    followingLatest=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<=LATEST_THRESHOLD;
    byId('jump-latest').hidden=currentView!=='conversation'||followingLatest;
  }
  function jumpToLatest(){
    followingLatest=true;const scroll=byId('center-content');scroll.scrollTop=scroll.scrollHeight;byId('jump-latest').hidden=true;
  }
  function wireLatestControl(){
    const scroll=byId('center-content');scroll.addEventListener('scroll',updateLatestControl,{passive:true});
    byId('jump-latest').onclick=()=>{jumpToLatest();const target=byId('composer-wrap').hidden?byId('conversation'):byId('draft');target.tabIndex=target===byId('conversation')?-1:target.tabIndex;target.focus({preventScroll:true});};
    new MutationObserver(()=>{const follow=followingLatest;requestAnimationFrame(()=>{if(currentView!=='conversation')return;if(follow&&followingLatest)jumpToLatest();else updateLatestControl();});}).observe(byId('conversation'),{childList:true,subtree:true,characterData:true});
    new ResizeObserver(()=>{if(currentView==='conversation'){if(followingLatest)jumpToLatest();else updateLatestControl();}}).observe(scroll);
  }
  function localDay(date){return date.getFullYear()+'-'+date.getMonth()+'-'+date.getDate();}
  function appendDateSeparator(m,previous,box){
    const date=new Date(m.createdAt);if(!m.createdAt||!Number.isFinite(date.getTime()))return previous;
    const key=localDay(date);if(key===previous)return key;
    const today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);
    const separator=document.createElement('div');separator.className='message-date';separator.setAttribute('role','separator');
    const label=key===localDay(today)?'Today':key===localDay(yesterday)?'Yesterday':date.toLocaleDateString([],{year:'numeric',month:'long',day:'numeric'});
    separator.textContent=label;separator.setAttribute('aria-label',label);box.append(separator);return key;
  }
  const questionDisclosures=new Map();
  function renderConversation(){const c=currentChat(),box=byId('conversation'),scroll=byId('center-content'),top=scroll.scrollTop,follow=followingLatest;box.querySelectorAll('.clarification-card details').forEach(details=>questionDisclosures.set(details.closest('.clarification-card').dataset.questionId,details.open));box.replaceChildren();renderForkOrigin(c,box);if(c.sample){const marker=document.createElement('div');marker.className='sample-label';marker.textContent='Sample conversation';box.append(marker);appendMessage({role:'user',text:'We have intermittent packet loss at the branch network. Help me investigate the likely path.'});appendMessage({role:'assistant',agentId:'companion',text:'Let’s keep this investigation scoped. Start with the branch edge, then compare the uplink and the first shared hop. I can show the proposed checks here before anything could run.'});const card=document.createElement('section');card.className='tool-card';card.innerHTML='<div class="tool-card-header"><span>Workspace tools</span><span>Inspect before use</span></div>';[['browser','Inspect a browser result','browser'],['plugins','Read Cisco inventory','plug'],['computer','Inspect a sample desktop','computer']].forEach(([v,t,g])=>{const b=document.createElement('button');b.type='button';b.className='tool-request';b.dataset.toolRequest=v;b.innerHTML=`${icon(g)}<span><strong>${t}</strong><small>${v === 'plugins' ? 'Read live Cisco sandbox inventory' : 'Review this local capability preview'}</small></span>${icon('chevron')}`;b.addEventListener('click',()=>openPane(v));card.append(b);});box.append(card);}let day=null;c.messages.forEach(m=>{day=appendDateSeparator(m,day,box);appendMessage(m);});renderRewindNotice(c,box);renderWorking(c);if(!c.sample&&!c.messages.length)box.innerHTML=`<div class="empty-state"><div class="empty-icon">${icon('chat')}</div><h2>Start this conversation</h2><p>Send a message to your coworker using OpenCode · MiMo V2.5.</p></div>`;scroll.scrollTop=follow?scroll.scrollHeight:top;updateLatestControl();refreshConversationFind();}
  const attachmentJobs=new Map();
  function renderAttachments(){
    const row=byId('attachments'),c=currentChat();row.replaceChildren();if(!c)return;const items=sessionAttachments.get(c.id)||[];
    for(const item of items){const chip=document.createElement('span');chip.className='attachment-chip';const name=document.createElement('span');name.textContent=item.name+(item.status==='error'?' · '+item.error:' · ready');const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove attachment '+item.name);remove.onclick=()=>{const previous=sessionAttachments.get(c.id)||[],names=c.pendingAttachmentNames;sessionAttachments.set(c.id,previous.filter(x=>x.id!==item.id));c.pendingAttachmentNames=(sessionAttachments.get(c.id)||[]).map(x=>x.name);if(!saveData()){sessionAttachments.set(c.id,previous);c.pendingAttachmentNames=names;c.attachmentWarning='Removal could not be saved. The previous selection is retained.';}else delete c.attachmentWarning;renderAttachments();updateSend();};chip.append(name,remove);row.append(chip);}
    const notice=document.createElement('span');notice.className='attachment-notice';
    if(attachmentJobs.has(c.id))notice.textContent='Reading selected files locally…';
    else if(items.length)notice.textContent='Send includes these text contents in the model request and saved conversation/export. Up to 5 UTF-8 text files; 32 KiB each. Files are not uploaded in the background.';
    else if(c.pendingAttachmentNames?.length){notice.textContent='Reattach files from the previous session: '+c.pendingAttachmentNames.join(', ')+'. Contents were not saved.';const clear=document.createElement('button');clear.type='button';clear.textContent='Clear old attachments';clear.onclick=()=>{const names=c.pendingAttachmentNames;c.pendingAttachmentNames=[];if(!saveData()){c.pendingAttachmentNames=names;c.attachmentWarning='Could not clear the saved filenames. Try again after freeing browser storage.';}else delete c.attachmentWarning;renderAttachments();updateSend();};row.append(clear);}
    if(c.attachmentWarning)notice.textContent=c.attachmentWarning+' '+notice.textContent;if(notice.textContent)row.append(notice);
  }
  function queueMessage(c,text,{pause=false,reason='',replyTo=null,clearComposer=false}={}){
    const value=String(text||'').trim();if(!value)return false;
    if(value.length>MAX_QUEUE_TEXT){toast(`Queued messages must be ${MAX_QUEUE_TEXT.toLocaleString()} characters or fewer.`);return false;}
    c.pendingQueue=Array.isArray(c.pendingQueue)?c.pendingQueue:[];const active=chatRequests.get(c.id);const steeringSlot=active&&!pause&&active.steeringText&&!active.steeringConverted&&['sending','received','accepted','pending'].includes(active.steeringStatus);const capacity=MAX_QUEUE_ITEMS-(steeringSlot?1:0);
    if(c.pendingQueue.length>=capacity){toast(steeringSlot?'Queue is holding one slot for the current steering request.':'Queue is full. Remove a queued message before adding another.');return false;}
    const previousQueueState={paused:c.queuePaused,reason:c.queuePauseReason,draft:c.draft,reply:c.draftReplyTo,names:c.pendingAttachmentNames};if(clearComposer){c.draft='';delete c.draftReplyTo;c.pendingAttachmentNames=[];}c.pendingQueue.push({id:uid(),text:value,mode:modeFor(c.mode),createdAt:now(),replyTo:normalizeReply(replyTo)});
    if(pause){c.queuePaused=true;c.queuePauseReason=reason||'This queued message is waiting for an explicit Resume.';}
    if(!saveData()){c.pendingQueue.pop();c.queuePaused=previousQueueState.paused;c.queuePauseReason=previousQueueState.reason;c.draft=previousQueueState.draft;c.draftReplyTo=previousQueueState.reply;c.pendingAttachmentNames=previousQueueState.names;toast('Could not save the queued message. Your draft is retained.');return false;}renderPendingQueue(c);updateSend();return true;
  }
  function removeQueuedMessage(c,id){c.pendingQueue=(c.pendingQueue||[]).filter(item=>item.id!==id);c.queueEditing=false;if(!c.pendingQueue.length){c.queuePaused=false;c.queuePauseReason='';}saveData();renderPendingQueue(c);updateSend();}
  function renderPendingQueue(c){
    const panel=byId('pending-queue');if(!panel||!c||currentChat()?.id!==c.id)return;if(c.queueEditing&&panel.dataset.queueChat===c.id)return;const items=Array.isArray(c.pendingQueue)?c.pendingQueue:[];panel.dataset.queueChat=c.id;panel.hidden=!items.length;if(!items.length)return;
    byId('queue-count').textContent=`${items.length}/${MAX_QUEUE_ITEMS}`;byId('queue-title').textContent=c.queuePaused?'Queue paused':'Queued messages';
    const note=byId('queue-note');note.textContent=c.queuePaused?(c.queuePauseReason||'Queue paused. Resume to dispatch one message at a time.'):(chatRequests.has(c.id)?'Messages stay separate and dispatch FIFO after this reply.':'Queued messages dispatch one at a time.');
    const list=byId('queue-list');list.replaceChildren();items.forEach((item,index)=>{const li=document.createElement('li');li.className='queue-item';li.dataset.queueId=item.id;const editor=document.createElement('textarea');editor.rows=2;editor.maxLength=MAX_QUEUE_TEXT;editor.readOnly=true;editor.value=item.text;editor.setAttribute('aria-label',`Queued message ${index+1}`);editor.oninput=()=>{if(editor.value.trim()){item.text=editor.value;saveData();}else editor.setAttribute('aria-invalid','true');};editor.onblur=()=>{if(!editor.value.trim())editor.value=item.text;editor.removeAttribute('aria-invalid');};const actions=document.createElement('div');actions.className='queue-item-actions';const edit=document.createElement('button');edit.type='button';edit.className='button-secondary';edit.dataset.queueEdit=item.id;edit.textContent='Edit';edit.onclick=()=>{const editing=!editor.readOnly;editor.readOnly=editing;edit.textContent=editing?'Edit':'Done';c.queueEditing=!editing;if(c.queueEditing){c.queuePaused=true;c.queuePauseReason='Queue paused while a queued message is being edited.';saveData();}if(!editing){editor.focus();editor.select();}else{saveData();renderPendingQueue(c);}};const remove=document.createElement('button');remove.type='button';remove.className='button-secondary queue-remove';remove.dataset.queueRemove=item.id;remove.textContent='Remove';remove.onclick=()=>removeQueuedMessage(c,item.id);actions.append(edit,remove);li.append(editor,actions);list.append(li);});
    const resume=byId('resume-queue');resume.hidden=!c.queuePaused;resume.disabled=chatRequests.size>0;resume.onclick=()=>resumeQueue(c);
  }
  function pauseQueue(c,reason){if(!c?.pendingQueue?.length)return;c.queuePaused=true;c.queuePauseReason=reason||'Queue paused. Resume to continue one message at a time.';saveData();if(currentChat()?.id===c.id){renderPendingQueue(c);updateSend();}}
  function resumeQueue(c=currentChat()){
    if(c?.pendingAdmission||savedWaitingChat()){toast('Cancel or answer the waiting request before resuming queued work.');return;}
    if(!c?.pendingQueue?.length){if(c){c.queuePaused=false;c.queuePauseReason='';saveData();}renderPendingQueue(c);updateSend();return;}
    if(chatRequests.size){toast('Another conversation is receiving a reply. Try Resume after it finishes.');return;}
    c.queueEditing=false;c.queuePaused=false;c.queuePauseReason='';dispatchNextQueued(c);renderPendingQueue(c);updateSend();
  }
  function dispatchNextQueued(c){
    if(c?.pendingAdmission){toast('Check the saved run before resuming queued work.');return false;}
    if(!c||c.archived||chatRequests.size||savedWaitingChat()||c.queuePaused||c.queueEditing||!c.pendingQueue?.length)return false;
    const before=clone(c);const item=c.pendingQueue.shift();const text=item.text;c.messages.push({id:uid(),role:'user',text,recipients:c.recipients,recipientNames:selectedAgents(c).map(a=>a.name),createdAt:now(),mode:modeFor(item.mode),queuedFrom:item.id,replyTo:normalizeReply(item.replyTo)});c.queueDispatching=item.id;if(!saveData()){Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,before);c.queuePaused=true;c.queuePauseReason='Could not save queue dispatch. Resume after browser storage is available.';renderPendingQueue(c);toast(c.queuePauseReason);return false;}if(currentChat()?.id===c.id){renderConversation();renderPendingQueue(c);updateSend();}requestChatReply(c,modeFor(item.mode));return true;
  }
  function dispatchAvailableQueue(){
    if(chatRequests.size)return false;const target=data.chats.find(chat=>Array.isArray(chat.pendingQueue)&&chat.pendingQueue.length&&!chat.queuePaused&&!chat.queueEditing);return target?dispatchNextQueued(target):false;
  }
  function renderModelButton(c){
    const button=byId('model-picker');if(!button)return;
    const selection=c.providerSelection;
    button.textContent=selection?'Model: '+selection.modelId:'Model: default';
    button.title=selection?selection.providerId+' · '+selection.modelId+' · '+selection.effort+' (requested)':'Use the local service default; open to view configured models.';
    button.disabled=chatRequests.size>0||!!c.pendingAdmission||!!c.pendingQueue?.length;
    button.onclick=()=>openSettings('models');
  }
  async function renderProviderSettings(container){
    const chat=currentChat();
    const title=document.createElement('h2');title.textContent='Models & providers';
    const note=document.createElement('p');note.textContent='Choose the model for this conversation. Changes apply to new requests; saved retries keep their original selection.';
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Reading local model configuration…';
    const picker=document.createElement('div');picker.className='provider-picker';
    const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh model list';refresh.onclick=()=>renderProviderSettings(container);
    const defaults=document.createElement('button');defaults.type='button';defaults.textContent='Use service default';
    const locked=()=>chatRequests.size>0||!!chat.pendingAdmission||!!chat.pendingQueue?.length;
    function save(selection){
      if(locked()){status.textContent='Finish or cancel the pending run and queued messages before changing models.';return;}
      const previous=chat.providerSelection;
      if(selection)chat.providerSelection=clone(selection);else delete chat.providerSelection;
      if(!saveData()){if(previous)chat.providerSelection=previous;else delete chat.providerSelection;status.textContent='Could not save your selection. The previous setting is retained.';return;}
      renderModelButton(chat);status.textContent=selection?'Saved for this conversation. Connection remains unverified until a request succeeds.':'Service default selected for new requests.';
    }
    defaults.disabled=locked();defaults.onclick=()=>save(null);
    container.replaceChildren(title,note,status,picker,refresh,defaults);
    if(locked()){status.textContent='Finish or cancel the pending run and queued messages before changing models.';return;}
    try{
      const response=await fetch('http://127.0.0.1:8768/api/capabilities',{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('Local model list is unavailable.');
      const snapshot=await response.json();
      if(!Array.isArray(snapshot.providers))throw Error('Update the local service to use model selection.');
      if(!picker.isConnected)return;
      AvenProviderPicker.render(picker,{snapshot,selection:chat.providerSelection||{},onSave:selection=>{const checked=AvenProviderPicker.validateSelection(selection,snapshot);if(!checked.ok){status.textContent=checked.reason;return;}save(checked.selection);}});
      status.textContent='Listed models come from local configuration. This does not check provider reachability.';
    }catch(error){if(status.isConnected)status.textContent=error.message;}
  }
  function renderComposer(){const c=currentChat();if(!c)return;renderModelButton(c);byId('draft').value=c.draft||'';renderReplyPreview(c);renderAttachments();renderPendingQueue(c);updateSend();}
  function updateSend(){
    updateContextIndicator();
    const modePicker=byId('chat-mode');if(modePicker){modePicker.value=modeFor(currentChat()?.mode);modePicker.disabled=chatRequests.size>0||!!currentChat()?.pendingQueue?.length;}
    const c=currentChat();if(!c)return;renderModelButton(c);const pending=chatRequests.get(c.id),draft=byId('draft').value.trim();const send=byId('send');const savedWait=!chatRequests.size?savedWaitingChat():null;const queueMode=Boolean(chatRequests.size||c.queuePaused||c.pendingQueue?.length);send.disabled=!!savedWait||!!c.pendingAdmission&&!pending||(!draft&&!(sessionAttachments.get(c.id)||[]).length)||attachmentJobs.has(c.id);send.setAttribute('aria-label',queueMode?'Queue message':'Send message');send.title=queueMode?'Queue message':'Send message';
    const steer=byId('steer');if(steer){const steeringInFlight=['sending','received','accepted','pending'].includes(pending?.steeringStatus);const ready=Boolean(pending?.runId&&pending?.steeringToken);steer.hidden=!ready;steer.disabled=!draft||steeringInFlight||!!c.draftReplyTo;steer.title=c.draftReplyTo?'Send or queue this reply; steering does not include quotes.':steeringInFlight?'Waiting for the current steering request to resolve.':ready?'Send guidance to apply at the next step.':'Steering is available after the run starts.';}
    const status=byId('chat-status');status.replaceChildren();const error=chatErrors.get(c.id)||c.replyError;let message='';if(savedWait)message='Waiting for your answer in '+savedWait.title+'. Cancel the saved wait before a fresh request.';else if(pending)message=pending.waiting?'Waiting for your answer':pending.steeringMessage||'Thinking…';else if(chatRequests.size){const active=data.chats.find(x=>chatRequests.has(x.id));message=chatRequests.get(active?.id)?.waiting?'Waiting for your answer in '+active.title+'. Your draft is kept here.':'Waiting for '+(active?selectedAgents(active)[0]?.name||active.title:'another conversation')+' · one run at a time. Press Enter to queue here.';}else if(c.queuePaused)message='Queue paused. Resume when you are ready.';else if(error)message='Reply failed: '+error;if(c.captureWarning||message)status.append(document.createTextNode(c.captureWarning||message));if((chatRequests.size&&!pending)||(savedWait&&savedWait.id!==c.id)){const open=document.createElement('button');open.type='button';open.textContent='Open active conversation';open.onclick=()=>showChat(savedWait?.id||[...chatRequests.keys()][0]);status.append(open);}all('[data-mode]').forEach(button=>{const selected=modeFor(button.dataset.mode)===modeFor(c.mode);button.setAttribute('aria-checked',String(selected));button.classList.toggle('is-selected',selected);});renderPendingQueue(c);
  }
  
  function openPopover(id,anchor){closePopovers();const menu=byId(id),r=anchor.getBoundingClientRect();menu.hidden=false;menu.style.maxHeight='';menu.style.maxWidth='calc(100vw - 16px)';menu.style.overflowY='auto';if(id==='add-menu'){const top=byId('composer').getBoundingClientRect().top;menu.style.maxHeight=Math.max(24,top-16)+'px';menu.style.top=Math.max(8,top-menu.offsetHeight-8)+'px';}else menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+7))+'px';menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';anchor.setAttribute('aria-expanded','true');one('button',menu)?.focus();}
  function closePopovers(){['add-menu','create-menu','account-menu'].forEach(id=>{if(byId(id))byId(id).hidden=true;});['quick-create','tools-menu','account-button'].forEach(id=>{if(byId(id))byId(id).setAttribute('aria-expanded','false');});}
  
  
  
  function closeContextMenu(restore=true){byId('agent-context-menu')?.remove();contextAgentId=null;if(restore&&contextOpener?.isConnected)contextOpener.focus();contextOpener=null;}
  function contextAction(action){const a=agentById(contextAgentId);if(!a)return;if(action==='pin'||action==='unread'){if(action==='pin')setPinned(a,!a.pinned);else a.unread=!a.unread;savePrefs();}else if(action==='hide'){a.hidden=true;savePrefs();}else if(action==='edit'){const id=a.id;closeContextMenu();openProfile(id);return;}else if(action==='delete'){if(!confirm('Delete '+a.name+' from active coworkers? Its conversations and documents will be retained. Restore the profile from Settings.')){closeContextMenu();return;}a.hidden=true;a.archived=true;savePrefs();}else if(action==='move-project'||action==='move-section'){closeContextMenu();openMove(a.id,action==='move-project'?'project':'section',contextChatId);return;}closeContextMenu();renderSidebar();one('[data-agent-menu="'+a.id+'"]')?.focus();}
  
  function getDoc(id,name){if(!docs[id])docs[id]={};if(typeof docs[id][name]!=='string')docs[id][name]=name==='SOUL.md'?`# ${agentById(id).name}\n\nDescribe this agent's tone and boundaries.`:'Keep durable local notes here.';return docs[id][name];}
  function renderAgentPane(){openProfile(prefs.activeAgent);}
  
  function renderProfile(){
    const id=profileAgentId,pane=byId('pane-content');pane.innerHTML='<form id="profile-form" class="profile-form"><div class="profile-avatar-wrap"><button type="button" id="edit-avatar" class="avatar-edit-button" aria-label="Choose coworker appearance"></button><span class="avatar-edit-caption">Change appearance</span></div><section id="avatar-picker" hidden aria-label="Avatar chooser"></section><label for="profile-name">Name</label><input id="profile-name" maxlength="80" required><label for="profile-label">Label <span class="optional">(optional)</span></label><input id="profile-label" maxlength="80" placeholder="For example: Security"><label for="profile-description">Role / description</label><textarea id="profile-description" rows="4" maxlength="1500" placeholder="What this coworker is for"></textarea><label class="notification-row" for="profile-notifications"><span><strong>Notifications</strong><small>When this coworker finishes or needs input</small></span><input type="checkbox" id="profile-notifications" role="switch"></label><p id="profile-status" role="status"></p></form><div class="profile-documents"><h3>Coworker notes</h3><p class="profile-doc-note">Saved locally on this device. These notes are not included in model requests.</p><div class="pane-list" id="profile-doc-list"></div></div>';
    for(const [field,key]of [['profile-name','name'],['profile-label','label'],['profile-description','description']]){const n=byId(field);n.value=profileDraft[key];n.oninput=()=>{if(profileAgentId===id&&profileDraft)profileDraft[key]=n.value;};n.onchange=()=>persistProfileField(key,n.value,id);}
    byId('profile-notifications').checked=profileDraft.notifications;byId('profile-notifications').onchange=e=>{if(!persistProfileField('notifications',e.target.checked,id))e.target.checked=agentById(id).notifications!==false;};byId('edit-avatar').append(createAvatar('large',{id,avatar:profileDraft.avatar}));byId('edit-avatar').onclick=openAvatarPicker;byId('profile-form').onsubmit=e=>{e.preventDefault();document.activeElement?.blur();};
    for(const name of ['SOUL.md','MEMORY.md']){const b=document.createElement('button');b.type='button';b.dataset.doc=name;b.innerHTML=icon('document')+'<span>'+name+'</span>';b.onclick=()=>openDocument(name);byId('profile-doc-list').append(b);}
  }
  function persistProfileField(key,value,id=profileAgentId){
    if(!profileDraft||id!==profileAgentId)return false;const status=byId('profile-status');if(key==='name'){value=value.trim();if(!value){status.textContent='Name cannot be empty.';return false;}if(prefs.agents.some(a=>a.id!==id&&a.name.trim().toLowerCase()===value.toLowerCase())){status.textContent='Another agent uses that name.';return false;}}
    const next=clone(prefs),a=next.agents.find(a=>a.id===id);if(!a)return false;a[key]=value;if(key==='description')a.role=value;
    if(!save(PREF_KEY,next)){status.textContent='Could not save locally. Your previous saved value is intact.';return false;}
    prefs=next;profileDraft[key]=clone(value);const original=JSON.parse(profileOriginal);original[key]=clone(value);profileOriginal=JSON.stringify(original);if(key==='name')byId('profile-name').value=value;if(JSON.stringify(profileDraft)===profileOriginal)status.textContent='';applyPrefs();syncAgentIdentity(id);return true;
  }
  
  function applyAvatar(avatar){
    if(!profileDraft)return false;profileGeneration++;profileAvatarBusy=false;const ok=persistProfileField('avatar',avatar);profileDraft.avatar=ok?avatar:AvenAvatars.config(agentById(profileAgentId));refreshProfileAvatar();return ok;
  }
  function openAvatarPicker(){const picker=byId('avatar-picker');picker.hidden=!picker.hidden;if(!picker.hidden)renderAvatarPicker();}
  function refreshProfileAvatar(){byId('edit-avatar').replaceChildren(createAvatar('large',{id:profileAgentId,avatar:profileDraft.avatar}));}
  function renderAvatarPicker(){
    const box=byId('avatar-picker');box.innerHTML='<div class="avatar-picker-tabs" role="tablist"><button type="button" role="tab" data-avatar-tab="styles">Network</button><button type="button" role="tab" data-avatar-tab="generate">Generate</button><button type="button" role="tab" data-avatar-tab="upload">Upload</button><button type="button" id="avatar-reset">Reset</button></div><div id="avatar-picker-body"></div><p id="avatar-status" role="status"></p>';
    all('[data-avatar-tab]',box).forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.avatarTab===avatarTab));b.onclick=()=>{avatarTab=b.dataset.avatarTab;renderAvatarPicker();};});byId('avatar-reset').onclick=()=>{applyAvatar(AvenAvatars.config({id:profileAgentId}));renderAvatarPicker();};const body=byId('avatar-picker-body');
    if(avatarTab==='styles'){
      const grid=document.createElement('div');grid.className='avatar-style-grid';for(const style of AvenAvatars.styles){const label=AvenAvatars.labelFor(style);const b=document.createElement('button');b.type='button';b.dataset.avatarStyle=style;b.setAttribute('aria-label','Choose '+label+' avatar');b.title=label;b.setAttribute('aria-pressed',String(profileDraft.avatar.style===style&&!profileDraft.avatar.image));b.append(createAvatar('choice',{id:profileAgentId,avatar:{...profileDraft.avatar,style,image:''}}));b.onclick=()=>{applyAvatar({...profileDraft.avatar,style,image:''});renderAvatarPicker();};grid.append(b);}body.append(grid);
      const colors=document.createElement('div');colors.className='avatar-colors';for(const color of AvenAvatars.colors){const b=document.createElement('button');b.type='button';b.dataset.avatarColor=color;b.style.background=color;b.setAttribute('aria-label','Avatar color '+color);b.setAttribute('aria-pressed',String(profileDraft.avatar.color===color));b.onclick=()=>{applyAvatar({...profileDraft.avatar,color,image:''});renderAvatarPicker();};colors.append(b);}const label=document.createElement('label');label.className='custom-color';label.textContent='Custom';const input=document.createElement('input');input.type='color';input.id='avatar-color-custom';input.value=profileDraft.avatar.color;input.oninput=()=>{applyAvatar({...profileDraft.avatar,color:input.value,image:''});};label.append(input);colors.append(label);body.append(colors);
    }else if(avatarTab==='generate'){
      body.innerHTML='<label for="avatar-prompt">Describe a network avatar</label><textarea id="avatar-prompt" rows="3" placeholder="For example: a friendly firewall guardian"></textarea><button type="button" id="avatar-generate" class="button-secondary full-width">Generate variation</button><p class="setting-help">Creates a local network design. AI image generation is not connected.</p>';
      byId('avatar-generate').onclick=()=>{if(applyAvatar(AvenAvatars.generate(byId('avatar-prompt').value,profileDraft.avatar)))byId('avatar-status').textContent='Variation applied.';};
    }else{
      body.innerHTML='<div id="avatar-drop" class="avatar-drop" tabindex="0"><p>Drop or paste an image here</p><label class="button-secondary" for="avatar-upload">Browse files</label><input type="file" id="avatar-upload" accept="image/png,image/jpeg,image/webp"><small>PNG, JPEG or WebP · up to 2 MB · saved locally</small></div>';
      byId('avatar-upload').onchange=e=>{uploadProfileAvatar(e.target.files[0]);e.target.value='';};const drop=byId('avatar-drop');drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();uploadProfileAvatar(e.dataTransfer.files[0]);};drop.onpaste=e=>{const file=[...e.clipboardData.items].find(x=>x.kind==='file')?.getAsFile();if(file){e.preventDefault();uploadProfileAvatar(file);}};
    }
  }
  async function uploadProfileAvatar(file){
    const draft=profileDraft,token=++profileGeneration;profileAvatarBusy=true;byId('avatar-status').textContent='Reading image…';
    try{const image=await AvenAvatars.upload(file);if(profileDraft!==draft||token!==profileGeneration)return;if(applyAvatar({...profileDraft.avatar,image}))byId('avatar-status').textContent='Image applied.';}
    catch(error){if(profileDraft===draft&&token===profileGeneration&&byId('avatar-status'))byId('avatar-status').textContent=error.message;}
    finally{if(profileDraft===draft&&token===profileGeneration){profileAvatarBusy=false;}}
  }
  function openDocument(name){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;const id=prefs.activeAgent;activeDoc={id,name,original:getDoc(id,name),dirty:false};const pane=byId('pane-content');pane.innerHTML=`<div class="doc-editor"><label for="doc-textarea">${esc(name)} · ${esc(agentById(id).name)}</label><p class="doc-local-note">Local note only. This content is not sent to the model.</p><textarea id="doc-textarea" spellcheck="false"></textarea><div class="doc-actions"><button class="button-secondary" id="cancel-doc" type="button">Cancel</button><button class="button-primary" id="save-doc" type="button">Save</button></div><span class="doc-status" id="doc-status" role="status"></span><button class="button-secondary" id="back-doc" type="button" style="margin-top:12px">Back to coworker</button></div>`;byId('doc-textarea').value=activeDoc.original;byId('doc-textarea').oninput=()=>activeDoc.dirty=byId('doc-textarea').value!==activeDoc.original;byId('save-doc').onclick=()=>{const previous=docs[id][name];docs[id][name]=byId('doc-textarea').value;if(!saveDocs()){docs[id][name]=previous;byId('doc-status').textContent='Could not save. Your edited text is retained.';return;}activeDoc.original=docs[id][name];activeDoc.dirty=false;byId('doc-status').textContent='Saved locally.';};byId('cancel-doc').onclick=()=>{activeDoc=null;renderAgentPane();};byId('back-doc').onclick=()=>{if(confirmDiscardDoc())renderAgentPane();};byId('doc-textarea').focus();}
  function confirmDiscardDoc(){if(fileController?.isBusy()){toast('Wait for the file operation to finish before leaving this pane.');return false;}if(document.querySelector('.aven-evidence-note')?.value.trim()||fileController?.hasUnsavedChanges()){if(!confirm('Discard unsaved changes in this pane?'))return false;evidenceGeneration++;evidenceController?.destroy();evidenceController=null;fileController?.destroy();fileController=null;}if(profileDraft){if((JSON.stringify(profileDraft)!==profileOriginal)&&!confirm('Discard unsaved profile changes?'))return false;profileDraft=null;profileGeneration++;profileAvatarBusy=false;if(paneView==='profile')paneView='agent';}if(!activeDoc)return true;if(!activeDoc.dirty){activeDoc=null;return true;}if(confirm('This document has unsaved changes. Discard them?')){activeDoc=null;return true;}return false;}
  function syncPaneModal(){const open=!byId('right-pane').hidden,narrow=innerWidth<=760;byId('right-pane').setAttribute('aria-modal',String(open&&narrow));byId('center-column').inert=open&&narrow;byId('rail').inert=open&&narrow;one('.app-header').inert=open&&narrow;if(open&&narrow&&!byId('right-pane').contains(document.activeElement))byId('close-pane').focus();}
  function openPane(view='agent'){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;resetToolContext();if(byId('right-pane').hidden)paneOpener=document.activeElement;paneView=view;byId('right-pane').hidden=false;syncPaneModal();byId('pane-title').textContent=view==='agent'?'Coworker':view[0].toUpperCase()+view.slice(1);all('[data-pane]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.pane===view)));if(view==='agent')renderAgentPane();else if(view==='artifacts')renderArtifactsPane();else renderToolPane(view);}
  function closePane(force=false){if(fileController?.isBusy()){toast('Wait for the file operation to finish.');return false;}if(!force&&hasUnsavedPaneChanges()&&!confirmDiscardDoc())return false;activeDoc=null;profileDraft=null;profileGeneration++;profileAvatarBusy=false;resetToolContext();byId('right-pane').hidden=true;syncPaneModal();const opener=paneOpener;paneOpener=null;if(opener?.isConnected&&!opener.closest('#right-pane'))opener.focus();return true;}
  function workspaceToolOptions(selectedChatId){return {data,selectedChatId,onSave:next=>{const previous=data.workspaceTools;data.workspaceTools=next;if(!saveData()){data.workspaceTools=previous;return false;}return true;},onOpenMessage:(chatId,messageId)=>{const c=data.chats.find(x=>x.id===chatId);if(!c||c.archived||!c.messages.some(m=>m.id===messageId)){toast('The referenced message is missing or archived. Restore archived chats in Settings.');return false;}return openMessageContext(chatId,messageId);},onDownload:(name,text)=>{downloadLocal(name,text,'text/plain;charset=utf-8');return true;}};}
  function renderArtifactsPane(){activeDoc=null;AvenWorkspaceTools.render('Artifacts',byId('pane-content'),workspaceToolOptions(currentChat()?.id));}
  function showWorkspaceView(dest){
    if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;retainDraft();closePane(true);clearCenter();currentView=dest;byId('empty-view').hidden=false;byId('composer-wrap').hidden=true;setSurface(dest);
    AvenWorkspaceTools.render(dest,byId('empty-view'),workspaceToolOptions());const back=document.createElement('button');back.type='button';back.className='button-secondary';back.id='back-conversation';back.textContent='Back to conversation';back.onclick=()=>showChat();byId('empty-view').append(back);
  }
  function resetToolContext() {
    evidenceGeneration++;evidenceController?.destroy();evidenceController=null;fileController?.destroy();fileController=null;
    toolContext += 1;
    Object.entries(toolStates).forEach(([view, state]) => { clearTimeout(toolTimers[view]); state.status = 'idle'; state.attempt = 0; });
  }

  let sandboxResult = null, sandboxLoading = false, sandboxError = '';
  function renderNetworkSandboxPane() {
    const box = byId('pane-content');
    box.innerHTML = `<section class="preview-card"><h3>Cisco Catalyst Center</h3><p class="pane-note">Read device inventory from Cisco’s shared sandbox.</p><button class="button-primary" id="sandbox-load" ${sandboxLoading?'disabled':''}>${sandboxLoading?'Reading inventory…':sandboxResult?'Refresh inventory':'Load inventory'}</button><p role="status" class="pane-note">${esc(sandboxError || (sandboxResult ? 'Retrieved '+new Date(sandboxResult.retrievedAt).toLocaleString() : 'Load a current inventory snapshot. No configuration changes.'))}</p></section>`;
    if (sandboxResult) {
      const results = document.createElement('section');
      results.setAttribute('aria-label', 'Cisco device inventory');
      results.innerHTML = `<p class="pane-note">${sandboxResult.devices.length} devices · Cisco sandbox</p>`;
      sandboxResult.devices.forEach(device => {
        const card = document.createElement('article'); card.className='preview-card sandbox-device';
        card.innerHTML = `<h3>${esc(device.hostname)}</h3><dl><dt>Platform</dt><dd>${esc(device.platform)}</dd><dt>Management IP</dt><dd>${esc(device.managementIp)}</dd><dt>Software</dt><dd>${esc(device.softwareVersion)}</dd><dt>Reported reachability</dt><dd>${esc(device.reachability)}</dd></dl>`;
        results.append(card);
      }); box.append(results);
    }
    byId('sandbox-load').onclick = async () => {
      if(sandboxLoading)return;
      sandboxLoading=true; sandboxError=''; renderNetworkSandboxPane();
      try {
        const response=await fetch('http://127.0.0.1:8768/api/sandbox/inventory',{method:'POST',headers:{'X-Aven-Sandbox':'read-only'},signal:AbortSignal.timeout(45000)});
        if(!response.ok)throw Error('unavailable');
        const result=await response.json();
        if(!Array.isArray(result.devices))throw Error('invalid response');
        sandboxResult=result;
      } catch {sandboxError='Could not refresh Cisco inventory. Check that the local service is running. Any previous inventory below is an earlier snapshot.';}
      finally {sandboxLoading=false; if(paneView==='plugins')renderNetworkSandboxPane();}
    };
  }
  function renderToolPane(view) {
    if(view==='files'){fileController=AvenFiles.render(byId('pane-content'),{onStatus:()=>{}});return;}
    if(view==='plugins'){renderNetworkSandboxPane();return;}
    const pane=byId('pane-content');pane.replaceChildren();
    const title=document.createElement('h3');title.textContent=view==='browser'?'Browser unavailable':'Computer unavailable';
    const note=document.createElement('p');note.textContent=view==='browser'?'No browser session is connected to Aven. Live page previews and browser actions are not available in this build.':'No computer session is connected to Aven. Screen previews and computer actions are not available in this build.';
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='No external session or action is active.';pane.append(title,note,status);
  }

  async function addFiles(files){
    const c=currentChat();if(!c||c.archived)return;const incoming=[...files];if(!incoming.length)return;
    const previous=attachmentJobs.get(c.id)||Promise.resolve();const job=previous.catch(()=>{}).then(async()=>{const next=await AvenAttachments.readFiles(incoming,sessionAttachments.get(c.id)||[]);if(!data.chats.includes(c))return;sessionAttachments.set(c.id,next);c.pendingAttachmentNames=next.map(x=>x.name);if(!saveData())c.attachmentWarning='File selection could not be saved. Ready files exist only for this page session.';else delete c.attachmentWarning;});attachmentJobs.set(c.id,job);renderAttachments();updateSend();
    try{await job;}catch{toast('Could not read the selected files. Reattach them to try again.');}finally{if(attachmentJobs.get(c.id)===job)attachmentJobs.delete(c.id);if(currentChat()?.id===c.id){renderAttachments();updateSend();}}
  }
  function convertPendingSteerToQueue(c,p,message){
    const text=p.pendingSteerText||p.steeringText;if(!text||p.steeringConverted)return true;
    const added=queueMessage(c,text,{pause:true,reason:message||'Steering was accepted but was not applied. Resume to send it as the next message.'});
    if(added){p.steeringConverted=true;p.steeringStatus='pending';p.steeringMessage=message||'Steering was not applied; it is queued and paused.';}
    return added;
  }
  function questionMessage(c,q){return c.messages.find(m=>m.question?.id===q.id);}
  function renderQuestion(m){
    const c=currentChat(),p=chatRequests.get(c.id),q=m.question,view=receiptViews.get(c.id)||{};
    const live=!!(p?.waiting&&p.question?.id===q.id&&p.answerToken);
    return AvenClarification.card(q,{expanded:questionDisclosures.get(q.id)||false,live,busy:live?p.questionBusy:!!view.busy,draft:live?p.answerDraft:(m.answerDraft||{}),note:live?p.questionNote:view.questionNote,
      onDraft:draft=>{
        if(!live||p.questionBusy)return p.questionNote;
        const bounded=draft.choiceId?{choiceId:draft.choiceId}:{text:String(draft.text||'').slice(0,2000)};
        p.answerDraft=bounded;m.answerDraft={...bounded};
        p.questionNote=saveData()?'Answer draft saved. Nothing has been sent.':'Browser storage is unavailable. Your answer draft is kept for this page only; nothing was sent.';
        return p.questionNote;
      },onAnswer:live?p.answerQuestion:null,
      onCancel:!q.inert&&q.chatId===c.id&&q.requestId===c.pendingAdmission?()=>live?p.cancelQuestion():cancelSavedQuestion(c,q):null,
      onRefresh:!q.inert&&q.chatId===c.id?event=>refreshQuestion(c,q,event.currentTarget===document.activeElement):null});
  }
  async function readQuestion(q){
    const query=new URLSearchParams({chatId:q.chatId,requestId:q.requestId,runId:q.runId});
    const response=await fetch(CHAT_API+'/question?'+query,{headers:{'X-Aven-Chat':'text-only'},signal:AbortSignal.timeout(10000)}),value=await response.json();
    if(!response.ok)throw Error(value.reasons?.[0]||value.error||'Saved question is unavailable.');return value;
  }
  async function refreshQuestion(c,q,restoreFocus=false){
    const active=chatRequests.get(c.id),p=active?.question?.id===q.id?active:null;let note;
    try{const value=await readQuestion(q),m=questionMessage(c,q);if(m)m.question=value.question;
      note=value.question.phase==='waiting'
        ?p?.waiting?'Still waiting for your answer. No answer was sent by this refresh.':'Still waiting. Cancel this saved question, then send a fresh request.'
        :'Saved state refreshed. No work was dispatched by this refresh.';
      if(p?.waiting&&value.question.phase!=='waiting'){p.finishQuestion?.(null,Error(value.question.answer?'Your answer was recorded. Check the saved run; no continuation was retried.':'This question is no longer active. Check the saved run.'));}
      else if(!p&&c.pendingAdmission===q.requestId&&value.receipt.state!=='admitted')await reviewReceipt(c);
    }catch(error){note=error.message;}
    if(p)p.questionNote=note;
    receiptViews.set(c.id,{...receiptViews.get(c.id),questionNote:note});
    renderConversation();updateSend();
    // Populate the mounted live region after rendering so refresh is announced.
    const selector='.clarification-card[data-question-id="'+CSS.escape(q.id)+'"]';
    const status=one(selector+' .clarification-note');if(status)status.textContent='';
    requestAnimationFrame(()=>{
      if(currentChat()?.id!==c.id)return;
      const status=one(selector+' .clarification-note');if(status)status.textContent=note;
      if(restoreFocus)one(selector+' [data-question-action="refresh"]')?.focus();
    });
  }
  async function questionPost(q,action,extra={},signal){
    return fetch(CHAT_API+'/question/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Aven-Chat':'text-only','Accept':'application/x-ndjson'},body:JSON.stringify({...AvenClarification.scope(q),...extra}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(130000)]):AbortSignal.timeout(130000)});
  }
  async function cancelSavedQuestion(c,q){
    if(chatRequests.size)return;
    receiptViews.set(c.id,{busy:true});renderConversation();
    try{await withAdmissionWriter(c.id,async()=>{
      // Refuse a stale workspace before even cancelling; do not touch a live tab.
      if(localStorage.getItem(CHAT_KEY)!==savedWorkspace)throw Error('Workspace changed in another tab. Keep your draft and reload.');
      const response=await questionPost(q,'cancel'),value=await response.json();if(!response.ok)throw Error(value.reasons?.[0]||value.error);
      const pending=AvenAdmission.pending(c);if(!pending)throw Error('Saved request is unavailable.');
      const before=clone(c);AvenAdmission.applyReceipt(c,pending.submission,value.receipt,null);const m=questionMessage(c,q);if(m){m.question=value.question;m.text=value.receipt.outcome==='UNKNOWN'?'The original service stopped. Completion is unknown; no continuation was dispatched by this cancellation.':'Request cancelled. Send a fresh request when ready.';}
      receiptSavePermit=q.requestId;const saved=saveData();receiptSavePermit=null;if(!saved){Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,before);throw Error('Cancellation is saved by the service, but browser storage failed. Refresh saved state.');}
    });receiptViews.delete(c.id);}
    catch(error){receiptViews.set(c.id,{questionNote:error.message});}
    renderConversation();updateSend();requestAnimationFrame(()=>byId('draft').focus());
  }
  async function readChatResponse(c,p,response){
    p.responseRejected=!response.ok;
    if(!response.headers.get('content-type')?.includes('application/x-ndjson')){const value=await response.json();if(!response.ok)throw Object.assign(Error(value.reasons?.[0]||value.error||'Connection unavailable.'),{status:response.status});return value;}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,result,failure;
    const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);processChatEvent(c,p,event);if(event.type==='final')result=event.reply;if(event.type==='question')result={waiting:true,...event};if(event.type==='failed')failure=event.message;};
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_STREAM_BYTES){p.controller.abort();throw Error('Run output exceeded display limit.');}buffer+=decoder.decode(value,{stream:true});let pos;while((pos=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,pos));buffer=buffer.slice(pos+1);}}
    buffer+=decoder.decode();if(buffer.trim())consume(buffer);if(failure)throw Error(failure);if(!result)throw Error('Run ended without a saved answer.');return result;
  }
  async function waitForAnswer(c,p,value){
    p.waiting=true;p.question=value.question;p.answerToken=value.answerToken;p.answerDraft={};p.steeringToken=null;
    AvenAdmission.reconcileResult(c,{id:uid(),role:'assistant',agentId:p.agentId,requestId:p.requestId,runId:p.runId,question:value.question,events:AvenRunState.clean(p.events),evidence:AvenRunState.clean(p.events.flatMap(e=>Array.isArray(e.evidence)?e.evidence:e.evidence?[e.evidence]:[])),status:'WAITING',text:'',mode:p.mode,createdAt:now()});
    if(!saveData())throw Error('Question could not be saved in this browser. No answer was sent.');
    const result=new Promise((resolve,reject)=>{
      p.finishQuestion=(value,error)=>{p.answerToken=null;p.waiting=false;error?reject(error):resolve(value);};
      p.answerQuestion=async answer=>{
        if(p.questionBusy)return;p.questionBusy=true;p.questionNote='';renderConversation();
        try{
          // Persist again before dispatch; edit-time storage failure never authorizes sending.
          const message=questionMessage(c,p.question);if(message)message.answerDraft={...answer};
          if(!saveData())throw Object.assign(Error('Browser storage is unavailable. Your answer draft is retained; nothing was sent.'),{status:400});
          p.controller=new AbortController();const response=await questionPost(p.question,'answer',{answer,answerToken:p.answerToken},p.controller.signal);
          const result=await readChatResponse(c,p,response);
          p.finishQuestion(result);
        }catch(error){
          if(error.status===400||error.status===403||error.status===409){p.questionNote=error.message;p.questionBusy=false;renderConversation();requestAnimationFrame(()=>one('.clarification-card textarea, .clarification-card input, .clarification-card button')?.focus());return;}
          try{const saved=await readQuestion(p.question),m=questionMessage(c,p.question);if(m){m.question=saved.question;if(saved.question.answer)delete m.answerDraft;}saveData();}catch{}
          p.finishQuestion(null,Error('Answer delivery is uncertain. Check saved state; no answer or continuation will be retried automatically.'));
        }
      };
      p.cancelQuestion=async()=>{
        if(p.questionBusy)return;p.questionBusy=true;renderConversation();
        try{const response=await questionPost(p.question,'cancel'),result=await response.json();if(!response.ok)throw Error(result.reasons?.[0]||result.error);p.finishQuestion({...result,cancelled:true});}
        catch(error){p.questionBusy=false;p.questionNote=error.message;renderConversation();}
      };
    });
    renderConversation();updateSend();requestAnimationFrame(()=>{if(currentChat()?.id===c.id)one('.clarification-card input, .clarification-card textarea, .clarification-card button')?.focus();});return result;
  }
  function processChatEvent(c,p,event){
    if(!event||typeof event!=='object')return;
    if(event.receipt&&p.submission)p.submission.receipt=event.receipt;
    if(event.type==='question_answered'){const m=questionMessage(c,event.question);if(m){m.question=event.question;delete m.answerDraft;}if(currentChat()?.id===c.id)renderConversation();}
    if(event.type==='start'&&event.segmentId){p.waiting=false;p.steeringMessage='Working';renderConversation();}
    if(event.type==='start'){if(event.runId)p.runId=String(event.runId);if(event.steeringToken)p.steeringToken=String(event.steeringToken);}
    const safeEvent=AvenRunState.clean(event);if(event.type!=='final'){const previousEvents=p.events;p.events=[...p.events,safeEvent];try{const previous=c.runJournal;c.runJournal=AvenRunState.journal(p);if(!saveData()){c.runJournal=previous;throw Error('Browser storage is full or unavailable.');}}catch(error){p.events=previousEvents;p.captureError='Run capture incomplete: '+error.message+' Remote completion is unknown.';c.captureWarning=p.captureError;p.controller.abort();throw error;}}
    if(event.type==='steer_received'||event.type==='steer_applied'||event.type==='steer_pending'){
      const id=String(event.id||event.steeringId||'');const record=p.steeringEvents.get(id)||{};record.status=event.type.replace('steer_','');record.message=event.message||'';p.steeringEvents.set(id,record);p.lastSteeringEvent=event;
      if(event.type==='steer_applied'){p.steeringStatus='applied';p.steeringMessage=event.message||'Steering applied at the next step.';if(id&&event.message&&!p.appliedSteerIds.has(id)){p.appliedSteerIds.add(id);c.messages.push({id:uid(),role:'user',text:event.message,recipients:c.recipients,recipientNames:selectedAgents(c).map(a=>a.name),steeringId:id,createdAt:now()});saveData();if(currentChat()?.id===c.id)renderConversation();}}
      else if(event.type==='steer_pending'){p.steeringStatus='pending';p.pendingSteerText=event.message||p.steeringText;p.steeringMessage=event.message||'Steering was not applied; it will wait in the queue.';if(p.steeringText)convertPendingSteerToQueue(c,p,p.steeringMessage);else p.pendingSteerEvent=event;}
      else if(!['applied','pending'].includes(p.steeringStatus)){p.steeringStatus='received';p.steeringMessage=event.message||'Steering accepted; it applies at the next step.';}
    }
    if(currentChat()?.id===c.id){updateRunActivity(c.id);updateSend();}
  }
  async function steerCurrent(){
    const c=currentChat(),p=chatRequests.get(c?.id),text=byId('draft').value.trim();if(p?.waiting)return;if(!c||!p?.runId||!p?.steeringToken||!text)return;
    if(text.length>MAX_QUEUE_TEXT){toast(`Steering text must be ${MAX_QUEUE_TEXT.toLocaleString()} characters or fewer.`);return;}
    if((c.pendingQueue||[]).length>=MAX_QUEUE_ITEMS){toast('Queue is full. Remove a queued message before steering.');return;}
    const draftAtSend=byId('draft').value;p.steeringText=text;p.pendingSteerText='';p.pendingSteerEvent=null;p.steeringConverted=false;p.steeringStatus='sending';p.steeringMessage='Sending guidance…';updateSend();
    try{
      const response=await fetch(`${CHAT_API}/steer`,{method:'POST',headers:{'X-Aven-Chat':'text-only','Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({runId:p.runId,chatId:c.id,steeringToken:p.steeringToken,text})});
      let result={};try{result=await response.json();}catch{}
      if(!response.ok||result.accepted!==true)throw Error(result.error||'Steering was not accepted.');
      p.steeringId=String(result.id||'');const related=p.steeringEvents.get(p.steeringId)||{};if(p.steeringStatus!=='applied'&&p.steeringStatus!=='pending'){p.steeringStatus=related.status||'accepted';p.steeringMessage=related.message||'Steering accepted; it applies at the next step.';}
      if(chatRequests.get(c.id)!==p&&p.steeringStatus!=='applied'&&!convertPendingSteerToQueue(c,p,'The run ended before steering was applied. Resume to send this guidance next.')){toast('The run ended. Steering remains in your draft because the queue is full.');return;}
      if(p.pendingSteerEvent)processChatEvent(c,p,p.pendingSteerEvent);
      if(byId('draft').value===draftAtSend){c.draft='';byId('draft').value='';saveData();}
    }catch(error){p.steeringStatus='error';p.steeringMessage=error instanceof TypeError?'Delivery uncertain. Keep the draft and retry Steer manually.':error.message||'Steering was not accepted. The draft is still here.';}
    updateSend();if(currentChat()?.id===c.id)updateRunActivity(c.id);
  }
  const modeFor=value=>value==='plan'?'plan':'inspect';
  async function requestChatReply(c,requestMode=modeFor(c.messages.at(-1)?.mode??c.mode),retrySaved=null){
    if(chatRequests.size)return;
    try{const outcome=await withAdmissionWriter(c.id,()=>performChatReply(c,requestMode,retrySaved));if(outcome==='success')dispatchAvailableQueue();}
    catch(error){toast(error.message);}
  }
  async function performChatReply(c,requestMode,retrySaved){
    if(chatRequests.size)return;
    if(c.pendingAdmission&&!retrySaved){toast('Check the saved run before sending again.');return;}
    const agent=retrySaved?agentById(retrySaved.submission.agentId):(selectedAgents(c)[0]||agentById(prefs.activeAgent)),agentId=agent.id;const {messages}=chatContext(c);
    const sourceMessage=retrySaved?.message||c.messages.at(-1);
    if(!sourceMessage||sourceMessage.role!=='user'||!retrySaved&&(!messages.length||messages.at(-1).role!=='user'))return;
    let submission;try{submission=retrySaved?.submission||AvenAdmission.prepare(c,sourceMessage,{agentId,agentName:agent.name,mode:requestMode,messages,selection:c.providerSelection});}catch(error){toast(error.message);return;}
    if(c.captureWarning){toast(c.captureWarning+' Reload to recover saved work before another request.');return;}
    const beforePrepare=clone(c);sourceMessage.submission=submission;c.pendingAdmission=submission.body.requestId;
    submission.ownerSession=browserSession;const requestBody=submission.body;
    const started=performance.now(),controller=new AbortController(),pending={journalId:uid(),requestId:requestBody.requestId,submission,agentId,mode:requestBody.mode,startedAt:now(),name:agent.name,started,controller,events:[],runId:null,steeringToken:null,steeringText:'',pendingSteerText:'',steeringStatus:'idle',steeringMessage:'Steering applies at the next step.',steeringEvents:new Map(),appliedSteerIds:new Set()};let timer,result,runOutcome='error';chatErrors.delete(c.id);delete c.replyError;c.runJournal=AvenRunState.journal(pending);if(retrySaved)receiptSavePermit=requestBody.requestId;const preparedSaved=saveData();receiptSavePermit=null;if(!preparedSaved){Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,beforePrepare);c.replyError='Could not save run capture. No request was sent.';renderConversation();return;}chatRequests.set(c.id,pending);renderSidebar();renderConversation();updateSend();
    timer=setInterval(()=>{const elapsed=one('.working-elapsed');if(elapsed&&currentChat()?.id===c.id)elapsed.textContent=durationLabel(performance.now()-started);},1000);
    try{
      pending.dispatched=true;
      result=await readChatResponse(c,pending,await fetch(CHAT_API,{method:'POST',headers:{'Content-Type':'application/json','X-Aven-Chat':'text-only','Accept':'application/x-ndjson'},body:JSON.stringify(requestBody),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(130000)])}));
      if(result.waiting)result=await waitForAnswer(c,pending,result);
      if(result.receipt)submission.receipt=result.receipt;
      if(result.question){const m=c.messages.find(m=>m.question?.id===result.question.id);if(m)m.question=result.question;}
      if(result.cancelled){submission.state='settled';delete c.pendingAdmission;delete c.runJournal;delete c.queueDispatching;const m=c.messages.find(m=>m.question?.id===result.question.id);if(m){m.question=result.question;m.status='NOT_EXECUTED';m.text='Request cancelled. No continuation was dispatched.';}if(!saveData()){c.pendingAdmission=requestBody.requestId;throw Error('Cancellation could not be saved in this browser. Check saved state.');}runOutcome='cancelled';return runOutcome;}
      if(result.duplicate){submission.state='unknown';receiptViews.set(c.id,{receipt:result.receipt,note:'This request was already accepted. Check its saved result; no new work was started.'});delete c.runJournal;saveData();return;}
      if(typeof result.text!=='string'||!result.text.trim())throw Error('The provider returned an empty reply.');
      if(data.chats.includes(c)){const status=AvenRunState.outcome(result,pending.events),completed=AvenAdmission.reconcileResult(c,{id:uid(),role:'assistant',agentId,requestId:requestBody.requestId,text:result.text,model:result.model,requestedSelection:result.requestedSelection,provenance:result.provenance,mode:result.mode||'unavailable',status,usage:AvenRunState.usage(result.usage),journalId:pending.journalId,source:result.source||'',events:pending.events,evidence:AvenRunState.clean(result.evidence||[]),runId:result.runId||pending.runId,durationMs:Math.round(performance.now()-started),createdAt:now()});const journal=c.runJournal;if(currentChat()?.id!==c.id)c.unread=true;delete c.runJournal;delete c.queueDispatching;delete c.pendingAdmission;submission.state='settled';submission.receipt=result.receipt;if(saveData()){runOutcome=status==='SUCCESS'?'success':'error';if(runOutcome==='success'&&agent.notifications!==false&&currentChat()?.id!==c.id){notifyRun(c,completed,agent);}}else{c.runJournal=journal;c.pendingAdmission=requestBody.requestId;submission.state='unknown';c.captureWarning='The final result is visible but could not be saved. Export it or free browser storage before reloading.';}}
    }catch(error){submission.state='unknown';const message=pending.captureError|| (pending.controller.signal.aborted?'Run stopped. A command already submitted to Cisco may still finish.':error.name==='TimeoutError'?'The request timed out.':error instanceof TypeError?'Local chat service is unavailable.':error.message);const events=pending.events||[];if(['received','accepted','pending'].includes(pending.steeringStatus)&&!pending.steeringConverted)convertPendingSteerToQueue(c,pending,'Steering was accepted but was not applied. Resume to send it as the next message.');if(events.some(e=>e.type==='tool_start')||pending.dispatched&&!pending.responseRejected){delete c.replyError;chatErrors.delete(c.id);AvenAdmission.reconcileResult(c,{id:uid(),role:'assistant',agentId,requestId:requestBody.requestId,text:message,source:'Coworker run incomplete · no automatic retry',journalId:pending.journalId,runId:pending.runId,status:'UNKNOWN',durationMs:Math.round(performance.now()-started),events:AvenRunState.clean(events),evidence:events.map(e=>e.evidence).filter(Boolean),createdAt:now()});}else{chatErrors.set(c.id,message);c.replyError=message;}const journal=c.runJournal;delete c.runJournal;delete c.queueDispatching;if(!saveData()){c.runJournal=journal;c.captureWarning='Could not save the interrupted result. Previously captured evidence is retained; remote completion is unknown.';}}
    finally{clearInterval(timer);const scroll=byId('center-content'),following=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<160;if(['received','accepted','pending'].includes(pending.steeringStatus)&&!pending.steeringConverted)convertPendingSteerToQueue(c,pending,'Steering was accepted but was not applied. Resume to send it as the next message.');if(runOutcome!=='success')for(const queuedChat of data.chats)pauseQueue(queuedChat,runOutcome==='cancelled'?'Queue paused after cancellation. Resume when ready.':pending.controller.signal.aborted?'Queue paused after stopping this run.':'Queue paused after an uncertain or failed run.');chatRequests.delete(c.id);renderSidebar();if(currentChat()?.id===c.id&&currentView==='conversation'){renderConversation();if(following)requestAnimationFrame(()=>byId('conversation').lastElementChild?.scrollIntoView({block:'end'}));}updateSend();if(pending.question&&currentChat()?.id===c.id)requestAnimationFrame(()=>byId('draft').focus());}
    return runOutcome;
  }
  function sendMessage(event){
    event?.preventDefault();const c=currentChat();if(!chatRequests.size&&savedWaitingChat()){toast('A saved question is waiting in '+savedWaitingChat().title+'. Your draft is retained.');return;}if(c.pendingAdmission&&!chatRequests.has(c.id)){toast('Check the saved run before sending again. Your draft is retained.');return;}const items=sessionAttachments.get(c.id)||[];if(attachmentJobs.has(c.id)){toast('Wait for local file reading to finish.');return;}if(!items.length&&c.pendingAttachmentNames?.length){toast('Reattach or clear previous-session files before sending.');return;}let text;try{text=AvenAttachments.compose(byId('draft').value.trim(),items).text;}catch(error){toast(error.message);return;}if(!text.trim())return;
    if(chatRequests.size||c.queuePaused||c.pendingQueue?.length){if(queueMessage(c,text,{replyTo:c.draftReplyTo,clearComposer:true})){sessionAttachments.delete(c.id);delete c.attachmentWarning;byId('draft').value='';renderComposer();}return;}
    if(contextMessage({text,replyTo:c.draftReplyTo}).length>32000){toast('Message and quoted context exceed 32,000 characters. Shorten the message or cancel the reply. Your draft is retained.');return;}const replyTo=normalizeReply(c.draftReplyTo),oldDraft=c.draft,oldNames=c.pendingAttachmentNames;c.pendingAttachmentNames=[];c.messages.push({id:uid(),role:'user',text,mode:modeFor(c.mode),attachments:items.map(x=>x.name),replyTo,recipients:c.recipients,recipientNames:selectedAgents(c).map(a=>a.name),createdAt:now()});c.draft='';delete c.draftReplyTo;if(!saveData()){c.messages.pop();c.draft=oldDraft;c.pendingAttachmentNames=oldNames;c.draftReplyTo=replyTo;toast('Could not save the message. Your draft is retained.');return;}sessionAttachments.delete(c.id);delete c.attachmentWarning;byId('draft').value='';renderConversation();renderComposer();renderSidebar();requestChatReply(c);
  }
  
  
  function captureSettings(){if(byId('behavior-timezone'))settingsBehavior.set(behaviorAgentId,{timezone:byId('behavior-timezone').value,autoReview:byId('behavior-auto-review').checked});all('#settings-content [data-pref]').forEach(n=>settingsDraft[n.dataset.pref]=n.type==='checkbox'?n.checked:n.value);}
  function setChatMode(value){
    const c=currentChat(),next=modeFor(value);if(!c)return false;const previous=c.mode;c.mode=next;if(!saveData()){c.mode=previous;toast('Could not save the mode. Previous mode remains selected.');return false;}
    all('[data-mode]').forEach(button=>{const selected=modeFor(button.dataset.mode)===next;button.setAttribute('aria-checked',String(selected));button.classList.toggle('is-selected',selected);});
    closePopovers();byId('tools-menu')?.focus();updateSend();return true;
  }

  function setupScrollSurfaces(){
    const surfaces=['#center-content','#sidebar-scroll','#pane-content','#settings-content','#search-results','#create-dialog-body','#account-menu','#create-menu','#add-menu'].map(selector=>one(selector)).filter(Boolean);
    surfaces.forEach(surface=>{
      if(surface.dataset.scrollWired==='true')return;
      surface.dataset.scrollWired='true';surface.classList.add('scroll-surface');if(['sidebar-scroll','center-content','pane-content'].includes(surface.id))surface.tabIndex=0;
      let idleTimer;
      const wake=()=>{surface.classList.add('scroll-active');clearTimeout(idleTimer);idleTimer=setTimeout(()=>surface.classList.remove('scroll-active'),720);};
      surface.addEventListener('scroll',wake,{passive:true});
      surface.addEventListener('pointerenter',wake,{passive:true});
      surface.addEventListener('focusin',wake);
      surface.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))wake();});
    });
  }
  
  
  
  function showInfo(title,body){byId('info-dialog-title').textContent=title;byId('info-dialog-body').innerHTML=body;byId('info-dialog').showModal();}
  
  function renderBehaviorSettings(){const p=byId('settings-content');const a=agentById(behaviorAgentId),behavior={...a,...(settingsBehavior.get(a.id)||{})};p.innerHTML='<h2>Coworker preferences</h2><p>One place for scheduling and review preferences.</p><label for="behavior-agent">Coworker</label><select id="behavior-agent">'+prefs.agents.filter(x=>!x.archived).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select><label for="behavior-timezone">Time zone</label><select id="behavior-timezone"></select><label class="setting-check"><input id="behavior-auto-review" type="checkbox"> Automatic review</label><p class="setting-help">These are saved preferences. No background agent is running.</p>';byId('behavior-agent').value=a.id;const zones=[...new Set(['Follow system','UTC','Asia/Kolkata','America/Los_Angeles',behavior.timezone||'Follow system'])];byId('behavior-timezone').replaceChildren(...zones.map(z=>{const o=document.createElement('option');o.textContent=z;return o;}));byId('behavior-timezone').value=behavior.timezone||'Follow system';byId('behavior-auto-review').checked=!!behavior.autoReview;byId('behavior-agent').onchange=e=>{captureSettings();behaviorAgentId=e.target.value;renderBehaviorSettings();};}
  window.addEventListener('beforeunload',e=>{if(activeDoc?.dirty||(profileDraft&&JSON.stringify(profileDraft)!==profileOriginal)||document.querySelector('.aven-evidence-note')?.value.trim()||fileController?.hasUnsavedChanges()){e.preventDefault();e.returnValue='';}});
  function setupPaneResize(){
    const handle=byId('pane-resize');let desired=Number(prefs.paneWidth)||350;
    const apply=()=>{const max=Math.max(320,Math.min(720,document.querySelector('.workspace-body').clientWidth-320));const width=Math.max(320,Math.min(max,desired));document.documentElement.style.setProperty('--pane-width',width+'px');handle.setAttribute('aria-valuemin','320');handle.setAttribute('aria-valuemax',max);handle.setAttribute('aria-valuenow',Math.round(width));};
    const save=()=>{const old=prefs.paneWidth;prefs.paneWidth=desired;if(!savePrefs()){prefs.paneWidth=old;toast('Pane width could not be saved.');}};
    handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();desired=e.key==='Home'?320:e.key==='End'?Number(handle.getAttribute('aria-valuemax')):Number(handle.getAttribute('aria-valuenow'))+(e.key==='ArrowLeft'?10:-10);desired=Math.max(320,Math.min(Number(handle.getAttribute('aria-valuemax')),desired));apply();save();};
    handle.onpointerdown=e=>{e.preventDefault();const start=e.clientX,width=Number(handle.getAttribute('aria-valuenow'));const move=e=>{desired=Math.max(320,Math.min(Number(handle.getAttribute('aria-valuemax')),width+start-e.clientX));apply();};const stop=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',stop);save();};addEventListener('pointermove',move);addEventListener('pointerup',stop);};addEventListener('resize',apply);new ResizeObserver(apply).observe(document.querySelector('.workspace-body'));apply();
  }
  function init(){setupPaneResize();setIcons();applyPrefs();renderSidebar();showChat(data.activeChat);byId('right-pane').hidden=true;syncPaneModal();byId('toggle').onclick=()=>{const r=byId('rail'),open=r.classList.toggle('expanded');byId('toggle').setAttribute('aria-expanded',String(open));byId('toggle').setAttribute('aria-label',open?'Collapse sidebar':'Expand sidebar');document.documentElement.style.setProperty('--rail-width',open?'260px':'72px');};byId('quick-create').onclick=()=>openPopover('create-menu',byId('quick-create'));byId('tools-menu').onclick=()=>openPopover('add-menu',byId('tools-menu'));byId('account-button').onclick=()=>openPopover('account-menu',byId('account-button'));all('[data-create]').forEach(b=>b.onclick=()=>createWorkspace(b.dataset.create));all('[data-account-action]').forEach(b=>b.onclick=()=>accountAction(b.dataset.accountAction));all('[data-add]').forEach(b=>b.onclick=()=>{closePopovers();byId('tools-menu').focus();const t=b.dataset.add;if(t==='files'||t==='images')byId(t==='files'?'file-picker':'image-picker').click();else openPane(t==='localfiles'?'files':t);});byId('file-picker').onchange=e=>{addFiles(e.target.files);e.target.value='';};byId('image-picker').onchange=e=>{addFiles(e.target.files);e.target.value='';};byId('search-nav').onclick=openSearch;byId('avatar').onclick=()=>{if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;prefs.activeAgent=currentChat()?.recipients?.[0]||prefs.activeAgent;savePrefs();openPane('agent');};byId('composer').onsubmit=sendMessage;byId('draft').oninput=()=>{currentChat().draft=byId('draft').value;updateSend();saveUnrelatedData();};byId('draft').oncompositionstart=()=>composition=true;byId('draft').oncompositionend=()=>composition=false;byId('draft').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composition&&!e.ctrlKey&&!e.altKey){e.preventDefault();sendMessage(e);}};byId('close-pane').onclick=()=>closePane();all('[data-pane]').forEach(b=>b.onclick=()=>openPane(b.dataset.pane));byId('settings').onclick=()=>openSettings();byId('close-settings').onclick=()=>byId('settings-dialog').close();byId('cancel-settings').onclick=()=>byId('settings-dialog').close();byId('save-settings').onclick=()=>{captureSettings();const previous=prefs;prefs={...prefs,...settingsDraft,agents:prefs.agents.map(a=>({...a,...(settingsBehavior.get(a.id)||{})})),activeAgent:prefs.activeAgent,sections:prefs.sections};if(!savePrefs()){prefs=previous;byId('settings-status').textContent='Could not save settings. Previous preferences are unchanged.';return;}applyPrefs();renderSidebar();byId('settings-status').textContent='Settings saved locally.';setTimeout(()=>byId('settings-dialog').close(),100);};byId('settings-dialog').onclose=()=>{if(settingsOpener?.isConnected)settingsOpener.focus();settingsOpener=null;};byId('global-search').oninput=renderSearch;byId('close-search').onclick=()=>byId('search-dialog').close();byId('search-dialog').onclose=()=>{if(searchOpener?.isConnected)searchOpener.focus();searchOpener=null;};byId('close-info').onclick=()=>byId('info-dialog').close();byId('info-ok').onclick=()=>byId('info-dialog').close();document.addEventListener('pointerdown',e=>{if(!e.target.closest('#add-menu,#create-menu,#account-menu,#quick-create,#tools-menu,#account-button'))closePopovers();if(!e.target.closest('#agent-context-menu')&&!e.target.closest('[data-agent-menu],[data-section-menu],[data-section-toggle]'))closeContextMenu();});window.onresize=()=>{syncPaneModal();closePopovers();};const media=matchMedia('(prefers-color-scheme: light)');media.addEventListener?.('change',()=>{if(prefs.theme==='system')applyPrefs();});byId('sidebar-resize').onpointerdown=e=>{e.preventDefault();const start=e.clientX,startWidth=byId('rail').getBoundingClientRect().width,move=m=>{const w=Math.max(220,Math.min(380,startWidth+m.clientX-start));document.documentElement.style.setProperty('--rail-width',`${w}px`);byId('rail').style.width=`${w}px`;byId('sidebar-resize').setAttribute('aria-valuenow',Math.round(w));},stop=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',stop);};addEventListener('pointermove',move);addEventListener('pointerup',stop);};byId('sidebar-resize').onkeydown=e=>{let w=byId('rail').getBoundingClientRect().width;if(e.key==='ArrowLeft')w-=10;else if(e.key==='ArrowRight')w+=10;else if(e.key==='Home')w=220;else if(e.key==='End')w=380;else return;e.preventDefault();w=Math.max(220,Math.min(380,w));document.documentElement.style.setProperty('--rail-width',`${w}px`);byId('rail').style.width=`${w}px`;byId('sidebar-resize').setAttribute('aria-valuenow',Math.round(w));};document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!byId('create-menu').hidden||!byId('account-menu').hidden||!byId('add-menu').hidden){const opener=!byId('add-menu').hidden?byId('tools-menu'):!byId('create-menu').hidden?byId('quick-create'):byId('account-button');closePopovers();opener.focus();return;}if(byId('agent-context-menu')){closeContextMenu();return;}if(byId('avatar-picker')&&!byId('avatar-picker').hidden){e.preventDefault();byId('avatar-picker').hidden=true;byId('edit-avatar').focus();return;}if(!byId('right-pane').hidden){e.preventDefault();closePane();}});}
  function finishInteractionWiring(){
    hydrateConversationHistory();recoverInterruptedRuns();wireMessageLinks();byId('file-picker').accept=AvenAttachments.accepts.join(',');const composer=byId('composer');composer.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});composer.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();addFiles(e.dataTransfer.files);}});composer.addEventListener('paste',e=>{const files=[...e.clipboardData.items].filter(x=>x.kind==='file').map(x=>x.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();addFiles(files);}});
    wireLatestControl();
    all('[data-mode]').forEach(b=>b.onclick=()=>setChatMode(b.dataset.mode));
    byId('save-settings').addEventListener('click',()=>requestAnimationFrame(()=>{renderConversation();updateSend();}));
    setupScrollSurfaces();wireCommands();
    byId('conversation-find-input').oninput=refreshConversationFind;byId('find-prev').onclick=()=>selectFindMatch(-1);byId('find-next').onclick=()=>selectFindMatch(1);byId('find-close').onclick=()=>closeConversationFind();
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&!one('dialog[open]')&&currentView==='conversation'){e.preventDefault();openConversationFind();}else if(!byId('conversation-find').hidden&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeConversationFind();}else if(e.target===byId('conversation-find-input')&&e.key==='Enter'){e.preventDefault();selectFindMatch(e.shiftKey?-1:1);}},true);
    const legacyModePicker=byId('chat-mode');if(legacyModePicker)legacyModePicker.onchange=e=>setChatMode(e.target.value);const rail=byId('rail'),resize=byId('sidebar-resize');byId('steer').onclick=steerCurrent;expandedWidth=Number(prefs.sidebarWidth)||260;
    const setWidth=w=>{expandedWidth=Math.max(220,Math.min(380,w));prefs.sidebarWidth=expandedWidth;savePrefs();rail.style.width='';document.documentElement.style.setProperty('--rail-width',rail.classList.contains('expanded')?expandedWidth+'px':'72px');resize.setAttribute('aria-valuenow',Math.round(expandedWidth));};setWidth(expandedWidth);
    const setExpanded=open=>{rail.classList.toggle('expanded',open);byId('toggle').setAttribute('aria-expanded',String(open));byId('toggle').setAttribute('aria-label',open?'Collapse sidebar':'Expand sidebar');byId('toggle').dataset.tip=open?'Collapse sidebar':'Expand sidebar';setWidth(expandedWidth);};
    byId('toggle').onclick=()=>setExpanded(!rail.classList.contains('expanded'));if(innerWidth<=760)setExpanded(false);matchMedia('(max-width:760px)').addEventListener('change',e=>{if(e.matches)setExpanded(false);});
    resize.onpointerdown=e=>{if(!rail.classList.contains('expanded'))return;e.preventDefault();const start=e.clientX,w=expandedWidth;const move=m=>setWidth(w+m.clientX-start),stop=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',stop);};addEventListener('pointermove',move);addEventListener('pointerup',stop);};resize.onkeydown=e=>{let w=expandedWidth;if(e.key==='ArrowLeft')w-=10;else if(e.key==='ArrowRight')w+=10;else if(e.key==='Home')w=220;else if(e.key==='End')w=380;else return;e.preventDefault();setWidth(w);};
    byId('settings').hidden=true;byId('avatar').oncontextmenu=e=>{e.preventDefault();showContextMenu(currentChat()?.recipients?.[0]||prefs.activeAgent,e.clientX,e.clientY,byId('avatar'));};
    all('[data-destination]').forEach(b=>{b.onclick=()=>{const dest=b.dataset.destination;if(dest==='Search'){closePopovers();openSearch();}else if(dest==='Artifacts')openPane('artifacts');else showWorkspaceView(dest);};});
    document.addEventListener('keydown',e=>{const dialog=one('dialog[open]');if(dialog)return;const menu=byId('agent-context-menu')||['create-menu','account-menu','add-menu'].map(byId).find(n=>!n.hidden);if(menu&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=all('button',menu),i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}if(e.key==='Tab'&&!byId('right-pane').hidden&&innerWidth<=760){const nodes=all('button,input,select,textarea,a,[tabindex="0"]',byId('right-pane')).filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}},true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&one('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();one('dialog[open]').close();}},true);
    byId('search-dialog').addEventListener('cancel',()=>closePopovers());
  }
  /*
   * Direct + Teams navigation surface.
   * These overrides keep the older storage vocabulary readable while the UI
   * presents only coworker conversations and team containers.
   */
  function isDirectConversation(c){return Boolean(c&&!c.projectId&&!c.channelId&&c.recipients?.length===1);}
  function directOwner(c){return agentById(c?.recipients?.[0]);}
  function directSubtitle(c,a,duplicate){const last=[...(c.messages||[])].reverse().find(m=>!m.welcome&&typeof m.text==='string'&&m.text.trim());if(last){const preview=plainPreview(last.text);return preview.slice(0,64)+(preview.length>64?'…':'');}if(duplicate&&c.title&&c.title!==a.name)return c.title;return 'New conversation';}
  function setSurface(title,context=''){byId('surface').textContent=title;const node=byId('surface-context');if(node){node.textContent=context;node.hidden=!context;}}
  function renderCustomSection(sec,list,parent,renderRow){const wrap=document.createElement('section');wrap.className='custom-section';const header=document.createElement('div');header.className='custom-section-header';const toggle=document.createElement('button');toggle.type='button';toggle.className='custom-section-toggle';toggle.dataset.sectionToggle=sec.id;toggle.setAttribute('aria-expanded',String(!sec.collapsed));toggle.innerHTML='<span>'+esc(sec.name)+'</span><span class="section-chevron" aria-hidden="true">⌄</span>';const body=document.createElement('div');body.dataset.sectionBody=sec.id;body.className='custom-section-body';body.hidden=!!sec.collapsed;body.id='section-body-'+sec.id;toggle.setAttribute('aria-controls',body.id);toggle.onclick=()=>{const next=clone(prefs),target=next.sections.find(x=>x.id===sec.id);if(!target)return;target.collapsed=!target.collapsed;if(!save(PREF_KEY,next)){toast('Section could not be saved.');return;}prefs=next;renderSidebar();all('[data-section-toggle]').find(n=>n.dataset.sectionToggle===sec.id)?.focus();};const menu=document.createElement('button');menu.type='button';menu.dataset.sectionMenu=sec.id;menu.className='section-menu-button';menu.textContent='···';menu.setAttribute('aria-label',sec.name+' section actions');menu.onclick=e=>{e.stopPropagation();const r=menu.getBoundingClientRect();showSectionMenu(sec.id,r.left,r.bottom,menu);};header.oncontextmenu=e=>{e.preventDefault();const r=toggle.getBoundingClientRect();showSectionMenu(sec.id,e.clientX||r.left,e.clientY||r.bottom,toggle);};header.append(toggle,menu);for(const item of list)renderRow(item,body);if(!list.length)body.innerHTML='<div class="sidebar-empty">No coworkers in this section</div>';wrap.append(header,body);parent.append(wrap);}
  function threadNavMenu(c,opener,point){const direct=isDirectConversation(c),owner=directOwner(c);navMenu(opener,[{label:'Find in conversation',icon:'search',run:openConversationFind},...(direct?[{label:'Rename conversation',icon:'edit',run:()=>renameNav('chat',c)}]:[]),{label:direct?'Rename coworker':'Rename',icon:'edit',run:()=>direct?renameNav('coworker',owner):renameNav('chat',c)},{label:direct?'Open coworker profile':'Copy conversation',icon:direct?'avatar':'copy',run:direct?(()=>openProfile(owner.id)):async()=>{const text=c.messages.map(m=>{const raw=evidenceItems(m.events,m.evidence);return (m.role==='user'?'You':agentById(m.agentId||c.recipients?.[0]).name)+':\n'+(raw.length?raw.map(e=>e.output).join('\n\n'):m.text||'');}).join('\n\n');try{await navigator.clipboard.writeText(text);toast('Conversation copied.');}catch{toast('Could not access the clipboard.');}}},{label:c.pinned?'Unpin':'Pin',icon:'pin',run:()=>navCommit(()=>{setPinned(c,!c.pinned);})},{label:c.archived?'Restore chat':'Archive',icon:c.archived?'restore':'archive',disabled:!c.archived&&chatBusy(c),reason:'Finish the run and clear queued messages before archiving.',run:()=>c.archived?(navCommit(()=>{c.archived=false;}),showChat(c.id)):archiveNavChat(c)},null,{label:'Move to…',icon:'move',disabled:!!c.channelId,run:()=>moveNavChat(c)},...(direct?[{label:owner.unread?'Mark as read':'Mark as unread',icon:'more',run:()=>{owner.unread=!owner.unread;savePrefs();renderSidebar();}},{label:'Move to section…',icon:'move',run:()=>openMove(owner.id,'section',c.id)},{label:'Hide coworker from sidebar',icon:'archive',run:()=>{owner.hidden=true;savePrefs();renderSidebar();}}]:[])],point);}
  function renameNav(kind,item){const isCoworker=kind==='coworker',isTeam=kind==='team';navDialog('Rename '+(isCoworker?'coworker':isTeam?'folder':'conversation'),[{id:'nav-name',label:'Name',value:isCoworker?item.name:isTeam?item.name:item.title}],'Save',(status,dialog)=>{const name=byId('nav-name').value.trim();if(!name){status.textContent='Enter a name.';return;}if(isCoworker){const next=clone(prefs),target=next.agents.find(a=>a.id===item.id);if(!target){status.textContent='Coworker is unavailable.';return;}if(next.agents.some(a=>a.id!==item.id&&a.name.trim().toLowerCase()===name.toLowerCase())){status.textContent='Another coworker uses that name.';return;}target.name=name;if(!save(PREF_KEY,next)){status.textContent='Could not save locally. The previous name is unchanged.';return;}prefs=next;applyPrefs();renderSidebar();if(currentChat()?.recipients?.[0]===item.id&&!currentChat()?.projectId)setSurface(name);dialog.close();return;}if(navCommit(()=>{if(isTeam)item.name=name;else{item.title=name;item.autoTitle=false;}})){dialog.close();if(kind==='chat'&&data.activeChat===item.id)setSurface(isDirectConversation(item)?directOwner(item).name:item.title,projectById(item.projectId)?.name||'');if(isTeam&&currentChat()?.projectId===item.id)setSurface(currentChat().title,name);}});}
  function moveNavChat(c){navDialog('Move conversation',[{id:'nav-destination',label:'Location',value:c.projectId||'',options:[...(c.recipients?.length===1?[['','Coworkers']]:[]),...data.projects.filter(t=>t.id!=='personal'||data.chats.some(x=>x.projectId===t.id)).map(folder=>[folder.id,folder.name])]}],'Move',(status,dialog)=>{const id=byId('nav-destination').value||null;if((!id&&c.recipients?.length!==1)||c.channelId||(id&&!data.projects.some(folder=>folder.id===id))){status.textContent='Choose an existing folder or Coworkers.';return;}if(navCommit(()=>{c.projectId=id;})){dialog.close();showChat(c.id);}});}
  function editTeamMembers(team){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;const dialog=byId('workspace-create-dialog'),selected=new Set(team.members||[]);byId('workspace-create-title').textContent='Edit folder coworkers';byId('create-dialog-body').innerHTML='<form id="team-members-form" class="workspace-form"><p class="form-help">Choose the coworkers who receive new conversations in this folder.</p><fieldset><legend>Coworkers</legend><div id="team-member-options" class="member-options"></div></fieldset><p id="team-members-status" class="form-status" role="status"></p><div class="form-actions"><button type="button" id="cancel-team-members" class="button-secondary">Cancel</button><button type="submit" class="button-primary">Save coworkers</button></div></form>';const options=byId('team-member-options');prefs.agents.filter(a=>!a.hidden&&!a.archived).forEach(a=>{const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=a.id;input.checked=selected.has(a.id);label.append(input,document.createTextNode(a.name));options.append(label);});byId('cancel-team-members').onclick=()=>dialog.close();byId('close-workspace-create').onclick=()=>dialog.close();dialog.onclose=()=>byId('thread-actions')?.focus();byId('team-members-form').onsubmit=e=>{e.preventDefault();const ids=all('#team-member-options input:checked').map(n=>n.value);if(!ids.length){byId('team-members-status').textContent='Choose at least one coworker.';return;}if(navCommit(()=>{team.members=ids;})){dialog.close();}};dialog.showModal();options.querySelector('input')?.focus();}
  function newProjectChat(team){const members=[...new Set((team.members||[]).filter(id=>prefs.agents.some(a=>a.id===id&&!a.hidden&&!a.archived)))];navDialog('New conversation in '+team.name,[{id:'nav-chat-name',label:'Conversation name',value:'New conversation'}],'Create conversation',(status,dialog)=>{const name=byId('nav-chat-name').value.trim();if(!name){status.textContent='Choose a conversation name.';return;}if(!members.length){status.textContent='Add at least one coworker to this folder first.';return;}const chat={id:uid(),title:name,autoTitle:false,projectId:team.id,channelId:null,recipients:members,sample:false,draft:'',messages:[],pendingQueue:[]};if(navCommit(()=>{data.chats.unshift(chat);team.collapsed=false;})){dialog.close();showChat(chat.id);byId('draft').focus();}});}
  function teamNavMenu(team,opener,point){const chats=data.chats.filter(c=>c.projectId===team.id&&!c.channelId&&!c.archived);navMenu(opener,[{label:'New conversation',icon:'plus',run:()=>newProjectChat(team)},{label:'Rename folder',icon:'edit',run:()=>renameNav('team',team)},{label:'Edit coworkers',icon:'avatar',run:()=>editTeamMembers(team)},{label:team.pinned?'Unpin folder':'Pin folder',icon:'pin',run:()=>navCommit(()=>{setPinned(team,!team.pinned);})},null,{label:'Archive conversations',icon:'archive',disabled:chats.some(chatBusy)||!chats.length,reason:'Finish active runs and clear queued messages first.',run:()=>{if(chats.some(chatBusy))return;if(navCommit(()=>{chats.forEach(c=>c.archived=true);}))showChat(data.chats.find(c=>!c.archived)?.id);}}],point);}
  function renderDirectRow(c,parent,duplicate){const a=directOwner(c);if(!a||a.hidden||a.archived)return;const row=document.createElement('div');row.className='sidebar-row direct-row'+(c.id===data.activeChat?' is-active':'')+(c.unread||a.unread?' is-unread':'');row.dataset.directRow=c.id;row.dataset.agentRow=a.id;const open=document.createElement('button');open.type='button';open.className='agent-open direct-open';open.dataset.agentOpen=a.id;open.append(createAvatar('small',a));const copy=document.createElement('span');copy.className='direct-copy';const name=document.createElement('strong');name.className='direct-name';name.textContent=a.name;const subtitle=document.createElement('small');subtitle.className='direct-subtitle';subtitle.textContent=directSubtitle(c,a,duplicate);copy.append(name);if(duplicate&&c.title!==a.name){const title=document.createElement('small');title.className='direct-conversation-title';title.textContent=c.title;copy.append(title);}copy.append(subtitle);open.append(copy);open.title=a.name+(duplicate?' · '+c.title:'');open.onclick=()=>showChat(c.id);const controls=document.createElement('span');controls.className='nav-row-actions';const pin=navButton(c.pinned?'Unpin '+a.name:'Pin '+a.name,'pin',()=>navCommit(()=>{setPinned(c,!c.pinned);}));const archive=navButton('Archive conversation with '+a.name,'archive',()=>archiveNavChat(c));archive.disabled=chatBusy(c);if(archive.disabled)archive.title='Finish the run and clear queued messages before archiving.';controls.append(pin,archive,navButton('Conversation actions for '+a.name,'more',b=>threadNavMenu(c,b)));row.append(open,controls);row.oncontextmenu=e=>{e.preventDefault();threadNavMenu(c,open,{x:e.clientX,y:e.clientY});};parent.append(row);}
  function renderProjectNavigation(parent){const teams=[...data.projects].filter(team=>{const chats=data.chats.filter(c=>c.projectId===team.id&&!c.channelId&&!c.archived);return !(team.id==='personal'&&!chats.length);}).sort((a,b)=>pinComparator(a,b));if(!teams.length){parent.innerHTML='<div class="sidebar-empty">No grouped conversations yet.</div>';return;}for(const team of teams){const wrap=document.createElement('section');wrap.className='team-tree';const row=document.createElement('div');row.className='team-heading project-heading';const open=document.createElement('button');open.type='button';open.className='sidebar-row team-row project-row';open.dataset.teamRow=team.id;open.setAttribute('aria-expanded',String(!team.collapsed));open.innerHTML=navIcon('chevron')+icon('folder');const label=document.createElement('span');label.className='sidebar-row-label';label.textContent=team.name;open.append(label);if(team.pinned){const pin=document.createElement('span');pin.className='pin-marker';pin.innerHTML=navIcon('pin');open.append(pin);}open.onclick=()=>navCommit(()=>{team.collapsed=!team.collapsed;});const actions=document.createElement('span');actions.className='nav-row-actions';actions.append(navButton('Folder actions for '+team.name,'more',b=>teamNavMenu(team,b)),navButton('New conversation in '+team.name,'plus',()=>newProjectChat(team)));row.append(open,actions);row.oncontextmenu=e=>{e.preventDefault();teamNavMenu(team,open,{x:e.clientX,y:e.clientY});};wrap.append(row);const list=document.createElement('div');list.className='team-conversations project-conversations';list.hidden=!!team.collapsed;const chats=data.chats.filter(c=>c.projectId===team.id&&!c.channelId&&!c.archived).sort((a,b)=>pinComparator(a,b));for(const c of chats){const line=document.createElement('div');line.className='thread-row'+(c.id===data.activeChat?' is-active':'');const item=document.createElement('button');item.type='button';item.className='sidebar-row thread-open';item.dataset.conversationRow=c.id;const title=document.createElement('span');title.className='sidebar-row-label';title.textContent=c.title;item.title=c.title;item.append(title);if(c.pinned){const pin=document.createElement('span');pin.className='pin-marker';item.append(pin);}item.onclick=()=>showChat(c.id);const controls=document.createElement('span');controls.className='nav-row-actions';const pin=navButton(c.pinned?'Unpin '+c.title:'Pin '+c.title,'pin',()=>navCommit(()=>{setPinned(c,!c.pinned);}));const archive=navButton('Archive '+c.title,'archive',()=>archiveNavChat(c));archive.disabled=chatBusy(c);if(archive.disabled)archive.title='Finish the run and clear queued messages before archiving.';controls.append(pin,archive,navButton('Conversation actions for '+c.title,'more',b=>threadNavMenu(c,b)));line.append(item,controls);line.oncontextmenu=e=>{e.preventDefault();threadNavMenu(c,item,{x:e.clientX,y:e.clientY});};list.append(line);}if(!chats.length)list.innerHTML='<div class="sidebar-empty">No conversations yet</div>';wrap.append(list);parent.append(wrap);}}
  function renderSidebar(){const direct=byId('direct-list'),teams=byId('team-list');if(!direct||!teams)return;direct.replaceChildren();teams.replaceChildren();const chats=data.chats.filter(c=>!c.archived&&isDirectConversation(c)&&prefs.agents.some(a=>a.id===c.recipients?.[0]&&!a.hidden&&!a.archived));const duplicateCounts=new Map();chats.forEach(c=>{const id=c.recipients[0];duplicateCounts.set(id,(duplicateCounts.get(id)||0)+1);});const row=(c,parent)=>renderDirectRow(c,parent,duplicateCounts.get(c.recipients[0])>1);const pinned=chats.filter(c=>c.pinned||directOwner(c).pinned).sort(directPinComparator),custom=chats.filter(c=>!pinned.includes(c)&&directOwner(c).sectionId);const section=(label,list,sec)=>{if(sec){renderCustomSection(sec,list,direct,row);return;}if(!list.length)return;const h=document.createElement('div');h.className='sidebar-section-label';h.textContent=label;direct.append(h);list.forEach(c=>row(c,direct));};section('Pinned',pinned);chats.filter(c=>!pinned.includes(c)&&!directOwner(c).sectionId).forEach(c=>row(c,direct));for(const sec of prefs.sections)section(sec,custom.filter(c=>directOwner(c).sectionId===sec.id),sec);if(!chats.length&&!prefs.sections.length)direct.innerHTML='<div class="sidebar-empty">No coworker conversations. Create a coworker with +.</div>';renderProjectNavigation(teams);byId('thread-actions').onclick=e=>threadNavMenu(currentChat(),e.currentTarget);all('[data-group-toggle]').forEach(t=>{t.onclick=()=>{const l=one('[data-group-list="'+t.dataset.groupToggle+'"]'),open=t.getAttribute('aria-expanded')!=='true';t.setAttribute('aria-expanded',String(open));if(l)l.hidden=!open;};});}
  function showArchived(){openSettings('archived');}
  const NAV_KEY='aven-conversation-navigation-v1';
  let conversationHistory={entries:[],index:0},navigationReady=false,navigationStorageWarned=false;
  function saveConversationHistory(){try{sessionStorage.setItem(NAV_KEY,JSON.stringify(conversationHistory));}catch{if(!navigationStorageWarned){navigationStorageWarned=true;toast('Navigation works for this page; browser session storage is unavailable.');}}}
  function updateNavigationButtons(){
    if(!byId('chat-back'))return;byId('chat-back').disabled=!navigationReady||conversationHistory.index<=0;byId('chat-forward').disabled=!navigationReady||conversationHistory.index>=conversationHistory.entries.length-1;
  }
  function hydrateConversationHistory(){
    let reset=false;
    try{const raw=sessionStorage.getItem(NAV_KEY);if(raw){const value=JSON.parse(raw);if(!Array.isArray(value.entries)||value.entries.length>100||!Number.isInteger(value.index)||value.index<0||value.index>=value.entries.length)throw Error('Invalid navigation');
      for(const entry of value.entries)if(!entry||typeof entry.chatId!=='string'||!Number.isFinite(entry.scrollTop)||entry.scrollTop<0||entry.scrollTop>100000000||!data.chats.some(c=>c.id===entry.chatId))throw Error('Unavailable navigation');
      if(value.entries[value.index].chatId!==data.activeChat)throw Error('Different workspace');conversationHistory=value;
    }}catch{reset=true;}
    if(!conversationHistory.entries.length||reset)conversationHistory={entries:[{chatId:data.activeChat,scrollTop:0}],index:0};navigationReady=true;saveConversationHistory();updateNavigationButtons();if(reset)toast('Navigation history was reset. Saved conversations and drafts are unchanged.');
    byId('chat-back').onclick=()=>navigateConversationHistory(-1);byId('chat-forward').onclick=()=>navigateConversationHistory(1);
  }
  function recordConversationVisit(chat,options){
    if(!navigationReady)return;
    const entry=conversationHistory.entries[conversationHistory.index];if(entry&&entry.chatId===renderedChatId)entry.scrollTop=byId('center-content').scrollTop;
    if(options.navigation!==false&&entry?.chatId!==chat.id){conversationHistory.entries=conversationHistory.entries.slice(0,conversationHistory.index+1);conversationHistory.entries.push({chatId:chat.id,scrollTop:0});if(conversationHistory.entries.length>100)conversationHistory.entries.shift();conversationHistory.index=conversationHistory.entries.length-1;}
    saveConversationHistory();updateNavigationButtons();
  }
  function navigateConversationHistory(direction){
    let target=conversationHistory.index+direction;
    while(target>=0&&target<conversationHistory.entries.length&&!data.chats.some(c=>c.id===conversationHistory.entries[target].chatId))target+=direction;
    if(target<0||target>=conversationHistory.entries.length){toast('No saved conversation in that direction.');return;}
    const entry=conversationHistory.entries[target];if(!showChat(entry.chatId,{navigation:false,scrollTop:entry.scrollTop}))return;
    conversationHistory.index=target;saveConversationHistory();updateNavigationButtons();byId('center-content').focus({preventScroll:true});
  }
  function showChat(id=data.activeChat,options={}){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return false;retainDraft();const c=data.chats.find(x=>x.id===id)||data.chats.find(x=>!x.archived)||data.chats[0];if(!c)return false;if(renderedChatId!==c.id){closeConversationFind(false);if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return false;resetToolContext();}recordConversationVisit(c,options);c.unread=false;if(isDirectConversation(c))directOwner(c).unread=false;data.activeChat=c.id;renderedChatId=c.id;currentView='conversation';if(c.recipients?.[0]&&prefs.agents.some(a=>a.id===c.recipients[0]))prefs.activeAgent=c.recipients[0];saveUnrelatedData();savePrefs();applyPrefs();clearCenter();byId('conversation').hidden=false;byId('composer-wrap').hidden=!!c.archived;const team=c.projectId?projectById(c.projectId):null;setSurface(isDirectConversation(c)?directOwner(c).name:c.title,team?.name||'');renderConversation();renderComposer();renderSidebar();if(!byId('right-pane').hidden){if(paneView==='agent'||paneView==='profile')renderAgentPane();else if(paneView==='artifacts')renderArtifactsPane();else if(['annotate','compare'].includes(paneView))closePane(true);else renderToolPane(paneView);}if(innerWidth<=760)closePane(true);requestAnimationFrame(()=>{if(currentView==='conversation'&&currentChat()?.id===c.id){const scroll=byId('center-content');scroll.scrollTop=Number.isFinite(options.scrollTop)?options.scrollTop:scroll.scrollHeight;updateLatestControl();}});return true;}
  function openAgentConversation(id){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;retainDraft();const a=agentById(id);prefs.activeAgent=id;a.unread=false;savePrefs();const existing=data.chats.filter(c=>!c.archived&&isDirectConversation(c)&&c.recipients[0]===id);if(existing.length){showChat(existing.find(c=>c.id===data.activeChat)?.id||existing[0].id);return;}const welcome={id:uid(),role:'assistant',agentId:id,text:'Hi, I’m '+a.name+'. I’m ready to help with your network work.',welcome:true,createdAt:now()};const c={id:uid(),title:a.name,autoTitle:false,sample:false,channelId:null,projectId:null,recipients:[id],draft:'',pendingAttachmentNames:[],messages:[welcome],pendingQueue:[]};data.chats.unshift(c);if(!saveData()){data.chats.shift();toast('Could not save this coworker locally.');return;}showChat(c.id);}
  function createWorkspace(type,editId=null){if(type==='agent-edit'){openProfile(editId);return;}if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;const isCoworker=type==='agent'||type==='coworker',isTeam=type==='team'||type==='project'||type==='channel';if(!isCoworker&&!isTeam)return;closePopovers();retainDraft();createReturnChat=data.activeChat;createSucceeded=false;createOpener=document.activeElement;const dialog=byId('workspace-create-dialog'),body=byId('create-dialog-body'),label=isCoworker?'coworker':'team';byId('workspace-create-title').textContent='New '+label;let html='<form class="workspace-form" id="workspace-create-form"><label for="workspace-create-name">Name</label><input id="workspace-create-name" maxlength="80" required autocomplete="off" placeholder="'+(isTeam?'For example: Network operations':'For example: Firewall specialist')+'">';if(isCoworker)html+='<label for="workspace-create-role">Focus</label><textarea id="workspace-create-role" maxlength="1500" required placeholder="What should this coworker help with?"></textarea>';if(isTeam)html+='<fieldset><legend>Coworkers</legend><div id="workspace-create-members" class="member-options">'+prefs.agents.filter(a=>!a.hidden&&!a.archived).map(a=>'<label><input type="checkbox" value="'+esc(a.id)+'" '+(a.id===prefs.activeAgent?'checked':'')+'>'+esc(a.name)+'</label>').join('')+'</div></fieldset>';body.innerHTML=html+'<p id="workspace-create-status" class="form-status" role="status"></p><div class="form-actions"><button class="button-secondary" id="cancel-workspace-create" type="button">Cancel</button><button class="button-primary" id="finish-workspace-create" type="submit">Create '+label+'</button></div></form>';byId('cancel-workspace-create').onclick=()=>dialog.close();byId('close-workspace-create').onclick=()=>dialog.close();byId('workspace-create-form').onsubmit=e=>{e.preventDefault();finishWorkspaceCreate(type);};dialog.onclose=()=>{if(!createSucceeded)showChat(createReturnChat);if(createOpener?.isConnected)createOpener.focus();};dialog.showModal();byId('workspace-create-name').focus();}
  function finishWorkspaceCreate(type){const isCoworker=type==='agent'||type==='coworker',isTeam=type==='team'||type==='project'||type==='channel',name=byId('workspace-create-name')?.value.trim(),status=byId('workspace-create-status');if(!name)return;if(isCoworker){const role=byId('workspace-create-role')?.value.trim();if(!role){status.textContent='Describe the coworker focus.';return;}const pendingRecovery=recoverPendingCoworkerCreate(localStorage);if(!pendingRecovery.ok){coworkerCreationRecoveryBlocked=true;const message='Could not recover the previous local creation. A pending coworker change is still retained. Reload after browser storage is available.';status.textContent=message;toast(message);return;}coworkerCreationRecoveryBlocked=false;if(prefs.agents.some(a=>a.name.toLowerCase()===name.toLowerCase())){status.textContent='Choose a different name.';return;}const before={prefs:clone(prefs),data:clone(data),docs:clone(docs)},nextPrefs=clone(prefs),nextData=clone(data),nextDocs=clone(docs),a={id:uid(),name,role,description:role,label:'',notifications:true,timezone:'Follow system',autoReview:false,hidden:false,archived:false,pinned:false,unread:false,sectionId:''},welcome={id:uid(),role:'assistant',agentId:a.id,text:'Hi, I’m '+name+'. I’m ready to help with your network work.',welcome:true,createdAt:now()},c={id:uid(),title:name,autoTitle:false,sample:false,channelId:null,projectId:null,recipients:[a.id],draft:'',pendingAttachmentNames:[],messages:[welcome],pendingQueue:[]};nextPrefs.agents.push(a);nextPrefs.activeAgent=a.id;nextData.chats.unshift(c);nextData.activeChat=c.id;nextDocs[a.id]={'SOUL.md':'# '+name+'\n\nDescribe the coworker\'s tone and boundaries.','MEMORY.md':''};if(localStorage.getItem(CHAT_KEY)!==savedWorkspace||data.chats.some(chat=>chat.pendingAdmission)){status.textContent='Review saved requests and reload changed work before creating a coworker.';return;}const result=persistCoworkerCreation(localStorage,{prefs:nextPrefs,data:nextData,docs:nextDocs});if(!result.ok){prefs=before.prefs;data=before.data;docs=before.docs;if(result.pending)coworkerCreationRecoveryBlocked=true;const message=result.pending?'Could not save this coworker locally. A previous local creation is pending recovery. Reload after browser storage is available.':'Could not save this coworker locally.';status.textContent=message;toast(message);return;}prefs=nextPrefs;data=nextData;docs=nextDocs;savedWorkspace=localStorage.getItem(CHAT_KEY);createSucceeded=true;byId('workspace-create-dialog').close();showChat(c.id);byId('draft').focus();return;}if(isTeam){const members=[...new Set(all('#workspace-create-members input:checked').map(n=>n.value))];if(!members.length){status.textContent='Choose at least one coworker.';return;}if(data.projects.some(team=>team.name.toLowerCase()===name.toLowerCase())){status.textContent='Choose a different name.';return;}const team={id:uid(),name,members,collapsed:false,pinned:false};const chat={id:uid(),title:name,projectId:team.id,channelId:null,recipients:members,sample:false,draft:'',messages:[],pendingQueue:[]};data.projects.push(team);data.chats.unshift(chat);if(!saveData()){data.projects.pop();data.chats.shift();status.textContent='Could not save this folder locally.';return;}createSucceeded=true;byId('workspace-create-dialog').close();showChat(chat.id);}}
  function openProfile(id=prefs.activeAgent,chooseAvatar=false){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;closePopovers();profileAgentId=id;prefs.activeAgent=id;savePrefs();applyPrefs();const a=agentById(id);profileDraft={name:a.name,label:a.label||'',description:a.description??a.role??'',notifications:a.notifications!==false,avatar:AvenAvatars.config(a)};profileOriginal=JSON.stringify(profileDraft);profileGeneration++;profileAvatarBusy=false;avatarTab='styles';paneView='profile';if(byId('right-pane').hidden)paneOpener=document.activeElement;byId('right-pane').hidden=false;byId('pane-title').textContent=a.name;all('[data-pane]').forEach(n=>n.setAttribute('aria-selected',String(n.dataset.pane==='agent')));renderProfile();syncPaneModal();if(chooseAvatar)openAvatarPicker();}
  function syncAgentIdentity(id){const a=agentById(id);for(const row of all('[data-agent-row]').filter(n=>n.dataset.agentRow===id)){one('.network-avatar',row)?.replaceWith(createAvatar('small',a));const label=one('.sidebar-row-label',row);if(label)label.textContent=a.name;one('[data-agent-menu]',row)?.setAttribute('aria-label',a.name+' actions');}for(const row of all('[data-direct-row]').filter(n=>n.dataset.agentRow===id)){const name=one('.direct-name',row);if(name)name.textContent=a.name;const open=one('.direct-open',row);if(open)open.title=a.name;}if(currentChat()?.recipients?.[0]===id&&!currentChat()?.projectId)setSurface(a.name);if(!byId('right-pane').hidden&&paneView==='profile')byId('pane-title').textContent=a.name;}
  function searchChatLabel(c){return (isDirectConversation(c)?directOwner(c).name+' · ':'')+c.title+(c.archived?' · Archived':'');}
  function searchSnippet(text,query){const plain=plainPreview(text),at=plain.toLocaleLowerCase().indexOf(query),start=Math.max(0,at-55);return (start?'…':'')+plain.slice(start,start+210)+(plain.length>start+210?'…':'');}
  function renderSearch(){
    const q=byId('global-search').value.trim().toLocaleLowerCase(),cat=one('[data-search-category][aria-pressed="true"]')?.dataset.searchCategory||'All',coworker=byId('search-coworker').value,chatId=byId('search-conversation').value,res=[];
    const add=(kind,name,detail,cb,id)=>{if((cat==='All'||cat===kind)&&`${name} ${detail}`.toLocaleLowerCase().includes(q))res.push({kind,name,detail,cb,id});};
    const chats=data.chats.filter(c=>(!coworker||c.recipients.includes(coworker))&&(!chatId||c.id===chatId));
    chats.forEach(c=>{
      const label=searchChatLabel(c);add('Conversations',label,`${c.messages.length} saved messages`,()=>showChat(c.id),c.id);
      c.messages.forEach(m=>{
        const open=()=>openMessageContext(c.id,m.id);add('Messages',m.text||'Attachment message',label,open,m.id);
        (m.attachments||[]).forEach(n=>add('Files',n,label,open,m.id));
        (m.text||'').match(/https?:\/\/[^\s<>]+/g)?.forEach(url=>add('Links',url,label,open,m.id));
      });
    });
    if(!chatId)prefs.agents.filter(a=>!coworker||a.id===coworker).forEach(a=>add('Coworkers',a.name,a.role,()=>openAgentConversation(a.id),a.id));
    if(!coworker&&!chatId)data.projects.filter(folder=>data.chats.some(c=>c.projectId===folder.id)).forEach(folder=>add('Folders',folder.name,`${(folder.members||[]).length} coworkers`,()=>showChat(data.chats.find(c=>c.projectId===folder.id)?.id),folder.id));
    const list=byId('search-results');list.replaceChildren();byId('search-count').textContent=res.length+' local results';
    if(!res.length){const p=document.createElement('p');p.className='search-empty';p.textContent='No matching local records. Try another phrase or clear the filters.';list.append(p);return;}
    res.forEach(r=>{const b=document.createElement('button');b.type='button';b.className='search-result';b.dataset.resultId=r.id;const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small'),kind=document.createElement('span');name.textContent=searchSnippet(r.name,q);detail.textContent=r.detail;kind.className='result-kind';kind.textContent=r.kind;text.append(name,detail);b.append(text,kind);b.onclick=()=>{searchOpener=null;byId('search-dialog').close();r.cb();};list.append(b);});
  }
  function populateSearchScope(){
    const coworker=byId('search-coworker').value,select=byId('search-conversation'),previous=select.value;select.replaceChildren(new Option('All conversations',''));
    data.chats.filter(c=>!coworker||c.recipients.includes(coworker)).forEach(c=>select.add(new Option(searchChatLabel(c),c.id)));
    if([...select.options].some(o=>o.value===previous))select.value=previous;
  }
  function openSearch(){
    searchOpener=document.activeElement;const d=byId('search-dialog'),cats=['All','Messages','Conversations','Coworkers','Folders','Files','Links'];
    byId('search-filters').replaceChildren(...cats.map(cat=>{const b=document.createElement('button');b.type='button';b.textContent=cat;b.dataset.searchCategory=cat;b.setAttribute('aria-pressed',String(cat==='All'));b.onclick=()=>{all('[data-search-category]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderSearch();};return b;}));
    const coworkers=byId('search-coworker');coworkers.replaceChildren(new Option('All coworkers',''));prefs.agents.forEach(a=>coworkers.add(new Option(a.name,a.id)));
    byId('search-conversation').replaceChildren();populateSearchScope();coworkers.onchange=()=>{populateSearchScope();renderSearch();};byId('search-conversation').onchange=renderSearch;
    byId('search-clear').onclick=()=>{byId('global-search').value='';coworkers.value='';byId('search-conversation').value='';populateSearchScope();all('[data-search-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.searchCategory==='All')));renderSearch();byId('global-search').focus();};
    byId('global-search').value='';renderSearch();d.showModal();byId('global-search').focus();
  }
  function renderArchivedSettings(){const p=byId('settings-content');const chats=data.chats.filter(c=>c.archived);p.innerHTML='<h2>Archived conversations</h2><p>Archived conversations stay read-only until you restore them.</p><div class="archived-settings-list"></div>';const list=one('.archived-settings-list',p);if(!chats.length){list.innerHTML='<p class="search-empty">No archived conversations.</p>';return;}chats.forEach(c=>{const row=document.createElement('div');row.className='archived-row';const text=document.createElement('div');const name=document.createElement('strong');name.textContent=isDirectConversation(c)?directOwner(c).name:c.title;const detail=document.createElement('small');detail.textContent=isDirectConversation(c)?(c.title===directOwner(c).name?'Conversation with coworker':c.title):(projectById(c.projectId)?.name||'Conversation in folder');text.append(name,detail);const restore=navButton('Restore '+c.title,'restore',()=>{if(navCommit(()=>{c.archived=false;})){renderArchivedSettings();}});row.append(text,restore);list.append(row);});}
  function renderAgentsSettings(){const p=byId('settings-content');p.innerHTML='<h2>Coworkers</h2><p>Hidden coworkers can be restored here. Conversations and documents remain local.</p><div class="agent-settings-list"></div><h3>New coworker</h3><button class="button-secondary" id="settings-create-agent" type="button">Create a coworker in workspace</button>';const list=one('.agent-settings-list',p);prefs.agents.forEach(a=>{const card=document.createElement('div');card.className='agent-setting-card';card.innerHTML=`<div><strong>${esc(a.name)}</strong><p>${esc(a.role)}</p></div><button type="button" data-select-agent="${esc(a.id)}">${a.id===prefs.activeAgent?'Selected':'Select'}</button>${a.hidden||a.archived?`<button type="button" data-restore-agent="${esc(a.id)}">Restore</button>`:''}`;list.append(card);});all('[data-select-agent]',p).forEach(b=>b.onclick=()=>{prefs.activeAgent=b.dataset.selectAgent;savePrefs();applyPrefs();renderAgentsSettings();renderSidebar();});all('[data-restore-agent]',p).forEach(b=>b.onclick=()=>{const a=agentById(b.dataset.restoreAgent);a.hidden=false;a.archived=false;savePrefs();renderAgentsSettings();renderSidebar();});byId('settings-create-agent').onclick=()=>{byId('settings-dialog').close();createWorkspace('agent');};}
  function downloadLocal(name,text,type='application/json'){
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function workspaceEnvelope(){return AvenWorkspaceBackup.envelope(prefs,data,docs,UI_BUILD);}
  function exportEvidence(m){
    const items=[],seen=new Set();const add=e=>{if(!e||typeof e!=='object')return;if(e.evidence)(Array.isArray(e.evidence)?e.evidence:[e.evidence]).forEach(add);if(typeof e.output!=='string')return;const key=JSON.stringify([e.command||e.operation||e.name,e.target||e.hostname,e.status,e.output]);if(!seen.has(key)){seen.add(key);items.push({...e,command:e.command||e.operation||e.name,target:e.target||e.hostname});}};(m.events||[]).forEach(add);(m.evidence||[]).forEach(add);return items;
  }
  function exportMarkdown(){
    const c=currentChat(),parts=['# '+c.title,'Exported from Aven · '+now(),'Local conversation only. Attachment contents are not included.'];
    if(c.forkedFrom)parts.push('Fork origin: '+c.forkedFrom.title+' / '+c.forkedFrom.chatId+' / '+c.forkedFrom.messageId);
    for(const m of c.messages){parts.push('## '+(m.role==='user'?'You':agentById(m.agentId).name)+(m.createdAt?' · '+m.createdAt:''));if(m.replyTo)parts.push('Reply to '+m.replyTo.author+':\n> '+m.replyTo.text.replace(/\n/g,'\n> '));parts.push(m.text||'');if(m.runId)parts.push('Run ID: '+m.runId+' · Message ID: '+m.id+' · Model: '+(m.model||'Unavailable'));for(const item of exportEvidence(m)){const fence='`'.repeat(Math.max(3,...(item.output.match(/`+/g)||[]).map(s=>s.length+1)));parts.push('Raw output · '+[item.command,item.target,item.status,item.source,item.time||item.startedAt].filter(Boolean).join(' · ')+'\n'+fence+'text\n'+item.output+'\n'+fence);}if(m.attachments?.length)parts.push('Attachment names: '+m.attachments.join(', '));}
    downloadLocal('aven-conversation-'+c.id+'.md',parts.join('\n\n'),'text/markdown');
  }
  function renderDataSettings(){
    const p=byId('settings-content');p.innerHTML='<h2>Privacy &amp; data</h2><p>Conversation history is stored in this browser; the local service also retains diagnostic run records. Sending a message shares recent conversation text and relevant diagnostic evidence with OpenCode. Local coworker notes and files opened in the file editor are not sent. Text attachments are sent only when you press Send; their contents then become saved conversation text.</p><h3>Local backup</h3><p>Exports include conversations, drafts, raw device output and local coworker notes. Keep the file private. Backend credentials and active run controls are not included. Text attachments already sent are included as conversation text; unsent file contents are not saved or exported.</p><div class="data-actions"><button id="export-workspace" type="button">Export workspace JSON</button><button id="export-markdown" type="button">Export this conversation</button><button id="download-recovery" type="button">Download pre-import backup</button></div><h3>Restore a workspace</h3><p>Choose an Aven JSON backup up to 10 MiB. Add restored conversations as separate copies, or replace the whole workspace. Imported queues stay paused and imported connection permissions stay off.</p><input id="import-workspace" type="file" accept=".json,application/json" aria-label="Choose Aven backup"><div id="import-preview" hidden><p id="import-summary"></p><p>Add keeps your current work and preferences. Replace overwrites local conversations, notes and preferences. Both save a pre-import backup.</p><button type="button" id="add-import">Add restored conversations</button><button type="button" id="confirm-import">Replace local workspace</button><button type="button" id="cancel-import">Cancel import</button></div><p id="backup-status" role="status"></p>';
    const status=byId('backup-status'),preview=byId('import-preview');let pending=null,selection=0;
    byId('export-workspace').onclick=()=>{try{retainDraft();downloadLocal('aven-workspace-'+new Date().toISOString().slice(0,10)+'.json',AvenWorkspaceBackup.serialize(workspaceEnvelope()));status.textContent='Workspace export prepared.';}catch(error){status.textContent=error.message||'Could not prepare the export.';}};
    byId('export-markdown').onclick=exportMarkdown;
    byId('download-recovery').disabled=!localStorage.getItem(AvenWorkspaceBackup.BACKUP);
    byId('download-recovery').onclick=()=>{try{const backup=JSON.parse(localStorage.getItem(AvenWorkspaceBackup.BACKUP));downloadLocal('aven-pre-import-backup.json',AvenWorkspaceBackup.serialize(backup.envelope));}catch{status.textContent='The local recovery backup could not be read.';}};
    const busy=()=>data.chats.some(c=>c.pendingAdmission)||chatRequests.size>0||hasUnsavedPaneChanges();
    byId('import-workspace').onchange=async e=>{
      const ticket=++selection;pending=null;preview.hidden=true;status.textContent='';const file=e.target.files[0];if(!file)return;
      if(busy()){status.textContent='Finish active runs and save or close profile editors before importing.';return;}
      try{if(file.size>AvenWorkspaceBackup.MAX_BYTES)throw Error('Backup exceeds the 10 MiB import limit.');const value=AvenWorkspaceBackup.parse(await file.text());if(ticket!==selection||!status.isConnected)return;pending=value;byId('import-summary').textContent=file.name+' · '+value.prefs.agents.length+' coworkers · '+value.data.chats.length+' conversations · '+value.data.chats.reduce((n,c)=>n+c.messages.length,0)+' messages';preview.hidden=false;}catch(error){if(ticket===selection)status.textContent=error.message;}
    };
    byId('cancel-import').onclick=()=>{selection++;pending=null;preview.hidden=true;byId('import-workspace').value='';status.textContent='Import cancelled. Your workspace is unchanged.';};
    const restore=async mode=>{
      if(!pending)return;
      try{await withAdmissionWriter(null,()=>{
        if(localStorage.getItem(CHAT_KEY)!==savedWorkspace)throw Error('Workspace changed in another tab. Reload before restoring a workspace.');
        const pendingRecovery=recoverPendingCoworkerCreate(localStorage);if(!pendingRecovery.ok){coworkerCreationRecoveryBlocked=true;throw Error('An unfinished coworker creation is pending recovery. Reload after browser storage is available before restoring a workspace.');}coworkerCreationRecoveryBlocked=false;
        if(localStorage.getItem(CHAT_KEY)!==savedWorkspace)throw Error('Workspace changed during recovery. Reload before restoring a workspace.');
        if(!pending||busy())throw Error('Finish active runs and save or close profile editors before importing.');
        AvenWorkspaceBackup.replace(localStorage,pending,workspaceEnvelope(),mode);status.textContent='Workspace restored. Reloading…';location.reload();
      });}
      catch(error){status.textContent=error.message;byId('download-recovery').disabled=!localStorage.getItem(AvenWorkspaceBackup.BACKUP);}
    };
    byId('add-import').onclick=()=>restore('add');byId('confirm-import').onclick=()=>restore('replace');
  }
  const notifiedRuns=new Set();
  function notifyRun(c,m,a){
    const key=c.id+'/'+m.id+'/'+(m.runId||m.journalId||'');if(notifiedRuns.has(key)||a.notifications===false)return;notifiedRuns.add(key);const box=byId('toast');box.replaceChildren();const text=document.createElement('span');text.textContent=a.name+' finished. ';const open=document.createElement('button');open.type='button';open.textContent='Open result';open.onclick=()=>{openMessageContext(c.id,m.id);box.replaceChildren();};const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss completion notice');close.onclick=()=>box.replaceChildren();box.append(text,open,close);
  }
  function recoverInterruptedRuns(){
    const prepared=c=>c.queueDispatching&&c.messages.at(-1)?.role==='user'&&c.messages.at(-1)?.queuedFrom===c.queueDispatching;
    if(!data.chats.some(c=>c.runJournal||prepared(c)))return;
    for(const c of data.chats){if(c.pendingAdmission)continue;if(!c.runJournal){if(prepared(c)){const before=clone(c),m=c.messages.pop();c.pendingQueue=[{id:m.queuedFrom,text:m.text,mode:modeFor(m.mode),replyTo:m.replyTo,createdAt:m.createdAt},...(c.pendingQueue||[])];delete c.queueDispatching;c.queuePaused=true;c.queuePauseReason='A queued message was prepared but not dispatched. Review and resume explicitly.';if(!saveData()){Object.assign(c,before);c.captureWarning='Prepared queue recovery could not be saved.';}}continue;}const before=clone(c);let recovered;try{recovered=AvenRunState.recover(c,prefs.agents.some(a=>a.id===c.runJournal.agentId)?c.runJournal.agentId:c.recipients[0]);}catch{recovered={invalid:true};}
      if(recovered?.invalid){c.captureWarning='Saved run capture is invalid. Keep browser data and export a backup for recovery.';c.queuePaused=true;continue;}
      if(recovered&&!recovered.duplicate)c.messages.push(recovered);delete c.runJournal;delete c.queueDispatching;delete c.captureWarning;c.queuePaused=true;c.queuePauseReason='Previous session interrupted. Review captured evidence; resume queued work explicitly.';
      if(!saveData()){Object.assign(c,before);c.captureWarning='Interrupted run could not be recovered because browser storage is unavailable.';}
    }renderConversation();updateSend();
  }
  function wireMessageLinks(){
    const open=()=>{if(!location.hash)return;const args=new URLSearchParams(location.hash.slice(1)),chatId=args.get('chat'),messageId=args.get('message');if(!chatId)return;const c=data.chats.find(c=>c.id===chatId);if(!c){toast('This linked conversation is unavailable in this browser workspace.');return;}if(c.archived){toast('This linked conversation is archived. Restore it in Settings → Archived chats.');return;}if(messageId&&!c.messages.some(m=>m.id===messageId)){toast('This linked message is unavailable. The conversation is still saved.');return;}if(messageId)openMessageContext(c.id,messageId);else showChat(c.id);};window.addEventListener('hashchange',open);open();
  }
  function renderLocalDiagnostics(container,onStatus){return AvenDiagnostics.render(container,{build:UI_BUILD,chatId:currentChat()?.id,onDownload:downloadLocal,onStatus});}
  function showBuildInfo(){
    showInfo('About Aven','<h3>A workspace for network coworkers</h3><dl class="build-info"><dt>UI build</dt><dd>'+UI_BUILD+'</dd><dt>Updated</dt><dd>'+UI_BUILD_DATE+'</dd><dt>Storage</dt><dd>This browser · workspace backup version '+AvenWorkspaceBackup.VERSION+'</dd><dt>Chat connection</dt><dd id="about-chat-connection">Unknown · local status not checked</dd></dl><p class="setting-help">This identifies the loaded UI. Connection details update from the local status check; they do not confirm provider or device reachability. Export and recovery are available under Settings → Privacy &amp; data.</p><button type="button" id="copy-build-info">Copy build details</button>');
    const connectionRow=byId('about-chat-connection');const diagnostics=document.createElement('section');byId('info-dialog-body').append(diagnostics);renderLocalDiagnostics(diagnostics,snapshot=>{const row=connectionRow;if(!row?.isConnected)return;if(snapshot?.state==='unavailable'){row.textContent='Unavailable · local status unavailable';return;}if(snapshot?.state==='checking'||snapshot?.state==='unknown'){row.textContent='Unknown · local status not checked';return;}const provider=typeof snapshot?.provider==='string'&&snapshot.provider.trim()?snapshot.provider:'Unavailable';const model=typeof snapshot?.model==='string'&&snapshot.model.trim()?snapshot.model:'Unavailable';row.textContent=provider+' · '+model+' ('+(snapshot?.configured===true?'configured':'not configured')+'; reachability unverified)';});
    byId('copy-build-info').onclick=async()=>{try{await navigator.clipboard.writeText('Aven UI '+UI_BUILD+'\nUpdated '+UI_BUILD_DATE+'\nLocal workspace backup v'+AvenWorkspaceBackup.VERSION);byId('copy-build-info').textContent='Copied';}catch{byId('copy-build-info').textContent='Copy failed';}};
  }
  function renderSettingsPage(){all('[data-category]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.category===settingsPage)));const p=byId('settings-content');p.replaceChildren();if(settingsPage==='general')p.innerHTML='<h2>General</h2><p>Local workspace preferences. No account is connected.</p><label for="pref-display-name">Display name</label><input id="pref-display-name" data-pref="displayName" maxlength="80" placeholder="Vikas">';if(settingsPage==='appearance')p.innerHTML='<h2>Appearance</h2><p>Choose the visual language for this workspace.</p><label for="pref-theme">Theme</label><select id="pref-theme" data-pref="theme"><option value="system">Follow System</option><option value="light">Light</option><option value="dark">Dark</option></select><label for="pref-accent">Accent</label><select id="pref-accent" data-pref="accent"><option value="black">Black</option><option value="blue">Blue</option><option value="violet">Violet</option><option value="green">Green</option></select><label for="pref-density">Density</label><select id="pref-density" data-pref="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><label for="pref-language">Language</label><select id="pref-language" data-pref="language"><option value="system">English (system fallback)</option><option value="en">English</option><option value="unsupported" disabled>Other languages (not supported)</option></select>';if(settingsPage==='presentation')p.innerHTML='<h2>Conversation details</h2><p>Keep the conversation focused. Turn on the detail groups you want to see below answers.</p><label class="setting-check" for="pref-show-evidence"><input id="pref-show-evidence" type="checkbox" data-pref="showEvidence"> <span>Show raw evidence</span></label><label class="setting-check" for="pref-show-investigation"><input id="pref-show-investigation" type="checkbox" data-pref="showInvestigation"> <span>Show investigation activity</span></label><label class="setting-check" for="pref-show-run-details"><input id="pref-show-run-details" type="checkbox" data-pref="showRunDetails"> <span>Show run details</span></label><p class="setting-help">Raw outputs stay copy-exact. These switches only change what the chat presents.</p>';if(settingsPage==='coworkers')renderAgentsSettings();if(settingsPage==='behavior')renderBehaviorSettings();if(settingsPage==='models')renderProviderSettings(p);if(settingsPage==='connections')renderLocalDiagnostics(p);if(settingsPage==='data')renderDataSettings();if(settingsPage==='archived')renderArchivedSettings();all('#settings-content [data-pref]').forEach(n=>{if(n.type==='checkbox')n.checked=!!settingsDraft[n.dataset.pref];else n.value=settingsDraft[n.dataset.pref]??'';});}
  function openSettings(page='general'){byId('settings-status').textContent='';settingsOpener=document.activeElement;settingsDraft=clone(prefs);settingsBehavior=new Map();behaviorAgentId=prefs.activeAgent;settingsPage=page==='agents'?'coworkers':page;const cats=[['general','General'],['appearance','Appearance'],['presentation','Conversation details'],['coworkers','Coworkers'],['behavior','Coworker behavior'],['models','Models & providers'],['connections','Connections'],['data','Privacy & data'],['archived','Archived chats']];byId('settings-nav').replaceChildren(...cats.map(([id,label])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.category=id;b.setAttribute('aria-current',String(id===settingsPage));b.onclick=()=>{captureSettings();settingsPage=id;renderSettingsPage();};return b;}));renderSettingsPage();byId('settings-dialog').showModal();}
  function accountAction(action){closePopovers();if(action==='settings')openSettings();else if(action==='about')showBuildInfo();else if(action==='help')showShortcutReference();else if(action==='feedback'){showInfo('Send Feedback','<label for="feedback-text">What could work better?</label><textarea id="feedback-text" rows="5" maxlength="4000" placeholder="Describe what you expected and what happened…"></textarea><button type="button" id="save-feedback" class="button-primary">Save feedback locally</button><p id="feedback-status" role="status"></p><button type="button" id="export-feedback">Download saved feedback</button><p class="setting-help">Feedback stays local. Download it to share manually; no logs are attached.</p>');byId('export-feedback').onclick=()=>{try{const items=JSON.parse(localStorage.getItem('aven-feedback-v1')||'[]');downloadLocal('aven-feedback.json',JSON.stringify(items,null,2));}catch{byId('feedback-status').textContent='Saved feedback could not be read.';}};byId('save-feedback').onclick=()=>{const text=byId('feedback-text').value.trim();if(!text){byId('feedback-status').textContent='Add your feedback first.';return;}let items;try{items=JSON.parse(localStorage.getItem('aven-feedback-v1')||'[]');}catch{items=[];}if(!Array.isArray(items))items=[];if(save('aven-feedback-v1',[...items,{text,createdAt:now()}])){byId('feedback-status').textContent='Saved locally.';byId('feedback-text').value='';}else byId('feedback-status').textContent='Could not save to local storage.';};}else if(action==='add-account')showInfo('Add Account','<div class="info-symbol">'+icon('account')+'</div><h3>Accounts are not connected yet</h3><p>This frontend can preview account controls. Sign-in will be available when authentication is connected.</p>');else if(action==='logout')showInfo('Log out','<div class="info-symbol">'+icon('logout')+'</div><h3>No connected account</h3><p>There is no signed-in session to end. Your local conversations stay on this device.</p>');}
  function openMove(id,kind,chatId=null){if(hasUnsavedPaneChanges()&&!confirmDiscardDoc())return;const a=agentById(id),dialog=byId('workspace-create-dialog');createSucceeded=true;createReturnChat=data.activeChat;createOpener=document.activeElement;byId('workspace-create-title').textContent='Move '+a.name;const choices=kind==='project'?data.projects:prefs.sections;byId('create-dialog-body').innerHTML='<form id="move-form" class="workspace-form"><label for="move-target">'+(kind==='project'?'Conversation folder':'Section')+'</label><select id="move-target">'+(kind==='project'?'<option value="__direct">Coworkers · no folder</option>':'')+choices.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+(kind==='section'?'<option value="__new">Create a section…</option>':'')+'</select>'+(kind==='section'?'<label for="new-section-name">New section name</label><input id="new-section-name" maxlength="60" placeholder="For example: Operations">':'')+'<p id="move-status" role="status"></p><div class="form-actions"><button type="button" id="cancel-move" class="button-secondary">Cancel</button><button type="submit" class="button-primary" id="save-move">Move</button></div></form>';byId('cancel-move').onclick=()=>dialog.close();byId('close-workspace-create').onclick=()=>dialog.close();dialog.onclose=()=>{if(createOpener?.isConnected)createOpener.focus();};byId('move-form').onsubmit=e=>{e.preventDefault();let target=byId('move-target').value;if(target==='__direct')target=null;if(kind==='section'&&target==='__new'){const name=byId('new-section-name').value.trim();if(!name){byId('move-status').textContent='Enter a section name.';return;}const found=prefs.sections.find(s=>s.name.toLowerCase()===name.toLowerCase());target=found?.id||uid();if(!found)prefs.sections.push({id:target,name});}if(kind==='section')a.sectionId=target;else{a.projectId=target;for(const c of data.chats.filter(c=>chatId?c.id===chatId:(!c.channelId&&!c.projectId&&c.recipients?.length===1&&c.recipients[0]===id)))c.projectId=target;saveData();}savePrefs();dialog.close();renderSidebar();showChat();};dialog.showModal();byId('move-target').focus();}
  function showContextMenu(id,x,y,opener,chatId=null){contextChatId=chatId;closePopovers();closeContextMenu(false);contextAgentId=id;contextOpener=opener||document.activeElement;const menu=document.createElement('div');menu.id='agent-context-menu';menu.className='context-menu';menu.setAttribute('role','menu');const a=agentById(id),actions=[['pin',a.pinned?'Unpin':'Pin'],['unread',a.unread?'Mark as read':'Mark as unread'],['edit','Edit profile'],['move-project','Move to folder…'],['move-section','Move to section…'],['hide','Hide from sidebar'],['delete','Delete local coworker']];for(const [act,label]of actions){const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.dataset.menuAction=act;b.textContent=label;if(act==='delete')b.className='menu-danger';b.onclick=()=>contextAction(act);menu.append(b);}document.body.append(menu);menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';one('button',menu).focus();}
  const initialInit=init;init=()=>{if(migrationFailed){document.body.replaceChildren();const note=document.createElement('p');note.textContent='Could not safely migrate saved conversations. Free browser storage and reload. Your previous data has not been replaced.';document.body.append(note);if(!startupRecovery.ok){if(!creationRecovery.ok){note.textContent='An interrupted coworker creation could not be recovered. Free browser storage and reload. Pending local workspace data was kept intact.';return;}note.textContent='An interrupted import could not be recovered. Free browser storage and reload, or download the retained pre-import backup.';const recovery=document.createElement('button');recovery.type='button';recovery.textContent='Download pre-import backup';recovery.onclick=()=>{try{const saved=JSON.parse(localStorage.getItem(AvenWorkspaceBackup.BACKUP));downloadLocal('aven-pre-import-backup.json',AvenWorkspaceBackup.serialize(saved.envelope));}catch{note.textContent='The recovery backup could not be exported. Keep browser data intact and retry after freeing storage.';}};document.body.append(recovery);}return;}initialInit();finishInteractionWiring();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();





