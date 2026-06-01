# @electric-ax/example-deep-survey

## 0.1.17

### Patch Changes

- Updated dependencies [e9ea591]
- Updated dependencies [98b51d6]
- Updated dependencies [aed2189]
- Updated dependencies [52a641f]
  - @electric-ax/agents-runtime@0.3.6

## 0.1.16

### Patch Changes

- Updated dependencies [d344c32]
- Updated dependencies [c1834f3]
- Updated dependencies [319e405]
  - @electric-ax/agents-runtime@0.3.5

## 0.1.15

### Patch Changes

- Updated dependencies [833a1cb]
- Updated dependencies [833a1cb]
  - @electric-ax/agents-runtime@0.3.4

## 0.1.14

### Patch Changes

- Updated dependencies [9c2c3ae]
- Updated dependencies [a70567e]
- Updated dependencies [b3d4f02]
- Updated dependencies [dffbf62]
  - @electric-ax/agents-runtime@0.3.3

## 0.1.13

### Patch Changes

- Updated dependencies [e13cad1]
- Updated dependencies [4d9c36e]
  - @electric-ax/agents-runtime@0.3.2

## 0.1.12

### Patch Changes

- Updated dependencies [ca01b9d]
- Updated dependencies [9f10b20]
  - @electric-ax/agents-runtime@0.3.1

## 0.1.11

### Patch Changes

- Updated dependencies [9c275b7]
- Updated dependencies [1ab43f5]
- Updated dependencies [99ac6fd]
- Updated dependencies [adc99e9]
  - @electric-ax/agents-runtime@0.3.0

## 0.1.10

### Patch Changes

- Updated dependencies [e126eba]
- Updated dependencies [e126eba]
  - @electric-ax/agents-runtime@0.2.2

## 0.1.9

### Patch Changes

- Updated dependencies [dfc9a45]
- Updated dependencies [83204d9]
  - @electric-ax/agents-runtime@0.2.1

## 0.1.8

### Patch Changes

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [08e85a0]
  - @electric-ax/agents-runtime@0.2.0

## 0.1.7

### Patch Changes

- 590aabb: Improve the agents UI timeline and reactivity, add a browser-safe runtime client export, and route built-in agent metadata extraction through the configurable low-cost model runner.
- Updated dependencies [1df7cce]
- Updated dependencies [f509387]
- Updated dependencies [590aabb]
- Updated dependencies [744c47f]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [7f8947a]
  - @electric-ax/agents-runtime@0.1.3

## 0.1.6

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2

## 0.1.5

### Patch Changes

- Updated dependencies [e0b588f]
  - @electric-ax/agents-runtime@0.1.1

## 0.1.4

### Patch Changes

- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents-runtime@0.1.0

## 0.1.3

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4

## 0.1.2

### Patch Changes

- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3

## 0.1.1

### Patch Changes

- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
