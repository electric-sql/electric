import type { ShapeStreamStateKind } from '../../src/shape-stream-state'

export type EventType =
  | `response`
  | `messages`
  | `sseClose`
  | `pause`
  | `resume`
  | `error`
  | `retry`
  | `markMustRefetch`
  | `withHandle`
  | `enterReplayMode`

export interface ExpectedBehavior {
  /** Expected kind of the resulting state */
  resultKind?: ShapeStreamStateKind
  /** If true, the result state should be reference-equal to the input state (no-op) */
  sameReference?: boolean
  /** For response events: expected action in the transition */
  action?: `accepted` | `ignored` | `stale-retry`
  /** For message events: expected becameUpToDate flag */
  becameUpToDate?: boolean
  /** Description for debugging */
  description: string
}

export const TRANSITION_TABLE: Record<
  ShapeStreamStateKind,
  Partial<Record<EventType, ExpectedBehavior>>
> = {
  initial: {
    response: {
      resultKind: `syncing`,
      action: `accepted`,
      description: `Initial accepts response → Syncing`,
    },
    messages: {
      resultKind: `live`,
      becameUpToDate: true,
      description: `Initial with up-to-date message → Live`,
    },
    sseClose: {
      sameReference: true,
      description: `Initial ignores SSE close (base class no-op)`,
    },
    pause: {
      resultKind: `paused`,
      description: `Initial → Paused`,
    },
    error: {
      resultKind: `error`,
      description: `Initial → Error`,
    },
    markMustRefetch: {
      resultKind: `initial`,
      description: `Initial → fresh Initial`,
    },
    withHandle: {
      resultKind: `initial`,
      description: `Initial with new handle stays Initial`,
    },
    enterReplayMode: {
      resultKind: `replaying`,
      description: `Initial can enter replay → Replaying`,
    },
  },
  syncing: {
    response: {
      resultKind: `syncing`,
      action: `accepted`,
      description: `Syncing accepts response → Syncing`,
    },
    messages: {
      resultKind: `live`,
      becameUpToDate: true,
      description: `Syncing with up-to-date message → Live`,
    },
    sseClose: {
      sameReference: true,
      description: `Syncing ignores SSE close (base class no-op)`,
    },
    pause: {
      resultKind: `paused`,
      description: `Syncing → Paused`,
    },
    error: {
      resultKind: `error`,
      description: `Syncing → Error`,
    },
    markMustRefetch: {
      resultKind: `initial`,
      description: `Syncing → fresh Initial`,
    },
    withHandle: {
      resultKind: `syncing`,
      description: `Syncing with new handle stays Syncing`,
    },
    enterReplayMode: {
      resultKind: `replaying`,
      description: `Syncing can enter replay → Replaying`,
    },
  },
  live: {
    response: {
      resultKind: `live`,
      action: `accepted`,
      description: `Live accepts response → Live`,
    },
    messages: {
      resultKind: `live`,
      becameUpToDate: true,
      description: `Live with up-to-date message → Live`,
    },
    sseClose: {
      resultKind: `live`,
      description: `Live handles SSE close → Live (with updated SSE state)`,
    },
    pause: {
      resultKind: `paused`,
      description: `Live → Paused`,
    },
    error: {
      resultKind: `error`,
      description: `Live → Error`,
    },
    markMustRefetch: {
      resultKind: `initial`,
      description: `Live → fresh Initial`,
    },
    withHandle: {
      resultKind: `live`,
      description: `Live with new handle stays Live`,
    },
    enterReplayMode: {
      sameReference: true,
      description: `Live cannot enter replay (base class no-op)`,
    },
  },
  replaying: {
    response: {
      resultKind: `replaying`,
      action: `accepted`,
      description: `Replaying accepts response → Replaying`,
    },
    messages: {
      resultKind: `live`,
      becameUpToDate: true,
      description: `Replaying with up-to-date message → Live`,
    },
    sseClose: {
      sameReference: true,
      description: `Replaying ignores SSE close (base class no-op)`,
    },
    pause: {
      resultKind: `paused`,
      description: `Replaying → Paused`,
    },
    error: {
      resultKind: `error`,
      description: `Replaying → Error`,
    },
    markMustRefetch: {
      resultKind: `initial`,
      description: `Replaying → fresh Initial`,
    },
    withHandle: {
      resultKind: `replaying`,
      description: `Replaying with new handle stays Replaying`,
    },
    enterReplayMode: {
      sameReference: true,
      description: `Replaying cannot enter replay (base class no-op)`,
    },
  },
  'stale-retry': {
    response: {
      resultKind: `syncing`,
      action: `accepted`,
      description: `StaleRetry accepts response → Syncing`,
    },
    messages: {
      resultKind: `live`,
      becameUpToDate: true,
      description: `StaleRetry with up-to-date message → Live`,
    },
    sseClose: {
      sameReference: true,
      description: `StaleRetry ignores SSE close (base class no-op)`,
    },
    pause: {
      resultKind: `paused`,
      description: `StaleRetry → Paused`,
    },
    error: {
      resultKind: `error`,
      description: `StaleRetry → Error`,
    },
    markMustRefetch: {
      resultKind: `initial`,
      description: `StaleRetry → fresh Initial`,
    },
    withHandle: {
      resultKind: `stale-retry`,
      description: `StaleRetry with new handle stays StaleRetry`,
    },
    enterReplayMode: {
      resultKind: `replaying`,
      description: `StaleRetry enters replay → Replaying (loses retry count)`,
    },
  },
  paused: {
    response: {
      action: `ignored`,
      sameReference: true,
      description: `Paused ignores response (base class no-op)`,
    },
    messages: {
      sameReference: true,
      becameUpToDate: false,
      description: `Paused ignores messages (base class no-op)`,
    },
    sseClose: {
      sameReference: true,
      description: `Paused ignores SSE close (base class no-op)`,
    },
    pause: {
      sameReference: true,
      description: `Paused.pause() is idempotent (returns this)`,
    },
    error: {
      resultKind: `error`,
      description: `Paused → Error`,
    },
    markMustRefetch: {
      resultKind: `initial`,
      description: `Paused → fresh Initial`,
    },
    withHandle: {
      resultKind: `paused`,
      description: `Paused with new handle stays Paused (delegates)`,
    },
    enterReplayMode: {
      sameReference: true,
      description: `Paused cannot enter replay (base class no-op)`,
    },
  },
  error: {
    response: {
      action: `ignored`,
      sameReference: true,
      description: `Error ignores response (base class no-op)`,
    },
    messages: {
      sameReference: true,
      becameUpToDate: false,
      description: `Error ignores messages (base class no-op)`,
    },
    sseClose: {
      sameReference: true,
      description: `Error ignores SSE close (base class no-op)`,
    },
    pause: {
      resultKind: `paused`,
      description: `Error → Paused`,
    },
    error: {
      resultKind: `error`,
      description: `Error → new Error (wraps)`,
    },
    markMustRefetch: {
      resultKind: `initial`,
      description: `Error → fresh Initial`,
    },
    withHandle: {
      resultKind: `error`,
      description: `Error with new handle stays Error (delegates)`,
    },
    enterReplayMode: {
      sameReference: true,
      description: `Error cannot enter replay (base class no-op)`,
    },
  },
}
