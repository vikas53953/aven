# Execution integration scope — 2026-09-13

Owner instructions: accept the expanded avatars; use the supplied OpenCode Go subscription key and a low-cost model; explore cheap/free/open-source browser, computer and network options and connect them; implement automatic coordination/feedback and real build/merge gates. Follow-up target: Cisco Sandbox.

## Delivery contract

- Retain the approved avatar artwork and app UI. Add execution controls to the IntentGraph workspace.
- Protect the provider credential with Windows DPAPI outside the project; pass it to the fixed OpenCode endpoint only. Do not put it in argv, prompts, source, telemetry or browser responses.
- Default to MiMo V2.5, bounded token/call/time budgets, explicit error classification and no model/provider fallback. Provider calls must report actual results and usage.
- Coordinate a bounded task from its approved baseline and candidate file scope. Show the builder's proposal before applying it. Revalidate the baseline, assignments, real paths and source hashes at apply time.
- Keep model-generated content untrusted: schema validation, size limits, no arbitrary shell commands, no deletes, no changes to credentials/runtime/gates/baselines or outside the original file allowlist.
- Preserve restart/cancel behavior and a single active run. Restart must not replay a write or tool side effect. Stop after bounded correction attempts.
- Feed review findings and user feedback into the next builder attempt. A model verdict does not establish owner visual acceptance or authorize release.
- Use isolated Playwright contexts and selected-window Windows UI Automation. Preview action details; bind short-lived, single-use approval to the precise action and target. Inspect locally without automatically sending screenshots or desktop contents to a provider.
- Limit network commands to explicit read-only commands on configured devices with strict host-key validation. No scanning, guessed credentials, configuration changes or automatic trust-on-first-use.
- Run fixed trusted checks with captured evidence, bounded execution and a credential-free child environment. Re-evaluate the release gate against the current candidate afterward. Do not claim an OS network sandbox.
- Install hooks only into an explicitly selected existing repository, preserving existing hooks. This non-Git workspace cannot perform a real merge; demonstrate hook behavior in an isolated fixture and report that boundary.

## Evidence requirements

Test malformed/provider-injected responses, path escape/symlink denial, stale source and baseline, cancellation/restart/retry budgets, missing credentials/provider errors, browser redirects and target changes, unselected desktop control, unknown SSH host keys and disallowed commands, stale review rejection and missing Git repository. Keep fixture success separate from actual provider/browser/desktop/device evidence.

## Cisco discovery

The current sandbox catalog remains on a loading screen in the inspected browser. Cisco announced a reservation-platform transition from August 2026 with Always-On continuity being handled separately. The officially published `sandbox-iosxe-latest-1.cisco.com:22` accepted a bounded TCP connection on this PC. This proves reachability only; no credentials were tried and no authenticated device session is claimed. Current access details and trusted host-key material remain unresolved.
