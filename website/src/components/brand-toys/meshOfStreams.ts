export interface MeshPoint {
  x: number
  y: number
}

export interface MeshWheel {
  id: string
  x: number
  y: number
  r: number
  innerR: number
  segmentCount: number
  rotationRate: number
  rotationOffset: number
  segmentOffset: number
}

export interface MeshCornerArc {
  // If present, overrides the arc center used at points[index].
  // Otherwise the renderer derives the center from the two adjacent segments
  // using `radius` (canvas arcTo style).
  center?: MeshPoint
  // Arc radius for this corner (per-lane, so concentric arcs across a bundle).
  radius: number
}

export interface MeshTrack {
  id: string
  fromWheelId: string
  toWheelId: string
  points: MeshPoint[]
  // Per-vertex corner data (length === points.length). Endpoints have radius 0
  // and are ignored by the renderer.
  corners: MeshCornerArc[]
  // Pre-built primitives (straight line + circular arc) that exactly mirror
  // what the canvas renderer draws via arcTo. Used by sampleAlongTrack so
  // animated messages follow the visible rounded path instead of cutting
  // outside each corner.
  segments: RenderedPathSegment[]
  // Total length along the rendered (rounded) path, not the raw polyline.
  length: number
}

export type RenderedPathSegment =
  | {
      kind: `line`
      x0: number
      y0: number
      x1: number
      y1: number
      length: number
    }
  | {
      kind: `arc`
      cx: number
      cy: number
      r: number
      a0: number
      a1: number
      ccw: boolean
      length: number
    }

export interface MeshScene {
  width: number
  height: number
  wheels: MeshWheel[]
  tracks: MeshTrack[]
}

export interface MeshSceneOptions {
  width: number
  height: number
  seed: string | number
  wheelCount: number
  layout: `wide` | `square` | `dense` | `sparse`
  connectionDensity: number
  gridSize: number
  routePadding: number
  cornerRadius: number
  // Optional: emit additional tracks that enter/leave via the left and right
  // canvas edges. Adds a sense of the mesh being part of a larger system.
  // Off by default to keep the existing visual unchanged.
  edgeConnections?: boolean
}

interface CandidateEdge {
  a: number
  b: number
  distance: number
}

interface WheelAnchor {
  x: number
  y: number
  tier: number
}

export function hashSeed(seed: string | number): number {
  const text = String(seed)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function distance(a: MeshPoint, b: MeshPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

function uniquePairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function nearestGrid(value: number, cell: number): number {
  return Math.round(value / cell) * cell
}

function polylineLength(points: MeshPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++)
    total += distance(points[i - 1], points[i])
  return total
}

function minSegmentLength(points: MeshPoint[]): number {
  let min = Number.POSITIVE_INFINITY
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distance(points[i - 1], points[i]))
  }
  return Number.isFinite(min) ? min : 0
}

function simplifyPolyline(points: MeshPoint[]): MeshPoint[] {
  if (points.length <= 2) return points.slice()
  const out: MeshPoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]
    const cur = points[i]
    const next = points[i + 1]
    // Drop `cur` only when prev/cur/next are EXACTLY collinear and going in
    // the same direction (no backtrack). The previous sign-only check would
    // collapse a near-horizontal sequence like (573,240)→(601,243)→(633,245)
    // into a single slanted segment, even though intermediate vertices
    // represent real direction changes.
    const ax = cur.x - prev.x
    const ay = cur.y - prev.y
    const bx = next.x - cur.x
    const by = next.y - cur.y
    const cross = ax * by - ay * bx
    const dot = ax * bx + ay * by
    if (Math.abs(cross) < 0.001 && dot >= 0) continue
    out.push(cur)
  }
  out.push(points[points.length - 1])
  return out
}

function normalizePolyline(points: MeshPoint[]): MeshPoint[] {
  if (points.length <= 2) return points.slice()
  const deduped: MeshPoint[] = []
  for (const point of points) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.x === point.x && prev.y === point.y) continue
    deduped.push(point)
  }

  const out: MeshPoint[] = []
  for (const point of deduped) {
    out.push(point)
    while (out.length >= 3) {
      const a = out[out.length - 3]
      const c = out[out.length - 1]
      if (a.x === c.x && a.y === c.y) {
        out.splice(out.length - 2, 2)
        continue
      }
      break
    }
  }
  return out
}

function turnCount(points: MeshPoint[]): number {
  let turns = 0
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const dx1 = Math.sign(b.x - a.x)
    const dy1 = Math.sign(b.y - a.y)
    const dx2 = Math.sign(c.x - b.x)
    const dy2 = Math.sign(c.y - b.y)
    if (dx1 !== dx2 || dy1 !== dy2) turns += 1
  }
  return turns
}

function maxTurnAngleDegrees(points: MeshPoint[]): number {
  let maxAngle = 0
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const ux = b.x - a.x
    const uy = b.y - a.y
    const vx = c.x - b.x
    const vy = c.y - b.y
    const uLen = Math.hypot(ux, uy)
    const vLen = Math.hypot(vx, vy)
    if (uLen < 0.001 || vLen < 0.001) continue
    const dot = (ux * vx + uy * vy) / (uLen * vLen)
    const angle = (Math.acos(clamp(dot, -1, 1)) * 180) / Math.PI
    maxAngle = Math.max(maxAngle, angle)
  }
  return maxAngle
}

function isBetween(value: number, a: number, b: number): boolean {
  return value >= Math.min(a, b) && value <= Math.max(a, b)
}

function overlaps1D(a0: number, a1: number, b0: number, b1: number): boolean {
  return (
    Math.max(Math.min(a0, a1), Math.min(b0, b1)) <
    Math.min(Math.max(a0, a1), Math.max(b0, b1))
  )
}

function hasSelfOverlapOrIntersection(points: MeshPoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a0 = points[i - 1]
    const a1 = points[i]
    const aVertical = a0.x === a1.x
    for (let j = i + 2; j < points.length; j++) {
      if (i === 1 && j === points.length - 1) continue
      const b0 = points[j - 1]
      const b1 = points[j]
      const bVertical = b0.x === b1.x

      if (aVertical === bVertical) {
        if (aVertical) {
          if (a0.x !== b0.x) continue
          if (overlaps1D(a0.y, a1.y, b0.y, b1.y)) return true
        } else {
          if (a0.y !== b0.y) continue
          if (overlaps1D(a0.x, a1.x, b0.x, b1.x)) return true
        }
        continue
      }

      const v0 = aVertical ? a0 : b0
      const v1 = aVertical ? a1 : b1
      const h0 = aVertical ? b0 : a0
      const h1 = aVertical ? b1 : a1
      if (
        isBetween(v0.x, h0.x, h1.x) &&
        isBetween(h0.y, v0.y, v1.y) &&
        !(v0.x === h0.x && h0.y === v0.y) &&
        !(v0.x === h1.x && h0.y === v1.y)
      ) {
        return true
      }
    }
  }
  return false
}

function pointToSegmentDistance(
  point: MeshPoint,
  a: MeshPoint,
  b: MeshPoint
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 0.0001) return distance(point, a)
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq, 0, 1)
  return distance(point, { x: a.x + dx * t, y: a.y + dy * t })
}

function pathCoverageDistance(
  points: MeshPoint[],
  existingPaths: MeshPoint[][]
): number {
  if (existingPaths.length === 0) return 0
  let total = 0
  let samples = 0
  for (const point of points) {
    let nearest = Number.POSITIVE_INFINITY
    for (const existing of existingPaths) {
      for (let i = 1; i < existing.length; i++) {
        nearest = Math.min(
          nearest,
          pointToSegmentDistance(point, existing[i - 1], existing[i])
        )
      }
    }
    if (Number.isFinite(nearest)) {
      total += nearest
      samples += 1
    }
  }
  return samples > 0 ? total / samples : 0
}

function orientation(a: MeshPoint, b: MeshPoint, c: MeshPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: MeshPoint, b: MeshPoint, c: MeshPoint): boolean {
  return (
    c.x >= Math.min(a.x, b.x) - 0.001 &&
    c.x <= Math.max(a.x, b.x) + 0.001 &&
    c.y >= Math.min(a.y, b.y) - 0.001 &&
    c.y <= Math.max(a.y, b.y) + 0.001
  )
}

function segmentsIntersectOrOverlap(
  a0: MeshPoint,
  a1: MeshPoint,
  b0: MeshPoint,
  b1: MeshPoint
): boolean {
  const o1 = orientation(a0, a1, b0)
  const o2 = orientation(a0, a1, b1)
  const o3 = orientation(b0, b1, a0)
  const o4 = orientation(b0, b1, a1)

  if (
    ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
    ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
  ) {
    return true
  }
  if (Math.abs(o1) < 0.001 && onSegment(a0, a1, b0)) return true
  if (Math.abs(o2) < 0.001 && onSegment(a0, a1, b1)) return true
  if (Math.abs(o3) < 0.001 && onSegment(b0, b1, a0)) return true
  if (Math.abs(o4) < 0.001 && onSegment(b0, b1, a1)) return true
  return false
}

function segmentDistance(
  a0: MeshPoint,
  a1: MeshPoint,
  b0: MeshPoint,
  b1: MeshPoint
): number {
  if (segmentsIntersectOrOverlap(a0, a1, b0, b1)) return 0
  return Math.min(
    pointToSegmentDistance(a0, b0, b1),
    pointToSegmentDistance(a1, b0, b1),
    pointToSegmentDistance(b0, a0, a1),
    pointToSegmentDistance(b1, a0, a1)
  )
}

function pathHitsWheel(
  points: MeshPoint[],
  wheel: MeshWheel,
  margin: number
): boolean {
  for (let i = 1; i < points.length; i++) {
    if (
      pointToSegmentDistance(wheel, points[i - 1], points[i]) <
      wheel.r + margin
    ) {
      return true
    }
  }
  return false
}

function tracksConflict(
  a: MeshPoint[],
  b: MeshPoint[],
  minGap: number
): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentDistance(a[i - 1], a[i], b[j - 1], b[j]) < minGap) {
        return true
      }
    }
  }
  return false
}

function lineIntersection(
  a0: MeshPoint,
  a1: MeshPoint,
  b0: MeshPoint,
  b1: MeshPoint
): MeshPoint | null {
  const ax = a1.x - a0.x
  const ay = a1.y - a0.y
  const bx = b1.x - b0.x
  const by = b1.y - b0.y
  const det = ax * by - ay * bx
  if (Math.abs(det) < 0.0001) return null
  const cx = b0.x - a0.x
  const cy = b0.y - a0.y
  const t = (cx * by - cy * bx) / det
  return { x: a0.x + ax * t, y: a0.y + ay * t }
}

/**
 * Replace Z-shapes (two same-direction segments separated by a short
 * perpendicular step) with a single 45° diagonal. This produces cleaner
 * routing when a corridor only needs to "shift sideways" a little: instead of
 * 90° → tiny step → 90°, we get 45° → diagonal → 45°.
 *
 * Only chamfers when:
 *   - A→B and C→D are EXACTLY same axis-aligned direction
 *   - B→C is a perpendicular step
 *   - The step is short enough to fit within both A→B and C→D
 *   - Step length is at most `maxStep` (otherwise it's a "real" Z, not a
 *     small offset, and a 45° diagonal would look weird)
 */
function chamferZShapes(points: MeshPoint[], maxStep: number): MeshPoint[] {
  if (points.length < 4) return points.slice()
  const out = points.slice()
  let i = 1
  while (i < out.length - 2) {
    const A = out[i - 1]
    const B = out[i]
    const C = out[i + 1]
    const D = out[i + 2]
    const abDx = B.x - A.x
    const abDy = B.y - A.y
    const bcDx = C.x - B.x
    const bcDy = C.y - B.y
    const cdDx = D.x - C.x
    const cdDy = D.y - C.y
    const abLen = Math.hypot(abDx, abDy)
    const bcLen = Math.hypot(bcDx, bcDy)
    const cdLen = Math.hypot(cdDx, cdDy)
    if (abLen < 0.01 || bcLen < 0.01 || cdLen < 0.01) {
      i += 1
      continue
    }
    const sameDir =
      Math.abs(abDx / abLen - cdDx / cdLen) < 0.001 &&
      Math.abs(abDy / abLen - cdDy / cdLen) < 0.001
    const perp = Math.abs(abDx * bcDx + abDy * bcDy) < 0.001
    if (!sameDir || !perp || bcLen > maxStep) {
      i += 1
      continue
    }
    // True 45° chamfer: shift back/forward along the run by HALF the
    // perpendicular step so the diagonal is at 45° (equal along & perp
    // components). Shifting by the full step would produce a shallower
    // ~27° turn (2:1 along:perp), which gives less corner headroom.
    const shift = bcLen / 2
    if (shift >= abLen || shift >= cdLen) {
      i += 1
      continue
    }
    const inDirX = abDx / abLen
    const inDirY = abDy / abLen
    const outDirX = cdDx / cdLen
    const outDirY = cdDy / cdLen
    out[i] = { x: B.x - inDirX * shift, y: B.y - inDirY * shift }
    out[i + 1] = { x: C.x + outDirX * shift, y: C.y + outDirY * shift }
    i += 2
  }
  return out
}

function offsetPolyline(points: MeshPoint[], offset: number): MeshPoint[] {
  if (Math.abs(offset) < 0.0001 || points.length <= 1) return points.slice()

  const segments = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 0.0001) continue
    const nx = -dy / len
    const ny = dx / len
    segments.push({
      a: { x: a.x + nx * offset, y: a.y + ny * offset },
      b: { x: b.x + nx * offset, y: b.y + ny * offset },
    })
  }
  if (segments.length === 0) return points.slice()

  const out: MeshPoint[] = [segments[0].a]
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]
    const next = segments[i]
    const hit = lineIntersection(prev.a, prev.b, next.a, next.b)
    out.push(hit ?? prev.b)
  }
  out.push(segments[segments.length - 1].b)
  return out
}

function buildRoundedPath(points: MeshPoint[], radius: number): string {
  if (points.length === 0) return ``
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }

  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inLen = distance(prev, cur)
    const outLen = distance(cur, next)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const inDx = (cur.x - prev.x) / (inLen || 1)
    const inDy = (cur.y - prev.y) / (inLen || 1)
    const outDx = (next.x - cur.x) / (outLen || 1)
    const outDy = (next.y - cur.y) / (outLen || 1)
    const p1 = { x: cur.x - inDx * r, y: cur.y - inDy * r }
    const p2 = { x: cur.x + outDx * r, y: cur.y + outDy * r }
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

export function pointAtDistance(
  points: MeshPoint[],
  distanceAlong: number
): { x: number; y: number; angle: number } {
  if (points.length === 0) return { x: 0, y: 0, angle: 0 }
  if (points.length === 1) return { x: points[0].x, y: points[0].y, angle: 0 }

  let remaining = distanceAlong
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const segLen = distance(a, b)
    if (remaining <= segLen || i === points.length - 1) {
      const t = segLen === 0 ? 0 : clamp(remaining / segLen, 0, 1)
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      }
    }
    remaining -= segLen
  }

  const a = points[points.length - 2]
  const b = points[points.length - 1]
  return {
    x: b.x,
    y: b.y,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

export function sampleAlongTrack(
  track: MeshTrack,
  fraction: number
): { x: number; y: number; angle: number } {
  const wrapped = ((fraction % 1) + 1) % 1
  return sampleAlongRenderedPath(track.segments, track.length, wrapped)
}

export function sampleAlongRenderedPath(
  segments: readonly RenderedPathSegment[],
  totalLength: number,
  fraction: number
): { x: number; y: number; angle: number } {
  if (segments.length === 0 || totalLength <= 0) {
    return { x: 0, y: 0, angle: 0 }
  }
  let target = fraction * totalLength
  // Walk segments until we find the one containing `target`.
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (target <= seg.length || i === segments.length - 1) {
      const t = seg.length === 0 ? 0 : clamp(target / seg.length, 0, 1)
      if (seg.kind === `line`) {
        return {
          x: lerp(seg.x0, seg.x1, t),
          y: lerp(seg.y0, seg.y1, t),
          angle: Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0),
        }
      }
      // arc: interpolate angle from a0 -> a1 in the correct direction.
      let delta = seg.a1 - seg.a0
      if (seg.ccw) {
        // Counterclockwise (canvas convention with y-down): delta should be negative.
        if (delta > 0) delta -= Math.PI * 2
      } else {
        if (delta < 0) delta += Math.PI * 2
      }
      const angle = seg.a0 + delta * t
      return {
        x: seg.cx + Math.cos(angle) * seg.r,
        y: seg.cy + Math.sin(angle) * seg.r,
        // Tangent direction at this point on the arc: perpendicular to the
        // radius, in the direction of travel.
        angle: angle + (seg.ccw ? -Math.PI / 2 : Math.PI / 2),
      }
    }
    target -= seg.length
  }
  // Fallback (shouldn't reach here)
  const last = segments[segments.length - 1]
  if (last.kind === `line`) {
    return {
      x: last.x1,
      y: last.y1,
      angle: Math.atan2(last.y1 - last.y0, last.x1 - last.x0),
    }
  }
  return {
    x: last.cx + Math.cos(last.a1) * last.r,
    y: last.cy + Math.sin(last.a1) * last.r,
    angle: last.a1 + (last.ccw ? -Math.PI / 2 : Math.PI / 2),
  }
}

// Builds the same line+arc primitives that the canvas renderer draws via
// arcTo, so we can sample along the rounded path. Mirrors the per-corner
// clamping (`min(requested, inLen/2, outLen/2)`) used by traceLineArcPath.
export function buildRenderedPathSegments(
  points: readonly MeshPoint[],
  corners: readonly MeshCornerArc[] | undefined,
  fallbackRadius: number
): RenderedPathSegment[] {
  const out: RenderedPathSegment[] = []
  if (points.length < 2) return out

  type CornerArcGeom = {
    tangentInX: number
    tangentInY: number
    tangentOutX: number
    tangentOutY: number
    cx: number
    cy: number
    r: number
    a0: number
    a1: number
    ccw: boolean
    arcLen: number
  }

  // Pre-compute arc geometry per interior point (null if no arc).
  const arcs: (CornerArcGeom | null)[] = new Array(points.length).fill(null)
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inDx = cur.x - prev.x
    const inDy = cur.y - prev.y
    const outDx = next.x - cur.x
    const outDy = next.y - cur.y
    const inLen = Math.hypot(inDx, inDy)
    const outLen = Math.hypot(outDx, outDy)
    if (inLen < 0.001 || outLen < 0.001) continue
    const inUx = inDx / inLen
    const inUy = inDy / inLen
    const outUx = outDx / outLen
    const outUy = outDy / outLen
    const cross = inUx * outUy - inUy * outUx
    const dot = inUx * outUx + inUy * outUy
    const corner = corners?.[i]
    const requested =
      corner && corner.radius > 0 ? corner.radius : fallbackRadius
    if (Math.abs(cross) < 0.001 || requested <= 0.001) continue
    // Match the renderer's clamp.
    const r = Math.max(0.5, Math.min(requested, inLen / 2, outLen / 2))
    // Exterior turn angle (between inbound direction and outbound direction).
    const turnExt = Math.atan2(Math.abs(cross), dot)
    // Distance from corner vertex to each tangent point along the segments:
    //   d = r / tan((π - turnExt)/2) = r * tan(turnExt/2)
    const d = r * Math.tan(turnExt / 2)
    const tangentInX = cur.x - inUx * d
    const tangentInY = cur.y - inUy * d
    const tangentOutX = cur.x + outUx * d
    const tangentOutY = cur.y + outUy * d
    // Arc center: along the bisector of the INTERIOR angle (from cur, between
    // -inU and +outU), at distance h = r / cos(turnExt/2).
    const bisX = -inUx + outUx
    const bisY = -inUy + outUy
    const bisLen = Math.hypot(bisX, bisY)
    if (bisLen < 0.001) continue
    const h = r / Math.cos(turnExt / 2)
    const cx = cur.x + (bisX / bisLen) * h
    const cy = cur.y + (bisY / bisLen) * h
    const a0 = Math.atan2(tangentInY - cy, tangentInX - cx)
    const a1 = Math.atan2(tangentOutY - cy, tangentOutX - cx)
    // In canvas y-down coords:
    //   cross > 0  → outU is rotated CW from inU  → right turn on screen
    //                → arc sweeps clockwise on screen → counterclockwise=false
    //   cross < 0  → left turn → arc sweeps counterclockwise on screen
    //                → counterclockwise=true
    const ccw = cross < 0
    arcs[i] = {
      tangentInX,
      tangentInY,
      tangentOutX,
      tangentOutY,
      cx,
      cy,
      r,
      a0,
      a1,
      ccw,
      arcLen: r * turnExt,
    }
  }

  // Walk through, emitting line segments between arcs (or endpoints) and
  // arc segments at each corner that has one.
  let curX = points[0].x
  let curY = points[0].y
  for (let i = 1; i < points.length; i++) {
    const arc = arcs[i]
    let lineEndX: number
    let lineEndY: number
    if (arc) {
      lineEndX = arc.tangentInX
      lineEndY = arc.tangentInY
    } else {
      lineEndX = points[i].x
      lineEndY = points[i].y
    }
    const lineLen = Math.hypot(lineEndX - curX, lineEndY - curY)
    if (lineLen > 0.001) {
      out.push({
        kind: `line`,
        x0: curX,
        y0: curY,
        x1: lineEndX,
        y1: lineEndY,
        length: lineLen,
      })
    }
    if (arc) {
      out.push({
        kind: `arc`,
        cx: arc.cx,
        cy: arc.cy,
        r: arc.r,
        a0: arc.a0,
        a1: arc.a1,
        ccw: arc.ccw,
        length: arc.arcLen,
      })
      curX = arc.tangentOutX
      curY = arc.tangentOutY
    } else {
      curX = lineEndX
      curY = lineEndY
    }
  }
  return out
}

export function renderedPathLength(
  segments: readonly RenderedPathSegment[]
): number {
  let total = 0
  for (const seg of segments) total += seg.length
  return total
}

export function trackPath(points: MeshPoint[], radius: number): string {
  return buildRoundedPath(points, radius)
}

export function createMeshScene(options: MeshSceneOptions): MeshScene {
  const width = Math.max(320, Math.round(options.width))
  const height = Math.max(320, Math.round(options.height))
  const seed = hashSeed(options.seed)
  const random = mulberry32(seed)
  const grid = clamp(Math.round(options.gridSize), 18, 60)
  const routePadding = clamp(Math.round(options.routePadding), 0, 3)
  const connectionDensity = clamp(options.connectionDensity, 0, 1)
  const cornerRadius = Math.max(0, options.cornerRadius)

  const layoutScale =
    options.layout === `dense`
      ? 0.82
      : options.layout === `sparse`
        ? 1.1
        : options.layout === `square`
          ? 1.02
          : 1

  const margin = Math.max(54, Math.round(Math.min(width, height) * 0.068))
  const usableWidth = Math.max(100, width - margin * 2)
  const usableHeight = Math.max(100, height - margin * 2)
  const radiusScale = Math.min(width, height) / 900
  const radiusTiers = [
    Math.round(82 * radiusScale * layoutScale),
    Math.round(68 * radiusScale * layoutScale),
    Math.round(56 * radiusScale * layoutScale),
    Math.round(44 * radiusScale * layoutScale),
  ].map((r) => clamp(r, 28, 130))

  const anchors: WheelAnchor[] =
    options.layout === `square`
      ? [
          { x: 0.5, y: 0.5, tier: 0 },
          { x: 0.26, y: 0.26, tier: 1 },
          { x: 0.74, y: 0.28, tier: 1 },
          { x: 0.28, y: 0.74, tier: 1 },
          { x: 0.72, y: 0.74, tier: 1 },
          { x: 0.5, y: 0.18, tier: 2 },
          { x: 0.18, y: 0.52, tier: 2 },
          { x: 0.82, y: 0.5, tier: 2 },
          { x: 0.52, y: 0.84, tier: 2 },
        ]
      : [
          { x: 0.52, y: 0.5, tier: 0 },
          { x: 0.2, y: 0.34, tier: 1 },
          { x: 0.78, y: 0.35, tier: 1 },
          { x: 0.18, y: 0.7, tier: 1 },
          { x: 0.82, y: 0.68, tier: 1 },
          { x: 0.37, y: 0.2, tier: 2 },
          { x: 0.62, y: 0.18, tier: 2 },
          { x: 0.37, y: 0.82, tier: 2 },
          { x: 0.64, y: 0.82, tier: 2 },
          { x: 0.08, y: 0.5, tier: 3 },
          { x: 0.92, y: 0.5, tier: 3 },
        ]

  const targetCount = clamp(Math.round(options.wheelCount), 4, 18)
  const wheels: MeshWheel[] = []
  const minGap = Math.max(12, Math.round(grid * 0.72))

  function canPlace(x: number, y: number, r: number): boolean {
    if (x - r < margin || x + r > width - margin) return false
    if (y - r < margin || y + r > height - margin) return false
    for (const wheel of wheels) {
      if (distance({ x, y }, wheel) < r + wheel.r + minGap) return false
    }
    return true
  }

  for (let i = 0; i < anchors.length && wheels.length < targetCount; i++) {
    const anchor = anchors[i]
    const baseX = margin + anchor.x * usableWidth
    const baseY = margin + anchor.y * usableHeight
    const r = radiusTiers[Math.min(anchor.tier, radiusTiers.length - 1)]

    let placed = false
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const jitterMul = attempt === 0 ? 0 : 0.025 + attempt * 0.01
      const x = nearestGrid(
        baseX + (random() - 0.5) * usableWidth * jitterMul,
        grid
      )
      const y = nearestGrid(
        baseY + (random() - 0.5) * usableHeight * jitterMul,
        grid
      )
      if (!canPlace(x, y, r)) continue
      wheels.push({
        id: `wheel-${wheels.length}`,
        x,
        y,
        r,
        innerR: Math.max(14, r * 0.58),
        segmentCount: 16,
        rotationRate: (0.08 + random() * 0.18) * (random() < 0.5 ? -1 : 1),
        rotationOffset: random() * Math.PI * 2,
        segmentOffset: random() * Math.PI * 2,
      })
      placed = true
    }
  }

  const fallbackCandidates: MeshPoint[] = []
  for (let x = margin; x <= width - margin; x += grid) {
    for (let y = margin; y <= height - margin; y += grid) {
      fallbackCandidates.push({ x, y })
    }
  }
  shuffleInPlace(fallbackCandidates, random)

  for (const candidate of fallbackCandidates) {
    if (wheels.length >= targetCount) break
    const tier = Math.floor(random() * radiusTiers.length)
    const r = radiusTiers[tier]
    if (!canPlace(candidate.x, candidate.y, r)) continue
    wheels.push({
      id: `wheel-${wheels.length}`,
      x: candidate.x,
      y: candidate.y,
      r,
      innerR: Math.max(14, r * 0.58),
      segmentCount: 16,
      rotationRate: (0.08 + random() * 0.18) * (random() < 0.5 ? -1 : 1),
      rotationOffset: random() * Math.PI * 2,
      segmentOffset: random() * Math.PI * 2,
    })
  }

  function anglePoint(wheel: MeshWheel, angle: number, offset = 0): MeshPoint {
    return {
      x: wheel.x + Math.cos(angle) * (wheel.r + offset),
      y: wheel.y + Math.sin(angle) * (wheel.r + offset),
    }
  }

  function guideOffset(offsetFromCenter = 0): number {
    return Math.max(
      grid * 1.15,
      cornerRadius * 1.4,
      Math.abs(offsetFromCenter) + laneSpacing * 1.25
    )
  }

  // Every wheel pair is a candidate corridor; the placement loop below
  // saturates the canvas by trying each pair repeatedly until conflict
  // detection refuses any more bundles.
  const edges: CandidateEdge[] = []
  for (let i = 0; i < wheels.length; i++) {
    for (let j = i + 1; j < wheels.length; j++) {
      edges.push({ a: i, b: j, distance: distance(wheels[i], wheels[j]) })
    }
  }
  edges.sort((a, b) => a.distance - b.distance)

  function snapCoord(value: number): number {
    return nearestGrid(value, grid)
  }

  function makeRouteCandidates(
    startGuide: MeshPoint,
    endGuide: MeshPoint
  ): MeshPoint[][] {
    const candidates: MeshPoint[][] = []
    // No bare [startGuide, endGuide] shortcut: when guides are only NEARLY
    // axis-aligned, that 2-point candidate (wrapped with wheel-edge points
    // that lie on the line of sight between wheel centers) becomes fully
    // collinear and collapses to a slanted 2-point segment — visually a
    // diagonal track running through the wheel-axis. The HVH/VHV variants
    // below collapse cleanly to a true 2-point straight line when guides
    // ARE axis-aligned, so we don't lose anything in that case.
    //
    // For nearly-aligned wheel pairs we DO want a clean straight track,
    // though: emit a 2-point candidate at the AVERAGED Y (or X) so the
    // resulting polyline is truly horizontal (or vertical). Lane
    // construction's lineCircleEntry then finds the wheel-edge entry along
    // that axis-aligned direction, producing a clean stripe rather than a
    // slanted line of sight.
    const guideDx = endGuide.x - startGuide.x
    const guideDy = endGuide.y - startGuide.y
    if (Math.abs(guideDy) < grid * 0.5 && Math.abs(guideDx) > grid * 1.5) {
      const y = (startGuide.y + endGuide.y) / 2
      candidates.push([
        { x: startGuide.x, y },
        { x: endGuide.x, y },
      ])
    }
    if (Math.abs(guideDx) < grid * 0.5 && Math.abs(guideDy) > grid * 1.5) {
      const x = (startGuide.x + endGuide.x) / 2
      candidates.push([
        { x, y: startGuide.y },
        { x, y: endGuide.y },
      ])
    }
    candidates.push([startGuide, { x: endGuide.x, y: startGuide.y }, endGuide])
    candidates.push([startGuide, { x: startGuide.x, y: endGuide.y }, endGuide])
    const midX = snapCoord((startGuide.x + endGuide.x) / 2)
    const midY = snapCoord((startGuide.y + endGuide.y) / 2)
    const quarterXs = [
      snapCoord(startGuide.x * 0.75 + endGuide.x * 0.25),
      midX,
      snapCoord(startGuide.x * 0.25 + endGuide.x * 0.75),
    ]
    const quarterYs = [
      snapCoord(startGuide.y * 0.75 + endGuide.y * 0.25),
      midY,
      snapCoord(startGuide.y * 0.25 + endGuide.y * 0.75),
    ]
    const boundaryXs = [snapCoord(grid * 3), snapCoord(width - grid * 3)]
    const boundaryYs = [snapCoord(grid * 3), snapCoord(height - grid * 3)]
    candidates.push([
      startGuide,
      { x: midX, y: startGuide.y },
      { x: midX, y: endGuide.y },
      endGuide,
    ])
    candidates.push([
      startGuide,
      { x: startGuide.x, y: midY },
      { x: endGuide.x, y: midY },
      endGuide,
    ])
    for (const x of quarterXs) {
      candidates.push([
        startGuide,
        { x, y: startGuide.y },
        { x, y: endGuide.y },
        endGuide,
      ])
    }
    for (const y of quarterYs) {
      candidates.push([
        startGuide,
        { x: startGuide.x, y },
        { x: endGuide.x, y },
        endGuide,
      ])
    }
    for (const x of boundaryXs) {
      candidates.push([
        startGuide,
        { x, y: startGuide.y },
        { x, y: endGuide.y },
        endGuide,
      ])
    }
    for (const y of boundaryYs) {
      candidates.push([
        startGuide,
        { x: startGuide.x, y },
        { x: endGuide.x, y },
        endGuide,
      ])
    }

    // 4-segment "pan" candidates: H V H V (or V H V H).
    //   A ──────┐                   D
    //           │                   │
    //           └───────────────────┘
    // Asymmetric: one wheel leaves along the wheel-axis (the short "handle"),
    // detours perpendicular, runs a long parallel section (the "pan body"),
    // and enters the other wheel from a perpendicular direction. The two
    // orientations below cover both choices of which end is which.
    const panHandleH = Math.max(
      grid * 1.2,
      Math.abs(endGuide.x - startGuide.x) * 0.12
    )
    const panHandleV = Math.max(
      grid * 1.2,
      Math.abs(endGuide.y - startGuide.y) * 0.12
    )

    // HVHV "horizontal-axis" pan: short H handle out of A, V drop, long H
    // across at panY, V into D.
    {
      const panDirX =
        Math.abs(endGuide.x - startGuide.x) < 0.5
          ? 1
          : Math.sign(endGuide.x - startGuide.x)
      const panMx1 = snapCoord(startGuide.x + panDirX * panHandleH)
      if (Math.abs(endGuide.x - panMx1) > grid * 0.6) {
        const panYs = [
          snapCoord(grid * 3),
          snapCoord(height - grid * 3),
          snapCoord((startGuide.y + endGuide.y) / 2 + grid * 4),
          snapCoord((startGuide.y + endGuide.y) / 2 - grid * 4),
        ]
        for (const panY of panYs) {
          if (
            Math.abs(panY - startGuide.y) < grid * 1.5 ||
            Math.abs(panY - endGuide.y) < grid * 1.5
          ) {
            continue
          }
          // A enters horizontally, D enters vertically.
          candidates.push([
            startGuide,
            { x: panMx1, y: startGuide.y },
            { x: panMx1, y: panY },
            { x: endGuide.x, y: panY },
            endGuide,
          ])
          // Mirror: A enters vertically, D enters horizontally.
          const panMx2 = snapCoord(endGuide.x - panDirX * panHandleH)
          if (Math.abs(panMx2 - startGuide.x) > grid * 0.6) {
            candidates.push([
              startGuide,
              { x: startGuide.x, y: panY },
              { x: panMx2, y: panY },
              { x: panMx2, y: endGuide.y },
              endGuide,
            ])
          }
        }
      }
    }

    // VHVH "vertical-axis" pan: short V handle out of A, H jog, long V across
    // at panX, H into D.
    {
      const panDirY =
        Math.abs(endGuide.y - startGuide.y) < 0.5
          ? 1
          : Math.sign(endGuide.y - startGuide.y)
      const panMy1 = snapCoord(startGuide.y + panDirY * panHandleV)
      if (Math.abs(endGuide.y - panMy1) > grid * 0.6) {
        const panXs = [
          snapCoord(grid * 3),
          snapCoord(width - grid * 3),
          snapCoord((startGuide.x + endGuide.x) / 2 + grid * 4),
          snapCoord((startGuide.x + endGuide.x) / 2 - grid * 4),
        ]
        for (const panX of panXs) {
          if (
            Math.abs(panX - startGuide.x) < grid * 1.5 ||
            Math.abs(panX - endGuide.x) < grid * 1.5
          ) {
            continue
          }
          // A enters vertically, D enters horizontally.
          candidates.push([
            startGuide,
            { x: startGuide.x, y: panMy1 },
            { x: panX, y: panMy1 },
            { x: panX, y: endGuide.y },
            endGuide,
          ])
          // Mirror: A enters horizontally, D enters vertically.
          const panMy2 = snapCoord(endGuide.y - panDirY * panHandleV)
          if (Math.abs(panMy2 - startGuide.y) > grid * 0.6) {
            candidates.push([
              startGuide,
              { x: panX, y: startGuide.y },
              { x: panX, y: panMy2 },
              { x: endGuide.x, y: panMy2 },
              endGuide,
            ])
          }
        }
      }
    }

    return candidates.map((points) =>
      normalizePolyline(simplifyPolyline(points))
    )
  }

  // Local-only variant of makeRouteCandidates used as a last-resort fallback
  // for very close wheel pairs whose normal guides would produce U-turns or
  // sub-grid segments. Emits ONLY routes whose interior points sit within (or
  // very near) the bounding box of start/end — no boundary detours, no pan
  // shapes — so the resulting tracks are short HVH/VHV dog-legs rather than
  // visually jarring loops out to the canvas edge.
  function makeLocalRouteCandidates(
    startGuide: MeshPoint,
    endGuide: MeshPoint
  ): MeshPoint[][] {
    const candidates: MeshPoint[][] = []
    // Nearly-axis-aligned wheel pair: emit a clean straight track at the
    // averaged Y (or X). Wrapping with line-of-sight wheel-edge points would
    // give a slanted path; the lane construction's lineCircleEntry instead
    // computes the wheel-edge entry along this 2-point candidate's direction,
    // producing a true axis-aligned stripe.
    const dx = endGuide.x - startGuide.x
    const dy = endGuide.y - startGuide.y
    if (Math.abs(dy) < grid * 0.5 && Math.abs(dx) > grid * 1.5) {
      const y = (startGuide.y + endGuide.y) / 2
      candidates.push([
        { x: startGuide.x, y },
        { x: endGuide.x, y },
      ])
    }
    if (Math.abs(dx) < grid * 0.5 && Math.abs(dy) > grid * 1.5) {
      const x = (startGuide.x + endGuide.x) / 2
      candidates.push([
        { x, y: startGuide.y },
        { x, y: endGuide.y },
      ])
    }
    candidates.push([startGuide, { x: endGuide.x, y: startGuide.y }, endGuide])
    candidates.push([startGuide, { x: startGuide.x, y: endGuide.y }, endGuide])
    const midX = snapCoord((startGuide.x + endGuide.x) / 2)
    const midY = snapCoord((startGuide.y + endGuide.y) / 2)
    candidates.push([
      startGuide,
      { x: midX, y: startGuide.y },
      { x: midX, y: endGuide.y },
      endGuide,
    ])
    candidates.push([
      startGuide,
      { x: startGuide.x, y: midY },
      { x: endGuide.x, y: midY },
      endGuide,
    ])
    return candidates.map((points) =>
      normalizePolyline(simplifyPolyline(points))
    )
  }

  function validateTrackPoints(
    points: MeshPoint[],
    fromWheel: MeshWheel,
    toWheel: MeshWheel
  ): boolean {
    const simplified = normalizePolyline(simplifyPolyline(points))
    if (turnCount(simplified) > 6) return false
    if (maxTurnAngleDegrees(simplified) > 90.001) return false
    if (hasSelfOverlapOrIntersection(simplified)) return false
    const directDistance = distance(fromWheel, toWheel)
    const length = polylineLength(simplified)
    const segmentFloor = Math.max(grid * 0.45, cornerRadius + 2)
    if (minSegmentLength(simplified) < segmentFloor) return false
    if (directDistance > 0 && length / directDistance > 3.1) return false
    for (const wheel of wheels) {
      if (wheel.id === fromWheel.id || wheel.id === toWheel.id) continue
      if (
        pathHitsWheel(simplified, wheel, Math.max(8, routePadding * grid * 0.5))
      ) {
        return false
      }
    }
    return true
  }

  const tracks: MeshTrack[] = []
  // Hard cap on per-side bundle expansion. Real expansion is gated by
  // conflict detection (sibling lanes and previously-accepted tracks); this
  // ceiling just stops runaway growth on completely empty canvases. Each
  // side of the bundle expands INDEPENDENTLY against this cap, so a bundle
  // can be e.g. 1 lane on one side and 12 on the other if that's where the
  // free space happens to be.
  const maxBundleHalfWidth = Math.max(6, Math.round(6 + connectionDensity * 18))
  const laneSpacing = Math.max(8, grid * 0.38)
  const acceptedTrackPointSets: MeshPoint[][] = []
  const wheelDegree = wheels.map(() => 0)
  const pairUsage = new Map<string, number>()
  const minCorridorsPerWheel = Math.max(
    5,
    4 + Math.round(connectionDensity * 3)
  )

  type Lane = { points: MeshPoint[]; corners: MeshCornerArc[]; offset: number }

  function tryPlaceBundle(edge: CandidateEdge): Lane[] | null {
    const fromWheel = wheels[edge.a]
    const toWheel = wheels[edge.b]
    const startAngle = Math.atan2(
      toWheel.y - fromWheel.y,
      toWheel.x - fromWheel.x
    )
    const endAngle = Math.atan2(
      fromWheel.y - toWheel.y,
      fromWheel.x - toWheel.x
    )
    const centerStartPoint = anglePoint(fromWheel, startAngle, 0)
    const centerStartGuide = anglePoint(fromWheel, startAngle, guideOffset(0))
    const centerEndGuide = anglePoint(toWheel, endAngle, guideOffset(0))
    const centerEndPoint = anglePoint(toWheel, endAngle, 0)

    // For very close wheel pairs the offset guides either cross past each
    // other (forcing a U-turn) or sit too close together to fit any HVH
    // detour without sub-grid segments. In those cases we route between the
    // wheel-edge points directly using a SMALL set of LOCAL HVH/VHV variants
    // (no canvas-boundary detours, no pan shapes). The full makeRouteCandidates
    // output would happily synthesise a U-shape that runs all the way up to
    // the canvas edge for a pair of adjacent wheels — visually awful and not
    // the intent of the fallback, which is just "find the shortest sensible
    // PCB route between these two close edges".
    const guideAxis = {
      x: centerEndGuide.x - centerStartGuide.x,
      y: centerEndGuide.y - centerStartGuide.y,
    }
    const wheelAxis = {
      x: toWheel.x - fromWheel.x,
      y: toWheel.y - fromWheel.y,
    }
    const guidesCrossed =
      guideAxis.x * wheelAxis.x + guideAxis.y * wheelAxis.y <= 0
    const guideSeparation = Math.hypot(guideAxis.x, guideAxis.y)
    const segmentFloorEstimate = Math.max(grid * 0.45, cornerRadius + 2)
    const guidesTooClose = guideSeparation < segmentFloorEstimate * 1.5
    const rawCandidates: MeshPoint[][] = [
      ...makeRouteCandidates(centerStartGuide, centerEndGuide),
    ]
    if (guidesCrossed || guidesTooClose) {
      rawCandidates.push(
        ...makeLocalRouteCandidates(centerStartPoint, centerEndPoint)
      )
    }
    // For validation we need wheel-edge entry/exit points along the actual
    // CORE direction (matching what the lane will do via lineCircleEntry),
    // not along the line-of-sight from wheel-to-wheel. Without this, a
    // nearly-axis-aligned core that the lane would render as a clean
    // horizontal stripe gets validated as a slanted polyline (the
    // line-of-sight wheel-edge points sit at slightly different Y values),
    // and either (a) gets falsely rejected for a sub-grid kink, or (b) gets
    // collapsed by simplifyPolyline into a single off-axis 2-point segment.
    function entryAlongCoreDir(
      coreFirst: MeshPoint,
      coreSecond: MeshPoint,
      wheel: MeshWheel
    ): MeshPoint {
      const dx = coreSecond.x - coreFirst.x
      const dy = coreSecond.y - coreFirst.y
      const len = Math.hypot(dx, dy)
      if (len < 0.0001) return coreFirst
      const dir = { x: dx / len, y: dy / len }
      const wx = coreFirst.x - wheel.x
      const wy = coreFirst.y - wheel.y
      const b = 2 * (wx * dir.x + wy * dir.y)
      const c = wx * wx + wy * wy - wheel.r * wheel.r
      const disc = b * b - 4 * c
      if (disc < 0) return coreFirst
      const sq = Math.sqrt(disc)
      const t1 = (-b - sq) / 2
      const t2 = (-b + sq) / 2
      // Pick the intersection closest to coreFirst. This covers all three
      // configurations: coreFirst outside the wheel (both t negative, want
      // closer-to-c0 = least negative), coreFirst exactly on the circle
      // (one t≈0, want that one), and coreFirst on the far side (both t
      // positive, want least positive).
      const t = Math.abs(t1) < Math.abs(t2) ? t1 : t2
      return { x: coreFirst.x + t * dir.x, y: coreFirst.y + t * dir.y }
    }
    const routeCandidates = rawCandidates
      .map((rawCore) => {
        // Chamfer small Z-shapes (lateral shifts) into 45° diagonals so we get
        // a cleaner stretched corner rather than two 90° corners and a short
        // perpendicular nubbin between them.
        const core = chamferZShapes(
          rawCore,
          Math.max(grid * 0.9, laneSpacing * 2.4)
        )
        const startEntry =
          core.length >= 2
            ? entryAlongCoreDir(core[0], core[1], fromWheel)
            : centerStartPoint
        const endEntry =
          core.length >= 2
            ? entryAlongCoreDir(
                core[core.length - 1],
                core[core.length - 2],
                toWheel
              )
            : centerEndPoint
        const full = normalizePolyline([startEntry, ...core, endEntry])
        const coverageScore =
          acceptedTrackPointSets.length === 0
            ? 0
            : pathCoverageDistance(full, acceptedTrackPointSets)
        return {
          core,
          full,
          score:
            polylineLength(full) +
            turnCount(full) * grid * 0.35 +
            maxTurnAngleDegrees(full) * 0.25 -
            coverageScore * 2.1,
        }
      })
      .filter((candidate) =>
        validateTrackPoints(candidate.full, fromWheel, toWheel)
      )
      .sort((a, b) => a.score - b.score)

    let bestBundle: Lane[] | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const chosen of routeCandidates) {
      // The first and last segments of the corridor define the directions in
      // which lanes approach (and leave) the wheels. Every lane in the bundle
      // travels parallel to these directions; the lanes simply touch the wheel
      // circumference at whatever point those parallel lines intersect it.
      if (chosen.core.length < 2) continue
      const startSegDx = chosen.core[1]
        ? chosen.core[1].x - chosen.core[0].x
        : 0
      const startSegDy = chosen.core[1]
        ? chosen.core[1].y - chosen.core[0].y
        : 0
      const endIdx = chosen.core.length - 1
      const endSegDx = chosen.core[endIdx].x - chosen.core[endIdx - 1].x
      const endSegDy = chosen.core[endIdx].y - chosen.core[endIdx - 1].y
      const startSegLen = Math.hypot(startSegDx, startSegDy)
      const endSegLen = Math.hypot(endSegDx, endSegDy)
      if (startSegLen < 0.01 || endSegLen < 0.01) continue
      // startU points AWAY from fromWheel (along the first corridor segment).
      const startU = {
        x: startSegDx / startSegLen,
        y: startSegDy / startSegLen,
      }
      // endU points AWAY from toWheel (= reverse of last corridor segment).
      const endU = { x: -endSegDx / endSegLen, y: -endSegDy / endSegLen }

      // Find the point on the line through `point` in direction `dir` that
      // lies on the circle around `wheel`. Returns the intersection closest
      // to `point` so we don't accidentally cross the wheel and emerge on the
      // far side (which used to happen when `point` was already on or inside
      // the circle and the previous "always pick negative t" rule selected
      // the t = -2r intersection).
      function lineCircleEntry(
        point: MeshPoint,
        dir: { x: number; y: number },
        wheel: MeshWheel
      ): MeshPoint | null {
        const wx = point.x - wheel.x
        const wy = point.y - wheel.y
        const b = 2 * (wx * dir.x + wy * dir.y)
        const c = wx * wx + wy * wy - wheel.r * wheel.r
        const disc = b * b - 4 * c
        if (disc < 0) return null
        const sq = Math.sqrt(disc)
        const t1 = (-b - sq) / 2
        const t2 = (-b + sq) / 2
        const t = Math.abs(t1) < Math.abs(t2) ? t1 : t2
        return { x: point.x + t * dir.x, y: point.y + t * dir.y }
      }

      // Per centerline corner, capture the geometry we'll need to assign arc
      // radii once the bundle size is known. We DON'T pre-pick a radius here:
      // routing is planned without rounding, then radii are filled in below.
      interface CornerGeom {
        turnSign: number
        inLen: number
        outLen: number
        tanHalf: number
        // True for ~45° chamfer corners (chamferZShapes produces these). At
        // these corners we don't try to be concentric: we just give every
        // lane a fixed small radius (= laneSpacing) so the chamfer reads as
        // a softened diagonal regardless of bundle width.
        isChamfer: boolean
        // Whether this corner sits at the FIRST or LAST interior corner; if
        // so, the segment toward the wheel-side guide can use its full length
        // (no neighboring corner consuming part of it).
        isFirstInterior: boolean
        isLastInterior: boolean
      }
      const cornerGeometry: (CornerGeom | null)[] = chosen.core.map(
        (_, idx) => {
          if (idx === 0 || idx === chosen.core.length - 1) return null
          const a = chosen.core[idx - 1]
          const b = chosen.core[idx]
          const c = chosen.core[idx + 1]
          const inDx = b.x - a.x
          const inDy = b.y - a.y
          const outDx = c.x - b.x
          const outDy = c.y - b.y
          const inLen = Math.hypot(inDx, inDy)
          const outLen = Math.hypot(outDx, outDy)
          const cross = inDx * outDy - inDy * outDx
          if (Math.abs(cross) < 0.001) return null
          const turnSign = cross > 0 ? 1 : -1
          const dot = inDx * outDx + inDy * outDy
          // External turn angle (0 = straight, π = U-turn).
          const turnExt = Math.atan2(Math.abs(cross), dot)
          const tanHalf = Math.tan(turnExt / 2)
          // 45° chamfer detection: external turn angle is π/4 (~0.785 rad).
          // Use a generous band so floating-point drift doesn't slip through.
          const isChamfer = Math.abs(turnExt - Math.PI / 4) < 0.05
          return {
            turnSign,
            inLen,
            outLen,
            tanHalf,
            isChamfer,
            isFirstInterior: idx === 1,
            isLastInterior: idx === chosen.core.length - 2,
          }
        }
      )

      function buildLane(offset: number): {
        points: MeshPoint[]
        corners: MeshCornerArc[]
        offset: number
      } | null {
        const offsetCore = offsetPolyline(chosen.core, offset)
        if (offsetCore.length < 2) return null
        const c0 = offsetCore[0]
        const cN = offsetCore[offsetCore.length - 1]

        // Lane entry: extend the offset corridor's first segment line back
        // toward fromWheel until it touches the circle. The lane segment
        // (laneStartPoint → c0) is collinear with (c0 → c1), so normalize
        // will collapse them into a single straight entry.
        const laneStartPoint = lineCircleEntry(c0, startU, fromWheel)
        const laneEndPoint = lineCircleEntry(cN, endU, toWheel)
        if (!laneStartPoint || !laneEndPoint) return null

        // Build the raw lane (vertex per centerline vertex plus wheel-edge
        // entry/exit). Corner radii start as 0; they'll be filled in once
        // the bundle is finalized.
        const rawPoints: MeshPoint[] = [
          laneStartPoint,
          ...offsetCore,
          laneEndPoint,
        ]
        const rawCorners: MeshCornerArc[] = rawPoints.map(() => ({ radius: 0 }))

        // Normalize: drop adjacent duplicates and a-b-a backtracks while
        // keeping cornerInfo in sync.
        const lanePoints: MeshPoint[] = []
        const laneCorners: MeshCornerArc[] = []
        for (let i = 0; i < rawPoints.length; i++) {
          const p = rawPoints[i]
          const prev = lanePoints[lanePoints.length - 1]
          if (
            prev &&
            Math.abs(prev.x - p.x) < 0.001 &&
            Math.abs(prev.y - p.y) < 0.001
          ) {
            continue
          }
          lanePoints.push(p)
          laneCorners.push(rawCorners[i])
          while (lanePoints.length >= 3) {
            const a = lanePoints[lanePoints.length - 3]
            const c = lanePoints[lanePoints.length - 1]
            if (Math.abs(a.x - c.x) < 0.001 && Math.abs(a.y - c.y) < 0.001) {
              lanePoints.splice(lanePoints.length - 2, 2)
              laneCorners.splice(laneCorners.length - 2, 2)
              continue
            }
            break
          }
        }
        // Drop interior vertices that are perfectly collinear (the entry/exit
        // segments by construction sit on the same line as their neighbors).
        // These dropped vertices never carried corner data anyway; this keeps
        // lanePoints[k] aligned with chosen.core[k] for k = 1..N-2.
        for (let i = lanePoints.length - 2; i >= 1; i--) {
          const a = lanePoints[i - 1]
          const b = lanePoints[i]
          const c = lanePoints[i + 1]
          const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
          if (Math.abs(cross) < 0.5) {
            lanePoints.splice(i, 1)
            laneCorners.splice(i, 1)
          }
        }

        if (!validateTrackPoints(lanePoints, fromWheel, toWheel)) return null
        // Enforce the global lane-spacing rule against every previously
        // accepted track. Anything closer than ~one lane spacing visually
        // crowds the rendered tracks together (stripes start to merge), so
        // candidate lanes that would violate this are simply rejected and
        // the bundle expansion will try the next outer band instead.
        for (const existing of acceptedTrackPointSets) {
          if (tracksConflict(lanePoints, existing, laneSpacing * 0.95)) {
            return null
          }
        }
        if (laneCorners.length > 0) {
          laneCorners[0] = { radius: 0 }
          laneCorners[laneCorners.length - 1] = { radius: 0 }
        }
        return { points: lanePoints, corners: laneCorners, offset }
      }

      const centerLane = buildLane(0)
      if (!centerLane) continue

      const bundleLanes: Lane[] = [centerLane]
      let expansionScore = 0
      // Asymmetric bundle expansion. Each side grows independently, so a
      // single-track corridor with empty space on one side will keep adding
      // lanes on that side even after the other side has been blocked by
      // an existing bundle. Symmetric "break on first failure" expansion
      // was leaving lots of obvious gaps where extra tracks would clearly
      // have fit.
      let negBlocked = false
      let posBlocked = false
      for (let band = 1; band <= maxBundleHalfWidth; band++) {
        if (negBlocked && posBlocked) break
        const offset = band * laneSpacing
        if (!negBlocked) {
          const negLane = buildLane(-offset)
          if (!negLane) {
            negBlocked = true
          } else {
            let conflict = false
            for (const sibling of bundleLanes) {
              if (
                tracksConflict(
                  negLane.points,
                  sibling.points,
                  laneSpacing * 0.88
                )
              ) {
                conflict = true
                break
              }
            }
            if (conflict) {
              negBlocked = true
            } else {
              bundleLanes.unshift(negLane)
              expansionScore += offset
            }
          }
        }
        if (!posBlocked) {
          const posLane = buildLane(offset)
          if (!posLane) {
            posBlocked = true
          } else {
            let conflict = false
            for (const sibling of bundleLanes) {
              if (
                tracksConflict(
                  posLane.points,
                  sibling.points,
                  laneSpacing * 0.88
                )
              ) {
                conflict = true
                break
              }
            }
            if (conflict) {
              posBlocked = true
            } else {
              bundleLanes.push(posLane)
              expansionScore += offset
            }
          }
        }
      }

      // Now that the bundle is finalized, assign concentric arc radii at each
      // corridor corner. The widest-possible OUTER lane radius is bounded by
      // segment headroom (so its tangent point still fits in its segments).
      // The implied centerline radius is `outerR - halfBundleOffset` and may
      // be NEGATIVE when the bundle is wider than the available headroom —
      // that's fine: it just means the inside lanes will hit the per-lane
      // floor and become near-sharp, exactly as requested:
      //   "few tracks → nice wide radii; short segments or many tracks → tight
      //    inside corner."
      // All lanes share the same arc center per corner because they're
      // perpendicular offsets of the centerline (canvas's arcTo derives the
      // center from the angle bisector, and the bisector is shared across
      // parallel offsets).
      {
        const niceWide = Math.max(cornerRadius, grid * 1.4)
        // Minimum radius for 90°-ish corners. The inside lane of a wide
        // bundle (or any lane on a tightly-packed corner) used to clamp at
        // ~0.5px, which renders as a visually sharp point against the
        // generously-rounded outer lanes. Floor at 1/3 of the lane spacing
        // so even the innermost lane keeps a perceptible curve.
        const minR = laneSpacing / 3
        // virtualCenterR[idx] is the (possibly negative) centerline radius
        // that, combined with the per-lane offset, gives each lane a
        // concentric arc. Per-lane floor is applied below.
        const virtualCenterR: number[] = chosen.core.map(() => 0)
        for (let idx = 1; idx < chosen.core.length - 1; idx++) {
          const geom = cornerGeometry[idx]
          if (!geom) continue
          // Each segment is shared with at most one neighbor corner: reserve
          // half its length for THIS corner (or all of it on a wheel-side
          // segment that has no neighbor corner).
          const inHead = geom.isFirstInterior ? geom.inLen : geom.inLen / 2
          const outHead = geom.isLastInterior ? geom.outLen : geom.outLen / 2
          const headroom = Math.min(inHead, outHead)
          // Largest radius the OUTERMOST lane can wear without its tangent
          // point overshooting the segment.
          const maxOuterR = headroom * geom.tanHalf
          // Bundles can be ASYMMETRIC about the centerline (see expansion
          // loop above). Compute the maximum outer-side extent for THIS
          // particular corner — the outer side of a turn is where
          // turnSign*offset < 0 (the per-lane formula below subtracts
          // turnSign*offset, so negative values produce LARGER radii =
          // outer arcs). Different corners along the same bundle may see
          // different outer extents because turnSign flips between left
          // and right turns.
          let maxOuterOffsetForCorner = 0
          for (const lane of bundleLanes) {
            const sideOffset = -geom.turnSign * lane.offset
            if (sideOffset > maxOuterOffsetForCorner) {
              maxOuterOffsetForCorner = sideOffset
            }
          }
          // Desired outer radius if we got our way: a nice wide centerline
          // arc plus the bundle's outward expansion on this side.
          const desiredOuterR = niceWide + maxOuterOffsetForCorner
          const outerR = Math.min(desiredOuterR, maxOuterR)
          virtualCenterR[idx] = outerR - maxOuterOffsetForCorner
        }
        for (const lane of bundleLanes) {
          for (let k = 1; k < lane.points.length - 1; k++) {
            const geom = cornerGeometry[k]
            if (!geom) {
              lane.corners[k] = { radius: 0 }
              continue
            }
            if (geom.isChamfer) {
              // Simplification at 45° chamfer corners: don't try to be
              // concentric (the diagonal segment is too short to fit
              // meaningfully different per-lane radii). Give every lane the
              // same fixed radius (2× the lane spacing) — enough to visibly
              // soften the corner and stay consistent with the 90° corners'
              // visual weight.
              lane.corners[k] = { radius: laneSpacing * 2 }
              continue
            }
            // Standard 90°-ish corner: lanes whose offset puts them on the
            // OUTSIDE of the turn (sign opposite to turnSign) get the larger
            // radius; INSIDE lanes get smaller (and may clamp to minR for
            // very wide bundles or short segments).
            const r = virtualCenterR[k] - geom.turnSign * lane.offset
            lane.corners[k] = { radius: Math.max(minR, r) }
          }
        }
      }

      const candidateScore =
        chosen.score - bundleLanes.length * grid * 1.8 - expansionScore * 0.08

      if (
        bestBundle === null ||
        bundleLanes.length > bestBundle.length ||
        (bundleLanes.length === bestBundle.length && candidateScore < bestScore)
      ) {
        bestBundle = bundleLanes
        bestScore = candidateScore
      }
    }
    return bestBundle && bestBundle.length >= 1 ? bestBundle : null
  }

  // Keep adding corridors until the canvas is saturated. The naive approach
  // (sort once per pass, then try all edges) leaves outlying wheels orphaned:
  // the closest pairs saturate first, and by the time we get round to a far
  // wheel its routing space is already blocked by other bundles.
  //
  // Instead we run two phases:
  //   1. CONNECT — guarantee every wheel gets at least minCorridorsPerWheel
  //      connections, prioritising the most-under-connected pair on every
  //      single placement (re-sort after each successful placement).
  //   2. FILL — saturation loop that keeps stacking corridors until conflict
  //      detection refuses any more bundles.
  // tracksConflict in tryPlaceBundle prevents physical overlap, so the cap
  // on corridors-per-pair just needs to be high enough not to gate fill.
  const maxCorridorsPerPair = Math.max(8, wheels.length)

  function placeBundleForEdge(edge: CandidateEdge): boolean {
    const key = uniquePairKey(edge.a, edge.b)
    const used = pairUsage.get(key) ?? 0
    if (used >= maxCorridorsPerPair) return false
    const acceptedBundle = tryPlaceBundle(edge)
    if (!acceptedBundle) return false
    for (const lane of acceptedBundle) {
      const segments = buildRenderedPathSegments(
        lane.points,
        lane.corners,
        cornerRadius
      )
      tracks.push({
        id: `track-${tracks.length}`,
        fromWheelId: wheels[edge.a].id,
        toWheelId: wheels[edge.b].id,
        points: lane.points,
        corners: lane.corners,
        segments,
        length: renderedPathLength(segments),
      })
      acceptedTrackPointSets.push(lane.points)
    }
    pairUsage.set(key, used + 1)
    wheelDegree[edge.a] += 1
    wheelDegree[edge.b] += 1
    return true
  }

  // Phase 1: connectivity. Re-sort after every placement so the most
  // under-connected wheel is always next in line. The MAX deficit (rather
  // than sum) keeps pairs containing a single isolated wheel at the top.
  const maxConnectIterations = edges.length * (minCorridorsPerWheel + 2)
  for (let iter = 0; iter < maxConnectIterations; iter++) {
    const remaining = edges.filter(
      (e) => (pairUsage.get(uniquePairKey(e.a, e.b)) ?? 0) < maxCorridorsPerPair
    )
    if (remaining.length === 0) break
    remaining.sort((a, b) => {
      const deficitA = Math.max(
        Math.max(0, minCorridorsPerWheel - wheelDegree[a.a]),
        Math.max(0, minCorridorsPerWheel - wheelDegree[a.b])
      )
      const deficitB = Math.max(
        Math.max(0, minCorridorsPerWheel - wheelDegree[b.a]),
        Math.max(0, minCorridorsPerWheel - wheelDegree[b.b])
      )
      if (deficitA !== deficitB) return deficitB - deficitA
      const sumDefA =
        Math.max(0, minCorridorsPerWheel - wheelDegree[a.a]) +
        Math.max(0, minCorridorsPerWheel - wheelDegree[a.b])
      const sumDefB =
        Math.max(0, minCorridorsPerWheel - wheelDegree[b.a]) +
        Math.max(0, minCorridorsPerWheel - wheelDegree[b.b])
      if (sumDefA !== sumDefB) return sumDefB - sumDefA
      const pairA = pairUsage.get(uniquePairKey(a.a, a.b)) ?? 0
      const pairB = pairUsage.get(uniquePairKey(b.a, b.b)) ?? 0
      if (pairA !== pairB) return pairA - pairB
      return a.distance - b.distance
    })
    // No wheel is under its target → connectivity goal met, exit phase 1.
    const topDeficit = Math.max(
      Math.max(0, minCorridorsPerWheel - wheelDegree[remaining[0].a]),
      Math.max(0, minCorridorsPerWheel - wheelDegree[remaining[0].b])
    )
    if (topDeficit === 0) break
    // Walk the sorted list and place the first edge that succeeds. This is
    // important: a pair may fail because of conflicts, in which case we want
    // to fall through to the next-most-deserving pair instead of giving up.
    let placedAny = false
    for (const edge of remaining) {
      if (placeBundleForEdge(edge)) {
        placedAny = true
        break
      }
    }
    if (!placedAny) break
  }

  // Phase 2: saturation fill. The connectivity phase already placed at least
  // one corridor per wheel, so now we just keep stacking until tryPlaceBundle
  // runs out of fitting routes.
  const maxFillPasses = 120
  for (let pass = 0; pass < maxFillPasses; pass++) {
    let placedInPass = 0
    const orderedEdges = [...edges].sort((a, b) => {
      const pairA = pairUsage.get(uniquePairKey(a.a, a.b)) ?? 0
      const pairB = pairUsage.get(uniquePairKey(b.a, b.b)) ?? 0
      const degreeA = wheelDegree[a.a] + wheelDegree[a.b]
      const degreeB = wheelDegree[b.a] + wheelDegree[b.b]
      if (pairA !== pairB) return pairA - pairB
      if (degreeA !== degreeB) return degreeA - degreeB
      return a.distance - b.distance
    })
    for (const edge of orderedEdges) {
      if (placeBundleForEdge(edge)) placedInPass += 1
    }
    if (placedInPass === 0) break
  }

  // Phase 3: STRAIGHTEN — a final pass that stitches in straight horizontal
  // tracks between any two wheels whose vertical extents overlap and whose
  // line of sight is clear. The corridor-based phases above prefer
  // L-shaped / HVH routes, so even pairs that COULD be connected with a
  // simple cross-canvas stripe usually weren't. This pass goes through
  // every left-to-right wheel pair and tries multiple Y values within the
  // shared vertical band, letting tracksConflict gate density. The result
  // is a much denser horizontal-flow look — which is the dominant motion
  // axis of the visualisation anyway.
  function tryPlaceStraightHorizontal(
    start: MeshPoint,
    end: MeshPoint,
    fromWheelId: string,
    toWheelId: string,
    ignoreWheelIds: Set<string>
  ): boolean {
    // Reject if the line passes through any wheel that isn't an explicit
    // endpoint. The margin matches the routing padding used elsewhere.
    const obstacleMargin = Math.max(8, routePadding * grid * 0.5)
    for (const wheel of wheels) {
      if (ignoreWheelIds.has(wheel.id)) continue
      if (pointToSegmentDistance(wheel, start, end) < wheel.r + obstacleMargin)
        return false
    }
    const points: MeshPoint[] = [start, end]
    for (const existing of acceptedTrackPointSets) {
      if (tracksConflict(points, existing, laneSpacing * 0.95)) return false
    }
    const trackCorners: MeshCornerArc[] = [{ radius: 0 }, { radius: 0 }]
    const segments = buildRenderedPathSegments(
      points,
      trackCorners,
      cornerRadius
    )
    tracks.push({
      id: `track-${tracks.length}`,
      fromWheelId,
      toWheelId,
      points,
      corners: trackCorners,
      segments,
      length: renderedPathLength(segments),
    })
    acceptedTrackPointSets.push(points)
    return true
  }

  const orderByX = wheels
    .map((_, i) => i)
    .sort((a, b) => wheels[a].x - wheels[b].x)
  for (let i = 0; i < orderByX.length; i++) {
    for (let j = i + 1; j < orderByX.length; j++) {
      const wA = wheels[orderByX[i]]
      const wB = wheels[orderByX[j]]
      // Wheels need real horizontal separation for a stripe to fit between
      // them; if the bounding circles overlap horizontally, the
      // wheel-to-wheel segment is essentially zero length.
      if (wB.x - wA.x < (wA.r + wB.r) * 0.6) continue
      // Vertical band where a horizontal line can simultaneously enter the
      // left side of B and exit the right side of A. The 0.85 factor keeps
      // the stripe away from the very top/bottom of each wheel (where the
      // entry point would sit at a glancing angle).
      const yMin = Math.max(wA.y - wA.r * 0.85, wB.y - wB.r * 0.85)
      const yMax = Math.min(wA.y + wA.r * 0.85, wB.y + wB.r * 0.85)
      if (yMax - yMin < laneSpacing * 0.5) continue
      const ignore = new Set([wA.id, wB.id])
      // Walk the band in lane-spacing increments, with a small offset so we
      // don't always hit dead-on the same Y other phases used.
      const yStep = laneSpacing
      for (let y = yMin + yStep / 2; y <= yMax; y += yStep) {
        const dyA = y - wA.y
        const dyB = y - wB.y
        const xA = wA.x + Math.sqrt(Math.max(0, wA.r * wA.r - dyA * dyA))
        const xB = wB.x - Math.sqrt(Math.max(0, wB.r * wB.r - dyB * dyB))
        if (xB - xA < grid * 1.2) continue
        tryPlaceStraightHorizontal(
          { x: xA, y },
          { x: xB, y },
          wA.id,
          wB.id,
          ignore
        )
      }
    }
  }

  // Phase 4 (optional): EDGE CONNECTIONS — add straight horizontal tracks
  // that come in from the left edge of the canvas and leave from the
  // right edge. Only wheels close to each respective edge are considered,
  // otherwise we'd draw very long stripes across the whole canvas which
  // visually dominate. The edge fade naturally hides the off-canvas end.
  if (options.edgeConnections) {
    const edgeProximity = width * 0.4
    for (const wheel of wheels) {
      const yStep = laneSpacing
      const yMin = wheel.y - wheel.r * 0.75
      const yMax = wheel.y + wheel.r * 0.75
      const ignore = new Set([wheel.id])
      const tryLeft = wheel.x < edgeProximity
      const tryRight = wheel.x > width - edgeProximity
      if (!tryLeft && !tryRight) continue
      for (let y = yMin + yStep / 2; y <= yMax; y += yStep) {
        const dy = y - wheel.y
        const xRadius = Math.sqrt(Math.max(0, wheel.r * wheel.r - dy * dy))
        if (xRadius < grid * 0.2) continue
        if (tryLeft) {
          tryPlaceStraightHorizontal(
            { x: 0, y },
            { x: wheel.x - xRadius, y },
            `edge-left`,
            wheel.id,
            ignore
          )
        }
        if (tryRight) {
          tryPlaceStraightHorizontal(
            { x: wheel.x + xRadius, y },
            { x: width, y },
            wheel.id,
            `edge-right`,
            ignore
          )
        }
      }
    }
  }

  return { width, height, wheels, tracks }
}
