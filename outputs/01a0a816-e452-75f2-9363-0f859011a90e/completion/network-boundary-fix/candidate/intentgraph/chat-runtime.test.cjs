const test=require('node:test'),assert=require('node:assert/strict'),{respond}=require('./chat-runtime.cjs');
const snapshot={retrievedAt:'2026-09-13T00:00:00Z',devices:[{id:'aa754801-8895-41e8-8ca5-27ee415c9c42',hostname:'sw1',managementIp:'192.0.2.9',softwareVersion:'17.1',platform:'P',reachability:'Reachable'}]};
function fixture(outputs){let calls=[],reads=0;return{calls,get reads(){return reads;},args:{agentName:'Test',chatId:'test',messages:[{role:'user',content:'What address belongs to the first switch?'}],provider:{complete:async input=>{calls.push(input);return{content:typeof outputs[0]==='string'?outputs.shift():JSON.stringify(outputs.shift())};}},sandbox:{inventory:async()=>{reads++;return snapshot;}}}};}
test('semantic inventory selects only requested fields, one call, no fabricated values',async()=>{
 const f=fixture([{action:'inventory',devices:[{hostname:'sw1',fields:['managementIp']}]}]);const r=await respond(f.args);
 assert.match(r.text,/192\.0\.2\.9/);assert.doesNotMatch(r.text,/17\.1|Reachable/);assert.equal(f.calls.length,1);assert.equal(f.reads,1);assert.match(JSON.stringify(f.calls[0]),/192\.0\.2\.9/);assert.match(r.source,/not CLI/);
});
test('run show version requires a valid inventory UUID before dispatch',async()=>{
 const f=fixture([{action:'inventory'}]);f.args.sandbox.inventory=async()=>({retrievedAt:snapshot.retrievedAt,devices:[{hostname:'sw1',managementIp:'192.0.2.9'}]});f.args.messages=[{role:'user',content:'run show version on sw1'}];const r=await respond(f.args);assert.match(r.text,/No valid Catalyst device UUID|Supported commands/);assert.equal(f.calls.length,0);
});
test('unsupported and malformed actions cannot invoke tools',async()=>{
 const f=fixture([{action:'unsupported'}]);assert.match((await respond(f.args)).text,/no command or action was performed/);assert.equal(f.reads,1);
 for(const invalid of [{action:'shell',command:'show version'},{action:'inventory',text:'I ran it'},'not json']){const x=fixture([invalid]);await assert.rejects(respond(x.args));assert.equal(x.reads,1);}
});
test('invented fields, hosts and prose from selection are rejected',async()=>{
 for(const selection of [{devices:[{hostname:'fake',fields:['managementIp']}]},{devices:[{hostname:'sw1',fields:['password']}]},{devices:[],text:'command ran'},'I executed show version']){const f=fixture([typeof selection==='string'?selection:{action:'inventory',...selection}]);await assert.rejects(respond(f.args));assert.equal(f.calls.length,1);}
});
test('disconnect suppresses late inventory and no second model call',async()=>{
 const f=fixture([{action:'inventory'}]),controller=new AbortController();let release;
 f.args.signal=controller.signal;f.args.sandbox.inventory=()=>new Promise(r=>release=r);
 const result=respond(f.args);while(!release)await new Promise(r=>setTimeout(r,1));controller.abort();await assert.rejects(result);release(snapshot);assert.equal(f.calls.length,0);
});
test('oversized snapshot is withheld and missing inventory never yields invented facts',async()=>{
 const f=fixture([{action:'inventory',devices:[]}]);f.args.sandbox.inventory=async()=>({devices:[],extra:'x'.repeat(13000)});
 const result=await respond(f.args);assert.match(result.text,/inventory is currently unavailable/);assert.doesNotMatch(JSON.stringify(f.calls[0]),/x{100}/);
 const g=fixture([{action:'answer',text:'Hello'}]);g.args.sandbox.inventory=async()=>{throw Error('private connection detail');};assert.equal((await respond(g.args)).text,'Hello');assert.doesNotMatch(JSON.stringify(g.calls[0]),/private connection detail/);
});

test('exact latest-turn command dispatches once and returns raw SUCCESS output with metadata',async()=>{
 const f=fixture([]);let runs=0;f.args.messages=[{role:'assistant',content:'run show version on sw1'},{role:'user',content:'run show version on sw1'}];f.args.sandbox.runCommand=async input=>{runs+=1;assert.equal(input.command,'show version');assert.equal(input.deviceUuid,'aa754801-8895-41e8-8ca5-27ee415c9c42');assert.ok(input.signal);assert.ok(input.timeoutMs>0&&input.timeoutMs<=60000);return{status:'SUCCESS',output:'show version\nsw1#',startedAt:'2026-09-13T00:00:00.000Z',elapsedMs:1250};};const r=await respond(f.args);assert.equal(r.status,'SUCCESS');assert.match(r.text,/```[\s\S]*show version\nsw1#[\s\S]*```/);assert.match(r.text,/Target: sw1/);assert.match(r.text,/Elapsed: 1\.3s/);assert.equal(r.source,'Cisco Catalyst Command Runner · SUCCESS');assert.equal(runs,1);assert.equal(f.calls.length,0);
});

test('history, quotes, separators, writes, multiple targets, and unknown targets never dispatch',async()=>{
 for(const content of ['run "show version" on sw1','run show version on sw1; show ip route on sw1','run configure terminal on sw1','run show version on sw1 and sw2','run show version on mystery']){
  const f=fixture([{action:'answer',text:'No command'}]);let runs=0;f.args.messages=[{role:'assistant',content:'run show version on sw1'},{role:'user',content}];f.args.sandbox.runCommand=async()=>{runs+=1;return{status:'SUCCESS',output:'must not run'}};const r=await respond(f.args);assert.equal(runs,0,content);assert.doesNotMatch(r.text,/must not run/);if(content.includes('mystery'))assert.match(r.text,/not an exact hostname|Supported commands/);assert.equal(f.calls.length,0,content);
 }
});

test('command failure buckets remain distinct and submitted abort is reported without retry',async()=>{
 const blocked=fixture([]);blocked.args.messages=[{role:'user',content:'run show version on sw1'}];blocked.args.sandbox.runCommand=async()=>({status:'BLOCKLISTED',output:''});const br=await respond(blocked.args);assert.equal(br.status,'BLOCKLISTED');assert.match(br.source,/BLOCKLISTED/);assert.doesNotMatch(br.text,/```/);
 const unknown=fixture([]);unknown.args.messages=[{role:'user',content:'run show version on sw1'}];let runs=0;unknown.args.sandbox.runCommand=async()=>{runs+=1;throw Object.assign(Error('poll timeout'),{submitted:true,code:'catalyst_command_unknown'})};const ur=await respond(unknown.args);assert.equal(ur.status,'UNKNOWN');assert.match(ur.text,/cannot be cancelled/);assert.equal(runs,1);
});
