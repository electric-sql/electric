---
title: Context composition
titleTemplate: "... - Electric Agents"
description: >-
  Control what goes into the agent's context window using ctx.useContext() with token-budgeted sources, cache tiers, and imperative context entries.
outline: [2, 3]
---

# Context composition

By default, the runtime assembles the agent's context window from the entity's full timeline (messages, tool calls, text responses). `ctx.useContext()` gives you explicit control over what goes in and how much space each piece gets.

## When to use it

Most entities don't need `useContext` -- the default timeline assembly works well for simple conversational agents. Use `useContext` when you need to:

- **Budget token space** across multiple content sources (docs, conversation history, retrieved context)
- **Mix static and dynamic content** with different caching behavior
- **Inject external content** (documentation, search results, knowledge bases) alongside conversation history

## UseContextConfig

```ts
ctx.useContext({
  sourceBudget: 18_000,
  sources: {
    docs: {
      content: () => "# Reference docs\n...",
      max: 6_000,
      cache: "stable",
    },
    conversation: {
      content: () => ctx.timelineMessages(),
      max: 12_000,
      cache: "volatile",
    },
  },
})
```

| Field          | Type                           | Description                                              |
| -------------- | ------------------------------ | -------------------------------------------------------- |
| `sourceBudget` | `number`                       | Total token budget across all sources. Required.         |
| `sources`      | `Record<string, SourceConfig>` | Named content sources. Must contain at least one source. |

### SourceConfig

Each source declares a content function, a max token allocation, and a cache tier:

| Field     | Type                                                   | Description                                                                      |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `content` | `() => string \| LLMMessage[] \| TimestampedMessage[]` | Function called each agent run to produce the source content. Can be async.      |
| `max`     | `number`                                               | Maximum tokens this source may consume. Content is truncated if it exceeds this. |
| `cache`   | `CacheTier`                                            | Caching hint that controls assembly ordering. See [Cache tiers](#cache-tiers).   |

The `content` function can return:

- A **string** -- inserted as a single system message
- An **`LLMMessage[]`** array -- inserted as-is
- A **`TimestampedMessage[]`** array -- interleaved by timestamp with other volatile sources

### Cache tiers

Cache tiers control assembly ordering and caching behavior. Sources are assembled from most stable to most volatile:

| Tier              | Position | Use for                                                        |
| ----------------- | -------- | -------------------------------------------------------------- |
| `"pinned"`        | First    | Content that never changes (system instructions, schemas)      |
| `"stable"`        | Second   | Content that changes rarely (docs TOC, reference material)     |
| `"slow-changing"` | Third    | Content that updates occasionally (summaries, aggregations)    |
| `"volatile"`      | Last     | Content that changes every wake (conversation, search results) |

Non-volatile sources (`pinned`, `stable`, `slow-changing`) have their `max` values summed and validated against `sourceBudget` at registration time. Volatile sources share the remaining budget.

## timelineMessages

`ctx.timelineMessages()` projects the entity's timeline (inbox messages, agent runs, tool calls) into an ordered array of `TimestampedMessage` objects suitable for passing to an LLM.

```ts
const messages = ctx.timelineMessages()
// or with options:
const messages = ctx.timelineMessages({
  since: 42,
  projection: (item) => {
    if (item.kind === "run") return [{ role: "assistant", content: "..." }]
    return null // use default projection
  },
})
```

| Option       | Type                                           | Description                                                                            |
| ------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `since`      | `number`                                       | Only include items after this timeline position.                                       |
| `projection` | `(item: TimelineItem) => LLMMessage[] \| null` | Custom projection function. Return `null` to use the default projection for that item. |

This is typically used as the `content` function of a `volatile` source:

```ts
ctx.useContext({
  sourceBudget: 15_000,
  sources: {
    conversation: {
      content: () => ctx.timelineMessages(),
      max: 15_000,
      cache: "volatile",
    },
  },
})
```

## Context entries

Context entries are durable key-value items stored in the entity's stream. Unlike sources (which are recomputed each wake), context entries persist across wakes and are projected into the context window automatically when `useContext` is active.

Use context entries for information the agent discovers during a run that should remain available in future wakes (e.g. user preferences, extracted facts, accumulated instructions).

### insertContext

```ts
ctx.insertContext("user-prefs", {
  name: "User preferences",
  content: "Prefers concise responses. Timezone: PST.",
  attrs: { priority: "high" },
})
```

Inserting with an existing `id` replaces the previous entry.

### removeContext

```ts
ctx.removeContext("user-prefs")
```

### getContext / listContext

```ts
const entry = ctx.getContext("user-prefs")
// { id: "user-prefs", name: "User preferences", content: "...", insertedAt: 1234 }

const all = ctx.listContext()
// Array<ContextEntry>
```

### ContextEntryInput

| Field     | Type                | Description                         |
| --------- | ------------------- | ----------------------------------- |
| `name`    | `string`            | Human-readable label for the entry. |
| `content` | `string`            | The text content.                   |
| `attrs`   | `ContextEntryAttrs` | Optional metadata attributes.       |

### ContextEntry

Extends `ContextEntryInput` with:

| Field        | Type     | Description                       |
| ------------ | -------- | --------------------------------- |
| `id`         | `string` | The id passed to `insertContext`. |
| `insertedAt` | `number` | Timeline position when inserted.  |

## Full example

This example from the built-in Horton assistant shows all three source types working together:

```ts
async handler(ctx, wake) {
  const tools = [...ctx.darixTools, ...customTools]

  ctx.useContext({
    sourceBudget: 18_000,
    sources: {
      docs_toc: {
        content: () => renderCompressedToc(),
        max: 3_000,
        cache: "stable",
      },
      retrieved_docs: {
        content: () => renderRetrievedDocs(wake, ctx.events),
        max: 6_000,
        cache: "volatile",
      },
      conversation: {
        content: () => ctx.timelineMessages(),
        max: 9_000,
        cache: "volatile",
      },
    },
  })

  ctx.useAgent({
    systemPrompt: "You are a helpful assistant.",
    model: "claude-sonnet-4-5-20250929",
    tools,
  })
  await ctx.agent.run()
}
```

The `stable` docs TOC is assembled first and cached across wakes. The two `volatile` sources (retrieved docs and conversation) are recomputed each wake and share the remaining budget.

## Entities without useContext

Entities that don't call `useContext` are unchanged -- the runtime uses its default timeline assembly, building the full conversation history into the context window automatically. There is no need to migrate existing entities.
