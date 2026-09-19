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
| no-mistakes publication gate / remote push | Pending destination selection and gate execution |
| `git diff --cached --check` | Reports pre-existing whitespace issues in the imported snapshot; not reformatted during archival publication |

The source scan is a bounded publication check, not a security certification.
The complete local regression output remains with the publication preparation files.
