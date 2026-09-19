# IntentGraph local runtime

Start from the project directory with `./Start-IntentGraph.ps1`, then open http://127.0.0.1:8768/.
Requires Node 20+ and TypeScript; run `npm install --prefix intentgraph` on a fresh machine. This workspace already resolves TypeScript locally.

## What is implemented

- A searchable file/symbol index with source locations and parser-derived dependencies. The graph is another view of that index. Coverage lists unresolved paths; it is not a complete semantic model of every language.
- Local file watching, persisted latest before/after text, and real file-change events. An unattributed edit remains unattributed.
- Team registrations, assigned tasks, bidirectional feedback and reported activity. Registration does not launch an agent or verify its identity.
- Versioned intent baselines with reference hashes, evidence records, three review roles, and a serialized checkpoint release gate. Missing, failed, unverified or stale reviews block release. Implementation changes require fresh evidence; changed reference artifacts require a new baseline.
- Optional instrumented Node spans with async parent relationships. Blue pulses represent reported spans; amber pulses represent file changes. Static graph edges never prove that code ran.

## Agent access

From this project:

```powershell
node intentgraph/cli.cjs query renderProfile
node intentgraph/cli.cjs source polished.js
node intentgraph/cli.cjs state
node intentgraph/cli.cjs action '@path-to-action.json'
node intentgraph/cli.cjs gate TASK_ID
```

Action JSON uses the same `/api/action` contract as the UI. The CLI obtains the local request token. Useful actions: `agent.register`, `baseline.create`, `task.create`, `task.state`, `message`, `evidence.add`, `review.add`, `checkpoint.release`. Gate exits 0 only when allowed, otherwise 2. Do not manufacture pass records to advance a task. Owner baseline approval is an explicit separate UI action.

For another project, run `node intentgraph/server.cjs --root "C:/path/to/project" --port 8769` and pass `--url http://127.0.0.1:8769` to CLI commands. State stays inside that project's `.intentgraph/runtime`. Back up that folder to retain runtime history. The app-return link in this preview points to Aven on port 8767.

## Optional execution tracing

```javascript
const { createTracer } = require('./intentgraph/trace.cjs');
const tracer = createTracer({ taskId: 'registered-task', actorId: 'registered-actor' });
await tracer.withSpan({ file: 'src/main.js', symbol: 'loadData', line: 12 }, async () => {
  return loadData();
});
```

Only instrumented functions report spans. Arguments, results and error text are not sent. Tracing preserves the original return value/error if the local service is unavailable, but requests can add latency. This is not a line debugger or automatic application-wide tracing.

## Enforcement boundary

The service enforces its own release action and the CLI provides a nonzero gate exit for integration into a delivery command. It cannot prevent direct filesystem edits, manual Git commands, forged local reporting identities or a reviewer making a poor judgment. No Git hooks are installed in this non-Git workspace. No persistent autonomous agent scheduler is running. AI providers, browser/computer execution and network device execution remain disconnected until explicitly configured.

## Checks

```powershell
npm --prefix intentgraph run check
node --test intentgraph/backend.test.cjs intentgraph/trace.test.cjs
```

Test fixture approvals are isolated from project state. They establish mechanical behavior, not owner acceptance of this interface.
