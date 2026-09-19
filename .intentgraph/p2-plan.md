# P2 execution packet

Baseline: feedback-07.md, user-authorized frontend revision. Root is coordinator/planner and final verifier. P2 builder owns polished.html/css/js. Plan advisor returned PLAN_APPROVED after adding explicit migration, menu, ownership, keyboard and responsive coverage. Independent review will inspect a runnable candidate; no role is represented as a continuously watching background agent.

## Planned evidence

- Raw P1 storage backup, once and without overwriting; rerunning migration is idempotent. Preserve unassigned and assigned conversations, drafts, message recipients, pending filenames, saved agent documents and unrelated storage keys. Previously session-only file contents remain session-only.
- Create agent through the shared plus and centered popup, then immediately enter its project-owned conversation. Channel creation persists name, members and project. Cancel restores context. No separate Chat destination or central New Chat action.
- Enter sends once; Shift+Enter newline; composition Enter does not send. Attachments, Search, documents and tool previews remain scoped.
- Context actions are reachable by pointer and keyboard; hide is recoverable; deletion clearly names its local scope and requires confirmation. Settings distinguish Save from Cancel; per-agent fields stay per-agent.
- Inspect desktop and 320px narrow views, intermediate widths, centered forms/settings, account/context menus, sidebar resize/collapse, focus and contrast. Record limits of automated checks.
- No external runtime calls, live agents, account login/logout, device operations or actual server uploads are introduced.

## Candidate integrity

P1 sources and evidence are preserved under baselines/polished-p1/. verify-p2.cjs records start/end SHA-256 for the three prototype sources and the review page. Runs that see changing source hashes are exploratory. Final evidence will identify a stable P2 candidate; a code change makes affected evidence stale. All original wireframe source hashes remain protected by polished-baseline-hashes.json.

P2 remains pending the user's visual decision, even when scoped checks pass.
