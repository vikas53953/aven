'use strict';
const path=require('node:path');
const {createProvider}=require('./provider.cjs');
const {getSecret,hasSecret}=require('./vault.cjs');
function createExecutionService({root,engine,runtimeDirectory,provider:injectedProvider,coordinator:injectedCoordinator,adapters:injectedAdapters,delivery:injectedDelivery}){
  const provider=injectedProvider||createProvider({getKey:()=>getSecret('opencode-go')});
  const coordinator=injectedCoordinator||new (require('./coordinator.cjs').Coordinator)({root,engine,provider,runtimeDirectory});
  const adapters=injectedAdapters||new (require('./adapters/index.cjs').ExecutionAdapters)({root,runtimeDirectory,getSecret,pythonPath:path.join(root,'.intentgraph','runtime','python','Scripts','python.exe'),browserExecutable:process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Google','Chrome','Application','chrome.exe'):undefined});
  const delivery=injectedDelivery||new (require('./delivery.cjs').DeliveryGate)({root,engine,runtimeDirectory});
  let checkPending=false,lastConnection=null;
  async function status(){const providerState=await provider.status();return{provider:{...providerState,connected:Boolean(providerState.last?.ok),credentialStored:hasSecret('opencode-go'),lastConnection},coordinator:await coordinator.status(),adapters:await adapters.status(),delivery:await delivery.status()};}
  async function action(input){
    const {type,...args}=input;
    switch(type){
      case 'execution.provider.check':{
        if(checkPending)throw Error('Connection check already running');checkPending=true;
        try{const response=await provider.complete({sessionId:'aven-local-connection-check',maxTokens:128,messages:[{role:'user',content:'Coding client connection check: reply OK only.'}]});lastConnection={ok:true,at:new Date().toISOString(),usage:response.usage};engine.recordEvent({type:'provider.check',provenance:'actual-provider-call',model:'mimo-v2.5',ok:true});return lastConnection;}catch(error){lastConnection={ok:false,at:new Date().toISOString(),code:error.code||'connection_failed'};throw error;}finally{checkPending=false;}
      }
      case 'execution.run.start':return coordinator.start(args);
      case 'execution.run.apply':return coordinator.apply(args);
      case 'execution.run.resume':return coordinator.resume(args);
      case 'execution.run.cancel':return coordinator.cancel(args);
      case 'execution.run.feedback':return coordinator.feedback(args);
      case 'execution.delivery.run':return delivery.run(args);
      case 'execution.adapter':{
        if(!new Set(['browser.open','browser.inspect','browser.preview','browser.execute','desktop.windows','desktop.select','desktop.inspect','desktop.preview','desktop.execute','network.profiles','network.read']).has(args.operation?.type))throw Error('This operation requires local adapter setup and is not exposed through the execution API');
        const result=await adapters.action(args.operation);
        engine.recordEvent({type:'adapter.action',operation:args.operation?.type,provenance:'local-adapter',at:new Date().toISOString()});return result;
      }
      default:throw Error('Unknown execution action');
    }
  }
  async function close(){await coordinator.close?.();await adapters.close?.();}
  return {status,action,close,provider,coordinator,adapters,delivery};
}
module.exports={createExecutionService};


