---
'@electric-ax/agents': patch
---

Allow Horton and Worker to use configured Anthropic or OpenAI models. Adds a `model-catalog` that selects providers from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, surfaces UI-selectable reasoning effort for compatible OpenAI reasoning models, and threads the catalog through `bootstrap`, `registerHorton`, `registerWorker`, and `spawnWorker`.
