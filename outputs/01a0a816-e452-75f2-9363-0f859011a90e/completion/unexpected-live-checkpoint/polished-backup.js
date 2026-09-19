/* Versioned local workspace interchange. No network or runtime execution. */
(function(root){
  'use strict';
  const VERSION=1,MAX_BYTES=10*1024*1024;
  const KEYS=['aven-polished-preferences-v1','aven-polished-chats-v1','aven-polished-docs-v1','aven-polished-direct-teams-migration-v4','aven-polished-local-reactions-v1'];
  const BACKUP='aven-polished-before-import-v1';
  const PENDING='aven-polished-import-pending-v1';
  const PREF_FIELDS=new Set('theme accent language density displayName activeAgent provider model browser computer sidebarWidth paneWidth sections agents'.split(' '));
  const privateKey=key=>/^(?:proto|prototype|constructor|token|steeringToken|accessToken|refreshToken|bearerToken|apiKey|password|credential|credentials|controller|authorization|permission|permissions|secret|clientSecret)$/i.test(key.replace(/[_-]/g,''));
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  function graph(v,depth=0){
    check(depth<45,'Backup nesting is too deep.');
    if(v===null||typeof v!=='object')return;
    for(const [key,value]of Object.entries(v)){check(!privateKey(key),'Backup contains unsupported private or reserved fields.');graph(value,depth+1);}
  }
  function string(v,label,max=1024*1024){check(typeof v==='string'&&v.length<=max,'Invalid '+label+'.');}
  function fields(v,names,label){for(const name of names.split(' '))if(v[name]!==undefined&&v[name]!==null)string(v[name],label+' '+name);}
  function list(v,label,max=20000){check(Array.isArray(v)&&v.length<=max,'Invalid '+label+'.');return v;}
  function records(v,label){const rows=list(v,label);const ids=new Set();rows.forEach(row=>{check(record(row),'Invalid '+label+' entry.');string(row.id,label+' ID',100);check(row.id&&!ids.has(row.id),'Duplicate or empty '+label+' ID.');ids.add(row.id);});return ids;}
  function evidence(v){if(v===undefined)return;for(const e of list(v,'evidence')){check(record(e),'Invalid evidence entry.');fields(e,'output command operation name target hostname source status type message','evidence');if(e.evidence!==undefined&&e.evidence!==null)evidence(Array.isArray(e.evidence)?e.evidence:[e.evidence]);}}
  function reply(v){if(v===undefined||v===null)return;check(record(v),'Invalid reply quote.');string(v.id,'reply ID',100);string(v.text,'reply quote',1000);fields(v,'author','reply');}
  function messages(value,agentIds){
    for(const m of list(value,'messages'))if(record(m)&&m.annotations!==undefined){list(m.annotations,'annotations',100);records(m.annotations,'annotations');for(const n of m.annotations){check(n.messageId===m.id,'Annotation message mismatch.');string(n.text,'annotation',4000);check(n.text.trim(),'Empty annotation.');check(Number.isInteger(n.evidenceIndex)&&n.evidenceIndex>=0,'Invalid annotation evidence index.');check(typeof n.outputHash==='string'&&/^[a-f0-9]{64}$/.test(n.outputHash),'Invalid annotation hash.');fields(n,'runId command target sourceId createdAt','annotation');}}
    for(const m of list(value,'messages'))if(record(m)&&m.recipients!==undefined)list(m.recipients,'message recipients').forEach(id=>check(typeof id==='string'&&agentIds.has(id),'Unknown message recipient.'));
    records(value,'messages');for(const m of value){check(['user','assistant'].includes(m.role),'Invalid message role.');fields(m,'text createdAt source model runId localReaction','message');if(m.agentId)check(agentIds.has(m.agentId),'Message references an unknown coworker.');if(m.attachments!==undefined)list(m.attachments,'attachments').forEach(v=>string(v,'attachment name'));if(m.recipientNames!==undefined)list(m.recipientNames,'recipient names').forEach(v=>string(v,'recipient name'));if(m.reactions!==undefined)list(m.reactions,'reactions',30).forEach(v=>string(v,'reaction',20));evidence(m.evidence);evidence(m.events);reply(m.replyTo);}
  }
  function automation(value){
    if(value===undefined)return;
    check(record(value),'Invalid automation state.');
    if(value.version!==undefined)check(value.version===1,'Unsupported automation state version.');
    const schedules=value.schedules||[];list(schedules,'schedules',100);records(schedules,'schedules');
    for(const schedule of schedules){
      fields(schedule,'title workflowId workflowVersion cadence timezone timeOfDay nextRunAt lastRunAt lastStatus createdAt updatedAt','schedule');
      if(schedule.enabled!==undefined)check(typeof schedule.enabled==='boolean','Invalid schedule enabled state.');
      if(schedule.weekday!==undefined)check(Number.isInteger(schedule.weekday)&&schedule.weekday>=0&&schedule.weekday<=6,'Invalid schedule weekday.');
      const history=schedule.history||[];list(history,'schedule history',100);records(history,'schedule history');
      for(const entry of history){fields(entry,'runId dispatchId trigger status startedAt finishedAt error','schedule history');if(entry.outputRef!==undefined&&entry.outputRef!==null){check(record(entry.outputRef),'Invalid schedule output reference.');fields(entry.outputRef,'chatId messageId','schedule output reference');}}
      const failures=schedule.failures||[];list(failures,'schedule failures',20);records(failures,'schedule failures');for(const failure of failures)fields(failure,'at message runId','schedule failure');
    }
    if(value.notifications!==undefined){check(record(value.notifications),'Invalid automation notifications.');if(value.notifications.muted!==undefined)check(typeof value.notifications.muted==='boolean','Invalid automation mute state.');const delivered=value.notifications.delivered||[];list(delivered,'notifications',100);records(delivered,'notifications');for(const event of delivered){fields(event,'type taskId runId title message createdAt','notification');if(event.read!==undefined)check(typeof event.read==='boolean','Invalid notification read state.');if(event.muted!==undefined)check(typeof event.muted==='boolean','Invalid notification mute state.');}}
    if(value.selectedPluginIds!==undefined)list(value.selectedPluginIds,'selected plugins',20).forEach(id=>string(id,'selected plugin ID',160));
  }
  function validate(input){
    check(record(input)&&input.format==='aven-workspace'&&input.version===VERSION,'Choose an Aven workspace backup with version 1.');graph(input);
    const result=structuredClone(input),p=result.prefs,d=result.data,docs=result.docs;
    check(record(p)&&record(d)&&record(docs),'Backup must contain preferences, conversation data and local notes.');
    check(Object.keys(p).every(key=>PREF_FIELDS.has(key)),'Backup has unsupported preference fields.');
    fields(p,'theme accent language density displayName activeAgent provider model','preference');
    if(p.sidebarWidth!==undefined)check(Number.isFinite(p.sidebarWidth)&&p.sidebarWidth>=220&&p.sidebarWidth<=380,'Invalid sidebar width.');
    if(p.paneWidth!==undefined)check(Number.isFinite(p.paneWidth)&&p.paneWidth>=320&&p.paneWidth<=720,'Invalid pane width.');
    for(const key of ['browser','computer'])if(p[key]!==undefined)check(typeof p[key]==='boolean','Invalid connection preference.');
    const agents=records(p.agents,'coworkers'),sections=records(p.sections,'sections'),projects=records(d.projects,'folders'),channels=records(d.channels,'channels'),chats=records(d.chats,'conversations');
    check(agents.size&&chats.size,'Backup must include a coworker and a conversation.');check(agents.has(p.activeAgent)&&chats.has(d.activeChat),'Backup has an invalid active destination.');
    const refs=(value,ids,label)=>list(value,label).forEach(id=>check(typeof id==='string'&&ids.has(id),'Unknown '+label+' reference.'));
    for(const a of p.agents){string(a.name,'coworker name',80);fields(a,'role description label timezone sectionId projectId','coworker');if(a.sectionId)check(sections.has(a.sectionId),'Unknown coworker section.');if(a.projectId)check(projects.has(a.projectId),'Unknown coworker folder.');if(a.avatar!==undefined){check(record(a.avatar),'Invalid avatar.');fields(a.avatar,'style color image type','avatar');if(a.avatar.image)check(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a.avatar.image),'Only embedded raster avatar photos can be restored.');}a.autoReview=false;}
    for(const section of p.sections)string(section.name,'section name',80);
    for(const folder of d.projects){string(folder.name,'folder name',100);if(folder.members!==undefined)refs(folder.members,agents,'folder members');}
    for(const channel of d.channels){fields(channel,'name projectId','channel');if(channel.projectId)check(projects.has(channel.projectId),'Unknown channel folder.');if(channel.members!==undefined)refs(channel.members,agents,'channel members');}
    for(const c of d.chats){
      string(c.title,'conversation name');fields(c,'draft projectId channelId queuePauseReason replyError','conversation');refs(c.recipients,agents,'conversation coworkers');check(c.recipients.length>0,'Conversation needs a coworker.');if(c.projectId)check(projects.has(c.projectId),'Unknown conversation folder.');if(c.channelId)check(channels.has(c.channelId),'Unknown conversation channel.');
      messages(c.messages,agents);reply(c.draftReplyTo);if(c.pendingAttachmentNames!==undefined)list(c.pendingAttachmentNames,'attachment names').forEach(v=>string(v,'attachment name'));
      const queue=c.pendingQueue||[];records(queue,'queue');check(queue.length<=8,'Queue exceeds eight messages.');c.pendingQueue=queue.map(item=>{string(item.text,'queued text',4000);check(item.text.trim(),'Queued text cannot be empty.');reply(item.replyTo);fields(item,'createdAt','queue');return {id:item.id,text:item.text,createdAt:item.createdAt,replyTo:item.replyTo||null,...(item.mode!==undefined?{mode:item.mode==='plan'?'plan':'inspect'}:{})};});
      c.queuePaused=!!queue.length;c.queuePauseReason=queue.length?'Restored queue is paused. Review it before resuming.':'';delete c.queueDispatching;c.queueEditing=false;
      if(c.rewindHistory!==undefined)for(const snapshot of list(c.rewindHistory,'original history')){check(record(snapshot),'Invalid original history.');messages(snapshot.messages,agents);list(snapshot.retainedIds,'retained message IDs').forEach(v=>string(v,'retained message ID',100));}
      if(c.forkedFrom!==undefined){check(record(c.forkedFrom),'Invalid fork origin.');fields(c.forkedFrom,'chatId messageId title createdAt','fork origin');}
    }
    if(d.workspaceTools!==undefined){
      check(record(d.workspaceTools),'Invalid workspace notes.');
      for(const [kind,max]of [['ideas',200],['goals',100]]){const rows=d.workspaceTools[kind]||[];list(rows,kind,max);records(rows,kind);for(const row of rows){string(row.title,kind+' title',160);if(row.body!==undefined)string(row.body,kind+' body',8000);if(row.steps!==undefined){list(row.steps,'goal steps',50);records(row.steps,'goal steps');for(const step of row.steps)string(step.text,'step text',8000);}}}
      automation(d.workspaceTools.automation);
    }
    for(const [id,notes]of Object.entries(docs)){check(agents.has(id)&&record(notes),'Unknown coworker notes.');for(const [name,text]of Object.entries(notes)){check(['SOUL.md','MEMORY.md'].includes(name),'Unsupported coworker note.');string(text,'coworker note');}}
    p.browser=false;p.computer=false;
    return result;
  }
  function exportSafe(value){
    if(Array.isArray(value))return value.map(exportSafe);
    if(!record(value))return value;
    return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKey(key)).map(([key,v])=>{if(['evidence','events'].includes(key)){graph(v);return [key,structuredClone(v)];}return [key,exportSafe(v)];}));
  }
  function envelope(prefs,data,docs,build){return {format:'aven-workspace',version:VERSION,exportedAt:new Date().toISOString(),build,prefs:exportSafe(Object.fromEntries(Object.entries(prefs).filter(([key])=>PREF_FIELDS.has(key)))),data:exportSafe(data),docs:structuredClone(docs)};}
  function parse(text){check(new TextEncoder().encode(text).length<=MAX_BYTES,'Backup exceeds the 10 MiB import limit.');let value;try{value=JSON.parse(text);}catch{throw Error('This file is not valid JSON.');}return validate(value);}
  function serialize(value){const text=JSON.stringify(value,null,2);check(new TextEncoder().encode(text).length<=MAX_BYTES,'Workspace exceeds the 10 MiB backup limit. Export individual conversations instead.');validate(value);return text;}
  function mergeImported(current,imported){
    const incoming=validate(imported),result=structuredClone(current),maps={};
    for(const [name,rows]of Object.entries({agents:incoming.prefs.agents,sections:incoming.prefs.sections,projects:incoming.data.projects,channels:incoming.data.channels,chats:incoming.data.chats}))maps[name]=new Map(rows.map(row=>[row.id,crypto.randomUUID()]));
    const missing=new Map();const ref=(kind,id)=>{if(!id)return id;if(maps[kind].has(id))return maps[kind].get(id);const key=kind+':'+id;if(!missing.has(key))missing.set(key,'unavailable-import-'+crypto.randomUUID());return missing.get(key);};
    for(const a of incoming.prefs.agents){a.id=ref('agents',a.id);a.name=a.name.slice(0,69)+' (restored)';a.sectionId=ref('sections',a.sectionId);a.projectId=ref('projects',a.projectId);}
    incoming.prefs.sections.forEach(s=>s.id=ref('sections',s.id));
    for(const p of incoming.data.projects){p.id=ref('projects',p.id);p.members=(p.members||[]).map(id=>ref('agents',id));}
    for(const c of incoming.data.channels){c.id=ref('channels',c.id);c.projectId=ref('projects',c.projectId);c.members=(c.members||[]).map(id=>ref('agents',id));}
    const remapMessages=rows=>rows.forEach(m=>{if(m.agentId)m.agentId=ref('agents',m.agentId);if(Array.isArray(m.recipients))m.recipients=m.recipients.map(id=>ref('agents',id));});
    for(const c of incoming.data.chats){c.id=ref('chats',c.id);c.projectId=ref('projects',c.projectId);c.channelId=ref('channels',c.channelId);c.recipients=c.recipients.map(id=>ref('agents',id));remapMessages(c.messages);if(c.recoveredFrom)c.recoveredFrom=ref('chats',c.recoveredFrom);if(c.forkedFrom)c.forkedFrom.chatId=ref('chats',c.forkedFrom.chatId);for(const snapshot of c.rewindHistory||[]){remapMessages(snapshot.messages);if(snapshot.recoveryChatId)snapshot.recoveryChatId=ref('chats',snapshot.recoveryChatId);}}
    result.prefs.agents.push(...incoming.prefs.agents);result.prefs.sections.push(...incoming.prefs.sections);
    result.data.chats.push(...incoming.data.chats);result.data.projects.push(...incoming.data.projects);result.data.channels.push(...incoming.data.channels);
    for(const [id,notes]of Object.entries(incoming.docs))result.docs[ref('agents',id)]=notes;
    if(incoming.data.workspaceTools){
      const remapNotes=value=>{if(Array.isArray(value))return value.map(remapNotes);if(!record(value))return value;return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==='chatId'?ref('chats',v):key==='id'?crypto.randomUUID():remapNotes(v)]));};
      result.data.workspaceTools=result.data.workspaceTools||{ideas:[],goals:[]};
      for(const kind of ['ideas','goals'])result.data.workspaceTools[kind]=[...(result.data.workspaceTools[kind]||[]),...remapNotes(incoming.data.workspaceTools[kind]||[])];
      if(incoming.data.workspaceTools.automation){
        const source=structuredClone(incoming.data.workspaceTools.automation),existing=result.data.workspaceTools.automation||{version:1,schedules:[],notifications:{muted:false,delivered:[]},selectedPluginIds:[]};
        const scheduleIds=new Map();
        source.schedules=(source.schedules||[]).map(schedule=>{const old=schedule.id;schedule.id=crypto.randomUUID();scheduleIds.set(old,schedule.id);schedule.history=(schedule.history||[]).map(entry=>({...entry,id:crypto.randomUUID()}));schedule.failures=(schedule.failures||[]).map(entry=>({...entry,id:crypto.randomUUID()}));return schedule;});
        source.notifications={...(source.notifications||{}),delivered:(source.notifications?.delivered||[]).map(event=>({...event,id:crypto.randomUUID(),taskId:scheduleIds.get(event.taskId)||event.taskId}))};
        result.data.workspaceTools.automation={version:1,schedules:[...(existing.schedules||[]),...(source.schedules||[])].slice(-100),notifications:{muted:existing.notifications?.muted===true,delivered:[...(existing.notifications?.delivered||[]),...(source.notifications?.delivered||[])].slice(-100)},selectedPluginIds:[...new Set([...(existing.selectedPluginIds||[]),...(source.selectedPluginIds||[])])]};
      }
    }
    result.data.activeChat=ref('chats',incoming.data.activeChat);
    validate(result); // Validate the union; only imported execution controls were normalized above.
    return result;
  }
  function replace(storage,imported,previousEnvelope,mode='replace'){
    check(['add','replace'].includes(mode),'Unknown restore mode.');
    check(recoverPending(storage).ok,'Recover the interrupted import before starting another restore.');
    const incoming=mode==='add'?mergeImported(previousEnvelope,imported):validate(imported),raw=Object.fromEntries(KEYS.map(key=>[key,storage.getItem(key)]));
    const transactionId=crypto.randomUUID();storage.setItem(BACKUP,JSON.stringify({transactionId,createdAt:new Date().toISOString(),raw,envelope:previousEnvelope}));
    storage.setItem(PENDING,transactionId);
    const values=[JSON.stringify(incoming.prefs),JSON.stringify(incoming.data),JSON.stringify(incoming.docs),'v4','v1'];
    try{KEYS.forEach((key,i)=>storage.setItem(key,values[i]));storage.removeItem(PENDING);}
    catch(error){const restored=recoverPending(storage).ok;
      throw Error(restored?'Could not save the import. Previous workspace restored.':'Could not finish restoring local storage. Download the pre-import backup before reloading.');}
    return incoming;
  }
  function recoverPending(storage){
    try{const id=storage.getItem(PENDING);if(!id)return {ok:true,recovered:false};const backup=JSON.parse(storage.getItem(BACKUP));check(backup?.transactionId===id&&record(backup.raw)&&KEYS.every(key=>Object.hasOwn(backup.raw,key)&&(backup.raw[key]===null||typeof backup.raw[key]==='string')),'Missing import recovery snapshot.');
      for(const key of KEYS){if(backup.raw[key]===null)storage.removeItem(key);else storage.setItem(key,backup.raw[key]);}storage.removeItem(PENDING);return {ok:true,recovered:true};
    }catch{return {ok:false,recovered:false};}
  }
  const api={VERSION,MAX_BYTES,KEYS,BACKUP,PENDING,envelope,validate,parse,serialize,mergeImported,replace,recoverPending};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AvenWorkspaceBackup=api;
})(globalThis);
