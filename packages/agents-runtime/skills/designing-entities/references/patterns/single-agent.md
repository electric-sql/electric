# Pattern: single-agent

A single LLM-driven entity with no coordination. The handler body is essentially `useAgent + agent.run`. Optional tools (custom, stateful, or `ctx.electricTools` helpers) extend its reach.

**Canonical description:** no dedicated pattern doc — this is the baseline entity shape. See `/docs/usage/defining-entities` and `/docs/entities/agents/horton` (the built-in assistant, an exemplar of the single-agent shape) for reference.

**Canonical example:** `examples/durable-agents-playground/src/standalone/assistant.ts`

## When this pattern applies

- One entity does the whole job.
- No `ctx.spawn`, `ctx.observe`, `ctx.send` to other entities.
- No shared state across multiple entities.
- May use custom tools that talk to the outside world (HTTP, files, MCP servers, etc.).
- May use persistent custom state (e.g. memory, preferences).

## Required state

Often none. Add custom state only when the agent needs to persist something across wakes (conversation memory, cached results, user preferences).

## Handler skeleton

```ts
async handler(ctx) {
  ctx.useAgent({
    systemPrompt: "...",
    model: "claude-sonnet-4-5-20250929",
    tools: [...ctx.electricTools, ...customTools],
  })
  await ctx.agent.run()
}
```

If custom state is used, initialize in `firstWake`:

```ts
async handler(ctx) {
  if (ctx.firstWake && !ctx.db.collections.memory?.get("initialized")) {
    ctx.db.actions.memory_insert({ row: { key: "initialized", value: "true" } })
  }
  // ... useAgent, run ...
}
```

## Invariants

- No `ctx.spawn`, `ctx.observe`, `ctx.send` in the handler body.
- No `mkdb` / `observe(db(...))`.
- `ctx.useAgent` and `ctx.agent.run()` are the core of the handler.

## Pattern-specific review checklist

Apply these in phase 4 in addition to `references/review-checklist.md`:

| #   | Rule                                                                                                            | Why                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| SA1 | No calls to `ctx.spawn`, `ctx.observe`, or `ctx.send` in the handler.                                           | If present, this is not single-agent — switch to the matching coordination pattern.                         |
| SA2 | No `ctx.mkdb` / `ctx.observe(db(...))`.                                                                         | Shared state is a blackboard signal — switch pattern.                                                       |
| SA3 | Handler body reduces to (optional firstWake init) + `useAgent` + `agent.run()`. Any extra work is a code smell. | Complexity inside a single-agent handler usually means the design should be split across multiple entities. |
| SA4 | `creationSchema` only if `ctx.args` is actually read.                                                           | Avoid declaring schemas that are never used.                                                                |

## Anti-patterns

- **Inlining orchestration logic**: "agent does X, then if condition Y do Z" where Z is a different kind of work. That's two entities. Consider `pipeline` or `manager-worker`.
- **Using `inboxSchemas` for synchronous request/response**: inbox is for wake signals, not blocking RPC. If the agent needs a reply loop, the LLM should drive it with a tool call.
- **Persisting transient state**: if something only matters within one wake, use a local variable, not `ctx.db`.
