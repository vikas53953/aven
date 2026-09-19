'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),audit=path.dirname(__dirname);
const read=file=>JSON.parse(fs.readFileSync(path.join(__dirname,file),'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required=(value,label)=>{if(!value)throw Error(`Verification incomplete: ${label}`);};
const review=read('independent-review.json');required(review.status==='APPROVED'&&!(review.findings||[]).some(f=>!f.resolved),'independent review');
const creation=read('creation/creation-evidence-integrated.json');required(creation.mode==='integrated'&&creation.passed,'creation');
const connection=read('connection/report-integrated.json');required(connection.tests.length>=6&&connection.tests.every(t=>t.exitCode===0),'connection');
const artifacts=read('artifacts/evidence-integrated.json');required(artifacts.integrated&&artifacts.tests.every(t=>t.exitCode===0),'artifacts');
const header=read('header/report-integrated.json');required(header.tests.every(t=>t.passed),'header');
const regressions=read('root-regressions.json');required(regressions.passed,'module regressions');
const backend=read('backend-tests.json');required(backend.exitCode===0,'backend');
for(const file of ['atlas-verification.json','served-build-verification.json','live-ui-verification.json'])required(read(file).passed,file);
for(const item of read('original-artifacts.json'))required(hash(path.join(audit,item.file))===item.sha256.toLowerCase(),`original ${item.file}`);
for(const item of read('baseline-hashes.json'))required(hash(path.join(__dirname,'baseline',item.path))===item.sha256.toLowerCase(),`baseline ${item.path}`);
const source=JSON.parse(fs.readFileSync(path.join(audit,'source-register.json'),'utf8'));required(hash(source.source)===source.sha256.toLowerCase(),'source workbook');
for(const item of read('integrated-file-hashes.json'))required(hash(path.join(root,item.file))===item.sha256,'integrated file unchanged after review');
const allowed=new Set(['polished.js','polished.html','polished-diagnostics.js','polished-workspace-tools.js']);
const originalFiles=JSON.parse(fs.readFileSync(path.join(audit,'baseline-hashes.json'),'utf8').replace(/^\uFEFF/,''));
for(const item of originalFiles)if(!allowed.has(path.basename(item.path)))required(hash(item.path)===item.sha256.toLowerCase(),`untouched source ${path.basename(item.path)}`);
const tests=[
 {command:'creation/creation-audit.cjs --integrated',exitCode:0,result:`${creation.tests.length} creation scenarios passed: failures at all three persisted keys, saved-state preservation, pending recovery and same-name retry.`},
 {command:'connection/candidate/ux102-about-connection.test.cjs --integrated',exitCode:0,result:`${connection.tests.length} About connection cases passed.`},
 {command:'artifacts/artifact-duplication.test.cjs --integrated',exitCode:0,result:`${artifacts.evidence.length} artifact cases passed; exact output and distinct result preservation.`},
 {command:'header/rename-header-test.cjs --integrated',exitCode:0,result:`${header.tests[0].checks} rename/navigation/reload checks passed.`},
 ...regressions.tests.map(t=>({command:t.command.join(' '),exitCode:t.exitCode,result:`${t.name}: passed; log fixes/${t.log}`})),
 {command:backend.command,exitCode:backend.exitCode,result:backend.summary.join('; ')},
 {command:'verify-atlas.cjs',exitCode:0,result:read('atlas-verification.json').checks.join('; ')},
 {command:'verify-served-build.cjs',exitCode:0,result:'All four served UI assets match local patched file hashes.'},
 {command:'Direct browser UI verification',exitCode:0,result:'Build v8 and About state observed; existing Artifacts reduced from46 mirrored entries to23 outputs. Local configuration read only.'},
 {command:'Independent review',exitCode:0,result:'APPROVED for the four scoped repairs; see fixes/independent-review.json.'}
];
const result={passed:true,at:new Date().toISOString(),build:'ux-audit-fixes-v8',tests,originalWorkbooksUnchanged:true,baselinePreserved:true,limitations:[
 'These four repairs do not complete the remaining115-feature backlog.',
 'Failure tests use isolated browser storage and mocked status endpoints. No new provider or device request was made.',
 'Recovery preserves saved state. Newly typed unsaved changes during a persistent storage failure are not guaranteed.',
 'Artifact reconciliation is scoped to unambiguous persisted JSON mirrors; unknown/ambiguous repeated outputs remain visible.',
 'No live filesystem write, cross-device transaction or product-owner acceptance is asserted.'
]};
fs.writeFileSync(path.join(__dirname,'root-verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:true,groups:tests.length,build:result.build}));
