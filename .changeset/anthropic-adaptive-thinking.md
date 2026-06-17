---
'@electric-ax/agents': patch
---

Use Anthropic's adaptive thinking API for models that require it (Opus 4.6/4.7,
Sonnet 4.6). The builtin model catalog previously injected budget-based
`thinking: { type: "enabled", budget_tokens }` for every reasoning-capable
Anthropic model, which Opus 4.7 rejects with a 400 — it needs
`thinking: { type: "adaptive" }` + `output_config.effort`. Those models now emit
the adaptive shape (reasoningEffort mapped to the effort level); older models
keep budget-based thinking.
