# Clarification and approval flow proposal

19 September 2026. **Historical proposal; the subsequent launch brief authorized all four recommended choices and the clarification-only slice. Current acceptance status belongs to [HANDOVER.md](../../HANDOVER.md#what-we-are-doing-now).** Prepared after the local durable-admission milestone (`eb02372`, `ff9f0f0`, `e373be3`). The archived workflow candidate remains unmounted. The active narrow implementation and current limits are recorded in [clarification evidence](../evidence/clarification-2026-09-19/README.md); the proposal below preserves the original planning context. Approval and mock execution remain excluded.

Recommend one next implementation slice, subject to the decisions below: **answer one structured clarification within an existing serial, read-only chat run**. Retain the original run identity and mode, reject stale answers, preserve a visible waiting state, and support explicit cancellation and recovery. This is the earliest workflow boundary: general action approval depends on reliable waiting and continuation. Include no action approval or executor in that first slice.

The full proposed journey below describes where later review and approval would fit. Those later stages are a roadmap, not part of the recommended slice. Independent review of the admission branch comes first. Native Windows validation remains outstanding and must either be completed or remain explicitly unverified.

## Evidence and reference boundaries

The [central register](../../outputs/01a0a3bc-a376-74e1-8d48-e4029c2cb5a2/Aven-UI-UX-Feature-Register.xlsx) retains the original requirements in column M and adds dated effective verdicts in Q–S. The [all-115 reconciliation](../evidence/admission-2026-09-19/feature-verdicts.json) retains 37 scoped Verified, 57 Partial, 3 Unverified, 14 Missing and 4 Deferred rows. Relevant original requirements are:

| ID and current verdict | Original acceptance requirement | Proposed coverage |
| --- | --- | --- |
| UX-033 — Missing | Answer maps to one pending question; stale cards cannot authorize later work. | Primary first-slice target: explicit question identity, one answer and stale rejection. Approval behavior still requires a later scope. |
| UX-034 — Partial | Plan mode cannot execute state-changing operations; current read-only scope stays explicit. | Regression boundary. Plan remains zero network/diagnostic tools; asking for information must not enable them. |
| UX-037 — Missing | Two runs remain isolated, individually stoppable and recoverable. | Excluded. A serial waiting run is not parallel work. |
| UX-072 — Partial | Proposal shows exact diff and target; edits invalidate prior approval. | Later immutable action review. Existing local file review remains unchanged. |
| UX-073 — Partial | Comment cannot drift to a different result after rerun. | Regression only; no annotation redesign or implied promotion. |
| UX-074 — Missing | Target or command changes require new review; old approval cannot authorize new work. | Later one-time approval bound to the exact action and scope. |
| UX-080 — Missing | Review displays affected devices and rollback limits; chat revert never substitutes for device rollback. | Later network-specific review; no device-write capability is selected here. |
| UX-114 — Missing | Aven preview and executed action share the same digest, scope and one-time approval. | Requires composition with the eventual executor, beyond a standalone mock card. |

UI evidence is narrower than blanket approval of the shell:

- [Chat correction](../../.intentgraph/feedback-chat-polish.md), lines 3–16, records the requested quiet layout, exact raw output shown once, visible failure, hover/focus details and visible touch controls. Preserve those behaviors and the existing v9.1 layout beneath the admission changes.
- [Wireframe feedback](../../.intentgraph/feedback-02.md), lines 3–16, places chat in the center and detail previews on the right. Its in-chat request-card flow is explicitly a proposal, not authorization for operations. [Later shell feedback](../../.intentgraph/feedback-03.md), lines 3–13, is support with requested changes, not final baseline approval.
- [Four-avatar approval](../../.intentgraph/avatar-four-approval.md), lines 3–9, and [expanded-family acceptance](../../.intentgraph/avatar-family.md), lines 48–51, approve that artwork. They do not approve clarification, approval cards or execution integrations. The editable approved SVG baseline is present; the original excluded raster references are unavailable in this checkout.
- [Review discipline](../../.intentgraph/feedback-08.md), lines 3 and 41, requires demonstrated journeys and source hashes, with independent review separate from owner visual acceptance. The archived [video observations](../../.intentgraph/reference-video-01.md) and [Grok Bot observations](../../.intentgraph/reference-grokbot-01.md) provide interaction context, not a newly approved Aven design.

No new screenshot, generated mockup or automated test in this task grants owner UI approval. A future running fixture must be reviewed in the actual Aven shell.

## Complete proposed user journey

### 1. Start or continue a conversation

The user chooses the existing Plan or Inspect mode and sends a normal message. The current saved request identity and receipt admit the run. The mode and provider selection are captured for that run; changing settings while it waits must not silently change its continuation. Existing read-only tools remain confined to Inspect.

Example: “Investigate the switch interface” can lead to “Which switch should I inspect?” when the target is ambiguous. Selecting a target supplies missing information; it does not authorize a configuration change. Missing credentials are directed to the existing connection setup, never requested in a chat answer.

### 2. Ask one question and visibly wait

A validated structured response creates one compact card in the originating conversation. It shows the question, a short reason when useful, offered choices, and a text field only when free text is allowed. No answer is pre-submitted. The card and conversation status say **Waiting for your answer**; a waiting run is neither successful nor failed, and a spinner must not suggest that a provider is still working.

Keep details secondary. Stable IDs, hashes and capability tokens belong in stored evidence or optional technical detail, not the primary user flow. Do not add a new navigation destination or redesign avatars, composer, history or Settings.

Under the recommended serial policy, waiting retains the global slot. Other conversations retain drafts and show which conversation needs an answer, with a link to it. They must not dispatch. Queued follow-ups remain visible and paused; a clarification answer is submitted through its card, never inferred from arbitrary composer text or the next queued item.

### 3. Answer once, cancel, or encounter a stale card

The user selects one choice or enters an allowed answer, then activates **Continue**. The control disables while the response is being accepted. The backend consumes the question's one-time answer capability and durably records the transition before starting a continuation segment. The segment retains the original chat/run/mode/provider selection and gets a new cancellation handle and its own dispatch identity. Double-clicks, another tab, stale cards, transport retries and late replies must not start another segment.

The accepted answer remains in the card as history, and status changes to **Working** only when continuation is admitted. An invalid answer keeps the answer draft and explains the permitted format. An obsolete card says that the question is no longer active and offers a read-only refresh of current state. It cannot answer a newer question or approve an action.

**Cancel request** while waiting ends that waiting workflow without dispatching a continuation. **Stop** during a running segment retains today's uncertainty about work already submitted. Neither action implies that external work was rolled back. Cancellation leaves queued follow-ups paused until explicit Resume; normal terminal completion can retain the existing FIFO behavior.

### 4. Handle interruption and reload honestly

Reading a saved card or receipt has no side effects. After a lost answer response, read authoritative question/segment state: show the accepted answer if it committed, otherwise retain an explicit unresolved state. Never repeat the provider segment merely because the answer response was lost.

For the recommended first slice, reload restores tokenless question history. It offers **Cancel waiting request**, followed by an explicit fresh request, instead of silently resuming a lost in-memory continuation. The label must explain that no answer was sent. A dead owner is reconciled as UNKNOWN using the admission rules; a live owner cannot be taken over by elapsed time. Storage failure leaves an unresolved state and preserves the local answer draft where possible. Native process-liveness checks require Windows validation.

Durable answer-after-restart support is a separate alternative in decision 3. It requires persisted continuation state and cannot be promised merely because a card or receipt survives reload.

### 5. Review a proposed action — later stage

If a later authorized workflow proposes a change, the chat shows **Review proposed change**. Opening it displays the exact target(s), operation, before/after diff or exact action, impact, preconditions, rollback method and limits, plus any unavailable evidence. Use the existing right-hand preview pattern for longer details and retain a compact status in chat. Reviewing is read-only.

The proposal has an immutable revision and scope/action digests. Any edit to target, command, parameters, mode or relevant context creates a new revision and invalidates prior approval. A read-only Inspect choice never implies a state-changing permission. A chat revert changes conversation history only; it must not appear as device rollback.

For a mock demonstration, label the entire card and final receipt **Simulation — no device changes**. It may demonstrate the contract, but cannot complete UX-114's actual adapter-composition requirement or establish real rollback.

### 6. Decide on that exact action — later stage

After review, the proposed primary action is **Approve and run this action**, alongside **Decline** and **Cancel request**. A mock demonstrator uses **Run simulation** instead. One explicit click may perform the approval and dispatch protocol; simply opening the preview, changing focus or rendering a saved card never approves or executes.

The backend binds the decision to chat, run, proposal revision, scope/action digests, mode, expiry and the authorized actor when an identity policy exists. It consumes the decision capability and issues a distinct one-time execution capability. Dispatch revalidates current scope and consumes that capability before crossing the executor boundary. Decline/cancel consumes the pending decision without execution. An approval is not transferable to another device, action, run or later revision.

No real actor authentication exists in the local chat origin check. Selecting an authenticated approver and authorization policy is a prerequisite for any customer or live-action claim. The mock path must remain explicitly local and synthetic.

### 7. Show the result and retain the receipt — later stage

Show exactly one outcome and its exact evidence: completed, failed, declined, canceled before dispatch, or UNKNOWN after uncertain submission. The receipt binds what was reviewed to what was attempted and identifies the executor. A successful simulated result remains simulated.

A timeout, Stop, process exit or lost response after dispatch must never automatically replay the action. Retain the consumed capability and the UNKNOWN receipt, offer read-only reconciliation, and require a new explicit review for a genuinely new action. A follow-up clarification can ask about next steps, but cannot manufacture approval for that new action.

## Integration dependencies and candidate provenance

The [workflow candidate](../../outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/workflows/README.md) is useful design and test material. On 19 September all **14** paths in its [candidate SHA manifest](../../outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/workflows/sourcehashes.json) matched their recorded SHA-256. Its recorded adapter, execution-service and runtime source hashes still match active files; its server source hash does **not** match after admission integration. This hash comparison was fresh; historical workflow test claims were not rerun or promoted during proposal preparation.

Representative frozen hashes:

| Candidate file | SHA-256 |
| --- | --- |
| `approval-workflow.cjs` | `f75eddd2665a84b0e37e678bea740444056ff75a8317c24236e025d7d7b3649d` |
| `clarification-runtime.cjs` | `ceef4ba90270eeda9af8336c926622ca485af7d5276c5727f7ac97801e4fa0ef` |
| `clarification-server-adapter.cjs` | `f0abdc98d22cee2504a2f7d47fc0963b2706ab66dd636bc17b6029652c7e162c` |
| `polished-approval-workflow.js` | `88f05b07fc4738b04d805fabd184caaa153b60cd602fc6bb3de6b9ad40d2868e` |

The candidate models nonterminal `waiting-question`, same-run continuation, one-time tokens, immutable review receipts, revision CAS and restart invalidation. It accepts only an explicitly marked mock executor. Its [row results](../../outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/workflows/row-results.json) explicitly leave existing execution-service/adapters uncomposed. The 24 archived replacement hunks must not be applied wholesale to today's server or browser.

Four boundaries need deliberate implementation after the decisions are recorded:

1. **Waiting versus terminal admission.** Current [server](../../intentgraph/server.cjs), lines 298–332, always closes and settles after `respond()` returns. Current [receipt service](../../intentgraph/reliability.cjs), lines 81–105, knows admitted/settled/unknown, not a durable pending question. A structured question must not pass through terminal `replyOutcome()` or release the global slot. Under the recommended policy keep the admitted receipt and record a durable workflow phase beneath it. Do not treat idle waiting as orphaned ownership in `recover()`.
2. **Atomic continuation.** Persist question identity, accepted answer, segment identity and ownership with the admission transition, or define an equivalent tested atomic protocol. Two independent SQLite stores with separate commits are not automatically atomic. Start with one authoritative transaction boundary where feasible. A crash after accepting an answer but before dispatch stays explicitly unresolved; no automatic replay. Transport retries need an idempotent decision receipt so consuming a capability does not lose proof of an already accepted answer.
3. **Mode and structured output.** Current [runtime](../../intentgraph/agent-runtime.cjs), lines 210–216 and 357–407, makes Plan zero-tools. Prefer a validated, bounded content envelope for a Plan clarification, or an explicitly separated control-only mechanism that cannot expose network tools. Reject malformed envelopes and oversized/unsafe fields. Clarification must work with injected model fixtures before any provider use is considered. Preserve provider selection/provenance without copying credentials or opaque control tokens into persisted history.
4. **One approval owner and executor binding.** Current [adapter approval code](../../intentgraph/adapters/index.cjs), lines 462–503 and 570–598, handles browser/desktop preview and one-time execution; it is not a general network-write engine. [Execution service](../../intentgraph/execution-service.cjs), lines 25–28, exposes a fixed operation set. A later approval integration must make the Aven preview and adapter action use one authoritative scope/digest contract; two unrelated approval stores or a decorative UI receipt do not meet UX-114. There is no network configuration execution path selected here.

## Intended files for the recommended first slice

This is a reviewable scope, not permission to edit them now:

| Files | Intended change |
| --- | --- |
| `intentgraph/reliability-storage.cjs`, `reliability.cjs` | Versioned durable question/segment transition and ownership invariants; migration and recovery rules without losing existing receipts. |
| `intentgraph/server.cjs`, `chat-read-api.cjs` | Nonterminal waiting, scoped answer/cancel/readback routes behind the existing origin/header guards, same-run segment handling. |
| `intentgraph/agent-runtime.cjs`; new narrow `clarification-runtime.cjs` and `clarification-workflow.cjs` if useful | Bounded structured question contract and continuation bridge. Adapt audited candidate contracts; do not import the approval executor surface. |
| `polished-admission.js`, `polished-run-state.js`, `polished.js`, `polished.html`; a small question renderer if needed | Tokenless persisted question history, explicit card actions, terminal reconciliation, waiting/queue state and focus behavior. |
| `polished.css` | Only styles needed for compact cards, focus and narrow layouts; preserve existing shell and controls. |
| `polished-backup.js` | Preserve inert history; copied/imported chats cannot inherit answer capabilities or pending ownership. |
| `intentgraph/fixtures/admission-ui.cjs` and focused workflow/API/browser tests | Deterministic, local-only question and continuation fixtures with dispatch counters. |
| `intentgraph/README.md`, `HANDOVER.md`, handover/architecture docs, central register and dated evidence | Document actual delivered scope, limits, fresh hashes and row-specific verdicts. Regenerate HLD after architectural changes. |

No change to provider onboarding, model selection, adapters, device command catalog or original candidate archives is expected for that first slice. If integration proves to require them, reduce scope or return a concrete revised plan before expanding it.

## Acceptance and verification plan

The first slice is acceptable only if all of these are demonstrated on active source:

1. One ordinary chat request produces one bounded question in the correct conversation. Its receipt remains nonterminal, mode is retained, and waiting is visibly distinct from completion and active execution.
2. Exactly one valid answer maps to that question and starts at most one continuation segment in the same run. Another run/chat, newer question, stale revision, repeated answer, changed answer body, double-click or other tab cannot authorize work. Repeated accepted submissions return their existing decision receipt.
3. A saved answer is not reclassified as a normal queued message. Waiting preserves queued text and unrelated drafts. Other conversations accurately show the serial limit. Cancel/UNKNOWN pauses the queue; Resume remains explicit where required.
4. Stop, cancel, closed transport, browser save failure, database commit failure and backend exit have explicit outcomes. Reload matches the chosen policy, never silently resumes, never steals live ownership and never clears another tab's pending journal. Imported history is inert.
5. Plan cannot invoke network/device/diagnostic tools, even with malicious tool-bearing output or answers. Inspect retains its existing allowlist. No question answer implies state-changing permission. History, HTML rendering and backups contain no usable control capability or secret.
6. Existing raw output remains exact and rendered once; long code stays collapsed; existing annotations and reviewed local file edits keep their identity. Current admission tests remain green, including paused-owner schedules across processes.

Focused tests should cover the answer/cancel race, two service processes and tabs answering once, a stale owner resuming after another transition, unknown commit outcomes, a crash on each side of answer-commit/dispatch/evidence/settlement, repeated readback, copied chat/import/reload, malformed structured output, and Plan no-tools enforcement. Use the actual local router with injected responders and exact dispatch counts. Supplement pure state tests with response-loss and process-death tests; snapshots alone cannot prove at-most-once continuation.

Run the applicable full non-networked Node suite and syntax checks after focused tests pass. Keep environment-related skips explicit. Verify SQLite migrations against an existing receipt database copy, missing/corrupt stores and rollback failures; preserve original retained receipts. Native Windows startup, SQLite locking/process-liveness and restart must be tested on Windows or remain unverified.

Visual verification must use chrome-devtools-axi against the running fixture: desktop and 390px width, keyboard-only choice/text/Continue/cancel, touch-visible actions, focus after validation/continuation/cancel, a long question, long choices, denied/stale/unknown states, another conversation, queued follow-ups, reload and reduced motion. Inspect the whole conversation with raw evidence and code blocks. Record served-source hashes, console results and screenshots. Independent technical review and explicit owner review of those new cards are separate requirements; automation satisfies neither by itself.

For a **later approval** stage, add immutable preview/revision tests; changed-target/command/mode invalidation; expired, duplicate, denied and canceled decisions; a crash before/after capability consumption; executor-scope mismatch; no execution on render/review/reload; UNKNOWN without retry; and exact preview-to-executor digest comparison. Mock tests alone must leave real adapter/network acceptance unverified.

When updating the register, retain original requirements and historical evidence. Append dated effective verdicts and explicit gaps for UX-033 and relevant regressions. A clarification-only result does not automatically complete the combined clarification/approval row, and does not promote UX-074, UX-080, UX-114 or UX-037. The architecture record must distinguish waiting, approval, execution and checkpoint capabilities as planned, implemented or verified.

## Open product decisions

These choices gate future implementation, not the completed admission milestone. Recommendations below are proposals and must not be recorded as owner answers. Keep the decisions together as one review of this document.

| Decision | Recommended option | Alternative and consequence |
| --- | --- | --- |
| 1. Scope of the next slice | Clarification only in the current read-only runtime; approval remains a later design. | Include a clearly labeled mock review/approval demonstrator as well, expanding implementation and visual review; or defer workflow work. No option authorizes live actions. |
| 2. Capacity while waiting | Retain the global serial slot until answer/cancel/recovery; show the waiting conversation. | Allow other chats to run while one waits. That requires a scheduler, isolated ownership and resumable capacity admission, and becomes a different milestone. |
| 3. Reload behavior | Retain question history, then explicitly cancel the lost wait and start a fresh request; never auto-resume. | Answer the original question after restart. That requires durable continuation/checkpoint design and further ownership/replay tests. |
| 4. First eventual approval target | Keep any initial approval demonstration mock-only, with no real executor. | Select one existing browser/desktop action for a separately authorized integration, or define a future network-write operation. Either real option first needs exact action scope, environment, authenticated approver policy, expiry/review rules and rollback/UNKNOWN handling. |

Do not infer approval of these choices from approval of the admission branch. After the owner chooses, rewrite the bounded implementation brief around the chosen first slice and its acceptance tests before work begins.

## Explicit exclusions

No proposal implementation in this task. No network-device writes, browser/desktop control, live providers, credentials, deployment, publication, push, merge or Git UI actions. No scheduler or parallel runs, provider replacement, model/effort picker, autonomous approval, inferred approval from chat, bulk candidate overlay, generalized resumable tools, LangGraph checkpoint rollout, customer/tenant identity, cross-device history, scheduled investigations, or broad UI redesign. Existing read-only boundaries and historical archives remain intact. Future approval of a diagram or mock does not authorize any of these capabilities.
