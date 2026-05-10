import {
  DurableStream,
  DurableStreamError,
  FetchError,
  IdempotentProducer,
} from '@durable-streams/client'
import { ATTR, injectTraceHeaders, withSpan } from './tracing.js'
import type { WakeNotification } from '@electric-ax/agents-runtime'

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

export interface ConsumerStateResponse {
  state: string
  wake_id?: string | null
  webhook?: {
    wake_id?: string | null
    subscription_id?: string
  }
}

export interface MintWakeNotificationRequest {
  streamPath: string
  streams?: WakeNotification[`streams`]
  triggeredBy?: WakeNotification[`triggeredBy`]
  triggerEvent?: WakeNotification[`triggerEvent`]
  wakeEvent?: WakeNotification[`wakeEvent`]
}

export interface MintWakeNotificationResponse {
  notification: WakeNotification
}

function isNotFoundError(err: unknown): boolean {
  return (
    (err instanceof DurableStreamError && err.code === `NOT_FOUND`) ||
    (err instanceof FetchError && err.status === 404)
  )
}

function isAbortLikeError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === `AbortError` || err.message === `Stream request was aborted`)
  )
}

export class StreamClient {
  constructor(readonly baseUrl: string) {}

  private streamUrl(path: string): string {
    return `${this.baseUrl}${path}`
  }

  async create(
    path: string,
    opts: { contentType: string; body?: Uint8Array | string }
  ): Promise<void> {
    return await withSpan(`stream.create`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `create`,
      })
      await DurableStream.create({
        url: this.streamUrl(path),
        contentType: opts.contentType,
        body: opts.body,
      })
    })
  }

  async fork(path: string, sourcePath: string): Promise<void> {
    return await withSpan(`stream.fork`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: path,
        [ATTR.STREAM_OP]: `fork`,
      })
      const headers: Record<string, string> = {
        'content-type': `application/json`,
        'Stream-Forked-From': sourcePath,
      }
      injectTraceHeaders(headers)

      const response = await fetch(this.streamUrl(path), {
        method: `PUT`,
        headers,
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
        headers,
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
      const handle = new DurableStream({ url: this.streamUrl(path) })
      const response = await handle.stream({
        offset: fromOffset ?? `-1`,
        live: false,
      })
      const messages: Array<StreamMessage> = []

      return await new Promise<StreamReadResult>((resolve, reject) => {
        let settled = false
        let unsub = () => {}

        const finish = (r: StreamReadResult) => {
          if (settled) return
          settled = true
          unsub()
          resolve(r)
        }

        unsub = response.subscribeBytes((chunk) => {
          messages.push({
            data: chunk.data,
            offset: chunk.offset,
          })
          if (chunk.upToDate || chunk.streamClosed) {
            finish({ messages })
          }
        })

        response.closed
          .then(() => finish({ messages }))
          .catch((err) => {
            if (settled) return
            settled = true
            unsub()
            reject(err)
          })
      })
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
      const handle = new DurableStream({ url: this.streamUrl(path) })
      const response = await handle.stream<T>({
        offset: fromOffset ?? `-1`,
        live: false,
      })
      return await response.json<T>()
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
      const handle = new DurableStream({ url: this.streamUrl(path) })
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
    await DurableStream.delete({ url: this.streamUrl(path) })
  }

  async exists(path: string): Promise<boolean> {
    try {
      const result = await DurableStream.head({ url: this.streamUrl(path) })
      return result.exists
    } catch (err) {
      if (isNotFoundError(err)) {
        return false
      }
      throw err
    }
  }

  async headOffset(path: string): Promise<string | null> {
    try {
      const result = await DurableStream.head({ url: this.streamUrl(path) })
      return result.exists ? String(result.offset) : null
    } catch (err) {
      if (isNotFoundError(err)) {
        return null
      }
      throw err
    }
  }

  async createSubscription(
    pattern: string,
    subscriptionId: string,
    webhookUrl: string,
    description?: string
  ): Promise<{ subscription_id: string; webhook_secret?: string }> {
    const url = `${this.baseUrl}${pattern}?subscription=${encodeURIComponent(subscriptionId)}`
    const res = await fetch(url, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        webhook: webhookUrl,
        ...(description ? { description } : {}),
      }),
    })
    if (!res.ok) {
      throw new Error(
        `Subscription creation failed: ${res.status} ${await res.text()}`
      )
    }
    return res.json() as Promise<{
      subscription_id: string
      webhook_secret?: string
    }>
  }

  async getConsumerState(
    consumerId: string
  ): Promise<ConsumerStateResponse | null> {
    const res = await fetch(
      `${this.baseUrl}/consumers/${encodeURIComponent(consumerId)}`,
      { method: `GET` }
    )
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(
        `Consumer query failed: ${res.status} ${await res.text()}`
      )
    }
    return res.json() as Promise<ConsumerStateResponse>
  }

  async mintWakeNotification(
    consumerId: string,
    request: MintWakeNotificationRequest
  ): Promise<MintWakeNotificationResponse> {
    return await withSpan(`stream.mintWakeNotification`, async (span) => {
      span.setAttributes({
        [ATTR.STREAM_PATH]: request.streamPath,
        [ATTR.STREAM_OP]: `mintWakeNotification`,
        [`electric_agents.consumer.id`]: consumerId,
      })

      const headers: Record<string, string> = {
        'content-type': `application/json`,
      }
      injectTraceHeaders(headers)

      const stream = new DurableStream({
        url: this.streamUrl(request.streamPath),
      })
      const head = await stream.head()
      if (!head.exists) {
        throw new Error(
          `Wake notification mint failed for consumer "${consumerId}" ` +
            `stream "${request.streamPath}": 404 Stream not found`
        )
      }

      const registerRes = await fetch(`${this.baseUrl}/consumers`, {
        method: `POST`,
        headers,
        body: JSON.stringify({
          consumer_id: consumerId,
          streams: [request.streamPath],
        }),
      })
      if (registerRes.status !== 200 && registerRes.status !== 201) {
        const body = await registerRes.text()
        throw new Error(
          `Wake notification mint failed for consumer "${consumerId}" ` +
            `stream "${request.streamPath}": consumer registration failed ` +
            `${registerRes.status} ${body}`
        )
      }

      const wakeId = `wake-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      return {
        notification: {
          consumerId,
          epoch: 0,
          wakeId,
          streamPath: request.streamPath,
          streams: request.streams ?? [
            { path: request.streamPath, offset: `-1` },
          ],
          ...(request.triggeredBy ? { triggeredBy: request.triggeredBy } : {}),
          callback: `${this.baseUrl}/consumers/${encodeURIComponent(consumerId)}/acquire`,
          claimToken: wakeId,
          ...(request.triggerEvent
            ? { triggerEvent: request.triggerEvent }
            : {}),
          ...(request.wakeEvent ? { wakeEvent: request.wakeEvent } : {}),
        },
      }
    })
  }
}
