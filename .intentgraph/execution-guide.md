# Local execution — 13 September 2026

Open `http://127.0.0.1:8768/execution.html` after running `Start-IntentGraph.ps1`.

## Use the team

1. In Code & team, register distinct planner, builder, reviewer and acceptance sessions.
2. Define and approve a baseline, then create a task with explicit existing candidate files and those four assignments.
3. In Execution, select the task and start the team. The planner and builder use OpenCode Go MiMo V2.5.
4. Inspect the proposed file contents. Apply only the proposal you accept. Changed source, references or assignments invalidate that proposal.
5. Engineering, planning and experience reviews run after application. Failed reviews feed a correction proposal back to the builder. Each correction needs its own apply action.
6. Run trusted checks and inspect evidence. Source review is not runtime testing or visual acceptance. Release remains a separate checkpoint.

This is a bounded source-editing coordinator: one active run, at most 12 provider calls, 48,000 output tokens, ten minutes and two correction rounds. Restarted work requires manual resume. It does not run model-generated shell commands, add arbitrary files, or silently change its own runtime. The four roles use the same selected model with separate role context; this does not establish independent model judgment.

## Use local tools

- Browser: open an isolated browser, inspect it, then preview and approve an exact click or text entry. The initial URL allowlist is the two local application origins on ports 8767 and 8768. This browser has no access to your normal logged-in profile.
- Computer: list windows, select one, inspect its controls, then preview and approve a control action. UI Automation may not expose usable controls in every application. Only the selected window is controlled.
- Network: a Netmiko adapter is installed. Cisco Sandbox is the selected target, but no device session is authenticated yet. The owner will provide current access details. The adapter requires an explicit profile, a network-only credential reference and a trusted SSH host-key file. Only the three listed read-only commands are accepted.

Browser and desktop approvals expire after 60 seconds and work once. Their local tool panels are implemented; the source coordinator does not autonomously invoke them or transmit their contents to the AI provider. A model-driven tool loop remains a separate integration step.

Credentials are stored outside this repository with Windows current-user DPAPI protection. To enter a future Cisco password locally, use `node intentgraph/vault.cjs network-cisco-sandbox` and supply it at the protected stdin prompt. Do not place passwords in a profile, command argument, source file or chat.

## Delivery boundaries

The current project folder is not a Git repository. Trusted local checks can run, but no hooks have been installed into this project and no merge has been performed. See `intentgraph/delivery.md` for the reusable hook installer and its limits. Remote branch protection is not configured.

The expanded avatar family has owner visual approval. The new execution workspace and the application's overall runtime experience still need owner evaluation.

## Evidence

- OpenCode connection preflight: HTTP 200, 283 total tokens.
- Real coordinator fixture: five MiMo calls, an explicitly applied tiny source proposal, three source reviews, then awaiting owner. Only generated test-fixture content was sent; production files were not changed by that run.
- Native Windows fixture: real inspection, text entry, button invocation, and replay rejection passed.
- Execution UI: provider configuration, adapter availability, non-Git status, request-token rejection, artifact confinement, actual browser inspection/screenshot, 390px layout and JavaScript-error checks passed.
- Final suite totals and revision hashes are recorded in `.intentgraph/evidence/execution-verification.json` when integration verification completes.

Options, pricing and primary sources: `.intentgraph/execution-options.md`.

## Cisco shared sandbox integration

The polished prototype exposes **Composer + → Network sandbox → Load inventory**, also available in the right-hand Plugins tab. This requests a timestamped device inventory through the local service on port 8768. Chats are not transmitted to Cisco or an AI model by this action.

The fixed destination is `sandboxdnac.cisco.com`. Only token authentication and the read-only network-device inventory endpoint are supported. Shared credentials are stored in Windows DPAPI, not in browser storage. Published credentials can change; this is not a guarantee of permanent access.

The owner approved the exact leaf certificate fingerprint recorded in `.intentgraph/runtime/catalyst-trust.json`. An unmatched certificate is rejected before HTTP credentials are sent. No blanket certificate-trust bypass or arbitrary URL proxy is exposed. Requests have a size/time limit, one active fetch, and a 30-second inventory cache.

Source for the published shared sandbox access: https://catalystcentersdk.readthedocs.io/en/stable/api/quickstart.html

This connection does not enable SSH configuration or autonomous network-device changes. Model-driven tool execution remains separate work.

## Live prototype text chat

The polished composer now calls the existing OpenCode Go provider using MiMo V2.5. Enter sends; Shift+Enter adds a line. Replies are stored in their originating conversation. Pending replies disable sending, and provider failures show an explicit manual retry without adding a duplicate user message.

Only the latest 24 real text messages, limited to 32,000 characters, are sent with each request. Sample conversation content, files and inventory are excluded. File attachments are explicitly rejected by this text-only path and remain in the composer. A single primary selected coworker answers; this is not autonomous multi-agent tool execution.

The server accepts only the exact local frontend/service origins with a dedicated chat header. It reuses the encrypted local OpenCode credential, fixed provider endpoint/model, 1,024 output-token cap and provider timeout. It does not expose the key or generic action token through the chat route. No automatic retry occurs.

The protected server baseline was reviewed and regenerated for this owner-authorized integration; previous pins are backed up in `.intentgraph/runtime/delivery-config.before-chat.json`.

## Chat inventory lookup and working indicator

The chat now renders a transient named working card while a request is pending, with reduced-motion fallback. It is removed on completion/failure and is never saved as a message.

Explicit read-only inventory questions such as `check the sw1 ip add` use the existing pinned Cisco connector and a local formatter. Replies contain actual inventory fields and retrieval time. This is a bounded inventory lookup, not general autonomous CLI execution. Mutation requests are excluded. Inventory tool replies are excluded from subsequent model history, so this path does not send Cisco records to OpenCode.

Verification: route tests cover known/missing device, connector failure, mutation exclusion, zero model calls for inventory, and existing route access controls. Browser checks verified working visibility, disabled send, reduced motion, cleanup and a live sw1 IP reply. Evidence: `.intentgraph/evidence/chat-inventory.json`. Previous protected baseline: `.intentgraph/runtime/delivery-config.before-chat-inventory.json`.

## Semantic inventory questions (supersedes the keyword lookup above)

The previous keyword-based question router was removed after it incorrectly treated `run show version` as an inventory lookup. Chat now uses the configured model to choose an inventory read and select relevant devices/fields based on the conversation, including follow-ups. Actual values are rendered from the returned snapshot; model-supplied values, unknown fields, and invented hostnames are rejected.

This remains a bounded capability: two model calls and one fixed read-only inventory call at most, with a shared 60-second deadline. Public sandbox inventory is now supplied to OpenCode for field selection, and user-facing prior answers are retained in conversation context. No raw credentials or tokens are included. This supersedes the earlier no-inventory-to-model note.

CLI execution is not connected. The backend separately denies recognizable command requests and marks unsupported actions as not executed. Inventory software versions are not represented as `show version` output. General explanations still use the model.

Validation lesson: never treat an example question as a string-matching specification. Exercise paraphrases, contextual follow-ups, comparisons, and the contrast between recorded facts and actual command execution. Do not present an inventory response as proof of an executed command.

Semantic chat has a 2,048-token cap per model call (at most two calls), retaining the shared 60-second deadline. Initial live follow-up checks returned empty provider content; the response budget was raised and the full sequence retested. These failures must remain visible as failures, never canned inventory replies.

For this short structured chat path only, the request now explicitly supplies `thinking: {type: "disabled"}`; other provider callers retain their default behavior. MiMo documents this option at https://mimo.mi.com/docs/en-US/api/chat/openai-api . Live OpenCode compatibility is checked by the semantic-chat verification. An optional bounded model query hint is accepted but never executed as a command or URL.

### Final semantic chat flow

Supersedes the two-call description above: one fixed inventory preload (10-second limit, 30-second cache), then ONE model call with public snapshot context. Both share a 60-second deadline. Inventory JSON is capped at 12k characters and combined history plus snapshot at 48k characters. A missing snapshot does not block general explanations; inventory requests return explicit unavailability. The model selects names/fields, and the server formats only actual values. CLI denial precedes any inventory or model request. This removes keyword-based inventory routing while keeping unsupported execution explicit.

## Message usability follow-up

Added Copy controls and local timestamps to user/assistant messages, measured request duration on new replies, and a live working timer. Missing historical durations are not fabricated. Assistant text renders a safe subset of Markdown with DOM-created headings, lists, code blocks, bold text, and tables; raw HTML is not executed. Clipboard copies original message text.

Conversations open at the latest message. Replies follow the bottom only while the user is following the conversation. Failures now appear inline with a persistent manual Retry control, instead of silently leaving an unanswered question; no automatic retry is made.

Live MPLS tests succeeded in approximately 17s (API) and 14s (browser). These measurements do not establish why the earlier user request failed. Browser verification covered clipboard contents, timestamps, duration persistence, timer, formatting, HTML confinement, 390px layout, and live response. Separate error/retry test passed across reload. Evidence: `.intentgraph/evidence/message-tools.json` and `.intentgraph/evidence/mpls-diagnosis.json`.

## Command Runner chat integration (2026-09-13)

This replaces the earlier CLI-unavailable boundary. Explicit read-only requests are bound to the latest user message and a known sandbox device. The backend maps permitted commands to fixed strings and uses the pinned Catalyst Center Command Runner API. It submits once, polls the returned task ID, and downloads the result by validated file ID. It does not follow API-returned URLs or open arbitrary hosts.

Command responses show actual output, target, command, retrieval time and elapsed time. Inventory remains labelled inventory; general explanations use OpenCode. Unknown targets, unsupported commands and ambiguous requests do not execute. A timed-out submitted task may still run remotely; it is not automatically submitted again. Configuration commands and arbitrary shell execution are outside this path.

The existing conversation UI provides working indication, timestamps, copy controls and formatted output. Integration evidence is recorded in `.intentgraph/evidence/command-runner-chat.json` once the live browser checks finish. The original successful connector probe is `.intentgraph/evidence/command-runner-probe.json`.

Verified: 18 focused backend/chat tests passed. Live browser composer checks returned real SUCCESS output for `run show version on sw1` and `run show ip interface brief on sw1`; `What is MPLS?` returned an AI explanation. Screenshot and response evidence saved. Current command syntax is explicit `run <supported command> on <hostname>` (or `execute`); free-form questions remain LLM-supported, but arbitrary command paraphrases/configuration are not supported. Supported commands: show version; show ip interface brief; show interfaces status; show vlan brief; show ip route; show interfaces.
