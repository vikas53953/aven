# Wireframe v0.6 — conversations and organization

User asks to address created agents from chat, create new chats, add channels containing threads, group projects and move Search above the agent control. Existing direction is supported, not full acceptance.

## Proposed interaction model
- Search is the first left-rail control. Agent avatar comes next, with its own creation plus.
- General Create menu offers New chat, New channel, New project and New agent.
- Chats, Channels and Projects form the upper navigation group; Feed, Ideas, Goals and Artifacts remain below a divider. Detailed Feed/Ideas/Goals screens are still pending.
- A channel contains chat threads. A project can group channels and direct chats. A separate Threads navigation item is omitted to avoid two names for the same conversation unit; hierarchy awaits user review.
- New chat button sits in the central header. In a channel it starts another thread in that channel.
- Each chat has a To selector for one or more created agent profiles. Local messages show intended recipients. No agent is invoked.
- Chats, drafts, recipient choices, channels and projects persist in this browser. Attachment contents remain session-only and stay with their chat; saved messages retain filenames only. Search covers chat titles/text, channels, projects and agent names.

Canonical interpretation: visual-map.json v0.6. Previous version retained in visual-map-v05.json. New interaction code: intent-conversations.js. Review storage remains version-specific.

Unimplemented: real agent routing/execution, shared channel memberships/access, collaborative persistence, per-agent real memory and actual upload processing. User profiles created while reviewing earlier iterations are preserved.

Pipeline lesson: explicit object relationships and entry points matter as much as component placement. Validate a whole journey across creation, selection, messages, switching, retrieval and reload; require isolation between conversations.
