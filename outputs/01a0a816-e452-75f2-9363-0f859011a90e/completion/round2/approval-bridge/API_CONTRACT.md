# Approval bridge contract (UX-080 / UX-114)

This assignment is an integration seam for the root-owned server and shell. It
does not modify the frozen IntentGraph server or adapter files.

## Server seam

`createApprovalBridge({ executionFacade, adapterIdentity, allowedOrigins, now,
tokenTtlMs, workflowTtlMs })` owns a memory-only `ConnectionManager` and
returns:

- `connect({ origin, scope, adapterIdentity, manualReviewOnly })`
- `disconnect(context)`, `reload(context)`, `rotate(context)`
- `preview(context, request)` -> scoped preview with `previewToken`, `digest`,
  `adapterDigest`, target scope, bounded current value, fixed impact and
  rollback-unavailable truth
- `review(context, { previewToken })`
- `approve(context, { previewToken })` -> one-time `approvalToken`
- `execute(context, { approvalToken, digest })` -> adapter result or terminal
  `UNKNOWN` after the underlying adapter token is consumed
- `cancel(context, { previewToken?, approvalToken? })`

`executionFacade.action({ type: 'execution.adapter', operation })` is the only
execution call. Production composition injects the existing execution service;
tests inject a recording facade. The bridge never starts a workflow/model run.
The preview's underlying `approvalId` and `token` are captured separately in
memory and both are passed unchanged to the existing adapter execute call.

The bridge uses an explicit `ReviewLedger` seam (`storagePath` or injected
ledger). Its SQLite rows contain only sanitized receipt metadata: digest,
adapter digest, execution mode, target scope, session/generation, expiry, status,
impact and rollback. Raw scoped tokens, underlying adapter tokens and fill text
are memory-only. On process reload active rows become terminal `unknown`; on
connection rotation/reload/disconnect they become `stale`. This seam is
deliberate because the existing durable `ApprovalWorkflow` owns a different
question/proposal lifecycle and cannot safely revive an adapter token.

The production execution facade must expose the actual `ExecutionAdapters`
instance. Compose `createAdapterStateProvider(execution.adapters)` and pass the
returned synchronous provider as `adapterState`; it calls the adapter's
synchronous `status()` and fingerprints `browserContextId`, page catalog,
selected desktop window, connection and closed state. Changes advance the
adapter generation and revoke pending reviews. Caller-supplied identity is
compared against that state; it is never accepted as proof by itself. The
preview's derived `adapterTarget` and `adapterContext` bind the actual page or
selected-window fingerprint into the scope digest; a caller cannot substitute a
different page/window/control.

## HTTP seam

`createApprovalBridgeHttpApi({ bridge })` handles these paths:

`POST /api/approval-bridge/connect`, `/disconnect`, `/reload`, `/rotate`,
`/preview`, `/review`, `/approve`, `/execute`, `/cancel`, and `GET
/api/approval-bridge/status`.

Every applicable request must have all of these exact values:

- `Origin` equal to the connected origin;
- `X-Aven-Approval: approval-bridge`;
- `X-Aven-Approval-Token` (memory-only scoped token);
- `X-Aven-Approval-Session`, `X-Aven-Approval-Generation`,
  `X-Aven-Approval-Connection`;
- `X-Aven-Approval-Scope` equal to the connection scope key.

The root-owned `/api/action` route must call `isDirectAdapterOperation` (or
`assertNoDirectAdapterBypass`) before dispatch and reject browser/desktop
`preview` and `execute` operations with `403`; those operations are reachable
only through this bridge.

## UI seam

`mountApprovalBridgePane(container, bridgeClient, {getScope, adapterIdentity})`
renders a small review pane with explicit browser URL open/inspect, adapter-listed
desktop window select/inspect and target connect controls;
`createApprovalBridgeClient({basePath, origin, currentChatId, getMode,
adapterClient})` owns the in-memory request context and sends the exact headers.
Its adapter-client methods delegate target setup to the existing browser
open/inspect or desktop windows/select/inspect paths; the bridge never guesses a
page, window or control identifier. `connectCurrent` requires an established
adapter target and a root-supplied current scope. Agent maps to `inspect` and
Plan maps to `plan`; only an explicit `write` review can call
preview/approve/execute.
The pane's `Review action` builds a bounded operation from inspected browser
controls or desktop controls and calls its returned `load(request)`; no raw DOM,
selector, control id, digest or token is rendered as the main user review.
`APPROVAL_BRIDGE_MENU_ACTION` is the menu entry metadata. The pane labels browser
work as an adapter-owned headless browser context, surfaces bounded current
value or unavailable, and says that chat revert cannot roll back an executed
device or browser action. It never writes tokens to browser storage.

The pane also accepts a root-supplied `getInventory()` callback for a bounded
read-only network proposal card. It only lists returned device IDs and
allowlisted diagnostic/proposed-change descriptions, reports current value and
impact as unavailable when no bounded capture exists, and keeps execution
disabled until a separate network write plus recovery-plan contract exists; it
does not issue a network or device action.
