'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const out=path.resolve(__dirname,'..'),candidate=path.join(out,'assembled-candidate'),config=path.join(__dirname,'integration-deltas.json');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const plan=JSON.parse(fs.readFileSync(config,'utf8')),changes=[];
function target(rel){if(path.isAbsolute(rel)||rel.split(/[\\/]/).includes('..'))throw Error('Unsafe candidate path');return path.join(candidate,rel);}
for(const entry of plan){
 const source=path.resolve(__dirname,entry.source);
 if(!source.startsWith(__dirname+path.sep))throw Error('Source outside round2');
 const bytes=fs.readFileSync(source);
 if(hash(bytes)!==entry.sha256.toLowerCase())throw Error('Reviewed package changed: '+entry.source);
 if(entry.kind==='hunks'){
  const parsed=JSON.parse(bytes),hunks=Array.isArray(parsed)?parsed:parsed.replacements;
  if(!Array.isArray(hunks)||!hunks.length)throw Error('Missing exact replacements');
  for(const h of hunks){
   const dest=target(h.file),before=fs.readFileSync(dest,'utf8');
   if(!h.old||typeof h.new!=='string'||before.split(h.old).length!==2)throw Error('Missing or ambiguous hunk '+entry.owner+':'+h.file);
   const after=before.replace(h.old,h.new);fs.writeFileSync(dest,after);changes.push({owner:entry.owner,file:h.file,before:hash(before),after:hash(after)});
  }
 }else if(entry.kind==='file'){
  const dest=target(entry.file),before=fs.existsSync(dest)?fs.readFileSync(dest):null;
  if(entry.beforeSha256&&(!before||hash(before)!==entry.beforeSha256.toLowerCase()))throw Error('Unexpected prior module '+entry.file);
  if(before&&!entry.beforeSha256)throw Error('Existing module requires prior hash '+entry.file);
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);changes.push({owner:entry.owner,file:entry.file,before:before?hash(before):null,after:hash(bytes)});
 }else throw Error('Unknown delta kind');
}
const provenancePath=path.join(out,'assembled-provenance.json'),provenance=JSON.parse(fs.readFileSync(provenancePath,'utf8'));
const final=new Map(provenance.finalFiles.map(r=>[r.file,r]));
for(const c of changes){const r={file:c.file,owner:c.owner,source:'round2/integration-deltas.json',sha256:c.after};provenance.records.push(r);final.set(c.file,r);}
provenance.finalFiles=[...final.values()];provenance.at=new Date().toISOString();
fs.writeFileSync(provenancePath,JSON.stringify(provenance,null,2));
fs.writeFileSync(path.join(__dirname,'applied-deltas.json'),JSON.stringify({at:provenance.at,changes},null,2));
console.log(JSON.stringify({reviewedDeltas:plan.length,changes:changes.length}));
