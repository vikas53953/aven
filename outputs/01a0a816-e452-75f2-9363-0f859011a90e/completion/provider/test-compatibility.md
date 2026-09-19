# Baseline lifecycle compatibility

The provider gate now requires a capability record before accepting an explicit or legacy default chat request. Three frozen baseline tests used a provider status stub of `{}` and therefore modeled no configured provider:

- `intentgraph/agent-stream.test.cjs`
- `intentgraph/chat.test.cjs`
- `intentgraph/steering.test.cjs` (the two server-start cases)

`test-replacements.json` adds the same test-only OpenCode/MiMo V2.5 capability fixture to those server starts. The fixture is configured but disconnected, so the lifecycle tests retain a valid first-use request without claiming reachability. It does not change production files or bypass the selection gate.

The patched tests pass against the assembled candidate with the local Node runtime. The run used no provider request, vault access, credential, or external call.
