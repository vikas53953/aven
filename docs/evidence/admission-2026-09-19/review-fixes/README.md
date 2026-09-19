# Independent-review corrections — 19 September 2026

This pass corrects two findings on review base `a4baf4d`, within the same local branch. It awaits independent re-review. It does not change backend fencing or authorize the separate clarification/approval proposal.

1. Multiple pending conversations no longer block each other's explicit reconciliation. A browser Web Lock protects the complete active writer lifetime and the short receipt-save transition. A genuinely live tab retains that lock; another tab cannot mutate its captured workspace. After reload, an explicitly reviewed request can be saved while unrelated pending captures, queues and journals are copied unchanged from stored state. The whole-workspace stale-snapshot check still rejects a concurrent edit. Draft and navigation state remain separate from the protected capture.
2. A successful saved-request retry reconciles into the assistant message already bound to that request. Its ID, original creation time and annotations remain intact; distinct earlier raw events/evidence are retained and exact repeated capture entries are deduplicated. Repeated failure uses the same reconciliation path. A different request identity cannot overwrite that result, even if a run ID is supplied. Completion notifications use the reconciled message.

The active build is `ux-minimal-ui-v9.3-recovery`. The browser uses `navigator.locks` on the loopback secure context; unavailable Web Locks produce an explicit coordination error before request dispatch or receipt mutation. Browser locks protect local capture and have no timeout-based takeover. SQLite remains the independent backend authority. This does not turn localStorage into a general transactional database, authenticate an owner, or add cross-device support.

## Current results

**83 tests: 82 passed, 0 failed, 1 existing Playwright skip**, with all seven mounted browser regressions enabled. Six browser-state tests and all current storage/protocol tests pass. Syntax checks and seven HTTP-served source hashes match active files. Actual 1440×1000 and 390×844 viewports, screenshot dimensions and narrow keyboard retry were verified. See [verification.json](verification.json), [full test output](node-tests.txt), [browser checks](browser-checks.json), [desktop](desktop.png), [narrow](narrow.png) and [narrow recovery](narrow-recovery.png).

## Regressions and reproduction

The mounted tests use the actual root UI and router with `intentgraph/fixtures/admission-ui.cjs`, injected responders, disposable storage and ports 8767/8768. The fixture can hold a responder until its local configuration clears `hold`, so the live-owner test does not depend on a timing guess. No secret, provider or device call is permitted by the fixture.

`intentgraph/mounted-admission.test.cjs` invokes only individual **chrome-devtools-axi** commands. Set `AVEN_BROWSER_TOOL` to an absolute executable for an isolated task-local session and browser profile. The test itself starts/stops only its own fixture. Example:

```sh
AVEN_BROWSER_TOOL="$PWD/.audit/browser-tool" \
AVEN_UI_EVIDENCE="$PWD/.audit/mounted-results.json" \
AVEN_UI_SCREENSHOTS="$PWD/.audit/screenshots" \
TMPDIR="$PWD/.audit/tmp" \
node --test --test-concurrency=1 intentgraph/*.test.cjs
```

Use a disposable browser profile: these tests seed localStorage and exercise reload, so they must not share an owner's application profile. With no `AVEN_BROWSER_TOOL`, the seven mounted checks are explicitly skipped. The full run recorded here enables them. When TMPDIR is inside a Git checkout, retain the documented temporary Git-discovery boundary for the existing non-Git-workspace fixture; see the [initial evidence](../README.md).

Seven mounted regressions cover both settled receipts, both missing receipts, mixed settled/missing receipts, actual client outage followed by missing-receipt retry, a genuinely live writer in another tab, rejection of a newer workspace snapshot, and FIFO dispatch after lock release. They assert retained drafts/queues/journals/message identity/annotations/raw data, exact responder counts, one SUCCESS result, exact collapsed code, and served-source hashes. The mixed case uses a 390×844 viewport and keyboard activation of Retry. The six pure browser-state tests include a new same-request reconciliation test; existing storage/protocol tests remain in the full suite.

The three multi-chat arrangements and the duplicate UNKNOWN/SUCCESS result were reproduced against the original browser source before correction. The first combined run also exposed a stale idle HTTP test connection in the mixed case; using `Connection: close` in test setup allowed that case to reproduce independently. The red logs retain this distinction instead of calling the driver error a product defect.

## Tooling and visual evidence

The task-local bridge was corrected under Firstmate steering to retain MCP page-ID routing. Chrome and bridge process identities were checked before restarting only those owned processes. The old `run` helper was never retried. The mounted harness handles successful tab creation followed by the CLI's missing-selection snapshot error by verifying the new page and explicitly selecting it; it closes that page and restores selection afterward.

This MCP/Chrome combination reports successful `resize` without changing the effective viewport. The final checks therefore use `emulate --viewport`, assert actual `innerWidth` and `innerHeight`, and capture screenshots only at the verified dimensions. Browser images are fixture evidence, not approved design references. An existing form-field id/name issue may appear in the console; JavaScript exceptions are checked separately.

## Remaining limits

Windows PowerShell, DPAPI, native SQLite/process liveness, clipboard/IME/UI Automation, packaged restart and physical assistive technology remain **unverified from WSL**. No live provider/device, owner visual acceptance, production durability or customer isolation is established. No pipeline, push, merge, publication or deployment was performed.

The independent review's **evidence-versus-receipt ambiguity remains a nonblocking limitation**. For example, evidence can be saved before terminal receipt settlement fails; recovery may then report UNKNOWN while the saved evidence contains a completed reply. Evidence-file presence or a read-model label must not be treated as proof of a settled admission or remote success. This correction does not redesign that readback model or reinterpret UNKNOWN as success. The requested retry fix applies when the same saved request subsequently receives an authoritative successful response.

The central register preserves all original requirements and its effective verdict counts. This adds scoped recovery/retry/ownership evidence; it does not complete parallel work, resumable tools, clarification, approval, or checkpoints. Future proposal choices remain with `aven-approval-clarification-plan` and are not answered here.
