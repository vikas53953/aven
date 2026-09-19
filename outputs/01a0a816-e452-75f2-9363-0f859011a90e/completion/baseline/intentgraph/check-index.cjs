'use strict';
const assert=require('node:assert/strict');
const {createTracer}=require('./trace.cjs');
async function readIndex(url){
  const response=await fetch(url+'/api/index');
  assert.equal(response.status,200);
  const index=await response.json();
  assert.ok(index.files.length>0,'index must contain files');
  const ids=new Set(index.nodes.map(node=>node.id));
  assert.equal(ids.size,index.nodes.length,'node IDs must be unique');
  for(const file of index.files){assert.ok(ids.has(file.id));assert.match(file.hash,/^[a-f0-9]{64}$/);}
  return {revision:index.revision,files:index.files.length,nodes:index.nodes.length,edges:index.edges.length};
}
async function main(){
  const url=process.env.INTENTGRAPH_URL||'http://127.0.0.1:8768';
  const taskId=process.env.INTENTGRAPH_TASK,actorId=process.env.INTENTGRAPH_ACTOR;
  const result=taskId&&actorId
    ?await createTracer({url,taskId,actorId,onError:error=>console.error(error.message)}).withSpan({file:'intentgraph/check-index.cjs',symbol:'readIndex'},()=>readIndex(url))
    :await readIndex(url);
  console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={readIndex};
