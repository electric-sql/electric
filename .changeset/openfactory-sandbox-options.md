---
'@electric-ax/agents': minor
---

Embedder customization for built-in agents: `BuiltinAgentHandlerOptions.dockerSandbox` ({ image, env, extraMounts, allowFloatingTag }) threads into the built-in `docker` sandbox profile, `AgentHandlerResult.modelCatalog` exposes the resolved model catalog, and `resolveBuiltinModelConfig` (+ `BuiltinModelCatalog`, `BuiltinAgentModelConfig`, docker-option types) are now exported so embedders can register sibling agent types with the same model resolution.
