<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

// Section 2: "Online together" — one shape, three live readers.
// A Postgres source emits events; three clients (web, mobile, agent)
// each receive them with a slight, different latency, then render the
// most-recent rows in their own typography. The point: same shape,
// different surfaces, all live.

interface Row {
  id: string
  text: string
  user: string
}

const SEED: Row[] = [
  { id: "01F7", text: "Reviewed PR #214", user: "alex" },
  { id: "01F8", text: "Closed issue #87", user: "sam" },
  { id: "01F9", text: "Deployed v0.9.3", user: "jen" },
  { id: "01FA", text: "Tagged release", user: "alex" },
  { id: "01FB", text: "Merged main → prod", user: "kai" },
  { id: "01FC", text: "Updated runbook", user: "sam" },
  { id: "01FD", text: "Triaged inbox", user: "jen" },
  { id: "01FE", text: "Approved design", user: "alex" },
]

interface PulseState {
  x: number
  y: number
  opacity: number
}

// All pulse coordinates are in the SVG viewBox (0 0 600 80), so the
// pulses always travel along the rendered lines no matter how the SVG
// is stretched. preserveAspectRatio="none" stretches both lines and
// pulses identically.
const FAN_SOURCE = { x: 300, y: 0 }
const FAN_TARGETS = {
  web: { x: 100, y: 80 },
  mobile: { x: 300, y: 80 },
  agent: { x: 500, y: 80 },
}
const PULSE_DURATION = 620

const sourceTick = ref(0)
const webRows = ref<Row[]>([])
const mobileRows = ref<Row[]>([])
const agentRows = ref<Row[]>([])

const webPulse = ref<PulseState>({ ...FAN_SOURCE, opacity: 0 })
const mobilePulse = ref<PulseState>({ ...FAN_SOURCE, opacity: 0 })
const agentPulse = ref<PulseState>({ ...FAN_SOURCE, opacity: 0 })
const sourcePulse = ref(0)

const rootRef = ref<HTMLElement>()
const isVisible = useDemoVisibility(rootRef)
const hasStarted = ref(false)

let timer: number | undefined
let mounted = true

function pushRow(target: { value: Row[] }, row: Row, max = 4) {
  target.value = [row, ...target.value].slice(0, max)
}

const prefersReducedMotion =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false

function runPulse(
  target: { value: PulseState },
  end: { x: number; y: number },
) {
  if (prefersReducedMotion) return
  const start = performance.now()
  const sx = FAN_SOURCE.x
  const sy = FAN_SOURCE.y
  function step(now: number) {
    if (!mounted) return
    const t = Math.min(1, (now - start) / PULSE_DURATION)
    const eased = 1 - Math.pow(1 - t, 2)
    const opacity =
      t < 0.1 ? t / 0.1 : t > 0.85 ? Math.max(0, (1 - t) / 0.15) : 1
    target.value = {
      x: sx + (end.x - sx) * eased,
      y: sy + (end.y - sy) * eased,
      opacity,
    }
    if (t < 1) requestAnimationFrame(step)
    else target.value = { ...target.value, opacity: 0 }
  }
  requestAnimationFrame(step)
}

let emitCounter = 0

function emitOne() {
  const base = SEED[emitCounter % SEED.length]
  const seq = emitCounter.toString(16).toUpperCase().padStart(3, "0")
  const row = { ...base, id: `01F${seq}` }
  sourcePulse.value = Date.now()
  sourceTick.value += 1

  // Each client receives with its own latency (HTTP CDN realism)
  setTimeout(() => {
    pushRow(webRows, row)
    runPulse(webPulse, FAN_TARGETS.web)
  }, 320)
  setTimeout(() => {
    pushRow(mobileRows, row)
    runPulse(mobilePulse, FAN_TARGETS.mobile)
  }, 540)
  setTimeout(() => {
    pushRow(agentRows, row)
    runPulse(agentPulse, FAN_TARGETS.agent)
  }, 720)

  emitCounter += 1
}

let hasEmittedOnce = false
function start() {
  if (timer) return
  // Only emit immediately on the very first start, so the demo doesn't
  // burst rows every time visibility briefly flips during layout settle.
  if (!hasEmittedOnce) {
    hasEmittedOnce = true
    emitOne()
  }
  timer = window.setInterval(emitOne, 2400)
}

function stop() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

watch(isVisible, (v) => {
  if (v) {
    hasStarted.value = true
    start()
  } else {
    stop()
  }
})

onMounted(() => {
  // Pre-seed the full row budget (4) so the cards never grow once
  // live emits start arriving — height stays rock-stable.
  const seeded = SEED.slice(0, 4).map((r, idx) => ({ ...r, id: `seed-${idx}` }))
  webRows.value = seeded
  mobileRows.value = seeded
  agentRows.value = seeded
  if (isVisible.value) {
    hasStarted.value = true
    start()
  }
})

onUnmounted(() => {
  mounted = false
  stop()
})
</script>

<template>
  <div ref="rootRef" class="mcp-demo" :class="{ started: hasStarted }">
    <div class="mcp-stage">
      <!-- Source -->
      <div class="mcp-source" :class="{ pulse: sourcePulse > 0 }" :key="sourcePulse">
        <div class="mcp-source-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
            <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
          </svg>
        </div>
        <div class="mcp-source-text">
          <div class="mcp-source-label">Postgres</div>
          <div class="mcp-source-shape">shape: <span class="mono">events</span></div>
        </div>
        <div class="mcp-source-tick mono">tx&nbsp;{{ sourceTick.toString().padStart(3, "0") }}</div>
      </div>

      <!-- Fan-out lines + pulses (all in viewBox space so pulses
           travel exactly along the rendered lines) -->
      <svg class="mcp-fan" viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true">
        <line class="fan-line" x1="300" y1="0" x2="100" y2="80" />
        <line class="fan-line" x1="300" y1="0" x2="300" y2="80" />
        <line class="fan-line" x1="300" y1="0" x2="500" y2="80" />
        <circle
          class="fan-pulse"
          r="3.5"
          :cx="webPulse.x"
          :cy="webPulse.y"
          :opacity="webPulse.opacity"
        />
        <circle
          class="fan-pulse"
          r="3.5"
          :cx="mobilePulse.x"
          :cy="mobilePulse.y"
          :opacity="mobilePulse.opacity"
        />
        <circle
          class="fan-pulse"
          r="3.5"
          :cx="agentPulse.x"
          :cy="agentPulse.y"
          :opacity="agentPulse.opacity"
        />
      </svg>

      <!-- Three clients -->
      <div class="mcp-clients">
        <div class="mcp-client client-web">
          <div class="client-header">
            <span class="client-dot web-dot"></span>
            <span class="client-name">Web</span>
            <span class="client-meta mono">react</span>
          </div>
          <ul class="client-list">
            <li v-for="row in webRows" :key="`w-${row.id}`" class="client-row card-row">
              <span class="row-id mono">{{ row.id }}</span>
              <span class="row-text">{{ row.text }}</span>
              <span class="row-user mono">@{{ row.user }}</span>
            </li>
          </ul>
        </div>

        <div class="mcp-client client-mobile">
          <div class="client-header">
            <span class="client-dot mobile-dot"></span>
            <span class="client-name">Mobile</span>
            <span class="client-meta mono">expo</span>
          </div>
          <ul class="client-list">
            <li v-for="row in mobileRows" :key="`m-${row.id}`" class="client-row chat-row">
              <span class="row-text">{{ row.text }}</span>
              <span class="row-user mono">@{{ row.user }}</span>
            </li>
          </ul>
        </div>

        <div class="mcp-client client-agent">
          <div class="client-header">
            <span class="client-dot agent-dot"></span>
            <span class="client-name">Agent</span>
            <span class="client-meta mono">handler</span>
          </div>
          <ul class="client-list">
            <li v-for="row in agentRows" :key="`a-${row.id}`" class="client-row term-row">
              <span class="row-id mono">[{{ row.id }}]</span>
              <span class="row-text mono">{{ row.text }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-demo {
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 22px 24px;
}

.mcp-stage {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Source ─────────────────────────────────────────────────────── */

.mcp-source {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  position: relative;
  z-index: 1;
}

.mcp-source.pulse::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 10px;
  border: 1px solid var(--vp-c-brand-1);
  animation: mcp-source-flash 0.7s ease-out forwards;
  pointer-events: none;
}

@keyframes mcp-source-flash {
  0% { opacity: 0.9; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.04); }
}

.mcp-source-icon {
  color: var(--ea-text-2);
  display: flex;
}

.mcp-source-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.2;
}

.mcp-source-shape {
  font-size: 12px;
  color: var(--ea-text-2);
  margin-top: 2px;
}

.mcp-source-tick {
  font-size: 11px;
  color: var(--ea-text-3);
  margin-left: 4px;
  padding-left: 14px;
  border-left: 1px solid var(--ea-divider);
}

/* ── Fan-out svg ────────────────────────────────────────────────── */

.mcp-fan {
  width: 100%;
  height: 24px;
  margin: -2px 0;
}

.fan-line {
  stroke: var(--ea-divider);
  stroke-width: 1;
}

.fan-pulse {
  fill: var(--vp-c-brand-1);
}

/* ── Clients ────────────────────────────────────────────────────── */

.mcp-clients {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.mcp-client {
  background: var(--ea-bg);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.client-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ea-divider);
  flex-wrap: nowrap;
  min-width: 0;
}

.client-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  display: inline-block;
}

.client-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ea-text-1);
  white-space: nowrap;
}

.client-meta {
  font-size: 11px;
  color: var(--ea-text-3);
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.mono {
  font-family: var(--vp-font-family-mono);
}

.client-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* Reserve enough height for 4 of the tallest (chat) row variant so
     the card height stays constant as new rows enter and the
     enter-animation translateY can't push the parent. */
  height: 144px;
  overflow: hidden;
}

.client-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.35;
  padding: 4px 0;
}
.mcp-demo.started .client-row {
  animation: mcp-row-in 0.4s ease-out;
}

@keyframes mcp-row-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Web style: card-list */
.card-row {
  background: var(--ea-surface-alt);
  border-radius: 4px;
  padding: 5px 8px;
}
.card-row .row-id {
  font-size: 10.5px;
  color: var(--ea-text-3);
}
.card-row .row-text {
  flex: 1;
  color: var(--ea-text-1);
}
.card-row .row-user {
  font-size: 11px;
  color: var(--ea-text-2);
}

/* Mobile style: chat-list */
.chat-row {
  flex-direction: column;
  align-items: flex-start;
  background: transparent;
  padding: 2px 0;
  gap: 1px;
  border-bottom: 1px dashed var(--ea-divider);
  line-height: 1.25;
}
.chat-row:last-child {
  border-bottom: none;
}
.chat-row .row-text {
  color: var(--ea-text-1);
  font-size: 12.5px;
}
.chat-row .row-user {
  font-size: 10px;
  color: var(--ea-text-3);
}

/* Agent style: terminal log */
.term-row {
  font-size: 12px;
  color: var(--ea-text-2);
  background: transparent;
  padding: 2px 0;
}
.term-row .row-id {
  color: var(--ea-text-3);
}
.term-row .row-text {
  color: var(--ea-text-1);
}

/* ── Responsive ─────────────────────────────────────────────────── */

@media (max-width: 760px) {
  .mcp-clients {
    grid-template-columns: 1fr;
  }
  .mcp-fan {
    height: 50px;
  }
  .mcp-demo {
    padding: 18px;
  }
}
</style>
