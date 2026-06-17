---
'@electric-ax/agents': patch
'@electric-ax/agents-runtime': patch
---

Delegate built-in reasoning configuration to pi-ai instead of rewriting provider request payloads in the model catalog. Built-in OpenAI, OpenAI Codex, and Anthropic reasoning models now pass `reasoning` through the runtime adapter, preserving the existing `auto` defaults and Anthropic thinking budgets while letting pi-ai own provider-specific payload shapes such as OpenAI reasoning summaries and Anthropic adaptive thinking.
