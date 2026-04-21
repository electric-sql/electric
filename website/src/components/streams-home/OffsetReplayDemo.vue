<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

type Phase = 1 | 2 | 3
type ConsumerStatus = "connected" | "dropped" | "resuming"

interface Chunk {
  id: number
  from: "producer" | "server"
  startTime: number
  duration: number
  duplicate?: boolean
}

interface StackRow {
  id: number
  hex: string
  pending: boolean
  pulse: boolean
}

const TRAVEL_MS = 700
const MAX_STACK_ROWS = 5

const rootRef = ref<HTMLElement>()
const visible = useDemoVisibility(rootRef)

const phase = ref<Phase>(1)
const serverStack = ref<StackRow[]>([])
const producerSeq = ref(15)
const producerSeqBlinking = ref(false)
const consumerStatus = ref<ConsumerStatus>("connected")
const chunksInFlight = ref<Chunk[]>([])
const flightTick = ref(0)
let stackRowIdCounter = 0

const showDuplicateCallout = ref(false)
const showServerCheck = ref(false)
const showServerCross = ref(false)
const showConsumerCheck = ref(false)

const reducedMotion = ref(false)
const showStaticEnd = ref(false)

let rafId: number | null = null
let timers: ReturnType<typeof setTimeout>[] = []
let running = false
let chunkIdCounter = 0

const stackRows = computed(() => serverStack.value)

function makeHex(seq: number): string {
  // Deterministic-ish hex bytes derived from seq, so each row reads as
  // distinct stream content rather than a generic placeholder block.
  const bytes = [seq * 23 + 17, seq * 71 + 5, seq * 113 + 41, seq * 191 + 3]
    .map((n) => ((n % 254) + 1).toString(16).padStart(2, "0"))
    .join(" ")
  return bytes
}

function pushRow(pending: boolean) {
  const id = ++stackRowIdCounter
  const next = [
    ...serverStack.value.map((r) => ({ ...r, pulse: false })),
    { id, hex: makeHex(producerSeq.value), pending, pulse: true },
  ]
  // Keep only the most recent MAX_STACK_ROWS so the box doesn't grow forever.
  serverStack.value = next.slice(-MAX_STACK_ROWS)
}

function syncPendingRows() {
  serverStack.value = serverStack.value.map((r) => ({ ...r, pending: false }))
}

const consumerStatusText = computed(() => {
  switch (consumerStatus.value) {
    case "connected":
      return "● connected"
    case "dropped":
      return "× dropped"
    case "resuming":
      return "↻ resuming"
  }
  return ""
})

function later(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.push(setTimeout(resolve, ms))
  })
}

function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

function fireChunk(from: "producer" | "server", duplicate = false): number {
  const id = ++chunkIdCounter
  chunksInFlight.value = [
    ...chunksInFlight.value,
    {
      id,
      from,
      startTime: performance.now(),
      duration: TRAVEL_MS,
      duplicate,
    },
  ]
  return id
}

function tickRaf() {
  const now = performance.now()
  const next = chunksInFlight.value.filter(
    (c) => now - c.startTime < c.duration
  )
  if (next.length !== chunksInFlight.value.length) {
    chunksInFlight.value = next
  }
  flightTick.value = now
  rafId = requestAnimationFrame(tickRaf)
}

function chunkProgress(c: Chunk, now: number): number {
  return Math.max(0, Math.min(1, (now - c.startTime) / c.duration))
}

async function runLoop() {
  running = true
  while (running) {
    if (!visible.value) {
      await later(220)
      continue
    }

    // ── reset for new cycle ─────────────────────────────────────────
    serverStack.value = []
    producerSeq.value = 14
    consumerStatus.value = "connected"
    chunksInFlight.value = []
    showServerCheck.value = false
    showServerCross.value = false
    showConsumerCheck.value = false
    showDuplicateCallout.value = false
    producerSeqBlinking.value = false
    phase.value = 1

    // ── PHASE 1 — happy path: 3 chunks producer → server → consumer ─
    for (let i = 0; i < 3; i++) {
      if (!running) return
      producerSeq.value = 15 + i
      fireChunk("producer")
      await later(TRAVEL_MS - 50)
      if (!running) return
      pushRow(false)
      showServerCheck.value = true
      fireChunk("server")
      await later(180)
      showServerCheck.value = false
      await later(TRAVEL_MS - 230)
      if (!running) return
      showConsumerCheck.value = true
      await later(200)
      showConsumerCheck.value = false
      await later(80)
    }

    if (!running) return
    await later(280)

    // ── PHASE 2 — duplicate suppression ─────────────────────────────
    phase.value = 2
    producerSeqBlinking.value = true
    await later(360)
    producerSeqBlinking.value = false

    // retry of seq 17 — server should ✗ ignore
    fireChunk("producer", true)
    await later(TRAVEL_MS - 40)
    if (!running) return
    showServerCross.value = true
    showDuplicateCallout.value = true
    await later(900)
    showServerCross.value = false
    showDuplicateCallout.value = false
    await later(160)

    // bump to seq 18 — server ✓ stores
    producerSeq.value = 18
    fireChunk("producer")
    await later(TRAVEL_MS - 40)
    if (!running) return
    pushRow(false)
    showServerCheck.value = true
    fireChunk("server")
    await later(220)
    showServerCheck.value = false
    await later(TRAVEL_MS - 270)
    if (!running) return
    showConsumerCheck.value = true
    await later(220)
    showConsumerCheck.value = false
    await later(360)

    // ── PHASE 3 — consumer drop & resume ────────────────────────────
    if (!running) return
    phase.value = 3
    consumerStatus.value = "dropped"
    await later(500)

    // producer keeps producing 2 more while consumer is offline → pending rows
    for (let i = 0; i < 2; i++) {
      if (!running) return
      producerSeq.value += 1
      fireChunk("producer")
      await later(TRAVEL_MS - 50)
      pushRow(true)
      showServerCheck.value = true
      await later(280)
      showServerCheck.value = false
      await later(120)
    }

    if (!running) return
    consumerStatus.value = "resuming"
    await later(700)

    consumerStatus.value = "connected"
    // Server replays only the new chunks (not the whole history)
    for (let i = 0; i < 2; i++) {
      fireChunk("server")
      await later(280)
    }
    await later(TRAVEL_MS - 250)
    if (!running) return
    syncPendingRows()
    showConsumerCheck.value = true
    await later(700)
    showConsumerCheck.value = false

    await later(700)
  }
}

onMounted(() => {
  reducedMotion.value =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (reducedMotion.value) {
    // Static end-state for reduced motion
    showStaticEnd.value = true
    producerSeq.value = 20
    for (let i = 16; i <= 20; i++) {
      producerSeq.value = i
      pushRow(false)
    }
    consumerStatus.value = "connected"
    showServerCheck.value = true
    showConsumerCheck.value = true
    return
  }

  rafId = requestAnimationFrame(tickRaf)
  runLoop()
})

onUnmounted(() => {
  running = false
  clearTimers()
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})

// Helper: split chunksInFlight into per-segment dots so the template
// can position each one on the correct arrow.
const producerDots = computed(() => {
  const now = flightTick.value || performance.now()
  return chunksInFlight.value
    .filter((c) => c.from === "producer")
    .map((c) => ({ id: c.id, p: chunkProgress(c, now), duplicate: c.duplicate }))
})
const serverDots = computed(() => {
  const now = flightTick.value || performance.now()
  return chunksInFlight.value
    .filter((c) => c.from === "server")
    .map((c) => ({ id: c.id, p: chunkProgress(c, now) }))
})

</script>

<template>
  <div ref="rootRef" class="ord">
    <span class="sr-only">
      Diagram showing a producer service posting chunks to an Electric Stream
      server that de-duplicates by Producer-Id, Producer-Epoch and Producer-Seq
      headers, while a consumer client reads chunks and resumes from the last
      offset it saw after a connection drop.
    </span>

    <!-- ─── Single row: producer / server / consumer ────────────────── -->
    <div class="ord-grid" aria-hidden="true">
      <!-- Producer box (name + headers combined) -->
      <div class="ord-col ord-col--producer">
        <div class="ord-actor-label">producer</div>
        <div class="ord-box ord-box--combined">
          <div class="ord-box-name">svc</div>
          <div class="ord-box-divider" />
          <div class="ord-headers-inline">
            <div class="ord-hdr">
              <span class="ord-hdr-key">producer-id</span>
              <span class="ord-hdr-val">svc-1</span>
            </div>
            <div class="ord-hdr">
              <span class="ord-hdr-key">producer-epoch</span>
              <span class="ord-hdr-val">2</span>
            </div>
            <div class="ord-hdr">
              <span class="ord-hdr-key">producer-seq</span>
              <span
                class="ord-hdr-val ord-hdr-val--seq"
                :class="{ 'is-blink': producerSeqBlinking }"
              >{{ producerSeq }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Producer → Server arrow -->
      <div class="ord-arrow">
        <div class="ord-arrow-label">POST</div>
        <div class="ord-arrow-track">
          <svg
            class="ord-arrow-line"
            viewBox="0 0 100 8"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1="4"
              x2="98"
              y2="4"
              stroke="currentColor"
              stroke-width="1"
            />
            <polyline
              points="93,1 98,4 93,7"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span
            v-for="d in producerDots"
            :key="d.id"
            class="ord-dot"
            :class="{ 'ord-dot--dup': d.duplicate }"
            :style="{ left: `calc(${d.p * 100}% - 4px)` }"
          />
        </div>
      </div>

      <!-- Server (durable streams) box -->
      <div class="ord-col ord-col--server">
        <div class="ord-actor-label">durable streams</div>
        <div class="ord-box ord-box--server">
          <div class="ord-stack">
            <div
              v-for="row in stackRows"
              :key="row.id"
              class="ord-stack-row"
              :class="{
                'is-new': row.pulse,
                'is-pending': row.pending,
              }"
            >{{ row.hex }}</div>
          </div>

          <Transition name="ord-mark">
            <span v-if="showServerCheck" class="ord-mark ord-mark--good">✓</span>
          </Transition>
          <Transition name="ord-mark">
            <span v-if="showServerCross" class="ord-mark ord-mark--bad">✗</span>
          </Transition>
          <Transition name="ord-callout">
            <div v-if="showDuplicateCallout" class="ord-callout">
              duplicate · ignored
            </div>
          </Transition>
        </div>
      </div>

      <!-- Server → Consumer arrow -->
      <div class="ord-arrow">
        <div class="ord-arrow-label">GET&nbsp;?offset=…</div>
        <div class="ord-arrow-track">
          <svg
            class="ord-arrow-line"
            viewBox="0 0 100 8"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1="4"
              x2="98"
              y2="4"
              stroke="currentColor"
              stroke-width="1"
            />
            <polyline
              points="93,1 98,4 93,7"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span
            v-for="d in serverDots"
            :key="d.id"
            class="ord-dot"
            :style="{ left: `calc(${d.p * 100}% - 4px)` }"
          />
        </div>
      </div>

      <!-- Consumer box (name + status combined) -->
      <div class="ord-col ord-col--consumer">
        <div class="ord-actor-label">consumer</div>
        <div
          class="ord-box ord-box--combined"
          :class="{ 'is-dimmed': consumerStatus === 'dropped' }"
        >
          <div class="ord-box-name">client</div>
          <div class="ord-box-divider" />
          <div
            class="ord-status-inline"
            :class="{
              'is-connected': consumerStatus === 'connected',
              'is-dropped': consumerStatus === 'dropped',
              'is-resuming': consumerStatus === 'resuming',
            }"
          >{{ consumerStatusText }}</div>
          <Transition name="ord-mark">
            <span v-if="showConsumerCheck" class="ord-mark ord-mark--good ord-mark--inline">✓</span>
          </Transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ord {
  position: relative;
  width: 100%;
  max-width: 720px;
  padding: 22px 18px 20px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  font-family: var(--vp-font-family-base);
  color: var(--ea-text-1);
}
.dark .ord {
  background: var(--ea-surface-alt);
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

/* ── Grid: producer | arrow | server | arrow | consumer ─────────── */
.ord-grid {
  display: grid;
  grid-template-columns:
    minmax(140px, 1.3fr)
    minmax(48px, 0.8fr)
    minmax(170px, 1.4fr)
    minmax(48px, 0.8fr)
    minmax(140px, 1.3fr);
  /* Bottoms align; combined with equal box min-heights this means all
     five columns line up top-and-bottom (boxes + actor labels). */
  align-items: end;
  gap: 8px;
}

.ord-col {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
}

.ord-actor-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-2);
  text-align: center;
  margin-bottom: 4px;
  letter-spacing: 0.02em;
}

/* ── Boxes ──────────────────────────────────────────────────────── */
.ord-box {
  position: relative;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-bg);
  font-family: var(--vp-font-family-mono);
  color: var(--ea-text-1);
  transition: opacity 0.3s, border-color 0.3s;
}
.dark .ord-box {
  background: var(--ea-surface);
}

/* Combined actor box: name on top, then a divider, then either headers
   (producer) or status (consumer) — keeps everything about that actor
   in a single box. */
.ord-box--combined {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  min-height: 144px;
  font-size: 12.5px;
}
.ord-box--combined .ord-box-name {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: center;
  font-size: 12.5px;
  margin: 2px 0 0;
}
.ord-box-divider {
  height: 1px;
  background: var(--ea-divider);
  margin: 8px -12px 8px;
  opacity: 0.7;
}

.ord-box--combined.is-dimmed {
  opacity: 0.55;
  border-color: color-mix(in srgb, var(--ea-event-error) 35%, var(--ea-divider));
}

.ord-box--server {
  display: flex;
  align-items: center;
  justify-content: center;
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 55%, var(--ea-divider));
  padding: 10px 12px;
  min-height: 144px;
}

/* ── Stack (chunk rows) ─────────────────────────────────────────── */
.ord-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0;
  width: 100%;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  line-height: 16px;
  color: color-mix(in srgb, var(--vp-c-brand-1) 75%, transparent);
  letter-spacing: 0.06em;
  white-space: pre;
  /* Reserve room so the box height stays fixed across cycles. */
  min-height: calc(5 * 16px);
}
.ord-stack-row {
  opacity: 0.9;
  transition: opacity 0.4s ease, color 0.4s ease;
}
.ord-stack-row.is-pending {
  /* Amber until the consumer catches up — visually marked as "not yet
     delivered to the client". */
  color: var(--ea-event-tool-call);
  animation: ord-row-pending 1.6s ease-in-out infinite;
}
.ord-stack-row.is-new {
  animation: ord-row-pulse 0.55s ease-out;
}
.ord-stack-row.is-new.is-pending {
  animation: ord-row-pulse-pending 0.55s ease-out,
    ord-row-pending 1.6s ease-in-out 0.55s infinite;
}
@keyframes ord-row-pulse {
  0% {
    color: var(--vp-c-brand-1);
    transform: translateX(-2px);
    opacity: 0;
  }
  40% {
    color: var(--vp-c-brand-1);
    transform: translateX(0);
    opacity: 1;
  }
  100% {
    color: color-mix(in srgb, var(--vp-c-brand-1) 75%, transparent);
    opacity: 0.9;
  }
}
@keyframes ord-row-pulse-pending {
  0% {
    color: var(--ea-event-tool-call);
    transform: translateX(-2px);
    opacity: 0;
  }
  40% {
    color: var(--ea-event-tool-call);
    transform: translateX(0);
    opacity: 1;
  }
  100% {
    color: var(--ea-event-tool-call);
    opacity: 0.9;
  }
}
@keyframes ord-row-pending {
  0%, 100% { opacity: 0.95; }
  50% { opacity: 0.55; }
}

/* ── ✓ / ✗ markers ──────────────────────────────────────────────── */
.ord-mark {
  position: absolute;
  right: 8px;
  top: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}
.ord-mark--inline {
  position: absolute;
  right: 6px;
  top: 6px;
  font-size: 12px;
}
.ord-mark--good {
  color: var(--vp-c-brand-1);
}
.ord-mark--bad {
  color: var(--ea-event-error);
}

.ord-mark-enter-from,
.ord-mark-leave-to {
  opacity: 0;
  transform: scale(0.4);
}
.ord-mark-enter-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.ord-mark-leave-active {
  transition: opacity 0.25s ease-in, transform 0.25s ease-in;
}

/* ── Duplicate callout above server box ─────────────────────────── */
.ord-callout {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  padding: 3px 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--ea-event-error);
  background: var(--ea-bg);
  border: 1px solid color-mix(in srgb, var(--ea-event-error) 50%, var(--ea-divider));
  border-radius: 4px;
  pointer-events: none;
  z-index: 2;
}
.dark .ord-callout {
  background: var(--ea-surface);
}
.ord-callout-enter-from,
.ord-callout-leave-to {
  opacity: 0;
  transform: translate(-50%, 4px);
}
.ord-callout-enter-active,
.ord-callout-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

/* ── Arrows ─────────────────────────────────────────────────────── */
.ord-arrow {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  /* Push the arrow track so its line sits in the vertical centre of the
     surrounding boxes (boxes are 144px tall and bottom-aligned). */
  padding-bottom: 68px;
  min-width: 0;
}
.ord-arrow-label {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: var(--ea-text-2);
  text-align: center;
  letter-spacing: 0.02em;
}
.ord-arrow-track {
  position: relative;
  height: 8px;
  width: 100%;
  color: var(--ea-divider);
}
.ord-arrow-line {
  display: block;
  width: 100%;
  height: 8px;
  overflow: visible;
}
.ord-dot {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  margin-top: -4px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 6px color-mix(in srgb, var(--vp-c-brand-1) 60%, transparent);
  pointer-events: none;
  will-change: left;
}
.ord-dot--dup {
  background: var(--ea-event-error);
  box-shadow: 0 0 6px color-mix(in srgb, var(--ea-event-error) 55%, transparent);
}

/* ── Headers inside producer box ────────────────────────────────── */
.ord-headers-inline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  line-height: 1.3;
  color: var(--ea-text-2);
}
.ord-hdr {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}
.ord-hdr-key {
  color: var(--ea-text-2);
  font-size: 9.5px;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  opacity: 0.85;
}
.ord-hdr-val {
  color: var(--ea-text-1);
  font-size: 11px;
}
.ord-hdr-val--seq {
  font-weight: 600;
  transition: color 0.15s;
}
.ord-hdr-val--seq.is-blink {
  animation: ord-blink 0.3s ease-in-out 0s 3;
  color: var(--ea-event-error);
}
@keyframes ord-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ── Status inside consumer box ─────────────────────────────────── */
.ord-status-inline {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--ea-text-2);
  white-space: normal;
  text-wrap: balance;
  transition: color 0.25s;
}
.ord-status-inline.is-connected {
  color: var(--vp-c-brand-1);
}
.ord-status-inline.is-dropped {
  color: var(--ea-event-error);
}
.ord-status-inline.is-resuming {
  color: var(--vp-c-brand-1);
}

/* ── Reduced motion ─────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .ord-stack-row,
  .ord-hdr-val--seq,
  .ord-mark,
  .ord-callout,
  .ord-dot {
    animation: none !important;
    transition: none !important;
  }
}

/* ── Responsive ─────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .ord {
    padding: 16px 12px 14px;
  }

  /* Stack producer → server → consumer vertically. Arrows become short
     horizontal connectors with the label inline so the whole demo
     stays compact on narrow phones. */
  .ord-grid {
    grid-template-columns: 1fr;
    grid-auto-rows: auto;
    align-items: stretch;
    gap: 4px;
  }

  .ord-actor-label {
    font-size: 10px;
    text-align: left;
    margin-bottom: 4px;
    padding-left: 2px;
  }

  /* Boxes go full-width and shrink to content height. */
  .ord-box--combined,
  .ord-box--server {
    min-height: 0;
    padding: 10px 12px;
    font-size: 12px;
  }
  .ord-box--combined {
    flex-direction: row;
    align-items: stretch;
    gap: 10px;
  }
  .ord-box--combined .ord-box-name {
    font-size: 12px;
    text-align: left;
    align-self: center;
    flex-shrink: 0;
    min-width: 48px;
    margin: 0;
  }
  .ord-box-divider {
    height: auto;
    width: 1px;
    background: var(--ea-divider);
    margin: 0;
    flex-shrink: 0;
  }

  /* Producer headers row, two per line to save vertical space. */
  .ord-headers-inline {
    flex: 1;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px 14px;
    align-items: baseline;
  }
  .ord-hdr {
    flex-direction: row;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
  }
  .ord-hdr-key {
    font-size: 9.5px;
  }
  .ord-hdr-val {
    font-size: 11px;
  }

  /* Consumer status sits next to the name, right-aligned. */
  .ord-status-inline {
    flex: 1;
    text-align: right;
    font-size: 11px;
    justify-content: flex-end;
  }

  /* Server box: hex stack stays vertical inside, but no excess padding. */
  .ord-box--server {
    justify-content: flex-start;
  }
  .ord-stack {
    align-items: stretch;
    font-size: 10.5px;
    line-height: 15px;
    min-height: calc(5 * 15px);
  }
  .ord-stack-row {
    text-align: left;
  }

  /* Arrows become real vertical connectors between the stacked boxes.
     The SVG line + animated dots are rotated 90° so the dots travel
     top-to-bottom. The POST / GET label sits inline beside the arrow
     (rather than above it) so it can't overlap the arrowhead, and
     the arrow itself is long enough to span the full gap — passing
     visually over the next box's "durable streams" / "consumer"
     actor label and touching the top of the box below. */
  .ord-arrow {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0;
    /* Row only needs to host the label; the rotated track is allowed
       to extend visually past the row above and below using transforms. */
    min-height: 14px;
    /* Bumped z-index so the arrow line draws over the next actor
       label rather than under it (no background, but keeps stacking
       intent obvious to anyone reading the CSS). */
    position: relative;
    z-index: 1;
  }
  .ord-arrow-label {
    font-size: 10px;
    color: var(--ea-text-2);
    text-align: left;
  }
  /* Tall, slightly thicker connector. After rotate(90deg) the track is
     visually 44px tall × 10px wide; the trailing translate(N,0) is in
     the rotated frame, which is the visual DOWN direction — so it
     shifts the whole arrow downward into the next row. The values are
     chosen so the top tip aligns with the previous box's bottom edge
     and the arrowhead extends just past the next actor label, landing
     at the top of the next box. */
  .ord-arrow-track {
    width: 44px;
    height: 10px;
    flex: none;
    transform: rotate(90deg) translate(15px, 0);
    transform-origin: center;
  }
  /* Pin the visual stroke width so the line reads as a real arrow
     even after the viewBox is squashed by preserveAspectRatio="none"
     onto a 24×10 track (where naive 1-unit strokes would render
     sub-pixel). */
  .ord-arrow-line :deep(line),
  .ord-arrow-line :deep(polyline) {
    vector-effect: non-scaling-stroke;
    stroke-width: 1.5;
  }

  /* Inline ✓ on consumer box stays anchored to top-right. */
  .ord-mark--inline {
    top: 8px;
    right: 8px;
  }
  /* Duplicate callout above the server box can wrap. */
  .ord-callout {
    white-space: normal;
    text-align: center;
  }
}
</style>
