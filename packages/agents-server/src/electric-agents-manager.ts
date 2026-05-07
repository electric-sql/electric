/**
 * Orchestrates the Electric Agents entity lifecycle: register types, spawn, send, kill.
 *
 * Entity identity is the URL (/{type}/{instance_id}). Entity tags and
 * lifecycle state are persisted directly in Postgres. Durable streams remain
 * the append-only transport for inbox/state events.
 */

import { randomUUID } from 'node:crypto'
import fastq from 'fastq'
import {
  assertTags,
  entityStateSchema,
  getCronStreamPath,
  getSharedStateStreamPath,
  getNextCronFireAt,
  manifestChildKey,
  manifestSharedStateKey,
  manifestSourceKey,
  resolveCronScheduleSpec,
} from '@electric-ax/agents-runtime'
import {
  ErrCodeDuplicateURL,
  ErrCodeForkInProgress,
  ErrCodeForkWaitTimeout,
  ErrCodeInvalidRequest,
  ErrCodeNotFound,
  ErrCodeNotRunning,
  ErrCodeSchemaKeyExists,
  ErrCodeSchemaValidationFailed,
  ErrCodeUnknownEntityType,
  ErrCodeUnknownEventType,
  ErrCodeUnknownMessageType,
} from './electric-agents-types.js'
import { EntityAlreadyExistsError } from './electric-agents-registry.js'
import { serverLog } from './log.js'
import { ATTR, withSpan } from './tracing.js'
import type { queueAsPromised } from 'fastq'
import type { Scheduler } from './scheduler.js'
import type {
  WakeEvalResult,
  WakeRegistration,
  WakeRegistry,
} from './wake-registry.js'
import type { WakeMessage } from '@electric-ax/agents-runtime'
import type { PostgresRegistry } from './electric-agents-registry.js'
import type { SchemaValidator } from './electric-agents-schema-validator.js'
import type { StreamClient } from './stream-client.js'
import type {
  ElectricAgentsEntity,
  ElectricAgentsEntityType,
  RegisterEntityTypeRequest,
  SendRequest,
  SetTagRequest,
  TypedSpawnRequest,
} from './electric-agents-types.js'
import type { EntityBridgeManager } from './entity-bridge-manager.js'

type SpawnPersistResult = [
  PromiseSettledResult<void>,
  PromiseSettledResult<void>,
  PromiseSettledResult<number>,
]
type SpawnPersistJob = () => Promise<SpawnPersistResult>

type ForkSubtreeOptions = {
  rootInstanceId?: string
  waitTimeoutMs?: number
  waitPollMs?: number
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

export class ElectricAgentsManager {
  readonly registry: PostgresRegistry
  private streamClient: StreamClient
  private validator: SchemaValidator
  private scheduler: Scheduler | null = null
  private entityBridgeManager: EntityBridgeManager | null = null
  private writeTokenValidator:
    | ((entity: ElectricAgentsEntity, token: string) => boolean)
    | null = null
  readonly wakeRegistry: WakeRegistry
  private forkWorkLockedEntities = new Map<string, number>()
  private forkWriteLockedEntities = new Map<string, number>()
  private forkWriteLockedStreams = new Map<string, number>()
  private spawnPersistQueue: queueAsPromised<
    SpawnPersistJob,
    SpawnPersistResult
  >

  constructor(opts: {
    registry: PostgresRegistry
    streamClient: StreamClient
    validator: SchemaValidator
    wakeRegistry: WakeRegistry
    spawnConcurrency?: number
  }) {
    this.registry = opts.registry
    this.streamClient = opts.streamClient
    this.validator = opts.validator
    this.wakeRegistry = opts.wakeRegistry

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
    })
    this.wakeRegistry.setDebounceCallback((result) => {
      void this.deliverWakeResult(result)
    })
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

  setScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler
  }

  setEntityBridgeManager(entityBridgeManager: EntityBridgeManager): void {
    this.entityBridgeManager = entityBridgeManager
  }

  setWriteTokenValidator(
    validator: (entity: ElectricAgentsEntity, token: string) => boolean
  ): void {
    this.writeTokenValidator = validator
  }

  private isValidWriteToken(
    entity: ElectricAgentsEntity,
    token: string
  ): boolean {
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

    const existing = await this.registry.getEntityType(req.name)
    const now = new Date().toISOString()
    const entityType: ElectricAgentsEntityType = {
      name: req.name,
      description: req.description,
      creation_schema: req.creation_schema,
      inbox_schemas: req.inbox_schemas,
      state_schemas: req.state_schemas,
      serve_endpoint: req.serve_endpoint,
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

    const entityURL = `/${typeName}/${instanceId}`
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

    if (req.parent) {
      const parent = await this.registry.getEntity(req.parent)
      if (!parent) {
        throw new ElectricAgentsError(
          ErrCodeNotFound,
          `Parent entity "${req.parent}" not found`,
          404
        )
      }
    }

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
      write_token: writeToken,
      tags: initialTags,
      spawn_args: req.args,
      type_revision: entityType.revision,
      inbox_schemas: entityType.inbox_schemas,
      state_schemas: entityType.state_schemas,
      created_at: now,
      updated_at: now,
    }
    if (req.parent) {
      entityData.parent = req.parent
    }

    if (req.wake) {
      await this.wakeRegistry.register({
        subscriberUrl: req.wake.subscriberUrl,
        sourceUrl: entityURL,
        condition: req.wake.condition,
        debounceMs: req.wake.debounceMs,
        timeoutMs: req.wake.timeoutMs,
        oneShot: false,
        includeResponse: req.wake.includeResponse,
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
          from: req.parent ?? `spawn`,
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
              entityURL
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
      const sourceTree = await this.waitForIdleSubtree(rootUrl, opts, workLocks)
      const sourceRoot = sourceTree[0]!
      if (sourceRoot.parent) {
        throw new ElectricAgentsError(
          ErrCodeInvalidRequest,
          `Only top-level entities can be forked`,
          400
        )
      }

      const snapshot = await this.readForkStateSnapshot(sourceTree)
      const suffix = randomUUID().slice(0, 8)
      const entityUrlMap = await this.buildForkEntityUrlMap(sourceTree, {
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
        sourceTree,
        entityUrlMap,
        stringMap
      )

      this.addForkLocks(
        this.forkWriteLockedEntities,
        sourceTree.map((entity) => entity.url),
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
          await this.streamClient.fork(
            plan.fork.streams.main,
            plan.source.streams.main
          )
          createdStreams.push(plan.fork.streams.main)
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
            this.wakeRegistry.unregisterBySubscriber(entityUrl),
            this.wakeRegistry.unregisterBySource(entityUrl),
            this.registry.deleteEntity(entityUrl),
          ]),
          ...Array.from(sharedStateIdMap.values()).map((id) =>
            this.wakeRegistry.unregisterBySource(getSharedStateStreamPath(id))
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
      const stopped = subtree.find((entity) => entity.status === `stopped`)
      if (stopped) {
        throw new ElectricAgentsError(
          ErrCodeNotRunning,
          `Cannot fork stopped entity "${stopped.url}"`,
          409
        )
      }

      let active = subtree.filter((entity) => entity.status !== `idle`)
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
          (entity) => entity.status !== `idle`
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
    stringMap: Map<string, string>
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

    if (next.kind === `schedule` && next.scheduleType === `future_send`) {
      let changed = false
      if (typeof next.targetUrl === `string`) {
        const forkTarget = entityUrlMap.get(next.targetUrl)
        if (forkTarget) {
          next.targetUrl = forkTarget
          changed = true
        }
      }
      if (typeof next.from === `string`) {
        const forkFrom = entityUrlMap.get(next.from)
        if (forkFrom) {
          next.from = forkFrom
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
      await this.syncEntitiesManifestSource(
        entityUrl,
        manifestKey,
        `upsert`,
        manifest
      )

      const wake = this.buildManifestWakeRegistration(
        entityUrl,
        manifestKey,
        manifest
      )
      if (wake) {
        await this.wakeRegistry.register(wake)
      }

      const cronSpec = this.extractManifestCronSpec(manifest)
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

  private buildManifestWakeRegistration(
    subscriberUrl: string,
    manifestKey: string,
    manifest: Record<string, unknown>
  ): WakeRegistration | null {
    const sourceUrl = this.extractManifestSourceUrl(manifest)
    if (!sourceUrl) return null

    const wake =
      manifest.kind === `schedule` && manifest.scheduleType === `cron`
        ? (manifest.wake ?? { on: `change` })
        : manifest.wake

    if (wake === `runFinished`) {
      return {
        subscriberUrl,
        sourceUrl,
        condition: `runFinished`,
        oneShot: false,
        manifestKey,
      }
    }

    if (!isRecord(wake)) return null

    if (wake.on === `runFinished`) {
      return {
        subscriberUrl,
        sourceUrl,
        condition: `runFinished`,
        oneShot: false,
        includeResponse:
          typeof wake.includeResponse === `boolean`
            ? wake.includeResponse
            : undefined,
        manifestKey,
      }
    }

    if (wake.on !== `change`) return null

    const collections = Array.isArray(wake.collections)
      ? wake.collections.filter((c): c is string => typeof c === `string`)
      : undefined
    const ops = Array.isArray(wake.ops)
      ? wake.ops.filter(
          (op): op is `insert` | `update` | `delete` =>
            op === `insert` || op === `update` || op === `delete`
        )
      : undefined

    return {
      subscriberUrl,
      sourceUrl,
      condition: {
        on: `change`,
        ...(collections ? { collections } : {}),
        ...(ops ? { ops } : {}),
      },
      debounceMs:
        typeof wake.debounceMs === `number` ? wake.debounceMs : undefined,
      timeoutMs:
        typeof wake.timeoutMs === `number` ? wake.timeoutMs : undefined,
      oneShot: false,
      manifestKey,
    }
  }

  private extractManifestSourceUrl(
    manifest: Record<string, unknown>
  ): string | undefined {
    if (manifest.kind === `child`) {
      return typeof manifest.entity_url === `string`
        ? manifest.entity_url
        : undefined
    }
    if (manifest.kind === `source`) {
      const config = isRecord(manifest.config) ? manifest.config : undefined
      if (manifest.sourceType === `entity`) {
        return typeof config?.entityUrl === `string`
          ? config.entityUrl
          : typeof manifest.sourceRef === `string`
            ? manifest.sourceRef
            : undefined
      }
      if (manifest.sourceType === `cron` && config) {
        const expression = config.expression
        if (typeof expression === `string`) {
          const spec = resolveCronScheduleSpec(
            expression,
            typeof config.timezone === `string` ? config.timezone : undefined,
            { fallback: `utc` }
          )
          return getCronStreamPath(spec.expression, spec.timezone)
        }
      }
      if (manifest.sourceType === `entities`) {
        return typeof manifest.sourceRef === `string`
          ? `/_entities/${manifest.sourceRef}`
          : undefined
      }
      if (manifest.sourceType === `db`) {
        return typeof manifest.sourceRef === `string`
          ? getSharedStateStreamPath(manifest.sourceRef)
          : undefined
      }
    }
    if (manifest.kind === `shared-state`) {
      return typeof manifest.id === `string`
        ? getSharedStateStreamPath(manifest.id)
        : undefined
    }
    if (
      manifest.kind === `schedule` &&
      manifest.scheduleType === `cron` &&
      typeof manifest.expression === `string`
    ) {
      const spec = resolveCronScheduleSpec(
        manifest.expression,
        typeof manifest.timezone === `string` ? manifest.timezone : undefined,
        { fallback: `utc` }
      )
      return getCronStreamPath(spec.expression, spec.timezone)
    }
    return undefined
  }

  private extractManifestCronSpec(
    manifest: Record<string, unknown>
  ): { expression: string; timezone: string } | undefined {
    if (manifest.kind === `source` && manifest.sourceType === `cron`) {
      const config = isRecord(manifest.config) ? manifest.config : undefined
      if (typeof config?.expression === `string`) {
        return resolveCronScheduleSpec(
          config.expression,
          typeof config.timezone === `string` ? config.timezone : undefined,
          { fallback: `utc` }
        )
      }
    }

    if (
      manifest.kind === `schedule` &&
      manifest.scheduleType === `cron` &&
      typeof manifest.expression === `string`
    ) {
      return resolveCronScheduleSpec(
        manifest.expression,
        typeof manifest.timezone === `string` ? manifest.timezone : undefined,
        { fallback: `utc` }
      )
    }

    return undefined
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
        from:
          typeof manifest.from === `string` ? manifest.from : ownerEntityUrl,
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
   * Deliver a message to an entity's main stream, with optional input schema
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
    }
    if (req.type) {
      value.message_type = req.type
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
      throw new ElectricAgentsError(`UNAUTHORIZED`, `Invalid write token`, 401)
    }
    if (entity.status === `stopped`) {
      throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409)
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
        `ENTITY_PERSIST_FAILED`,
        `Entity not found after tag write`,
        500
      )
    }

    if (result.changed && this.entityBridgeManager) {
      await this.entityBridgeManager.onEntityChanged(entityUrl)
    }

    return updated
  }

  async removeTag(
    entityUrl: string,
    key: string,
    token: string
  ): Promise<ElectricAgentsEntity> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }

    if (!this.isValidWriteToken(entity, token)) {
      throw new ElectricAgentsError(`UNAUTHORIZED`, `Invalid write token`, 401)
    }
    if (entity.status === `stopped`) {
      throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409)
    }

    const result = await this.registry.removeEntityTag(entityUrl, key)
    const updated = result.entity
    if (!updated) {
      throw new ElectricAgentsError(
        `ENTITY_PERSIST_FAILED`,
        `Entity not found after tag delete`,
        500
      )
    }

    if (result.changed && this.entityBridgeManager) {
      await this.entityBridgeManager.onEntityChanged(entityUrl)
    }

    return updated
  }

  async registerEntitiesSource(tags: Record<string, string>): Promise<{
    sourceRef: string
    streamUrl: string
  }> {
    if (!this.entityBridgeManager) {
      throw new Error(`Entity bridge manager not configured`)
    }
    return this.entityBridgeManager.register(this.validateTags(tags))
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
      await this.syncEntitiesManifestSource(entityUrl, key, operation, value)
      return
    }

    await this.streamClient.append(entity.streams.main, encoded)
    await this.syncEntitiesManifestSource(entityUrl, key, operation, value)
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
    await this.wakeRegistry.unregisterByManifestKey(entityUrl, manifestKey)
    await this.wakeRegistry.register({
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
      from?: string
      messageType?: string
    }
  ): Promise<{ txid: string }> {
    if (!this.scheduler) {
      throw new Error(`Scheduler not configured`)
    }

    const targetUrl = req.targetUrl ?? ownerEntityUrl
    const from = req.from ?? ownerEntityUrl
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

    await this.wakeRegistry.unregisterByManifestKey(ownerEntityUrl, manifestKey)
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
            payload: req.payload,
            producerId,
            ...(req.from ? { from: req.from } : {}),
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
        payload: req.payload,
        producerId,
        ...(req.from ? { from: req.from } : {}),
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
    await this.wakeRegistry.unregisterByManifestKey(entityUrl, manifestKey)

    const txid = randomUUID()
    await this.writeManifestEntry(entityUrl, manifestKey, `delete`, undefined, {
      txid,
    })

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
      const results = this.wakeRegistry.evaluate(sourceUrl, event)
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

  private async syncEntitiesManifestSource(
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
  // Kill
  // ==========================================================================

  async kill(entityUrl: string): Promise<{ txid: number }> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }

    await this.wakeRegistry.unregisterBySubscriber(entityUrl)
    await this.wakeRegistry.unregisterBySource(entityUrl)

    const txid = await this.registry.updateStatusWithTxid(entityUrl, `stopped`)
    if (this.entityBridgeManager) {
      await this.entityBridgeManager.onEntityChanged(entityUrl)
    }

    // Append entity_stopped to main/error streams and close them.
    const stoppedEvent = entityStateSchema.entityStopped.insert({
      key: `stopped`,
      value: {
        timestamp: new Date().toISOString(),
      },
    } as any)
    const eofData = this.encodeChangeEvent(
      stoppedEvent as Record<string, unknown>
    )

    for (const streamPath of [entity.streams.main, entity.streams.error]) {
      try {
        await this.streamClient.append(streamPath, eofData, { close: true })
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

    return { txid }
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
   * Add new input/output schema keys to an entity type directly in Postgres.
   */
  async amendSchemas(
    typeName: string,
    schemas: {
      inbox_schemas?: Record<string, Record<string, unknown>>
      state_schemas?: Record<string, Record<string, unknown>>
    }
  ): Promise<ElectricAgentsEntityType> {
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
   * Called by ElectricAgentsServer during webhook forwarding to inject entity context.
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
      },
      triggerEvent: `message_received`,
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
    if (entity.status === `stopped`) {
      throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409)
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
    await this.wakeRegistry.stopSync()
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
