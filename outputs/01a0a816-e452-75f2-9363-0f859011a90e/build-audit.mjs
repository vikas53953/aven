import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = fileURLToPath(new URL('.', import.meta.url));
const sourceRegisterPath = `${outputDir}/source-register.json`;
const integratedPath = `${outputDir}/integrated-audit.json`;
const outputPath = `${outputDir}/Aven-Independent-Audit.xlsx`;

const allowedVerdicts = ['Verified (scoped)', 'Partial', 'Missing', 'Defect', 'Unverified', 'Deferred'];
const sourceHeaders = [
  'ID', 'Area', 'Feature', 'Aven state', 'Aven today', 'Grok Bot', 'Codex desktop', 'Claude Code',
  'Aven target / next action', 'Priority', 'Phase', 'Dependency', 'Acceptance check', 'Delivery', 'Decision', 'Evidence',
];
const auditHeaders = ['ID', 'Area', 'Feature', 'Original Delivery', 'Independent verdict', 'Evidence level', 'Finding / gap', 'Next action', 'Limitation', 'Evidence refs'];
const findingsHeaders = ['ID', 'Feature', 'Defect title', 'Repro', 'Expected', 'Actual', 'Severity', 'Evidence refs'];

const text = (value) => {
  if (Array.isArray(value)) return value.join('\n');
  if (value === null || value === undefined) return '';
  return String(value);
};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const expectedIds = (count) => Array.from({ length: count }, (_, i) => `UX-${String(i + 1).padStart(3, '0')}`);

function assertSource(register) {
  if (!Array.isArray(register.rows) || register.rows.length !== 115) throw new Error(`Expected 115 source rows; found ${register.rows?.length ?? 'missing'}`);
  if (!Array.isArray(register.headers) || JSON.stringify(register.headers.slice(0, sourceHeaders.length)) !== JSON.stringify(sourceHeaders)) throw new Error('Source headers do not match the expected 16-column register');
  const ids = register.rows.map((row) => row.ID);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds(115))) throw new Error('Source IDs are not the stable UX-001 through UX-115 sequence');
  if (!register.source || !register.sha256) throw new Error('Source path and hash are required in source-register.json');
  return ids;
}

function assertIntegrated(integrated, sourceIds) {
  if (!Array.isArray(integrated.rows) || integrated.rows.length !== sourceIds.length) throw new Error(`Expected ${sourceIds.length} integrated rows; found ${integrated.rows?.length ?? 'missing'}`);
  const fields = ['id', 'verdict', 'evidenceLevel', 'finding', 'evidence', 'nextAction', 'limitation'];
  const seen = new Set();
  for (const row of integrated.rows) {
    for (const key of fields) if (!hasOwn(row, key)) throw new Error(`Integrated row ${row.id ?? '<unknown>'} is missing ${key}`);
    if (!sourceIds.includes(row.id)) throw new Error(`Integrated row has unknown ID: ${row.id}`);
    if (seen.has(row.id)) throw new Error(`Integrated rows contain duplicate ID: ${row.id}`);
    seen.add(row.id);
    if (!allowedVerdicts.includes(row.verdict)) throw new Error(`Unsupported independent verdict for ${row.id}: ${row.verdict}`);
  }
  for (const id of sourceIds) if (!seen.has(id)) throw new Error(`Integrated rows are missing source ID: ${id}`);
  if (!Array.isArray(integrated.defects)) throw new Error('Integrated audit is missing the defects array');
  const defectIds = new Set();
  for (const defect of integrated.defects) {
    if (!Array.isArray(defect.ids) || defect.ids.length === 0) throw new Error('Each defect must contain one or more ids');
    for (const key of ['severity', 'title', 'repro', 'expected', 'actual', 'evidence']) if (!hasOwn(defect, key)) throw new Error(`Defect group is missing ${key}`);
    const groupIds = new Set();
    for (const id of defect.ids) {
      if (!sourceIds.includes(id)) throw new Error(`Defect has unknown ID: ${id}`);
      if (groupIds.has(id)) throw new Error(`Defect group repeats ID: ${id}`);
      groupIds.add(id);
      defectIds.add(id);
      const row = integrated.rows.find((candidate) => candidate.id === id);
      if (!row || row.verdict !== 'Defect') throw new Error(`Defect ${id} must have row verdict Defect`);
    }
  }
  for (const row of integrated.rows) if (row.verdict === 'Defect' && !defectIds.has(row.id)) throw new Error(`Defect verdict has no defect details: ${row.id}`);
  if (integrated.tests !== undefined && !Array.isArray(integrated.tests)) throw new Error('Integrated tests must be an array');
  if (integrated.methodology !== undefined && !Array.isArray(integrated.methodology)) throw new Error('Integrated methodology must be an array');
  if (integrated.rootObservations !== undefined && !Array.isArray(integrated.rootObservations)) throw new Error('Integrated rootObservations must be an array');
  if (integrated.summary !== undefined && !Array.isArray(integrated.summary)) throw new Error('Integrated summary must be an array');
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
const currentSourceHash = crypto.createHash('sha256').update(await fs.readFile(register.source)).digest('hex');
if (currentSourceHash !== register.sha256) throw new Error(`Source workbook hash changed: register=${register.sha256}, current=${currentSourceHash}`);
const integrated = JSON.parse(await fs.readFile(integratedPath, 'utf8'));
assertIntegrated(integrated, sourceIds);
const auditDate = integrated.auditDate ?? '16 September 2026';
const buildId = integrated.buildId ?? 'ux-pipeline-v7';

const sourceRows = new Map(register.rows.map((row) => [row.ID, row]));
const auditRows = integrated.rows.map((row) => {
  const source = sourceRows.get(row.id);
  return [row.id, source.Area, source.Feature, source.Delivery, row.verdict, row.evidenceLevel, row.finding, row.nextAction, row.limitation, row.evidence];
});
const defects = integrated.defects.flatMap((defect) => defect.ids.map((id) => [id, sourceRows.get(id).Feature, defect.title, defect.repro, defect.expected, defect.actual, defect.severity, defect.evidence]));

const summaryText = text(integrated.summary ?? []);
const limitationText = [...new Set(integrated.rows.map((row) => text(row.limitation)).filter(Boolean))].join('\n');

const workbook = Workbook.create();
const auditSheet = workbook.worksheets.add('Audit');
const findingsSheet = workbook.worksheets.add('Findings');
const originalSheet = workbook.worksheets.add('Original register');
auditSheet.tabColor = '#243447';
findingsSheet.tabColor = '#8A5A2B';
originalSheet.tabColor = '#708090';

auditSheet.getRange('A1:J1').merge();
auditSheet.getRange('A1').values = [['Aven independent audit']];
auditSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' }, verticalAlignment: 'center' };
auditSheet.getRange('A1:J1').format.rowHeight = 26;
auditSheet.getRange('A2:J2').merge();
auditSheet.getRange('A2').values = [[`Independent review of ${sourceIds.length} source features on ${auditDate}, build ${buildId}. Verdicts are evidence-scoped. Partial can reflect incomplete acceptance coverage even where a local implementation exists.`]];
auditSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
auditSheet.getRange('A2:J2').format.rowHeight = 28;
auditSheet.getRange('A4:B4').values = [['Verdict', 'Count']];
auditSheet.getRange('A5:A10').values = allowedVerdicts.map((verdict) => [verdict]);
auditSheet.getRange('B5:B10').formulas = allowedVerdicts.map((verdict) => [`=COUNTIFS($E$13:$E$127,"${verdict}")`]);
auditSheet.getRange('D4:J4').merge();
auditSheet.getRange('D4').values = [['Source and review context']];
for (const [row, label, value] of [
  [5, 'Source path', register.source],
  [6, 'Source SHA-256', register.sha256],
  [7, 'Summary', summaryText],
  [8, 'Methodology', 'Detailed methodology appears below the audit table.'],
  [9, 'Limits', 'Per-feature limitations appear in the Audit table.'],
  [10, 'Defects', `${defects.length} affected feature rows; ${integrated.defects.length} distinct defects`],
  [11, 'Tests', 'Detailed test commands and results appear below the audit table.'],
]) {
  auditSheet.getRange(`D${row}`).values = [[label]];
  auditSheet.getRange(`E${row}:J${row}`).merge();
  auditSheet.getRange(`E${row}`).values = [[value]];
  auditSheet.getRange(`E${row}:J${row}`).format.wrapText = true;
  auditSheet.getRange(`E${row}:J${row}`).format.verticalAlignment = 'center';
  auditSheet.getRange(`D${row}`).format.rowHeight = row === 7 ? 60 : 26;
}
auditSheet.getRange('A4:B4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'center' };
auditSheet.getRange('D4:J4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'left', verticalAlignment: 'center' };
auditSheet.getRange('D5:D11').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };

const auditHeaderRow = 12;
const auditFirstRow = 13;
const auditLastRow = auditFirstRow + auditRows.length - 1;
auditSheet.getRange(`A${auditHeaderRow}:J${auditLastRow}`).values = [auditHeaders, ...auditRows];
const auditWidths = [11, 14, 30, 18, 21, 18, 44, 44, 38, 44];
styleTable(auditSheet, `A1:J${auditLastRow}`, `A${auditHeaderRow}:J${auditHeaderRow}`, `A${auditFirstRow}:J${auditLastRow}`, auditWidths, auditLastRow);
auditSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
auditSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
auditSheet.getRange('A1:J1').format.rowHeight = 26;
auditSheet.getRange('A2:J2').format.rowHeight = 28;
auditSheet.getRange('A4:B4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'center', verticalAlignment: 'center' };
auditSheet.getRange('A5:A10').format.wrapText = true;
auditSheet.getRange('A5:A10').format.rowHeight = 28;
auditSheet.getRange('E7:J7').format.rowHeight = 60;
auditSheet.getRange('D4:J4').format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, horizontalAlignment: 'left', verticalAlignment: 'center' };
auditSheet.getRange('D5:D11').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
auditSheet.getRange('D5:J11').format.verticalAlignment = 'center';
for (let i = 0; i < auditRows.length; i += 1) {
  const rowNumber = auditFirstRow + i;
  auditSheet.getRange(`A${rowNumber}:J${rowNumber}`).format.rowHeight = estimateHeight(auditRows[i], auditWidths);
  if (i % 2 === 0) auditSheet.getRange(`A${rowNumber}:J${rowNumber}`).format.fill = '#F7F9FC';
}
auditSheet.getRange(`A${auditFirstRow}:A${auditLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
auditSheet.getRange(`E${auditFirstRow}:E${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Verified (scoped)', format: { fill: '#E8F2EC', font: { color: '#27623B', bold: true } } });
auditSheet.getRange(`E${auditFirstRow}:E${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Defect', format: { fill: '#FBE5E4', font: { color: '#922D32', bold: true } } });
auditSheet.getRange(`E${auditFirstRow}:E${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Missing', format: { fill: '#FFF1DC', font: { color: '#805322', bold: true } } });
auditSheet.getRange(`E${auditFirstRow}:E${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Unverified', format: { fill: '#E9EDF3', font: { color: '#46566D', bold: true } } });
auditSheet.getRange(`E${auditFirstRow}:E${auditLastRow}`).conditionalFormats.add('containsText', { text: 'Deferred', format: { fill: '#F0E9F7', font: { color: '#6A4685', bold: true } } });
const auditTable = auditSheet.tables.add(`A${auditHeaderRow}:J${auditLastRow}`, true, 'AvenAudit');
auditTable.showFilterButton = true;
auditTable.style = 'TableStyleLight1';
auditSheet.freezePanes.freezeRows(auditHeaderRow);
auditSheet.freezePanes.freezeColumns(3);

const auditDetailTitleRow = auditLastRow + 3;
auditSheet.getRange(`A${auditDetailTitleRow}:J${auditDetailTitleRow}`).merge();
auditSheet.getRange(`A${auditDetailTitleRow}`).values = [['Methodology, observations and tests']];
auditSheet.getRange(`A${auditDetailTitleRow}`).format = { fill: '#DCE5EF', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
const detailEntries = [
  ...(integrated.methodology ?? []).map((value, i) => [`Methodology ${i + 1}`, value]),
  ...(integrated.rootObservations ?? []).map((value, i) => [`Root observation ${i + 1}`, value]),
  ...(integrated.tests ?? []).map((test, i) => [`Test ${i + 1}`, `${text(test.command)} [exit ${text(test.exitCode)}]: ${text(test.result)}`]),
];
for (let i = 0; i < detailEntries.length; i += 1) {
  const row = auditDetailTitleRow + 1 + i;
  const [label, value] = detailEntries[i];
  auditSheet.getRange(`A${row}:B${row}`).merge();
  auditSheet.getRange(`C${row}:J${row}`).merge();
  auditSheet.getRange(`A${row}`).values = [[label]];
  auditSheet.getRange(`C${row}`).values = [[value]];
  auditSheet.getRange(`A${row}:B${row}`).format = { fill: '#F2F5F9', font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'top' };
  auditSheet.getRange(`C${row}:J${row}`).format = { font: { name: 'Arial', size: 10, color: '#243447' }, wrapText: true, verticalAlignment: 'top' };
  auditSheet.getRange(`A${row}:J${row}`).format.borders = { bottom: { style: 'thin', color: '#D7DEE8' } };
  auditSheet.getRange(`A${row}:J${row}`).format.rowHeight = Math.max(30, Math.min(90, Math.ceil(text(value).length / 120) * 14 + 16));
}

findingsSheet.getRange('A1:H1').merge();
findingsSheet.getRange('A1').values = [['Aven independent audit findings']];
findingsSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
findingsSheet.getRange('A1:H1').format.rowHeight = 26;
for (const [row, label, value] of [
  [3, 'Source path', register.source],
  [4, 'Source SHA-256', register.sha256],
  [5, 'Methodology', 'See the Audit detail section for the full methodology and checks.'],
  [6, 'Limitations', 'Per-feature limitations appear in the Audit table.'],
  [7, 'Summary', summaryText],
  [8, 'Defects', `${defects.length} affected feature rows; ${integrated.defects.length} distinct defects`],
]) {
  findingsSheet.getRange(`A${row}`).values = [[label]];
  findingsSheet.getRange(`B${row}:H${row}`).merge();
  findingsSheet.getRange(`B${row}`).values = [[value]];
  findingsSheet.getRange(`A${row}`).format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
  findingsSheet.getRange(`B${row}:H${row}`).format = { font: { name: 'Arial', size: 10, color: '#243447' }, wrapText: true, verticalAlignment: 'center' };
  findingsSheet.getRange(`A${row}:H${row}`).format.rowHeight = row === 7 ? 60 : 28;
}
const findingsHeaderRow = 10;
const findingsFirstRow = 11;
const findingsLastRow = findingsFirstRow + Math.max(defects.length, 1) - 1;
if (defects.length) findingsSheet.getRange(`A${findingsHeaderRow}:H${findingsLastRow}`).values = [findingsHeaders, ...defects];
else findingsSheet.getRange(`A${findingsHeaderRow}:H${findingsLastRow}`).values = [findingsHeaders, ['—', 'No defects supplied', '—', '—', '—', '—', '—', '—']];
const findingsWidths = [11, 30, 30, 52, 42, 52, 12, 44];
styleTable(findingsSheet, `A1:H${findingsLastRow}`, `A${findingsHeaderRow}:H${findingsHeaderRow}`, `A${findingsFirstRow}:H${findingsLastRow}`, findingsWidths, findingsLastRow);
findingsSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
findingsSheet.getRange('A1:H1').format.rowHeight = 26;
findingsSheet.getRange('A3:A8').format = { font: { name: 'Arial', size: 10, bold: true, color: '#243447' }, verticalAlignment: 'center' };
findingsSheet.getRange('A3:A8').format.wrapText = true;
findingsSheet.getRange('A3:A6').format.rowHeight = 40;
findingsSheet.getRange('A8').format.rowHeight = 40;
findingsSheet.getRange('B3:H8').format = { font: { name: 'Arial', size: 10, color: '#243447' }, wrapText: true, verticalAlignment: 'center' };
for (let i = 0; i < Math.max(defects.length, 1); i += 1) {
  const row = defects[i] ?? ['—', 'No defects supplied', '—', '—', '—', '—', '—', '—'];
  findingsSheet.getRange(`A${findingsFirstRow + i}:H${findingsFirstRow + i}`).format.rowHeight = estimateHeight(row, findingsWidths);
}
findingsSheet.getRange(`A${findingsFirstRow}:A${findingsLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
if (defects.length) {
  findingsSheet.getRange(`G${findingsFirstRow}:G${findingsLastRow}`).conditionalFormats.add('containsText', { text: 'P0', format: { fill: '#FBE5E4', font: { color: '#922D32', bold: true } } });
  findingsSheet.getRange(`G${findingsFirstRow}:G${findingsLastRow}`).conditionalFormats.add('containsText', { text: 'P1', format: { fill: '#FFF1DC', font: { color: '#805322', bold: true } } });
  const findingsTable = findingsSheet.tables.add(`A${findingsHeaderRow}:H${findingsLastRow}`, true, 'AvenFindings');
  findingsTable.showFilterButton = true;
  findingsTable.style = 'TableStyleLight1';
}
findingsSheet.freezePanes.freezeRows(findingsHeaderRow);
findingsSheet.freezePanes.freezeColumns(2);

originalSheet.getRange('A1:P1').merge();
originalSheet.getRange('A1').values = [['Original Aven register snapshot']];
originalSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
originalSheet.getRange('A2:P2').merge();
originalSheet.getRange('A2').values = [[`Preserved source claims from ${register.source}. SHA-256: ${register.sha256}`]];
originalSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
const originalHeaderRow = 5;
const originalFirstRow = 6;
const originalLastRow = originalFirstRow + register.rows.length - 1;
const originalRows = register.rows.map((row) => sourceHeaders.map((header) => row[header] ?? null));
originalSheet.getRange(`A${originalHeaderRow}:P${originalLastRow}`).values = [sourceHeaders, ...originalRows];
const originalWidths = [11, 14, 30, 16, 46, 34, 34, 34, 42, 11, 17, 32, 42, 18, 16, 44];
styleTable(originalSheet, `A1:P${originalLastRow}`, `A${originalHeaderRow}:P${originalHeaderRow}`, `A${originalFirstRow}:P${originalLastRow}`, originalWidths, originalLastRow);
originalSheet.getRange('A1').format = { font: { name: 'Arial', size: 16, bold: true, color: '#243447' } };
originalSheet.getRange('A2').format = { font: { name: 'Arial', size: 10, italic: true, color: '#58687A' } };
originalSheet.getRange('A1:P1').format.rowHeight = 26;
originalSheet.getRange('A2:P2').format.rowHeight = 26;
for (let i = 0; i < originalRows.length; i += 1) {
  const rowNumber = originalFirstRow + i;
  originalSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.rowHeight = estimateHeight(originalRows[i], originalWidths);
  if (i % 2 === 0) originalSheet.getRange(`A${rowNumber}:P${rowNumber}`).format.fill = '#F7F9FC';
}
originalSheet.getRange(`A${originalFirstRow}:A${originalLastRow}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#243447' };
const originalTable = originalSheet.tables.add(`A${originalHeaderRow}:P${originalLastRow}`, true, 'OriginalAvenRegister');
originalTable.showFilterButton = true;
originalTable.style = 'TableStyleLight1';
originalSheet.freezePanes.freezeRows(originalHeaderRow);
originalSheet.freezePanes.freezeColumns(3);

workbook.recalculate();
console.log((await workbook.inspect({ kind: 'region', sheetId: 'Audit', range: 'A4:E10', maxChars: 5000, tableMaxRows: 10, tableMaxCols: 5 })).ndjson);
console.log((await workbook.inspect({ kind: 'table', sheetId: 'Audit', range: 'A12:J15', include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 10, maxChars: 6000 })).ndjson);
console.log((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 50 }, summary: 'final formula error scan', maxChars: 2000 })).ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const [sheetName, range, filename] of [
  ['Audit', 'A1:J20', 'audit-preview.png'],
  ['Findings', `A1:H${Math.min(findingsLastRow, 18)}`, 'findings-preview.png'],
  ['Original register', 'A1:P12', 'original-register-preview.png'],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: 'png' });
  await fs.writeFile(`${outputDir}/${filename}`, new Uint8Array(await preview.arrayBuffer()));
}
const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(outputPath);
console.log(`Exported ${auditRows.length} audit rows, ${defects.length} findings, and ${originalRows.length} source rows to ${outputPath}`);
