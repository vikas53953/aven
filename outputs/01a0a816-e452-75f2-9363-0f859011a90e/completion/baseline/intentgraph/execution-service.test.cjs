'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createExecutionService}=require('./execution-service.cjs');
test('execution API denies profile mutation and dispatches only named local operations',async()=>{
 const operations=[];const service=createExecutionService({root:__dirname,runtimeDirectory:__dirname,engine:{recordEvent(){}},provider:{status:()=>({last:{ok:true}})},coordinator:{status:()=>({runs:[]})},adapters:{status:()=>({}),action:async input=>{operations.push(input.type);return{profiles:[]};}},delivery:{status:()=>({})}});
 await assert.rejects(service.action({type:'execution.adapter',operation:{type:'network.profile.configure',explicit:true,credentialRef:'network-cisco'}}),/local adapter setup/);
 await assert.rejects(service.action({type:'execution.adapter',operation:{type:'network.execute'}}),/local adapter setup/);
 assert.deepEqual(operations,[]);
 await service.action({type:'execution.adapter',operation:{type:'network.profiles'}});
 assert.deepEqual(operations,['network.profiles']);
 assert.equal((await service.status()).provider.last.ok,true);
 await service.close();
});
