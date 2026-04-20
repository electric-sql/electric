/**
 * Streams focus script — drives the "substrate-cutaway" vignette.
 *
 * 8 s loop. The ambient script keeps comets flowing across all four
 * channels. The focus script overlays a clear "fan-out → junction →
 * riser → surface" narrative so the viewer can track one packet from
 * channel-a, through junction-2 (mid-channel branch), up riser-4 to
 * the coordination board.
 *
 *   t = 0.0 s  spawn a slow comet on channel-a (front bus).
 *   t = 2.0 s  junction-2 pulses (the comet has reached the branch).
 *   t = 3.0 s  spawn a comet on channel-b (back bus) — fan-out feel.
 *   t = 4.0 s  riser-4 fires, ops-board-1-card-0 highlights.
 *   t = 5.5 s  spawn a fast comet on channel-d (deep feedback).
 *   t = 7.0 s  pulse the fulfilment thread (durable packets glow).
 */

import type { CropScript } from '../types'

export const STREAMS_FOCUS_SCRIPT: CropScript = {
  loopMs: 8_000,
  beats: [
    {
      at: 0,
      kind: `spawn-comet`,
      channel: `channel-a`,
      threadId: `fulfilment-9c2b`,
      speed: 0.18,
    },
    {
      at: 2_000,
      kind: `junction-pulse`,
      junction: `junction-2`,
      durationMs: 700,
    },
    {
      at: 3_000,
      kind: `spawn-comet`,
      channel: `channel-b`,
      threadId: `fulfilment-9c2b`,
      speed: 0.22,
    },
    {
      at: 4_000,
      kind: `highlight`,
      surface: `ops-board-1-card-0`,
      durationMs: 1200,
    },
    {
      at: 4_000,
      kind: `pulse-thread`,
      thread: `fulfilment-9c2b`,
      durationMs: 1200,
    },
    {
      at: 5_500,
      kind: `spawn-comet`,
      channel: `channel-d`,
      threadId: `fulfilment-9c2b`,
      speed: 0.32,
    },
    {
      at: 6_500,
      kind: `junction-pulse`,
      junction: `junction-1`,
      durationMs: 700,
    },
    {
      at: 7_000,
      kind: `pulse-thread`,
      thread: `fulfilment-9c2b`,
      durationMs: 800,
    },
    { at: 7_000, kind: `pulse-thread`, thread: `health-bg`, durationMs: 800 },
  ],
}
