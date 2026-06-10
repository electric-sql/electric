import { queryOnce } from '@durable-streams/state/db'
import { DurableStream } from '@durable-streams/client'
import { assembleContext } from './context-assembly'
import { createContextEntriesApi } from './context-entries'
import { entityStateSchema } from './entity-schema'
import { createGoalApi } from './goal-api'
import { formatPointerOrderToken } from './event-pointer'
import {
  allocateRunKey,
  createOutboundBridge,
  loadOutboundIdSeed,
} from './outbound-bridge'
import { createPiAgentAdapter } from './pi-adapter'
import {
  defaultProjection,
  timelineMessages as runtimeTimelineMessages,
  timelineToMessages,
} from './timeline-context'
import { getCronStreamPath } from './cron-utils'
import { runtimeLog } from './log'
import { sliceChars } from './token-budget'
import { createContextTools } from './tools/context-tools'
import { appendPathToUrl } from './url'
import { CACHE_TIERS } from './types'
import { composeToolsWithProviders } from './tool-providers'
import { validateSlashCommandDefinitions } from './composer-input'
import type { HydratedWebhookSourceWake } from './webhook-sources'
import type { ChangeEvent } from '@durable-streams/state'
import type { Sandbox } from './sandbox/types'
import type {
  DynamicSlashCommandRegistration,
  SlashCommandDefinition,
  SlashCommandHelpers,
  SlashCommandRow,
} from './composer-input'
import type {
  AgentConfig,
  AgentHandle,
  AgentModel,
  AgentRunResult,
  AgentTool,
  AttachmentCreateInput,
  AttachmentsApi,
  EntitySignal,
  EntityHandle,
  EntityStreamDBWithActions,
  ForkOptions,
  HandlerContext,
  LLMContentBlock,
  HandlerWake,
  LLMMessage,
  ManifestAttachmentEntry,
  ManifestRealtimeSessionEntry,
  ObservationHandle,
  ObservationSource,
  RealtimeAudioConfig,
  RealtimeAudioFormat,
  RealtimeConfig,
  RealtimeHandle,
  RealtimeProviderEvent,
  RealtimeProviderSession,
  RealtimeRunResult,
  RunHandle,
  SendResult,
  SharedStateHandle,
  SharedStateSchemaMap,
  StateProxy,
  TimelineProjectionOpts,
  UseContextConfig,
  Wake,
  WakeEvent,
  WakeSession,
} from './types'

const REALTIME_MIN_INPUT_COMMIT_BYTES = 4_800
const REALTIME_SESSION_SOFT_LIMIT_MS = 55 * 60 * 1000
const REALTIME_AUDIO_SPAN_MAX_MS = 500
const REALTIME_PCM16_BYTES_PER_SAMPLE = 2
const REALTIME_DEFAULT_AUDIO_FORMAT: RealtimeAudioFormat = {
  codec: `pcm16`,
  sampleRate: 24_000,
  channels: 1,
}

function agentModelId(model: AgentModel): string {
  return typeof model === `string` ? model : model.id
}

function agentModelProvider(config: AgentConfig): string {
  return typeof config.model === `string`
    ? (config.provider ?? `anthropic`)
    : config.model.provider
}

function isRealtimeSessionManifest(
  entry: unknown
): entry is ManifestRealtimeSessionEntry {
  return (
    typeof entry === `object` &&
    entry !== null &&
    (entry as { kind?: unknown }).kind === `realtime-session` &&
    typeof (entry as { id?: unknown }).id === `string`
  )
}

function realtimeManifestIsActive(
  entry: ManifestRealtimeSessionEntry
): boolean {
  return entry.status === `requested` || entry.status === `active`
}

function getToolName(tool: AgentTool): string | null {
  const name = (tool as { name?: unknown }).name
  return typeof name === `string` ? name : null
}

function applyRealtimeToolPolicy(
  tools: Array<AgentTool>,
  policy: RealtimeConfig[`toolPolicy`]
): Array<AgentTool> {
  if (!policy) return tools
  const allowed = new Set([...(policy.direct ?? []), ...(policy.confirm ?? [])])
  if (allowed.size === 0) return []
  return tools.filter((tool) => {
    const name = getToolName(tool)
    return name != null && allowed.has(name)
  })
}

type RealtimeStreamConfig = NonNullable<HandlerContextConfig[`realtimeStreams`]>
type RealtimeControlInput =
  | { type: `input_text`; text: string }
  | { type: `input_audio.commit`; afterAudioBytes?: number }
  | { type: `response.cancel` }
  | { type: `output_audio.truncate`; itemId: string; audioEndMs: number }
  | { type: `session.close`; reason?: string }
type RealtimeStreamIo = {
  writeProviderEvent: (event: RealtimeProviderEvent) => Promise<void>
  close: () => Promise<void>
}
type RealtimeAudioSpanDraft = {
  stream: `input` | `output`
  seq: number
  producerId: string
  producerEpoch: number
  byteStart: number
  byteEnd: number
  sampleStart: number
  sampleCount: number
  sampleRate: number
  channels: number
  timingSource: `runtime` | `provider`
  createdAt: string
  capturedAt?: string
  receivedAt?: string
  participantId?: string
  providerItemId?: string
  responseId?: string
}

function trackRealtimeAppend(
  pending: Set<Promise<void>>,
  append: Promise<void>,
  onError: (error: unknown) => void
): void {
  let tracked: Promise<void>
  tracked = append.catch(onError).finally(() => {
    pending.delete(tracked)
  })
  pending.add(tracked)
}

function isRealtimeControlInput(value: unknown): value is RealtimeControlInput {
  if (!value || typeof value !== `object`) return false
  const type = (value as { type?: unknown }).type
  if (type === `output_audio.truncate`) {
    return (
      typeof (value as { itemId?: unknown }).itemId === `string` &&
      typeof (value as { audioEndMs?: unknown }).audioEndMs === `number`
    )
  }
  if (type === `input_audio.commit`) {
    const afterAudioBytes = (value as { afterAudioBytes?: unknown })
      .afterAudioBytes
    return (
      afterAudioBytes === undefined ||
      (typeof afterAudioBytes === `number` &&
        Number.isFinite(afterAudioBytes) &&
        afterAudioBytes >= 0)
    )
  }
  if (type === `input_text`) {
    return typeof (value as { text?: unknown }).text === `string`
  }
  return type === `response.cancel` || type === `session.close`
}

function realtimeDurableStream(
  streams: RealtimeStreamConfig,
  path: string,
  contentType: string
): DurableStream {
  return new DurableStream({
    url: appendPathToUrl(streams.baseUrl, path),
    headers: streams.headers,
    contentType,
    batching: true,
  })
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function realtimeControlOutput(event: RealtimeProviderEvent): unknown {
  if (event.type !== `output_audio.delta`) return event
  return {
    type: event.type,
    responseId: event.responseId,
    itemId: event.itemId,
    byteLength: event.audio.byteLength,
  }
}

function useManualRealtimeInputCommits(
  audio: RealtimeAudioConfig | undefined
): boolean {
  return audio?.turnDetection === false || audio?.turnDetection?.type === `none`
}

function realtimeByteOffset(byte: number): string {
  return `byte:${byte}`
}

function realtimeAudioFrameBytes(format: RealtimeAudioFormat): number {
  return REALTIME_PCM16_BYTES_PER_SAMPLE * format.channels
}

function realtimeAudioSamples(
  byteLength: number,
  format: RealtimeAudioFormat
): number {
  return Math.floor(byteLength / realtimeAudioFrameBytes(format))
}

function createRealtimeStreamIo(
  config: HandlerContextConfig,
  session: ManifestRealtimeSessionEntry | undefined,
  providerSession: RealtimeProviderSession,
  audio: RealtimeAudioConfig | undefined
): RealtimeStreamIo | undefined {
  if (!config.realtimeStreams || !session) return undefined

  const logPrefix = `[agent-runtime]`
  const abort = new AbortController()
  const abortFromRun = (): void => abort.abort()
  if (config.runSignal?.aborted) {
    abort.abort()
  } else {
    config.runSignal?.addEventListener(`abort`, abortFromRun, { once: true })
  }

  const audioIn = realtimeDurableStream(
    config.realtimeStreams,
    session.streams.audio_in,
    `audio/pcm`
  )
  const audioOut = realtimeDurableStream(
    config.realtimeStreams,
    session.streams.audio_out,
    `audio/pcm`
  )
  const controlIn = realtimeDurableStream(
    config.realtimeStreams,
    session.streams.control_in,
    `application/json`
  )
  const controlOut = realtimeDurableStream(
    config.realtimeStreams,
    session.streams.control_out,
    `application/json`
  )
  const tasks: Array<Promise<void>> = []
  let audioInChunks = 0
  let audioInBytes = 0
  let committedAudioInBytes = 0
  let controlInCommands = 0
  let audioOutChunks = 0
  let audioOutBytes = 0
  let controlOutEvents = 0
  const pendingOutputAppends = new Set<Promise<void>>()
  const pendingInputCommits: Array<{ afterAudioBytes?: number }> = []
  const pendingAudioChunks: Array<{
    start: number
    end: number
    data: Uint8Array
  }> = []
  const inputAudioFormat = audio?.inputFormat ?? REALTIME_DEFAULT_AUDIO_FORMAT
  const outputAudioFormat = audio?.outputFormat ?? REALTIME_DEFAULT_AUDIO_FORMAT
  const audioSpanDrafts: Partial<
    Record<`input` | `output`, RealtimeAudioSpanDraft>
  > = {}
  let inputAudioSpanSeq = 0
  let outputAudioSpanSeq = 0
  let processingInputCommits = false
  const manualInputCommits = useManualRealtimeInputCommits(audio)

  const trackOutputAppend = (append: Promise<void>, label: string): void => {
    trackRealtimeAppend(pendingOutputAppends, append, (error) => {
      if (!abort.signal.aborted) {
        runtimeLog.warn(logPrefix, `${label}:`, error)
      }
    })
  }

  const flushAudioSpan = (stream: `input` | `output`): void => {
    const draft = audioSpanDrafts[stream]
    if (!draft || draft.byteEnd <= draft.byteStart) return
    audioSpanDrafts[stream] = undefined
    config.writeEvent(
      entityStateSchema.realtimeAudioSpans.insert({
        key: `realtime-audio-span:${session.id}:${stream}:${draft.seq}`,
        value: {
          session_id: session.id,
          stream,
          producer_id: draft.producerId,
          producer_epoch: draft.producerEpoch,
          seq: draft.seq,
          offset: realtimeByteOffset(draft.byteStart),
          next_offset: realtimeByteOffset(draft.byteEnd),
          byte_start: draft.byteStart,
          byte_end: draft.byteEnd,
          byte_length: draft.byteEnd - draft.byteStart,
          sample_start: draft.sampleStart,
          sample_count: draft.sampleCount,
          sample_rate: draft.sampleRate,
          channels: draft.channels,
          codec: `pcm16`,
          timing_source: draft.timingSource,
          created_at: draft.createdAt,
          ...(draft.capturedAt ? { captured_at: draft.capturedAt } : {}),
          ...(draft.receivedAt ? { received_at: draft.receivedAt } : {}),
          ...(draft.participantId
            ? { participant_id: draft.participantId }
            : {}),
          ...(draft.providerItemId
            ? { provider_item_id: draft.providerItemId }
            : {}),
          ...(draft.responseId ? { response_id: draft.responseId } : {}),
        } as never,
      }) as ChangeEvent
    )
  }

  const appendAudioSpan = (input: {
    stream: `input` | `output`
    byteStart: number
    byteLength: number
    format: RealtimeAudioFormat
    producerId: string
    timingSource: `runtime` | `provider`
    capturedAt?: string
    receivedAt?: string
    participantId?: string
    providerItemId?: string
    responseId?: string
  }): void => {
    if (input.byteLength <= 0) return
    const frameBytes = realtimeAudioFrameBytes(input.format)
    const byteEnd = input.byteStart + input.byteLength
    const sampleStart = Math.floor(input.byteStart / frameBytes)
    const sampleCount = realtimeAudioSamples(input.byteLength, input.format)
    const maxSampleCount = Math.max(
      1,
      Math.floor((input.format.sampleRate * REALTIME_AUDIO_SPAN_MAX_MS) / 1000)
    )
    const draft = audioSpanDrafts[input.stream]
    const compatible =
      draft &&
      draft.producerId === input.producerId &&
      draft.timingSource === input.timingSource &&
      draft.participantId === input.participantId &&
      draft.providerItemId === input.providerItemId &&
      draft.responseId === input.responseId &&
      draft.byteEnd === input.byteStart &&
      draft.sampleRate === input.format.sampleRate &&
      draft.channels === input.format.channels &&
      draft.sampleCount + sampleCount <= maxSampleCount

    if (compatible) {
      draft.byteEnd = byteEnd
      draft.sampleCount += sampleCount
      draft.receivedAt = input.receivedAt ?? draft.receivedAt
      return
    }

    flushAudioSpan(input.stream)
    const seq =
      input.stream === `input` ? inputAudioSpanSeq++ : outputAudioSpanSeq++
    audioSpanDrafts[input.stream] = {
      stream: input.stream,
      seq,
      producerId: input.producerId,
      producerEpoch: config.epoch,
      byteStart: input.byteStart,
      byteEnd,
      sampleStart,
      sampleCount,
      sampleRate: input.format.sampleRate,
      channels: input.format.channels,
      timingSource: input.timingSource,
      createdAt: new Date().toISOString(),
      capturedAt: input.capturedAt,
      receivedAt: input.receivedAt,
      participantId: input.participantId,
      providerItemId: input.providerItemId,
      responseId: input.responseId,
    }
  }

  const discardCommittedAudioChunks = (): void => {
    while (
      pendingAudioChunks.length > 0 &&
      pendingAudioChunks[0]!.end <= committedAudioInBytes
    ) {
      pendingAudioChunks.shift()
    }
  }

  const appendAudioRangeToProvider = async (
    start: number,
    end: number
  ): Promise<void> => {
    if (!providerSession.appendInputAudio) return
    for (const chunk of pendingAudioChunks) {
      if (chunk.end <= start) continue
      if (chunk.start >= end) break
      const sliceStart = Math.max(0, start - chunk.start)
      const sliceEnd = Math.min(chunk.data.byteLength, end - chunk.start)
      if (sliceEnd <= sliceStart) continue
      await providerSession.appendInputAudio(
        chunk.data.subarray(sliceStart, sliceEnd)
      )
    }
  }

  const processPendingInputCommits = async (): Promise<void> => {
    if (processingInputCommits) return
    processingInputCommits = true
    try {
      while (pendingInputCommits.length > 0) {
        const command = pendingInputCommits[0]!
        const commitAudioBytes = command.afterAudioBytes ?? audioInBytes
        if (audioInBytes < commitAudioBytes) return

        pendingInputCommits.shift()
        if (commitAudioBytes <= committedAudioInBytes) {
          runtimeLog.info(
            logPrefix,
            `realtime input_audio.commit ignored session=${session.id} audioInBytes=${audioInBytes} committedAudioInBytes=${committedAudioInBytes} commitAudioBytes=${commitAudioBytes}`
          )
          continue
        }

        const pendingAudioBytes = commitAudioBytes - committedAudioInBytes
        if (pendingAudioBytes < REALTIME_MIN_INPUT_COMMIT_BYTES) {
          runtimeLog.info(
            logPrefix,
            `realtime input_audio.commit skipped session=${session.id} audioInBytes=${audioInBytes} committedAudioInBytes=${committedAudioInBytes} commitAudioBytes=${commitAudioBytes}`
          )
          await providerSession.clearInputAudio?.()
          committedAudioInBytes = commitAudioBytes
          discardCommittedAudioChunks()
          continue
        }

        await appendAudioRangeToProvider(
          committedAudioInBytes,
          commitAudioBytes
        )
        await providerSession.commitInputAudio?.()
        committedAudioInBytes = commitAudioBytes
        discardCommittedAudioChunks()
      }
    } finally {
      processingInputCommits = false
    }
  }

  runtimeLog.info(
    logPrefix,
    `realtime stream bridge starting session=${session.id} inputMode=${manualInputCommits ? `manual-commit` : `provider-vad`} audioIn=${session.streams.audio_in} audioOut=${session.streams.audio_out}`
  )

  if (providerSession.appendInputAudio) {
    tasks.push(
      (async () => {
        const response = await audioIn.stream({
          live: true,
          signal: abort.signal,
          warnOnHttp: false,
        })
        try {
          for await (const chunk of response.bodyStream()) {
            if (abort.signal.aborted) break
            const nextChunkCount = audioInChunks + 1
            if (nextChunkCount === 1) {
              runtimeLog.info(
                logPrefix,
                `realtime audio/in first chunk session=${session.id} bytes=${chunk.byteLength}`
              )
            }
            const start = audioInBytes
            audioInChunks = nextChunkCount
            audioInBytes += chunk.byteLength
            appendAudioSpan({
              stream: `input`,
              byteStart: start,
              byteLength: chunk.byteLength,
              format: inputAudioFormat,
              producerId: session.streams.audio_in,
              timingSource: `runtime`,
              participantId: `user`,
              receivedAt: new Date().toISOString(),
            })
            if (manualInputCommits) {
              pendingAudioChunks.push({
                start,
                end: start + chunk.byteLength,
                data: chunk,
              })
              await processPendingInputCommits()
            } else {
              await providerSession.appendInputAudio?.(chunk)
            }
          }
        } finally {
          response.cancel()
        }
      })().catch((error) => {
        if (!abort.signal.aborted) {
          runtimeLog.warn(
            `[agent-runtime] realtime audio/in pump failed:`,
            error
          )
        }
      })
    )
  }

  tasks.push(
    (async () => {
      const response = await controlIn.stream<RealtimeControlInput>({
        live: true,
        signal: abort.signal,
        json: true,
        warnOnHttp: false,
      })
      try {
        for await (const command of response.jsonStream()) {
          if (abort.signal.aborted || !isRealtimeControlInput(command)) {
            continue
          }
          controlInCommands += 1
          if (controlInCommands === 1) {
            runtimeLog.info(
              logPrefix,
              `realtime control/in first command session=${session.id} type=${command.type}`
            )
          }
          switch (command.type) {
            case `input_text`:
              await providerSession.sendText?.(command.text)
              break
            case `input_audio.commit`:
              if (manualInputCommits) {
                pendingInputCommits.push({
                  afterAudioBytes: command.afterAudioBytes,
                })
                await processPendingInputCommits()
              } else {
                runtimeLog.info(
                  logPrefix,
                  `realtime input_audio.commit ignored in provider-vad mode session=${session.id}`
                )
              }
              break
            case `response.cancel`:
              await providerSession.cancelResponse?.()
              break
            case `output_audio.truncate`:
              await providerSession.truncateOutputAudio?.({
                itemId: command.itemId,
                audioEndMs: command.audioEndMs,
              })
              break
            case `session.close`:
              await providerSession.close?.(command.reason)
              abort.abort()
              break
          }
        }
      } finally {
        response.cancel()
      }
    })().catch((error) => {
      if (!abort.signal.aborted) {
        runtimeLog.warn(
          `[agent-runtime] realtime control/in pump failed:`,
          error
        )
      }
    })
  )

  return {
    async writeProviderEvent(event) {
      controlOutEvents += 1
      if (controlOutEvents === 1) {
        runtimeLog.info(
          logPrefix,
          `realtime provider first event session=${session.id} type=${event.type}`
        )
      }
      if (event.type === `output_audio.delta`) {
        const byteStart = audioOutBytes
        audioOutChunks += 1
        audioOutBytes += event.audio.byteLength
        if (audioOutChunks === 1) {
          runtimeLog.info(
            logPrefix,
            `realtime audio/out first chunk session=${session.id} bytes=${event.audio.byteLength}`
          )
        }
        appendAudioSpan({
          stream: `output`,
          byteStart,
          byteLength: event.audio.byteLength,
          format: outputAudioFormat,
          producerId: session.streams.audio_out,
          timingSource: `provider`,
          participantId: `assistant`,
          providerItemId: event.itemId,
          responseId: event.responseId,
          receivedAt: new Date().toISOString(),
        })
        trackOutputAppend(
          audioOut.append(event.audio),
          `realtime audio/out append failed`
        )
      }
      trackOutputAppend(
        controlOut.append(jsonBytes(realtimeControlOutput(event))),
        `realtime control/out append failed`
      )
    },
    async close() {
      abort.abort()
      config.runSignal?.removeEventListener(`abort`, abortFromRun)
      await Promise.allSettled([...tasks, ...pendingOutputAppends])
      flushAudioSpan(`input`)
      flushAudioSpan(`output`)
      runtimeLog.info(
        logPrefix,
        `realtime stream bridge closed session=${session.id} audioInChunks=${audioInChunks} audioInBytes=${audioInBytes} controlInCommands=${controlInCommands} providerEvents=${controlOutEvents} audioOutChunks=${audioOutChunks} audioOutBytes=${audioOutBytes}`
      )
    },
  }
}

const MAX_HYDRATED_IMAGE_ATTACHMENTS = 4
const MAX_HYDRATED_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface HandlerContextConfig<TState extends StateProxy = StateProxy> {
  entityUrl: string
  entityType: string
  epoch: number
  wakeOffset: string
  firstWake: boolean
  tags: Readonly<Record<string, string>>
  principal?: HandlerContext[`principal`]
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  state: TState
  actions: Record<string, (...args: Array<unknown>) => unknown>
  staticSlashCommands?: Array<SlashCommandDefinition>
  electricTools: Array<AgentTool>
  sandbox: Sandbox
  events: Array<ChangeEvent>
  writeEvent: (event: ChangeEvent) => void
  wakeSession: WakeSession
  wakeEvent: WakeEvent
  runSignal?: AbortSignal
  registerSignalHandler?: (
    handler: (signal: {
      signal: EntitySignal
      reason?: string
      payload?: unknown
    }) => void | Promise<void>
  ) => void
  hydratedWebhookSourceWake?: HydratedWebhookSourceWake | null
  realtimeStreams?: {
    baseUrl: string
    headers?: Record<string, string>
  }
  doObserve: (
    source: ObservationSource,
    wake?: Wake
  ) => Promise<ObservationHandle>
  doSpawn: (
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: {
      initialMessage?: unknown
      initialMessageType?: string
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  doFork: (
    sourceEntityUrl: string,
    id: string,
    opts: ForkOptions
  ) => Promise<EntityHandle>
  doMkdb: <TSchema extends SharedStateSchemaMap>(
    id: string,
    schema: TSchema
  ) => SharedStateHandle<TSchema>
  doCreateAttachment?: (
    input: AttachmentCreateInput
  ) => Promise<ManifestAttachmentEntry>
  doReadAttachment?: (id: string) => Promise<Uint8Array>
  prepareAgentRun?: () => Promise<void>
  executeSend: (send: {
    targetUrl: string
    payload: unknown
    type?: string
    afterMs?: number
  }) => Promise<SendResult>
  doSetTag: (key: string, value: string) => Promise<void>
  doDeleteTag: (key: string) => Promise<void>
  doUnobserve: (sourceRef: string) => Promise<void>
}

export interface HandlerContextResult<TState extends StateProxy = StateProxy> {
  ctx: HandlerContext<TState>
  getSleepRequested: () => boolean
}

type DebugHandlerContext<TState extends StateProxy = StateProxy> =
  HandlerContext<TState> & {
    __debug: {
      useContextRegistrations: () => number
    }
  }

function asMessageText(value: unknown): string {
  return typeof value === `string` ? value : JSON.stringify(value ?? ``)
}

function missingContextToolData(message: string): Promise<never> {
  return Promise.reject(new Error(message))
}

function getCronScheduleTriggerPayload(
  db: Pick<EntityStreamDBWithActions, `collections`>,
  sourceUrl: string
): unknown | undefined {
  for (const entry of db.collections.manifests.toArray) {
    const manifest = entry as Record<string, unknown>
    if (
      manifest.kind !== `schedule` ||
      manifest.scheduleType !== `cron` ||
      typeof manifest.expression !== `string`
    ) {
      continue
    }

    const manifestSource = getCronStreamPath(
      manifest.expression,
      typeof manifest.timezone === `string` ? manifest.timezone : undefined,
      { fallback: `utc` }
    )
    if (manifestSource !== sourceUrl) {
      continue
    }

    if (`payload` in manifest) {
      return manifest.payload
    }
  }

  return undefined
}

function getTriggerMessageText(
  db: Pick<EntityStreamDBWithActions, `collections`>,
  wakeEvent: WakeEvent,
  events: Array<ChangeEvent>,
  wakeOffset: string,
  hydratedWebhookSourceWake?: HydratedWebhookSourceWake | null
): string {
  if (wakeEvent.type === `inbox`) {
    let latestPayload: unknown = wakeEvent.payload
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!
      if (event.type !== `inbox`) {
        continue
      }

      const value = event.value as
        | {
            payload?: unknown
            status?: `pending` | `processed` | `cancelled`
          }
        | undefined
      if (value?.status === `cancelled`) {
        continue
      }
      const payload = value?.payload
      if (latestPayload === undefined) {
        latestPayload = payload
      }
      if (wakeOffset === `-1` || event.headers.offset === wakeOffset) {
        return asMessageText(payload)
      }
    }

    if (latestPayload !== undefined) {
      return asMessageText(latestPayload)
    }
  }

  if (wakeEvent.type === `wake` && typeof wakeEvent.source === `string`) {
    if (hydratedWebhookSourceWake) {
      return asMessageText(hydratedWebhookSourceWake)
    }

    const cronPayload = getCronScheduleTriggerPayload(db, wakeEvent.source)
    if (cronPayload !== undefined) {
      return asMessageText(cronPayload)
    }
  }

  return asMessageText({
    type: wakeEvent.type,
    source: wakeEvent.source,
    payload: wakeEvent.payload,
    summary: wakeEvent.summary,
    fullRef: wakeEvent.fullRef,
    fromOffset: wakeEvent.fromOffset,
    toOffset: wakeEvent.toOffset,
    eventCount: wakeEvent.eventCount,
  })
}

function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  // Prefer the platform helper when available (Node 20+, modern browsers).
  const any = (
    AbortSignal as unknown as {
      any?: (sigs: Array<AbortSignal>) => AbortSignal
    }
  ).any
  if (typeof any === `function`) return any.call(AbortSignal, [a, b])
  const controller = new AbortController()
  const linkTo = (source: AbortSignal): void => {
    if (source.aborted) {
      controller.abort(source.reason)
      return
    }
    source.addEventListener(`abort`, () => controller.abort(source.reason), {
      once: true,
    })
  }
  linkTo(a)
  linkTo(b)
  return controller.signal
}

function toHandlerWake(wakeEvent: WakeEvent): HandlerWake {
  if (wakeEvent.type === `inbox`) {
    return {
      type: `inbox`,
      source: wakeEvent.source,
      raw: wakeEvent,
      message: {
        type: wakeEvent.summary ?? `message`,
        payload: wakeEvent.payload,
        from: wakeEvent.source,
      },
    }
  }

  return {
    type: `other`,
    wakeType: wakeEvent.type,
    source: wakeEvent.source,
    payload: wakeEvent.payload,
    raw: wakeEvent,
  }
}

function createSlashCommandHelpers(
  config: Pick<
    HandlerContextConfig,
    `db` | `writeEvent` | `staticSlashCommands`
  >
): SlashCommandHelpers {
  type DynamicLayer = DynamicSlashCommandRegistration & { updated_at: string }
  const staticCommands = new Map(
    (config.staticSlashCommands ?? []).map((command) => [command.name, command])
  )
  const slashCommandsCollection = config.db.collections.slashCommands
  const rows = new Map(
    ((slashCommandsCollection?.toArray ?? []) as Array<SlashCommandRow>).map(
      (row) => [row.name, row]
    )
  )
  const dynamicLayers = new Map<string, Array<DynamicLayer>>()

  for (const row of rows.values()) {
    const layers =
      row.dynamic_layers ??
      (row.source === `dynamic`
        ? [
            {
              name: row.name,
              description: row.description,
              arguments: row.arguments,
              owner: row.owner,
              version: row.version,
              updated_at: row.updated_at,
            },
          ]
        : [])
    if (layers.length > 0) {
      dynamicLayers.set(row.name, [...layers])
    }
  }

  const listRows = (): Array<SlashCommandRow> => Array.from(rows.values())

  const getRow = (name: string): SlashCommandRow | undefined => {
    return rows.get(name)
  }

  const writeRow = (row: SlashCommandRow): void => {
    const existing = getRow(row.name)
    rows.set(row.name, row)
    const helper = existing
      ? entityStateSchema.slashCommands.update
      : entityStateSchema.slashCommands.insert

    config.writeEvent(
      helper({
        key: row.name,
        value: row,
      } as never) as ChangeEvent
    )
  }

  const deleteRow = (name: string): void => {
    rows.delete(name)
    config.writeEvent(
      entityStateSchema.slashCommands.delete({
        key: name,
      } as never) as ChangeEvent
    )
  }

  const writeEffectiveRow = (name: string): void => {
    const layers = dynamicLayers.get(name) ?? []
    const topLayer = layers.at(-1)
    if (topLayer) {
      writeRow({
        ...topLayer,
        key: name,
        source: `dynamic`,
        dynamic_layers: layers,
      })
      return
    }

    const staticCommand = staticCommands.get(name)
    if (!staticCommand) {
      deleteRow(name)
      return
    }

    writeRow({
      ...staticCommand,
      key: staticCommand.name,
      source: `static`,
      updated_at: new Date().toISOString(),
    })
  }

  const assertValid = (commands: Array<SlashCommandDefinition>): void => {
    const validation = validateSlashCommandDefinitions(commands)
    if (validation) {
      throw new Error(
        `[agent-runtime] invalid slash command definition: ${validation.details
          .map((issue) => `${issue.path} ${issue.message}`)
          .join(`; `)}`
      )
    }
  }

  const register = (command: DynamicSlashCommandRegistration): void => {
    assertValid([command])
    const owner = command.owner ?? `handler`
    const now = new Date().toISOString()
    const nextLayer = {
      ...command,
      owner,
      updated_at: now,
    }
    const existingLayers = dynamicLayers.get(command.name) ?? []
    dynamicLayers.set(command.name, [
      ...existingLayers.filter((layer) => layer.owner !== owner),
      nextLayer,
    ])
    writeEffectiveRow(command.name)
  }

  return {
    get: getRow,
    list: listRows,
    register,
    unregister(name, opts): void {
      const existing = getRow(name)
      const layers = dynamicLayers.get(name) ?? []
      if (opts?.owner) {
        if (!layers.some((layer) => layer.owner === opts.owner)) {
          return
        }
      } else if (existing?.source !== `dynamic`) {
        return
      }
      const owner = opts?.owner ?? existing?.owner
      dynamicLayers.set(
        name,
        owner ? layers.filter((layer) => layer.owner !== owner) : []
      )
      writeEffectiveRow(name)
    },
    replaceOwned(owner, commands): void {
      const ownedCommands = commands.map((command) => ({ ...command, owner }))
      assertValid(ownedCommands)

      const nextNames = new Set(ownedCommands.map((command) => command.name))
      for (const [name, layers] of [...dynamicLayers.entries()]) {
        if (!layers.some((layer) => layer.owner === owner)) {
          continue
        }
        if (nextNames.has(name)) {
          continue
        }
        dynamicLayers.set(
          name,
          layers.filter((layer) => layer.owner !== owner)
        )
        writeEffectiveRow(name)
      }

      for (const command of ownedCommands) {
        register(command)
      }
    },
  }
}

export function createHandlerContext<TState extends StateProxy = StateProxy>(
  config: HandlerContextConfig<TState>
): HandlerContextResult<TState> {
  let sleepRequested = false
  let agentConfig: AgentConfig | null = null
  let realtimeConfig: RealtimeConfig | null = null
  let activeRealtimeProviderSession: RealtimeProviderSession | null = null
  let useContextConfig: UseContextConfig | null = null
  let useContextHash = ``
  let useContextRegistrations = 0
  // Run-id allocation for ctx.recordRun() / ctx.replyText(). Delegates
  // to the outbound bridge's shared id-seed cache so synthetic runs
  // can't collide with `run-N` keys the bridge allocated for events
  // that haven't round-tripped into the local collection yet. The local
  // floor keeps sequential allocations monotonic within this handler
  // even when the collection lags (or has no stable id, as in tests).
  let localRunFloor = 0
  const nextRunKey = (): string => {
    const key = allocateRunKey(config.db, localRunFloor)
    localRunFloor = parseInt(key.slice(`run-`.length), 10) + 1
    return key
  }

  const contextApi = createContextEntriesApi({
    db: config.db,
    writeEvent: config.writeEvent,
    wakeSession: config.wakeSession,
  })

  const goalApi = createGoalApi({
    db: config.db,
    wakeSession: config.wakeSession,
    writeEvent: config.writeEvent,
  })

  const listAttachments: AttachmentsApi[`list`] = (filter) => {
    const attachments = config.db.collections.manifests.toArray
      .filter((entry) => entry.kind === `attachment`)
      .map((entry) => entry as unknown as ManifestAttachmentEntry)
    return attachments.filter((attachment) => {
      if (filter?.role && attachment.role !== filter.role) return false
      if (
        filter?.subject &&
        (attachment.subject.type !== filter.subject.type ||
          attachment.subject.key !== filter.subject.key)
      ) {
        return false
      }
      return true
    })
  }

  const attachmentsApi: AttachmentsApi = {
    list: listAttachments,
    get(id) {
      return listAttachments().find((attachment) => attachment.id === id)
    },
    async read(id) {
      if (!config.doReadAttachment) {
        throw new Error(`[agent-runtime] attachments.read() is not configured`)
      }
      return await config.doReadAttachment(id)
    },
    async create(input) {
      if (!config.doCreateAttachment) {
        throw new Error(
          `[agent-runtime] attachments.create() is not configured`
        )
      }
      return await config.doCreateAttachment(input)
    },
  }

  function realtimeSessions(): Array<ManifestRealtimeSessionEntry> {
    const sessions: Array<ManifestRealtimeSessionEntry> = []
    for (const entry of config.db.collections.manifests.toArray) {
      if (isRealtimeSessionManifest(entry)) {
        sessions.push(entry)
      }
    }
    return sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  function activeRealtimeSession(): ManifestRealtimeSessionEntry | undefined {
    return realtimeSessions().filter(realtimeManifestIsActive).at(-1)
  }

  async function updateRealtimeSessionStatus(
    session: ManifestRealtimeSessionEntry | undefined,
    status: `active` | `closed` | `failed`,
    opts: { reason?: string; error?: string } = {}
  ): Promise<void> {
    if (!session) return

    const key = session.key ?? `realtime-session:${session.id}`
    const terminal = status === `closed` || status === `failed`
    const endedAt = terminal ? new Date().toISOString() : session.endedAt
    const meta = {
      ...(session.meta ?? {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
      ...(opts.error ? { error: opts.error } : {}),
    }

    const nextSession: ManifestRealtimeSessionEntry = {
      key,
      kind: `realtime-session`,
      id: session.id,
      provider: session.provider,
      model: session.model,
      ...(session.voice ? { voice: session.voice } : {}),
      ...(session.reasoningEffort
        ? { reasoningEffort: session.reasoningEffort }
        : {}),
      ...(typeof session.interruptResponse === `boolean`
        ? { interruptResponse: session.interruptResponse }
        : {}),
      status,
      startedAt: session.startedAt,
      endedAt: endedAt ?? null,
      streams: session.streams,
      retention: `forever`,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    }

    config.wakeSession.registerManifestEntry(nextSession)
    config.writeEvent(
      entityStateSchema.realtimeSessions.update({
        key,
        value: {
          session_id: session.id,
          provider: session.provider,
          model: session.model,
          ...(session.voice ? { voice: session.voice } : {}),
          ...(session.reasoningEffort
            ? { reasoning_effort: session.reasoningEffort }
            : {}),
          ...(typeof session.interruptResponse === `boolean`
            ? { interrupt_response: session.interruptResponse }
            : {}),
          status,
          started_at: session.startedAt,
          ...(endedAt ? { ended_at: endedAt } : {}),
          streams: session.streams,
          ...(opts.reason ? { reason: opts.reason } : {}),
          ...(opts.error ? { error: opts.error } : {}),
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        } as never,
      }) as ChangeEvent
    )
    await config.wakeSession.commitManifestEntries()
  }

  function structuralHash(nextConfig: UseContextConfig): string {
    const sources = Object.entries(nextConfig.sources)
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(
        ([name, source]) => [name, source.max ?? null, source.cache] as const
      )
    return JSON.stringify({
      sourceBudget: nextConfig.sourceBudget,
      sources,
    })
  }

  function bytesToBase64(bytes: Uint8Array): string {
    const chunkSize = 0x8000
    let binary = ``
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  function attachmentDescriptor(attachment: ManifestAttachmentEntry): string {
    return `${attachment.filename ?? attachment.id}, type=${attachment.mimeType}, size=${attachment.byteLength ?? `unknown`}`
  }

  function selectHydratableImageAttachmentIds(
    messages: Array<LLMMessage>
  ): Set<string> {
    const selected = new Set<string>()
    let selectedBytes = 0

    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex--
    ) {
      const message = messages[messageIndex]
      if (!message || typeof message.content === `string`) continue

      for (
        let blockIndex = message.content.length - 1;
        blockIndex >= 0;
        blockIndex--
      ) {
        const block = message.content[blockIndex]
        if (!block || block.type !== `attachment` || selected.has(block.id)) {
          continue
        }

        const attachment = attachmentsApi.get(block.id)
        if (
          !attachment ||
          attachment.status !== `complete` ||
          !attachment.mimeType.startsWith(`image/`)
        ) {
          continue
        }

        const byteLength = attachment.byteLength ?? 0
        if (
          selected.size >= MAX_HYDRATED_IMAGE_ATTACHMENTS ||
          selectedBytes + byteLength > MAX_HYDRATED_IMAGE_ATTACHMENT_BYTES
        ) {
          continue
        }

        selected.add(block.id)
        selectedBytes += byteLength
      }
    }

    return selected
  }

  async function hydrateAttachmentBlocks(
    messages: Array<LLMMessage>
  ): Promise<Array<LLMMessage>> {
    const hydratableImageAttachmentIds =
      selectHydratableImageAttachmentIds(messages)

    return await Promise.all(
      messages.map(async (message) => {
        if (typeof message.content === `string`) {
          return message
        }
        const content = await Promise.all(
          message.content.map(async (block): Promise<LLMContentBlock> => {
            if (block.type !== `attachment`) {
              return block
            }
            const attachment = attachmentsApi.get(block.id)
            if (!attachment) {
              return {
                type: `text`,
                text: `[attachment missing: id=${block.id}]`,
              }
            }
            if (
              attachment.status !== `complete` ||
              !attachment.mimeType.startsWith(`image/`)
            ) {
              return {
                type: `text`,
                text: `[attachment: ${attachmentDescriptor(attachment)}]`,
              }
            }
            if (!hydratableImageAttachmentIds.has(block.id)) {
              return {
                type: `text`,
                text: `[attachment not sent to model: ${attachmentDescriptor(attachment)}, reason=image attachment prompt limit]`,
              }
            }
            try {
              const bytes = await attachmentsApi.read(block.id)
              return {
                type: `image`,
                data: bytesToBase64(bytes),
                mimeType: attachment.mimeType,
              }
            } catch (error) {
              return {
                type: `text`,
                text: `[attachment unreadable: id=${block.id}, error=${error instanceof Error ? error.message : String(error)}]`,
              }
            }
          })
        )
        return { ...message, content }
      })
    )
  }

  function readContextHistoryOffset(row: { key: string }): string | undefined {
    const contextInserted = config.db.collections.contextInserted
    const pointer = contextInserted.__electricRowOffsets?.get(row.key)
    if (pointer) {
      // Format the pointer as a stable, sortable string. Matches the
      // `_timeline_order` produced by `entity-stream-db` so that
      // `loadContextHistory(id, offset)` can round-trip lookups
      // against the same row.
      return formatPointerOrderToken(pointer)
    }

    const seq = Reflect.get(row, `_seq`)
    if (typeof seq === `number`) {
      return `seq:${seq.toString().padStart(12, `0`)}`
    }

    return undefined
  }

  function assertValidUseContextConfig(nextConfig: UseContextConfig): void {
    if (
      !Number.isFinite(nextConfig.sourceBudget) ||
      nextConfig.sourceBudget <= 0
    ) {
      throw new Error(
        `[agent-runtime] useContext: sourceBudget must be a positive finite number`
      )
    }

    if (Object.keys(nextConfig.sources).length === 0) {
      throw new Error(
        `[agent-runtime] useContext: sources must contain at least one source`
      )
    }

    let nonVolatileMaxSum = 0
    for (const [name, source] of Object.entries(nextConfig.sources)) {
      if (!CACHE_TIERS.includes(source.cache)) {
        throw new Error(
          `[agent-runtime] useContext: unknown cache tier "${String(source.cache)}" for source "${name}"; expected ${CACHE_TIERS.join(` | `)}`
        )
      }
      if (source.max != null) {
        if (!Number.isFinite(source.max) || source.max <= 0) {
          throw new Error(
            `[agent-runtime] useContext: source "${name}" max must be a positive finite number`
          )
        }
      } else if (source.cache !== `volatile`) {
        throw new Error(
          `[agent-runtime] useContext: source "${name}" must specify max unless cache is volatile`
        )
      }
      if (source.cache !== `volatile`) {
        nonVolatileMaxSum += source.max
      }
    }

    if (nonVolatileMaxSum > nextConfig.sourceBudget) {
      throw new Error(
        `[agent-runtime] useContext: non-volatile source max sum (${nonVolatileMaxSum}) exceeds sourceBudget (${nextConfig.sourceBudget}); reduce per-source max values or increase sourceBudget`
      )
    }
  }

  const agent: AgentHandle = {
    async run(
      input?: string,
      abortSignal?: AbortSignal
    ): Promise<AgentRunResult> {
      if (!agentConfig) {
        throw new Error(
          `[agent-runtime] agent.run() called without useAgent().`
        )
      }

      if (config.prepareAgentRun) {
        await config.prepareAgentRun()
      }

      const activeAgentConfig = agentConfig

      const messageText = getTriggerMessageText(
        config.db,
        config.wakeEvent,
        config.events,
        config.wakeOffset,
        config.hydratedWebhookSourceWake
      )
      const effectiveInput = input ?? messageText

      async function runAgent(
        messages: Array<LLMMessage>,
        extraTools: Array<AgentTool> = []
      ): Promise<AgentRunResult> {
        const composedTools = (await composeToolsWithProviders(
          activeAgentConfig.tools
        )) as Array<AgentTool>
        const adapterFactory = createPiAgentAdapter({
          systemPrompt: activeAgentConfig.systemPrompt,
          model: activeAgentConfig.model,

          provider: activeAgentConfig.provider,

          tools: [...composedTools, ...extraTools] as Array<never>,

          streamFn: activeAgentConfig.streamFn,

          getApiKey: activeAgentConfig.getApiKey,

          onPayload: activeAgentConfig.onPayload,

          onStepEnd: activeAgentConfig.onStepEnd,
          modelTimeoutMs: activeAgentConfig.modelTimeoutMs,
          modelMaxRetries: activeAgentConfig.modelMaxRetries,
        })
        const handle = adapterFactory({
          entityUrl: config.entityUrl,
          epoch: config.epoch,
          messages,
          outboundIdSeed: await loadOutboundIdSeed(config.db),
          writeEvent: config.writeEvent,
        })

        const latestMessageRole = messages.at(-1)?.role
        const runInput =
          input !== undefined ||
          config.hydratedWebhookSourceWake != null ||
          latestMessageRole !== `user`
            ? effectiveInput
            : undefined

        const logPrefix = `[${config.entityUrl}]`
        runtimeLog.info(
          logPrefix,
          `agent.run starting provider=${agentModelProvider(activeAgentConfig)} ` +
            `model=${agentModelId(activeAgentConfig.model)} ` +
            `messages=${messages.length} latestRole=${latestMessageRole ?? `none`} ` +
            `wakeType=${config.wakeEvent.type} wakeOffset=${config.wakeOffset} ` +
            `triggerMessageLen=${messageText.length} ` +
            `runInputLen=${runInput?.length ?? 0} ` +
            `tools=${composedTools.length + extraTools.length}`
        )
        if (messages.length > 0) {
          const tail = messages.slice(-3)
          runtimeLog.info(
            logPrefix,
            `agent.run last messages: ${tail
              .map(
                (m) =>
                  `${m.role}=${typeof m.content === `string` ? m.content.slice(0, 80) : `[non-string]`}`
              )
              .join(` | `)}`
          )
        }
        if (runInput !== undefined) {
          runtimeLog.info(
            logPrefix,
            `agent.run input: ${runInput.slice(0, 200)}`
          )
        }

        const combinedSignal =
          config.runSignal && abortSignal
            ? combineAbortSignals(config.runSignal, abortSignal)
            : (abortSignal ?? config.runSignal)
        await handle.run(runInput, combinedSignal)
        runtimeLog.info(logPrefix, `agent.run completed`)

        return {
          writes: [],
          toolCalls: [],
          usage: { tokens: 0, duration: 0 },
        }
      }

      if (activeAgentConfig.testResponses) {
        const bridge = createOutboundBridge(
          await loadOutboundIdSeed(config.db),
          config.writeEvent
        )
        const responses = activeAgentConfig.testResponses

        function emitResponse(response: string): void {
          bridge.onTextStart()
          if (response.length > 0) {
            bridge.onTextDelta(response)
          }
          bridge.onTextEnd()
        }

        try {
          bridge.onRunStart()
          bridge.onStepStart({
            modelProvider: `test`,
            modelId: agentModelId(activeAgentConfig.model),
          })

          if (Array.isArray(responses)) {
            const priorRunCount = (
              await queryOnce((q) =>
                q.from({ runs: config.db.collections.runs })
              )
            ).length
            emitResponse(
              responses[priorRunCount % Math.max(responses.length, 1)] ?? ``
            )
          } else {
            const response = await responses(messageText, bridge)
            if (response !== undefined) {
              emitResponse(response)
            }
          }

          bridge.onStepEnd({ finishReason: `stop`, durationMs: 0 })
          bridge.onRunEnd({ finishReason: `stop` })
        } catch (error) {
          bridge.onStepEnd({ finishReason: `error`, durationMs: 0 })
          bridge.onRunEnd({ finishReason: `error` })
          throw error
        }

        return {
          writes: [],
          toolCalls: [],
          usage: { tokens: 0, duration: 0 },
        }
      }

      if (useContextConfig) {
        const assembled = await assembleContext(useContextConfig)
        const messages = assembled.map(
          ({ at: _at, ...message }) => message as LLMMessage
        )
        const assembledResult = assembled.__result

        const autoTools = createContextTools({
          loadTimelineRange: ({ from, to }) =>
            Promise.resolve(
              runtimeTimelineMessages(config.db, { since: from })
                .filter((message) => message.at <= to)
                .map(({ at: _at, ...message }) => JSON.stringify(message))
                .join(`\n`)
            ),
          loadSourceRange: ({ snapshot, from, to }) => {
            const sourceSnapshot = assembledResult?.snapshots.get(snapshot)
            if (!sourceSnapshot) {
              return missingContextToolData(`[missing snapshot ${snapshot}]`)
            }
            return Promise.resolve(sliceChars(sourceSnapshot.content, from, to))
          },
          loadContextHistory: ({ id, offset }) => {
            const contextInserted = config.db.collections.contextInserted
            for (const row of contextInserted.toArray) {
              if (row.id !== id) {
                continue
              }
              if (readContextHistoryOffset(row) === offset) {
                return Promise.resolve(row.content)
              }
            }
            return missingContextToolData(
              `[missing context history for ${id} @ ${offset}]`
            )
          },
        })
        return runAgent(await hydrateAttachmentBlocks(messages), autoTools)
      }

      return runAgent(
        await hydrateAttachmentBlocks(timelineToMessages(config.db))
      )
    },
  }

  const realtimeHandle: RealtimeHandle = {
    async run(): Promise<RealtimeRunResult> {
      if (!realtimeConfig) {
        throw new Error(
          `[agent-runtime] realtime.run() called without useRealtime().`
        )
      }

      if (config.prepareAgentRun) {
        await config.prepareAgentRun()
      }

      const activeRealtimeConfig = realtimeConfig
      const bridge = createOutboundBridge(
        await loadOutboundIdSeed(config.db),
        config.writeEvent
      )
      const startedAt = Date.now()
      let textStarted = false
      let currentToolCall:
        | { toolCallId: string; name: string; args: unknown }
        | undefined
      const realtimeSession = activeRealtimeSession()

      const endText = (): void => {
        if (!textStarted) return
        bridge.onTextEnd()
        textStarted = false
      }

      const emitText = (delta: string): void => {
        if (delta.length === 0) return
        if (!textStarted) {
          bridge.onTextStart()
          textStarted = true
        }
        bridge.onTextDelta(delta)
      }

      const transcriptTextByKey = new Map<string, string>()
      const transcriptCreatedAtByKey = new Map<string, string>()
      const transcriptDeltaSeqByKey = new Map<string, number>()
      const transcriptFallbackIds = new Map<`input` | `output`, string>()
      const inputTranscriptKeyByTurnId = new Map<string, string>()
      const outputTranscriptKeyByResponseId = new Map<string, string>()
      const outputTranscriptKeysByResponseId = new Map<string, Array<string>>()
      const outputTranscriptSegmentByResponseId = new Map<string, number>()
      const outputTranscriptSourceByKey = new Map<string, string>()
      let transcriptFallbackCounter = 0
      let pendingInputTranscriptKey: string | undefined
      let activeOutputTranscript:
        | { key: string; responseId?: string }
        | undefined
      let providerSessionId = realtimeSession?.id

      const currentTranscriptSessionId = (): string =>
        realtimeSession?.id ?? providerSessionId ?? `ephemeral`

      const transcriptKey = (
        direction: `input` | `output`,
        id?: string
      ): string => {
        let stableId = id
        if (!stableId) {
          stableId = transcriptFallbackIds.get(direction)
          if (!stableId) {
            stableId = `fallback-${transcriptFallbackCounter}`
            transcriptFallbackCounter += 1
            transcriptFallbackIds.set(direction, stableId)
          }
        }
        return `realtime-transcript:${currentTranscriptSessionId()}:${direction}:${stableId}`
      }

      const inputTranscriptKey = (turnId?: string): string => {
        if (turnId) {
          const existing = inputTranscriptKeyByTurnId.get(turnId)
          if (existing) return existing
          if (pendingInputTranscriptKey) {
            inputTranscriptKeyByTurnId.set(turnId, pendingInputTranscriptKey)
            return pendingInputTranscriptKey
          }
          const key = transcriptKey(`input`, turnId)
          inputTranscriptKeyByTurnId.set(turnId, key)
          return key
        }
        const key = pendingInputTranscriptKey ?? transcriptKey(`input`)
        pendingInputTranscriptKey = key
        return key
      }

      const trackOutputTranscriptKey = (
        responseId: string | undefined,
        key: string
      ): void => {
        activeOutputTranscript = { key, responseId }
        if (!responseId) return
        const keys = outputTranscriptKeysByResponseId.get(responseId) ?? []
        if (!keys.includes(key)) {
          keys.push(key)
          outputTranscriptKeysByResponseId.set(responseId, keys)
        }
      }

      const outputTranscriptKey = (responseId?: string): string => {
        if (responseId) {
          const existing = outputTranscriptKeyByResponseId.get(responseId)
          if (existing) return existing
          const key = transcriptKey(`output`, responseId)
          outputTranscriptKeyByResponseId.set(responseId, key)
          trackOutputTranscriptKey(responseId, key)
          return key
        }
        const key = activeOutputTranscript?.responseId
          ? transcriptKey(`output`)
          : (activeOutputTranscript?.key ?? transcriptKey(`output`))
        trackOutputTranscriptKey(undefined, key)
        return key
      }

      const rotateActiveOutputTranscript = (): void => {
        const active = activeOutputTranscript
        if (!active) return
        const text = transcriptTextByKey.get(active.key) ?? ``
        if (text.length === 0) return

        if (active.responseId) {
          const nextSegment =
            (outputTranscriptSegmentByResponseId.get(active.responseId) ?? 0) +
            1
          outputTranscriptSegmentByResponseId.set(
            active.responseId,
            nextSegment
          )
          const key = transcriptKey(
            `output`,
            `${active.responseId}:segment-${nextSegment}`
          )
          outputTranscriptKeyByResponseId.set(active.responseId, key)
          trackOutputTranscriptKey(active.responseId, key)
          return
        }

        transcriptFallbackIds.delete(`output`)
        activeOutputTranscript = undefined
      }

      const outputTranscriptSourceRank = (source: string): number => {
        switch (source) {
          case `response.output_audio_transcript`:
            return 3
          case `response.audio_transcript`:
            return 2
          case `response.output_text`:
            return 1
          default:
            return 0
        }
      }

      const outputTranscriptSourceKey = (input: {
        responseId?: string
        itemId?: string
        contentIndex?: number
      }): string | undefined => {
        if (input.responseId) {
          return `${input.responseId}:${input.itemId ?? ``}:${input.contentIndex ?? 0}`
        }
        if (input.itemId) {
          return `${input.itemId}:${input.contentIndex ?? 0}`
        }
        return undefined
      }

      const resetOutputTranscriptText = (
        responseId: string | undefined
      ): void => {
        const keys = responseId
          ? (outputTranscriptKeysByResponseId.get(responseId) ?? [])
          : activeOutputTranscript
            ? [activeOutputTranscript.key]
            : []
        for (const key of keys) {
          transcriptTextByKey.set(key, ``)
          deleteRealtimeTranscriptDeltas(key)
        }
      }

      const shouldUseOutputTranscriptSource = (input: {
        responseId?: string
        itemId?: string
        contentIndex?: number
        transcriptSource?: string
      }): boolean => {
        if (!input.transcriptSource) return true
        const key = outputTranscriptSourceKey(input)
        if (!key) return true
        const existing = outputTranscriptSourceByKey.get(key)
        if (!existing) {
          outputTranscriptSourceByKey.set(key, input.transcriptSource)
          return true
        }
        if (existing === input.transcriptSource) return true
        if (
          outputTranscriptSourceRank(input.transcriptSource) >
          outputTranscriptSourceRank(existing)
        ) {
          outputTranscriptSourceByKey.set(key, input.transcriptSource)
          resetOutputTranscriptText(input.responseId)
          return true
        }
        return false
      }

      const writeRealtimeTranscript = (input: {
        direction: `input` | `output`
        key: string
        text: string
        status: `partial` | `final`
        turnId?: string
        responseId?: string
        allowEmpty?: boolean
      }): void => {
        const collection = config.db.collections.realtimeTranscripts
        if (
          input.text.length === 0 &&
          !input.allowEmpty &&
          !collection.has(input.key)
        ) {
          return
        }

        const existing = collection.get(input.key) as
          | { created_at?: string }
          | undefined
        const createdAt =
          transcriptCreatedAtByKey.get(input.key) ??
          existing?.created_at ??
          new Date().toISOString()
        transcriptCreatedAtByKey.set(input.key, createdAt)

        const value = {
          session_id: currentTranscriptSessionId(),
          direction: input.direction,
          text: input.text,
          status: input.status,
          audio_stream: input.direction,
          ...(input.turnId ? { turn_id: input.turnId } : {}),
          ...(input.responseId ? { response_id: input.responseId } : {}),
          created_at: createdAt,
        }
        config.writeEvent(
          (collection.has(input.key)
            ? entityStateSchema.realtimeTranscripts.update({
                key: input.key,
                value: value as never,
              })
            : entityStateSchema.realtimeTranscripts.insert({
                key: input.key,
                value: value as never,
              })) as ChangeEvent
        )

        emitRealtimeTranscript(input)
      }

      const emitRealtimeTranscript = (input: {
        direction: `input` | `output`
        key: string
        text: string
        status: `partial` | `final`
        turnId?: string
        responseId?: string
      }): void => {
        const onTranscript = activeRealtimeConfig.onTranscript
        if (!onTranscript) return
        void Promise.resolve(
          onTranscript({
            key: input.key,
            sessionId: currentTranscriptSessionId(),
            direction: input.direction,
            text: input.text,
            status: input.status,
            ...(input.turnId ? { turnId: input.turnId } : {}),
            ...(input.responseId ? { responseId: input.responseId } : {}),
          })
        ).catch((error) => {
          runtimeLog.warn(
            `[agent-runtime]`,
            `realtime transcript callback failed:`,
            error
          )
        })
      }

      const writeRealtimeTranscriptDelta = (input: {
        key: string
        delta: string
      }): void => {
        if (input.delta.length === 0) return
        const seq = transcriptDeltaSeqByKey.get(input.key) ?? 0
        transcriptDeltaSeqByKey.set(input.key, seq + 1)
        config.writeEvent(
          entityStateSchema.textDeltas.insert({
            key: `${input.key}:delta-${seq}`,
            value: {
              text_id: input.key,
              realtime_transcript_id: input.key,
              delta: input.delta,
            } as never,
          }) as ChangeEvent
        )
      }

      const deleteRealtimeTranscriptDeltas = (key: string): void => {
        const deltaCount = transcriptDeltaSeqByKey.get(key) ?? 0
        for (let index = 0; index < deltaCount; index += 1) {
          config.writeEvent(
            entityStateSchema.textDeltas.delete({
              key: `${key}:delta-${index}`,
            }) as ChangeEvent
          )
        }
        transcriptDeltaSeqByKey.set(key, 0)
      }

      const reconcileRealtimeTranscriptDeltas = (
        key: string,
        finalText: string
      ): void => {
        const currentText = transcriptTextByKey.get(key) ?? ``
        if (finalText === currentText) return
        if (finalText.startsWith(currentText)) {
          writeRealtimeTranscriptDelta({
            key,
            delta: finalText.slice(currentText.length),
          })
          return
        }
        deleteRealtimeTranscriptDeltas(key)
        writeRealtimeTranscriptDelta({ key, delta: finalText })
      }

      const beginRealtimeTranscript = (input: {
        direction: `input` | `output`
        turnId?: string
        responseId?: string
      }): void => {
        const key =
          input.direction === `input`
            ? inputTranscriptKey(input.turnId)
            : outputTranscriptKey(input.responseId)
        const existing = config.db.collections.realtimeTranscripts.get(key) as
          | { text?: string }
          | undefined
        const text = transcriptTextByKey.get(key) ?? existing?.text ?? ``
        transcriptTextByKey.set(key, text)
        writeRealtimeTranscript({
          direction: input.direction,
          key,
          text,
          status: `partial`,
          turnId: input.turnId,
          responseId: input.responseId,
          allowEmpty: true,
        })
      }

      const appendRealtimeTranscript = (input: {
        direction: `input` | `output`
        delta: string
        turnId?: string
        responseId?: string
        itemId?: string
        contentIndex?: number
        transcriptSource?: string
      }): void => {
        if (input.delta.length === 0) return
        if (
          input.direction === `output` &&
          !shouldUseOutputTranscriptSource(input)
        ) {
          return
        }
        const key =
          input.direction === `input`
            ? inputTranscriptKey(input.turnId)
            : outputTranscriptKey(input.responseId)
        const text = `${transcriptTextByKey.get(key) ?? ``}${input.delta}`
        transcriptTextByKey.set(key, text)
        if (!config.db.collections.realtimeTranscripts.has(key)) {
          writeRealtimeTranscript({
            direction: input.direction,
            key,
            text: ``,
            status: `partial`,
            turnId: input.turnId,
            responseId: input.responseId,
            allowEmpty: true,
          })
        }
        writeRealtimeTranscriptDelta({ key, delta: input.delta })
        emitRealtimeTranscript({
          direction: input.direction,
          key,
          text,
          status: `partial`,
          turnId: input.turnId,
          responseId: input.responseId,
        })
      }

      const completeRealtimeTranscript = (input: {
        direction: `input` | `output`
        text?: string
        turnId?: string
        responseId?: string
      }): void => {
        const key =
          input.direction === `input`
            ? inputTranscriptKey(input.turnId)
            : outputTranscriptKey(input.responseId)
        const text = input.text ?? transcriptTextByKey.get(key) ?? ``
        reconcileRealtimeTranscriptDeltas(key, text)
        transcriptTextByKey.set(key, text)
        writeRealtimeTranscript({
          direction: input.direction,
          key,
          text,
          status: `final`,
          turnId: input.turnId,
          responseId: input.responseId,
        })
        if (
          (input.direction === `input` && !input.turnId) ||
          (input.direction === `output` && !input.responseId)
        ) {
          transcriptFallbackIds.delete(input.direction)
        }
        if (input.direction === `input` && pendingInputTranscriptKey === key) {
          pendingInputTranscriptKey = undefined
          if (input.turnId) {
            transcriptFallbackIds.delete(`input`)
          }
        }
      }

      const completeOutputTranscript = (input: {
        text?: string
        responseId?: string
        itemId?: string
        contentIndex?: number
        transcriptSource?: string
      }): void => {
        if (!shouldUseOutputTranscriptSource(input)) return
        const existingKeys = input.responseId
          ? outputTranscriptKeysByResponseId.get(input.responseId)
          : activeOutputTranscript
            ? [activeOutputTranscript.key]
            : undefined
        const keys =
          existingKeys && existingKeys.length > 0
            ? existingKeys
            : [outputTranscriptKey(input.responseId)]

        for (const [index, key] of keys.entries()) {
          const existing = config.db.collections.realtimeTranscripts.get(
            key
          ) as { text?: string } | undefined
          const text =
            keys.length === 1 && input.text !== undefined
              ? input.text
              : (transcriptTextByKey.get(key) ??
                existing?.text ??
                (index === keys.length - 1 ? (input.text ?? ``) : ``))
          reconcileRealtimeTranscriptDeltas(key, text)
          transcriptTextByKey.set(key, text)
          writeRealtimeTranscript({
            direction: `output`,
            key,
            text,
            status: `final`,
            responseId: input.responseId,
          })
        }

        if (!input.responseId) {
          transcriptFallbackIds.delete(`output`)
        }
        if (
          activeOutputTranscript &&
          activeOutputTranscript.responseId === input.responseId
        ) {
          activeOutputTranscript = undefined
        }
      }

      const composedTools = (await composeToolsWithProviders(
        activeRealtimeConfig.tools ?? []
      )) as Array<AgentTool>
      const providerTools = applyRealtimeToolPolicy(
        composedTools,
        activeRealtimeConfig.toolPolicy
      )
      const activeRealtimeSessionId = realtimeSession?.id
      let realtimeCloseReason: string | undefined
      const messages =
        activeRealtimeConfig.context?.includeTimeline === false
          ? []
          : await hydrateAttachmentBlocks(
              runtimeTimelineMessages(config.db, {
                projection: (item) => {
                  if (
                    item.kind === `realtime_transcript` &&
                    item.sessionId === activeRealtimeSessionId
                  ) {
                    return null
                  }
                  return defaultProjection(item)
                },
              }).map(({ at: _at, ...message }) => message as LLMMessage)
            )
      let realtimeIo: RealtimeStreamIo | undefined
      let realtimeSessionTerminalWritten = false
      let realtimeSessionLimitTimer: ReturnType<typeof setTimeout> | undefined

      async function handleProviderEvent(
        event: RealtimeProviderEvent
      ): Promise<void> {
        switch (event.type) {
          case `session.started`:
            providerSessionId =
              realtimeSession?.id ?? event.sessionId ?? providerSessionId
            break

          case `session.updated`:
          case `output_audio.delta`:
          case `output_audio.completed`:
          case `response.started`:
          case `response.cancelled`:
            break

          case `input_audio.speech_started`:
            rotateActiveOutputTranscript()
            beginRealtimeTranscript({
              direction: `input`,
              turnId: event.turnId,
            })
            break

          case `input_audio.speech_stopped`:
            if (event.turnId || pendingInputTranscriptKey) {
              beginRealtimeTranscript({
                direction: `input`,
                turnId: event.turnId,
              })
            }
            break

          case `input_audio.committed`:
            beginRealtimeTranscript({
              direction: `input`,
              turnId: event.turnId,
            })
            break

          case `input_transcript.delta`:
            appendRealtimeTranscript({
              direction: `input`,
              delta: event.delta,
              turnId: event.turnId,
            })
            break

          case `input_transcript.completed`:
            completeRealtimeTranscript({
              direction: `input`,
              text: event.text,
              turnId: event.turnId,
            })
            break

          case `session.closed`:
            realtimeCloseReason = event.reason
            endText()
            break

          case `response.completed`:
            endText()
            break

          case `session.error`:
            if (event.code === `response_cancel_not_active`) {
              runtimeLog.warn(
                `[agent-runtime]`,
                `realtime provider ignored inactive response cancellation: ${event.error}`
              )
              break
            }
            if (
              event.code === `invalid_value` &&
              event.error.includes(`Audio content`) &&
              event.error.includes(`already shorter than`)
            ) {
              runtimeLog.warn(
                `[agent-runtime]`,
                `realtime provider ignored stale output audio truncate: ${event.error}`
              )
              break
            }
            throw new Error(
              `[agent-runtime] realtime provider error${event.code ? ` ${event.code}` : ``}: ${event.error}`
            )

          case `output_transcript.delta`:
            appendRealtimeTranscript({
              direction: `output`,
              delta: event.delta,
              responseId: event.responseId,
              itemId: event.itemId,
              contentIndex: event.contentIndex,
              transcriptSource: event.transcriptSource,
            })
            break

          case `output_transcript.completed`:
            completeOutputTranscript({
              text: event.text,
              responseId: event.responseId,
              itemId: event.itemId,
              contentIndex: event.contentIndex,
              transcriptSource: event.transcriptSource,
            })
            break

          case `tool_call.started`:
            currentToolCall = {
              toolCallId: event.toolCallId,
              name: event.name,
              args: event.args,
            }
            if (event.args !== undefined) {
              bridge.onToolCallStart(event.toolCallId, event.name, event.args)
            }
            break

          case `tool_call.arguments_delta`:
            break

          case `tool_call.arguments_completed`:
            currentToolCall = {
              toolCallId: event.toolCallId,
              name: event.name,
              args: event.args,
            }
            bridge.onToolCallStart(event.toolCallId, event.name, event.args)
            break

          case `tool_call.completed`: {
            if (currentToolCall?.toolCallId !== event.toolCallId) {
              bridge.onToolCallStart(event.toolCallId, event.name, undefined)
            }
            bridge.onToolCallEnd(
              event.toolCallId,
              event.name,
              event.result,
              event.isError ?? false
            )
            break
          }
        }
      }

      try {
        bridge.onRunStart()
        bridge.onStepStart({
          modelProvider: activeRealtimeConfig.provider.id,
          modelId: activeRealtimeConfig.provider.model,
        })

        if (activeRealtimeConfig.testResponses) {
          const messageText = getTriggerMessageText(
            config.db,
            config.wakeEvent,
            config.events,
            config.wakeOffset,
            config.hydratedWebhookSourceWake
          )
          const responses = activeRealtimeConfig.testResponses
          if (Array.isArray(responses)) {
            const priorRunCount = (
              await queryOnce((q) =>
                q.from({ runs: config.db.collections.runs })
              )
            ).length
            emitText(
              responses[priorRunCount % Math.max(responses.length, 1)] ?? ``
            )
          } else {
            const response = await responses(messageText, bridge)
            if (response !== undefined) emitText(response)
          }
          endText()
        } else {
          activeRealtimeProviderSession =
            await activeRealtimeConfig.provider.connect({
              systemPrompt: activeRealtimeConfig.systemPrompt,
              messages,
              tools: providerTools,
              audio: activeRealtimeConfig.audio,
              session: realtimeSession,
              signal: config.runSignal,
            })
          realtimeSessionLimitTimer = setTimeout(() => {
            runtimeLog.info(
              `[agent-runtime]`,
              `realtime session soft limit reached session=${realtimeSession?.id ?? `ephemeral`}`
            )
            void activeRealtimeProviderSession?.close?.(
              `session-duration-limit`
            )
          }, REALTIME_SESSION_SOFT_LIMIT_MS)
          await updateRealtimeSessionStatus(realtimeSession, `active`)
          realtimeIo = createRealtimeStreamIo(
            config,
            realtimeSession,
            activeRealtimeProviderSession,
            activeRealtimeConfig.audio
          )

          for await (const event of activeRealtimeProviderSession.events) {
            if (config.runSignal?.aborted) {
              break
            }
            await realtimeIo?.writeProviderEvent(event)
            await handleProviderEvent(event)
          }
        }

        endText()
        await updateRealtimeSessionStatus(realtimeSession, `closed`, {
          reason: config.runSignal?.aborted
            ? `aborted`
            : (realtimeCloseReason ?? `completed`),
        })
        realtimeSessionTerminalWritten = true
        bridge.onStepEnd({
          finishReason: config.runSignal?.aborted ? `aborted` : `stop`,
          durationMs: Date.now() - startedAt,
        })
        bridge.onRunEnd({
          finishReason: config.runSignal?.aborted ? `aborted` : `stop`,
        })
      } catch (error) {
        endText()
        if (!realtimeSessionTerminalWritten) {
          await updateRealtimeSessionStatus(realtimeSession, `failed`, {
            error: error instanceof Error ? error.message : String(error),
          })
          realtimeSessionTerminalWritten = true
        }
        bridge.onStepEnd({
          finishReason: `error`,
          durationMs: Date.now() - startedAt,
        })
        bridge.onRunEnd({ finishReason: `error` })
        throw error
      } finally {
        if (realtimeSessionLimitTimer) {
          clearTimeout(realtimeSessionLimitTimer)
        }
        await realtimeIo?.close()
        activeRealtimeProviderSession = null
      }

      return {
        writes: [],
        toolCalls: [],
        usage: { tokens: 0, duration: Date.now() - startedAt },
      }
    },
    async close(reason?: string): Promise<void> {
      await activeRealtimeProviderSession?.close?.(reason)
    },
    async stop(reason?: string): Promise<void> {
      await this.close(reason)
    },
    async cancelResponse(): Promise<void> {
      await activeRealtimeProviderSession?.cancelResponse?.()
    },
    async sendText(text: string): Promise<void> {
      await activeRealtimeProviderSession?.sendText?.(text)
    },
  }

  const ctx: DebugHandlerContext<TState> = {
    firstWake: config.firstWake,
    wake: toHandlerWake(config.wakeEvent),
    slashCommands: createSlashCommandHelpers(config),
    tags: config.tags,
    principal: config.principal,
    entityUrl: config.entityUrl,
    entityType: config.entityType,
    args: config.args,
    db: config.db,
    events: config.events,
    state: config.state,
    actions: config.actions,
    electricTools: config.electricTools,
    signal: config.runSignal ?? new AbortController().signal,
    sandbox: config.sandbox,
    useAgent(cfg) {
      agentConfig = cfg
      return agent
    },
    useRealtime(cfg) {
      realtimeConfig = cfg
      return realtimeHandle
    },
    useContext(nextConfig) {
      assertValidUseContextConfig(nextConfig)
      const hash = structuralHash(nextConfig)
      if (hash !== useContextHash) {
        useContextHash = hash
        useContextRegistrations += 1
      }
      useContextConfig = nextConfig
    },
    timelineMessages(opts?: TimelineProjectionOpts) {
      return runtimeTimelineMessages(config.db, opts)
    },
    insertContext: contextApi.insertContext,
    removeContext: contextApi.removeContext,
    getContext: contextApi.getContext,
    listContext: contextApi.listContext,
    setGoal: goalApi.setGoal,
    clearGoal: goalApi.clearGoal,
    getGoal: goalApi.getGoal,
    markGoalComplete: goalApi.markGoalComplete,
    updateGoalUsage: goalApi.updateGoalUsage,
    __debug: {
      useContextRegistrations: () => useContextRegistrations,
    },
    agent,
    realtime: {
      activeSession: activeRealtimeSession,
      sessions: realtimeSessions,
    },
    observe: ((source: ObservationSource, opts?: { wake?: Wake }) => {
      return config.doObserve(source, opts?.wake) as Promise<
        ObservationHandle & EntityHandle & SharedStateHandle
      >
    }) as DebugHandlerContext<TState>[`observe`],
    unobserve(sourceRef: string): Promise<void> {
      return config.doUnobserve(sourceRef)
    },
    spawn(
      type: string,
      id: string,
      args?: Record<string, unknown>,
      opts?: {
        initialMessage?: unknown
        wake?: Wake
        tags?: Record<string, string>
        observe?: boolean
      }
    ): Promise<EntityHandle> {
      return config.doSpawn(type, id, args, opts)
    },
    fork(
      sourceEntityUrl: string,
      id: string,
      opts?: ForkOptions
    ): Promise<EntityHandle> {
      return config.doFork(sourceEntityUrl, id, opts ?? {})
    },
    forkSelf(id: string, opts?: ForkOptions): Promise<EntityHandle> {
      return config.doFork(config.entityUrl, id, opts ?? {})
    },
    mkdb<TSchema extends SharedStateSchemaMap>(
      id: string,
      schema: TSchema
    ): SharedStateHandle<TSchema> {
      return config.doMkdb(id, schema)
    },
    send(
      entityUrl: string,
      payload: unknown,
      opts?: { type?: string; afterMs?: number }
    ): Promise<SendResult> {
      return config.executeSend({
        targetUrl: entityUrl,
        payload,
        type: opts?.type,
        afterMs: opts?.afterMs,
      })
    },
    attachments: attachmentsApi,
    onSignal(handler): void {
      config.registerSignalHandler?.(handler)
    },
    recordRun(): RunHandle {
      const key = nextRunKey()
      let deltaCounter = 0
      config.writeEvent(
        entityStateSchema.runs.insert({
          key,
          value: { status: `started` } as never,
        }) as ChangeEvent
      )
      return {
        key,
        end({ status, finishReason }): void {
          config.writeEvent(
            entityStateSchema.runs.update({
              key,
              value: {
                status,
                finish_reason:
                  finishReason ?? (status === `failed` ? `error` : `stop`),
              } as never,
            }) as ChangeEvent
          )
        },
        attachResponse(text: string): void {
          if (typeof text !== `string` || text.length === 0) return
          config.writeEvent(
            entityStateSchema.textDeltas.insert({
              key: `${key}:delta-${deltaCounter}`,
              value: {
                text_id: key,
                run_id: key,
                delta: text,
              } as never,
            }) as ChangeEvent
          )
          deltaCounter += 1
        },
      }
    },
    // Renders `text` as an ordinary assistant message in the chat without
    // calling the LLM. Used for runtime-driven replies like slash-command
    // responses and budget-limit notices. The five writes synthesize the
    // same run + text + delta event sequence the outbound bridge would
    // emit for a real LLM turn; the UI needs all of them to render.
    replyText(text: string): void {
      if (typeof text !== `string` || text.length === 0) return
      const runKey = nextRunKey()
      const msgKey = `${runKey}:msg`
      config.writeEvent(
        entityStateSchema.runs.insert({
          key: runKey,
          value: { status: `started` } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.texts.insert({
          key: msgKey,
          value: { status: `streaming`, run_id: runKey } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.textDeltas.insert({
          key: `${msgKey}:0`,
          value: {
            text_id: msgKey,
            run_id: runKey,
            delta: text,
          } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.texts.update({
          key: msgKey,
          value: { status: `completed`, run_id: runKey } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.runs.update({
          key: runKey,
          value: {
            status: `completed`,
            finish_reason: `stop`,
          } as never,
        }) as ChangeEvent
      )
    },
    sleep(): void {
      sleepRequested = true
    },
    setTag(key: string, value: string): Promise<void> {
      return config.doSetTag(key, value)
    },
    deleteTag(key: string): Promise<void> {
      return config.doDeleteTag(key)
    },
  }

  return {
    ctx,
    getSleepRequested: () => sleepRequested,
  }
}
