---
"@electric-ax/agents": patch
---

Add the `coder` entity (a Claude Code / Codex CLI session wrapped as a long-lived entity) and give Horton matching `spawn_coder` / `prompt_coder` tools so the chatbot can dispatch coding work and keep prompting the same coder across many turns. The coder records its own `runs` events around each CLI invocation and pipes the assistant reply through `attachResponse`, so observers waking with `runFinished` get the response in the wake payload. Includes `--skip-git-repo-check` for `codex exec`, deterministic per-cwd Claude session discovery (so non-interactive `claude -p` runs are found reliably), and adopts the first prompt's text as the entity's display title.
