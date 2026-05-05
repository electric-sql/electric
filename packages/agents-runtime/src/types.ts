import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardTypedV1,
} from '@standard-schema/spec'
import type {
  StreamDB as BaseStreamDB,
  ChangeEvent,
  CollectionDefinition as StateCollectionDefinition,
  StateEvent,
} from '@durable-streams/state'
import type { EntityRegistry } from './define-entity'
import type {
  Collection as TanStackCollection,
  Context as QueryContext,
  DeltaEvent as TanStackDeltaEvent,
  Effect as TanStackEffect,
  EffectConfig as TanStackEffectConfig,
  EffectContext as TanStackEffectContext,
  EffectQueryInput as TanStackEffectQueryInput,
} from '@tanstack/db'
import type {
  AgentTool as PiAgentTool,
  StreamFn,
} from '@mariozechner/pi-agent-core'
import type {
  KnownProvider,
  Model,
  SimpleStreamOptions,
} from '@mariozechner/pi-ai'
import type {
  EntityStreamDB as RuntimeEntityStreamDB,
  EntityStreamDBWithActions as RuntimeEntityStreamDBWithActions,
} from './entity-stream-db'
import type {
  ChildStatusEntry,
  ContextEntryAttrs as EntityContextEntryAttrs,
  ContextInserted as EntityContextInserted,
  ContextRemoved as EntityContextRemoved,
  Manifest as EntityManifest,
  ManifestChildEntry as EntityManifestChildEntry,
  ManifestContextEntry as EntityManifestContextEntry,
  ManifestCronScheduleEntry as EntityManifestCronScheduleEntry,
  ManifestEffectEntry as EntityManifestEffectEntry,
  ManifestFutureSendScheduleEntry as EntityManifestFutureSendScheduleEntry,
  ManifestSharedStateEntry as EntityManifestSharedStateEntry,
  ManifestSourceEntry as EntityManifestSourceEntry,
  WakeEntry,
} from './entity-schema'
import type { EntityTags, TagOperation } from './tags'

export type EntityStreamDB = RuntimeEntityStreamDB
export type EntityStreamDBWithActions<
  TState extends EntityStateDefinition | undefined =
    | EntityStateDefinition
    | undefined,
  TActions extends EntityActionMap = EntityActionMap,
> = Omit<RuntimeEntityStreamDBWithActions, `actions` | `collections`> & {
  collections: RuntimeEntityStreamDBWithActions[`collections`] &
    EntityCollectionsFromState<TState>
  actions: GeneratedStateActions<TState> & HandlerActions<TActions>
}
export type ChildStatus = ChildStatusEntry
export type ObservationCollectionMap = Record<string, StateCollectionDefinition>
export type ObservationStreamDB = BaseStreamDB<ObservationCollectionMap>
export type EntitiesObservationHandle = ObservationHandle & {
  sourceType: `entities`
  db: ObservationStreamDB
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue }

export type EntitySchema = StandardTypedV1<any, any>

type AnyFunction = (...args: Array<any>) => unknown
export type EntityActionMap = Record<string, AnyFunction>
export type EntityStateDefinition = Record<string, CollectionDefinition>

export interface EntityTransaction {
  isPersisted: {
    promise: Promise<unknown>
  }
}

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer R) => void
  ? R
  : never

type ObjectOutput<T> = T extends object ? T : Record<string, unknown>

export type SchemaInput<TSchema> = TSchema extends StandardTypedV1
  ? StandardTypedV1.InferInput<TSchema>
  : unknown

export type SchemaOutput<TSchema> = TSchema extends StandardTypedV1
  ? StandardTypedV1.InferOutput<TSchema>
  : unknown

type CollectionSchema<TCollection> = TCollection extends {
  schema?: infer TSchema
}
  ? NonNullable<TSchema>
  : never

export type CollectionRow<TCollection> = [
  CollectionSchema<TCollection>,
] extends [never]
  ? Record<string, unknown>
  : ObjectOutput<SchemaOutput<CollectionSchema<TCollection>>>

export type CollectionInsert<TCollection> = [
  CollectionSchema<TCollection>,
] extends [never]
  ? CollectionRow<TCollection>
  : ObjectOutput<SchemaInput<CollectionSchema<TCollection>>>

export type CollectionKey<TCollection> = TCollection extends {
  primaryKey: infer TPrimaryKey extends string
}
  ? TPrimaryKey extends keyof CollectionRow<TCollection>
    ? Extract<CollectionRow<TCollection>[TPrimaryKey], string> extends never
      ? string
      : Extract<CollectionRow<TCollection>[TPrimaryKey], string>
    : string
  : `key` extends keyof CollectionRow<TCollection>
    ? Extract<CollectionRow<TCollection>[`key`], string> extends never
      ? string
      : Extract<CollectionRow<TCollection>[`key`], string>
    : string

export type StateProxyFrom<TState> =
  TState extends Record<string, unknown>
    ? {
        [K in keyof TState & string]: StateCollectionProxy<
          CollectionRow<TState[K]>,
          CollectionInsert<TState[K]>,
          CollectionKey<TState[K]>
        >
      }
    : {}

type EntityCollectionsFromState<TState> =
  TState extends Record<string, unknown>
    ? {
        [K in keyof TState & string]: TanStackCollection<
          CollectionRow<TState[K]>,
          CollectionKey<TState[K]>,
          any,
          any,
          CollectionInsert<TState[K]>
        >
      }
    : {}

type GeneratedActionUnion<TState extends Record<string, unknown>> = {
  [K in keyof TState & string]: {
    [P in `${K}_insert`]: (args: {
      row: CollectionInsert<TState[K]>
    }) => EntityTransaction
  } & {
    [P in `${K}_update`]: (args: {
      key: CollectionKey<TState[K]>
      updater: (draft: CollectionRow<TState[K]>) => void
    }) => EntityTransaction
  } & {
    [P in `${K}_delete`]: (args: {
      key: CollectionKey<TState[K]>
    }) => EntityTransaction
  }
}[keyof TState & string]

export type GeneratedStateActions<TState> =
  TState extends Record<string, unknown>
    ? [keyof TState & string] extends [never]
      ? {}
      : UnionToIntersection<GeneratedActionUnion<TState>>
    : {}

export type HandlerActions<TActions extends EntityActionMap> = {
  [K in keyof TActions]: TActions[K] extends (...args: infer TParams) => unknown
    ? (...args: TParams) => EntityTransaction
    : never
}

export type EntityArgs<TCreationSchema> =
  TCreationSchema extends StandardTypedV1
    ? Readonly<ObjectOutput<SchemaInput<TCreationSchema>>>
    : Readonly<Record<string, unknown>>

// Re-export TanStack DB effect types
export type DeltaEvent<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = TanStackDeltaEvent<TRow, TKey>
export type EffectContext = TanStackEffectContext
export type Effect = TanStackEffect
export type EffectQueryInput<TContext extends QueryContext = QueryContext> =
  TanStackEffectQueryInput<TContext>

export interface TriggerConfig {
  observe?: string
  where?: (event: ChangeEvent) => boolean
  key?: (event: ChangeEvent) => string
  cron?: string
  webhook?: string
}

export type LLMMessage =
  | LLMUserMessage
  | LLMAssistantMessage
  | LLMToolCallMessage
  | LLMToolResultMessage

interface LLMMessageBase {
  content: string
}

export interface LLMUserMessage extends LLMMessageBase {
  role: `user`
}

export interface LLMAssistantMessage extends LLMMessageBase {
  role: `assistant`
}

export interface LLMToolCallMessage extends LLMMessageBase {
  role: `tool_call`
  toolCallId: string
  toolName: string
  toolArgs: unknown
}

export interface LLMToolResultMessage extends LLMMessageBase {
  role: `tool_result`
  toolCallId: string
  isError: boolean
}

export const CACHE_TIERS = [
  `pinned`,
  `stable`,
  `slow-changing`,
  `volatile`,
] as const

export type CacheTier = (typeof CACHE_TIERS)[number]

/**
 * Message annotated with a logical timeline position used only for prompt
 * assembly and timeline projection ordering.
 */
export type TimestampedMessage = LLMMessage & {
  /**
   * Monotonic logical order used to interleave context messages.
   * This is not a wall-clock timestamp or a durable stream offset.
   */
  at: number
}

export type SourceContent =
  | string
  | Array<LLMMessage>
  | Array<TimestampedMessage>

interface SourceConfigBase {
  content: () => SourceContent | Promise<SourceContent>
}

export interface VolatileSourceConfig extends SourceConfigBase {
  cache: `volatile`
  max?: number
}

export interface NonVolatileSourceConfig extends SourceConfigBase {
  cache: Exclude<CacheTier, `volatile`>
  max: number
}

export type SourceConfig = VolatileSourceConfig | NonVolatileSourceConfig

export interface UseContextConfig {
  sourceBudget: number
  sources: Record<string, SourceConfig>
}

export type ManifestEntry = EntityManifest
export type ManifestChildEntry = EntityManifestChildEntry
export type ManifestContextEntry = EntityManifestContextEntry
export type ManifestCronScheduleEntry = EntityManifestCronScheduleEntry
export type ManifestEffectEntry = EntityManifestEffectEntry
export type ManifestFutureSendScheduleEntry =
  EntityManifestFutureSendScheduleEntry
export type ManifestSourceEntry = EntityManifestSourceEntry
export type ManifestSharedStateEntry = EntityManifestSharedStateEntry
export type ContextInserted = EntityContextInserted
export type ContextRemoved = EntityContextRemoved
export type ContextEntryAttrs = EntityContextEntryAttrs

export interface ContextEntryInput {
  name: string
  attrs?: ContextEntryAttrs
  content: string
}

export interface ContextEntry extends ContextEntryInput {
  id: string
  insertedAt: number
}

export type TimelineItem =
  | { kind: `inbox`; at: number; payload: unknown }
  | { kind: `wake`; at: number; payload: unknown }
  | {
      kind: `run`
      at: number
      items: Array<
        | { kind: `text`; text: string; status: `streaming` | `completed` }
        | {
            kind: `toolCall`
            key: string
            toolName: string
            args: unknown
            result: unknown
            error: string | null
            status:
              | `started`
              | `args_complete`
              | `executing`
              | `completed`
              | `failed`
          }
      >
    }
  | {
      kind: `context_inserted`
      at: number
      historyOffset: string
      id: string
      name: string
      attrs: ContextEntryAttrs
      content: string
      superseded: boolean
    }
  | {
      kind: `context_removed`
      at: number
      historyOffset: string
      id: string
      name: string
    }

export interface TimelineProjectionOpts {
  since?: number
  projection?: (item: TimelineItem) => Array<LLMMessage> | null
}

export interface EntityCreated {
  key: string
  entity_type: string
  timestamp: string
  args: JsonValue
  parent_url?: string
}

export interface PendingSend {
  targetUrl: string
  payload: unknown
  type?: string
  /** Delay delivery by this many milliseconds. */
  afterMs?: number
}

export type EffectConfig<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = TanStackEffectConfig<TRow, TKey>

/**
 * Proxy handle for a single custom state collection exposed on `SharedStateHandle`.
 * Mutating methods (insert/update/delete) return a Transaction (fire-and-forget
 * or await via `tx.isPersisted.promise`). Read methods delegate to the underlying
 * TanStack DB collection.
 */
export interface StateCollectionProxy<
  T extends object = Record<string, unknown>,
  TInsert extends object = T,
  TKey extends string = string,
> {
  insert: (row: TInsert) => EntityTransaction
  update: (key: TKey, updater: (draft: T) => void) => EntityTransaction
  delete: (key: TKey) => EntityTransaction
  get: (key: TKey) => T | undefined
  toArray: Array<T>
}

export type StateProxy = Record<string, StateCollectionProxy>

/**
 * Schema definition for a single collection within a shared state stream.
 * Mirrors how entity `state:` collections are defined but is self-contained
 * so shared state schemas can be declared inline.
 */
export interface SharedStateCollectionSchema<
  TSchema extends StandardSchemaV1<any, any> | undefined =
    | StandardSchemaV1<any, any>
    | undefined,
> {
  /** Zod (or any Standard Schema) validator for the row type */
  schema?: TSchema
  /** Event type string used in the durable stream (e.g. `"finding"`) */
  type: string
  /** Primary key field name (must be a string field on the row) */
  primaryKey: string
}

/**
 * Map of collection names to their schema definitions for a shared state stream.
 * Example:
 * ```ts
 * {
 *   findings: {
 *     schema: z.object({ key: z.string(), domain: z.string(), finding: z.string() }),
 *     type: "finding",
 *     primaryKey: "key",
 *   }
 * }
 * ```
 */
export type SharedStateSchemaMap = Record<string, SharedStateCollectionSchema>

/**
 * Handle returned by `ctx.mkdb()` and `ctx.observe(db(...))`.
 * Provides typed collection proxies keyed by the collection names declared
 * in the schema map. Also exposes the stream id.
 */
export type SharedStateHandle<
  TSchema extends SharedStateSchemaMap = SharedStateSchemaMap,
> = {
  /** The shared state stream identifier */
  id: string
} & {
  [K in keyof TSchema]: StateCollectionProxy<
    CollectionRow<TSchema[K]>,
    CollectionInsert<TSchema[K]>,
    CollectionKey<TSchema[K]>
  >
}

export interface RuntimeContext {
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  self: SelfHandle
  actions: Record<string, (...args: Array<unknown>) => unknown>
  spawn: (
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: {
      initialMessage?: unknown
      tags?: Record<string, string>
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  observe: ((
    source: ObservationSource & { sourceType: `entity` },
    opts?: { wake?: Wake }
  ) => Promise<EntityHandle>) &
    (<TSchema extends SharedStateSchemaMap>(
      source: ObservationSource & { sourceType: `db`; schema: TSchema },
      opts?: { wake?: Wake }
    ) => Promise<SharedStateHandle<TSchema> & ObservationHandle>) &
    ((
      source: ObservationSource,
      opts?: { wake?: Wake }
    ) => Promise<ObservationHandle>)
  mkdb: <TSchema extends SharedStateSchemaMap>(
    id: string,
    schema: TSchema
  ) => SharedStateHandle<TSchema>
  send: (
    entityUrl: string,
    payload: unknown,
    opts?: { type?: string; afterMs?: number }
  ) => void
  createEffect: (functionRef: string, key: string, config: JsonValue) => boolean
}

export interface SelfHandle {
  entityUrl: string
  send: (payload: unknown, opts?: { type?: string }) => void
}

export interface EntityHandle extends ObservationHandle {
  entityUrl: string
  type?: string
  db: EntityStreamDB
  events: Array<ChangeEvent>
  run: Promise<void>
  text: () => Promise<Array<string>>
  send: (msg: unknown) => void
  status: () => ChildStatus | undefined
}

// ── Observation Source Interface ─────────────────────────────────

export interface ObservationSource {
  readonly sourceType: string
  readonly sourceRef: string
  readonly streamUrl?: string
  readonly schema?: Record<string, CollectionDefinition>

  wake?: () => SourceWakeConfig
  toManifestEntry: () => ManifestSourceEntry
}

export interface SourceWakeConfig {
  sourceUrl: string
  condition:
    | `runFinished`
    | {
        on: `change`
        collections?: Array<string>
        ops?: Array<TagOperation>
      }
  debounceMs?: number
  timeoutMs?: number
  includeResponse?: boolean
}

export interface ObservationHandle {
  sourceType: string
  sourceRef: string
  db?: EntityStreamDB | ObservationStreamDB
  events: Array<ChangeEvent>
}

export interface SourceHandleInfo {
  sourceType: string
  wireDb?: (
    db: EntityStreamDBWithActions | ObservationStreamDB
  ) => void | Promise<void>
}

export interface CollectionDefinition<
  TSchema extends StandardSchemaV1<any, any> | undefined =
    | StandardSchemaV1<any, any>
    | undefined,
> {
  schema?: TSchema
  /** Event type string used in the durable stream (e.g. `"counter_value"`). Defaults to `"state:${name}"`. */
  type?: string
  /** Primary key field name. Defaults to `"key"`. */
  primaryKey?: string
}

export interface EntityTypeEntry<
  TDefinition extends AnyEntityDefinition = AnyEntityDefinition,
> {
  name: string
  definition: TDefinition
}

// Re-export upstream types used in signatures above so consumers can import from one place
export type { ChangeEvent, StateEvent }

export interface WebhookNotification {
  consumerId: string
  epoch: number
  wakeId: string
  streamPath: string
  streams: Array<{ path: string; offset: string }>
  triggeredBy?: Array<string>
  callback: string
  claimToken: string
  writeToken?: string
  triggerEvent?: string
  wakeEvent?: WakeEvent
  entity?: {
    type?: string
    status: string
    url: string
    streams: { main: string; error: string }
    tags?: Record<string, string>
    spawnArgs?: Record<string, unknown>
    writeToken?: string
  }
}

export interface ProcessWakeConfig {
  /** Base URL of the durable streams server */
  baseUrl: string
  /** Entity registry used by this runtime instance */
  registry?: EntityRegistry
  /** Optional tool factory invoked per wake context. */
  createElectricTools?: (context: {
    entityUrl: string
    entityType: string
    args: Readonly<Record<string, unknown>>
    db: EntityStreamDBWithActions
    events: Array<ChangeEvent>
    upsertCronSchedule: (opts: {
      id: string
      expression: string
      timezone?: string
      payload?: unknown
      debounceMs?: number
      timeoutMs?: number
    }) => Promise<{ txid: string }>
    upsertFutureSendSchedule: (opts: {
      id: string
      payload: unknown
      targetUrl?: string
      fireAt: string
      from?: string
      messageType?: string
    }) => Promise<{ txid: string }>
    deleteSchedule: (opts: { id: string }) => Promise<{ txid: string }>
  }) => Array<AgentTool> | Promise<Array<AgentTool>>
  /** Optional shutdown signal to end idle waits during host teardown. */
  shutdownSignal?: AbortSignal
  /** Idle timeout in ms before closing the wake (default: 20_000) */
  idleTimeout?: number
  /** Heartbeat interval in ms (default: 30_000) */
  heartbeatInterval?: number
}

export type WakePhase = `setup` | `active` | `closing` | `closed`

export interface WakeSession {
  getPhase: () => WakePhase
  registerManifestEntry: (entry: ManifestEntry) => boolean
  removeManifestEntry: (key: string) => boolean
  commitManifestEntries: () => Promise<void>
  rollbackManifestEntries: () => void
  registerSharedStateHandle: (id: string, handle: SharedStateHandleInfo) => void
  registerSpawnHandle: (id: string, handle: SpawnHandleInfo) => void
  registerSourceHandle: (id: string, handle: SourceHandleInfo) => void
  enqueueSend: (send: PendingSend) => void
  getManifest: () => Array<ManifestEntry>
  getPendingSends: () => Array<PendingSend>
  getSharedStateHandles: () => Map<string, SharedStateHandleInfo>
  getSpawnHandles: () => Map<string, SpawnHandleInfo>
  getSourceHandles: () => Map<string, SourceHandleInfo>
  finishSetup: () => SetupCompleteResult
  close: () => Promise<void>
}

/**
 * Handle info exposed by setup context for shared state streams.
 * processWake uses this to create/connect the backing StreamDB.
 */
export interface SharedStateHandleInfo {
  mode: `create` | `connect`
  schema: SharedStateSchemaMap
  handle?: SharedStateHandle
  wireDb: (db: EntityStreamDBWithActions) => void | Promise<void>
}

/**
 * Handle info exposed by setup context for spawned children.
 * processWake uses this to wire the child's StreamDB after spawning.
 */
export interface SpawnHandleInfo {
  wireDb: (db: EntityStreamDBWithActions) => void | Promise<void>
  resolveRun: () => void
  rejectRun: (reason: Error) => void
  /** Update the handle's entityUrl after learning the server-assigned URL. */
  updateEntityUrl: (realUrl: string) => void
}

/**
 * Callback payload passed to onSetupComplete between setup() and agent execution.
 * Gives processWake the hooks it needs to create real streams and wire handles.
 */
export interface SetupCompleteResult {
  manifest: Array<ManifestEntry>
  sharedStateHandles: Map<string, SharedStateHandleInfo>
  spawnHandles: Map<string, SpawnHandleInfo>
  sourceHandles: Map<string, SourceHandleInfo>
}

// ── Wake Primitives ──────────────────────────────────────────────

export type Wake =
  | `runFinished`
  | { on: `runFinished`; includeResponse?: boolean }
  | {
      on: `change`
      collections?: Array<string>
      ops?: Array<TagOperation>
      debounceMs?: number
      timeoutMs?: number
    }

export type WakeMessage = Omit<WakeEntry, `key`>

export type WakeEvent = {
  source: string
  type: string
  fromOffset: number
  toOffset: number
  eventCount: number
  payload?: unknown
  summary?: string
  fullRef?: string
}

export type AgentRunResult = {
  result?: unknown
  writes: Array<ChangeEvent>
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>
  usage: { tokens: number; duration: number }
}

export type AgentTool = PiAgentTool
export type AgentModel = string | Model<any>

export interface AgentConfig {
  systemPrompt: string
  model: AgentModel
  provider?: KnownProvider
  tools: Array<AgentTool>
  streamFn?: StreamFn
  getApiKey?: (
    provider: string
  ) => Promise<string | undefined> | string | undefined
  onPayload?: SimpleStreamOptions[`onPayload`]
  testResponses?: TestResponses
}

export type TestResponses = Array<string> | TestResponseFn

export type TestResponseFn = (
  message: string,
  bridge: OutboundBridgeHandle
) => Promise<string | undefined>

export interface OutboundBridgeHandle {
  onRunStart: () => void
  onRunEnd: (opts?: { finishReason?: string }) => void
  onStepStart: (opts: { modelProvider: string; modelId: string }) => void
  onStepEnd: (opts: { finishReason: string; durationMs: number }) => void
  onTextStart: () => void
  onTextDelta: (delta: string) => void
  onTextEnd: () => void
  onToolCallStart(toolCallId: string, name: string, args: unknown): void
  onToolCallStart(name: string, args: unknown): void
  onToolCallEnd(
    toolCallId: string,
    name: string,
    result: unknown,
    isError: boolean
  ): void
  onToolCallEnd(name: string, result: unknown, isError: boolean): void
}

export interface AgentHandle {
  run: (input?: string) => Promise<AgentRunResult>
}

/**
 * Handle returned by `ctx.recordRun()`. Lets a non-LLM entity bracket
 * an external operation (CLI subprocess, HTTP call, etc.) with the
 * same `runs`-collection events that `useAgent` writes internally, so
 * parents observing the entity with `wake: "runFinished"` are woken
 * when the operation completes.
 */
export interface RunHandle {
  /** Generated run key (e.g. `run-3`). Same value appears in the entity's `runs` collection. */
  readonly key: string
  /**
   * Finalize the run by writing the corresponding `runs` collection
   * update. Calling this satisfies the `runFinished` wake matcher,
   * causing observers to be woken.
   */
  end(opts: { status: `completed` | `failed`; finishReason?: string }): void
  /**
   * Attach a response text to this run as a `text_delta` event linked
   * via `run_id`. Observers waking on `runFinished` with
   * `includeResponse: true` receive the concatenation of all deltas
   * attached this way as the run's `response`. Multiple calls append
   * additional deltas in order.
   */
  attachResponse(text: string): void
}

export interface HandlerContext<
  TState extends StateProxy = StateProxy,
  TArgs extends Readonly<Record<string, unknown>> = Readonly<
    Record<string, unknown>
  >,
  TActions extends Record<string, (...args: Array<any>) => unknown> = Record<
    string,
    (...args: Array<any>) => unknown
  >,
  TDb extends EntityStreamDBWithActions = EntityStreamDBWithActions,
> {
  firstWake: boolean
  tags: Readonly<EntityTags>
  entityUrl: string
  entityType: string
  args: TArgs
  db: TDb
  state: TState
  events: Array<ChangeEvent>
  actions: TActions
  electricTools: Array<AgentTool>
  useAgent: (config: AgentConfig) => AgentHandle
  useContext: (config: UseContextConfig) => void
  timelineMessages: (opts?: TimelineProjectionOpts) => Array<TimestampedMessage>
  insertContext: (id: string, entry: ContextEntryInput) => void
  removeContext: (id: string) => void
  getContext: (id: string) => ContextEntry | undefined
  listContext: () => Array<ContextEntry>
  agent: AgentHandle
  spawn: (
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: {
      initialMessage?: unknown
      wake?: Wake
      tags?: Record<string, string>
      /**
       * When false, the parent does not subscribe to the child's stream. The
       * spawned EntityHandle is fire-and-forget: `.run`, `.text`, and
       * `.status` throw if accessed. Use for high-fanout patterns where the
       * parent never awaits child completion.
       */
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  observe: ((
    source: ObservationSource & { sourceType: `entity` },
    opts?: { wake?: Wake }
  ) => Promise<EntityHandle>) &
    (<TSchema extends SharedStateSchemaMap>(
      source: ObservationSource & { sourceType: `db`; schema: TSchema },
      opts?: { wake?: Wake }
    ) => Promise<SharedStateHandle<TSchema> & ObservationHandle>) &
    ((
      source: ObservationSource,
      opts?: { wake?: Wake }
    ) => Promise<ObservationHandle>)
  mkdb: <T extends SharedStateSchemaMap>(
    id: string,
    schema: T
  ) => SharedStateHandle<T>
  send: (
    entityUrl: string,
    payload: unknown,
    opts?: { type?: string; afterMs?: number }
  ) => void
  /**
   * Record a non-LLM run on the entity's built-in `runs` collection.
   * Use this to bracket an external operation (CLI subprocess, HTTP
   * call, etc.) so observers waking on `runFinished` are notified when
   * it completes. LLM-driven entities don't need to call this — the
   * `useAgent` flow records runs internally via the outbound bridge.
   */
  recordRun: () => RunHandle
  sleep: () => void
  setTag: (key: string, value: string) => Promise<void>
  removeTag: (key: string) => Promise<void>
}

export type EntityActionsFactory<
  TState extends EntityStateDefinition | undefined,
  TActions extends EntityActionMap,
> = (collections: EntityCollectionsFromState<TState>) => TActions

export interface EntityDefinition<
  TCreationSchema extends EntitySchema | undefined = EntitySchema | undefined,
  TState extends EntityStateDefinition | undefined =
    | EntityStateDefinition
    | undefined,
  TActions extends EntityActionMap = EntityActionMap,
> {
  description?: string
  state?: TState
  actions?: EntityActionsFactory<TState, TActions>
  creationSchema?: TCreationSchema
  inboxSchemas?: Record<string, StandardJSONSchemaV1>
  outputSchemas?: Record<string, StandardJSONSchemaV1>

  handler: (
    ctx: HandlerContext<
      StateProxyFrom<TState>,
      EntityArgs<TCreationSchema>,
      HandlerActions<TActions>,
      EntityStreamDBWithActions<TState, TActions>
    >,
    wake: WakeEvent
  ) => void | Promise<void>
}

export type AnyEntityDefinition = Omit<
  EntityDefinition<
    EntitySchema | undefined,
    EntityStateDefinition | undefined,
    EntityActionMap
  >,
  `actions` | `handler`
> & {
  actions?: (collections: Record<string, unknown>) => EntityActionMap
  handler: (ctx: HandlerContext, wake: WakeEvent) => void | Promise<void>
}
