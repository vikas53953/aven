# Execution choices — researched 13 September 2026

The owner approved the sixteen-avatar family and authorized OpenCode Go, low-cost models, execution adapters, automatic coordination and delivery gates. The selected network target is Cisco Sandbox; current access must be verified before using any historical hostname or credential.

| Area | Options compared | Initial choice and reason |
|---|---|---|
| AI | OpenCode Go MiMo V2.5, GLM Flash, larger coding models; local model hosting | MiMo V2.5 on the existing Go subscription. Documented input/output rates are $0.14/$0.28 per million tokens; use bounded calls and no automatic provider fallback. Local models avoid API charges but require suitable hardware and separate quality evaluation. |
| Browser | Playwright, Browser Use, hosted browser services | Local Playwright: already available, inspectable DOM and reproducible isolated contexts. Browser Use adds model-driven browsing, which can add token use. Hosted services are unnecessary for this local first slice. |
| Windows desktop | pywinauto/UI Automation, PyAutoGUI | pywinauto for named controls and selected-window identity. Coordinate automation is a fallback for inaccessible controls, not the default. Elevated and custom-rendered apps may require additional support. |
| Network | Netmiko, Scrapli, Nornir | Netmiko for the first multi-vendor SSH adapter. Scrapli is a reasonable alternative, especially for async workflows. Nornir adds inventory and parallel execution when fleet orchestration is needed. Start with exact read-only commands. |

These selected automation libraries are open source and do not require hosted automation subscriptions. Model calls, device hosting and optional cloud services have separate costs. The comparison covers relevant leading options, not every tool available.

OpenCode lists MiMo V2.5 as not used for training with zero-day retention. Its Go endpoint is `https://opencode.ai/zen/go/v1/chat/completions`. A bounded connection check returned HTTP 200 using `mimo-v2.5`, with 260 input and 23 output tokens. Only a generic connection-check prompt was sent. Account-side balance fallback settings were not changed.

The supplied credential is stored outside the project using Windows DPAPI for the current user. It is not included in source, model prompts, browser responses or telemetry. Local software running as this Windows user remains within the same trust boundary.

Sources:

- [OpenCode Go models, pricing, protocol and privacy](https://opencode.ai/docs/go/)
- [Playwright](https://github.com/microsoft/playwright)
- [Browser Use](https://github.com/browser-use/browser-use)
- [pywinauto](https://github.com/pywinauto/pywinauto)
- [PyAutoGUI](https://github.com/asweigart/pyautogui)
- [Netmiko](https://github.com/ktbyers/netmiko)
- [Scrapli](https://github.com/carlmontanari/scrapli)
- [Nornir](https://github.com/nornir-automation/nornir)
- [Cisco Sandbox](https://developer.cisco.com/site/sandbox/)
