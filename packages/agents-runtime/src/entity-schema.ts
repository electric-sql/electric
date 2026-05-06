import { createStateSchema } from '@durable-streams/state'
import { z } from 'zod'
import type {
  ChangeEvent,
  CollectionDefinition,
  StateSchema,
} from '@durable-streams/state'
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@standard-schema/spec'
import type { JsonValue } from './types'

// ============================================================================
// Passthrough Schema Utility
// ============================================================================

/**
 * Creates a passthrough Standard Schema validator that accepts any value of
 * type T without validation. Used for entity stream collections where the
 * shape is enforced by the write side (the server / agent adapter).
 */
export function passthrough<T>(): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1 as const,
      vendor: `electric-agents`,
      validate: (value: unknown): StandardSchemaV1.Result<T> => ({
        value: value as T,
      }),
    },
  }
}

// ============================================================================
// Standard Schemas
// ============================================================================

type BuiltInEntitySchema<T> = StandardSchemaV1<T> & StandardJSONSchemaV1<T>
type SequencedPersistedRow<T extends { key?: string | undefined }> = Omit<
  T,
  `key`
> & {
  key: string
  _seq?: number
}
type Schema<T> = z.ZodType<T>
type ChildEntityStatusValue = `spawning` | `running` | `idle` | `stopped`
type TagEntryValue = {
  key?: string
  value: string
}
type WakeChangeEntryValue = {
  collection: string
  kind: `insert` | `update` | `delete`
  key: string
}
type WakeFinishedChildEntryValue = {
  url: string
  type: string
  run_status: `completed` | `failed`
  response?: string
  error?: string
}
type WakeOtherChildEntryValue = {
  url: string
  type: string
  status: ChildEntityStatusValue
}
export type WakeConfigValue =
  | `runFinished`
  | {
      on: `runFinished`
      includeResponse?: boolean
    }
  | {
      on: `change`
      collections?: Array<string>
      ops?: Array<`insert` | `update` | `delete`>
      debounceMs?: number
      timeoutMs?: number
    }
type RunValue = {
  key?: string
  status: `started` | `completed` | `failed`
  finish_reason?: string
}
type StepValue = {
  key?: string
  run_id?: string
  step_number: number
  status: `started` | `completed`
  finish_reason?: string
  model_provider?: string
  model_id?: string
  duration_ms?: number
}
type TextValue = {
  key?: string
  run_id?: string
  status: `streaming` | `completed`
}
type TextDeltaValue = {
  key?: string
  text_id: string
  run_id: string
  delta: string
}
type ToolCallValue = {
  key?: string
  run_id?: string
  tool_call_id?: string
  tool_name: string
  status: `started` | `args_complete` | `executing` | `completed` | `failed`
  args?: unknown
  result?: unknown
  error?: string
  duration_ms?: number
}
type ReasoningValue = {
  key?: string
  status: `streaming` | `completed`
}
type ErrorEventValue = {
  key?: string
  error_code: string
  message: string
  run_id?: string
  step_id?: string
  tool_call_id?: string
}
type MessageReceivedValue = {
  key?: string
  from: string
  payload?: unknown
  timestamp: string
  message_type?: string
}
type WakeEntryValue = {
  key?: string
  timestamp: string
  source: string
  timeout: boolean
  changes: Array<WakeChangeEntryValue>
  finished_child?: WakeFinishedChildEntryValue
  other_children?: Array<WakeOtherChildEntryValue>
}
type EntityCreatedValue = {
  key?: string
  entity_type: string
  timestamp: string
  args: Record<string, JsonValue>
  parent_url?: string
}
type EntityStoppedValue = {
  key?: string
  timestamp: string
  reason?: string
}
type ChildStatusEntryValue = {
  key?: string
  entity_url: string
  entity_type: string
  status: ChildEntityStatusValue
}
type ManifestChildEntryValue = {
  key?: string
  kind: `child`
  id: string
  entity_type: string
  entity_url: string
  wake?: WakeConfigValue
  observed: boolean
}
type ManifestSourceEntryValue = {
  key?: string
  kind: `source`
  sourceType: string
  sourceRef: string
  wake?: WakeConfigValue
  config: Record<string, unknown>
}
type ManifestSharedStateEntryValue = {
  key?: string
  kind: `shared-state`
  id: string
  mode: `create` | `connect`
  collections: Record<
    string,
    {
      type: string
      primaryKey: string
    }
  >
  wake?: WakeConfigValue
}
type ManifestEffectEntryValue = {
  key?: string
  kind: `effect`
  id: string
  function_ref: string
  config: unknown
}
type ContextEntryAttrsValue = Record<string, string | number | boolean>
type ManifestContextEntryValue = {
  key?: string
  kind: `context`
  id: string
  name: string
  attrs: ContextEntryAttrsValue
  content: string
  insertedAt: number
}
type FutureSendScheduleStatus = `pending` | `sent` | `failed`
type ManifestCronScheduleEntryValue = {
  key?: string
  kind: `schedule`
  id: string
  scheduleType: `cron`
  expression: string
  timezone?: string
  payload?: unknown
  wake?: WakeConfigValue
}
type ManifestFutureSendScheduleEntryValue = {
  key?: string
  kind: `schedule`
  id: string
  scheduleType: `future_send`
  fireAt: string
  targetUrl: string
  payload: unknown
  producerId: string
  from?: string
  messageType?: string
  status?: FutureSendScheduleStatus
  sentAt?: string
  failedAt?: string
  lastError?: string
}
type ReplayWatermarkValue = {
  key?: string
  source_id: string
  offset: string
  updated_at: string
}
type ContextInsertedValue = {
  key?: string
  id: string
  name: string
  attrs: ContextEntryAttrsValue
  content: string
  timestamp: string
}
type ContextRemovedValue = {
  key?: string
  id: string
  name: string
  timestamp: string
}

function createJsonObjectSchema(): Schema<Record<string, JsonValue>> {
  return z.object({}).catchall(z.unknown()) as unknown as Schema<
    Record<string, JsonValue>
  >
}

function createChildEntityStatusSchema(): Schema<ChildEntityStatusValue> {
  return z.enum([`spawning`, `running`, `idle`, `stopped`])
}

function createWakeChangeSchema(): Schema<WakeChangeEntryValue> {
  return z.object({
    collection: z.string(),
    kind: z.enum([`insert`, `update`, `delete`]),
    key: z.string(),
  })
}

function createWakeFinishedChildSchema(): Schema<WakeFinishedChildEntryValue> {
  return z.object({
    url: z.string(),
    type: z.string(),
    run_status: z.enum([`completed`, `failed`]),
    response: z.string().optional(),
    error: z.string().optional(),
  })
}

function createWakeOtherChildSchema(): Schema<WakeOtherChildEntryValue> {
  return z.object({
    url: z.string(),
    type: z.string(),
    status: createChildEntityStatusSchema(),
  })
}

function createWakeConfigSchema(): Schema<WakeConfigValue> {
  return z.union([
    z.literal(`runFinished`),
    z.object({
      on: z.literal(`runFinished`),
      includeResponse: z.boolean().optional(),
    }),
    z.object({
      on: z.literal(`change`),
      collections: z.array(z.string()).optional(),
      ops: z.array(z.enum([`insert`, `update`, `delete`])).optional(),
      debounceMs: z.number().optional(),
      timeoutMs: z.number().optional(),
    }),
  ])
}

function createRunSchema(): Schema<RunValue> {
  return z.object({
    key: z.string().optional(),
    status: z.enum([`started`, `completed`, `failed`]),
    finish_reason: z.string().optional(),
  })
}

function createStepSchema(): Schema<StepValue> {
  return z.object({
    key: z.string().optional(),
    run_id: z.string().optional(),
    step_number: z.number().int(),
    status: z.enum([`started`, `completed`]),
    finish_reason: z.string().optional(),
    model_provider: z.string().optional(),
    model_id: z.string().optional(),
    duration_ms: z.number().int().optional(),
  })
}

function createTextSchema(): Schema<TextValue> {
  return z.object({
    key: z.string().optional(),
    run_id: z.string().optional(),
    status: z.enum([`streaming`, `completed`]),
  })
}

function createTextDeltaSchema(): Schema<TextDeltaValue> {
  return z.object({
    key: z.string().optional(),
    text_id: z.string(),
    run_id: z.string(),
    delta: z.string(),
  })
}

function createToolCallSchema(): Schema<ToolCallValue> {
  return z.object({
    key: z.string().optional(),
    run_id: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_name: z.string(),
    status: z.enum([
      `started`,
      `args_complete`,
      `executing`,
      `completed`,
      `failed`,
    ]),
    args: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    duration_ms: z.number().int().optional(),
  })
}

function createReasoningSchema(): Schema<ReasoningValue> {
  return z.object({
    key: z.string().optional(),
    status: z.enum([`streaming`, `completed`]),
  })
}

function createErrorEventSchema(): Schema<ErrorEventValue> {
  return z.object({
    key: z.string().optional(),
    error_code: z.string(),
    message: z.string(),
    run_id: z.string().optional(),
    step_id: z.string().optional(),
    tool_call_id: z.string().optional(),
  })
}

function createMessageReceivedSchema(): Schema<MessageReceivedValue> {
  return z.object({
    key: z.string().optional(),
    from: z.string(),
    payload: z.unknown().optional(),
    timestamp: z.string(),
    message_type: z.string().optional(),
  })
}

function createWakeSchema(): Schema<WakeEntryValue> {
  return z.object({
    key: z.string().optional(),
    timestamp: z.string(),
    source: z.string(),
    timeout: z.boolean(),
    changes: z.array(createWakeChangeSchema()),
    finished_child: createWakeFinishedChildSchema().optional(),
    other_children: z.array(createWakeOtherChildSchema()).optional(),
  })
}

function createEntityCreatedSchema(): Schema<EntityCreatedValue> {
  return z.object({
    key: z.string().optional(),
    entity_type: z.string(),
    timestamp: z.string(),
    args: createJsonObjectSchema(),
    parent_url: z.string().optional(),
  })
}

function createEntityStoppedSchema(): Schema<EntityStoppedValue> {
  return z.object({
    key: z.string().optional(),
    timestamp: z.string(),
    reason: z.string().optional(),
  })
}

function createChildStatusSchema(): Schema<ChildStatusEntryValue> {
  return z.object({
    key: z.string().optional(),
    entity_url: z.string(),
    entity_type: z.string(),
    status: createChildEntityStatusSchema(),
  })
}

function createTagEntrySchema(): Schema<TagEntryValue> {
  return z.object({
    key: z.string().optional(),
    value: z.string(),
  })
}
function createContextInsertedSchema(): Schema<ContextInsertedValue> {
  return z.object({
    key: z.string().optional(),
    id: z.string(),
    name: z.string(),
    attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    content: z.string(),
    timestamp: z.string(),
  })
}

function createContextRemovedSchema(): Schema<ContextRemovedValue> {
  return z.object({
    key: z.string().optional(),
    id: z.string(),
    name: z.string(),
    timestamp: z.string(),
  })
}
function createManifestSchema(): Schema<
  | ManifestChildEntryValue
  | ManifestSourceEntryValue
  | ManifestSharedStateEntryValue
  | ManifestEffectEntryValue
  | ManifestContextEntryValue
  | ManifestCronScheduleEntryValue
  | ManifestFutureSendScheduleEntryValue
> {
  return z.union([
    z.object({
      key: z.string().optional(),
      kind: z.literal(`child`),
      id: z.string(),
      entity_type: z.string(),
      entity_url: z.string(),
      wake: createWakeConfigSchema().optional(),
      observed: z.boolean().default(false),
    }),
    z.object({
      key: z.string().optional(),
      kind: z.literal(`source`),
      sourceType: z.string(),
      sourceRef: z.string(),
      wake: createWakeConfigSchema().optional(),
      config: z.record(z.string(), z.unknown()),
    }),
    z.object({
      key: z.string().optional(),
      kind: z.literal(`shared-state`),
      id: z.string(),
      mode: z.enum([`create`, `connect`]),
      collections: z.record(
        z.string(),
        z.object({
          type: z.string(),
          primaryKey: z.string(),
        })
      ),
      wake: createWakeConfigSchema().optional(),
    }),
    z.object({
      key: z.string().optional(),
      kind: z.literal(`effect`),
      id: z.string(),
      function_ref: z.string(),
      config: z.unknown(),
    }),
    z.object({
      key: z.string().optional(),
      kind: z.literal(`context`),
      id: z.string(),
      name: z.string(),
      attrs: z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean()])
      ),
      content: z.string(),
      insertedAt: z.number().int(),
    }),
    z.object({
      key: z.string().optional(),
      kind: z.literal(`schedule`),
      id: z.string(),
      scheduleType: z.literal(`cron`),
      expression: z.string(),
      timezone: z.string().optional(),
      payload: z.unknown().optional(),
      wake: createWakeConfigSchema().optional(),
    }),
    z.object({
      key: z.string().optional(),
      kind: z.literal(`schedule`),
      id: z.string(),
      scheduleType: z.literal(`future_send`),
      fireAt: z.string(),
      targetUrl: z.string(),
      payload: z.unknown(),
      producerId: z.string(),
      from: z.string().optional(),
      messageType: z.string().optional(),
      status: z.enum([`pending`, `sent`, `failed`]).default(`pending`),
      sentAt: z.string().optional(),
      failedAt: z.string().optional(),
      lastError: z.string().optional(),
    }),
  ]) as unknown as Schema<
    | ManifestChildEntryValue
    | ManifestSourceEntryValue
    | ManifestSharedStateEntryValue
    | ManifestEffectEntryValue
    | ManifestContextEntryValue
    | ManifestCronScheduleEntryValue
    | ManifestFutureSendScheduleEntryValue
  >
}

function createReplayWatermarkSchema(): Schema<ReplayWatermarkValue> {
  return z.object({
    key: z.string().optional(),
    source_id: z.string(),
    offset: z.string(),
    updated_at: z.string(),
  })
}

export type ChildEntityStatus = ChildEntityStatusValue
export type WakeChangeEntry = WakeChangeEntryValue
export type WakeFinishedChildEntry = WakeFinishedChildEntryValue
export type WakeOtherChildEntry = WakeOtherChildEntryValue
export type Run = SequencedPersistedRow<RunValue>
export type Step = SequencedPersistedRow<StepValue>
export type Text = SequencedPersistedRow<TextValue>
export type TextDelta = SequencedPersistedRow<TextDeltaValue>
export type ToolCall = SequencedPersistedRow<ToolCallValue>
export type Reasoning = SequencedPersistedRow<ReasoningValue>
export type ErrorEvent = SequencedPersistedRow<ErrorEventValue>
export type MessageReceived = SequencedPersistedRow<MessageReceivedValue>
export type WakeEntry = SequencedPersistedRow<WakeEntryValue>
export type EntityCreated = SequencedPersistedRow<EntityCreatedValue>
export type EntityStopped = SequencedPersistedRow<EntityStoppedValue>
export type ChildStatusEntry = SequencedPersistedRow<ChildStatusEntryValue>
export type TagEntry = SequencedPersistedRow<TagEntryValue>
export type ContextInserted = SequencedPersistedRow<ContextInsertedValue>
export type ContextRemoved = SequencedPersistedRow<ContextRemovedValue>
export type ContextEntryAttrs = ContextEntryAttrsValue
export type ManifestChildEntry = SequencedPersistedRow<ManifestChildEntryValue>
export type ManifestSourceEntry =
  SequencedPersistedRow<ManifestSourceEntryValue>
export type ManifestSharedStateEntry =
  SequencedPersistedRow<ManifestSharedStateEntryValue>
export type ManifestEffectEntry =
  SequencedPersistedRow<ManifestEffectEntryValue>
export type ManifestContextEntry =
  SequencedPersistedRow<ManifestContextEntryValue>
export type ManifestCronScheduleEntry =
  SequencedPersistedRow<ManifestCronScheduleEntryValue>
export type ManifestFutureSendScheduleEntry =
  SequencedPersistedRow<ManifestFutureSendScheduleEntryValue>
type ManifestUnion =
  | ManifestChildEntry
  | ManifestSourceEntry
  | ManifestSharedStateEntry
  | ManifestEffectEntry
  | ManifestContextEntry
  | ManifestCronScheduleEntry
  | ManifestFutureSendScheduleEntry
export type Manifest = ManifestUnion & {
  id?: string
  entity_url?: string
  entity_type?: string
  wake?: WakeConfigValue
  observed?: boolean
  sourceType?: string
  sourceRef?: string
  config?: unknown
  name?: string
  attrs?: ContextEntryAttrs
  content?: string
  insertedAt?: number
  scheduleType?: `cron` | `future_send`
  expression?: string
  payload?: unknown
  fireAt?: string
  targetUrl?: string
  producerId?: string
  from?: string
  messageType?: string
  status?: FutureSendScheduleStatus
  sentAt?: string
  failedAt?: string
  lastError?: string
}
export type ReplayWatermark = SequencedPersistedRow<ReplayWatermarkValue>

// ============================================================================
// Collection Names Constant
// ============================================================================

export const ENTITY_COLLECTIONS = {
  runs: `runs`,
  steps: `steps`,
  texts: `texts`,
  textDeltas: `textDeltas`,
  toolCalls: `toolCalls`,
  reasoning: `reasoning`,
  errors: `errors`,
  inbox: `inbox`,
  wakes: `wakes`,
  entityCreated: `entityCreated`,
  entityStopped: `entityStopped`,
  childStatus: `childStatus`,
  tags: `tags`,
  manifests: `manifests`,
  contextInserted: `contextInserted`,
  contextRemoved: `contextRemoved`,
  replayWatermarks: `replayWatermarks`,
} as const

export const BUILT_IN_EVENT_SCHEMAS = {
  run: createRunSchema() as unknown as BuiltInEntitySchema<Run>,
  step: createStepSchema() as unknown as BuiltInEntitySchema<Step>,
  text: createTextSchema() as unknown as BuiltInEntitySchema<Text>,
  text_delta:
    createTextDeltaSchema() as unknown as BuiltInEntitySchema<TextDelta>,
  tool_call: createToolCallSchema() as unknown as BuiltInEntitySchema<ToolCall>,
  reasoning:
    createReasoningSchema() as unknown as BuiltInEntitySchema<Reasoning>,
  error: createErrorEventSchema() as unknown as BuiltInEntitySchema<ErrorEvent>,
  message_received:
    createMessageReceivedSchema() as unknown as BuiltInEntitySchema<MessageReceived>,
  wake: createWakeSchema() as unknown as BuiltInEntitySchema<WakeEntry>,
  entity_created:
    createEntityCreatedSchema() as unknown as BuiltInEntitySchema<EntityCreated>,
  entity_stopped:
    createEntityStoppedSchema() as unknown as BuiltInEntitySchema<EntityStopped>,
  child_status:
    createChildStatusSchema() as unknown as BuiltInEntitySchema<ChildStatusEntry>,
  tags: createTagEntrySchema() as unknown as BuiltInEntitySchema<TagEntry>,
  context_inserted:
    createContextInsertedSchema() as unknown as BuiltInEntitySchema<ContextInserted>,
  context_removed:
    createContextRemovedSchema() as unknown as BuiltInEntitySchema<ContextRemoved>,
  manifest: createManifestSchema() as unknown as BuiltInEntitySchema<Manifest>,
  replay_watermark:
    createReplayWatermarkSchema() as unknown as BuiltInEntitySchema<ReplayWatermark>,
} as const

// ============================================================================
// Schema Definition
// ============================================================================

/** Typed map of all entity stream collection definitions. */
type EntityCollectionsDefinition = {
  runs: CollectionDefinition<Run>
  steps: CollectionDefinition<Step>
  texts: CollectionDefinition<Text>
  textDeltas: CollectionDefinition<TextDelta>
  toolCalls: CollectionDefinition<ToolCall>
  reasoning: CollectionDefinition<Reasoning>
  errors: CollectionDefinition<ErrorEvent>
  inbox: CollectionDefinition<MessageReceived>
  wakes: CollectionDefinition<WakeEntry>
  entityCreated: CollectionDefinition<EntityCreated>
  entityStopped: CollectionDefinition<EntityStopped>
  childStatus: CollectionDefinition<ChildStatusEntry>
  tags: CollectionDefinition<TagEntry>
  manifests: CollectionDefinition<Manifest>
  contextInserted: CollectionDefinition<ContextInserted>
  contextRemoved: CollectionDefinition<ContextRemoved>
  replayWatermarks: CollectionDefinition<ReplayWatermark>
  [key: string]: CollectionDefinition<unknown>
}

/**
 * Built-in collection definitions shared by all entities. These are the
 * agent-lifecycle and infrastructure collections (runs, steps, texts, etc.).
 * Custom entity state collections are merged with these at StreamDB creation time.
 */
export const builtInCollections: EntityCollectionsDefinition = {
  runs: {
    schema: BUILT_IN_EVENT_SCHEMAS.run as StandardSchemaV1<Run>,
    type: `run`,
    primaryKey: `key`,
  },
  steps: {
    schema: BUILT_IN_EVENT_SCHEMAS.step as StandardSchemaV1<Step>,
    type: `step`,
    primaryKey: `key`,
  },
  texts: {
    schema: BUILT_IN_EVENT_SCHEMAS.text as StandardSchemaV1<Text>,
    type: `text`,
    primaryKey: `key`,
  },
  textDeltas: {
    schema: BUILT_IN_EVENT_SCHEMAS.text_delta as StandardSchemaV1<TextDelta>,
    type: `text_delta`,
    primaryKey: `key`,
  },
  toolCalls: {
    schema: BUILT_IN_EVENT_SCHEMAS.tool_call as StandardSchemaV1<ToolCall>,
    type: `tool_call`,
    primaryKey: `key`,
  },
  reasoning: {
    schema: BUILT_IN_EVENT_SCHEMAS.reasoning as StandardSchemaV1<Reasoning>,
    type: `reasoning`,
    primaryKey: `key`,
  },
  errors: {
    schema: BUILT_IN_EVENT_SCHEMAS.error as StandardSchemaV1<ErrorEvent>,
    type: `error`,
    primaryKey: `key`,
  },
  inbox: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.message_received as StandardSchemaV1<MessageReceived>,
    type: `message_received`,
    primaryKey: `key`,
  },
  wakes: {
    schema: BUILT_IN_EVENT_SCHEMAS.wake as StandardSchemaV1<WakeEntry>,
    type: `wake`,
    primaryKey: `key`,
  },
  entityCreated: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.entity_created as StandardSchemaV1<EntityCreated>,
    type: `entity_created`,
    primaryKey: `key`,
  },
  entityStopped: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.entity_stopped as StandardSchemaV1<EntityStopped>,
    type: `entity_stopped`,
    primaryKey: `key`,
  },
  childStatus: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.child_status as StandardSchemaV1<ChildStatusEntry>,
    type: `child_status`,
    primaryKey: `key`,
  },
  tags: {
    schema: BUILT_IN_EVENT_SCHEMAS.tags as StandardSchemaV1<TagEntry>,
    type: `tags`,
    primaryKey: `key`,
  },
  manifests: {
    schema: BUILT_IN_EVENT_SCHEMAS.manifest as StandardSchemaV1<Manifest>,
    type: `manifest`,
    primaryKey: `key`,
  },
  contextInserted: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.context_inserted as StandardSchemaV1<ContextInserted>,
    type: `context_inserted`,
    primaryKey: `key`,
  },
  contextRemoved: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.context_removed as StandardSchemaV1<ContextRemoved>,
    type: `context_removed`,
    primaryKey: `key`,
  },
  replayWatermarks: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.replay_watermark as StandardSchemaV1<ReplayWatermark>,
    type: `replay_watermark`,
    primaryKey: `key`,
  },
}

/**
 * The entity stream state schema. All Electric Agents entity event types map to typed
 * TanStack DB collections via real Standard Schema validators backed by Zod.
 */
export const entityStateSchema: StateSchema<EntityCollectionsDefinition> =
  createStateSchema(builtInCollections)

// ============================================================================
// Management Event Guard
// ============================================================================

/** Event types that are management/bookkeeping rather than agent content. */
const MANAGEMENT_TYPES = new Set<string>([
  `entity_created`,
  `manifest`,
  `replay_watermark`,
  `ack`,
])

/**
 * Returns true if the change event is a management event (manifest or ack),
 * rather than an agent content event (run, step, text, tool call, etc.).
 */
export function isManagementEvent(event: ChangeEvent): boolean {
  return MANAGEMENT_TYPES.has(event.type)
}
