/**
 * Sync focus script — drives the "mirrored-surfaces" vignette.
 *
 * 6 s loop. The ambient script handles low-cadence pulses on all 8
 * threads. The focus script tells one *propagation* story per loop:
 * one thread fires, every surface in `manifestations` lights up in
 * sequence with a 250 ms delay so the eye reads it as broadcast.
 *
 *   loop A (0..3 s):    escalation thread → fh-screen-1, ops-board,
 *                       rv-screen.
 *   loop B (3..6 s):    audit thread → fh-screen-2, rv-screen,
 *                       meeting-screen, plan-cell-3.
 */

import type { CropScript } from '../types'

export const SYNC_FOCUS_SCRIPT: CropScript = {
  loopMs: 6_000,
  beats: [
    // Loop A — escalation broadcast.
    {
      at: 0,
      kind: `pulse-thread`,
      thread: `escalation-1f6a`,
      durationMs: 1300,
    },
    { at: 0, kind: `highlight`, surface: `fh-screen-1`, durationMs: 1300 },
    {
      at: 250,
      kind: `highlight`,
      surface: `ops-board-1-card-0`,
      durationMs: 1300,
    },
    { at: 500, kind: `highlight`, surface: `rv-screen`, durationMs: 1300 },

    // Loop B — audit broadcast (slightly larger fan-out).
    { at: 3_000, kind: `pulse-thread`, thread: `audit-7e1`, durationMs: 1500 },
    { at: 3_000, kind: `highlight`, surface: `fh-screen-2`, durationMs: 1300 },
    { at: 3_250, kind: `highlight`, surface: `rv-screen`, durationMs: 1300 },
    {
      at: 3_500,
      kind: `highlight`,
      surface: `meeting-screen`,
      durationMs: 1300,
    },
    { at: 3_750, kind: `highlight`, surface: `plan-cell-3`, durationMs: 1300 },
  ],
}
