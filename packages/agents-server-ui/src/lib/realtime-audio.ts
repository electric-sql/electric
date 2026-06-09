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

const REALTIME_SAMPLE_RATE = 24_000

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

function pcm16Floats(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const output = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000
  }
  return output
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
    batching: false,
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
      model: `gpt-realtime-2`,
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
}: {
  baseUrl: string
  entityUrl: string
}): Promise<RealtimeAudioSession> {
  const session = await createRealtimeSession(baseUrl, entityUrl)
  const abort = new AbortController()
  const micContext = createAudioContext()
  const playbackContext = createAudioContext()
  const media = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: REALTIME_SAMPLE_RATE,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
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
  const controlIn = streamHandle(
    baseUrl,
    session.streams.control_in,
    `application/json`
  )

  const source = micContext.createMediaStreamSource(media)
  const processor = micContext.createScriptProcessor(1024, 1, 1)
  const silentOutput = micContext.createGain()
  silentOutput.gain.value = 0
  let appendQueue = Promise.resolve()
  processor.onaudioprocess = (event) => {
    if (abort.signal.aborted) return
    const input = event.inputBuffer.getChannelData(0)
    const bytes = pcm16Bytes(input)
    appendQueue = appendQueue
      .then(() => audioIn.append(bytes))
      .catch((error) => {
        console.warn(`[realtime-audio] microphone append failed`, error)
      })
  }
  source.connect(processor)
  processor.connect(silentOutput)
  silentOutput.connect(micContext.destination)

  let nextPlaybackTime = playbackContext.currentTime
  const playback = (async () => {
    const response = await audioOut.stream({
      live: true,
      signal: abort.signal,
      warnOnHttp: false,
    })
    try {
      for await (const chunk of response.bodyStream()) {
        if (abort.signal.aborted || chunk.byteLength === 0) continue
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
        const startAt = Math.max(playbackContext.currentTime, nextPlaybackTime)
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

  return {
    sessionId: session.sessionId,
    async sendText(text: string) {
      await controlIn.append(
        new TextEncoder().encode(JSON.stringify({ type: `input_text`, text }))
      )
    },
    async stop() {
      abort.abort()
      processor.disconnect()
      silentOutput.disconnect()
      source.disconnect()
      for (const track of media.getTracks()) track.stop()
      await appendQueue.catch(() => undefined)
      await controlIn
        .append(
          new TextEncoder().encode(
            JSON.stringify({ type: `session.close`, reason: `client-stop` })
          )
        )
        .catch(() => undefined)
      await playback
      await Promise.allSettled([micContext.close(), playbackContext.close()])
    },
  }
}
