# Aven · Network harness — High-level design

HLD 26 · Updated 2026-09-20

## Purpose

A working local prototype, not yet a multi-customer service. Explore the actual call path, proposed production boundaries, and how user intent becomes an evidence-based investigation.

This is a maintained design snapshot, not a live health report. The first framework runtime slice is implemented locally; later production layers remain planned.

## Interactive infographic

[Open architecture atlas](http://127.0.0.1:8767/docs/architecture/)

## Target flow

User ↔ Frontend ↔ Backend API ↔ LangChain agent (on LangGraph)

- Agent ↔ LLM: reasoning and structured tool requests.
- Agent ↔ Network tools ↔ Catalyst Center ↔ Device: actual execution and output.
- LangGraph ↔ Checkpoint store: planned persistence branch.
- Runtime → Frontend: NDJSON tool activity, evidence and final answer.

The LLM does not directly access devices or storage. LangChain is inside the backend, not after Command Runner.

## Layers and current status

### 01. Frontend — built

Displays conversations, avatars, results, timestamps and copy controls. Sends your message to the backend.

Current: Plain HTML, CSS and browser JavaScript on localhost:8767; UI build ux-minimal-ui-v9.4-clarification. The local workspace now includes validated text attachments, Ideas and Goals, a derived activity feed, raw-evidence artifacts, exact-evidence annotations and run comparison. Browser run journals preserve bounded evidence through interruption; uncertain completion is UNKNOWN and queues remain paused until explicit resume. The composer plus menu offers Agent and Plan; Agent maps to the existing inspect backend mode and its read-only allowlist, while Plan binds zero tools. Local file access is session-scoped to a user-selected folder, with before/after review, conflict checks and verified writes; network configuration approval is separate and pending. Backup/restore includes workspace notes and annotations with rollback. The independent 115-row audit separates scoped verification, partial capability, missing work and unverified behavior. Four confirmed defects are repaired in this build: recoverable coworker creation, truthful About connection status, mirrored artifact deduplication and direct-conversation header identity. The post-fix workbook retains prior verdicts and evidence; tests are distinct from owner acceptance. Browser/computer panes truthfully report unavailable sessions. Cross-device history, accounts/customer isolation and remote handoff are deferred by user choice. Conversation evidence, investigation and run details are off by default and independently enabled in Settings. Raw artifact and CLI bodies start collapsed. The context ring beside Send reports the bounded local request window without inventing provider token usage. History fixes retain legacy pins and failed-save rollback; the reaction picker supports search and contained keyboard navigation. These UI changes are integrated in v9.1; the broader provider, approval, automation, terminal and Git candidates remain unintegrated; the bounded admission and clarification slices are composed. Long generated code blocks start collapsed while surrounding explanation stays visible; opening a block reveals the retained source without alteration. Each submitted turn saves stable identity and exact bounded outgoing context. Explicit receipt review reconciles interruption without redispatch; UNKNOWN pauses queued work. A second tab cannot clear an owned admission on reload. Dated platform checks and their limits belong to docs/handover/VERIFICATION.md. Current acceptance status belongs to HANDOVER.md. Independent-review corrections allow each reloaded pending conversation to reconcile while unrelated captures remain unchanged. A Web Lock protects live browser writers; stale workspace snapshots still fail. Saved-request retry updates the original result identity and retains annotations and raw capture. One compact structured clarification can pause an existing Plan or Inspect request. Waiting retains the serial slot and browser writer lock. Choices/free text supply information, never action permission. Accepted answers remain in history; README.md owns the answered-row disclosure usage guide. Reload retains tokenless history and requires explicit cancellation plus a fresh request; imported/copied question history is inert. Queued work pauses after cancellation or uncertainty. See docs/evidence/clarification-2026-09-19/ for dated checks; independent review and owner visual approval remain separate. Review corrections F2/F3 save bounded unsubmitted answer drafts on every choice/text edit, including after rejection, and restore Refresh focus with an updated live status. Reload shows drafts inertly and restores no answer authority; failed browser storage blocks submission. Review fixes allow unrelated draft/navigation saves after pending-request reload while retaining capture ownership and strict stale-workspace checks. Add and Replace import commits now use the admission Web Lock and compare fresh storage before writing. T1 correction fences unrelated pending-request draft/navigation saves with the same Web Lock. Foreign live-tab edits stay in memory with a warning; abandoned pending saves retain capture checks and stale-workspace rejection. Same-tab unrelated saves are serialized through lock release so reloaded waiting-question navigation and rapid draft edits do not generate false foreign-writer warnings; cross-tab exclusion and strict stale checks remain in force. A composer model control opens a capability-driven provider/model/effort picker for the current conversation. Saved retries retain their original selection; active or queued work locks changes. Configured-local status never claims provider connectivity.

Code / location: polished.html, polished.js, polished.css, polished-backup.js, polished-run-state.js, polished-attachments.js, polished-workspace-tools.js/css, polished-evidence-tools.js/css, polished-files.js/css, polished-diagnostics.js, polished-admission.js, polished-clarification.js, polished-provider-picker.js

Concept: A screen is not an agent. It presents the work and your controls.

### 02. Backend API — built

Accepts chat requests, validates the payload and calls the runtime. Returns the answer to the browser.

Current: Node.js 24.16+ CommonJS and node:http. POST /api/chat validates mode, bounded text and optional paired request identity. SQLite commits the full admission transition before dispatch and enforces one global admitted chat across processes sharing the store. Exact replay returns the same receipt without responder work; changed content conflicts. Chat-scoped receipt/readback and explicit recovery preserve UNKNOWN and never resume tools. Legacy identity-free clients remain accepted without cross-request replay guarantees. Optional strict provider/model/effort selection is validated before dispatch and bound into explicit-request fingerprints. Legacy requests retain their original no-selection fingerprint. Capabilities retain ai/runtime/execution fields and mark providers without executable adapters unavailable; all four known providers remain visible. A small loopback health endpoint supports Windows launcher readiness; status does not establish reachability. Clarification question, accepted answer and unique continuation segment share the receipt SQLite transaction boundary (workflow schema user_version 2; original admission schema remains version 1). Scoped question read, answer and cancel routes retain existing origin/header guards. A capability hash binds one bounded answer to an immutable question revision; exact repeats return the existing decision and never dispatch. Original mode/provider and context stay in memory for one continuation with a new controller. Accepted-before-dispatch interruption stays UNKNOWN, without replay. Waiting is nonterminal and cannot be recovered merely because time passed. Provider fixtures use direct capability/model/key injection; no parallel providerRuntime or fetch interface is exposed. Chat accepts no client context counters; private runtimeContext remains server-owned across clarification.

Code / location: intentgraph/server.cjs, intentgraph/chat-read-api.cjs, intentgraph/reliability.cjs, intentgraph/reliability-storage.cjs, intentgraph/clarification-workflow.cjs, intentgraph/provider-selection.cjs

Concept: The API delivers the request; it does not decide which network checks are useful.

### 03. Agent runtime — partial

LangChain createAgent coordinates model calls and typed tools. LangGraph manages the in-memory execution loop.

Current: Installed and connected to chat: LangChain 1.5.11, LangGraph 1.4.15 and the OpenCode adapter. Natural-language tool selection replaces the previous exact-command parser. Durable checkpoints are not configured. Plan mode uses an empty tool array and does not require a sandbox. Browser journal recovery is not backend execution resumption. A bounded JSON content envelope can ask one question without adding a tool. Plan remains zero-tools; hostile Plan tool output fails closed. Inspect keeps its existing read-only tools. A continuation cannot ask another structured question or authorize writes. Provider/model selection is chosen for new requests, then frozen across clarification continuation. Requested selection is separate from provider-reported metadata; missing metadata remains unavailable. Independent-review correction F1 retains one server-owned in-memory model instance, bounded model/tool messages (96 messages, 256 KiB), cumulative evidence, a shared six-call budget and the attempted-diagnostic set across the single continuation. UNKNOWN diagnostics cannot be retried after clarification. Oversized context fails closed; no restart checkpoint is added.

Code / location: intentgraph/agent-runtime.cjs

Concept: The API, agent runtime and tools are modules inside the backend application, not nested servers. The LLM is hosted externally.

### 04. LLM / reasoning — built

The model understands questions and interprets results. In the target design it requests tool calls; the runtime executes them.

Current: OpenCode Go / MiMo V2.5 through LangChain ChatOpenAI with the provider session header. Model requests tools and interprets returned evidence. The default remains unchanged. Explicit selection can use an advertised configured adapter. Non-OpenCode adapters require host injection; this slice adds no production adapter or credential onboarding. Locally configured selections are allowed with connection unverified, so UX-027 remains Partial.

Code / location: intentgraph/agent-runtime.cjs; provider.cjs remains used by other workflows. intentgraph/provider-selection.cjs; polished-provider-picker.js.

Concept: The LLM proposes actions; it has no direct switch connection.

### 05. Network tools — partial

Inventory identifies devices. Command Runner submits a CLI request, follows task progress and retrieves actual output.

Current: Chat uses network-execution.cjs to route Catalyst devices to Command Runner and configured SSH profiles to a Python Nornir task with Netmiko. No SSH profiles are configured yet; live SSH is not verified.

Code / location: intentgraph/network-execution.cjs → adapters/index.cjs → adapters/network.py; Catalyst path → catalyst.cjs

Concept: A tool wraps a real operation. Cisco Command Runner supports read-only CLI; it is not an unrestricted SSH shell.

### 06. Cisco sandbox — built

Catalyst Center reaches the managed devices, executes the request and returns results to our connector.

Current: Live sw1 command output verified on 13 September. Reachability is a dated observation, not a continuous health signal.

Code / location: sandboxdnac.cisco.com · sw1 and inventory devices

Concept: An inventory IP does not prove your PC can SSH directly to that device.

### 07. Persistence — partial

A checkpoint store will save execution progress; conversation storage will retain sessions. Long-term memory is a separate design choice.

Current: Browser localStorage retains conversations and exact submitted request snapshots. A local SQLite receipt store commits identity, fingerprint, run ID and ownership before dispatch; a unique admitted row preserves serial execution. Stale owners cannot publish a second claim. Explicit recovery requires proof that the owner is gone, or no longer active in this service, and records UNKNOWN without replay. Evidence is flushed before settlement; failed persistence remains unresolved. This does not add LangGraph checkpoints, resumable external operations, tenant storage or cross-device transactions. Production/checkpoint database choice remains open. Browser admission writes require Web Locks; the browser lock spans active capture and explicit reconciliation, separate from SQLite authority. Unrelated pending captures are preserved during a scoped save. Clarification records use the same local receipt database. History is durable; provider continuation state and answer capabilities are not restored after restart. Existing receipts and idempotency identities survive migration.

Code / location: intentgraph/reliability-storage.cjs, intentgraph/reliability.cjs, polished-admission.js; .intentgraph/runtime/chat-admission.sqlite and initialization marker; .intentgraph/evidence/runs

Concept: A database is a supporting branch, not the final step of every answer.

### 08. Activity & evidence — partial

Streams tool start, result, error and final answer events to chat.

Current: Tool activity, Stop, queued follow-ups, steering acknowledgements and applied/pending states. Raw non-inventory CLI output is displayed in a terminal block with copy, preserving whitespace; the model explanation is separate. Artifacts reconciles matching event/evidence representations conservatively, preserving distinct diagnostic results and exact raw output; a full generated-file library remains partial. Final delivery follows evidence persistence and receipt settlement. Receipt-save failure remains UNKNOWN and blocks further admission until explicit safe recovery. Receipt state is distinct from raw evidence availability.

Code / location: polished.js + .intentgraph/evidence

Concept: An animated teaching diagram is not a live execution trace.

### 09. Team & code graph — planned

Connect intent, work items, agents, code changes and acceptance evidence through indexed relationships and visual views.

Current: Local IntentGraph index/dashboard exists separately. End-to-end connection to this conversational runtime is not demonstrated.

Code / location: intentgraph/ · separate dashboard on port 8768

Concept: The code dependency graph, agent-team view and LangGraph execution graph describe different things.

## Decisions and outstanding work

- **Implemented:** LangChain createAgent on LangGraph with OpenCode and typed Catalyst tools; existing UI retained. Local durable request admission and explicit UNKNOWN recovery are implemented separately from checkpoints. One structured clarification and one same-run read-only continuation are integrated; approval remains unimplemented. A bounded conversation provider/model/effort picker is implemented; production provider onboarding is not.
- **Next checkpoint:** Complete independent provider-picker delivery review, then owner review of the running picker. Native Windows startup, reuse, restart and offline chat behavior have scoped evidence; packaged application and live-adapter acceptance remain outstanding. Mock-only approval is a future direction, not implemented functionality.
- **Still open:** SSH lab access, checkpoint database, customer permissions, long-term memory and tenant deployment.
- **Verification:** Read docs/handover/VERIFICATION.md for dated checks and exact scope. The provider-picker record includes native Windows and running offline-browser evidence. Automated mounted tests, independent review, owner visual acceptance, packaged-app behavior and live provider/device reachability remain distinct.

## Target walkthrough

1. You ask: “Investigate sw1’s interfaces.” The frontend sends your ordinary-language request.
2. The backend records admission before starting a run. Stable identity admits one responder call; replay returns the existing receipt. The global serial limit remains.
3. The runtime coordinates the investigation. LangChain supplies the agent loop; LangGraph underpins execution.
4. The LLM chooses a useful check. It requests a tool with structured inputs, rather than inventing device facts.
5. A network tool executes the check. The adapter resolves sw1 and calls Cisco Command Runner.
6. Cisco returns actual output. A task can succeed, fail or remain unknown. Preserve that distinction.
7. Results return to the agent. The model interprets evidence and may request another check. This is a loop.
8. Progress can be checkpointed. This planned side operation enables recovery; it is not required after every model token.
9. Activity and the answer return to you. Chat displays tool activity, evidence and the answer. Checkpoint persistence above is still planned; the diagram is a teaching view, not telemetry.

## Boundaries and failure behavior

- Existing connector uses the approved certificate pin and locally protected credentials. No secrets belong in this document or browser.
- Inventory observations and actual CLI execution remain visibly distinct.
- The model selects tools from ordinary language. The existing 25-command read-only catalog remains a capability limit; broader diagnostics are the next automation slice.
- Configuration execution and its permission policy are not decided by this HLD. Cisco Command Runner itself is read-only.
- Timeouts after submission must preserve unknown outcome; do not silently repeat requests.
- Checkpointing does not automatically make external operations safe to replay. Tool execution and resume behavior need explicit tests.
- OpenCode tool calls are covered by the first live slice evidence. Durable checkpoint storage is not configured.

## First acceptance checkpoint

Ask “Investigate sw1’s interfaces.” The agent must select tools without exact user command syntax, retrieve real results, interpret them, show activity and evidence, and preserve explicit failure/unknown states. Also test general questions, follow-ups, interruption and unsupported operations. This checkpoint validates the local framework slice, not enterprise readiness or general network diagnostic accuracy.

## Change history

- 2026-09-20 — **Provider contract documentation reconciled:** Updated the runtime reference for optional selection, receipt identity and reported provenance. Replaced stale current Windows limitations with pointers to docs/handover/VERIFICATION.md and corrected capability visibility wording. HLD 26 and dated evidence are preserved; no new execution or acceptance is claimed.
- 2026-09-20 — **Bounded picker interface simplification:** Removed unused chat context counters, parallel providerRuntime injection and unused providerFetch forwarding in intentgraph/server.cjs. Direct fixture injection, selection validation, legacy fingerprints and private clarification runtimeContext are retained. UX027 remains Partial; this cleanup adds no adapter or connected-provider acceptance claim.
- 2026-09-20 — **Bounded provider picker and Windows launch checks:** Implemented conversation selection, strict pre-dispatch validation, legacy replay compatibility, immutable continuation selection and honest requested/reported provenance. Native Windows launcher startup/reuse/restart and offline browser flow checked with Node24.19. Fixed Windows test cleanup for open SQLite handles. No credential access, live providers/devices or customer acceptance. Scope: docs/evidence/provider-picker-2026-09-20/README.md.
- 2026-09-20 — **Compact answer documentation reconciled:** README.md owns answered-row usage; HANDOVER.md records the current branch, initial-card approval and delivery authorization. Current acceptance references point to that owner; dated evidence and verification limits are preserved. No new verification or acceptance is claimed.
- 2026-09-20 — **Answered disclosure state survives in-session refresh:** Implemented in-memory disclosure state keyed by question in polished.js, independent of answer authority. Conversation re-renders preserve expanded or collapsed state; newly displayed answers and page reloads default collapsed. Added a focused mounted fixture regression for refresh success/error feedback visibility, keyboard focus, navigation and reload; verification remains separate from customer acceptance.
- 2026-09-20 — **Answered clarification collapses into a compact row:** Owner requested an expandable Answered: <answer> row after previewing the clarification UI. Answered cards now default to a native details/summary disclosure; expanding retains the question, answer and saved-state refresh. Waiting and cancellation behavior are unchanged. This is a local presentation change; full Windows application acceptance remains separate.
- 2026-09-20 — **Documentation reconciled with durable admission:** Corrected the function walkthrough to reference durable admission instead of the removed process-local in-flight flag. Current delivery status is owned by HANDOVER.md; dated validation is indexed in docs/handover/VERIFICATION.md. No implementation or acceptance state changed.
- 2026-09-20 — **Same-tab unrelated saves serialized:** Implemented T2 in polished.js by serializing unrelated-save Web Lock requests within the tab. Navigation and rapid draft edits retain waiting guidance and the latest persisted draft after reload. Focused mounted reproduction and verification: docs/evidence/clarification-2026-09-19/t2-verification.md. Foreign writers remain excluded and stale workspace checks are unchanged. Pipeline re-review and CI remain with the outer executor; Windows, live providers/devices, owner visual acceptance and release approval are not established.
- 2026-09-20 — **Live writer completion protected from foreign navigation:** Implemented T1 in polished.js. Unrelated draft/navigation saves acquire the admission Web Lock before checking fresh storage and unchanged protected capture. A live foreign writer rejects persistence while retaining the visible draft and warning; abandoned pending requests still allow unrelated saves. Focused mounted reproduction and verification are recorded in docs/evidence/clarification-2026-09-19/t1-verification.md. Pipeline re-review and remote CI belong to the outer executor; Windows, live providers/devices, owner visual acceptance and customer release remain unverified or unauthorized.
- 2026-09-20 — **Pending capture persistence and guarded workspace restore:** Implemented R1/R2 corrections in polished.js with focused mounted regressions in intentgraph/mounted-admission.test.cjs. Verification is limited to the review fix round; no new owner visual acceptance, Windows validation, live provider/device check or release approval is claimed. Existing evidence-versus-receipt ambiguity and continuation limits remain unchanged. Focused mounted verification was attempted with chrome-devtools-axi on 2026-09-20 but all three selected cases were blocked in setup because Google Chrome stable was unavailable at /opt/google/chrome/chrome; no regression assertions ran. Atlas visual verification was likewise unavailable. The HLD was regenerated; authoritative test/lint and delivery phases remain with the outer executor.
- 2026-09-19 — **Clarification independent-review corrections F1–F3:** Preserve bounded live model/tool context, six-call budget and attempted diagnostics across the single continuation; save answer drafts before Continue and after rejected edits; restore Refresh focus and announce current status. Actual LangChain and mounted regressions are recorded in docs/evidence/clarification-2026-09-19/verification.json. Independent re-review and owner UI approval remain pending. No restart continuation, approvals or authority expansion; existing reliability and Windows limitations remain.
- 2026-09-19 — **One bounded clarification in a serial read-only run:** Implemented on reliability base e176ad4989a9e8f5455223206f10227d58b837b6. One durable question/answer/segment protocol, scoped routes and compact accessible card preserve the v9.1 shell and recovery fixes. At most one same-run continuation retains Plan/Inspect and provider; reload/import never restore answer authority. Cancellation does not dispatch and queue resumption remains explicit after cancellation or uncertainty. No approvals, mock execution, scheduler, parallel work or durable continuation after restart. Evidence: docs/evidence/clarification-2026-09-19/verification.json; independent review and owner UI approval remain pending. Existing evidence-versus-receipt ambiguity and Windows uncertainty remain documented. Long evidence paths wrap in atlas rows at narrow widths.
- 2026-09-19 — **Independent-review recovery corrections:** Fixed multi-pending-chat reconciliation lockout and duplicate UNKNOWN/SUCCESS messages on a successful saved-request retry. Browser Web Locks preserve live writer ownership; capture-scoped saves preserve unrelated journals and queues. Message IDs, timestamps, annotations and distinct raw evidence survive reconciliation. Current suite: 83 tests, 82 pass, zero fail, one existing Playwright skip; seven mounted browser checks enabled. Evidence-versus-receipt ambiguity remains a documented nonblocking limitation; no backend or workflow expansion. Evidence: docs/evidence/admission-2026-09-19/review-fixes/verification.json.
- 2026-09-19 — **Durable, fenced chat request admission:** Composed a narrow backend receipt and browser identity/recovery slice on the v9.1 UI, now build ux-minimal-ui-v9.2-admission. The deterministic suspended-owner test fails against archived candidate hashes and passes against active SQLite transitions. Current suite: 74 pass, zero fail, one existing browser-adapter skip (75 tests); loopback desktop/narrow, Stop, duplicate retry, reload, keyboard recovery and queue fixtures pass. Evidence: docs/evidence/admission-2026-09-19/verification.json and browser-checks.json. No live devices/providers, secrets, Windows validation or owner approval. Historical candidate packages and evidence remain unchanged.
- 2026-09-16 — **Minimal UI v9.1 code folding:** Long generated code starts collapsed. Three root browser boundary checks passed: final failures stay visible with raw output hidden; active Stop remains available; long code is collapsed with exact source retained. Evidence: completion/ui-release/boundaries-v9.1.json and integration.json. The live browser shows a collapsed 113-line HTML block. Backend integration remains pending.
- 2026-09-16 — **Minimal UI v9 and history release:** Integrated only the reviewed UI/history/reaction changes. Evidence: completion/ui-release/navigation/results.json (31 checks pass), browser-evidence.json (23 checks pass), quality-evidence.json (10 checks pass), backup.test.cjs (3 pass), integration.json (5 exact source files, verified hashes). Fixed duplicate fenced CLI output caused by Markdown boundary newlines without modifying retained output bytes. Backend behavior and remaining 115-row completion verdicts are unchanged; owner visual acceptance and full backend integration remain separate.
- 2026-09-16 — **HLD 16 · Independent audit fixes:** Build ux-audit-fixes-v8 repairs four confirmed defects affecting UX-011, UX-058, UX-066, UX-098 and UX-102. Independent review and isolated integrated browser regressions cover creation failure/recovery/retry, status truthfulness, artifact preservation and rename identity. Evidence: outputs/01a0a816-e452-75f2-9363-0f859011a90e/fixes/independent-review.json and root-verification.json. Backend regression: 58 passed, zero failed. Original feature register and audit workbook remain unchanged; post-fix workbook preserves prior verdicts. These repairs do not complete the remaining feature backlog or assert live provider/device reachability, real filesystem verification or owner acceptance.
- 2026-09-16 — **HLD 15 · Pending local feature batch:** Build ux-pipeline-v7 adds attachments, local workspace tools, bounded run capture/recovery, zero-tool Plan mode, evidence annotations/comparison, scoped file review, accessibility and pane controls. Evidence: .intentgraph/evidence/pending-88-20260916/. Backend: 58 serial tests passed; status/read API and mode fixtures passed. Local service restarted and status returned no active runs; provider/device reachability not tested. The workbook remains the authoritative per-feature status. Four remote/account rows deferred by user instruction. No owner acceptance or release approval granted. Final register checkpoint: 80 Verified, 10 Implemented partial, 21 Not started, 4 Deferred. Local file shell: 26 checks with real SHA-256 and memory-only handles; close-focus defect fixed and retested.
- 2026-09-16 — **HLD 14 · Conversation navigation:** UX-012 and UX-014 verified: section ordering persists and failed saves preserve order; conversation Back/Forward preserves drafts and scroll, respects unsaved document guards, and validates session history. Evidence: .intentgraph/evidence/ux-pipeline-2026-09-16/navigation.json. History and command regressions pass. 27 of 115 rows verified; owner acceptance remains separate.
- 2026-09-15 — **HLD 13 · Recovery review closure:** Closed five review findings: private/control fields rejected with raw text preserved; message-recipient validation; startup recovery for interrupted five-key imports; matching serialized UTF-8 export/import limits; Markdown includes original inventory evidence. verify-backup-schema.cjs passes 9/9; verify-local-data-ui.cjs passes including Add collision/reload and simulated interrupted-import startup. Light/dark terminal contrast corrected. No live provider/device execution or owner acceptance asserted.
- 2026-09-15 — **HLD 12 · Local recovery and appearance:** 25 workbook rows verified; UX-102 build-details slice and UX-110 safe-link slice remain partial. Evidence: .intentgraph/evidence/ux-fixes-2026-09-15/local-data-ui.json plus verify-backup-schema.cjs (5 tests). Add restore remaps ID collisions and retains existing records; replacement requires explicit action and keeps a recoverable raw backup. Restored queues remain paused. Combined raw-CLI, queue/steering, history, reply, commands, rendering and navigation regressions pass. Live existing workspace inspected on ux-pipeline-v5 without provider/device requests. Owner acceptance remains pending.
- 2026-09-15 — **HLD 11 · Verified local conversation controls:** 22 register features verified. Evidence: .intentgraph/evidence/ux-fixes-2026-09-15/ (root-review, reaction-recovery, chat-interactions, local-commands, edit-rendering, history-navigation JSON). Exact raw CLI, queued follow-ups and next-step steering regressions passed before the latest navigation batch; final combined regression is pending. Safe-link slice of UX-110 implemented and tested; media remains partial. Export/import, density and diagnostics in progress. No owner acceptance or new provider/device integration claimed.
- 2026-09-15 — **HLD 10 · UI/UX implementation pipeline:** User authorized feature-by-feature implementation, beginning at spreadsheet row 11 and prioritizing all Needs fix entries. UX-001 through UX-007, UX-103 and UX-109 are in progress. Root review, mocked browser checks and source backups protect existing local state. The workbook records delivery separately from owner acceptance. Verification evidence will be added as each feature passes.
- 2026-09-15 — **HLD 09 · UI/UX comparison and acceptance status:** Inspected the exact Aven shell and installed Grok Bot/Codex surfaces; Claude Code working-session access was gated, so its feature entries use official documentation. Central register: outputs/01a0a3bc-a376-74e1-8d48-e4029c2cb5a2/Aven-UI-UX-Feature-Register.xlsx. Evidence: .intentgraph/evidence/ux-comparison-2026-09-15/. 115 checks distinguish present, partial, placeholder, missing, needs-fix and unverified behavior. Previously passing checks do not establish owner acceptance. No comparison-driven product implementation has started. Existing IntentGraph browser/desktop approval adapters should be evaluated for integration rather than rebuilt.
- 2026-09-15 — **HLD 08 · Direct, Teams and conversation control:** Grok Bot inspected live. Simplified the navigation model, moved archives into Settings and preserved coworker identity. Local reactions and reversible conversation-context truncation added. This does not add multiagent execution or server-side persistence.
- 2026-09-15 — **HLD 07 · Project and thread interactions:** Inspected Codex project and chat menus. Added local persistent navigation lifecycle and compact CLI controls; archive blocked during active/queued work. Advanced sharing, forking and native OS integrations remain unimplemented.
- 2026-09-15 — **HLD 06 · Chat presentation and ownership:** Codex desktop reference inspected. Removed duplicate primary CLI rendering, added hover/focus controls, preserved existing project ownership and separated Direct navigation. Browser acceptance fixtures cover saved history and movement.
- 2026-09-15 — **HLD 05 · Chat control and raw CLI:** Added FIFO queued follow-ups and next-model-step steering. Raw CLI displayed independently from model text. Expanded the shared Cisco catalog to 25 commands; inventory and clock verified on the sandbox, BGP summary returned failure.
- 2026-09-15 — **HLD 04 · Open-source execution:** Adopted Nornir + Netmiko instead of Itential. Added a real Python task worker, server-owned SSH profile routing, transport evidence and per-target capabilities. SSH live connection remains pending.
- 2026-09-15 — **HLD 03 · Layered Aven build:** Adapted the Netrok layer structure; added the first framework runtime, typed tools and streamed evidence. External automation platforms remain options. Live browser addressing query selected show ip interface brief; MPLS returned without tools. Diagnostic interpretation remains an evaluation gap.
- 2026-09-14 — **HLD 02 · Technical and production review:** Verified the stack and function path; added proposed customer boundaries, intent/context explanation, BGP example and decisions. No runtime migration performed.
- 2026-09-14 — **HLD 01:** Created this shared map. Framework integration remains next, not completed.
- 2026-09-13 — **Command Runner:** Two distinct commands verified through chat; ordinary MPLS question also answered.
- 2026-09-13 — **Prototype:** Approved avatar family and interactive chat with timestamps, copy and elapsed time.

## Maintenance

Edit architecture.json as part of each relevant implementation checkpoint, add dated evidence and regenerate this HLD with node docs/architecture/build-hld.cjs. The webpage reads the same JSON. Follow MAINTENANCE.md.

## Sources

- [LangChain overview](https://docs.langchain.com/oss/javascript/langchain/overview)
- [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Command Runner evidence](../../.intentgraph/evidence/command-runner-chat.json)
- [Agent context and tools](https://docs.langchain.com/oss/javascript/langchain/context-engineering)
- [Agent evaluations](https://docs.langchain.com/oss/javascript/langchain/test)
- [Tenant isolation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [Cisco BGP troubleshooting](https://www.cisco.com/c/en/us/support/docs/ip/border-gateway-protocol-bgp/220604-understand-basic-bgp-troubleshoot.html)
- [Your Netrok architecture reference](netrok-reference.png)
- [First framework slice · verification and limits](verification.json)
- [Nornir/Netmiko setup and scope](NETWORK-EXECUTION.md)
- [Nornir documentation](https://nornir.readthedocs.io/en/latest/)
- [Netmiko source](https://github.com/ktbyers/netmiko)
- [Nornir adoption verification](nornir-verification.json)
- [Supported diagnostic commands](../../intentgraph/network-commands.json)
- [Chat controls and CLI evidence](./CHAT-CONTROLS.md)
- [Chat presentation acceptance](../../.intentgraph/feedback-chat-polish.md)
- [Project/thread interaction checkpoint](../../.intentgraph/feedback-project-navigation.md)
- [Local admission verification (2026-09-19)](../evidence/admission-2026-09-19/README.md)
- [Independent-review recovery evidence (2026-09-19)](../evidence/admission-2026-09-19/review-fixes/README.md)
- [Clarification verification (2026-09-19)](../evidence/clarification-2026-09-19/README.md)
- [Provider picker and Windows checks (2026-09-20)](../evidence/provider-picker-2026-09-20/README.md)


## Technical and production architecture workshop

### 01 / What actually runs

Verified from current source for HLD 03. Language, runtime, framework and hosting mean different things.

#### Frontend

HTML defines structure, CSS defines appearance and JavaScript handles behavior. The active page is polished.html. No React, Angular, Tailwind or TypeScript compilation drives this shell.

#### Libraries and assets

SVG avatar artwork loads through artwork.js and polished-avatars.js. React asset components elsewhere do not make the active application React. Playwright and TypeScript are declared project dependencies; package presence does not establish runtime usage.

#### Static hosting

Start-NetrokMuse.ps1 launches Python http.server on localhost:8767. Python serves files; it does not execute the chat agent. This development server is not proposed customer hosting.

#### Backend

JavaScript .cjs modules run in Node.js. node:http serves requests. API routing, runtime and tools share one backend service today. The LLM runs externally through OpenCode.

#### Framework and other tools

LangChain/LangGraph run in Node. The execution facade routes Catalyst targets to Command Runner and configured SSH profiles to the Python Nornir/Netmiko worker. Browser/desktop tools remain separate.

#### Storage and identity

Browser localStorage holds conversations and request snapshots; local SQLite holds durable admission receipts; local files hold raw evidence; the Windows vault remains separate. Admission is not a customer identity system or resumable LangGraph checkpoint.

### 02 / Follow the real function path

Current implementation. Open any step to understand its responsibility.

#### 1. Browser opens polished.html

Loads polished.css, avatar-system/avatar.css, then artwork.js, polished-avatars.js and polished.js. index.html is the older entry served by the startup script; the active chat URL is polished.html.

#### 2. Module setup → init()

polished.js executes an enclosing function, migrates browser state, and calls init on DOM readiness. Wrapped init invokes initialInit() and finishInteractionWiring(): preferences, sidebar, active chat and event handlers.

#### 3. sendMessage(event)

Enter/submit validates the draft, adds the user message, saves state and renders the conversation. It calls requestChatReply(chat).

#### 4. requestChatReply(chat)

Persists a stable request identity and exact bounded context, then posts to the local chat API. Receipt review and recovery are explicit. Retrying transport preserves identity; a deliberate new turn receives a new one. Provider keys stay outside the browser.

#### 5. route(req,res)

server.cjs validates origin and payload, then admits the request through reliability.cjs before calling agent-runtime.respond(). See the Backend API layer for durable serial admission and clarification transitions; a process-local in-flight flag is no longer the admission authority.

#### 6. Framework loop

createAgent() sends conversation, domain instructions and typed tool schemas to OpenCode. The model can answer directly or request inventory/run_diagnostic; LangGraph loops over model and tools.

#### 7. Typed tool execution

The tool validates the operation and exact inventory hostname, resolves a Catalyst device ID or SSH profile ID, then calls network-execution.cjs. The selected transport returns evidence to the model. No credentials are accepted from model tool arguments.

#### 8. Cisco task → model interpretation

Command Runner returns a task ID and output file. SUCCESS, FAILURE and UNKNOWN remain distinct. Tool events stream to the browser while the model interprets results.

#### 9. Render and record

requestChatReply() consumes NDJSON; appendMessage() shows the answer, timestamp, copy controls and expandable evidence. Browser history and local server run files retain records; neither is a resumable LangGraph checkpointer.

### 03 / Proposed customer-ready architecture

Recommendations for discussion, not installed services. Start with a modular app and a separate worker; distribute further when measured load requires it.

#### Deployment direction

Recommend a web application plus customer-side network connector. Decide hosted SaaS, customer-hosted or hybrid with the first customers. Keep the approved UI independent of deployment so a desktop shell remains possible.

#### Frontend evolution

React + TypeScript is a maintainability proposal as components grow, preserving the approved appearance. It is not required before the next agent experiment. Serve production assets through managed hosting/CDN.

#### Authenticated API

Node/TypeScript API handles organizations, users, projects, devices and runs. Use an identity provider and resource-level authorization. Tenant/user scope is established by the server, never by LLM-supplied identifiers.

#### Agent worker

LangChain/LangGraph work should survive browser disconnects. Separate workers from request handling, persist run IDs/status and use a durable work mechanism with backpressure. Evaluate framework deployment options before creating a custom scheduler.

#### Persistence

Recommend Postgres for app records and supported checkpoint storage, plus object storage for large evidence. Enforce tenant scope across messages, checkpoints, caches, retrieval, tools and files. Vector search is optional, not required for BGP diagnosis.

#### Private-network connector

A customer-owned connector reaches local devices through supported vendor APIs, NETCONF/RESTCONF or SSH. Propose an outbound mutually authenticated connection, scoped connector identity and local secrets. Cloud workers cannot assume access to private device IPs.

#### Events and evidence

Stream tool/run start, completion and errors with replay after reconnect. Record target, inputs, status, timestamps and evidence references. Display short action explanations, not purported private model reasoning.

#### Concurrency and recovery

Replace the global chat lock with tenant/run/device limits and queue backpressure. Bound time/cost, respect provider limits, reconcile submitted operations before retries, and test resume behavior. Checkpoints alone do not prevent duplicate external operations.

#### Monetization and operations

Design tenant plans, entitlements, usage metering, quota enforcement and overage ownership. Establish latency/availability targets, load tests, backup/restore tests and operational monitoring before promising capacity.

#### Data lifecycle

Decide data residency, provider retention, redaction and deletion across logs, checkpoints, evidence and backups. Context must not cross tenant boundaries. Device outputs/documents are untrusted data, never authorization.

#### Real-network permissions

Read diagnostics and configuration changes need distinct customer-approved policies. Even diagnostic commands can load devices. Proposed mutation flows require scoped review, evidence and recovery. This HLD does not enable commands or finalize that policy.

#### Rollout sequence

Framework sandbox investigation → tenant-isolated private pilot with connector → reliability, billing and security validation → broader launch. Microservices and Kubernetes are not automatic prerequisites.

### 04 / How intent becomes an investigation

The user supplies intent; the app supplies scoped context; the LLM proposes actions; tools supply evidence. LangChain coordinates this loop, not correctness.

#### Original intent

Preserve the exact request: Investigate BGP. Include the selected device/site and relevant conversation. Do not invent customer, peer, VRF or symptom.

#### Visible interpretation

Show a compact intent card with goal, scope, assumptions and expected deliverable. Proceed if context already establishes scope. Ask a focused question when missing information materially changes the task. Users can correct it.

#### Context sources

Authenticated user/tenant scope; relevant conversation; authorized inventory/topology; platform/capabilities; versioned runbooks/vendor references; fresh tool results. Record provenance and freshness; do not send all available data.

#### Domain habits

Reviewed network runbooks describe what to check, how evidence affects the next step and when to stop. They guide investigation rather than prescribing a fixed transcript. Platform adapters translate supported capabilities into operations.

#### Model input and tool choice

The selected model receives instructions, relevant messages/context and tool schemas. It can return a structured tool request. The runtime validates and executes it, then feeds the result back for the next step.

#### How many commands?

There is no fixed count. Gather the least information needed and follow evidence. Stop when the agreed question is answered, evidence/access runs out, the user stops, or declared time/cost/tool budgets are reached. Mark incomplete work honestly.

#### What you can inspect

Original request → interpreted task → short action rationale → tool/target/inputs → actual result → supported conclusions and unknowns. Show these decisions and evidence, not a claim to expose the model’s hidden reasoning.

#### Is it the right model?

LangChain does not certify a model. Compare candidate models on representative network cases: correct scope/tool, grounded answer, ambiguity, recovery, latency and cost. Use expert-labelled outcomes and deterministic checks; another LLM judge alone is insufficient.

#### Intent-to-output acceptance

Define a deliverable such as peer states, evidence-backed causes or unknowns, and next checks. Evaluate the answer against that contract. A fluent answer or successful command is not proof of a correct diagnosis.

### 05 / BGP: adaptive investigation example

Target behavior only. This BGP workflow is not implemented and asserts no actual sandbox BGP state.

#### Establish scope

No selected device/site/VRF? Ask which one. If context supplies it, state the scope and proceed. Investigate does not itself authorize configuration changes.

#### Establish facts

Identify platform, address family/VRF and whether BGP is configured. A summary capability might map to show ip bgp summary on suitable IOS devices; other platforms need different syntax.

#### Branch: peer is down

Inspect relevant peer, reachability, interface and routing evidence. A peer state alone is not a root cause. Ask for missing access or corroboration when necessary.

#### Branch: peers up, routes missing

Inspect relevant prefixes, advertised/received routes and policy evidence. An Established session does not establish correct routing.

#### Branch: insufficient evidence

Report what was observed, unknowns and the next useful check. Stop at tool unavailability or budget exhaustion rather than inventing a healthy result.

#### Return a useful result

Show device/peer scope, observation time, cited outputs, supported conclusions, unknowns and recommended next steps. A user correction updates the task and continues from evidence.

### 06 / Decisions before customer launch

Open decisions, not silent implementation commitments.

#### Customers and workload

First customer type, concurrent investigations, inventory size, platforms and response latency targets. Many users alone is not a capacity specification.

#### Deployment and identity

Hosted, private or hybrid; identity/SSO provider; isolation and data residency requirements.

#### Operations

Diagnostic versus configuration scope, roles, approval policy and execution protocols.

#### Model data and commercial use

What may leave the customer network, redaction/retention, customer-owned keys and whether the provider plan permits intended commercial usage.

#### Storage and launch criteria

Choose supported checkpoint storage, evidence store and identity services after deployment needs are known. Define quality, recovery, isolation, operating-cost and pilot acceptance tests.

## Proposed production topology

- **User / browser:** Approved UI → authenticated API. Customer selects organization and scope.
- **Service boundary:** API → durable work mechanism → agent worker (LangChain / LangGraph).
- **Supporting services:** Worker ↔ external model; worker ↔ tenant-scoped checkpoint/database and evidence storage.
- **Customer network boundary:** Worker ↔ outbound authenticated connector ↔ vendor API / SSH / NETCONF ↔ devices.
- **Return path:** Device evidence → worker → events and answer → browser. Checkpoints support resume.

## Reference-aligned Aven layers

### Users & interfaces · Northbound

- **NOC engineers (built):** Existing browser conversation with network avatars.
- **APIs / dashboards (partial):** Local API and IntentGraph dashboard. Public tenant APIs not built.
- **ChatOps / mobile / ITSM (planned):** Separate channels and customer integrations.

### Aven application · Coworker experience

- **Conversation (built):** Approved interface; live tool activity is the first enhancement.
- **Investigations (partial):** Timeline, tool evidence and answer.
- **Topology / knowledge (planned):** Topology exploration, runbooks and prior incidents.
- **Collaboration / insights (planned):** Handoffs, multi-user work and proactive observations.

### Intelligence & planning · Aven runtime

- **Conversational orchestrator (partial):** LangChain createAgent on LangGraph replaces the rigid parser.
- **Context & capability registry (partial):** Conversation context plus typed inventory/diagnostic tools.
- **Adaptive investigation (partial):** Model chooses the next tool from results; bounded run with explicit failure.
- **Memory / evaluations (planned):** Durable checkpoints, knowledge retrieval and repeatable domain evaluation.
- **Specialist models (optional):** Not required for first slice; use only if evaluations justify them.

### Automation & execution · Pluggable provider boundary

- **Catalyst adapter (built):** Current implementation: pinned API, task polling and real CLI output.
- **Nornir + Netmiko (partial):** Installed worker and chat routing; live SSH pending a configured lab profile.
- **Ansible / Nautobot (options):** Evaluate reusable jobs and inventory rather than invent network automation.
- **Job lifecycle (partial):** Current task IDs and outcomes; durable cross-session orchestration remains planned.

### Network & infrastructure · Southbound

- **Cisco sandbox (connected):** Current test devices via Catalyst Center.
- **Routing / firewalls / SD-WAN (planned):** Vendor-specific capabilities through chosen automation providers.
- **DC / wireless / cloud / DNS (planned):** Future supported infrastructure; no current live access claimed.

## Layer delivery sequence

- **1 · Intelligence slice (implemented · local slice):** Framework loop, existing model, inventory/diagnostics and visible tool evidence. Broader operations and durable recovery are later slices.
- **2 · Network execution (partial):** Nornir/Netmiko worker and routing implemented. Next checkpoint: real SSH lab verification.
- **3 · Durable investigations (partial):** Local durable admission receipts and explicit unknown recovery are implemented. LangGraph checkpoint storage, context/runbooks, resumable runs and domain task evaluations remain planned.
- **4 · Customer pilot (planned):** Identity, tenant boundaries, private connector, metering and recovery validation.
- **5 · Enterprise expansion (planned):** Integrations, topology, specialist models and proactive workflows based on evidence.