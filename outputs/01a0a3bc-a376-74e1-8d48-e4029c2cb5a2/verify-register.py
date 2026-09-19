import json
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

base = Path(__file__).parent
path = base / 'Aven-UI-UX-Feature-Register.xlsx'
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(path) as z:
    assert z.testzip() is None
    strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for item in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', ns):
            strings.append(''.join(item.itertext()))
    root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    def value(c):
        kind = c.get('t')
        if kind == 'inlineStr': return ''.join(c.find('s:is', ns).itertext())
        v = c.find('s:v', ns)
        if v is None: return ''
        return strings[int(v.text)] if kind == 's' else v.text or ''
    cells = {c.get('r'): value(c) for c in root.findall('.//s:sheetData/s:row/s:c', ns)}
    ids = [cells[f'A{r}'] for r in range(11,126)]
    assert len(ids) == len(set(ids)) == 115
    assert ids == [f'UX-{i:03}' for i in range(1,116)]
    states = Counter(cells[f'D{r}'] for r in range(11,126))
    assert set(states) <= {'Needs fix','Present','Partial','Not verified','Missing','Placeholder'}
    deliveries = Counter(cells[f'N{r}'] for r in range(11,126))
    if cells.get('N8') == 'Verified':
        assert cells['O8'] == str(deliveries['Verified'])
    assert all(cells.get(f'{col}{r}') for r in range(11,126) for col in 'ABCDEFGHIJKLMNOP')
    assert not root.findall('.//s:c[@t="e"]', ns)
    for addr, expected in {'B8':115,'E8':states['Needs fix'],'G8':states['Missing'],'I8':states['Partial']+states['Placeholder'],'K8':states['Present'],'M8':states['Not verified']}.items():
        assert cells[addr] == str(expected), (addr,cells[addr],expected)
    updates_path = base/'register-updates.json'
    if updates_path.exists():
        updates = json.loads(updates_path.read_text(encoding='utf-8'))
        changed = {'A3','A7','N8','O8','B8','E8','G8','I8','K8','M8'}
        for update in updates:
            row = ids.index(update['id']) + 11
            for col, expected in update['cells'].items():
                assert cells[f'{col}{row}'] == expected, (update['id'],col)
                changed.add(f'{col}{row}')
        backups = sorted(base.glob('register-backup-*.xlsx'))
        if backups:
            with zipfile.ZipFile(backups[-1]) as old:
                old_strings = [''.join(t.itertext()) for t in ET.fromstring(old.read('xl/sharedStrings.xml'))]
                old_root = ET.fromstring(old.read('xl/worksheets/sheet1.xml'))
                for cell in old_root.findall('.//s:sheetData/s:row/s:c', ns):
                    address = cell.get('r')
                    if address in changed: continue
                    v = cell.find('s:v', ns)
                    old_value = '' if v is None else (old_strings[int(v.text)] if cell.get('t') == 's' else v.text or '')
                    if cell.get('t') == 'inlineStr': old_value = ''.join(cell.find('s:is',ns).itertext())
                    assert cells.get(address,'') == old_value, ('Unexpected change',address)
    pane = root.find('.//s:pane', ns)
    assert pane is not None and pane.get('ySplit') == '10' and pane.get('xSplit') == '3', ET.tostring(pane)
    table = ET.fromstring(z.read('xl/tables/table1.xml'))
    assert table.get('ref') == 'A10:P125'
    assert table.find('s:autoFilter', ns) is not None
    validations = root.find('s:dataValidations', ns)
    assert validations is not None and len(validations) >= 3
    sheets = ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)
    assert len(sheets) == 1
    result = {'file':str(path),'checks':'PASS','features':115,'states':dict(states),'delivery':dict(deliveries),'formula_errors':0,'filter_table':'A10:P125','frozen_rows':10,'frozen_columns':3,'worksheet_count':1,'reference_scope':'Grok/Codex live UI plus docs; Claude Code working session gated','export_process_note':'Artifact export reported success but process exited 1. Independent saved-file checks above passed.'}
    (base/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))
