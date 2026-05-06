# Pattern: manager-worker

A parent entity spawns a **fixed set of specialist children**, each with a specific role (e.g. {economic, political, social, technical}). The parent waits for all children to complete, then synthesizes their results via its own LLM.

**Canonical description:** `/docs/entities/patterns/manager-worker`

**Canonical example:** `examples/durable-agents-playground/src/coordination/manager-worker.ts` — note the playground registers its own `worker` type; see "Spawning the built-in worker" below.

## Spawning the built-in worker

The Electric agent server's built-in `worker` type has a strict contract (`/docs/entities/agents/worker`):

```ts
interface WorkerArgs {
  systemPrompt: string
  tools: Array<WorkerToolName> // non-empty subset of: bash | read | write | edit | web_search | fetch_url | spawn_worker
}
```

Workers do **not** receive `ctx.electricTools` — they are a least-privilege sandbox. Always pass both `systemPrompt` and `tools`; omitting `tools` (or passing an empty array) throws at spawn time.

## When this pattern applies

- Fixed, named set of specialist roles — not a variable count per input.
- Each specialist examines the same subject from a different angle.
- Parent waits for all specialists before producing a synthesis.
- Parent's final response incorporates all children's outputs.

If the specialist count varies per input (e.g. one worker per chunk), use `map-reduce` instead. If specialists run one after another (output of A → input of B), use `pipeline`. If specialists are chosen dynamically per request, use `dispatcher`.

## Required state

```ts
state: {
  children: {
    schema: z.object({
      key: z.string(),     // specialist role identifier
      url: z.string(),     // child's entityUrl, populated after spawn
      kind: z.string(),    // specialist role (matches key)
      question: z.string(),// question delivered to this specialist
    }),
    primaryKey: "key",
  },
}
```

## Handler skeleton

```ts
import { entity } from '@electric-ax/agents-runtime'

async handler(ctx, wake) {
  const PERSPECTIVES = [
    { id: "economic",  systemPrompt: "You analyze economic dimensions..." },
    { id: "political", systemPrompt: "You analyze political dimensions..." },
    // ...
  ]

  const analyzeTool: AgentTool = {
    name: "analyze_with_perspectives",
    /* ... */
    execute: async (_id, { question }) => {
      // spawn-once, reuse via observe
      for (const p of PERSPECTIVES) {
        const existing = ctx.db.collections.children?.get(p.id)
        if (!existing?.url) {
          const child = await ctx.spawn(
            "worker",
            `${p.id}`,
            {
              systemPrompt: p.systemPrompt,
              tools: p.tools, // e.g. ["web_search", "fetch_url"] — required, least-privilege
            },
            { initialMessage: question, wake: "runFinished" }
          )
          ctx.db.actions.children_insert({ row: { key: p.id, url: child.entityUrl, kind: p.id, question } })
        } else {
          const child = await ctx.observe(entity(existing.url))
          child.send(question)
        }
      }

      // on re-wake, collect text from all children
      const results = await Promise.all(
        PERSPECTIVES.map(async (p) => {
          const row = ctx.db.collections.children?.get(p.id)
          if (!row?.url) return { id: p.id, text: "" }
          const handle = await ctx.observe(entity(row.url))
          return { id: p.id, text: (await handle.text()).join("\n\n") }
        })
      )

      return {
        content: [{ type: "text", text: results.map(r => `### ${r.id}\n${r.text}`).join("\n\n") }],
        details: {},
      }
    },
  }

  ctx.useAgent({
    systemPrompt: "...",
    model: "claude-sonnet-4-5-20250929",
    tools: [...ctx.electricTools, analyzeTool],
  })
  await ctx.agent.run()
}
```

## Invariants

- **Spawn-once guard.** Always read `ctx.db.collections.children?.get(id)` before `ctx.spawn`. Reuse via `ctx.observe(entity(url))` on re-wake.
- **Deterministic child IDs.** Derive the child ID from the specialist role key, not `Date.now()` or counters. `p.id` is stable across wakes.
- **`wake: "runFinished"` on every spawn.** Parent must be re-invoked when each child completes.
- **`Promise.all` for collection.** Gather results after all children report — never sequential awaits when the children are independent.
- **Synthesis step.** The parent's LLM sees the aggregated results and produces the final answer — the tool returns the aggregation, not a synthesis.

## Pattern-specific review checklist

| #   | Rule                                                                                             | Why                                                                          |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| MW1 | `state.children` declared with at minimum `{ key, url }` rows.                                   | Required for spawn-once guard.                                               |
| MW2 | Spawn site is guarded by `ctx.db.collections.children?.get(id)` check.                           | Otherwise re-wakes produce `spawn(sameId)` errors.                           |
| MW3 | Each child ID is a stable string (no `Date.now()`, no random).                                   | Determinism across re-wakes.                                                 |
| MW4 | Every `ctx.spawn` sets `wake: "runFinished"`.                                                    | Parent wake on child completion.                                             |
| MW5 | Collection uses `Promise.all` over specialists, not sequential `await`.                          | Children are independent — parallel collection.                              |
| MW6 | `PERSPECTIVES` (or equivalent specialist list) is declared once, not re-derived per wake.        | Must be stable across wakes to keep IDs deterministic.                       |
| MW7 | Every spawn of the built-in `worker` passes a non-empty `tools` array of valid `WorkerToolName`. | Built-in worker throws `[worker] tools must be a non-empty array` otherwise. |

## Anti-patterns

- **Random or timestamp-based child IDs.** Breaks determinism — re-wake spawns duplicate children.
- **Spawning inside `firstWake` only.** On re-wake after the first tool call, children don't exist in state yet. Spawn inside the tool or on message receipt, always guarded by state lookup.
- **Awaiting each child sequentially.** Defeats parallelism; turns manager-worker into an ad-hoc pipeline.
- **Per-wake specialist list.** If `PERSPECTIVES` is generated dynamically per wake, the pattern is `map-reduce`, not manager-worker.
- **Secrets in worker prompts.** Don't interpolate API tokens / OAuth bearers / signed URLs into a worker's `systemPrompt` or `initialMessage` — they end up in the entity's persisted streams. For authenticated external APIs, have the manager do the fetch (tokens stay in trusted code) and pass the raw response to the worker as its message. Workers that still need to make their own calls should use built-in tools like `web_search` that read their own API key internally.

## Handling authenticated external data

When specialists need data from an API that requires authentication:

- **Prefer manager-side prefetch.** The tool that spawns workers runs the authenticated `fetch` itself, then passes the JSON response to the worker via `initialMessage` (or `handle.send(...)` on reuse). Worker `systemPrompt` describes the summarization task only — no URLs, no headers, no tokens.
- **When that isn't possible**, register a custom worker type in the app that closes over the credential at registration time. Never the built-in `worker`, which is a least-privilege sandbox and has no way to read secrets except through its prompt/message.
- **Log carefully.** Even manager-side `console.log` of request bodies or response headers can leak auth if a token is echoed back by the API. Redact before logging.
