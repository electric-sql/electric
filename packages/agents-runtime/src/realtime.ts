import type { RealtimeProviderConfig, RealtimeProviderEvent } from './types'

export interface TestRealtimeProviderOptions {
  model?: string
  events?: Array<RealtimeProviderEvent>
  response?: string
}

export function createTestRealtimeProvider(
  opts: TestRealtimeProviderOptions = {}
): RealtimeProviderConfig {
  return {
    id: `test`,
    model: opts.model ?? `test-realtime`,
    async connect() {
      const events =
        opts.events ??
        (opts.response != null
          ? [
              { type: `session.started` as const },
              {
                type: `output_transcript.completed` as const,
                text: opts.response,
              },
              { type: `response.completed` as const },
              { type: `session.closed` as const },
            ]
          : [
              { type: `session.started` as const },
              { type: `session.closed` as const },
            ])

      return {
        events: (async function* () {
          for (const event of events) {
            yield event
          }
        })(),
      }
    },
  }
}
