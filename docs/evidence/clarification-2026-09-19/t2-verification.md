# T2 focused verification · 2026-09-20

Before the fix, the existing `mounted second tab cannot cancel` case failed at the waiting-guidance assertion: navigation after reload displayed “Another tab is still saving a run. Your draft is kept in this tab only; copy it before reloading.” Navigation requests two unrelated saves, whose nonblocking Web Lock requests competed within the same tab.

The fix serializes same-tab unrelated saves through completion of each lock request. Foreign-writer exclusion, capture ownership and strict saved-workspace comparison remain unchanged. No import or runtime continuation logic changed.

After the fix, all three selected mounted cases passed (zero failures or skips):

```sh
CHROME_DEVTOOLS_AXI_SESSION=aven-t2 \
CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:9337 \
AVEN_BROWSER_TOOL=/home/vikasmit/.local/bin/chrome-devtools-axi \
node --test --test-concurrency=1 \
  --test-name-pattern='mounted second tab cannot cancel|mounted pending reload|mounted recovery cannot interrupt' \
  intentgraph/mounted-admission.test.cjs
```

- The clarification test preserves the original waiting-guidance assertion and now also verifies rapid input edits, drained browser locks, the latest draft and selected conversation across reload, and waiting guidance after reload. Existing tokenless cancellation and paused-queue assertions pass.
- The abandoned pending-request test verifies unrelated draft/navigation persistence, preserved captures and stale-edit rejection.
- The active-writer test verifies byte-identical storage during foreign navigation/editing, successful original-writer completion while the foreign tab remains elsewhere, retained capture and the foreign tab's visible draft.

Verification used cached headless Chromium with an isolated worktree profile through chrome-devtools-axi and the synthetic local admission fixture. No credentials, live providers or devices were used. The HLD generator completed; the served HLD 24 atlas rendered distinct current/target views and advanced its guided walkthrough.

Unchanged import guards retain their prior focused evidence in t1-verification.md; they were not rerun for this same-tab scheduling correction. The complete suite, lint/static analysis, independent re-review and remote CI were not run in this assigned test phase. Re-review and required CI belong to the outer executor. Native Windows and live integrations remain unverified; owner visual acceptance and customer-release approval remain ungranted. Atlas interaction verification does not confer owner acceptance.
