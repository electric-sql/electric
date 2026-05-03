---
title: Architecture
titleTemplate: "Coding Agent - Electric Agents"
description: >-
  Package layout and dependency flow for @electric-ax/coding-agents.
outline: [2, 3]
---

# Architecture

The `@electric-ax/coding-agents` package wires four orthogonal pieces around an entity handler.

```text
              spawnCodingAgent(ctx)               POST /send {type: ...}
                    │                                     │
                    ▼                                     ▼
           ┌──────────────────┐                  ┌──────────────────┐
           │ entity / spawn   │                  │ entity / inbox   │
           └─────────┬────────┘                  └─────────┬────────┘
                     │                                     │
                     ▼                                     ▼
              ┌─────────────────────────────────────────────────┐
              │             coding-agent handler                │  ── packages/coding-agents/src/entity/handler.ts
              │   (sessionMeta / runs / events / lifecycle /    │
              │    nativeJsonl  state collections)              │
              └─────────────────────────────────────────────────┘
                  │                  │                  │
        provider.start /  bridge.runTurn          WorkspaceRegistry
        destroy / status  (per kind)              (per-identity lease)
                  ▼                  ▼                  ▼
        ┌──────────────────┐  ┌────────────────┐  ┌──────────────┐
        │ SandboxProvider  │  │     Bridge     │  │  Workspace   │
        │  ─ LocalDocker   │  │  ─ StdioBridge │  │  Registry    │
        │  ─ Host          │  │     ↓          │  └──────────────┘
        │  ─ FlySprites    │  │  Adapter map   │
        └──────────────────┘  │  ─ claude      │
                              │  ─ codex       │
                              │  ─ opencode    │
                              └────────────────┘
```

## Responsibility split

- [`entity/handler.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/entity/handler.ts) — first-wake init, inbox dispatch, status machine, run accounting, transcript capture / materialise, fork backfill. Mutates state collections via `ctx.db.actions`.
- [`lifecycle-manager.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/lifecycle-manager.ts) — multiplexes the three providers, runs the idle eviction timer, and tracks the per-agent `pin` refcount.
- [`workspace-registry.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/workspace-registry.ts) — canonicalises workspace identities (`volume:<name>`, `bindMount:<realpath>`, `sprite:<agentId>`) and serialises concurrent runs that share an identity behind a per-identity mutex.
- [`bridge/stdio-bridge.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/bridge/stdio-bridge.ts) — runs one CLI turn: builds argv via the per-kind adapter, pipes prompt, drains stdout, normalises raw lines into `agent-session-protocol` events.
- [`providers/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/providers/) — three `SandboxProvider` implementations (LocalDocker, Host, FlySprites). The provider surface is small enough that a fourth (Modal, E2B, …) is a few hundred LOC. See [Integrating](./integrating).

## Setup

### Required env

At least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` must be set; both is fine. `SPRITES_TOKEN` is required only if you want the sprites target.

```bash
ANTHROPIC_API_KEY=sk-ant-...                           # claude / opencode (anthropic models)
OPENAI_API_KEY=sk-proj-...                             # codex / opencode (openai models)
SPRITES_TOKEN=<bearer-token-from-sprites.dev>          # optional — enables target=sprites
```

`registerCodingAgent`'s default `env()` callback mirrors `ANTHROPIC_API_KEY` → `CLAUDE_CODE_OAUTH_TOKEN` when the value matches the OAuth shape (`sk-ant-oat...`), so a single `ANTHROPIC_API_KEY=sk-ant-oat...` covers both API-key and OAuth-token code paths transparently.

### Local dev

```bash
node packages/electric-ax/bin/dev.mjs up           # spawn full stack on :4437
node packages/electric-ax/bin/dev.mjs restart      # bounce host services (state preserved)
node packages/electric-ax/bin/dev.mjs clear-state  # nuke postgres + volumes + streams
```

`dev.mjs` runs an embedded `DurableStreamTestServer` and persists its data directory to `.local/dev-streams` so existing entities survive `up`-after-`down`.

### Bootstrap registration

[`packages/agents/src/bootstrap.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/bootstrap.ts) wires the providers + bridge into the entity registry on dev-server startup:

```ts
import {
  registerCodingAgent,
  LocalDockerProvider,
  HostProvider,
  StdioBridge,
  createSpritesProviderIfConfigured,
} from '@electric-ax/coding-agents'

const spritesProvider = createSpritesProviderIfConfigured()

registerCodingAgent(registry, {
  providers: {
    sandbox: new LocalDockerProvider(),
    host: new HostProvider(),
    ...(spritesProvider ? { sprites: spritesProvider } : {}),
  },
  bridge: new StdioBridge(),
})
```

The sprites provider is registered conditionally on `SPRITES_TOKEN` so deployments without it see no behavioural change.
