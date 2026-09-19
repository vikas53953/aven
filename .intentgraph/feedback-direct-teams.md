# Direct and Teams checkpoint — 2026-09-15

User decision: reduce the sidebar to Direct and Teams. Move archived chats into Settings. Remove the top wordmark. Keep coworker identity in the center header rather than turning the first message into its name.

Reference inspected: the running Grok Bot desktop, firewall conversation. Observed a stable firewall header, sidebar avatar/name/latest-message preview, and minimal right profile fields. Right-clicking a message exposed emoji reactions, Reply and Copy. Revert was requested by the user; it was not verified in that reference menu. No reference messages or profiles were changed.

Implementation contract:
- Direct identifies a coworker; Teams organize shared conversations. Existing project/channel records migrate without discarding conversation IDs, evidence, drafts or queued work. Migration is backed up and versioned.
- Archives are browsed and restored within Settings. Busy conversations remain protected from archive/revert; archived conversations remain read-only.
- New coworker welcome is local display content, excluded from model context. It is not a generated provider response or a live status claim.
- Message actions appear on hover/focus and via right-click. Reactions persist locally. Revert retains the selected message and earlier context, stores the removed history, and offers undo before subsequent conversation changes. Executed device actions are never undone by reverting a chat.
- CLI evidence stays exact and is not duplicated. Queue/steering behavior remains unchanged.

This is a frontend/local-storage change. Teams membership does not establish parallel multiagent execution. Durable server-side histories, accounts and customer isolation remain future work.

Verification: see evidence/direct-teams-v4.json and direct-teams-v4.png after browser acceptance. Queue/steering/raw CLI and stream-rendering regression checks also run for this slice.

Continuation: workspace is netrok-muse, live shell polished.html on 8767, Node runtime on 8768. Current UI revision direct-teams-v4. The next task should read this checkpoint and architecture.json, inspect the actual page, and use current evidence rather than infer state from older discussion. No new user task is required for this checkpoint.
