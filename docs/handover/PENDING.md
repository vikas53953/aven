# Pending features

The 19 September admission supplement retains these dated 16 September verdicts; candidate implementation is not acceptance. Fresh publication tests did not re-audit these 14 features.

| ID | Feature | Original next action |
| --- | --- | --- |
| UX-023 | File or device mentions | Add @device and @document chips that identify exact scope. |
| UX-026 | Voice dictation | Defer until microphone, transcript review and provider privacy are defined. |
| UX-027 | Model and effort picker | Show actual model; enable selection only for connected supported providers. |
| UX-033 — now Partial | Clarification and approval cards | Clarification implemented locally; independent review and owner UI approval pending. General approval remains missing. |
| UX-037 | Parallel work visibility | Show current serial limit honestly; add independent work only with backend support. |
| UX-071 | Interactive terminal | Keep read-only evidence primary; add terminal only for defined authorized workflows. |
| UX-074 | Execution approval receipt | Preserve read-only safety; require exact scope-bound approval for future changes. |
| UX-075 | Git stage, commit and PR controls | Defer; only add if configuration-as-code becomes a primary workflow. |
| UX-080 | Scope, impact and rollback preview | Require network-specific change scope and recovery plan before enabling writes. |
| UX-082 | Topology and visual evidence | Add traceable network diagrams only when backed by actual inventory. |
| UX-086 | Scheduled investigations | Add preview, timezone, pause/resume, last/next run and run history. |
| UX-088 | Plugin discovery and management | Prioritize real network adapters; expose install/connect/capability state accurately. |
| UX-089 | Skills and reusable workflows | Add saved diagnostic procedures with purpose, inputs and evidence requirements. |
| UX-114 | Existing approval tooling integration | Reuse proven backing contracts; design Aven-facing review without exposing engineering internals. |

The current 58 Partial and 3 Unverified features also need work. Use the linked effective verdict review and central register for their original acceptance requirements. Four Deferred entries remain explicit scope exclusions, not completed features.

## Preserved admission milestone

Stable identity, durable serial receipts, stale-owner fencing and explicit UNKNOWN recovery are implemented. Independent-review fixes allow each reloaded pending conversation to reconcile and update successful retries in the existing result message. Browser Web Locks protect live capture. The clarification launch brief identifies reliability base `e176ad4989a9e8f5455223206f10227d58b837b6` as independently approved. Current evidence: [latest recovery verification](../evidence/admission-2026-09-19/review-fixes/README.md). This does not complete full draft/queue migration, resumable tools or LangGraph checkpoints. Native Windows behavior and owner UI approval remain unverified. Independent review of the new clarification branch remains pending.

The [proposal](../proposals/approval-clarification.md) has a subsequent launch authorization approving its four recommended choices. The bounded clarification slice is implemented locally; see [current evidence](../evidence/clarification-2026-09-19/README.md). UX-033 is Partial, with approval still absent. UX-074, UX-080 and UX-114 remain Missing; UX-037 remains Missing because execution is serial. No approval candidate or executor has been mounted. Independent clarification review, owner review in the existing UI and native Windows validation remain pending. The evidence-versus-receipt ambiguity is unchanged.

19 September independent-review follow-up: F1–F3 corrections retain the live runtime context and six-call budget, persist bounded answer drafts on edits, and restore Refresh focus/status. Independent re-review of the corrected commit must precede owner UI review. Existing reliability and Windows limitations, UX-033 Partial and missing approval rows remain unchanged. Exact technical results: [clarification evidence](../evidence/clarification-2026-09-19/verification.json).
