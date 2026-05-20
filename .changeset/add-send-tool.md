---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
---

Add `send` tool exposing `ctx.send()` to LLM agents (Horton and Worker) for sending messages to Electric entities by URL. Change `send()` return type from `void` to `Promise<SendResult>` so callers can await delivery confirmation and handle failures with structured error results.
