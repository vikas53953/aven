'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
if(!fs.existsSync(path.join(__dirname,'integration.json')))throw Error('Integrate candidates first.');
const stamp=[];
for(const name of ['polished.js','polished.html']){
 const file=path.join(root,name),before=fs.readFileSync(file,'utf8');
 const count=before.split('ux-pipeline-v7').length-1;
 if(!count)throw Error(`Missing prior build marker: ${name}`);
 const after=before.replaceAll('ux-pipeline-v7','ux-audit-fixes-v8');
 fs.writeFileSync(file,after);
 stamp.push({file:name,replacements:count,sha256:crypto.createHash('sha256').update(after).digest('hex')});
}
fs.writeFileSync(path.join(__dirname,'build-stamp.json'),JSON.stringify({build:'ux-audit-fixes-v8',at:new Date().toISOString(),files:stamp},null,2));
console.log(JSON.stringify(stamp));
