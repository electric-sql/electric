<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

const DESKTOP_COLS = 8
const DESKTOP_ROWS = 5
const MOBILE_COLS = 6
const MOBILE_ROWS = 4
const DOT_SIZE = 12
const GAP = 16

const containerRef = ref<HTMLElement | null>(null) as { value: HTMLElement | undefined }
const isActive = useDemoVisibility(containerRef)
const isMobile = ref(false)

const cols = computed(() => (isMobile.value ? MOBILE_COLS : DESKTOP_COLS))
const rows = computed(() => (isMobile.value ? MOBILE_ROWS : DESKTOP_ROWS))
const totalDots = computed(() => cols.value * rows.value)

const activeDots = ref(new Set<number>())
const pulsingDots = ref(new Set<number>())
const lines = ref<Array<{ from: number; to: number; id: number }>>([])
let lineId = 0

const activeCount = computed(() => activeDots.value.size)

const prefixes = [
  "/worker/task",
  "/agent/planner",
  "/bot/scraper",
  "/agent/reviewer",
  "/worker/indexer",
  "/bot/monitor",
  "/agent/coder",
  "/worker/deploy",
  "/agent/tester",
  "/bot/scheduler",
  "/worker/build",
  "/agent/analyst",
  "/bot/fetcher",
  "/worker/sync",
  "/agent/parser",
]

function entityName(idx: number): string {
  return `${prefixes[idx % prefixes.length]}-${idx}`
}

function adjacents(idx: number): number[] {
  const c = idx % cols.value
  const r = Math.floor(idx / cols.value)
  const result: number[] = []
  if (c > 0) result.push(idx - 1)
  if (c < cols.value - 1) result.push(idx + 1)
  if (r > 0) result.push(idx - cols.value)
  if (r < rows.value - 1) result.push(idx + cols.value)
  return result
}

function activate(idx: number) {
  activeDots.value = new Set([...activeDots.value, idx])
  pulsingDots.value = new Set([...pulsingDots.value, idx])
  setTimeout(() => {
    pulsingDots.value = new Set([...pulsingDots.value].filter((i) => i !== idx))
  }, 400)
}

function deactivate(idx: number) {
  activeDots.value = new Set([...activeDots.value].filter((i) => i !== idx))
}

function showLine(from: number, to: number) {
  const id = ++lineId
  lines.value = [...lines.value, { from, to, id }]
  timers.push(
    window.setTimeout(() => {
      lines.value = lines.value.filter((l) => l.id !== id)
    }, 600),
  )
}

function dotCenter(idx: number): { x: number; y: number } {
  const c = idx % cols.value
  const r = Math.floor(idx / cols.value)
  return {
    x: c * (DOT_SIZE + GAP) + DOT_SIZE / 2,
    y: r * (DOT_SIZE + GAP) + DOT_SIZE / 2,
  }
}

const gridWidth = computed(() => cols.value * DOT_SIZE + (cols.value - 1) * GAP)
const gridHeight = computed(
  () => rows.value * DOT_SIZE + (rows.value - 1) * GAP,
)

let timers: number[] = []
let cycleTimer: number | null = null

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t))
  timers = []
  if (cycleTimer !== null) {
    window.clearTimeout(cycleTimer)
    cycleTimer = null
  }
}

function reset() {
  activeDots.value = new Set()
  pulsingDots.value = new Set()
  lines.value = []
}

function schedule(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms))
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function distanceFromSeed(idx: number, seedIdx: number, colCount: number): number {
  const c1 = idx % colCount
  const r1 = Math.floor(idx / colCount)
  const c2 = seedIdx % colCount
  const r2 = Math.floor(seedIdx / colCount)
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

function runCycle() {
  reset()

  const total = totalDots.value
  const c = cols.value
  const seedIdx = Math.floor(Math.random() * total)
  const waveCount = Math.floor(total * 0.4)

  const allIndices = Array.from({ length: total }, (_, i) => i)
  allIndices.sort((a, b) => {
    const da = distanceFromSeed(a, seedIdx, c)
    const db = distanceFromSeed(b, seedIdx, c)
    if (da !== db) return da - db
    return Math.random() - 0.5
  })

  const waveIndices = allIndices.slice(0, waveCount)
  const maxDist = distanceFromSeed(waveIndices[waveIndices.length - 1], seedIdx, c)

  const WAVE_SPREAD_MS = 1600
  const HOLD_MS = 1400
  const SCALE_DOWN_MS = 1200

  let prevIdx = -1
  waveIndices.forEach((idx) => {
    const dist = distanceFromSeed(idx, seedIdx, c)
    const jitter = (Math.random() - 0.5) * 100
    const delay = 600 + (dist / Math.max(maxDist, 1)) * WAVE_SPREAD_MS + jitter

    const lineFrom = prevIdx
    schedule(delay, () => {
      activate(idx)
      if (lineFrom >= 0 && Math.random() < 0.5) {
        showLine(lineFrom, idx)
      }
    })
    prevIdx = idx
  })

  const peakTime = 600 + WAVE_SPREAD_MS + 200

  const deactivateOrder = shuffle(waveIndices)
  deactivateOrder.forEach((idx, i) => {
    const delay = peakTime + HOLD_MS + (i / deactivateOrder.length) * SCALE_DOWN_MS
    const jitter = (Math.random() - 0.5) * 80
    schedule(delay + jitter, () => deactivate(idx))
  })

  const totalCycleMs = peakTime + HOLD_MS + SCALE_DOWN_MS + 2000
  cycleTimer = window.setTimeout(() => runCycle(), totalCycleMs)
}

// --- Tooltip ---

const hoveredDot = ref<number | null>(null)
const tooltipStyle = ref<Record<string, string>>({})

function onDotEnter(idx: number, e: MouseEvent) {
  hoveredDot.value = idx
  const el = e.currentTarget as HTMLElement
  const container = containerRef.value
  if (!container) return
  const cr = container.getBoundingClientRect()
  const dr = el.getBoundingClientRect()
  tooltipStyle.value = {
    left: `${dr.left - cr.left + dr.width / 2}px`,
    top: `${dr.top - cr.top - 6}px`,
  }
}

function onDotLeave() {
  hoveredDot.value = null
}

// --- Lifecycle ---

function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}

onMounted(() => {
  checkMobile()
  window.addEventListener("resize", checkMobile)

  watch(isActive, (v) => {
    if (v) {
      runCycle()
    } else {
      clearTimers()
      reset()
    }
  }, { immediate: true })
})

onBeforeUnmount(() => {
  clearTimers()
  window.removeEventListener("resize", checkMobile)
})

const counterText = computed(() => {
  const n = activeCount.value
  return `${totalDots.value} entities · ${n} active`
})
</script>

<template>
  <div ref="containerRef" class="agent-grid-demo">
    <div class="grid-wrapper" :style="{ width: gridWidth + 'px', height: gridHeight + 'px' }">
      <!-- SVG lines layer -->
      <svg class="lines-layer" :viewBox="`0 0 ${gridWidth} ${gridHeight}`">
        <line
          v-for="line in lines"
          :key="line.id"
          :x1="dotCenter(line.from).x"
          :y1="dotCenter(line.from).y"
          :x2="dotCenter(line.to).x"
          :y2="dotCenter(line.to).y"
          class="connect-line"
        />
      </svg>

      <!-- Dots layer -->
      <div
        class="dots-grid"
        :style="{
          gridTemplateColumns: `repeat(${cols}, ${DOT_SIZE}px)`,
          gridTemplateRows: `repeat(${rows}, ${DOT_SIZE}px)`,
          gap: GAP + 'px',
        }"
      >
        <div
          v-for="i in totalDots"
          :key="i - 1"
          class="dot"
          :class="{
            active: activeDots.has(i - 1),
            pulsing: pulsingDots.has(i - 1),
          }"
          @mouseenter="onDotEnter(i - 1, $event)"
          @mouseleave="onDotLeave"
        />
      </div>

      <!-- Tooltip -->
      <div
        v-if="hoveredDot !== null"
        class="dot-tooltip"
        :style="tooltipStyle"
      >
        {{ entityName(hoveredDot) }}
      </div>
    </div>

    <p class="grid-counter">{{ counterText }}</p>
  </div>
</template>

<style scoped>
.agent-grid-demo {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.grid-wrapper {
  position: relative;
}

.dots-grid {
  display: grid;
  position: relative;
  z-index: 1;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ea-indicator-sleep);
  transition:
    background 0.35s ease,
    box-shadow 0.35s ease;
  cursor: default;
}

.dot.active {
  background: var(--ea-indicator-active);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ea-indicator-active) 50%, transparent);
}

.dot.pulsing {
  animation: dot-pulse 0.4s ease-out;
}

@keyframes dot-pulse {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.5);
  }
  100% {
    transform: scale(1);
  }
}

/* SVG connecting lines */
.lines-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}

.connect-line {
  stroke: var(--ea-indicator-active);
  stroke-width: 1.5;
  stroke-linecap: round;
  opacity: 0;
  animation: line-flash 0.6s ease-out forwards;
}

@keyframes line-flash {
  0% {
    opacity: 0;
  }
  30% {
    opacity: 0.6;
  }
  100% {
    opacity: 0;
  }
}

/* Tooltip */
.dot-tooltip {
  position: absolute;
  z-index: 10;
  transform: translate(-50%, -100%);
  padding: 4px 10px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-1);
  white-space: nowrap;
  pointer-events: none;
}

/* Counter */
.grid-counter {
  margin: 16px 0 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--ea-text-2);
  letter-spacing: 0.02em;
  min-width: 200px;
  text-align: center;
}

@media (max-width: 768px) {
  .grid-counter {
    font-size: 12px;
  }
}
</style>
