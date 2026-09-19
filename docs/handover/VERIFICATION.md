# Publication snapshot verification

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
| no-mistakes gate | Separate publication run; consult the repository PR/check history rather than inferring gate success from the local test results |
| CI | No hosted workflow configured for the initial archive; local validation commands are recorded in `.no-mistakes.yaml` |
| `git diff --cached --check` | Reports pre-existing whitespace issues in the imported snapshot; not reformatted during archival publication |

The source scan is a bounded publication check, not a security certification.
The complete local regression output remains with the publication preparation files.
