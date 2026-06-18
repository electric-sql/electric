---
'@electric-ax/agents-runtime': patch
---

Enable provider retries for agent model calls by default so transient LLM errors are retried. Set `modelMaxRetries: 0` to preserve the previous no-retry behavior.
