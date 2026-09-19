# Trial 01 evidence

## Plan review
- Reviewer: independent Advisor `prototype_plan_review` (Terra).
- Verdict: PLAN_APPROVED, 2026-09-10.
- Scope: bounded local clarification prototype, honest lab labels, no device/model access, original Netrok untouched, user visual baseline pending.
- This is plan review, not acceptance of the running UI.

## Implementation and runtime
- Builder: `build_visual_prototype` (Luna), exclusive ownership of index.html, styles.css, app.js.
- Coordinator owns project records, local serving, and verification.
- Runtime checks: executed through the in-app browser against http://127.0.0.1:8767/.
- User experience approval: pending.
- Subsequent user verdict: changes requested (feedback-01.md). Functional passes below remain limited technical observations; the prototype failed to establish the desired reference experience.

## Executed checks
| Criterion | Observation | Result |
|---|---|---|
| C-01 | Composer measured 1626px at 1920px window; main pane 1682px | Pass for proposed responsive behavior |
| C-02 | Typed draft survived evidence open/close and reload; 1440px evidence shares space with chat | Pass |
| C-03 | Approved first simulation, created alternate, rejected it; both decisions retained in activity | Pass |
| C-04 | Arbitrary submitted text returned explicit local-save/no-live-agent note | Pass |
| C-05 | Changed to dark and Atlas Lab; reload preserved values; restored Atlas/light afterward | Pass |
| C-06 | Document widths equal viewport at390,820,1440,1920;390 panel inspected visually | Pass for inspected states |
| C-07 | Activity listed actual approval, alternate proposal, rejection, and settings changes | Pass for inspected actions |
| Feedback | Test note survived reload; removed the test note afterward | Pass |
| Plan selection | New alternate remained selected as draft after reload instead of reverting to decided first plan | Pass after review fix |
| Keyboard | Tab from final settings control wrapped to Close; Escape restored Open settings focus | Pass after review fix |

Browser console showed no errors after corrections. `node --check app.js` passed. PowerShell launcher syntax parsed successfully; static server returned HTTP200. Launcher process spawning itself was not exercised because the preview server was already running.

## Mismatches caught and corrected
- Composer initially capped by a960px wrapper: removed wrapper cap; remeasured.
- Desktop evidence overlaid chat: added shared desktop layout.
- Intermediate820px window became too narrow: shared layout now starts at1100px;820 overlay preserves582px main pane.
- Oversized SVG in evidence action: constrained button icons.
- Artifact title/subtitle ran together: separate block rows.
- Independent engineering review identified focus handling, selected-plan persistence, and insufficient stored-plan validation. Root added focus containment/background inertness, opener restoration, persistent selection, and full field/decision validation.

## Coverage limits
This validates a local browser prototype, not AI quality, network execution, background agents, full accessibility compliance, or fidelity to the authenticated Muse desktop UI. No actual Meta login was performed. Feedback JSON download exists but its downloaded file was not inspected. User acceptance and the deliberate seeded-mismatch experiment remain pending. No live graph or enforcing hook was tested.

Candidate identity: source hashes in code-index.json. Preview screenshot: preview.png, captured from a clean browser profile at1440x900; it depicts initial sample state, not the tester's activity history.

## Independent re-review
`prototype_code_review` re-read the corrected files and reported no remaining blocking findings within the inspected scope. It confirmed fixes for focus handling, plan selection persistence, stored-plan validation, and the medium-window layout. This is engineering review of the prototype, not user experience approval.

## Visual interpretation map v0.2 — 2026-09-10
- Added intent-map.html and intent-map.js with canonical data in visual-map.json. This is an interactive clarification artifact, not a full-screen redesign of the product.
- The five indexed areas distinguish user wording, reference observations, mismatches, proposals, gaps and acceptance demonstrations. Timestamp links lead to the exact user walkthrough. Schematics are labelled as interpretations, not captured reference images.
- Browser exercised sidebar expansion, Feed selection, avatar entry, MEMORY.md workspace and switching settings/composer review sections. Corrected the schematic so opening a document hides chat bubbles/composer.
- A temporary settings note persisted through reload and was then cleared. No user review decision was fabricated. Export control is implemented; downloaded export contents were not inspected.
- Page width was1265 for1280 viewport and375 for390 viewport in the inspected states; narrow screenshot inspected. HTTP returned200; JavaScript syntax check passed before the final small document-view correction, then repeated afterward.
- Full settings reference, avatar transition/artwork/motion, expanded navigation details, browser/computer panels and exact send states remain unresolved. User baseline approval is pending.

## Interactive wireframe v0.3 — user-feedback iteration
- Added header branding placement, consistent SVG navigation icons with hover/focus labels, a revised send control and central chat with right-side agent/artifact/browser/plugin views.
- User-directed right-hand placement is recorded in feedback-02.md and visual-map.json; no claim this placement matches the reference. v0.2 data retained separately.
- Browser exercised document and web artifact previews, browser result preview, plugin connection-state preview, SOUL.md return, panel close and message preview. A typed draft survived these panel changes before being sent within the wireframe. No external request or connection occurred.
- Desktop measurement: chat ends at881px; right panel starts at893px. Narrow test caught clipping despite no page-level overflow; fixed panel width. At390px viewport, chat and right panel both end at350px within the360px canvas boundary.
- JavaScript syntax check passed. Final candidate file hashes recorded in code-index.json. Validation is root self-review of the wireframe, not independent review or user acceptance.
- Full visual styling, avatar/logo artwork, actual editor/settings behavior and live integrations remain pending. Earlier v0.2 local review decisions are not reused as v0.3 acceptance.

## Wireframe v0.4 — Aven working name
- Browser inspected refined chat/settings icons, removed duplicate center icon, bottom-left sidebar controls, single left Artifacts entry and distinct Computer workspace.
- Expanded/collapsed left sidebar while right workspace stayed visible. Inspected the two controls adjacent vertically at the bottom-left.
- Exercised Computer preview/return, document and web artifacts through left navigation, and Browser result preview. Draft survived all transitions; temporary QA draft cleared.
- At390px width the right panel ended at350px within the360px canvas boundary. Desktop view restored and updated wireframe left open.
- JavaScript syntax check passed. File hashes refreshed in code-index.json. Root self-review only; revised visual acceptance pending.
- Browser and Computer are illustrated workspaces, not live agent sessions. No external task or desktop action was performed.

## Wireframe v0.5 — settings, profiles and attachments
- In-app browser: navigated all six settings categories; changed theme, saved, created a temporary agent and verified both after reload. Removed temporary profile and restored dark theme. Inspected settings visually.
- Repeatable isolated-browser verification: node .intentgraph/verify-v05.cjs passed using installed Chrome. Edge launch attempts failed before test execution; Chrome completed the full check.
- Verified real file chooser selection of text and image fixtures, decoded thumbnail, attachment removal, attachment-only send, image-specific picker, six settings categories, theme persistence, profile creation, duplicate-name rejection, switching and draft preservation.
- Narrow settings dialog fits a390px viewport. No page errors and no POST requests occurred in the exercised flows. Export download is implemented but not checked by this test.
- Screenshot: settings-v05.png. JavaScript syntax checks passed for intent-map.js and intent-controls.js. Candidate hashes refreshed.
- Root self-review plus automated browser evidence; no independent acceptance review or final user approval claimed. No agent runtime, upload backend, provider integration or desktop execution was implemented.

## Wireframe v0.6 — conversations and agent recipients
- In-app screenshot inspected: Search above agent control, adjacent agent plus, grouped navigation, New chat button and recipient selector. Existing user-created profile retained.
- node .intentgraph/verify-v06.cjs passed in isolated Chrome: sidebar agent creation; project/channel/two-thread creation; two selected recipients; thread message and draft isolation; reload persistence; Search retrieval; per-chat attachment isolation; narrow canvas bounds; no page errors.
- Existing v0.5 browser checks rerun and passed after integration, covering Settings, agent profile persistence and real local file/image pickers.
- Detailed Feed/Ideas/Goals remain explicit placeholders. New chats show no artifacts until outputs exist; original sample artifacts belong only to the initial sample chat.
- Code syntax checks passed; hashes updated. Screenshot conversations-v06.png is an isolated test fixture, not user's actual conversations.
- Root self-review plus automated evidence only. Proposed hierarchy and visual acceptance pending; no live agent dispatch, collaboration or external upload.

## Wireframe v0.7 — native reference inspection and entry points
- Inspected the running Grok Bot desktop window through Computer Use, opened Create, opened Search, selected Messages, then dismissed Search. No reference-side creation or message submission.
- In-app screenshot verified Aven's top Create plus, Search underneath, removed avatar plus, and full central agent setup form.
- node .intentgraph/verify-v07.cjs passed in isolated Chrome: Create above Search, no avatar/right-panel plus, central creation and cancel with draft preservation, agent/chat continuation, project/channel creation, eight search filters, message/file/link matches, settings-management link to central creation, saved data after reload, narrow Search/Settings geometry, and no page errors.
- Search screenshot search-v07.png uses isolated synthetic test records. Native reference contents were not copied into the project.
- Root self-review plus automated checks; no independent acceptance or final user approval claimed. Search remains local; no live agents or uploads.

## Wireframe v0.8 — layout acceptance checkpoint
- User explicitly accepts wireframe layout/interaction direction, requests collapse beside Create, and leaves name/logo open. v0.7 layout artifacts preserved under baselines/wireframe-v07 by reversing only this turn's narrow HTML/CSS/version changes; behavior files copied unchanged.
- Moved collapse before Create in the top-left control row; widened compact rail for usable adjacent targets. Removed empty logo slot, retaining the working wordmark recommendation.
- node .intentgraph/verify-v08.cjs passed: top control geometry/order, left-only expand/collapse, narrow panel bounds. Screenshot wireframe-v08.png. Current hashes refreshed.
- Global intentgraph skill and reference-coverage.md updated with reusable iteration lessons. quick_validate.py reported Skill is valid. This validates structure, not guaranteed outcomes; no independent forward-test was run at this checkpoint.
- Current user acceptance is layout/interaction direction, not final styling, branding, integrations or deployment.
