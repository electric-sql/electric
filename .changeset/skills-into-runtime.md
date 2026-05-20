---
'@electric-ax/agents-runtime': minor
'@electric-ax/agents': patch
---

Move the `.md`-skill-directory loader (`createSkillsRegistry`) and the per-entity skill tool builder (`createSkillTools`) — together with the `SkillsRegistry` / `SkillMeta` types and the underlying `preamble` / `extract-meta` helpers — out of `@electric-ax/agents` and into `@electric-ax/agents-runtime`, alongside the rest of the entity-runtime primitives.

No behaviour change. Same files, re-rooted to the package whose dependencies they already use: skills depend on `completeWithLowCostModel` and the runtime logger, both already in `agents-runtime`. The skills code uses zero symbols defined in `@electric-ax/agents`, so the previous arrangement had the dependency graph pointing the wrong way.

This makes the skills primitives available to any package built on top of `agents-runtime` (e.g. external Discord / Slack / CLI bots) without pulling in Horton, Worker, or `BuiltinAgentsServer` as transitive context.

Existing internal call sites in `@electric-ax/agents` (`bootstrap.ts`, `agents/horton.ts`) now import from `@electric-ax/agents-runtime`. No public API of `@electric-ax/agents` is affected — the skills surface was never re-exported from its `index.ts`, so embedders that only consumed Horton / Worker / Server APIs continue to work unchanged.
