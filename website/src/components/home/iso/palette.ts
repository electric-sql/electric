/**
 * Substrate → accent colour mapping for the homepage iso scene.
 *
 * Three accent families (sync = teal, streams = violet, agents = coral),
 * resolved from CSS custom properties so theme switching just works. The
 * v2 plan calls these "element-kind colours": colour is determined by
 * what the element *is*, not which thread it belongs to.
 *
 * Resolution strategy:
 *  - On the client we read `getComputedStyle(document.documentElement)`
 *    once per draw frame and cache the parsed RGB triplet.
 *  - On the server we fall back to the dark-mode hex constants below
 *    (SSR snapshot generator overrides this if needed).
 *
 * Anything outside `<HomeIsoBg>` should keep using `--vp-c-brand-1` and
 * the existing teal-on-navy palette.
 */
import type { Substrate } from './types'

// ── CSS custom property names ────────────────────────────────────────

const VAR_BY_SUBSTRATE: Record<Substrate, string> = {
  sync: `--home-iso-sync`,
  streams: `--home-iso-streams`,
  agents: `--home-iso-agents`,
}

// ── Hard-coded fallbacks for SSR / when CSS vars are missing ────────

const FALLBACK_DARK: Record<Substrate, [number, number, number]> = {
  sync: [117, 251, 253],
  streams: [167, 139, 250],
  agents: [255, 138, 101],
}

const FALLBACK_LIGHT: Record<Substrate, [number, number, number]> = {
  sync: [13, 154, 170],
  streams: [111, 77, 255],
  agents: [212, 74, 37],
}

const FALLBACK_NEUTRAL_DARK: [number, number, number] = [255, 255, 245]
const FALLBACK_NEUTRAL_LIGHT: [number, number, number] = [0, 0, 0]

// ── Cache (cleared each frame by `resetPaletteCache()`) ──────────────

interface Cache {
  dark: boolean
  rgb: Map<string, [number, number, number]>
  neutral: [number, number, number]
}

let cache: Cache | null = null

/** Call once per draw frame so the lookup honours a fresh theme switch. */
export function resetPaletteCache(dark: boolean): void {
  if (typeof window === `undefined`) {
    cache = {
      dark,
      rgb: new Map(),
      neutral: dark ? FALLBACK_NEUTRAL_DARK : FALLBACK_NEUTRAL_LIGHT,
    }
    return
  }
  const root = document.documentElement
  const computed = getComputedStyle(root)
  const rgb = new Map<string, [number, number, number]>()
  ;([`sync`, `streams`, `agents`] as Substrate[]).forEach((s) => {
    const raw = computed.getPropertyValue(VAR_BY_SUBSTRATE[s]).trim()
    rgb.set(s, parseColor(raw, (dark ? FALLBACK_DARK : FALLBACK_LIGHT)[s]))
  })
  // Neutral comes from --home-iso-neutral as a "r, g, b" triplet.
  const neutralRaw = computed.getPropertyValue(`--home-iso-neutral`).trim()
  const neutral = parseTriplet(
    neutralRaw,
    dark ? FALLBACK_NEUTRAL_DARK : FALLBACK_NEUTRAL_LIGHT
  )
  cache = { dark, rgb, neutral }
}

function ensureCache(dark: boolean): Cache {
  if (!cache || cache.dark !== dark) resetPaletteCache(dark)
  return cache!
}

// ── Public colour helpers ────────────────────────────────────────────

/**
 * Substrate accent at the given alpha. Used for channels, comets,
 * risers, junction boxes, actors (coral), surface pulses (teal), etc.
 */
export function accent(
  dark: boolean,
  substrate: Substrate,
  alpha: number
): string {
  const c =
    ensureCache(dark).rgb.get(substrate) ??
    (dark ? FALLBACK_DARK[substrate] : FALLBACK_LIGHT[substrate])
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}

/** Neutral mono colour for scaffold elements (walls, plain humans, lamps). */
export function neutral(dark: boolean, alpha: number): string {
  const c = ensureCache(dark).neutral
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}

/** Returns the brand teal at the requested alpha (back-compat). */
export function brandTeal(dark: boolean, alpha: number): string {
  return accent(dark, `sync`, alpha)
}

// ── Parsing ──────────────────────────────────────────────────────────

function parseColor(
  raw: string,
  fallback: [number, number, number]
): [number, number, number] {
  if (!raw) return fallback
  // Hex like "#aabbcc"
  if (raw.startsWith(`#`)) {
    const hex = raw.slice(1)
    const expanded =
      hex.length === 3
        ? hex
            .split(``)
            .map((c) => c + c)
            .join(``)
        : hex
    if (expanded.length !== 6) return fallback
    const r = parseInt(expanded.slice(0, 2), 16)
    const g = parseInt(expanded.slice(2, 4), 16)
    const b = parseInt(expanded.slice(4, 6), 16)
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback
    return [r, g, b]
  }
  // rgb() / rgba()
  const m = raw.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(`,`).map((p) => parseFloat(p.trim()))
    if (parts.length >= 3 && parts.slice(0, 3).every((p) => !Number.isNaN(p))) {
      return [parts[0], parts[1], parts[2]]
    }
  }
  return fallback
}

function parseTriplet(
  raw: string,
  fallback: [number, number, number]
): [number, number, number] {
  if (!raw) return fallback
  const parts = raw.split(`,`).map((p) => parseFloat(p.trim()))
  if (parts.length === 3 && parts.every((p) => !Number.isNaN(p))) {
    return [parts[0], parts[1], parts[2]]
  }
  return fallback
}
