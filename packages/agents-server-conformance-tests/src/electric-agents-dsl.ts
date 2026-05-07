/**
 * Electric Agents testing DSL — fluent builder, history recorder, and invariant checkers.
 *
 * Usage:
 *   await electricAgents(baseUrl)
 *     .subscription('/agents/**', 'agent-handler')
 *     .spawn('/agents/task-1')
 *     .send({ text: 'hello' })
 *     .expectWebhook()
 *     .expectEntityContext()
 *     .respondDone()
 *     .expectStatus('running')
 *     .kill()
 *     .expectStatus('stopped')
 *     .run()
 */

import { createServer as createHttpServer } from 'node:http'
import { Shape, ShapeStream } from '@electric-sql/client'
import { expect } from 'vitest'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { ElectricAgentsEntityRow } from '../../agents-server/src/electric-agents-types.js'

// ============================================================================
// History Event Types
// ============================================================================

export type HistoryEvent =
  | {
      type: `subscription_created`
      pattern: string
      subscriptionId: string
      webhookUrl: string
    }
  | {
      type: `entity_spawned`
      entityUrl: string
      entityType?: string
      status: string
      streams: { main: string; error: string }
      parent?: string
    }
  | {
      type: `message_sent`
      entityUrl: string
      payload: unknown
      from?: string
    }
  | {
      type: `webhook_received`
      consumer_id: string
      epoch: number
      wake_id: string
      entity?: WebhookEntityContext
      trigger_event?: string
    }
  | { type: `webhook_responded`; status: number; body: unknown }
  | {
      type: `entity_status_checked`
      entityUrl: string
      status: string
    }
  | {
      type: `entity_killed`
      entityUrl: string
    }
  | {
      type: `entity_list_fetched`
      count: number
      filter?: { type?: string; status?: string }
    }
  | {
      type: `stream_read`
      path: string
      messageCount: number
    }
  | {
      type: `send_rejected`
      entityUrl: string
      status: number
      code: string
    }
  | {
      type: `spawn_rejected`
      url: string
      status: number
      code: string
    }
  | { type: `entity_type_registered`; name: string; revision: number }
  | { type: `entity_type_inspected`; name: string; revision: number }
  | { type: `entity_type_deleted`; name: string }
  | { type: `entity_type_schemas_amended`; name: string; revision: number }
  | {
      type: `entity_write`
      entityUrl: string
      eventType?: string
      payload: unknown
    }
  | {
      type: `tags_updated`
      entityUrl: string
      tags: Record<string, string>
    }
  | {
      type: `tags_checked`
      entityUrl: string
      tags: Record<string, string>
    }
  | {
      type: `spawn_schema_rejected`
      typeName: string
      instanceId: string
      status: number
      code: string
    }
  | {
      type: `send_schema_rejected`
      entityUrl: string
      messageType: string
      status: number
      code: string
    }
  | {
      type: `write_schema_rejected`
      entityUrl: string
      eventType: string
      status: number
      code: string
    }
  | {
      type: `send_unknown_type_rejected`
      entityUrl: string
      messageType: string
      status: number
      code: string
    }
  | {
      type: `write_unknown_type_rejected`
      entityUrl: string
      eventType: string
      status: number
      code: string
    }
  | { type: `entity_persisted_verified`; entityUrl: string }
  | {
      type: `state_protocol_write`
      entityUrl: string
      eventType: string
      key: string
    }

interface WebhookEntityContext {
  type?: string
  status: string
  url: string
  streams: { main: string; error: string }
  tags?: Record<string, string>
}

export interface EntityTypeRegistration {
  name: string
  description: string
  creation_schema?: Record<string, unknown>
  input_schemas?: Record<string, Record<string, unknown>>
  output_schemas?: Record<string, Record<string, unknown>>
  inbox_schemas?: Record<string, Record<string, unknown>>
  state_schemas?: Record<string, Record<string, unknown>>
  metadata_schema?: Record<string, unknown>
  serve_endpoint?: string
}

interface ElectricAgentsStreamValue {
  from?: string
  payload?: unknown
  [key: string]: unknown
}

interface ElectricAgentsStreamEvent {
  type: string
  key?: string
  value?: ElectricAgentsStreamValue
  headers?: Record<string, unknown>
  [key: string]: unknown
}

export async function fetchShapeRows<T = Record<string, unknown>>(
  baseUrl: string,
  table: string
): Promise<Array<T>> {
  const stream = new ShapeStream({
    url: `${baseUrl}/_electric/electric/v1/shape`,
    params: { table },
    subscribe: false,
  })
  const shape = new Shape(stream)
  const rows = await shape.rows
  return rows as Array<T>
}

async function fetchEntitiesViaShape(
  baseUrl: string,
  filter?: { type?: string; status?: string; parent?: string }
): Promise<Array<ElectricAgentsEntityRow>> {
  let entities = await fetchShapeRows<ElectricAgentsEntityRow>(
    baseUrl,
    `entities`
  )

  if (filter?.type) {
    entities = entities.filter((e) => e.type === filter.type)
  }
  if (filter?.status) {
    entities = entities.filter((e) => e.status === filter.status)
  }
  if (filter?.parent) {
    entities = entities.filter((e) => e.parent === filter.parent)
  }

  return entities
}

function toServerEntityTypeRegistration(
  registration: EntityTypeRegistration
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: registration.name,
    description: registration.description,
    ...(registration.creation_schema && {
      creation_schema: registration.creation_schema,
    }),
    ...(registration.metadata_schema && {
      metadata_schema: registration.metadata_schema,
    }),
    ...(registration.serve_endpoint && {
      serve_endpoint: registration.serve_endpoint,
    }),
  }

  const inboxSchemas = registration.inbox_schemas ?? registration.input_schemas
  const stateSchemas = registration.state_schemas ?? registration.output_schemas

  if (inboxSchemas) {
    body.inbox_schemas = inboxSchemas
  }
  if (stateSchemas) {
    body.state_schemas = stateSchemas
  }

  return body
}

// ============================================================================
// Webhook Notification (received by the test receiver)
// ============================================================================

interface WebhookNotification {
  body: string
  parsed: {
    consumer_id: string
    epoch: number
    wake_id: string
    primary_stream: string
    streams: Array<{ path: string; offset: string }>
    triggered_by: Array<string>
    callback: string
    token: string
    entity?: WebhookEntityContext
    trigger_event?: string
  }
  resolve: (response: { status: number; body: string }) => void
}

function normalizeWebhookPayload(body: string): WebhookNotification[`parsed`] {
  const parsed = JSON.parse(body) as Record<string, unknown>

  return {
    consumer_id: String(parsed.consumer_id ?? parsed.consumerId ?? ``),
    epoch: Number(parsed.epoch ?? 0),
    wake_id: String(parsed.wake_id ?? parsed.wakeId ?? ``),
    primary_stream: String(parsed.primary_stream ?? parsed.streamPath ?? ``),
    streams: Array.isArray(parsed.streams)
      ? (parsed.streams as Array<{ path: string; offset: string }>)
      : [],
    triggered_by: Array.isArray(parsed.triggered_by)
      ? (parsed.triggered_by as Array<string>)
      : Array.isArray(parsed.triggeredBy)
        ? (parsed.triggeredBy as Array<string>)
        : [],
    callback: String(parsed.callback ?? ``),
    token: String(parsed.token ?? parsed.claimToken ?? ``),
    entity: parsed.entity as WebhookEntityContext | undefined,
    trigger_event: (parsed.trigger_event ?? parsed.triggerEvent) as
      | string
      | undefined,
  }
}

// ============================================================================
// Webhook Receiver — local HTTP server for receiving webhook POSTs
// ============================================================================

class WebhookReceiver {
  private server: Server | null = null
  private _url: string | null = null
  private notifications: Array<WebhookNotification> = []
  private waitResolvers: Array<() => void> = []
  private consumedCount = 0

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createHttpServer((req, res) => {
        this.handleRequest(req, res)
      })
      this.server.on(`error`, reject)
      this.server.listen(0, `127.0.0.1`, () => {
        const addr = this.server!.address()
        if (typeof addr === `object` && addr) {
          this._url = `http://127.0.0.1:${addr.port}`
        }
        resolve(this._url!)
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise((resolve) => {
      this.server!.closeAllConnections()
      this.server!.close(() => {
        this.server = null
        this._url = null
        resolve()
      })
    })
  }

  get url(): string {
    if (!this._url) throw new Error(`WebhookReceiver not started`)
    return this._url
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Array<Buffer> = []
    req.on(`data`, (chunk: Buffer) => chunks.push(chunk))
    req.on(`end`, () => {
      const body = Buffer.concat(chunks).toString(`utf-8`)

      try {
        const parsed = normalizeWebhookPayload(body)
        const notification: WebhookNotification = {
          body,
          parsed,
          resolve: (response) => {
            res.writeHead(response.status, {
              'content-type': `application/json`,
            })
            res.end(response.body)
          },
        }

        this.notifications.push(notification)
        for (const waiter of this.waitResolvers) {
          waiter()
        }
        this.waitResolvers = []
      } catch {
        res.writeHead(400)
        res.end(`Invalid JSON`)
      }
    })
  }

  async waitForNotification(timeoutMs = 10_000): Promise<WebhookNotification> {
    const targetIdx = this.consumedCount
    this.consumedCount++

    if (this.notifications.length > targetIdx) {
      return this.notifications[targetIdx]!
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for webhook notification after ${timeoutMs}ms`
          )
        )
      }, timeoutMs)

      const check = () => {
        if (this.notifications.length > targetIdx) {
          clearTimeout(timeout)
          resolve(this.notifications[targetIdx]!)
        } else {
          this.waitResolvers.push(check)
        }
      }
      check()
    })
  }

  async expectNoNotification(timeoutMs = 500): Promise<void> {
    const startCount = this.notifications.length
    await new Promise((r) => setTimeout(r, timeoutMs))
    expect(this.notifications.length).toBe(startCount)
  }

  get received(): Array<WebhookNotification> {
    return this.notifications
  }
}

// ============================================================================
// Serve Endpoint Receiver — local HTTP server that responds to PUT requests
// from Electric Agents during registerTypeViaServe
// ============================================================================

export class ServeEndpointReceiver {
  private server: Server | null = null
  private _url: string | null = null
  private manifest: EntityTypeRegistration | null = null

  async start(manifest: EntityTypeRegistration): Promise<string> {
    this.manifest = manifest
    return new Promise((resolve, reject) => {
      this.server = createHttpServer((req, res) => {
        this.handleRequest(req, res)
      })
      this.server.on(`error`, reject)
      this.server.listen(0, `127.0.0.1`, () => {
        const addr = this.server!.address()
        if (typeof addr === `object` && addr) {
          this._url = `http://127.0.0.1:${addr.port}`
        }
        resolve(this._url!)
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise((resolve) => {
      this.server!.closeAllConnections()
      this.server!.close(() => {
        this.server = null
        this._url = null
        resolve()
      })
    })
  }

  get url(): string {
    if (!this._url) throw new Error(`ServeEndpointReceiver not started`)
    return this._url
  }

  private handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'content-type': `application/json` })
    res.end(JSON.stringify(this.manifest))
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function electricAgentsFetch(
  baseUrl: string,
  path: string,
  opts: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      'content-type': `application/json`,
      ...opts.headers,
    },
  })
}

// ============================================================================
// Step Types
// ============================================================================

type Step =
  | { kind: `subscription`; pattern: string; id: string }
  | {
      kind: `spawn`
      url: string
      type?: string
      tags?: Record<string, string>
    }
  | { kind: `send`; payload: unknown; from: string; type?: string }
  | { kind: `sendTo`; url: string; payload: unknown; from: string }
  | { kind: `expectWebhook`; opts?: ExpectWebhookOpts }
  | { kind: `respondDone` }
  | { kind: `expectEntityContext`; checks?: EntityContextChecks }
  | { kind: `expectStatus`; status: string }
  | { kind: `kill` }
  | { kind: `killUrl`; url: string }
  | { kind: `expectStreamContains`; messageType: string }
  | { kind: `readStream`; stream?: `main` | `error` }
  | {
      kind: `list`
      filter?: {
        type?: string
        status?: string
        parent?: string
        limit?: number
        offset?: number
      }
    }
  | { kind: `expectListCount`; min?: number; max?: number; exact?: number }
  | { kind: `expectListTotal`; total: number }
  | { kind: `expectSpawnError`; url: string; code: string; status: number }
  | { kind: `expectSendError`; code: string; status: number }
  | { kind: `wait`; ms: number }
  | { kind: `custom`; fn: (ctx: RunContext) => Promise<void> }
  // Entity type CRUD
  | { kind: `registerType`; registration: EntityTypeRegistration }
  | { kind: `expectTypeExists`; name: string }
  | { kind: `inspectType`; name: string }
  | { kind: `deleteType`; name: string }
  | { kind: `expectTypeNotExists`; name: string }
  | {
      kind: `amendSchemas`
      name: string
      input_schemas?: Record<string, Record<string, unknown>>
      output_schemas?: Record<string, Record<string, unknown>>
    }
  | { kind: `listTypes` }
  | { kind: `registerTypeViaServe`; registration: EntityTypeRegistration }
  // Updated spawn (typeName + instanceId)
  | {
      kind: `spawnTyped`
      typeName: string
      instanceId: string
      args?: Record<string, unknown>
      tags?: Record<string, string>
      parent?: string
      initialMessage?: unknown
    }
  // Write
  | { kind: `write`; payload: unknown; eventType?: string }
  | {
      kind: `writeStateProtocol`
      event: {
        type: string
        key: string
        value: Record<string, unknown>
        headers: { operation: `insert` | `update`; [k: string]: unknown }
      }
    }
  | {
      kind: `expectStreamEvent`
      type: string
      key: string
      operation: `insert` | `update`
      valueCheck?: (value: Record<string, unknown>) => void
    }
  | {
      kind: `expectStreamEventCount`
      type: string
      count: number
    }
  // Tags
  | { kind: `setTags`; tags: Record<string, string> }
  | { kind: `expectTags`; tags: Record<string, string> }
  // Schema error assertions
  | {
      kind: `expectSpawnSchemaError`
      typeName: string
      instanceId: string
      args?: Record<string, unknown>
      code: string
      status: number
    }
  | {
      kind: `expectSendSchemaError`
      payload: unknown
      messageType: string
      code: string
      status: number
    }
  | {
      kind: `expectWriteSchemaError`
      payload: unknown
      eventType: string
      code: string
      status: number
    }
  | {
      kind: `expectSendUnknownType`
      payload: unknown
      messageType: string
      code: string
      status: number
    }
  | {
      kind: `expectWriteUnknownType`
      payload: unknown
      eventType: string
      code: string
      status: number
    }
  // Persistence
  | { kind: `expectEntityPersisted` }

interface ExpectWebhookOpts {
  timeoutMs?: number
}

interface EntityContextChecks {
  url?: string
  type?: string
  status?: string
}

// ============================================================================
// Run Context — mutable state during execution
// ============================================================================

export interface RunContext {
  baseUrl: string
  receiver: WebhookReceiver
  history: Array<HistoryEvent>
  subscriptions: Array<{ pattern: string; id: string }>

  // Current entity
  currentEntityUrl: string | null
  currentEntityStreams: { main: string; error: string } | null
  currentWriteToken: string | null

  // Current webhook notification
  notification: WebhookNotification | null

  // Last list result
  lastListResult: Array<{
    url: string
    type: string
    status: string
    [key: string]: unknown
  }> | null
  lastListTotal: number | null

  // Last stream read result
  lastStreamMessages: Array<ElectricAgentsStreamEvent> | null

  // Current entity type context
  currentEntityType: string | null

  // Last entity type inspect/get result
  lastTypeResult: Record<string, unknown> | null

  // Last entity type list result
  lastTypeListResult: Array<{
    name: string
    description: string | null
    [key: string]: unknown
  }> | null

  // Serve endpoint receiver for registerTypeViaServe
  serveReceiver: ServeEndpointReceiver | null
}

// ============================================================================
// ElectricAgentsScenario — Fluent builder
// ============================================================================

export class ElectricAgentsScenario {
  private baseUrl: string
  private steps: Array<Step> = []
  private _skipInvariants = false

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  // --- Setup ---

  subscription(pattern: string, id: string): this {
    this.steps.push({ kind: `subscription`, pattern, id })
    return this
  }

  // --- Entity lifecycle ---

  spawn(
    typeName: string,
    instanceId: string,
    opts?: {
      args?: Record<string, unknown>
      tags?: Record<string, string>
      parent?: string
      initialMessage?: unknown
    }
  ): this {
    this.steps.push({
      kind: `spawnTyped`,
      typeName,
      instanceId,
      args: opts?.args,
      tags: opts?.tags,
      parent: opts?.parent,
      initialMessage: opts?.initialMessage,
    })
    return this
  }

  send(payload: unknown, opts: { from: string; type?: string }): this {
    this.steps.push({ kind: `send`, payload, from: opts.from, type: opts.type })
    return this
  }

  sendTo(url: string, payload: unknown, opts: { from: string }): this {
    this.steps.push({ kind: `sendTo`, url, payload, from: opts.from })
    return this
  }

  kill(): this {
    this.steps.push({ kind: `kill` })
    return this
  }

  killUrl(url: string): this {
    this.steps.push({ kind: `killUrl`, url })
    return this
  }

  // --- Webhook interaction ---

  expectWebhook(opts?: ExpectWebhookOpts): this {
    this.steps.push({ kind: `expectWebhook`, opts })
    return this
  }

  respondDone(): this {
    this.steps.push({ kind: `respondDone` })
    return this
  }

  expectEntityContext(checks?: EntityContextChecks): this {
    this.steps.push({ kind: `expectEntityContext`, checks })
    return this
  }

  // --- Assertions ---

  expectStatus(status: string): this {
    this.steps.push({ kind: `expectStatus`, status })
    return this
  }

  expectStreamContains(messageType: string): this {
    this.steps.push({ kind: `expectStreamContains`, messageType })
    return this
  }

  readStream(stream?: `main` | `error`): this {
    this.steps.push({ kind: `readStream`, stream })
    return this
  }

  list(filter?: {
    type?: string
    status?: string
    parent?: string
    limit?: number
    offset?: number
  }): this {
    this.steps.push({ kind: `list`, filter })
    return this
  }

  expectListCount(opts: { min?: number; max?: number; exact?: number }): this {
    this.steps.push({ kind: `expectListCount`, ...opts })
    return this
  }

  expectListTotal(total: number): this {
    this.steps.push({ kind: `expectListTotal`, total })
    return this
  }

  // --- Entity type CRUD ---

  registerType(registration: EntityTypeRegistration): this {
    this.steps.push({ kind: `registerType`, registration })
    return this
  }

  expectTypeExists(name: string): this {
    this.steps.push({ kind: `expectTypeExists`, name })
    return this
  }

  inspectType(name: string): this {
    this.steps.push({ kind: `inspectType`, name })
    return this
  }

  deleteType(name: string): this {
    this.steps.push({ kind: `deleteType`, name })
    return this
  }

  expectTypeNotExists(name: string): this {
    this.steps.push({ kind: `expectTypeNotExists`, name })
    return this
  }

  amendSchemas(
    name: string,
    schemas: {
      input_schemas?: Record<string, Record<string, unknown>>
      output_schemas?: Record<string, Record<string, unknown>>
    }
  ): this {
    this.steps.push({
      kind: `amendSchemas`,
      name,
      input_schemas: schemas.input_schemas,
      output_schemas: schemas.output_schemas,
    })
    return this
  }

  listTypes(): this {
    this.steps.push({ kind: `listTypes` })
    return this
  }

  registerTypeViaServe(registration: EntityTypeRegistration): this {
    this.steps.push({ kind: `registerTypeViaServe`, registration })
    return this
  }

  // --- Write and tags ---

  write(payload: unknown, opts?: { type?: string }): this {
    this.steps.push({ kind: `write`, payload, eventType: opts?.type })
    return this
  }

  writeStateProtocol(event: {
    type: string
    key: string
    value: Record<string, unknown>
    headers: { operation: `insert` | `update`; [k: string]: unknown }
  }): this {
    this.steps.push({ kind: `writeStateProtocol`, event })
    return this
  }

  expectStreamEvent(
    type: string,
    key: string,
    operation: `insert` | `update`,
    valueCheck?: (value: Record<string, unknown>) => void
  ): this {
    this.steps.push({
      kind: `expectStreamEvent`,
      type,
      key,
      operation,
      valueCheck,
    })
    return this
  }

  expectStreamEventCount(type: string, count: number): this {
    this.steps.push({ kind: `expectStreamEventCount`, type, count })
    return this
  }

  setTags(tags: Record<string, string>): this {
    this.steps.push({ kind: `setTags`, tags })
    return this
  }

  expectTags(expected: Record<string, string>): this {
    this.steps.push({ kind: `expectTags`, tags: expected })
    return this
  }

  // --- Schema error assertions ---

  expectSpawnSchemaError(
    typeName: string,
    instanceId: string,
    opts?: { args?: Record<string, unknown> }
  ): this {
    this.steps.push({
      kind: `expectSpawnSchemaError`,
      typeName,
      instanceId,
      args: opts?.args,
      code: `SCHEMA_VALIDATION_ERROR`,
      status: 422,
    })
    return this
  }

  expectSendSchemaError(
    payload: unknown,
    opts: { from: string; type?: string }
  ): this {
    this.steps.push({
      kind: `expectSendSchemaError`,
      payload,
      messageType: opts.type ?? `default`,
      code: `SCHEMA_VALIDATION_ERROR`,
      status: 422,
    })
    return this
  }

  expectWriteSchemaError(payload: unknown, opts?: { type?: string }): this {
    this.steps.push({
      kind: `expectWriteSchemaError`,
      payload,
      eventType: opts?.type ?? `default`,
      code: `SCHEMA_VALIDATION_ERROR`,
      status: 422,
    })
    return this
  }

  expectSendUnknownType(
    payload: unknown,
    opts: { from: string; type: string }
  ): this {
    this.steps.push({
      kind: `expectSendUnknownType`,
      payload,
      messageType: opts.type,
      code: `UNKNOWN_MESSAGE_TYPE`,
      status: 422,
    })
    return this
  }

  expectWriteUnknownType(payload: unknown, opts: { type: string }): this {
    this.steps.push({
      kind: `expectWriteUnknownType`,
      payload,
      eventType: opts.type,
      code: `UNKNOWN_EVENT_TYPE`,
      status: 422,
    })
    return this
  }

  // --- Persistence ---

  expectEntityPersisted(): this {
    this.steps.push({ kind: `expectEntityPersisted` })
    return this
  }

  // --- Error scenarios ---

  expectSpawnError(url: string, code: string, status: number): this {
    this.steps.push({ kind: `expectSpawnError`, url, code, status })
    return this
  }

  expectSendError(code: string, status: number): this {
    this.steps.push({ kind: `expectSendError`, code, status })
    return this
  }

  // --- Tier 2: Raw / Custom ---

  custom(fn: (ctx: RunContext) => Promise<void>): this {
    this.steps.push({ kind: `custom`, fn })
    return this
  }

  wait(ms: number): this {
    this.steps.push({ kind: `wait`, ms })
    return this
  }

  // --- Config ---

  skipInvariants(): this {
    this._skipInvariants = true
    return this
  }

  // --- Execute ---

  async run(): Promise<Array<HistoryEvent>> {
    const receiver = new WebhookReceiver()
    await receiver.start()

    const ctx: RunContext = {
      baseUrl: this.baseUrl,
      receiver,
      history: [],
      subscriptions: [],
      currentEntityUrl: null,
      currentEntityStreams: null,
      currentWriteToken: null,
      notification: null,
      lastListResult: null,
      lastListTotal: null,
      lastStreamMessages: null,
      currentEntityType: null,
      lastTypeResult: null,
      lastTypeListResult: null,
      serveReceiver: null,
    }

    try {
      for (const step of this.steps) {
        await executeStep(ctx, step)
      }

      if (!this._skipInvariants) {
        checkInvariants(ctx.history)
      }

      return ctx.history
    } finally {
      for (const subscription of ctx.subscriptions) {
        try {
          await fetch(
            `${ctx.baseUrl}${subscription.pattern}?subscription=${subscription.id}`,
            { method: `DELETE` }
          )
        } catch {
          // best-effort cleanup
        }
      }
      for (const n of receiver.received) {
        try {
          n.resolve({ status: 200, body: JSON.stringify({ done: true }) })
        } catch {
          // already responded
        }
      }
      await receiver.stop()
      if (ctx.serveReceiver) {
        await ctx.serveReceiver.stop()
      }
    }
  }
}

// ============================================================================
// Step Executor
// ============================================================================

async function executeStep(ctx: RunContext, step: Step): Promise<void> {
  switch (step.kind) {
    case `subscription`: {
      const res = await fetch(
        `${ctx.baseUrl}${step.pattern}?subscription=${step.id}`,
        {
          method: `PUT`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ webhook: ctx.receiver.url }),
        }
      )
      expect(res.status).toBeLessThan(300)
      ctx.subscriptions.push({ pattern: step.pattern, id: step.id })

      ctx.history.push({
        type: `subscription_created`,
        pattern: step.pattern,
        subscriptionId: step.id,
        webhookUrl: ctx.receiver.url,
      })
      break
    }

    case `spawn`: {
      throw new Error(
        `The old 'spawn' step is deprecated. Use 'spawnTyped' instead.`
      )
    }

    case `send`:
    case `sendTo`: {
      let entityUrl = ctx.currentEntityUrl
      if (step.kind === `sendTo`) {
        entityUrl = step.url
      }
      if (!entityUrl)
        throw new Error(`No current entity — did you spawn first?`)

      const body: Record<string, unknown> = { payload: step.payload }
      if (step.from) body.from = step.from

      const res = await electricAgentsFetch(ctx.baseUrl, `${entityUrl}/send`, {
        method: `POST`,
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(204)

      ctx.history.push({
        type: `message_sent`,
        entityUrl,
        payload: step.payload,
        from: step.from,
      })
      break
    }

    case `expectWebhook`: {
      const timeoutMs = step.opts?.timeoutMs ?? 10_000
      const notification = await ctx.receiver.waitForNotification(timeoutMs)

      expect(notification.parsed.consumer_id).toBeDefined()
      expect(notification.parsed.epoch).toBeGreaterThan(0)
      expect(notification.parsed.wake_id).toBeDefined()

      ctx.notification = notification

      ctx.history.push({
        type: `webhook_received`,
        consumer_id: notification.parsed.consumer_id,
        epoch: notification.parsed.epoch,
        wake_id: notification.parsed.wake_id,
        entity: notification.parsed.entity,
        trigger_event: notification.parsed.trigger_event,
      })
      break
    }

    case `respondDone`: {
      if (!ctx.notification) throw new Error(`No notification to respond to`)
      ctx.notification.resolve({
        status: 200,
        body: JSON.stringify({ done: true }),
      })
      ctx.history.push({
        type: `webhook_responded`,
        status: 200,
        body: { done: true },
      })
      ctx.notification = null

      await new Promise((r) => setTimeout(r, 100))
      break
    }

    case `expectEntityContext`: {
      if (!ctx.notification)
        throw new Error(`No notification — did you expectWebhook first?`)

      const entity = ctx.notification.parsed.entity
      expect(
        entity,
        `Webhook payload must contain entity context`
      ).toBeDefined()
      expect(entity!.url).toBeTruthy()
      expect(entity!.streams.main).toBeTruthy()
      expect(entity!.streams.error).toBeTruthy()

      if (step.checks?.url) {
        expect(entity!.url).toBe(step.checks.url)
      }
      if (step.checks?.type) {
        expect(entity!.type).toBe(step.checks.type)
      }
      if (step.checks?.status) {
        expect(entity!.status).toBe(step.checks.status)
      }
      break
    }

    case `expectStatus`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const res = await electricAgentsFetch(ctx.baseUrl, ctx.currentEntityUrl)
      expect(res.status).toBe(200)
      const entity = (await res.json()) as Record<string, unknown>
      if (step.status === `running`) {
        expect([`running`, `idle`]).toContain(entity.status)
      } else {
        expect(entity.status).toBe(step.status)
      }

      ctx.history.push({
        type: `entity_status_checked`,
        entityUrl: ctx.currentEntityUrl,
        status: entity.status as string,
      })
      break
    }

    case `kill`:
    case `killUrl`: {
      let entityUrl = ctx.currentEntityUrl
      if (step.kind === `killUrl`) {
        entityUrl = step.url
      }
      if (!entityUrl)
        throw new Error(`No current entity — did you spawn first?`)

      const res = await electricAgentsFetch(ctx.baseUrl, entityUrl, {
        method: `DELETE`,
      })
      expect(res.status).toBe(200)

      ctx.history.push({
        type: `entity_killed`,
        entityUrl,
      })
      break
    }

    case `readStream`: {
      if (!ctx.currentEntityStreams)
        throw new Error(`No current entity streams`)
      const streamPath =
        step.stream === `error`
          ? ctx.currentEntityStreams.error
          : ctx.currentEntityStreams.main

      const res = await fetch(
        `${ctx.baseUrl}${streamPath}?offset=0000000000000000_0000000000000000`
      )

      if (res.status === 200) {
        const text = await res.text()
        const messages = text ? JSON.parse(text) : []
        ctx.lastStreamMessages = (
          Array.isArray(messages) ? messages : [messages]
        ) as Array<ElectricAgentsStreamEvent>

        ctx.history.push({
          type: `stream_read`,
          path: streamPath,
          messageCount: ctx.lastStreamMessages.length,
        })
      } else {
        ctx.lastStreamMessages = []
        ctx.history.push({
          type: `stream_read`,
          path: streamPath,
          messageCount: 0,
        })
      }
      break
    }

    case `expectStreamContains`: {
      if (!ctx.lastStreamMessages)
        throw new Error(`No stream messages — did you readStream first?`)
      const found = ctx.lastStreamMessages.some(
        (m) => m.type === step.messageType
      )
      expect(
        found,
        `Stream should contain message of type '${step.messageType}'`
      ).toBe(true)
      break
    }

    case `list`: {
      const entities = await fetchEntitiesViaShape(ctx.baseUrl, step.filter)

      // Apply limit/offset if specified (client-side since shapes don't support them)
      let result = entities
      if (step.filter?.offset !== undefined) {
        result = result.slice(step.filter.offset)
      }
      if (step.filter?.limit !== undefined) {
        result = result.slice(0, step.filter.limit)
      }

      ctx.lastListResult = result
      ctx.lastListTotal = entities.length

      ctx.history.push({
        type: `entity_list_fetched`,
        count: result.length,
        filter: step.filter,
      })
      break
    }

    case `expectListCount`: {
      if (!ctx.lastListResult)
        throw new Error(`No list result — did you list() first?`)
      if (step.exact !== undefined) {
        expect(ctx.lastListResult.length).toBe(step.exact)
      }
      if (step.min !== undefined) {
        expect(ctx.lastListResult.length).toBeGreaterThanOrEqual(step.min)
      }
      if (step.max !== undefined) {
        expect(ctx.lastListResult.length).toBeLessThanOrEqual(step.max)
      }
      break
    }

    case `expectSpawnError`: {
      const res = await electricAgentsFetch(ctx.baseUrl, step.url, {
        method: `PUT`,
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(step.status)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe(step.code)

      ctx.history.push({
        type: `spawn_rejected`,
        url: step.url,
        status: step.status,
        code: step.code,
      })
      break
    }

    case `expectSendError`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `${ctx.currentEntityUrl}/send`,
        {
          method: `POST`,
          body: JSON.stringify({ from: `test`, payload: { should: `fail` } }),
        }
      )
      expect(res.status).toBe(step.status)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe(step.code)

      ctx.history.push({
        type: `send_rejected`,
        entityUrl: ctx.currentEntityUrl,
        status: step.status,
        code: step.code,
      })
      break
    }

    case `expectListTotal`: {
      if (ctx.lastListTotal === null)
        throw new Error(`No list total — did you list() first?`)
      expect(ctx.lastListTotal).toBe(step.total)
      break
    }

    case `wait`: {
      await new Promise((r) => setTimeout(r, step.ms))
      break
    }

    case `custom`: {
      await step.fn(ctx)
      break
    }

    // --- Entity type CRUD ---

    case `registerType`: {
      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/_electric/entity-types`,
        {
          method: `POST`,
          body: JSON.stringify(
            toServerEntityTypeRegistration(step.registration)
          ),
        }
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as Record<string, unknown>

      ctx.currentEntityType = step.registration.name

      ctx.history.push({
        type: `entity_type_registered`,
        name: step.registration.name,
        revision: body.revision as number,
      })
      break
    }

    case `expectTypeExists`: {
      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/_electric/entity-types/${step.name}`
      )
      expect(res.status).toBe(200)
      break
    }

    case `inspectType`: {
      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/_electric/entity-types/${step.name}`
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      ctx.lastTypeResult = body

      ctx.history.push({
        type: `entity_type_inspected`,
        name: step.name,
        revision: body.revision as number,
      })
      break
    }

    case `deleteType`: {
      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/_electric/entity-types/${step.name}`,
        { method: `DELETE` }
      )
      expect([200, 204]).toContain(res.status)

      ctx.history.push({
        type: `entity_type_deleted`,
        name: step.name,
      })
      break
    }

    case `expectTypeNotExists`: {
      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/_electric/entity-types/${step.name}`
      )
      expect(res.status).toBe(404)
      break
    }

    case `amendSchemas`: {
      const body: Record<string, unknown> = {}
      if (step.input_schemas) body.inbox_schemas = step.input_schemas
      if (step.output_schemas) body.state_schemas = step.output_schemas

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/_electric/entity-types/${step.name}/schemas`,
        {
          method: `PATCH`,
          body: JSON.stringify(body),
        }
      )
      expect(res.status).toBe(200)
      const result = (await res.json()) as Record<string, unknown>

      ctx.history.push({
        type: `entity_type_schemas_amended`,
        name: step.name,
        revision: result.revision as number,
      })
      break
    }

    case `listTypes`: {
      ctx.lastTypeListResult = await fetchShapeRows(ctx.baseUrl, `entity_types`)
      break
    }

    case `registerTypeViaServe`: {
      const receiver = new ServeEndpointReceiver()
      await receiver.start(step.registration)

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/_electric/entity-types`,
        {
          method: `POST`,
          body: JSON.stringify({
            name: step.registration.name,
            serve_endpoint: receiver.url,
          }),
        }
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as Record<string, unknown>

      ctx.currentEntityType = step.registration.name
      ctx.serveReceiver = receiver

      ctx.history.push({
        type: `entity_type_registered`,
        name: step.registration.name,
        revision: body.revision as number,
      })
      break
    }

    // --- Typed spawn ---

    case `spawnTyped`: {
      const body: Record<string, unknown> = {}
      if (step.args) body.args = step.args
      if (step.tags) body.tags = step.tags
      if (step.parent) body.parent = step.parent
      if (step.initialMessage !== undefined) {
        body.initialMessage = step.initialMessage
      }

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/${step.typeName}/${step.instanceId}`,
        {
          method: `PUT`,
          body: JSON.stringify(body),
        }
      )
      expect(res.status).toBe(201)
      const entity = (await res.json()) as Record<string, unknown>

      ctx.currentEntityUrl = entity.url as string
      ctx.currentEntityStreams = entity.streams as {
        main: string
        error: string
      }
      ctx.currentWriteToken = null

      ctx.history.push({
        type: `entity_spawned`,
        entityUrl: entity.url as string,
        entityType: step.typeName,
        status: entity.status as string,
        streams: entity.streams as { main: string; error: string },
        parent: step.parent,
      })
      break
    }

    // --- Write ---

    case `write`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const body: Record<string, unknown> = {
        type: step.eventType ?? `default`,
        key: `write-${ctx.history.length}`,
        value:
          typeof step.payload === `object` && step.payload !== null
            ? (step.payload as Record<string, unknown>)
            : { data: step.payload },
        headers: { operation: `insert` },
      }

      const writeHeaders: Record<string, string> = {}
      if (ctx.currentWriteToken) {
        writeHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
      }

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `${ctx.currentEntityUrl}/main`,
        {
          method: `POST`,
          headers: writeHeaders,
          body: JSON.stringify(body),
        }
      )
      expect([200, 204]).toContain(res.status)

      ctx.history.push({
        type: `entity_write`,
        entityUrl: ctx.currentEntityUrl,
        eventType: step.eventType,
        payload: step.payload,
      })
      break
    }

    case `writeStateProtocol`: {
      const entityUrl = ctx.currentEntityUrl
      if (!entityUrl)
        throw new Error(`No current entity for writeStateProtocol`)

      const writeHeaders: Record<string, string> = {}
      if (ctx.currentWriteToken) {
        writeHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
      }

      const res = await electricAgentsFetch(ctx.baseUrl, `${entityUrl}/main`, {
        method: `POST`,
        headers: writeHeaders,
        body: JSON.stringify(step.event),
      })
      expect([200, 204]).toContain(res.status)
      ctx.history.push({
        type: `entity_write`,
        entityUrl,
        eventType: step.event.type,
        payload: step.event,
      })
      break
    }

    case `expectStreamEvent`: {
      if (!ctx.lastStreamMessages)
        throw new Error(`readStream() must be called first`)
      const match = ctx.lastStreamMessages.find(
        (e) =>
          e.type === step.type &&
          e.key === step.key &&
          e.headers?.operation === step.operation
      )
      expect(match).toBeDefined()
      if (step.valueCheck && match) {
        step.valueCheck(match.value ?? {})
      }
      break
    }

    case `expectStreamEventCount`: {
      if (!ctx.lastStreamMessages)
        throw new Error(`readStream() must be called first`)
      const count = ctx.lastStreamMessages.filter(
        (e) => e.type === step.type
      ).length
      expect(count).toBe(step.count)
      break
    }

    // --- Tags ---

    case `setTags`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const tagHeaders: Record<string, string> = {}
      if (ctx.currentWriteToken) {
        tagHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
      }

      for (const [key, value] of Object.entries(step.tags)) {
        const res = await electricAgentsFetch(
          ctx.baseUrl,
          `${ctx.currentEntityUrl}/tags/${encodeURIComponent(key)}`,
          {
            method: `POST`,
            headers: tagHeaders,
            body: JSON.stringify({ value }),
          }
        )
        expect(res.status).toBe(200)
      }

      ctx.history.push({
        type: `tags_updated`,
        entityUrl: ctx.currentEntityUrl,
        tags: step.tags,
      })
      break
    }

    case `expectTags`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const res = await electricAgentsFetch(ctx.baseUrl, ctx.currentEntityUrl)
      expect(res.status).toBe(200)
      const entity = (await res.json()) as Record<string, unknown>
      expect(entity.tags).toEqual(step.tags)

      ctx.history.push({
        type: `tags_checked`,
        entityUrl: ctx.currentEntityUrl,
        tags: step.tags,
      })
      break
    }

    // --- Schema error assertions ---

    case `expectSpawnSchemaError`: {
      const body: Record<string, unknown> = {}
      if (step.args) body.args = step.args

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `/${step.typeName}/${step.instanceId}`,
        {
          method: `PUT`,
          body: JSON.stringify(body),
        }
      )
      expect(res.status).toBe(422)
      const result = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(result.error.code).toBe(`SCHEMA_VALIDATION_FAILED`)

      ctx.history.push({
        type: `spawn_schema_rejected`,
        typeName: step.typeName,
        instanceId: step.instanceId,
        status: 422,
        code: `SCHEMA_VALIDATION_FAILED`,
      })
      break
    }

    case `expectSendSchemaError`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `${ctx.currentEntityUrl}/send`,
        {
          method: `POST`,
          body: JSON.stringify({
            type: step.messageType,
            payload: step.payload,
          }),
        }
      )
      expect(res.status).toBe(422)
      const result = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(result.error.code).toBe(`SCHEMA_VALIDATION_FAILED`)

      ctx.history.push({
        type: `send_schema_rejected`,
        entityUrl: ctx.currentEntityUrl,
        messageType: step.messageType,
        status: 422,
        code: `SCHEMA_VALIDATION_FAILED`,
      })
      break
    }

    case `expectWriteSchemaError`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const writeHeaders: Record<string, string> = {}
      if (ctx.currentWriteToken) {
        writeHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
      }

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `${ctx.currentEntityUrl}/main`,
        {
          method: `POST`,
          headers: writeHeaders,
          body: JSON.stringify({
            type: step.eventType,
            key: `schema-test-${ctx.history.length}`,
            value:
              typeof step.payload === `object` && step.payload !== null
                ? (step.payload as Record<string, unknown>)
                : { data: step.payload },
            headers: { operation: `insert` },
          }),
        }
      )
      expect(res.status).toBe(422)
      const result = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(result.error.code).toBe(`SCHEMA_VALIDATION_FAILED`)

      ctx.history.push({
        type: `write_schema_rejected`,
        entityUrl: ctx.currentEntityUrl,
        eventType: step.eventType,
        status: 422,
        code: `SCHEMA_VALIDATION_FAILED`,
      })
      break
    }

    case `expectSendUnknownType`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `${ctx.currentEntityUrl}/send`,
        {
          method: `POST`,
          body: JSON.stringify({
            type: step.messageType,
            payload: step.payload,
          }),
        }
      )
      expect(res.status).toBe(422)
      const result = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(result.error.code).toBe(`UNKNOWN_MESSAGE_TYPE`)

      ctx.history.push({
        type: `send_unknown_type_rejected`,
        entityUrl: ctx.currentEntityUrl,
        messageType: step.messageType,
        status: 422,
        code: `UNKNOWN_MESSAGE_TYPE`,
      })
      break
    }

    case `expectWriteUnknownType`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const writeHeaders: Record<string, string> = {}
      if (ctx.currentWriteToken) {
        writeHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
      }

      const res = await electricAgentsFetch(
        ctx.baseUrl,
        `${ctx.currentEntityUrl}/main`,
        {
          method: `POST`,
          headers: writeHeaders,
          body: JSON.stringify({
            type: step.eventType,
            key: `unknown-type-test-${ctx.history.length}`,
            value:
              typeof step.payload === `object` && step.payload !== null
                ? (step.payload as Record<string, unknown>)
                : { data: step.payload },
            headers: { operation: `insert` },
          }),
        }
      )
      expect(res.status).toBe(422)
      const result = (await res.json()) as {
        error: { code: string; message: string }
      }
      expect(result.error.code).toBe(`UNKNOWN_EVENT_TYPE`)

      ctx.history.push({
        type: `write_unknown_type_rejected`,
        entityUrl: ctx.currentEntityUrl,
        eventType: step.eventType,
        status: 422,
        code: `UNKNOWN_EVENT_TYPE`,
      })
      break
    }

    // --- Persistence ---

    case `expectEntityPersisted`: {
      if (!ctx.currentEntityUrl) throw new Error(`No current entity`)

      const res = await electricAgentsFetch(ctx.baseUrl, ctx.currentEntityUrl)
      expect(res.status).toBe(200)

      ctx.history.push({
        type: `entity_persisted_verified`,
        entityUrl: ctx.currentEntityUrl,
      })
      break
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

// ============================================================================
// Invariant Checkers
// ============================================================================

export function checkInvariants(history: Array<HistoryEvent>): void {
  checkSpawnPrecedesSend(history)
  checkSpawnPrecedesKill(history)
  checkNoSendAfterKill(history)
  checkEntityContextOnWebhook(history)
  checkStreamPathsMatchEntityUrl(history)
  checkStatusTransitionsValid(history)
  checkEntityTypeExistsBeforeSpawn(history)
  checkSchemaValidationAtGates(history)
  checkAdditiveSchemaEvolution(history)
  checkRegistryStreamConsistency(history)
  checkParentExists(history)
  checkNoSpawnAfterTypeDeleted(history)

  const spWrites = history.filter((e) => e.type === `state_protocol_write`)
  for (const w of spWrites) {
    const spw = w as {
      type: string
      entityUrl: string
      eventType: string
      key: string
    }
    expect(
      [`run`, `step`, `text`, `tool_call`, `text_delta`].includes(
        spw.eventType
      ),
      `State Protocol write must have valid event type, got: ${spw.eventType}`
    ).toBe(true)
    expect(spw.key, `State Protocol write must have a key`).toBeTruthy()
    expect(
      spw.entityUrl,
      `State Protocol write must reference an entity`
    ).toBeTruthy()
  }
}

/**
 * Spec S8 — Precedence: an entity must be spawned before messages can be sent to it.
 * ¬send W spawn — "spawn must happen before send"
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkSpawnPrecedesSend(history: Array<HistoryEvent>): void {
  const spawned = new Set<string>()

  for (const event of history) {
    if (event.type === `entity_spawned`) {
      spawned.add(event.entityUrl)
    }
    if (event.type === `message_sent`) {
      expect(
        spawned.has(event.entityUrl),
        `Precedence: message_sent to ${event.entityUrl} but entity was not spawned first`
      ).toBe(true)
    }
  }
}

/**
 * Spec S9 — Precedence: an entity must be spawned before it can be killed.
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkSpawnPrecedesKill(history: Array<HistoryEvent>): void {
  const spawned = new Set<string>()

  for (const event of history) {
    if (event.type === `entity_spawned`) {
      spawned.add(event.entityUrl)
    }
    if (event.type === `entity_killed`) {
      expect(
        spawned.has(event.entityUrl),
        `Precedence: entity_killed ${event.entityUrl} but entity was not spawned first`
      ).toBe(true)
    }
  }
}

/**
 * Spec S3 — Safety: no successful send after kill.
 * Once an entity is killed, message_sent should not appear for it.
 * (send_rejected is fine — that's the expected error path.)
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkNoSendAfterKill(history: Array<HistoryEvent>): void {
  const killed = new Set<string>()

  for (const event of history) {
    if (event.type === `entity_killed`) {
      killed.add(event.entityUrl)
    }
    if (event.type === `message_sent`) {
      expect(
        !killed.has(event.entityUrl),
        `Safety: message_sent to ${event.entityUrl} after it was killed`
      ).toBe(true)
    }
  }
}

/**
 * Spec S6 — Safety: every webhook received while Electric Agents is enabled must contain
 * entity context (entity field in the payload).
 * Soundness: Sound | Completeness: Incomplete (only checks observed webhooks)
 */
function checkEntityContextOnWebhook(history: Array<HistoryEvent>): void {
  for (const event of history) {
    if (event.type === `webhook_received`) {
      expect(
        event.entity,
        `Safety: webhook_received must contain entity context`
      ).toBeDefined()
      expect(event.entity!.url).toBeTruthy()
    }
  }
}

/**
 * Spec S5 — Structural: stream paths must match {entity.url}/main and {entity.url}/error.
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkStreamPathsMatchEntityUrl(history: Array<HistoryEvent>): void {
  for (const event of history) {
    if (event.type === `entity_spawned`) {
      expect(event.streams.main).toBe(`${event.entityUrl}/main`)
      expect(event.streams.error).toBe(`${event.entityUrl}/error`)
    }
  }
}

/**
 * Spec S4 — Safety: entity status transitions must be valid.
 * spawning → running is valid (at spawn time)
 * running/idle → stopped is valid (at kill time)
 * stopped → running is NOT valid
 * Soundness: Sound | Completeness: Incomplete (only checks observed status reads)
 */
function checkStatusTransitionsValid(history: Array<HistoryEvent>): void {
  const lastStatus = new Map<string, string>()

  for (const event of history) {
    if (event.type === `entity_spawned`) {
      lastStatus.set(event.entityUrl, event.status)
    }
    if (event.type === `entity_status_checked`) {
      const prev = lastStatus.get(event.entityUrl)
      if (prev === `stopped`) {
        expect(
          event.status,
          `Safety: entity ${event.entityUrl} transitioned from stopped to ${event.status}`
        ).toBe(`stopped`)
      }
      lastStatus.set(event.entityUrl, event.status)
    }
  }
}

/**
 * Spec R1 — Structural: every entity_spawned must be preceded by an
 * entity_type_registered event for the matching entity type.
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkEntityTypeExistsBeforeSpawn(history: Array<HistoryEvent>): void {
  const registeredTypes = new Set<string>()

  for (const event of history) {
    if (event.type === `entity_type_registered`) {
      registeredTypes.add(event.name)
    }
    if (event.type === `entity_spawned` && event.entityType !== undefined) {
      expect(
        registeredTypes.has(event.entityType),
        `Structural: entity_spawned for type '${event.entityType}' but no prior entity_type_registered event found`
      ).toBe(true)
    }
  }
}

/**
 * Spec R2 — Safety: schema rejection events must carry the correct error code.
 * All schema rejection events (spawn/send/write) must have code SCHEMA_VALIDATION_FAILED.
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkSchemaValidationAtGates(history: Array<HistoryEvent>): void {
  for (const event of history) {
    if (
      event.type === `spawn_schema_rejected` ||
      event.type === `send_schema_rejected` ||
      event.type === `write_schema_rejected`
    ) {
      expect(
        event.code,
        `Safety: ${event.type} must have code SCHEMA_VALIDATION_FAILED, got '${event.code}'`
      ).toBe(`SCHEMA_VALIDATION_FAILED`)
    }
  }
}

/**
 * Spec R3 — Additive-only schema evolution: entity_type_schemas_amended events
 * must not remove or rename schema keys that existed in the prior registration.
 * This checker works on the step inputs stored in history by tracking which
 * amendment steps appear in sequence. Since the history events for amendments
 * only record name and revision (not the actual schema keys), this invariant
 * verifies structural ordering — each amendment event must follow a registration
 * event. Full key-level checking would require schema contents in the event.
 * Soundness: Partial | Completeness: Incomplete (key contents not in history events)
 *
 * Note: The invariant verifies that every schema amendment is preceded by a
 * registration of the same type name, consistent with additive-only evolution.
 */
function checkAdditiveSchemaEvolution(history: Array<HistoryEvent>): void {
  const registeredTypes = new Set<string>()

  for (const event of history) {
    if (event.type === `entity_type_registered`) {
      registeredTypes.add(event.name)
    }
    if (event.type === `entity_type_schemas_amended`) {
      expect(
        registeredTypes.has(event.name),
        `Additive evolution: entity_type_schemas_amended for '${event.name}' but no prior entity_type_registered event found`
      ).toBe(true)
    }
  }
}

/**
 * Spec R4 — Registry stream consistency: every entity_spawned must refer to an
 * entity that has not already been killed, and stream URLs must follow the
 * convention {entity.url}/main and {entity.url}/error.
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkRegistryStreamConsistency(history: Array<HistoryEvent>): void {
  const killedEntities = new Set<string>()

  for (const event of history) {
    if (event.type === `entity_killed`) {
      killedEntities.add(event.entityUrl)
    }
    if (event.type === `entity_spawned`) {
      expect(
        !killedEntities.has(event.entityUrl),
        `Registry consistency: entity_spawned for ${event.entityUrl} but entity was already killed`
      ).toBe(true)

      expect(
        event.streams.main,
        `Registry consistency: entity ${event.entityUrl} streams.main must be ${event.entityUrl}/main`
      ).toBe(`${event.entityUrl}/main`)

      expect(
        event.streams.error,
        `Registry consistency: entity ${event.entityUrl} streams.error must be ${event.entityUrl}/error`
      ).toBe(`${event.entityUrl}/error`)
    }
  }
}

/**
 * Spec R5 — Parent existence: if a spawned entity declares a parent, the
 * parent must have been spawned earlier in the trace and not yet killed.
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkParentExists(history: Array<HistoryEvent>): void {
  const spawnedAlive = new Set<string>()
  for (const event of history) {
    if (event.type === `entity_spawned`) {
      if (event.parent) {
        expect(
          spawnedAlive.has(event.parent),
          `Parent ${event.parent} must be spawned and alive before child ${event.entityUrl} is spawned`
        ).toBe(true)
      }
      spawnedAlive.add(event.entityUrl)
    }
    if (event.type === `entity_killed`) {
      spawnedAlive.delete(event.entityUrl)
    }
  }
}

/**
 * Spec R6 — No spawn after type deleted: every entity_spawned event must not
 * be preceded by an entity_type_deleted event for the same type name (unless
 * re-registered between the deletion and the spawn).
 * Soundness: Sound | Completeness: Complete (within trace)
 */
function checkNoSpawnAfterTypeDeleted(history: Array<HistoryEvent>): void {
  const deletedTypes = new Set<string>()

  for (const event of history) {
    if (event.type === `entity_type_deleted`) {
      deletedTypes.add(event.name)
    }
    if (event.type === `entity_type_registered`) {
      // Re-registration clears the deleted flag
      deletedTypes.delete(event.name)
    }
    if (event.type === `entity_spawned` && event.entityType !== undefined) {
      expect(
        !deletedTypes.has(event.entityType),
        `Safety: entity_spawned for type '${event.entityType}' after it was deleted without re-registration`
      ).toBe(true)
    }
  }
}

// ============================================================================
// State Machine Model (Init/Next formalism)
// ============================================================================

/**
 * Actions available in the Electric Agents entity lifecycle.
 * Used by enabledElectricAgentsActions() as the ENABLED predicate.
 */
export type ElectricAgentsAction =
  | `register_type`
  | `delete_type`
  | `spawn`
  | `send`
  | `kill`
  | `check_status`
  | `list`

/**
 * Model of a single entity type's state.
 */
export interface EntityTypeModel {
  name: string
  hasCreationSchema: boolean
  hasInputSchemas: boolean
  hasOutputSchemas: boolean
}

/**
 * Model of a single entity's state — the "abstract" version
 * that tracks what should be true, independent of the server.
 */
export interface EntityModel {
  url: string
  typeName: string
  status: `running` | `stopped`
  messageCount: number
}

/**
 * World model tracking all entities and entity types in a scenario.
 * This is the Init/Next state that the property test evolves.
 */
export interface ElectricAgentsWorldModel {
  entityTypes: Array<EntityTypeModel>
  entities: Array<EntityModel>
  nextEntityNum: number
}

/**
 * ENABLED predicate — determines which actions can fire from the current state.
 *
 * - register_type: always (up to a cap of 3 types)
 * - delete_type: when entity types exist and no running entities use them
 * - spawn: when at least one entity type is registered (up to a cap)
 * - send: when at least one entity is running
 * - kill: when at least one entity is running
 * - check_status: when at least one entity exists
 * - list: always
 */
export function enabledElectricAgentsActions(
  model: ElectricAgentsWorldModel
): Array<ElectricAgentsAction> {
  const enabled: Array<ElectricAgentsAction> = [`list`]

  if (model.entityTypes.length < 3) {
    enabled.push(`register_type`)
  }

  const runningTypeNames = new Set(
    model.entities.filter((e) => e.status === `running`).map((e) => e.typeName)
  )
  const deletableTypes = model.entityTypes.filter(
    (t) => !runningTypeNames.has(t.name)
  )
  if (deletableTypes.length > 0) {
    enabled.push(`delete_type`)
  }

  if (model.entityTypes.length > 0 && model.entities.length < 4) {
    enabled.push(`spawn`)
  }

  const hasRunning = model.entities.some((e) => e.status === `running`)
  if (hasRunning) {
    enabled.push(`send`, `kill`, `check_status`)
  }

  const hasAny = model.entities.length > 0
  if (hasAny && !hasRunning) {
    enabled.push(`check_status`)
  }

  return enabled
}

/**
 * Next relation — pure state transition for the model.
 * The real server execution happens separately in the property test.
 */
export function applyElectricAgentsAction(
  model: ElectricAgentsWorldModel,
  action: ElectricAgentsAction,
  targetIdx?: number
): ElectricAgentsWorldModel {
  switch (action) {
    case `register_type`: {
      const typeNum = model.entityTypes.length
      return {
        ...model,
        entityTypes: [
          ...model.entityTypes,
          {
            name: `prop-type-${typeNum}`,
            hasCreationSchema: false,
            hasInputSchemas: false,
            hasOutputSchemas: false,
          },
        ],
      }
    }
    case `delete_type`: {
      const runningTypeNames = new Set(
        model.entities
          .filter((e) => e.status === `running`)
          .map((e) => e.typeName)
      )
      const deletable = model.entityTypes.filter(
        (t) => !runningTypeNames.has(t.name)
      )
      if (deletable.length === 0) return model
      const toDelete = deletable[0]!
      return {
        ...model,
        entityTypes: model.entityTypes.filter((t) => t.name !== toDelete.name),
      }
    }
    case `spawn`: {
      if (model.entityTypes.length === 0) return model
      const typeName = model.entityTypes[0]!.name
      return {
        ...model,
        entities: [
          ...model.entities,
          {
            url: `/prop-placeholder/entity-${model.nextEntityNum}`,
            typeName,
            status: `running`,
            messageCount: 0,
          },
        ],
        nextEntityNum: model.nextEntityNum + 1,
      }
    }
    case `send`: {
      if (targetIdx === undefined) return model
      const entities = [...model.entities]
      const e = entities[targetIdx]!
      entities[targetIdx] = { ...e, messageCount: e.messageCount + 1 }
      return { ...model, entities }
    }
    case `kill`: {
      if (targetIdx === undefined) return model
      const entities = [...model.entities]
      const e = entities[targetIdx]!
      entities[targetIdx] = { ...e, status: `stopped` }
      return { ...model, entities }
    }
    case `check_status`:
    case `list`:
      return model
  }
}

// ============================================================================
// Public factory
// ============================================================================

export function electricAgents(baseUrl: string): ElectricAgentsScenario {
  return new ElectricAgentsScenario(baseUrl)
}

export function checkStateProtocolInvariants(
  events: Array<Record<string, unknown>>
): void {
  const stateProtocolEvents = events.filter((e) => e.type && e.key && e.headers)
  if (stateProtocolEvents.length === 0) return

  // E1: Every run must have insert before update
  const runs = new Map<string, Array<Record<string, unknown>>>()
  for (const e of stateProtocolEvents) {
    if (e.type !== `run`) continue
    const key = e.key as string
    if (!runs.has(key)) runs.set(key, [])
    runs.get(key)!.push(e)
  }
  for (const [key, evts] of runs) {
    expect(
      (evts[0] as any).headers.operation,
      `E1: run ${key} must start with insert`
    ).toBe(`insert`)
  }

  // E2: Every step must have insert before update
  const steps = new Map<string, Array<Record<string, unknown>>>()
  for (const e of stateProtocolEvents) {
    if (e.type !== `step`) continue
    const key = e.key as string
    if (!steps.has(key)) steps.set(key, [])
    steps.get(key)!.push(e)
  }
  for (const [key, evts] of steps) {
    expect(
      (evts[0] as any).headers.operation,
      `E2: step ${key} must start with insert`
    ).toBe(`insert`)
  }

  // E3: Every text must have insert before update
  const texts = new Map<string, Array<Record<string, unknown>>>()
  for (const e of stateProtocolEvents) {
    if (e.type !== `text`) continue
    const key = e.key as string
    if (!texts.has(key)) texts.set(key, [])
    texts.get(key)!.push(e)
  }
  for (const [key, evts] of texts) {
    expect(
      (evts[0] as any).headers.operation,
      `E3: text ${key} must start with insert`
    ).toBe(`insert`)
  }

  // E4: Tool call state machine — started → [args_complete] → executing → completed/failed
  const toolCalls = new Map<string, Array<Record<string, unknown>>>()
  for (const e of stateProtocolEvents) {
    if (e.type !== `tool_call`) continue
    const key = e.key as string
    if (!toolCalls.has(key)) toolCalls.set(key, [])
    toolCalls.get(key)!.push(e)
  }
  for (const [key, evts] of toolCalls) {
    expect(evts.length).toBeGreaterThanOrEqual(3)
    expect(
      (evts[0] as any).headers.operation,
      `E4: tool_call ${key} must start with insert`
    ).toBe(`insert`)
    expect(
      (evts[0] as any).value?.status,
      `E4: tool_call ${key} insert must have status started`
    ).toBe(`started`)

    // Find executing event — may be at index 1 (no args_complete) or index 2 (with args_complete)
    const statuses = evts.map((e: any) => e.value?.status)
    const executingIdx = statuses.indexOf(`executing`)
    expect(
      executingIdx,
      `E4: tool_call ${key} must have executing state`
    ).toBeGreaterThan(0)

    // If args_complete is present, it must come after started and before executing
    if (executingIdx > 1) {
      expect(
        statuses[1],
        `E4: tool_call ${key} event after started must be args_complete if not executing`
      ).toBe(`args_complete`)
    }

    // Last event must be completed or failed
    const lastStatus = statuses[statuses.length - 1]
    expect(
      lastStatus === `completed` || lastStatus === `failed`,
      `E4: tool_call ${key} must end with completed or failed, got ${lastStatus}`
    ).toBe(true)

    // tool_name must be consistent across all events
    const toolNames = evts.map((e: any) => e.value?.tool_name).filter(Boolean)
    if (toolNames.length > 0) {
      const first = toolNames[0]
      for (const tn of toolNames) {
        expect(tn, `E4: tool_name must be consistent for ${key}`).toBe(first)
      }
    }
  }

  // E5: text_delta keys must follow {text_id}:{seq} pattern
  const textDeltas = stateProtocolEvents.filter((e) => e.type === `text_delta`)
  for (const d of textDeltas) {
    const key = d.key as string
    expect(key, `E5: text_delta key must contain ':'`).toContain(`:`)
    const [parentKey, seqStr] = key.split(`:`)
    expect(
      Number.isInteger(parseInt(seqStr!, 10)),
      `E5: text_delta seq must be integer`
    ).toBe(true)

    // text_id in value must match parent key from key
    const val = d.value as Record<string, unknown> | undefined
    if (val) {
      expect(
        val.text_id,
        `E5: text_delta value.text_id must match parent key`
      ).toBe(parentKey)
    }
  }

  // E6: Steps must have step_number on both insert and update
  for (const [key, evts] of steps) {
    for (const e of evts) {
      const val = e.value as Record<string, unknown> | undefined
      expect(
        val?.step_number,
        `E6: step ${key} must have step_number`
      ).toBeDefined()
    }
    // step_number must be consistent across insert and update for same key
    const stepNumbers = evts
      .map((e: any) => e.value?.step_number)
      .filter((n: unknown) => n !== undefined)
    if (stepNumbers.length > 1) {
      const first = stepNumbers[0]
      for (const n of stepNumbers) {
        expect(n, `E6: step_number must be consistent for ${key}`).toBe(first)
      }
    }
  }

  // E7: text_delta sequences must be monotonically increasing per parent
  const deltasByParent = new Map<string, Array<number>>()
  for (const d of textDeltas) {
    const key = d.key as string
    const [parentKey, seqStr] = key.split(`:`)
    if (!deltasByParent.has(parentKey!)) deltasByParent.set(parentKey!, [])
    deltasByParent.get(parentKey!)!.push(parseInt(seqStr!, 10))
  }
  for (const [parent, seqs] of deltasByParent) {
    for (let i = 1; i < seqs.length; i++) {
      expect(
        seqs[i]!,
        `E7: text_delta seq for ${parent} must be monotonically increasing`
      ).toBeGreaterThan(seqs[i - 1]!)
    }
  }

  // E8: Run and step completion updates must have finish_reason
  for (const [key, evts] of runs) {
    const updates = evts.filter((e: any) => e.headers.operation === `update`)
    for (const u of updates) {
      const val = u.value as Record<string, unknown>
      if (val.status === `completed`) {
        expect(
          val.finish_reason,
          `E8: run ${key} completion must have finish_reason`
        ).toBeDefined()
      }
    }
  }
  for (const [key, evts] of steps) {
    const updates = evts.filter((e: any) => e.headers.operation === `update`)
    for (const u of updates) {
      const val = u.value as Record<string, unknown>
      if (val.status === `completed`) {
        expect(
          val.finish_reason,
          `E8: step ${key} completion must have finish_reason`
        ).toBeDefined()
      }
    }
  }
}
