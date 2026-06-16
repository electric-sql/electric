---
title: Built-in collections
titleTemplate: "... - Electric Agents"
description: >-
  Reference for the 20 runtime-managed collections: runs, steps, texts, toolCalls, inbox, signals, errors, slashCommands, and more.
outline: [2, 3]
---

# Built-in collections

Every entity automatically has these 20 collections, populated by the runtime as the agent operates. Custom state collections defined in `EntityDefinition.state` are merged with these at creation time.

**Source:** `@electric-ax/agents-runtime` -- `entity-schema.ts`

## Collection summary

| Collection         | Event Type         | Interface          | Description                  |
| ------------------ | ------------------ | ------------------ | ---------------------------- |
| `runs`             | `run`              | `Run`              | Agent run lifecycle          |
| `steps`            | `step`             | `Step`             | LLM call step lifecycle      |
| `texts`            | `text`             | `Text`             | Text message lifecycle       |
| `textDeltas`       | `text_delta`       | `TextDelta`        | Incremental text content     |
| `toolCalls`        | `tool_call`        | `ToolCall`         | Tool call lifecycle          |
| `reasoning`        | `reasoning`        | `Reasoning`        | Reasoning block lifecycle    |
| `reasoningDeltas`  | `reasoning_delta`  | `ReasoningDelta`   | Incremental reasoning content |
| `errors`           | `error`            | `ErrorEvent`       | Diagnostic errors            |
| `inbox`            | `inbox` | `MessageReceived`  | Inbound messages             |
| `wakes`            | `wake`             | `WakeEntry`        | Wake delivery records        |
| `entityCreated`    | `entity_created`   | `EntityCreated`    | Entity bootstrap metadata    |
| `entityStopped`    | `entity_stopped`   | `EntityStopped`    | Entity shutdown signal       |
| `signals`          | `signal`           | `Signal`           | Lifecycle signal records     |
| `childStatus`      | `child_status`     | `ChildStatusEntry` | Child/observed entity status |
| `tags`             | `tags`             | `TagEntry`         | Entity tags                  |
| `slashCommands`    | `slash_command`    | `SlashCommandEntry` | Composer slash commands      |
| `manifests`        | `manifest`         | `Manifest`         | Durable resource manifests   |
| `contextInserted`  | `context_inserted` | `ContextInserted`  | Context additions            |
| `contextRemoved`   | `context_removed`  | `ContextRemoved`   | Context removals             |
| `replayWatermarks` | `replay_watermark` | `ReplayWatermark`  | Replay progress tracking     |

All collections use `key` as the primary key. Runtime-managed timeline rows may also include `_timeline_order` for stable timeline sorting.

## Type definitions

### Run

```ts
interface Run {
  key: string
  status: "started" | "completed" | "failed"
  finish_reason?: string
}
```

### Step

```ts
interface Step {
  key: string
  run_id?: string
  step_number: number
  status: "started" | "completed"
  finish_reason?: string
  model_provider?: string
  model_id?: string
  duration_ms?: number
  input_tokens?: number
  output_tokens?: number
}
```

### Text

```ts
interface Text {
  key: string
  run_id?: string
  status: "streaming" | "completed"
}
```

### TextDelta

```ts
interface TextDelta {
  key: string
  text_id: string
  run_id: string
  delta: string
}
```

### ToolCall

```ts
interface ToolCall {
  key: string
  run_id?: string
  tool_call_id?: string
  tool_name: string
  status: "started" | "args_complete" | "executing" | "completed" | "failed"
  args?: unknown
  result?: unknown
  error?: string
  duration_ms?: number
}
```

### Reasoning

```ts
interface Reasoning {
  key: string
  run_id?: string
  status: "streaming" | "completed"
  encrypted?: string
  summary_title?: string
}
```

### ReasoningDelta

```ts
interface ReasoningDelta {
  key: string
  reasoning_id: string
  run_id: string
  delta: string
}
```

### ErrorEvent

```ts
interface ErrorEvent {
  key: string
  error_code: string
  message: string
  run_id?: string
  step_id?: string
  tool_call_id?: string
}
```

### MessageReceived

```ts
interface MessageReceived {
  key: string
  from?: string
  payload?: unknown
  timestamp?: string
  message_type?: string
  mode?: "immediate" | "queued" | "paused" | "steer"
  status?: "pending" | "processed" | "cancelled"
  position?: string
  processed_at?: string
  cancelled_at?: string
}
```

### WakeEntry

```ts
interface WakeEntry {
  key: string
  timestamp: string
  source: string
  timeout: boolean
  changes: WakeChangeEntry[]
  finished_child?: WakeFinishedChildEntry
  other_children?: WakeOtherChildEntry[]
}

interface WakeChangeEntry {
  collection: string
  kind: "insert" | "update" | "delete"
  key: string
  from?: string
  payload?: unknown
  timestamp?: string
  message_type?: string
}

interface WakeFinishedChildEntry {
  url: string
  type: string
  run_status: "completed" | "failed"
  response?: string // concatenated text deltas from the finished run
  error?: string // error message(s) if run_status is "failed"
}

interface WakeOtherChildEntry {
  url: string
  type: string
  status: "spawning" | "running" | "idle" | "paused" | "stopping" | "stopped" | "killed"
}
```

### EntityCreated

```ts
interface EntityCreated {
  key: string
  entity_type: string
  timestamp: string
  args: Record<string, JsonValue>
  parent_url?: string
}
```

### EntityStopped

```ts
interface EntityStopped {
  key: string
  timestamp: string
  reason?: string
}
```

### Signal

```ts
interface Signal {
  key: string
  signal: "SIGINT" | "SIGHUP" | "SIGTERM" | "SIGKILL" | "SIGSTOP" | "SIGCONT" | "SIGUSR"
  status: "unhandled" | "handled"
  sender?: string
  reason?: string
  payload?: unknown
  timestamp: string
  handled_at?: string
  handled_by?: string
  outcome?: "transitioned" | "ignored" | "invalid_for_state" | "delivered" | "aborted" | "shutdown_requested" | "failed"
  previous_state?: ChildStatusEntry["status"]
  new_state?: ChildStatusEntry["status"]
}
```

### ChildStatusEntry

```ts
interface ChildStatusEntry {
  key: string
  entity_url: string
  entity_type: string
  status: "spawning" | "running" | "idle" | "paused" | "stopping" | "stopped" | "killed"
}
```

### TagEntry

```ts
interface TagEntry {
  key: string
  value: string
}
```

### SlashCommandEntry

```ts
interface SlashCommandEntry {
  key: string
  name: string
  description?: string
  arguments?: Array<{
    name: string
    type: "string" | "number" | "boolean"
    required?: boolean
    description?: string
  }>
  source: "static" | "dynamic"
  owner?: string
  version?: string
  updated_at: string
  dynamic_layers?: Array<{
    name: string
    description?: string
    arguments?: Array<{
      name: string
      type: "string" | "number" | "boolean"
      required?: boolean
      description?: string
    }>
    owner?: string
    version?: string
    updated_at: string
  }>
}
```

### ContextInserted

```ts
interface ContextInserted {
  key: string
  id: string
  name: string
  attrs: Record<string, string | number | boolean>
  content: string
  timestamp: string
}
```

### ContextRemoved

```ts
interface ContextRemoved {
  key: string
  id: string
  name: string
  timestamp: string
}
```

### Manifest

Discriminated union by `kind`:

```ts
type Manifest =
  | ManifestChildEntry
  | ManifestSourceEntry
  | ManifestSharedStateEntry
  | ManifestEffectEntry
  | ManifestAttachmentEntry
  | ManifestContextEntry
  | ManifestCronScheduleEntry
  | ManifestFutureSendScheduleEntry
  | ManifestGoalEntry

interface ManifestChildEntry {
  key: string
  kind: "child"
  id: string
  entity_type: string
  entity_url: string
  wake?: WakeConfig
  observed: boolean
}

interface ManifestSourceEntry {
  key: string
  kind: "source"
  sourceType: "entity" | "cron" | "entities" | "db" | "webhook" | "pgSync" | string
  sourceRef: string
  wake?: WakeConfig
  config: Record<string, unknown>
}

interface ManifestSharedStateEntry {
  key: string
  kind: "shared-state"
  id: string
  mode: "create" | "connect"
  collections: Record<string, { type: string; primaryKey: string }>
  wake?: WakeConfig
}

interface ManifestEffectEntry {
  key: string
  kind: "effect"
  id: string
  function_ref: string
  config: unknown
}

interface ManifestAttachmentEntry {
  key: string
  kind: "attachment"
  id: string
  streamPath: string
  status: "pending" | "complete" | "failed"
  subject: {
    type: "inbox" | "run" | "text" | "tool_call" | "context"
    key: string
  }
  role: "input" | "output"
  mimeType: string
  filename?: string
  byteLength?: number
  sha256?: string
  createdAt: string
  createdBy?: string
  error?: string
  meta?: Record<string, JsonValue>
}

interface ManifestContextEntry {
  key: string
  kind: "context"
  id: string
  name: string
  attrs: Record<string, string | number | boolean>
  content: string
  insertedAt: number
}

interface ManifestCronScheduleEntry {
  key: string
  kind: "schedule"
  id: string
  scheduleType: "cron"
  expression: string
  timezone?: string
  payload?: unknown
  wake?: WakeConfig
}

interface ManifestFutureSendScheduleEntry {
  key: string
  kind: "schedule"
  id: string
  scheduleType: "future_send"
  fireAt: string
  targetUrl: string
  payload: unknown
  producerId: string
  from?: string
  messageType?: string
  status?: "pending" | "sent" | "failed"
  sentAt?: string
  failedAt?: string
  lastError?: string
}

interface ManifestGoalEntry {
  key: string
  kind: "goal"
  id: string
  objective: string
  status: "active" | "complete" | "budget_limited"
  tokenBudget: number | null
  tokensUsed: number
  summary?: string
  createdAt: string
  updatedAt: string
}
```

`pgSync()` observations are stored as `sourceType: "pgSync"` manifest rows and project matching Postgres shape changes into the observed source's `changes` collection.

### ReplayWatermark

```ts
interface ReplayWatermark {
  key: string
  source_id: string
  offset: string
  updated_at: string
}
```
