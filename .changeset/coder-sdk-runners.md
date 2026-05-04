---
'@electric-ax/agents': minor
---

feat: drive the coder entity via Claude Code and Codex SDKs instead of the `claude` / `codex` CLI binaries

The `coder` entity now invokes `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk` directly, so the host no longer needs `claude` or `codex` installed on PATH — both SDKs ship their own platform-specific subprocess binaries as optional dependencies. Events stream from the SDK iterators into the entity's durable event collection live, replacing the previous JSONL file-watcher and post-run discovery plumbing.
