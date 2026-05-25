import {
  DurableStream,
  DurableStreamError,
  FetchError,
  IdempotentProducer,
} from '@durable-streams/client'
import type { EventPointer } from '@electric-ax/agents-runtime'
import { ErrCodeNotFound } from './electric-agents-types.js'
import { ATTR, injectTraceHeaders, withSpan } from './tracing.js'
import type { HeadersRecord, MaybePromise } from '@durable-streams/client'

export type DurableStreamsBearerProvider = string | (() => MaybePromise<string>)

export interface StreamClientOptions {
  bearer?: DurableStreamsBearerProvider
}

export interface StreamAppendResult {
  offset: string
}

export interface StreamMessage {
  data: Uint8Array
  offset: string
}

export interface StreamReadResult {
  messages: Array<StreamMessage>
}

export interface WaitForMessagesResult {
  messages: Array<StreamMessage>
  timedOut: boolean
}

export interface SubscriptionStreamInfo {
  path: string
  tail_offset?: string
  has_pending?: boolean
}

export interface SubscriptionResponse {
  subscription_id?: string
  id?: string
  type?: `webhook` | `pull-wake`
  pattern?: string
  streams?: Array<string | SubscriptionStreamInfo>
  webhook?: {
    url?: string
    signing?: {
      alg?: string
      kid?: string
      jwks_url?: string
    }
  }
  wake_stream?: string
  callback_url?: string
  callback_token?: string
}

export interface SubscriptionCreateInput {
  type: `webhook` | `pull-wake`
  pattern?: string
  streams?: Array<string>
  webhook?: { url: string }
  wake_stream?: string
  lease_ttl_ms?: number
  description?: string
}

export interface SubscriptionClaimResponse {
  wake_id: string
  generation: number
  token: string
  streams: Array<SubscriptionStreamInfo>
  lease_ttl_ms?: number
}

export class DurableStreamsSubscriptionError extends Error {
  readonly code?: string
  readonly errorMessage?: string

  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(`${message}: ${status} ${body}`)
    this.name = `DurableStreamsSubscriptionError`

    try {
      const parsed = JSON.parse(body) as {
        error?: { code?: unknown; message?: unknown }
      }
      if (typeof parsed.error?.code === `string`) {
        this.code = parsed.error.code
      }
      if (typeof parsed.error?.message === `string`) {
        this.errorMessage = parsed.error.message
      }
    } catch {
      // Preserve the raw body in the error message when DS returns non-JSON.
    }
  }
}

async function resolveDurableStreamsBearer(
  bearer: DurableStreamsBearerProvider | undefined
): Promise<string | undefined> {
  if (!bearer) return undefined
  const value = typeof bearer === `function` ? await bearer() : bearer
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
}

export async function applyDurableStreamsBearer(
  headers: Headers,
  bearer: DurableStreamsBearerProvider | undefined,
  opts: { overwrite?: boolean } = {}
): Promise<void> {
  if (!bearer) return
  if (!opts.overwrite && headers.has(`authorization`)) return
  const value = await resolveDurableStreamsBearer(bearer)
  if (value) {
    headers.set(`authorization`, value)
  }
}

function appendPathToBaseUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  const basePath = url.pathname.replace(/\/+$/, ``)
  const childPath = path.replace(/^\/+/, ``)
  url.pathname = childPath
    ? `${basePath === `/` ? `` : basePath}/${childPath}`
    : basePath || `/`
  return url.toString().replace(/\/+$/, ``)
}

function durableStreamsBearerHeaders(
  bearer: DurableStreamsBearerProvider | undefined
): HeadersRecord | undefined {
  if (!bearer) return undefined
  return {
    authorization: async () =>
      (await resolveDurableStreamsBearer(bearer)) ?? ``,
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    (err instanceof DurableStreamError && err.code === ErrCodeNotFound) ||
    (err instanceof FetchError && err.status === 404)
  )
}

function isAbortLikeError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === `AbortError` || err.message === `Stream request was aborted`)
  )
}

function normalizeSubscriptionPattern(pattern: string): string {
  return pattern.replace(/^\/+/, ``)
}

function normalizeSubscriptionStreamPath(path: string): string {
  return path.replace(/^\/+/, ``)
}

function normalizeSubscriptionPath(path: string): string {
  return path.replace(/^\/+/, ``).replace(/\/+$/, ``)
}

export class StreamClient {
  constructor(
    readonly baseUrl: string,
    readonly options: StreamClientOptions = {}
  ) {}

  private streamUrl(path: string): string {
    return appendPathToBaseUrl(this.baseUrl, path)
  }

  private streamHeaders(): HeadersRecord | undefined {
    return durableStreamsBearerHeaders(this.options.bearer)
  }

  private async requestHeaders(
    init?: HeadersInit,
    opts: { overwriteBearer?: boolean } = {}
  ): Promise<Headers> {
    const headers = new Headers(init)
    await applyDurableStreamsBearer(headers, this.options.bearer, {
      overwrite: opts.overwriteBearer,
    })
    return headers
  }

  private backendSubscriptionPath(path: string): string {
    return normalizeSubscriptionPath(path)
  }

  private runtimeSubscriptionPath(path: string): string {
    return normalizeSubscriptionPath(path)
  }

  private subscriptionUrl(subscriptionId: string): string {
    return appendPathToBaseUrl(
      this.baseUrl,
      `/__ds/subscriptions/${encodeURIComponent(subscriptionId)}`
    )
  }

  private subscriptionChildUrl(
    subscriptionId: string,
    ...segments: Array<string>
  ): string {
    const url = new URL(this.subscriptionUrl(subscriptionId))
    url.pathname = `${url.pathname.replace(/\/+$/, ``)}/${segments
      .map((segment) => encodeURIComponent(segment))
      .join(`/`)}`
    return url.toString()
  }

  async create(
    path: string,
    opts: { contentType: string; body?: Uint8Array | string; closed?: boolean }
  ): Promise<void> {
    return await withSpan(`stream.create`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `create`,
      })
      await DurableStream.create({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
        contentType: opts.contentType,
        body: opts.body,
        closed: opts.closed,
      })
    })
  }

  async fork(
    path: string,
    sourcePath: string,
    opts?: { forkPointer?: EventPointer }
  ): Promise<void> {
    return await withSpan(`stream.fork`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `fork`,
      })
      const headers: Record<string, string> = {
        'content-type': `application/json`,
        'Stream-Forked-From': new URL(this.streamUrl(sourcePath)).pathname,
      }
      if (opts?.forkPointer) {
        // PR #347 returns 400 if Stream-Fork-Sub-Offset > 0 without an
        // accompanying Stream-Fork-Offset. When our pointer's offset is
        // `null` (anchor at stream start), send the explicit zero-offset
        // string to satisfy that constraint.
        const ZERO_OFFSET = `0000000000000000_0000000000000000`
        headers[`Stream-Fork-Offset`] = opts.forkPointer.offset ?? ZERO_OFFSET
        if (opts.forkPointer.subOffset > 0) {
          headers[`Stream-Fork-Sub-Offset`] = String(opts.forkPointer.subOffset)
        }
      }
      injectTraceHeaders(headers)

      const response = await fetch(this.streamUrl(path), {
        method: `PUT`,
        headers: await this.requestHeaders(headers),
      })

      if (response.ok) return

      throw new Error(
        `Stream fork failed: ${response.status} ${await response.text()}`
      )
    })
  }

  async append(
    path: string,
    data: Uint8Array | string,
    opts?: { close?: boolean }
  ): Promise<StreamAppendResult> {
    return await withSpan(`stream.append`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: opts?.close ? `append+close` : `append`,
      })
      const handle = new DurableStream({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
        contentType: `application/json`,
        batching: false,
      })
      if (opts?.close) {
        const result = await handle.close({ body: data })
        return { offset: result.finalOffset }
      }

      await handle.append(data)
      const head = await handle.head()
      return { offset: (head.exists && head.offset) || `` }
    })
  }

  async appendIdempotent(
    path: string,
    data: Uint8Array | string,
    opts: { producerId: string; epoch?: number }
  ): Promise<void> {
    return await withSpan(`stream.appendIdempotent`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `appendIdempotent`,
      })
      const stream = new DurableStream({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
        contentType: `application/json`,
      })
      const producer = new IdempotentProducer(stream, opts.producerId, {
        epoch: opts.epoch ?? 0,
      })

      try {
        producer.append(data)
        await producer.flush()
      } finally {
        await producer.detach()
      }
    })
  }

  async appendWithProducerHeaders(
    path: string,
    data: Uint8Array | string,
    opts: { producerId: string; epoch: number; seq: number }
  ): Promise<void> {
    return await withSpan(`stream.appendWithProducerHeaders`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `appendWithProducerHeaders`,
      })
      const headers: Record<string, string> = {
        'content-type': `application/json`,
        'Producer-Id': opts.producerId,
        'Producer-Epoch': String(opts.epoch),
        'Producer-Seq': String(opts.seq),
      }
      injectTraceHeaders(headers)
      const response = await fetch(this.streamUrl(path), {
        method: `POST`,
        headers: await this.requestHeaders(headers),
        body: typeof data === `string` ? data : Buffer.from(data),
      })

      if (response.ok || response.status === 204) {
        return
      }

      throw new Error(
        `Stream append failed: ${response.status} ${await response.text()}`
      )
    })
  }

  async read(path: string, fromOffset?: string): Promise<StreamReadResult> {
    return await withSpan(`stream.read`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `read`,
      })
      const handle = new DurableStream({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
      })
      const response = await handle.stream({
        offset: fromOffset ?? `-1`,
        live: false,
      })
      const body = await response.body()
      return {
        messages:
          body.length === 0
            ? []
            : [
                {
                  data: body,
                  offset: response.offset,
                },
              ],
      }
    })
  }

  async readJson<T = unknown>(
    path: string,
    fromOffset?: string
  ): Promise<Array<T>> {
    return await withSpan(`stream.readJson`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `readJson`,
      })
      const handle = new DurableStream({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
      })
      const response = await handle.stream<T>({
        offset: fromOffset ?? `-1`,
        live: false,
      })
      return await response.json<T>()
    })
  }

  async readJsonWithPointers<T = unknown>(
    path: string,
    fromOffset?: string
  ): Promise<Array<{ item: T; pointer: EventPointer }>> {
    return await withSpan(`stream.readJsonWithPointers`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `readJsonWithPointers`,
      })
      const handle = new DurableStream({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
      })
      const response = await handle.stream<T>({
        offset: fromOffset ?? `-1`,
        live: false,
      })
      // Per-item pointer = { offset: anchor, subOffset: position-in-batch + 1 }
      // where anchor is the END offset of the PREVIOUS batch (null for the
      // very first batch). Matches `entity-stream-db.ts`'s onBeforeBatch
      // semantics so the pointers we mint here align with PR #347's
      // `Stream-Fork-Sub-Offset` interpretation ("N messages past anchor").
      //
      // We must NOT await `response.closed` to know when the read finishes —
      // the inner reader marks the response closed when it observes
      // `upToDate` in the HTTP response *before* the subscriber loop has
      // had a chance to deliver the buffered batch to our callback. So we
      // resolve when our subscriber sees the `upToDate=true` boundary
      // batch instead, which is guaranteed to fire for live:false reads
      // (even on an empty source: the server still returns a final batch
      // with `items=[]` and `upToDate=true`). `response.closed` is used
      // only to propagate hard errors.
      return await new Promise<Array<{ item: T; pointer: EventPointer }>>(
        (resolve, reject) => {
          const result: Array<{ item: T; pointer: EventPointer }> = []
          let previousBatchOffset: string | null = null
          let settled = false
          response.subscribeJson<T>((batch) => {
            const batchAnchor = previousBatchOffset
            batch.items.forEach((item, itemIndex) => {
              result.push({
                item,
                pointer: {
                  offset: batchAnchor,
                  subOffset: itemIndex + 1,
                },
              })
            })
            previousBatchOffset = batch.offset
            if (batch.upToDate && !settled) {
              settled = true
              resolve(result)
            }
          })
          response.closed.catch((err) => {
            if (settled) return
            settled = true
            reject(err)
          })
        }
      )
    })
  }

  async waitForMessages(
    path: string,
    fromOffset: string,
    timeoutMs: number
  ): Promise<WaitForMessagesResult> {
    return await withSpan(`stream.waitForMessages`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `waitForMessages`,
      })
      const handle = new DurableStream({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
      })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await handle.stream({
          offset: fromOffset,
          live: `long-poll`,
          signal: controller.signal,
        })

        const messages: Array<StreamMessage> = []
        return await new Promise<WaitForMessagesResult>((resolve, reject) => {
          let settled = false
          let unsub = () => {}

          const finish = (result: WaitForMessagesResult) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            unsub()
            resolve(result)
          }

          unsub = response.subscribeBytes((chunk) => {
            messages.push({
              data: chunk.data,
              offset: chunk.offset,
            })
            if (chunk.upToDate) {
              finish({ messages, timedOut: false })
            }
          })

          response.closed
            .then(() => finish({ messages, timedOut: false }))
            .catch((err) => {
              if (settled) return
              clearTimeout(timer)
              if (isAbortLikeError(err)) {
                settled = true
                unsub()
                resolve({ messages: [], timedOut: true })
                return
              }
              settled = true
              unsub()
              reject(err)
            })
        })
      } catch (err) {
        clearTimeout(timer)
        if (isAbortLikeError(err)) {
          return { messages: [], timedOut: true }
        }
        throw err
      }
    })
  }

  async delete(path: string): Promise<void> {
    await DurableStream.delete({
      url: this.streamUrl(path),
      headers: this.streamHeaders(),
    })
  }

  async ensure(path: string, opts: { contentType: string }): Promise<void> {
    if (await this.exists(path)) return
    try {
      await this.create(path, opts)
    } catch (err) {
      if (
        err &&
        typeof err === `object` &&
        `status` in err &&
        (err as { status?: unknown }).status === 409
      ) {
        return
      }
      throw err
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const result = await DurableStream.head({
        url: this.streamUrl(path),
        headers: this.streamHeaders(),
      })
      return result.exists
    } catch (err) {
      if (isNotFoundError(err)) {
        return false
      }
      throw err
    }
  }

  async createSubscription(
    pattern: string,
    subscriptionId: string,
    webhookUrl: string,
    description?: string
  ): Promise<SubscriptionResponse> {
    const res = await this.putSubscription(subscriptionId, {
      type: `webhook`,
      pattern: normalizeSubscriptionPattern(pattern),
      webhook: { url: webhookUrl },
      ...(description ? { description } : {}),
    })
    return res
  }

  async putSubscription(
    subscriptionId: string,
    input: SubscriptionCreateInput
  ): Promise<SubscriptionResponse> {
    const res = await fetch(this.subscriptionUrl(subscriptionId), {
      method: `PUT`,
      headers: await this.requestHeaders({
        'content-type': `application/json`,
      }),
      body: JSON.stringify({
        ...input,
        pattern:
          typeof input.pattern === `string`
            ? this.backendSubscriptionPath(
                normalizeSubscriptionPattern(input.pattern)
              )
            : undefined,
        streams: input.streams?.map((stream) =>
          this.backendSubscriptionPath(normalizeSubscriptionStreamPath(stream))
        ),
        wake_stream:
          typeof input.wake_stream === `string`
            ? this.backendSubscriptionPath(
                normalizeSubscriptionStreamPath(input.wake_stream)
              )
            : undefined,
      }),
    })
    return await this.subscriptionJson(res, `Subscription creation failed`)
  }

  async getSubscription(
    subscriptionId: string
  ): Promise<SubscriptionResponse | null> {
    const res = await fetch(this.subscriptionUrl(subscriptionId), {
      method: `GET`,
      headers: await this.requestHeaders(),
    })
    if (res.status === 404) return null
    return await this.subscriptionJson(res, `Subscription query failed`)
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    const res = await fetch(this.subscriptionUrl(subscriptionId), {
      method: `DELETE`,
      headers: await this.requestHeaders(),
    })
    if (res.status === 404 || res.status === 204) return
    if (!res.ok) {
      throw new Error(
        `Subscription delete failed: ${res.status} ${await res.text()}`
      )
    }
  }

  async addSubscriptionStreams(
    subscriptionId: string,
    streams: Array<string>
  ): Promise<SubscriptionResponse> {
    const res = await fetch(
      this.subscriptionChildUrl(subscriptionId, `streams`),
      {
        method: `POST`,
        headers: await this.requestHeaders({
          'content-type': `application/json`,
        }),
        body: JSON.stringify({
          streams: streams.map((stream) =>
            this.backendSubscriptionPath(
              normalizeSubscriptionStreamPath(stream)
            )
          ),
        }),
      }
    )
    return await this.subscriptionJson(res, `Subscription stream add failed`)
  }

  async removeSubscriptionStream(
    subscriptionId: string,
    streamPath: string
  ): Promise<void> {
    const res = await fetch(
      this.subscriptionChildUrl(
        subscriptionId,
        `streams`,
        this.backendSubscriptionPath(
          normalizeSubscriptionStreamPath(streamPath)
        )
      ),
      { method: `DELETE`, headers: await this.requestHeaders() }
    )
    if (res.status === 404 || res.status === 204) return
    if (!res.ok) {
      throw new Error(
        `Subscription stream remove failed: ${res.status} ${await res.text()}`
      )
    }
  }

  async claimSubscription(
    subscriptionId: string,
    worker: string
  ): Promise<SubscriptionClaimResponse | null> {
    const res = await fetch(
      this.subscriptionChildUrl(subscriptionId, `claim`),
      {
        method: `POST`,
        headers: await this.requestHeaders({
          'content-type': `application/json`,
        }),
        body: JSON.stringify({ worker }),
      }
    )
    if (res.status === 204 || res.status === 404) return null
    return (await this.subscriptionJson(
      res,
      `Subscription claim failed`
    )) as SubscriptionClaimResponse
  }

  async ackSubscription(
    subscriptionId: string,
    token: string,
    body: Record<string, unknown>
  ): Promise<SubscriptionResponse> {
    const res = await fetch(this.subscriptionChildUrl(subscriptionId, `ack`), {
      method: `POST`,
      headers: await this.requestHeaders({
        'content-type': `application/json`,
        authorization: `Bearer ${token}`,
      }),
      body: JSON.stringify(this.subscriptionRequestBody(body)),
    })
    return await this.subscriptionJson(res, `Subscription ack failed`)
  }

  async releaseSubscription(
    subscriptionId: string,
    token: string,
    body: Record<string, unknown>
  ): Promise<SubscriptionResponse> {
    const res = await fetch(
      this.subscriptionChildUrl(subscriptionId, `release`),
      {
        method: `POST`,
        headers: await this.requestHeaders({
          'content-type': `application/json`,
          authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify(this.subscriptionRequestBody(body)),
      }
    )
    return await this.subscriptionJson(res, `Subscription release failed`)
  }

  private subscriptionRequestBody(
    body: Record<string, unknown>
  ): Record<string, unknown> {
    const next = { ...body }
    if (typeof next.stream === `string`) {
      next.stream = this.backendSubscriptionPath(next.stream)
    }
    if (typeof next.path === `string`) {
      next.path = this.backendSubscriptionPath(next.path)
    }
    if (Array.isArray(next.acks)) {
      next.acks = next.acks.map((ack) => {
        if (!ack || typeof ack !== `object`) return ack
        const mapped = { ...(ack as Record<string, unknown>) }
        if (typeof mapped.stream === `string`) {
          mapped.stream = this.backendSubscriptionPath(mapped.stream)
        }
        if (typeof mapped.path === `string`) {
          mapped.path = this.backendSubscriptionPath(mapped.path)
        }
        return mapped
      })
    }
    return next
  }

  private subscriptionResponseBody(
    body: SubscriptionResponse
  ): SubscriptionResponse {
    const next = { ...body }
    if (typeof next.pattern === `string`) {
      next.pattern = this.runtimeSubscriptionPath(next.pattern)
    }
    if (typeof next.wake_stream === `string`) {
      next.wake_stream = this.runtimeSubscriptionPath(next.wake_stream)
    }
    if (Array.isArray(next.streams)) {
      next.streams = next.streams.map((stream) => {
        if (typeof stream === `string`)
          return this.runtimeSubscriptionPath(stream)
        return {
          ...stream,
          path: this.runtimeSubscriptionPath(stream.path),
        }
      })
    }
    if (Array.isArray((next as { acks?: unknown }).acks)) {
      ;(next as { acks?: Array<Record<string, unknown>> }).acks = (
        next as { acks: Array<Record<string, unknown>> }
      ).acks.map((ack) => {
        if (!ack || typeof ack !== `object`) return ack
        const mapped = { ...ack }
        if (typeof mapped.stream === `string`) {
          mapped.stream = this.runtimeSubscriptionPath(mapped.stream)
        }
        if (typeof mapped.path === `string`) {
          mapped.path = this.runtimeSubscriptionPath(mapped.path)
        }
        return mapped
      })
    }
    if (typeof (next as { stream?: unknown }).stream === `string`) {
      ;(next as { stream: string }).stream = this.runtimeSubscriptionPath(
        (next as { stream: string }).stream
      )
    }
    return next
  }

  private async subscriptionJson(
    res: Response,
    message: string
  ): Promise<SubscriptionResponse> {
    if (!res.ok) {
      throw new DurableStreamsSubscriptionError(
        message,
        res.status,
        await res.text()
      )
    }
    if (res.status === 204) return {}
    const text = await res.text()
    if (!text.trim()) return {}
    return this.subscriptionResponseBody(
      JSON.parse(text) as SubscriptionResponse
    )
  }
}
