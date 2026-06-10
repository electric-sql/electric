import { assign, fromCallback, fromPromise, setup } from 'xstate'
import type { PullWakeEvent, PullWakeStreamResponse } from './pull-wake-runner'

export const INITIAL_RECONNECT_BACKOFF_MS = 1_000
export const MAX_RECONNECT_BACKOFF_MS = 30_000

/**
 * Side effects the lifecycle machine triggers but does not own. Diagnostics,
 * heartbeating, and claim processing live in the runner closure; the machine
 * decides *when* they happen so every (state, event) pair is explicit.
 */
export interface PullWakeMachineEffects {
  /** Open the wake stream. The signal is aborted whenever `connecting` exits. */
  connectStream: (signal: AbortSignal) => Promise<PullWakeStreamResponse>
  onStreamConnected: () => void
  onStreamDisconnected: () => void
  onWake: (event: PullWakeEvent) => void
  onOffset: (offset: string) => void
  /** A connect attempt or stream session ended in error. */
  onReconnectError: (error: unknown) => void
  notifyHeartbeatChange: () => void
  cancelResponse: (response: PullWakeStreamResponse, reason: Error) => void
  /** Entered `stopping`: abort in-flight work and stop heartbeats. */
  onStopping: () => void
  /** Drain sequence: wait for claim actors, abort wakes, drain wakes. */
  shutdown: () => Promise<void>
}

export interface PullWakeMachineContext {
  backoffMs: number
  response: PullWakeStreamResponse | null
  streamResetError: Error | null
  drainError: unknown
}

export type PullWakeMachineEvent =
  | { type: `START` }
  | { type: `STOP` }
  | { type: `STREAM_RESET`; error: Error }
  | { type: `WAKE`; event: PullWakeEvent }
  | { type: `OFFSET`; offset: string }
  | { type: `STREAM_END`; error?: unknown }

export function createPullWakeMachine(effects: PullWakeMachineEffects) {
  return setup({
    types: {
      context: {} as PullWakeMachineContext,
      events: {} as PullWakeMachineEvent,
    },
    actors: {
      connectStream: fromPromise<PullWakeStreamResponse>(({ signal }) =>
        effects.connectStream(signal)
      ),
      consumeStream: fromCallback<
        PullWakeMachineEvent,
        { response: PullWakeStreamResponse }
      >(({ sendBack, input }) => {
        const { response } = input
        let stopped = false
        void (async () => {
          try {
            for await (const event of response.jsonStream()) {
              if (stopped) return
              if (event?.type === `wake`) {
                sendBack({ type: `WAKE`, event })
              }
              if (response.offset !== undefined) {
                sendBack({ type: `OFFSET`, offset: response.offset })
              }
            }
            await response.closed
            if (!stopped) sendBack({ type: `STREAM_END` })
          } catch (error) {
            if (!stopped) sendBack({ type: `STREAM_END`, error })
          }
        })()
        return () => {
          stopped = true
        }
      }),
      shutdown: fromPromise(() => effects.shutdown()),
    },
    delays: {
      reconnectBackoff: ({ context }) => context.backoffMs,
    },
  }).createMachine({
    id: `pullWakeRunner`,
    context: {
      backoffMs: INITIAL_RECONNECT_BACKOFF_MS,
      response: null,
      streamResetError: null,
      drainError: null,
    },
    initial: `stopped`,
    states: {
      stopped: {
        on: {
          START: {
            target: `running`,
            actions: assign({
              backoffMs: INITIAL_RECONNECT_BACKOFF_MS,
              response: null,
              streamResetError: null,
              drainError: null,
            }),
          },
        },
      },
      running: {
        initial: `connecting`,
        on: {
          STOP: { target: `stopping` },
        },
        states: {
          connecting: {
            entry: [
              assign({ streamResetError: null }),
              () => effects.notifyHeartbeatChange(),
            ],
            invoke: {
              src: `connectStream`,
              onDone: {
                target: `streaming`,
                actions: assign({
                  response: ({ event }) => event.output,
                  backoffMs: INITIAL_RECONNECT_BACKOFF_MS,
                }),
              },
              onError: {
                target: `reconnecting`,
                actions: ({ event }) => effects.onReconnectError(event.error),
              },
            },
            on: {
              // Leaving `connecting` aborts the in-flight connect attempt —
              // the invoked promise actor's signal is cancelled by xstate.
              STREAM_RESET: {
                target: `reconnecting`,
                actions: ({ event }) => effects.onReconnectError(event.error),
              },
            },
          },
          streaming: {
            entry: () => effects.onStreamConnected(),
            exit: [
              ({ context }) => {
                if (context.response) {
                  effects.cancelResponse(
                    context.response,
                    context.streamResetError ??
                      new Error(`pull wake runner stopped`)
                  )
                }
              },
              () => effects.onStreamDisconnected(),
              assign({ response: null }),
            ],
            invoke: {
              src: `consumeStream`,
              input: ({ context }) => ({ response: context.response! }),
            },
            on: {
              WAKE: { actions: ({ event }) => effects.onWake(event.event) },
              OFFSET: {
                actions: ({ event }) => effects.onOffset(event.offset),
              },
              STREAM_RESET: {
                guard: ({ context }) => !context.streamResetError,
                // Cancel the stream; the consume actor then observes the end
                // of iteration and emits STREAM_END, which routes to the
                // error path below via context.streamResetError.
                actions: [
                  assign({ streamResetError: ({ event }) => event.error }),
                  ({ context, event }) => {
                    if (context.response) {
                      effects.cancelResponse(context.response, event.error)
                    }
                  },
                ],
              },
              STREAM_END: [
                {
                  guard: ({ context, event }) =>
                    Boolean(event.error ?? context.streamResetError),
                  target: `reconnecting`,
                  actions: ({ context, event }) =>
                    effects.onReconnectError(
                      event.error ?? context.streamResetError
                    ),
                },
                { target: `reconnecting` },
              ],
            },
          },
          reconnecting: {
            entry: () => effects.notifyHeartbeatChange(),
            after: {
              reconnectBackoff: {
                target: `connecting`,
                actions: assign({
                  backoffMs: ({ context }) =>
                    Math.min(context.backoffMs * 2, MAX_RECONNECT_BACKOFF_MS),
                }),
              },
            },
          },
        },
      },
      stopping: {
        entry: () => effects.onStopping(),
        invoke: {
          src: `shutdown`,
          onDone: { target: `stopped` },
          onError: {
            target: `stopped`,
            actions: assign({ drainError: ({ event }) => event.error }),
          },
        },
      },
    },
  })
}
