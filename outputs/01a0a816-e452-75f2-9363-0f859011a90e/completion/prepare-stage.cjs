'use strict';
// Read-only toward product and owner candidates. Conflicts require root review.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const owners=['minimal-ui','reliability','provider','workflows','workspace','automation','history','reaction-picker','network-boundary-fix','terminal','git'];
const read=p=>fs.readFileSync(p,'utf8'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const stage=new Map(),accepted=[],conflicts=[];
for(const owner of owners){
 const candidates=[path.join(__dirname,owner,'replacements.json'),path.join(__dirname,owner,'candidate','replacements.json')];
 if(owner==='history')candidates.push(path.join(__dirname,'replacements.json'));
 const p=candidates.find(p=>fs.existsSync(p));
 if(!p){conflicts.push({owner,reason:'package pending'});continue;}
 const raw=JSON.parse(read(p).replace(/^\uFEFF/,'')),entries=Array.isArray(raw)?raw:raw.replacements;
 if(!Array.isArray(entries))throw Error('Invalid package '+owner);
 entries.forEach((e,index)=>{
  const file=e.file||e.path,old=e.old??e.before,next=e.new??e.after;
  if(!file||path.isAbsolute(file)||file.split(/[\\/]/).includes('..')||!old||typeof next!=='string')throw Error('Invalid hunk '+owner+':'+index);
  if(old===next){accepted.push({owner,index,file,noChange:true,oldHash:hash(old),newHash:hash(next)});return;}
  const base=read(path.join(__dirname,'baseline',file)),current=stage.get(file)??base;
  if(base.split(old).length!==2||current.split(old).length!==2){conflicts.push({owner,index,file,reason:base.split(old).length!==2?'baseline anchor':'overlap',old,new:next});return;}
  stage.set(file,current.replace(old,next));accepted.push({owner,index,file,oldHash:hash(old),newHash:hash(next)});
 });
}
const out=path.join(__dirname,'root-stage');fs.mkdirSync(out,{recursive:true});
for(const [file,content] of stage){const dest=path.join(out,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);}
fs.writeFileSync(path.join(__dirname,'stage-conflicts.json'),JSON.stringify(conflicts,null,2));
fs.writeFileSync(path.join(__dirname,'stage-provenance.json'),JSON.stringify({at:new Date().toISOString(),accepted,files:[...stage].map(([file,content])=>({file,sha256:hash(content)})),complete:conflicts.length===0},null,2));
console.log(JSON.stringify({files:stage.size,accepted:accepted.length,conflicts:conflicts.map(({owner,index,file,reason})=>({owner,index,file,reason}))},null,2));
