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
    const dx1 = Math.sign(cur.x - prev.x)
    const dy1 = Math.sign(cur.y - prev.y)
    const dx2 = Math.sign(next.x - cur.x)
    const dy2 = Math.sign(next.y - cur.y)
    if (dx1 === dx2 && dy1 === dy2) continue
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

  const edges: CandidateEdge[] = []
  for (let i = 0; i < wheels.length; i++) {
    for (let j = i + 1; j < wheels.length; j++) {
      edges.push({ a: i, b: j, distance: distance(wheels[i], wheels[j]) })
    }
  }
  edges.sort((a, b) => a.distance - b.distance)

  const chosenKeys = new Set<string>()
  const chosenEdges: CandidateEdge[] = []

  const minNeighbors = clamp(
    6 + Math.round(connectionDensity * 6),
    6,
    Math.max(6, Math.min(12, wheels.length - 1))
  )

  function addEdge(a: number, b: number) {
    const key = uniquePairKey(a, b)
    if (chosenKeys.has(key)) return
    chosenKeys.add(key)
    chosenEdges.push({ a, b, distance: distance(wheels[a], wheels[b]) })
  }

  for (let i = 0; i < wheels.length; i++) {
    const neighbors = edges
      .filter((edge) => edge.a === i || edge.b === i)
      .map((edge) => (edge.a === i ? edge.b : edge.a))
      .sort(
        (a, b) =>
          distance(wheels[i], wheels[a]) - distance(wheels[i], wheels[b])
      )

    const directional = {
      left: -1,
      right: -1,
      up: -1,
      down: -1,
    }
    for (const other of neighbors) {
      const dx = wheels[other].x - wheels[i].x
      const dy = wheels[other].y - wheels[i].y
      if (dx < 0 && directional.left === -1) directional.left = other
      if (dx > 0 && directional.right === -1) directional.right = other
      if (dy < 0 && directional.up === -1) directional.up = other
      if (dy > 0 && directional.down === -1) directional.down = other
    }
    for (const other of Object.values(directional)) {
      if (other >= 0) addEdge(i, other)
    }
    for (const other of neighbors.slice(0, minNeighbors)) {
      addEdge(i, other)
    }
    const midReach = neighbors[Math.floor(neighbors.length * 0.66)]
    const farReach = neighbors[neighbors.length - 1]
    if (midReach !== undefined) addEdge(i, midReach)
    if (farReach !== undefined) addEdge(i, farReach)
  }

  function snapCoord(value: number): number {
    return nearestGrid(value, grid)
  }

  function makeRouteCandidates(
    startGuide: MeshPoint,
    endGuide: MeshPoint
  ): MeshPoint[][] {
    const candidates: MeshPoint[][] = []
    if (
      Math.abs(startGuide.x - endGuide.x) < 0.5 ||
      Math.abs(startGuide.y - endGuide.y) < 0.5
    ) {
      candidates.push([startGuide, endGuide])
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
  const maxBundleHalfWidth = Math.max(
    1,
    1 + Math.round(connectionDensity * 1.5)
  )
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

    const routeCandidates = makeRouteCandidates(
      centerStartGuide,
      centerEndGuide
    )
      .map((rawCore) => {
        // Chamfer small Z-shapes (lateral shifts) into 45° diagonals so we get
        // a cleaner stretched corner rather than two 90° corners and a short
        // perpendicular nubbin between them.
        const core = chamferZShapes(
          rawCore,
          Math.max(grid * 0.9, laneSpacing * 2.4)
        )
        const full = normalizePolyline([
          centerStartPoint,
          ...core,
          centerEndPoint,
        ])
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
      // lies on the circle around `wheel` of radius wheel.r and is on the
      // -dir side of `point` (i.e., closer to the wheel along the parallel
      // line we just constructed).
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
        // We want the negative-t intersection (walk back toward wheel from c0).
        const t =
          t1 < 0 && t2 < 0
            ? Math.max(t1, t2)
            : t1 < 0
              ? t1
              : t2 < 0
                ? t2
                : Math.min(t1, t2)
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
        for (const existing of acceptedTrackPointSets) {
          if (tracksConflict(lanePoints, existing, laneSpacing * 0.2)) {
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
      for (let band = 1; band <= maxBundleHalfWidth; band++) {
        const offset = band * laneSpacing
        const negLane = buildLane(-offset)
        const posLane = buildLane(offset)
        if (!negLane || !posLane) break
        let siblingConflict = false
        for (const sibling of bundleLanes) {
          if (
            tracksConflict(
              negLane.points,
              sibling.points,
              laneSpacing * 0.88
            ) ||
            tracksConflict(posLane.points, sibling.points, laneSpacing * 0.88)
          ) {
            siblingConflict = true
            break
          }
        }
        if (
          siblingConflict ||
          tracksConflict(negLane.points, posLane.points, laneSpacing * 1.76)
        ) {
          break
        }
        bundleLanes.unshift(negLane)
        bundleLanes.push(posLane)
        expansionScore += offset
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
        const halfBundleCount = (bundleLanes.length - 1) / 2
        const halfBundleOffset = halfBundleCount * laneSpacing
        const niceWide = Math.max(cornerRadius, grid * 1.4)
        const minR = 0.5
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
          // Desired outer radius if we got our way: a nice wide centerline
          // arc plus the bundle's outward expansion.
          const desiredOuterR = niceWide + halfBundleOffset
          const outerR = Math.min(desiredOuterR, maxOuterR)
          virtualCenterR[idx] = outerR - halfBundleOffset
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

  for (let pass = 0; pass < 36; pass++) {
    let placedInPass = 0
    const orderedEdges = [...chosenEdges].sort((a, b) => {
      const pairA = pairUsage.get(uniquePairKey(a.a, a.b)) ?? 0
      const pairB = pairUsage.get(uniquePairKey(b.a, b.b)) ?? 0
      const deficitA =
        Math.max(0, minCorridorsPerWheel - wheelDegree[a.a]) +
        Math.max(0, minCorridorsPerWheel - wheelDegree[a.b])
      const deficitB =
        Math.max(0, minCorridorsPerWheel - wheelDegree[b.a]) +
        Math.max(0, minCorridorsPerWheel - wheelDegree[b.b])
      const degreeA = wheelDegree[a.a] + wheelDegree[a.b]
      const degreeB = wheelDegree[b.a] + wheelDegree[b.b]
      if (pairA !== pairB) return pairA - pairB
      if (deficitA !== deficitB) return deficitB - deficitA
      if (degreeA !== degreeB) return degreeA - degreeB
      return a.distance - b.distance
    })

    for (const edge of orderedEdges) {
      const key = uniquePairKey(edge.a, edge.b)
      const used = pairUsage.get(key) ?? 0
      if (used >= 2) continue

      const acceptedBundle = tryPlaceBundle(edge)
      if (!acceptedBundle) continue

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
      placedInPass += 1
    }

    if (placedInPass === 0) break
  }

  return { width, height, wheels, tracks }
}
