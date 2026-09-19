'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const input=path.join(__dirname,'automation/candidate/polished-backup.js');
const source=fs.readFileSync(input,'utf8');let value=source;
const changes=[];
function change(old,next){if(value.split(old).length!==2)throw Error('Backup anchor missing/ambiguous: '+old.slice(0,80));value=value.replace(old,next);changes.push({old,new:next});}
change('model browser computer sidebarWidth paneWidth sections agents', 'model providerSelection providerSelectionExplicit showEvidence showInvestigation showRunDetails browser computer sidebarWidth paneWidth sections agents');
change('token|steeringToken|accessToken', 'token|questionToken|decisionToken|executionToken|approvalToken|reviewToken|workflowActions|steeringToken|accessToken');
change("    fields(p,'theme accent language density displayName activeAgent provider model','preference');",`    fields(p,'theme accent language density displayName activeAgent provider model','preference');
    for(const key of ['showEvidence','showInvestigation','showRunDetails','providerSelectionExplicit'])if(p[key]!==undefined)check(typeof p[key]==='boolean','Invalid '+key+' preference.');
    if(p.providerSelection!==undefined&&p.providerSelection!==null){const selection=p.providerSelection;check(record(selection)&&Object.keys(selection).every(key=>['providerId','modelId','effort'].includes(key)),'Invalid provider selection.');check(['opencode','openrouter','anthropic','openai'].includes(selection.providerId),'Unsupported provider selection.');string(selection.modelId,'selected model',200);check(selection.modelId.trim().length>0,'Selected model is empty.');check(['none','low','medium','high','max'].includes(selection.effort),'Invalid selected effort.');}
    if(p.providerSelectionExplicit===true)check(record(p.providerSelection),'Explicit provider selection is missing.');`);
change("      messages(c.messages,agents);reply(c.draftReplyTo);",`      if(c.workflowState!==undefined&&c.workflowState!==null){check(record(c.workflowState),'Invalid workflow history.');c.workflowState.status='restored-history';c.workflowState.interactive=false;c.workflowState.executionAllowed=false;c.workflowState.restoreNotice='Restored workflow history. Start a fresh request to continue.';if(record(c.workflowState.approval)&&['pending','approved'].includes(c.workflowState.approval.status))c.workflowState.approval.status='invalidated';}
      delete c.workflowActions;
      messages(c.messages,agents);reply(c.draftReplyTo);`);
change("Object.entries(value).filter(([key])=>!privateKey(key))", "Object.entries(value).filter(([key,v])=>!privateKey(key)&&typeof v!=='function'&&v!==undefined)");
const out=path.join(__dirname,'root-backup');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'polished-backup.js'),value);
fs.writeFileSync(path.join(out,'root-replacements.json'),JSON.stringify(changes.map(e=>({file:'polished-backup.js',...e})),null,2));
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({input,inputHash:hash(source),candidateHash:hash(value),at:new Date().toISOString(),changes:changes.length},null,2));
console.log(JSON.stringify({candidate:path.join(out,'polished-backup.js'),changes:changes.length}));
