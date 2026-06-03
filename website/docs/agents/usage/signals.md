---
title: Signals
titleTemplate: "... - Electric Agents"
description: >-
  Interrupt, pause, resume, terminate, and notify Electric Agents entities with lifecycle signals.
outline: [2, 3]
---

# Signals

Signals are lifecycle controls for entities. They let users and hosts interrupt active work, pause or resume entities, kill entities, and deliver custom lifecycle notifications to handlers.

Signal records are written to the entity's `signals` collection and appear in timeline helpers.

## Supported signals

| Signal | Runtime behavior |
| ------ | ---------------- |
| `SIGINT` | Abort the active handler invocation through `ctx.signal`. Use for "stop current run". |
| `SIGSTOP` | Runtime-controlled pause. |
| `SIGCONT` | Runtime-controlled resume. |
| `SIGKILL` | Terminal kill/delete signal. |
| `SIGHUP` | Delivered to `ctx.onSignal()` handlers. |
| `SIGTERM` | Delivered to `ctx.onSignal()` handlers for graceful shutdown-style behavior. |
| `SIGUSR` | Delivered to `ctx.onSignal()` handlers for application-defined behavior. |

Runtime-controlled signals are handled by the runtime and are not delivered to `ctx.onSignal()`.

## CLI

Send a signal from the CLI:

```sh
electric agents signal /horton/onboarding SIGINT --reason "stop current run"
electric agents signal /horton/onboarding SIGUSR --payload '{"refresh":true}'
```

`kill` is shorthand for a terminal signal:

```sh
electric agents kill /horton/onboarding
```

## Programmatic clients

Use `createAgentsClient()` for UI-style clients:

```ts
const client = createAgentsClient({
  baseUrl: "http://localhost:4437",
  principalKey: "user:sam",
})

await client.signal({
  entityUrl: "/horton/onboarding",
  signal: "SIGINT",
  reason: "User clicked stop",
})

await client.kill("/horton/onboarding", "User deleted the session")
```

Use `createRuntimeServerClient()` when you need the lower-level server client:

```ts
await runtimeClient.signalEntity({
  entityUrl: "/worker/analysis",
  signal: "SIGUSR",
  payload: { refresh: true },
})
```

The caller needs `signal` permission on the entity, or `manage`.

## Handler cancellation

Every handler receives `ctx.signal`, an `AbortSignal` that fires when the current wake should stop early. Pass it to cancellable work:

```ts
async handler(ctx) {
  const res = await fetch("https://api.example.com/data", {
    signal: ctx.signal,
  })

  await ctx.sandbox.exec({
    command: "npm test",
    signal: ctx.signal,
    timeoutMs: 60_000,
  })
}
```

`SIGINT` aborts this signal. Runtime shutdown can also abort it.

## Handler-delivered signals

Use `ctx.onSignal()` for `SIGHUP`, `SIGTERM`, and `SIGUSR`:

```ts
async handler(ctx) {
  ctx.onSignal(async ({ signal, reason, payload }) => {
    if (signal === "SIGUSR") {
      ctx.insertContext("refresh-request", {
        name: "Refresh request",
        content: JSON.stringify({ reason, payload }),
        attrs: {},
      })
    }
  })

  await ctx.agent.run()
}
```

Handlers should keep signal callbacks short and idempotent. If the signal should trigger substantial work, record state or context and let the normal handler flow pick it up.

## Signal records

Signal rows include the signal name, sender, reason, payload, handling status, outcome, and state transition fields:

```ts
interface Signal {
  signal: "SIGINT" | "SIGHUP" | "SIGTERM" | "SIGKILL" | "SIGSTOP" | "SIGCONT" | "SIGUSR"
  status: "unhandled" | "handled"
  sender?: string
  reason?: string
  payload?: unknown
  outcome?: "transitioned" | "ignored" | "invalid_for_state" | "delivered" | "aborted" | "shutdown_requested" | "failed"
}
```

See [Built-in collections](../reference/built-in-collections#signal) for the full row shape.
