import { DurableStream } from '@durable-streams/client'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import { serverFetch, getConfiguredServerHeaders } from './auth-fetch'
import { loadRealtimeSettingsStatus } from './server-connection'

export type RealtimeAudioSession = {
  sessionId: string
  sendText: (text: string) => Promise<void>
  setInputLevelHandler: (handler: ((level: number) => void) | undefined) => void
  stop: () => Promise<void>
}

type RealtimeSessionCreateResult = {
  sessionId: string
  interruptResponse: boolean
  streams: {
    audio_in: string
    audio_out: string
    control_in: string
    control_out: string
  }
}

type RealtimeControlOutput =
  | { type: `input_audio.speech_started`; audioOffset?: string }
  | { type: `output_audio.delta`; itemId?: string; byteLength?: number }
  | { type: `output_audio.completed`; responseId?: string; itemId?: string }
  | { type: `response.completed`; responseId?: string }
  | { type: `response.cancelled`; responseId?: string }
  | { type: `session.closed`; reason?: string }
  | { type: string; [key: string]: unknown }

const REALTIME_SAMPLE_RATE = 24_000
const MIC_CAPTURE_CHUNK_SAMPLES = 1024
const MIC_WORKLET_PROCESSOR_NAME = `realtime-mic-capture`
const BYTES_PER_PCM16_SAMPLE = 2
const TRUNCATE_SAFETY_MS = 80
const MIC_PRE_ROLL_MS = 360
const MIC_VAD_TAIL_MS = 700
const MIC_MAX_QUEUE_MS = 1600
const MIC_APPEND_BATCH_MS = 60
const MIC_APPEND_DRAIN_WAIT_MS = 350
const MIC_MIN_START_LEVEL = 0.012
const MIC_MIN_CONTINUE_LEVEL = 0.006
const MIC_PLAYBACK_START_LEVEL = 0.035
const MIC_START_CONFIRM_CHUNKS = 1
const MIC_PLAYBACK_START_CONFIRM_CHUNKS = 4
const MIC_NOISE_MARGIN_START = 0.01
const MIC_NOISE_MARGIN_CONTINUE = 0.004
const MIC_NOISE_FLOOR_INITIAL = 0.003
const MIC_NOISE_FLOOR_MAX = 0.018
const MIC_NOISE_FLOOR_ALPHA = 0.008
const SILENT_GREETING_DELAY_MS = 1000
const SILENT_GREETING_TEXT =
  `The user started a voice session but has not spoken yet. ` +
  `Say a brief friendly hello and ask how you can help.`

const NO_RETRY_BACKOFF = {
  initialDelay: 100,
  maxDelay: 100,
  multiplier: 1,
  maxRetries: 0,
}

type MicCapture = {
  node: AudioNode
  cleanup: () => void
  mode: `audio-worklet` | `script-processor`
}

type EncodedMicAudio = {
  bytes: Uint8Array
  level: number
}

function realtimeUrl(baseUrl: string): string {
  return appendPathToUrl(baseUrl, `/_electric/realtime/sessions`)
}

function streamUrl(baseUrl: string, streamPath: string): string {
  return appendPathToUrl(baseUrl, streamPath)
}

function pcm16Bytes(input: Float32Array): Uint8Array {
  const bytes = new Uint8Array(input.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0))
    view.setInt16(
      index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    )
  }
  return bytes
}

function pcm16DurationMs(byteLength: number): number {
  return (byteLength / BYTES_PER_PCM16_SAMPLE / REALTIME_SAMPLE_RATE) * 1000
}

function durationBytes(durationMs: number): number {
  return Math.ceil(
    (durationMs / 1000) * REALTIME_SAMPLE_RATE * BYTES_PER_PCM16_SAMPLE
  )
}

function combineChunks(chunks: Array<Uint8Array>): Uint8Array {
  if (chunks.length === 1) return chunks[0]!
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

class Pcm16MicEncoder {
  private readonly sourceSampleRate: number
  private readonly targetSampleRate: number
  private readonly sourceSamplesPerTargetSample: number
  private nextSourceOffset = 0

  constructor(sourceSampleRate: number, targetSampleRate: number) {
    this.sourceSampleRate =
      Number.isFinite(sourceSampleRate) && sourceSampleRate > 0
        ? sourceSampleRate
        : targetSampleRate
    this.targetSampleRate = targetSampleRate
    this.sourceSamplesPerTargetSample =
      this.sourceSampleRate / this.targetSampleRate
  }

  encode(input: Float32Array): EncodedMicAudio | null {
    if (input.length === 0) return null
    const samples =
      this.sourceSampleRate === this.targetSampleRate
        ? input
        : this.resample(input)
    if (samples.length === 0) return null
    return { bytes: pcm16Bytes(samples), level: audioLevel(samples) }
  }

  private resample(input: Float32Array): Float32Array {
    const ratio = this.sourceSamplesPerTargetSample
    if (!Number.isFinite(ratio) || ratio <= 0) return input

    const samples: Array<number> = []
    let sourceOffset = this.nextSourceOffset

    while (sourceOffset < input.length) {
      const leftIndex = Math.floor(sourceOffset)
      const rightIndex = Math.min(leftIndex + 1, input.length - 1)
      const fraction = sourceOffset - leftIndex
      const left = input[leftIndex] ?? 0
      const right = input[rightIndex] ?? left
      samples.push(left + (right - left) * fraction)
      sourceOffset += ratio
    }

    this.nextSourceOffset = sourceOffset - input.length
    if (this.nextSourceOffset < 0) this.nextSourceOffset = 0

    return Float32Array.from(samples)
  }
}

function audioLevel(input: Float32Array): number {
  if (input.length === 0) return 0
  let sumSquares = 0
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index] ?? 0
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / input.length)
  return Math.max(0, Math.min(1, rms * 8))
}

function pcm16Floats(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const output = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000
  }
  return output
}

function alignedPcm16Chunk(
  chunk: Uint8Array,
  remainder: Uint8Array | undefined
): { bytes: Uint8Array; remainder: Uint8Array | undefined } {
  const bytes = remainder ? combineChunks([remainder, chunk]) : chunk
  const alignedLength =
    bytes.byteLength - (bytes.byteLength % BYTES_PER_PCM16_SAMPLE)

  return {
    bytes:
      alignedLength === bytes.byteLength
        ? bytes
        : bytes.subarray(0, alignedLength),
    remainder:
      alignedLength === bytes.byteLength
        ? undefined
        : bytes.slice(alignedLength),
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number
): Promise<void> {
  await Promise.race([promise, delay(timeoutMs)])
}

function micWorkletSource(): string {
  return `
class RealtimeMicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.chunkSamples = options.processorOptions?.chunkSamples ?? ${MIC_CAPTURE_CHUNK_SAMPLES}
    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') this.flush()
    }
    this.reset()
  }

  reset() {
    this.buffer = new Float32Array(this.chunkSamples)
    this.offset = 0
  }

  flush() {
    if (this.offset === 0) return
    const samples =
      this.offset === this.buffer.length
        ? this.buffer
        : this.buffer.slice(0, this.offset)
    this.port.postMessage({ type: 'samples', samples: samples.buffer }, [
      samples.buffer,
    ])
    this.reset()
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0]
    if (output) output.fill(0)

    const input = inputs[0]?.[0]
    if (!input) return true

    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index] || 0))
      this.buffer[this.offset] = sample
      this.offset += 1
      if (this.offset === this.chunkSamples) this.flush()
    }

    return true
  }
}

registerProcessor('${MIC_WORKLET_PROCESSOR_NAME}', RealtimeMicCaptureProcessor)
`
}

function streamHandle(
  baseUrl: string,
  path: string,
  contentType: string,
  opts: { retryWrites?: boolean } = {}
): DurableStream {
  const url = streamUrl(baseUrl, path)
  return new DurableStream({
    url,
    headers: getConfiguredServerHeaders(url),
    contentType,
    ...(opts.retryWrites === false ? { backoffOptions: NO_RETRY_BACKOFF } : {}),
    batching: true,
  })
}

function createAudioContext(): AudioContext {
  return new AudioContext({ sampleRate: REALTIME_SAMPLE_RATE })
}

function createScriptProcessorMicCapture(
  context: AudioContext,
  onSamples: (samples: Float32Array) => void
): MicCapture {
  const processor = context.createScriptProcessor(
    MIC_CAPTURE_CHUNK_SAMPLES,
    1,
    1
  )
  processor.onaudioprocess = (event) => {
    onSamples(event.inputBuffer.getChannelData(0))
  }
  return {
    node: processor,
    cleanup() {
      processor.onaudioprocess = null
    },
    mode: `script-processor`,
  }
}

async function createAudioWorkletMicCapture(
  context: AudioContext,
  onSamples: (samples: Float32Array) => void
): Promise<MicCapture> {
  const workletUrl = URL.createObjectURL(
    new Blob([micWorkletSource()], { type: `application/javascript` })
  )
  try {
    await context.audioWorklet.addModule(workletUrl)
  } finally {
    URL.revokeObjectURL(workletUrl)
  }

  const node = new AudioWorkletNode(context, MIC_WORKLET_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      chunkSamples: MIC_CAPTURE_CHUNK_SAMPLES,
    },
  })
  node.port.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; samples?: unknown } | undefined
    if (data?.type !== `samples` || !(data.samples instanceof ArrayBuffer)) {
      return
    }
    onSamples(new Float32Array(data.samples))
  }

  return {
    node,
    cleanup() {
      node.port.postMessage({ type: `flush` })
      node.port.close()
    },
    mode: `audio-worklet`,
  }
}

async function createMicCapture(
  context: AudioContext,
  onAudio: (bytes: Uint8Array, level: number) => void
): Promise<MicCapture> {
  const encoder = new Pcm16MicEncoder(context.sampleRate, REALTIME_SAMPLE_RATE)
  const onSamples = (samples: Float32Array): void => {
    const encoded = encoder.encode(samples)
    if (!encoded) return
    onAudio(encoded.bytes, encoded.level)
  }

  if (context.audioWorklet) {
    try {
      return await createAudioWorkletMicCapture(context, onSamples)
    } catch (error) {
      console.warn(
        `[realtime-audio] audio worklet unavailable, using script processor fallback`,
        error
      )
    }
  }
  return createScriptProcessorMicCapture(context, onSamples)
}

async function createRealtimeSession(
  baseUrl: string,
  entityUrl: string
): Promise<RealtimeSessionCreateResult> {
  const realtimeSettings = await loadRealtimeSettingsStatus()
  if (
    typeof window !== `undefined` &&
    typeof window.electronAPI?.getRealtimeSettings === `function` &&
    realtimeSettings.openAIApiKeyStatus !== `valid`
  ) {
    throw new Error(
      realtimeSettings.openAIApiKeyError ??
        `OpenAI API key must be verified before starting voice mode.`
    )
  }
  const response = await serverFetch(realtimeUrl(baseUrl), {
    method: `POST`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify({
      entityUrl,
      provider: `openai`,
      model: realtimeSettings.settings.model,
      voice: realtimeSettings.settings.voice,
      reasoningEffort: realtimeSettings.settings.reasoningEffort,
      interruptResponse: realtimeSettings.settings.interruptResponse,
      inputAudio: {
        codec: `pcm16`,
        sampleRate: REALTIME_SAMPLE_RATE,
        channels: 1,
      },
      outputAudio: {
        codec: `pcm16`,
        sampleRate: REALTIME_SAMPLE_RATE,
        channels: 1,
      },
      meta: { source: `agents-server-ui` },
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Failed to start realtime session (${response.status}): ${await response.text()}`
    )
  }
  return {
    ...((await response.json()) as Omit<
      RealtimeSessionCreateResult,
      `interruptResponse`
    >),
    interruptResponse: realtimeSettings.settings.interruptResponse,
  }
}

export async function startRealtimeAudioSession({
  baseUrl,
  entityUrl,
  onInputLevel,
  initialText,
  greetIfSilent = false,
}: {
  baseUrl: string
  entityUrl: string
  onInputLevel?: (level: number) => void
  initialText?: string
  greetIfSilent?: boolean
}): Promise<RealtimeAudioSession> {
  const abort = new AbortController()
  const micContext = createAudioContext()
  const playbackContext = createAudioContext()
  let inputLevelHandler = onInputLevel
  const resumeAudioContexts = Promise.allSettled([
    micContext.resume(),
    playbackContext.resume(),
  ])
  let playback = Promise.resolve()
  let control = Promise.resolve()
  let media: MediaStream | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let micCapture: MicCapture | undefined
  let silentOutput: GainNode | undefined
  let controlIn: DurableStream | undefined
  let session: RealtimeSessionCreateResult | undefined
  let nextPlaybackTime = playbackContext.currentTime
  let currentOutputItemId: string | null = null
  let currentOutputStartedAt: number | null = null
  let currentOutputReceivedMs = 0
  let micChunks = 0
  let micSentChunks = 0
  let playbackChunks = 0
  let controlEvents = 0
  let speechTurns = 0
  let voiceCandidateChunks = 0
  let noiseFloor = MIC_NOISE_FLOOR_INITIAL
  let speechActive = false
  let lastVoiceAt = 0
  let audioQueuedBytes = 0
  let audioInputStopping = false
  let audioInputError: Error | undefined
  let wakeAudioInputWriter: (() => void) | undefined
  let activeResponseId: string | undefined
  let responseActive = false
  let userSpeechSeen = false
  let textTurnSent = false
  let silentGreetingTimer: number | undefined
  let providerStarted = false
  let initialStartHandled = false
  const preSpeechChunks: Array<Uint8Array> = []
  const audioQueue: Array<Uint8Array> = []
  const pendingAudioAppends = new Set<Promise<void>>()
  const playbackNodes = new Set<AudioBufferSourceNode>()
  let audioInputWriter = Promise.resolve()

  const appendControl = async (value: unknown): Promise<void> => {
    await controlIn?.append(jsonBytes(value))
  }

  const cancelSilentGreeting = (): void => {
    if (silentGreetingTimer === undefined) return
    window.clearTimeout(silentGreetingTimer)
    silentGreetingTimer = undefined
  }

  const markUserSpeechSeen = (): void => {
    userSpeechSeen = true
    cancelSilentGreeting()
  }

  const sendTextTurn = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed) return
    textTurnSent = true
    cancelSilentGreeting()
    await appendControl({ type: `input_text`, text: trimmed })
  }

  const scheduleSilentGreeting = (): void => {
    if (!greetIfSilent || initialText?.trim()) return
    cancelSilentGreeting()
    console.info(
      `[realtime-audio] scheduling silent greeting session=${session?.sessionId} delayMs=${SILENT_GREETING_DELAY_MS}`
    )
    silentGreetingTimer = window.setTimeout(() => {
      silentGreetingTimer = undefined
      if (abort.signal.aborted || userSpeechSeen || textTurnSent) {
        console.info(
          `[realtime-audio] silent greeting skipped session=${session?.sessionId} userSpeechSeen=${userSpeechSeen} textTurnSent=${textTurnSent}`
        )
        return
      }
      console.info(
        `[realtime-audio] sending silent greeting session=${session?.sessionId}`
      )
      void sendTextTurn(SILENT_GREETING_TEXT).catch((error) => {
        console.warn(`[realtime-audio] silent greeting failed`, error)
      })
    }, SILENT_GREETING_DELAY_MS)
  }

  const handleInitialRealtimeStart = (): void => {
    if (!providerStarted || initialStartHandled) return
    initialStartHandled = true
    if (initialText?.trim()) {
      void sendTextTurn(initialText).catch((error) => {
        console.warn(`[realtime-audio] initial realtime text failed`, error)
      })
      return
    }
    scheduleSilentGreeting()
  }

  const wakeAudioWriter = (): void => {
    wakeAudioInputWriter?.()
    wakeAudioInputWriter = undefined
  }

  const playbackIsActive = (): boolean =>
    playbackNodes.size > 0 ||
    nextPlaybackTime > playbackContext.currentTime + 0.05

  const trimPreSpeechChunks = (): void => {
    const maxBytes = durationBytes(MIC_PRE_ROLL_MS)
    let total = preSpeechChunks.reduce(
      (sum, chunk) => sum + chunk.byteLength,
      0
    )
    while (total > maxBytes && preSpeechChunks.length > 0) {
      const dropped = preSpeechChunks.shift()!
      total -= dropped.byteLength
    }
  }

  const rememberPreSpeechChunk = (bytes: Uint8Array): void => {
    preSpeechChunks.push(bytes)
    trimPreSpeechChunks()
  }

  const dropStaleAudio = (): void => {
    const maxBytes = durationBytes(MIC_MAX_QUEUE_MS)
    while (audioQueuedBytes > maxBytes && audioQueue.length > 1) {
      const dropped = audioQueue.shift()!
      audioQueuedBytes -= dropped.byteLength
    }
  }

  const enqueueAudioInput = (bytes: Uint8Array): void => {
    audioQueue.push(bytes)
    audioQueuedBytes += bytes.byteLength
    dropStaleAudio()
    wakeAudioWriter()
  }

  const dequeueAudioBatch = (): Uint8Array | null => {
    if (audioQueue.length === 0) return null
    const maxBytes = durationBytes(MIC_APPEND_BATCH_MS)
    let batchBytes = 0
    const chunks: Array<Uint8Array> = []
    while (audioQueue.length > 0) {
      const next = audioQueue[0]!
      if (chunks.length > 0 && batchBytes + next.byteLength > maxBytes) break
      chunks.push(audioQueue.shift()!)
      batchBytes += next.byteLength
      audioQueuedBytes -= next.byteLength
    }
    return combineChunks(chunks)
  }

  const toError = (value: unknown): Error =>
    value instanceof Error ? value : new Error(String(value))

  const throwIfAudioInputFailed = (): void => {
    if (audioInputError) throw audioInputError
  }

  const waitForPendingAudioInput = async (
    timeoutMs = MIC_APPEND_DRAIN_WAIT_MS
  ): Promise<void> => {
    if (pendingAudioAppends.size > 0) {
      await Promise.race([
        Promise.all(Array.from(pendingAudioAppends)),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ])
    }
    throwIfAudioInputFailed()
  }

  const trackAudioAppend = (
    audioIn: DurableStream,
    batch: Uint8Array
  ): void => {
    const append = audioIn
      .append(batch)
      .then(() => {
        micSentChunks += 1
        if (micSentChunks === 1) {
          console.info(
            `[realtime-audio] microphone first sent chunk session=${session?.sessionId} bytes=${batch.byteLength}`
          )
        }
      })
      .catch((error) => {
        audioInputError ??= toError(error)
        console.warn(`[realtime-audio] microphone append failed`, error)
      })
      .finally(() => {
        pendingAudioAppends.delete(append)
      })
    pendingAudioAppends.add(append)
  }

  const runAudioInputWriter = async (audioIn: DurableStream): Promise<void> => {
    while (
      !audioInputStopping ||
      audioQueue.length > 0 ||
      pendingAudioAppends.size > 0
    ) {
      throwIfAudioInputFailed()
      const batch = dequeueAudioBatch()
      if (batch) {
        trackAudioAppend(audioIn, batch)
        continue
      }

      if (audioInputStopping && pendingAudioAppends.size > 0) {
        await waitForPendingAudioInput(250)
        continue
      }

      await new Promise<void>((resolve) => {
        wakeAudioInputWriter = resolve
      })
    }
  }

  const stopScheduledPlayback = (): void => {
    for (const node of playbackNodes) {
      try {
        node.stop()
      } catch {
        // Already stopped.
      }
    }
    playbackNodes.clear()
    nextPlaybackTime = playbackContext.currentTime
    currentOutputStartedAt = null
  }

  const setCurrentOutputItem = (itemId: string): void => {
    if (currentOutputItemId === itemId) return
    currentOutputItemId = itemId
    currentOutputStartedAt = null
    currentOutputReceivedMs = 0
  }

  const interruptPlayback = ({
    cancelResponse = true,
  }: { cancelResponse?: boolean } = {}): void => {
    const itemId = currentOutputItemId
    const wasResponseActive = responseActive
    responseActive = false
    if (cancelResponse && (wasResponseActive || itemId)) {
      void appendControl({ type: `response.cancel` }).catch((error) => {
        console.warn(`[realtime-audio] response cancel failed`, error)
      })
    }

    if (!itemId) {
      stopScheduledPlayback()
      return
    }

    const playedMs =
      currentOutputStartedAt === null
        ? 0
        : Math.max(
            0,
            Math.floor(
              (playbackContext.currentTime - currentOutputStartedAt) * 1000
            )
          )
    const maxGeneratedMs = Math.max(
      0,
      Math.floor(currentOutputReceivedMs - TRUNCATE_SAFETY_MS)
    )
    const audioEndMs = Math.min(playedMs, maxGeneratedMs)
    stopScheduledPlayback()
    if (audioEndMs <= 0) return

    void appendControl({
      type: `output_audio.truncate`,
      itemId,
      audioEndMs,
    }).catch((error) => {
      console.warn(`[realtime-audio] output truncate failed`, error)
    })
  }

  const cleanup = async (sendClose: boolean): Promise<void> => {
    micCapture?.cleanup()
    micCapture?.node.disconnect()
    cancelSilentGreeting()
    silentOutput?.disconnect()
    source?.disconnect()
    inputLevelHandler?.(0)
    for (const track of media?.getTracks() ?? []) track.stop()
    audioInputStopping = true
    wakeAudioWriter()
    await settleWithin(audioInputWriter, 250)
    abort.abort()
    stopScheduledPlayback()
    await settleWithin(audioInputWriter, 250)
    if (sendClose && controlIn) {
      await settleWithin(
        appendControl({
          type: `session.close`,
          reason: `client-stop`,
        }).catch(() => undefined),
        500
      )
    }
    await Promise.allSettled([
      settleWithin(playback, 250),
      settleWithin(control, 250),
    ])
    await Promise.allSettled([micContext.close(), playbackContext.close()])
  }

  try {
    media = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: REALTIME_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    await resumeAudioContexts
    session = await createRealtimeSession(baseUrl, entityUrl)
    console.info(
      `[realtime-audio] session started session=${session.sessionId} audioIn=${session.streams.audio_in} audioOut=${session.streams.audio_out}`
    )
    const audioIn = streamHandle(
      baseUrl,
      session.streams.audio_in,
      `audio/pcm; rate=${REALTIME_SAMPLE_RATE}; channels=1`,
      { retryWrites: false }
    )
    const audioOut = streamHandle(
      baseUrl,
      session.streams.audio_out,
      `audio/pcm; rate=${REALTIME_SAMPLE_RATE}; channels=1`
    )
    controlIn = streamHandle(
      baseUrl,
      session.streams.control_in,
      `application/json`,
      { retryWrites: false }
    )
    const controlOut = streamHandle(
      baseUrl,
      session.streams.control_out,
      `application/json`
    )
    audioInputWriter = runAudioInputWriter(audioIn).catch((error) => {
      if (!abort.signal.aborted) {
        console.warn(`[realtime-audio] microphone writer failed`, error)
      }
    })

    const handleInputAudio = (bytes: Uint8Array, level: number): void => {
      if (abort.signal.aborted) return
      inputLevelHandler?.(level)
      micChunks += 1
      if (micChunks === 1) {
        console.info(
          `[realtime-audio] microphone first chunk session=${session?.sessionId} bytes=${bytes.byteLength}`
        )
      }
      rememberPreSpeechChunk(bytes)

      const now = performance.now()
      const startThreshold = Math.max(
        MIC_MIN_START_LEVEL,
        noiseFloor + MIC_NOISE_MARGIN_START,
        playbackIsActive() ? MIC_PLAYBACK_START_LEVEL : 0
      )
      const continueThreshold = Math.max(
        MIC_MIN_CONTINUE_LEVEL,
        noiseFloor + MIC_NOISE_MARGIN_CONTINUE
      )
      const hasVoice =
        level >= (speechActive ? continueThreshold : startThreshold)

      if (hasVoice) {
        lastVoiceAt = now
        if (!speechActive) {
          voiceCandidateChunks += 1
          const requiredChunks = playbackIsActive()
            ? MIC_PLAYBACK_START_CONFIRM_CHUNKS
            : MIC_START_CONFIRM_CHUNKS
          if (voiceCandidateChunks < requiredChunks) return

          voiceCandidateChunks = 0
          speechActive = true
          speechTurns += 1
          console.info(
            `[realtime-audio] microphone voice gate opened session=${session?.sessionId} turn=${speechTurns} level=${level.toFixed(4)} threshold=${startThreshold.toFixed(4)} noiseFloor=${noiseFloor.toFixed(4)}`
          )
          for (const chunk of preSpeechChunks.splice(0)) {
            enqueueAudioInput(chunk)
          }
          return
        }
        enqueueAudioInput(bytes)
        return
      }

      voiceCandidateChunks = 0

      if (speechActive) {
        if (now - lastVoiceAt < MIC_VAD_TAIL_MS) {
          enqueueAudioInput(bytes)
          return
        }
        speechActive = false
      }

      if (!speechActive && level < startThreshold) {
        noiseFloor =
          noiseFloor * (1 - MIC_NOISE_FLOOR_ALPHA) +
          Math.min(level, MIC_NOISE_FLOOR_MAX) * MIC_NOISE_FLOOR_ALPHA
      }
    }
    source = micContext.createMediaStreamSource(media)
    micCapture = await createMicCapture(micContext, handleInputAudio)
    console.info(
      `[realtime-audio] microphone capture mode session=${session.sessionId} mode=${micCapture.mode} inputRate=${micContext.sampleRate} targetRate=${REALTIME_SAMPLE_RATE}`
    )
    silentOutput = micContext.createGain()
    silentOutput.gain.value = 0
    source.connect(micCapture.node)
    micCapture.node.connect(silentOutput)
    silentOutput.connect(micContext.destination)

    playback = (async () => {
      const response = await audioOut.stream({
        live: true,
        signal: abort.signal,
        warnOnHttp: false,
      })
      let playbackRemainder: Uint8Array | undefined
      try {
        for await (const chunk of response.bodyStream()) {
          if (abort.signal.aborted || chunk.byteLength === 0) continue
          playbackChunks += 1
          if (playbackChunks === 1) {
            console.info(
              `[realtime-audio] playback first chunk session=${session?.sessionId} bytes=${chunk.byteLength}`
            )
          }
          const aligned = alignedPcm16Chunk(chunk, playbackRemainder)
          playbackRemainder = aligned.remainder
          if (aligned.bytes.byteLength === 0) continue

          const samples = pcm16Floats(aligned.bytes)
          const buffer = playbackContext.createBuffer(
            1,
            samples.length,
            REALTIME_SAMPLE_RATE
          )
          buffer.copyToChannel(samples, 0)
          const node = playbackContext.createBufferSource()
          node.buffer = buffer
          node.connect(playbackContext.destination)
          node.onended = () => playbackNodes.delete(node)
          playbackNodes.add(node)
          const startAt = Math.max(
            playbackContext.currentTime,
            nextPlaybackTime
          )
          if (currentOutputItemId && currentOutputStartedAt === null) {
            currentOutputStartedAt = startAt
          }
          node.start(startAt)
          nextPlaybackTime = startAt + buffer.duration
        }
      } finally {
        response.cancel()
      }
    })().catch((error) => {
      if (!abort.signal.aborted) {
        console.warn(`[realtime-audio] playback stream failed`, error)
      }
    })

    control = (async () => {
      const response = await controlOut.stream<RealtimeControlOutput>({
        live: true,
        signal: abort.signal,
        json: true,
        warnOnHttp: false,
      })
      try {
        for await (const event of response.jsonStream()) {
          if (abort.signal.aborted || !event || typeof event !== `object`) {
            continue
          }
          controlEvents += 1
          if (controlEvents === 1) {
            console.info(
              `[realtime-audio] control first event session=${session?.sessionId} type=${event.type}`
            )
          }
          if (event.type === `session.started`) {
            providerStarted = true
            handleInitialRealtimeStart()
          } else if (event.type === `response.started`) {
            activeResponseId =
              typeof event.responseId === `string`
                ? event.responseId
                : undefined
            responseActive = true
          } else if (
            event.type === `response.completed` ||
            event.type === `response.cancelled`
          ) {
            if (
              !activeResponseId ||
              typeof event.responseId !== `string` ||
              event.responseId === activeResponseId
            ) {
              activeResponseId = undefined
              responseActive = false
            }
          } else if (
            event.type === `output_audio.delta` &&
            typeof event.itemId === `string`
          ) {
            setCurrentOutputItem(event.itemId)
            if (typeof event.byteLength === `number`) {
              currentOutputReceivedMs += pcm16DurationMs(event.byteLength)
            }
          } else if (
            event.type === `input_audio.speech_started` &&
            session.interruptResponse
          ) {
            markUserSpeechSeen()
            interruptPlayback({ cancelResponse: false })
          } else if (event.type === `input_audio.speech_started`) {
            markUserSpeechSeen()
          }
        }
      } finally {
        response.cancel()
      }
    })().catch((error) => {
      if (!abort.signal.aborted) {
        console.warn(`[realtime-audio] control stream failed`, error)
      }
    })

    return {
      sessionId: session.sessionId,
      async sendText(text: string) {
        await sendTextTurn(text)
      },
      setInputLevelHandler(handler) {
        inputLevelHandler = handler
      },
      async stop() {
        await cleanup(true)
      },
    }
  } catch (error) {
    await cleanup(Boolean(session))
    throw error
  }
}
