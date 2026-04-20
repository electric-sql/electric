/**
 * Ambient script — eight concurrent threads on coprime cadences.
 *
 * The plan's threads have cadences (in seconds): 2, 3, 5, 7, 11, 13, 17,
 * 19. The true LCM is ~112 days; we don't loop the script that long.
 * Instead we pick a 60 s super-loop and let each thread fire at its own
 * cadence within that window. After 60 s the cursor resets — visually
 * indistinguishable from a much longer loop because (a) thread events
 * are short bursts not continuous motion, and (b) the camera doesn't
 * move so the eye doesn't "remember" the exact frame.
 *
 * Beats are generated programmatically rather than authored by hand
 * because 8 threads × 60 s = ~120 beats and we want the cadences exact.
 */

import type { CropScript, ScriptBeat, ThreadId } from '../types'

const SUPER_LOOP_MS = 60_000

interface ThreadProgram {
  id: ThreadId
  cadenceMs: number
  /** Beats fired at thread cadence. `at` is *relative* to the cadence
   *  start (0 = start of this thread tick). */
  cycle: ScriptBeat[]
}

const PROGRAMS: ThreadProgram[] = [
  // ── Sync threads — surface mirror pulses ─────────────────────────
  {
    id: `escalation-1f6a`,
    cadenceMs: 5_000,
    cycle: [
      { at: 0, kind: `highlight`, surface: `fh-screen-1`, durationMs: 1100 },
      {
        at: 200,
        kind: `highlight`,
        surface: `ops-board-1-card-0`,
        durationMs: 1100,
      },
      { at: 400, kind: `highlight`, surface: `rv-screen`, durationMs: 1100 },
      {
        at: 0,
        kind: `pulse-thread`,
        thread: `escalation-1f6a`,
        durationMs: 1100,
      },
    ],
  },
  {
    id: `audit-7e1`,
    cadenceMs: 13_000,
    cycle: [
      { at: 0, kind: `highlight`, surface: `fh-screen-2`, durationMs: 1100 },
      { at: 250, kind: `highlight`, surface: `rv-screen`, durationMs: 1100 },
      {
        at: 500,
        kind: `highlight`,
        surface: `meeting-screen`,
        durationMs: 1100,
      },
      { at: 750, kind: `highlight`, surface: `plan-cell-3`, durationMs: 1100 },
      { at: 0, kind: `pulse-thread`, thread: `audit-7e1`, durationMs: 1200 },
    ],
  },
  {
    id: `meeting-4f8`,
    cadenceMs: 17_000,
    cycle: [
      {
        at: 0,
        kind: `speaking-turn`,
        people: [`human-meet-1`, `human-meet-2`, `human-meet-3`],
        durationMs: 1400,
      },
      {
        at: 1500,
        kind: `highlight`,
        surface: `meeting-screen`,
        durationMs: 1100,
      },
      { at: 1700, kind: `highlight`, surface: `plan-cell-5`, durationMs: 1100 },
      { at: 0, kind: `pulse-thread`, thread: `meeting-4f8`, durationMs: 1500 },
    ],
  },
  // ── Streams threads — comet flow ─────────────────────────────────
  {
    id: `fulfilment-9c2b`,
    cadenceMs: 7_000,
    cycle: [
      {
        at: 0,
        kind: `spawn-comet`,
        channel: `channel-a`,
        threadId: `fulfilment-9c2b`,
        speed: 0.18,
      },
      {
        at: 0,
        kind: `pulse-thread`,
        thread: `fulfilment-9c2b`,
        durationMs: 1100,
      },
    ],
  },
  {
    id: `notify-5d8`,
    cadenceMs: 3_000,
    cycle: [
      {
        at: 0,
        kind: `spawn-comet`,
        channel: `channel-b`,
        threadId: `notify-5d8`,
        speed: 0.32,
      },
    ],
  },
  {
    id: `health-bg`,
    cadenceMs: 2_000,
    cycle: [
      {
        at: 0,
        kind: `spawn-comet`,
        channel: `channel-d`,
        threadId: `health-bg`,
        speed: 0.12,
      },
    ],
  },
  // ── Agents thread — analyst shuttles between planning wall and rv-desk
  {
    id: `enrich-ab3`,
    cadenceMs: 11_000,
    cycle: [
      {
        at: 0,
        kind: `walk-actor`,
        actor: `analyst-1`,
        to: [
          [11.4, 2.5, 0],
          [11.4, 3.4, 0],
          [11.4, 3.85, 0],
        ],
        speed: 1.0,
      },
      {
        at: 4_000,
        kind: `highlight`,
        surface: `rv-screen`,
        durationMs: 1100,
      },
      {
        at: 4_500,
        kind: `walk-actor`,
        actor: `analyst-1`,
        to: [
          [11.4, 3.85, 0],
          [11.4, 2.5, 0],
        ],
        speed: 1.0,
      },
      { at: 0, kind: `pulse-thread`, thread: `enrich-ab3`, durationMs: 1100 },
    ],
  },
  // ── Dispatch courier — comms-room → workshop ─────────────────────
  {
    id: `dispatch-2c4`,
    cadenceMs: 19_000,
    cycle: [
      {
        at: 0,
        kind: `walk-actor`,
        actor: `courier-2`,
        to: [
          [9.0, 5.5, 0],
          [11.0, 5.5, 0],
          [13.5, 5.5, 0],
          [13.95, 3.3, 0],
        ],
        speed: 1.4,
      },
      {
        at: 3_500,
        kind: `pickup`,
        actor: `courier-2`,
        from: `dispatch-screen`,
        thread: `dispatch-2c4`,
      },
      {
        at: 6_000,
        kind: `drop`,
        actor: `courier-2`,
        into: `ff-screen-2`,
      },
      {
        at: 6_500,
        kind: `walk-actor`,
        actor: `courier-2`,
        to: [
          [13.95, 3.3, 0],
          [13.5, 5.5, 0],
          [11.0, 5.5, 0],
          [9.0, 5.5, 0],
        ],
        speed: 1.4,
      },
      { at: 0, kind: `pulse-thread`, thread: `dispatch-2c4`, durationMs: 1200 },
    ],
  },
]

/**
 * Build the super-loop ambient script by exploding each thread's cycle
 * across the SUPER_LOOP window at the thread's cadence.
 *
 * Also adds:
 *  - Sweeper perimeter walk (30 s).
 *  - Inspector tick / pause / tick (8 s + offset on the second).
 *  - Maintenance actor on the roof (30 s).
 *  - Card-shuffle on ops boards every ~14 s.
 *  - Random screen-blip noise across the FH screens.
 */
function buildAmbientBeats(): ScriptBeat[] {
  const beats: ScriptBeat[] = []

  for (const p of PROGRAMS) {
    let phase = 0
    while (phase < SUPER_LOOP_MS) {
      for (const b of p.cycle) {
        const at = phase + b.at
        if (at >= SUPER_LOOP_MS) continue
        beats.push({ ...b, at } as ScriptBeat)
      }
      phase += p.cadenceMs
    }
  }

  // Inspector-1 tick / pause / tick on 8 s cadence — at ops-board-1
  // (coordination zone, around x ≈ 4.4, y ≈ 1.5).
  for (let t = 0; t < SUPER_LOOP_MS; t += 8_000) {
    beats.push({
      at: t,
      kind: `walk-actor`,
      actor: `inspector-1`,
      to: [
        [4.4, 1.5, 0],
        [4.4, 1.2, 0],
      ],
      speed: 0.5,
    })
    beats.push({
      at: t + 1500,
      kind: `highlight`,
      surface: `ops-board-1-card-0`,
      durationMs: 800,
    })
    beats.push({
      at: t + 3000,
      kind: `walk-actor`,
      actor: `inspector-1`,
      to: [
        [4.4, 1.2, 0],
        [4.4, 1.5, 0],
      ],
      speed: 0.5,
    })
  }
  // Inspector-2 — same cadence, 4 s offset, on board 2.
  for (let t = 4_000; t < SUPER_LOOP_MS; t += 8_000) {
    beats.push({
      at: t,
      kind: `walk-actor`,
      actor: `inspector-2`,
      to: [
        [6.4, 1.5, 0],
        [6.4, 1.2, 0],
      ],
      speed: 0.5,
    })
    beats.push({
      at: t + 1500,
      kind: `highlight`,
      surface: `ops-board-2-card-0`,
      durationMs: 800,
    })
  }

  // Sweeper perimeter walk along the back archive aisle (30 s loop).
  for (let t = 0; t < SUPER_LOOP_MS; t += 30_000) {
    beats.push({
      at: t,
      kind: `walk-actor`,
      actor: `sweeper-1`,
      to: [
        [13.95, 4.5, 0],
        [13.95, 5.5, 0],
        [13.95, 6.5, 0],
        [13.95, 5.5, 0],
        [13.95, 4.5, 0],
      ],
      speed: 0.5,
    })
  }

  // Maintenance pacing the comms-room aisle (30 s loop).
  for (let t = 5_000; t < SUPER_LOOP_MS; t += 30_000) {
    beats.push({
      at: t,
      kind: `walk-actor`,
      actor: `maintenance-1`,
      to: [
        [13.95, 0.8, 0],
        [13.95, 2.6, 0],
        [13.95, 0.8, 0],
      ],
      speed: 0.6,
    })
  }

  // Card-shuffle on ops boards every ~14 s.
  for (let t = 7_000; t < SUPER_LOOP_MS; t += 14_000) {
    beats.push({
      at: t,
      kind: `card-shuffle`,
      board: `ops-board-1`,
      from: 0,
      to: 1,
    })
  }

  // Screen-blips — random ambient liveness on FH screens. Pre-baked
  // pseudo-random schedule so the script is deterministic.
  const blipSurfaces = [
    `fh-screen-1`,
    `fh-screen-2`,
    `fh-screen-3`,
    `dispatch-screen`,
    `ff-screen-1`,
    `ff-screen-2`,
    `rv-screen`,
  ]
  for (let t = 600; t < SUPER_LOOP_MS; t += 1100) {
    const idx = Math.floor((t * 1103) % blipSurfaces.length)
    beats.push({ at: t, kind: `screen-blip`, surface: blipSurfaces[idx] })
  }

  beats.sort((a, b) => a.at - b.at)
  return beats
}

export const AMBIENT_SCRIPT: CropScript = {
  loopMs: SUPER_LOOP_MS,
  beats: buildAmbientBeats(),
}
