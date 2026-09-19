import json
import hashlib
from pathlib import Path

out = Path(__file__).parent
baseline = (out / 'baseline' / 'polished.js').read_bytes().splitlines(keepends=True)
candidate = (out / 'history-candidate' / 'polished.js').read_bytes().splitlines(keepends=True)

def find(lines, prefix):
    prefix = prefix if isinstance(prefix, bytes) else prefix.encode('utf-8')
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            return index
    raise RuntimeError(f'missing source line: {prefix}')

def line(lines, prefix):
    return lines[find(lines, prefix)]

def text(raw):
    return raw.decode('utf-8')

source_sha = hashlib.sha256(b''.join(baseline)).hexdigest().upper()

replacements = []

# Add pin ordering state directly after the existing navigation commit helper.
base_nav = line(baseline, '  function navCommit')
cand_nav_index = find(candidate, '  function navCommit')
cand_chat_busy_index = find(candidate, '  function chatBusy')
replacements.append({'file': 'polished.js', 'sourceSHA': source_sha, 'old': text(base_nav), 'new': text(b''.join(candidate[cand_nav_index:cand_chat_busy_index]))})

# These function-level replacements are narrow and only contain the pin-order
# behavior; every old value is copied from the immutable baseline snapshot.
for prefix in [
    '  function projectNavMenu',
    '  function contextAction',
    '  function threadNavMenu',
    '  function teamNavMenu',
    '  function renderDirectRow',
]:
    replacements.append({'file': 'polished.js', 'sourceSHA': source_sha, 'old': text(line(baseline, prefix)), 'new': text(line(candidate, prefix))})

# Keep the two canonical navigation renderers together so their ordering
# contract is applied as one narrow hunk.
base_project_index = find(baseline, '  function renderProjectNavigation')
base_sidebar_index = find(baseline, '  function renderSidebar')
cand_project_index = find(candidate, '  function renderProjectNavigation')
cand_sidebar_index = find(candidate, '  function renderSidebar')
replacements.append({'file': 'polished.js', 'sourceSHA': source_sha, 'old': text(b''.join(baseline[base_project_index:base_sidebar_index + 1])), 'new': text(b''.join(candidate[cand_project_index:cand_sidebar_index + 1]))})

# Guard the optional chat-mode control so the rest of interaction wiring runs
# on the current shell, where this legacy control is absent.
replacements.append({'file': 'polished.js', 'sourceSHA': source_sha, 'old': text(line(baseline, "    byId('chat-mode').onchange")), 'new': text(line(candidate, '    const chatMode=byId(\'chat-mode\')'))})

# The candidate's final bootstrap is the only tail change. Pin ordering stays
# in the canonical renderers; no post-render DOM append/reordering is emitted.
base_bootstrap_index = find(baseline, "  if(document.readyState==='loading')")
cand_bootstrap_index = find(candidate, "  if(document.readyState==='loading')")
replacements.append({'file': 'polished.js', 'sourceSHA': source_sha, 'old': text(b''.join(baseline[base_bootstrap_index:])), 'new': text(b''.join(candidate[cand_bootstrap_index:]))})

(out / 'replacements.json').write_bytes((json.dumps(replacements, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
print(json.dumps({'replacements': len(replacements), 'baselineBytes': sum(map(len, baseline)), 'candidateBytes': sum(map(len, candidate)), 'crlf': all(b'\r\n' in raw for raw in [b''.join(baseline), b''.join(candidate)])}))
