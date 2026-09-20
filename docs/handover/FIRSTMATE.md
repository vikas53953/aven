# Firstmate setup and Aven continuation

Firstmate is a separate agent orchestration distribution, installed from
https://github.com/kunchenguid/firstmate. It is not a standalone skill that turns
the Codex desktop chat into a Firstmate runtime.

## Verified local setup

On 19 September 2026, the owner's Windows PowerShell launcher opened Ubuntu WSL,
then tmux and Codex CLI in a Linux Firstmate checkout. The detect-only bootstrap,
tool version checks, tmux startup check, GitHub sign-in and Codex sign-in passed.
The separate Windows checkout was updated while preserving its private state.

Linux tool versions checked: Codex CLI 0.155.1, gh-axi 0.1.35,
chrome-devtools-axi 0.1.34, lavish-axi 0.1.73, tasks-axi 0.2.5,
quota-axi 0.1.47, Treehouse 2.0.1, no-mistakes 1.75.2, GitHub CLI 2.101.0,
jq 1.8.2 and tmux 3.4. These are dated local facts, not minimum-version promises.
Windows and WSL have separate CLI installs; the Windows publication gate encountered
a Codex version mismatch described in [VERIFICATION.md](VERIFICATION.md).

The existing Windows launcher calls `wsl.exe -d Ubuntu -- bash` and the user's
`~/.local/bin/start-firstmate` script. That script checks required tools/sign-ins,
sets `FM_HOME` to `~/firstmate` and `FM_BACKEND=tmux`, and opens or attaches the
`firstmate` tmux session. Native Windows fleet execution and a native Codex desktop
Firstmate backend were not verified.

## Continue Aven

1. Use a Git checkout of https://github.com/vikas53953/aven as the shared project
   source. Reconcile newer changes from the original local non-Git folder first.
2. Give Firstmate the exact checkout path plus `HANDOVER.md`. Windows drive paths
   map to `/mnt/<drive>/...` inside WSL; quote paths containing spaces.
3. Ask it to inspect current source and candidate provenance, then summarize
   completed/current/pending work before proposing the next integration milestone.
4. Configure one working copy and isolated worker worktrees. Preserve local-only
   private state separately; do not copy credentials into the repository.
5. Run Aven's Windows-specific features in a compatible Windows environment.
   Firstmate running in WSL does not establish Linux compatibility for DPAPI,
   PowerShell launchers, browser/desktop adapters or historical test scripts.

No credentials, login codes, private Firstmate state, or third-party Firstmate
distribution files are included here. Review directory and hook trust prompts in
the actual agent UI. Firstmate does not inherit the originating Codex conversation.

## Clarification handoff

Use [HANDOVER.md](../../HANDOVER.md#what-we-are-doing-now) for current branch,
delivery authorization and acceptance status, and [verification history](VERIFICATION.md)
for dated checks. The original `fm/aven-clarification` launch and reproduction fixture
are preserved in [the 19 September evidence](../evidence/clarification-2026-09-19/README.md).
