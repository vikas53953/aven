# Wireframe v0.7 — reference-backed entry points

User explicitly asked to inspect the already-open Grok Bot desktop application and match the location/behavior of Create and Search. Native inspection completed; see reference-grokbot-01.md.

- One common Create plus at the top of the left sidebar, above Search. Avatar and right-agent-panel plus shortcuts removed. Aven menu contains New chat, New project, New channel and New agent, as requested.
- Search opens a centered popup over the existing workspace, with All, Messages, Chats, Agents, Channels, Projects, Files and Links filters. Actual reference uses Bots/Groups and also Routines/Actions; Aven uses its current entity names. Search reads only local records; file search covers filenames, not contents.
- Agent, project and channel setup appear in the main central workspace with Create and Cancel. Cancel returns to the previous chat and draft. Agent creation opens a central chat addressed to the new local profile.
- Settings is separate and right-aligned. Agent management in Settings links to central creation rather than embedding another creation form.
- Compact icon-only navigation remains supported; expanding the sidebar reveals the Search field treatment. This preserves the earlier compact-navigation preference while following the newly inspected control order.

Observed: reference control placement, two-item Create menu, filterable Search popup, Messages empty state, existing central New Bot setup conversation. Adapted: four Create choices, Aven filter names, explicit setup form. No bot was created or messaged in the reference app.

Canonical interpretation: visual-map.json v0.7. Previous v0.6 snapshot: visual-map-v06.json. New entry-point behavior: intent-entrypoints.js. User visual acceptance remains pending.

Pipeline lesson: inspect the actual entry point and the surface it opens before choosing a dialog, drawer or central page. Matching labels alone misses interaction meaning.
