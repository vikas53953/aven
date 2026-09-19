'use strict';
const fs=require('node:fs'),path=require('node:path');
const owners=['reliability','provider','workflows','minimal-ui','workspace','automation','history'];
const staged=new Map(),report=[];
for(const owner of owners){
 const file=[path.join(__dirname,owner,'replacements.json'),path.join(__dirname,owner,'candidate','replacements.json')].find(p=>fs.existsSync(p));
 if(!file){report.push({owner,status:'pending'});continue;}
 const j=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));const entries=Array.isArray(j)?j:j.replacements;
 if(!Array.isArray(entries)){report.push({owner,status:'invalid manifest'});continue;}
 for(const e of entries){
  const rel=e.file||e.path;const old=e.old??e.before;const next=e.new??e.after;
  if(typeof rel!=='string'||typeof old!=='string'||typeof next!=='string'){report.push({owner,status:'unsupported entry',keys:Object.keys(e)});continue;}
  const base=path.join(__dirname,'baseline',rel);if(!fs.existsSync(base)){report.push({owner,file:rel,status:'no baseline'});continue;}
  const original=fs.readFileSync(base,'utf8'),current=staged.get(rel)??original;
  if(original.split(old).length!==2){report.push({owner,file:rel,status:'baseline anchor not unique',preview:old.slice(0,100)});continue;}
  if(current.split(old).length!==2){report.push({owner,file:rel,status:'overlap',preview:old.slice(0,100)});continue;}
  staged.set(rel,current.replace(old,next));
 }
 report.push({owner,status:'inspected',hunks:entries.length});
}
fs.writeFileSync(path.join(__dirname,'hunk-inspection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
