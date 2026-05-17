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

Also add a public React hook for app and userland UIs:

```ts
useEntityTimeline(db, opts?)
```

The hook should be exported for users to build their own timeline UIs. It should
wrap `createEntityTimelineQuery` and return the maintained timeline rows plus
useful derived state such as `generationActive`, pending inbox messages, and any
other small status values needed by the built-in UI.

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

## Query and hook options

Add options to both `createEntityTimelineQuery` and `useEntityTimeline` so
callers can choose how inbox messages participate in the timeline:

```ts
type EntityTimelineInboxMode =
  | `processed` // default: processed + optimistic local pending rows inline
  | `none` // no inbox messages in the timeline
  | `all` // include processed, pending, paused, steer, and cancelled inbox rows
```

Default to `processed`. This matches the built-in chat UX: processed user
messages appear chronologically in the timeline, and optimistic local pending
rows created through TanStack DB mutation APIs also appear in the same timeline
path while they are unsynced. Non-optimistic queued rows can still remain
separately editable in the composer/drawer.

Use `none` for UIs that want a pure event/run stream without user messages.
Use `all` for debugging/audit UIs where pending/cancelled/steer rows should be
visible inline exactly where they happened.

`useEntityTimeline` should always be free to run a separate pending-inbox query
when the UI needs editable queued messages, regardless of the main timeline
inbox mode.

To avoid duplicate rendering, the hook should separate timeline rendering from
editable pending state:

- `rows` follows `inboxMode`.
- `pendingInbox` is returned for composer/drawer editing state.
- In the default `processed` mode, `rows` includes synced processed inbox rows
  plus local optimistic pending inbox rows created through DB mutation APIs.
- When `inboxMode: 'all'`, all pending inbox messages may appear in `rows`;
  callers that also render `pendingInbox` controls must key by `row.inbox.$key`
  and avoid drawing a second message bubble for the same pending row.
- Optimistic pending inbox inserts should go into the inbox collection with a
  pending `_timeline_order`, so they appear through the same `rows` path. The
  separate `pendingInbox` result is metadata/editing state for the same row, not
  a second rendering source.

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
type EntityTimelineOrder = string

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

This key rule also applies to selected source subqueries and nested collections:
the selected row should retain its `$key` virtual prop. Do not add `sourceKey`
fields for run, inbox, text, tool call, or chunk rows unless a future API proves
the virtual key is insufficient.

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

Filter to processed messages by default. The exact filter depends on
`opts.inboxMode`:

```ts
const inbox = q
  .from({ inbox: db.collections.inbox })
  .where(({ inbox }) =>
    opts.inboxMode === `processed`
      ? or(
          eq(coalesce(inbox.status, `processed`), `processed`),
          isOptimisticLocalRow(inbox)
        )
      : opts.inboxMode === `all`
        ? true
        : false
  )
  .select(({ inbox }) => ({
    order: inbox._timeline_order,
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
  order: run._timeline_order,
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

### Nested includes rendering contract

Do not wrap these nested includes in `toArray` in `createEntityTimelineQuery`.
The point of the new API is that `items`, `chunks`, `errors`, and `steps` remain
child live collections maintained by TanStack DB.

Parent timeline rows should pass child collections down to row components:

```tsx
function TimelineRunRow({ run }: { run: EntityTimelineRunRow }) {
  return <AgentResponse items={run.items} errors={run.errors} />
}
```

Child components then subscribe to the child collection where they render it:

```tsx
function AgentResponse({
  items,
}: {
  items: Collection<EntityTimelineRunItem>
}) {
  const { data: runItems = [] } = useLiveQuery(items)
  return runItems.map((item) =>
    item.text ? (
      <TextItem text={item.text} />
    ) : (
      <ToolCall item={item.toolCall} />
    )
  )
}

function TextItem({ text }: { text: EntityTimelineTextItem }) {
  const { data: chunks = [] } = useLiveQuery(text.chunks)
  // Markdown streaming strategy TBD; do not eagerly concatenate in the query.
}
```

This is the key performance boundary. A text delta should update the text row's
`chunks` child collection and the subscribed text component, not rematerialize
the whole run, whole timeline, or all previous messages.

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
  order: wake._timeline_order,
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
    order: manifest._timeline_order,
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
    order: contextInserted._timeline_order,
    id: contextInserted.id,
    name: contextInserted.name,
    attrs: contextInserted.attrs,
    content: contextInserted.content,
    timestamp: contextInserted.timestamp,
  }))
```

`contextRemoved` should mirror this shape in a `contextRemoved` source branch.

### Steps, errors, and lifecycle-like rows

`steps` are model-generation step lifecycle rows emitted by the outbound bridge:

- `onStepStart()` inserts a step with `status: 'started'`, `step_number`,
  `run_id`, and optional `model_provider`/`model_id`.
- `onStepEnd()` updates that step to `status: 'completed'` with
  `finish_reason` and optional `duration_ms`.

They are not user messages or tool calls. They describe LLM/model execution
attempts within a run. Today they are used as run metadata and for ordering
anchoring, but the built-in chat UI does not render them as visible rows.

First pass: keep steps as nested run metadata. Include them in the run row so
observability UIs can render model/step metadata, but do not make them top-level
timeline rows unless we decide they are user-visible inline events. A later
option can expose step rows inline for debugging/audit views.

Apply the same rule to top-level errors without `run_id`, entity lifecycle rows,
and signal rows: include them in `createEntityTimelineQuery` only when they are
events a user would reasonably expect to see at the point they happened. If a row
is primarily current entity state, keep it out of the event timeline and expose
it through state/status APIs instead.

## Ordering

Use a stable first-event order injected by `createEntityStreamDB` at stream
ingest time.

Do not use the existing `__electricRowOffsets` map for live timeline ordering.
That map is currently updated on every change event, so it represents the last
offset that affected a row. The timeline needs "when this event first happened",
not "when this row was last updated". Run rows, step rows, text rows, and
tool-call rows are often updated after they are inserted; using a last-update
offset would move old timeline items forward incorrectly.

Decision:

- Add an internal row field, `_timeline_order`, to the built-in event row
  types/schemas that participate in timelines.
- In `createEntityStreamDB`'s `onBeforeBatch`, derive a stable order token for
  each incoming change event from the Electric/Durable Streams offset and the
  item index within the batch.
- Store the first order token seen for each `(collection, row key)` in a map.
- Before StreamDB applies each insert/update/upsert change, inject that first
  order token into `item.value._timeline_order`.
- Preserve the original first order token on later updates.
- Use `_timeline_order` as the primary order expression in
  `createEntityTimelineQuery`.

`_timeline_order` should be a lexically sortable string. Use an
offset-plus-index token rather than raw offset alone. Some stream batches can
contain multiple events, and not every event is guaranteed to carry a unique
per-item offset. A token such as `${offset}:${itemIndex.padStart(...)}` gives a
stable total order while still preserving the underlying stream order.

Because `_timeline_order` is an actual query field, it must be accepted by the
built-in row schemas/types. Do not rely on mutating event values if validation or
row parsing would strip the field before TanStack DB sees it.

Reset/replay behavior:

- On stream reset, clear the first-order map.
- During replay, rebuild `_timeline_order` from replayed events.
- If the first event observed for a row is an update rather than an insert, use
  that first observed update's order. It is still stable for the local
  materialization.

Optimistic local rows:

- Pending optimistic rows that do not yet have a stream offset should receive a
  high pending order token so they sort after persisted rows.
- Pending order tokens should preserve local insertion order, e.g.
  `pending:${counter.padStart(...)}`.
- Optimistic rows should render through the same timeline query/component path as
  synced rows.
- Optimistic rows should be applied through TanStack DB mutation APIs so the
  collection sees them as normal local rows, including their pending
  `_timeline_order`.
- When the persisted stream event arrives, the server-backed row should replace
  the optimistic row and use its real `_timeline_order` from the writeback.

This keeps ordering local to StreamDB ingestion and avoids modifying every write
site (`EntityManager`, `outbound-bridge`, context writes, wake writes, etc.) to
precompute an order value they do not know yet.

For run rows, use `run._timeline_order` directly. Because `_timeline_order` is
assigned from the first event observed for the run row and preserved on later
updates, completion updates no longer move the run later in the timeline. This
removes the need for the current imperative run/text re-anchoring workaround.

## Runtime exports

Add new exports alongside the existing aggregate API:

```ts
export { createEntityIncludesQuery, createEntityTimelineQuery }
export { useEntityTimeline }

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
   - Replace `createEntityIncludesQuery` with the exported
     `useEntityTimeline`/`createEntityTimelineQuery` path.
   - Remove the separate manifest query/merge once manifests are included.
   - Keep the pending inbox query separate inside the hook and return
     `pendingInbox`.
   - Return `generationActive` from the hook as derived state, preferably from a
     small dedicated live query over active runs rather than by scanning the
     full timeline on every change.
   - Keep global entity status enrichment separate initially.
   - When matching processed/pending inbox messages, use `row.inbox.$key` as the
     raw inbox key and `row.$key` only as the timeline row key.
2. `packages/agents-server-ui/src/components/EntityTimeline.tsx`
   - Accept the new row union, or adapt it to the current `TimelineEntry`
     shape as an intermediate step.
   - Use each row's `$key` virtual prop as the React/virtualizer key.
   - Pass nested child collections such as `run.items` to child row components
     instead of rebuilding `section.items` arrays.
3. `packages/agents-server-ui/src/components/AgentResponse.tsx`
   - Subscribe to nested run items with `useLiveQuery(run.items)`.
   - Update text rendering after reviewing the streaming Markdown parser; avoid
     eager timeline-query concatenation.
   - Keep markdown caching and tool display parsing in the component layer.
4. `packages/electric-ax/src/observe-ui.tsx`
   - Move from aggregate includes to timeline rows.
5. `examples/deep-survey/src/ui/components/ChatSidebar.tsx`
   - Move from aggregate includes to timeline rows if it remains a streaming
     UI example.

Keep `useChat` on `createEntityIncludesQuery` initially as a stable convenience
hook for aggregate chat data. `useEntityTimeline` is the new row-oriented hook
for timeline UIs.

## Tests

Add runtime tests for the new query:

- Multi-source timeline returns inbox, run, wake, manifest, and context rows in
  order.
- Rows from different source collections with the same raw key do not collide;
  use the multi-source `$key` virtual prop as the public row key.
- Insert/update/delete in each source updates only the relevant branch rows.
- A text delta insertion updates the nested text chunks include for the active
  run item.
- Parent timeline rows expose child collections, not arrays, for nested
  includes.
- Child UI components subscribe to child collections with `useLiveQuery`.
- A tool call update updates the matching nested run item.
- Non-optimistic pending inbox rows are excluded from the main timeline by
  default.
- Optimistic pending rows created through DB mutation APIs are included in the
  main timeline by default.
- `opts.inboxMode` can exclude inbox rows or include all inbox statuses.
- Manifests are present in the timeline without a separate merge.
- Run rows keep their first-event `_timeline_order` when completed, so completion
  updates do not move them later in the timeline.
- `_timeline_order` is derived from the first stream offset/item index for a row
  and does not change when that row is updated.
- Multiple events in the same stream batch still receive deterministic relative
  ordering.
- Stream reset/replay clears and rebuilds `_timeline_order` deterministically.
- Rows first observed through an update still get a stable first-observed
  `_timeline_order`.
- Optimistic rows sort after persisted rows until replaced by server-backed rows
  with real `_timeline_order`.
- Optimistic rows preserve local insertion order and render through the same row
  path as synced rows.

Add UI-level tests or focused hook tests:

- `useEntityTimeline` no longer rebuilds the manifest merge path.
- Streaming text updates keep prior top-level timeline row identities stable
  where TanStack DB exposes stable maintained rows.
- Optimistic inbox behavior renders through the same `rows` path in `ChatView`.
- Pending inbox editing state still works in `ChatView` without double-rendering
  the same optimistic row.
- `generationActive` is returned by `useEntityTimeline` without requiring
  timeline consumers to scan every row.

## Deferred decisions and audit notes

- Do not add a convenience `text` string to text rows in the first pass. Leave
  text materialization to consumers until we have reviewed how the streaming
  Markdown parser should consume chunks optimally.
- Validate the `_timeline_order` injection point against `@durable-streams/state`
  internals. If `onBeforeBatch` cannot safely mutate incoming event values before
  validation and collection application, add first-event-order support in
  StreamDB itself rather than pushing ordering logic into every writer.
- Leave `normalizeEntityTimelineData` and related aggregate helpers in place for
  now. After the row-oriented timeline migration is complete, audit which
  aggregate helpers are still used and remove unused compatibility code then.

## Implementation phases

1. Define row types, hook return types, and source subquery helpers in
   `agents-runtime`.
2. Add `_timeline_order` row support:
   - first prove the injection point by testing that values added in
     `onBeforeBatch` survive validation and collection application;
   - extend built-in event row schemas/types;
   - inject first-offset-plus-index order tokens in `createEntityStreamDB`;
   - preserve the first token across updates.
3. Implement `createEntityTimelineQuery` with multi-source `from` and no outer
   `select`.
4. Add `useEntityTimeline` returning rows plus derived state
   (`generationActive`, pending inbox, etc.).
5. Add run nested includes for ordered text/tool-call items, errors, and nested
   step metadata.
6. Add text chunk includes and remove eager text concatenation from the new API.
7. Add parity tests against key `createEntityIncludesQuery` behaviors.
8. Migrate `agents-server-ui` behind the same public `useEntityTimeline` hook.
9. Migrate observe/example streaming UIs.
10. Document when to use `createEntityIncludesQuery` versus
    `createEntityTimelineQuery`.
