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
import type { SlashCommandRow } from './composer-input'
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
  _timeline_order?: string
}
type Schema<T> = z.ZodType<T>
type ChildEntityStatusValue =
  | `spawning`
  | `running`
  | `idle`
  | `paused`
  | `stopping`
  | `stopped`
  | `killed`
export type EntitySignal =
  | `SIGINT`
  | `SIGHUP`
  | `SIGTERM`
  | `SIGKILL`
  | `SIGSTOP`
  | `SIGCONT`
  | `SIGUSR`
type SignalHandlingStatus = `unhandled` | `handled`
type SignalOutcome =
  | `transitioned`
  | `ignored`
  | `invalid_for_state`
  | `delivered`
  | `aborted`
  | `shutdown_requested`
  | `failed`
type TagEntryValue = {
  key?: string
  value: string
}
type SlashCommandValue = {
  key?: string
  name: string
  description?: string
  arguments?: Array<{
    name: string
    type: `string` | `number` | `boolean`
    required?: boolean
    description?: string
  }>
  source: `static` | `dynamic`
  owner?: string
  version?: string
  updated_at: string
  dynamic_layers?: Array<{
    name: string
    description?: string
    arguments?: Array<{
      name: string
      type: `string` | `number` | `boolean`
      required?: boolean
      description?: string
    }>
    owner?: string
    version?: string
    updated_at: string
  }>
}
type WakeChangeEntryValue = {
  collection: string
  kind: `insert` | `update` | `delete`
  key: string
  value?: unknown
  oldValue?: unknown
  from?: string
  from_principal?: string
  from_agent?: string
  payload?: unknown
  timestamp?: string
  message_type?: string
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
  // Token usage for this step as reported by the provider's
  // end-of-message `usage` payload. Populated on `onStepEnd` when the
  // adapter has the data — older events without these fields stay
  // valid (both optional), so this is a strictly additive change.
  // `input_tokens` is the *uncached* input side (fresh tokens plus
  // cache writes; cache reads excluded) — the cache-inclusive total
  // would re-count the whole conversation on every step.
  input_tokens?: number
  output_tokens?: number
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
  run_id?: string
  status: `streaming` | `completed`
  // Anthropic emits "redacted thinking" content blocks the client can't
  // display but MUST round-trip back to the model on the next turn or
  // the conversation errors. Persist verbatim, render nothing.
  encrypted?: string
  // OpenAI's Responses API surfaces reasoning with a bolded title line
  // (`**Inspecting PR workflow**\n\n<body>`). We split it out at write
  // time so the UI can drive a separate heading without re-parsing on
  // every render. Empty / absent for providers that don't emit titles
  // (Anthropic, DeepSeek-R1, Moonshot K2).
  summary_title?: string
}
type ReasoningDeltaValue = {
  key?: string
  reasoning_id: string
  run_id: string
  delta: string
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
  from?: string
  from_principal?: string
  from_agent?: string
  payload?: unknown
  timestamp?: string
  message_type?: string
  mode?: `immediate` | `queued` | `paused` | `steer`
  status?: `pending` | `processed` | `cancelled`
  position?: string
  processed_at?: string
  cancelled_at?: string
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
type SignalValue = {
  key?: string
  signal: EntitySignal
  status: SignalHandlingStatus
  sender?: string
  reason?: string
  payload?: unknown
  timestamp: string
  handled_at?: string
  handled_by?: string
  outcome?: SignalOutcome
  previous_state?: ChildEntityStatusValue
  new_state?: ChildEntityStatusValue
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
type AttachmentStatusValue = `pending` | `complete` | `failed`
type AttachmentSubjectTypeValue =
  | `inbox`
  | `run`
  | `text`
  | `tool_call`
  | `context`
type AttachmentRoleValue = `input` | `output`
type AttachmentSubjectValue = {
  type: AttachmentSubjectTypeValue
  key: string
}
type ManifestAttachmentEntryValue = {
  key?: string
  kind: `attachment`
  id: string
  streamPath: string
  status: AttachmentStatusValue
  subject: AttachmentSubjectValue
  role: AttachmentRoleValue
  mimeType: string
  filename?: string
  byteLength?: number
  sha256?: string
  createdAt: string
  createdBy?: string
  error?: string
  meta?: Record<string, JsonValue>
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
  messageType?: string
  status?: FutureSendScheduleStatus
  sentAt?: string
  failedAt?: string
  lastError?: string
}
type GoalStatusValue = `active` | `complete` | `budget_limited`
type ManifestGoalEntryValue = {
  key?: string
  kind: `goal`
  id: string
  objective: string
  status: GoalStatusValue
  // `null` means unbounded — the user must opt in explicitly.
  tokenBudget: number | null
  // Maintained by the handler's in-memory step accumulator (the single
  // write path for usage); enforcement aborts mid-run via the step-end hook.
  tokensUsed: number
  // Optional completion note recorded by mark_goal_complete — what was
  // accomplished, or what blocked the goal.
  summary?: string
  // ISO strings, matching every other manifest kind.
  createdAt: string
  updatedAt: string
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

const timelineOrderField = {
  _timeline_order: z.string().optional(),
}

function createChildEntityStatusSchema(): Schema<ChildEntityStatusValue> {
  return z.enum([
    `spawning`,
    `running`,
    `idle`,
    `paused`,
    `stopping`,
    `stopped`,
    `killed`,
  ])
}

function createEntitySignalSchema(): Schema<EntitySignal> {
  return z.enum([
    `SIGINT`,
    `SIGHUP`,
    `SIGTERM`,
    `SIGKILL`,
    `SIGSTOP`,
    `SIGCONT`,
    `SIGUSR`,
  ])
}

function createWakeChangeSchema(): Schema<WakeChangeEntryValue> {
  return z.object({
    collection: z.string(),
    kind: z.enum([`insert`, `update`, `delete`]),
    key: z.string(),
    value: z.unknown().optional(),
    oldValue: z.unknown().optional(),
    from: z.string().optional(),
    from_principal: z.string().optional(),
    from_agent: z.string().optional(),
    payload: z.unknown().optional(),
    timestamp: z.string().optional(),
    message_type: z.string().optional(),
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
    ...timelineOrderField,
    status: z.enum([`started`, `completed`, `failed`]),
    finish_reason: z.string().optional(),
  })
}

function createStepSchema(): Schema<StepValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    run_id: z.string().optional(),
    step_number: z.number().int(),
    status: z.enum([`started`, `completed`]),
    finish_reason: z.string().optional(),
    model_provider: z.string().optional(),
    model_id: z.string().optional(),
    duration_ms: z.number().int().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
  })
}

function createTextSchema(): Schema<TextValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    run_id: z.string().optional(),
    status: z.enum([`streaming`, `completed`]),
  })
}

function createTextDeltaSchema(): Schema<TextDeltaValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    text_id: z.string(),
    run_id: z.string(),
    delta: z.string(),
  })
}

function createToolCallSchema(): Schema<ToolCallValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
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
    ...timelineOrderField,
    run_id: z.string().optional(),
    status: z.enum([`streaming`, `completed`]),
    encrypted: z.string().optional(),
    summary_title: z.string().optional(),
  })
}

function createReasoningDeltaSchema(): Schema<ReasoningDeltaValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    reasoning_id: z.string(),
    run_id: z.string(),
    delta: z.string(),
  })
}

function createErrorEventSchema(): Schema<ErrorEventValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
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
    ...timelineOrderField,
    from: z.string().optional(),
    from_principal: z.string().optional(),
    from_agent: z.string().optional(),
    payload: z.unknown().optional(),
    timestamp: z.string().optional(),
    message_type: z.string().optional(),
    mode: z.enum([`immediate`, `queued`, `paused`, `steer`]).optional(),
    status: z.enum([`pending`, `processed`, `cancelled`]).optional(),
    position: z.string().optional(),
    processed_at: z.string().optional(),
    cancelled_at: z.string().optional(),
  })
}

function createWakeSchema(): Schema<WakeEntryValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
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
    ...timelineOrderField,
    entity_type: z.string(),
    timestamp: z.string(),
    args: createJsonObjectSchema(),
    parent_url: z.string().optional(),
  })
}

function createEntityStoppedSchema(): Schema<EntityStoppedValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    timestamp: z.string(),
    reason: z.string().optional(),
  })
}

function createSignalSchema(): Schema<SignalValue> {
  return z.object({
    key: z.string().optional(),
    signal: createEntitySignalSchema(),
    status: z.enum([`unhandled`, `handled`]),
    sender: z.string().optional(),
    reason: z.string().optional(),
    payload: z.unknown().optional(),
    timestamp: z.string(),
    handled_at: z.string().optional(),
    handled_by: z.string().optional(),
    outcome: z
      .enum([
        `transitioned`,
        `ignored`,
        `invalid_for_state`,
        `delivered`,
        `aborted`,
        `shutdown_requested`,
        `failed`,
      ])
      .optional(),
    previous_state: createChildEntityStatusSchema().optional(),
    new_state: createChildEntityStatusSchema().optional(),
  })
}

function createChildStatusSchema(): Schema<ChildStatusEntryValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    entity_url: z.string(),
    entity_type: z.string(),
    status: createChildEntityStatusSchema(),
  })
}

function createTagEntrySchema(): Schema<TagEntryValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    value: z.string(),
  })
}

function createAttachmentSubjectSchema(): Schema<AttachmentSubjectValue> {
  return z.object({
    type: z.enum([`inbox`, `run`, `text`, `tool_call`, `context`]),
    key: z.string(),
  })
}

function createAttachmentMetaSchema(): Schema<Record<string, JsonValue>> {
  return z.object({}).catchall(z.unknown()) as unknown as Schema<
    Record<string, JsonValue>
  >
}

function createSlashCommandSchema(): Schema<SlashCommandValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
    name: z.string(),
    description: z.string().optional(),
    arguments: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum([`string`, `number`, `boolean`]),
          required: z.boolean().optional(),
          description: z.string().optional(),
        })
      )
      .optional(),
    source: z.enum([`static`, `dynamic`]),
    owner: z.string().optional(),
    version: z.string().optional(),
    updated_at: z.string(),
    dynamic_layers: z
      .array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          arguments: z
            .array(
              z.object({
                name: z.string(),
                type: z.enum([`string`, `number`, `boolean`]),
                required: z.boolean().optional(),
                description: z.string().optional(),
              })
            )
            .optional(),
          owner: z.string().optional(),
          version: z.string().optional(),
          updated_at: z.string(),
        })
      )
      .optional(),
  })
}
function createContextInsertedSchema(): Schema<ContextInsertedValue> {
  return z.object({
    key: z.string().optional(),
    ...timelineOrderField,
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
    ...timelineOrderField,
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
  | ManifestAttachmentEntryValue
  | ManifestContextEntryValue
  | ManifestCronScheduleEntryValue
  | ManifestFutureSendScheduleEntryValue
  | ManifestGoalEntryValue
> {
  return z.union([
    z.object({
      key: z.string().optional(),
      ...timelineOrderField,
      kind: z.literal(`child`),
      id: z.string(),
      entity_type: z.string(),
      entity_url: z.string(),
      wake: createWakeConfigSchema().optional(),
      observed: z.boolean().default(false),
    }),
    z.object({
      key: z.string().optional(),
      ...timelineOrderField,
      kind: z.literal(`source`),
      sourceType: z.string(),
      sourceRef: z.string(),
      wake: createWakeConfigSchema().optional(),
      config: z.record(z.string(), z.unknown()),
    }),
    z.object({
      key: z.string().optional(),
      ...timelineOrderField,
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
      ...timelineOrderField,
      kind: z.literal(`effect`),
      id: z.string(),
      function_ref: z.string(),
      config: z.unknown(),
    }),
    z.object({
      key: z.string().optional(),
      ...timelineOrderField,
      kind: z.literal(`attachment`),
      id: z.string(),
      streamPath: z.string(),
      status: z.enum([`pending`, `complete`, `failed`]),
      subject: createAttachmentSubjectSchema(),
      role: z.enum([`input`, `output`]),
      mimeType: z.string(),
      filename: z.string().optional(),
      byteLength: z.number().int().nonnegative().optional(),
      sha256: z.string().optional(),
      createdAt: z.string(),
      createdBy: z.string().optional(),
      error: z.string().optional(),
      meta: createAttachmentMetaSchema().optional(),
    }),
    z.object({
      key: z.string().optional(),
      ...timelineOrderField,
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
      ...timelineOrderField,
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
      ...timelineOrderField,
      kind: z.literal(`schedule`),
      id: z.string(),
      scheduleType: z.literal(`future_send`),
      fireAt: z.string(),
      targetUrl: z.string(),
      payload: z.unknown(),
      producerId: z.string(),
      messageType: z.string().optional(),
      status: z.enum([`pending`, `sent`, `failed`]).default(`pending`),
      sentAt: z.string().optional(),
      failedAt: z.string().optional(),
      lastError: z.string().optional(),
    }),
    z.object({
      key: z.string().optional(),
      ...timelineOrderField,
      kind: z.literal(`goal`),
      id: z.string(),
      objective: z.string(),
      status: z.enum([`active`, `complete`, `budget_limited`]),
      tokenBudget: z.number().int().positive().nullable(),
      tokensUsed: z.number().int().nonnegative(),
      summary: z.string().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ]) as unknown as Schema<
    | ManifestChildEntryValue
    | ManifestSourceEntryValue
    | ManifestSharedStateEntryValue
    | ManifestEffectEntryValue
    | ManifestAttachmentEntryValue
    | ManifestContextEntryValue
    | ManifestCronScheduleEntryValue
    | ManifestFutureSendScheduleEntryValue
    | ManifestGoalEntryValue
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
export type ReasoningDelta = SequencedPersistedRow<ReasoningDeltaValue>
export type ErrorEvent = SequencedPersistedRow<ErrorEventValue>
export type MessageReceived = SequencedPersistedRow<MessageReceivedValue>
export type WakeEntry = SequencedPersistedRow<WakeEntryValue>
export type EntityCreated = SequencedPersistedRow<EntityCreatedValue>
export type EntityStopped = SequencedPersistedRow<EntityStoppedValue>
export type Signal = SequencedPersistedRow<SignalValue>
export type ChildStatusEntry = SequencedPersistedRow<ChildStatusEntryValue>
export type TagEntry = SequencedPersistedRow<TagEntryValue>
export type SlashCommandEntry = SequencedPersistedRow<SlashCommandValue> &
  SlashCommandRow
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
export type AttachmentStatus = AttachmentStatusValue
export type AttachmentSubjectType = AttachmentSubjectTypeValue
export type AttachmentRole = AttachmentRoleValue
export type AttachmentSubject = AttachmentSubjectValue
export type ManifestAttachmentEntry =
  SequencedPersistedRow<ManifestAttachmentEntryValue>
export type ManifestContextEntry =
  SequencedPersistedRow<ManifestContextEntryValue>
export type ManifestCronScheduleEntry =
  SequencedPersistedRow<ManifestCronScheduleEntryValue>
export type ManifestFutureSendScheduleEntry =
  SequencedPersistedRow<ManifestFutureSendScheduleEntryValue>
export type GoalStatus = GoalStatusValue
export type ManifestGoalEntry = SequencedPersistedRow<ManifestGoalEntryValue>
type ManifestUnion =
  | ManifestChildEntry
  | ManifestSourceEntry
  | ManifestSharedStateEntry
  | ManifestEffectEntry
  | ManifestAttachmentEntry
  | ManifestContextEntry
  | ManifestCronScheduleEntry
  | ManifestFutureSendScheduleEntry
  | ManifestGoalEntry
export type Manifest = ManifestUnion & {
  id?: string
  entity_url?: string
  entity_type?: string
  wake?: WakeConfigValue
  observed?: boolean
  sourceType?: string
  sourceRef?: string
  config?: unknown
  streamPath?: string
  subject?: AttachmentSubject
  role?: AttachmentRoleValue
  mimeType?: string
  filename?: string
  byteLength?: number
  sha256?: string
  createdAt?: string
  createdBy?: string
  error?: string
  meta?: Record<string, JsonValue>
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
  messageType?: string
  status?: FutureSendScheduleStatus | AttachmentStatusValue | GoalStatusValue
  sentAt?: string
  failedAt?: string
  lastError?: string
  objective?: string
  tokenBudget?: number | null
  tokensUsed?: number
  summary?: string
  updatedAt?: string
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
  reasoningDeltas: `reasoningDeltas`,
  errors: `errors`,
  inbox: `inbox`,
  wakes: `wakes`,
  entityCreated: `entityCreated`,
  entityStopped: `entityStopped`,
  signals: `signals`,
  childStatus: `childStatus`,
  tags: `tags`,
  slashCommands: `slashCommands`,
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
  reasoning_delta:
    createReasoningDeltaSchema() as unknown as BuiltInEntitySchema<ReasoningDelta>,
  error: createErrorEventSchema() as unknown as BuiltInEntitySchema<ErrorEvent>,
  inbox:
    createMessageReceivedSchema() as unknown as BuiltInEntitySchema<MessageReceived>,
  wake: createWakeSchema() as unknown as BuiltInEntitySchema<WakeEntry>,
  entity_created:
    createEntityCreatedSchema() as unknown as BuiltInEntitySchema<EntityCreated>,
  entity_stopped:
    createEntityStoppedSchema() as unknown as BuiltInEntitySchema<EntityStopped>,
  signal: createSignalSchema() as unknown as BuiltInEntitySchema<Signal>,
  child_status:
    createChildStatusSchema() as unknown as BuiltInEntitySchema<ChildStatusEntry>,
  tags: createTagEntrySchema() as unknown as BuiltInEntitySchema<TagEntry>,
  slash_command:
    createSlashCommandSchema() as unknown as BuiltInEntitySchema<SlashCommandEntry>,
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
  reasoningDeltas: CollectionDefinition<ReasoningDelta>
  errors: CollectionDefinition<ErrorEvent>
  inbox: CollectionDefinition<MessageReceived>
  wakes: CollectionDefinition<WakeEntry>
  entityCreated: CollectionDefinition<EntityCreated>
  entityStopped: CollectionDefinition<EntityStopped>
  signals: CollectionDefinition<Signal>
  childStatus: CollectionDefinition<ChildStatusEntry>
  tags: CollectionDefinition<TagEntry>
  slashCommands: CollectionDefinition<SlashCommandEntry>
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
  reasoningDeltas: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.reasoning_delta as StandardSchemaV1<ReasoningDelta>,
    type: `reasoning_delta`,
    primaryKey: `key`,
  },
  errors: {
    schema: BUILT_IN_EVENT_SCHEMAS.error as StandardSchemaV1<ErrorEvent>,
    type: `error`,
    primaryKey: `key`,
  },
  inbox: {
    schema: BUILT_IN_EVENT_SCHEMAS.inbox as StandardSchemaV1<MessageReceived>,
    type: `inbox`,
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
  signals: {
    schema: BUILT_IN_EVENT_SCHEMAS.signal as StandardSchemaV1<Signal>,
    type: `signal`,
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
  slashCommands: {
    schema:
      BUILT_IN_EVENT_SCHEMAS.slash_command as StandardSchemaV1<SlashCommandEntry>,
    type: `slash_command`,
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
  `signal`,
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
