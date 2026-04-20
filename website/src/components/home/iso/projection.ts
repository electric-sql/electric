/**
 * Hand-rolled isometric projection: 3D world → 2D canvas.
 *
 *   screenX = (x - y) * cos(30°) * scale
 *   screenY = ((x + y) * sin(30°) - z) * scale
 *
 * Conventions match `types.ts`:
 *  - +x and +y are the two horizontal iso axes (visually they map to
 *    down-right and down-left on screen).
 *  - +z is up (subtracts from screenY).
 *
 * Painter's-algorithm ordering uses the dot `(x + y - z)`. Items with
 * higher values are closer to the viewer and should be drawn last.
 */

import type {
  ProjectorOpts,
  Projected,
  Vec3,
  WorldBounds,
  CameraCrop,
} from './types'

export const ISO_COS = Math.cos(Math.PI / 6) // ~0.8660
export const ISO_SIN = Math.sin(Math.PI / 6) // 0.5

/** Project a single 3D world point. */
export function projectPoint(p: Vec3, opts: ProjectorOpts): Projected {
  const [x, y, z] = p
  const sx = (x - y) * ISO_COS * opts.scale + opts.offsetX
  const sy = ((x + y) * ISO_SIN - z) * opts.scale + opts.offsetY
  const depth = x + y - z
  return { sx, sy, depth, fade: fadeForPoint(p, opts.bounds, opts.fadeMargin) }
}

/** Project just to (sx, sy) without computing fade — for tight loops. */
export function projectXY(
  p: Vec3,
  opts: ProjectorOpts
): { sx: number; sy: number } {
  const [x, y, z] = p
  return {
    sx: (x - y) * ISO_COS * opts.scale + opts.offsetX,
    sy: ((x + y) * ISO_SIN - z) * opts.scale + opts.offsetY,
  }
}

/** Painter's-algorithm sort key. Higher values draw later (in front). */
export function depthOf(p: Vec3): number {
  return p[0] + p[1] - p[2]
}

/**
 * Compute the fade alpha (0..1) for a world point given the crop bounds
 * and fade margin. Points strictly inside the bounds get 1.0; points
 * exactly at `fadeMargin` outside the bounds get 0.0; points further
 * outside also get 0.0. Linear ramp in between.
 *
 * The fade is applied per-axis and then combined as `min`, which
 * produces a soft rectangular halo around the bounds.
 */
export function fadeForPoint(p: Vec3, b: WorldBounds, margin: number): number {
  if (margin <= 0) {
    if (
      p[0] < b.minX ||
      p[0] > b.maxX ||
      p[1] < b.minY ||
      p[1] > b.maxY ||
      p[2] < b.minZ ||
      p[2] > b.maxZ
    ) {
      return 0
    }
    return 1
  }
  const fx = axisFade(p[0], b.minX, b.maxX, margin)
  const fy = axisFade(p[1], b.minY, b.maxY, margin)
  const fz = axisFade(p[2], b.minZ, b.maxZ, margin)
  return Math.min(fx, fy, fz)
}

function axisFade(v: number, lo: number, hi: number, margin: number): number {
  if (v >= lo && v <= hi) return 1
  if (v < lo) {
    const d = lo - v
    if (d >= margin) return 0
    return 1 - d / margin
  }
  // v > hi
  const d = v - hi
  if (d >= margin) return 0
  return 1 - d / margin
}

// ── Layout: choose a scale and offset that fits the crop on the canvas

/**
 * Compute a `ProjectorOpts` that frames the crop bounds inside a canvas
 * of `(width, height)` css pixels, leaving a small padding ratio on
 * each side.
 *
 * `zoom` (default 1) lets a caller scale the rendered drawing without
 * changing the canvas size. zoom > 1 makes the scene render bigger
 * than it would otherwise (and may overflow the canvas — which is
 * fine because the canvas itself has `overflow: hidden`).
 */
export function projectorForCrop(
  crop: CameraCrop,
  width: number,
  height: number,
  paddingRatio = 0.02,
  zoom = 1
): ProjectorOpts {
  // Sample the 8 corners of the bounds to get the screen-space extent at
  // unit scale. Then pick a scale that fits with padding.
  const corners: Vec3[] = []
  for (const x of [crop.worldBounds.minX, crop.worldBounds.maxX]) {
    for (const y of [crop.worldBounds.minY, crop.worldBounds.maxY]) {
      for (const z of [crop.worldBounds.minZ, crop.worldBounds.maxZ]) {
        corners.push([x, y, z])
      }
    }
  }
  let minSX = Infinity,
    maxSX = -Infinity
  let minSY = Infinity,
    maxSY = -Infinity
  for (const [x, y, z] of corners) {
    const sx = (x - y) * ISO_COS
    const sy = (x + y) * ISO_SIN - z
    if (sx < minSX) minSX = sx
    if (sx > maxSX) maxSX = sx
    if (sy < minSY) minSY = sy
    if (sy > maxSY) maxSY = sy
  }
  // Guard against zero-extent bounds.
  const worldW = maxSX - minSX
  const worldH = maxSY - minSY
  const padW = width * (1 - paddingRatio * 2)
  const padH = height * (1 - paddingRatio * 2)
  const scale = Math.max(0.001, Math.min(padW / worldW, padH / worldH)) * zoom
  // Centre the projected world on the canvas.
  const offsetX = width / 2 - ((minSX + maxSX) / 2) * scale
  const offsetY = height / 2 - ((minSY + maxSY) / 2) * scale
  return {
    scale,
    offsetX,
    offsetY,
    bounds: crop.worldBounds,
    fadeMargin: crop.fadeMargin,
  }
}

// ── Polyline helpers (for channel paths and walking actors) ──────────

/** Total length of a polyline in *world* units. */
export function polylineLength(pts: readonly Vec3[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += dist3(pts[i - 1], pts[i])
  }
  return total
}

/** Sample a polyline at parameter t ∈ [0,1] (by arc length). */
export function samplePolyline(pts: readonly Vec3[], t: number): Vec3 {
  if (pts.length === 0) return [0, 0, 0]
  if (pts.length === 1) return pts[0]
  const total = polylineLength(pts)
  if (total === 0) return pts[0]
  let target = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < pts.length; i++) {
    const seg = dist3(pts[i - 1], pts[i])
    if (target <= seg) {
      const k = seg === 0 ? 0 : target / seg
      return [
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k,
        pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * k,
      ] as Vec3
    }
    target -= seg
  }
  return pts[pts.length - 1]
}

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ── Hit-testing (screen → world) ─────────────────────────────────────

/**
 * Project a 3D point and return the screen-space distance to (mx, my).
 * Used for hit-testing actors and packets without doing a full inverse
 * projection (the iso projection is degenerate without a known z).
 */
export function screenDistance(
  p: Vec3,
  mx: number,
  my: number,
  opts: ProjectorOpts
): number {
  const { sx, sy } = projectXY(p, opts)
  return Math.hypot(sx - mx, sy - my)
}
