# P4 feedback tasks

User request: avatar editing and custom sections, 2026-09-11. P3 technical passes remain historical. P3 snapshot: baselines/polished-p3/. The user accepts the composer itself and username Settings, but requests these corrections.

- [x] F09-01 Open editable agent details directly; remove the redundant Edit Profile button. Click the avatar itself to open its chooser. Keep SOUL.md/MEMORY.md reachable.
- [x] F09-02 Avatar style/color/Generate/Upload/Reset applies immediately, persists per agent and updates the matching sidebar/header. Remove profile Save/Cancel; text fields save on edit/blur, invalid or failed writes show an error. Keep document and app-settings Save controls, which were not rejected.
- [x] F09-03 Make sidebar avatars visibly larger. Native Grok Bot inspected: ordinary row avatar artwork is approximately 32–36 pixels tall; our 29px SVG box yielded smaller artwork. Use a 44px box with larger artwork coverage.
- [x] F09-04 Add eye blinking, antenna/tuft sway and surrounding signal-wave animation to original network mascots. Keep uploaded images intact. Respect reduced-motion preference.
- [x] F09-05 Anchor the composer plus menu above the composer, keeping the composer visible. Constrain menu height/width to the viewport and preserve keyboard dismissal and all attachment/tool options.
- [x] F09-06 Custom sections collapse/expand and retain their state. Chevron appears on hover/focus. Right-click or keyboard menu exposes Rename section, preserving member assignments and rejecting empty/duplicate names.
- [x] F09-07 Preserve accepted settings, conversation identity, drafts, creation, Enter/Shift+Enter, documents and earlier local data. Re-run focused evidence against source hashes.

User item 5 was explicitly withdrawn; do not implement inferred behavior from it.

Interpretation: network antenna motion and soft signal waves express the requested hair/wave liveliness without changing the chosen network artwork into a different character. Uploaded photos are not facially animated. No backend image generation or authentication is introduced.

Verified evidence: verify-p4.cjs / p4-test-results.json plus root rendered inspection. User visual approval remains separate.

Candidate: P4-cf9d42a81fb7. 8 verification groups passed; exact source hashes and scoped evidence are in polished-candidate.json and p4-test-results.json. User visual approval pending.
