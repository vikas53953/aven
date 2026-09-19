'use strict';
const {SUPPORTED_COMMANDS,isUuid}=require('./catalyst.cjs');
const {COMMANDS}=require('./adapters/index.cjs');
function createNetworkExecution({catalyst,adapters}) {
  const supportedCommands=[...new Set([...SUPPORTED_COMMANDS,...Object.values(COMMANDS).flat()])];
  return {
    supportedCommands,
    isDeviceId:id=>isUuid(id)||(typeof id==='string'&&/^ssh:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id)),
    async inventory({signal}={}) {
      signal?.throwIfAborted();
      const profiles=adapters.readProfiles();
      let snapshot,unavailable=[];
      try { snapshot=await catalyst.inventory({signal}); }
      catch(error){signal?.throwIfAborted();if(!profiles.length)throw error;snapshot={devices:[]};unavailable.push('cisco-catalyst');}
      return {source:'aven-network-execution',retrievedAt:snapshot.retrievedAt||new Date().toISOString(),unavailable,
        devices:[...snapshot.devices.map(d=>({...d,transport:'cisco-catalyst',supportedCommands:[...SUPPORTED_COMMANDS]})),
          ...profiles.map(p=>({id:'ssh:'+p.id,hostname:p.id,managementIp:p.host,platform:p.platform,transport:'nornir-netmiko',reachability:'Not checked',supportedCommands:COMMANDS[p.platform]}))]};
    },
    async runCommand({command,deviceUuid,signal,timeoutMs}) {
      signal?.throwIfAborted();const startedAt=new Date().toISOString();
      if(typeof deviceUuid==='string'&&deviceUuid.startsWith('ssh:')) {
        const profileId=deviceUuid.slice(4),profile=adapters.readProfiles().find(p=>p.id===profileId);
        if(!profile||!COMMANDS[profile.platform]?.includes(command))return {status:'NOT_EXECUTED',source:'nornir-netmiko',output:'',startedAt};
        try {const result=await adapters.networkRead({profileId,command},{signal});return {status:'SUCCESS',source:'nornir-netmiko',output:result.output,startedAt,elapsedMs:Date.now()-Date.parse(startedAt)};}
        catch(error){return {status:error.submitted?'UNKNOWN':'FAILURE',source:'nornir-netmiko',output:'',startedAt,elapsedMs:Date.now()-Date.parse(startedAt)};}
      }
      if(!isUuid(deviceUuid)||!SUPPORTED_COMMANDS.includes(command))return {status:'NOT_EXECUTED',source:'cisco-catalyst',output:'',startedAt};
      return {...await catalyst.runCommand({command,deviceUuid,signal,timeoutMs}),source:'cisco-catalyst'};
    }
  };
}
module.exports={createNetworkExecution};
