# IntentGraph trial — what improved

## Current decision
P2-612c88cacd5b is built against feedback-07: agent-first creation, expandable project conversations, centered popups/settings, account and context menus, and a Grok-informed neutral palette. Ten root check groups and five independent check groups pass on the recorded sources; user visual approval remains pending. The user previously accepted the wireframe direction; v0.7/v0.8 and P1 are preserved. That earlier acceptance does not override the latest feedback. Aven remains a working wordmark.

## Feedback and resulting changes
1. **Reference mismatch:** moved from inferred marketing-page layout to the user's exact walkthrough and native Grok Bot inspection. Observations, user requests and adaptations are labelled separately.
2. **Identity and layout:** separated app name from agent avatar; kept conversation central; moved agent details and outputs to the right. Avatar artwork and motion remain unfinished.
3. **Navigation:** grouped destinations; refined icons; consolidated Create; put Search beneath it; aligned the collapse control with its left-sidebar scope.
4. **Complete interactions:** replaced explanatory-only controls with central creation flows, settings pages, filtered Search, cancel/return behavior and saved local preferences.
5. **Agents and conversations:** added local profiles, multiple chat recipients, chats, projects and channels containing threads. Verified drafts/messages/attachments stay with the right chat.
6. **Tools and outputs:** separated agent documents, artifacts, plugin connection previews, Browser and Computer. Added actual local file/image selection with previews and removal.
7. **Evidence and acceptance:** kept user approval distinct from functional test results. Preserved versions, original feedback and unresolved choices. Latest layout acceptance does not mean runtime or final product acceptance.

## What is reusable
`$intentgraph` is an installed skill at C:/Users/vikasmit/.codex/skills/intentgraph/SKILL.md. It is workflow guidance plus supporting references and a project-record template, not one executable script.

This checkpoint promotes the cross-project lessons into the skill and its references/reference-coverage.md: test complete opening journeys; make control scope legible; validate ownership and state isolation; distinguish selection from execution; preserve accepted versions and unresolved branding; distinguish project records from skill updates and enforcement.

The following clarification checkpoint also made original-idea support explicit in the skill, project template and references/original-design.md. A project may start from user scenarios and competing visual concepts; the accepted concept becomes its reference. External products are optional. This route has been documented and structurally validated, but has not yet been tested on a separate original-idea project.

Earlier feedback is retained in feedback-01.md through feedback-06.md, along with reference-video-01.md, reference-grokbot-01.md, visual-map.json and evidence.md. Those project records are separate from the global skill. Product-specific sidebar positions, names and settings categories are not made universal skill rules.

## Design guidance checkpoint — 2026-09-10

The user authorized strengthening IntentGraph with design fundamentals, complete experience coverage, and evidence requirements. The global skill now routes UI work to `references/experience-design.md`; its project template now records design decisions and journey coverage linked to intent, criteria, and evidence.

Added guidance covers typography, spacing, hierarchy, color, icons, layout, responsiveness, accessibility, interaction, motion, and content/recovery. It requires observable design choices, applicable states and ownership checks, and evidence appropriate to each claim. It preserves ordinary-language intent, reference-free design, accepted layouts, and project-specific style choices. A checklist or screenshot does not establish complete UX or accessibility conformance.

This is a skill/documentation update. The Aven wireframe and accepted baseline were not changed; no new UI or runtime capability was built. The next practical test is the bounded polished prototype and an independent comparison. Improved outcome reliability has not yet been demonstrated.

## Pending at the wireframe checkpoint (historical)
- A visual prototype with final typography, spacing, icon treatment, avatar/logo decisions, motion, and representative loading/empty/error states.
- Real AI agent execution, uploads, provider connections, browser/computer control and shared collaboration.
- Live code graph, live agent-team dashboard and enforcing hooks. The existing code index is a manual file snapshot.
- A fresh builder/independent acceptance experiment against the accepted visual baseline. Structural skill validation and local browser tests do not prove that this workflow will reliably prevent future product drift.

Recommendation: no more speculative navigation or features in the wireframe. Use it as the layout/interaction baseline for one bounded, polished visual prototype, then compare before backend implementation.

## Polished prototype trial — 2026-09-11

The user authorized the practical test. A separate polished frontend now lives at `../polished.html`, with `../prototype-review.html` connecting the original intent/reference records, unchanged wireframe, three method layers, and candidate evidence. It uses its own `aven-polished-` storage namespace. The accepted wireframe and its user records were not migrated or edited.

The candidate preserves the conversation/sidebar/right-workspace model and adds proposed visual styling, an original avatar treatment, local agent document editing, and deterministic tool state previews. Chat/profile/project/channel creation, attachments, filtered search, settings and theme persistence are exercised locally. Feed/Ideas/Goals remain explicitly scoped empty states. No live AI or device/browser/computer operations were added.

The trial caught actual regressions before user review: creation placement drift, New Chat requiring an extra form, modal Escape handling, stale tool preview state across contexts, overflow from an invisible tooltip, clipped narrow-screen controls, cramped document labels, and a hardcoded light-theme label color. Fixes and tests are tied to the candidate through `polished-test-results.json` and the candidate manifest. Early runs during builder edits were exploratory, not final acceptance verdicts.

Learning: a detailed shared brief and fresh builder did not eliminate drift. Executed journeys and rendered inspection were still necessary. A passing color-token matrix missed a hardcoded message label; the added rendered-label check demonstrates why both are needed. This is evidence that the review loop found problems in this slice, not proof of reliable delivery across future projects.

Current scope and final evidence: `polished-prototype.md`, `polished-evidence.json`, and `polished-independent-review.md`. User acceptance of the polished styling, avatar and branding remains pending. Live graphs, team telemetry, enforcing hooks and backend integrations remain unbuilt.

# P2 feedback checkpoint — 2026-09-11

The user tried P1 and requested an agent-first interaction model. See `feedback-07.md` for the criterion map and native Grok Bot observations. Existing wireframe/P1 acceptance and engineering evidence are historical, not evidence that the new direction is accepted.

Lessons from this iteration: passing a creation test does not prove that the creation flow has the right number of steps; navigation must preserve conversation context; background records and visible hierarchy must agree; application settings and agent details have different locations; a visual rejection remains changes requested even after technical checks pass. These are recorded project lessons. No new global skill update, enforcement hook or live graph is claimed in this revision.

P2 implementation evidence: popup success originally returned to the old conversation, startup could overwrite a stored draft, settings retained old corner positioning, and the resize separator was positioned against the viewport. The root review found and corrected these regressions. Root checks now cover migration, creation, keyboard sending, settings, preserved document/attachment/tool flows, six viewport widths, resizing, profile context actions and protected source files. Independent checks additionally confirm project moves do not move channel conversations, and hide/delete recovery retains evidence. These results are scoped to the local prototype; they do not certify live agent behavior or substitute for the user's visual decision.


# P3 feedback checkpoint — 2026-09-11

The user rejected partial treatment of P2 feedback. The exact request is retained in feedback-08-original.txt; feedback-08.md gives each requested correction an ID and audits all ten previous-round criteria. P2 source and evidence are preserved in baselines/polished-p2/.

P3 changes: remove the composer recipient selector; permanently fill Search and hide section chevrons until hover/focus; add eight original network avatar styles, colors, procedural Generate, validated local Upload and Reset; stage avatar/name/label/description/notifications in the right-side Edit Profile pane; keep Name/Role/Project in centered creation; move timezone/auto-review to one Settings category; complete all six username-menu actions with icons; move the avatar beside the title and derive new conversation titles from their first message.

Lessons recorded: a visible control is not evidence of a complete interaction; separately verify entry point, placement, editable state, Save, Cancel, reload and agent isolation. Preserve exact user language and the interpretation beside it (the spoken “two-button” was treated as “To:” selector). Inspect the actual reference control before translating it. Review test assumptions too: edit-profile fields and agent documents are different states, pinned placement takes precedence over sections, and modal dismissal and CSS transitions require realistic test steps. An invisible tooltip caused narrow-screen overflow; inspecting another agent exposed conversation-identity coupling. Both required behavioral corrections.

These are project iteration records. No new global skill update, automatic graph, background watching team or enforcement hook is claimed. Network Generate is a local procedural design variation; it does not call an image model. Avatar uploads are validated and saved locally. Account authentication and live AI/browser/computer actions remain unconnected. Technical evidence and the user's visual decision remain separate.


# P4 avatar and section checkpoint — 2026-09-11

The user accepted the composer and username settings, and requested direct profile editing, immediate avatar reflection, larger animated sidebar identities, an above-composer attachment menu, and rename/collapse for custom sections. See feedback-09.md. The withdrawn fifth item was deliberately excluded. P3 source and evidence were archived under baselines/polished-p3/.

Learnings: visual approval of an avatar chooser did not establish the expected persistence model. The owner expects selection to apply directly, so profile changes now save individually without a second Save action. Agent and app/document settings have different persistence expectations; document/settings Save controls remain. A section is a user-managed object, so it needs a stable identity, rename, collapse state, keyboard access and persistence—not merely a decorative label. Popup placement is checked against the composer rectangle rather than against the viewport alone. Motion is original SVG animation, with reduced-motion and uploaded-photo boundaries.

These are project records; no global skill edits, live graph, team dashboard or enforcement hooks were added. Local procedural avatar generation and unconnected backend capabilities remain explicit.

## Avatar family expansion

Owner approved the first four and authorized expansion. Sixteen editable SVGs, generated React wrappers, nine presentation states, six size previews and picker integration delivered as AV2-ae8ad3e219bd. Saved colors/photos and legacy role aliases verified. First four geometry remains exact; approved preview is frozen. Expanded-family visual review remains pending. Live code graph, team dashboard and enforcing hooks remain unbuilt.
