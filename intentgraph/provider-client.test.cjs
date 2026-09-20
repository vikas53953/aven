'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const admission=require('../polished-admission.js');
require('../polished-provider-picker.js');
const picker=globalThis.AvenProviderPicker;
const selection={providerId:'opencode',modelId:'mimo-v2.5',effort:'none'};
const options=()=>({agentId:'companion',agentName:'Companion',mode:'plan',messages:[{role:'user',content:'Investigate'}],selection:{...selection}});
test('saved request copies selection and retry retains it after preference changes',()=>{
 const chat={id:'chat-1'},message={role:'user'},input=options();let sequence=0;
 const saved=admission.prepare(chat,message,input,()=>`id-${++sequence}`);message.submission=saved;
 input.selection.modelId='changed';
 assert.deepEqual(saved.body.selection,selection);
 const retry=admission.prepare(chat,message,{...options(),selection:{...selection,modelId:'different'}});
 assert.equal(retry,saved);assert.deepEqual(retry.body.selection,selection);
});
test('legacy request remains valid without explicit selection; malformed selection is rejected',()=>{
 const input=options();delete input.selection;
 assert.equal(admission.valid(admission.prepare({id:'chat-2'},{role:'user'},input,()=> 'identity'),'chat-2'),true);
 assert.throws(()=>admission.prepare({id:'chat-2'},{role:'user'},{...options(),selection:{providerId:'unknown',modelId:'bad',effort:'high'}}));
});
test('picker rejects unavailable, unadvertised and unsupported selections',()=>{
 const snapshot={providers:[{id:'opencode',status:'configured',configured:true,models:[{id:'mimo-v2.5',status:'configured',efforts:['none']}]}]};
 assert.equal(picker.validateSelection(selection,snapshot).ok,true);
 assert.equal(picker.validateSelection({...selection,effort:'high'},snapshot).ok,false);
 assert.equal(picker.validateSelection({...selection,modelId:'invented'},snapshot).ok,false);
 snapshot.providers[0].configured=false;snapshot.providers[0].status='unknown';
 assert.equal(picker.validateSelection(selection,snapshot).ok,false);
});