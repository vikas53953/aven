/* Compact, inert-by-default question rendering. Capabilities remain in memory. */
(function(root){
  'use strict';
  function scope(q){return {chatId:q.chatId,requestId:q.requestId,runId:q.runId,questionId:q.id,revision:q.revision};}
  function card(q,{live=false,busy=false,draft={},note='',onDraft,onAnswer,onCancel,onRefresh}={}){
    const box=document.createElement('section');box.className='clarification-card';box.dataset.questionId=q.id;
    const heading=document.createElement('h3');heading.id='question-'+q.id;
    heading.textContent=q.phase==='waiting'?'Waiting for your answer':q.phase==='cancelled'?'Request cancelled':q.answer?'Answer recorded':'Question no longer active';
    box.setAttribute('aria-labelledby',heading.id);box.append(heading);
    const prompt=document.createElement('p');prompt.className='clarification-prompt';prompt.textContent=q.prompt;box.append(prompt);
    if(q.reason){const reason=document.createElement('p');reason.className='clarification-reason';reason.textContent=q.reason;box.append(reason);}
    if(q.answer){const answer=document.createElement('p');answer.textContent='Your answer: '+q.answer.text;box.append(answer);}
    if(!live&&!q.answer&&(draft.text||draft.choiceId)){const saved=document.createElement('p');saved.textContent='Answer draft (delivery unconfirmed): '+(draft.text||q.choices.find(c=>c.id===draft.choiceId)?.label||draft.choiceId);box.append(saved);}
    const message=document.createElement('p');message.className='clarification-note';message.setAttribute('role','status');message.setAttribute('aria-atomic','true');message.textContent=note||(!live&&q.phase==='waiting'?'This saved question cannot be answered after reload. No answer was sent from this session. Cancel the waiting request, then send a fresh request.':'Answers supply information only. They do not authorize changes.');
    const form=document.createElement('form');form.className='clarification-form';
    const fieldset=document.createElement('fieldset');fieldset.disabled=busy;const legend=document.createElement('legend');legend.textContent='Choose one answer';fieldset.append(legend);
    if(live&&q.phase==='waiting'){
      for(const choice of q.choices){const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name='clarification-'+q.id;input.value=choice.id;input.checked=draft.choiceId===choice.id;input.onchange=()=>{delete draft.text;draft.choiceId=choice.id;if(free)free.value='';message.textContent=onDraft?.(draft)||message.textContent;};label.append(input,document.createTextNode(choice.label));fieldset.append(label);}
      var free;
      if(q.allowFreeText){const label=document.createElement('label');label.textContent=q.choices.length?'Or enter your answer':'Your answer';free=document.createElement('textarea');free.name='clarification-text';free.maxLength=2000;free.rows=3;free.value=draft.text||'';free.oninput=()=>{delete draft.choiceId;free.value=free.value.slice(0,2000);draft.text=free.value;fieldset.querySelectorAll('input').forEach(i=>i.checked=false);message.textContent=onDraft?.(draft)||message.textContent;};label.append(free);fieldset.append(label);}
      form.append(fieldset);
      const submit=document.createElement('button');submit.type='submit';submit.className='button-primary';submit.textContent=busy?'Sending answer…':'Continue';submit.disabled=busy;form.append(submit);
      form.onsubmit=e=>{e.preventDefault();if(!busy)onAnswer?.(draft.choiceId?{choiceId:draft.choiceId}:{text:draft.text||''});};box.append(form);
    }
    box.append(message);
    const actions=document.createElement('div');actions.className='clarification-actions';
    function button(label,fn){if(!fn)return;const b=document.createElement('button');b.type='button';b.className='button-secondary';b.textContent=label;b.disabled=busy;b.onclick=fn;if(label==='Refresh saved state')b.dataset.questionAction='refresh';actions.append(b);}
    if(q.phase==='waiting')button(live?'Cancel request':'Cancel waiting request',onCancel);
    button('Refresh saved state',onRefresh);box.append(actions);
    if(q.answer){
      const details=document.createElement('details');
      const summary=document.createElement('summary');summary.textContent='Answered: '+q.answer.text;
      const content=document.createElement('div');content.className='clarification-details';
      while(box.firstChild)content.append(box.firstChild);
      details.append(summary,content);box.append(details);box.classList.add('clarification-answered');
    }
    return box;
  }
  const api={scope,card};if(typeof module!=='undefined')module.exports=api;else root.AvenClarification=api;
})(typeof window!=='undefined'?window:globalThis);
