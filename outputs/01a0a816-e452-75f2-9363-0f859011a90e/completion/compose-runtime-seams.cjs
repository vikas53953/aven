'use strict';
// Root-owned integration seams. Candidate only; exact anchors fail closed.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'root-stage'),resolutions=[];
function patch(file,old,next,reason){const p=path.join(root,file),s=fs.readFileSync(p,'utf8');if(s.split(old).length!==2)throw Error('Missing/ambiguous seam: '+reason);fs.writeFileSync(p,s.replace(old,next));resolutions.push({file,reason});}
const server='intentgraph/server.cjs',runtime='intentgraph/agent-runtime.cjs';
patch(server,"const messages={provider_401:'OpenCode authentication failed.',provider_429:'OpenCode rate limit reached. Try again later.',provider_timeout:'OpenCode timed out. You can retry.',provider_key_unavailable:'OpenCode key is unavailable locally.'};","const messages={provider_401:'The selected provider rejected authentication.',provider_429:'The selected provider reached its rate limit. Try again later.',provider_timeout:'The selected provider timed out. Review any captured results before retrying.',provider_key_unavailable:'The selected provider key is unavailable locally.'};",'Attribute errors to the selected provider without implying OpenCode');
patch(server,'JSON.stringify({chatId:body.chatId,agentName:body.agentName,mode,messages:body.messages})','JSON.stringify({chatId:body.chatId,agentName:body.agentName,mode,messages:body.messages,selection:selected.selection,context:body.context||null})','Bind replay identity to selected provider and request context');
patch(server,'execution, reliability, recoverReliability, recoverAbandonedReliability };','execution, reliability, recoverReliability, recoverAbandonedReliability, clarificationManager: workflowManager, workflowApi, gitWorkspace, gitApi };','Expose composed workflow, Git and reliability lifecycle for local tests');
const serverText=fs.readFileSync(path.join(root,server),'utf8');
const start=serverText.indexOf('        const responder=options.chatResponder'),end=serverText.indexOf('\n      }catch(error){',start);
if(start<0||end<0)throw Error('Responder seam missing');
const old=serverText.slice(start,end),call=old.match(/const reply=await responder\(\{([\s\S]*?)\}\);/);
if(!call)throw Error('Selected-provider responder options missing');
patch(server,old,`        const responder=options.chatResponder||require('./agent-runtime.cjs').respond;
        const workflowRun=await workflowManager.start({runId,chatId:body.chatId,mode,messages:body.messages,selection:selected.selection,responder,onEvent:event=>{if(event.type!=='start'&&event.type!=='pending_question'&&event.type!=='completed')emit(event);},responderOptions:{${call[1]}}});
        runState.beginClosing();
        if(workflowRun.status==='waiting-question'){
          completedReply={...workflowRun,runId,mode};
          const metadata=workflowRun.result||{};
          emit({type:'pending_question',mode,question:workflowRun.pendingQuestion.question,questionToken:workflowRun.pendingQuestion.token,...metadata});
        }else{
          completedReply={...workflowRun.result,runId,mode,workflowRunId:workflowRun.runId};
          emit({type:'final',reply:completedReply});
        }
        if(!streaming&&!res.destroyed)sendJson(res,200,completedReply);`,'Route selected provider through clarification lifecycle');
patch(server,'onStatus: options.onWorkflowStatus',`onStatus: state=>{
      const prior=reliability.getRun(state.runId);
      if(state.terminal&&prior?.status==='WAITING'){
        const statuses=[];const visit=value=>{if(!value||typeof value!=='object')return;if(typeof value.status==='string')statuses.push(value.status.toUpperCase());for(const key of ['evidence','events'])if(Array.isArray(value[key]))value[key].forEach(visit);};visit(state.result);
        const status=state.status!=='completed'?'UNKNOWN':statuses.includes('UNKNOWN')?'UNKNOWN':statuses.some(x=>['FAILURE','BLOCKLISTED','NOT_EXECUTED'].includes(x))?'FAILURE':'SUCCESS';
        reliability.settleRun(state.runId,status,{chatId:state.chatId},{ownerId:serverOwnerId,idempotencyKey:'workflow.settle:'+state.runId+':'+status});
        try{
          const filename=path.join(root,'.intentgraph','evidence','runs',state.runId+'.json');
          const previous=JSON.parse(fs.readFileSync(filename,'utf8'));
          if(previous.runId!==state.runId||previous.chatId!==state.chatId)throw Error('Run evidence ownership mismatch');
          const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:token|credential|password|secret|authorization)$/i.test(key)).map(([key,item])=>[key,clean(item)])):value;
          const reply=clean({...state.result,runId:state.runId,mode:state.mode,status});
          const event={type:'workflow_settled',runId:state.runId,at:new Date().toISOString(),status,events:clean(state.events||[])};
          const next={...previous,initialReply:previous.initialReply||previous.reply,reply,events:[...(previous.events||[]),event].slice(-100)};
          const encoded=JSON.stringify(next,null,2);if(Buffer.byteLength(encoded)>8*1024*1024)throw Error('Run evidence storage limit exceeded');
          const temporary=filename+'.tmp-'+crypto.randomUUID();fs.writeFileSync(temporary,encoded,{flag:'wx'});fs.renameSync(temporary,filename);
        }catch(error){console.error('Workflow evidence could not be saved',error.code||error.message);}
      }
      options.onWorkflowStatus?.(state);
    }`,'Settle the same durable WAITING run after answer or cancel');
patch(runtime,'    let finalMessage = null;','    let finalMessage = null;\n    let pendingQuestion = null;','Track a validated pending question without replacing provider metadata');
const responseUpdate='          responseMetadata = { providerId: observed.providerId || responseMetadata.providerId, modelId: observed.modelId || responseMetadata.modelId, effort: observed.effort || responseMetadata.effort, usage: observed.usage || responseMetadata.usage };';
patch(runtime,responseUpdate,responseUpdate+'\n          const structured=extractPendingQuestion(output);if(structured){pendingQuestion=structured;try{onModelComplete?.();}catch{}break;}','Extract question after observing actual provider response');
patch(runtime,"    const text = stringifyContent(finalMessage?.content).slice(0, MAX_RESPONSE_TEXT_BYTES);",`    if(pendingQuestion){const provenance=responseProvenance({requested:selected,response:responseMetadata});return {pendingQuestion,source:'LangGraph network coworker',providerId:selected.providerId,model:selected.modelId,effort:selected.effort,requestedSelection:selected,provenance,usage:provenance.usage,context:context||null,mode:selectedMode,evidence:evidence.map(item=>({...item})),runId};}
    const text = stringifyContent(finalMessage?.content).slice(0, MAX_RESPONSE_TEXT_BYTES);`,'Preserve selected and observed provider provenance on clarification');
const finalRuntime=fs.readFileSync(path.join(root,runtime),'utf8');
if(!finalRuntime.includes('const incompleteSummary = incompleteEvidenceSummary(evidence);')||!finalRuntime.includes('text: incompleteSummary || groundedText,'))throw Error('Independent health boundary hunks missing');
resolutions.push({file:runtime,reason:'Health boundary independently composes with provider metadata'});
fs.writeFileSync(path.join(__dirname,'runtime-seam-resolutions.json'),JSON.stringify({at:new Date().toISOString(),resolutions},null,2));
console.log(JSON.stringify({resolved:resolutions.length}));
