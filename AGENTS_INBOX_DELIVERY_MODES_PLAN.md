# Agents Inbox Message Modes Plan

## Goal

Add first-class shared message queueing and steering to Electric Agents while keeping `/send` as the canonical way to send messages to an entity.

The core model is:

- `inbox` contains messages sent to an entity.
- Each inbox message has a processing `mode` and lifecycle `status`.
- Pending queued messages are synced across devices and editable before processing.
- Processed messages are immutable conversation history and are visible to the agent runtime.
- Steer messages interrupt the current generation and restart the loop around the promoted message.

This should be a framework-level capability, with Horton as the polished default experience rather than a one-off special case.

## Current State

Today, `POST /{type}/{name}/send` appends an inbox insert directly to the entity main stream. The UI optimistically inserts the same shape into `db.collections.inbox`, so the message appears in the chat immediately.

The runtime wakes on inbox inserts. Horton then calls `ctx.agent.run()`, and the runtime derives the trigger text from the current inbox row while history comes from `ctx.timelineMessages()`.

There is no durable pending state today. Once a message is appended to `inbox`, it is treated as committed conversation history.

## Proposed Model

Extend inbox messages with processing metadata:

```ts
type InboxMode = 'immediate' | 'queued' | 'steer'
type InboxStatus = 'pending' | 'processed' | 'cancelled'

type InboxMessage = {
  // Existing inbox fields.
  key: string
  from: string
  payload: unknown
  timestamp: string
  message_type?: string

  // New processing metadata.
  mode: InboxMode
  status: InboxStatus
  position?: string
  processed_at?: string
  cancelled_at?: string
}
```

Default behavior should preserve the existing semantics:

- If `mode` is omitted, treat it as `immediate`.
- If `status` is omitted on existing rows, treat it as `processed`.

This allows existing stream history and existing callers to keep working while newer clients can opt into queueing and steering.

## Processing Semantics

### Immediate

`mode: 'immediate'` is the current behavior.

`/send` creates a processed inbox message and the runtime wakes normally:

```text
/send { mode: 'immediate', payload }
-> inbox insert { mode: 'immediate', status: 'processed' }
-> runtime handles inbox row
```

Use cases:

- Existing API callers.
- System messages.
- Machine-to-machine messages.
- Worker/child entity messages.
- Any message type that should not wait behind a user queue.

### Queued

`mode: 'queued'` appends a shared pending inbox message:

```text
/send { mode: 'queued', payload }
-> inbox insert { mode: 'queued', status: 'pending', position }
-> UI renders pending message
-> runtime ignores it until promotion
```

While pending, the message can be edited, reordered, cancelled, or promoted to steer.

Normal promotion happens when the entity is ready for another user input:

```text
head pending queued message
-> inbox update { status: 'processed', processed_at }
-> runtime handles that message as the next trigger
```

Pending queued messages must not be included in `ctx.timelineMessages()` or default LLM context.

### Queue Position

`position` should be an opaque, lexicographically sortable string used only for ordering pending queued messages. The current recommendation is to use fractional indexing, similar to how collaborative list UIs order cards without renumbering the whole list.

Sorting rule:

```text
pending queued messages
-> sort by position asc
-> then created stream order asc
-> then key asc
```

The tie-breakers matter because multiple devices may submit or reorder at the same time. Runtime promotion must be deterministic even if two rows temporarily share a position.

Suggested behavior:

- New queued message with no explicit `position`: server assigns a position after the current queue tail.
- Reorder to top: client/server assigns a position before the current first pending message.
- Reorder between two messages: client/server assigns a position between the previous and next positions.
- Reorder to bottom: client/server assigns a position after the current last pending message.
- Missing `position` on a pending message: project it as after all positioned pending messages, ordered by stream order.

The API should treat `position` as opaque. Clients can send a proposed position for optimistic UI, but the server/runtime should be allowed to normalize or replace it in the appended stream event.

Example:

```text
A position "a0"
B position "m0"
C position "z0"

move C between A and B -> C position "g0"
```

We should not use `_seq` as the primary queue order. `_seq` is the append order of stream events, which is perfect for transcript history but poor for reordering because moving an item would require projection tricks or full renumbering. `position` makes reorder an ordinary update to the pending message.

### Steer

`mode: 'steer'` means "process this now, interrupt current work, and restart the loop."

For a new message:

```text
/send { mode: 'steer', payload }
-> inbox insert { mode: 'steer', status: 'processed' }
-> interrupt active generation
-> restart handler with steer message as trigger
```

For an existing queued message:

```text
pending queued message
-> update same row { mode: 'steer', status: 'processed', processed_at }
-> interrupt active generation
-> restart handler with that message as trigger
```

Steer messages become committed history immediately. They should not remain editable once processed.

## State Transitions

Allowed transitions:

```text
pending queued -> pending queued      edit/reorder
pending queued -> cancelled           delete/cancel
pending queued -> processed queued    normal promotion
pending queued -> processed steer     steer now
processed immediate                   send now
processed steer                       steer now
```

Disallowed by default:

```text
processed -> pending
processed -> cancelled
processed -> edited payload
cancelled -> processed
```

The invariant is:

```text
pending = editable intent
processed = immutable transcript history
cancelled = hidden or visibly cancelled queue history, not agent-visible
```

## API Shape

Treat inbox messages as a REST-style resource. Sending a message creates an inbox row; editing, reordering, cancelling, processing, and steering are updates to that row.

The clean resource shape is:

```http
POST /{type}/{name}/inbox
PATCH /{type}/{name}/inbox/{messageKey}
DELETE /{type}/{name}/inbox/{messageKey}
```

`POST` creates an inbox row:

```ts
type SendRequest = {
  from?: string
  key?: string
  type?: string
  payload?: unknown
  mode?: 'immediate' | 'queued' | 'steer'
  position?: string
}
```

`from` and `payload` remain required after validation.

`PATCH` modifies a pending row or performs controlled status transitions:

These endpoints append updates to the entity stream. They should reject changes to processed or cancelled messages unless an explicit future admin/debug override is introduced.

Patch examples:

```ts
// Edit payload while pending.
{ payload: { text: 'updated prompt' } }

// Reorder while pending.
{ position: 'b7' }

// Mark the head queued message as processed.
{ status: 'processed' }

// Promote queued message to steer and process it immediately.
{ mode: 'steer', status: 'processed' }
```

`DELETE` cancels a pending row. At the stream layer this still produces a delete event for the inbox collection; it should not physically rewrite history.

`POST /{type}/{name}/send` can remain as a compatibility alias for `POST /{type}/{name}/inbox`, or we can make the breaking rename now and move clients to `/inbox`.

Steer may still deserve a dedicated helper route/action because it has side effects beyond row mutation: it requests cancellation and loop restart. The underlying state transition should still be the same inbox row update.

## Runtime Changes

### Inbox Schema

Rename the built-in event/collection type from `inbox` to `inbox` so the runtime names the thing being inserted/updated/deleted rather than the event that happened.

Update the built-in `inbox` schema to include:

- `mode`
- `status`
- `position`
- `processed_at`
- `cancelled_at`

Default old rows to `mode: 'immediate'` and `status: 'processed'` in projections.

### Timeline Projection

Split inbox handling into two projections:

- `processedInbox`: messages with `status: 'processed'`.
- `pendingInbox`: messages with `status: 'pending'`.

`buildTimelineEntries()` should render processed messages in the existing conversation timeline. Pending messages can be returned separately or included as explicit pending sections so the UI can render a queue affordance without confusing them with committed conversation history.

`timelineMessages()` and `timelineToMessages()` must only include processed messages.

### Wake Selection

Immediate processed messages should continue to wake the entity.

Queued pending inserts should not invoke the handler as user input. They may wake or notify the runtime's queue manager, but they should not be selected by `getTriggerMessageText()` until promoted to processed.

Promotion should be idempotent and claim exactly one pending message at a time.

### Queue Promotion

When the entity is idle or the current handler pass has completed, the runtime should inspect pending queued inbox messages ordered by `position` and promote the head message.

Promotion appends an update event for the existing inbox row:

```ts
{
  status: 'processed',
  processed_at: new Date().toISOString()
}
```

The promoted message then becomes the next message trigger.

Concurrency requirements:

- Only one worker/runtime instance may promote a given message.
- Promotion must be idempotent if retried.
- Reordering/editing should be rejected or conflict if the message was already processed by the time the mutation is processed.

### Steer Interruption

Steer requires cancellation support across the active generation loop.

Runtime responsibilities:

- Persist the steer message as processed.
- Signal the active wake/run to stop.
- Mark the current run as interrupted/cancelled, or add an interruption event that the timeline can render.
- Abort model streaming if supported.
- Abort or detach long-running tools where possible.
- Restart processing with the steer message as the current trigger.

This is the largest part of the feature and should be implemented after basic queued processing.

## Entity Type Configuration

This should be framework-level, not Horton-specific.

Entity definitions should be able to express default processing behavior:

```ts
messageProcessing: {
  defaultMode: 'immediate' | 'queued'
  allowSteer?: boolean
}
```

Potential later extension:

```ts
messageProcessing: {
  defaultMode: 'queued',
  byType: {
    prompt: { defaultMode: 'queued', allowSteer: true },
    control: { defaultMode: 'immediate', allowSteer: false },
  },
}
```

Horton should opt into:

```ts
messageProcessing: {
  defaultMode: 'queued',
  allowSteer: true,
}
```

Other agents can remain immediate by default.

## UI Changes

### Message Input

The composer should choose a mode based on entity configuration and state:

- If entity defaults to immediate, send immediate.
- If entity defaults to queued and the entity is busy, send queued.
- If entity defaults to queued and no generation is active, either send immediate or queued-then-promote immediately. Prefer the latter if we want one consistent path.

For Horton:

- Normal submit uses queued processing.
- If idle, the queued message is promoted immediately by the runtime.
- If busy, it appears in the shared pending queue.
- A "steer now" action promotes a pending queued message to steer.

### Pending Queue UI

Render pending inbox messages in `packages/agents-server-ui` as an expanded composer drawer above the chat input, similar to Cursor's queued follow-up UI.

The existing `MessageInput` already accepts a `drawer` slot for content above the composer. Extend that pattern so the chat view can render a pending-message drawer that shares the composer width and visually attaches to the input.

Suggested layout:

```text
⌄ 1 Queued
  ○ Update the docs section...
                         [edit] [steer] [delete]
```

Behavior:

- The drawer is hidden when there are no pending inbox messages.
- The drawer header shows the count, e.g. `1 Queued` or `3 Queued`.
- Each row shows a compact single-line preview of the pending message payload.
- Rows expose edit, steer, and delete controls.
- The steer control can use an upward arrow icon and should promote that pending message to `mode: 'steer'` / `status: 'processed'`.
- Delete issues the inbox delete/cancel action for pending messages.
- Reorder can be added after the base drawer exists, using drag handles or up/down controls.

Editing should reuse the main composer rather than opening an inline editor. Clicking edit:

- Copies the pending message text/payload back into the input.
- Puts the composer into an "editing queued message" state keyed by the inbox message key.
- Shows a clear label above or inside the composer, e.g. `Editing queued message`, with a cancel affordance.
- Changes the submit action from `POST /inbox` to `PATCH /inbox/{messageKey}`.
- On successful save, clears the editing state and empties the composer.
- Cancel editing restores normal compose mode without modifying the pending row.

The first-class Horton path can start with text payloads (`{ text }`). The component should still be structured around generic inbox rows so other agents can provide typed payload renderers later.

Required controls:

- Edit payload.
- Delete/cancel.
- Reorder.
- Steer now.

The UI should be driven by stream state, not local-only draft state, so multiple devices see the same queue.

### Timeline UI

Processed messages render as today.

Interrupted runs need a visible terminal state, for example:

```text
Interrupted by steer message
```

Pending messages should not look identical to processed chat bubbles. They are planned inputs, not transcript history.

## Backwards Compatibility

If we choose to preserve compatibility:

- Existing `/send` calls without `mode` remain immediate.
- Existing inbox rows without `mode` or `status` project as processed immediate.
- Existing agents continue consuming inbox rows as before.

If we choose a breaking cleanup:

- Rename the logical collection from `inbox` to `messages`.
- Make processing status mandatory.
- Require clients to choose or inherit a mode.
- Provide migration only for active development users.

Given the product is early, either route is possible. The lower-risk path is additive metadata with compatibility defaults.

## Open Questions

- Should pending messages live in the same `inbox` collection permanently, or should we eventually rename the concept to `messages` for clarity?
- Should normal queued promotion update the same row to processed, or append a separate processing event? Same-row updates are simpler for UI identity; separate events preserve stricter event sourcing.
- Should `/send` with `mode: 'queued'` always queue, even when idle, or should the server/runtime immediately deliver it when possible?
- Should cancelled pending messages remain visible in history, or disappear from default UI projections?
- What is the exact terminal run status for interrupted generations: `cancelled`, `interrupted`, or `failed` with a reason?
- How should long-running tools respond to steer: abort, finish in background, or detach and ignore output?

## Implementation Phases

### Phase 1: Processing Metadata

- Extend inbox schema with `mode`, `status`, `position`, and lifecycle timestamps.
- Add compatibility defaults for old rows.
- Update timeline/context projections to only expose processed messages to agents.
- Keep `/send` defaulting to immediate.

### Phase 2: Shared Queued Messages

- Add `/send { mode: 'queued' }`.
- Add pending message edit/reorder/cancel endpoints.
- Render pending messages in the UI from stream state.
- Add runtime promotion of one pending queued message at a time.
- Configure Horton to default user prompts to queued processing.

### Phase 3: Steer

- Add `/send { mode: 'steer' }`.
- Add "promote queued message to steer" endpoint/action.
- Add cancellation signal plumbing through runtime, model adapter, and tools.
- Add interrupted run timeline rendering.
- Restart the loop with the steer message as trigger.

### Phase 4: Framework Polish

- Add entity-level processing configuration.
- Support per-message-type processing policy.
- Document patterns for immediate, queued, and steer processing.
- Add conformance tests for queue ordering, edit conflicts, multi-device sync, and steer interruption.

## Test Plan

Runtime tests:

- Old inbox rows without processing metadata are treated as processed.
- `timelineMessages()` excludes pending and cancelled messages.
- Queued messages promote in position order.
- Editing a pending message changes the eventual processed payload.
- Reordering pending messages changes promotion order.
- Cancelling a pending message prevents processing.
- Concurrent promotion attempts deliver only one message once.

Server tests:

- `/send` without mode remains immediate.
- `/send` with queued creates pending inbox message.
- Pending edit/reorder/cancel endpoints reject processed messages.
- Steer endpoint transitions pending queued to processed steer.

UI tests:

- Pending messages render from stream state.
- Pending edits survive refresh and appear on another client.
- Reorder controls update shared order.
- Processed messages move from pending queue to transcript.
- Steer now removes the pending item and shows interruption state.

Horton tests:

- Default prompt processing queues while a run is active.
- Horton only sees processed messages in context.
- Multiple queued prompts are handled one at a time.
- Steer interrupts current generation and restarts with the selected message.
