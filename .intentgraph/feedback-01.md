# Feedback 01 — reference interpretation failed

Source: user feedback in this task, 2026-09-10. Status: changes requested. No revised UI is approved yet.

## What went wrong in the workflow

The planner inspected official mobile/product-design material and a desktop sign-in screen, then invented the authenticated desktop layout. The plan reviewer accepted that adaptation without establishing whether it preserved the user's defining experience. Engineering checks verified this invented subset; they did not prove reference fidelity.

User emphasis: "What we are doing as of now is building a pipeline for me so that in the future I can use it."

## Translation of user feedback — proposed criteria, not verified Muse facts

| ID | User's words / correction | Interpretation to demonstrate | Reference verification needed |
|---|---|---|---|
| F-01 | "Muse is an interactive avatar"; current logos feel fake | Treat the agent avatar as an interactive identity and entry point; avoid invented branding standing in for it | Exact visual, motion, click target, destination; 3D implementation remains unknown |
| F-02 | "Atlas might be the name ... I'm not sure" | Explain the relationship between product, agent name, and network role visually; Atlas was an agent-invented placeholder, not user intent | Naming/identity hierarchy from the video; user preference for adaptation |
| F-03 | Collapsible sidebar; mentions ideas, goals, search, chat, feed | Map actual navigation destinations and expanded/collapsed states before rebuilding sidebar | Exact order, grouping, labels, behavior |
| F-04 | Right shell opens for work, "not ... for ... Atlas" | Separate the agent workspace opened via avatar from task evidence/artifacts | Agent panel contents and navigation: memory/personality files, activity, browser/computer tools |
| F-05 | Settings only display name and appearance | Inventory reference app settings, agent configuration, and tool permissions; reproduce the relevant structure | Categories and controls as shown in video |
| F-06 | Mentions soul.md, memory.md, browser and computer use | Show inspectable agent identity/memory and capability surfaces; frontend representation is separate from operational backend | Confirm filenames, editing behavior and tool entry points; do not claim live capabilities |
| F-07 | "Local prototype, you do not need to write down" | Remove repeated labels from primary chrome; retain honest capability limitations at relevant actions or in details | User direction is explicit; no reference needed |
| F-08 | Composer looks similar but send control not clean | Preserve broad composer direction; inspect and match the compact reference send control | Exact icon, shape, size, placement |
| F-09 | Appearance seemed broken, then "I forgot to click on Save Settings" | Theme change is not a confirmed defect; user corrected this observation | No repair assumed; discoverability can be discussed if useful |

## Technical question answered
The current prototype uses index.html, styles.css, and app.js. It has no React, TypeScript, Tailwind, AI provider, or device-execution backend. Framework selection is separate from establishing the visual baseline.

## Next evidence checkpoint
The user supplied https://www.youtube.com/watch?v=Sfmtbxqtz7o. Inspect this demonstration and record timestamps before redesigning the defining regions. See reference-video-01.md for the first evidence pass.

## Reusable changes
IntentGraph now requires reference coverage and interaction mapping for reference-matching work, and an experience reviewer must test completeness of the criteria themselves. This is a procedural improvement, not a proven enforcement mechanism. Its effectiveness remains to be tested in the next interpretation round.
