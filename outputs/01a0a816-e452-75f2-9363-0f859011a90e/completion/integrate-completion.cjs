'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p).replace(/^\uFEFF/,''));
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const argValue=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const manifestName=argValue('--manifest')||'integration-manifest.json';
if(path.isAbsolute(manifestName)||manifestName.split(/[\\/]/).includes('..'))throw Error('Unsafe manifest path');
const manifest=json(path.join(__dirname,manifestName));
const reportName=argValue('--report')||(process.argv.includes('--apply')?'integration.json':'integration-dry-run.json');
if(path.isAbsolute(reportName)||reportName.split(/[\\/]/).includes('..'))throw Error('Unsafe report path');
const reportPath=path.join(__dirname,reportName);
const staged=new Map(),changes=[];
function safe(rel){
  if(typeof rel!=='string'||path.isAbsolute(rel)||rel.split(/[\\/]/).includes('..'))throw Error('Unsafe relative path');
  const resolved=path.resolve(root,rel);
  if(!resolved.startsWith(root+path.sep)||rel.startsWith('outputs'))throw Error('Unexpected product path');
  return resolved;
}
function candidatePath(rel){
  if(typeof rel!=='string'||path.isAbsolute(rel)||rel.split(/[\\/]/).includes('..'))throw Error('Unsafe candidate path');
  const p=path.resolve(__dirname,rel);
  if(!p.startsWith(__dirname+path.sep))throw Error('Candidate outside completion directory');
  return p;
}
for(const entry of manifest.composedFiles||[]){
  const dest=safe(entry.file),baseline=fs.readFileSync(path.join(__dirname,'baseline',entry.file));
  const current=fs.readFileSync(dest),content=fs.readFileSync(candidatePath(entry.source));
  if(!entry.sha256||!entry.baselineSha256||hash(content)!==entry.sha256||hash(baseline)!==entry.baselineSha256)throw Error('Unfrozen composition '+entry.file);
  if(!current.equals(baseline)&&(!entry.expectedCurrentSha256||hash(current)!==entry.expectedCurrentSha256))throw Error('Product changed since approved checkpoint: '+entry.file);
  if(staged.has(entry.file))throw Error('Duplicate composed file '+entry.file);
  staged.set(entry.file,content);
  changes.push({owner:'root-reviewed-composition',file:entry.file,oldSha256:hash(baseline),newSha256:hash(content)});
}
for(const owner of manifest.owners||[]){
  const entries=json(path.join(__dirname,owner,'replacements.json'));
  if(!Array.isArray(entries))throw Error('Invalid replacements: '+owner);
  for(const entry of entries){
    const dest=safe(entry.file),basePath=path.join(__dirname,'baseline',entry.file);
    const baseline=read(basePath);
    if(typeof entry.old!=='string'||!entry.old||typeof entry.new!=='string'||entry.new===entry.old)throw Error('Invalid hunk '+owner+'/'+entry.file);
    if(baseline.split(entry.old).length!==2)throw Error('Baseline anchor not unique '+owner+'/'+entry.file);
    if(!staged.has(entry.file)){
      if(read(dest)!==baseline)throw Error('Product changed since baseline: '+entry.file);
      staged.set(entry.file,baseline);
    }
    const current=staged.get(entry.file);
    if(current.split(entry.old).length!==2)throw Error('Overlapping/stale hunk '+owner+'/'+entry.file);
    staged.set(entry.file,current.replace(entry.old,entry.new));
    changes.push({owner,file:entry.file,oldSha256:hash(entry.old),newSha256:hash(entry.new)});
  }
}
for(const entry of manifest.newFiles||[]){
  const dest=safe(entry.file);
  if(staged.has(entry.file))throw Error('New file conflicts: '+entry.file);
  if(fs.existsSync(dest)&&(!entry.expectedExistingSha256||hash(fs.readFileSync(dest))!==entry.expectedExistingSha256))throw Error('Unattributed existing new file: '+entry.file);
  const content=fs.readFileSync(entry.source?candidatePath(entry.source):path.join(__dirname,entry.owner,'candidate',entry.file));
  if(!entry.sha256||hash(content)!==entry.sha256)throw Error('Candidate hash missing or changed: '+entry.file);
  staged.set(entry.file,content);changes.push({owner:entry.owner,file:entry.file,newSha256:hash(content)});
}
const report={at:new Date().toISOString(),applied:process.argv.includes('--apply'),changes,files:[...staged].map(([file,content])=>({file,before:fs.existsSync(safe(file))?hash(fs.readFileSync(safe(file))):null,after:hash(content)}))};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
if(report.applied){
 const prior=new Map([...staged.keys()].map(file=>[file,fs.existsSync(safe(file))?fs.readFileSync(safe(file)):null]));
 const written=[];
 try{
  for(const [file,content]of staged){const dest=safe(file);fs.mkdirSync(path.dirname(dest),{recursive:true});written.push(file);fs.writeFileSync(dest,content);if(hash(fs.readFileSync(dest))!==hash(content))throw Error('Write verification failed: '+file);}
  report.verified=true;
 }catch(error){
  const rollbackErrors=[];
  for(const file of written.reverse())try{const data=prior.get(file),dest=safe(file);if(data===null){if(fs.existsSync(dest))fs.unlinkSync(dest);}else fs.writeFileSync(dest,data);}catch(rollbackError){rollbackErrors.push({file,error:rollbackError.message});}
  report.verified=false;report.failure=error.message;report.rollbackErrors=rollbackErrors;
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  throw error;
 }
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
}
console.log(JSON.stringify({applied:report.applied,files:report.files.length,hunks:changes.length}));
