---
'@electric-ax/agents': minor
---

Embedder customization hooks for the built-in agents:

- `BuiltinAgentHandlerOptions.dockerSandbox` ({ image, allowFloatingTag, env, extraMounts }) threads into the built-in `docker` sandbox profile. These are embedder/operator-trust inputs: `extraMounts` is subject to the runtime's docker-socket guard and `env` is passed verbatim into the container.
- `AgentHandlerResult.modelCatalog` exposes the resolved model catalog so embedders can register sibling agent types with the same model resolution.
- New exports: `resolveBuiltinModelConfig`, `resolveDockerSandboxOpts`, and types `BuiltinModelCatalog`, `BuiltinAgentModelConfig`, `BuiltinDockerSandboxOptions`, `BuiltinDockerSandboxMount`.
