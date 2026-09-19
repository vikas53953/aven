'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const out=path.resolve(__dirname,'..');
for(const script of ['prepare-stage.cjs','resolve-core-stage.cjs','round2/compose-existing.cjs','compose-runtime-seams.cjs','compose-workflow-ui.cjs','round2/compose-final-seams.cjs','prepare-backup-compat.cjs','assemble-test-candidate.cjs','round2/apply-reviewed-deltas.cjs']){
 const result=spawnSync(process.execPath,[path.join(out,script)],{cwd:out,encoding:'utf8',windowsHide:true});
 if(result.status!==0){process.stderr.write(result.stderr||result.stdout||String(result.error));process.exit(result.status||1);}
 console.log(script+' PASS');
}
const resolutions={
 'provider:20':'round2/compose-existing capability discovery/preflight/concurrency',
 'workflows:3':'compose-runtime-seams exposes workflow and Git lifecycle',
 'workflows:4':'compose-runtime-seams preserves selected provider responder options through workflow manager',
 'workflows:8':'provider response metadata is internally observed; obsolete caller metadata argument is unnecessary',
 'workflows:9':'compose-runtime-seams plus final-seams capture model and tool clarification with provider provenance',
 'workflows:15':'compose-workflow-ui handles waiting question alongside reliability/provider validation',
 'workflows:23':'round2/compose-existing merges owned workflow/reliability shutdown',
 'workspace:1':'round2/compose-existing removes duplicate attachment binder',
 'automation:4':'round2/compose-existing merges controller declaration',
 'automation:9':'round2/compose-existing preserves reply metadata and records notification after successful save',
 'automation:10':'round2/compose-existing preserves automation pane during chat navigation',
 'automation:14':'round2/compose-existing merges Settings categories',
 'terminal:2':'round2/compose-existing preserves Agent/Plan plus menu and adds Terminal',
 'git:3':'round2/compose-existing merges Git Settings with provider configuration',
 'git:8':'compose-runtime-seams exposes Git and workflow alongside reliability'
};
const core=JSON.parse(fs.readFileSync(path.join(out,'root-core-resolutions.json'),'utf8'));
for(const entry of core.pending){if(!resolutions[entry.owner+':'+entry.index])throw Error('Unreviewed conflict '+entry.owner+':'+entry.index);}
const files=JSON.parse(fs.readFileSync(path.join(out,'assembled-provenance.json'),'utf8')).finalFiles;
fs.writeFileSync(path.join(__dirname,'base-composition-review.json'),JSON.stringify({at:new Date().toISOString(),pendingConflicts:[],resolved:core.pending.map(e=>({...e,resolution:resolutions[e.owner+':'+e.index]})),files},null,2));
console.log('All staged overlaps accounted for; tests required before integration.');
