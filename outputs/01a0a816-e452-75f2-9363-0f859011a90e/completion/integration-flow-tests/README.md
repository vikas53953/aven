# Integration flow fixture

Run from this directory with the bundled Node runtime:

```powershell
$env:AVEN_PRODUCT_ROOT = 'C:\path\to\assembled-candidate'
& 'C:\Users\vikasmit\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\integration-flow-tests.cjs
```

If `AVEN_PRODUCT_ROOT` is omitted, the harness uses `..\assembled-candidate`. It records `results.json`; an unavailable or incomplete overlay records `blockers.json` and exits `2`. A runnable overlay exits `0` only when all scoped IDs pass and exits `1` when a concrete acceptance check fails. The harness owns UX025, UX030, UX031, UX033, UX040, UX101 and UX109.

The fixture starts the candidate's exported `createServer` on an ephemeral loopback port with `allowConcurrentRuns: true`, creates a temporary server root and workflow store, injects a deterministic provider, adapter set, and sandbox, and guards `fetch` and vault access. It drives workflow start/answer/recovery/stop plus streaming chat, steering, duplicate request, queue ordering, independent chat concurrency with same-chat rejection, explicit edit/resend with preserved evidence and command-call counts, and local-note request exclusion. It also runs the candidate's exported workspace backup contract through validation, serialization, replacement and parse-on-reload to compare chats, drafts, queues, avatars, revert history, notes and new preference fields exactly. No candidate or user browser files are edited.

See `expected-assertions.json` for the UX ID map and check limits. `AVEN_PRODUCT_ROOT` should point to the final assembled overlay before interpreting any result as acceptance evidence.
