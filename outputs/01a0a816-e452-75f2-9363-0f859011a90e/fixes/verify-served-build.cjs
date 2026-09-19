'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
(async()=>{
 const files=[];
 for(const file of ['polished.html','polished.js','polished-diagnostics.js','polished-workspace-tools.js']){
  const response=await fetch(`http://127.0.0.1:8767/${file}?v=ux-audit-fixes-v8`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Static response failed: ${file} ${response.status}`);
  const served=hash(Buffer.from(await response.arrayBuffer())),local=hash(fs.readFileSync(path.join(root,file)));
  if(served!==local)throw Error(`Stale served file: ${file}`);
  files.push({file,sha256:local,servedMatches:true});
 }
 fs.writeFileSync(path.join(__dirname,'served-build-verification.json'),JSON.stringify({passed:true,at:new Date().toISOString(),build:'ux-audit-fixes-v8',files},null,2));
 console.log(JSON.stringify({passed:true,files}));
})().catch(error=>{console.error(error);process.exitCode=1;});
