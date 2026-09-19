import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = fileURLToPath(new URL('.', import.meta.url));
const baselineDir = resolve(outputDir, '..', '..');
const sourceRegisterPath = resolve(baselineDir, 'source-register.json');
const baselineIntegratedPath = resolve(baselineDir, 'integrated-audit.json');
const baselineWorkbookPath = resolve(baselineDir, 'Aven-Independent-Audit.xlsx');
const postFixPath = resolve(outputDir, '..', 'post-fix-data.json');
const outputPath = resolve(outputDir, 'Aven-Post-Fix-Review.xlsx');

const expectedBaselineWorkbookSha256 = '3fc2940d99c2e99b3d8631c62b9ced8cd89cab0b3a56ca90e7c5925991686d99';
const expectedBaselineIntegratedSha256 = '13a988f541761d0174512091c5ead042c8b8f88c31e30426039fbb83f0210394';
const allowedVerdicts = ['Verified (scoped)', 'Partial', 'Missing', 'Defect', 'Unverified', 'Deferred'];
const sourceHeaders = [
  'ID', 'Area', 'Feature', 'Aven state', 'Aven today', 'Grok Bot', 'Codex desktop', 'Claude Code',
  'Aven target / next action', 'Priority', 'Phase', 'Dependency', 'Acceptance check', 'Delivery', 'Decision', 'Evidence',
];
const auditHeaders = ['ID', 'Area', 'Feature', 'Original Delivery', 'Prior independent verdict', 'Current verdict', 'Evidence level', 'Prior finding / gap', 'Prior evidence refs', 'Fix scope / result', 'Current evidence refs', 'Remaining gaps / next action', 'Limitation'];
const findingsHeaders = ['ID', 'Feature', 'Defect title', 'Severity', 'Repro', 'Expected', 'Actual', 'Prior evidence refs', 'Resolution', 'Verification status', 'Current evidence refs'];

const text = (value) => {
  if (Array.isArray(value)) return value.join('\n');
  if (value === null || value === undefined) return '';
  return String(value);
};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const expectedIds = (count) => Array.from({ length: count }, (_, i) => `UX-${String(i + 1).padStart(3, '0')}`);
const sha256File = async (path) => crypto.createHash('sha256').update(await fs.readFile(path)).digest('hex');

function assertSource(register) {
  if (!Array.isArray(register.rows) || register.rows.length !== 115) throw new Error(`Expected 115 source rows; found ${register.rows?.length ?? 'missing'}`);
  if (!Array.isArray(register.headers) || JSON.stringify(register.headers.slice(0, sourceHeaders.length)) !== JSON.stringify(sourceHeaders)) throw new Error('Source headers do not match the expected 16-column register');
  const ids = register.rows.map((row) => row.ID);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds(115))) throw new Error('Source IDs are not the stable UX-001 through UX-115 sequence');
  if (!register.source || !register.sha256) throw new Error('Source path and hash are required in source-register.json');
  return ids;
}

function assertPostFix(postFix, baseline, sourceIds) {
  if (!Array.isArray(postFix.rows) || postFix.rows.length !== sourceIds.length) throw new Error(`Expected ${sourceIds.length} post-fix rows; found ${postFix.rows?.length ?? 'missing'}`);
  const fields = ['id', 'priorVerdict', 'priorFinding', 'priorEvidence', 'verdict', 'evidenceLevel', 'finding', 'evidence', 'fixResolution', 'nextAction', 'limitation'];
  const baselineRows = new Map(baseline.rows.map((row) => [row.id, row]));
  const seen = new Set();
  const changed = [];
  for (const row of postFix.rows) {
    for (const key of fields) if (!hasOwn(row, key)) throw new Error(`Post-fix row ${row.id ?? '<unknown>'} is missing ${key}`);
    if (!sourceIds.includes(row.id)) throw new Error(`Post-fix row has unknown ID: ${row.id}`);
    if (seen.has(row.id)) throw new Error(`Post-fix rows contain duplicate ID: ${row.id}`);
    seen.add(row.id);
    if (!allowedVerdicts.includes(row.priorVerdict) || !allowedVerdicts.includes(row.verdict)) throw new Error(`Unsupported verdict on ${row.id}`);
    const baselineRow = baselineRows.get(row.id);
    if (!baselineRow || row.priorVerdict !== baselineRow.verdict) throw new Error(`Prior verdict mismatch for ${row.id}`);
    if (row.verdict !== row.priorVerdict) changed.push(row.id);
  }
  for (const id of sourceIds) if (!seen.has(id)) throw new Error(`Post-fix rows are missing source ID: ${id}`);
  if (JSON.stringify(postFix.rows.map((row) => row.id)) !== JSON.stringify(sourceIds)) throw new Error('Post-fix rows must remain in stable UX-001 through UX-115 order');
  if (!Array.isArray(baseline.defects) || !Array.isArray(postFix.defects)) throw new Error('Both baseline and post-fix defects arrays are required');
  const baselineDefectIds = new Set(baseline.defects.flatMap((defect) => defect.ids));
  if (changed.some((id) => !baselineDefectIds.has(id))) throw new Error(`Only prior defect rows may change verdict; changed ${changed.join(', ')}`);
  if (postFix.defects.length !== baseline.defects.length) throw new Error(`Expected ${baseline.defects.length} retained defect groups; found ${postFix.defects.length}`);
  const retainedDefectIds = new Set();
  for (const defect of postFix.defects) {
    if (!Array.isArray(defect.ids) || defect.ids.length === 0) throw new Error('Each post-fix defect must contain one or more ids');
    for (const key of ['severity', 'title', 'repro', 'expected', 'actual', 'priorEvidence', 'resolution', 'status', 'evidence']) if (!hasOwn(defect, key)) throw new Error(`Post-fix defect group is missing ${key}`);
    const groupIds = new Set();
    for (const id of defect.ids) {
      if (!baselineDefectIds.has(id)) throw new Error(`Post-fix defect has ID outside baseline defect scope: ${id}`);
      if (groupIds.has(id)) throw new Error(`Post-fix defect group repeats ID: ${id}`);
      groupIds.add(id);
      retainedDefectIds.add(id);
    }
  }
  if (retainedDefectIds.size !== baselineDefectIds.size || [...baselineDefectIds].some((id) => !retainedDefectIds.has(id))) throw new Error('Post-fix defects must retain all five baseline defect IDs');
  if (postFix.tests !== undefined && !Array.isArray(postFix.tests)) throw new Error('Post-fix tests must be an array');
  if (postFix.methodology !== undefined && !Array.isArray(postFix.methodology)) throw new Error('Post-fix methodology must be an array');
  if (postFix.rootObservations !== undefined && !Array.isArray(postFix.rootObservations)) throw new Error('Post-fix rootObservations must be an array');
  if (postFix.summary !== undefined && !Array.isArray(postFix.summary)) throw new Error('Post-fix summary must be an array');
}

function estimateHeight(values, widths) {
  const lines = values.map((value, i) => text(value).split(/\r?\n/).reduce((total, part) => total + Math.max(1, Math.ceil(part.length / Math.max(8, (widths[i] ?? 20) * 1.15))), 0));
  return Math.max(42, Math.min(132, Math.max(...lines) * 13 + 10));
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

const register = JSON.parse(await fs.readFile(sourceRegisterPath, 'utf8'));
const sourceIds = assertSource(register);
const sourceWorkbookHash = await sha256File(register.source);
if (sourceWorkbookHash !== register.sha256) throw new Error(`Source workbook hash changed: register=${register.sha256}, current=${sourceWorkbookHash}`);
if (await sha256File(baselineWorkbookPath) !== expectedBaselineWorkbookSha256) throw new Error('Audit baseline workbook changed; refusing to author post-fix review');
if (await sha256File(baselineIntegratedPath) !== expectedBaselineIntegratedSha256) throw new Error('Audit baseline integrated-audit.json changed; refusing to author post-fix review');
const baseline = JSON.parse(await fs.readFile(baselineIntegratedPath, 'utf8'));
const postFix = JSON.parse(await fs.readFile(postFixPath, 'utf8'));
assertPostFix(postFix, baseline, sourceIds);

const sourceRows = new Map(register.rows.map((row) => [row.ID, row]));
const auditRows = postFix.rows.map((row) => {
  const source = sourceRows.get(row.id);
  return [row.id, source.Area, source.Feature, source.Delivery, row.priorVerdict, row.verdict, row.evidenceLevel, row.priorFinding, row.priorEvidence, `Current finding: ${text(row.finding)}\nFix scope / result: ${text(row.fixResolution)}`, row.evidence, row.nextAction, row.limitation];
});
const defectOrder = ['UX-058', 'UX-098', 'UX-102', 'UX-066', 'UX-011'];
const orderedDefects = [...postFix.defects].sort((a, b) => {
  const firstA = Math.min(...a.ids.map((id) => defectOrder.indexOf(id) < 0 ? 999 : defectOrder.indexOf(id)));
  const firstB = Math.min(...b.ids.map((id) => defectOrder.indexOf(id) < 0 ? 999 : defectOrder.indexOf(id)));
  return firstA - firstB;
});
const defects = orderedDefects.flatMap((defect) => defect.ids.slice().sort((a, b) => defectOrder.indexOf(a) - defectOrder.indexOf(b)).map((id) => [id, sourceRows.get(id).Feature, defect.title, defect.severity, defect.repro, defect.expected, defect.actual, defect.priorEvidence, defect.resolution, defect.status, defect.evidence]));
const summaryText = text(postFix.summary ?? []);
const limitationText = [...new Set(postFix.rows.map((row) => text(row.limitation)).filter(Boolean))].join('\n');
const changedIds = postFix.rows.filter((row) => row.verdict !== row.priorVerdict).map((row) => row.id);

const workbook = Workbook.create();
const auditSheet = workbook.worksheets.add('Audit');
const findingsSheet = workbook.worksheets.add('Findings');
const originalSheet = workbook.worksheets.add('Original register');
auditSheet.tabColor = '#243447';
findingsSheet.tabColor = '#8A5A2B';
originalSheet.tabColor = '#708090';

auditSheet.getRange('A1:M1').merge();
auditSheet.getRange('A1').values = [['Aven post-fix review']];
auditSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' }, verticalAlignment: 'center' };
auditSheet.getRange('A1:M1').format.rowHeight = 26;
auditSheet.getRange('A2:M2').merge();
auditSheet.getRange('A2').values = [[`Independent review of ${sourceIds.length} source features on 16 September 2026, build ux-audit-fixes-v8. Prior verdicts remain visible. Only five prior defect rows may change. Partial can reflect incomplete acceptance coverage even where a local implementation exists.`]];
auditSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
auditSheet.getRange('A2:M2').format.rowHeight = 28;
auditSheet.getRange('A4:B4').values = [['Current verdict', 'Count']];
auditSheet.getRange('A5:A10').values = allowedVerdicts.map((verdict) => [verdict]);
auditSheet.getRange('B5:B10').formulas = allowedVerdicts.map((verdict) => [`=COUNTIFS($F$13:$F$127,"${verdict}")`]);
auditSheet.getRange('D4:M4').merge();
auditSheet.getRange('D4').values = [['Source and review context']];
for (const [row, label, value] of [
  [5, 'Source path', register.source],
  [6, 'Source SHA-256', register.sha256],
  [7, 'Summary', summaryText],
  [8, 'Verdict changes', changedIds.length ? `${changedIds.length} rows changed: ${changedIds.join(', ')}` : 'No verdict changes supplied'],
  [9, 'Defects', `${defects.length} affected feature rows; ${postFix.defects.length} distinct defects retained in Findings`],
  [10, 'Scope', 'Post-fix review evidence is scoped to the supplied tests and observations.'],
  [11, 'Limits', 'Per-feature limitations appear in the Audit table.'],
]) {
  auditSheet.getRange(`D${row}`).values = [[label]];
  auditSheet.getRange(`E${row}:M${row}`).merge();
  auditSheet.getRange(`E${row}`).values = [[value]];
  auditSheet.getRange(`E${row}:M${row}`).format.wrapText = true;
  auditSheet.getRange(`E${row}:M${row}`).format.verticalAlignment = 'center';
  auditSheet.getRange(`D${row}:M${row}`).format.rowHeight = row === 7 ? 60 : 26;
}
auditSheet.getRange('A4:B4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'center', verticalAlignment: 'center' };
auditSheet.getRange('A5:A10').format.wrapText = true;
auditSheet.getRange('A5:A10').format.rowHeight = 28;
auditSheet.getRange('D4:M4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'left', verticalAlignment: 'center' };
auditSheet.getRange('D5:D11').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };

const auditHeaderRow = 12;
const auditFirstRow = 13;
const auditLastRow = auditFirstRow + auditRows.length - 1;
auditSheet.getRange(`A${auditHeaderRow}:M${auditLastRow}`).values = [auditHeaders, ...auditRows];
const auditWidths = [11, 14, 29, 18, 21, 21, 18, 40, 40, 40, 40, 40, 36];
styleTable(auditSheet, `A1:M${auditLastRow}`, `A${auditHeaderRow}:M${auditHeaderRow}`, `A${auditFirstRow}:M${auditLastRow}`, auditWidths, auditLastRow);
auditSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' }, verticalAlignment: 'center' };
auditSheet.getRange('A1:M1').format.rowHeight = 26;
auditSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
auditSheet.getRange('A2:M2').format.rowHeight = 28;
auditSheet.getRange('A5:A10').format.wrapText = true;
auditSheet.getRange('A5:A10').format.rowHeight = 28;
auditSheet.getRange('D4:M4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'left', verticalAlignment: 'center' };
auditSheet.getRange('D5:D11').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
auditSheet.getRange('D5:M11').format.verticalAlignment = 'center';
auditSheet.getRange('E7:M7').format.rowHeight = 60;
for (let i = 0; i < auditRows.length; i += 1) {
  const rowNumber = auditFirstRow + i;
  auditSheet.getRange(`A${rowNumber}:M${rowNumber}`).format.rowHeight = estimateHeight(auditRows[i], auditWidths);
  if (i % 2 === 0) auditSheet.getRange(`A${rowNumber}:M${rowNumber}`).format.fill = '#F7F9FC';
}
auditSheet.getRange(`A${auditFirstRow}:A${auditLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
auditSheet.getRange(`F${auditFirstRow}:F${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Verified (scoped)', format: { fill: '#E8F2EC', font: { color: '#27623B', bold: true } } });
auditSheet.getRange(`F${auditFirstRow}:F${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Defect', format: { fill: '#FBE5E4', font: { color: '#922D32', bold: true } } });
auditSheet.getRange(`F${auditFirstRow}:F${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Missing', format: { fill: '#FFF1DC', font: { color: '#805322', bold: true } } });
auditSheet.getRange(`F${auditFirstRow}:F${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Unverified', format: { fill: '#E9EDF3', font: { color: '#46566D', bold: true } } });
auditSheet.getRange(`F${auditFirstRow}:F${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Deferred', format: { fill: '#F0E9F7', font: { color: '#6A4685', bold: true } } });
const auditTable = auditSheet.tables.add(`A${auditHeaderRow}:M${auditLastRow}`, true, 'AvenPostFixAudit');
auditTable.showFilterButton = true;
auditTable.style = 'TableStyleLight1';
auditSheet.freezePanes.freezeRows(auditHeaderRow);
auditSheet.freezePanes.freezeColumns(3);

const auditDetailTitleRow = auditLastRow + 3;
auditSheet.getRange(`A${auditDetailTitleRow}:M${auditDetailTitleRow}`).merge();
auditSheet.getRange(`A${auditDetailTitleRow}`).values = [['Methodology, observations and tests']];
auditSheet.getRange(`A${auditDetailTitleRow}`).format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
const detailEntries = [
  ...(postFix.methodology ?? []).map((value, i) => [`Methodology ${i + 1}`, value]),
  ...(postFix.rootObservations ?? []).map((value, i) => [`Root observation ${i + 1}`, value]),
  ...(postFix.tests ?? []).map((test, i) => [`Test ${i + 1}`, `${text(test.command)} [exit ${text(test.exitCode)}]: ${text(test.result)}`]),
];
for (let i = 0; i < detailEntries.length; i += 1) {
  const row = auditDetailTitleRow + 1 + i;
  const [label, value] = detailEntries[i];
  auditSheet.getRange(`A${row}:B${row}`).merge();
  auditSheet.getRange(`C${row}:M${row}`).merge();
  auditSheet.getRange(`A${row}`).values = [[label]];
  auditSheet.getRange(`C${row}`).values = [[value]];
  auditSheet.getRange(`A${row}:B${row}`).format = { fill: '#F2F5F9', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'top' };
  auditSheet.getRange(`C${row}:M${row}`).format = { font: { name: 'Arial', size: 10, color: '#243447' }, wrapText: true, verticalAlignment: 'top' };
  auditSheet.getRange(`A${row}:M${row}`).format.borders = { bottom: { style: 'thin', color: '#D7DEE8' } };
  auditSheet.getRange(`A${row}:M${row}`).format.rowHeight = Math.max(30, Math.min(90, Math.ceil(text(value).length / 120) * 14 + 16));
}

findingsSheet.getRange('A1:K1').merge();
findingsSheet.getRange('A1').values = [['Aven post-fix defect findings']];
findingsSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
findingsSheet.getRange('A1:K1').format.rowHeight = 26;
for (const [row, label, value] of [
  [3, 'Source path', register.source],
  [4, 'Source SHA-256', register.sha256],
  [5, 'Methodology', 'See the Audit detail section for methodology and supplied tests.'],
  [6, 'Limitations', 'Per-feature limitations appear in Audit. Defect records remain listed after resolution.'],
  [7, 'Summary', summaryText],
  [8, 'Defects', `${defects.length} affected feature rows; ${postFix.defects.length} distinct defects`],
]) {
  findingsSheet.getRange(`A${row}`).values = [[label]];
  findingsSheet.getRange(`B${row}:K${row}`).merge();
  findingsSheet.getRange(`B${row}`).values = [[value]];
  findingsSheet.getRange(`A${row}`).format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
  findingsSheet.getRange(`B${row}:K${row}`).format = { font: { name: 'Arial', size: 10, color: '#243447' }, wrapText: true, verticalAlignment: 'center' };
  findingsSheet.getRange(`A${row}:K${row}`).format.rowHeight = row === 7 ? 60 : 28;
}
const findingsHeaderRow = 10;
const findingsFirstRow = 11;
const findingsLastRow = findingsFirstRow + Math.max(defects.length, 1) - 1;
if (defects.length) findingsSheet.getRange(`A${findingsHeaderRow}:K${findingsLastRow}`).values = [findingsHeaders, ...defects];
else findingsSheet.getRange(`A${findingsHeaderRow}:K${findingsLastRow}`).values = [findingsHeaders, ['—', 'No defects supplied', '—', '—', '—', '—', '—', '—', '—', '—', '—']];
const findingsWidths = [11, 30, 30, 12, 52, 42, 52, 40, 42, 22, 44];
styleTable(findingsSheet, `A1:K${findingsLastRow}`, `A${findingsHeaderRow}:K${findingsHeaderRow}`, `A${findingsFirstRow}:K${findingsLastRow}`, findingsWidths, findingsLastRow);
findingsSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
findingsSheet.getRange('A1:K1').format.rowHeight = 26;
findingsSheet.getRange('A3:A8').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, wrapText: true, verticalAlignment: 'center' };
findingsSheet.getRange('A3:A6').format.rowHeight = 28;
findingsSheet.getRange('A8').format.rowHeight = 28;
findingsSheet.getRange('B3:K8').format = { font: { name: 'Arial', size: 10, color: '#243447' }, wrapText: true, verticalAlignment: 'center' };
findingsSheet.getRange('B7:K7').format.rowHeight = 60;
for (let i = 0; i < Math.max(defects.length, 1); i += 1) {
  const row = defects[i] ?? ['—', 'No defects supplied', '—', '—', '—', '—', '—', '—', '—', '—'];
  findingsSheet.getRange(`A${findingsFirstRow + i}:K${findingsFirstRow + i}`).format.rowHeight = estimateHeight(row, findingsWidths);
}
findingsSheet.getRange(`A${findingsFirstRow}:A${findingsLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
findingsSheet.getRange(`I${findingsFirstRow}:I${findingsLastRow}`).conditionalFormats.add('containsText', { text: 'Verified', format: { fill: '#E8F2EC', font: { color: '#27623B', bold: true } } });
findingsSheet.getRange(`I${findingsFirstRow}:I${findingsLastRow}`).conditionalFormats.add('containsText', { text: 'Open', format: { fill: '#FBE5E4', font: { color: '#922D32', bold: true } } });
if (defects.length) {
  const findingsTable = findingsSheet.tables.add(`A${findingsHeaderRow}:K${findingsLastRow}`, true, 'AvenPostFixFindings');
  findingsTable.showFilterButton = true;
  findingsTable.style = 'TableStyleLight1';
}
findingsSheet.freezePanes.freezeRows(findingsHeaderRow);
findingsSheet.freezePanes.freezeColumns(2);

originalSheet.getRange('A1:P1').merge();
originalSheet.getRange('A1').values = [['Original Aven register snapshot']];
originalSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
originalSheet.getRange('A1:P1').format.rowHeight = 26;
originalSheet.getRange('A2:P2').merge();
originalSheet.getRange('A2').values = [[`Preserved source claims from ${register.source}. SHA-256: ${register.sha256}`]];
originalSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
originalSheet.getRange('A2:P2').format.rowHeight = 26;
const originalHeaderRow = 5;
const originalFirstRow = 6;
const originalLastRow = originalFirstRow + register.rows.length - 1;
const originalRows = register.rows.map((row) => sourceHeaders.map((header) => row[header] ?? null));
originalSheet.getRange(`A${originalHeaderRow}:P${originalLastRow}`).values = [sourceHeaders, ...originalRows];
const originalWidths = [11, 14, 30, 16, 46, 34, 34, 34, 42, 11, 17, 32, 42, 18, 16, 44];
styleTable(originalSheet, `A1:P${originalLastRow}`, `A${originalHeaderRow}:P${originalHeaderRow}`, `A${originalFirstRow}:P${originalLastRow}`, originalWidths, originalLastRow);
originalSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
originalSheet.getRange('A1:P1').format.rowHeight = 26;
originalSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
originalSheet.getRange('A2:P2').format.rowHeight = 26;
for (let i = 0; i < originalRows.length; i += 1) {
  const rowNumber = originalFirstRow + i;
  originalSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.rowHeight = estimateHeight(originalRows[i], originalWidths);
  if (i % 2 === 0) originalSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.fill = '#F7F9FC';
}
originalSheet.getRange(`A${originalFirstRow}:A${originalLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
const originalTable = originalSheet.tables.add(`A${originalHeaderRow}:P${originalLastRow}`, true, 'OriginalAvenPostFixRegister');
originalTable.showFilterButton = true;
originalTable.style = 'TableStyleLight1';
originalSheet.freezePanes.freezeRows(originalHeaderRow);
originalSheet.freezePanes.freezeColumns(3);

workbook.recalculate();
console.log((await workbook.inspect({ kind: 'region', sheetId: 'Audit', range: 'A4:B10', maxChars: 5000, tableMaxRows: 10, tableMaxCols: 2 })).ndjson);
console.log((await workbook.inspect({ kind: 'table', sheetId: 'Audit', range: 'A12:M15', include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 13, maxChars: 8000 })).ndjson);
console.log((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 50 }, summary: 'final formula error scan', maxChars: 2000 })).ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const [sheetName, range, filename] of [
  ['Audit', 'A1:M20', 'post-fix-audit-preview.png'],
  ['Findings', `A1:K${Math.min(findingsLastRow, 18)}`, 'post-fix-findings-preview.png'],
  ['Original register', 'A1:P12', 'post-fix-original-register-preview.png'],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: 'png' });
  await fs.writeFile(resolve(outputDir, filename), new Uint8Array(await preview.arrayBuffer()));
}
const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(outputPath);
console.log(`Exported ${auditRows.length} audit rows, ${defects.length} retained defect rows, and ${originalRows.length} source rows to ${outputPath}`);
