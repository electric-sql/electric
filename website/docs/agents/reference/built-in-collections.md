---
title: Built-in collections
titleTemplate: "... - Electric Agents"
description: >-
  Reference for the 14 runtime-managed collections: runs, steps, texts, toolCalls, inbox, errors, and more.
outline: [2, 3]
---

# Built-in collections

Every entity automatically has these 14 collections, populated by the runtime as the agent operates. Custom state collections defined in `EntityDefinition.state` are merged with these at creation time.

**Source:** `@durable-streams/darix-runtime` -- `entity-schema.ts`

## Collection summary

| Collection         | Event Type         | Interface          | Description                  |
| ------------------ | ------------------ | ------------------ | ---------------------------- |
| `runs`             | `run`              | `Run`              | Agent run lifecycle          |
| `steps`            | `step`             | `Step`             | LLM call step lifecycle      |
| `texts`            | `text`             | `Text`             | Text message lifecycle       |
| `textDeltas`       | `text_delta`       | `TextDelta`        | Incremental text content     |
| `toolCalls`        | `tool_call`        | `ToolCall`         | Tool call lifecycle          |
| `reasoning`        | `reasoning`        | `Reasoning`        | Reasoning block lifecycle    |
| `errors`           | `error`            | `ErrorEvent`       | Diagnostic errors            |
| `inbox`            | `message_received` | `MessageReceived`  | Inbound messages             |
| `wakes`            | `wake`             | `WakeEntry`        | Wake delivery records        |
| `entityCreated`    | `entity_created`   | `EntityCreated`    | Entity bootstrap metadata    |
| `entityStopped`    | `entity_stopped`   | `EntityStopped`    | Entity shutdown signal       |
| `childStatus`      | `child_status`     | `ChildStatusEntry` | Child/observed entity status |
| `manifests`        | `manifest`         | `Manifest`         | Durable resource manifests   |
| `replayWatermarks` | `replay_watermark` | `ReplayWatermark`  | Replay progress tracking     |

All collections use `key` as the primary key.

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
  status: "streaming" | "completed"
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
  from: string
  payload?: unknown
  timestamp: string
  message_type?: string
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
  status: "spawning" | "running" | "idle" | "stopped"
}
```

### EntityCreated

```ts
interface EntityCreated {
  key: string
  entity_type: string
  timestamp: string
  args: JsonValue
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

### ChildStatusEntry

```ts
interface ChildStatusEntry {
  key: string
  entity_url: string
  entity_type: string
  status: "spawning" | "running" | "idle" | "stopped"
}
```

### Manifest

Discriminated union by `kind`:

```ts
type Manifest =
  | ManifestChildEntry
  | ManifestEffectEntry
  | ManifestObserveEntry
  | ManifestSharedStateEntry

interface ManifestChildEntry {
  key: string
  kind: "child"
  id: string
  entity_type: string
  entity_url: string
  wake?: Wake
  observed: boolean
}

interface ManifestObserveEntry {
  key: string
  kind: "observe"
  id: string
  entity_url: string
  wake?: Wake
}

interface ManifestSharedStateEntry {
  key: string
  kind: "shared-state"
  id: string
  mode: "create" | "connect"
  collections: Record<string, { type: string; primaryKey: string }>
  wake?: Wake
}

interface ManifestEffectEntry {
  key: string
  kind: "effect"
  id: string
  function_ref: string
  config: JsonValue
}
```

### ReplayWatermark

```ts
interface ReplayWatermark {
  key: string
  source_id: string
  offset: string
  updated_at: string
}
```
