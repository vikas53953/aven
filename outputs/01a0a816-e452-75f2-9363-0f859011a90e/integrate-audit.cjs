const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, ''));
const source = read('source-register.json');
const roots = read('root-findings.json');
const folders = ['audit_001_040', 'audit_041_079', 'audit_080_115'];
const rows = [], tests = [], defects = [];
for (const folder of folders) {
  const report = read(`${folder}/report.json`);
  const names = fs.readdirSync(path.join(dir, folder)).filter(n => /\.(json|cjs|png)$/.test(n));
  const qualify = value => names.reduce((v, n) => v.replace(new RegExp(`(?<![\\w/\\\\-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `${folder}/${n}`), String(value || ''));
  rows.push(...report.rows.map(row => ({ ...row, evidence: qualify(row.evidence), limitation: row.limitation || 'See evidence scope; full acceptance was not established.' })));
  tests.push(...report.tests.map(test => ({ ...test, command: qualify(test.command) })));
  defects.push(...report.defects.map(defect => ({ ...defect, evidence: qualify(defect.evidence), severity: defect.severity === 'medium' ? 'P2' : defect.severity })));
}
const map = new Map(rows.map(row => [row.id, row]));
for (const row of roots.overrides) map.set(row.id, row);
tests.push(...roots.tests, {command:'Read-only local GET /api/chat/runs and /api/chat/runs/:id',exitCode:0,result:'Four stored runs listed; one matching record read with 13 events and original reply provenance. No new provider/device execution. Evidence: root-run-readback.json.'});
defects.push(...roots.defects);
for (const defect of defects) {
  if (defect.ids.includes('UX-102')) defect.actual = 'About shows OpenCode / MiMo V2.5 (configured) while the refreshed diagnostics JSON shows configured:false, provider Not connected and model Unavailable.';
  if (defect.ids.includes('UX-011')) defect.actual = 'The active direct-chat header temporarily changes to the conversation title; the persisted coworker name remains unchanged and normal chat navigation renders the coworker identity again.';
}
for (const test of tests) {
  if (test.command === 'node isolated Playwright browser audit') {
    test.command = 'node audit_080_115/audit-080-115.cjs :: browser phase';
    if (test.exitCode !== 0) test.result = 'INCOMPLETE: browser chain timed out at a hidden composer after recorded earlier checks and the isolated About contradiction. Later planned checks are not counted as passes. See audit_080_115/report.json and browser-audit.json.';
  }
  if (test.command === 'node static source audit') test.command = 'node audit_080_115/audit-080-115.cjs :: static phase';
  if (test.command === 'node module fixture audit') test.command = 'node audit_080_115/audit-080-115.cjs :: module phase';
}
if (map.size !== 115 || rows.length !== 115) throw new Error(`Invalid reconciliation: ${map.size} unique / ${rows.length} reviewed rows`);
for (const original of source.rows) if (!map.has(original.ID)) throw new Error(`Missing ${original.ID}`);
const overridesPath = path.join(dir, 'root-review-overrides.json');
if (fs.existsSync(overridesPath)) for (const row of read('root-review-overrides.json')) map.set(row.id, {...map.get(row.id), ...row});
const integrated = {
  rows: source.rows.map(original => map.get(original.ID)),
  tests,
  defects,
  methodology: [
    'All 115 register rows reviewed against current source and available evidence; targeted isolated Chromium/module tests plus direct control of the running app. This was not 115 complete manual end-to-end acceptance tests.',
    'Verified (scoped): named tested behavior passed. Partial: useful implementation exists but capability or acceptance coverage is incomplete. Missing: no matching implemented workflow. Defect: reproduced incorrect behavior. Unverified: insufficient current evidence. Deferred: original register scope decision.',
    'Fixtures used new browser contexts and intercepted external requests. No provider/device execution, credential retrieval, real OS folder permission grant or disk editing. Read-only existing local run records were retrieved separately.',
    'Original workbook and 17 baseline app/runtime files remained unchanged. Served entrypoint and selected modules matched disk hashes. Evidence is a dated snapshot of ux-pipeline-v7, not a production certification.',
    'Initial harness/selector errors were retained in evidence and distinguished from product defects. Incomplete checks are not passes. Owner visual acceptance, real provider/device paths and real filesystem workflows remain separate.'
  ],
  rootObservations: [
    'Live UI: coworker identity, local welcome, disabled empty Send, profile/docs, privacy, local diagnostics, Browser/Computer unavailable states, artifact scope and saved Feed message navigation inspected.',
    'Live diagnostics: OpenCode Go / mimo-v2.5, locally configured, reachability explicitly unverified. Existing run readback returned matching run/chat IDs and 13 events.',
    'CUA later timed out opening/reacquiring the large Artifacts view. Cause was not isolated; this was recorded as an automation limitation, not a confirmed app defect.'
  ],
  summary: []
};
const counts = {};
for (const row of integrated.rows) counts[row.verdict] = (counts[row.verdict] || 0) + 1;
const claimed = source.rows.filter(row => row.Delivery === 'Verified');
const originalVerifiedNow = {};
for (const row of claimed) { const verdict = map.get(row.ID).verdict; originalVerifiedNow[verdict] = (originalVerifiedNow[verdict] || 0) + 1; }
integrated.summary = [
  'Original register: 80 Verified, 10 Implemented, 21 Not started, 4 Deferred. The previous task explicitly acknowledged 31 local items still needed work.',
  `Independent snapshot: ${Object.entries(counts).map(([k,v]) => `${v} ${k}`).join('; ')}.`,
  `Original 80 Verified reassessed: ${Object.entries(originalVerifiedNow).map(([k,v]) => `${v} ${k}`).join('; ')}.`,
  `${defects.length} distinct reproduced defects affect ${new Set(defects.flatMap(d => d.ids)).size} feature rows. No fixes applied during this audit.`
];
fs.writeFileSync(path.join(dir, 'integrated-audit.json'), JSON.stringify(integrated, null, 2));
fs.writeFileSync(path.join(dir, 'audit-counts.json'), JSON.stringify({total:115,counts,originalVerifiedNow,defectCount:defects.length,defectFeatureCount:new Set(defects.flatMap(d=>d.ids)).size},null,2));
console.log(JSON.stringify({counts, originalVerifiedNow, defects: defects.map(d => ({ids:d.ids,title:d.title}))},null,2));
