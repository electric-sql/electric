---
title: Architecture
titleTemplate: "Coding Agent - Electric Agents"
description: >-
  Package layout and dependency flow for @electric-ax/coding-agents.
outline: [2, 3]
---

# Architecture

The `@electric-ax/coding-agents` package wires three orthogonal subsystems — providers, bridge, workspace registry — around the entity handler, with a lifecycle manager multiplexing the providers.

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

See [Operations → Setup](./operations#setup) for required env vars, local dev commands, and the bootstrap-registration snippet.
