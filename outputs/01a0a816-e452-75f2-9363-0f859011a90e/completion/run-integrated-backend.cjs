'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),crypto=require('node:crypto');
const root=process.env.AVEN_PRODUCT_ROOT?path.resolve(process.env.AVEN_PRODUCT_ROOT):path.resolve(__dirname,'../../..'),out=process.env.AVEN_TEST_OUTPUT?path.resolve(process.env.AVEN_TEST_OUTPUT):path.join(__dirname,'integrated-verification');
fs.mkdirSync(out,{recursive:true});
const files=fs.readdirSync(path.join(root,'intentgraph')).filter(f=>f.endsWith('.test.cjs')).sort().map(f=>'intentgraph/'+f);
const args=['--test','--test-reporter=tap','--test-timeout=60000','--test-concurrency=1',...files],startedAt=new Date().toISOString();
const sourceHashes=Object.fromEntries(fs.readdirSync(path.join(root,'intentgraph')).filter(f=>f.endsWith('.cjs')).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'intentgraph',f))).digest('hex')]));
let output='';const log=fs.createWriteStream(path.join(out,'backend-tests.txt'));
const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;log.write(chunk);});
const timer=setTimeout(()=>child.kill(),300000);
child.on('error',error=>{output+='\n'+error.stack;});
child.on('close',(exitCode,signal)=>{
 clearTimeout(timer);log.end();
 const report={command:'node '+args.join(' '),startedAt,endedAt:new Date().toISOString(),exitCode,signal,sourceHashes,summary:output.split(/\r?\n/).filter(l=>/^# (tests|pass|fail|cancelled|skipped|duration_ms)/.test(l))};
 fs.writeFileSync(path.join(out,'backend-tests.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,sourceHashes:undefined},null,2));process.exitCode=exitCode===0?0:1;
});
