/**
 * Agents focus script — drives the "coordination-floor" vignette.
 *
 * 8 s loop, four headline beats. The ambient script keeps running
 * underneath; this script *commandeers* `courier-1` and `inspector-1`
 * for a tightly-timed handoff narrative across the campus floor.
 *
 * On the single-floor campus, the choreography reads as a horizontal
 * sweep:
 *
 *   t = 0.0 s  inspector-1 steps up to ops-board-1 (coordination zone).
 *   t = 1.0 s  card-0 highlights, handoff burst at the board, courier
 *              picks up the escalation.
 *   t = 2.5 s  courier-1 walks across — coordination → reception desks.
 *   t = 5.0 s  drops into channel-a (front bus), fh-screen-1 lights,
 *              escalation thread pulses, comet flies along channel-a.
 */

import type { CropScript } from '../types'

export const AGENTS_FOCUS_SCRIPT: CropScript = {
  loopMs: 8_000,
  beats: [
    {
      at: 0,
      kind: `walk-actor`,
      actor: `inspector-1`,
      to: [
        [4.4, 1.5, 0],
        [4.4, 1.0, 0],
      ],
      speed: 0.6,
    },
    {
      at: 1_000,
      kind: `highlight`,
      surface: `ops-board-1-card-0`,
      durationMs: 1500,
    },
    { at: 1_000, kind: `handoff-burst`, at3: [4.4, 1.0, 0.3], durationMs: 900 },
    {
      at: 1_200,
      kind: `pickup`,
      actor: `courier-1`,
      from: `ops-board-1-card-0`,
      thread: `escalation-1f6a`,
    },
    // Walk: from courier-1 home (4.5, 5.5) up to the board, then across
    // to the reception desk row.
    {
      at: 2_500,
      kind: `walk-actor`,
      actor: `courier-1`,
      to: [
        [4.5, 5.5, 0],
        [4.5, 4.5, 0],
        [3.0, 4.5, 0],
        [1.0, 4.5, 0],
        [0.6, 4.85, 0],
      ],
      speed: 1.5,
    },
    {
      at: 5_000,
      kind: `drop`,
      actor: `courier-1`,
      into: `channel-a`,
    },
    { at: 5_000, kind: `highlight`, surface: `fh-screen-1`, durationMs: 1300 },
    {
      at: 5_000,
      kind: `pulse-thread`,
      thread: `escalation-1f6a`,
      durationMs: 1300,
    },
    {
      at: 5_200,
      kind: `spawn-comet`,
      channel: `channel-a`,
      threadId: `escalation-1f6a`,
      speed: 0.32,
    },
    // Return to home base on channel-a substrate.
    {
      at: 5_500,
      kind: `walk-actor`,
      actor: `courier-1`,
      to: [
        [0.6, 4.85, 0],
        [3.0, 5.5, 0],
        [4.5, 5.5, 0],
      ],
      speed: 1.4,
    },
  ],
}
