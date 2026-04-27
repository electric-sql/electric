---
name: designing-entities
description: Use when an app developer wants to build an entity (a.k.a. an agent) for their Electric Agents app — designing a single entity type, picking a coordination pattern when needed (single-agent, manager-worker, pipeline, map-reduce, dispatcher, blackboard, reactive-observer), defining state, handler, schemas, and implementing it in one entity file. Applies to any use of `registry.define(...)` / `defineEntity(...)` in a `@electric-ax/agents-runtime` app.
---

# Designing entities

Guided, 5-phase workflow for designing and implementing one Electric Agents entity. Infers the coordination pattern from the user's description, reviews the design against universal and pattern-specific checks, and writes a single entity file once approved.

## When to use

- User is starting a new entity in their app (`registry.define(...)` / `registerXxx(registry)`).
- User asks "how do I build an agent that..." / "I want an entity that...".

Do not use when editing an existing entity, querying entity streams (see the `entity-stream-queries` skill), or changing the runtime itself.

## Workflow

The five phases are strict — do not skip, merge, or reorder. Reference files are loaded on demand only when the phase below says so.

### 1. Elicit

Ask the developer one open question:

> Describe the entity you want to build. What should it do? Who/what does it interact with? What triggers it?

Skip this prompt if the opening message already contains a clear description.

### 2. Clarify

Load `references/pattern-triggers.md`. Match the description against the trigger table. If one pattern fits clearly, skip ahead. Otherwise, ask **one** disambiguation question per message — focused on narrowing the coordination shape (spawns / parallel vs sequential / fixed vs dynamic specialists / shared state / observes / LLM vs orchestration-only). Stop as soon as the pattern and shape are unambiguous. Typical count: 2–4 questions. Never ask a canned full list.

### 3. Propose pattern and design

State the inferred pattern and the reasoning:

```
Inferred pattern: <name>
Why: <trigger phrases> + <structural signals>
```

Load `references/patterns/<selected>.md`. If runtime details are needed, read the authoritative docs on demand (see "Canonical material" below). Then present the design outline in chat:

- Entity type name + `description`
- Coordination pattern (or "single-agent — no coordination")
- `creationSchema` (if spawn args are expected) — field names + types
- `state` collections — names, primary keys, row shape
- `inboxSchemas` (if messages are typed)
- `outputSchemas` (if the entity produces typed output events)
- Handler outline — `firstWake` init, wake-type branches, agent config, spawn/observe calls
  - Key `ctx` properties: `ctx.db.actions.*` (insert/update/delete), `ctx.db.collections.*` (get/toArray), `ctx.tags` / `ctx.setTag(key, value)` / `ctx.removeTag(key)`, `ctx.events` (Array of ChangeEvent from observed sources)
  - Observation sources: `entity(url)`, `cron(expression)`, `tagged({ match: ... })` — import from `@electric-ax/agents-runtime`
  - `ctx.send(url, payload, { type?, afterMs? })` — `afterMs` delays delivery
- Built-in agents referenced (e.g. `worker`), if any
- `registerXxx(registry)` factory wrapping it

Ask: _"Design look right? Any changes before we run the review checks?"_ Wait for the answer. Revise if requested, then re-present the outline.

### 4. Review (loop until approved)

Load `references/review-checklist.md`. The pattern file from step 3 is already loaded. Apply both checklists mechanically against the design. Report:

```
Universal checks:
  ✓ Handler signature correct
  ✓ ...ctx.electricTools spread into tools array
  ✗ Spawn-once guard missing — child IDs collide on re-wake
  N/A creationSchema — no spawn args

Pattern-specific (<name>):
  ✗ State machine transitions not defined
  ✓ Parallel spawn loop uses deterministic IDs

Proposed fixes:
  - Add state.children collection + spawn-once guard
  - Add state.status with transitions idle → mapping → reducing → idle

Apply these fixes? Anything to override?
```

Iterate: developer requests changes → revise design → re-run both checklists → report again. Loop until the developer explicitly approves ("looks good, write the file" or equivalent).

### 5. Implement

Confirm the output path — default `entities/<type-name>.ts`, or whatever the developer specifies. Write **exactly one** file using this shape:

```ts
import type { EntityRegistry } from "@electric-ax/agents-runtime"
import { z } from "zod/v4"

// schemas (creationSchema, inboxSchemas, collection schemas) go here

export function register<Name>(registry: EntityRegistry) {
  registry.define("<type>", {
    description: "...",
    creationSchema,
    inboxSchemas,
    state: { ... },
    async handler(ctx, wake) { ... },
  })
}
```

After writing, tell the developer:

> Wire it in by adding `register<Name>(registry)` to your registry composition file (typically `entities/registry.ts` or `server.ts`).

Do not patch the developer's registry file automatically. Stop — skill is done.

## Invariants

- One question per message in phase 2.
- No files written before phase 5.
- Phase 4 loops until the developer explicitly approves.
- Reference files are loaded on demand, never upfront.
- The skill writes exactly one entity file. Multi-entity systems are designed by running the skill once per entity.

## Canonical material (read on demand, do not preload)

> **How to access docs:** paths below are relative routes (e.g. `/docs/reference/handler-context`).
> If the file is available locally at `electric-agents-docs/docs/`, read it from disk.
> Otherwise fetch from `https://durable-agents-docs.netlify.app/` + the route
> (e.g. `https://durable-agents-docs.netlify.app/docs/reference/handler-context`).

Runtime API reference:

- `/docs/reference/handler-context` — the `ctx` API (db, state, spawn, observe, send, agent, electricTools, firstWake, sleep, tags, setTag, removeTag, events).
- `/docs/reference/wake-event` — wake event types and the `Wake` configuration object.
- `/docs/reference/entity-definition` — full `EntityDefinition` interface.
- `/docs/reference/built-in-collections` — the 17 built-in collections on `db.collections.*`.
- `/docs/reference/state-collection-proxy` — `ctx.db.actions.*` (insert/update/delete) and `ctx.db.collections.*` (get/toArray) API.
- `/docs/reference/shared-state-handle` — `mkdb` / `observe(db(...))`.
- `/docs/reference/agent-config` — `useAgent`, `AgentHandle.run()`, `testResponses`.
- `/docs/reference/agent-tool` — custom tool interface.
- `/docs/reference/entity-handle` — what `ctx.spawn` / `ctx.observe` return.

Usage guides:

- `/docs/usage/writing-handlers` — handler lifecycle and re-entrancy.
- `/docs/usage/waking-entities` — how wakes are produced and consumed; authoritative mental model for `wake.type` (only `"message_received"` and `"wake"`).
- `/docs/usage/defining-entities` — registry and collection declaration patterns.

Built-in agent types:

- `/docs/entities/agents/horton` — the dev-server's built-in assistant (chat, research, code, dispatch). Useful as a reference for custom single-agent entities.
- `/docs/entities/agents/worker` — the built-in sandboxed subagent. Required spawn args: `{ systemPrompt, tools }` where `tools` is a non-empty subset of `WorkerToolName`. Workers do **not** receive `ctx.electricTools` (least-privilege).

Pattern descriptions:

- `/docs/entities/patterns/<name>` — one per pattern.

Canonical example implementations:

- `examples/durable-agents-playground/src/coordination/{manager-worker,pipeline,map-reduce,dispatcher}.ts`
- `examples/durable-agents-playground/src/blackboard/{debate,wiki,peer-review,trading-floor}.ts`
- `examples/durable-agents-playground/src/reactive/{monitor,summarizer,guardian}.ts`
- `examples/durable-agents-playground/src/standalone/assistant.ts`
- `examples/durable-agents-playground/src/workers/worker.ts` — the playground registers its **own** `worker` type that accepts `sharedState` / `builtinTools`. When a real app spawns `"worker"` it gets the server's built-in least-privilege worker instead; adjust pattern examples accordingly.

Each `references/patterns/<name>.md` points at the specific canonical example for that pattern.
