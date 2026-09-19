# Wireframe v0.5 — settings, agents and attachments

User expresses confidence in the direction and requests concrete settings interactions, multi-agent creation and file/image attachment support. This supports the layout direction, not full implementation acceptance.

- Settings now opens a navigable dialog with six proposed pages: General, Appearance, Agents, Models & providers, Connections, Privacy & data.
- Display name, theme, spacing and proposed provider/access preferences save locally. Provider/access choices do not activate integrations or grant permissions.
- Agents page creates named local profiles with a role description. The right agent workspace has a switcher and plus shortcut. Profiles persist across reload; duplicate names are rejected. Profiles are not running agents, and per-agent execution/history/memory remains future work.
- Composer plus opens files, images and tool choices. Selected files remain in browser memory. Image thumbnails and removable chips are shown. Attachment-only messages can be demonstrated locally, with no server upload or AI request.
- Settings is a proposed Aven structure, not a claimed copy of unseen reference settings. Final settings and visual acceptance remain pending.

Source records: visual-map.json v0.5; archived v0.4 in visual-map-v04.json. New behavior lives in intent-controls.js; original product prototype remains unchanged.

Workflow lesson: a control is not sufficiently demonstrated merely because selecting it highlights an explanatory note. Acceptance should exercise the entry, contents, changes, saving and return journey. Distinguish local profile creation from agent execution, and file selection from uploading.
