# IntentGraph runtime delivery — 12 September 2026

The earlier status that the live graph and team dashboard were unbuilt is superseded by this local runtime delivery. Historical avatar/prototype evidence remains unchanged.

## Available locally

- `http://127.0.0.1:8768/`: Code & index, Agent team, Review checkpoints.
- `Start-IntentGraph.ps1`: start/reopen the loopback service without stopping an unrelated port owner.
- `intentgraph/cli.cjs`: agent-readable query, source, state, action and gate commands.
- `intentgraph/trace.cjs`: explicitly instrumented Node spans, with async parent IDs and reduced-motion UI handling.

The current runtime task records actual reporting sessions from this work. A missing planner assignment is shown as missing; no fictional independent planner has been added. File events come from the watcher and do not imply knowledge of which process edited the file. The service records feedback; automatic delivery into model conversations still requires an adapter.

## Acceptance boundaries

The runtime baseline is a draft for owner review. Implementation and fixture tests do not constitute owner approval. The release endpoint remains blocked until the task has the required approval, assignments, fresh evidence and review verdicts. Backend fixture approval/release tests run in separate temporary projects.

Existing Aven avatar acceptance and this runtime UI acceptance are distinct. The approved four-character direction and expanded sixteen-character assets were not changed by this delivery.

## Still pending

1. Owner review of the runtime views and expanded avatar family.
2. AI provider/model choice and a real dispatch adapter. OpenCode 1.18.16 was found locally; no provider account, key or model call was used.
3. Automatic agent launch, feedback delivery and continuous review integration. The current sessions report through the API/CLI.
4. Delivery-command/Git-hook integration in an actual repository. This folder is not a Git repository; the local service cannot enforce unrelated filesystem or Git actions.
5. Real browser/computer/network-device execution with explicit targets and connection settings.

Verification scripts and limitations are documented in `intentgraph/README.md`. Runtime test outputs and screenshots live under `.intentgraph/runtime`, outside the candidate file index.
