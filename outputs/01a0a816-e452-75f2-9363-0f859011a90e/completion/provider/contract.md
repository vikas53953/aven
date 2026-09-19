# Provider selection contract

The server accepts the existing chat body unchanged for legacy clients. An explicit selection is optional but, when present, must have this exact shape:

```json
{
  "selection": {
    "providerId": "opencode | openrouter | anthropic | openai",
    "modelId": "provider-advertised-model-id",
    "effort": "none | low | medium | high | max"
  }
}
```

The server validates explicit selections against an injected capability snapshot before it creates a run or calls an adapter. A provider and advertised model are selectable when they are `configured` (first use is allowed while reachability remains unverified) or `connected`, and the model lists the selected effort. Unknown and unavailable states remain disabled and retain a reason. A supplied model without its own availability signal stays unknown; it never inherits a provider's connected state. A request without `selection` resolves to the configured OpenCode/MiMo V2.5 default for backwards compatibility, validates that default at dispatch, and is marked `source: "configured-default"`.

`GET /api/capabilities` returns `{schemaVersion, checkedAt, providers}`. The four provider IDs are always present. Model lists for providers without an injected catalog are empty; this means availability is unknown or unavailable, never that a provider has no models in the world. The server does not retrieve or return credentials.

The local Settings setup form may `POST /api/provider-config` with
`{providerId, modelId, effort, credential?}`. The request is accepted only for
one of the four provider IDs, a supported effort, and a bounded model ID. When a
key is supplied on this explicit local Save action, the service stores it under
the fixed provider-specific vault reference using the OS-protected vault; the
key is never persisted in the browser, config file, response, or log. When the
key is omitted, an existing vault entry is required. The service merges the
model/effort into the nonsecret `<runtimeDirectory>/provider-config.json` file,
reloads its capability snapshot, and returns the same sanitized provider list
with `configured: true`, `connected: false`, and an unverified reason.
OpenCode's built-in adapter currently accepts only `effort: "none"`; the
Settings form disables other efforts for that provider until a distinct native
mapping is confirmed. `GET /api/provider-config` returns the sanitized
capability view; both endpoints
are loopback-origin protected and setup makes no provider request.

The lower-level runtime helper still accepts an injected named `credentialRef`
for tests and host integration. The visible Settings flow does not expose that
reference and uses the fixed mapping for OpenCode, OpenRouter, Anthropic, and
OpenAI.

The server accepts an explicit `providerRuntime` or builds one from
`providerConfigs`, `getProviderKey`, `providerFetch`, and
`providerModelFactory`. `providerConfigs[providerId]` may supply a capability record plus
provider-specific `getKey`, `fetchImpl`, or `modelFactory` functions. These are
host-owned references; the runtime config does not read environment variables,
vault values, browser state, or endpoints. When a provider config is present,
the runtime defaults transport to the host's process fetch and the adapter
still enforces the official HTTPS origin/path allowlist. A configured provider
without a custom model factory uses the selected provider adapter through the
same injected/default transport; a custom factory remains an explicit host
escape hatch. OpenCode requests retain a stable per-chat session header and
user-agent. No provider request occurs until the host supplies a credential
getter and the validated selection is dispatched.

Responses carry `requestedSelection` and `provenance`. `provenance.effective` is populated only from provider response metadata; `provenance.source` is `provider-response` when metadata was returned and `request-selection` when it was not. `provenance.usage` is `null` when the provider omitted usage. The UI can keep the requested picker value visible while labeling effective model/effort as unavailable until response metadata exists.

The context metadata passed with a chat request is bounded and descriptive only: `windowMessages`, `windowCharacters`, `retainedMessages`, `retainedCharacters`, `omittedMessages`, and `totalMessages`. A missing limit or count stays `null`; no percentage is synthesized.
