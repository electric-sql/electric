---
'@electric-ax/agents-runtime': minor
'@electric-ax/agents': minor
'@electric-ax/agents-server-conformance-tests': patch
---

Adds the `Sandbox` primitive (`@electric-ax/agents-runtime/sandbox`) for isolating LLM-driven tool calls. Three providers ship: `unrestrictedSandbox()` (explicit pass-through), `remoteSandbox({provider: 'e2b'})` (E2B as an optional peer dep), and `dockerSandbox()` (container isolation via `dockerode` as an optional peer dep).

Built-in entities (Horton, Worker) default to `unrestrictedSandbox` via the new `chooseDefaultSandbox(workingDirectory)` helper. Stronger isolation is opt-in by constructing `dockerSandbox` or `remoteSandbox` directly — `dockerSandbox` is the recommended path for multi-entity hosting.

Behavior changes folded in: bash no longer forwards `process.env` to children (closes `$ANTHROPIC_API_KEY` exfil), tool descriptions corrected, and read/write/edit reject symlink escapes from the workspace.

`createFetchUrlTool` and the other tool factories now require a `Sandbox` parameter — see `plans/sandbox-design.md` for the full migration story.
