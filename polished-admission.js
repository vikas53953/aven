/* Saved request identity only. Backend receipts authorize execution. */
(function(root){
  'use strict';
  const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
  function valid(value,chatId){
    const b=value?.body;
    return b&&b.chatId===chatId&&id(b.chatId)&&id(b.requestId)&&id(b.idempotencyKey)&&typeof b.agentName==='string'&&b.agentName.length<=80&&['inspect','plan'].includes(b.mode)&&Array.isArray(b.messages)&&b.messages.length>0&&b.messages.length<=24&&b.messages.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.trim())&&b.messages.at(-1).role==='user'&&b.messages.reduce((n,m)=>n+m.content.length,0)<=32000;
  }
  function prepare(chat,message,{agentId,agentName,mode,messages},uuid=()=>crypto.randomUUID()){
    if(message.submission?.body?.chatId===chat.id){
      if(!valid(message.submission,chat.id))throw Error('Saved request is invalid. Keep your workspace backup before continuing.');
      return message.submission;
    }
    const submission={agentId,state:'prepared',body:{chatId:chat.id,requestId:uuid(),idempotencyKey:uuid(),agentName:agentName.slice(0,80),mode:mode==='plan'?'plan':'inspect',messages:messages.map(({role,content})=>({role,content}))}};
    if(!valid(submission,chat.id))throw Error('The saved request exceeds the local chat limits.');
    return submission;
  }
  function pending(chat){
    const message=chat.messages.find(m=>m.role==='user'&&m.submission?.body?.chatId===chat.id&&m.submission.body.requestId===chat.pendingAdmission);
    return message&&valid(message.submission,chat.id)?{message,submission:message.submission}:null;
  }
  function applyReceipt(chat,submission,receipt,record){
    if(receipt.chatId!==chat.id||receipt.requestId!==submission.body.requestId||!['settled','unknown'].includes(receipt.state))throw Error('The saved receipt is not a completed local admission.');
    if(record&&(record.chatId!==chat.id||record.runId!==receipt.runId||record.requestId!==receipt.requestId))throw Error('Saved run does not match this request.');
    const existing=chat.messages.find(m=>m.role==='assistant'&&(m.requestId===receipt.requestId||m.runId===receipt.runId));
    const reply=record?.reply;
    const result={id:existing?.id||crypto.randomUUID(),role:'assistant',agentId:submission.agentId,requestId:receipt.requestId,runId:receipt.runId,status:receipt.outcome,mode:submission.body.mode,text:reply?.text||'Remote completion is unknown. Review captured evidence before continuing. No request was retried.',source:reply?.source||'Saved local run',model:reply?.model,usage:reply?.usage,events:record?.events||existing?.events||[],evidence:reply?.evidence||existing?.evidence||[],createdAt:existing?.createdAt||receipt.updatedAt};
    if(existing)Object.assign(existing,result);else chat.messages.push(result);
    submission.state='settled';submission.receipt=receipt;
    delete chat.pendingAdmission;delete chat.runJournal;delete chat.queueDispatching;delete chat.replyError;delete chat.captureWarning;
    chat.queuePaused=!!chat.pendingQueue?.length;chat.queuePauseReason=chat.queuePaused?'Saved run reviewed. Resume queued work explicitly.':'';
    return result;
  }
  const api={valid,prepare,pending,applyReceipt};
  if(typeof module!=='undefined')module.exports=api;else root.AvenAdmission=api;
})(typeof window!=='undefined'?window:globalThis);
