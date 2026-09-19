'use strict';
const fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const review=read(path.join(__dirname,'independent-review.json'));
if(review.status!=='APPROVED'||(review.findings||[]).some(f=>!f.resolved))throw Error('Independent review has not approved these fixes.');
const verified=read(path.join(__dirname,'root-verification.json'));
if(!verified.passed)throw Error('Root verification incomplete.');
const data=read(path.join(base,'integrated-audit.json'));
const changes={
 'UX-011':{verdict:'Verified (scoped)',finding:'Direct conversation rename preserves the coworker header and stored identity; folder conversations keep their own titles. The original header defect is fixed in this local build.',nextAction:'Retain rename, navigation and reload regression coverage.',limitation:'Scoped to the tested local direct/folder/coworker rename paths.'},
 'UX-058':{verdict:'Verified (scoped)',finding:'Coworker creation now commits recoverable exact local state. Tested persistence failures restore prior saved data; interrupted recovery is guarded and same-name retry succeeds. The local welcome remains distinct from a model response.',nextAction:'Retain storage-failure, reload, retry and unrelated-state preservation tests.',limitation:'Local isolated browser storage only; no cross-device transaction guarantee. New unsaved UI edits during a persistent storage failure are not guaranteed; recover saved state before continuing.'},
 'UX-066':{verdict:'Partial',finding:'Matching saved event/evidence copies are combined conservatively in Artifacts; distinct results, ambiguous repeated outputs and raw content are preserved. A complete generated-file artifact library remains outside this fix.',nextAction:'Implement actual generated-file opening/preview and verify chat scope before claiming the whole feature complete.',limitation:'Deduplication fix verified for unambiguous mirrored results; broader artifact-file capability remains partial.'},
 'UX-098':{verdict:'Partial',finding:'The confirmed coworker-creation recovery defect is fixed. This does not complete all offline, timeout, cancellation and provider-error recovery paths.',nextAction:'Complete independent recovery acceptance checks for remaining failure classes.',limitation:'Only the creation transaction/reload/retry path was fixed and tested in this batch.'},
 'UX-102':{verdict:'Verified (scoped)',finding:'About no longer invents configured status. Displayed connection identity follows the local diagnostics snapshot, including unchecked, false and unavailable states; credential configuration is not presented as provider health.',nextAction:'Retain true/false/unavailable diagnostics and safe-report regression coverage.',limitation:'Local status fixtures and served build identity only; no live provider/device reachability claim.'}
};
for(const row of data.rows){
 row.priorVerdict=row.verdict;row.priorFinding=row.finding;row.priorEvidence=row.evidence;
 if(changes[row.id]){
  Object.assign(row,changes[row.id]);row.evidenceLevel='Integrated focused regressions + independent review';
  row.evidence='fixes/independent-review.json; fixes/root-verification.json; fixes/integration.json';
  row.fixResolution='Confirmed defect fixed; current verdict describes remaining feature scope.';
 }else row.fixResolution='Not changed in this fix batch.';
 if(row.id==='UX-008'){
  row.finding='Initial header identity remains implemented. The related rename defect from the original audit is fixed in this batch; broader header acceptance coverage remains scoped.';
  row.nextAction='Complete the remaining header and short-message acceptance checks. Retain the passing rename/navigation regression.';
  row.limitation='Rename identity now passes focused tests. Broader header acceptance coverage remains incomplete.';
  row.fixResolution='Related UX-011 defect resolved; this row retains its prior Partial verdict.';
 }
 if(row.id==='UX-103'){
  row.finding='The original audit header-name inconsistency is fixed. A complete terminology/icon review across all surfaces remains outstanding.';
  row.nextAction='Complete the remaining terminology and icon consistency review across all surfaces.';
  row.limitation='The known rename inconsistency is resolved; complete terminology and icon acceptance is not yet verified.';
  row.fixResolution='Related UX-011 defect resolved; this row retains its prior verdict.';
 }
}
for(const defect of data.defects){
 defect.priorEvidence=defect.evidence;defect.status='Fixed (tested scope)';
 defect.resolution=changes[defect.ids[0]].finding;
 defect.evidence+='; fixes/independent-review.json; fixes/root-verification.json';
}
data.tests.push(...(verified.tests||[]));
data.rootObservations.push('Four confirmed defects fixed in build ux-audit-fixes-v8; reviewed against preserved pre-fix files. Original audit workbook and original feature register retained unchanged.');
data.methodology.push('Post-fix update changes the verdicts of only the five defect-affected rows after independent review; related header findings are clarified without upgrading their verdicts. Prior verdict/evidence are retained.');
const counts={};for(const row of data.rows)counts[row.verdict]=(counts[row.verdict]||0)+1;
data.summary=[
 'Four confirmed defects affecting five rows fixed and independently reviewed. This batch does not implement the remaining feature backlog.',
 `Post-fix snapshot: ${Object.entries(counts).map(([k,v])=>`${v} ${k}`).join('; ')}.`,
 'Partial can reflect missing capability or incomplete acceptance coverage. Live provider/device, real filesystem and owner acceptance remain separate.',
 'Original feature register and independent audit workbook are unchanged; prior verdicts remain visible for comparison.'
];
data.build='ux-audit-fixes-v8';data.auditDate='2026-09-16';data.counts=counts;
fs.writeFileSync(path.join(__dirname,'post-fix-data.json'),JSON.stringify(data,null,2));
console.log(JSON.stringify({rows:data.rows.length,counts},null,2));
