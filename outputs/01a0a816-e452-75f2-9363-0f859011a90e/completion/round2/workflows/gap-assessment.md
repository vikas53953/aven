# Round 2 workflow gap assessment

Scope: UX-033 clarification and approval cards, plus UX-074 execution approval receipt.

Frozen input: `completion/workflows/candidate/` (the prior candidate package). The prior package is read-only for this round. The only round-2 artifacts are this assessment, an input hash ledger, an incremental manifest, and the supplemental acceptance test.

## Current evidence

- The frozen package passes 35 focused tests: approval lifecycle, clarification lifecycle, HTTP adapter, normal-chat pending/resume, agent-runtime structured model content, and browser card rendering.
- UX-033 primitives are present: typed pending-question extraction accepts model JSON and `ask_clarification` tool results; one answer is bound to one run/chat/question token; stale/replayed answers fail; resume keeps the same run and selection; waiting is reported as non-terminal; a fresh cancellation segment is created on resume; browser refresh restores review-only history and requires explicit abandon.
- UX-074 primitives are present: exact target, operation, command/scope, diff, impact, rollback and mode are included in a digest-bound receipt; approval and execution tokens are one-time; proposal replacement stales prior approval; replay, stale scope and action digests fail before the executor boundary; rendering is pure.

## Round-2 gap

The previous browser test passes card state directly to the renderer. It does not prove the complete model/tool response -> normal workflow HTTP response -> browser pending card path. The supplemental test closes that evidence gap for both structured model content and an `ask_clarification` tool call using an injected responder and loopback HTTP only.

UX-074 remains explicitly mock-bound in this package. The separate approval-bridge owner must wire the existing adapter contract before the parent can claim an executed real action. This slice therefore proves immutable receipt/rejection behavior and labels UI execution as mock-only; it does not claim device/provider/network mutation.

## Required parent interface

The parent composition should mount `createWorkflowApi({ manager, originAllowed })` after its existing origin policy, pass the same `runId`, `chatId`, and provider selection through `/api/chat` and `/api/chat/workflow/answer`, and load `polished-approval-workflow.js` before `polished.js`. The approval bridge may reuse `ApprovalWorkflow` review/approval methods through a review-only session; it must supply a real existing adapter executor before promoting UX-074 beyond mock evidence.

