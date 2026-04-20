/**
 * Per-frame state updates for the homepage isometric scene.
 *
 * Pure logic — no canvas, no DOM. Receives a `SceneState`, the current
 * crop tweaks, deltaTime in ms, and zero-or-more scripts (ambient +
 * focus). Mutates the state in place: highlights, comets, thread pulses,
 * actor walks, script cursors, junction flashes, handoff bursts,
 * connection arcs, eased filter alpha multipliers.
 */

import type {
  SceneState,
  CropScript,
  CropScripts,
  CropTweaks,
  ScriptBeat,
  ChannelId,
  Vec3,
  ActorWalk,
  CameraCrop,
  Substrate,
} from './types'
import { polylineLength } from './projection'

/** Initialise a SceneState for a fresh mount of a crop. */
export function initSceneState(scene: SceneState[`scene`]): SceneState {
  return {
    scene,
    comets: [],
    highlights: new Map(),
    threadPulses: new Map(),
    lastPulseMs: new Map(),
    scripts: {
      ambient: { t: 0, nextBeatIdx: 0 },
      focus: { t: 0, nextBeatIdx: 0 },
    },
    elapsedMs: 0,
    filter: null,
    filterAlpha: { sync: 1, streams: 1, agents: 1 },
    junctionFlashes: [],
    handoffBursts: [],
    connectionArcs: [],
    carrying: new Map(),
  }
}

/** Reset the script cursors (called when a vignette enters the viewport). */
export function resetScriptCursor(state: SceneState): void {
  state.scripts.ambient.t = 0
  state.scripts.ambient.nextBeatIdx = 0
  state.scripts.focus.t = 0
  state.scripts.focus.nextBeatIdx = 0
}

const PULSE_DEFAULT_MS = 6000
const PULSE_DURATION_MS = 1100
const COMET_DEFAULT_SPEED = 0.05 // 1/s along channel (so ~20 s end-to-end)
const FILTER_EASE_PER_S = 5 // 200 ms ease (5 / s)
const FILTER_AMP = 1.2
const FILTER_DIM = 0.15

/**
 * Advance the scene state by `dt` milliseconds. Both ambient + focus
 * scripts tick simultaneously — they share the SceneState. Focus beats
 * commandeer relevant actors during their loop window; ambient beats
 * fill the gaps.
 */
export function tickScene(
  state: SceneState,
  dt: number,
  tweaks: CropTweaks,
  crop: CameraCrop,
  scripts: CropScripts,
  reducedMotion: boolean
): void {
  state.elapsedMs += dt

  // ── Filter ease (always runs, even under reduced motion) ──────────
  easeFilterAlpha(state, dt, reducedMotion)

  if (reducedMotion) {
    // Snap dynamic motion to a stable idle and bail. Highlights tied to
    // mirror-pulse threads stay because they're tonal, not motion.
    state.comets.length = 0
    state.junctionFlashes.length = 0
    state.handoffBursts.length = 0
    state.connectionArcs.length = 0
    // Still tick thread pulses so mirror-pulse highlights stay visible
    // on a fixed cadence (5 s).
    tickThreadPulses(state, tweaks, crop, /* fixedCadence */ true)
    return
  }

  // ── Highlights decay ────────────────────────────────────────────────
  for (const [k, v] of state.highlights) {
    const next = Math.max(0, v - dt * 0.0018)
    if (next <= 0.001) state.highlights.delete(k)
    else state.highlights.set(k, next)
  }

  tickThreadPulses(state, tweaks, crop, /* fixedCadence */ false)

  // ── Ambient comet spawning on channels ─────────────────────────────
  if (tweaks.substrateFlow > 0.01) {
    const targetActive = Math.round(
      state.scene.substrate.channels.length * 1.6 * tweaks.substrateFlow
    )
    if (
      state.comets.length < targetActive &&
      Math.random() < dt * 0.0008 * tweaks.substrateFlow
    ) {
      const ch =
        state.scene.substrate.channels[
          Math.floor(Math.random() * state.scene.substrate.channels.length)
        ]
      if (ch && ch.path.length >= 2) {
        const thread = pickThreadForChannel(state, ch.id)
        state.comets.push({
          channelId: ch.id,
          threadId: thread,
          t: 0,
          speed:
            COMET_DEFAULT_SPEED *
            (0.8 + Math.random() * 0.4) *
            Math.max(tweaks.substrateFlow, 0.6),
          birthMs: state.elapsedMs,
        })
      }
    }
  }

  // ── Advance comets ─────────────────────────────────────────────────
  for (let i = state.comets.length - 1; i >= 0; i--) {
    const c = state.comets[i]
    const prevT = c.t
    c.t += c.speed * (dt / 1000)
    if (c.t >= 1) {
      state.comets.splice(i, 1)
      continue
    }
    // Fire junction flashes when the comet crosses a junction.
    fireJunctionsCrossed(state, c.channelId, prevT, c.t)
  }

  // ── Advance walking actors ─────────────────────────────────────────
  if (tweaks.courierWalk > 0.01) {
    for (const a of state.scene.actors) {
      if (!a.walking) continue
      const w = a.walking
      const len = polylineLength(w.points)
      if (len <= 0) {
        a.walking = undefined
        continue
      }
      w.t += (w.speed * tweaks.courierWalk * (dt / 1000)) / len
      if (w.t >= 1) {
        a.position = w.points[w.points.length - 1]
        a.walking = undefined
      } else {
        a.position = sampleWalk(w)
      }
    }
  }

  // ── Decay junction flashes / handoff bursts / connection arcs ─────
  decayList(state.junctionFlashes, state.elapsedMs)
  decayList(state.handoffBursts, state.elapsedMs)
  decayList(state.connectionArcs, state.elapsedMs)

  // ── Run scripts (ambient + focus, both ticking each frame) ────────
  if (scripts.ambient) tickScript(state, dt, scripts.ambient, `ambient`)
  if (scripts.focus) tickScript(state, dt, scripts.focus, `focus`)
}

function easeFilterAlpha(
  state: SceneState,
  dt: number,
  reducedMotion: boolean
): void {
  const targets: Record<Substrate, number> = {
    sync:
      state.filter == null
        ? 1
        : state.filter === `sync`
          ? FILTER_AMP
          : FILTER_DIM,
    streams:
      state.filter == null
        ? 1
        : state.filter === `streams`
          ? FILTER_AMP
          : FILTER_DIM,
    agents:
      state.filter == null
        ? 1
        : state.filter === `agents`
          ? FILTER_AMP
          : FILTER_DIM,
  }
  const k = reducedMotion ? 1 : Math.min(1, (dt / 1000) * FILTER_EASE_PER_S)
  for (const s of [`sync`, `streams`, `agents`] as Substrate[]) {
    state.filterAlpha[s] += (targets[s] - state.filterAlpha[s]) * k
  }
}

function tickThreadPulses(
  state: SceneState,
  tweaks: CropTweaks,
  crop: CameraCrop,
  fixedCadence: boolean
): void {
  const pulseEvery = fixedCadence
    ? 5000
    : (tweaks.pulseCadenceMs ?? PULSE_DEFAULT_MS)
  for (const t of state.scene.threads) {
    if (!isHighlightThread(crop, t.id)) {
      state.threadPulses.set(t.id, 0)
      continue
    }
    const last = state.lastPulseMs.get(t.id) ?? -pulseEvery
    if (
      state.elapsedMs - last >=
      pulseEvery / Math.max(tweaks.mirroredPulse, 0.001)
    ) {
      state.lastPulseMs.set(t.id, state.elapsedMs)
    }
    const sincePulse = state.elapsedMs - (state.lastPulseMs.get(t.id) ?? 0)
    let intensity = 0
    if (sincePulse < PULSE_DURATION_MS) {
      const k = sincePulse / PULSE_DURATION_MS
      intensity = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7
      intensity = Math.max(0, Math.min(1, intensity)) * tweaks.mirroredPulse
    }
    state.threadPulses.set(t.id, intensity)
  }
}

function tickScript(
  state: SceneState,
  dt: number,
  script: CropScript,
  slot: `ambient` | `focus`
): void {
  if (script.beats.length === 0) return
  const cursor = state.scripts[slot]
  cursor.t += dt
  if (cursor.t >= script.loopMs) {
    cursor.t = cursor.t % script.loopMs
    cursor.nextBeatIdx = 0
  }
  while (
    cursor.nextBeatIdx < script.beats.length &&
    script.beats[cursor.nextBeatIdx].at <= cursor.t
  ) {
    applyBeat(state, script.beats[cursor.nextBeatIdx], slot)
    cursor.nextBeatIdx++
  }
}

function fireJunctionsCrossed(
  state: SceneState,
  channelId: ChannelId,
  prevT: number,
  t: number
): void {
  const junctions = state.scene.substrate.junctions
  if (!junctions || junctions.length === 0) return
  const ch = state.scene.substrate.channels.find((c) => c.id === channelId)
  if (!ch) return
  for (const j of junctions) {
    if (!j.channels.includes(channelId)) continue
    // Compute the t along this channel that's nearest to the junction.
    // Cheap: linear scan of segments, find min squared distance projection.
    const tj = nearestTOnChannel(ch.path, j.at)
    if (tj > prevT && tj <= t) {
      state.junctionFlashes.push({
        junctionId: j.id,
        startMs: state.elapsedMs,
        durationMs: 250,
      })
    }
  }
}

function nearestTOnChannel(path: readonly Vec3[], pt: Vec3): number {
  if (path.length < 2) return 0
  let total = polylineLength(path)
  if (total === 0) return 0
  let bestT = 0
  let bestD = Infinity
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (segLen > 0) {
      const u = Math.max(
        0,
        Math.min(
          1,
          ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy + (pt[2] - a[2]) * dz) /
            (segLen * segLen)
        )
      )
      const px = a[0] + dx * u
      const py = a[1] + dy * u
      const pz = a[2] + dz * u
      const d2 = (px - pt[0]) ** 2 + (py - pt[1]) ** 2 + (pz - pt[2]) ** 2
      if (d2 < bestD) {
        bestD = d2
        bestT = (acc + u * segLen) / total
      }
    }
    acc += segLen
  }
  return bestT
}

function decayList<T extends { startMs: number; durationMs: number }>(
  list: T[],
  nowMs: number
): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (nowMs - list[i].startMs >= list[i].durationMs) list.splice(i, 1)
  }
}

function applyBeat(
  state: SceneState,
  beat: ScriptBeat,
  slot: `ambient` | `focus`
): void {
  switch (beat.kind) {
    case `highlight`:
      state.highlights.set(beat.surface, 1)
      break
    case `pulse-thread`:
      state.lastPulseMs.set(beat.thread, state.elapsedMs)
      break
    case `walk-actor`: {
      const a = state.scene.actors.find((x) => x.id === beat.actor)
      if (!a) break
      // If the slot is `ambient` and this actor is currently being
      // commandeered by an active focus walk, skip — focus wins.
      if (
        slot === `ambient` &&
        a.walking &&
        state.scripts.focus.nextBeatIdx > 0
      ) {
        // Heuristic: if focus has fired beats this loop cycle, assume
        // it owns the actor. Cheap and good enough for v2.
        break
      }
      const points: Vec3[] =
        beat.to.length > 0 ? [a.position, ...beat.to] : [a.position]
      a.walking = { points, t: 0, speed: beat.speed }
      a.position = points[0]
      break
    }
    case `wake-actor`:
      // No-op: future hook for spawning fresh actors mid-loop.
      break
    case `spawn-comet`: {
      const ch = state.scene.substrate.channels.find(
        (x) => x.id === beat.channel
      )
      if (!ch) break
      state.comets.push({
        channelId: beat.channel,
        threadId: beat.threadId,
        t: 0,
        speed: beat.speed ?? COMET_DEFAULT_SPEED * 1.4,
        birthMs: state.elapsedMs,
      })
      break
    }
    case `junction-pulse`:
      state.junctionFlashes.push({
        junctionId: beat.junction,
        startMs: state.elapsedMs,
        durationMs: beat.durationMs ?? 250,
      })
      break
    case `handoff-burst`:
      state.handoffBursts.push({
        at: beat.at3,
        startMs: state.elapsedMs,
        durationMs: beat.durationMs ?? 600,
      })
      break
    case `card-shuffle`:
      // Symbolic: bump the highlight on a sentinel surface so the renderer
      // can pick up the visual cue; the actual row swap is omitted to keep
      // the scene constant immutable.
      state.highlights.set(
        `__shuffle__:${beat.board}:${beat.from}->${beat.to}`,
        1
      )
      break
    case `screen-blip`:
      state.highlights.set(
        beat.surface,
        Math.max(state.highlights.get(beat.surface) ?? 0, 0.4)
      )
      break
    case `speaking-turn`:
      for (const p of beat.people) {
        state.highlights.set(`__person__:${p}`, 1)
      }
      break
    case `pickup`: {
      state.highlights.set(beat.from, 1)
      const a = state.scene.actors.find((x) => x.id === beat.actor)
      if (a) state.carrying.set(a.id, beat.thread)
      // Coral particle burst at the actor's current position.
      if (a) {
        state.handoffBursts.push({
          at: a.position,
          startMs: state.elapsedMs,
          durationMs: 600,
        })
      }
      break
    }
    case `drop`: {
      const a = state.scene.actors.find((x) => x.id === beat.actor)
      if (
        typeof beat.into === `string` &&
        state.scene.substrate.channels.find((c) => c.id === beat.into)
      ) {
        state.comets.push({
          channelId: beat.into as ChannelId,
          threadId: state.carrying.get(beat.actor) ?? `__script__`,
          t: 0,
          speed: COMET_DEFAULT_SPEED * 1.4,
          birthMs: state.elapsedMs,
        })
      } else {
        state.highlights.set(beat.into, 1)
      }
      if (a) {
        state.handoffBursts.push({
          at: a.position,
          startMs: state.elapsedMs,
          durationMs: 600,
        })
        state.carrying.delete(a.id)
      }
      break
    }
  }
}

function sampleWalk(w: ActorWalk): Vec3 {
  const total = polylineLength(w.points)
  if (total === 0) return w.points[0]
  let target = Math.max(0, Math.min(1, w.t)) * total
  for (let i = 1; i < w.points.length; i++) {
    const a = w.points[i - 1]
    const b = w.points[i]
    const seg = Math.sqrt(
      (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    )
    if (target <= seg) {
      const k = seg === 0 ? 0 : target / seg
      return [
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k,
        a[2] + (b[2] - a[2]) * k,
      ]
    }
    target -= seg
  }
  return w.points[w.points.length - 1]
}

function pickThreadForChannel(state: SceneState, channelId: ChannelId): string {
  void channelId
  if (state.scene.threads.length === 0) return `__ambient__`
  return state.scene.threads[
    Math.floor(Math.random() * state.scene.threads.length)
  ].id
}

function isHighlightThread(crop: CameraCrop, threadId: string): boolean {
  if (!crop.highlightThreads || crop.highlightThreads.length === 0) return true
  return crop.highlightThreads.includes(threadId)
}
