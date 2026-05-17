# Electric Agents `createEntityTimelineQuery` plan

## Goal

Add a row-oriented, fine-grained live query API for Electric Agents timelines:

```ts
createEntityTimelineQuery(db)
```

This query should produce an ordered timeline collection of individual events
rather than one aggregate session object. It is intended for hot UI paths such
as the built-in app chat log, observe UI, and user-built timeline UIs.

Keep `createEntityIncludesQuery` as the snapshot/convenience API. It is useful
when consumers want the whole session shape at once, but it rematerializes the
session-level data structure on every streaming chunk.

## Core direction

Use TanStack DB's multi-source `from` for the outer timeline query and keep the
outer query simple:

```ts
return q
  .from({
    inbox,
    run,
    wake,
    manifest,
    contextInserted,
    contextRemoved,
  })
  .orderBy(({ inbox, run, wake, manifest, contextInserted, contextRemoved }) =>
    coalesce(
      inbox.order,
      run.order,
      wake.order,
      manifest.order,
      contextInserted.order,
      contextRemoved.order
    )
  )
```

Do not use `caseWhen` in the outer `select`. Without an outer `select`, the
query result keeps the discriminated/exclusive union produced by multi-source
`from`:

```ts
type EntityTimelineQueryRow =
  | { inbox: EntityTimelineInboxRow; run?: undefined; wake?: undefined; ... }
  | { run: EntityTimelineRunRow; inbox?: undefined; wake?: undefined; ... }
  | { wake: EntityTimelineWakeRow; inbox?: undefined; run?: undefined; ... }
  | ...
```

Any event-type projection should happen in the source subquery for that event
type. The outer query should only combine and order already-shaped event rows.

Use `caseWhen` only where it is materially useful, such as branch-dependent
includes/joins after a union source or conditional nested projection. It should
not be required for the top-level timeline union.

## Why this exists

The current UI path is:

```text
createEntityIncludesQuery
  -> normalizeEntityTimelineData
  -> buildTimelineEntries
  -> EntityTimeline
```

`createEntityIncludesQuery` returns one aggregate row with nested arrays:

- `runs`
- `inbox`
- `wakes`
- `entities`
- nested `texts`, `toolCalls`, `steps`, `errors`
- text strings built from `concat(toArray(textDeltas...))`

During streaming, every new text delta changes the aggregate row. The render
pipeline has memoization to avoid repainting settled rows, but the session data
structure is still rebuilt on each chunk. The new API should let TanStack DB
maintain the timeline incrementally at row and nested-collection granularity.

## UI use cases to support

The built-in app UI currently needs:

- A stable ordered row list for virtualized rendering and find/search.
- Rows for processed user messages, agent runs/responses, wakes, manifests,
  context insertion/removal events, and possibly top-level errors/lifecycle
  events later.
- Agent run rows with ordered nested content:
  - text segments;
  - tool calls;
  - run errors;
  - steps, even if the current UI does not render them prominently.
- Text segment rows with ordered text chunks/deltas, so streaming updates only
  the active text's nested collection rather than the whole timeline.
- Manifest rows for the app timeline, currently queried separately and merged in
  `useEntityTimeline`.
- Related entity data/status for manifest badges and "open entity" actions.
- Pending inbox messages separately for queued/editable messages in
  `MessageInput` and `EntityContextDrawer`.
- A cheap way to derive whether generation is active.

UI-only behavior should stay outside the query:

- Markdown rendering and render cache management.
- Tool argument parsing for display.
- Tool result stringification for display/copy.
- The first-message `isInitial` flag.
- `responseTimestamp`, which depends on the previous user message.
- Optimistic inline queued message projection.

## Proposed source subqueries

Each source subquery should project rows into a runtime-level timeline event
shape with a common base:

```ts
type EntityTimelineOrder = string | number

type EntityTimelineRowBase = {
  order: EntityTimelineOrder
}
```

Do not project synthetic timeline identifiers in each source subquery. TanStack
DB adds `$key` virtual props to live query rows, and multi-source `from` prefixes
the outer row key with the active source alias. A no-select multi-source row
therefore has enough identity and discrimination already:

```ts
{
  $key: `wake:123`,
  wake: {
    $key: 123,
    // projected wake fields...
  },
}
```

Consumers should use the outer row's `$key` as the stable timeline row key and
narrow by the active source alias (`row.wake`, `row.run`, `row.inbox`, etc.).
The source row's own `$key` remains available inside the active alias if callers
need the original collection key.

This matches the TanStack DB branch implementation: union branches are wrapped
under their source alias, no-select union queries return the namespaced row, and
the union stream key is prefixed with the source alias.

Do not add a separate `kind` field just to discriminate timeline rows. The
active source alias is the discriminant. In UI code, replace old
`section.kind` switches with small alias-narrowing helpers:

```ts
function isInboxRow(row: EntityTimelineQueryRow): row is InboxTimelineRow {
  return row.inbox !== undefined
}

function isRunRow(row: EntityTimelineQueryRow): row is RunTimelineRow {
  return row.run !== undefined
}
```

For exhaustive handling, use a helper that branches over every known alias and
assigns the remainder to `never`. This keeps type safety without duplicating the
source alias as another string field that can drift from the query shape.

### Inbox source

Filter to processed messages by default:

```ts
const inbox = q
  .from({ inbox: db.collections.inbox })
  .where(({ inbox }) => eq(coalesce(inbox.status, `processed`), `processed`))
  .select(({ inbox }) => ({
    order: coalesce(inbox._seq, -1),
    from: coalesce(inbox.from, `unknown`),
    payload: inbox.payload,
    timestamp: coalesce(inbox.timestamp, EPOCH_ISO),
    mode: coalesce(inbox.mode, `immediate`),
    status: coalesce(inbox.status, `processed`),
    position: inbox.position,
    processed_at: inbox.processed_at,
    cancelled_at: inbox.cancelled_at,
  }))
```

Pending inbox should remain a separate query for the composer/drawer because it
has different sorting and editing behavior.

### Run source

The run source is the most important for fine-grained streaming behavior:

```ts
const run = q.from({ run: db.collections.runs }).select(({ run }) => ({
  order: coalesce(run._seq, -1),
  status: run.status,
  finish_reason: run.finish_reason,
  items: runItemsInclude(run.key),
  errors: runErrorsInclude(run.key),
  steps: runStepsInclude(run.key),
}))
```

`items` should be an ordered nested collection over texts and tool calls. Use
the same no-outer-select multi-source pattern here too, so item rows are
discriminated by active alias and keyed by DB:

```ts
q.from({
  text,
  toolCall,
})
  .where(({ text, toolCall }) =>
    eq(coalesce(text.run_id, toolCall.run_id), run.key)
  )
  .orderBy(({ text, toolCall }) => coalesce(text.order, toolCall.order))
```

The result shape should be:

```ts
type EntityTimelineRunItem =
  | { $key: string; text: EntityTimelineTextItem; toolCall?: undefined }
  | { $key: string; text?: undefined; toolCall: EntityTimelineToolCallItem }
```

Text item rows should include ordered chunks/deltas rather than an eagerly
concatenated text string:

```ts
type EntityTimelineTextItem = {
  run_id: string
  order: EntityTimelineOrder
  status: `streaming` | `completed`
  chunks: Collection<EntityTimelineTextChunk>
}

type EntityTimelineTextChunk = {
  text_id: string
  run_id: string
  order: EntityTimelineOrder
  delta: string
}
```

Do not decide the final text materialization strategy in this plan. First review
how the streaming Markdown parser should consume chunks so the UI can avoid
unnecessary string rebuilding.

Tool call item rows should preserve the current display fields:

```ts
type EntityTimelineToolCallItem = {
  run_id: string
  order: EntityTimelineOrder
  tool_name: string
  status: `started` | `args_complete` | `executing` | `completed` | `failed`
  args?: unknown
  result?: unknown
  error?: string
}
```

### Wake source

Project the current wake display payload:

```ts
const wake = q.from({ wake: db.collections.wakes }).select(({ wake }) => ({
  order: coalesce(wake._seq, -1),
  payload: {
    type: `wake` as const,
    timestamp: wake.timestamp,
    source: wake.source,
    timeout: wake.timeout,
    changes: wake.changes,
    finished_child: wake.finished_child,
    other_children: wake.other_children,
  },
}))
```

### Manifest source

The app UI currently queries manifests separately and merges them into the
timeline. The new query should include them directly:

```ts
const manifest = q
  .from({ manifest: db.collections.manifests })
  .select(({ manifest }) => ({
    order: coalesce(manifest._seq, -1),
    manifest,
  }))
```

Entity status enrichment can be handled in one of two ways:

1. Keep the app UI's separate status query against the global entity registry.
2. Add a runtime-level related-entity projection for child/source manifests.

Prefer option 1 initially to keep `createEntityTimelineQuery` focused on the
entity stream itself.

### Context sources

Include context history rows so the query is comprehensive for userland
timeline UIs, even if the built-in chat UI chooses not to display them yet:

```ts
const contextInserted = q
  .from({ contextInserted: db.collections.contextInserted })
  .select(({ contextInserted }) => ({
    order: coalesce(contextInserted._seq, -1),
    id: contextInserted.id,
    name: contextInserted.name,
    attrs: contextInserted.attrs,
    content: contextInserted.content,
    timestamp: contextInserted.timestamp,
  }))
```

`contextRemoved` should mirror this shape in a `contextRemoved` source branch.

### Steps, errors, and lifecycle-like rows

Include rows chronologically when they are events that make sense inline in a
timeline. For steps, that means including them if they represent meaningful
execution milestones rather than merely run state metadata. They can be top-level
timeline rows, nested run items, or both depending on the display contract, but
they should not be omitted solely because the current built-in UI does not render
them today.

Apply the same rule to top-level errors without `run_id`, entity lifecycle rows,
and signal rows: include them in `createEntityTimelineQuery` only when they are
events a user would reasonably expect to see at the point they happened. If a row
is primarily current entity state, keep it out of the event timeline and expose
it through state/status APIs instead.

## Ordering

The first implementation can keep the same practical order source as the live
query currently uses: `coalesce(_seq, -1)`.

Longer term, the synchronous snapshot path has stronger offset-based ordering
via `__electricRowOffsets`. If live query rows can expose equivalent ordering
metadata, move the shared ordering logic into reusable helpers so the snapshot
and live timeline paths agree exactly. Before doing this, verify what the
available live-query offset means; it is only suitable for ordering if it is the
last Electric offset that affected the row.

For run rows, preserve the existing behavior where a run is anchored to the
earliest child event rather than a later run-row update. This may require a
derived `runOrder` subquery/field that is the minimum of:

- the run row order;
- text item order;
- first text delta order;
- tool call order;
- step order.

If that is too much for the first pass, document the gap and keep tests around
the old aggregate query until the row-oriented query reaches parity.

## Runtime exports

Add new exports alongside the existing aggregate API:

```ts
export { createEntityIncludesQuery, createEntityTimelineQuery }

export type {
  EntityTimelineQueryRow,
  EntityTimelineInboxRow,
  EntityTimelineRunRow,
  EntityTimelineRunItem,
  EntityTimelineTextItem,
  EntityTimelineTextChunk,
  EntityTimelineToolCallItem,
  EntityTimelineWakeRow,
  EntityTimelineManifestRow,
}
```

Optionally add a convenience collection factory later:

```ts
createEntityTimelineCollection(db)
```

The query function should come first so users can compose it inside their own
queries.

## Built-in UI migration

Migrate hot paths to the row-oriented query:

1. `packages/agents-server-ui/src/hooks/useEntityTimeline.ts`
   - Replace `createEntityIncludesQuery` with `createEntityTimelineQuery`.
   - Remove the separate manifest query/merge once manifests are included.
   - Keep the pending inbox query separate.
   - Keep global entity status enrichment separate initially.
2. `packages/agents-server-ui/src/components/EntityTimeline.tsx`
   - Accept the new row union, or adapt it to the current `TimelineEntry`
     shape as an intermediate step.
   - Use each row's `$key` virtual prop as the React/virtualizer key.
   - Prefer rendering run rows from nested `items` rather than from a rebuilt
     `section.items` array.
3. `packages/agents-server-ui/src/components/AgentResponse.tsx`
   - Render nested run items.
   - Update text rendering after reviewing the streaming Markdown parser; avoid
     eager timeline-query concatenation.
   - Keep markdown caching and tool display parsing in the component layer.
4. `packages/electric-ax/src/observe-ui.tsx`
   - Move from aggregate includes to timeline rows.
5. `examples/deep-survey/src/ui/components/ChatSidebar.tsx`
   - Move from aggregate includes to timeline rows if it remains a streaming
     UI example.

Keep `useChat` on `createEntityIncludesQuery` initially as a stable convenience
hook. A separate row-oriented hook can be added later.

## Tests

Add runtime tests for the new query:

- Multi-source timeline returns inbox, run, wake, manifest, and context rows in
  order.
- Rows from different source collections with the same raw key do not collide;
  use the multi-source `$key` virtual prop as the public row key.
- Insert/update/delete in each source updates only the relevant branch rows.
- A text delta insertion updates the nested text chunks include for the active
  run item.
- A tool call update updates the matching nested run item.
- Pending inbox rows are excluded from the main timeline by default.
- Manifests are present in the timeline without a separate merge.
- Run rows preserve current ordering semantics, including the "run anchored to
  earliest child event" behavior.

Add UI-level tests or focused hook tests:

- `useEntityTimeline` no longer rebuilds the manifest merge path.
- Streaming text updates keep prior top-level timeline row identities stable
  where TanStack DB exposes stable maintained rows.
- Pending/optimistic inbox behavior still works in `ChatView`.

## Deferred decisions and audit notes

- Do not add a convenience `text` string to text rows in the first pass. Leave
  text materialization to consumers until we have reviewed how the streaming
  Markdown parser should consume chunks optimally.
- Verify whether live query rows expose an Electric offset suitable for ordering.
  It must be the last offset that affected the row to replace `_seq` safely.
- Leave `normalizeEntityTimelineData` and related aggregate helpers in place for
  now. After the row-oriented timeline migration is complete, audit which
  aggregate helpers are still used and remove unused compatibility code then.

## Implementation phases

1. Define row types and source subquery helpers in `agents-runtime`.
2. Implement `createEntityTimelineQuery` with multi-source `from` and no outer
   `select`.
3. Add run nested includes for ordered text/tool-call items, errors, and steps.
4. Add text chunk includes and remove eager text concatenation from the new API.
5. Add parity tests against key `createEntityIncludesQuery` behaviors.
6. Migrate `agents-server-ui` behind the same public `useEntityTimeline` hook.
7. Migrate observe/example streaming UIs.
8. Document when to use `createEntityIncludesQuery` versus
   `createEntityTimelineQuery`.
