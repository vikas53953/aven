'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./server.cjs');

const DEFAULT_URL = 'http://127.0.0.1:8768';

function usage() {
  process.stderr.write('Usage: cli.cjs query TERM | source PATH | state | action JSON | gate TASK\n');
}

function getBaseUrl(args) {
  const index = args.indexOf('--url');
  return (index >= 0 ? args[index + 1] : process.env.INTENTGRAPH_URL || DEFAULT_URL).replace(/\/$/, '');
}

function compactCoverage(coverage, verbose) {
  if (verbose) return coverage;
  return {
    ...coverage,
    skipped: undefined,
    unresolvedExternalPaths: undefined,
    skippedCount: Array.isArray(coverage.skipped) ? coverage.skipped.length : 0,
    unresolvedExternalCount: Array.isArray(coverage.unresolvedExternalPaths) ? coverage.unresolvedExternalPaths.length : 0
  };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  let body;
  try { body = await response.json(); } catch { body = { error: await response.text() }; }
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return body;
}

async function postAction(baseUrl, action) {
  const session = await request(baseUrl, '/api/session');
  const token = session.token || session.csrfToken;
  if (!token) throw new Error('service did not return an IntentGraph token');
  return request(baseUrl, '/api/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IntentGraph-Token': token,
      Origin: baseUrl
    },
    body: JSON.stringify(action)
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = argv.filter((arg) => arg !== '--url' && !((argv.indexOf('--url') >= 0) && arg === argv[argv.indexOf('--url') + 1]));
  const baseUrl = getBaseUrl(argv);
  const command = args[0];
  if (!command) { usage(); return 1; }
  if (command === 'query') {
    const term = args.slice(1).join(' ').trim().toLowerCase();
    const verbose = argv.includes('--verbose');
    const index = await request(baseUrl, '/api/index');
    if (!term) { process.stdout.write(`${JSON.stringify({ ...index, coverage: compactCoverage(index.coverage || {}, verbose) })}\n`); return 0; }
    const files = index.files.filter((file) => file.path.toLowerCase().includes(term));
    const nodes = index.nodes.filter((node) => `${node.name} ${node.file}`.toLowerCase().includes(term));
    const edges = index.edges.filter((edge) => `${edge.source} ${edge.target} ${edge.kind} ${edge.provenance}`.toLowerCase().includes(term));
    process.stdout.write(`${JSON.stringify({ revision: index.revision, files, nodes, edges, coverage: compactCoverage(index.coverage || {}, verbose) })}\n`);
    return 0;
  }
  if (command === 'source') {
    const sourcePath = args[1];
    if (!sourcePath) { usage(); return 1; }
    process.stdout.write(`${JSON.stringify(await request(baseUrl, `/api/source?path=${encodeURIComponent(sourcePath)}`))}\n`);
    return 0;
  }
  if (command === 'state') {
    process.stdout.write(`${JSON.stringify(await request(baseUrl, '/api/state'))}\n`);
    return 0;
  }
  if (command === 'action') {
    const serialized = args.slice(1).join(' ');
    if (!serialized) { usage(); return 1; }
    let action;
    try {
      const text = serialized.startsWith('@') ? fs.readFileSync(path.resolve(serialized.slice(1)), 'utf8') : serialized;
      action = JSON.parse(text);
    } catch (error) { process.stderr.write(`Invalid action JSON: ${error.message}\n`); return 1; }
    process.stdout.write(`${JSON.stringify(await postAction(baseUrl, action))}\n`);
    return 0;
  }
  if (command === 'gate') {
    const taskId = args[1];
    if (!taskId) { usage(); return 1; }
    const gate = await request(baseUrl, `/api/gate?taskId=${encodeURIComponent(taskId)}`);
    process.stdout.write(`${JSON.stringify(gate)}\n`);
    return gate.allowed ? 0 : 2;
  }
  if (command === 'service') {
    const rootIndex = argv.indexOf('--root');
    const portIndex = argv.indexOf('--port');
    const root = rootIndex >= 0 ? argv[rootIndex + 1] : path.resolve(__dirname, '..');
    const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : 8768;
    const server = await start({ root, port });
    process.stdout.write(`IntentGraph listening at http://127.0.0.1:${server.address().port}\n`);
    await new Promise(() => {});
    return 0;
  }
  usage();
  return 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.body ? JSON.stringify(error.body) : error.stack || error}\n`);
    process.exitCode = error.status === 409 ? 2 : 1;
  });
}

module.exports = { main, request, postAction };
