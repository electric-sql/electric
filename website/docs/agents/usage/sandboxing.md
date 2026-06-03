---
title: Sandboxing
titleTemplate: "... - Electric Agents"
description: >-
  Isolate file, process, and network access for LLM-driven tools with Electric Agents sandbox profiles.
outline: [2, 3]
---

# Sandboxing

Electric Agents runs LLM-driven file, shell, and fetch tools through `ctx.sandbox`. The sandbox owns filesystem path resolution, subprocess execution, and network egress for the current wake session.

Sandboxing is configured by the runtime host, advertised to the server as named **sandbox profiles**, and selected when an entity is spawned.

## Runtime profiles

Register sandbox profiles on the runtime:

```ts
import { createRuntimeHandler } from "@electric-ax/agents-runtime"
import {
  remoteSandbox,
  unrestrictedSandbox,
} from "@electric-ax/agents-runtime/sandbox"

const runtime = createRuntimeHandler({
  baseUrl: "http://localhost:4437",
  registry,
  sandboxProfiles: [
    {
      name: "local",
      label: "Local",
      description: "Trusted local development sandbox",
      factory: ({ args }) =>
        unrestrictedSandbox({
          workingDirectory:
            typeof args.workingDirectory === "string"
              ? args.workingDirectory
              : process.cwd(),
        }),
    },
    {
      name: "e2b",
      label: "E2B",
      description: "Remote VM sandbox",
      remote: true,
      factory: ({ sandboxKey, persistent, owner }) =>
        remoteSandbox({
          provider: "e2b",
          sandboxKey,
          persistent,
          owner,
          initialNetworkPolicy: { mode: "allow-all" },
        }),
    },
  ],
})
```

The runtime sends profile descriptors to the server during type/runtime registration. The factory stays local to the runtime; only names, labels, descriptions, and `remote` metadata cross the wire.

## Built-in profiles

The sandbox package exports:

```ts
import {
  chooseDefaultSandbox,
  unrestrictedSandbox,
  remoteSandbox,
} from "@electric-ax/agents-runtime/sandbox"
import { dockerSandbox } from "@electric-ax/agents-runtime/sandbox/docker"
```

| Provider | Use case | Notes |
| -------- | -------- | ----- |
| `unrestrictedSandbox()` | Trusted local development | Shares the host filesystem and process namespace. It is convenient, not a security boundary. |
| `dockerSandbox()` | Local isolation for multi-entity hosts | Requires Docker and `dockerode`. Recommended for untrusted or multi-tenant local workloads. |
| `remoteSandbox({ provider: "e2b" })` | Remote VM isolation | Requires the optional `e2b` package and provider credentials. Mark the profile `remote: true`. |
| `chooseDefaultSandbox()` | Built-in local default | Chooses the default local profile for built-in Horton and Worker runtimes. |

## Handler access

Handlers and custom tools use `ctx.sandbox`:

```ts
async handler(ctx) {
  const result = await ctx.sandbox.exec({
    command: "ls -la",
    timeoutMs: 10_000,
    signal: ctx.signal,
  })

  const readme = await ctx.sandbox.readFile("README.md")
  const res = await ctx.sandbox.fetch("https://example.com")
}
```

Pass paths straight to the sandbox. Do not pre-resolve paths against the host filesystem; the sandbox may be a container or remote VM with a different root.

The runtime owns sandbox disposal. Handlers should not call `ctx.sandbox.dispose()`.

## Spawn-time selection

Select or inherit a sandbox when spawning:

```ts
await ctx.spawn(
  "worker",
  "analysis",
  { systemPrompt: "Inspect the workspace", tools: ["read", "bash"] },
  {
    initialMessage: "Start with package.json",
    sandbox: "inherit",
  }
)
```

Object form gives more control:

```ts
await client.spawnEntity({
  type: "worker",
  id: "isolated",
  sandbox: {
    profile: "docker",
    scope: "entity",
    persistent: true,
  },
})
```

Sandbox selection fields:

| Field | Meaning |
| ----- | ------- |
| `profile` | Named runtime profile to use. |
| `inherit` | Reuse the parent's resolved sandbox selection. |
| `key` | Explicit shared sandbox identity. |
| `scope` | `entity` for per-entity identity, or `wake` for per-wake identity. |
| `persistent` | Preserve sandbox state between wake sessions when supported. |
| `owner` | Whether this entity owns lifecycle teardown for the sandbox. |

## Network policy

Sandbox network policy supports:

```ts
type NetworkPolicy =
  | { mode: "allow-all" }
  | { mode: "deny-all" }
  | { mode: "allowlist"; allow: string[] }
```

`deny-all` is the strongest isolation mode on isolated providers. `allowlist` is provider-dependent: remote providers can enforce it at the VM boundary, while Docker currently uses it for sandbox `fetch()` paths rather than as a complete process-level egress boundary. Use `deny-all` when you need network isolation.

## Security notes

- `unrestrictedSandbox()` is for trusted local code. It can reduce accidental path escapes, but it is not a security boundary.
- Built-in file tools now rely on the active sandbox for containment and do not forward the host `process.env` into shell commands.
- Remote and Docker sandboxes isolate more, but credentials and mounted data still need careful scoping.
- Use a per-entity or explicit sandbox key when a worker needs state to survive across wakes.
