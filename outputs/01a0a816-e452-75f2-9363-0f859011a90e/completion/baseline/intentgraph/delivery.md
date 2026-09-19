# IntentGraph delivery gate

`delivery.cjs` is the local build and Git integration boundary for IntentGraph. It is deliberately small: the caller selects a task and a command ID, while the module owns the executable and every argument in a fixed command catalog.

## Library contract

```js
const { DeliveryGate } = require('./delivery.cjs');

const gate = new DeliveryGate({
  root: projectRoot,
  engine: intentGraphEngine,
  runtimeDirectory: path.join(projectRoot, '.intentgraph', 'runtime')
});

const status = await gate.status({ taskId });
const result = await gate.run({ taskId, commandId: 'verify-intentgraph' });
```

The service engine must be for the same real filesystem root as `root`. The setup record under `.intentgraph/runtime/delivery-config.json` binds that root to the catalog hash and records hashes for the delivery runner, every local module transitively loaded or invoked by the pinned backend/trace test command (including the Python adapter entrypoints), and dependency manifests/lockfiles. A changed or malformed setup record blocks delivery. Candidate task files are checked for confinement, regular-file status, IntentGraph indexing, secrets, runtime paths, dependency definitions, and the fixed delivery/service/test runners.

`status()` reports `ready` or `blocked` and includes the service, task gate, catalog, and Git repository checks. A non-Git workspace is explicitly reported as blocked for merge delivery. `run()` can still execute a build check before reviews exist. Its result separates:

- `checksPassed`: whether the fixed process completed successfully;
- `gateAllowed`: the IntentGraph task gate after the check;
- `gatedStatus.build` and `gatedStatus.release`: the actual check and release states;
- `evidence`: the bounded command result saved under `.intentgraph/evidence`.

The module never creates a review, marks a review as passing, or releases a checkpoint. Writing and indexing command evidence can advance the IntentGraph revision, so existing reviews may become stale. After the command exits, the gate rechecks the pinned source/catalog hashes and candidate file hashes before it returns a ready result. A release decision must be evaluated again after checks and fresh evidence are reviewed.

## Fixed commands

The default command is `verify-intentgraph`:

```text
node --test intentgraph/backend.test.cjs intentgraph/trace.test.cjs
```

`check-candidate` and its `syntax-check` alias run `node --check` separately for each `.js`, `.cjs`, or `.mjs` task candidate. They parse source without evaluating it. No command line, shell string, executable, working directory, or environment can be supplied by a task or model. The catalog hash is established on first setup and checked on every status/run call.

Checks run with a credential-free environment allowlist and no shell. Output is capped at 64 KiB, and each process has a two-minute timeout. The captured exit code, signal, timeout/output-limit state, stdout, stderr, command ID, candidate hashes, and catalog hash are written to the evidence artifact. These controls do not claim an operating-system sandbox, network isolation, or protection against a malicious trusted test runner; the fixed runner and candidate restrictions are the boundary implemented here.

## Git hooks

Hook installation is an explicit operation and requires an existing repository path:

```powershell
node intentgraph/delivery.cjs hooks install --repo "C:\path\to\repository"
```

Installation refuses a missing/non-Git repository, a repository whose real root differs from the gate root, or any existing `pre-commit`, `pre-merge-commit`, or `pre-push` hook. Existing hooks are never overwritten. Each new hook invokes the local delivery CLI and gates every active task using the local IntentGraph engine.

Before allowing `pre-commit` or `pre-merge-commit`, the gate requires the task's current service gate to pass and checks the Git staged tree with `git write-tree`. Staged paths must belong to an active task, and every task candidate's staged blob must match the current working file. This catches partial staging and edits made after review. `pre-push` consumes Git's pushed-ref input from stdin, inspects each pushed commit tree and changed path set, and compares it with the current reviewed candidate; missing or malformed ref input fails closed. A task with missing, failed, unverified, or stale reviews remains blocked. Every hook also requires current successful `verify-intentgraph` evidence for the task; checks do not manufacture approval records.

The CLI hook command is also available for diagnostics:

```powershell
node intentgraph/delivery.cjs hook --root "C:\path\to\repository" --hook pre-commit
```

These hooks are convenience gates. Git's `--no-verify` option and manual Git operations can bypass them, so a successful hook is evidence of that invocation rather than an absolute enforcement claim. The current Netrok Muse workspace is not a Git repository; `status` therefore reports the expected non-Git blocked state until an owner explicitly supplies a repository to the hook installer.
