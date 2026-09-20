# Provider picker and native Windows checks — 20 September 2026

## Scope

UX-027 advances to **Partial**, not fully accepted. The composer opens Models & providers. A conversation can save an advertised provider/model/effort tuple. Locally configured models are selectable with connection explicitly unverified; unavailable providers remain disabled. The service default remains OpenCode MiMo V2.5 with no effort setting. This slice adds no credential entry, provider onboarding, speculative network adapters or action execution.

Selections are copied into new requests and included in admission identity. Saved retries retain their original body. Clarification retains its admitted selection and runtime context; settings cannot change an active or queued request. Requested and provider-reported provenance are distinct; missing reported metadata stays unavailable. A configured connection does not establish reachability.

## Native Windows evidence

Used Node.js 24.19.0, Windows PowerShell, the real launch scripts and a separate loopback fixture for chat behavior. The system-default Node 24.11.0 was rejected by the existing minimum-runtime check. `Start-IntentGraph.ps1 -NodePath <supported-node.exe> -NoBrowser` supports an explicit installed runtime.

- Frontend launcher opens `/polished.html`, verifies served bytes, supports `-NoBrowser`, and preserves an occupied foreign port.
- Backend launcher startup, reuse and restart succeeded. Readiness now uses bounded `/api/health`; the former `/api/index` response was about 64 MB and timed out during PowerShell JSON parsing.
- Browser reload retained existing conversation history and saved model/effort preference.
- Offline alternate-model clarification completed with exactly two responder calls (initial request and one continuation). Both requested and reported fixture selection remained `opencode / fixture-alternate / low`. Provider and device calls were zero.
- Model selection was disabled during the active/waiting request. Unconfigured providers were visibly disabled; configured-local status explicitly did not claim connectivity.
- The compact answered-row review separately checked keyboard expansion, visible refresh success/error and focus, navigation, restart/reload and 390px presentation against its exact reviewed commit.

The first native full-suite attempt exposed open SQLite handles in clarification test cleanup and was stopped after it ceased progressing. A subsequent run passed 101 tests, failed one Windows-only attempt to rename an open SQLite database, and skipped 23. The corrected test now asserts Windows protects the open database, then checks file loss after shutdown. The final serial suite completed: **102 passed, 0 failed, 23 skipped**, 125 total, in 59.2 seconds. Skips are existing optional mounted-browser/adapter checks. Earlier interrupted/failed attempts are not passes. The six focused storage tests also passed after correction.

## Limits

Windows launch and loopback behavior are tested; this is not full installed/packaged Windows application acceptance. No stored credentials, external providers, devices, deployment or customer release were used. Provider onboarding and non-OpenCode production adapters remain pending. The original connected-provider acceptance criterion is not closed by configured-local fixtures. Prior evidence-versus-receipt ambiguity and explicit cancellation after restart remain unchanged. Owner visual acceptance and assistive-technology acceptance remain separate from these checks.
