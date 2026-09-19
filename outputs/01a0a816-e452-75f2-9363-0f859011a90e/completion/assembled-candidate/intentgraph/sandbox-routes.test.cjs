'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start}=require('./server.cjs');
test('sandbox routes require exact origin and explicit header without exposing generic actions',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'catalyst-route-'));
 let reads=0;
 const server=await start({root,port:0,execution:false,sandbox:{status:()=>({configured:true}),inventory:()=>{reads++;return{devices:[]};},close(){}}});
 const base=`http://127.0.0.1:${server.address().port}`;
 const origin='http://127.0.0.1:8767';
 try{
  for(const bad of ['https://example.com','http://127.0.0.1:8767.evil.com','null']){
   const r=await fetch(base+'/api/sandbox/inventory',{method:'POST',headers:{Origin:bad,'X-Aven-Sandbox':'read-only'}});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
  }
  assert.equal((await fetch(base+'/api/sandbox/inventory',{method:'POST',headers:{Origin:origin}})).status,403);
  const pre=await fetch(base+'/api/sandbox/inventory',{method:'OPTIONS',headers:{Origin:origin}});assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),origin);
  assert.equal((await fetch(base+'/api/sandbox/inventory',{method:'POST',headers:{Origin:origin,'X-Aven-Sandbox':'read-only'},body:'{"url":"https://evil.com"}'})).status,400);
  const result=await fetch(base+'/api/sandbox/inventory',{method:'POST',headers:{Origin:origin,'X-Aven-Sandbox':'read-only'}});assert.equal(result.status,200);assert.equal(reads,1);
  const session=await fetch(base+'/api/session',{headers:{Origin:origin}});assert.equal(session.headers.get('access-control-allow-origin'),null);
  const {token}=await session.json();assert.equal((await fetch(base+'/api/action',{method:'POST',headers:{Origin:origin,'X-IntentGraph-Token':token},body:'{}'})).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
