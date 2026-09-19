'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const owners={creation:['polished.js','polished-backup.js'],connection:['polished.js','polished-diagnostics.js'],artifacts:['polished-workspace-tools.js'],header:['polished.js']};
const staged=new Map(),changes=[];
for(const [owner,files] of Object.entries(owners)) {
  const entries=readJson(path.join(__dirname,owner,'replacements.json'));
  if(!Array.isArray(entries)||!entries.length)throw Error(`Missing replacements: ${owner}`);
  for(const entry of entries) {
    if(!files.includes(entry.file))throw Error(`Unexpected owned file: ${owner}/${entry.file}`);
    if(typeof entry.old!=='string'||!entry.old||typeof entry.new!=='string'||entry.new===entry.old)throw Error(`Invalid replacement: ${owner}`);
    const original=fs.readFileSync(path.join(__dirname,'baseline',entry.file),'utf8');
    if(original.split(entry.old).length!==2)throw Error(`Baseline anchor not unique: ${owner}/${entry.file}`);
    if(!staged.has(entry.file)) {
      const current=fs.readFileSync(path.join(root,entry.file),'utf8');
      if(current!==original)throw Error(`Product changed since snapshot: ${entry.file}`);
      staged.set(entry.file,current);
    }
    const current=staged.get(entry.file);
    if(current.split(entry.old).length!==2)throw Error(`Overlapping replacements: ${owner}/${entry.file}`);
    staged.set(entry.file,current.replace(entry.old,entry.new));
    changes.push({owner,file:entry.file,oldSha256:hash(entry.old),newSha256:hash(entry.new)});
  }
}
for(const [file,content] of staged)fs.writeFileSync(path.join(root,file),content);
const result={appliedAt:new Date().toISOString(),changes,files:[...staged].map(([file,content])=>({file,before:hash(fs.readFileSync(path.join(__dirname,'baseline',file))),after:hash(content)}))};
fs.writeFileSync(path.join(__dirname,'integration.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
