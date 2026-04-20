<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

/* ── Diagram geometry (SVG units) ───────────────────────────────────── */

const VB_W = 400
const VB_H = 305

const ORIGIN = { x: 140, y: 8, w: 120, h: 46 }
const ORIGIN_BOTTOM = { x: ORIGIN.x + ORIGIN.w / 2, y: ORIGIN.y + ORIGIN.h }
const ORIGIN_VLINE_END_Y = 100

const EDGES = [
  { id: "lhr", label: "edge:lhr", x: 18, y: 102, w: 110, h: 32 },
  { id: "fra", label: "edge:fra", x: 145, y: 102, w: 110, h: 32 },
  { id: "nyc", label: "edge:nyc", x: 272, y: 102, w: 110, h: 32 },
]

interface FanLine {
  edgeIdx: number
  x1: number
  y1: number
  x2: number
  y2: number
}

const FAN_TARGET_Y = 200
const FAN_LINES: FanLine[] = []
EDGES.forEach((edge, i) => {
  const cx = edge.x + edge.w / 2
  const cy = edge.y + edge.h
  const targets = [cx - 38, cx, cx + 38]
  for (const tx of targets) {
    FAN_LINES.push({ edgeIdx: i, x1: cx, y1: cy, x2: tx, y2: FAN_TARGET_Y })
  }
})

/* ── Dot grid ───────────────────────────────────────────────────────── */

const GRID_COLS = 16
const GRID_ROWS = 5
const GRID_X_START = 22
const GRID_X_END = 378
const GRID_Y_START = 210
const GRID_Y_END = 282

interface Dot {
  x: number
  y: number
}

const dots: Dot[] = []
{
  const stepX = (GRID_X_END - GRID_X_START) / (GRID_COLS - 1)
  const stepY = (GRID_Y_END - GRID_Y_START) / (GRID_ROWS - 1)
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      dots.push({
        x: GRID_X_START + c * stepX,
        y: GRID_Y_START + r * stepY,
      })
    }
  }
}

/* ── Reactive state ─────────────────────────────────────────────────── */

const rootRef = ref<HTMLElement>()
const isActive = useDemoVisibility(rootRef)

const cycleId = ref(0)
const originPulse = ref(false)
const pulsingEdges = ref<Set<number>>(new Set())
const twinklingDots = ref<Set<number>>(new Set())

const originRequests = ref(1)
const clientReads = ref(12438)
const animatingOrigin = ref(false)
const animatingClient = ref(false)

const formatter = new Intl.NumberFormat("en-US")
const originText = computed(() => formatter.format(Math.round(originRequests.value)))
const clientText = computed(() => formatter.format(Math.round(clientReads.value)))

let cycleTimer: number | null = null
const timers: number[] = []
const rafIds: number[] = []

function clearTimers() {
  if (cycleTimer !== null) {
    window.clearTimeout(cycleTimer)
    cycleTimer = null
  }
  timers.forEach((t) => window.clearTimeout(t))
  timers.length = 0
  rafIds.forEach((id) => window.cancelAnimationFrame(id))
  rafIds.length = 0
}

function schedule(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms))
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/* ── Counter tween ──────────────────────────────────────────────────── */

function tween(
  ref: { value: number },
  from: number,
  to: number,
  duration: number,
  flag: { value: boolean }
) {
  flag.value = true
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    ref.value = from + (to - from) * eased
    if (t < 1) {
      rafIds.push(window.requestAnimationFrame(step))
    } else {
      ref.value = to
      flag.value = false
    }
  }
  rafIds.push(window.requestAnimationFrame(step))
}

/* ── Cycle runner ───────────────────────────────────────────────────── */

function pickRandom<T>(arr: T[], n: number): T[] {
  const indices = Array.from({ length: arr.length }, (_, i) => i)
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return indices.slice(0, n).map((i) => arr[i])
}

function runCycle() {
  cycleId.value++

  originPulse.value = true
  schedule(420, () => {
    originPulse.value = false
  })

  EDGES.forEach((_, i) => {
    schedule(360 + i * 80, () => {
      const next = new Set(pulsingEdges.value)
      next.add(i)
      pulsingEdges.value = next
      schedule(500, () => {
        const cleared = new Set(pulsingEdges.value)
        cleared.delete(i)
        pulsingEdges.value = cleared
      })
    })
  })

  schedule(900, () => {
    const dotIndices = Array.from({ length: dots.length }, (_, i) => i)
    const picked = pickRandom(dotIndices, 32)
    twinklingDots.value = new Set(picked)
    schedule(700, () => {
      twinklingDots.value = new Set()
    })
  })

  schedule(950, () => {
    const orFrom = originRequests.value
    const cFrom = clientReads.value
    const orTo = orFrom + 1
    const chunk = 2900 + Math.floor(Math.random() * 250)
    const cTo = cFrom + chunk
    tween(originRequests, orFrom, orTo, 600, animatingOrigin)
    tween(clientReads, cFrom, cTo, 600, animatingClient)
  })

  cycleTimer = window.setTimeout(runCycle, 3000)
}

function start() {
  clearTimers()
  originRequests.value = 1
  clientReads.value = 12438
  cycleId.value = 0
  pulsingEdges.value = new Set()
  twinklingDots.value = new Set()
  originPulse.value = false
  runCycle()
}

function stop() {
  clearTimers()
  pulsingEdges.value = new Set()
  twinklingDots.value = new Set()
  originPulse.value = false
}

onMounted(() => {
  if (reducedMotion()) {
    originRequests.value = 1
    clientReads.value = 12438
    return
  }
  watch(
    isActive,
    (v) => {
      if (v) start()
      else stop()
    },
    { immediate: true }
  )
})

onBeforeUnmount(() => {
  clearTimers()
})

/* ── Particles (origin → edges, edges → grid) ───────────────────────── */

interface Particle {
  fromX: number
  fromY: number
  toX: number
  toY: number
  delay: number
  duration: number
  cls: string
}

const particles = computed<Particle[]>(() => {
  const list: Particle[] = []
  EDGES.forEach((edge) => {
    list.push({
      fromX: ORIGIN_BOTTOM.x,
      fromY: ORIGIN_BOTTOM.y,
      toX: edge.x + edge.w / 2,
      toY: edge.y,
      delay: 0,
      duration: 380,
      cls: "cf-particle--solid",
    })
  })
  FAN_LINES.forEach((line, i) => {
    list.push({
      fromX: line.x1,
      fromY: line.y1,
      toX: line.x2,
      toY: line.y2,
      delay: 420 + (i % 3) * 60,
      duration: 460,
      cls: "cf-particle--dashed",
    })
  })
  return list
})
</script>

<template>
  <div ref="rootRef" class="cf">
    <span class="sr-only">
      A diagram showing one origin Electric Stream request fanning out
      through three CDN edge nodes — lhr, fra and nyc — to a grid of
      cached client reads. Counters at the bottom show one origin
      request and twelve thousand four hundred and thirty-eight client
      reads.
    </span>

    <div class="cf-frame" aria-hidden="true">
      <svg
        class="cf-svg"
        :viewBox="`0 0 ${VB_W} ${VB_H}`"
        preserveAspectRatio="xMidYMid meet"
      >
        <!-- Origin → Edges connector -->
        <line
          :x1="ORIGIN_BOTTOM.x"
          :y1="ORIGIN_BOTTOM.y"
          :x2="ORIGIN_BOTTOM.x"
          :y2="ORIGIN_VLINE_END_Y"
          class="cf-arrow cf-arrow--solid"
        />
        <line
          v-for="edge in EDGES"
          :key="`split-${edge.id}`"
          :x1="ORIGIN_BOTTOM.x"
          :y1="ORIGIN_VLINE_END_Y - 1"
          :x2="edge.x + edge.w / 2"
          :y2="edge.y"
          class="cf-arrow cf-arrow--solid"
        />

        <!-- Edges → Grid fan-out -->
        <line
          v-for="(line, i) in FAN_LINES"
          :key="`fan-${i}`"
          :x1="line.x1"
          :y1="line.y1"
          :x2="line.x2"
          :y2="line.y2"
          class="cf-arrow cf-arrow--dashed"
        />

        <!-- Dot grid -->
        <circle
          v-for="(d, i) in dots"
          :key="`dot-${i}`"
          :cx="d.x"
          :cy="d.y"
          r="1.8"
          class="cf-dot"
          :class="{ 'cf-dot--twinkle': twinklingDots.has(i) }"
        />

        <!-- Origin box -->
        <g class="cf-origin" :class="{ 'cf-origin--pulse': originPulse }">
          <rect
            :x="ORIGIN.x"
            :y="ORIGIN.y"
            :width="ORIGIN.w"
            :height="ORIGIN.h"
            rx="6"
            ry="6"
            class="cf-origin-box"
          />
          <text
            :x="ORIGIN.x + ORIGIN.w / 2"
            :y="ORIGIN.y + 18"
            text-anchor="middle"
            class="cf-origin-title"
          >
            <tspan class="cf-origin-bolt">⚡</tspan>
            <tspan dx="4">Stream</tspan>
          </text>
          <text
            :x="ORIGIN.x + ORIGIN.w / 2"
            :y="ORIGIN.y + 35"
            text-anchor="middle"
            class="cf-origin-sub"
          >
            offset = …KV00
          </text>
        </g>

        <!-- "1 origin request" label, to the right of vertical arrow -->
        <text
          :x="ORIGIN_BOTTOM.x + 12"
          :y="(ORIGIN_BOTTOM.y + ORIGIN_VLINE_END_Y) / 2 + 3"
          class="cf-arrow-label"
        >
          1 origin request
        </text>

        <!-- Edge boxes -->
        <g
          v-for="(edge, i) in EDGES"
          :key="`edge-${edge.id}`"
          class="cf-edge"
          :class="{ 'cf-edge--pulse': pulsingEdges.has(i) }"
        >
          <rect
            :x="edge.x"
            :y="edge.y"
            :width="edge.w"
            :height="edge.h"
            rx="6"
            ry="6"
            class="cf-edge-box"
          />
          <text
            :x="edge.x + edge.w / 2"
            :y="edge.y + edge.h / 2 + 4"
            text-anchor="middle"
            class="cf-edge-text"
          >
            {{ edge.label }}
          </text>
        </g>

        <!-- Particles (re-keyed each cycle so animations restart) -->
        <g :key="cycleId" class="cf-particles">
          <circle
            v-for="(p, i) in particles"
            :key="i"
            :cx="p.toX"
            :cy="p.toY"
            r="2"
            :class="['cf-particle', p.cls]"
            :style="{
              '--dx': `${p.fromX - p.toX}px`,
              '--dy': `${p.fromY - p.toY}px`,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.duration}ms`,
            }"
          />
        </g>

        <!-- Caption -->
        <text
          :x="VB_W / 2"
          :y="VB_H - 5"
          text-anchor="middle"
          class="cf-caption"
        >
          {{ formatter.format(Math.round(clientReads)) }} cached reads to
          clients
        </text>
      </svg>
    </div>

    <div class="cf-stats" aria-hidden="true">
      <div class="cf-stat">
        <div class="cf-stat-label">origin requests</div>
        <div
          class="cf-stat-num"
          :class="{ 'cf-stat-num--ticking': animatingOrigin }"
        >
          {{ originText }}
        </div>
      </div>
      <div class="cf-stat-divider" />
      <div class="cf-stat">
        <div class="cf-stat-label">client reads</div>
        <div
          class="cf-stat-num cf-stat-num--brand"
          :class="{ 'cf-stat-num--ticking': animatingClient }"
        >
          {{ clientText }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cf {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── Diagram frame ────────────────────────────────────────────────────── */

.cf-frame {
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  padding: 14px 14px 6px;
}

.dark .cf-frame {
  background: var(--ea-surface-alt);
}

.cf-svg {
  display: block;
  width: 100%;
  height: auto;
  font-family: var(--vp-font-family-mono);
}

/* ── Connectors ───────────────────────────────────────────────────────── */

.cf-arrow {
  fill: none;
  stroke: var(--ea-divider);
  stroke-width: 1;
}
.cf-arrow--solid {
  stroke: color-mix(in srgb, var(--ea-text-2) 45%, transparent);
}
.cf-arrow--dashed {
  stroke-dasharray: 2 3;
  stroke: color-mix(in srgb, var(--ea-text-2) 35%, transparent);
}

.cf-arrow-label {
  font-size: 8px;
  fill: var(--ea-text-2);
  letter-spacing: 0.02em;
}

/* ── Origin ──────────────────────────────────────────────────────────── */

.cf-origin-box {
  fill: var(--ea-surface-alt);
  stroke: color-mix(in srgb, var(--vp-c-brand-1) 55%, var(--ea-divider));
  stroke-width: 1;
  transition: stroke 0.4s ease, filter 0.4s ease;
}

.dark .cf-origin-box {
  fill: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--ea-surface));
}

.cf-origin-bolt {
  fill: var(--vp-c-brand-1);
  font-size: 11px;
}

.cf-origin-title {
  font-size: 11px;
  font-weight: 700;
  fill: var(--ea-text-1);
}

.cf-origin-sub {
  font-size: 9px;
  fill: var(--ea-text-2);
}

.cf-origin--pulse .cf-origin-box {
  stroke: var(--vp-c-brand-1);
  filter: drop-shadow(
    0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 60%, transparent)
  );
}

/* ── Edges ──────────────────────────────────────────────────────────── */

.cf-edge-box {
  fill: var(--ea-surface-alt);
  stroke: var(--ea-divider);
  stroke-width: 1;
  transition: stroke 0.35s ease, filter 0.35s ease;
}

.dark .cf-edge-box {
  fill: color-mix(in srgb, var(--ea-text-1) 4%, var(--ea-surface));
}

.cf-edge-text {
  font-size: 9px;
  fill: var(--ea-text-1);
  letter-spacing: 0.02em;
}

.cf-edge--pulse .cf-edge-box {
  stroke: var(--vp-c-brand-1);
  filter: drop-shadow(
    0 0 3px color-mix(in srgb, var(--vp-c-brand-1) 55%, transparent)
  );
}

/* ── Dot grid ───────────────────────────────────────────────────────── */

.cf-dot {
  fill: var(--ea-text-2);
  opacity: 0.35;
  transition: fill 0.35s ease, opacity 0.35s ease;
}

.cf-dot--twinkle {
  fill: var(--vp-c-brand-1);
  opacity: 0.85;
}

/* ── Caption ────────────────────────────────────────────────────────── */

.cf-caption {
  font-size: 9px;
  fill: var(--ea-text-2);
  letter-spacing: 0.02em;
}

/* ── Particles ──────────────────────────────────────────────────────── */

.cf-particle {
  fill: var(--vp-c-brand-1);
  opacity: 0;
  transform: translate(var(--dx), var(--dy));
  animation-name: cf-particle-fly;
  animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
  animation-fill-mode: forwards;
  transform-box: fill-box;
  transform-origin: center;
}
.cf-particle--dashed {
  opacity: 0;
  r: 1.5;
}

@keyframes cf-particle-fly {
  0% {
    opacity: 0;
    transform: translate(var(--dx), var(--dy));
  }
  20% {
    opacity: 0.95;
  }
  80% {
    opacity: 0.95;
  }
  100% {
    opacity: 0;
    transform: translate(0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cf-particle {
    display: none;
  }
}

/* ── Stats panel ────────────────────────────────────────────────────── */

.cf-stats {
  display: flex;
  align-items: center;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface-alt);
  overflow: hidden;
}

.cf-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 16px;
}

.cf-stat-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cf-stat-num {
  font-family: var(--vp-font-family-mono);
  font-size: 18px;
  font-weight: 700;
  color: var(--ea-text-1);
  font-variant-numeric: tabular-nums;
  transition: color 0.3s ease;
}

.cf-stat-num--brand {
  color: var(--vp-c-brand-1);
}

.cf-stat-num--ticking {
  color: var(--vp-c-brand-1);
}

.cf-stat-divider {
  width: 1px;
  align-self: stretch;
  background: var(--ea-divider);
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .cf-frame {
    padding: 10px 10px 4px;
  }
  .cf-stat-num {
    font-size: 16px;
  }
  .cf-stat {
    padding: 12px 10px;
  }
  .cf-stat-label {
    font-size: 10px;
  }
}
</style>
