'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const specs=[
  ...['polished.js','polished-diagnostics.js','polished-workspace-tools.js','polished-backup.js'].map(file=>({name:`Syntax: ${file}`,args:['--check',file]})),
  {name:'Backup schema and recovery',args:['--test','.intentgraph/runtime/verify-backup-schema.cjs']},
  {name:'Workspace tools',args:['.intentgraph/runtime/verify-workspace-tools.cjs']},
  {name:'Evidence tools',args:['.intentgraph/runtime/verify-evidence-tools.cjs']}
];
const tests=[];
for(const spec of specs){
  const startedAt=new Date().toISOString();
  const result=cp.spawnSync(process.execPath,spec.args,{cwd:root,encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:5e6});
  const log=spec.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.txt';
  fs.writeFileSync(path.join(__dirname,log),(result.stdout||'')+(result.stderr||''));
  const item={name:spec.name,command:[process.execPath,...spec.args],startedAt,endedAt:new Date().toISOString(),exitCode:result.status,passed:result.status===0,log,error:result.error?.message};
  tests.push(item);console.log(JSON.stringify(item));
}
fs.writeFileSync(path.join(__dirname,'root-regressions.json'),JSON.stringify({passed:tests.every(t=>t.passed),tests},null,2));
if(tests.some(t=>!t.passed))process.exitCode=1;
