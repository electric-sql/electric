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
  | `processed` // default: processed messages inline, pending returned separately
  | `none` // no inbox messages in the timeline
  | `all` // include processed, pending, paused, steer, and cancelled inbox rows
```

Default to `processed`. This matches the built-in chat UX: processed user
messages appear chronologically in the timeline, while pending/queued messages
remain separately editable in the composer/drawer and can be projected
optimistically at the bottom of the UI.

Use `none` for UIs that want a pure event/run stream without user messages.
Use `all` for debugging/audit UIs where pending/cancelled/steer rows should be
visible inline exactly where they happened.

`useEntityTimeline` should always be free to run a separate pending-inbox query
when the UI needs editable queued messages, regardless of the main timeline
inbox mode.

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

Prefer an explicit stable event-order value written during stream writes. The
timeline needs "when this event first happened", not "when this row was last
updated". Run rows, step rows, text rows, and tool-call rows are often updated
after they are inserted; using the last update offset would move old timeline
items forward incorrectly.

Best target design:

- add or reuse a cross-collection `timeline_order`/event-order value on built-in
  event rows;
- assign it when the event row is first written;
- preserve it on later updates;
- use it as the primary order for top-level rows and nested run items.

If Electric exposes the insert offset or stable first offset for each row in live
queries, that can replace an explicit event-order field. If the available offset
is the last offset that affected the row, do not use it for timeline ordering.

`_seq` can remain a temporary compatibility source while the new ordering field
or first-offset support is implemented, but the plan should not treat `_seq` as
the final design.

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

If we introduce a stable event-order field, this becomes simpler: the run's
display order should be the minimum event order across the run row, text rows,
text chunks, tool calls, and steps. That keeps a streaming run anchored near the
message that caused it even when the run row is completed later.

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
- Pending inbox rows are excluded from the main timeline by default.
- `opts.inboxMode` can exclude inbox rows or include all inbox statuses.
- Manifests are present in the timeline without a separate merge.
- Run rows preserve current ordering semantics, including the "run anchored to
  earliest child event" behavior.

Add UI-level tests or focused hook tests:

- `useEntityTimeline` no longer rebuilds the manifest merge path.
- Streaming text updates keep prior top-level timeline row identities stable
  where TanStack DB exposes stable maintained rows.
- Pending/optimistic inbox behavior still works in `ChatView`.
- `generationActive` is returned by `useEntityTimeline` without requiring
  timeline consumers to scan every row.

## Deferred decisions and audit notes

- Do not add a convenience `text` string to text rows in the first pass. Leave
  text materialization to consumers until we have reviewed how the streaming
  Markdown parser should consume chunks optimally.
- Verify whether live query rows expose an Electric first/insert offset suitable
  for ordering. A last-updated offset is not suitable for timeline order.
- Leave `normalizeEntityTimelineData` and related aggregate helpers in place for
  now. After the row-oriented timeline migration is complete, audit which
  aggregate helpers are still used and remove unused compatibility code then.

## Implementation phases

1. Define row types, hook return types, and source subquery helpers in
   `agents-runtime`.
2. Decide and implement the stable event-order source.
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
