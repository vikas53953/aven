# Aven handover — 19 September 2026

## Start here

Aven is an existing local network-engineering assistant prototype. This repository
began as a publication snapshot of the active `netrok-muse` folder. The Git checkout
now includes local admission and bounded clarification; it is not a claim of production readiness. Read [AGENTS.md](AGENTS.md), then
[architecture/HLD.md](docs/architecture/HLD.md). The historical folder/product name
Netrok Muse still appears in filenames.

## What has been done

- Active browser shell: `polished.html`, `polished.js`, `polished.css`, supporting
  UI modules and avatar artwork. `index.html` is the older prototype.
- Node/CommonJS backend in `intentgraph/`, with a bounded chat/runtime API,
  LangChain/LangGraph orchestration, OpenCode integration, inventory and limited
  read-only network diagnostics. Real provider/device use needs separate local
  configuration and credentials, which are not published here.
- Workspace/history UI includes attachments, ideas/goals, activity and evidence
  presentation, interruption state, reviewed local file editing and backup/restore.
  The architecture record explains partial and unavailable capabilities.
- The [architecture record](docs/architecture/architecture.json) identifies UI build `ux-minimal-ui-v9.4-clarification`. It preserves the v9.1
  minimal UI/history/reaction behavior and adds durable, fenced chat admission.
  Stable request identity, independent multi-chat receipt recovery, same-request result reconciliation and serial execution are integrated;
  one structured clarification is integrated. The bounded provider-picker slice adds optional request selection and provenance; provider onboarding, action approval, automation, terminal and Git candidates remain separate.
- A central 115-feature comparison register, independent audit, post-fix review and
  candidate evidence preserve implementation and acceptance history.
- Firstmate was installed separately using Windows PowerShell → Ubuntu WSL → tmux →
  Codex CLI. Its software and GitHub/Codex authentication checks passed. Credentials,
  Firstmate private state and the Firstmate distribution itself are not part of Aven.
  See [Firstmate setup and continuation](docs/handover/FIRSTMATE.md).

## What we are doing now

The screened initial snapshot is the shared source in https://github.com/vikas53953/aven.
As of 20 September, clarification [PR #1](https://github.com/vikas53953/aven/pull/1)
and compact answered-row [PR #2](https://github.com/vikas53953/aven/pull/2) are merged.
The compact-row merge is `8c74be304ff5643a2b41aab769bcce96fcdd7922`.
The next branch adds a bounded conversation model picker and native Windows launcher
fixes. See [scope and evidence](docs/evidence/provider-picker-2026-09-20/README.md).
Its validation gate owns further delivery; this checkpoint does not claim that
the provider branch is already pushed or merged.

Task-branch push and PR are authorized; root owns merge after applicable checks
pass and substantive findings are resolved. The owner approved the initial
clarification card and explicitly requested the compact answered row. That approval
does not establish acceptance of the full application or the subsequent refresh
correction; local fixtures do not establish customer or visual acceptance.
Deployment and customer release remain unauthorized. Record any delivery blocker instead of treating authorization
as completion. The older non-Git folder remains untouched.

Use this repository as the shared source and documentation home. Designate one Git checkout as the working source and register that
checkout with Firstmate. Do not overwrite the original folder or import private
runtime state automatically. Reconcile any newer local changes first.

## Current evidence and pending work

The dated UI/history review recorded **37 Verified (scoped), 57 Partial, 3 Unverified, 14 Missing and 4 Deferred**. The clarification supplement advances UX-033 to Partial; the bounded provider-picker supplement advances UX-027 to Partial: **37 Verified (scoped), 59 Partial, 3 Unverified, 12 Missing and 4 Deferred** across 115 features. These combine the
16 September verdicts with scoped clarification and provider supplements, not a fresh full-product audit. Older README and
workbook snapshots contain different counts; preserve their dates and scope.

Authoritative references:

- [Central feature register](outputs/01a0a3bc-a376-74e1-8d48-e4029c2cb5a2/Aven-UI-UX-Feature-Register.xlsx)
- [Independent audit](outputs/01a0a816-e452-75f2-9363-0f859011a90e/Aven-Independent-Audit.xlsx)
- [Post-fix review](outputs/01a0a816-e452-75f2-9363-0f859011a90e/fixes/report/Aven-Post-Fix-Review.xlsx)
- [19 September clarification supplement](docs/evidence/clarification-2026-09-19/feature-verdicts.json)
- [16 September effective verdicts and limits](outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/ui-release/row-verdict-review.json)
- [Original completion plan](outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/PLAN.md)
- [Pending feature IDs](docs/handover/PENDING.md)

Owner UI acceptance remains distinct from independent review. Provider onboarding and production adapters,
approval/workflow, automation, terminal and Git candidates still need integration.
The [approval/clarification proposal](docs/proposals/approval-clarification.md) now records the launch authorization for all four recommended choices. Only clarification is implemented: one question, one same-run read-only continuation, serial waiting and explicit cancellation after reload. Approval, mock execution and durable continuation after restart remain excluded. Files under `outputs/`
are archived candidates or evidence, not automatically the live application. Do
not bulk-copy an assembled candidate over the root application.

Provider/model selection, action authorization, credential boundaries, restart and
idempotency behavior require evidence at their actual integration boundaries.
Cross-device history, accounts/customer isolation and remote handoff remain deferred
as described by the source records. Packaged-app behavior, live provider/device
reachability, visual acceptance and assistive-technology acceptance are separate
from local fixture tests.

## How we work

1. Inspect current code and dated evidence; preserve original acceptance criteria.
2. Divide work into disjoint candidate scopes. Workers supply changed paths, source
   hashes, exact changes and focused test evidence.
3. The coordinating agent integrates shared files sequentially and independently
   verifies the resulting live build. A worker's completion claim does not update
   the central register by itself.
4. Keep Plan mode tool-free; rendering a proposal never authorizes execution. Keep
   network execution scoped and explicit. Do not use live credentials or device/model
   calls merely to run regression tests.
5. Update `docs/architecture/architecture.json` and dated changes, then run
   `node docs/architecture/build-hld.cjs` when implementation/architecture changes.
6. Update the existing central feature register with evidence and limitations.
   Passing tests and owner approval are distinct.
7. Use branches/worktrees after establishing the Git baseline. This publication is
   authorized; future product pushes, merges and releases follow the owner's scope.

## Run and validate

Follow the [runtime prerequisites](intentgraph/README.md) for the active backend. From the root:

```powershell
npm ci --prefix intentgraph
npm run check --prefix intentgraph
node --test --test-concurrency=1 intentgraph/*.test.cjs
.\Start-NetrokMuse.ps1
.\Start-IntentGraph.ps1
```

Open `/polished.html` on the loopback frontend at port 8767; the backend uses port
8768. Windows launchers and DPAPI credential protection are Windows-specific;
Firstmate's WSL installation does not prove that every Aven function runs on Linux.
Do not configure secrets in committed files. A source checkout starts without the
original user's browser storage, runtime profiles or credentials.

See [verification history](docs/handover/VERIFICATION.md) for dated full-suite results
and subsequent focused regression evidence. Those fixture checks do not establish
Windows, live-infrastructure or owner visual acceptance.

## Publication boundaries

See [publication scope](docs/handover/PUBLICATION-SCOPE.md). Unreviewed screenshots
and private runtime evidence remain local, so some historical evidence links are
intentionally unavailable in the published copy. Do not claim an excluded image
was inspected from this repository.

## Suggested skills

- `handoff` for a continuation summary referencing these records.
- `diagnosing-bugs` for a reproduced defect or runtime failure.
- `frontend-design-thinking` for reference-grounded UI work after inspecting the
  exact current UI and accepted reference scope.
- `code-review` for independent review of proposed integration changes.
- `firstmate-build` / `no-mistakes` for the configured delivery validation flow.

Skills are optional workflow aids subject to explicit owner instructions; their
presence does not authorize external actions or change project acceptance.

The preserved reliability base is `e176ad4989a9e8f5455223206f10227d58b837b6`, identified as independently approved by the Firstmate launch brief. This worker does not claim independent approval of its own clarification changes. Evidence-versus-receipt ambiguity and native Windows uncertainty remain explicit limitations. Current acceptance scope is recorded under “What we are doing now” above.

Review and test corrections are implemented on this branch. Their dated validation
and remaining evidence limits are indexed in [verification history](docs/handover/VERIFICATION.md).
