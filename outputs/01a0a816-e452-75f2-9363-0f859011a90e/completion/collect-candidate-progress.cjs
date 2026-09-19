'use strict';
const fs=require('node:fs'),path=require('node:path');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,p),'utf8').replace(/^\uFEFF/,''));
const coverage=read('coverage-ledger.json');
const reports=[['history','row-results.json'],['navigation-review','navigation-tests/row-results.json'],['minimal-ui','minimal-ui/row-results.json'],['reaction-picker','reaction-picker/row-results.json'],['reliability','reliability/row-results.json'],['provider','provider/row-results.json'],['workflows','workflows/row-results.json'],['workspace','workspace/row-results.json'],['automation','automation/row-results.json']];
const byId=new Map(),inputs=[];
for(const [owner,file] of reports){
 if(!fs.existsSync(path.join(__dirname,file))){inputs.push({owner,file,available:false});continue;}
 const report=read(file),rows=Array.isArray(report)?report:report.rows||report.results||[];
 inputs.push({owner,file,available:true,rows:rows.length});
 for(const row of rows){if(!/^UX-\d{3}$/.test(row.id||''))continue;if(!byId.has(row.id))byId.set(row.id,[]);byId.get(row.id).push({owner,report:file,...row});}
}
const rows=coverage.rows.map(row=>({id:row.id,feature:row.original.Feature,acceptance:row.original['Acceptance check'],priorVerdict:row.audit.verdict,owner:row.owner,candidateReports:byId.get(row.id)||[],rootVerdict:'Pending integration and acceptance review'}));
const report={at:new Date().toISOString(),warning:'Implementation claims and scoped test passes are not final completion verdicts.',inputs,rows};
fs.writeFileSync(path.join(__dirname,'candidate-progress.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({rows:rows.length,withCandidateReports:rows.filter(r=>r.candidateReports.length).length,inputs},null,2));
