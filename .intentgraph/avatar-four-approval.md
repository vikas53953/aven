# Avatar v2: four-character visual checkpoint

Status: APPROVED by owner. Owner said: "Expand the family. I am pretty much okay with whatever you created." Expansion and integration are authorized under the previously agreed workflow. Historical checkpoint details follow. Current work: avatar-family.md.

## Owner clarification

Original vectors do not exist. Owner explicitly authorized clean editable SVG recreations of Cloud, Router, Firewall and Switch first. Show original reference alongside still and interactive 24/48/96px previews. Stop for visual approval before expanding the family or replacing existing picker selections.

## Implementation boundary

- Existing implementation inspected: polished-avatars.js eight styles, local procedural generator, uploaded photos; polished.js picker, color controls and automatic per-agent persistence; polished.css avatar motion and reduced-motion rules.
- Existing product files and saved selections remain untouched. Preview has no persistence or application mutation.
- New artwork.js is the authoritative geometry for transparent SVG exports, preview renderer and generated React components. Named body, feet, appendages, eyes, eyebrows, mouth and details groups remain editable.
- Amber #FAAE54 is the most frequent warm foreground pixel sampled from the supplied PNG. Source contains shading and antialiasing; a flat vector fill does not claim pixel identity.
- At 24px, Router indicator dots and Switch ports are hidden. Faces and silhouette remain consistent.
- Idle blink, hover smile/tilt, attentive listening, thinking gaze/tilt and transient happy expression are isolated to the active preview. Gallery stays still. Toggle, reduced motion, background and offscreen pauses are supported.
- Success here names a visual expression demonstration; it never claims a device or operation succeeded. Runtime status remains separate.

## Review surface

`http://127.0.0.1:8767/avatar-system/four-preview.html`

Owner decision must explicitly cover shape/face similarity and motion before the remaining twelve or P4 integration. No approval inferred from test passes.

## Reusable lesson

When a user says "as it is" but supplies only raster artwork, resolve source fidelity first. Preserve the original, obtain reconstruction permission, and demonstrate a small representative family in actual application contexts before broad replacement. Separate visual acceptance from functional verification.

## Verification

Independent browser and preservation checks: 32/32 passed (avatar-four-checks.json). Includes editable groups, still gallery, one active animation, controls, transient expression reset, reduced motion/toggle, offscreen pause, keyboard, narrow layouts, no storage writes and unchanged P4 source hashes. React transpilation and 12/12 static-render geometry comparisons passed (avatar-four-react-check.json). Root inspected the side-by-side screenshot. These checks do not establish owner visual approval.
