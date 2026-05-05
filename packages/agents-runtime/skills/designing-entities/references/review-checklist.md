# Universal review checklist

Use this file during **phase 4 (Review)** of the skill. Apply every rule below against the proposed design. Report each rule as `✓`, `✗`, or `N/A` with a one-line reason. Combine with the pattern-specific checks from `references/patterns/<name>.md`.

Treat the rules as the literal contract for the entity — violations are flagged as `✗` and must be fixed before phase 5 writes the file (unless the developer explicitly overrides with rationale).

## Handler shape

| #   | Rule                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Signature is `handler(ctx, wake): Promise<void> \| void`; marked `async` or returns `Promise<void>` explicitly.                                                             | Re-entrant handler contract; synchronous-only handlers can't `await` `agent.run()` or `spawn`.                                                                                                                                                                                               |
| H2  | Exported as `export function register<Name>(registry: EntityRegistry) { registry.define(...) }`, not a bare `registry.define(...)` at module scope.                         | Matches the repo's factory pattern; lets the app's registry composition wire it in explicitly.                                                                                                                                                                                               |
| H3  | No closure state (module-level `let`, `const` mutable objects captured by the handler) carries information across wakes. Durable state goes in `ctx.db` only.               | Process restarts wipe closures. `ctx.db` is backed by the durable stream.                                                                                                                                                                                                                    |
| H4  | `ctx.firstWake` gates only one-time setup that cannot be expressed declaratively (e.g. `mkdb`, default row insert). Never used for logic that must survive process restart. | `firstWake` is true only on the very first-ever wake; after a restart the flag is correctly `false`, so one-time setup protected solely by `firstWake` does not self-heal. For safe idempotent init also guard by reading state (`if (!ctx.db.collections.status?.get("current")) { ... }`). |

## Agent config (only if `ctx.useAgent(...)` is called)

| #   | Rule                                                                                                             | Why                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `...ctx.electricTools` is spread into the `tools` array — always first.                                          | The runtime coordination tools (spawn, observe, send, etc.) live in `ctx.electricTools`. Omitting them breaks child wakes, shared state, and inbox routing. |
| A2  | `ctx.useAgent(...)` is called before `ctx.agent.run()`.                                                          | `run()` without prior `useAgent` throws.                                                                                                                    |
| A3  | Every custom tool's `execute` returns `{ content: [...], details: {...} }`. `details` is required even if empty. | The `AgentTool` interface requires it; omitting causes a type error and a runtime crash when the agent consumes the result.                                 |
| A4  | `model` is a real Claude identifier (e.g. `claude-sonnet-4-5-20250929`). Flag hand-edited typos.                 | Unknown model IDs fail at provider call time.                                                                                                               |
| A5  | `systemPrompt` is a non-empty string.                                                                            | Empty system prompts produce poor agent behavior; usually a copy/paste mistake.                                                                             |

## State and schemas

| #   | Rule                                                                                                                                        | Why                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Every entry in `state: { ... }` has either an explicit `primaryKey` or relies on the default `"key"` intentionally.                         | Rows are keyed by this field; mismatches cause silent dropped writes.                                                                      |
| S2  | Every `insert` / `update` payload includes the primary-key field.                                                                           | Writes without the PK field are rejected.                                                                                                  |
| S3  | `creationSchema` is defined if the handler reads `ctx.args`.                                                                                | Without it, args are untyped `unknown` and invalid spawns reach the handler.                                                               |
| S4  | `inboxSchemas` are defined if the handler branches on `wake.type === "message_received"` with typed payloads per message type.              | Schemas surface in the Electric Agents UI/CLI and validate incoming messages. Untyped inbox = silent data shape drift.                     |
| S5  | Schemas use Standard Schema (Zod v4 preferred, or other Standard-Schema validators).                                                        | The runtime only understands Standard-Schema-compatible validators.                                                                        |
| S6  | `ctx.args` is cast or parsed to the type declared by `creationSchema`, not used as raw `unknown`.                                           | Validation happens at spawn, but `ctx.args` is typed as `Readonly<Record<string, unknown>>` — casting/parsing makes the handler type-safe. |
| S7  | Collection `type` field (event type string) follows the convention `"state:<name>"` for entity state or `"shared:<name>"` for shared state. | Keeps stream event types searchable and consistent with existing entities.                                                                 |

## Messaging and lifecycle

| #   | Rule                                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | `ctx.send(url, payload, { type: "...", afterMs?: number })` passes a `type` whenever the receiving entity declares `inboxSchemas`. Optional `afterMs` delays delivery.                                                                                                                                                    | Without `type`, `inboxSchemas` validation cannot route the message and schema-typed handlers receive untyped payloads. `afterMs` is useful for scheduled retries or delayed notifications. |
| M2  | `ctx.sleep()` is used for deliberate early exits (e.g. "nothing to do this wake"), not as a return statement in the middle of async work.                                                                                                                                                                                 | `sleep()` signals "end this wake, don't reschedule"; returning before pending awaits leaves work orphaned.                                                                                 |
| M3  | The handler eventually completes (returns or calls `sleep()`), does not loop indefinitely.                                                                                                                                                                                                                                | Handlers have an idle timeout; infinite loops get killed mid-work.                                                                                                                         |
| M4  | `ctx.spawn(...)` that the handler later awaits (`await child.run` or reads `child.text()` inside the same wake) passes `wake: "runFinished"`.                                                                                                                                                                             | Without it, the parent never wakes when the child completes; the current wake awaits forever or times out.                                                                                 |
| M5  | `ctx.observe(entity(url), ...)` includes a `wake` option (`{ on: "change", collections: [...] }` or `"runFinished"`) whenever the handler needs to react to the observed entity. `observe()` takes an `ObservationSource` (use `entity()`, `cron()`, or `tagged()` from `@electric-ax/agents-runtime`), not a raw string. | Observation without wake is a silent subscription that never re-invokes the handler. Raw strings are not valid `ObservationSource` objects.                                                |

## Built-in worker contract

Apply only when the entity `ctx.spawn("worker", ...)` — the Electric Agents server's built-in worker type.

| #   | Rule                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Every `ctx.spawn("worker", ...)` passes `{ systemPrompt, tools }` with `tools` a non-empty subset of `"bash" \| "read" \| "write" \| "edit" \| "web_search" \| "fetch_url" \| "spawn_worker"`.                                                 | Built-in worker throws `[worker] tools must be a non-empty array` (or `unknown tool name`) at parse time.                                                                                                                                                                                                             |
| W2  | Spawn args do **not** include `sharedState`, `sharedStateToolMode`, or `builtinTools`. If those are needed, spawn a custom worker type the app registered, not the built-in `worker`.                                                          | The built-in worker is a least-privilege sandbox and ignores these args. For shared-state workflows see the blackboard pattern.                                                                                                                                                                                       |
| W3  | Work that requires runtime primitives (`ctx.electricTools` — cron, arbitrary `send`, etc.) is done in the spawner, not the worker.                                                                                                             | Workers do not receive `ctx.electricTools`.                                                                                                                                                                                                                                                                           |
| W4  | Worker `systemPrompt` and `initialMessage` do **not** contain API tokens, OAuth bearers, cookies, signed URLs, or other secrets. Authenticated fetches happen in the manager (trusted code); the raw response is passed to the worker as data. | Worker prompts and messages are persisted in entity streams — anyone who can read the stream can read the secrets. Interpolating `process.env.*` into a prompt effectively publishes it. Built-in tools like `web_search` that read their own API key at call-time are fine because the key never touches the prompt. |

## App wiring

These apply to the app's `server.ts` / entry point, not to any individual entity. Flag them in phase 4 if the design relies on the feature.

| #   | Rule                                                                                                                                                                                                                       | Why                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AW1 | If any entity spreads `...ctx.electricTools` and expects schedule tools, pass `createElectricTools: (ctx) => createScheduleTools(ctx)` to `createRuntimeHandler`. Import `createScheduleTools` from `@electric-ax/agents`. | Without it, `ctx.electricTools` is `[]`. The Electric Agents dev server wires this automatically; standalone apps must opt in.                                                  |
| AW2 | The app process has `ANTHROPIC_API_KEY` (and any other provider keys) in its environment at boot — via `.env` file, shell export, or process manager.                                                                      | `agent.run()` calls the LLM provider. Missing API key throws inside the agent loop. If the handler doesn't catch, it crashes the wake (or the process). Check at boot and warn. |
| S8  | `creationSchema` fields use `.default()` or `.optional()` where possible.                                                                                                                                                  | The Electric Agents UI spawns entities with no args — the server rejects with 422 if required fields are missing. Use defaults so entities can be spawned from the UI.          |

## Gotchas catalogue (rationale source)

These are the documented foot-guns — all universal checks above trace back to one of them. Keep this list in mind when explaining a `✗` to the developer.

1. **Spawn-once violation.** Spawning the same child ID twice fails. Always check state before spawn: `const existing = ctx.db.collections.children?.get(childId); if (existing?.url) { ctx.observe(entity(existing.url)) } else { ctx.spawn(...) }`.
2. **Missing `...ctx.electricTools`.** Breaks all coordination silently.
3. **Tool result without `details`.** Runtime-level crash when the agent consumes the result.
4. **Missing `wake: "runFinished"` on spawn.** Parent never wakes on child completion.
5. **Over-relying on `firstWake` for init.** After process restart, `firstWake` is `false`; init must also check state.
6. **Assuming synchronous writes.** `insert/update/delete` are fire-and-forget Transactions; if you must await persistence use `tx.isPersisted.promise`.
7. **Schema validation firing on write.** Invalid rows throw at `insert` time — keep schemas permissive until the shape is stable.
8. **Shared-state schema mismatch.** Parent and children must use identical schemas (same import, not re-declared copies).
9. **`creationSchema` without arg parsing.** Validates at spawn but handler still sees untyped `unknown` until cast.
10. **`observe` without wake.** Silent subscription; handler never fires on changes.
11. **Missing message `type`.** Inbox routing via `inboxSchemas` breaks.
12. **Handler that never ends.** Infinite loops get killed.
13. **Required creationSchema fields + no-args UI spawn.** The Electric Agents UI spawns entities with no args. The server now rejects with 422 if required fields are missing. Use `.default()` or `.optional()` so entities can be spawned from the UI.
14. **Secrets in worker prompts.** Interpolating `process.env.*` into a worker `systemPrompt` or `initialMessage` leaks it into the entity's persisted streams. Do authenticated fetches in the manager and pass the raw response to the worker as data; let built-in tools read their own keys from env.
15. **`ctx.electricTools` empty in standalone apps.** Pass `createElectricTools: (ctx) => createScheduleTools(ctx)` to `createRuntimeHandler`. Import `createScheduleTools` from `@electric-ax/agents`.

## Output format (phase 4)

```
Universal checks:
  ✓ H1 Handler signature correct
  ✓ H2 registerXxx factory exported
  ✓ A1 ...ctx.electricTools spread first
  ✗ M4 wake: "runFinished" missing on spawn — parent will stall
  N/A S3 creationSchema — no spawn args expected

Pattern-specific (<name>): see patterns/<name>.md

Proposed fixes:
  - M4: add `wake: "runFinished"` to ctx.spawn() options

Apply these fixes? Anything to override?
```

Re-run the checklist after every revision. Continue looping until the developer explicitly approves.
