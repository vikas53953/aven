/* Local run capture: no execution, credentials, network or automatic retries. */
(function(root){
  'use strict';
  const MAX_BYTES=1024*1024,MAX_EVENTS=100;
  const privateKey=k=>/^(?:proto|prototype|constructor|token|steeringToken|accessToken|refreshToken|bearerToken|apiKey|password|credential|credentials|controller|authorization|permission|permissions|secret|clientSecret)$/i.test(k.replace(/[_-]/g,''));
  function clean(value,depth=0){
    if(depth>32)throw Error('Run metadata is too deeply nested.');
    if(value===null||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(v=>clean(v,depth+1));
    return Object.fromEntries(Object.entries(value).filter(([k])=>!privateKey(k)).map(([k,v])=>[k,clean(v,depth+1)]));
  }
  function journal(p){
    if(p.events.length>MAX_EVENTS)throw Error('Run capture exceeded 100 events.');
    const j=clean({id:p.journalId,runId:p.runId||null,agentId:p.agentId,startedAt:p.startedAt,events:p.events,status:'UNKNOWN'});
    if(new TextEncoder().encode(JSON.stringify(j)).length>MAX_BYTES)throw Error('Run capture exceeded 1 MiB.');
    return j;
  }
  function valid(j){return j&&typeof j.id==='string'&&j.id.length<=100&&typeof j.agentId==='string'&&Number.isFinite(Date.parse(j.startedAt))&&Array.isArray(j.events)&&j.events.length<=MAX_EVENTS&&new TextEncoder().encode(JSON.stringify(j)).length<=MAX_BYTES;}
  function recover(chat,agentId){
    const j=chat.runJournal;if(!j)return null;
    if(!valid(j))return {invalid:true};
    if(chat.messages.some(m=>m.journalId===j.id||(j.runId&&m.runId===j.runId)))return {duplicate:true};
    const events=clean(j.events);
    return {id:j.id,role:'assistant',agentId:agentId||j.agentId,journalId:j.id,runId:j.runId,status:'UNKNOWN',text:'Previous session interrupted. Remote completion is unknown; a submitted command may still finish. Captured evidence is retained. No request was retried.',source:'Recovered local run capture',events,evidence:events.flatMap(e=>Array.isArray(e.evidence)?e.evidence:e.evidence?[e.evidence]:[]),createdAt:new Date().toISOString(),durationMs:Math.max(0,Date.parse(events.at(-1)?.at||j.startedAt)-Date.parse(j.startedAt))};
  }
  function usage(value){
    if(!value||typeof value!=='object')return null;
    const result={};for(const [key,n] of Object.entries(value))if(['inputTokens','outputTokens','totalTokens','input_tokens','output_tokens','total_tokens'].includes(key)&&Number.isSafeInteger(n)&&n>=0)result[key]=n;
    return Object.keys(result).length?result:null;
  }
  function outcome(reply,events=[]){
    const statuses=[];const visit=value=>{if(!value||typeof value!=='object')return;if(typeof value.status==='string')statuses.push(value.status.toUpperCase());for(const key of ['evidence','events']){const items=value[key];if(Array.isArray(items))items.forEach(visit);else if(items)visit(items);}};visit(reply);events.forEach(visit);
    for(const status of ['FAILURE','BLOCKLISTED','UNKNOWN','NOT_EXECUTED'])if(statuses.includes(status))return status;
    return reply.partial||reply.status&&reply.status!=='SUCCESS'?'UNKNOWN':'SUCCESS';
  }
  const api={MAX_BYTES,MAX_EVENTS,clean,journal,recover,usage,outcome};
  if(typeof module!=='undefined')module.exports=api;else root.AvenRunState=api;
})(typeof window!=='undefined'?window:globalThis);
