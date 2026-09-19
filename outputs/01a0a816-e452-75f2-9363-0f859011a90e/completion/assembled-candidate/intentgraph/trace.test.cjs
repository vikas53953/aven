'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createTracer}=require('./trace.cjs');
test('traces preserve async parentage and results without recording application data',async()=>{
  const events=[];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/session'){res.end(JSON.stringify({token:'fixture'}));return;}
    let body='';for await(const part of req)body+=part;
    events.push(JSON.parse(body));res.end(JSON.stringify({ok:true}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const tracer=createTracer({url:`http://127.0.0.1:${server.address().port}`,taskId:'task',actorId:'actor'});
  try{
    const result=await tracer.withSpan({file:'main.js',symbol:'parent'},async()=>{
      await Promise.resolve();
      return tracer.withSpan({file:'main.js',symbol:'child'},async()=> 'private-result');
    });
    assert.equal(result,'private-result');
    assert.deepEqual(events.map(e=>e.phase),['start','start','end','end']);
    assert.equal(events[1].parentSpanId,events[0].spanId);
    assert.equal(events[1].traceId,events[0].traceId);
    const failure=new Error('private-error');
    await assert.rejects(tracer.withSpan({file:'main.js'},async()=>{throw failure;}),e=>e===failure);
    assert.equal(events.at(-1).phase,'error');
    assert.ok(!JSON.stringify(events).includes('private-'));
  }finally{await new Promise(resolve=>server.close(resolve));}
  const errors=[];
  const disconnected=createTracer({url:`http://127.0.0.1:${server.address()?.port||1}`,taskId:'task',actorId:'actor',onError:e=>errors.push(e)});
  assert.equal(await disconnected.withSpan({file:'main.js'},async()=>42),42);
  assert.equal(errors.length,2);
});
