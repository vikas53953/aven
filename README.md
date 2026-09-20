# Aven — current source and handover

Start with [HANDOVER.md](HANDOVER.md) for completed/current/pending work, workflow, verification and publication limits. [vikas53953/aven](https://github.com/vikas53953/aven) is the shared source and documentation home. This is the 19 September 2026 source snapshot. The sections below preserve historical project documentation; their dated status counts are not the current acceptance ledger.

## Run the current application

Use Node 24.16 or newer, run `npm ci --prefix intentgraph`, then
`./Start-IntentGraph.ps1` and `./Start-NetrokMuse.ps1`. The frontend opens
http://127.0.0.1:8767/polished.html. If Windows finds an older Node first, pass
`-NodePath 'C:\path\to\supported\node.exe'` to the backend launcher. Both launchers
accept `-NoBrowser` for terminal-only startup and leave occupied foreign ports alone.
See the [runtime reference](intentgraph/README.md) for admission, backup and recovery contracts.

Use **Model: default** in the composer to open **Models & providers**. **Use this model**
saves the provider/model/effort choice for that conversation immediately. Only advertised
configured choices are available; configuration alone does not verify connectivity.
Active/queued requests lock changes, and retries/clarification retain their original
selection. **Use service default** restores the existing OpenCode default. This slice
does not add credential setup or new production provider adapters. Enable **Show run details**
in Settings to see requested and provider-reported selections separately; missing
reported fields appear as unavailable.

Plan or Inspect can ask one clarification in the conversation. Select a choice or
enter an allowed answer and use **Continue**, or **Cancel request**. Waiting keeps
execution serial. Accepted answers collapse into a small **Answered: Core switch**
row (using your answer). Click the row, or focus it and press Enter or Space, to
expand or collapse the original question, answer and **Refresh saved state** control.
Expansion is retained through refresh and conversation navigation in the same page;
reloading returns answered rows to their collapsed default.

After reload, a saved waiting question cannot continue: cancel it and
send a fresh request. A draft warning means edits are held only in that tab; copy
them before reloading. Clarification supplies scope and grants no execution approval.

# Netrok Muse â€” local visual prototype

An independent network-engineering interpretation of Meta Muse, built as IntentGraph trial 01. This is a browser-based local prototype, not Meta's product or a packaged Windows executable.

Open http://127.0.0.1:8767/ while the preview server is running. To reopen later, run `Start-NetrokMuse.ps1` from this folder. It requires the already installed Python runtime and starts a loopback-only static server. Alternatively run `python -m http.server 8767 --bind 127.0.0.1` in this folder.

Try the sample incident, evidence drawer, simulated investigation decision, goals, activity, settings, and reference feedback. Prototype data stays in this browser's local storage. Clearing browser site data removes it. No model API or network device is connected; lab results are sample content.

The product interpretation is pending user approval. Read `.intentgraph/project.md` for intent, reference coverage, and proposed criteria; `.intentgraph/evidence.md` for actual verification status. This prototype does not provide IntentGraph's live team dashboard, automatic code graph, or enforcing hooks.

Reference: https://introducing.muse.ai/ and https://muse.ai/ inspected September 10, 2026. The signed-in desktop interface was not inspected; desktop composition is a proposal.

## Current architecture and implementation status

The paragraphs above describe the original visual-only prototype. They are historical: the active shell is [polished.html](http://127.0.0.1:8767/polished.html?revision=ux-pipeline-v7), with OpenCode chat, LangChain/LangGraph, inventory and limited read-only diagnostics connected. For current implementation and acceptance limits, open the [architecture atlas](http://127.0.0.1:8767/docs/architecture/) or read [the HLD](docs/architecture/HLD.md). Maintain these documents with each architectural change.

## Central UI/UX feature register

[Aven UI/UX feature register](outputs/01a0a3bc-a376-74e1-8d48-e4029c2cb5a2/Aven-UI-UX-Feature-Register.xlsx) is the single comparison and improvement worklist, dated 15 September 2026. It covers 115 checks against inspected Grok Bot/Codex surfaces and documented Claude Code capabilities. Implementation starts at row 11 (UX-001): finish Needs fix first, then Missing and Partial entries by dependency. Filter by phase, priority, current state or delivery. Update delivery and evidence in this workbook; preserve user edits rather than regenerating it from the initial builder. Verified means the recorded checks passed; owner acceptance remains a separate state.

## UI pipeline checkpoint Â· 16 September 2026

Register: **80 verified, 10 partially implemented, 21 not started, 4 deferred** (115 total).

Build `ux-pipeline-v7` adds validated text attachments, Ideas/Goals, a real activity feed and raw-evidence artifacts, interrupted-run recovery, Plan mode with zero tools, evidence annotations/comparison, and reviewed local file editing. Pane resizing, accessible run state and failure-safe local note saves are tested. Browser and computer panes explicitly report unavailable sessions. Provider switching, network-change approval and other unfinished integrations remain in the central workbook; remote/account items are deferred by user choice.

Evidence: [.intentgraph/evidence/pending-88-20260916/](.intentgraph/evidence/pending-88-20260916/). Tests use isolated browser storage, mocked provider/device traffic and in-memory file handles. The backend suite passed 58 tests in serial; local status endpoints were checked after service restart. Real OS folder-picker interaction, provider/device reachability and owner acceptance remain separate from these checks. The workbook is the single status source.
