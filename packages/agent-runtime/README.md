# @electric-ax/agent-runtime

Electric Agents runtime for durable entity handlers over [Durable Streams](../../README.md).

Each entity owns an append-only stream. On every wake, the runtime materializes
that stream into typed TanStack DB collections, builds a `HandlerContext`, and
runs your entity's single `handler(ctx, wake)` entrypoint.

There is no separate `setup()` or `loader()` phase in the current API.

## Install

```bash
pnpm add @electric-ax/agent-runtime
```

Peer dependency: `@tanstack/db >= 0.5.33`

## Quick Start

```ts
import http from 'node:http'
import { z } from 'zod'
import { createRuntimeHandler, defineEntity } from '@electric-ax/agent-runtime'

defineEntity(`assistant`, {
  description: `Simple durable chat assistant`,

  state: {
    status: {
      schema: z.object({
        key: z.string(),
        value: z.enum([`idle`, `working`]),
      }),
      type: `status`,
      primaryKey: `key`,
    },
  },

  async handler(ctx) {
    if (!ctx.db.collections.status.get(`current`)) {
      ctx.db.actions.status_insert({
        row: { key: `current`, value: `idle` },
      })
    }

    ctx.useAgent({
      systemPrompt: `You are a helpful assistant.`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [...ctx.electricTools],
    })

    await ctx.agent.run()
  },
})

const runtime = createRuntimeHandler({
  baseUrl: `http://127.0.0.1:4437`,
  serveEndpoint: `http://127.0.0.1:3000/webhook`,
})

await runtime.registerTypes()

const server = http.createServer(async (req, res) => {
  if (req.url === `/webhook` && req.method === `POST`) {
    await runtime.onEnter(req, res)
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(3000, `127.0.0.1`)
```

## Entity Model

Entities are declared with `defineEntity(name, definition)`:

```ts
import { z } from 'zod'
import { defineEntity } from '@electric-ax/agent-runtime'

defineEntity(`pr-reviewer`, {
  description: `Code review agent`,

  creationSchema: z.object({
    repo: z.string(),
    prNumber: z.number().int(),
  }),

  inboxSchemas: {
    'pr-opened': z.object({
      diff: z.string(),
      baseBranch: z.string().optional(),
    }),
  },

  state: {
    reviewStatus: {
      schema: z.object({
        key: z.string(),
        status: z.enum([`pending`, `reviewing`, `done`]),
      }),
      type: `review_status`,
      primaryKey: `key`,
    },
  },

  async handler(ctx, wake) {
    if (ctx.firstWake && !ctx.db.collections.reviewStatus.get(`current`)) {
      ctx.db.actions.reviewStatus_insert({
        row: { key: `current`, status: `reviewing` },
      })
    }

    if (wake.type === `message_received`) {
      ctx.useAgent({
        systemPrompt: `Review pull requests carefully and concisely.`,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.electricTools],
      })
      await ctx.agent.run()
      ctx.db.actions.reviewStatus_update({
        key: `current`,
        updater: (draft) => {
          draft.status = `done`
        },
      })
    }
  },
})
```

## HandlerContext

`handler(ctx, wake)` receives:

- `ctx.firstWake` — `true` only on the first wake for the entity
- `ctx.entityUrl` / `ctx.entityType` — identity metadata
- `ctx.args` — immutable validated spawn args
- `ctx.db` — the entity's materialized StreamDB exposing typed
  `ctx.db.collections.<name>` (TanStack DB collections) for reads and
  auto-generated write actions at `ctx.db.actions.<name>_{insert,update,delete}`
- `ctx.electricTools` — built-in runtime tools to pass through to agents

### State

Every collection declared under `definition.state` gets auto-generated
`<name>_insert`, `<name>_update`, and `<name>_delete` actions on
`ctx.db.actions`. Reads go through `ctx.db.collections.<name>`:

```ts
ctx.db.actions.counts_insert({ row: { key: `main`, value: 0 } })
ctx.db.actions.counts_update({
  key: `main`,
  updater: (draft) => {
    draft.value++
  },
})
ctx.db.actions.counts_delete({ key: `main` })

ctx.db.collections.counts.get(`main`)
ctx.db.collections.counts.toArray
```

### Agents

```ts
ctx.useAgent({
  systemPrompt: `You are a helpful assistant.`,
  model: `claude-sonnet-4-5-20250929`,
  tools: [...ctx.electricTools, myTool],
})

await ctx.agent.run()
```

`agent.run()` assembles the entity's context from the materialized timeline and
processes the wake's trigger message. If you do not call `useAgent()`,
the runtime will not run an LLM for that wake.

### Spawn, Observe, and Send

```ts
const child = await ctx.spawn(`researcher`, `r-1`, { topic: `durability` })
await child.run

child.send(`dig deeper into storage tradeoffs`)
const text = await child.text()

const observed = await ctx.observe(`/researcher/r-2`, {
  wake: `runFinished`,
})
const status = observed.status()

ctx.send(`/other-entity/id`, { text: `hello` }, { type: `message` })
```

### Shared State

```ts
const boardSchema = {
  findings: {
    schema: z.object({
      key: z.string(),
      domain: z.string(),
      finding: z.string(),
    }),
    type: `finding`,
    primaryKey: `key`,
  },
}

if (ctx.firstWake) {
  ctx.mkdb(`board-1`, boardSchema)
}

const board = await ctx.observe(db(`board-1`, boardSchema))

board.findings.insert({
  key: `f-1`,
  domain: `security`,
  finding: `XSS found`,
})
```

`mkdb` creates the backing stream (throws if it already exists). `observe(db(...))` returns a handle for reading and writing on any wake.

## Runtime Handler

`createRuntimeHandler()` creates the webhook entrypoint that Electric Agents calls when an
entity is woken.

```ts
const runtime = createRuntimeHandler({
  baseUrl: `http://127.0.0.1:4437`,
  serveEndpoint: `http://127.0.0.1:3000/webhook`,
})

await runtime.registerTypes()
```

Main methods:

- `runtime.registerTypes()` — register all entity types with the server
- `runtime.onEnter(req, res)` — Node HTTP adapter for webhook delivery
- `runtime.handleRequest(request)` — fetch-native handler
- `runtime.drainWakes()` — wait for in-flight wakes to settle

## Built-in agents

The previous `registerChatAgent` / `registerResearcherAgent` / `registerCoderAgent` / `registerOracleAgent` helpers have been removed. Built-in agents now live in `@electric-ax/agent-server` (Horton + worker). To register them in your own runtime, use `createAgentHandler` from `@electric-ax/agent-server`.

## Timeline Helpers

The runtime also exports timeline helpers used by the UI layer:

- `createEntityIncludesQuery(db)`
- `getEntityState(runs, inbox)`
- `buildSections(runs, inbox)`
- `timelineToMessages(db)`

`useChat(db)` uses the query-based `IncludesRun` / `IncludesInboxMessage`
arrays, and `timelineToMessages(db)` builds LLM messages from the same shaped
data.

## Testing

The old public `createTestAdapter` API has been removed.

For integration tests inside this repo, see:

- [runtime-dsl.ts](./test/runtime-dsl.ts)
- [runtime-dsl.test.ts](./test/runtime-dsl.test.ts)
- [setup-context.test.ts](./test/setup-context.test.ts)

## License

Apache-2.0
