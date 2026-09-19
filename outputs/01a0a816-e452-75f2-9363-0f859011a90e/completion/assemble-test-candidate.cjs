'use strict';
// Isolated full-shell test overlay. Does not write product files or copy runtime state.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const product=path.resolve(__dirname,'../../..'),out=path.join(__dirname,'assembled-candidate');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const records=[];
function copy(src,rel,owner){
 const data=fs.readFileSync(src),dest=path.join(out,rel);
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);
 records.push({source:path.relative(__dirname,src),file:rel,owner,sha256:hash(data)});
}
function sourceTree(src,prefix,owner){
 for(const e of fs.readdirSync(src,{withFileTypes:true})){
  if(e.name.startsWith('.')||['node_modules','outputs','runtime','logs'].includes(e.name)||e.isSymbolicLink())continue;
  const file=path.join(src,e.name),rel=path.join(prefix,e.name);
  if(e.isDirectory())sourceTree(file,rel,owner);
  else if(/\.(cjs|mjs|js|json|css|html|svg|png|jpg|woff2?|py|ps1)$/i.test(e.name))copy(file,rel,owner);
 }
}
fs.mkdirSync(out,{recursive:true});
for(const e of fs.readdirSync(product,{withFileTypes:true}))if(e.isFile()&&/^polished.*\.(js|css|html)$/.test(e.name))copy(path.join(product,e.name),e.name,'baseline-live-unchanged');
sourceTree(path.join(product,'avatar-system'),'avatar-system','baseline-assets');
sourceTree(path.join(__dirname,'baseline','intentgraph'),'intentgraph','frozen-baseline');
sourceTree(path.join(__dirname,'root-stage'),'','root-composition');
const files=[
 ['reliability','candidate/polished-reliability.js','polished-reliability.js'],
 ['reliability','candidate/intentgraph/reliability.cjs','intentgraph/reliability.cjs'],
 ['reliability','candidate/intentgraph/reliability-storage.cjs','intentgraph/reliability-storage.cjs'],
 ['provider','candidate/provider-picker.js','provider-picker.js'],
 ['workspace','candidate/workspace-capabilities.js','workspace-capabilities.js'],
 ['workspace','candidate/workspace-capabilities.css','workspace-capabilities.css'],
 ['workflows','candidate/polished-approval-workflow.js','polished-approval-workflow.js'],
 ['automation','candidate/polished-automation.js','polished-automation.js'],
 ['automation','candidate/polished-automation.css','polished-automation.css'],
 ['terminal','candidate/polished-terminal.js','polished-terminal.js'],
 ['terminal','candidate/polished-terminal.css','polished-terminal.css'],
 ['git','polished-git.js','polished-git.js'],
 ['git','polished-git.css','polished-git.css'],
 ['git','intentgraph/git-workspace.cjs','intentgraph/git-workspace.cjs']
];
for(const name of ['provider-selection','provider-adapter','provider-runtime-config'])files.push(['provider',`candidate/intentgraph/${name}.cjs`,`intentgraph/${name}.cjs`]);
for(const name of ['approval-workflow','clarification-runtime','clarification-server-adapter'])files.push(['workflows',`candidate/${name}.cjs`,`intentgraph/${name}.cjs`]);
for(const [owner,source,file]of files)copy(path.join(__dirname,owner,source),file,owner);
copy(path.join(__dirname,'root-backup','polished-backup.js'),'polished-backup.js','root-backup-compatibility');
const testHunks=JSON.parse(fs.readFileSync(path.join(__dirname,'provider','test-replacements.json'),'utf8'));
for(const entry of testHunks){
 if(!/^intentgraph\/[a-z-]+\.test\.cjs$/.test(entry.file))throw Error('Unexpected test-only target');
 const target=path.join(out,entry.file),before=fs.readFileSync(target,'utf8');
 if(before.split(entry.old).length!==2)throw Error('Test compatibility anchor missing: '+entry.file);
 const after=before.replace(entry.old,entry.new);fs.writeFileSync(target,after);
 records.push({source:'provider/test-replacements.json',file:entry.file,owner:'explicit-mock-provider-test-fixture',sha256:hash(after)});
}
const latest=new Map(records.map(r=>[r.file,r]));
fs.writeFileSync(path.join(__dirname,'assembled-provenance.json'),JSON.stringify({at:new Date().toISOString(),purpose:'Candidate tests only; not integration approval',records,finalFiles:[...latest.values()]},null,2));
console.log(JSON.stringify({directory:out,files:latest.size}));
