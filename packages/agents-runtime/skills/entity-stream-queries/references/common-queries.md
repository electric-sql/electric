# Common Query Patterns

All examples assume:

```ts
import { eq, queryOnce } from '@durable-streams/state'
```

## Find an existing spawned child

```ts
import { manifestChildKey } from '@electric-ax/agents-runtime'

const child = await queryOnce((q) =>
  q
    .from({ manifests: ctx.db.collections.manifests })
    .where(({ manifests }) =>
      eq(manifests.key, manifestChildKey(`worker`, `child-1`))
    )
    .findOne()
)

if (child?.kind === `child`) {
  ctx.send(child.entity_url, payload)
} else {
  await ctx.spawn(`worker`, `child-1`, args)
}
```

## List observed entities

```ts
const observed = await queryOnce((q) =>
  q
    .from({ manifests: ctx.db.collections.manifests })
    .where(({ manifests }) => eq(manifests.kind, `observe`))
)
```

## Read the current manifest state

```ts
const manifestRows = await queryOnce((q) =>
  q.from({ manifests: db.collections.manifests })
)
```

Project/group those rows at the call site if needed. Do not add a one-off helper unless it encodes real semantics.

## Read current child statuses

```ts
const statuses = await queryOnce((q) =>
  q.from({ childStatus: db.collections.childStatus })
)
```

## Read a child stream's latest runs in a test or handler

```ts
const runs = await queryOnce((q) =>
  q.from({ runs: childHandle.db.collections.runs })
)

const latestRun = runs[runs.length - 1]
```

## Live UI query for the combined entity view

Use the shared entity view query in `src/entity-timeline.ts` for UI/chat surfaces that need runs, inbox, wakes, and related entities together.

```ts
const timelineQuery = createEntityIncludesQuery(db)
const { data = [] } = useLiveQuery(timelineQuery, [timelineQuery])
const timeline = data[0]
```

Use direct `queryOnce(...)` for one-shot reads. Use the shared live query only when you genuinely need the full reactive view model.
