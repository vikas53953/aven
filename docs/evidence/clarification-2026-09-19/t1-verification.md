# T1 focused verification · 2026-09-20

The original mounted ownership case failed before the fix: foreign navigation changed the saved workspace hash during a live writer. The strict stale-workspace check then prevents the original writer from saving completion, as recorded in the preceding test-phase finding.

After the fix, this focused command passed all five selected cases (zero failures or skips):

```sh
CHROME_DEVTOOLS_AXI_SESSION=t1-fix \
CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:9337 \
AVEN_BROWSER_TOOL=/home/vikasmit/.local/bin/chrome-devtools-axi \
node --test --test-concurrency=1 \
  --test-name-pattern='mounted recovery cannot interrupt|mounted pending reload|mounted (add|replace) restore|mounted writer release' \
  intentgraph/mounted-admission.test.cjs
```

Cached Chromium ran headlessly with an isolated worktree profile and chrome-devtools-axi, against the synthetic local admission fixture. No credentials, live providers or devices were used.

- The strengthened ownership case keeps the foreign tab on another conversation while the original writer finishes. Foreign navigation and draft editing leave persisted storage byte-identical; completion clears pending admission, retains captured evidence and annotations, and makes no extra responder call. The foreign draft remains visible with a warning that it is only retained in this tab.
- The writer's unrelated draft survives FIFO completion; exact code output and desktop/narrow behavior pass.
- Reloaded abandoned pending requests allow unrelated draft and selection persistence across reload, preserve protected captures, and reject stale edits.
- Both Add and Replace restore reject live writers and stale snapshots.

The architecture HLD was regenerated. The served atlas loaded HLD 23; current/target controls rendered distinct views and Next advanced the guided walkthrough.

The complete suite, lint/static analysis, pipeline re-review and remote CI were not run in this assigned test phase. Re-review of the source correction and required CI remain the outer executor's responsibility. Native Windows and real integration checks remain unavailable; owner visual acceptance and customer release approval remain ungranted. This atlas check does not establish owner visual acceptance.
