import { ATTR, injectTraceHeaders, withSpan } from './tracing.js'
import type { DrizzleDB } from './db/index.js'
import type {
  DispatchPolicy,
  DispatchTarget,
  ElectricAgentsEntity,
  ElectricAgentsRunner,
  PublicWakeNotification,
} from './electric-agents-types.js'
import type {
  MintWakeNotificationRequest,
  MintWakeNotificationResponse,
  StreamAppendResult,
  StreamClient,
} from './stream-client.js'
import type { WakeNotification } from '@electric-ax/agents-runtime'

export interface DispatchWakeRouterEntityLookup {
  getEntity(entityUrl: string): Promise<ElectricAgentsEntity | null>
  getEntityByStream(streamPath: string): Promise<ElectricAgentsEntity | null>
  getRunner?(runnerId: string): Promise<ElectricAgentsRunner | null>
}

export type DispatchWakeMaterializationStatus =
  | `queued`
  | `coalesced`
  | `skipped`

export interface DispatchWakeMaterializationInput {
  target: Extract<DispatchTarget, { type: `webhook` | `runner` }>
  notification: WakeNotification
  notificationPublic: PublicWakeNotification
  entity?: ElectricAgentsEntity
  runner?: ElectricAgentsRunner
  runnerWakeStream?: string
}

export type DispatchWakeMaterializationResult =
  | {
      status: `queued`
      wakeId?: string
    }
  | {
      status: `coalesced` | `skipped`
      wakeId?: string
      reason?: string
    }

export interface DispatchWakeDeliveredInput {
  wakeId: string
  target: Extract<DispatchTarget, { type: `webhook` | `runner` }>
  runnerWakeStream?: string
  runnerWakeStreamOffset?: string
}

export interface DispatchWakeFailedInput {
  wakeId: string
  target: Extract<DispatchTarget, { type: `webhook` | `runner` }>
  error: unknown
}

export interface DispatchWakeRouterOptions {
  streamClient: StreamClient
  registry?: DispatchWakeRouterEntityLookup
  pgDb?: DrizzleDB
  fetchImpl?: typeof fetch
  materializeWake?: (
    input: DispatchWakeMaterializationInput
  ) =>
    | Promise<DispatchWakeMaterializationResult>
    | DispatchWakeMaterializationResult
  markWakeDelivered?: (
    input: DispatchWakeDeliveredInput
  ) => Promise<void> | void
  markWakeFailed?: (input: DispatchWakeFailedInput) => Promise<void> | void
  /**
   * Optional scaffold hook for replacing minted Durable Streams callback URLs
   * before delivery. Future wiring should persist the original callback via
   * registry.upsertConsumerCallback({
   *   consumerId: notification.consumerId,
   *   callbackUrl: notification.callback,
   *   primaryStream: notification.streamPath,
   * }) and return an Agents Server callback-forward URL using
   * callbackForwardPathForConsumer(notification.consumerId), e.g.
   * /_electric/callback-forward/{consumerId}.
   *
   * The materialized wake_notifications row stores only
   * redactWakeNotification(notification). Raw callback/claim/write tokens are
   * present only in the delivered webhook body or runner wake-stream entry.
   */
  callbackUrlForNotification?: (
    notification: WakeNotification,
    entity: ElectricAgentsEntity
  ) => Promise<string> | string
}

export type DispatchWakeDeliveryResult =
  | {
      target: Extract<DispatchTarget, { type: `webhook` }>
      status: `delivered`
    }
  | {
      target: Extract<DispatchTarget, { type: `runner` }>
      status: `queued`
      runnerWakeStream: string
      runnerWakeStreamOffset: string
    }
  | {
      target: Extract<DispatchTarget, { type: `webhook` | `runner` }>
      status: `coalesced` | `skipped`
      wakeId?: string
      reason?: string
    }

/**
 * Deterministic consumer id for the per-entity consumer mutex.
 *
 * The exact Durable Streams consumer-id convention is intentionally
 * centralized here so this scaffold can be adjusted when the mint API is
 * finalized.
 */
export function consumerIdForEntity(entityUrl: string): string {
  const normalized = entityUrl.replace(/^\/+|\/+$/g, ``)
  if (!normalized) {
    throw new Error(`Cannot build consumer id for empty entity URL`)
  }
  return `entity:${normalized.replaceAll(`/`, `:`)}`
}

export function callbackForwardPathForConsumer(consumerId: string): string {
  if (!consumerId) {
    throw new Error(`Cannot build callback-forward path for empty consumer id`)
  }
  return `/_electric/callback-forward/${encodeURIComponent(consumerId)}`
}

export function runnerWakeStream(runnerId: string): string {
  if (!runnerId) {
    throw new Error(`Cannot build runner wake stream for empty runner id`)
  }
  return `/runners/${encodeURIComponent(runnerId)}/wake`
}

export function redactWakeNotification(
  notification: WakeNotification
): PublicWakeNotification {
  const {
    callback: _callback,
    claimToken: _claimToken,
    writeToken: _writeToken,
    entity,
    ...publicNotification
  } = notification as WakeNotification & { writeToken?: string }

  if (!entity) {
    return publicNotification
  }

  const { writeToken: _entityWriteToken, ...publicEntity } =
    entity as NonNullable<WakeNotification[`entity`]> & { writeToken?: string }
  return {
    ...publicNotification,
    entity: publicEntity,
  }
}

function redactDeliveryTokens(
  notification: WakeNotification
): WakeNotification {
  const {
    writeToken: _writeToken,
    entity,
    ...notificationWithoutTokens
  } = notification as WakeNotification & { writeToken?: string }

  if (!entity) {
    return notificationWithoutTokens
  }

  const { writeToken: _entityWriteToken, ...entityWithoutToken } =
    entity as NonNullable<WakeNotification[`entity`]> & { writeToken?: string }

  return {
    ...notificationWithoutTokens,
    entity: entityWithoutToken,
  }
}

/**
 * Scaffold for pull-wake dispatch. This class is intentionally not wired into
 * stream append/spawn paths yet; it only centralizes helper logic and isolated
 * operations that future slices can call after state/coalescing rules exist.
 */
export class DispatchWakeRouter {
  private readonly streamClient: StreamClient
  private readonly registry?: DispatchWakeRouterEntityLookup
  private readonly fetchImpl: typeof fetch
  private readonly materializeWake?: NonNullable<
    DispatchWakeRouterOptions[`materializeWake`]
  >
  private readonly markWakeDelivered?: NonNullable<
    DispatchWakeRouterOptions[`markWakeDelivered`]
  >
  private readonly markWakeFailed?: NonNullable<
    DispatchWakeRouterOptions[`markWakeFailed`]
  >
  private readonly callbackUrlForNotification?: NonNullable<
    DispatchWakeRouterOptions[`callbackUrlForNotification`]
  >

  constructor(options: DispatchWakeRouterOptions) {
    this.streamClient = options.streamClient
    this.registry = options.registry
    this.fetchImpl = options.fetchImpl ?? fetch
    this.materializeWake = options.materializeWake
    this.markWakeDelivered = options.markWakeDelivered
    this.markWakeFailed = options.markWakeFailed
    this.callbackUrlForNotification = options.callbackUrlForNotification
  }

  async lookupEntity(entityUrl: string): Promise<ElectricAgentsEntity | null> {
    if (!this.registry) {
      throw new Error(`DispatchWakeRouter registry lookup is not configured`)
    }
    return await this.registry.getEntity(entityUrl)
  }

  async lookupEntityByStream(
    streamPath: string
  ): Promise<ElectricAgentsEntity | null> {
    if (!this.registry) {
      throw new Error(`DispatchWakeRouter registry lookup is not configured`)
    }
    return await this.registry.getEntityByStream(streamPath)
  }

  async lookupRunner(runnerId: string): Promise<ElectricAgentsRunner | null> {
    if (!this.registry?.getRunner) {
      throw new Error(`DispatchWakeRouter runner lookup is not configured`)
    }
    return await this.registry.getRunner(runnerId)
  }

  resolveSingleTarget(
    policy: DispatchPolicy | undefined
  ): DispatchTarget | null {
    if (!policy || policy.targets.length === 0) return null
    if (policy.targets.length !== 1) {
      throw new Error(
        `DispatchWakeRouter v1 only supports exactly one dispatch target`
      )
    }
    return policy.targets[0]!
  }

  async mintNotificationForEntity(
    entity: ElectricAgentsEntity,
    request?: Partial<MintWakeNotificationRequest>
  ): Promise<MintWakeNotificationResponse> {
    return await this.streamClient.mintWakeNotification(
      consumerIdForEntity(entity.url),
      {
        ...request,
        streamPath: request?.streamPath ?? entity.streams.main,
      }
    )
  }

  enrichNotification(
    notification: WakeNotification,
    entity: ElectricAgentsEntity
  ): WakeNotification {
    const enriched = this.enrichNotificationEntityContext(notification, entity)
    if (!this.callbackUrlForNotification) {
      return enriched
    }

    const callback = this.callbackUrlForNotification(enriched, entity)
    if (typeof callback !== `string`) {
      void Promise.resolve(callback).catch(() => {})
      throw new Error(
        `DispatchWakeRouter callbackUrlForNotification returned a Promise; use enrichNotificationForEntity()`
      )
    }
    return { ...enriched, callback }
  }

  /**
   * Async enrichment path that supports callback rewrite hooks which need
   * persistence/IO. Prefer this method when callbackUrlForNotification is set.
   */
  async enrichNotificationForEntity(
    notification: WakeNotification,
    entity: ElectricAgentsEntity
  ): Promise<WakeNotification> {
    const enriched = this.enrichNotificationEntityContext(notification, entity)
    if (!this.callbackUrlForNotification) {
      return enriched
    }

    const callback = await this.callbackUrlForNotification(enriched, entity)
    return { ...enriched, callback }
  }

  private enrichNotificationEntityContext(
    notification: WakeNotification,
    entity: ElectricAgentsEntity
  ): WakeNotification {
    const {
      writeToken: _writeToken,
      entity: _entity,
      ...notificationWithoutTokens
    } = notification as WakeNotification & { writeToken?: string }

    return {
      ...notificationWithoutTokens,
      triggerEvent: notification.triggerEvent ?? `message_received`,
      entity: {
        type: entity.type,
        status: entity.status,
        url: entity.url,
        streams: entity.streams,
        tags: entity.tags,
        spawnArgs: entity.spawn_args,
      },
    }
  }

  async dispatchToTarget(
    target: Extract<DispatchTarget, { type: `webhook` | `runner` }>,
    notification: WakeNotification,
    entity?: ElectricAgentsEntity
  ): Promise<DispatchWakeDeliveryResult> {
    return await withSpan(`electric_agents.dispatchWake`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: notification.streamPath,
        [ATTR.STREAM_OP]: `dispatchWake`,
        [`electric_agents.dispatch.target_type`]: target.type,
      })

      const runner =
        target.type === `runner`
          ? await this.resolveEnabledRunner(target.runnerId)
          : undefined
      const resolvedRunnerWakeStream = runner?.wake_stream

      const materialized = await this.materializeWake?.({
        target,
        notification,
        notificationPublic: redactWakeNotification(notification),
        ...(entity ? { entity } : {}),
        ...(runner ? { runner } : {}),
        ...(resolvedRunnerWakeStream
          ? { runnerWakeStream: resolvedRunnerWakeStream }
          : {}),
      })

      if (
        materialized?.status === `coalesced` ||
        materialized?.status === `skipped`
      ) {
        return {
          target,
          status: materialized.status,
          wakeId: materialized.wakeId,
          reason: materialized.reason,
        }
      }

      try {
        if (target.type === `webhook`) {
          await this.postWebhook(target, notification)
          await this.markWakeDelivered?.({
            wakeId: notification.wakeId,
            target,
          })
          return { target, status: `delivered` }
        }

        const append = await this.appendRunnerWake(
          resolvedRunnerWakeStream!,
          notification
        )
        await this.markWakeDelivered?.({
          wakeId: notification.wakeId,
          target,
          runnerWakeStream: resolvedRunnerWakeStream,
          runnerWakeStreamOffset: append.offset,
        })
        return {
          target,
          status: `queued`,
          runnerWakeStream: resolvedRunnerWakeStream!,
          runnerWakeStreamOffset: append.offset,
        }
      } catch (err) {
        await this.markWakeFailed?.({
          wakeId: notification.wakeId,
          target,
          error: err,
        })
        throw err
      }
    })
  }

  private async postWebhook(
    target: Extract<DispatchTarget, { type: `webhook` }>,
    notification: WakeNotification
  ): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': `application/json`,
    }
    injectTraceHeaders(headers)

    const response = await this.fetchImpl(target.url, {
      method: `POST`,
      headers,
      body: JSON.stringify(redactDeliveryTokens(notification)),
    })

    if (!response.ok) {
      throw new Error(
        `Dispatch wake webhook failed: ${response.status} ${await response.text()}`
      )
    }
  }

  private async resolveEnabledRunner(
    runnerId: string
  ): Promise<ElectricAgentsRunner> {
    const runner = await this.lookupRunner(runnerId)
    if (!runner) {
      throw new Error(`Dispatch runner "${runnerId}" was not found`)
    }
    if (runner.admin_status !== `enabled`) {
      throw new Error(`Dispatch runner "${runnerId}" is disabled`)
    }
    if (!runner.wake_stream) {
      throw new Error(`Dispatch runner "${runnerId}" has no wake stream`)
    }
    return runner
  }

  private async appendRunnerWake(
    wakeStream: string,
    notification: WakeNotification
  ): Promise<StreamAppendResult> {
    return await this.streamClient.append(
      wakeStream,
      JSON.stringify(redactDeliveryTokens(notification))
    )
  }
}
