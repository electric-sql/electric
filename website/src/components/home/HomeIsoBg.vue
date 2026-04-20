<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CROPS, SCRIPTS, TWEAKS, pickCrop } from './iso/crops'
import { drawScene } from './iso/render'
import { initSceneState, resetScriptCursor, tickScene } from './iso/simulate'
import { HOME_SCENE } from './iso/scene'
import { projectorForCrop, screenDistance } from './iso/projection'
import type {
  CameraCrop,
  ConnectionArc,
  CropName,
  ExcludeRect,
  ProjectorOpts,
  SceneState,
  Substrate,
  Vec3,
} from './iso/types'

const props = withDefaults(
  defineProps<{
    /** Which named crop to render. */
    crop: CropName
    /** Optional element whose text rects geometry should avoid. */
    excludeEl?: HTMLElement
    /** Force-disable interactivity (used for hidden/preview modes). */
    interactive?: boolean
    /**
     * Tag for the IntersectionObserver: hero animates as soon as it
     * mounts, vignettes only animate when in view (and reset their
     * scripted loop on every entry).
     */
    autoStart?: boolean
    /**
     * Optional override of the legend filter. If provided, takes
     * precedence over the crop's intrinsic filter (lets the hero be
     * controlled by the interactive legend). null = no filter.
     */
    filter?: Substrate | null
    /**
     * If true, animate the crop bounds from the hero's `world` extent
     * to the vignette's bounds over `zoomDurationMs` on viewport entry.
     * Skipped under prefers-reduced-motion. Vignette-only.
     */
    zoomIn?: boolean
    zoomDurationMs?: number
    /**
     * Multiplier applied to the projector scale — a constant zoom of
     * the rendered drawing inside the canvas. 1 = fit-to-canvas (the
     * default), > 1 makes the scene render bigger and overflow the
     * canvas (clipped by the parent's `overflow: hidden`).
     */
    zoom?: number
    /**
     * Per-side fraction by which the canvas should extend beyond its
     * layout slot. A single number applies to all four sides; passing
     * `{ top, right, bottom, left }` lets each side be tuned
     * independently (useful when the band has a navbar above it but
     * lots of space to the right or below).
     *
     * `bleed: 0.25` → canvas is 50 % wider and 50 % taller than the
     * parent, recentred. `bleed: { top: 0, right: 0.3, bottom: 0.15,
     * left: 0.2 }` → asymmetric bleed.
     *
     * The parent of `<HomeIsoBg>` must allow `overflow: visible` for
     * the bleed to actually be seen — typically the page-level band
     * still has `overflow: hidden` as a safety clip.
     */
    bleed?: number | { top?: number; right?: number; bottom?: number; left?: number }
    /**
     * If true, applies a CSS `mask-image` radial/linear gradient to the
     * canvas so the rectangular edges feather softly into the page
     * background. Useful when the iso scene is bleeding past its slot
     * and would otherwise show a hard rectangular cut.
     */
    feather?: boolean
  }>(),
  {
    interactive: true,
    autoStart: false,
    filter: undefined,
    zoomIn: false,
    zoomDurationMs: 600,
    zoom: 1,
    bleed: 0,
    feather: false,
  }
)

const bleedInsets = computed(() => {
  const b = props.bleed
  const sides = typeof b === 'number'
    ? { top: b, right: b, bottom: b, left: b }
    : { top: b.top ?? 0, right: b.right ?? 0, bottom: b.bottom ?? 0, left: b.left ?? 0 }
  return {
    top: `${-sides.top * 100}%`,
    right: `${-sides.right * 100}%`,
    bottom: `${-sides.bottom * 100}%`,
    left: `${-sides.left * 100}%`,
  }
})

const wrapEl = ref<HTMLDivElement>()
const canvasEl = ref<HTMLCanvasElement>()
const tooltipEl = ref<HTMLDivElement>()

let raf = 0
let running = false
let visible = false
let lastTime = 0
let dpr = 1
let widthCss = 0
let heightCss = 0

let proj: ProjectorOpts | null = null
let exclusions: ExcludeRect[] = []
let hoveredSurface: string | null = null
let hoveredActorId: string | null = null
// Crop-zoom animation state. zoomT goes 0 → 1 over zoomDurationMs.
// When zoomIn is false (or under reduced motion) it sits at 1.
let zoomT = 1
let zoomActive = false

const state: SceneState = initSceneState(HOME_SCENE)

const reducedMotion = ref(false)

const aspect = ref<'desktop' | 'mobile'>('desktop')

const activeCrop = computed<CameraCrop>(() => pickCrop(props.crop, aspect.value === 'mobile'))
const tweaks = computed(() => TWEAKS[props.crop])
const scripts = computed(() => SCRIPTS[props.crop])

function resolvedFilter(): Substrate | null {
  if (props.filter !== undefined) return props.filter
  return activeCrop.value.filter ?? null
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function recomputeAspect() {
  if (typeof window === 'undefined') return
  aspect.value = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
}

function getTextRects(element: Element): DOMRect[] {
  const rects: DOMRect[] = []
  const range = document.createRange()
  const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let textNode: Text | null
  while ((textNode = walk.nextNode() as Text | null)) {
    if (!textNode.textContent?.trim()) continue
    range.selectNodeContents(textNode)
    const nodeRects = range.getClientRects()
    for (let i = 0; i < nodeRects.length; i++) rects.push(nodeRects[i])
  }
  element
    .querySelectorAll('a, button, svg, img, input, .ea-hero-install')
    .forEach((child) => {
      const r = child.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) rects.push(r)
    })
  return rects
}

function measureExclusions(): ExcludeRect[] {
  const zones: ExcludeRect[] = []
  const excEl = props.excludeEl
  if (!excEl || !canvasEl.value || !canvasEl.value.parentElement) return zones
  const origin = canvasEl.value.parentElement.getBoundingClientRect()
  const rects = getTextRects(excEl)
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue
    zones.push({
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
    })
  }
  return zones
}

function doLayout() {
  const c = canvasEl.value
  if (!c || !c.parentElement) return
  const rect = c.parentElement.getBoundingClientRect()
  dpr = window.devicePixelRatio || 1
  widthCss = rect.width
  heightCss = rect.height
  c.width = Math.max(1, Math.floor(widthCss * dpr))
  c.height = Math.max(1, Math.floor(heightCss * dpr))
  c.style.width = widthCss + 'px'
  c.style.height = heightCss + 'px'
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  recomputeAspect()
  rebuildProjector()
  exclusions = measureExclusions()
}

function rebuildProjector(): void {
  if (widthCss <= 0 || heightCss <= 0) return
  proj = projectorForCrop(currentCrop(), widthCss, heightCss, 0.02, props.zoom)
}

/**
 * Returns the crop to use *this frame* — interpolated between the
 * hero "world" crop and the vignette's target crop when a zoom-in is
 * in progress, otherwise just the active crop.
 */
function currentCrop(): CameraCrop {
  const target = activeCrop.value
  if (!props.zoomIn || zoomT >= 1 || reducedMotion.value) return target
  const isMobile = aspect.value === 'mobile'
  const start = CROPS.world[isMobile ? 'mobile' : 'desktop']
  const eased = easeOutCubic(zoomT)
  return {
    ...target,
    worldBounds: lerpBounds(start.worldBounds, target.worldBounds, eased),
    fadeMargin: start.fadeMargin + (target.fadeMargin - start.fadeMargin) * eased,
  }
}

function lerpBounds(a: CameraCrop['worldBounds'], b: CameraCrop['worldBounds'], k: number) {
  return {
    minX: a.minX + (b.minX - a.minX) * k,
    maxX: a.maxX + (b.maxX - a.maxX) * k,
    minY: a.minY + (b.minY - a.minY) * k,
    maxY: a.maxY + (b.maxY - a.maxY) * k,
    minZ: a.minZ + (b.minZ - a.minZ) * k,
    maxZ: a.maxZ + (b.maxZ - a.maxZ) * k,
  }
}

function easeOutCubic(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

function findHover(mx: number, my: number): { surface: string | null; actorId: string | null } {
  if (!proj) return { surface: null, actorId: null }
  // Actors first (they're sprites and easy to hit).
  let bestActorD = 22
  let bestActor: string | null = null
  for (const a of state.scene.actors) {
    const d = screenDistance(a.position, mx, my, proj)
    if (d < bestActorD) {
      bestActorD = d
      bestActor = a.id
    }
  }
  // Substrate packets (durable + active comets).
  let bestPacketD = 18
  let bestSurface: string | null = null
  for (const ch of state.scene.substrate.channels) {
    for (const p of ch.durable) {
      const sample = sampleAlong(ch.path, p.position)
      const d = screenDistance(sample, mx, my, proj)
      if (d < bestPacketD) {
        bestPacketD = d
        // No surface id for raw packets — show thread id in tooltip.
        bestSurface = `__packet__:${p.threadId}:${ch.id}:${p.position.toFixed(2)}`
      }
    }
  }
  for (const c of state.comets) {
    const ch = state.scene.substrate.channels.find((x) => x.id === c.channelId)
    if (!ch) continue
    const sample = sampleAlong(ch.path, c.t)
    const d = screenDistance(sample, mx, my, proj)
    if (d < bestPacketD) {
      bestPacketD = d
      bestSurface = `__comet__:${c.threadId}:${ch.id}`
    }
  }
  // Surfaces (screens, board cards). Approximate by furniture position.
  let bestSurfD = 22
  for (const b of state.scene.buildings) {
    let floorZ = b.origin[2]
    for (const f of b.floors) {
      for (const z of f.zones) {
        const zoneOrigin: Vec3 = [
          b.origin[0] + z.origin[0],
          b.origin[1] + z.origin[1],
          floorZ + z.origin[2],
        ]
        for (const fu of z.furniture) {
          const at: Vec3 = [
            zoneOrigin[0] + fu.at[0],
            zoneOrigin[1] + fu.at[1],
            zoneOrigin[2] + fu.at[2],
          ]
          if (fu.kind === 'screen') {
            const d = screenDistance([at[0], at[1], at[2] + (fu.h ?? 0.5) * 0.5], mx, my, proj)
            if (d < bestSurfD) {
              bestSurfD = d
              bestSurface = fu.surface
            }
          } else if (fu.kind === 'board') {
            for (const card of fu.cards) {
              const cd = screenDistance(
                [at[0], at[1], at[2] + 0.45 - card.row * 0.18],
                mx,
                my,
                proj
              )
              if (cd < bestSurfD) {
                bestSurfD = cd
                bestSurface = card.surface
              }
            }
          }
        }
      }
      floorZ += f.height
    }
  }
  return { surface: bestSurface, actorId: bestActor }
}

function sampleAlong(path: readonly Vec3[], t: number): Vec3 {
  if (path.length === 0) return [0, 0, 0]
  if (path.length === 1) return path[0]
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    total += Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
  }
  if (total === 0) return path[0]
  let target = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    const seg = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
    if (target <= seg) {
      const k = seg === 0 ? 0 : target / seg
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
    }
    target -= seg
  }
  return path[path.length - 1]
}

function showTooltip(surface: string | null, actorId: string | null, mx: number, my: number) {
  const tt = tooltipEl.value
  if (!tt) return
  if (actorId) {
    const a = state.scene.actors.find((x) => x.id === actorId)
    if (!a) {
      tt.style.opacity = '0'
      return
    }
    tt.textContent = `/${a.kind}/${a.id}  ·  ${a.walking ? 'walking' : 'idle'}`
    tt.style.opacity = '1'
    tt.style.left = mx + 'px'
    tt.style.top = (my - 24) + 'px'
    return
  }
  if (surface) {
    if (surface.startsWith('__packet__')) {
      const parts = surface.split(':')
      tt.textContent = `/${parts[1]}  ·  durable`
    } else if (surface.startsWith('__comet__')) {
      const parts = surface.split(':')
      tt.textContent = `/${parts[1]}  ·  in flight`
    } else {
      // Find the thread that contains this surface, if any.
      const t = state.scene.threads.find((x) => x.manifestations.includes(surface))
      tt.textContent = t ? `/${t.id}  ·  ${surface}` : `/${surface}`
    }
    tt.style.opacity = '1'
    tt.style.left = mx + 'px'
    tt.style.top = (my - 24) + 'px'
    return
  }
  tt.style.opacity = '0'
}

function onPointerMove(e: PointerEvent) {
  if (!props.interactive || !canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const { surface, actorId } = findHover(mx, my)
  hoveredSurface = surface
  hoveredActorId = actorId
  if (surface || actorId) {
    canvasEl.value.style.cursor = 'pointer'
    if (e.pointerType !== 'touch') showTooltip(surface, actorId, mx, my)
    if (surface && !surface.startsWith('__')) {
      // Highlight the hovered surface and its thread mates.
      state.highlights.set(surface, 1)
      const t = state.scene.threads.find((x) => x.manifestations.includes(surface))
      if (t) {
        for (const m of t.manifestations) {
          state.highlights.set(m, Math.max(state.highlights.get(m) ?? 0, 0.7))
        }
        emitHoverArc('sync', t.manifestations)
      }
    } else if (surface && surface.startsWith('__comet__')) {
      const parts = surface.split(':')
      emitChannelArc(parts[2])
    } else if (surface && surface.startsWith('__packet__')) {
      const parts = surface.split(':')
      emitChannelArc(parts[2])
    } else if (actorId) {
      const a = state.scene.actors.find((x) => x.id === actorId)
      if (a) {
        const path: Vec3[] = a.walking?.points && a.walking.points.length >= 2
          ? [...a.walking.points]
          : a.homeLoop ?? [a.position, [a.position[0] + 0.5, a.position[1] + 0.5, a.position[2]]]
        emitArc('agents', path)
      }
    }
  } else {
    canvasEl.value.style.cursor = ''
    if (tooltipEl.value) tooltipEl.value.style.opacity = '0'
  }
}

/** Push a transient connection arc through 3+ surfaces (sync) or
 *  along a polyline (agents/streams). Replaces any prior hover arc by
 *  trimming list to the most recent 4 — older ones decay anyway. */
function emitHoverArc(kind: 'sync', surfaceIds: string[]) {
  if (surfaceIds.length < 2) return
  // Resolve each surface id to a world position by scanning furniture.
  const points: Vec3[] = []
  for (const id of surfaceIds) {
    const at = positionOfSurface(id)
    if (at) points.push(at)
  }
  if (points.length < 2) return
  emitArc(kind, points)
}

function emitChannelArc(channelId: string) {
  const ch = state.scene.substrate.channels.find((c) => c.id === channelId)
  if (!ch) return
  const risers = state.scene.substrate.risers ?? []
  const matching = risers.filter((r) => r.channelId === channelId)
  if (matching.length === 0) {
    emitArc('streams', [...ch.path])
    return
  }
  // Build an arc: first the first 50 % of the channel path, then jump
  // up to each riser's surface.
  const pts: Vec3[] = ch.path.length > 0 ? [ch.path[0]] : []
  for (const r of matching.slice(0, 3)) {
    const sample = sampleAlong(ch.path, r.channelT)
    pts.push(sample)
    pts.push([sample[0], sample[1], r.topZ])
  }
  emitArc('streams', pts)
}

function emitArc(kind: ConnectionArc['kind'], points: Vec3[]) {
  // Cap simultaneous hover arcs to prevent runaway growth on rapid mouse.
  if (state.connectionArcs.length > 6) {
    state.connectionArcs.splice(0, state.connectionArcs.length - 6)
  }
  state.connectionArcs.push({
    kind,
    points,
    startMs: state.elapsedMs,
    durationMs: 280,
  })
}

function positionOfSurface(id: string): Vec3 | null {
  for (const b of state.scene.buildings) {
    let floorZ = b.origin[2]
    for (const f of b.floors) {
      for (const z of f.zones) {
        const zoneOrigin: Vec3 = [
          b.origin[0] + z.origin[0],
          b.origin[1] + z.origin[1],
          floorZ + z.origin[2],
        ]
        for (const fu of z.furniture) {
          const at: Vec3 = [
            zoneOrigin[0] + fu.at[0],
            zoneOrigin[1] + fu.at[1],
            zoneOrigin[2] + fu.at[2],
          ]
          if (fu.kind === 'screen' && fu.surface === id) {
            return [at[0], at[1], at[2] + (fu.h ?? 0.5) * 0.5]
          }
          if (fu.kind === 'board') {
            for (const card of fu.cards) {
              if (card.surface === id) {
                return [at[0], at[1], at[2] + 0.45 - card.row * 0.18]
              }
            }
          }
          if (fu.kind === 'wall-grid') {
            for (const cell of fu.addressable) {
              if (cell.surface === id) {
                return [at[0], at[1], at[2] + fu.h * (1 - cell.row / fu.rows)]
              }
            }
          }
        }
      }
      floorZ += f.height
    }
  }
  return null
}

function onPointerLeave() {
  hoveredSurface = null
  hoveredActorId = null
  if (tooltipEl.value) tooltipEl.value.style.opacity = '0'
  if (canvasEl.value) canvasEl.value.style.cursor = ''
}

function onClick(e: MouseEvent) {
  if (!props.interactive || !canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const { surface, actorId } = findHover(mx, my)
  if (actorId) {
    // Wake the actor — start a quick walk along channel-a.
    const a = state.scene.actors.find((x) => x.id === actorId)
    if (a) {
      a.walking = {
        points: [a.position, [a.position[0] + 1, a.position[1] - 0.4, a.position[2]]],
        t: 0,
        speed: 2.0,
      }
    }
  } else if (surface && !surface.startsWith('__')) {
    state.highlights.set(surface, 1)
    const t = state.scene.threads.find((x) => x.manifestations.includes(surface))
    if (t) state.lastPulseMs.set(t.id, state.elapsedMs)
  } else if (surface && surface.startsWith('__comet__')) {
    // Spawn a fresh comet on the same channel.
    const parts = surface.split(':')
    const channelId = parts[2]
    state.comets.push({
      channelId,
      threadId: parts[1],
      t: 0,
      speed: 0.18,
      birthMs: state.elapsedMs,
    })
  }
}

function tick(now: number) {
  if (!running) return
  const dt = Math.min(now - lastTime, 50)
  lastTime = now

  if (visible) {
    state.filter = resolvedFilter()
    tickScene(state, dt, tweaks.value, activeCrop.value, scripts.value, reducedMotion.value)
  }

  // Advance crop-zoom interpolation if active.
  if (zoomActive && !reducedMotion.value && props.zoomIn) {
    zoomT = Math.min(1, zoomT + dt / props.zoomDurationMs)
    rebuildProjector()
    if (zoomT >= 1) zoomActive = false
  }

  const c = canvasEl.value
  const ctx = c?.getContext('2d')
  if (c && ctx && proj) {
    drawScene(
      {
        ctx,
        width: widthCss,
        height: heightCss,
        dark: isDark(),
        crop: currentCrop(),
        tweaks: tweaks.value,
        state,
        exclusions,
        hoveredSurface,
        hoveredActorId,
        reducedMotion: reducedMotion.value,
      },
      proj
    )
  }

  raf = requestAnimationFrame(tick)
}

function start() {
  if (running) return
  running = true
  lastTime = performance.now()
  raf = requestAnimationFrame(tick)
}

function stop() {
  running = false
  cancelAnimationFrame(raf)
}

function onResize() {
  doLayout()
  // Re-measure exclusions next frame after potential layout settle.
  requestAnimationFrame(() => {
    exclusions = measureExclusions()
  })
}

let observer: IntersectionObserver | null = null
// v2 debounce — only reset the focus script if the section was hidden
// (visibility ratio < 0.05) for *more than 2 seconds*. Stops the
// vignette from re-restarting every time the user scrolls a few
// pixels in/out of frame.
let lastHiddenAt = 0
const RESET_DEBOUNCE_MS = 2000
const HIDDEN_THRESHOLD = 0.05

function setupObserver() {
  if (typeof window === 'undefined' || !wrapEl.value) return
  if (props.autoStart) {
    visible = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= HIDDEN_THRESHOLD) {
          if (!visible) {
            const hiddenForMs = lastHiddenAt
              ? performance.now() - lastHiddenAt
              : Infinity
            if (hiddenForMs > RESET_DEBOUNCE_MS) {
              // Long enough away that re-entry deserves a fresh intro.
              resetScriptCursor(state)
              // And re-trigger the crop-zoom-in on vignettes.
              if (props.zoomIn && !reducedMotion.value) {
                zoomT = 0
                zoomActive = true
                rebuildProjector()
              }
            }
          }
          visible = true
        } else {
          if (visible) lastHiddenAt = performance.now()
          visible = false
        }
      }
    },
    {
      rootMargin: '0px',
      // Multiple thresholds so we get accurate ratios.
      threshold: [0, HIDDEN_THRESHOLD, 0.25, 0.5],
    }
  )
  observer.observe(wrapEl.value)
}

const mql = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null
const mqlAspect = typeof window !== 'undefined'
  ? window.matchMedia('(max-width: 767px)')
  : null

function syncReducedMotion() {
  reducedMotion.value = !!mql?.matches
}

function syncAspect() {
  recomputeAspect()
  rebuildProjector()
}

watch(
  () => props.crop,
  () => {
    rebuildProjector()
    resetScriptCursor(state)
    if (props.zoomIn && !reducedMotion.value) {
      zoomT = 0
      zoomActive = true
    }
  }
)

onMounted(() => {
  syncReducedMotion()
  mql?.addEventListener('change', syncReducedMotion)
  mqlAspect?.addEventListener('change', syncAspect)

  // Initial zoom state.
  if (props.zoomIn && !reducedMotion.value) {
    zoomT = 0
    zoomActive = true
  } else {
    zoomT = 1
    zoomActive = false
  }

  // Two rAFs to ensure parent layout is settled before measuring text rects.
  requestAnimationFrame(() => requestAnimationFrame(() => doLayout()))
  window.addEventListener('resize', onResize)

  const c = canvasEl.value
  if (c) {
    c.addEventListener('pointermove', onPointerMove)
    c.addEventListener('pointerleave', onPointerLeave)
    c.addEventListener('click', onClick)
  }

  setupObserver()
  start()
})

onUnmounted(() => {
  stop()
  mql?.removeEventListener('change', syncReducedMotion)
  mqlAspect?.removeEventListener('change', syncAspect)
  window.removeEventListener('resize', onResize)
  observer?.disconnect()
  observer = null
  const c = canvasEl.value
  if (c) {
    c.removeEventListener('pointermove', onPointerMove)
    c.removeEventListener('pointerleave', onPointerLeave)
    c.removeEventListener('click', onClick)
  }
})

</script>

<template>
  <div
    ref="wrapEl"
    class="home-iso-wrap"
    :class="{ 'home-iso-wrap--feather': feather }"
    :style="bleedInsets"
  >
    <canvas ref="canvasEl" class="home-iso-canvas" />
    <div ref="tooltipEl" class="home-iso-tooltip" />
  </div>
</template>

<style scoped>
.home-iso-wrap {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  contain: paint;
}

/* Soften the rectangular edges of the canvas so the iso scene fades
   gracefully into the page background instead of cutting hard at the
   bleed bounds. The mask intersects two linear gradients: a gentle
   horizontal feather (~10 %) and a much stronger vertical feather
   (~28 %) so the top/bottom melt away before the iso geometry would
   otherwise be cut. */
.home-iso-wrap--feather {
  -webkit-mask-image:
    linear-gradient(to right, transparent 0%, #000 10%, #000 90%, transparent 100%),
    linear-gradient(to bottom, transparent 0%, #000 28%, #000 72%, transparent 100%);
  -webkit-mask-composite: source-in;
  mask-image:
    linear-gradient(to right, transparent 0%, #000 10%, #000 90%, transparent 100%),
    linear-gradient(to bottom, transparent 0%, #000 28%, #000 72%, transparent 100%);
  mask-composite: intersect;
}

.home-iso-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.home-iso-tooltip {
  position: absolute;
  pointer-events: none;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--ea-surface-alt);
  color: var(--ea-text-2);
  border: 1px solid var(--vp-c-divider);
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 2;
}
</style>
