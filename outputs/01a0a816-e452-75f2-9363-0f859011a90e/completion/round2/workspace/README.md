# Workspace capability candidate

Load `workspace-capabilities.css` and `workspace-capabilities.js` from the
polished shell using the two exact entries in `replacements.json`. The module
publishes `window.AvenWorkspaceCapabilities` (and CommonJS exports for unit
fixtures). The exact `polished.js` replacement calls
`installWorkspaceCapabilities` after the existing interaction wiring, passing
the current `#pane-content`, `#composer`, `#file-picker`, and `#draft` seams.
The adjacent `polished-workspace-tools.js` replacements mark generated files,
show their provenance, and add a scoped sandbox-preview action to the existing
artifact cards.

The bridge is intentionally explicit:

* `createExecutionBridge({ getStatus, invoke, authorization })` maps the
  existing `executionService.status()` adapter report. Browser pages and a
  selected desktop window become connected only when the caller supplies an
  explicit authorization flag. `call` never runs until that flag is true.
  `createHttpExecutionBridge` provides the concrete backend loopback
  `/api/workspace/connect`, `/api/workspace/status` and
  `/api/workspace/read` transport. A user click sends an exact-origin,
  read-only connection request; the returned workspace token stays in the
  bridge closure, expires after 15 minutes, is cleared by `disconnect`/reload,
  and is accepted only by the read route. The server binds each token to its
  requested browser, computer, or workspace scope. The matching server hunk
  accepts the polished UI origin (`http://127.0.0.1:8767`) for connection,
  keeps the existing `/api/action` guard unchanged, and never reuses its
  action token. `AvenExecutionAuthorization`
  is a mutable approval map updated only after the explicit connection click.
  Browser and computer panes expose Connect, Inspect, and Disconnect controls;
  terminal remains read-only unavailable because the current adapter contract
  has no terminal operation.
* `bindAttachmentSources` adds one-file drag/drop and clipboard-file paste to
  the existing attachment reader. Rejected and oversized records remain
  visible for removal through `renderAttachmentChips`.
* `createWebSpeechDictationAdapter` lazily detects the browser's native speech
  capability without starting it. The shell uses that adapter only when the
  capability exists, after an explicit user click, and discloses that browser
  speech services may receive audio under browser/provider privacy settings.
  `createDictationController` still renders an honest unavailable state when no
  capability exists and exposes recording, cancel and editable review states.
* Generated files require `chatId`, `messageId` and filename provenance.
  `collectGeneratedFiles` deduplicates aliases mirrored in `generatedFiles`,
  `files`, and `artifacts`. `openGeneratedFile` enforces selected-chat scope
  and uses one reusable sandboxed, CSP-limited HTML iframe or text/image
  preview. Unsupported media stays a labeled file.
* Inventory records can come from the saved workspace inventory and retained
  inventory evidence. Stable IDs are shown beside each mention, disconnected
  devices remain disconnected, and `Use stable ID` replaces an alias in the
  draft so the exact ID reaches the reviewed request context. The adjacent
  `agent-runtime.cjs` candidate also accepts that optional ID, rejects an
  ambiguous hostname or a hostname/ID mismatch, and retains `targetId` in
  sanitized inventory, result and evidence records.
* `normalizeTopology`, `renderTopology`, `normalizeEvidence` and
  `compareDiagnosticRuns` keep source/freshness/provenance visible and retain
  missing output as `missing` rather than coercing it to an empty result.
* `renderSafeMessage` creates HTTP(S) links with safe opener attributes and
  renders all other text as text nodes, so HTML and unsafe schemes remain inert.

No provider, device, browser, computer, terminal, credential or external
network call is made by this candidate during tests. `workspace-capabilities.test.cjs` uses
only injected mocks and memory values. The isolated
`workspace-capabilities.browser.test.cjs` uses a synthetic DOM, aborts every
route, and injects only candidate/baseline fixtures; it verifies the reachable
pane, mention, attachment, dictation, generated-file, topology, safe-content,
resizer, and full polished-shell initialization states. The shell route
responds only to mocked workspace connect/status/read requests and asserts that
the action token is absent. `workspace-capabilities.server.test.cjs` applies the
candidate server replacements to a temporary IntentGraph fixture and verifies
exact-origin connect, token separation, read-only operation validation, and
unchanged action boundaries without invoking an external adapter.
`agent-runtime.stable-id.test.cjs` applies the runtime replacement in another
temporary fixture and verifies duplicate-alias rejection, exact ID dispatch and
hostname/ID mismatch rejection with injected mocks.
