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

export interface MeshTrack {
  id: string
  fromWheelId: string
  toWheelId: string
  points: MeshPoint[]
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
  return pointAtDistance(track.points, wrapped * track.length)
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

  const edges: CandidateEdge[] = []
  for (let i = 0; i < wheels.length; i++) {
    for (let j = i + 1; j < wheels.length; j++) {
      edges.push({ a: i, b: j, distance: distance(wheels[i], wheels[j]) })
    }
  }
  edges.sort((a, b) => a.distance - b.distance)

  const chosenKeys = new Set<string>()
  const chosenEdges: CandidateEdge[] = []
  const degree = wheels.map(() => 0)

  const minNeighbors = clamp(
    2 + Math.round(connectionDensity * 4),
    2,
    Math.max(2, Math.min(6, wheels.length - 1))
  )

  function addEdge(a: number, b: number) {
    const key = uniquePairKey(a, b)
    if (chosenKeys.has(key)) return
    chosenKeys.add(key)
    chosenEdges.push({ a, b, distance: distance(wheels[a], wheels[b]) })
    degree[a] += 1
    degree[b] += 1
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
    if (directDistance > 0 && length / directDistance > 2.6) return false
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
  const bundleLaneCount = Math.max(3, 2 + Math.round(connectionDensity * 4))
  const laneSpacing = Math.max(6, grid * 0.28)

  for (const edge of chosenEdges) {
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
    const centerStartGuide = anglePoint(fromWheel, startAngle, grid * 0.78)
    const centerEndGuide = anglePoint(toWheel, endAngle, grid * 0.78)
    const centerEndPoint = anglePoint(toWheel, endAngle, 0)

    const routeCandidates = makeRouteCandidates(
      centerStartGuide,
      centerEndGuide
    )
      .map((core) => {
        const full = normalizePolyline([
          centerStartPoint,
          ...core,
          centerEndPoint,
        ])
        return {
          core,
          full,
          score:
            polylineLength(full) +
            turnCount(full) * grid * 0.35 +
            maxTurnAngleDegrees(full) * 0.25,
        }
      })
      .filter((candidate) =>
        validateTrackPoints(candidate.full, fromWheel, toWheel)
      )
      .sort((a, b) => a.score - b.score)

    const chosen = routeCandidates[0]
    if (!chosen) continue

    for (let laneIdx = 0; laneIdx < bundleLaneCount; laneIdx++) {
      const laneOffset = (laneIdx - (bundleLaneCount - 1) / 2) * laneSpacing
      const startAngleOffset =
        startAngle + laneOffset / Math.max(fromWheel.r, 1)
      const endAngleOffset = endAngle - laneOffset / Math.max(toWheel.r, 1)
      const laneStartPoint = anglePoint(fromWheel, startAngleOffset, 0)
      const laneStartGuide = anglePoint(
        fromWheel,
        startAngleOffset,
        grid * 0.78
      )
      const laneEndGuide = anglePoint(toWheel, endAngleOffset, grid * 0.78)
      const laneEndPoint = anglePoint(toWheel, endAngleOffset, 0)

      const offsetCore = offsetPolyline(chosen.core, laneOffset)
      const lanePoints = normalizePolyline([
        laneStartPoint,
        laneStartGuide,
        ...offsetCore.slice(1, -1),
        laneEndGuide,
        laneEndPoint,
      ])
      if (!validateTrackPoints(lanePoints, fromWheel, toWheel)) continue

      tracks.push({
        id: `track-${tracks.length}`,
        fromWheelId: fromWheel.id,
        toWheelId: toWheel.id,
        points: lanePoints,
        length: polylineLength(lanePoints),
      })
    }
  }

  return { width, height, wheels, tracks }
}
