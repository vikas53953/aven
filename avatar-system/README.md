# Network coworker avatars v2

Current checkpoint: the first four were approved by the owner. All SIXTEEN vector recreations, SVG exports, named React wrappers and nine presentation states are implemented. Use `gallery.html` for the complete family. `four-preview.html` resolves to the preserved approved checkpoint. Integration verification passed; expanded-family owner visual acceptance remains separate.

Run `node avatar-system/export.cjs` from the project root to regenerate SVG/React exports from artwork.js. React consumers import avatar.css; React is an additive deliverable, not a conversion of the current HTML/JS application. Only trusted generated geometry is used in the renderer. Host applications own the active-preview flag and transient-expression lifetime; the preview controller demonstrates success returning to idle after 1.1 seconds. Never derive device health from an expression.

The supplied sheet is authoritative. Preserve idle silhouettes, faces, feet, spacing and amber. Do not reinterpret them as new icons. Source image: `../.intentgraph/references/avatars-v2-original.png`.

## Emotion and motion contract

| State | Visible meaning | Motion when this coworker owns activity |
|---|---|---|
| Idle | Original face and artwork | Mostly still; an occasional blink only for the focused coworker |
| Hover | Original face, subtle lift/tilt and outline | Tilt at most 2 degrees; return smoothly on pointer leave |
| Selected | Persistent selection outline | Gentle halo; selection is also communicated by container/text |
| Listening | Attentive eyes, listening status label | Quiet halo/breathing; no exaggerated ear or mouth movement |
| Thinking | Concentrated gaze, thinking label | Slow tiny tilt or gaze shift; no full-body spin |
| Speaking | Speaking label, small mouth variation if original vector structure supports it | Restrained mouth movement; never imply audio synchronization without audio data |
| Success | Brief pleased expression and success marker | One small bounce, then return to stillness; not a permanent loop |
| Warning | Attentive expression and warning marker/text | Static by default; no alarming flashing or shaking |
| Offline | Original recognizable silhouette, muted treatment and offline label | Completely still |

Original idle facial expressions differ by role in the reference; preserve those differences. State variants must return to that exact idle appearance. If original vectors do not expose separable face/appendage parts, use body/halo/status treatment rather than silently redrawing the asset.

## Personality without chaos

- Only one selected/focused coworker owns conspicuous motion in a view. Gallery tiles are still until directly previewed.
- Eye blink, mouth shape, antenna/ear/leaf/tuft sway and tiny body tilt are the permitted channels. Do not move every part at once.
- Use amplitude limits from tokens.json, scaled with the avatar. Small sizes keep readable silhouettes and avoid added fine detail.
- Never use random timers per gallery tile, strobing, repeated success bounces, fast orbiting rings or continuous whole-body wobble.
- Pause offscreen/background previews. An uploaded photo receives no facial animation, transform or invented body parts.
- Reduced motion disables all animated channels, including rings. Selected, listening, thinking and speaking remain legible through static treatment and text.
- Decorative avatars use aria-hidden. Identity-bearing standalone avatars receive a concise accessible label. Put status changes in one semantic text location; do not announce animation frames or duplicate nearby labels.
- Interactive wrappers are keyboard-operable buttons with a visible focus ring and names such as “Choose Cloud avatar.” State meaning never depends only on orange/green/red.
- A preview control selects a visual state only. It must not suggest a real agent is listening, working, speaking or connected.

## Intended completed structure

- `tokens.json` — role, size, state and motion catalog.
- `source/` — original vector source and provenance, or explicitly approved vector recreation.
- `svg/<role>.svg` — sixteen generated SVG exports.
- `react/NetworkAvatar.tsx` — shared typed renderer, plus named wrappers such as CloudAvatar and RouterAvatar.
- `avatar.css` — shared restrained motion and reduced-motion styles.
- `gallery.html` — role/state/size preview and examples for sidebar, picker, details, chat, empty state and onboarding.

Generate all framework/export variants from the same authoritative artwork source; do not hand-maintain sixteen unrelated React and browser drawings.
