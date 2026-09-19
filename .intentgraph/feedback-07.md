# P2 — agent-first prototype revision

Date: 2026-09-11. Status: changes requested on P1; implementation authorized, visual approval pending.

The user's latest request supersedes earlier separate Chat creation and right-aligned app settings. The accepted wireframe and P1 are preserved; P1 checks describe that older candidate only.

## Intent translated into observable behavior

| ID | User intent | P2 result to demonstrate |
|---|---|---|
| F07-01 | “first creating the board, then creating the chat… two steps” | Shared top plus offers New agent, New channel, New project. New agent opens a centered popup, creates its project-owned conversation immediately. No separate Chat destination or repeated central New chat buttons. |
| F07-02 | “All the chats… collapsible… channel separated… projects” | Expandable sidebar groups show agents, channels and project-owned conversations. Default project receives previously unassigned conversations without losing content. |
| F07-03 | “tick marks are not in parallel” | Recipient and channel-member checkboxes align consistently. |
| F07-04 | “Enter… should send” | Enter sends once, Shift+Enter inserts newline; IME composition does not send. No sent toast. |
| F07-05 | “same color… Grok bot” | Neutral near-black center, charcoal sidebar/bubbles, consistent gray borders; centered settings with System/Light/Dark, Accent, Language. Exact pixel matching is not claimed. |
| F07-06 | “bot's time zone and auto review” | Per-agent preferences, saved locally; automatic execution remains unbuilt. |
| F07-07 | “left shell should be adjustable” | Drag divider or keyboard resize; collapse/expand restores width, bounded at narrow sizes. |
| F07-08 | “pictures… not looking good” | Original geometric bot avatar, replacing shaded companion artwork; styling awaits user judgment. |
| F07-09 | “right-click… Pin, Move to… unread… profile… delete… hide” | Context menu plus accessible menu button; sections, project moves, unread/pin state, profile edit, recoverable hidden agents and scoped deletion confirmation. |
| F07-10 | “username instead of settings” | Bottom username opens Settings/About/Help/Feedback/Log out. App settings centered. No invented signed-in account or external feedback delivery. |

## Reference inspected

Actual installed Grok Bot native window inspected 2026-09-11, approximately 1042×761. Near-black conversation, charcoal sidebar and message bubbles, simple colorful geometric bot avatars. Top plus and Search below it; sidebar resize separator. Bottom account menu contains Settings, About, Help Center, Send Feedback, Log out (also account/update options outside this slice). General settings are a centered large dialog, showing Theme / Follow System, Accent / Black, Language / Follow System. Bot right-click shows Pin, Move to, Mark as Unread, Edit Profile, Duplicate, Copy conversation ID, Hide from sidebar, Delete. Bot profile opens right details with name, label, description and notifications. No settings were changed, messages sent, or bots created/deleted in the reference.

Projects, agent auto-review/timezone, centered creation and removing the Chat destination are user-directed adaptations. Timezone/auto-review were not observed in the inspected reference profile. Browser/computer, live AI, auth and actual uploads remain unconnected in this frontend prototype.

## Preservation and evidence

Previous candidate sources and manifests: baselines/polished-p1/. Existing browser records must survive migration, including messages, drafts, recipients, documents and project/channel associations. Raw P1 local values should be backed up before migration. New checks must cover cancellation, reopening, ownership, nested navigation, context menus, responsive bounds and keyboard operation. Passing these checks is separate from user visual acceptance.
