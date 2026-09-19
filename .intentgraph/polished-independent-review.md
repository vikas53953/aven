# Independent polished candidate review

Review date: 2026-09-11 (Asia/Calcutta). Candidate was stable across a hash recheck before review.

Candidate identity:

- `polished.html` SHA-256 `3B9FEEBB5D6E0ED96E0CE05FDBE1A35690FF53D16EBC7DC6D7CF6D0AC1BD4CCA`
- `polished.css` SHA-256 `F57E60F37A5BD41526306C53EECB122F17538F567393E3EEE255E6D3086276CE`
- `polished.js` SHA-256 `B063B6588BCC0CC03E6297A21103430B699AE7A1761F81D8802671747D4AE219`
- `prototype-review.html` SHA-256 `E6E511BB36EB1116DF6C8F6CAD3B71F02DB2780D7AEB2CB7A275BCC10A97CBFE`

## Verdict

`GO WITH KNOWN RISK` for this local visual prototype after the one P3/J3 correction below. The accepted wireframe structure is preserved, the visual candidate is visibly polished in dark and light themes, and the inspected local flows are honest about sample-only behavior. This is not user acceptance, live agent validation, or an accessibility conformance claim.

## Findings

### P1 / P3-J3 — Cancel loses the channel context

- Location/state: `polished.js:254-261`, after creating a project and channel, then opening `# Policies` → `+ New thread` → `Cancel`.
- Evidence: isolated Playwright Chrome run in `review-polished-results.json`; the final surface was `Branch network review` rather than `# Policies`. The candidate wires every create form's Cancel to `showChat(data.activeChat)`, so a thread form has no return context.
- Consequence: a user leaves a channel after a harmless cancel and must rediscover it. The organization journey does not return to the surface that owns the operation.
- Correction: retain the originating directory/entity in `createWorkspace` context and have Cancel restore `showDirectory('Channel', context.channelId)` (or an equivalent return callback) for a channel thread; preserve the same behavior for project-scoped creation.
- Confidence: high; runtime reproduced against the exact candidate hash above.

### P2 / P8 — Review evidence JSON is missing at this snapshot

- Location/state: `prototype-review.html:18`; `/.intentgraph/polished-evidence.json` was absent.
- Evidence: opening `prototype-review.html` rendered the three requested review layers and source links, but the fetch produced a 404 console error and left the checkpoint results in the pending state.
- Consequence: the review page cannot show the candidate-specific checks until the root-owned evidence artifact is present.
- Correction: add the final `polished-evidence.json` manifest and re-open the review page to verify the rows and screenshot links populate. Treat this as a review-artifact gate, not a polished app runtime defect.
- Confidence: high; file existence and browser request were checked directly.

## Journey and visual coverage

The isolated Chrome review used `require('playwright')`, Chrome headless mode with the requested executable/flags, no external requests, and fresh contexts seeded only with sentinel records outside the Aven namespace. Screenshots are under `.intentgraph/review-polished-*.png`.

- P1/J1: accepted collapse → Create → Search order, centered conversation, right agent workspace, distinct Aven/agent identity: PASS.
- P2/J2: local draft, multi-agent recipients, file/image attach/remove, local send, reload ownership, and unchanged sentinel storage: PASS. Unsent reload retained only the filename and showed the required reattach notice; send stayed disabled.
- P3/J3: project/channel creation and channel thread creation worked; Cancel context return: FAIL as above. Search/tool menu/artifact navigation were additionally exercised and stayed local.
- P4/J4: two-profile SOUL ownership, save/cancel/Escape behavior, reload persistence, and sample artifact ownership: PASS.
- P5/J5: all six settings categories, light theme persistence, Escape close, opener focus restoration: PASS.
- P6/J6: browser/plugin/computer sample idle → loading → success → error → retry, reset, cancel, and no external request: PASS.
- P7/J7: 1920/1440/1024/768/390/320 widths, pane overlay/inert state, focus trap, no horizontal overflow, visible named controls, reduced motion, and light/dark rendered-label contrast check: PASS for the inspected scope; this is not WCAG conformance.
- P8/J8: review links and three-layer structure: PASS; candidate-specific evidence population remains pending until the JSON artifact exists.

Static inspection also confirmed sample content, local-only persistence, provider/connection disclaimers, no live agent/browser/computer execution, and unchanged accepted wireframe sources via `.intentgraph/polished-baseline-hashes.json`.

Not run: assistive-technology sessions, packaged Electron behavior, real provider/model calls, server uploads, live browser/computer control, and user visual acceptance.

## Scoped post-fix re-review

Rechecked after the root fixes without rerunning the broad suite. Current stable hashes are:

- `polished.html` `3B9FEEBB36EB1116DF6C8F6CAD3B71F02DB2780D7AEB2CB7A275BCC10A97CBFE`
- `polished.css` `F57E60F37A5BD41526306C53EECB122F17538F567393E3EEE255E6D3086276CE`
- `polished.js` `DE66E85F2CA7A93FC347EDBE67F5379383348899AA691C196D4532BA8FE3D493`
- `prototype-review.html` `E6E511BB36EB1116DF6C8F6CAD3B71F02DB2780D7AEB2CB7A275BCC10A97CBFE`

The P3/J3 finding is resolved. A fresh isolated Chrome flow now returns Cancel from `# Policies → + New thread` to `# Policies`; project-scoped Cancel returns to `Branch rollout`; a scoped `New chat` created from the channel persists both its `channelId` and owning `projectId`; and a created channel inherits the project. The run had no page errors.

The P8 evidence gap is resolved at the current snapshot. `prototype-review.html` fetched `/.intentgraph/polished-evidence.json` with HTTP 200 and rendered 10 rows: 8 PASS plus the two expected PENDING rows for independent experience review and user visual decision, with no page errors.

Scoped re-review verdict: `PASS` for the two corrected findings. No remaining implementation blocker was found in this narrow recheck. Overall release status remains conditional on the explicitly pending user visual decision and independent-review row update.
