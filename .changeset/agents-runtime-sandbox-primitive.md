---
'@electric-ax/agents-runtime': minor
'@electric-ax/agents': minor
'@electric-ax/agents-server-conformance-tests': patch
---

Adds the `Sandbox` primitive (`@electric-ax/agents-runtime/sandbox`) for isolating LLM-driven tool calls. Three providers ship: `unrestrictedSandbox()` (explicit pass-through), `nativeSandbox()` (Seatbelt on macOS, bubblewrap on Linux/WSL2 via `@anthropic-ai/sandbox-runtime`), and `remoteSandbox({provider: 'e2b'})` (E2B as an optional peer dep).

Built-in entities (Horton, Worker) default to `nativeSandbox` on supported platforms via the new `chooseDefaultSandbox(workingDirectory)` helper. `ELECTRIC_AGENTS_UNRESTRICTED=1` is the documented env-level panic switch.

Behavior changes folded in: bash no longer forwards `process.env` to children (closes `$ANTHROPIC_API_KEY` exfil), tool descriptions corrected, and read/write/edit reject symlink escapes from the workspace.

`createFetchUrlTool` and the other tool factories now require a `Sandbox` parameter — see `plans/sandbox-design.md` for the full migration story.
