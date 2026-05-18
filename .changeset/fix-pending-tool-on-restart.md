---
'@electric-ax/agents-runtime': patch
---

Fix Anthropic API contract violation when an agent restart leaves a tool call without a result. The timeline projection now synthesizes a synthetic error tool_result for interrupted tool calls so every tool_use has a matching tool_result.
