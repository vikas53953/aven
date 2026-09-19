# Chat control and CLI evidence

Original implemented checkpoint: 2026-09-15. Admission addendum: 2026-09-19.

## Where the behavior lives

- Frontend (`polished.js`): follow-up queue, editing/removal, explicit Resume, steering control and raw CLI terminal rendering.
- Backend API (`intentgraph/server.cjs`): binds steering to an active run and chat, acknowledges receipt, closes steering when the final model response is produced. Durable request admission is settled separately after evidence persistence.
- Agent runtime (`intentgraph/agent-runtime.cjs`): LangChain middleware adds accepted guidance before the next model step. An already-issued device command cannot be recalled by steering.
- Execution (`intentgraph/network-commands.json`): one 25-command Cisco read-only catalog shared by Catalyst Center and Nornir/Netmiko. Device/controller support is checked by execution results, not inferred from the catalog.

## Queue versus steer

Queued messages are separate future turns, dispatched in order after a successful reply. Stop, errors and reload pause the queue. Editing a queued message pauses dispatch. Each chat holds up to eight pending messages, each at most 4,000 characters.

Steering changes the current run at its next model boundary. Received and applied are distinct events. Guidance that cannot be applied is retained for a later turn, with the queue paused. A run admits at most eight steering messages. The short-lived steering token is not saved in browser history or backend event evidence.

## Terminal contract

The terminal displays the returned CLI string using a text node and preserved whitespace. Copy copies that output. Model commentary remains separate. No prompt, table or success result is invented. Failure output remains failure output. Large output is bounded, with truncation disclosed outside the output.

## Evidence and limits

- All 58 Node tests passed, including active-run binding, steering boundaries, command dispatch and raw-output preservation.
- Live OpenCode/Catalyst test applied steering and executed `show ip interface brief` successfully. Evidence: `.intentgraph/evidence/live-steering.json`.
- Live `show inventory` and `show clock` succeeded. `show ip bgp summary` returned FAILURE with `% BGP not active`; its raw error is preserved. Evidence: `.intentgraph/evidence/expanded-cli.json`.
- Browser stream rendering, escaped output and reload persistence passed in an isolated browser.
- Four browser checks passed for queue editing/removal and dispatch, late steering acknowledgement, exact Copy payload, reload pause and Stop pause. Windows clipboard reads normalize newlines; the text passed to Copy is checked independently.
- The live browser queued `show clock` after `show ip interface brief`, displayed both raw terminals, and copied the output successfully. Evidence: `.intentgraph/evidence/chat-controls-live-ui.json` and `.png`.

This does not certify every catalog command on every device. Direct SSH still requires a configured reachable lab profile. Durable server-side conversation queues and multi-customer scheduling remain future work.

## Durable admission addendum — 19 September 2026

`polished-admission.js` retains request identity and exact submitted context. The API uses a local SQLite receipt before dispatch; duplicate transport submissions return the same run without responder work. “Check saved run” is read-only. “Recover interrupted run” explicitly records UNKNOWN and releases only a stranded owner-safe slot, without replay. Another tab cannot clear a live admission on reload. Queued work remains paused after interruption/reconciliation and needs explicit Resume.

Current evidence: [75-test WSL run and loopback browser checks](../evidence/admission-2026-09-19/README.md). The historical live observations above remain dated; they were not rerun. Windows behavior and owner approval remain unverified. These receipts do not make external commands resumable, and they do not introduce parallel execution or durable server-side conversation queues.
