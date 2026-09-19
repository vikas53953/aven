# Aven handover — 19 September 2026

## Start here

Aven is an existing local network-engineering assistant prototype. This repository
is a publication snapshot of the active `netrok-muse` folder, not a new implementation
and not a claim of production readiness. Read [AGENTS.md](AGENTS.md), then
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
- HLD 17 identifies UI build `ux-minimal-ui-v9.1`. It records integrated minimal-UI,
  history and reaction-picker changes, while broader candidate work remains separate.
- A central 115-feature comparison register, independent audit, post-fix review and
  candidate evidence preserve implementation and acceptance history.
- Firstmate was installed separately using Windows PowerShell → Ubuntu WSL → tmux →
  Codex CLI. Its software and GitHub/Codex authentication checks passed. Credentials,
  Firstmate private state and the Firstmate distribution itself are not part of Aven.
  See [Firstmate setup and continuation](docs/handover/FIRSTMATE.md).

## What we are doing now

Publishing a screened snapshot and reusable handover to the public repository
https://github.com/vikas53953/aven, as authorized by the owner. No product
features were changed by the publication preparation. The original source folder
was not a Git repository; its files were preserved. This snapshot is a separate
copy so Firstmate and other tasks must not edit both copies independently.

Use this repository as the shared source and documentation home. Designate one Git checkout as the working source and register that
checkout with Firstmate. Do not overwrite the original folder or import private
runtime state automatically. Reconcile any newer local changes first.

## Current evidence and pending work

The dated UI/history verdict review records **37 Verified (scoped), 57 Partial,
3 Unverified, 14 Missing and 4 Deferred** across 115 features. These are the
16 September evidence verdicts, not a fresh full-product audit. Older README and
workbook snapshots contain different counts; preserve their dates and scope.

Authoritative references:

- [Central feature register](outputs/01a0a3bc-a376-74e1-8d48-e4029c2cb5a2/Aven-UI-UX-Feature-Register.xlsx)
- [Independent audit](outputs/01a0a816-e452-75f2-9363-0f859011a90e/Aven-Independent-Audit.xlsx)
- [Post-fix review](outputs/01a0a816-e452-75f2-9363-0f859011a90e/fixes/report/Aven-Post-Fix-Review.xlsx)
- [Effective verdicts and limits](outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/ui-release/row-verdict-review.json)
- [Original completion plan](outputs/01a0a816-e452-75f2-9363-0f859011a90e/completion/PLAN.md)
- [Pending feature IDs](docs/handover/PENDING.md)

Prioritize validating and composing the unintegrated reliability, provider,
approval/workflow, automation, terminal and Git candidates. Files under `outputs/`
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

Use Node.js 20 or newer for the active backend (some archived candidates use newer
Node features such as `node:sqlite`). From the root:

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

Fresh snapshot checks on 19 September: **58 backend tests passed, zero failed or
skipped**, and the existing syntax check passed. Tests use local fixtures/mocks;
this is not a fresh visual or live-infrastructure acceptance run. See
[verification](docs/handover/VERIFICATION.md).

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
