# Aven — IntentGraph trial 01

## Current state
- Date: 2026-09-12
- Location: C:/Users/vikasmit/Downloads/vikas problems/netrok-muse
- Stage: Sixteen-character avatar family built and integrated into the local prototype. Owner approved the first four; gallery verification passed; final app integration verification passed. See avatar-family.md.
- User authorization: start a separate local Muse-inspired network engineering application here and test IntentGraph. Existing Netrok worktree remains untouched.
- Coordinator/planner/prototyper: root task. Advisor: prototype_plan_review. No background product agents are running.
- First slice: a network incident conversation, evidence drawer, draft plan, and explicit simulated check decision.
- Backend/model/device access: not implemented. No credentials or external model calls required for the prototype.

## Original intent
I-01: "Let's do it from here only."
I-02: "build the Meta Muse application locally on this PC"
I-03: "Especially, start with Netrok, and at a later stage we can expand it to programming or software engineering."
I-04: "It will also be the test for this graph skill and the intent graph skill"

Interpretation: a separate local application with Muse as an experience reference, adapted to network engineering. Working title Netrok Muse; no Meta affiliation. This interpretation is demonstrated through a runnable prototype and awaits the user's feedback.

## Inspected reference
- R-01: https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/ — launch date and product description inspected.
- R-02: https://introducing.muse.ai/ — official design page and full-page screenshot inspected; mobile activity, goals, approvals, personal avatar, artifacts.
- R-03: https://muse.ai/ — public desktop sign-in page inspected at 1280x720. Authenticated desktop experience was not accessible.
- R-04: https://www.youtube.com/watch?v=Sfmtbxqtz7o — exact walkthrough supplied by the user after feedback. See reference-video-01.md for observed frames, transcript support, and remaining gaps. This replaces related marketing material as the primary interaction reference for the next interpretation.

Preserve: conversation-led experience, personal avatar, clear message bubbles, activity transparency, explicit action decisions, goals, artifacts.
Adapt: network scenarios; desktop navigation and right detail drawer are proposed interpretations, not verified copies of the authenticated Muse desktop UI.
Omit from this clarification slice: live AI, device connections, background execution, credentials, actual production commands.

## Historical initial-prototype criteria — v0.1 scope
| ID | Observable result | Check |
|---|---|---|
| C-01 | Main chat has a visible avatar, separate message bubbles, and a composer that uses available pane width | Inspect normal/wide/narrow views |
| C-02 | Evidence opens beside the conversation on desktop; closes without losing draft | Open evidence, type draft, close/reopen |
| C-03 | Sample read-only check requires explicit approve/reject; state and activity reflect the decision | Exercise both decisions in separate proposals |
| C-04 | Sample outputs are clearly labelled; arbitrary user text is not answered with invented AI results | Submit draft; inspect response |
| C-05 | Theme and profile controls work and persist locally | Change, reload, verify |
| C-06 | No spill outside viewport; small screens use a dismissible detail overlay | Responsive inspection |
| C-07 | Activity history records prototype actions rather than fake agent progress | Compare clicks and history |

## Records and evidence
Code index: code-index.json, a manual file-level snapshot with typed relations; no automatic/live index.
Review and test results: evidence.md, to be filled after actual execution.
User visual decision: initial product prototype rejected (feedback-01.md); subsequent v0.7 wireframe layout/interaction direction accepted. See iteration-summary.md for acceptance scope and remaining decisions.
Live code graph / team dashboard / enforcing hooks: not implemented.

## Current P4 checkpoint

Current request: feedback-09.md. P4 removes duplicate profile actions, adds immediate avatar changes and motion, anchors the attachment menu above the composer, and makes custom sections editable/collapsible. Current source: ../polished.html. Current evidence: polished-evidence.json and p4-test-results.json; final identity: polished-candidate.json. Owner visual acceptance remains pending.

## Historical P3 checkpoint

The current user request is feedback-08.md, with original language in feedback-08-original.txt. P3 supersedes the profile placement, avatar editing and menu omissions in P2. Current runnable candidate: ../polished.html; review page: ../prototype-review.html; current status: polished-evidence.json. Evidence is only final when source hashes match passing p3-test-results.json and p3-independent-results.json. User visual approval remains pending.

## Historical P2 checkpoint

Current checkpoint (2026-09-11): `feedback-07.md` supersedes P1's separate Chat creation and right-aligned application settings. Root integrated and corrected the candidate after initial builder work; `p2_plan_review` approved the bounded plan and `p2_independent_review` exercised context actions, project isolation, recovery and rendered views. These are completed task roles, not a live background agent system. `verify-p2.cjs` and `p2-test-results.json` retain exact candidate checks. Current evidence: `polished-evidence.json`. P1 sources/results: `baselines/polished-p1/`. Next step is the user's review of the running P2 prototype.

Current deliverable: `../polished.html`, with `../prototype-review.html` linking the unchanged wireframe and the three-layer review. Trial plan: `polished-prototype.md`; candidate checks: `polished-test-results.json`; final review summary: `polished-evidence.json`. User requested this practical test on 2026-09-11. Local frontend only; independent review and user acceptance are recorded separately. The historical proposal below explains its starting baseline.
Interactive wireframe v0.8 is available at ../intent-map.html (serve over localhost). Its shared data is visual-map.json. v0.7's accepted direction is preserved under baselines/wireframe-v07. The requested collapse control now precedes the top Create plus. Name/logo remain open. See iteration-summary.md for all feedback themes, reusable skill changes and remaining work.

Next proposed checkpoint: one polished visual prototype using the accepted layout and interaction model, with explicit branding and representative state decisions. No further features are needed to complete this wireframe. The minor v0.8 refinement has functional checks; no separate final styling or runtime acceptance is claimed. Backend work remains deferred.

Design guidance update (2026-09-10): the user authorized adding design fundamentals, journey coverage, and evidence requirements to the global IntentGraph skill. These are recorded in `C:/Users/vikasmit/.codex/skills/intentgraph/references/experience-design.md` and its project template. Apply them to the next bounded prototype, linking design and journey decisions to the existing intent and baseline. Current wireframe acceptance is unchanged; the new guidance has not yet been validated through a fresh implementation/independent acceptance experiment. See iteration-summary.md for the scope of this documentation update.
