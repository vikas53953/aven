"""Read-only verification of the exported audit workbook."""
import json
import collections
import pathlib
import zipfile
import xml.etree.ElementTree as ET

root = pathlib.Path(__file__).resolve().parent
ledger = json.loads((root.parent / 'final-row-results.json').read_text(encoding='utf-8-sig'))
expected = {row['id']: row['verdict'] for row in ledger['rows']}
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(root / 'Aven-Completion-Review.xlsx') as archive:
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        shared = [''.join(si.itertext()) for si in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
    def cells(part):
        document = ET.fromstring(archive.read(part))
        result = {}
        for cell in document.findall('.//m:sheetData/m:row/m:c', ns):
            value = cell.findtext('m:v', default='', namespaces=ns)
            if cell.get('t') == 's': value = shared[int(value)]
            elif cell.get('t') == 'inlineStr': value = ''.join(cell.find('m:is', ns).itertext())
            if cell.get('t') == 'e': raise AssertionError(f'Formula error in {part} {cell.get("r")}: {value}')
            result[cell.get('r')] = value
        return document, result
    document, audit = cells('xl/worksheets/sheet1.xml')
    actual = {audit[f'A{row}']: audit[f'H{row}'] for row in range(14, 129)}
    assert actual == expected, 'Exported IDs/verdicts differ from reviewed ledger'
    counts = collections.Counter(expected.values())
    verdicts = ['Verified (scoped)', 'Partial', 'Missing', 'Defect', 'Unverified', 'Deferred']
    for index, verdict in enumerate(verdicts, 5):
        cell = document.find(f'.//m:c[@r="C{index}"]', ns)
        assert cell.findtext('m:f', namespaces=ns), 'Count formula was not exported'
        assert int(float(audit[f'C{index}'])) == counts[verdict], f'Incorrect cached count {verdict}'
    assert document.find('.//m:pane', ns) is not None, 'Missing freeze panes'
    assert document.find('.//m:tablePart', ns) is not None, 'Missing filter table'
    _, original = cells('xl/worksheets/sheet4.xml')
    assert [original[f'A{row}'] for row in range(6, 121)] == list(expected), 'Source IDs lost or reordered'
    _, ui = cells('xl/worksheets/sheet3.xml')
    assert [ui[f'A{row}'] for row in range(5, 10)] == [f'UI-0{i}' for i in range(1, 6)], 'UI requirements lost'
    cells('xl/worksheets/sheet2.xml')
result = {'passed': True, 'featureRows': len(expected), 'uiRows': 5, 'counts': dict(counts), 'verification': 'Read-only exported XML, cached formula values, IDs, verdicts, tables and panes. Excel desktop was not used.'}
(root / 'export-verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
