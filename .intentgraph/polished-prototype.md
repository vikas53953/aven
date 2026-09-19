# Polished prototype trial P1 — 2026-09-11

## Authority and baseline

User requested the polished prototype as a practical test of IntentGraph's design guidance, experience coverage, and evidence requirements. The accepted layout direction is wireframe v0.7, with requested v0.8 collapse-before-Create refinement in `../intent-map.html`. Source data: `visual-map.json`; preserved v0.7: `baselines/wireframe-v07/`. Final visual styling and Aven branding remain proposed until the user reviews this candidate.

Scope: separate local frontend prototype, preserving the wireframe and its saved user records. Existing Netrok development remains paused. No backend, credentials, real model calls, device execution, or live graph/team telemetry. Root is planner/coordinator; bounded builder and independent reviewer assignments are recorded below. Assignment is not evidence of continuous monitoring.

## Design decisions — proposed visual direction

| ID | Decision / intent | Demonstration and limitation |
|---|---|---|
| D1 | Retain the accepted navigation, centered conversation, right workspace and central creation flows | Full-window product view; original wireframe stays available separately. No review rubric inside the product's chat. |
| D2 | Quiet dark neutral surfaces, restrained blue action accent, deliberate text hierarchy | Readable body, secondary labels, grouped controls, fluid composer. Also inspect the light theme. No mandated external font dependency. |
| D3 | Consistent line icons; separate small Aven wordmark and interactive agent identity | Original avatar treatment is a proposal, not verified Muse artwork or final brand approval. Collapse immediately precedes common Create; Search below. |
| D4 | Preserve task and state across navigation and window sizes | Desktop beside-pane layout; small-screen workspace overlay with an obvious return and keyboard handling. |
| D5 | Explain behavior through modest transitions, focus and textual feedback | No decorative continuous motion; reduced-motion preference preserves meaning. |

Alternative retained: a light neutral workspace via Appearance. Rejected for this checkpoint: new navigation/feature concepts, a marketing landing page, and copying the old rejected prototype. The user delegated polish of the accepted structure, not another broad concept round.

## Experience coverage and acceptance criteria

| ID / journey | Expected behavior | Required evidence |
|---|---|---|
| P1 / J1 Orientation | D1–D3: brand distinct from agent, left top collapse/Create/Search order, no agent plus, all accepted destinations; clean center/chat/composer, right workspace | Rendered desktop comparison with v0.8 and inspection at wide and narrow sizes |
| P2 / J2 Conversation | New chat; choose one or multiple locally created agent profiles; enter text and select/remove file/image; save locally; switch and return without mixing drafts/messages/attachments | Executed journey, reload, ownership checks; no live dispatch/upload claimed |
| P3 / J3 Organization | Shared Create offers chat, agent, channel, project; non-chat creation occupies center; cancel returns; channels contain threads; Search centered with filters and working results | Create/cancel, duplicate/empty validation, filtered search and result navigation |
| P4 / J4 Agent workspace | Avatar opens right; profile switch; SOUL/MEMORY open as agent-owned documents with local save/cancel and return; artifact ownership distinct | Two-profile document isolation, save/cancel, reload; artifact in sample chat only |
| P5 / J5 Settings | Right settings dialog categories reachable; appearance/save/cancel and persistence meaningful; no fake connected provider | Keyboard opening/closing, focus restoration, theme screenshots and reload |
| P6 / J6 Tools and states | Browser, plugin, computer accessible from composer and right tabs; simulated preview loading/error/retry/cancel/success states clearly labeled | Actual local state transitions, cancellation/repeated-input checks; zero runtime execution claims |
| P7 / J7 Responsive and accessible operation | No unintended overflow or inaccessible primary controls at 1920, 1440, 390 and 320 CSS widths; visible focus, named icons, dialog keyboard escape; reduced-motion; measured text contrast | Browser geometry and screenshots at 1920/1440/1024/768/390/320 widths, keyboard/DOM and reduced-motion checks, light/dark contrast token matrix for body/muted/action/selected/focus/disabled (disabled recorded separately). Limited checks, not conformance audit. |
| P8 / J8 Reviewability | User can open original wireframe, polished product and a concise three-layer review map; evidence points to exact candidate | Review page links and candidate manifest. Neither review page nor green tests imply user acceptance. |

Feed/Ideas/Goals remain navigable scope-limited empty states. They are not new full product modules. Real agent execution, real browser/computer streams, server uploads and complete assistive-technology evaluation are excluded and must remain explicit.

## Roles, evidence and verdicts

### Plan review corrections before builder release

- Entrypoints: `../polished.html`, `../polished.css`, `../polished.js`, and root-owned `../prototype-review.html`. Keep the new controller in an IIFE/module; reuse existing behavior by porting it, without loading the old global runtimes into the new page. Candidate manifest hashes all new sources and review artifacts.
- All polished localStorage keys begin `aven-polished-`. In isolated QA seed sentinel records in `aven-wireframe-*` and `intentgraph-*`, snapshot them, exercise polished journeys, and compare byte-for-byte afterward. Never migrate, overwrite, or clear the user's existing records. Test new namespace reload behavior.
- P2 attachment contents are session-only; filenames in saved messages persist. After reload no retained file bytes or actual upload may be claimed. Selected unsent files should receive an explicit reattachment explanation after reload if their names are retained.
- P4 closing or Escape with edited SOUL/MEMORY must retain the draft for the right agent or offer save/discard/stay; Cancel explicitly discards. Test another agent cannot inherit the first agent's text, and another chat cannot inherit sample artifacts.
- P6 state previews are deterministic and labeled sample/no external request. Exercise idle → loading → success, idle → loading → error → retry, cancel, reset, and repeated activation. No invented live activity.
- P7 includes 1920, 1440, 1024, 768, 390 and 320 CSS widths; a light/dark contrast token matrix for body/muted/action/selected/focus/disabled; reduced-motion inspection. Disabled appearance is recorded separately, not falsely claimed as an applicable normal-text conformance check.
- Review page exposes the three requested method layers (design guidance, journey coverage, evidence) and links original intent/reference records, accepted wireframe, and candidate/evidence. It is an external review surface, not a team telemetry dashboard.

### Traceability to existing records

The historical C-01–C-07 criteria belong to the rejected initial prototype and are not the current acceptance baseline. Links below identify relevant concerns without promoting that old verdict or its excluded simulated execution features.

| Current criteria | visual-map.json areas | Related historical concerns |
|---|---|---|
| P1 | branding, avatar, navigation, composer, workspace | C-01 |
| P2 | composer, agents, organization | C-01, C-04 |
| P3 | navigation, organization, agents | No complete historical equivalent |
| P4 | avatar, workspace, artifacts, agents | C-02 |
| P5 | settings | C-05 |
| P6 | tools, computer | C-03/C-04/C-07 scope distinctions only; no device execution |
| P7 | All rendered regions and journeys | C-06 |
| P8 | All 11 areas, source/interpretation/evidence distinctions | C-07 observability concern only |

- Root: plan, integration, test, rendered inspection, shared records.
- `polish_plan_review`: PLAN_APPROVED after two narrow revisions covering storage, ownership, deterministic state evidence, contrast and source traceability.
- `polished_builder`: assigned only polished.html, polished.css, polished.js/new polished assets; isolated controller, shared baseline and criteria. Root owns evidence/review records. Assignment is recorded; no continuous watch claim.
- `polished_independent_review`: independent Chrome/screenshot/code review completed; identified channel cancel context loss and pending evidence population. Root corrected both; narrow reviewer recheck recorded in polished-independent-review.md.
- Candidate identity: polished-candidate.json. Final root run: `node .intentgraph/verify-polished.cjs`, exit 0, eight check groups passed on stable source hashes. Screenshots, contrast measurements and commands are linked from polished-test-results.json and polished-evidence.json. Earlier build-time runs were exploratory. Root inspected dark/light and narrow screenshots plus the actual in-app view.
- User experience approval: pending.

## Learning test

Check whether a fresh builder can reproduce the accepted structure from the packet, and whether independent review detects meaningful omissions and mismatches. Record failures and corrections instead of measuring success by agent agreement. A successful local trial supports this slice only; it does not establish reliability across projects or implement live graphs/hooks.




## Final checkpoint

Candidate P1-9c459aadeb52 is ready for user visual review. All eight root verification groups pass on stable hashes; independent review findings were corrected and the reviewer independently confirmed the channel/project return path and evidence-page population. Full evidence is linked from polished-evidence.json; exact hashes from polished-candidate.json. User approval remains pending. No further backend, graph or enforcement capability is implied.
