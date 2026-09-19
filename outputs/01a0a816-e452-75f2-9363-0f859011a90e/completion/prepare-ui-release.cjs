'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const product=path.resolve(__dirname,'../../..'),dest=path.join(__dirname,'ui-release/candidate');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(dest,{recursive:true});
for(const item of fs.readdirSync(product,{withFileTypes:true}))if(item.isFile()&&/^polished.*\.(js|css|html)$/.test(item.name))fs.copyFileSync(path.join(product,item.name),path.join(dest,item.name));
fs.cpSync(path.join(product,'avatar-system'),path.join(dest,'avatar-system'),{recursive:true});
const changed=new Map(),applied=[];
for(const [owner,file]of [['minimal-ui','minimal-ui/replacements.json'],['history','replacements.json'],['reaction-picker','reaction-picker/replacements.json']]){
 const input=JSON.parse(fs.readFileSync(path.join(__dirname,file),'utf8').replace(/^\uFEFF/,''));
 for(const e of Array.isArray(input)?input:input.replacements){
  const rel=e.file||e.path,old=e.old??e.before,next=e.new??e.after;
  if(old===next)continue;
  const base=fs.readFileSync(path.join(__dirname,'baseline',rel),'utf8'),current=changed.get(rel)??base;
  if(base.split(old).length!==2)throw Error('Nonexact baseline '+owner+'/'+rel);
  if(current.split(old).length!==2){
   if(owner==='history'&&old.includes("byId('chat-mode').onchange")&&current.includes("if(legacyModePicker)legacyModePicker.onchange=e=>setChatMode(e.target.value)")){applied.push({owner,file:rel,resolution:'Equivalent guarded mode setter supplied by minimal UI'});continue;}
   throw Error('Unresolved overlap '+owner+'/'+rel);
  }
  changed.set(rel,current.replace(old,next));applied.push({owner,file:rel,oldSha256:hash(old),newSha256:hash(next)});
 }
}
let backup=fs.readFileSync(path.join(__dirname,'baseline/polished-backup.js'),'utf8');
const rawDedupe="body===wanted||wanted.startsWith(body)||body.startsWith(wanted)?'':whole";
const rawDedupeFixed="body.replace(/\\r\\n/g,'\\n').replace(/^\\n+|\\n+$/g,'')===wanted.replace(/\\r\\n/g,'\\n').replace(/^\\n+|\\n+$/g,'')?'':whole";
if(changed.get('polished.js').split(rawDedupe).length!==2)throw Error('Raw dedupe anchor');
changed.set('polished.js',changed.get('polished.js').replace(rawDedupe,rawDedupeFixed));
const codeAnchor="n.textContent=code.join('\\n');pre.append(n);parent.append(pre);continue;";
const codeFold="n.textContent=code.join('\\n');pre.append(n);if(code.length>12){const details=document.createElement('details');details.className='message-code-fold';const summary=document.createElement('summary');const language=line.trim().slice(3).trim();summary.textContent=(language||'Code')+' · '+code.length+' lines';pre.tabIndex=0;details.append(summary,pre);parent.append(details);}else parent.append(pre);continue;";
if(changed.get('polished.js').split(codeAnchor).length!==2)throw Error('Code fold anchor');
changed.set('polished.js',changed.get('polished.js').replace(codeAnchor,codeFold));
changed.set('polished.css',changed.get('polished.css')+'\n.message-code-fold{margin:12px 0;border:1px solid var(--border);border-radius:10px;overflow:hidden}.message-code-fold>summary{cursor:pointer;padding:10px 12px;color:var(--muted);font-size:12px}.message-code-fold>pre{margin:0;border:0;border-radius:0}\n');
backup=backup.replace('model browser computer sidebarWidth','model showEvidence showInvestigation showRunDetails browser computer sidebarWidth');
const anchor="    check(Object.keys(p).every(key=>PREF_FIELDS.has(key)),'Backup has unsupported preference fields.');";
if(backup.split(anchor).length!==2)throw Error('Backup preference anchor');
backup=backup.replace(anchor,anchor+"\r\n    for(const key of ['showEvidence','showInvestigation','showRunDetails'])if(p[key]!==undefined)check(typeof p[key]==='boolean','Invalid detail preference.');");
changed.set('polished-backup.js',backup);
for(const [rel,content]of changed)fs.writeFileSync(path.join(dest,rel),content.replaceAll('ux-audit-fixes-v8','ux-minimal-ui-v9.1'));
const priorPath=path.join(__dirname,'ui-release/integration.json'),prior=fs.existsSync(priorPath)?JSON.parse(fs.readFileSync(priorPath,'utf8')):null;
const files=[...changed.keys()].map(file=>({file,source:'ui-release/candidate/'+file,baselineSha256:hash(fs.readFileSync(path.join(__dirname,'baseline',file))),...(prior?.verified?{expectedCurrentSha256:prior.files.find(x=>x.file===file)?.after}:{}),sha256:hash(fs.readFileSync(path.join(dest,file)))}));
fs.writeFileSync(path.join(__dirname,'ui-release/manifest.json'),JSON.stringify({at:new Date().toISOString(),scope:'Minimal UI, history and reactions; backend unchanged',composedFiles:files,applied},null,2));
console.log(JSON.stringify({candidate:dest,files:files.map(x=>x.file),hunks:applied.length}));
