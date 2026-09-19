# Root handoff: approval bridge

Implemented in this owned directory only. Frozen IntentGraph, workflow and live
product files were not edited.

The production seam is `ApprovalBridge` + `ReviewLedger` in
`approval-bridge.cjs`. Root must inject the real execution service through
`executionFacade.action`, compose `createAdapterStateProvider(execution.adapters)`
with the bridge, and provide the runtime SQLite path. The provider fingerprints
the actual synchronous adapter status plus `browserContextId`, page catalog and
selected desktop window; changes advance generation and revoke pending reviews.
The facade receives `execution.adapter` for both preview and execute; execute
passes the underlying adapter `approvalId` and `token` separately and only once.

Root must apply `root-hook-manifest.json`: put
`assertNoDirectAdapterBypass` before generic `/api/action` execution dispatch,
route `/api/approval-bridge/*` to `createApprovalBridgeHttpApi`, close the
bridge with the server, and mount `createApprovalBridgeClient` plus
`mountApprovalBridgePane` in the existing workspace pane/menu. The manifest
includes the exact `execution.adapter` target seam: browser open/inspect and
desktop windows/select/inspect establish actual targets; no page/window/control
identifiers are guessed here.

The mounted pane is reachable end to end: it lists inspected browser controls
or adapter-listed desktop controls, chooses click/fill, rejects sensitive
browser targets, and sends an explicit `Review action` through the bridge's
`load`/preview path before the existing approve and execute buttons become
available. A root-supplied `getScope` is required for `Connect this target`.

The bridge accepts browser and desktop adapter reviews only. Network/device
writes are rejected until a separate network-specific change scope and recovery
plan seam is supplied. The pane presents human action, adapter-selected target,
bounded current value or unavailable, affected targets, impact limits and
rollback-unavailable truth; digest/session/token values stay out of the main
user-facing review.

The pane also has a bounded read-only network proposal card. Root supplies
`currentAdapterInventory`; the user selects actual device IDs and an allowlisted
diagnostic/proposed-change description. It shows affected devices and explicit
current-value/impact/rollback limits while keeping Execute disabled until a
network write and recovery-plan contract exists. No network or device action is
issued by this card.

Focused verification (bundled Node v24.19.0):

`node --check approval-bridge.cjs` PASS

`node --check approval-bridge-ui.js` PASS

`node --test approval-bridge.test.cjs` PASS, 10 tests / 10 passed. The tests use
an injected recording execution facade and a real local HTTP server; no browser,
desktop, device, provider, shell or credential calls occur.

The code-review skill's Git fixed-point diff was unavailable because this
workspace has no `.git` metadata. A manual standards/spec review against
`round2/CONTRACT.md` and UX-080/UX-114 ledger rows found no remaining owned-file
issue; composed server/UI review remains root-owned.
