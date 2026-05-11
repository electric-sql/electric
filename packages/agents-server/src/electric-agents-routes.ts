/**
 * HTTP handlers for Electric Agents entity management.
 */

import {
  handleElectricAgentsError,
  parseJsonBody,
  readBody,
  sendJson,
  sendJsonError,
} from './electric-agents-http'
import {
  assertRunnerAdminStatus,
  assertRunnerKind,
  ErrCodeUnknownEntityType,
  toPublicEntity,
} from './electric-agents-types'
import { runnerWakeStream } from './dispatch-wake-router'
import { serverLog } from './log.js'
import { formatAuthenticatedUser } from './authenticated-user-format'
import type { ElectricAgentsManager } from './electric-agents-manager'
import type { StreamClient } from './stream-client'
import type {
  AuthenticatedRequestUser,
  AuthenticateRequest,
  DispatchPolicy,
  ElectricAgentsRunner,
  RegisterRunnerRequest,
  RunnerHeartbeatRequest,
} from './electric-agents-types'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface ElectricAgentsRoutesOptions {
  streamClient?: StreamClient
  authenticateRequest?: AuthenticateRequest
  onEntityKilled?: (entityUrl: string) => void | Promise<void>
}

export class ElectricAgentsRoutes {
  private manager: ElectricAgentsManager
  private onEntityKilled?: (entityUrl: string) => void | Promise<void>
  private streamClient?: StreamClient
  private authenticateRequest?: AuthenticateRequest

  constructor(
    manager: ElectricAgentsManager,
    optsOrStreamClient?: ElectricAgentsRoutesOptions | StreamClient,
    authenticateRequest?: AuthenticateRequest
  ) {
    this.manager = manager

    if (
      optsOrStreamClient &&
      (`streamClient` in optsOrStreamClient ||
        `authenticateRequest` in optsOrStreamClient ||
        `onEntityKilled` in optsOrStreamClient)
    ) {
      this.streamClient = optsOrStreamClient.streamClient
      this.authenticateRequest = optsOrStreamClient.authenticateRequest
      this.onEntityKilled = optsOrStreamClient.onEntityKilled
    } else {
      this.streamClient = optsOrStreamClient as StreamClient | undefined
      this.authenticateRequest = authenticateRequest
    }
  }

  async handleRequest(
    method: string,
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    if (path === `/_electric/runners`) {
      if (method === `POST`) {
        await this.handleRegisterRunner(req, res)
        return true
      }
      if (method === `GET`) {
        await this.handleListRunners(req, res)
        return true
      }
    }

    const runnerMatch = path.match(
      /^\/_electric\/runners\/([^/]+)(?:\/(heartbeat|disable|enable))?$/
    )
    if (runnerMatch) {
      const runnerId = decodeURIComponent(runnerMatch[1]!)
      const action = runnerMatch[2]

      if (!action && method === `GET`) {
        await this.handleGetRunner(runnerId, req, res)
        return true
      }
      if (action === `heartbeat` && method === `POST`) {
        await this.handleHeartbeatRunner(runnerId, req, res)
        return true
      }
      if ((action === `disable` || action === `enable`) && method === `POST`) {
        await this.handleSetRunnerAdminStatus(runnerId, action, req, res)
        return true
      }
      return false
    }

    if (path === `/_electric/entities` && method === `GET`) {
      await this.handleListEntities(req, res)
      return true
    }

    // POST /_electric/cron/register — register a cron virtual stream
    if (path === `/_electric/cron/register` && method === `POST`) {
      await this.handleCronRegister(req, res)
      return true
    }

    if (path === `/_electric/entities/register` && method === `POST`) {
      await this.handleEntitiesRegister(req, res)
      return true
    }

    const scheduleMatch = path.match(
      /^(\/(?!_)[^/*]+\/[^/*]+)\/schedules\/([^/*]+)$/
    )
    if (scheduleMatch) {
      const entityUrl = scheduleMatch[1]!
      const scheduleId = decodeURIComponent(scheduleMatch[2]!)

      const entity = await this.manager.registry.getEntity(entityUrl)
      if (!entity) {
        const typeName = entityUrl.split(`/`)[1]!
        const entityType = await this.manager.registry.getEntityType(typeName)
        if (entityType) {
          sendJsonError(
            res,
            404,
            `NOT_FOUND`,
            `Entity not found at ${entityUrl}`
          )
          return true
        }
        return false
      }

      if (method === `PUT`) {
        await this.handleUpsertSchedule(entityUrl, scheduleId, req, res)
        return true
      }
      if (method === `DELETE`) {
        await this.handleDeleteSchedule(entityUrl, scheduleId, res)
        return true
      }
      return false
    }

    const tagMatch = path.match(/^(\/(?!_)[^/*]+\/[^/*]+)\/tags\/([^/*]+)$/)
    if (tagMatch) {
      const entityUrl = tagMatch[1]!
      const tagKey = decodeURIComponent(tagMatch[2]!)

      const entity = await this.manager.registry.getEntity(entityUrl)
      if (!entity) {
        const typeName = entityUrl.split(`/`)[1]!
        const entityType = await this.manager.registry.getEntityType(typeName)
        if (entityType) {
          sendJsonError(
            res,
            404,
            `NOT_FOUND`,
            `Entity not found at ${entityUrl}`
          )
          return true
        }
        return false
      }

      if (method === `POST`) {
        await this.handleSetTag(entityUrl, tagKey, req, res)
        return true
      }
      if (method === `DELETE`) {
        await this.handleRemoveTag(entityUrl, tagKey, req, res)
        return true
      }
      return false
    }

    // Entity action routes: /{type}/{name}/send
    // Excludes _-prefixed paths and glob patterns (*)
    const forkMatch = path.match(/^(\/(?!_)[^/*]+\/[^/*]+)\/fork$/)
    if (forkMatch) {
      const entityUrl = forkMatch[1]!

      const entity = await this.manager.registry.getEntity(entityUrl)
      if (!entity) {
        const typeName = entityUrl.split(`/`)[1]!
        const entityType = await this.manager.registry.getEntityType(typeName)
        if (entityType) {
          sendJsonError(
            res,
            404,
            `NOT_FOUND`,
            `Entity not found at ${entityUrl}`
          )
          return true
        }
        return false
      }

      if (method === `POST`) {
        await this.handleFork(entityUrl, req, res)
        return true
      }
      return false
    }

    const actionMatch = path.match(/^(\/(?!_)[^/*]+\/[^/*]+)\/send$/)
    if (actionMatch) {
      const entityUrl = actionMatch[1]!

      const entity = await this.manager.registry.getEntity(entityUrl)
      if (!entity) {
        const typeName = entityUrl.split(`/`)[1]!
        const entityType = await this.manager.registry.getEntityType(typeName)
        if (entityType) {
          sendJsonError(
            res,
            404,
            `NOT_FOUND`,
            `Entity not found at ${entityUrl}`
          )
          return true
        }
        return false
      }

      if (method === `POST`) {
        await this.handleSend(entityUrl, req, res)
        return true
      }
      return false
    }

    // PUT/GET/HEAD/DELETE /{type}/{name}
    // Excludes _-prefixed paths and glob patterns (*)
    const entityMatch = path.match(/^\/(?!_)[^/*]+\/[^/*]+$/)
    if (entityMatch) {
      const typeName = path.split(`/`)[1]!
      const entityType = await this.manager.registry.getEntityType(typeName)

      if (method === `PUT`) {
        if (!entityType) {
          sendJsonError(
            res,
            404,
            ErrCodeUnknownEntityType,
            `Entity type "${typeName}" not found`
          )
          return true
        }
        await this.handleSpawn(path, req, res)
        return true
      }

      const entity = await this.manager.registry.getEntity(path)
      if (!entity) {
        if (entityType) {
          sendJsonError(res, 404, `NOT_FOUND`, `Entity not found at ${path}`)
          return true
        }
        return false
      }

      if (method === `GET`) {
        sendJson(res, 200, toPublicEntity(entity))
        return true
      }
      if (method === `HEAD`) {
        res.writeHead(200)
        res.end()
        return true
      }
      if (method === `DELETE`) {
        await this.handleKill(path, res)
        return true
      }
    }

    return false
  }

  private async authenticateIncomingRequest(
    req: IncomingMessage
  ): Promise<AuthenticatedRequestUser | null> {
    if (!this.authenticateRequest) return null

    try {
      const user = await this.authenticateRequest(req)
      if (
        !user ||
        typeof user.userId !== `string` ||
        user.userId.length === 0
      ) {
        return null
      }
      return user
    } catch (err) {
      serverLog.warn(
        `[agent-server] authenticateRequest failed:`,
        err instanceof Error ? err.message : String(err)
      )
      return null
    }
  }

  private async authorizeRunnerTarget(
    runnerId: string,
    user: AuthenticatedRequestUser | null,
    res: ServerResponse,
    action: `spawn`
  ): Promise<boolean> {
    if (!this.authenticateRequest || !user) {
      sendJsonError(
        res,
        401,
        `AUTHENTICATION_REQUIRED`,
        `Authentication is required to ${action} runner-targeted work`
      )
      return false
    }

    const runner = await this.manager.registry.getRunner(runnerId)
    if (!runner) {
      sendJsonError(res, 404, `NOT_FOUND`, `Runner not found`)
      return false
    }
    if (runner.admin_status !== `enabled`) {
      sendJsonError(res, 403, `RUNNER_DISABLED`, `Runner is disabled`)
      return false
    }
    if (runner.owner_user_id !== user.userId) {
      sendJsonError(
        res,
        403,
        `FORBIDDEN`,
        `Authenticated user does not own the target runner`
      )
      return false
    }

    return true
  }

  private async authorizeRunnerManagement(
    runnerId: string,
    req: IncomingMessage,
    res: ServerResponse,
    action: `get` | `heartbeat` | `enable` | `disable`
  ): Promise<ElectricAgentsRunner | null | undefined> {
    if (!this.authenticateRequest) {
      // Scaffold-only: local development without an auth hook keeps direct
      // runner management access so examples and manual testing still work.
      return null
    }

    const user = await this.authenticateIncomingRequest(req)
    if (!user) {
      sendJsonError(
        res,
        401,
        `AUTHENTICATION_REQUIRED`,
        `Authentication is required to ${action} a runner`
      )
      return undefined
    }

    const runner = await this.manager.registry.getRunner(runnerId)
    if (!runner) {
      sendJsonError(res, 404, `NOT_FOUND`, `Runner not found`)
      return undefined
    }
    if (runner.owner_user_id !== user.userId) {
      sendJsonError(
        res,
        403,
        `FORBIDDEN`,
        `Authenticated user does not own the runner`
      )
      return undefined
    }

    return runner
  }

  private async handleRegisterRunner(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<
      Partial<RegisterRunnerRequest> & {
        runnerId?: string
        ownerUserId?: string
        adminStatus?: string
        wakeStream?: string
      }
    >(req, res)
    if (!parsed) return

    const id = parsed.id ?? parsed.runnerId
    const suppliedOwnerUserId = parsed.owner_user_id ?? parsed.ownerUserId
    const authenticatedUser = this.authenticateRequest
      ? await this.authenticateIncomingRequest(req)
      : null
    if (this.authenticateRequest && !authenticatedUser) {
      sendJsonError(
        res,
        401,
        `AUTHENTICATION_REQUIRED`,
        `Authentication is required to register a runner`
      )
      return
    }
    if (
      authenticatedUser &&
      suppliedOwnerUserId !== undefined &&
      suppliedOwnerUserId !== authenticatedUser.userId
    ) {
      sendJsonError(
        res,
        403,
        `OWNER_MISMATCH`,
        `owner_user_id must match the authenticated user`
      )
      return
    }
    // TODO(auth): when no authenticateRequest hook is configured, this keeps
    // the explicit owner_user_id scaffold-only path for local/dev setups.
    // Production runner ownership should come from authenticated user identity.
    const ownerUserId = authenticatedUser?.userId ?? suppliedOwnerUserId
    const label = parsed.label
    const kindRaw = parsed.kind ?? `local`
    const adminStatusRaw =
      parsed.admin_status ?? parsed.adminStatus ?? `enabled`
    const wakeStream =
      parsed.wake_stream ??
      parsed.wakeStream ??
      (id ? runnerWakeStream(id) : ``)

    if (!id || typeof id !== `string`) {
      sendJsonError(res, 400, `INVALID_REQUEST`, `Missing required field: id`)
      return
    }
    if (id.includes(`/`)) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `Runner id must not contain forward slashes`
      )
      return
    }
    if (!ownerUserId || typeof ownerUserId !== `string`) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `Missing required field: owner_user_id`
      )
      return
    }
    if (!label || typeof label !== `string`) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `Missing required field: label`
      )
      return
    }
    if (
      !wakeStream ||
      typeof wakeStream !== `string` ||
      !wakeStream.startsWith(`/`)
    ) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `wake_stream must be an absolute stream path`
      )
      return
    }
    if (typeof kindRaw !== `string` || typeof adminStatusRaw !== `string`) {
      sendJsonError(res, 400, `INVALID_REQUEST`, `Invalid runner status fields`)
      return
    }

    let kind: RegisterRunnerRequest[`kind`]
    let adminStatus: RegisterRunnerRequest[`admin_status`]
    try {
      kind = assertRunnerKind(kindRaw)
      adminStatus = assertRunnerAdminStatus(adminStatusRaw)
    } catch (err) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        err instanceof Error ? err.message : `Invalid runner field`
      )
      return
    }

    try {
      if (authenticatedUser) {
        const existingRunner = await this.manager.registry.getRunner(id)
        if (
          existingRunner &&
          existingRunner.owner_user_id !== authenticatedUser.userId
        ) {
          sendJsonError(
            res,
            403,
            `OWNER_MISMATCH`,
            `Authenticated user does not own the existing runner`
          )
          return
        }
      }

      if (this.streamClient) {
        await this.ensureWakeStreamExists(wakeStream)
      }
      const runner = await this.manager.registry.createRunner({
        id,
        ownerUserId,
        label,
        kind,
        adminStatus,
        wakeStream,
      })
      sendJson(res, 201, runner)
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleListRunners(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? `/_electric/runners`, `http://localhost`)
    const suppliedOwnerUserId =
      url.searchParams.get(`owner_user_id`) ??
      url.searchParams.get(`ownerUserId`) ??
      undefined

    if (this.authenticateRequest) {
      const user = await this.authenticateIncomingRequest(req)
      if (!user) {
        sendJsonError(
          res,
          401,
          `AUTHENTICATION_REQUIRED`,
          `Authentication is required to list runners`
        )
        return
      }
      if (suppliedOwnerUserId && suppliedOwnerUserId !== user.userId) {
        sendJsonError(
          res,
          403,
          `OWNER_MISMATCH`,
          `owner_user_id must match the authenticated user`
        )
        return
      }

      const runners = await this.manager.registry.listRunners({
        ownerUserId: user.userId,
      })
      sendJson(res, 200, runners)
      return
    }

    // Scaffold-only: without an auth hook, keep the query filter available for
    // local development and manual runner inspection.
    const runners = await this.manager.registry.listRunners({
      ownerUserId: suppliedOwnerUserId,
    })
    sendJson(res, 200, runners)
  }

  private async handleGetRunner(
    runnerId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const authorizedRunner = await this.authorizeRunnerManagement(
      runnerId,
      req,
      res,
      `get`
    )
    if (authorizedRunner === undefined) return
    if (authorizedRunner) {
      sendJson(res, 200, authorizedRunner)
      return
    }

    const runner = await this.manager.registry.getRunner(runnerId)
    if (!runner) {
      sendJsonError(res, 404, `NOT_FOUND`, `Runner not found`)
      return
    }
    sendJson(res, 200, runner)
  }

  private async handleHeartbeatRunner(
    runnerId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const authorizedRunner = await this.authorizeRunnerManagement(
      runnerId,
      req,
      res,
      `heartbeat`
    )
    if (authorizedRunner === undefined) return

    const parsed = await parseOptionalJsonBody<
      Partial<RunnerHeartbeatRequest> & {
        leaseMs?: number
        livenessLeaseExpiresAt?: string
      }
    >(req, res)
    if (!parsed) return

    const leaseMs = parsed.lease_ms ?? parsed.leaseMs
    if (leaseMs !== undefined && (!Number.isFinite(leaseMs) || leaseMs <= 0)) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `lease_ms must be a positive number`
      )
      return
    }

    const leaseExpiresRaw =
      parsed.liveness_lease_expires_at ?? parsed.livenessLeaseExpiresAt
    const livenessLeaseExpiresAt = leaseExpiresRaw
      ? new Date(leaseExpiresRaw)
      : undefined
    if (
      livenessLeaseExpiresAt &&
      Number.isNaN(livenessLeaseExpiresAt.getTime())
    ) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `liveness_lease_expires_at must be a valid timestamp`
      )
      return
    }

    const runner = await this.manager.registry.heartbeatRunner({
      runnerId,
      leaseMs,
      livenessLeaseExpiresAt,
    })
    if (!runner) {
      sendJsonError(res, 404, `NOT_FOUND`, `Runner not found`)
      return
    }
    sendJson(res, 200, runner)
  }

  private async handleSetRunnerAdminStatus(
    runnerId: string,
    action: `disable` | `enable`,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const authorizedRunner = await this.authorizeRunnerManagement(
      runnerId,
      req,
      res,
      action
    )
    if (authorizedRunner === undefined) return

    const runner = await this.manager.registry.setRunnerAdminStatus(
      runnerId,
      action === `disable` ? `disabled` : `enabled`
    )
    if (!runner) {
      sendJsonError(res, 404, `NOT_FOUND`, `Runner not found`)
      return
    }
    sendJson(res, 200, runner)
  }

  private async ensureWakeStreamExists(wakeStream: string): Promise<void> {
    if (!this.streamClient) return

    const exists = await this.streamClient.exists(wakeStream)
    if (exists) return

    try {
      await this.streamClient.create(wakeStream, {
        contentType: `application/json`,
      })
    } catch (err) {
      if (isAlreadyExistsStreamError(err)) return
      throw err
    }
  }

  private async handleSpawn(
    url: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const segments = url.split(`/`).filter(Boolean)
    const typeName = segments[0]!
    const instanceId = segments[1]!

    let parsed: {
      args?: Record<string, unknown>
      tags?: Record<string, string>
      parent?: string
      dispatch_policy?: DispatchPolicy
      initialMessage?: unknown
      wake?: {
        subscriberUrl: string
        condition:
          | `runFinished`
          | {
              on: `change`
              collections?: Array<string>
              ops?: Array<`insert` | `update` | `delete`>
            }
        debounceMs?: number
        timeoutMs?: number
        includeResponse?: boolean
      }
    } = {}
    const bodyBytes = await readBody(req)
    const bodyStr = new TextDecoder().decode(bodyBytes)
    if (bodyStr.trim()) {
      try {
        parsed = JSON.parse(bodyStr)
      } catch {
        sendJsonError(res, 400, `INVALID_REQUEST`, `Invalid JSON body`)
        return
      }
    }

    try {
      const dispatchPolicy = await this.manager.resolveEffectiveDispatchPolicy(
        typeName,
        {
          dispatch_policy: parsed.dispatch_policy,
          parent: parsed.parent,
        }
      )
      const target = dispatchPolicy?.targets[0]
      const authenticatedUser = await this.authenticateIncomingRequest(req)
      if (target?.type === `runner`) {
        const authorized = await this.authorizeRunnerTarget(
          target.runnerId,
          authenticatedUser,
          res,
          `spawn`
        )
        if (!authorized) return
      }

      const formattedUser = formatAuthenticatedUser(authenticatedUser)
      const parsedTags = parsed.tags ?? undefined
      let tags = parsedTags
      if (this.authenticateRequest) {
        if (formattedUser) {
          tags = { ...(parsedTags ?? {}), created_by: formattedUser }
        } else if (parsedTags) {
          tags = Object.fromEntries(
            Object.entries(parsedTags).filter(([key]) => key !== `created_by`)
          )
        } else {
          tags = undefined
        }
      }
      const entity = await this.manager.spawn(typeName, {
        instance_id: instanceId,
        args: parsed.args,
        tags,
        parent: parsed.parent,
        dispatch_policy: parsed.dispatch_policy,
        initialMessage: parsed.initialMessage,
        wake: parsed.wake,
      })
      sendJson(res, 201, { ...toPublicEntity(entity), txid: entity.txid })
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleListEntities(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? `/_electric/entities`, `http://localhost`)
    const type = url.searchParams.get(`type`) ?? undefined
    const status = url.searchParams.get(`status`) ?? undefined
    const parent = url.searchParams.get(`parent`) ?? undefined

    try {
      const { entities } = await this.manager.registry.listEntities({
        type,
        status,
        parent,
      })
      sendJson(
        res,
        200,
        entities.map((entity) => toPublicEntity(entity))
      )
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleSend(
    entityUrl: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<{
      from?: string
      payload?: unknown
      key?: string
      type?: string
      afterMs?: number
    }>(req, res)
    if (!parsed) return

    try {
      const formattedUser = formatAuthenticatedUser(
        await this.authenticateIncomingRequest(req)
      )
      const from = formattedUser ?? parsed.from
      if (parsed.afterMs && parsed.afterMs > 0) {
        await this.manager.enqueueDelayedSend(
          entityUrl,
          {
            from,
            payload: parsed.payload,
            key: parsed.key,
            type: parsed.type,
          },
          new Date(Date.now() + parsed.afterMs)
        )
      } else {
        await this.manager.send(entityUrl, {
          from,
          payload: parsed.payload,
          key: parsed.key,
          type: parsed.type,
        })
      }
      res.writeHead(204)
      res.end()
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleFork(
    entityUrl: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    let parsed: {
      instance_id?: string
      waitTimeoutMs?: number
    } = {}
    const bodyBytes = await readBody(req)
    const bodyStr = new TextDecoder().decode(bodyBytes)
    if (bodyStr.trim()) {
      try {
        parsed = JSON.parse(bodyStr)
      } catch {
        sendJsonError(res, 400, `INVALID_REQUEST`, `Invalid JSON body`)
        return
      }
    }

    try {
      const result = await this.manager.forkSubtree(entityUrl, {
        rootInstanceId: parsed.instance_id,
        waitTimeoutMs: parsed.waitTimeoutMs,
      })
      sendJson(res, 201, {
        root: toPublicEntity(result.root),
        entities: result.entities.map((entity) => toPublicEntity(entity)),
      })
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleSetTag(
    entityUrl: string,
    key: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<{
      value?: string
    }>(req, res)
    if (!parsed) return

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, ``) ?? ``

    try {
      if (typeof parsed.value !== `string`) {
        sendJsonError(res, 400, `INVALID_REQUEST`, `Tag values must be strings`)
        return
      }
      const updated = await this.manager.setTag(
        entityUrl,
        key,
        { value: parsed.value },
        token
      )
      sendJson(res, 200, toPublicEntity(updated))
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleRemoveTag(
    entityUrl: string,
    key: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, ``) ?? ``

    try {
      const updated = await this.manager.removeTag(entityUrl, key, token)
      sendJson(res, 200, toPublicEntity(updated))
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleUpsertSchedule(
    entityUrl: string,
    scheduleId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<{
      scheduleType?: `cron` | `future_send`
      expression?: string
      timezone?: string
      payload?: unknown
      debounceMs?: number
      timeoutMs?: number
      targetUrl?: string
      fireAt?: string
      from?: string
      messageType?: string
    }>(req, res)
    if (!parsed) return

    try {
      if (parsed.scheduleType === `cron`) {
        if (!parsed.expression) {
          sendJsonError(
            res,
            400,
            `INVALID_REQUEST`,
            `Missing required field: expression`
          )
          return
        }
        if (parsed.payload === undefined) {
          sendJsonError(
            res,
            400,
            `INVALID_REQUEST`,
            `Missing required field: payload`
          )
          return
        }
        const result = await this.manager.upsertCronSchedule(entityUrl, {
          id: scheduleId,
          expression: parsed.expression,
          timezone: parsed.timezone,
          payload: parsed.payload,
          debounceMs: parsed.debounceMs,
          timeoutMs: parsed.timeoutMs,
        })
        sendJson(res, 200, result)
        return
      }

      if (parsed.scheduleType === `future_send`) {
        if (!parsed.fireAt) {
          sendJsonError(
            res,
            400,
            `INVALID_REQUEST`,
            `Missing required field: fireAt`
          )
          return
        }
        const result = await this.manager.upsertFutureSendSchedule(entityUrl, {
          id: scheduleId,
          payload: parsed.payload,
          targetUrl: parsed.targetUrl,
          fireAt: parsed.fireAt,
          from: parsed.from,
          messageType: parsed.messageType,
        })
        sendJson(res, 200, result)
        return
      }

      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `scheduleType must be "cron" or "future_send"`
      )
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleDeleteSchedule(
    entityUrl: string,
    scheduleId: string,
    res: ServerResponse
  ): Promise<void> {
    try {
      const result = await this.manager.deleteSchedule(entityUrl, {
        id: scheduleId,
      })
      sendJson(res, 200, result)
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleKill(
    entityUrl: string,
    res: ServerResponse
  ): Promise<void> {
    try {
      const result = await this.manager.kill(entityUrl)
      await this.onEntityKilled?.(entityUrl)
      sendJson(res, 200, result)
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleCronRegister(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<{
      expression?: string
      timezone?: string
    }>(req, res)
    if (!parsed) return

    if (!parsed.expression) {
      sendJsonError(
        res,
        400,
        `INVALID_REQUEST`,
        `Missing required field: expression`
      )
      return
    }

    try {
      const streamPath = await this.manager.getOrCreateCronStream(
        parsed.expression,
        parsed.timezone
      )
      sendJson(res, 200, { streamUrl: streamPath })
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }

  private async handleEntitiesRegister(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const parsed = await parseJsonBody<{
      tags?: Record<string, string>
    }>(req, res)
    if (!parsed) return

    try {
      const result = await this.manager.registerEntitiesSource(
        parsed.tags ?? {}
      )
      sendJson(res, 200, result)
    } catch (err) {
      handleElectricAgentsError(err, res)
    }
  }
}

async function parseOptionalJsonBody<T>(
  req: IncomingMessage,
  res: ServerResponse
): Promise<T | null> {
  const body = await readBody(req)
  const bodyStr = new TextDecoder().decode(body)
  if (!bodyStr.trim()) {
    return {} as T
  }

  try {
    return JSON.parse(bodyStr) as T
  } catch {
    sendJsonError(res, 400, `INVALID_REQUEST`, `Invalid JSON body`)
    return null
  }
}

function isAlreadyExistsStreamError(err: unknown): boolean {
  if (!err || typeof err !== `object`) return false
  const maybe = err as { status?: unknown; code?: unknown; message?: unknown }
  return (
    maybe.status === 409 ||
    maybe.code === `CONFLICT` ||
    maybe.code === `CONFLICT_SEQ` ||
    (typeof maybe.message === `string` &&
      /already exists|conflict/i.test(maybe.message))
  )
}
