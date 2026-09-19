# P3 task list — every feedback item

Source: feedback-08-original.txt, user request dated 2026-09-11. Status: P3 local implementation verified; user visual approval pending. P2 functional passes did not establish visual acceptance. Prior source/evidence preserved under baselines/polished-p2/.

## Requested corrections

- [x] F08-01 Remove the composer's “To:” selector (interpreting spoken “two-button”). Keep standard attachment plus, text field and send arrow; preserve Enter send / Shift+Enter newline / IME guard. Manage channel members outside the composer.
- [x] F08-02 Search has a persistent filled background. Collapse control has a quiet default state.
- [x] F08-03 Section collapse chevrons appear on hover or keyboard focus, otherwise stay hidden; groups remain operable.
- [x] F08-04 Replace uniform faces with configurable network-themed avatars. Offer distinct network motifs and color selection, Generate variations, Upload and Reset. Update sidebar, conversation header and agent details consistently, per agent.
- [x] F08-05 Edit Profile opens in the right workspace, not a center-blocking dialog. Fields: avatar, name, optional label, description, notifications. Save/Cancel preserve the conversation and isolate unsaved edits.
- [x] F08-06 Create Agent includes name, role and project only. Remove time zone and auto-review duplication from creation and profile editing.
- [x] F08-07 Keep SOUL.md and MEMORY.md in agent details. Remove repeated “Save profile preferences” and duplicated behavior fields. Keep the previously requested timezone/auto-review preferences in a single Settings > Agent behavior location.
- [x] F08-08 Username menu displays all actions with consistent icons: Settings, About, Help Center, Send Feedback, Add Account, Log out. No clipping at small heights; informational pages and local feedback work. Authentication remains unconnected.
- [x] F08-09 Place avatar beside the conversation title at the left. Remove “CONVERSATION” and project/context labels from the header. Derive a concise local title from the first user message for new untitled conversations; preserve existing/custom titles.
- [x] F08-10 Recheck each previous-round requirement, rather than carrying forward a blanket PASS.

## Prior-feedback audit

| Prior ID | Audit before P3 | Required P3 treatment |
|---|---|---|
| F07-01 One-step agent creation / popup | Functional P2 checks passed; fields too broad | Retain flow; simplify fields |
| F07-02 Grouped/collapsible navigation | Functional P2 checks passed; chevrons visually rejected | Retain nesting; change affordance visibility |
| F07-03 Recipient alignment | Aligned but composer selector itself rejected | Remove composer selector; retain aligned channel member controls |
| F07-04 Enter sending | Passed in P2 | Recheck |
| F07-05 Theme and professional appearance | Themes functioned; remaining visual gaps reported | Recheck palette, Search, menu, header and profile views |
| F07-06 Time zone / auto review | Present but unnecessarily repeated | One home in Settings; no deletion of saved preferences |
| F07-07 Sidebar resize | Passed in P2 | Recheck |
| F07-08 Avatar | Rejected: no configurable network identity | Replace with complete configurable avatar journey |
| F07-09 Context/profile actions | Context state passed; Edit placement was wrong | Edit on right; recheck pin/move/unread/hide/delete/restore |
| F07-10 Username menu / settings | Actions existed; styling/icons/information incomplete | Complete icon menu + Add Account; centered app settings |

## Inspected references and boundaries

Native Grok Bot inspected at 1920×1032: filled Search; avatar adjacent title; right-side Edit Profile has avatar, Name, Label, Description, Notifications. Avatar popover has eight shapes and colors, Bot/Generate/Upload tabs, Reset; Generate contains a prompt and Generate button; Upload contains image drop area and Browse files. No reference data changed or submitted. Cursor Agents native view inspected: compact composer with plus, text field, model selector and microphone; no To selector. Codex native UI was not automated.

Network avatar artwork is an original adaptation. Generate in this local prototype creates procedural network-avatar variations, explicitly distinguished from AI image generation. Uploaded avatar content stays locally in the browser; no provider upload. Add Account/Log out do not pretend that authentication is connected. Original Netrok development remains paused.

## Evidence rule

Every item needs a demonstrated state/journey and candidate hash. The root owns implementation/integration and evidence; an independent review checks a bounded runnable set. Missing or simulated capability stays explicit. User visual approval remains pending.

## Executed evidence

Primary verification: p3-test-results.json, ten passing groups on a stable candidate. Covers actual local journeys, storage preservation, accepted/rejected uploads, profile cancellation, account actions, creation, Enter/Shift+Enter/IME, themes, six viewport widths, context recovery and unchanged wireframe sources. No page errors or external runtime requests were observed. Independent final review is recorded separately in p3-independent-results.json. Current identity and source hashes are in polished-candidate.json.

Completed prior-round audit: F07-01 popup agent/channel/project creation; F07-02 grouped navigation; F07-03 channel checkbox alignment and removal of composer selector; F07-04 keyboard sending; F07-05 themes and centered settings; F07-06 one settings home for behavior; F07-07 resizing/collapse restoration; F07-08 configurable avatars; F07-09 pin/unread/move/hide/delete/restore and right profile; F07-10 six-item username menu. All are covered by the P3 primary interaction groups.

Prototype boundary: Generate produces local network-mascot variations, not AI images. Upload supports validated PNG/JPEG/WebP avatars saved locally. Add Account and Log out open truthful unconnected-account explanations; no authentication backend is implemented. The task checkmarks cover these stated frontend behaviors, not live services or the user’s visual acceptance.
