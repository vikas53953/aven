# Pending features

The 19 September admission supplement retains these dated 16 September verdicts; candidate implementation is not acceptance. Fresh publication tests did not re-audit these 14 features.

| ID | Feature | Original next action |
| --- | --- | --- |
| UX-023 | File or device mentions | Add @device and @document chips that identify exact scope. |
| UX-026 | Voice dictation | Defer until microphone, transcript review and provider privacy are defined. |
| UX-027 | Model and effort picker | Show actual model; enable selection only for connected supported providers. |
| UX-033 | Clarification and approval cards | Use compact choices, free-text answer and explicit waiting state. |
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

The remaining 57 Partial and 3 Unverified features also need work. Use the linked effective verdict review and central register for their original acceptance requirements. Four Deferred entries remain explicit scope exclusions, not completed features.

## Admission milestone: implemented locally, review pending

Stable identity, durable serial receipts, stale-owner fencing and explicit UNKNOWN recovery are implemented. Current evidence: [admission verification](../evidence/admission-2026-09-19/README.md). This does not complete full draft/queue migration, resumable tools or LangGraph checkpoints. Native Windows behavior and independent/owner reviews remain pending.

The [approval/clarification proposal](../proposals/approval-clarification.md) describes a possible next flow and its unresolved product decisions. It is not implementation authorization. UX-033, UX-074, UX-080 and UX-114 remain Missing; UX-037 remains Missing because global serial execution is intentionally retained. No approval or clarification candidate has been loaded into the active application.
