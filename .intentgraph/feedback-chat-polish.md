# Chat experience correction — 2026-09-15

User intent: show a command's output once, keep message details quiet until needed, and give a conversation one navigation location. Successful network execution alone did not meet this acceptance requirement.

Reference inspected: the open Codex desktop window through Computer Use, including its quiet message layout and accessibility tree showing time/Copy controls, project-contained tasks and separate Recents. Hover timing was specified by the user; no pixel-perfect parity is claimed.

Implemented contract:
- Raw CLI evidence is rendered once by command, target, status and exact output identity. Copies in events and the final response merge; genuinely different output remains distinct.
- CLI answers use the terminal as their primary view. Optional explanation is collapsed; repeated code blocks and generated tables are removed from that explanation. General answers continue rendering normally. Failure status remains visible.
- Time, duration and Copy controls appear on hover or keyboard focus. Touch users retain visible controls. Raw Copy receives the exact output string.
- Existing project ownership is preserved. Direct conversations use an explicit null project. Opening Direct cannot reopen a project conversation. Multiple direct conversations remain separately reachable. Moving a conversation changes only that conversation.
- Channel conversations are listed under Channels rather than duplicated under Projects. Agent profile access remains available through the conversation header and context actions.

Reusable lesson: verify the complete rendered answer and navigation in stored-history fixtures, not just whether an individual terminal or command worked. Prompt guidance can reduce redundant tokens, but deterministic rendering owns duplicate suppression.

Next product milestones: complete a realistic investigation acceptance check; add durable conversation/investigation storage and recovery; add customer isolation and production identity before multi-customer release. These are not completed by this UI update.
