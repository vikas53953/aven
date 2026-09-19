'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID}=require('node:crypto');
/** Optional instrumentation, not a debugger. Never transmits arguments, results or error contents. */
function createTracer({url='http://127.0.0.1:8768',taskId,actorId,onError=()=>{}}={}){
  const endpoint=new URL(url);
  if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost'].includes(endpoint.hostname))throw Error('Tracer requires a loopback IntentGraph service');
  if(!taskId||!actorId)throw Error('Tracer requires a registered task and actor');
  const context=new AsyncLocalStorage();let token;
  async function emit(span,phase){
    try{
      if(!token){const r=await fetch(endpoint.origin+'/api/session',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Trace session unavailable');token=(await r.json()).token;}
      const r=await fetch(endpoint.origin+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','Origin':endpoint.origin,'X-IntentGraph-Token':token},body:JSON.stringify({type:'trace.span',taskId,actorId,...span,phase}),signal:AbortSignal.timeout(5000)});
      if(!r.ok){if(r.status===403)token=null;throw Error('Trace event rejected: '+r.status);}
    }catch(error){try{onError(error);}catch{}}
  }
  async function withSpan({file,symbol,line},fn){
    if(typeof fn!=='function')throw Error('withSpan requires a function');
    const parent=context.getStore(),span={file,symbol,line,traceId:parent?.traceId||randomUUID(),spanId:randomUUID(),...(parent?{parentSpanId:parent.spanId}:{})};
    return context.run(span,async()=>{await emit(span,'start');try{const result=await fn();await emit(span,'end');return result;}catch(error){await emit(span,'error');throw error;}});
  }
  return{withSpan};
}
module.exports={createTracer};
