'use strict';

/* Build only the bounded candidate package. This script never writes product files. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FIX_ROOT = __dirname;
const COMPLETION_ROOT = path.resolve(FIX_ROOT, '..');
const PRODUCT_ROOT = path.resolve(process.env.AVEN_PRODUCT_ROOT || path.resolve(COMPLETION_ROOT, '..', '..', '..'));
const CANDIDATE_ROOT = path.join(FIX_ROOT, 'candidate');
const CANDIDATE_INTENTGRAPH = path.join(CANDIDATE_ROOT, 'intentgraph');
const baselineIntentgraph = path.join(COMPLETION_ROOT, 'baseline', 'intentgraph');
const minimalUiCandidate = path.join(COMPLETION_ROOT, 'minimal-ui', 'candidate', 'polished.js');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function readBuffer(filePath) { return fs.readFileSync(filePath); }
function countExact(text, needle) { let count = 0, at = 0; while ((at = text.indexOf(needle, at)) !== -1) { count += 1; at += needle.length; } return count; }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function applyHunks({ sourcePath, outputPath, file, operations }) {
  let buffer = readBuffer(sourcePath);
  let text = buffer.toString('utf8');
  const originalHash = sha256(buffer);
  const replacements = [];
  for (const operation of operations) {
    const count = countExact(text, operation.old);
    if (count !== 1) throw new Error(`${file}: expected one exact occurrence, found ${count}`);
    const before = Buffer.from(text, 'utf8');
    text = text.replace(operation.old, operation.new);
    const after = Buffer.from(text, 'utf8');
    replacements.push({
      file,
      sourcePath,
      old: operation.old,
      new: operation.new,
      occurrenceCount: 1,
      sourceSHA256Before: sha256(before),
      sourceSHA256After: sha256(after)
    });
  }
  fs.writeFileSync(outputPath, text, 'utf8');
  return { originalHash, finalHash: sha256(Buffer.from(text, 'utf8')), replacements };
}

function lineContaining(text, predicate) {
  const line = text.split(/\r?\n/).find(predicate);
  if (!line) throw new Error('Could not find requested source line');
  return line;
}

function build() {
  ensureDir(CANDIDATE_INTENTGRAPH);
  const runtimeSource = path.join(baselineIntentgraph, 'agent-runtime.cjs');
  const runtimeText = readBuffer(runtimeSource).toString('utf8');
  const runtimeOperations = [
    {
      old: "const CHAT_MODES = Object.freeze(['inspect', 'plan']);\n\nconst OPERATION_COMMANDS",
      new: "const CHAT_MODES = Object.freeze(['inspect', 'plan']);\nconst NOT_ASSESSED_HEALTH = Object.freeze({ status: 'not_assessed', reason: 'Command completion is not a device health assessment.' });\n\nconst OPERATION_COMMANDS"
    },
    {
      old: "    'Never claim a command succeeded unless the tool result status is SUCCESS and includes raw output. Preserve UNKNOWN, FAILURE, BLOCKLISTED, NOT_EXECUTED, and budget exhaustion accurately. Never substitute output or imply a retry.',",
      new: "    'Never claim a command succeeded unless the tool result status is SUCCESS and includes raw output. Preserve UNKNOWN, FAILURE, BLOCKLISTED, NOT_EXECUTED, and budget exhaustion accurately. Never substitute output or imply a retry.',\n    'A SUCCESS command result means execution completed only; it never establishes a healthy device. Health conclusions require concrete raw evidence and must remain qualified. If any check is UNKNOWN, FAILURE, BLOCKLISTED, or NOT_EXECUTED, lead the authoritative answer with that deterministic outcome and state that device health is not established.',"
    },
    {
      old: "function evidenceSummary(evidence) {\n  const nonSuccess = evidence.filter((item) => item.status !== 'SUCCESS');\n  if (!nonSuccess.length) return '';\n  return '\\n\\nObserved operation status:\\n' + nonSuccess.map((item) => `${item.command} on ${item.target}: ${item.status}`).join('\\n');\n}",
      new: "function incompleteEvidenceSummary(evidence) {\n  const nonSuccess = evidence.filter((item) => item.status !== 'SUCCESS');\n  if (!nonSuccess.length) return '';\n  const observed = nonSuccess.map((item) => `${item.command} on ${item.target}: ${item.status}`).join('; ');\n  return `Observed check status: ${observed}. Device health is not established by these checks.`;\n}\n\nfunction healthAssessmentFor(evidence) {\n  return evidence.some((item) => item.command !== 'inventory') ? { ...NOT_ASSESSED_HEALTH } : null;\n}"
    },
    {
      old: "    const groundedText = text || (evidence.length ? 'The investigation ended without a grounded final response.' : 'No grounded response was returned.');\n",
      new: "    const groundedText = text || (evidence.length ? 'The investigation ended without a grounded final response.' : 'No grounded response was returned.');\n    const incompleteSummary = incompleteEvidenceSummary(evidence);\n    const healthAssessment = healthAssessmentFor(evidence);\n"
    },
    {
      old: "      text: `${groundedText}${evidenceSummary(evidence)}`,",
      new: "      text: incompleteSummary || groundedText,\n      ...(incompleteSummary && groundedText ? { advisoryText: groundedText } : {}),\n      ...(healthAssessment ? { healthAssessment } : {}),"
    }
  ];
  const runtimeOutput = path.join(CANDIDATE_INTENTGRAPH, 'agent-runtime.cjs');
  const runtimeResult = applyHunks({ sourcePath: runtimeSource, outputPath: runtimeOutput, file: 'intentgraph/agent-runtime.cjs', operations: runtimeOperations });

  for (const dependency of ['catalyst.cjs', 'vault.cjs', 'network-commands.json', 'network-execution.cjs', 'agent-runtime.test.cjs', 'chat-runtime.cjs', 'chat-runtime.test.cjs']) fs.copyFileSync(path.join(baselineIntentgraph, dependency), path.join(CANDIDATE_INTENTGRAPH, dependency));
  ensureDir(path.join(CANDIDATE_INTENTGRAPH, 'adapters'));
  fs.copyFileSync(path.join(baselineIntentgraph, 'adapters', 'index.cjs'), path.join(CANDIDATE_INTENTGRAPH, 'adapters', 'index.cjs'));

  // The root prepare stage checks each old anchor against immutable v8 first,
  // then applies packages in order. Keep these anchors shared with the
  // minimal-ui candidate so the health package composes after it.
  const uiSource = path.join(COMPLETION_ROOT, 'baseline', 'polished.js');
  const uiOperations = [
    {
      old: "status.textContent=String(item.status||'UNKNOWN');",
      new: "status.textContent='Execution: '+String(item.status||'UNKNOWN');status.setAttribute('aria-label','Execution status: '+String(item.status||'UNKNOWN'));"
    },
    {
      old: "header.append(title);if(item.status!=='SUCCESS')header.append(status);",
      new: "header.append(title);header.append(status);"
    },
    {
      old: "events:pending.events,evidence:AvenRunState.clean(result.evidence||[]),runId:",
      new: "events:pending.events,evidence:AvenRunState.clean(result.evidence||[]),healthAssessment:result.healthAssessment&&{status:result.healthAssessment.status,reason:result.healthAssessment.reason},runId:"
    },
    {
      old: "+'. Execution status does not establish device health.';",
      new: "+'. Execution status is separate from device health.'+(m.healthAssessment?.status==='not_assessed'?' Health: not assessed · '+(m.healthAssessment.reason||'Command completion is not a device health assessment.'):'');"
    },
    {
      old: "const explanation=rawTextForMessage(m).trim();",
      new: "const explanation=(m.evidence||[]).some(e=>e.status&&e.status!=='SUCCESS')?'':rawTextForMessage(m).trim();"
    }
  ];
  const frozenUiOutput = path.join(CANDIDATE_ROOT, 'frozen-v8', 'polished.js');
  ensureDir(path.dirname(frozenUiOutput));
  const uiResult = applyHunks({ sourcePath: uiSource, outputPath: frozenUiOutput, file: 'polished.js', operations: uiOperations });
  const preservedCandidate = path.join(CANDIDATE_ROOT, 'minimal-ui-health', 'polished.js');
  ensureDir(path.dirname(preservedCandidate));
  const currentCandidate = path.join(CANDIDATE_ROOT, 'polished.js');
  if (!fs.existsSync(preservedCandidate) && fs.existsSync(currentCandidate)) fs.copyFileSync(currentCandidate, preservedCandidate);
  if (!fs.existsSync(preservedCandidate)) throw new Error('The existing minimal UI candidate output is required for byte-equivalence preservation.');
  fs.copyFileSync(preservedCandidate, currentCandidate);
  const preservedCandidateHash = sha256(readBuffer(preservedCandidate));

  const sourceHashes = {
    liveAgentRuntime: sha256(readBuffer(path.join(PRODUCT_ROOT, 'intentgraph', 'agent-runtime.cjs'))),
    frozenAgentRuntime: runtimeResult.originalHash,
    latestMinimalUiCandidate: sha256(readBuffer(minimalUiCandidate)),
    frozenV8PolishedJs: uiResult.originalHash,
    livePolishedJs: sha256(readBuffer(path.join(PRODUCT_ROOT, 'polished.js'))),
    livePolishedHtml: sha256(readBuffer(path.join(PRODUCT_ROOT, 'polished.html')))
  };
  const manifest = {
    schemaVersion: 1,
    scope: 'UX079/UX106 health status boundary; candidate-only runtime and minimal UI changes.',
    productRoot: PRODUCT_ROOT,
    touchedFiles: ['candidate/intentgraph/agent-runtime.cjs', 'candidate/intentgraph/catalyst.cjs', 'candidate/intentgraph/vault.cjs', 'candidate/intentgraph/network-commands.json', 'candidate/polished.js', 'candidate/minimal-ui-health/polished.js', 'candidate/frozen-v8/polished.js'],
    unchangedCopies: ['candidate/intentgraph/catalyst.cjs', 'candidate/intentgraph/vault.cjs', 'candidate/intentgraph/network-commands.json', 'candidate/intentgraph/network-execution.cjs', 'candidate/intentgraph/adapters/index.cjs', 'candidate/intentgraph/agent-runtime.test.cjs', 'candidate/intentgraph/chat-runtime.cjs', 'candidate/intentgraph/chat-runtime.test.cjs'],
    sourceHashes,
    candidateHashes: { agentRuntime: runtimeResult.finalHash, frozenV8PolishedJs: uiResult.finalHash, preservedMinimalUiPolishedJs: preservedCandidateHash },
    replacements: [...runtimeResult.replacements, ...uiResult.replacements]
  };
  fs.writeFileSync(path.join(FIX_ROOT, 'replacements.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(FIX_ROOT, 'candidate-manifest.json'), JSON.stringify({ ...manifest, replacements: undefined }, null, 2).replace(/,\n  \"replacements\": undefined/, '') + '\n');
  console.log(JSON.stringify({ scope: manifest.scope, runtimeHunks: runtimeResult.replacements.length, uiHunks: uiResult.replacements.length, candidateHashes: manifest.candidateHashes }, null, 2));
}

build();
