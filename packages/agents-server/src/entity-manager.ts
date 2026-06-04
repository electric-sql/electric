import { createHash, randomUUID } from 'node:crypto'
import fastq from 'fastq'
import {
  assertTags,
  entityStateSchema,
  getCronStreamPath,
  getSharedStateStreamPath,
  getNextCronFireAt,
  eventSourceSubscriptionManifestKey,
  manifestChildKey,
  manifestSharedStateKey,
  manifestSourceKey,
  resolveCronScheduleSpec,
} from '@electric-ax/agents-runtime'
import type { EventPointer } from '@electric-ax/agents-runtime'
import {
  ErrCodeDuplicateURL,
  ErrCodeEntityPersistFailed,
  ErrCodeForkInProgress,
  ErrCodeForkWaitTimeout,
  ErrCodeInvalidSignal,
  ErrCodeInvalidRequest,
  ErrCodeNotFound,
  ErrCodeNotRunning,
  ErrCodeSchemaKeyExists,
  ErrCodeSchemaValidationFailed,
  ErrCodeUnauthorized,
  ErrCodeUnknownEntityType,
  ErrCodeUnknownEventType,
  ErrCodeUnknownMessageType,
  isTerminalEntityStatus,
  rejectsNormalWrites,
} from './electric-agents-types.js'
import { parseDispatchPolicy } from './dispatch-policy-schema.js'
import { applyTypeDefaultSubscriptionScope } from './routing/dispatch-policy.js'
import { resolveSandboxForSpawn } from './routing/sandbox.js'
import {
  isBuiltInSystemPrincipalUrl,
  principalFromCreatedBy,
  principalUrl,
  principalIdentityStateSchema,
  principalUpdateIdentityMessageSchema,
} from './principal.js'
import { EntityAlreadyExistsError } from './entity-registry.js'
import { serverLog } from './utils/log.js'
import {
  buildManifestWakeRegistration,
  extractManifestCronSpec,
} from './manifest-side-effects.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import { ATTR, withSpan } from './tracing.js'
import type { queueAsPromised } from 'fastq'
import type { SchedulerClient } from './scheduler.js'
import type { WakeEvalResult, WakeRegistry } from './wake-registry.js'
import type { WakeMessage } from '@electric-ax/agents-runtime'
import type { EventSourceSubscription } from '@electric-ax/agents-runtime'
import type { PostgresRegistry } from './entity-registry.js'
import type { SchemaValidator } from './electric-agents/schema-validator.js'
import type { StreamClient } from './stream-client.js'
import type {
  DispatchPolicy,
  ElectricAgentsEntity,
  ElectricAgentsEntityType,
  EntitySignal,
  RegisterEntityTypeRequest,
  SendRequest,
  SetTagRequest,
  SignalRequest,
  SignalResponse,
  TypedSpawnRequest,
} from './electric-agents-types.js'
import type { EntityBridgeCoordinator } from './entity-bridge-manager.js'
import type { Principal } from './principal.js'

type SpawnPersistResult = [
  PromiseSettledResult<void>,
  PromiseSettledResult<void>,
  PromiseSettledResult<number>,
]
type SpawnPersistJob = () => Promise<SpawnPersistResult>
type WriteTokenValidator = (
  entity: ElectricAgentsEntity,
  token: string
) => boolean
type ServerSignalOutcome = `transitioned` | `ignored`
type ServerSignalHandling = {
  status: ElectricAgentsEntity[`status`]
  handled: boolean
  outcome: ServerSignalOutcome
  unregisterWakes: boolean
}
type ServerSignalValue = {
  signal: EntitySignal
  status: `handled` | `unhandled`
  sender: typeof SERVER_SIGNAL_SENDER
  timestamp: string
  reason?: string
  payload?: unknown
  handled_at?: string
  handled_by?: typeof SERVER_SIGNAL_SENDER
  outcome?: ServerSignalOutcome
  previous_state?: ElectricAgentsEntity[`status`]
  new_state?: ElectricAgentsEntity[`status`]
}
type ServerSignalEvent = {
  type: `signal`
  key: string
  value: ServerSignalValue
  headers: {
    operation: `insert`
    timestamp: string
    txid: string
  }
}
type AttachmentSubjectType = `inbox` | `run` | `text` | `tool_call` | `context`
type AttachmentRole = `input` | `output`

export interface CreateAttachmentRequest {
  id?: string
  bytes: Uint8Array
  mimeType: string
  filename?: string
  subject: {
    type: AttachmentSubjectType
    key: string
  }
  role?: AttachmentRole
  createdBy?: string
  meta?: Record<string, unknown>
}

export interface ReadAttachmentResult {
  attachment: ManifestAttachmentEntry
  bytes: Uint8Array
}

type ManifestAttachmentEntry = {
  key: string
  kind: `attachment`
  id: string
  streamPath: string
  status: `pending` | `complete` | `failed`
  subject: {
    type: AttachmentSubjectType
    key: string
  }
  role: AttachmentRole
  mimeType: string
  filename?: string
  byteLength?: number
  sha256?: string
  createdAt: string
  createdBy?: string
  error?: string
  meta?: Record<string, unknown>
}

function createInitialQueuePosition(date: Date): string {
  return `${String(date.getTime()).padStart(16, `0`)}:a0`
}

type ForkSubtreeOptions = {
  rootInstanceId?: string
  waitTimeoutMs?: number
  waitPollMs?: number
  createdBy?: string
  /**
   * Optional anchor pointing at an event on the source root's `main` stream.
   * When set: only events at or before the pointer are kept on the root's
   * forked `main`, and the root's manifest is filtered so that descendants
   * spawned after the pointer are dropped from the fork (their now-orphan
   * subtrees are not forked). The pointer applies only to the root's
   * `main` stream — `error` and shared-state streams clone at HEAD
   * regardless.
   */
  forkPointer?: EventPointer
}

type ForkEntityPlan = {
  source: ElectricAgentsEntity
  fork: ElectricAgentsEntity
}

type ForkStateSnapshot = {
  manifestsByEntity: Map<string, Map<string, Record<string, unknown>>>
  childStatusesByEntity: Map<string, Map<string, Record<string, unknown>>>
  replayWatermarksByEntity: Map<string, Map<string, Record<string, unknown>>>
  sharedStateIds: Set<string>
}

type ForkResult = {
  root: ElectricAgentsEntity
  entities: Array<ElectricAgentsEntity>
}

const DEFAULT_FORK_WAIT_TIMEOUT_MS = 120_000
const DEFAULT_FORK_WAIT_POLL_MS = 250

const SERVER_SIGNAL_SENDER = `/_electric/server`
const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function maxAttachmentBytes(): number {
  const configured = Number(process.env.ELECTRIC_AGENTS_MAX_ATTACHMENT_BYTES)
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_ATTACHMENT_BYTES
}

function manifestAttachmentKey(id: string): string {
  return `attachment:${id}`
}

function getEntityAttachmentStreamPath(
  entityUrl: string,
  attachmentId: string
): string {
  return `${entityUrl.replace(/\/+$/, ``)}/attachments/${attachmentId}`
}

function isStreamCreateConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === `object` &&
    ((`status` in error && error.status === 409) ||
      (`code` in error && error.code === `CONFLICT_SEQ`))
  )
}

function assertCanonicalAttachmentStreamPath(
  entityUrl: string,
  attachment: ManifestAttachmentEntry
): void {
  const expected = getEntityAttachmentStreamPath(entityUrl, attachment.id)
  if (attachment.streamPath === expected) return
  throw new ElectricAgentsError(
    ErrCodeInvalidRequest,
    `Attachment stream path does not match its entity and id`,
    409
  )
}

function validateAttachmentId(id: string): void {
  if (!id || id.includes(`/`) || id.startsWith(`.`)) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `attachment id must not be empty, start with ".", or contain forward slashes`,
      400
    )
  }
}

function validateAttachmentSubject(
  subject: CreateAttachmentRequest[`subject`]
): void {
  if (!subject.key) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `attachment subject key is required`,
      400
    )
  }
  if (
    subject.type !== `inbox` &&
    subject.type !== `run` &&
    subject.type !== `text` &&
    subject.type !== `tool_call` &&
    subject.type !== `context`
  ) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `invalid attachment subject type`,
      400
    )
  }
}

function concatByteMessages(messages: Array<{ data: Uint8Array }>): Uint8Array {
  const total = messages.reduce((sum, message) => sum + message.data.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const message of messages) {
    bytes.set(message.data, offset)
    offset += message.data.length
  }
  return bytes
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Orchestrates the Electric Agents entity lifecycle: register types, spawn, send, kill.
 *
 * Entity identity is the URL (/{type}/{instance_id}). Entity tags and
 * lifecycle state are persisted directly in Postgres. Durable streams remain
 * the append-only transport for inbox/state events.
 */
export class EntityManager {
  readonly registry: PostgresRegistry
  private readonly tenantId: string
  private streamClient: StreamClient
  private validator: SchemaValidator
  private scheduler: SchedulerClient | null = null
  private entityBridgeManager: EntityBridgeCoordinator | null = null
  private writeTokenValidator: WriteTokenValidator | null = null
  readonly wakeRegistry: WakeRegistry
  private forkWorkLockedEntities = new Map<string, number>()
  private forkWriteLockedEntities = new Map<string, number>()
  private forkWriteLockedStreams = new Map<string, number>()
  private spawnPersistQueue: queueAsPromised<
    SpawnPersistJob,
    SpawnPersistResult
  >
  private readonly stopWakeRegistryOnShutdown: boolean

  constructor(opts: {
    registry: PostgresRegistry
    streamClient: StreamClient
    validator: SchemaValidator
    wakeRegistry: WakeRegistry
    scheduler?: SchedulerClient
    entityBridgeManager?: EntityBridgeCoordinator
    writeTokenValidator?: WriteTokenValidator
    spawnConcurrency?: number
    stopWakeRegistryOnShutdown?: boolean
  }) {
    this.registry = opts.registry
    this.tenantId = opts.registry.tenantId ?? DEFAULT_TENANT_ID
    this.streamClient = opts.streamClient
    this.validator = opts.validator
    this.wakeRegistry = opts.wakeRegistry
    this.scheduler = opts.scheduler ?? null
    this.entityBridgeManager = opts.entityBridgeManager ?? null
    this.writeTokenValidator = opts.writeTokenValidator ?? null
    this.stopWakeRegistryOnShutdown = opts.stopWakeRegistryOnShutdown ?? true

    const spawnConcurrency =
      opts.spawnConcurrency ??
      Number(process.env.ELECTRIC_AGENTS_SPAWN_CONCURRENCY ?? 16)
    this.spawnPersistQueue = fastq.promise<
      unknown,
      SpawnPersistJob,
      SpawnPersistResult
    >(async (job) => job(), spawnConcurrency)

    this.wakeRegistry.setTimeoutCallback((result) => {
      void this.deliverWakeResult(result)
    }, this.tenantId)
    this.wakeRegistry.setDebounceCallback((result) => {
      void this.deliverWakeResult(result)
    }, this.tenantId)
  }

  async rebuildWakeRegistry(
    electricUrl?: string,
    electricSecret?: string
  ): Promise<void> {
    if (electricUrl) {
      await this.wakeRegistry.startSync(electricUrl, electricSecret)
      return
    }

    await this.wakeRegistry.loadRegistrations()
  }

  setWriteTokenValidator(validator: WriteTokenValidator): void {
    this.writeTokenValidator = validator
  }

  isValidWriteToken(entity: ElectricAgentsEntity, token: string): boolean {
    return this.writeTokenValidator
      ? this.writeTokenValidator(entity, token)
      : token === entity.write_token
  }

  private encodeChangeEvent(event: Record<string, unknown>): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(event))
  }

  // ==========================================================================
  // Entity Type Registration
  // ==========================================================================

  async registerEntityType(
    req: RegisterEntityTypeRequest
  ): Promise<ElectricAgentsEntityType> {
    if (!req.name) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Missing required field: name`,
        400
      )
    }
    if (req.name === `principal`) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Entity type "principal" is built in and cannot be registered or updated`,
        400
      )
    }
    if (req.name.startsWith(`_`)) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Entity type names starting with "_" are reserved`,
        400
      )
    }
    if (!req.description) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Missing required field: description`,
        400
      )
    }

    // Validate schema subset for each provided schema.
    this.validateSchema(req.creation_schema)
    this.validateSchemaMap(req.inbox_schemas)
    this.validateSchemaMap(req.state_schemas)
    const defaultDispatchPolicy = req.default_dispatch_policy
      ? this.validateDispatchPolicy(req.default_dispatch_policy, {
          label: `default_dispatch_policy`,
        })
      : undefined

    const existing = await this.registry.getEntityType(req.name)
    const now = new Date().toISOString()
    const entityType: ElectricAgentsEntityType = {
      name: req.name,
      description: req.description,
      creation_schema: req.creation_schema,
      inbox_schemas: req.inbox_schemas,
      state_schemas: req.state_schemas,
      serve_endpoint: req.serve_endpoint,
      default_dispatch_policy: defaultDispatchPolicy,
      revision: existing ? existing.revision + 1 : 1,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }

    await this.registry.createEntityType(entityType)

    const stored = await this.registry.getEntityType(req.name)
    if (!stored) {
      throw new Error(`Failed to read back entity type "${req.name}"`)
    }

    return stored
  }

  async deleteEntityType(name: string): Promise<void> {
    if (name === `principal`) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Entity type "principal" is built in and cannot be deleted`,
        400
      )
    }
    const existing = await this.registry.getEntityType(name)
    if (!existing) {
      throw new ElectricAgentsError(
        ErrCodeNotFound,
        `Entity type "${name}" not found`,
        404
      )
    }

    await this.registry.deleteEntityType(name)
  }

  async ensurePrincipalEntityType(): Promise<ElectricAgentsEntityType> {
    const now = new Date().toISOString()
    return await this.registry.ensureEntityType({
      name: `principal`,
      description: `built-in principal entity`,
      inbox_schemas: { update_identity: principalUpdateIdentityMessageSchema },
      state_schemas: { identity: principalIdentityStateSchema },
      revision: 1,
      created_at: now,
      updated_at: now,
    })
  }

  async ensurePrincipal(principal: Principal): Promise<ElectricAgentsEntity> {
    const existing = await this.registry.getEntity(principal.url)
    if (existing) {
      await this.ensureUserPrincipal(principal)
      return existing
    }
    await this.ensurePrincipalEntityType()
    try {
      const entity = await this.spawn(`principal`, {
        instance_id: principal.key,
        args: { kind: principal.kind, id: principal.id, key: principal.key },
        tags: { principal_kind: principal.kind, principal_id: principal.id },
        created_by: principal.url,
      })
      const now = new Date().toISOString()
      await this.streamClient.append(
        entity.streams.main,
        this.encodeChangeEvent({
          type: `identity`,
          key: `self`,
          value: {
            kind: principal.kind,
            id: principal.id,
            key: principal.key,
            url: principal.url,
            created_at: now,
            updated_at: now,
          },
        })
      )
      await this.ensureUserPrincipal(principal)
      return entity
    } catch (error) {
      if (
        error instanceof ElectricAgentsError &&
        error.code === ErrCodeDuplicateURL
      ) {
        const raced = await this.registry.getEntity(principal.url)
        if (raced) {
          await this.ensureUserPrincipal(principal)
          return raced
        }
      }
      throw error
    }
  }

  private async ensureUserPrincipal(principal: Principal): Promise<void> {
    if (principal.kind === `user`) {
      await this.registry.ensureUserForPrincipal(principal)
    }
  }

  // ==========================================================================
  // Spawn
  // ==========================================================================

  /**
   * Spawn a new entity of the given type with durable streams.
   */
  async spawn(
    typeName: string,
    req: TypedSpawnRequest
  ): Promise<ElectricAgentsEntity & { txid: number }> {
    return await withSpan(`electric_agents.spawn`, async (span) => {
      span.setAttributes({
        [ATTR.ENTITY_TYPE]: typeName,
        ...(req.parent ? { [ATTR.PARENT_URL]: req.parent } : {}),
      })
      const entity = await this.spawnInner(typeName, req)
      span.setAttribute(ATTR.ENTITY_URL, entity.url)
      return entity
    })
  }

  private async spawnInner(
    typeName: string,
    req: TypedSpawnRequest
  ): Promise<ElectricAgentsEntity & { txid: number }> {
    if (
      typeName === `principal` &&
      req.created_by !== principalUrl(req.instance_id)
    ) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Principal entities are built in and can only be materialized by the system`,
        400
      )
    }

    if (typeName.startsWith(`_`)) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Entity type names starting with "_" are reserved`,
        400
      )
    }

    // Look up the entity type from the registry.
    const entityType = await this.registry.getEntityType(typeName)
    if (!entityType) {
      throw new ElectricAgentsError(
        ErrCodeUnknownEntityType,
        `Entity type "${typeName}" not found`,
        404
      )
    }

    // Validate args against creation_schema if declared.
    if (entityType.creation_schema && req.args) {
      const valErr = this.validator.validate(
        entityType.creation_schema,
        req.args
      )
      if (valErr) {
        throw new ElectricAgentsError(
          valErr.code,
          valErr.message,
          422,
          valErr.details
        )
      }
    }

    const initialTags = this.validateTags(req.tags ?? {})

    const instanceId = req.instance_id || randomUUID()
    if (instanceId.includes(`/`)) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `instance_id must not contain forward slashes`,
        400
      )
    }

    const writeToken = randomUUID()

    const entityURL =
      typeName === `principal`
        ? principalUrl(instanceId)
        : `/${typeName}/${instanceId}`
    const mainPath = `${entityURL}/main`
    const errorPath = `${entityURL}/error`

    const subscriptionId = `${typeName}-handler`

    const spawnT0 = performance.now()

    const existingByURL = await this.registry.getEntity(entityURL)
    if (existingByURL) {
      throw new ElectricAgentsError(
        ErrCodeDuplicateURL,
        `Entity already exists at URL "${entityURL}"`,
        409
      )
    }

    let parentEntity: ElectricAgentsEntity | null = null
    if (req.parent) {
      parentEntity = await this.registry.getEntity(req.parent)
      if (!parentEntity) {
        throw new ElectricAgentsError(
          ErrCodeNotFound,
          `Parent entity "${req.parent}" not found`,
          404
        )
      }
    }

    const dispatchPolicy = req.dispatch_policy
      ? this.validateDispatchPolicy(req.dispatch_policy, {
          label: `dispatch_policy`,
        })
      : parentEntity?.dispatch_policy
        ? applyTypeDefaultSubscriptionScope(
            parentEntity.dispatch_policy,
            entityType.default_dispatch_policy
          )
        : entityType.default_dispatch_policy

    const sandbox = await resolveSandboxForSpawn(
      this.registry,
      dispatchPolicy,
      req.sandbox,
      parentEntity
    )

    const now = Date.now()
    const entityData: ElectricAgentsEntity = {
      type: typeName,
      status: `idle`,
      url: entityURL,
      streams: {
        main: mainPath,
        error: errorPath,
      },
      subscription_id: subscriptionId,
      dispatch_policy: dispatchPolicy,
      write_token: writeToken,
      tags: initialTags,
      spawn_args: req.args,
      sandbox,
      type_revision: entityType.revision,
      inbox_schemas: entityType.inbox_schemas,
      state_schemas: entityType.state_schemas,
      created_at: now,
      created_by: req.created_by ?? parentEntity?.created_by,
      updated_at: now,
    }
    if (req.parent) {
      entityData.parent = req.parent
    }

    if (req.wake) {
      await this.wakeRegistry.register({
        tenantId: this.tenantId,
        subscriberUrl: req.wake.subscriberUrl,
        sourceUrl: entityURL,
        condition: req.wake.condition,
        debounceMs: req.wake.debounceMs,
        timeoutMs: req.wake.timeoutMs,
        oneShot: false,
        includeResponse: req.wake.includeResponse,
        manifestKey: req.wake.manifestKey,
      })
    }

    const contentType = `application/json`

    const createdEvent = entityStateSchema.entityCreated.insert({
      key: `entity-created`,
      value: {
        entity_type: typeName,
        timestamp: new Date().toISOString(),
        args: req.args ?? {},
        ...(req.parent ? { parent_url: req.parent } : {}),
      },
    } as any)

    const initialEvents: Array<Record<string, unknown>> = [
      createdEvent as Record<string, unknown>,
    ]

    if (req.initialMessage !== undefined) {
      const msgNow = new Date().toISOString()
      const inboxEvent = entityStateSchema.inbox.insert({
        key: `msg-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        value: {
          from: req.created_by ?? req.parent ?? `spawn`,
          payload: req.initialMessage,
          timestamp: msgNow,
        },
      } as any)
      initialEvents.push(inboxEvent as Record<string, unknown>)
    }

    // JSON-mode streams: server flattens one level. Append auto-wraps the
    // body in [...] but create does not, so we wrap it ourselves.
    const initialBody = `[${initialEvents.map((e) => JSON.stringify(e)).join(`,`)}]`

    const queueEnterT0 = performance.now()
    const queueWaiting = this.spawnPersistQueue.length()
    const queueRunning = this.spawnPersistQueue.running()
    const [mainStreamResult, errorStreamResult, entityResult] =
      await this.spawnPersistQueue.push(async () => {
        // Create entity first so it's visible in the DB before stream
        // creation can trigger webhooks that look up the entity.
        let entityTxid: number
        try {
          entityTxid = await withSpan(`db.createEntity`, () =>
            this.registry.createEntity(entityData)
          )
        } catch (err) {
          return [
            { status: `fulfilled`, value: undefined },
            { status: `fulfilled`, value: undefined },
            { status: `rejected`, reason: err },
          ] as SpawnPersistResult
        }

        const [mainStreamResult, errorStreamResult] = await Promise.allSettled([
          this.streamClient.create(mainPath, {
            contentType,
            body: initialBody,
          }),
          this.streamClient.create(errorPath, { contentType }),
        ])

        return [
          mainStreamResult,
          errorStreamResult,
          { status: `fulfilled`, value: entityTxid },
        ] as SpawnPersistResult
      })
    const parallelMs = +(performance.now() - queueEnterT0).toFixed(2)

    if (
      mainStreamResult.status === `rejected` ||
      errorStreamResult.status === `rejected` ||
      entityResult.status === `rejected`
    ) {
      const entityReason =
        entityResult.status === `rejected` ? entityResult.reason : null
      const streamReason =
        mainStreamResult.status === `rejected`
          ? mainStreamResult.reason
          : errorStreamResult.status === `rejected`
            ? errorStreamResult.reason
            : null
      const isDuplicate = entityReason instanceof EntityAlreadyExistsError
      const isStreamConflict =
        !!streamReason &&
        typeof streamReason === `object` &&
        ((`status` in streamReason && streamReason.status === 409) ||
          (`code` in streamReason && streamReason.code === `CONFLICT_SEQ`))

      const rollbacks: Array<Promise<unknown>> = []
      // On duplicate, the winning spawn owns both the stream and the row —
      // don't roll back either. For any other failure, clean up what succeeded.
      if (!isDuplicate && !isStreamConflict) {
        if (mainStreamResult.status === `fulfilled`) {
          rollbacks.push(this.streamClient.delete(mainPath))
        }
        if (errorStreamResult.status === `fulfilled`) {
          rollbacks.push(this.streamClient.delete(errorPath))
        }
        if (entityResult.status === `fulfilled`) {
          rollbacks.push(this.registry.deleteEntity(entityURL))
        }
        if (req.wake) {
          rollbacks.push(
            this.wakeRegistry.unregisterBySubscriberAndSource(
              req.wake.subscriberUrl,
              entityURL,
              this.tenantId
            )
          )
        }
        await Promise.allSettled(rollbacks)
      }

      if (isDuplicate || isStreamConflict) {
        throw new ElectricAgentsError(
          ErrCodeDuplicateURL,
          `Entity already exists at URL "${entityURL}"`,
          409
        )
      }

      const failure =
        mainStreamResult.status === `rejected`
          ? mainStreamResult.reason
          : errorStreamResult.status === `rejected`
            ? errorStreamResult.reason
            : (entityResult as PromiseRejectedResult).reason
      if (failure instanceof Error) throw failure
      throw new ElectricAgentsError(
        `SPAWN_FAILED`,
        `Spawn failed: ${String(failure)}`,
        500
      )
    }

    const txid = entityResult.value

    serverLog.event(
      {
        event: `spawn`,
        url: entityURL,
        type: typeName,
        parent: req.parent,
        parallelMs,
        totalMs: +(performance.now() - spawnT0).toFixed(2),
        queueWaiting,
        queueRunning,
      },
      `spawn done`
    )
    return { ...entityData, txid }
  }

  // ==========================================================================
  // Fork
  // ==========================================================================

  async forkSubtree(
    rootUrl: string,
    opts: ForkSubtreeOptions = {}
  ): Promise<ForkResult> {
    return await withSpan(`electric_agents.forkSubtree`, async (span) => {
      span.setAttribute(ATTR.ENTITY_URL, rootUrl)
      const result = await this.forkSubtreeInner(rootUrl, opts)
      span.setAttribute(`electric_agents.fork.root_url`, result.root.url)
      span.setAttribute(
        `electric_agents.fork.entity_count`,
        result.entities.length
      )
      return result
    })
  }

  private async forkSubtreeInner(
    rootUrl: string,
    opts: ForkSubtreeOptions
  ): Promise<ForkResult> {
    const forkT0 = performance.now()
    const workLocks = new Set<string>()
    const writeEntityLocks = new Set<string>()
    const writeStreamLocks = new Set<string>()

    try {
      // For pointer-forks we read the source root HISTORICALLY at a
      // frozen offset, so concurrent activity on the root past the
      // pointer can't tear our snapshot — we don't need to wait for
      // the root to be idle (which would block the "click fork right
      // after the response landed" case, since the runtime keeps the
      // worker warm for `idleTimeout`). We still wait+lock any kept
      // descendants below (after `computeEffectiveSubtree` runs), since
      // those are HEAD-cloned and need a stable snapshot. For HEAD-forks
      // the old all-idle requirement still applies.
      let sourceTree: Array<ElectricAgentsEntity>
      if (opts.forkPointer) {
        const rootEntity = await this.registry.getEntity(rootUrl)
        if (!rootEntity) {
          throw new ElectricAgentsError(
            ErrCodeNotFound,
            `Entity not found`,
            404
          )
        }
        if (isTerminalEntityStatus(rootEntity.status)) {
          throw new ElectricAgentsError(
            ErrCodeNotRunning,
            `Cannot fork terminal entity "${rootEntity.url}"`,
            409
          )
        }
        sourceTree = await this.listEntitySubtree(rootEntity)
      } else {
        sourceTree = await this.waitForIdleSubtree(rootUrl, opts, workLocks)
      }
      const sourceRoot = sourceTree[0]!
      if (sourceRoot.parent) {
        throw new ElectricAgentsError(
          ErrCodeInvalidRequest,
          `Only top-level entities can be forked`,
          400
        )
      }

      // When forking at a pointer, pre-read the root's main, validate the
      // pointer against the source's true history, and materialise the
      // root-at-pointer snapshot fragments. The pointer only applies to
      // the root's `main` stream. Descendants kept by the manifest filter
      // are forked at HEAD.
      //
      // Pointer→position translation: the runtime mints pointers as
      // `{ offset: previousBatchOffset, subOffset: itemIndex+1 }`, where
      // the anchor offset is the END of the delivery batch that
      // PRECEDED the targeted event. The durable-streams server
      // interprets `{ X, N }` as "from offset X, take N flattened
      // messages forward" — independent of how delivery is chunked. We
      // mirror that interpretation here by translating the pointer to a
      // 1-indexed CUMULATIVE position in the source's flattened
      // history, then filtering events with position ≤ that target.
      let preFilteredRoot:
        | {
            manifests: Map<string, Record<string, unknown>>
            childStatuses: Map<string, Record<string, unknown>>
            replayWatermarks: Map<string, Record<string, unknown>>
            sharedStateIds: Set<string>
          }
        | undefined
      if (opts.forkPointer) {
        const sourceEvents = await this.streamClient.readJson<
          Record<string, unknown>
        >(sourceRoot.streams.main)
        const flat = sourceEvents.flatMap((item) =>
          Array.isArray(item) ? item : [item]
        ) as Array<Record<string, unknown>>
        const target = this.resolveForkPointerTarget(
          flat,
          opts.forkPointer,
          sourceRoot.streams.main
        )
        const filteredEvents = flat.slice(0, target)
        const rootManifests = this.reduceStateRows(filteredEvents, `manifest`)
        const sharedStateIds = new Set<string>()
        for (const manifest of rootManifests.values()) {
          this.collectSharedStateIds(manifest, sharedStateIds)
        }
        preFilteredRoot = {
          manifests: rootManifests,
          childStatuses: this.reduceStateRows(filteredEvents, `child_status`),
          replayWatermarks: this.reduceStateRows(
            filteredEvents,
            `replay_watermark`
          ),
          sharedStateIds,
        }
      }

      const effectiveSubtree = preFilteredRoot
        ? this.computeEffectiveSubtree(
            sourceTree,
            sourceRoot.url,
            preFilteredRoot.manifests
          )
        : sourceTree

      // For pointer-forks, kept descendants (everything in the effective
      // subtree except the root) are HEAD-cloned, so they must be idle
      // before we read their snapshots. Wait+lock only those — the root
      // was skipped above.
      if (opts.forkPointer) {
        const descendants = effectiveSubtree.filter(
          (entity) => entity.url !== sourceRoot.url
        )
        if (descendants.length > 0) {
          await this.waitForGivenEntitiesIdle(descendants, opts, workLocks)
        }
      }

      const snapshot = await this.readForkStateSnapshot(
        // Skip the root when we've already pre-filtered it — avoid both a
        // wasted HEAD read of main and a re-population that would clobber
        // the filtered entries.
        preFilteredRoot
          ? effectiveSubtree.filter((entity) => entity.url !== sourceRoot.url)
          : effectiveSubtree
      )
      if (preFilteredRoot) {
        snapshot.manifestsByEntity.set(
          sourceRoot.url,
          preFilteredRoot.manifests
        )
        snapshot.childStatusesByEntity.set(
          sourceRoot.url,
          preFilteredRoot.childStatuses
        )
        snapshot.replayWatermarksByEntity.set(
          sourceRoot.url,
          preFilteredRoot.replayWatermarks
        )
        for (const id of preFilteredRoot.sharedStateIds) {
          snapshot.sharedStateIds.add(id)
        }
      }

      const suffix = randomUUID().slice(0, 8)
      const entityUrlMap = await this.buildForkEntityUrlMap(effectiveSubtree, {
        suffix,
        rootUrl,
        rootInstanceId: opts.rootInstanceId,
      })
      const sharedStateIdMap = await this.buildForkSharedStateIdMap(
        snapshot.sharedStateIds,
        suffix
      )
      const stringMap = this.buildForkStringMap(entityUrlMap, sharedStateIdMap)
      const entityPlans = this.buildForkEntityPlans(
        effectiveSubtree,
        entityUrlMap,
        stringMap,
        opts.createdBy
      )

      this.addForkLocks(
        this.forkWriteLockedEntities,
        effectiveSubtree.map((entity) => entity.url),
        writeEntityLocks
      )
      this.addForkLocks(
        this.forkWriteLockedStreams,
        [...snapshot.sharedStateIds].map((id) => getSharedStateStreamPath(id)),
        writeStreamLocks
      )

      const createdStreams: Array<string> = []
      const createdEntities: Array<string> = []
      const activeManifestsByEntity = new Map<
        string,
        Map<string, Record<string, unknown>>
      >()

      try {
        for (const plan of entityPlans) {
          const isRoot = plan.source.url === rootUrl
          await this.streamClient.fork(
            plan.fork.streams.main,
            plan.source.streams.main,
            isRoot && opts.forkPointer
              ? { forkPointer: opts.forkPointer }
              : undefined
          )
          createdStreams.push(plan.fork.streams.main)
          // `error` always clones at HEAD — no canonical mapping
          // between main-offset and error-offset.
          await this.streamClient.fork(
            plan.fork.streams.error,
            plan.source.streams.error
          )
          createdStreams.push(plan.fork.streams.error)
        }

        for (const [sourceId, forkId] of sharedStateIdMap) {
          const sourcePath = getSharedStateStreamPath(sourceId)
          const forkPath = getSharedStateStreamPath(forkId)
          await this.streamClient.fork(forkPath, sourcePath)
          createdStreams.push(forkPath)
        }

        for (const plan of entityPlans) {
          const manifests =
            snapshot.manifestsByEntity.get(plan.source.url) ?? new Map()
          for (const manifest of manifests.values()) {
            if (
              manifest.kind !== `attachment` ||
              typeof manifest.streamPath !== `string` ||
              typeof manifest.id !== `string`
            ) {
              continue
            }
            const forkPath = getEntityAttachmentStreamPath(
              plan.fork.url,
              manifest.id
            )
            await this.streamClient.fork(forkPath, manifest.streamPath)
            createdStreams.push(forkPath)
          }
        }

        for (const plan of entityPlans) {
          const reconciliation = this.buildForkReconciliation(
            plan,
            snapshot,
            entityUrlMap,
            sharedStateIdMap,
            stringMap
          )
          activeManifestsByEntity.set(plan.fork.url, reconciliation.manifests)
          for (const event of reconciliation.events) {
            await this.streamClient.append(
              plan.fork.streams.main,
              this.encodeChangeEvent(event)
            )
          }
        }

        for (const plan of entityPlans) {
          await this.registry.createEntity(plan.fork)
          createdEntities.push(plan.fork.url)
        }

        for (const plan of entityPlans) {
          const manifests =
            activeManifestsByEntity.get(plan.fork.url) ?? new Map()
          await this.materializeForkManifestSideEffects(
            plan.fork.url,
            manifests
          )
        }

        const root = entityPlans.find(
          (plan) => plan.source.url === rootUrl
        )!.fork
        serverLog.event(
          {
            event: `fork`,
            url: rootUrl,
            forkUrl: root.url,
            entities: entityPlans.length,
            sharedStateStreams: sharedStateIdMap.size,
            totalMs: +(performance.now() - forkT0).toFixed(2),
          },
          `fork done`
        )
        return { root, entities: entityPlans.map((plan) => plan.fork) }
      } catch (err) {
        await Promise.allSettled([
          ...createdEntities.flatMap((entityUrl) => [
            this.wakeRegistry.unregisterBySubscriber(entityUrl, this.tenantId),
            this.wakeRegistry.unregisterBySource(entityUrl, this.tenantId),
            this.registry.deleteEntity(entityUrl),
          ]),
          ...Array.from(sharedStateIdMap.values()).map((id) =>
            this.wakeRegistry.unregisterBySource(
              getSharedStateStreamPath(id),
              this.tenantId
            )
          ),
          ...createdStreams.map((streamPath) =>
            this.streamClient.delete(streamPath)
          ),
        ])
        throw err
      } finally {
        this.releaseForkLocks(this.forkWriteLockedStreams, writeStreamLocks)
        this.releaseForkLocks(this.forkWriteLockedEntities, writeEntityLocks)
      }
    } finally {
      this.releaseForkLocks(this.forkWorkLockedEntities, workLocks)
    }
  }

  isForkWorkLockedEntity(entityUrl: string): boolean {
    return (this.forkWorkLockedEntities.get(entityUrl) ?? 0) > 0
  }

  isForkWriteLockedEntity(entityUrl: string): boolean {
    return (this.forkWriteLockedEntities.get(entityUrl) ?? 0) > 0
  }

  isForkWriteLockedStream(streamPath: string): boolean {
    return (this.forkWriteLockedStreams.get(streamPath) ?? 0) > 0
  }

  private assertEntityNotForkWorkLocked(entityUrl: string): void {
    if (!this.isForkWorkLockedEntity(entityUrl)) return
    throw new ElectricAgentsError(
      ErrCodeForkInProgress,
      `Entity subtree is being forked`,
      409
    )
  }

  private addForkLocks(
    locks: Map<string, number>,
    keys: Array<string>,
    held: Set<string>
  ): void {
    for (const key of keys) {
      if (held.has(key)) continue
      locks.set(key, (locks.get(key) ?? 0) + 1)
      held.add(key)
    }
  }

  private releaseForkLocks(
    locks: Map<string, number>,
    held: Set<string>
  ): void {
    for (const key of held) {
      const count = locks.get(key) ?? 0
      if (count <= 1) {
        locks.delete(key)
      } else {
        locks.set(key, count - 1)
      }
    }
    held.clear()
  }

  /**
   * Variant of {@link waitForIdleSubtree} that takes an explicit entity
   * list instead of walking the registry from `rootUrl`. Used by the
   * pointer-fork path to wait+lock only the kept descendants, since
   * the root is being forked from history and doesn't need to be idle.
   */
  private async waitForGivenEntitiesIdle(
    entities: ReadonlyArray<ElectricAgentsEntity>,
    opts: ForkSubtreeOptions,
    workLocks: Set<string>
  ): Promise<void> {
    if (entities.length === 0) return

    const timeoutMs = opts.waitTimeoutMs ?? DEFAULT_FORK_WAIT_TIMEOUT_MS
    const pollMs = opts.waitPollMs ?? DEFAULT_FORK_WAIT_POLL_MS

    const refresh = async (): Promise<Array<ElectricAgentsEntity>> => {
      const refreshed = await Promise.all(
        entities.map((entity) => this.registry.getEntity(entity.url))
      )
      return refreshed.filter(
        (entity): entity is ElectricAgentsEntity => !!entity
      )
    }

    const deadline = Date.now() + timeoutMs
    while (true) {
      const present = await refresh()
      const stopped = present.find((entity) =>
        isTerminalEntityStatus(entity.status)
      )
      if (stopped) {
        throw new ElectricAgentsError(
          ErrCodeNotRunning,
          `Cannot fork terminal entity "${stopped.url}"`,
          409
        )
      }
      let active = present.filter(
        (entity) => entity.status !== `idle` && entity.status !== `paused`
      )
      if (active.length === 0) {
        this.addForkLocks(
          this.forkWorkLockedEntities,
          present.map((entity) => entity.url),
          workLocks
        )
        const reChecked = await refresh()
        const reActive = reChecked.filter(
          (entity) => entity.status !== `idle` && entity.status !== `paused`
        )
        if (reActive.length === 0) return
        this.releaseForkLocks(this.forkWorkLockedEntities, workLocks)
        active = reActive
      }
      if (Date.now() >= deadline) {
        throw new ElectricAgentsError(
          ErrCodeForkWaitTimeout,
          `Timed out waiting for descendants to become idle`,
          409,
          { active: active.map((entity) => entity.url) }
        )
      }
      await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    }
  }

  private async waitForIdleSubtree(
    rootUrl: string,
    opts: ForkSubtreeOptions,
    workLocks: Set<string>
  ): Promise<Array<ElectricAgentsEntity>> {
    const timeoutMs = opts.waitTimeoutMs ?? DEFAULT_FORK_WAIT_TIMEOUT_MS
    const pollMs = opts.waitPollMs ?? DEFAULT_FORK_WAIT_POLL_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `waitTimeoutMs must be a non-negative number`,
        400
      )
    }
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `waitPollMs must be a positive number`,
        400
      )
    }

    const deadline = Date.now() + timeoutMs
    while (true) {
      const root = await this.registry.getEntity(rootUrl)
      if (!root) {
        throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
      }
      if (root.parent) {
        throw new ElectricAgentsError(
          ErrCodeInvalidRequest,
          `Only top-level entities can be forked`,
          400
        )
      }

      const subtree = await this.listEntitySubtree(root)
      const stopped = subtree.find((entity) =>
        isTerminalEntityStatus(entity.status)
      )
      if (stopped) {
        throw new ElectricAgentsError(
          ErrCodeNotRunning,
          `Cannot fork terminal entity "${stopped.url}"`,
          409
        )
      }

      let active = subtree.filter(
        (entity) => entity.status !== `idle` && entity.status !== `paused`
      )
      if (active.length === 0) {
        this.addForkLocks(
          this.forkWorkLockedEntities,
          subtree.map((entity) => entity.url),
          workLocks
        )
        const lockedRoot = await this.registry.getEntity(rootUrl)
        if (!lockedRoot) {
          throw new ElectricAgentsError(
            ErrCodeNotFound,
            `Entity not found`,
            404
          )
        }
        const lockedSubtree = await this.listEntitySubtree(lockedRoot)
        this.addForkLocks(
          this.forkWorkLockedEntities,
          lockedSubtree.map((entity) => entity.url),
          workLocks
        )
        const lockedActive = lockedSubtree.filter(
          (entity) => entity.status !== `idle` && entity.status !== `paused`
        )
        if (lockedActive.length === 0) {
          return lockedSubtree
        }
        this.releaseForkLocks(this.forkWorkLockedEntities, workLocks)
        active = lockedActive
      }

      if (Date.now() >= deadline) {
        throw new ElectricAgentsError(
          ErrCodeForkWaitTimeout,
          `Timed out waiting for subtree to become idle`,
          409,
          { active: active.map((entity) => entity.url) }
        )
      }

      await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    }
  }

  /**
   * Translate `forkPointer` into a 1-indexed CUMULATIVE position in the
   * source's flattened history. Throws a 400 if the pointer doesn't
   * address a real event.
   *
   * Semantics (mirroring the durable-streams server interpretation):
   * `{ offset: X, subOffset: N }` means "from anchor X, take N flattened
   * messages forward." Concretely, the target event is the N-th event
   * after the last event whose `headers.offset` is ≤ X. (When `X` is
   * `null`, the anchor is the stream start and the target is the N-th
   * event from the very beginning.) The returned position is the count
   * of events to KEEP — events 1..position survive the filter.
   *
   * A pointer is valid when:
   *   - `pointer.offset` is `null` (stream start) OR matches some
   *     event's `headers.offset` value, AND
   *   - `pointer.subOffset` is in `[1, total events past the anchor]`.
   */
  private resolveForkPointerTarget(
    events: ReadonlyArray<Record<string, unknown>>,
    pointer: EventPointer,
    streamPath: string
  ): number {
    // Count events at-or-before the anchor and validate the anchor exists.
    // `pointer.offset === null` is the stream-start anchor — no events
    // precede it, so `positionAtAnchor` stays at 0.
    let positionAtAnchor = 0
    let anchorSeen = pointer.offset === null
    for (const event of events) {
      const headers = isRecord(event.headers) ? event.headers : undefined
      const eventOffset =
        typeof headers?.offset === `string` ? headers.offset : undefined
      if (eventOffset === undefined) continue
      if (pointer.offset === null) continue
      if (eventOffset === pointer.offset) anchorSeen = true
      if (eventOffset <= pointer.offset) positionAtAnchor++
    }
    if (!anchorSeen) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `fork_pointer.offset (${pointer.offset ?? `<stream-start>`}) does not match any event's Stream-Next-Offset on ${streamPath}`,
        400
      )
    }
    const eventsPastAnchor = events.length - positionAtAnchor
    if (pointer.subOffset < 1 || pointer.subOffset > eventsPastAnchor) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `fork_pointer.sub_offset ${pointer.subOffset} out of range past anchor on ${streamPath} (valid: 1..${eventsPastAnchor})`,
        400
      )
    }
    return positionAtAnchor + pointer.subOffset
  }

  /**
   * Compute the subset of `sourceTree` that survives the manifest filter
   * applied at the root. After filtering the root's manifest at the fork
   * pointer, only children whose manifest entries landed at or before the
   * pointer remain; those kept children carry their CURRENT (HEAD) subtree
   * along with them. Children dropped from the root's manifest, and any
   * of their descendants, are excluded.
   */
  private computeEffectiveSubtree(
    sourceTree: ReadonlyArray<ElectricAgentsEntity>,
    rootUrl: string,
    filteredRootManifests: ReadonlyMap<string, Record<string, unknown>>
  ): Array<ElectricAgentsEntity> {
    const keptChildUrls = new Set<string>()
    for (const value of filteredRootManifests.values()) {
      if (value.kind === `child` && typeof value.entity_url === `string`) {
        keptChildUrls.add(value.entity_url)
      }
    }

    const childrenByParent = new Map<string, Array<ElectricAgentsEntity>>()
    for (const entity of sourceTree) {
      if (!entity.parent) continue
      const list = childrenByParent.get(entity.parent) ?? []
      list.push(entity)
      childrenByParent.set(entity.parent, list)
    }

    const rootEntity = sourceTree.find((e) => e.url === rootUrl)
    if (!rootEntity) return []

    const result: Array<ElectricAgentsEntity> = [rootEntity]
    const queue: Array<ElectricAgentsEntity> = []
    for (const child of childrenByParent.get(rootUrl) ?? []) {
      if (keptChildUrls.has(child.url)) {
        queue.push(child)
      }
    }
    const seen = new Set<string>([rootUrl])
    while (queue.length > 0) {
      const entity = queue.shift()!
      if (seen.has(entity.url)) continue
      seen.add(entity.url)
      result.push(entity)
      // Below the kept-children level the existing recursive subtree is
      // included unchanged — kept descendants are HEAD-cloned.
      for (const grandchild of childrenByParent.get(entity.url) ?? []) {
        if (!seen.has(grandchild.url)) {
          queue.push(grandchild)
        }
      }
    }
    return result
  }

  private async listEntitySubtree(
    root: ElectricAgentsEntity
  ): Promise<Array<ElectricAgentsEntity>> {
    const result: Array<ElectricAgentsEntity> = []
    const queue: Array<ElectricAgentsEntity> = [root]
    const seen = new Set<string>()

    while (queue.length > 0) {
      const entity = queue.shift()!
      if (seen.has(entity.url)) continue
      seen.add(entity.url)
      result.push(entity)

      const { entities: children } = await this.registry.listEntities({
        parent: entity.url,
        limit: 10_000,
      })
      for (const child of children) {
        queue.push(child)
      }
    }

    return result
  }

  private async readForkStateSnapshot(
    entitiesToFork: Array<ElectricAgentsEntity>
  ): Promise<ForkStateSnapshot> {
    const manifestsByEntity = new Map<
      string,
      Map<string, Record<string, unknown>>
    >()
    const childStatusesByEntity = new Map<
      string,
      Map<string, Record<string, unknown>>
    >()
    const replayWatermarksByEntity = new Map<
      string,
      Map<string, Record<string, unknown>>
    >()
    const sharedStateIds = new Set<string>()

    for (const entity of entitiesToFork) {
      const events = await this.streamClient.readJson<Record<string, unknown>>(
        entity.streams.main
      )
      const manifests = this.reduceStateRows(events, `manifest`)
      const childStatuses = this.reduceStateRows(events, `child_status`)
      const replayWatermarks = this.reduceStateRows(events, `replay_watermark`)

      manifestsByEntity.set(entity.url, manifests)
      childStatusesByEntity.set(entity.url, childStatuses)
      replayWatermarksByEntity.set(entity.url, replayWatermarks)

      for (const manifest of manifests.values()) {
        this.collectSharedStateIds(manifest, sharedStateIds)
      }
    }

    return {
      manifestsByEntity,
      childStatusesByEntity,
      replayWatermarksByEntity,
      sharedStateIds,
    }
  }

  private reduceStateRows(
    rawEvents: Array<unknown>,
    eventType: string
  ): Map<string, Record<string, unknown>> {
    const rows = new Map<string, Record<string, unknown>>()
    const events = rawEvents.flatMap((item) =>
      Array.isArray(item) ? item : [item]
    )

    for (const event of events) {
      if (!isRecord(event) || event.type !== eventType) continue
      if (typeof event.key !== `string`) continue
      const headers = isRecord(event.headers) ? event.headers : undefined
      const operation = headers?.operation
      if (operation === `delete`) {
        rows.delete(event.key)
        continue
      }
      if (isRecord(event.value)) {
        rows.set(event.key, cloneRecord(event.value))
      }
    }

    return rows
  }

  private collectSharedStateIds(
    manifest: Record<string, unknown>,
    sharedStateIds: Set<string>
  ): void {
    if (manifest.kind === `shared-state` && typeof manifest.id === `string`) {
      sharedStateIds.add(manifest.id)
      return
    }

    if (manifest.kind !== `source` || manifest.sourceType !== `db`) {
      return
    }

    if (typeof manifest.sourceRef === `string`) {
      sharedStateIds.add(manifest.sourceRef)
    }
    const config = isRecord(manifest.config) ? manifest.config : undefined
    if (typeof config?.id === `string`) {
      sharedStateIds.add(config.id)
    }
  }

  private async buildForkEntityUrlMap(
    entitiesToFork: Array<ElectricAgentsEntity>,
    opts: { suffix: string; rootUrl: string; rootInstanceId?: string }
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const reserved = new Set<string>()

    for (const entity of entitiesToFork) {
      const { type, instanceId } = this.parseEntityUrl(entity.url)
      const rootRequestedId =
        entity.url === opts.rootUrl ? opts.rootInstanceId : undefined
      const baseId = rootRequestedId ?? `${instanceId}-fork-${opts.suffix}`
      const forkUrl = await this.reserveForkEntityUrl(type, baseId, reserved, {
        exact: rootRequestedId !== undefined,
      })
      map.set(entity.url, forkUrl)
    }

    return map
  }

  private async reserveForkEntityUrl(
    type: string,
    baseId: string,
    reserved: Set<string>,
    opts?: { exact?: boolean }
  ): Promise<string> {
    if (!baseId || baseId.includes(`/`)) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Fork instance_id must not be empty or contain forward slashes`,
        400
      )
    }

    let attempt = 0
    while (true) {
      const instanceId = attempt === 0 ? baseId : `${baseId}-${attempt}`
      const url = `/${type}/${instanceId}`
      const exists = reserved.has(url) || (await this.registry.getEntity(url))
      if (!exists) {
        reserved.add(url)
        return url
      }
      if (opts?.exact) {
        throw new ElectricAgentsError(
          ErrCodeDuplicateURL,
          `Entity already exists at URL "${url}"`,
          409
        )
      }
      attempt += 1
    }
  }

  private async buildForkSharedStateIdMap(
    sourceIds: Set<string>,
    suffix: string
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const reserved = new Set<string>()

    for (const sourceId of [...sourceIds].sort()) {
      const baseId = `${sourceId}-fork-${suffix}`
      let attempt = 0
      while (true) {
        const candidate = attempt === 0 ? baseId : `${baseId}-${attempt}`
        const path = getSharedStateStreamPath(candidate)
        if (
          !reserved.has(candidate) &&
          !(await this.streamClient.exists(path))
        ) {
          reserved.add(candidate)
          map.set(sourceId, candidate)
          break
        }
        attempt += 1
      }
    }

    return map
  }

  private buildForkStringMap(
    entityUrlMap: Map<string, string>,
    sharedStateIdMap: Map<string, string>
  ): Map<string, string> {
    const stringMap = new Map<string, string>()
    for (const [sourceUrl, forkUrl] of entityUrlMap) {
      stringMap.set(sourceUrl, forkUrl)
      stringMap.set(`${sourceUrl}/main`, `${forkUrl}/main`)
      stringMap.set(`${sourceUrl}/error`, `${forkUrl}/error`)
    }
    for (const [sourceId, forkId] of sharedStateIdMap) {
      stringMap.set(sourceId, forkId)
      stringMap.set(
        getSharedStateStreamPath(sourceId),
        getSharedStateStreamPath(forkId)
      )
    }
    return stringMap
  }

  private buildForkEntityPlans(
    entitiesToFork: Array<ElectricAgentsEntity>,
    entityUrlMap: Map<string, string>,
    stringMap: Map<string, string>,
    createdBy?: string
  ): Array<ForkEntityPlan> {
    const now = Date.now()
    return entitiesToFork.map((source) => {
      const forkUrl = entityUrlMap.get(source.url)
      if (!forkUrl) {
        throw new Error(`Missing fork URL for ${source.url}`)
      }
      const { type } = this.parseEntityUrl(forkUrl)
      const parent = source.parent ? entityUrlMap.get(source.parent) : undefined
      const spawnArgs = isRecord(source.spawn_args)
        ? (this.remapJsonValue(source.spawn_args, stringMap) as Record<
            string,
            unknown
          >)
        : source.spawn_args

      const fork: ElectricAgentsEntity = {
        ...source,
        url: forkUrl,
        type,
        status: `idle`,
        streams: {
          main: `${forkUrl}/main`,
          error: `${forkUrl}/error`,
        },
        subscription_id: `${type}-handler`,
        write_token: randomUUID(),
        spawn_args: spawnArgs,
        parent,
        created_by: createdBy ?? source.created_by,
        created_at: now,
        updated_at: now,
      }
      if (!parent) {
        delete fork.parent
      }

      return { source, fork }
    })
  }

  private buildForkReconciliation(
    plan: ForkEntityPlan,
    snapshot: ForkStateSnapshot,
    entityUrlMap: Map<string, string>,
    sharedStateIdMap: Map<string, string>,
    stringMap: Map<string, string>
  ): {
    events: Array<Record<string, unknown>>
    manifests: Map<string, Record<string, unknown>>
  } {
    const txid = `fork-${randomUUID()}`
    const headers = {
      txid,
      forkedFrom: plan.source.url,
    }
    const events: Array<Record<string, unknown>> = [
      entityStateSchema.entityCreated.update({
        key: `entity-created`,
        value: omitUndefined({
          entity_type: plan.fork.type,
          timestamp: new Date().toISOString(),
          args: plan.fork.spawn_args ?? {},
          parent_url: plan.fork.parent,
        }),
        headers,
      } as any) as Record<string, unknown>,
    ]

    const activeManifests = new Map<string, Record<string, unknown>>()
    const sourceManifests =
      snapshot.manifestsByEntity.get(plan.source.url) ?? new Map()
    for (const [key, value] of sourceManifests) {
      const remapped = this.remapManifestEntry(
        key,
        value,
        entityUrlMap,
        sharedStateIdMap
      )
      activeManifests.set(remapped.key, remapped.value)
      if (!remapped.changed) {
        continue
      }

      if (remapped.key !== key) {
        events.push(
          entityStateSchema.manifests.delete({
            key,
            headers,
          } as any) as Record<string, unknown>
        )
        events.push(
          entityStateSchema.manifests.insert({
            key: remapped.key,
            value: remapped.value as any,
            headers,
          } as any) as Record<string, unknown>
        )
      } else {
        events.push(
          entityStateSchema.manifests.update({
            key,
            value: remapped.value as any,
            headers,
          } as any) as Record<string, unknown>
        )
      }
    }

    const childStatuses =
      snapshot.childStatusesByEntity.get(plan.source.url) ?? new Map()
    for (const [key, value] of childStatuses) {
      const remapped = this.remapChildStatus(value, entityUrlMap)
      if (!remapped) continue
      events.push(
        entityStateSchema.childStatus.update({
          key,
          value: remapped as any,
          headers,
        } as any) as Record<string, unknown>
      )
    }

    const replayWatermarks =
      snapshot.replayWatermarksByEntity.get(plan.source.url) ?? new Map()
    for (const [key, value] of replayWatermarks) {
      const remapped = this.remapReplayWatermark(key, value, stringMap)
      if (!remapped) continue
      if (remapped.key !== key) {
        events.push(
          entityStateSchema.replayWatermarks.delete({
            key,
            headers,
          } as any) as Record<string, unknown>
        )
        events.push(
          entityStateSchema.replayWatermarks.insert({
            key: remapped.key,
            value: remapped.value as any,
            headers,
          } as any) as Record<string, unknown>
        )
      } else {
        events.push(
          entityStateSchema.replayWatermarks.update({
            key,
            value: remapped.value as any,
            headers,
          } as any) as Record<string, unknown>
        )
      }
    }

    return { events, manifests: activeManifests }
  }

  private remapManifestEntry(
    key: string,
    value: Record<string, unknown>,
    entityUrlMap: Map<string, string>,
    sharedStateIdMap: Map<string, string>
  ): {
    key: string
    value: Record<string, unknown>
    changed: boolean
  } {
    const next = cloneRecord(value)

    if (next.kind === `child` && typeof next.entity_url === `string`) {
      const forkUrl = entityUrlMap.get(next.entity_url)
      if (!forkUrl) return { key, value: next, changed: false }
      const { instanceId } = this.parseEntityUrl(forkUrl)
      next.id = instanceId
      next.entity_url = forkUrl
      next.key = manifestChildKey(String(next.entity_type), instanceId)
      return { key: String(next.key), value: next, changed: true }
    }

    if (next.kind === `shared-state` && typeof next.id === `string`) {
      const forkId = sharedStateIdMap.get(next.id)
      if (!forkId) return { key, value: next, changed: false }
      next.id = forkId
      next.key = manifestSharedStateKey(forkId)
      return { key: String(next.key), value: next, changed: true }
    }

    if (next.kind === `source` && next.sourceType === `entity`) {
      const config = isRecord(next.config) ? next.config : {}
      const sourceUrl =
        typeof config.entityUrl === `string`
          ? config.entityUrl
          : typeof next.sourceRef === `string`
            ? next.sourceRef
            : undefined
      const forkUrl = sourceUrl ? entityUrlMap.get(sourceUrl) : undefined
      if (!forkUrl) return { key, value: next, changed: false }
      const { type } = this.parseEntityUrl(forkUrl)
      next.sourceRef = forkUrl
      next.key = manifestSourceKey(`entity`, forkUrl)
      next.config = {
        ...config,
        entityUrl: forkUrl,
        streamPath: `${forkUrl}/main`,
        entityType: type,
      }
      return { key: String(next.key), value: next, changed: true }
    }

    if (next.kind === `source` && next.sourceType === `db`) {
      const config = isRecord(next.config) ? next.config : {}
      const sourceId =
        typeof next.sourceRef === `string`
          ? next.sourceRef
          : typeof config.id === `string`
            ? config.id
            : undefined
      const forkId = sourceId ? sharedStateIdMap.get(sourceId) : undefined
      if (!forkId) return { key, value: next, changed: false }
      next.sourceRef = forkId
      next.key = manifestSourceKey(`db`, forkId)
      next.config = {
        ...config,
        id: forkId,
      }
      return { key: String(next.key), value: next, changed: true }
    }

    if (
      next.kind === `attachment` &&
      typeof next.streamPath === `string` &&
      typeof next.id === `string`
    ) {
      for (const [sourceUrl, forkUrl] of entityUrlMap) {
        const prefix = `${sourceUrl}/attachments/`
        if (!next.streamPath.startsWith(prefix)) {
          continue
        }
        next.streamPath = getEntityAttachmentStreamPath(forkUrl, next.id)
        return { key, value: next, changed: true }
      }
    }

    if (next.kind === `schedule` && next.scheduleType === `future_send`) {
      let changed = false
      if (typeof next.targetUrl === `string`) {
        const forkTarget = entityUrlMap.get(next.targetUrl)
        if (forkTarget) {
          next.targetUrl = forkTarget
          changed = true
        }
      }
      if (typeof next.senderUrl === `string`) {
        const forkSender = entityUrlMap.get(next.senderUrl)
        if (forkSender) {
          next.senderUrl = forkSender
          changed = true
        }
      }
      return { key, value: next, changed }
    }

    return { key, value: next, changed: false }
  }

  private remapChildStatus(
    value: Record<string, unknown>,
    entityUrlMap: Map<string, string>
  ): Record<string, unknown> | null {
    if (typeof value.entity_url !== `string`) return null
    const forkUrl = entityUrlMap.get(value.entity_url)
    if (!forkUrl) return null
    const { type } = this.parseEntityUrl(forkUrl)
    return {
      ...value,
      entity_url: forkUrl,
      entity_type: type,
    }
  }

  private remapReplayWatermark(
    key: string,
    value: Record<string, unknown>,
    stringMap: Map<string, string>
  ): { key: string; value: Record<string, unknown> } | null {
    if (typeof value.source_id !== `string`) return null
    const sourceId = value.source_id
    const forkSourceId = stringMap.get(sourceId)
    if (!forkSourceId) return null
    const next = { ...value, source_id: forkSourceId }
    return {
      key: key === sourceId ? forkSourceId : key,
      value: next,
    }
  }

  private remapJsonValue(
    value: unknown,
    stringMap: Map<string, string>
  ): unknown {
    if (typeof value === `string`) {
      return stringMap.get(value) ?? value
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.remapJsonValue(item, stringMap))
    }
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.remapJsonValue(item, stringMap),
        ])
      )
    }
    return value
  }

  private async materializeForkManifestSideEffects(
    entityUrl: string,
    manifests: Map<string, Record<string, unknown>>
  ): Promise<void> {
    for (const [manifestKey, manifest] of manifests) {
      await this.syncManifestLinks(entityUrl, manifestKey, `upsert`, manifest)

      const wake = buildManifestWakeRegistration(
        entityUrl,
        manifest,
        manifestKey
      )
      if (wake) {
        await this.wakeRegistry.register({
          ...wake,
          tenantId: this.tenantId,
        })
      }

      const cronSpec = extractManifestCronSpec(manifest)
      if (cronSpec && this.scheduler) {
        await this.getOrCreateCronStream(cronSpec.expression, cronSpec.timezone)
      }

      await this.syncManifestFutureSendSchedule(
        entityUrl,
        manifestKey,
        manifest
      )
    }
  }

  private async syncManifestFutureSendSchedule(
    ownerEntityUrl: string,
    manifestKey: string,
    manifest: Record<string, unknown>
  ): Promise<void> {
    if (!this.scheduler) return
    if (
      manifest.kind !== `schedule` ||
      manifest.scheduleType !== `future_send` ||
      (manifest.status !== undefined && manifest.status !== `pending`)
    ) {
      return
    }

    const fireAtRaw = manifest.fireAt
    const producerId = manifest.producerId
    const targetUrl = manifest.targetUrl
    const senderUrl =
      typeof manifest.senderUrl === `string`
        ? manifest.senderUrl
        : ownerEntityUrl
    if (
      typeof fireAtRaw !== `string` ||
      typeof producerId !== `string` ||
      typeof targetUrl !== `string`
    ) {
      serverLog.warn(
        `[agent-server] invalid forked future_send manifest entry for ${ownerEntityUrl}/${manifestKey}`
      )
      return
    }

    const fireAt = new Date(fireAtRaw)
    if (Number.isNaN(fireAt.getTime())) {
      serverLog.warn(
        `[agent-server] invalid forked future_send fireAt for ${ownerEntityUrl}/${manifestKey}: ${fireAtRaw}`
      )
      return
    }

    await this.scheduler.syncManifestDelayedSend(
      ownerEntityUrl,
      manifestKey,
      {
        entityUrl: targetUrl,
        from: senderUrl,
        payload: manifest.payload,
        key: `scheduled-${producerId}`,
        type:
          typeof manifest.messageType === `string`
            ? manifest.messageType
            : undefined,
        producerId,
        manifest: {
          ownerEntityUrl,
          key: manifestKey,
          entry: omitUndefined({
            ...manifest,
            key: manifestKey,
            kind: `schedule`,
            scheduleType: `future_send`,
            targetUrl,
            senderUrl,
            fireAt: fireAt.toISOString(),
            producerId,
            status: `pending`,
          }),
        },
      },
      fireAt
    )
  }

  private parseEntityUrl(url: string): { type: string; instanceId: string } {
    const segments = url.split(`/`).filter(Boolean)
    if (segments.length !== 2 || !segments[0] || !segments[1]) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Invalid entity URL "${url}"`,
        400
      )
    }
    return { type: segments[0], instanceId: segments[1] }
  }

  // ==========================================================================
  // Send
  // ==========================================================================

  /**
   * Deliver a message to an entity's main stream, with optional inbox schema
   * validation.
   */
  async send(
    entityUrl: string,
    req: SendRequest,
    opts?: { producerId?: string }
  ): Promise<void> {
    const entity = await this.validateSendRequest(entityUrl, req)
    if (
      this.isForkWorkLockedEntity(entityUrl) &&
      !(req.from && this.isForkWorkLockedEntity(req.from))
    ) {
      this.assertEntityNotForkWorkLocked(entityUrl)
    }

    const now = new Date().toISOString()
    const key =
      req.key ??
      `msg-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const value: Record<string, unknown> = {
      from: req.from,
      payload: req.payload,
      timestamp: now,
      mode: req.mode ?? `immediate`,
      status:
        req.mode === `queued` || req.mode === `paused`
          ? `pending`
          : `processed`,
    }
    if (req.type) {
      value.message_type = req.type
    }
    if (req.position) {
      value.position = req.position
    } else if (value.mode === `queued` || value.mode === `paused`) {
      value.position = createInitialQueuePosition(new Date(now))
    }
    if (value.status === `processed`) {
      value.processed_at = now
    }

    const wakePausedEntity = entity.status === `paused` && req.mode !== `paused`
    if (wakePausedEntity) {
      await this.registry.updateStatus(entityUrl, `idle`)
      await this.entityBridgeManager?.onEntityChanged(entityUrl)
    }

    const envelope = entityStateSchema.inbox.insert({
      key,
      value,
    } as any)

    const encoded = this.encodeChangeEvent(envelope as Record<string, unknown>)
    try {
      if (opts?.producerId) {
        await this.streamClient.appendIdempotent(entity.streams.main, encoded, {
          producerId: opts.producerId,
        })
        return
      }

      await this.streamClient.append(entity.streams.main, encoded)
      if (entity.type === `principal` && req.type === `update_identity`) {
        const identity = (req.payload as { identity?: unknown })?.identity
        await this.streamClient.append(
          entity.streams.main,
          this.encodeChangeEvent({
            type: `identity`,
            key: `self`,
            value: identity,
          })
        )
      }
    } catch (err) {
      if (this.isClosedStreamError(err)) {
        throw new ElectricAgentsError(
          ErrCodeNotRunning,
          `Entity is stopped`,
          409
        )
      }
      throw err
    }
  }

  async updateInboxMessage(
    entityUrl: string,
    key: string,
    req: {
      payload?: unknown
      position?: string
      mode?: `immediate` | `queued` | `paused` | `steer`
      status?: `pending` | `processed` | `cancelled`
    }
  ): Promise<void> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }
    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }

    const now = new Date().toISOString()
    const value: Record<string, unknown> = {}
    if (`payload` in req) value.payload = req.payload
    if (req.position !== undefined) value.position = req.position
    if (req.mode !== undefined) value.mode = req.mode
    if (req.status !== undefined) {
      value.status = req.status
      if (req.status === `processed`) value.processed_at = now
      if (req.status === `cancelled`) value.cancelled_at = now
    }

    if (Object.keys(value).length === 0) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `No inbox fields to update`,
        400
      )
    }

    const envelope = entityStateSchema.inbox.update({
      key,
      value,
    } as any)
    await this.streamClient.append(
      entity.streams.main,
      this.encodeChangeEvent(envelope as Record<string, unknown>)
    )
  }

  async deleteInboxMessage(entityUrl: string, key: string): Promise<void> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }
    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }

    const envelope = entityStateSchema.inbox.delete({ key } as any)
    await this.streamClient.append(
      entity.streams.main,
      this.encodeChangeEvent(envelope as Record<string, unknown>)
    )
  }

  // ==========================================================================
  // Attachments
  // ==========================================================================

  isAttachmentStreamPath(path: string): boolean {
    return /^\/[^/]+\/[^/]+\/attachments\/[^/]+$/.test(path)
  }

  async createAttachment(
    entityUrl: string,
    req: CreateAttachmentRequest
  ): Promise<{ txid: string; attachment: ManifestAttachmentEntry }> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }
    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }
    if (this.isForkWorkLockedEntity(entityUrl)) {
      this.assertEntityNotForkWorkLocked(entityUrl)
    }

    const id = req.id ?? randomUUID()
    validateAttachmentId(id)
    validateAttachmentSubject(req.subject)

    const limit = maxAttachmentBytes()
    if (req.bytes.length > limit) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Attachment exceeds maximum size of ${limit} bytes`,
        413
      )
    }

    const mimeType = req.mimeType.trim() || `application/octet-stream`
    const streamPath = getEntityAttachmentStreamPath(entityUrl, id)
    const manifestKey = manifestAttachmentKey(id)
    const txid = randomUUID()
    const now = new Date().toISOString()
    const sha256 = createHash(`sha256`).update(req.bytes).digest(`hex`)
    const attachment: ManifestAttachmentEntry = {
      key: manifestKey,
      kind: `attachment`,
      id,
      streamPath,
      status: `complete`,
      subject: req.subject,
      role: req.role ?? `input`,
      mimeType,
      ...(req.filename ? { filename: req.filename } : {}),
      byteLength: req.bytes.length,
      sha256,
      createdAt: now,
      ...(req.createdBy ? { createdBy: req.createdBy } : {}),
      ...(req.meta
        ? { meta: req.meta as ManifestAttachmentEntry[`meta`] }
        : {}),
    }

    let streamCreated = false
    try {
      await this.streamClient.create(streamPath, {
        contentType: mimeType,
        body: req.bytes,
        closed: true,
      })
      streamCreated = true
      await this.writeManifestEntry(
        entityUrl,
        manifestKey,
        `upsert`,
        attachment as unknown as Record<string, unknown>,
        { txid }
      )
    } catch (error) {
      if (streamCreated) {
        await this.streamClient.delete(streamPath).catch(() => undefined)
      }
      if (!streamCreated && isStreamCreateConflict(error)) {
        throw new ElectricAgentsError(
          ErrCodeInvalidRequest,
          `Attachment already exists at id "${id}"`,
          409
        )
      }
      throw error
    }

    return { txid, attachment }
  }

  async getAttachment(
    entityUrl: string,
    id: string
  ): Promise<ManifestAttachmentEntry | null> {
    validateAttachmentId(id)
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }
    const events = await this.streamClient.readJson<Record<string, unknown>>(
      entity.streams.main
    )
    const manifest = this.reduceStateRows(events, `manifest`).get(
      manifestAttachmentKey(id)
    )
    if (!manifest || manifest.kind !== `attachment`) {
      return null
    }
    return manifest as unknown as ManifestAttachmentEntry
  }

  async readAttachment(
    entityUrl: string,
    id: string
  ): Promise<ReadAttachmentResult> {
    const attachment = await this.getAttachment(entityUrl, id)
    if (!attachment) {
      throw new ElectricAgentsError(
        ErrCodeNotFound,
        `Attachment not found`,
        404
      )
    }
    if (attachment.status !== `complete`) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Attachment is not complete`,
        409
      )
    }
    assertCanonicalAttachmentStreamPath(entityUrl, attachment)

    const result = await this.streamClient.read(attachment.streamPath)
    return {
      attachment,
      bytes: concatByteMessages(result.messages),
    }
  }

  async deleteAttachment(
    entityUrl: string,
    id: string
  ): Promise<{ txid: string }> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }
    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }
    if (this.isForkWorkLockedEntity(entityUrl)) {
      this.assertEntityNotForkWorkLocked(entityUrl)
    }

    const attachment = await this.getAttachment(entityUrl, id)
    if (!attachment) {
      throw new ElectricAgentsError(
        ErrCodeNotFound,
        `Attachment not found`,
        404
      )
    }
    assertCanonicalAttachmentStreamPath(entityUrl, attachment)
    const txid = randomUUID()
    await this.writeManifestEntry(
      entityUrl,
      manifestAttachmentKey(id),
      `delete`,
      undefined,
      { txid }
    )
    await this.streamClient.delete(attachment.streamPath).catch(() => undefined)
    return { txid }
  }

  // ==========================================================================
  // Tag Updates
  // ==========================================================================

  async setTag(
    entityUrl: string,
    key: string,
    req: SetTagRequest,
    token: string
  ): Promise<ElectricAgentsEntity> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }

    if (!this.isValidWriteToken(entity, token)) {
      throw new ElectricAgentsError(
        ErrCodeUnauthorized,
        `Invalid write token`,
        401
      )
    }
    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }

    if (typeof req.value !== `string`) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Tag values must be strings`,
        400
      )
    }

    const result = await this.registry.setEntityTag(entityUrl, key, req.value)
    const updated = result.entity
    if (!updated) {
      throw new ElectricAgentsError(
        ErrCodeEntityPersistFailed,
        `Entity not found after tag write`,
        500
      )
    }

    if (result.changed && this.entityBridgeManager) {
      await this.entityBridgeManager.onEntityChanged(entityUrl)
    }

    return updated
  }

  async deleteTag(
    entityUrl: string,
    key: string,
    token: string
  ): Promise<ElectricAgentsEntity> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }

    if (!this.isValidWriteToken(entity, token)) {
      throw new ElectricAgentsError(
        ErrCodeUnauthorized,
        `Invalid write token`,
        401
      )
    }
    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }

    const result = await this.registry.removeEntityTag(entityUrl, key)
    const updated = result.entity
    if (!updated) {
      throw new ElectricAgentsError(
        ErrCodeEntityPersistFailed,
        `Entity not found after tag delete`,
        500
      )
    }

    if (result.changed && this.entityBridgeManager) {
      await this.entityBridgeManager.onEntityChanged(entityUrl)
    }

    return updated
  }

  async ensureEntitiesMembershipStream(
    tags: Record<string, string>,
    principal: { url: string; kind: string }
  ): Promise<{
    sourceRef: string
    streamUrl: string
  }> {
    if (!this.entityBridgeManager) {
      throw new Error(`Entity bridge manager not configured`)
    }
    return this.entityBridgeManager.register(
      this.validateTags(tags),
      principal.url,
      principal.kind
    )
  }

  async writeManifestEntry(
    entityUrl: string,
    key: string,
    operation: `insert` | `update` | `upsert` | `delete`,
    value?: Record<string, unknown>,
    opts?: { producerId?: string; txid?: string }
  ): Promise<void> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }

    const event: Record<string, unknown> = {
      type: `manifest`,
      key,
      headers: {
        operation,
        timestamp: new Date().toISOString(),
        ...(opts?.txid ? { txid: opts.txid } : {}),
      },
    }
    if (value !== undefined) {
      event.value = value
    }

    const encoded = this.encodeChangeEvent(event)
    if (opts?.producerId) {
      await this.streamClient.appendIdempotent(entity.streams.main, encoded, {
        producerId: opts.producerId,
      })
      await this.syncManifestLinks(entityUrl, key, operation, value)
      return
    }

    await this.streamClient.append(entity.streams.main, encoded)
    await this.syncManifestLinks(entityUrl, key, operation, value)
  }

  async upsertCronSchedule(
    entityUrl: string,
    req: {
      id: string
      expression: string
      timezone?: string
      payload?: unknown
      debounceMs?: number
      timeoutMs?: number
    }
  ): Promise<{ txid: string }> {
    if (req.payload === undefined) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Missing required field: payload`,
        400
      )
    }

    const spec = resolveCronScheduleSpec(req.expression, req.timezone)

    const manifestKey = `schedule:${req.id}`
    await this.wakeRegistry.unregisterByManifestKey(
      entityUrl,
      manifestKey,
      this.tenantId
    )
    await this.wakeRegistry.register({
      tenantId: this.tenantId,
      subscriberUrl: entityUrl,
      sourceUrl: getCronStreamPath(spec.expression, spec.timezone),
      condition: {
        on: `change`,
      },
      debounceMs: req.debounceMs,
      timeoutMs: req.timeoutMs,
      oneShot: false,
      manifestKey,
    })
    await this.getOrCreateCronStream(spec.expression, spec.timezone)

    const txid = randomUUID()
    await this.writeManifestEntry(
      entityUrl,
      manifestKey,
      `upsert`,
      {
        key: manifestKey,
        kind: `schedule`,
        id: req.id,
        scheduleType: `cron`,
        expression: spec.expression,
        timezone: spec.timezone,
        payload: req.payload,
        wake: {
          on: `change`,
          ...(typeof req.debounceMs === `number`
            ? { debounceMs: req.debounceMs }
            : {}),
          ...(typeof req.timeoutMs === `number`
            ? { timeoutMs: req.timeoutMs }
            : {}),
        },
      },
      { txid }
    )

    return { txid }
  }

  async upsertFutureSendSchedule(
    ownerEntityUrl: string,
    req: {
      id: string
      payload: unknown
      targetUrl?: string
      fireAt: string
      senderUrl?: string
      messageType?: string
    }
  ): Promise<{ txid: string }> {
    if (!this.scheduler) {
      throw new Error(`Scheduler not configured`)
    }

    const targetUrl = req.targetUrl ?? ownerEntityUrl
    const from = req.senderUrl ?? ownerEntityUrl
    const fireAt = new Date(req.fireAt)
    if (Number.isNaN(fireAt.getTime())) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Invalid fireAt timestamp: ${req.fireAt}`,
        400
      )
    }

    await this.validateSendRequest(targetUrl, {
      from,
      payload: req.payload,
      type: req.messageType,
    })

    const manifestKey = `schedule:${req.id}`
    const producerId = `future-send-${randomUUID()}`

    await this.wakeRegistry.unregisterByManifestKey(
      ownerEntityUrl,
      manifestKey,
      this.tenantId
    )
    await this.scheduler.syncManifestDelayedSend(
      ownerEntityUrl,
      manifestKey,
      {
        entityUrl: targetUrl,
        from,
        payload: req.payload,
        key: `scheduled-${producerId}`,
        type: req.messageType,
        producerId,
        manifest: {
          ownerEntityUrl,
          key: manifestKey,
          entry: {
            key: manifestKey,
            kind: `schedule`,
            id: req.id,
            scheduleType: `future_send`,
            fireAt: fireAt.toISOString(),
            targetUrl,
            senderUrl: from,
            payload: req.payload,
            producerId,
            ...(req.messageType ? { messageType: req.messageType } : {}),
            status: `pending`,
          },
        },
      },
      fireAt
    )

    const txid = randomUUID()
    await this.writeManifestEntry(
      ownerEntityUrl,
      manifestKey,
      `upsert`,
      {
        key: manifestKey,
        kind: `schedule`,
        id: req.id,
        scheduleType: `future_send`,
        fireAt: fireAt.toISOString(),
        targetUrl,
        senderUrl: from,
        payload: req.payload,
        producerId,
        ...(req.messageType ? { messageType: req.messageType } : {}),
        status: `pending`,
      },
      { txid }
    )

    return { txid }
  }

  async deleteSchedule(
    entityUrl: string,
    req: { id: string }
  ): Promise<{ txid: string }> {
    const manifestKey = `schedule:${req.id}`
    if (this.scheduler) {
      await this.scheduler.cancelManifestDelayedSend(entityUrl, manifestKey)
    }
    await this.wakeRegistry.unregisterByManifestKey(
      entityUrl,
      manifestKey,
      this.tenantId
    )

    const txid = randomUUID()
    await this.writeManifestEntry(entityUrl, manifestKey, `delete`, undefined, {
      txid,
    })

    return { txid }
  }

  async upsertEventSourceSubscription(
    entityUrl: string,
    req: {
      subscription: EventSourceSubscription
      manifest: Record<string, unknown>
    }
  ): Promise<{ txid: string; subscription: EventSourceSubscription }> {
    const manifestKey = req.subscription.manifestKey
    const txid = randomUUID()
    await this.writeManifestEntry(
      entityUrl,
      manifestKey,
      `upsert`,
      req.manifest,
      {
        txid,
      }
    )

    // The manifest is the durable source of truth. Register side effects after
    // it is appended so failures can be repaired by manifest replay.
    await this.wakeRegistry.unregisterByManifestKey(
      entityUrl,
      manifestKey,
      this.tenantId
    )
    await this.wakeRegistry.register({
      tenantId: this.tenantId,
      subscriberUrl: entityUrl,
      sourceUrl: req.subscription.sourceUrl,
      condition: {
        on: `change`,
        collections: [`webhook_event`],
        ops: [`insert`],
      },
      oneShot: false,
      manifestKey,
    })

    return { txid, subscription: req.subscription }
  }

  async deleteEventSourceSubscription(
    entityUrl: string,
    req: { id: string }
  ): Promise<{ txid: string }> {
    const manifestKey = eventSourceSubscriptionManifestKey(req.id)
    const txid = randomUUID()
    await this.writeManifestEntry(entityUrl, manifestKey, `delete`, undefined, {
      txid,
    })

    await this.wakeRegistry.unregisterByManifestKey(
      entityUrl,
      manifestKey,
      this.tenantId
    )

    return { txid }
  }

  // ==========================================================================
  // Wake Evaluation
  // ==========================================================================

  /**
   * Register a wake subscription from a subscriber to a source entity.
   */
  async registerWake(opts: {
    subscriberUrl: string
    sourceUrl: string
    condition: `runFinished` | { on: `change`; collections?: Array<string> }
    debounceMs?: number
    timeoutMs?: number
    includeResponse?: boolean
    manifestKey?: string
  }): Promise<void> {
    await this.wakeRegistry.register({
      tenantId: this.tenantId,
      subscriberUrl: opts.subscriberUrl,
      sourceUrl: opts.sourceUrl,
      condition: opts.condition,
      oneShot: false,
      debounceMs: opts.debounceMs,
      timeoutMs: opts.timeoutMs,
      includeResponse: opts.includeResponse,
      manifestKey: opts.manifestKey,
    })
  }

  async enqueueDelayedSend(
    entityUrl: string,
    req: SendRequest,
    fireAt: Date
  ): Promise<void> {
    if (!this.scheduler) {
      throw new Error(`Scheduler not configured`)
    }

    await this.validateSendRequest(entityUrl, req)

    await this.scheduler.enqueueDelayedSend(
      {
        entityUrl,
        from: req.from,
        payload: req.payload,
        key: req.key,
        type: req.type,
        mode: req.mode,
        position: req.position,
      },
      fireAt
    )
  }

  /**
   * Evaluate an event against registered wake conditions and deliver results.
   */
  async evaluateWakes(
    sourceUrl: string,
    event: Record<string, unknown>
  ): Promise<void> {
    return await withSpan(`electric_agents.evaluateWakes`, async (span) => {
      span.setAttribute(ATTR.WAKE_SOURCE, sourceUrl)
      const results = this.wakeRegistry.evaluate(
        sourceUrl,
        event,
        this.tenantId
      )
      span.setAttribute(`electric_agents.wake.subscriber_count`, results.length)
      const settled = await Promise.allSettled(
        results.map((result) => this.deliverWakeResult(result))
      )
      for (const [index, result] of settled.entries()) {
        if (result.status === `rejected`) {
          serverLog.warn(
            `[agent-server] failed to deliver wake for ${results[index]!.subscriberUrl}:`,
            result.reason
          )
        }
      }
    })
  }

  /**
   * Deliver a wake result: append WakeMessage to subscriber's stream and
   * trigger webhook notification.
   */
  private async deliverWakeResult(result: WakeEvalResult): Promise<void> {
    if (result.tenantId !== this.tenantId) return

    return await withSpan(`electric_agents.deliverWake`, async (span) => {
      span.setAttributes({
        [ATTR.WAKE_SUBSCRIBER]: result.subscriberUrl,
        [ATTR.WAKE_SOURCE]: result.wakeMessage.source,
        [ATTR.WAKE_KIND]: result.wakeMessage.timeout ? `timeout` : `change`,
      })
      // Fetch subscriber and source entity in parallel — runFinished wakes need
      // both, plain wakes only need subscriber but the extra read is cheap.
      const needsSource = result.runFinishedStatus !== undefined
      const [subscriber, sourceEntity] = await Promise.all([
        this.registry.getEntity(result.subscriberUrl),
        needsSource
          ? this.registry.getEntity(result.wakeMessage.source)
          : Promise.resolve(null),
      ])
      if (!subscriber) return
      const wakeMessage = await this.buildWakeMessage(
        subscriber,
        result,
        sourceEntity
      )
      const wakeEvent = entityStateSchema.wakes.insert({
        key: `wake-${result.registrationDbId}-${result.sourceEventKey}`,
        value: wakeMessage,
      } as any)
      await this.streamClient.appendIdempotent(
        subscriber.streams.main,
        this.encodeChangeEvent(wakeEvent as Record<string, unknown>),
        {
          producerId: `wake-reg-${result.registrationDbId}-${result.sourceEventKey}`,
        }
      )
    })
  }

  private async syncManifestLinks(
    entityUrl: string,
    manifestKey: string,
    operation: `insert` | `update` | `upsert` | `delete`,
    value?: Record<string, unknown>
  ): Promise<void> {
    const sourceRef =
      operation === `delete` ? undefined : this.extractEntitiesSourceRef(value)
    await this.registry.replaceEntityManifestSource(
      entityUrl,
      manifestKey,
      sourceRef
    )

    const sharedStateId =
      operation === `delete` ? undefined : this.extractSharedStateId(value)
    await this.registry.replaceSharedStateLink(
      entityUrl,
      manifestKey,
      sharedStateId
    )
  }

  private extractEntitiesSourceRef(
    manifest?: Record<string, unknown>
  ): string | undefined {
    if (
      manifest?.kind === `source` &&
      manifest.sourceType === `entities` &&
      typeof manifest.sourceRef === `string`
    ) {
      return manifest.sourceRef
    }
    return undefined
  }

  private extractSharedStateId(
    manifest?: Record<string, unknown>
  ): string | undefined {
    if (manifest?.kind === `shared-state` && typeof manifest.id === `string`) {
      return manifest.id
    }

    if (manifest?.kind !== `source` || manifest.sourceType !== `db`) {
      return undefined
    }

    if (typeof manifest.sourceRef === `string`) {
      return manifest.sourceRef
    }
    const config = isRecord(manifest.config) ? manifest.config : undefined
    return typeof config?.id === `string` ? config.id : undefined
  }

  /**
   * Read a child entity's stream and extract concatenated text deltas
   * for a specific run, plus any error messages for that run.
   */
  private async extractRunResponse(
    entity: ElectricAgentsEntity,
    runKey: string,
    runStatus: `completed` | `failed`
  ): Promise<{ response?: string; error?: string }> {
    let events: Array<Record<string, unknown>>
    try {
      events = await this.streamClient.readJson<Record<string, unknown>>(
        entity.streams.main
      )
    } catch (err) {
      serverLog.warn(
        `[agent-server] failed to read child stream for ${entity.url} (${runKey}): ${err instanceof Error ? err.message : String(err)}`
      )
      return { error: `Failed to load child response` }
    }

    const textDeltas: Array<string> = []
    const errors: Array<string> = []

    for (const parsed of events) {
      const value = parsed.value as Record<string, unknown> | undefined
      if (!value) continue

      if (parsed.type === `text_delta`) {
        if ((value.run_id as string) === runKey) {
          textDeltas.push((value.delta as string) || ``)
        }
      } else if (parsed.type === `error` && runStatus === `failed`) {
        if ((value.run_id as string) === runKey) {
          errors.push((value.message as string) || ``)
        }
      }
    }

    const result: { response?: string; error?: string } = {}

    const runText = textDeltas.join(``)
    if (runText.length > 0) {
      result.response = runText
    }

    if (errors.length > 0) {
      result.error = errors.join(`\n`)
    }

    return result
  }

  private async buildWakeMessage(
    subscriber: ElectricAgentsEntity,
    result: WakeEvalResult,
    sourceEntity: ElectricAgentsEntity | null
  ): Promise<WakeMessage> {
    const wakeMessage: WakeMessage = {
      timestamp: new Date().toISOString(),
      ...result.wakeMessage,
    }
    if (!result.runFinishedStatus) {
      return wakeMessage
    }

    if (!sourceEntity) {
      throw new Error(
        `[agent-server] runFinished wake source entity not found: ${result.wakeMessage.source}`
      )
    }

    // `runFinished` is valid both for spawned children and explicitly observed
    // entities. Only child wakes get the richer sibling-status payload.
    if (sourceEntity.parent !== subscriber.url) {
      return wakeMessage
    }

    const includeResponse = result.includeResponse !== false
    const changes = result.wakeMessage.changes
    const runKey = changes[changes.length - 1]?.key
    const { response, error } =
      includeResponse && runKey
        ? await this.extractRunResponse(
            sourceEntity,
            runKey,
            result.runFinishedStatus
          )
        : {}

    return {
      ...wakeMessage,
      finished_child: {
        url: sourceEntity.url,
        type: sourceEntity.type,
        run_status: result.runFinishedStatus,
        ...(response !== undefined ? { response } : {}),
        ...(error !== undefined ? { error } : {}),
      },
    }
  }

  // ==========================================================================
  // Signals
  // ==========================================================================

  async signal(entityUrl: string, req: SignalRequest): Promise<SignalResponse> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }

    if (isTerminalEntityStatus(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeInvalidSignal,
        `Cannot signal a ${entity.status} entity`,
        409
      )
    }

    const now = new Date()
    const previousState = entity.status
    const handling = this.serverHandlingForSignal(previousState, req.signal)
    const txid =
      handling.status === previousState
        ? await this.registry.touchEntityWithTxid(entityUrl)
        : await this.registry.updateStatusWithTxid(entityUrl, handling.status)
    if (txid === null) {
      throw new ElectricAgentsError(
        ErrCodeInvalidSignal,
        `Cannot signal entity because it is already terminal`,
        409
      )
    }

    const key = `sig-${now.getTime()}-${randomUUID().slice(0, 8)}`
    const signalValue: ServerSignalValue = {
      signal: req.signal,
      status: handling.handled ? `handled` : `unhandled`,
      sender: SERVER_SIGNAL_SENDER,
      timestamp: now.toISOString(),
    }
    if (req.reason !== undefined) signalValue.reason = req.reason
    if (req.payload !== undefined) signalValue.payload = req.payload
    if (handling.handled) {
      signalValue.handled_at = now.toISOString()
      signalValue.handled_by = SERVER_SIGNAL_SENDER
      signalValue.outcome = handling.outcome
      signalValue.previous_state = previousState
      signalValue.new_state = handling.status
    }

    const signalEvent: ServerSignalEvent = {
      type: `signal`,
      key,
      value: signalValue,
      headers: {
        operation: `insert`,
        timestamp: now.toISOString(),
        txid: String(txid),
      },
    }

    const shouldCloseStreams = isTerminalEntityStatus(handling.status)
    await this.appendSignalEvent(entity, signalEvent, shouldCloseStreams)
    if (!shouldCloseStreams) {
      await this.evaluateWakes(
        entityUrl,
        signalEvent as unknown as Record<string, unknown>
      )
    }

    if (handling.unregisterWakes) {
      await this.wakeRegistry.unregisterBySubscriber(entityUrl, this.tenantId)
      await this.wakeRegistry.unregisterBySource(entityUrl, this.tenantId)
    }

    if (handling.status !== previousState && this.entityBridgeManager) {
      await this.entityBridgeManager.onEntityChanged(entityUrl)
    }

    return {
      url: entityUrl,
      signal: req.signal,
      previous_state: previousState,
      new_state: handling.status,
      created_at: now.getTime(),
      txid,
    }
  }

  async kill(entityUrl: string): Promise<{ txid: number }> {
    const response = await this.signal(entityUrl, {
      signal: `SIGKILL`,
      reason: `Legacy kill command`,
    })
    return { txid: response.txid }
  }

  private serverHandlingForSignal(
    status: ElectricAgentsEntity[`status`],
    signal: EntitySignal
  ): ServerSignalHandling {
    if (signal === `SIGKILL`) {
      return {
        status: `killed`,
        handled: true,
        outcome: `transitioned`,
        unregisterWakes: true,
      }
    }
    if (signal === `SIGTERM`) {
      if (status === `idle` || status === `paused`) {
        return {
          status: `stopped`,
          handled: true,
          outcome: `transitioned`,
          unregisterWakes: true,
        }
      }
      if (status === `running`) {
        return {
          status: `stopping`,
          handled: false,
          outcome: `transitioned`,
          unregisterWakes: false,
        }
      }
    }
    if (status === `paused` && signal !== `SIGCONT`) {
      return {
        status,
        handled: true,
        outcome: `ignored`,
        unregisterWakes: false,
      }
    }
    if (signal === `SIGSTOP` && (status === `idle` || status === `running`)) {
      return {
        status: `paused`,
        handled: status === `idle`,
        outcome: `transitioned`,
        unregisterWakes: false,
      }
    }
    if (signal === `SIGCONT` && status === `paused`) {
      return {
        status: `idle`,
        handled: false,
        outcome: `transitioned`,
        unregisterWakes: false,
      }
    }

    return {
      status,
      handled: false,
      outcome: `ignored`,
      unregisterWakes: false,
    }
  }

  private async appendSignalEvent(
    entity: ElectricAgentsEntity,
    signalEvent: ServerSignalEvent,
    closeStreams: boolean
  ): Promise<void> {
    const signalData = this.encodeChangeEvent(
      signalEvent as unknown as Record<string, unknown>
    )
    if (!closeStreams) {
      await this.streamClient.append(entity.streams.main, signalData)
      return
    }

    const errorCloseEvent = {
      type: `signal`,
      key: signalEvent.key,
      value: signalEvent.value,
      headers: signalEvent.headers,
    }
    const errorSignalData = this.encodeChangeEvent(
      errorCloseEvent as unknown as Record<string, unknown>
    )

    for (const [streamPath, data] of [
      [entity.streams.main, signalData],
      [entity.streams.error, errorSignalData],
    ] as const) {
      try {
        await this.streamClient.append(streamPath, data, { close: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (
          /closed/i.test(message) ||
          /not found/i.test(message) ||
          /404/.test(message) ||
          /409/.test(message)
        ) {
          continue
        }
        throw err
      }
    }
  }

  // ==========================================================================
  // Write Validation
  // ==========================================================================

  async validateWriteEvent(
    entity: ElectricAgentsEntity,
    event: Record<string, unknown>
  ): Promise<{ code: string; message: string; status: number } | null> {
    if (!entity.type) return null

    const { stateSchemas } = await this.getEffectiveSchemas(entity)
    if (!stateSchemas) return null

    const eventType = event.type as string | undefined
    if (!eventType) return null

    if (!(eventType in stateSchemas)) {
      return {
        code: ErrCodeUnknownEventType,
        message: `Unknown event type "${eventType}"`,
        status: 422,
      }
    }

    const schema = stateSchemas[eventType]
    if (schema) {
      const headers = event.headers as Record<string, unknown> | undefined
      const operation = headers?.operation
      const rawPayload =
        operation === `delete` && `old_value` in event
          ? event.old_value
          : event.value
      if (rawPayload === undefined) {
        return null
      }
      const payload =
        typeof rawPayload === `object` && rawPayload !== null
          ? (rawPayload as Record<string, unknown>)
          : rawPayload
      const valErr = this.validator.validate(schema, payload)
      if (valErr) {
        return {
          code: ErrCodeSchemaValidationFailed,
          message: valErr.message,
          status: 422,
        }
      }
    }

    return null
  }

  // ==========================================================================
  // Amend Schemas
  // ==========================================================================

  /**
   * Add new inbox/state schema keys to an entity type directly in Postgres.
   */
  async amendSchemas(
    typeName: string,
    schemas: {
      inbox_schemas?: Record<string, Record<string, unknown>>
      state_schemas?: Record<string, Record<string, unknown>>
    }
  ): Promise<ElectricAgentsEntityType> {
    if (typeName === `principal`) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Entity type "principal" is built in and cannot be amended`,
        400
      )
    }

    // Validate each provided schema via validateSchemaSubset.
    this.validateSchemaMap(schemas.inbox_schemas)
    this.validateSchemaMap(schemas.state_schemas)

    // Look up current entity type.
    const existing = await this.registry.getEntityType(typeName)
    if (!existing) {
      throw new ElectricAgentsError(
        ErrCodeUnknownEntityType,
        `Entity type "${typeName}" not found`,
        404
      )
    }

    // Check for key overlap (additive only, no overwriting).
    if (schemas.inbox_schemas && existing.inbox_schemas) {
      for (const key of Object.keys(schemas.inbox_schemas)) {
        if (key in existing.inbox_schemas) {
          throw new ElectricAgentsError(
            ErrCodeSchemaKeyExists,
            `Cannot amend existing inbox schema key: ${key}`,
            409
          )
        }
      }
    }
    if (schemas.state_schemas && existing.state_schemas) {
      for (const key of Object.keys(schemas.state_schemas)) {
        if (key in existing.state_schemas) {
          throw new ElectricAgentsError(
            ErrCodeSchemaKeyExists,
            `Cannot amend existing state schema key: ${key}`,
            409
          )
        }
      }
    }

    // Merge schemas.
    const mergedInbox = schemas.inbox_schemas
      ? { ...(existing.inbox_schemas ?? {}), ...schemas.inbox_schemas }
      : existing.inbox_schemas
    const mergedState = schemas.state_schemas
      ? { ...(existing.state_schemas ?? {}), ...schemas.state_schemas }
      : existing.state_schemas

    const now = new Date().toISOString()
    const nextRevision = existing.revision + 1

    const updatedType: ElectricAgentsEntityType = {
      name: existing.name,
      description: existing.description,
      creation_schema: existing.creation_schema,
      inbox_schemas: mergedInbox,
      state_schemas: mergedState,
      serve_endpoint: existing.serve_endpoint,
      revision: nextRevision,
      created_at: existing.created_at,
      updated_at: now,
    }

    await this.registry.updateEntityTypeInPlace(updatedType)

    return (await this.registry.getEntityType(typeName)) ?? updatedType
  }

  // ==========================================================================
  // Webhook Enrichment
  // ==========================================================================

  /**
   * Enrich webhook payload with entity context.
   * Called by ElectricAgentsServer during subscription webhook dispatch to inject entity context.
   */
  async enrichPayload(
    payload: Record<string, unknown>,
    consumer: { primary_stream: string }
  ): Promise<Record<string, unknown>> {
    const entity = await this.registry.getEntityByStream(
      consumer.primary_stream
    )
    if (!entity) return payload

    return {
      ...payload,
      entity: {
        type: entity.type,
        status: entity.status,
        url: entity.url,
        streams: entity.streams,
        tags: entity.tags,
        spawnArgs: entity.spawn_args,
        sandbox: entity.sandbox,
        createdBy: entity.created_by,
      },
      principal: principalFromCreatedBy(entity.created_by),
      triggerEvent: `inbox`,
    }
  }

  private validateSchema(schema: Record<string, unknown> | undefined): void {
    if (!schema) return
    const err = this.validator.validateSchemaSubset(schema)
    if (err) {
      throw new ElectricAgentsError(err.code, err.message, 400)
    }
  }

  private validateSchemaMap(
    schemas: Record<string, Record<string, unknown>> | undefined
  ): void {
    if (!schemas) return
    for (const schema of Object.values(schemas)) {
      this.validateSchema(schema)
    }
  }

  private validateDispatchPolicy(
    input: unknown,
    opts: { label: string }
  ): DispatchPolicy {
    try {
      return parseDispatchPolicy(input, opts.label)
    } catch (error) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        error instanceof Error ? error.message : `Invalid dispatch policy`,
        400
      )
    }
  }

  private validateTags(input: unknown): Record<string, string> {
    try {
      return assertTags(input)
    } catch (error) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        error instanceof Error ? error.message : `Invalid tags`,
        400
      )
    }
  }

  private async validateSendRequest(
    entityUrl: string,
    req: SendRequest
  ): Promise<ElectricAgentsEntity> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }
    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }

    if (req.type && entity.type) {
      const { inboxSchemas } = await this.getEffectiveSchemas(entity)
      if (inboxSchemas) {
        const schema = inboxSchemas[req.type]
        if (!schema) {
          throw new ElectricAgentsError(
            ErrCodeUnknownMessageType,
            `Unknown message type "${req.type}"`,
            422
          )
        }
        const valErr = this.validator.validate(schema, req.payload)
        if (valErr) {
          throw new ElectricAgentsError(
            valErr.code,
            valErr.message,
            422,
            valErr.details
          )
        }
      }
    }

    if (!req.from) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Missing required field: from`,
        400
      )
    }
    if (
      entity.type === `principal` &&
      req.type === `update_identity` &&
      !isBuiltInSystemPrincipalUrl(req.from)
    ) {
      throw new ElectricAgentsError(
        ErrCodeUnauthorized,
        `Only built-in system principals can update principal identity`,
        403
      )
    }

    if (req.payload === undefined) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `Missing required field: payload`,
        400
      )
    }

    return entity
  }

  private async getEffectiveSchemas(entity: ElectricAgentsEntity): Promise<{
    inboxSchemas?: Record<string, Record<string, unknown>>
    stateSchemas?: Record<string, Record<string, unknown>>
  }> {
    if (!entity.type) {
      return {
        inboxSchemas: entity.inbox_schemas,
        stateSchemas: entity.state_schemas,
      }
    }

    const latestType = await this.registry.getEntityType(entity.type)

    return {
      inboxSchemas: latestType?.inbox_schemas
        ? { ...(entity.inbox_schemas ?? {}), ...latestType.inbox_schemas }
        : entity.inbox_schemas,
      stateSchemas: latestType?.state_schemas
        ? { ...(entity.state_schemas ?? {}), ...latestType.state_schemas }
        : entity.state_schemas,
    }
  }

  private isClosedStreamError(err: unknown): boolean {
    if (!(err instanceof Error)) {
      return false
    }

    const status =
      `status` in err ? (err as { status?: unknown }).status : undefined

    return (
      (status === 409 && /Stream is closed/i.test(err.message)) ||
      /Stream append failed:\s*409\s+Stream is closed/i.test(err.message) ||
      /HTTP Error 409\b.*Stream is closed/i.test(err.message)
    )
  }

  /**
   * Ensure a virtual cron stream exists and schedule its next tick.
   * Returns the stream path (e.g. `/_cron/<base64url>`).
   */
  async getOrCreateCronStream(
    expression: string,
    timezone?: string
  ): Promise<string> {
    if (!this.scheduler) {
      throw new Error(`Scheduler not configured`)
    }

    const spec = resolveCronScheduleSpec(expression, timezone)
    const streamPath = getCronStreamPath(spec.expression, spec.timezone)

    // Ensure the backing stream exists
    const exists = await this.streamClient.exists(streamPath)
    if (!exists) {
      await this.streamClient.create(streamPath, {
        contentType: `application/json`,
      })
    }

    const fireAt = getNextCronFireAt(spec.expression, spec.timezone)
    await this.scheduler.enqueueCronTick(
      spec.expression,
      spec.timezone,
      0,
      streamPath,
      fireAt
    )

    return streamPath
  }

  async shutdown(): Promise<void> {
    if (this.stopWakeRegistryOnShutdown) {
      await this.wakeRegistry.stopSync()
    }
    this.registry.close()
  }
}

export class ElectricAgentsError extends Error {
  readonly details?: unknown

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    details?: unknown
  ) {
    super(message)
    this.name = `ElectricAgentsError`
    if (details !== undefined) {
      this.details = details
    }
  }
}
