/**
 * Canvas drawing routines for the homepage isometric scene (v2).
 *
 * One `drawScene()` entry point per frame. Internally it builds a flat
 * list of "draw commands" and z-sorts them (painter's algorithm). Each
 * command knows its own substrate tag and applies the eased filter
 * alpha multiplier from `state.filterAlpha`.
 *
 * Element-kind colour model:
 *  - Substrate (channels, comets, packets, junctions, risers, portals)
 *    → violet (`accent('streams')`)
 *  - Actors (couriers, inspectors, analysts, sweepers) → coral
 *    (`accent('agents')`)
 *  - Surface pulses (mirror highlights), connection arcs between
 *    mirrored surfaces → teal (`accent('sync')`)
 *  - Building shell, plain desks, plain humans, lamps, plants, sidewalk
 *    → neutral mono (`neutral()`)
 *
 * Style heritage: hairline 1 css px aesthetic. Lines are 1.4 css px for
 * "hot" elements. Theme-aware via CSS custom properties.
 */

import {
  ISO_SIN,
  projectXY,
  fadeForPoint,
  polylineLength,
  samplePolyline,
} from './projection'
import { accent, neutral as neutralColor, resetPaletteCache } from './palette'
import type {
  ActiveComet,
  Building,
  ProjectorOpts,
  RenderOptions,
  Vec3,
  Zone,
  Furniture,
  Channel,
  Junction,
  Riser,
  Skybridge,
  Sidewalk,
  Pedestrian,
  Substrate,
  Actor,
  ActorKind,
  Thread,
  ExcludeRect,
  ConnectionArc,
  HandoffBurst,
  JunctionFlash,
  UndergroundProp,
  OutdoorProp,
} from './types'

// ── Public entry point ────────────────────────────────────────────────

export function drawScene(opts: RenderOptions, proj: ProjectorOpts): void {
  const { ctx, width, height, exclusions } = opts

  // Refresh the palette cache once per frame so theme switches work.
  resetPaletteCache(opts.dark)

  ctx.clearRect(0, 0, width, height)
  // Background fade intentionally omitted — the canvas composes onto the
  // page background.

  const cmds: DrawCmd[] = []
  collectScene(cmds, opts, proj)
  cmds.sort((a, b) => a.depth - b.depth)
  for (const cmd of cmds) {
    cmd.draw(ctx, opts, proj)
  }

  if (exclusions && exclusions.length > 0) {
    fadeExclusionZones(ctx, exclusions, opts.dark)
  }
}

// ── Draw command queue ───────────────────────────────────────────────

interface DrawCmd {
  depth: number
  draw: (
    ctx: CanvasRenderingContext2D,
    opts: RenderOptions,
    proj: ProjectorOpts
  ) => void
}

function collectScene(
  cmds: DrawCmd[],
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const { state } = opts
  const scene = state.scene

  // Underground server-rack silhouettes (deepest, drawn first by depth).
  if (scene.substrate.underground) {
    for (const u of scene.substrate.underground)
      queueUnderground(cmds, u, opts, proj)
  }

  // Substrate channels.
  for (const ch of scene.substrate.channels) queueChannel(cmds, ch, opts, proj)
  // Junctions.
  if (scene.substrate.junctions) {
    for (const j of scene.substrate.junctions)
      queueJunction(cmds, j, opts, proj)
  }
  // Risers.
  if (scene.substrate.risers) {
    for (const r of scene.substrate.risers) queueRiser(cmds, r, opts, proj)
  }
  // Active comets on top of channels.
  for (const c of state.comets) queueComet(cmds, c, opts, proj)

  // Sidewalk + outdoor props.
  if (scene.sidewalk) queueSidewalk(cmds, scene.sidewalk, opts, proj)
  if (scene.outdoor) {
    for (const p of scene.outdoor) queueOutdoorProp(cmds, p, opts, proj)
  }

  // Pedestrians (outdoor).
  if (scene.pedestrians) {
    for (const p of scene.pedestrians) queuePedestrian(cmds, p, opts, proj)
  }

  // Buildings, floors, zones, furniture.
  for (const b of scene.buildings) queueBuilding(cmds, b, opts, proj)

  // Skybridges (between buildings).
  if (scene.skybridges) {
    for (const sb of scene.skybridges) queueSkybridge(cmds, sb, opts, proj)
  }

  // Actors (drawn from their dynamic positions).
  if (opts.tweaks.courierWalk > 0) {
    for (const a of scene.actors) queueActor(cmds, a, opts, proj)
  }

  // Connection arcs (drawn last so they overlay).
  for (const arc of state.connectionArcs)
    queueConnectionArc(cmds, arc, opts, proj)
  // Handoff bursts.
  for (const hb of state.handoffBursts) queueHandoffBurst(cmds, hb, opts, proj)
}

// ── Filter helpers ───────────────────────────────────────────────────

/** Multiplier from the eased filter for a given element substrate tag. */
function filterMul(opts: RenderOptions, sub: Substrate | undefined): number {
  if (!sub) return 1 // neutral elements unaffected
  const v = opts.state.filterAlpha[sub]
  return Math.max(0, Math.min(1, v))
}

/** Returns 1.4 if the element is being amplified by the filter, else 1. */
function lineWeight(opts: RenderOptions, sub: Substrate | undefined): number {
  if (!sub) return 1
  return opts.state.filterAlpha[sub] > 1.05 ? 1.4 : 1
}

// ── Exclusion-zone dimming (text occlusion) ──────────────────────────

function fadeExclusionZones(
  ctx: CanvasRenderingContext2D,
  zones: ExcludeRect[],
  dark: boolean
): void {
  ctx.save()
  ctx.globalCompositeOperation = `destination-out`
  const margin = 6
  for (const z of zones) {
    const w = z.right - z.left + margin * 2
    const h = z.bottom - z.top + margin * 2
    const x = z.left - margin
    const y = z.top - margin
    const grd = ctx.createRadialGradient(
      x + w / 2,
      y + h / 2,
      Math.min(w, h) * 0.15,
      x + w / 2,
      y + h / 2,
      Math.max(w, h) * 0.85
    )
    grd.addColorStop(0, `rgba(0,0,0,0.85)`)
    grd.addColorStop(1, `rgba(0,0,0,0)`)
    ctx.fillStyle = grd
    ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
  void dark
}

// ── Building shell, floors, zones, furniture ─────────────────────────

function queueBuilding(
  cmds: DrawCmd[],
  b: Building,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [bx, by, bz] = b.origin
  const [sx, sy, sz] = b.size

  // Each floor is at a stacked z position.
  let floorZ = bz
  for (let fi = 0; fi < b.floors.length; fi++) {
    const f = b.floors[fi]
    if (!b.roof) {
      queueFloorRect(cmds, [bx, by, floorZ], [sx, sy], opts, proj)
    }
    for (const zone of f.zones) {
      const zoneOrigin: Vec3 = [
        bx + zone.origin[0],
        by + zone.origin[1],
        floorZ + zone.origin[2],
      ]
      queueZone(cmds, zone, zoneOrigin, opts, proj)
    }
    floorZ += f.height
  }

  queueShell(cmds, b.origin, [sx, sy, sz], opts, proj)
}

function queueFloorRect(
  cmds: DrawCmd[],
  origin: Vec3,
  size: readonly [number, number],
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = origin
  const [dx, dy] = size
  const corners: Vec3[] = [
    [x, y, z],
    [x + dx, y, z],
    [x + dx, y + dy, z],
    [x, y + dy, z],
  ]
  cmds.push({
    depth: x + y - z - 0.001,
    draw: (ctx) => {
      ctx.lineWidth = 1
      ctx.strokeStyle = neutralColor(opts.dark, 0.1)
      drawIsoPolygon(ctx, corners, proj, false)
    },
  })
}

function queueShell(
  cmds: DrawCmd[],
  origin: Vec3,
  size: Vec3,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = origin
  const [dx, dy, dz] = size
  const edges: [Vec3, Vec3][] = [
    [
      [x, y, z],
      [x, y, z + dz],
    ],
    [
      [x + dx, y, z],
      [x + dx, y, z + dz],
    ],
    [
      [x, y + dy, z],
      [x, y + dy, z + dz],
    ],
    [
      [x + dx, y + dy, z],
      [x + dx, y + dy, z + dz],
    ],
    [
      [x, y, z + dz],
      [x + dx, y, z + dz],
    ],
    [
      [x, y, z + dz],
      [x, y + dy, z + dz],
    ],
    [
      [x, y, z],
      [x + dx, y, z],
    ],
    [
      [x, y, z],
      [x, y + dy, z],
    ],
  ]
  for (const [a, b] of edges) {
    const mid = midpoint(a, b)
    cmds.push({
      depth: mid[0] + mid[1] - mid[2],
      draw: (ctx) => {
        ctx.lineWidth = 1
        ctx.strokeStyle = neutralColor(opts.dark, 0.13)
        const pa = projectXY(a, proj)
        const pb = projectXY(b, proj)
        const fa = fadeForPoint(a, proj.bounds, proj.fadeMargin)
        const fb = fadeForPoint(b, proj.bounds, proj.fadeMargin)
        const fade = (fa + fb) * 0.5
        if (fade < 0.01) return
        ctx.globalAlpha = fade
        ctx.beginPath()
        ctx.moveTo(pa.sx, pa.sy)
        ctx.lineTo(pb.sx, pb.sy)
        ctx.stroke()
        ctx.globalAlpha = 1
      },
    })
  }
}

function queueZone(
  cmds: DrawCmd[],
  zone: Zone,
  origin: Vec3,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = origin
  const [dx, dy] = zone.size
  const corners: Vec3[] = [
    [x, y, z],
    [x + dx, y, z],
    [x + dx, y + dy, z],
    [x, y + dy, z],
  ]
  cmds.push({
    depth: x + y - z - 0.0005,
    draw: (ctx) => {
      ctx.save()
      ctx.lineWidth = 1
      ctx.setLineDash([2, 4])
      ctx.strokeStyle = neutralColor(opts.dark, 0.12)
      drawIsoPolygon(ctx, corners, proj, false)
      ctx.setLineDash([])
      ctx.restore()
    },
  })

  for (const f of zone.furniture) {
    queueFurniture(cmds, f, origin, opts, proj)
  }
}

function queueFurniture(
  cmds: DrawCmd[],
  f: Furniture,
  origin: Vec3,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const at: Vec3 = [
    origin[0] + f.at[0],
    origin[1] + f.at[1],
    origin[2] + f.at[2],
  ]
  switch (f.kind) {
    case `desk`:
      queueDesk(cmds, at, f.facing, opts, proj)
      break
    case `table`:
      queueTable(cmds, at, f.size ?? [1.2, 1.2], opts, proj)
      break
    case `chair`:
      queueChair(cmds, at, f.facing, opts, proj)
      break
    case `counter`:
      queueCounter(cmds, at, f.size ?? [1.6, 0.5], opts, proj)
      break
    case `screen`:
      queueScreen(cmds, at, f, opts, proj)
      break
    case `board`:
      queueBoard(cmds, at, f, opts, proj)
      break
    case `wall-grid`:
      queueWallGrid(cmds, at, f, opts, proj)
      break
    case `person`:
      queuePerson(cmds, at, f, opts, proj)
      break
    case `lamp`:
      queueLamp(cmds, at, opts, proj)
      break
    case `plant`:
      queuePlant(cmds, at, opts, proj)
      break
    case `cooler`:
      queueCooler(cmds, at, opts, proj)
      break
    case `door-arc`:
      queueDoorArc(cmds, at, f.facing, f.radius ?? 0.6, opts, proj)
      break
  }
}

function queueDesk(
  cmds: DrawCmd[],
  at: Vec3,
  facing: number,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  // Slightly smaller than 1×0.5 so reception desks at 0.9-unit centres
  // don't overlap (was 1.0 long → 0.1 of overlap per pair).
  const long = 0.8
  const short = 0.45
  const h = 0.4
  let dx = long,
    dy = short
  if (facing === 90 || facing === 270) {
    dx = short
    dy = long
  }
  queueBox(cmds, [x - dx / 2, y - dy / 2, z], [dx, dy, h], opts, proj, {
    edge: 0.3,
  })
}

function queueTable(
  cmds: DrawCmd[],
  at: Vec3,
  size: readonly [number, number],
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  const [dx, dy] = size
  queueBox(cmds, [x - dx / 2, y - dy / 2, z], [dx, dy, 0.4], opts, proj, {
    edge: 0.28,
  })
}

function queueChair(
  cmds: DrawCmd[],
  at: Vec3,
  facing: number,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  const w = 0.35
  queueBox(cmds, [x - w / 2, y - w / 2, z], [w, w, 0.45], opts, proj, {
    edge: 0.22,
  })
  void facing
}

function queueCounter(
  cmds: DrawCmd[],
  at: Vec3,
  size: readonly [number, number],
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  const [dx, dy] = size
  queueBox(cmds, [x - dx / 2, y - dy / 2, z], [dx, dy, 0.6], opts, proj, {
    edge: 0.3,
  })
}

function queueScreen(
  cmds: DrawCmd[],
  at: Vec3,
  f: Extract<Furniture, { kind: `screen` }>,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  const w = f.w ?? 0.7
  const h = f.h ?? 0.5
  // Screen as a flat panel — its front face runs along ONE principal
  // axis (x or y) with zero extent on the other. This guarantees the
  // four corners are coplanar and project to a true rectangle (not the
  // diagonal parallelogram you get from a thin-slab corner walk).
  let ax = w,
    ay = 0
  if (f.facing === 90 || f.facing === 270) {
    ax = 0
    ay = w
  }
  const hl = opts.state.highlights.get(f.surface) ?? 0
  const isHover = opts.hoveredSurface === f.surface
  const threadGlow = threadGlowForSurface(
    opts.state.scene.threads,
    f.surface,
    opts.state.threadPulses
  )
  const intensity = Math.max(hl, threadGlow, isHover ? 0.6 : 0)

  const corners: Vec3[] = [
    [x - ax / 2, y - ay / 2, z],
    [x + ax / 2, y + ay / 2, z],
    [x + ax / 2, y + ay / 2, z + h],
    [x - ax / 2, y - ay / 2, z + h],
  ]
  cmds.push({
    depth: x + y - (z + h / 2),
    draw: (ctx) => {
      const fade = avgFade(corners, proj)
      if (fade < 0.01) return
      // Surfaces are sync elements *only when actively glowing*. When idle,
      // they're a neutral scaffold. Filter mul applies to the glow/colour
      // strength accordingly.
      const syncMul = filterMul(opts, intensity > 0.05 ? `sync` : undefined)
      ctx.globalAlpha = fade
      ctx.fillStyle = surfaceFill(opts.dark, intensity * syncMul)
      drawIsoPolygon(ctx, corners, proj, true)
      ctx.fill()
      ctx.lineWidth = intensity * syncMul > 0.05 ? 1.4 : 1
      ctx.strokeStyle = surfaceStroke(opts.dark, intensity * syncMul)
      drawIsoPolygon(ctx, corners, proj, false)
      if (intensity * syncMul > 0.05) {
        const inset = 0.12
        const card: Vec3[] = [
          interp3(corners[0], corners[1], inset),
          interp3(corners[1], corners[0], inset),
          interp3(corners[2], corners[3], inset),
          interp3(corners[3], corners[2], inset),
        ]
        ctx.fillStyle = accent(
          opts.dark,
          `sync`,
          (0.22 + intensity * 0.6) * syncMul
        )
        drawIsoPolygon(ctx, card, proj, true)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    },
  })
}

function queueBoard(
  cmds: DrawCmd[],
  at: Vec3,
  f: Extract<Furniture, { kind: `board` }>,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  const cols = f.cols ?? 1
  const w = cols > 1 ? 1.6 : 1.2
  const h = 0.9
  // Flat panel — see the queueScreen comment above.
  let ax = w,
    ay = 0
  if (f.facing === 90 || f.facing === 270) {
    ax = 0
    ay = w
  }
  const corners: Vec3[] = [
    [x - ax / 2, y - ay / 2, z],
    [x + ax / 2, y + ay / 2, z],
    [x + ax / 2, y + ay / 2, z + h],
    [x - ax / 2, y - ay / 2, z + h],
  ]
  cmds.push({
    depth: x + y - (z + h / 2),
    draw: (ctx) => {
      const fade = avgFade(corners, proj)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      ctx.fillStyle = surfaceFill(opts.dark, 0)
      drawIsoPolygon(ctx, corners, proj, true)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = neutralColor(opts.dark, 0.22)
      drawIsoPolygon(ctx, corners, proj, false)

      const rows = Math.max(1, ...f.cards.map((c) => c.row + 1))
      const rowH = h / Math.max(rows, 4)
      const cardInset = 0.06
      const colW = 1 / Math.max(cols, 1)
      for (const c of f.cards) {
        const hl = opts.state.highlights.get(c.surface) ?? 0
        const isHover = opts.hoveredSurface === c.surface
        const threadGlow = threadGlowForSurface(
          opts.state.scene.threads,
          c.surface,
          opts.state.threadPulses
        )
        const intensity = Math.max(hl, threadGlow, isHover ? 0.6 : 0)
        const syncMul = filterMul(opts, intensity > 0.05 ? `sync` : undefined)
        const zMin = z + h - (c.row + 1) * rowH + rowH * 0.1
        const zMax = zMin + rowH * 0.8
        // Column slot.
        const col = c.col ?? 0
        const colMin = col * colW
        const colMax = (col + 1) * colW
        // Cards live on the panel's flat front face.
        let cardCorners: Vec3[]
        if (f.facing === 90 || f.facing === 270) {
          // ay is the wide axis; ax is zero.
          const yA = y - ay / 2 + ay * colMin + cardInset
          const yB = y - ay / 2 + ay * colMax - cardInset
          cardCorners = [
            [x, yA, zMin],
            [x, yB, zMin],
            [x, yB, zMax],
            [x, yA, zMax],
          ]
        } else {
          const xA = x - ax / 2 + ax * colMin + cardInset
          const xB = x - ax / 2 + ax * colMax - cardInset
          cardCorners = [
            [xA, y, zMin],
            [xB, y, zMin],
            [xB, y, zMax],
            [xA, y, zMax],
          ]
        }
        ctx.fillStyle = surfaceFill(opts.dark, intensity * syncMul)
        drawIsoPolygon(ctx, cardCorners, proj, true)
        ctx.fill()
        ctx.lineWidth = intensity * syncMul > 0.05 ? 1.2 : 1
        ctx.strokeStyle = surfaceStroke(opts.dark, intensity * syncMul)
        drawIsoPolygon(ctx, cardCorners, proj, false)
      }
      ctx.globalAlpha = 1
    },
  })
}

function queueWallGrid(
  cmds: DrawCmd[],
  at: Vec3,
  f: Extract<Furniture, { kind: `wall-grid` }>,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  // Flat panel along one principal axis. See queueScreen comment.
  let ax = f.w,
    ay = 0
  if (f.facing === 90 || f.facing === 270) {
    ax = 0
    ay = f.w
  }
  const corners: Vec3[] = [
    [x - ax / 2, y - ay / 2, z],
    [x + ax / 2, y + ay / 2, z],
    [x + ax / 2, y + ay / 2, z + f.h],
    [x - ax / 2, y - ay / 2, z + f.h],
  ]
  cmds.push({
    depth: x + y - (z + f.h / 2),
    draw: (ctx) => {
      const fade = avgFade(corners, proj)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      // Backplate.
      ctx.fillStyle = surfaceFill(opts.dark, 0)
      drawIsoPolygon(ctx, corners, proj, true)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = neutralColor(opts.dark, 0.22)
      drawIsoPolygon(ctx, corners, proj, false)

      // Cell grid.
      const cellW = f.w / f.cols
      const cellH = f.h / f.rows
      const inset = 0.06
      const blipPhase = (opts.state.elapsedMs / 4000) % 1
      for (let r = 0; r < f.rows; r++) {
        for (let c = 0; c < f.cols; c++) {
          const surface = f.addressable.find(
            (a) => a.row === r && a.col === c
          )?.surface
          let intensity = 0
          if (surface) {
            const hl = opts.state.highlights.get(surface) ?? 0
            const tg = threadGlowForSurface(
              opts.state.scene.threads,
              surface,
              opts.state.threadPulses
            )
            const isHover = opts.hoveredSurface === surface
            intensity = Math.max(hl, tg, isHover ? 0.6 : 0)
          } else {
            // Visual-noise blip — pseudo-random per-cell.
            const phase = ((r * 7.13 + c * 3.7) % 1) - blipPhase
            const blipK = Math.max(0, 0.05 - Math.abs(phase % 1) * 0.5)
            intensity = blipK
          }
          const syncMul = filterMul(opts, intensity > 0.04 ? `sync` : undefined)
          const cellMin = c * cellW + inset
          const cellMax = (c + 1) * cellW - inset
          const zMinCell = z + f.h - (r + 1) * cellH + inset
          const zMaxCell = z + f.h - r * cellH - inset
          let cell: Vec3[]
          if (f.facing === 90 || f.facing === 270) {
            const yA = y - ay / 2 + (ay * cellMin) / f.w
            const yB = y - ay / 2 + (ay * cellMax) / f.w
            cell = [
              [x, yA, zMinCell],
              [x, yB, zMinCell],
              [x, yB, zMaxCell],
              [x, yA, zMaxCell],
            ]
          } else {
            const xA = x - ax / 2 + ax * (cellMin / f.w)
            const xB = x - ax / 2 + ax * (cellMax / f.w)
            cell = [
              [xA, y, zMinCell],
              [xB, y, zMinCell],
              [xB, y, zMaxCell],
              [xA, y, zMaxCell],
            ]
          }
          ctx.fillStyle = surfaceFill(opts.dark, intensity * syncMul)
          drawIsoPolygon(ctx, cell, proj, true)
          ctx.fill()
          if (intensity * syncMul > 0.04) {
            ctx.lineWidth = 1
            ctx.strokeStyle = accent(
              opts.dark,
              `sync`,
              0.4 * intensity * syncMul + 0.1
            )
            drawIsoPolygon(ctx, cell, proj, false)
          }
        }
      }
      ctx.globalAlpha = 1
    },
  })
}

function queuePerson(
  cmds: DrawCmd[],
  at: Vec3,
  f: Extract<Furniture, { kind: `person` }>,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  const headR = 0.12
  const torsoH = f.pose === `sit` ? 0.45 : 0.6
  const baseZ = z
  const torsoTop: Vec3 = [x, y, baseZ + torsoH]
  const headCenter: Vec3 = [x, y, baseZ + torsoH + headR + 0.04]
  const wobble = opts.reducedMotion
    ? 0
    : Math.sin(opts.state.elapsedMs / 1700 + (x + y) * 3) * 0.6
  // Speaking-turn highlight: when a person id is in highlights via the
  // `__person__:` sentinel, brighten them briefly.
  const personHl = f.id
    ? (opts.state.highlights.get(`__person__:${f.id}`) ?? 0)
    : 0

  cmds.push({
    depth: x + y - (baseZ + torsoH * 0.5),
    draw: (ctx) => {
      const f1 = fadeForPoint([x, y, baseZ], proj.bounds, proj.fadeMargin)
      const f2 = fadeForPoint(headCenter, proj.bounds, proj.fadeMargin)
      const fade = Math.min(f1, f2)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      const base = projectXY([x, y, baseZ], proj)
      const top = projectXY(torsoTop, proj)
      const head = projectXY(headCenter, proj)
      const alphaBoost = 0.7 + personHl * 0.3
      ctx.lineWidth = 1.2 + personHl * 0.4
      ctx.strokeStyle = neutralColor(opts.dark, alphaBoost)
      ctx.fillStyle = neutralColor(opts.dark, alphaBoost)
      ctx.beginPath()
      ctx.moveTo(base.sx + wobble, base.sy)
      ctx.lineTo(top.sx + wobble, top.sy)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(
        head.sx + wobble,
        head.sy,
        headR * proj.scale * ISO_SIN * 1.4,
        0,
        Math.PI * 2
      )
      ctx.fill()
      ctx.globalAlpha = 1
    },
  })
}

function queueLamp(
  cmds: DrawCmd[],
  at: Vec3,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  cmds.push({
    depth: x + y - z + 0.0008,
    draw: (ctx) => {
      const fade = fadeForPoint(at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      const sp = projectXY(at, proj)
      const r = 22
      const grd = ctx.createRadialGradient(
        sp.sx,
        sp.sy + 4,
        0,
        sp.sx,
        sp.sy + 4,
        r
      )
      grd.addColorStop(0, neutralColor(opts.dark, 0.12 * fade))
      grd.addColorStop(1, neutralColor(opts.dark, 0))
      ctx.fillStyle = grd
      ctx.beginPath()
      ctx.arc(sp.sx, sp.sy + 4, r, 0, Math.PI * 2)
      ctx.fill()
    },
  })
}

function queuePlant(
  cmds: DrawCmd[],
  at: Vec3,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  cmds.push({
    depth: x + y - z + 0.001,
    draw: (ctx) => {
      const fade = fadeForPoint(at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      const sp = projectXY(at, proj)
      ctx.strokeStyle = neutralColor(opts.dark, 0.5)
      ctx.lineWidth = 1
      // 5-line spray.
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(sp.sx, sp.sy)
        ctx.lineTo(sp.sx + Math.cos(a) * 6, sp.sy + Math.sin(a) * 6 - 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  })
}

function queueCooler(
  cmds: DrawCmd[],
  at: Vec3,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  queueBox(cmds, [x - 0.15, y - 0.15, z], [0.3, 0.3, 0.7], opts, proj, {
    edge: 0.3,
  })
}

function queueDoorArc(
  cmds: DrawCmd[],
  at: Vec3,
  facing: number,
  radius: number,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = at
  // Arc swing animation: 0..π/2 over 12s.
  const phase = opts.reducedMotion ? 0 : (opts.state.elapsedMs / 12000) % 1
  const swing = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5 // 0..1
  const angle = swing * (Math.PI / 2)
  cmds.push({
    depth: x + y - z + 0.0009,
    draw: (ctx) => {
      const fade = fadeForPoint(at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      ctx.globalAlpha = fade * 0.5
      const sp = projectXY(at, proj)
      ctx.strokeStyle = neutralColor(opts.dark, 0.4)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(sp.sx, sp.sy, radius * proj.scale * 0.4, 0, angle, false)
      ctx.stroke()
      ctx.globalAlpha = 1
      void facing
    },
  })
}

// ── Substrate (channels, packets, comets, junctions, risers) ──────────

function queueChannel(
  cmds: DrawCmd[],
  ch: Channel,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  if (ch.path.length < 2) return
  const flow = opts.tweaks.substrateFlow
  const subMul = filterMul(opts, `streams`)

  cmds.push({
    depth: avgDepth(ch.path) - 0.5,
    draw: (ctx) => {
      ctx.lineWidth = lineWeight(opts, `streams`)
      ctx.strokeStyle = accent(
        opts.dark,
        `streams`,
        0.45 * Math.max(flow, 0.4) * subMul
      )
      ctx.beginPath()
      for (let i = 0; i < ch.path.length; i++) {
        const p = projectXY(ch.path[i], proj)
        if (i === 0) ctx.moveTo(p.sx, p.sy)
        else ctx.lineTo(p.sx, p.sy)
      }
      ctx.stroke()

      const total = polylineLength(ch.path)
      const tick = 0.8
      const count = Math.floor(total / tick)
      ctx.strokeStyle = accent(
        opts.dark,
        `streams`,
        0.22 * Math.max(flow, 0.4) * subMul
      )
      for (let i = 1; i < count; i++) {
        const t = (i * tick) / total
        const p = samplePolyline(ch.path, t)
        const sp = projectXY(p, proj)
        const perp = perpScreen(ch.path, t, proj, 4)
        ctx.beginPath()
        ctx.moveTo(sp.sx - perp.dx, sp.sy - perp.dy)
        ctx.lineTo(sp.sx + perp.dx, sp.sy + perp.dy)
        ctx.stroke()
      }
    },
  })

  for (const p of ch.durable) {
    const at = samplePolyline(ch.path, p.position)
    const intensity = isHighlightThread(opts.crop, p.threadId)
      ? 0.6 + Math.sin(opts.state.elapsedMs / 800 + p.position * 6) * 0.2
      : 0.35
    cmds.push({
      depth: at[0] + at[1] - at[2] + 0.001,
      draw: (ctx) => {
        const f = fadeForPoint(at, proj.bounds, proj.fadeMargin)
        if (f < 0.01) return
        const sp = projectXY(at, proj)
        ctx.globalAlpha = f
        const halo = ctx.createRadialGradient(sp.sx, sp.sy, 0, sp.sx, sp.sy, 12)
        halo.addColorStop(
          0,
          accent(opts.dark, `streams`, 0.45 * intensity * subMul)
        )
        halo.addColorStop(1, accent(opts.dark, `streams`, 0))
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(sp.sx, sp.sy, 12, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = accent(
          opts.dark,
          `streams`,
          (0.85 * intensity + 0.1) * subMul
        )
        ctx.beginPath()
        ctx.arc(sp.sx, sp.sy, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      },
    })
  }
}

function queueComet(
  cmds: DrawCmd[],
  c: ActiveComet,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const ch = opts.state.scene.substrate.channels.find(
    (x) => x.id === c.channelId
  )
  if (!ch || ch.path.length < 2) return
  const at = samplePolyline(ch.path, c.t)
  const trail: Vec3[] = []
  for (let i = 1; i <= 3; i++) {
    const tt = c.t - i * 0.025
    if (tt > 0) trail.push(samplePolyline(ch.path, tt))
  }
  // Portal fade-in/out near the world edges.
  const edgeFade = portalFade(c, ch, opts)
  const subMul = filterMul(opts, `streams`) * edgeFade
  cmds.push({
    depth: at[0] + at[1] - at[2] + 0.002,
    draw: (ctx) => {
      const fade = fadeForPoint(at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      const sp = projectXY(at, proj)
      for (let i = 0; i < trail.length; i++) {
        const tp = projectXY(trail[i], proj)
        const ta = (1 - i / trail.length) * 0.35 * fade * subMul
        ctx.fillStyle = accent(opts.dark, `streams`, ta)
        ctx.beginPath()
        ctx.arc(tp.sx, tp.sy, 2 - i * 0.4, 0, Math.PI * 2)
        ctx.fill()
      }
      const halo = ctx.createRadialGradient(sp.sx, sp.sy, 0, sp.sx, sp.sy, 14)
      halo.addColorStop(0, accent(opts.dark, `streams`, 0.55 * fade * subMul))
      halo.addColorStop(1, accent(opts.dark, `streams`, 0))
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(sp.sx, sp.sy, 14, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = accent(opts.dark, `streams`, 0.95 * fade * subMul)
      ctx.beginPath()
      ctx.arc(sp.sx, sp.sy, 2.6, 0, Math.PI * 2)
      ctx.fill()
    },
  })
}

function portalFade(c: ActiveComet, ch: Channel, opts: RenderOptions): number {
  // 0.6 unit fade at portal edges. Use the t-window around endpoints.
  const total = polylineLength(ch.path)
  const fadeUnits = 0.6
  if (total === 0) return 1
  const distFromStart = c.t * total
  const distFromEnd = (1 - c.t) * total
  let f = 1
  if (ch.portalLeft) f = Math.min(f, Math.max(0, distFromStart / fadeUnits))
  if (ch.portalRight) f = Math.min(f, Math.max(0, distFromEnd / fadeUnits))
  void opts
  return f
}

function queueJunction(
  cmds: DrawCmd[],
  j: Junction,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const flash = activeFlash(
    opts.state.junctionFlashes,
    j.id,
    opts.state.elapsedMs
  )
  const subMul = filterMul(opts, `streams`)
  const w = 0.3
  cmds.push({
    depth: j.at[0] + j.at[1] - j.at[2] + 0.0015,
    draw: (ctx) => {
      const fade = fadeForPoint(j.at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      const sp = projectXY(j.at, proj)
      const intensity = 0.4 + flash * 0.6
      ctx.lineWidth = 1 + flash * 0.6
      ctx.strokeStyle = accent(opts.dark, `streams`, 0.6 * intensity * subMul)
      ctx.fillStyle = accent(opts.dark, `streams`, 0.18 * intensity * subMul)
      // Small diamond.
      const r = w * proj.scale * 0.5
      ctx.beginPath()
      ctx.moveTo(sp.sx, sp.sy - r)
      ctx.lineTo(sp.sx + r, sp.sy)
      ctx.lineTo(sp.sx, sp.sy + r)
      ctx.lineTo(sp.sx - r, sp.sy)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      if (flash > 0.05) {
        const halo = ctx.createRadialGradient(
          sp.sx,
          sp.sy,
          0,
          sp.sx,
          sp.sy,
          r * 4
        )
        halo.addColorStop(0, accent(opts.dark, `streams`, 0.4 * flash * subMul))
        halo.addColorStop(1, accent(opts.dark, `streams`, 0))
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(sp.sx, sp.sy, r * 4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    },
  })
}

function activeFlash(
  flashes: JunctionFlash[],
  id: string,
  nowMs: number
): number {
  let max = 0
  for (const f of flashes) {
    if (f.junctionId !== id) continue
    const k = (nowMs - f.startMs) / f.durationMs
    if (k < 0 || k > 1) continue
    const v = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7
    if (v > max) max = v
  }
  return max
}

function queueRiser(
  cmds: DrawCmd[],
  r: Riser,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const ch = opts.state.scene.substrate.channels.find(
    (x) => x.id === r.channelId
  )
  if (!ch) return
  const base = samplePolyline(ch.path, r.channelT)
  const top: Vec3 = [base[0], base[1], r.topZ]
  const subMul = filterMul(opts, `streams`)
  // Riser glows when the surface its terminates on is currently
  // glowing for any thread.
  const surfGlow =
    threadGlowForSurface(
      opts.state.scene.threads,
      r.surface,
      opts.state.threadPulses
    ) + (opts.state.highlights.get(r.surface) ?? 0)
  const intensity = Math.min(1, 0.25 + surfGlow * 0.6)
  cmds.push({
    depth:
      (base[0] + top[0]) / 2 + (base[1] + top[1]) / 2 - (base[2] + top[2]) / 2,
    draw: (ctx) => {
      const f1 = fadeForPoint(base, proj.bounds, proj.fadeMargin)
      const f2 = fadeForPoint(top, proj.bounds, proj.fadeMargin)
      const fade = (f1 + f2) * 0.5
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      const pa = projectXY(base, proj)
      const pb = projectXY(top, proj)
      ctx.strokeStyle = accent(opts.dark, `streams`, 0.5 * intensity * subMul)
      ctx.lineWidth = lineWeight(opts, `streams`) * (intensity > 0.4 ? 1.4 : 1)
      ctx.beginPath()
      ctx.moveTo(pa.sx, pa.sy)
      ctx.lineTo(pb.sx, pb.sy)
      ctx.stroke()
      ctx.globalAlpha = 1
    },
  })
}

function queueUnderground(
  cmds: DrawCmd[],
  u: UndergroundProp,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = u.at
  const [dx, dy, dz] = u.size ?? [0.6, 0.4, 0.5]
  cmds.push({
    depth: x + y - z - 1, // explicitly behind
    draw: (ctx) => {
      const fade = fadeForPoint(u.at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      ctx.globalAlpha = fade * 0.7
      // Single silhouette rect.
      const corners: Vec3[] = [
        [x, y, z],
        [x + dx, y, z],
        [x + dx, y + dy, z],
        [x, y + dy, z],
        [x, y, z + dz],
        [x + dx, y, z + dz],
        [x + dx, y + dy, z + dz],
        [x, y + dy, z + dz],
      ]
      ctx.fillStyle = neutralColor(opts.dark, 0.08)
      ctx.strokeStyle = neutralColor(opts.dark, 0.12)
      ctx.lineWidth = 1
      // Front face only (cheap silhouette).
      const front: Vec3[] = [corners[0], corners[1], corners[5], corners[4]]
      drawIsoPolygon(ctx, front, proj, true)
      ctx.fill()
      ctx.stroke()
      ctx.globalAlpha = 1
    },
  })
}

// ── Skybridge ────────────────────────────────────────────────────────

function queueSkybridge(
  cmds: DrawCmd[],
  sb: Skybridge,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [ax, ay, az] = sb.from
  const [bx, by, bz] = sb.to
  const w = sb.width ?? 0.6
  // Build a thin floor strip + railings.
  const dx = bx - ax
  const dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.01) return
  const nx = -dy / len
  const ny = dx / len
  const wx = (nx * w) / 2
  const wy = (ny * w) / 2
  const corners: Vec3[] = [
    [ax + wx, ay + wy, az],
    [bx + wx, by + wy, bz],
    [bx - wx, by - wy, bz],
    [ax - wx, ay - wy, az],
  ]
  const mid: Vec3 = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]
  cmds.push({
    depth: mid[0] + mid[1] - mid[2],
    draw: (ctx) => {
      const fade = avgFade(corners, proj)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      ctx.fillStyle = surfaceFill(opts.dark, 0)
      ctx.strokeStyle = neutralColor(opts.dark, 0.3)
      ctx.lineWidth = 1
      drawIsoPolygon(ctx, corners, proj, true)
      ctx.fill()
      ctx.stroke()
      // Railings (vertical posts at each end + along).
      const posts: Vec3[][] = [
        [
          [ax + wx, ay + wy, az],
          [ax + wx, ay + wy, az + 0.45],
        ],
        [
          [bx + wx, by + wy, bz],
          [bx + wx, by + wy, bz + 0.45],
        ],
        [
          [ax - wx, ay - wy, az],
          [ax - wx, ay - wy, az + 0.45],
        ],
        [
          [bx - wx, by - wy, bz],
          [bx - wx, by - wy, bz + 0.45],
        ],
      ]
      for (const p of posts) {
        const pa = projectXY(p[0], proj)
        const pb = projectXY(p[1], proj)
        ctx.beginPath()
        ctx.moveTo(pa.sx, pa.sy)
        ctx.lineTo(pb.sx, pb.sy)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  })
}

// ── Sidewalk + outdoor props ─────────────────────────────────────────

function queueSidewalk(
  cmds: DrawCmd[],
  s: Sidewalk,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = s.origin
  const [dx, dy] = s.size
  const corners: Vec3[] = [
    [x, y, z],
    [x + dx, y, z],
    [x + dx, y + dy, z],
    [x, y + dy, z],
  ]
  cmds.push({
    depth: x + y - z - 0.0008,
    draw: (ctx) => {
      const fade = avgFade(corners, proj)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      ctx.lineWidth = 1
      ctx.strokeStyle = neutralColor(opts.dark, 0.2)
      drawIsoPolygon(ctx, corners, proj, false)
      // Tile lines along the strip.
      const step = 1.0
      for (let xi = step; xi < dx; xi += step) {
        const p1 = projectXY([x + xi, y, z], proj)
        const p2 = projectXY([x + xi, y + dy, z], proj)
        ctx.strokeStyle = neutralColor(opts.dark, 0.1)
        ctx.beginPath()
        ctx.moveTo(p1.sx, p1.sy)
        ctx.lineTo(p2.sx, p2.sy)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  })
}

function queueOutdoorProp(
  cmds: DrawCmd[],
  p: OutdoorProp,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const [x, y, z] = p.at
  if (p.kind === `streetlight`) {
    cmds.push({
      depth: x + y - z + 0.0009,
      draw: (ctx) => {
        const fade = fadeForPoint(p.at, proj.bounds, proj.fadeMargin)
        if (fade < 0.01) return
        ctx.globalAlpha = fade
        const base = projectXY([x, y, z], proj)
        const top = projectXY([x, y, z + 1.6], proj)
        ctx.strokeStyle = neutralColor(opts.dark, 0.5)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(base.sx, base.sy)
        ctx.lineTo(top.sx, top.sy)
        ctx.stroke()
        // Lamp head soft glow.
        const grd = ctx.createRadialGradient(
          top.sx,
          top.sy,
          0,
          top.sx,
          top.sy,
          18
        )
        grd.addColorStop(0, neutralColor(opts.dark, 0.18))
        grd.addColorStop(1, neutralColor(opts.dark, 0))
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(top.sx, top.sy, 18, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      },
    })
  } else if (p.kind === `tree`) {
    cmds.push({
      depth: x + y - z + 0.0009,
      draw: (ctx) => {
        const fade = fadeForPoint(p.at, proj.bounds, proj.fadeMargin)
        if (fade < 0.01) return
        ctx.globalAlpha = fade
        const base = projectXY([x, y, z], proj)
        const top = projectXY([x, y, z + 1.4], proj)
        ctx.strokeStyle = neutralColor(opts.dark, 0.4)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(base.sx, base.sy)
        ctx.lineTo(top.sx, top.sy)
        ctx.stroke()
        ctx.fillStyle = neutralColor(opts.dark, 0.18)
        ctx.beginPath()
        ctx.arc(top.sx, top.sy - 4, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      },
    })
  } else if (p.kind === `bench`) {
    queueBox(cmds, [x - 0.5, y - 0.15, z], [1.0, 0.3, 0.35], opts, proj, {
      edge: 0.25,
    })
  }
}

// ── Pedestrians ──────────────────────────────────────────────────────

function queuePedestrian(
  cmds: DrawCmd[],
  p: Pedestrian,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  if (p.loop.length < 2) return
  const t = opts.reducedMotion
    ? p.phase
    : (opts.state.elapsedMs / p.loopMs + p.phase) % 1
  const at = samplePolyline(p.loop, t)
  cmds.push({
    depth: at[0] + at[1] - at[2],
    draw: (ctx) => {
      const fade = fadeForPoint(at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      ctx.globalAlpha = fade * 0.85
      const base = projectXY(at, proj)
      const top = projectXY([at[0], at[1], at[2] + 0.55], proj)
      ctx.strokeStyle = neutralColor(opts.dark, 0.5)
      ctx.fillStyle = neutralColor(opts.dark, 0.5)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(base.sx, base.sy)
      ctx.lineTo(top.sx, top.sy)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(top.sx, top.sy - 4, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    },
  })
}

// ── Actors (couriers, inspectors, analysts, sweepers) ────────────────

function queueActor(
  cmds: DrawCmd[],
  a: Actor,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const pos = a.position
  const stepBob = opts.reducedMotion
    ? 0
    : a.walking
      ? Math.abs(Math.sin(opts.state.elapsedMs / 110)) * 0.04
      : 0
  const at: Vec3 = [pos[0], pos[1], pos[2] + stepBob]
  const isHover = opts.hoveredActorId === a.id
  cmds.push({
    depth: at[0] + at[1] - at[2],
    draw: (ctx) => {
      const fade = fadeForPoint(at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      drawActorSprite(ctx, a.kind, at, proj, opts, fade, isHover, a.id)
    },
  })
}

function drawActorSprite(
  ctx: CanvasRenderingContext2D,
  kind: ActorKind,
  at: Vec3,
  proj: ProjectorOpts,
  opts: RenderOptions,
  fade: number,
  hover: boolean,
  id: string
): void {
  const sp = projectXY(at, proj)
  const top = projectXY([at[0], at[1], at[2] + 0.6], proj)
  ctx.globalAlpha = fade

  // Humans don't get a substrate accent; everything else is `agents`.
  const sub: Substrate | undefined = kind === `human` ? undefined : `agents`
  const subMul = filterMul(opts, sub)
  const accentCol = sub
    ? accent(opts.dark, sub, hover ? 0.95 * subMul : 0.85 * subMul)
    : neutralColor(opts.dark, 0.55)
  const dim = neutralColor(opts.dark, 0.55)

  if (kind === `human`) {
    ctx.lineWidth = 1.2
    ctx.strokeStyle = dim
    ctx.fillStyle = dim
    ctx.beginPath()
    ctx.moveTo(sp.sx, sp.sy)
    ctx.lineTo(top.sx, top.sy)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(top.sx, top.sy - 5, 3.4, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === `courier`) {
    ctx.lineWidth = lineWeight(opts, sub) + 0.2
    ctx.strokeStyle = accentCol
    ctx.fillStyle = accentCol
    ctx.beginPath()
    ctx.moveTo(sp.sx, sp.sy)
    ctx.lineTo(top.sx, top.sy)
    ctx.stroke()
    // Square head.
    ctx.fillRect(top.sx - 2.6, top.sy - 8, 5.2, 5.2)
    // Parcel diamond mid-body — only when carrying something.
    if (opts.state.carrying.has(id)) {
      const mid = projectXY([at[0], at[1], at[2] + 0.32], proj)
      ctx.beginPath()
      ctx.moveTo(mid.sx, mid.sy - 4)
      ctx.lineTo(mid.sx + 4, mid.sy)
      ctx.lineTo(mid.sx, mid.sy + 4)
      ctx.lineTo(mid.sx - 4, mid.sy)
      ctx.closePath()
      ctx.fill()
    }
    if (hover)
      drawHoverHalo(
        ctx,
        top.sx,
        top.sy - 4,
        accent(opts.dark, `agents`, 0.35 * subMul)
      )
  } else if (kind === `inspector`) {
    ctx.lineWidth = lineWeight(opts, sub)
    ctx.strokeStyle = accentCol
    ctx.fillStyle = accentCol
    ctx.beginPath()
    ctx.moveTo(sp.sx, sp.sy)
    ctx.lineTo(top.sx, top.sy)
    ctx.stroke()
    drawHex(ctx, top.sx, top.sy - 6, 4)
    ctx.fill()
    // Clipboard line jutting from torso.
    ctx.beginPath()
    ctx.moveTo(top.sx + 1.5, top.sy + 3)
    ctx.lineTo(top.sx + 6, top.sy + 5)
    ctx.stroke()
    if (hover)
      drawHoverHalo(
        ctx,
        top.sx,
        top.sy - 4,
        accent(opts.dark, `agents`, 0.35 * subMul)
      )
  } else if (kind === `analyst`) {
    ctx.lineWidth = lineWeight(opts, sub)
    ctx.strokeStyle = accentCol
    ctx.fillStyle = accentCol
    ctx.beginPath()
    ctx.moveTo(sp.sx, sp.sy)
    ctx.lineTo(top.sx, top.sy)
    ctx.stroke()
    // Round head.
    ctx.beginPath()
    ctx.arc(top.sx, top.sy - 5, 3.6, 0, Math.PI * 2)
    ctx.fill()
    // Tiny laptop rectangle in front.
    ctx.fillRect(top.sx - 3, top.sy + 2, 6, 2)
    if (hover)
      drawHoverHalo(
        ctx,
        top.sx,
        top.sy - 4,
        accent(opts.dark, `agents`, 0.35 * subMul)
      )
  } else if (kind === `sweeper`) {
    ctx.lineWidth = lineWeight(opts, sub)
    ctx.strokeStyle = accent(opts.dark, `agents`, 0.55 * subMul)
    ctx.fillStyle = accent(opts.dark, `agents`, 0.55 * subMul)
    ctx.beginPath()
    ctx.moveTo(sp.sx, sp.sy)
    ctx.lineTo(top.sx, top.sy)
    ctx.stroke()
    // Diamond head.
    ctx.beginPath()
    ctx.moveTo(top.sx, top.sy - 9)
    ctx.lineTo(top.sx + 3.5, top.sy - 5)
    ctx.lineTo(top.sx, top.sy - 1)
    ctx.lineTo(top.sx - 3.5, top.sy - 5)
    ctx.closePath()
    ctx.fill()
    // Tool line.
    ctx.beginPath()
    ctx.moveTo(top.sx + 2, top.sy + 2)
    ctx.lineTo(top.sx + 6, top.sy + 8)
    ctx.stroke()
    if (hover)
      drawHoverHalo(
        ctx,
        top.sx,
        top.sy - 4,
        accent(opts.dark, `agents`, 0.3 * subMul)
      )
  }

  ctx.globalAlpha = 1
}

function drawHoverHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string
): void {
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18)
  halo.addColorStop(0, color)
  halo.addColorStop(1, color.replace(/[\d.]+\)$/, `0)`))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(cx, cy, 18, 0, Math.PI * 2)
  ctx.fill()
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number
): void {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

// ── Connection arcs (sync/streams/agents on hover) ───────────────────

function queueConnectionArc(
  cmds: DrawCmd[],
  arc: ConnectionArc,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  if (arc.points.length < 2) return
  // Lifecycle k 0..1; alpha = triangle envelope.
  const k = (opts.state.elapsedMs - arc.startMs) / arc.durationMs
  if (k < 0 || k > 1) return
  const env = opts.reducedMotion ? 1 : k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7
  const subMul = filterMul(opts, arc.kind)
  const mid = arc.points[Math.floor(arc.points.length / 2)]
  cmds.push({
    depth: mid[0] + mid[1] - mid[2] + 0.5,
    draw: (ctx) => {
      const dashed = arc.kind === `agents`
      ctx.save()
      if (dashed) ctx.setLineDash([4, 4])
      ctx.lineWidth = 1.4
      ctx.strokeStyle = accent(opts.dark, arc.kind, 0.7 * env * subMul)
      ctx.beginPath()
      for (let i = 0; i < arc.points.length; i++) {
        const p = projectXY(arc.points[i], proj)
        if (i === 0) ctx.moveTo(p.sx, p.sy)
        else ctx.lineTo(p.sx, p.sy)
      }
      ctx.stroke()
      ctx.restore()
    },
  })
}

// ── Handoff bursts (coral particles) ─────────────────────────────────

function queueHandoffBurst(
  cmds: DrawCmd[],
  hb: HandoffBurst,
  opts: RenderOptions,
  proj: ProjectorOpts
): void {
  const k = (opts.state.elapsedMs - hb.startMs) / hb.durationMs
  if (k < 0 || k > 1) return
  const subMul = filterMul(opts, `agents`)
  cmds.push({
    depth: hb.at[0] + hb.at[1] - hb.at[2] + 0.6,
    draw: (ctx) => {
      const fade = fadeForPoint(hb.at, proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      const sp = projectXY([hb.at[0], hb.at[1], hb.at[2] + 0.4], proj)
      const r = 4 + k * 18
      const a = (1 - k) * fade * subMul
      // Ring.
      ctx.lineWidth = 1.2
      ctx.strokeStyle = accent(opts.dark, `agents`, 0.7 * a)
      ctx.beginPath()
      ctx.arc(sp.sx, sp.sy, r, 0, Math.PI * 2)
      ctx.stroke()
      // 6 particles flying out.
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i
        const px = sp.sx + Math.cos(ang) * r
        const py = sp.sy + Math.sin(ang) * r
        ctx.fillStyle = accent(opts.dark, `agents`, a)
        ctx.beginPath()
        ctx.arc(px, py, 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
    },
  })
}

// ── Boxes (used for desks etc.) ───────────────────────────────────────

function queueBox(
  cmds: DrawCmd[],
  origin: Vec3,
  size: Vec3,
  opts: RenderOptions,
  proj: ProjectorOpts,
  styleOpts?: { edge?: number }
): void {
  const [x, y, z] = origin
  const [dx, dy, dz] = size
  const corners: Vec3[] = [
    [x, y, z],
    [x + dx, y, z],
    [x + dx, y + dy, z],
    [x, y + dy, z],
    [x, y, z + dz],
    [x + dx, y, z + dz],
    [x + dx, y + dy, z + dz],
    [x, y + dy, z + dz],
  ]
  const top: Vec3[] = [corners[4], corners[5], corners[6], corners[7]]
  const right: Vec3[] = [corners[1], corners[2], corners[6], corners[5]]
  const left: Vec3[] = [corners[3], corners[2], corners[6], corners[7]]
  const cx = x + dx / 2
  const cy = y + dy / 2
  const cz = z + dz / 2
  const edgeAlpha = styleOpts?.edge ?? 0.25

  cmds.push({
    depth: cx + cy - cz,
    draw: (ctx) => {
      const fade = fadeForPoint([cx, cy, cz], proj.bounds, proj.fadeMargin)
      if (fade < 0.01) return
      ctx.globalAlpha = fade
      ctx.lineWidth = 1
      ctx.fillStyle = surfaceFill(opts.dark, 0)
      ctx.strokeStyle = neutralColor(opts.dark, edgeAlpha)
      drawIsoPolygon(ctx, top, proj, true)
      ctx.fill()
      ctx.stroke()
      drawIsoPolygon(ctx, right, proj, true)
      ctx.fill()
      ctx.stroke()
      drawIsoPolygon(ctx, left, proj, true)
      ctx.fill()
      ctx.stroke()
      ctx.globalAlpha = 1
    },
  })
}

// ── Geometry utilities ────────────────────────────────────────────────

function drawIsoPolygon(
  ctx: CanvasRenderingContext2D,
  pts: Vec3[],
  proj: ProjectorOpts,
  pathOnly: boolean
): void {
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const p = projectXY(pts[i], proj)
    if (i === 0) ctx.moveTo(p.sx, p.sy)
    else ctx.lineTo(p.sx, p.sy)
  }
  ctx.closePath()
  if (!pathOnly) ctx.stroke()
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

function avgDepth(pts: readonly Vec3[]): number {
  let s = 0
  for (const p of pts) s += p[0] + p[1] - p[2]
  return s / pts.length
}

function avgFade(pts: Vec3[], proj: ProjectorOpts): number {
  let s = 0
  for (const p of pts) s += fadeForPoint(p, proj.bounds, proj.fadeMargin)
  return s / pts.length
}

function perpScreen(
  path: readonly Vec3[],
  t: number,
  proj: ProjectorOpts,
  len: number
): { dx: number; dy: number } {
  const eps = 0.001
  const a = samplePolyline(path, Math.max(0, t - eps))
  const b = samplePolyline(path, Math.min(1, t + eps))
  const sa = projectXY(a, proj)
  const sb = projectXY(b, proj)
  let dx = sb.sx - sa.sx
  let dy = sb.sy - sa.sy
  const m = Math.hypot(dx, dy) || 1
  dx /= m
  dy /= m
  return { dx: -dy * len, dy: dx * len }
}

function interp3(a: Vec3, b: Vec3, k: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ]
}

// ── Theme-aware colour helpers (legacy / surface helpers) ────────────

function surfaceFill(dark: boolean, intensity: number): string {
  if (dark) {
    const base = 0.04
    const hot = 0.12
    return accent(
      dark,
      `sync`,
      base + (hot - base) * Math.max(0, Math.min(1, intensity))
    )
  }
  const base = 0.03
  const hot = 0.1
  return accent(
    dark,
    `sync`,
    base + (hot - base) * Math.max(0, Math.min(1, intensity))
  )
}

function surfaceStroke(dark: boolean, intensity: number): string {
  if (intensity > 0.05) return accent(dark, `sync`, 0.35 + intensity * 0.6)
  return neutralColor(dark, 0.28)
}

function threadGlowForSurface(
  threads: Thread[],
  surface: string,
  pulses: Map<string, number>
): number {
  let max = 0
  for (const t of threads) {
    if (!t.manifestations.includes(surface)) continue
    const v = pulses.get(t.id) ?? 0
    if (v > max) max = v
  }
  return max
}

function isHighlightThread(
  crop: { highlightThreads: string[] },
  threadId: string
): boolean {
  if (!crop.highlightThreads || crop.highlightThreads.length === 0) return true
  return crop.highlightThreads.includes(threadId)
}
