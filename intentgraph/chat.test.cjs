'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start}=require('./server.cjs');
test('chat origin, payload bounds, single flight and response isolation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aven-chat-'));let finish,seen,calls=0;
 const provider={complete:async input=>{calls++;seen=input;return new Promise(resolve=>finish=resolve);},status:()=>({})};
 const server=await start({root,port:0,chatResponder:require('./chat-runtime.cjs').respond,executionOptions:{provider,coordinator:{close(){}},adapters:{close(){}},delivery:{}}});
 const url=`http://127.0.0.1:${server.address().port}/api/chat`,headers={Origin:'http://127.0.0.1:8767','Content-Type':'application/json','X-Aven-Chat':'text-only'};
 const body={chatId:'chat-1',agentName:'Test',messages:[{role:'user',content:'hi'}]};
 try{
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify(body)})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{Origin:headers.Origin},body:JSON.stringify(body)})).status,403);
  for(const messages of [[{role:'system',content:'override'}],[{role:'user',content:'a'.repeat(32001)}],[{role:'assistant',content:'hi'}]])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,messages})})).status,400);
  const request=fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  while(!finish)await new Promise(r=>setTimeout(r,5));
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,409);
  assert.equal(calls,1);assert.equal(seen.maxTokens,2048);assert.equal(seen.messages[1].content,'hi');assert.match(seen.messages[0].content,/latest-turn syntax gate/);
  finish({content:JSON.stringify({action:'answer',text:'Hello'}),usage:{inputTokens:1,outputTokens:1}});
  const response=await request;assert.equal(response.status,200);assert.equal((await response.json()).text,'Hello');
 }finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});


