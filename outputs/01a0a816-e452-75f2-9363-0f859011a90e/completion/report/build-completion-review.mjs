import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

// This builder is prepared for the later authoring/export step. The artifact
// marker is deliberately external and must be run immediately before that step.
const reportDir = fileURLToPath(new URL('.', import.meta.url));
const completionDir = resolve(reportDir, '..');
const outputRoot = resolve(completionDir, '..');
const coveragePath = resolve(completionDir, 'coverage-ledger.json');
const baselineLedgerPath = resolve(completionDir, 'baseline-ledger.json');
const uiAcceptancePath = resolve(completionDir, 'ui-acceptance.json');
const finalResultsPath = resolve(completionDir, 'final-row-results.json');
const sourceRegisterPath = resolve(outputRoot, 'source-register.json');
const sourceWorkbookFallback = resolve(outputRoot, 'Aven-Independent-Audit.xlsx');
const outputPath = resolve(reportDir, 'Aven-Completion-Review.xlsx');

const allowedVerdicts = ['Verified (scoped)', 'Partial', 'Missing', 'Defect', 'Unverified', 'Deferred'];
const expectedIds = Array.from({ length: 115 }, (_, i) => `UX-${String(i + 1).padStart(3, '0')}`);
const sourceHeaders = [
  'ID', 'Area', 'Feature', 'Aven state', 'Aven today', 'Grok Bot', 'Codex desktop', 'Claude Code',
  'Aven target / next action', 'Priority', 'Phase', 'Dependency', 'Acceptance check', 'Delivery', 'Decision', 'Evidence'
];
const auditHeaders = [
  'ID', 'Owner', 'Ownership status', 'Area', 'Feature', 'Original delivery', 'Prior independent verdict',
  'Current verdict', 'Evidence level', 'Acceptance check', 'Prior finding / gap', 'Prior evidence refs',
  'Current finding / result', 'Current evidence refs', 'Remaining gaps / next action', 'Limitation'
];
const findingsHeaders = [
  'ID', 'Feature', 'Defect title', 'Severity', 'Repro', 'Expected', 'Actual', 'Prior evidence refs',
  'Resolution', 'Verification status', 'Current evidence refs'
];
const uiHeaders = ['ID', 'Requirement', 'Acceptance', 'Owner', 'Status', 'Evidence and limitations'];

const text = value => Array.isArray(value) ? value.join('\n') : value === null || value === undefined ? '' : String(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const sha256File = async path => hash(await fs.readFile(path));

function assertCoverage(coverage) {
  if (!Array.isArray(coverage.rows) || coverage.rows.length !== 115) throw new Error(`Expected 115 coverage rows; found ${coverage.rows?.length ?? 'missing'}`);
  const ids = coverage.rows.map(row => row.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw new Error('Coverage rows must remain UX-001 through UX-115 in order');
  for (const row of coverage.rows) {
    if (!row.original || !row.audit || !row.ownership) throw new Error(`Coverage row ${row.id} is missing preserved baseline or ownership data`);
    if (row.original.ID !== row.id || row.audit.id !== row.id) throw new Error(`Coverage row ${row.id} has an inconsistent preserved ID`);
    if (!row.acceptance?.presentInRegister || row.acceptance.exact !== true) throw new Error(`Coverage row ${row.id} does not have an exact acceptance-register match`);
  }
}

function assertFinalResults(results, coverage) {
  if (!results || !Array.isArray(results.rows)) throw new Error(`Missing independently reviewed results: ${finalResultsPath}`);
  if (results.rows.length !== expectedIds.length) throw new Error(`Expected 115 independently reviewed rows; found ${results.rows.length}`);
  const coverageById = new Map(coverage.rows.map(row => [row.id, row]));
  const seen = new Set();
  for (const row of results.rows) {
    if (!expectedIds.includes(row.id) || seen.has(row.id)) throw new Error(`Final results contain an unknown or duplicate ID: ${row.id}`);
    seen.add(row.id);
    for (const key of ['id', 'verdict', 'evidenceLevel', 'finding', 'evidence', 'nextAction', 'limitation']) {
      if (!hasOwn(row, key)) throw new Error(`Final result ${row.id} is missing ${key}`);
    }
    if (!allowedVerdicts.includes(row.verdict)) throw new Error(`Unsupported final verdict on ${row.id}: ${row.verdict}`);
    if (hasOwn(row, 'priorVerdict') && row.priorVerdict !== coverageById.get(row.id).audit.verdict) throw new Error(`Prior verdict mismatch for ${row.id}`);
  }
  for (const id of expectedIds) if (!seen.has(id)) throw new Error(`Final results are missing ${id}`);
  if (results.defects !== undefined && !Array.isArray(results.defects)) throw new Error('Final results defects must be an array');
  if (results.tests !== undefined && !Array.isArray(results.tests)) throw new Error('Final results tests must be an array');
  if (results.methodology !== undefined && !Array.isArray(results.methodology)) throw new Error('Final results methodology must be an array');
  if (results.rootObservations !== undefined && !Array.isArray(results.rootObservations)) throw new Error('Final results rootObservations must be an array');
  if (results.summary !== undefined && !Array.isArray(results.summary)) throw new Error('Final results summary must be an array');
}

function assertUiAcceptance(ui) {
  if (!Array.isArray(ui.requirements) || ui.requirements.length !== 5) throw new Error('Expected five separate UI-01 through UI-05 requirements');
  const ids = ui.requirements.map(row => row.id);
  if (JSON.stringify(ids) !== JSON.stringify(['UI-01', 'UI-02', 'UI-03', 'UI-04', 'UI-05'])) throw new Error('New UI requirements must remain UI-01 through UI-05');
  for (const row of ui.requirements) for (const key of ['id', 'requirement', 'acceptance']) if (!hasOwn(row, key)) throw new Error(`New UI requirement ${row.id ?? '<unknown>'} is missing ${key}`);
}

function estimateHeight(values, widths) {
  const lines = values.map((value, i) => text(value).split(/\r?\n/).reduce((total, part) => total + Math.max(1, Math.ceil(part.length / Math.max(8, (widths[i] ?? 20) * 1.15))), 0));
  return Math.max(30, Math.min(132, Math.max(...lines) * 13 + 10));
}

function styleTable(sheet, usedRange, headerRange, bodyRange, widths, usedRows) {
  sheet.showGridLines = false;
  sheet.getRange(usedRange).format.font = { name: 'Arial', size: 10, color: '#243447' };
  sheet.getRange(usedRange).format.verticalAlignment = 'top';
  sheet.getRange(headerRange).format = { fill: '#243447', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
  sheet.getRange(headerRange).format.rowHeight = 34;
  widths.forEach((width, i) => sheet.getRangeByIndexes(0, i, usedRows, 1).format.columnWidth = width);
  if (bodyRange) {
    sheet.getRange(bodyRange).format.wrapText = true;
    sheet.getRange(bodyRange).format.borders = { insideHorizontal: { style: 'thin', color: '#D7DEE8' }, bottom: { style: 'thin', color: '#D7DEE8' } };
  }
}

function makeDefectRows(defects, coverageById) {
  return defects.flatMap(defect => {
    const ids = Array.isArray(defect.ids) ? defect.ids : [defect.id];
    return ids.filter(Boolean).map(id => [
      id,
      coverageById.get(id)?.original.Feature ?? '',
      defect.title ?? defect.name ?? '',
      defect.severity ?? '',
      defect.repro ?? '',
      defect.expected ?? '',
      defect.actual ?? '',
      defect.priorEvidence ?? defect.priorEvidenceRefs ?? '',
      defect.resolution ?? '',
      defect.status ?? defect.verificationStatus ?? '',
      defect.evidence ?? defect.evidenceRefs ?? ''
    ]);
  });
}

async function main() {
  const coverage = await readJson(coveragePath);
  const ui = await readJson(uiAcceptancePath);
  const finalResults = await readJson(finalResultsPath);
  assertCoverage(coverage);
  assertUiAcceptance(ui);
  assertFinalResults(finalResults, coverage);

  const sourceRegister = await readJson(sourceRegisterPath);
  if (!Array.isArray(sourceRegister.rows) || sourceRegister.rows.length !== 115) throw new Error('Source register must contain 115 rows');
  if (JSON.stringify(sourceRegister.headers?.slice(0, sourceHeaders.length)) !== JSON.stringify(sourceHeaders)) throw new Error('Source register headers changed');
  if (JSON.stringify(sourceRegister.rows.map(row => row.ID)) !== JSON.stringify(expectedIds)) throw new Error('Source register IDs changed');
  const sourcePath = sourceRegister.source || sourceWorkbookFallback;
  if (coverage.source?.baselineSha256 && await sha256File(baselineLedgerPath) !== coverage.source.baselineSha256) throw new Error('Baseline ledger hash changed; refusing to author completion review');
  if (!(await sha256File(sourcePath) === sourceRegister.sha256)) throw new Error('Source workbook hash changed; refusing to author completion review');

  const coverageById = new Map(coverage.rows.map(row => [row.id, row]));
  const finalById = new Map(finalResults.rows.map(row => [row.id, row]));
  const auditRows = coverage.rows.map(row => {
    const current = finalById.get(row.id);
    return [
      row.id,
      row.owner || row.ownership.primaryOwner || '',
      row.ownership.status || '',
      row.original.Area,
      row.original.Feature,
      row.original.Delivery,
      row.audit.verdict,
      current.verdict,
      current.evidenceLevel,
      row.original['Acceptance check'],
      row.audit.finding,
      row.audit.evidence,
      current.finding,
      current.evidence,
      current.nextAction,
      current.limitation
    ];
  });
  const changedIds = auditRows.filter(row => row[6] !== row[7]).map(row => row[0]);
  const currentCounts = Object.fromEntries(allowedVerdicts.map(verdict => [verdict, finalResults.rows.filter(row => row.verdict === verdict).length]));
  const defects = makeDefectRows(finalResults.defects ?? [], coverageById);
  const summaryText = text(finalResults.summary ?? []);
  const reviewedUi = new Map((finalResults.uiResults || []).map(row => [row.id, row]));
  if (reviewedUi.size !== 5 || ui.requirements.some(row => !reviewedUi.has(row.id))) throw new Error('All five UI requirements need a root-reviewed result before export');
  const uiRows = ui.requirements.map(row => {
    const reviewed = reviewedUi.get(row.id);
    if (!reviewed.status || !reviewed.evidence || !hasOwn(reviewed, 'limitation')) throw new Error(`Incomplete reviewed UI result: ${row.id}`);
    return [row.id, row.requirement, row.acceptance, 'minimal_ui', reviewed.status, `${text(reviewed.evidence)}\nLimitations: ${text(reviewed.limitation)}`];
  });

  // Authoring begins only when this builder is explicitly run after the marker.
  const workbook = Workbook.create();
  const auditSheet = workbook.worksheets.add('Completion review');
  const findingsSheet = workbook.worksheets.add('Findings');
  const uiSheet = workbook.worksheets.add('New UI');
  const originalSheet = workbook.worksheets.add('Original register');
  auditSheet.tabColor = '#243447';
  findingsSheet.tabColor = '#8A5A2B';
  originalSheet.tabColor = '#708090';
  uiSheet.tabColor = '#4B6B59';

  auditSheet.getRange('A1:P1').merge();
  auditSheet.getRange('A1').values = [['Aven completion review']];
  auditSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' }, verticalAlignment: 'center' };
  auditSheet.getRange('A1:P1').format.rowHeight = 26;
  auditSheet.getRange('A2:P2').merge();
  auditSheet.getRange('A2').values = [[`Independent review of ${expectedIds.length} frozen source features. Prior verdicts remain visible beside final independently reviewed results. New UI requirements are on a separate sheet.`]];
  auditSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
  auditSheet.getRange('A2:P2').format.rowHeight = 28;
  for (let row = 4; row <= 10; row++) auditSheet.getRange(`A${row}:B${row}`).merge();
  auditSheet.getRange('A4').values = [['Current verdict']];
  auditSheet.getRange('C4').values = [['Count']];
  auditSheet.getRange('A5:A10').values = allowedVerdicts.map(verdict => [verdict]);
  auditSheet.getRange('C5:C10').formulas = allowedVerdicts.map(verdict => [`=COUNTIFS($H$14:$H$128,"${verdict}")`]);
  auditSheet.getRange('D4:P4').merge();
  auditSheet.getRange('D4').values = [['Source and review context']];
  for (const [row, label, value] of [
    [5, 'Source path', sourcePath],
    [6, 'Source SHA-256', sourceRegister.sha256],
    [7, 'Reviewed on', finalResults.at || '2026-09-17'],
    [8, 'Verdict changes', changedIds.length ? `${changedIds.length} rows changed: ${changedIds.join(', ')}` : 'No verdict changes supplied'],
    [9, 'Summary', summaryText],
    [10, 'Coverage', `${coverage.report?.unassignedRows?.length ?? 0} unassigned rows; ${uiRows.length} separate UI requirements.`],
    [11, 'Scope', 'Verified (scoped) means the stated checks passed. Live provider, device and microphone checks are identified separately.' ]
  ]) {
    auditSheet.getRange(`D${row}`).values = [[label]];
    auditSheet.getRange(`E${row}:P${row}`).merge();
    auditSheet.getRange(`E${row}`).values = [[value]];
    auditSheet.getRange(`E${row}:P${row}`).format.wrapText = true;
    auditSheet.getRange(`D${row}:P${row}`).format.rowHeight = row === 7 || row === 9 ? 52 : 26;
  }
  auditSheet.getRange('A4:C4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'center', verticalAlignment: 'center' };
  auditSheet.getRange('D4:P4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'left', verticalAlignment: 'center' };
  auditSheet.getRange('D5:D11').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };

  const auditHeaderRow = 13;
  const auditFirstRow = 14;
  const auditLastRow = auditFirstRow + auditRows.length - 1;
  auditSheet.getRange(`A${auditHeaderRow}:P${auditLastRow}`).values = [auditHeaders, ...auditRows];
  const auditWidths = [11, 18, 20, 14, 29, 18, 22, 20, 18, 44, 40, 40, 40, 40, 40, 36];
  styleTable(auditSheet, `A1:P${auditLastRow}`, `A${auditHeaderRow}:P${auditHeaderRow}`, `A${auditFirstRow}:P${auditLastRow}`, auditWidths, auditLastRow);
  auditSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' }, verticalAlignment: 'center' };
  auditSheet.getRange('A1:P1').format.rowHeight = 26;
  auditSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
  auditSheet.getRange('A2:P2').format.rowHeight = 28;
  auditSheet.getRange('D5:P11').format.verticalAlignment = 'center';
  for (let i = 0; i < auditRows.length; i += 1) {
    const rowNumber = auditFirstRow + i;
    auditSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.rowHeight = estimateHeight(auditRows[i], auditWidths);
    if (i % 2 === 0) auditSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.fill = '#F7F9FC';
  }
  auditSheet.getRange(`A${auditFirstRow}:A${auditLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
  for (const [term, fill, color] of [['Verified (scoped)', '#E8F2EC', '#27623B'], ['Defect', '#FBE5E4', '#922D32'], ['Missing', '#FFF1DC', '#805322'], ['Unverified', '#E9EDF3', '#46566D'], ['Deferred', '#F0E9F7', '#6A4685']]) {
    auditSheet.getRange(`H${auditFirstRow}:H${auditLastRow}`).conditionalFormats.add('containsText', { text: term, format: { fill, font: { color, bold: true } } });
  }
  const auditTable = auditSheet.tables.add(`A${auditHeaderRow}:P${auditLastRow}`, true, 'AvenCompletionReview');
  auditTable.showFilterButton = true;
  auditTable.style = 'TableStyleLight1';
  auditSheet.freezePanes.freezeRows(auditHeaderRow);
  auditSheet.freezePanes.freezeColumns(5);

  findingsSheet.getRange('A1:K1').merge();
  findingsSheet.getRange('A1').values = [['Aven completion findings']];
  findingsSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
  findingsSheet.getRange('A1:K1').format.rowHeight = 26;
  findingsSheet.getRange('A3:A8').values = [['Source path'], ['Source SHA-256'], ['Summary'], ['Defect rows'], ['Scope'], ['Limitations']];
  findingsSheet.getRange('B3:K3').merge(); findingsSheet.getRange('B3').values = [[sourcePath]];
  findingsSheet.getRange('B4:K4').merge(); findingsSheet.getRange('B4').values = [[sourceRegister.sha256]];
  findingsSheet.getRange('B5:K5').merge(); findingsSheet.getRange('B5').values = [[summaryText]];
  findingsSheet.getRange('B6:K6').merge(); findingsSheet.getRange('B6').values = [[`${defects.length} affected feature rows from ${finalResults.defects?.length ?? 0} supplied defect groups`]];
  findingsSheet.getRange('B7:K7').merge(); findingsSheet.getRange('B7').values = [['Findings are sourced from the independently reviewed results file.']];
  findingsSheet.getRange('B8:K8').merge(); findingsSheet.getRange('B8').values = [['Per-row limitations appear in the Completion review sheet.']];
  findingsSheet.getRange('A3:A8').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
  findingsSheet.getRange('B3:K8').format = { font: { name: 'Arial', size: 10, color: '#243447' }, wrapText: true, verticalAlignment: 'center' };
  findingsSheet.getRange('A5:K5').format.rowHeight = 52;
  const findingsHeaderRow = 10;
  const findingsFirstRow = 11;
  const findingsLastRow = findingsFirstRow + Math.max(defects.length, 1) - 1;
  const defectValues = defects.length ? [findingsHeaders, ...defects] : [findingsHeaders, ['—', 'No defects supplied', '—', '—', '—', '—', '—', '—', '—', '—', '—']];
  findingsSheet.getRange(`A${findingsHeaderRow}:K${findingsLastRow}`).values = defectValues;
  const findingsWidths = [11, 30, 30, 12, 52, 42, 52, 40, 42, 22, 44];
  styleTable(findingsSheet, `A1:K${findingsLastRow}`, `A${findingsHeaderRow}:K${findingsHeaderRow}`, `A${findingsFirstRow}:K${findingsLastRow}`, findingsWidths, findingsLastRow);
  for (let i = 0; i < Math.max(defects.length, 1); i += 1) findingsSheet.getRange(`A${findingsFirstRow + i}:K${findingsFirstRow + i}`).format.rowHeight = estimateHeight(defectValues[i + 1], findingsWidths);
  if (defects.length) {
    const findingsTable = findingsSheet.tables.add(`A${findingsHeaderRow}:K${findingsLastRow}`, true, 'AvenCompletionFindings');
    findingsTable.showFilterButton = true;
    findingsTable.style = 'TableStyleLight1';
  }
  findingsSheet.freezePanes.freezeRows(findingsHeaderRow);
  findingsSheet.freezePanes.freezeColumns(2);

  const originalRows = sourceRegister.rows.map(row => sourceHeaders.map(header => row[header] ?? null));
  originalSheet.getRange('A1:P1').merge();
  originalSheet.getRange('A1').values = [['Original Aven register snapshot']];
  originalSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
  originalSheet.getRange('A1:P1').format.rowHeight = 26;
  originalSheet.getRange('A2:P2').merge();
  originalSheet.getRange('A2').values = [[`Preserved source claims from ${sourcePath}. SHA-256: ${sourceRegister.sha256}`]];
  originalSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
  const originalHeaderRow = 5;
  const originalFirstRow = 6;
  const originalLastRow = originalFirstRow + originalRows.length - 1;
  originalSheet.getRange(`A${originalHeaderRow}:P${originalLastRow}`).values = [sourceHeaders, ...originalRows];
  const originalWidths = [11, 14, 30, 16, 46, 34, 34, 34, 42, 11, 17, 32, 42, 18, 16, 44];
  styleTable(originalSheet, `A1:P${originalLastRow}`, `A${originalHeaderRow}:P${originalHeaderRow}`, `A${originalFirstRow}:P${originalLastRow}`, originalWidths, originalLastRow);
  originalSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
  originalSheet.getRange('A1:P1').format.rowHeight = 26;
  originalSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
  for (let i = 0; i < originalRows.length; i += 1) {
    const rowNumber = originalFirstRow + i;
    originalSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.rowHeight = estimateHeight(originalRows[i], originalWidths);
    if (i % 2 === 0) originalSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.fill = '#F7F9FC';
  }
  originalSheet.getRange(`A${originalFirstRow}:A${originalLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
  const originalTable = originalSheet.tables.add(`A${originalHeaderRow}:P${originalLastRow}`, true, 'OriginalAvenCompletionRegister');
  originalTable.showFilterButton = true;
  originalTable.style = 'TableStyleLight1';
  originalSheet.freezePanes.freezeRows(originalHeaderRow);
  originalSheet.freezePanes.freezeColumns(3);

  uiSheet.getRange('A1:F1').merge();
  uiSheet.getRange('A1').values = [['Chat interface review']];
  uiSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
  uiSheet.getRange('A1:F1').format.rowHeight = 26;
  uiSheet.getRange('A2:F2').merge();
  uiSheet.getRange('A2').values = [['UI-01 through UI-05 are separate requirements and are not added to the frozen UX-001 through UX-115 register.']];
  uiSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
  const uiHeaderRow = 4;
  const uiFirstRow = 5;
  const uiLastRow = uiFirstRow + uiRows.length - 1;
  uiSheet.getRange(`A${uiHeaderRow}:F${uiLastRow}`).values = [uiHeaders, ...uiRows];
  const uiWidths = [11, 42, 80, 18, 28, 24];
  styleTable(uiSheet, `A1:F${uiLastRow}`, `A${uiHeaderRow}:F${uiHeaderRow}`, `A${uiFirstRow}:F${uiLastRow}`, uiWidths, uiLastRow);
  uiSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
  uiSheet.getRange('A1:F1').format.rowHeight = 26;
  uiSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
  for (let i = 0; i < uiRows.length; i += 1) uiSheet.getRange(`A${uiFirstRow + i}:F${uiFirstRow + i}`).format.rowHeight = estimateHeight(uiRows[i], uiWidths);
  uiSheet.getRange(`A${uiFirstRow}:A${uiLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
  const uiTable = uiSheet.tables.add(`A${uiHeaderRow}:F${uiLastRow}`, true, 'AvenNewUiAcceptance');
  uiTable.showFilterButton = true;
  uiTable.style = 'TableStyleLight1';
  uiSheet.freezePanes.freezeRows(uiHeaderRow);

  workbook.recalculate();
  console.log((await workbook.inspect({ kind: 'region', sheetId: 'Completion review', range: 'A4:C10', maxChars: 5000, tableMaxRows: 10, tableMaxCols: 3 })).ndjson);
  console.log((await workbook.inspect({ kind: 'table', sheetId: 'Completion review', range: 'A13:P17', include: 'values,formulas', tableMaxRows: 5, tableMaxCols: 16, maxChars: 10000 })).ndjson);
  console.log((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 100 }, summary: 'completion review formula error scan', maxChars: 3000 })).ndjson);

  await fs.mkdir(reportDir, { recursive: true });
  for (const [sheetName, range, name] of [
    ['Completion review', 'A4:H16', 'completion-overview'],
    ['Completion review', 'I13:P16', 'completion-evidence'],
    ['Findings', 'A10:F13', 'findings'],
    ['Original register', 'A5:H8', 'original-register'],
    ['New UI', 'A1:F9', 'chat-interface']
  ]) {
    const preview = await workbook.render({ sheetName, range, scale: 1, format: 'png' });
    await fs.writeFile(resolve(reportDir, `${name}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(`Exported ${auditRows.length} original rows, ${uiRows.length} separate UI rows, and ${defects.length} finding rows to ${outputPath}`);
}

await main();
