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
  ErrCodeUnknownEntityType,
  toPublicEntity,
} from './electric-agents-types'
import type { ElectricAgentsManager } from './electric-agents-manager'
import type { IncomingMessage, ServerResponse } from 'node:http'

export class ElectricAgentsRoutes {
  private manager: ElectricAgentsManager
  private onEntityKilled?: (entityUrl: string) => void | Promise<void>

  constructor(
    manager: ElectricAgentsManager,
    opts?: {
      onEntityKilled?: (entityUrl: string) => void | Promise<void>
    }
  ) {
    this.manager = manager
    this.onEntityKilled = opts?.onEntityKilled
  }

  async handleRequest(
    method: string,
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
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
      const entity = await this.manager.spawn(typeName, {
        instance_id: instanceId,
        args: parsed.args,
        tags: parsed.tags,
        parent: parsed.parent,
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
      if (parsed.afterMs && parsed.afterMs > 0) {
        await this.manager.enqueueDelayedSend(
          entityUrl,
          {
            from: parsed.from,
            payload: parsed.payload,
            key: parsed.key,
            type: parsed.type,
          },
          new Date(Date.now() + parsed.afterMs)
        )
      } else {
        await this.manager.send(entityUrl, {
          from: parsed.from,
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
