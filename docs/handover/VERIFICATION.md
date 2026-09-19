# Verification history

## Initial publication snapshot

Date: 2026-09-19. Scope: current application snapshot, not archived candidate suites.

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund --prefix intentgraph` | Passed; 29 packages installed locally for testing |
| `npm run check --prefix intentgraph` | Passed |
| `node --test --test-concurrency=1 intentgraph/*.test.cjs` | 58 passed, 0 failed, 0 skipped |
| Source hash comparison immediately after snapshot | No drift in copied files |
| Credential-pattern scan of included text and XLSX XML | Eight findings reviewed: inert test fixtures; no actual token or private-key body found |
| Historical network evidence screen | Raw run records and evidence with private network addresses excluded |
| Full visual / packaged / live provider-device acceptance | Not performed for this publication |
| Publication target | Public `vikas53953/aven`, explicitly selected by the owner |
| no-mistakes gate | Attempted on 2026-09-19. Intent/rebase completed; review failed before producing findings because the installed Windows Codex CLI rejected configured model `gpt-6-astra` as requiring a newer CLI. No pipeline edits or gate push occurred. Full gate validation did not pass. |
| CI | No hosted workflow configured for the initial archive; local validation commands are recorded in `.no-mistakes.yaml` |
| `git diff --cached --check` | Reports pre-existing whitespace issues in the imported snapshot; not reformatted during archival publication |

The source scan is a bounded publication check, not a security certification.
The complete local regression output remains with the publication preparation files.

Publication is the owner's authorized initial source/document archive, with the
above limitation recorded. It is not a validated product release. Before later
feature delivery, update the gate's Codex runtime and run the full pipeline again.

## Initial local admission integration — 19 September 2026

At this initial checkpoint, WSL evidence superseded the publication snapshot for this changed slice: **75 tests, 74 passes, zero failures, one existing Playwright skip**; syntax checks pass. Twelve storage/API and five browser-state/backup tests are included. The deterministic suspended-owner regression fails against the archived candidate and passes against active source. Current desktop/narrow browser fixtures verify replay, Stop, queue FIFO, explicit recovery, another-tab preservation, draft retention and reload result reconciliation. Source hashes and fixture screenshots are in [the admission evidence](../evidence/admission-2026-09-19/README.md).

The ship contract is local-only: no pipeline, push, merge, publish or deploy was authorized or performed. The historical pipeline limitation above was not repaired or retried. Windows/DPAPI/native adapter behavior remains unverified from WSL. No live provider/device, credential access or owner visual approval occurred. Independent review remains pending.

## Independent-review corrections — 19 September 2026

Current full suite with mounted browser checks enabled: **83 tests, 82 passed, zero failed, one existing Playwright adapter skip**. Seven mounted chrome-devtools-axi cases and six browser-state tests pass; syntax, seven served-source hashes, actual 1440×1000 / 390×844 viewports and narrow keyboard retry are checked. The two review findings were reproduced before correction. See [latest recovery evidence](../evidence/admission-2026-09-19/review-fixes/README.md). Backend fencing is unchanged. Evidence-versus-receipt ambiguity is documented as nonblocking; Windows and owner UI acceptance remain unverified. Independent re-review is required; no self-approval or remote delivery occurred.

## Clarification-only local milestone — 19 September 2026

The Firstmate launch brief identifies `e176ad4989a9e8f5455223206f10227d58b837b6` as the independently approved reliability base. This branch preserves that base and adds one structured question/answer/continuation with durable fencing. [Clarification verification](../evidence/clarification-2026-09-19/verification.json) records current counts, failures corrected during development, syntax checks, receipt migration, served hashes and desktop/390px fixture screenshots. These are technical checks, not independent code review or owner UI approval. Both subsequent reviews remain pending; the worker is explicitly prohibited from delegating its implementation or running the publication pipeline. No pipeline, push, merge, publication, provider/device call or Windows certification was performed. Existing evidence-versus-receipt ambiguity remains unresolved.

Final clarification result: **103 Node tests, 102 passed, 0 failed, 1 existing Playwright adapter skip; all 14 mounted browser checks pass. Four mocked Python tests pass.** Syntax, base-receipt migration, served application/atlas hashes and desktop/390px checks pass. Long evidence paths wrap in the architecture atlas. The deterministic review UI is documented in [owner-review.json](../evidence/clarification-2026-09-19/owner-review.json). Independent review and owner UI approval remain pending.
