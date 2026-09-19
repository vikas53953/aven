#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here);
const baselinePath = path.join(root, 'baseline-ledger.json');
const acceptancePath = path.join(root, 'acceptance.txt');
const uiAcceptancePath = path.join(root, 'ui-acceptance.json');
const ledgerPath = path.join(root, 'coverage-ledger.json');
const reportPath = path.join(root, 'coverage-report.json');

const id = n => `UX-${String(n).padStart(3, '0')}`;
const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => id(start + i));
const unique = values => [...new Set(values)];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const baselineBytes = fs.readFileSync(baselinePath);
const baseline = JSON.parse(baselineBytes.toString('utf8'));
const acceptanceLines = fs.readFileSync(acceptancePath, 'utf8').split(/\r?\n/).filter(Boolean);
const uiAcceptance = JSON.parse(fs.readFileSync(uiAcceptancePath, 'utf8'));

// These are the bounded assignments supplied by the parent. Scope labels retain
// the distinction where one UX row has more than one independently assigned slice.
const assigned = {
  reliability: range(19, 20).concat([id(25)], range(28, 32), range(36, 37), range(39, 40), [id(98), id(99), id(101), id(107), id(113), id(115)]),
  provider: [id(27), id(38), id(60), id(61), id(100), id(102), id(108), id(109)],
  minimal_ui: [id(34), id(49), ...range(91, 97), id(103), id(105)],
  workflows: [id(33), id(34), ...range(72, 74), id(80), id(114)],
  git: [id(75)],
  workspace: [id(21), id(22), id(23), id(26), id(56), ...range(66, 71), id(76), id(78), id(81), id(82), id(110)],
  complete_automation: range(85, 89),
  complete_history: [id(83), id(84), id(111), id(112)],
  history: [...range(1, 18), id(24), id(35), ...range(41, 55), ...range(57, 59), ...range(62, 65)],
  root: [id(53), id(63), id(77), id(79), id(90), id(104), id(106)]
};

const scopes = new Map();
const addScope = (featureId, owner, scope = 'assigned') => {
  if (!scopes.has(featureId)) scopes.set(featureId, []);
  scopes.get(featureId).push({ owner, scope });
};
for (const [owner, ids] of Object.entries(assigned)) for (const featureId of ids) addScope(featureId, owner);

// The parent assignment calls out these cross-cutting slices explicitly.
addScope(id(34), 'minimal_ui', 'presentation');
addScope(id(34), 'workflows', 'backend');
addScope(id(69), 'workspace', 'focus');
addScope(id(73), 'history', 'history');
addScope(id(87), 'history', 'alerts');
addScope(id(49), 'minimal_ui', 'reaction picker search and keyboard repair');
addScope(id(52), 'root', 'new preference and workflow backup compatibility');
addScope(id(71), 'minimal_ui', 'interactive allowlisted diagnostic terminal implementation');
addScope(id(79), 'history', 'command completion versus health boundary repair');
addScope(id(106), 'history', 'failed transport cannot become authoritative healthy verdict');

const originalIds = baseline.rows.map(row => row.id);
const expectedIds = range(1, 115);
const duplicateIds = originalIds.filter((featureId, index) => originalIds.indexOf(featureId) !== index);
const missingBaselineIds = expectedIds.filter(featureId => !originalIds.includes(featureId));
const extraBaselineIds = originalIds.filter(featureId => !expectedIds.includes(featureId));

const acceptanceById = new Map();
const acceptanceParseErrors = [];
for (const line of acceptanceLines) {
  const match = line.match(/^(UX-\d+) \| ([^|]+) \| (.*)$/);
  if (!match) {
    acceptanceParseErrors.push(line);
    continue;
  }
  const [, featureId, feature, check] = match;
  if (acceptanceById.has(featureId)) acceptanceParseErrors.push(`duplicate:${featureId}`);
  acceptanceById.set(featureId, { featureId, feature, check, line });
}

const acceptanceMismatches = [];
for (const row of baseline.rows) {
  const acceptance = acceptanceById.get(row.id);
  if (!acceptance) continue;
  if (acceptance.feature !== row.original.Feature || acceptance.check !== row.original['Acceptance check']) {
    acceptanceMismatches.push({
      id: row.id,
      baselineFeature: row.original.Feature,
      registerFeature: acceptance.feature,
      baselineCheck: row.original['Acceptance check'],
      registerCheck: acceptance.check
    });
  }
}
const droppedAcceptances = expectedIds.filter(featureId => !acceptanceById.has(featureId));
const extraAcceptances = [...acceptanceById.keys()].filter(featureId => !expectedIds.includes(featureId));

const assignmentScopes = featureId => scopes.get(featureId) || [];
const assignmentOwners = featureId => unique(assignmentScopes(featureId).map(entry => entry.owner));
const unassigned = expectedIds.filter(featureId => !assignmentOwners(featureId).length);
const rootOwned = new Set(assigned.root);

const rows = baseline.rows.map(row => {
  const rowScopes = assignmentScopes(row.id);
  const owners = unique(rowScopes.map(entry => entry.owner));
  const acceptance = acceptanceById.get(row.id);
  let status = owners.length === 0 ? 'unassigned' : owners.length > 1 ? 'overlap' : 'assigned';
  if (rootOwned.has(row.id)) status = owners.length > 1 ? 'root-owned-overlap' : 'root-owned';
  return {
    ...row,
    owner: rootOwned.has(row.id) ? 'root' : owners[0] || null,
    ownership: {
      primaryOwner: rootOwned.has(row.id) ? 'root' : owners[0] || null,
      owners,
      scopes: rowScopes,
      status,
      specificity: rowScopes.filter(entry => entry.scope !== 'assigned').map(entry => `${entry.owner}:${entry.scope}`)
    },
    acceptance: {
      presentInRegister: Boolean(acceptance),
      exact: Boolean(acceptance && acceptance.feature === row.original.Feature && acceptance.check === row.original['Acceptance check']),
      registerLine: acceptance?.line || null
    }
  };
});

const newUi = uiAcceptance.requirements.map(requirement => ({
  ...requirement,
  owner: 'minimal_ui',
  scope: 'new UI; outside original 115'
}));

const conflicts = [
  {
    type: 'reassigned-fix',
    ids: [id(76)],
    previousOwner: 'provider',
    owner: 'workspace',
    resolution: 'Exact device selection is implemented with stable mentions and inventory UI; provider executor retains model/provider selection.'
  },
  {
    type: 'reassigned-fix',
    ids: [id(49)],
    previousOwner: 'history',
    owner: 'minimal_ui',
    resolution: 'Independent navigation tests found missing reaction search and keyboard focus. Minimal UI executor owns the fix; history evidence remains a secondary audit.'
  },
  {
    type: 'intentional-scope-split',
    ids: [id(34)],
    owners: ['minimal_ui', 'workflows'],
    detail: 'Plan and inspect modes have separate presentation and backend slices.'
  },
  {
    type: 'explicit-root-override',
    ids: [id(53), id(63)],
    candidates: ['history', 'root'],
    resolution: 'Root ownership is explicit for these deferred/unassigned rows; history range membership is retained as a conflict record only.'
  },
  {
    type: 'reassigned',
    ids: range(85, 89),
    previousOwner: 'workspace',
    owner: 'complete_automation',
    resolution: 'The parent update moves UX-085..089 to complete_automation; workspace retains its other rows.'
  },
  {
    type: 'cross-cutting-slice',
    ids: [id(69), id(73), id(87)],
    detail: 'UX-069 carries the workspace focus slice; UX-073 carries a history slice alongside workflows; UX-087 carries an alerts slice alongside complete_automation.'
  },
  {
    type: 'explicit-assignment-update',
    ids: [id(83), id(84), id(111), id(112)],
    previousOwner: null,
    owner: 'complete_history',
    resolution: 'The parent packet explicitly assigns these four rows to complete_history.'
  }
];

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    baseline: 'baseline-ledger.json',
    acceptance: 'acceptance.txt',
    baselineSha256: hash(baselineBytes)
  },
  baselineIntegrity: {
    expectedRows: 115,
    actualRows: baseline.rows.length,
    uniqueRows: unique(originalIds).length,
    missingIds: missingBaselineIds,
    extraIds: extraBaselineIds,
    duplicateIds,
    originalAndAuditPreserved: true
  },
  acceptanceCoverage: {
    expectedRows: 115,
    registerLines: acceptanceLines.length,
    parsedIds: acceptanceById.size,
    exactMatches: expectedIds.filter(featureId => {
      const row = baseline.rows.find(candidate => candidate.id === featureId);
      const acceptance = acceptanceById.get(featureId);
      return Boolean(row && acceptance && acceptance.feature === row.original.Feature && acceptance.check === row.original['Acceptance check']);
    }).length,
    droppedAcceptances,
    extraAcceptances,
    mismatches: acceptanceMismatches,
    parseErrors: acceptanceParseErrors
  },
  assignmentCoverage: {
    originalRows: expectedIds.length,
    assignedRows: expectedIds.length - unassigned.length,
    unassignedRows: unassigned,
    rootOwnedRows: [...rootOwned].sort(),
    historyExclusions: [id(56), id(60), id(61), id(83), id(84), id(111), id(112)],
    explicitExclusions: [id(56), id(60), id(61)],
    newUiRows: newUi.map(entry => entry.id)
  },
  conflicts,
  conclusion: {
    status: unassigned.length ? 'needs-owner-direction' : 'complete',
    droppedAcceptances: droppedAcceptances.length ? droppedAcceptances : 'none',
    note: unassigned.length
      ? 'Unassigned rows retain their acceptance requirements and baseline audit data; no verdicts were changed.'
      : 'All original rows have an explicit owner mapping; no verdicts were changed.'
  }
};

const ledger = {
  generatedAt: report.generatedAt,
  rule: 'Coverage bookkeeping only. Preserve baseline original and audit objects unchanged; new UX remains separate from original 115.',
  source: report.source,
  assignments: assigned,
  newUiAssignments: newUi,
  report: {
    unassignedRows: unassigned,
    conflicts: conflicts.map(conflict => ({ type: conflict.type, ids: conflict.ids }))
  },
  rows
};

fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  coverageLedger: ledgerPath,
  coverageReport: reportPath,
  rows: rows.length,
  unassigned,
  droppedAcceptances,
  baselineSha256: report.source.baselineSha256
}, null, 2));
