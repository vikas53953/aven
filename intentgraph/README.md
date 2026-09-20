# IntentGraph local runtime

Start from the project directory with `./Start-IntentGraph.ps1`, then open http://127.0.0.1:8768/.
Requires Node **24.16 or newer** (built-in `node:sqlite`) and TypeScript; run `npm ci --prefix intentgraph` on a fresh machine. The service and PowerShell launcher check the Node prerequisite before dispatch. See [verification history](../docs/handover/VERIFICATION.md) for dated native Windows startup and SQLite checks and their limits.

## Durable chat admission

The root browser requires Web Locks for admission writes on its loopback secure context. A lock protects the complete active capture and explicit receipt reconciliation across tabs; no elapsed timer steals ownership. Reloaded pending conversations can reconcile independently while unrelated capture and queues remain unchanged. Successful saved-request retry updates its original result message, retaining annotations and raw evidence. See [review corrections](../docs/evidence/admission-2026-09-19/review-fixes/README.md).

After reload, unrelated draft and conversation-selection saves acquire the same lock, preserve pending capture fields and reject stale workspace snapshots. Same-tab saves are serialized through lock release. While a foreign tab holds the writer lock, these edits remain only in the editing tab with a warning; copy the draft before reloading. Both Add and Replace restore acquire the admission lock and compare fresh saved workspace state before committing; live writers and stale snapshots block import. Focused evidence is indexed in [verification history](../docs/handover/VERIFICATION.md).

`POST /api/chat` accepts `requestId` and `idempotencyKey` together (1–100 ASCII letters, digits, hyphens or underscores). Reuse both only for the same logical submission and identical chat, coworker name, mode, message context and explicit provider selection (when supplied). A deliberate new turn needs new identity even when its text matches. Requests without both fields remain supported for legacy clients, with **no replay protection across identity-free submissions**.

`POST /api/chat` also accepts optional `selection: {providerId, modelId, effort}`. All three values must be canonical nonempty strings; extra fields are rejected. `GET /api/capabilities` advertises OpenCode, OpenRouter, Anthropic and OpenAI, with model availability and supported efforts; providers without executable adapters remain unavailable. Configured-local status is connection-unverified. Unsupported selections fail before admission, key access or model invocation. Omitting selection preserves the legacy fingerprint and resolves the existing OpenCode / MiMo V2.5 / `none` default for dispatch. An explicit tuple becomes part of the fingerprint; changing it under the same identity conflicts. Retries retain their saved request without model substitution, and the single clarification retains the admitted selection and private runtime context.

Responses keep `requestedSelection` separate from `provenance.effective` provider-reported metadata. Missing reported fields remain null; `provenance.match` is null unless all three reported fields are present. A request choice alone never proves which model answered. Picker usage belongs to the [application guide](../README.md#run-the-current-application).

The local SQLite receipt commits before responder invocation. One global admitted receipt keeps chats serial across service processes sharing the runtime directory. An exact duplicate returns JSON `{duplicate:true, receipt}` without streaming or invoking the responder; reuse with changed content returns 409. There is no expiring lease or automatic takeover of a paused owner. Receipts are retained; deleting them loses replay protection.

`GET /api/chat/receipt?chatId=…&requestId=…` returns scoped, sanitized admission state, outcome, run ID, evidence availability and whether explicit recovery is possible. It never mutates ownership. `POST /api/chat/recover` with the exact `chatId`, `requestId` and `runId` releases a stranded serial slot as UNKNOWN only after the original process is confirmed gone (or this service has stopped handling the run). It never dispatches the original request. A live/inaccessible/reused PID is conservatively treated as owned; elapsed time is insufficient. Both routes retain the existing loopback origin and `X-Aven-Chat: text-only` controls, which are not customer authentication.

Evidence is flushed before terminal receipt settlement and final delivery. Storage errors fail closed before admission; completion-save errors remain visible and retain an unresolved receipt. A run evidence file alone does not establish settled admission. Cancellation and owner-loss recovery retain UNKNOWN rather than claiming remote work stopped. This receipt database is **not** a LangGraph checkpoint or resumable tool execution.

Back up `.intentgraph/runtime/chat-admission.sqlite` and `chat-admission.initialized` together while the service is stopped, plus `.intentgraph/evidence/runs` if run readback is required. A missing database with an existing initialization marker prevents startup; replacing/removing an open store prevents new admission. Do not delete the marker to bypass recovery. For dated validation scope and acceptance limits, see [verification history](../docs/handover/VERIFICATION.md).

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

## Bounded clarification (local milestone, 19 September 2026)

An initial Plan or Inspect response may return a single validated JSON content envelope with `type: "clarification"` and `question: {prompt, reason?, choices: [{id,label}], allowFreeText}`. Limits: prompt/reason 500 characters, 2–4 distinct choices (or zero with free text), labels 200, IDs 40, free-text answer 2,000. Unrecognized fields and malformed envelopes fail closed. No clarification tool is registered. Plan binds zero tools; Inspect retains the existing read-only allowlist. An answer supplies scope only.

`GET /api/chat/question?chatId=…&requestId=…&runId=…` reads tokenless state. `POST /api/chat/question/answer` requires those identities plus `questionId`, immutable `revision`, the memory-only `answerToken`, and exactly one `{choiceId}` or `{text}` answer. `POST /api/chat/question/cancel` requires the same scope without answer/token; it can cancel only a waiting question. Existing loopback origin and `X-Aven-Chat: text-only` guards apply. These are local capability controls, not authenticated human identity.

The question and accepted answer/segment are committed in the existing receipt SQLite database. SQLite `user_version=2` adds the clarification table without changing version-one receipt identities. The answer transaction consumes the decision before a separately fenced dispatch; a crash between them leaves unresolved accepted state and never replays. Exact duplicate answers return the existing decision. A continuation retains the original mode and model instance, bounded model/tool conversation (96 messages and 256 KiB; larger context fails closed), cumulative evidence, the shared six-call tool budget and attempted-diagnostic set in server-owned memory. An UNKNOWN diagnostic cannot be retried merely after answering. A new controller/segment identity is used, and a second question is rejected. None of this state is a durable restart checkpoint. Waiting holds the global admitted row and browser writer lock. Time cannot transfer live ownership. Dead-owner recovery records UNKNOWN.

Every choice/text edit saves a bounded unsubmitted draft, including edits following a rejected submission. Storage failure retains the draft only in page memory and blocks dispatch until a successful save. Refresh updates the card live status and restores keyboard focus to that question’s Refresh button. Reload loses answer capability and continuation custody, while displaying any saved draft inertly. Readback is inert; explicit cancellation and a fresh request are required. Backup/import keeps inert question history, never pending ownership or capabilities. Queues remain paused after cancellation/uncertainty until explicit Resume. Existing receipts, recovery, evidence, code folding and v9.1 shell remain in place. Clarification does not add approval, execution, parallel runs, scheduling or resumable checkpoints. The provider-selection contract is documented under [durable chat admission](#durable-chat-admission).

Run `node --test --test-concurrency=1 intentgraph/*.test.cjs` and `npm run check --prefix intentgraph`. Mounted browser checks require an isolated `AVEN_BROWSER_TOOL` pointing to chrome-devtools-axi; see [dated fixture instructions](../docs/evidence/clarification-2026-09-19/README.md). Dated platform checks belong to [verification history](../docs/handover/VERIFICATION.md); current acceptance status belongs to [HANDOVER.md](../HANDOVER.md#what-we-are-doing-now). Evidence can still exist without a settled receipt, so read-model completion is not proof of successful admission settlement.
