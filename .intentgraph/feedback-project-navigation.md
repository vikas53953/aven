# Project and thread interactions — 2026-09-15

Inspected the actual Codex desktop through Computer Use before implementation. The project context menu showed Pin, Edit, Section, Open in Explorer, Archive chats and Remove project. The active chat menu showed Rename, Pin, Archive, Share, Copy, New side chat, Fork, scheduled task and Open in new window. Project plus/action controls and nested thread rows were inspected. No reference chats were created, archived or modified.

Implemented in Aven's local browser prototype:
- Project rows: collapse/expand, New chat, menu, rename, pin ordering, Archive chats and archived-chat restoration. Collapse and pins persist.
- Multiple independently named chats per project, using an existing coworker. Creating a chat does not invoke the LLM.
- Thread rows: hover/focus Pin, Archive and menu actions; the chat header opens the same menu. Rename, move to an existing project or Direct, Copy conversation, Archive and Restore preserve the chat identity and history.
- Pins order threads within their owning project, preserving the previous one-location requirement. They do not create duplicate sidebar entries.
- Archive is disabled while affected chats have an active run or pending queue. No pending work is silently removed.
- Menu keyboard navigation, Escape/focus return, outside dismissal, viewport bounds and touch-visible controls.
- Raw CLI Copy is an icon with a tooltip and Copied feedback. SUCCESS is no longer a badge; non-success states remain visible. This avoids implying that successful execution certifies network health.

Not implemented by this slice: project sections, OS Explorer integration, removing projects, public sharing, forking, side chats, scheduled tasks and separate native windows. These reference capabilities are not displayed as fake controls.

Evidence: `.intentgraph/evidence/project-navigation.json`, `project-navigation-menu.png`, `thread-navigation-menu.png`. Local browser acceptance fixtures, not production/customer isolation certification.
