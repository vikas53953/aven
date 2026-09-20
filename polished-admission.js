/* Saved request identity only. Backend receipts authorize execution. */
(function(root){
  'use strict';
  const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
  function validSelection(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&['opencode','openrouter','anthropic','openai'].includes(value.providerId)&&typeof value.modelId==='string'&&value.modelId.trim()===value.modelId&&value.modelId.length>0&&value.modelId.length<=200&&['none','low','medium','high','max'].includes(value.effort);}
  function valid(value,chatId){
    const b=value?.body;
    return b&&b.chatId===chatId&&(b.selection===undefined||validSelection(b.selection))&&id(b.chatId)&&id(b.requestId)&&id(b.idempotencyKey)&&typeof b.agentName==='string'&&b.agentName.length<=80&&['inspect','plan'].includes(b.mode)&&Array.isArray(b.messages)&&b.messages.length>0&&b.messages.length<=24&&b.messages.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.trim())&&b.messages.at(-1).role==='user'&&b.messages.reduce((n,m)=>n+m.content.length,0)<=32000;
  }
  function prepare(chat,message,{agentId,agentName,mode,messages,selection},uuid=()=>crypto.randomUUID()){
    if(message.submission?.body?.chatId===chat.id){
      if(!valid(message.submission,chat.id))throw Error('Saved request is invalid. Keep your workspace backup before continuing.');
      return message.submission;
    }
    const submission={agentId,state:'prepared',body:{chatId:chat.id,requestId:uuid(),idempotencyKey:uuid(),agentName:agentName.slice(0,80),mode:mode==='plan'?'plan':'inspect',messages:messages.map(({role,content})=>({role,content}))}};
    if(selection)submission.body.selection={providerId:selection.providerId,modelId:selection.modelId,effort:selection.effort};
    if(!valid(submission,chat.id))throw Error('The saved request exceeds the local chat limits.');
    return submission;
  }
  function pending(chat){
    const message=chat.messages.find(m=>m.role==='user'&&m.submission?.body?.chatId===chat.id&&m.submission.body.requestId===chat.pendingAdmission);
    return message&&valid(message.submission,chat.id)?{message,submission:message.submission}:null;
  }
  function resultFor(chat,result){
    return chat.messages.find(m=>m.role==='assistant'&&result.requestId&&m.requestId===result.requestId)
      ||chat.messages.find(m=>m.role==='assistant'&&!m.requestId&&result.runId&&m.runId===result.runId);
  }
  function reconcileResult(chat,result){
    const existing=resultFor(chat,result);
    if(!existing){chat.messages.push(result);return result;}
    // An authoritative outcome updates this request's existing message. Retain
    // annotations and exact earlier captures, even if the new reply omits them.
    const retained={id:existing.id,createdAt:existing.createdAt||result.createdAt};
    for(const key of ['events','evidence']){
      const seen=new Set();retained[key]=[];
      for(const item of [...(existing[key]||[]),...(result[key]||[])]){
        const identity=JSON.stringify(item);if(seen.has(identity))continue;
        seen.add(identity);retained[key].push(item);
      }
    }
    Object.assign(existing,result,retained);return existing;
  }
  function applyReceipt(chat,submission,receipt,record){
    if(receipt.chatId!==chat.id||receipt.requestId!==submission.body.requestId||!['settled','unknown'].includes(receipt.state))throw Error('The saved receipt is not a completed local admission.');
    if(record&&(record.chatId!==chat.id||record.runId!==receipt.runId||record.requestId!==receipt.requestId))throw Error('Saved run does not match this request.');
    const existing=resultFor(chat,receipt);
    const reply=record?.reply;
    const result={...(receipt.question?{question:receipt.question}:{}),id:existing?.id||crypto.randomUUID(),role:'assistant',agentId:submission.agentId,requestId:receipt.requestId,runId:receipt.runId,status:receipt.outcome,mode:submission.body.mode,text:reply?.text||(receipt.question?.phase==='cancelled'?'Request cancelled. No continuation was dispatched.':'Remote completion is unknown. Review captured evidence before continuing. No request was retried.'),source:reply?.source||'Saved local run',model:reply?.model,usage:reply?.usage,events:record?.events||existing?.events||[],evidence:reply?.evidence||existing?.evidence||[],createdAt:existing?.createdAt||receipt.updatedAt};
    if(reply?.requestedSelection)result.requestedSelection=reply.requestedSelection;
    if(reply?.provenance)result.provenance=reply.provenance;
    const reconciled=reconcileResult(chat,result);
    submission.state='settled';submission.receipt=receipt;
    delete chat.pendingAdmission;delete chat.runJournal;delete chat.queueDispatching;delete chat.replyError;delete chat.captureWarning;
    chat.queuePaused=!!chat.pendingQueue?.length;chat.queuePauseReason=chat.queuePaused?'Saved run reviewed. Resume queued work explicitly.':'';
    return reconciled;
  }
  const api={valid,validSelection,prepare,pending,applyReceipt,reconcileResult};
  if(typeof module!=='undefined')module.exports=api;else root.AvenAdmission=api;
})(typeof window!=='undefined'?window:globalThis);
