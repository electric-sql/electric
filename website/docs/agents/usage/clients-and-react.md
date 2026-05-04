---
title: Clients & React
titleTemplate: "... - Electric Agents"
description: >-
  Observe Electric Agents entities from app code, build reactive StreamDB handles,
  and render chat timelines with the React useChat hook.
outline: [2, 3]
---

# Clients & React

Use the client APIs when you need to observe agents from application code rather than from inside a handler. They load entity or observation streams into TanStack DB-backed collections that can drive UI.

## AgentsClient

`createAgentsClient()` creates a small read client for observation sources.

```ts
import {
  codingSession,
  createAgentsClient,
  entity,
  entities,
} from "@electric-ax/agents-runtime"

const client = createAgentsClient({ baseUrl: "http://localhost:4437" })

// Observe a single entity stream.
const entityDb = await client.observe(entity("/horton/onboarding"))
console.log(entityDb.collections.texts.toArray)

// Observe the entity membership stream for a tag query.
const membersDb = await client.observe(
  entities({ tags: { project: "alpha" } })
)
console.log(membersDb.collections.members.toArray)

```

### Types

```ts
interface AgentsClientConfig {
  baseUrl: string
  fetch?: typeof globalThis.fetch
}

interface AgentsClient {
  observe(
    source: ObservationSource
  ): Promise<EntityStreamDB | ObservationStreamDB>
}
```

`observe(entity(url))` returns an `EntityStreamDB`. `observe(entities(...))` and `observe(db(...))` return an `ObservationStreamDB`.

:::: warning
`client.observe(cron(...))` is not currently supported. Use cron sources from handler wake subscriptions, or schedule tools exposed through `ctx.electricTools`.
::::

## Observation Sources

The same source helpers used by `ctx.observe()` can be used with `AgentsClient`.

| Helper              | Use case                                             |
| ------------------- | ---------------------------------------------------- |
| `entity(url)`       | Observe one entity by URL.                           |
| `entities({ tags })` | Observe the entity membership stream matching tags. |
| `db(id, schema)`    | Observe a shared-state stream.                       |
| `cron(expression)`  | Build a cron source for wake subscriptions.          |

```ts
import { db } from "@electric-ax/agents-runtime"

const shared = await client.observe(db("research-123", researchSchema))
```

## React useChat

`@electric-ax/agents-runtime/react` exports `useChat()`, a React hook that turns an `EntityStreamDB` into sections suitable for a chat UI.

```tsx
import { useEffect, useState } from "react"
import { createAgentsClient, entity } from "@electric-ax/agents-runtime"
import { useChat } from "@electric-ax/agents-runtime/react"
import type { EntityStreamDB } from "@electric-ax/agents-runtime"

const client = createAgentsClient({ baseUrl: "http://localhost:4437" })

export function AgentConversation({ entityUrl }: { entityUrl: string }) {
  const [db, setDb] = useState<EntityStreamDB | null>(null)

  useEffect(() => {
    let cancelled = false
    let observedDb: EntityStreamDB | null = null
    client.observe(entity(entityUrl)).then((observed) => {
      observedDb = observed as EntityStreamDB
      if (cancelled) {
        observedDb.close()
        return
      }
      if (!cancelled) setDb(observedDb)
    })
    return () => {
      cancelled = true
      observedDb?.close()
    }
  }, [entityUrl])

  const chat = useChat(db)

  return (
    <ol>
      {chat.sections.map((section, index) => (
        <li key={index}>
          {section.kind === "user_message"
            ? section.text
            : section.items.map((item) =>
                item.kind === "text" ? item.text : item.toolName
              )}
        </li>
      ))}
    </ol>
  )
}
```

### UseChatResult

```ts
interface UseChatResult {
  sections: EntityTimelineSection[]
  state: "pending" | "queued" | "working" | "idle" | "error"
  runs: IncludesRun[]
  inbox: IncludesInboxMessage[]
  wakes: IncludesWakeMessage[]
  entities: IncludesEntity[]
}
```

`sections` are the high-level chat timeline. `runs`, `inbox`, `wakes`, and `entities` expose the normalized underlying data for richer UIs.

## Timeline Helpers

If you are not using React, the runtime also exports pure timeline helpers:

```ts
import {
  buildSections,
  buildTimelineEntries,
  createEntityIncludesQuery,
  defaultProjection,
  getEntityState,
  materializeTimeline,
  normalizeEntityTimelineData,
  timelineMessages,
  timelineToMessages,
} from "@electric-ax/agents-runtime"
```

Use these when you already have an `EntityStreamDB` and want to build your own UI integration.

| Helper                         | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `createEntityIncludesQuery(db)` | Builds the TanStack DB query used by `useChat`.               |
| `normalizeEntityTimelineData()` | Normalizes and sorts nested run, text, tool, wake, and entity data. |
| `getEntityState(runs, inbox)`  | Computes `pending`, `queued`, `working`, `idle`, or `error`.  |
| `buildSections(runs, inbox)`   | Builds chat-friendly user/agent sections.                     |
| `buildTimelineEntries(runs, inbox)` | Builds keyed timeline entries with response timestamps.  |
| `materializeTimeline(data)`    | Converts normalized timeline data into prompt-oriented timeline items. |
| `defaultProjection(item)`      | Projects one timeline item into LLM messages.                 |
| `timelineMessages(db, opts?)`  | Reads an entity DB and returns timestamped LLM messages.      |
| `timelineToMessages(db)`       | Convenience wrapper returning plain LLM messages.             |

## CLI Entity Stream DB

The `electric-ax/entity-stream-db` subpath exposes a convenience loader used by CLI and UI code:

```ts
import { createEntityStreamDB } from "electric-ax/entity-stream-db"

const { db, close } = await createEntityStreamDB({
  baseUrl: "http://localhost:4437",
  entityUrl: "/horton/onboarding",
  initialOffset: "0",
})

try {
  console.log(db.collections.runs.toArray)
} finally {
  close()
}
```

This API fetches entity metadata from the server, opens the entity's main stream, preloads it, and returns an `EntityStreamDB`.
