'use strict';

const MAX_PROPOSAL_FILES = 8;
const MAX_PROPOSAL_FILE_BYTES = 16 * 1024;
const MAX_FINDINGS = 100;
const MAX_FINDING_BYTES = 2 * 1024;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonValue(value, name) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 256 * 1024) throw new Error(`${name} must be a bounded JSON object`);
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) throw new Error('object required');
    return parsed;
  } catch (error) {
    throw new Error(`${name} must be valid JSON object`);
  }
}

function assertKeys(value, allowed, name) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${name} contains unknown field ${key}`);
}

function nonemptyText(value, name, maxBytes) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${name} must be bounded text`);
  return value;
}

function boundedText(value, name, maxBytes) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${name} must be bounded text`);
  return value;
}

function normalizeCandidatePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('proposal file path is invalid');
  const pathValue = value.trim().replaceAll('\\', '/');
  if (pathValue.startsWith('/') || /^[A-Za-z]:\//.test(pathValue) || pathValue.includes('\0')) throw new Error('proposal file path must be relative');
  const parts = pathValue.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('proposal file path contains traversal');
  return parts.join('/');
}

function containsKeyPattern(value) {
  if (typeof value !== 'string') return false;
  return /(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret|password|private[_-]?key|authorization)\s*[:=]\s*["'][^"'\r\n]{6,}["']/i.test(value) ||
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key|authorization)\s*[:=]\s*(?!process\.env\b)[A-Za-z0-9._+/=-]{12,}/i.test(value) ||
    /\b(?:bearer|token)\s+[A-Za-z0-9._+/=-]{24,}/i.test(value) ||
    /\b(?:sk|key|ghp|github_pat)-[A-Za-z0-9._-]{16,}\b/i.test(value);
}

function parseBuilderProposal(value, allowedFiles, baseHashes) {
  const object = parseJsonValue(value, 'builder proposal');
  assertKeys(object, ['summary', 'files'], 'builder proposal');
  const summary = nonemptyText(object.summary, 'builder proposal summary', 4 * 1024);
  if (containsKeyPattern(summary)) throw new Error('builder proposal contains a key-like value');
  if (!Array.isArray(object.files) || object.files.length < 1 || object.files.length > MAX_PROPOSAL_FILES) throw new Error('builder proposal files are invalid');
  const allowed = new Set(allowedFiles || []);
  const seen = new Set();
  const files = object.files.map((item, index) => {
    if (!isPlainObject(item)) throw new Error(`builder proposal files[${index}] must be an object`);
    assertKeys(item, ['path', 'baseHash', 'content'], `builder proposal files[${index}]`);
    const path = normalizeCandidatePath(item.path);
    if (seen.has(path)) throw new Error(`builder proposal contains duplicate file ${path}`);
    seen.add(path);
    if (!allowed.has(path)) throw new Error(`builder proposal file is outside task allowlist: ${path}`);
    if (typeof item.baseHash !== 'string' || !/^[a-f0-9]{64}$/i.test(item.baseHash)) throw new Error(`builder proposal files[${index}].baseHash is invalid`);
    if (baseHashes && baseHashes[path] && item.baseHash.toLowerCase() !== String(baseHashes[path]).toLowerCase()) throw new Error(`builder proposal base hash does not match snapshot for ${path}`);
    const content = boundedText(item.content, `builder proposal files[${index}].content`, MAX_PROPOSAL_FILE_BYTES);
    if (containsKeyPattern(content)) throw new Error(`builder proposal content for ${path} contains a key-like value`);
    return { path, baseHash: item.baseHash.toLowerCase(), content };
  });
  return { summary, files };
}

function parseReviewResponse(value, criterionIds) {
  const object = parseJsonValue(value, 'review response');
  assertKeys(object, ['outcome', 'criteria', 'findings'], 'review response');
  if (!['pass', 'fail', 'unverified'].includes(object.outcome)) throw new Error('review outcome is invalid');
  if (!Array.isArray(object.criteria) || object.criteria.length > 100 || object.criteria.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200)) throw new Error('review criteria are invalid');
  const known = new Set(criterionIds || []);
  const criteria = Array.from(new Set(object.criteria.map((item) => item.trim())));
  if (criteria.some((id) => !known.has(id))) throw new Error('review references an unknown criterion');
  if (!Array.isArray(object.findings) || object.findings.length > MAX_FINDINGS || object.findings.some((item) => typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > MAX_FINDING_BYTES)) throw new Error('review findings are invalid');
  const findings = object.findings.map((item) => item.trim()).filter(Boolean);
  if (containsKeyPattern(findings.join('\n'))) throw new Error('review response contains a key-like value');
  return { outcome: object.outcome, criteria, findings };
}

function parsePlan(value) {
  if (typeof value === 'string') {
    const plan = value.trim();
    if (!plan || Buffer.byteLength(plan, 'utf8') > 16 * 1024) throw new Error('planner response is invalid');
    if (containsKeyPattern(plan)) throw new Error('planner response contains a key-like value');
    return plan;
  }
  const object = parseJsonValue(value, 'planner response');
  assertKeys(object, ['summary', 'steps'], 'planner response');
  const summary = nonemptyText(object.summary, 'planner response summary', 8 * 1024);
  const steps = object.steps === undefined ? [] : object.steps;
  if (!Array.isArray(steps) || steps.length > 50 || steps.some((step) => typeof step !== 'string' || Buffer.byteLength(step, 'utf8') > 2 * 1024)) throw new Error('planner response steps are invalid');
  const result = JSON.stringify({ summary, steps });
  if (containsKeyPattern(result)) throw new Error('planner response contains a key-like value');
  return result;
}

module.exports = {
  MAX_PROPOSAL_FILES,
  MAX_PROPOSAL_FILE_BYTES,
  parseBuilderProposal,
  parseReviewResponse,
  parsePlan,
  containsKeyPattern,
  normalizeCandidatePath
};
