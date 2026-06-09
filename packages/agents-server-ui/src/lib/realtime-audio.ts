import { DurableStream } from '@durable-streams/client'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import { serverFetch, getConfiguredServerHeaders } from './auth-fetch'

export type RealtimeAudioSession = {
  sessionId: string
  sendText: (text: string) => Promise<void>
  stop: () => Promise<void>
}

type RealtimeSessionCreateResult = {
  sessionId: string
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
const BYTES_PER_PCM16_SAMPLE = 2
const TRUNCATE_SAFETY_MS = 80

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

function pcm16Floats(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const output = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000
  }
  return output
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function trackPendingAppend(
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

function streamHandle(
  baseUrl: string,
  path: string,
  contentType: string
): DurableStream {
  const url = streamUrl(baseUrl, path)
  return new DurableStream({
    url,
    headers: getConfiguredServerHeaders(url),
    contentType,
    batching: true,
  })
}

function createAudioContext(): AudioContext {
  return new AudioContext({ sampleRate: REALTIME_SAMPLE_RATE })
}

async function createRealtimeSession(
  baseUrl: string,
  entityUrl: string
): Promise<RealtimeSessionCreateResult> {
  const response = await serverFetch(realtimeUrl(baseUrl), {
    method: `POST`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify({
      entityUrl,
      provider: `openai`,
      model: `gpt-realtime`,
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
  return (await response.json()) as RealtimeSessionCreateResult
}

export async function startRealtimeAudioSession({
  baseUrl,
  entityUrl,
  onInputLevel,
}: {
  baseUrl: string
  entityUrl: string
  onInputLevel?: (level: number) => void
}): Promise<RealtimeAudioSession> {
  const abort = new AbortController()
  const micContext = createAudioContext()
  const playbackContext = createAudioContext()
  const resumeAudioContexts = Promise.allSettled([
    micContext.resume(),
    playbackContext.resume(),
  ])
  let playback = Promise.resolve()
  let control = Promise.resolve()
  let media: MediaStream | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let silentOutput: GainNode | undefined
  let controlIn: DurableStream | undefined
  let session: RealtimeSessionCreateResult | undefined
  let nextPlaybackTime = playbackContext.currentTime
  let currentOutputItemId: string | null = null
  let currentOutputStartedAt: number | null = null
  let currentOutputReceivedMs = 0
  let micChunks = 0
  let playbackChunks = 0
  let controlEvents = 0
  const playbackNodes = new Set<AudioBufferSourceNode>()
  const pendingAudioAppends = new Set<Promise<void>>()

  const appendControl = async (value: unknown): Promise<void> => {
    await controlIn?.append(jsonBytes(value))
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

  const interruptPlayback = (): void => {
    const itemId = currentOutputItemId
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
    abort.abort()
    processor?.disconnect()
    silentOutput?.disconnect()
    source?.disconnect()
    onInputLevel?.(0)
    for (const track of media?.getTracks() ?? []) track.stop()
    stopScheduledPlayback()
    await Promise.allSettled(pendingAudioAppends)
    if (sendClose && controlIn) {
      await appendControl({
        type: `session.close`,
        reason: `client-stop`,
      }).catch(() => undefined)
    }
    await Promise.allSettled([playback, control])
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
      `audio/pcm; rate=${REALTIME_SAMPLE_RATE}; channels=1`
    )
    const audioOut = streamHandle(
      baseUrl,
      session.streams.audio_out,
      `audio/pcm; rate=${REALTIME_SAMPLE_RATE}; channels=1`
    )
    controlIn = streamHandle(
      baseUrl,
      session.streams.control_in,
      `application/json`
    )
    const controlOut = streamHandle(
      baseUrl,
      session.streams.control_out,
      `application/json`
    )

    source = micContext.createMediaStreamSource(media)
    processor = micContext.createScriptProcessor(1024, 1, 1)
    silentOutput = micContext.createGain()
    silentOutput.gain.value = 0
    processor.onaudioprocess = (event) => {
      if (abort.signal.aborted) return
      const input = event.inputBuffer.getChannelData(0)
      const bytes = pcm16Bytes(input)
      onInputLevel?.(audioLevel(input))
      micChunks += 1
      if (micChunks === 1) {
        console.info(
          `[realtime-audio] microphone first chunk session=${session?.sessionId} bytes=${bytes.byteLength}`
        )
      }
      trackPendingAppend(
        pendingAudioAppends,
        audioIn.append(bytes),
        (error) => {
          console.warn(`[realtime-audio] microphone append failed`, error)
        }
      )
    }
    source.connect(processor)
    processor.connect(silentOutput)
    silentOutput.connect(micContext.destination)

    playback = (async () => {
      const response = await audioOut.stream({
        live: true,
        signal: abort.signal,
        warnOnHttp: false,
      })
      try {
        for await (const chunk of response.bodyStream()) {
          if (abort.signal.aborted || chunk.byteLength === 0) continue
          playbackChunks += 1
          if (playbackChunks === 1) {
            console.info(
              `[realtime-audio] playback first chunk session=${session?.sessionId} bytes=${chunk.byteLength}`
            )
          }
          const samples = pcm16Floats(chunk)
          const buffer = playbackContext.createBuffer(
            1,
            samples.length,
            REALTIME_SAMPLE_RATE
          )
          const channel = new Float32Array(samples.length)
          channel.set(samples)
          buffer.copyToChannel(channel, 0)
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
          if (
            event.type === `output_audio.delta` &&
            typeof event.itemId === `string`
          ) {
            setCurrentOutputItem(event.itemId)
            if (typeof event.byteLength === `number`) {
              currentOutputReceivedMs += pcm16DurationMs(event.byteLength)
            }
          } else if (event.type === `input_audio.speech_started`) {
            interruptPlayback()
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
        await appendControl({ type: `input_text`, text })
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
