# Avatar family v2

## Authorization and baseline

Owner accepted the four-character checkpoint: “Expand the family. I am pretty much okay with whatever you created.” This completes the explicit first-four approval gate. Earlier instructions authorize expanding to all sixteen and integrating the same design language without changing unrelated application UI after approval.

Approved Cloud, Router, Firewall and Switch geometry is preserved byte-for-byte at every supported size. The complete approved preview and pre-integration P4 sources are frozen in `baselines/avatar-four-approved/`. The source PNG remains unchanged in `references/avatars-v2-original.png`.

## This slice

- Add Load Balancer, Wi-Fi, DNS / DDI, SD-WAN, Leaf, Spine, Server, Storage, VPN, Proxy, Monitoring and Controller, preserving their reference silhouettes and individual faces.
- Shared amber #FAAE54, face #16302C, rounded feet, pill/arched eyes, smile geometry and named editable groups.
- Sixteen SVG assets and named React components generated from one `avatar-system/artwork.js` source.
- Six sizes: 20, 24, 32, 48, 64 and 96px. Fine indicator details omitted at 20/24px.
- Nine reusable presentation states, demonstrated in `avatar-system/gallery.html`.
- Existing avatar picker integrates the family; existing photos and explicit colors remain user-owned.

## State and motion semantics

| State | Presentation |
| --- | --- |
| Idle | Original role-specific face; occasional blink on the active preview only |
| Hover | Slight tilt and broader smile |
| Selected | Persistent soft emphasis, restrained breathing when motion enabled |
| Listening | Attentive eyes, small appendage response and breathing |
| Thinking | Tiny gaze shift and thoughtful tilt |
| Speaking | Small mouth movement, not audio-synchronized |
| Success | Brief happy expression, single small lift; preview resets after 1.1 seconds |
| Warning | Attentive eyes; static treatment |
| Offline | Muted, fully still treatment |

These states are visual vocabulary, not inferred network conditions. The app does not generate runtime success, device health, microphone, audio or connectivity state. Gallery controls demonstrate states. A host must supply actual operational state independently.

Motion belongs to at most one active avatar. Picker/gallery options remain still. Reduced motion disables animation; the preview also has an explicit toggle and pauses offscreen/background. Uploaded photos do not gain animated facial features or body transforms.

## Persistence and compatibility contract

Canonical role aliases for older saved choices: mesh → SD-WAN; rack → Server; wireless → Wi-Fi; fiber → Controller. Rendering resolves these aliases without bulk-writing stored records. Existing explicit colors, photo data, seeds, identity, conversations and documents must remain intact. Existing direct role names keep their selected role with the approved geometry. New avatars default to Cloud in amber.

The profile's immediate selection/save behavior, custom color controls, local photo upload and existing context menus remain in place. No unrelated layout redesign or backend work is included.

## Evidence boundary

Owner approval covers the first four and permission to expand. Acceptance of the remaining twelve and final integrated appearance is a new visual review, distinct from technical verification. The IntentGraph index remains a manual snapshot, not live graph telemetry or enforced hooks.

## Delivered checkpoint

AV2-ae8ad3e219bd — 2026-09-12T16:28:35.666Z. Gallery 10/10 groups passed; integrated app 10/10 groups passed; React 96/96 geometry parity passed. Sources remained stable during each completed run. Root inspected both gallery and integrated picker. Avatar observer cleanup prevents detached avatar nodes accumulating during repeated edits. Tests do not establish owner visual acceptance of the expanded family.

## Owner acceptance — 2026-09-13
The owner accepted the expanded avatars: 'this looks good', explicitly responding to 'Your visual acceptance of the expanded avatars'. This supersedes the earlier pending expanded-family visual acceptance. It does not approve the separate IntentGraph runtime interface or future execution integrations.

