'use strict';
// Prepare only. Applying requires the root's separate reviewed integration call.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const out=path.resolve(__dirname,'..'),product=path.resolve(out,'../../..'),candidate=path.join(out,'assembled-candidate');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest={createdAt:new Date().toISOString(),purpose:'Root-reviewed candidate; dry-run before apply',owners:[],composedFiles:[],newFiles:[]};
const backup=path.join(__dirname,'pre-integration-backup'),changes=[];
function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(item.isSymbolicLink())continue;
 const source=path.join(dir,item.name),rel=path.relative(candidate,source).replace(/\\/g,'/');
 if(item.isDirectory()){if(!['node_modules','runtime','logs','outputs'].includes(item.name)&&!item.name.startsWith('.'))visit(source);continue;}
 if(/(?:\.test\.|test-|package-lock|test-results)/.test(rel))continue;
 if(!/\.(?:js|cjs|mjs|json|css|html|svg|png|woff2?)$/.test(rel))continue;
 const content=fs.readFileSync(source),dest=path.join(product,rel),prior=fs.existsSync(dest)?fs.readFileSync(dest):null;
 if(prior&&content.equals(prior))continue;
 const baseline=path.join(out,'baseline',rel),entry={file:rel,source:'assembled-candidate/'+rel,sha256:hash(content)};
 if(fs.existsSync(baseline)&&prior){entry.baselineSha256=hash(fs.readFileSync(baseline));entry.expectedCurrentSha256=hash(prior);manifest.composedFiles.push(entry);}
 else{entry.owner='root-reviewed-round2';if(prior)entry.expectedExistingSha256=hash(prior);manifest.newFiles.push(entry);}
 const backupFile=path.join(backup,rel);
 if(prior){fs.mkdirSync(path.dirname(backupFile),{recursive:true});if(fs.existsSync(backupFile)&&hash(fs.readFileSync(backupFile))!==hash(prior))throw Error('Backup differs from current product '+rel);fs.writeFileSync(backupFile,prior);}
 changes.push({file:rel,before:prior?hash(prior):null,after:hash(content)});
}}
visit(candidate);
fs.mkdirSync(backup,{recursive:true});
fs.writeFileSync(path.join(__dirname,'integration-manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(backup,'index.json'),JSON.stringify({at:manifest.createdAt,changes},null,2));
console.log(JSON.stringify({prepared:true,applied:false,changedFiles:changes.length,backup}));
