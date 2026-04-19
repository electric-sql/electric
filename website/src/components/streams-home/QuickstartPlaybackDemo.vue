<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
} from "vue"

// ────────────────────────────────────────────────────────────────────────────
// Script — easy to edit. Each step is a command (typed character-by-character)
// followed by its output, then an inline annotation that fades in beside the
// thing it's explaining. Playback is purely derived from `elapsedMs`, so the
// scrubber can move the demo to any point in time.
// ────────────────────────────────────────────────────────────────────────────

interface OutputSegment {
  text: string
  kind?: "ok" | "data" | "key" | "muted" | "cursor"
}

type AnnotationAnchor = "cmd" | "out"

interface Step {
  id: string
  command: string
  thinkMs: number
  output: OutputSegment[][]
  annotation: string
  annotationAnchor?: AnnotationAnchor // defaults to "cmd"
}

const script: Step[] = [
  {
    id: "s1",
    command: `curl -X PUT http://localhost:4437/v1/stream/hello \\\n     -H 'Content-Type: application/json'`,
    thinkMs: 420,
    output: [
      [
        { text: "✓ ", kind: "ok" },
        { text: "201 Created" },
      ],
    ],
    annotation:
      "Creates a JSON-mode stream. Idempotent — re-running just no-ops.",
    annotationAnchor: "cmd",
  },
  {
    id: "s2",
    command: `curl -X POST http://localhost:4437/v1/stream/hello \\\n     -H 'Content-Type: application/json' \\\n     -d '{"hello":"world"}'`,
    thinkMs: 480,
    output: [
      [
        { text: "✓ ", kind: "ok" },
        { text: "200 OK   " },
        { text: "Stream-Next-Offset:", kind: "key" },
        { text: " 01JQXK5V00" },
      ],
    ],
    annotation:
      "Appends one JSON message. Save Stream-Next-Offset to resume from here.",
    annotationAnchor: "out",
  },
  {
    id: "s3",
    command: `curl "http://localhost:4437/v1/stream/hello?offset=-1"`,
    thinkMs: 380,
    output: [
      [
        { text: "[" },
        { text: '{"hello":"world"}' },
        { text: "]" },
      ],
    ],
    annotation:
      "Reads the stream from the start. JSON-mode reads return an array of messages.",
    annotationAnchor: "cmd",
  },
  {
    id: "s4",
    command: `curl -N "http://localhost:4437/v1/stream/hello?offset=-1&live=sse"`,
    thinkMs: 360,
    output: [
      [{ text: "event: ", kind: "data" }, { text: "data" }],
      [
        { text: "data: ", kind: "data" },
        { text: '[{"hello":"world"}]' },
      ],
      [{ text: "\u00A0" }],
      [{ text: "event: ", kind: "data" }, { text: "control" }],
      [
        { text: "data: ", kind: "data" },
        {
          text: '{"streamNextOffset":"01JQXK5V00","upToDate":true}',
        },
      ],
      [{ text: "▍", kind: "cursor" }],
    ],
    annotation:
      "Tails live. data events carry payloads; control events carry the next offset and state.",
    annotationAnchor: "cmd",
  },
]

// ────────────────────────────────────────────────────────────────────────────
// Pre-computed timeline — every visible state is a function of elapsedMs.
// ────────────────────────────────────────────────────────────────────────────

const CHAR_MS = 32
const BREAK_MS = 140
const POST_OUTPUT_GAP_MS = 1700
const FINAL_HOLD_MS = 5500
const TICK_MS = 80

interface StepTiming {
  start: number
  cmdEnd: number
  outShown: number
  end: number
  // Cumulative ms for each char of the command (charTimings[c] = ms within
  // this step at which character c is fully typed). Used by typedCharsAt().
  charTimings: number[]
}

const timings: StepTiming[] = (() => {
  const out: StepTiming[] = []
  let t = 0
  for (let i = 0; i < script.length; i++) {
    const start = t
    const cmd = script[i].command
    const charTimings: number[] = []
    let typed = 0
    for (let c = 0; c < cmd.length; c++) {
      typed += cmd[c] === "\n" ? BREAK_MS : CHAR_MS
      charTimings.push(typed)
    }
    const cmdEnd = start + typed
    const outShown = cmdEnd + script[i].thinkMs
    const isLast = i === script.length - 1
    const end = outShown + (isLast ? FINAL_HOLD_MS : POST_OUTPUT_GAP_MS)
    out.push({ start, cmdEnd, outShown, end, charTimings })
    t = end
  }
  return out
})()

const TOTAL_MS = timings[timings.length - 1].end

// ────────────────────────────────────────────────────────────────────────────
// Reactive state
// ────────────────────────────────────────────────────────────────────────────

const elapsedMs = ref(0)
const paused = ref(false)
const reduced = ref(false)
const isScrubbing = ref(false)

const rootRef = ref<HTMLElement>()
const bodyRef = ref<HTMLElement>()
const trackRef = ref<HTMLElement>()

let masterTick: ReturnType<typeof setInterval> | null = null

function startClock() {
  if (masterTick) return
  let last = performance.now()
  masterTick = setInterval(() => {
    const now = performance.now()
    const dt = now - last
    last = now
    if (paused.value || isScrubbing.value) return
    if (elapsedMs.value >= TOTAL_MS) {
      // Loop the demo back around.
      elapsedMs.value = 0
      return
    }
    elapsedMs.value = Math.min(TOTAL_MS, elapsedMs.value + dt)
  }, TICK_MS)
}

function stopClock() {
  if (masterTick) {
    clearInterval(masterTick)
    masterTick = null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pure derivations from elapsedMs — used by template
// ────────────────────────────────────────────────────────────────────────────

function isStepVisible(i: number): boolean {
  return elapsedMs.value >= timings[i].start
}

function typedCharsAt(i: number): number {
  const e = elapsedMs.value
  const tm = timings[i]
  if (e < tm.start) return 0
  if (e >= tm.cmdEnd) return script[i].command.length
  const within = e - tm.start
  const ct = tm.charTimings
  // Binary search for largest c where ct[c] <= within.
  let lo = 0
  let hi = ct.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ct[mid] <= within) lo = mid + 1
    else hi = mid
  }
  return lo
}

function isOutputShown(i: number): boolean {
  return elapsedMs.value >= timings[i].outShown
}

function isAnnotationVisible(step: Step, i: number): boolean {
  const anchor = step.annotationAnchor ?? "cmd"
  if (anchor === "cmd") return elapsedMs.value >= timings[i].cmdEnd
  return isOutputShown(i)
}

const activeStep = computed(() => {
  for (let i = script.length - 1; i >= 0; i--) {
    if (elapsedMs.value >= timings[i].start) return i
  }
  return -1
})

interface RenderedLine {
  text: string
  showCursor: boolean
  isContinuation: boolean
}

function renderTypedLines(stepIdx: number): RenderedLine[] {
  const cmd = script[stepIdx].command
  const typed = cmd.slice(0, typedCharsAt(stepIdx))
  const lines = typed.split("\n")
  const isActive = stepIdx === activeStep.value && !isOutputShown(stepIdx)
  return lines.map((text, i) => ({
    text,
    showCursor: isActive && i === lines.length - 1,
    isContinuation: i > 0,
  }))
}

// ────────────────────────────────────────────────────────────────────────────
// Auto-scroll: keep the bottom of the terminal in view as content grows.
// We track the previous scrollHeight and only auto-stick if the user is
// already near the bottom (so they can scroll up to read older output if
// they want).
// ────────────────────────────────────────────────────────────────────────────

let lastScrollHeight = 0

watch(
  () => [
    activeStep.value,
    isOutputShown(activeStep.value),
    typedCharsAt(activeStep.value),
  ],
  () => {
    nextTick(() => {
      const el = bodyRef.value
      if (!el) return
      const stickyThreshold = 24
      const wasAtBottom =
        el.scrollHeight - (el.scrollTop + el.clientHeight) <= stickyThreshold ||
        el.scrollHeight === lastScrollHeight
      if (wasAtBottom) {
        el.scrollTop = el.scrollHeight
      }
      lastScrollHeight = el.scrollHeight
    })
  }
)

// When the user scrubs backwards we always pin to the latest content (since
// later blocks just disappear). Forward scrubbing also benefits from this.
watch(elapsedMs, () => {
  nextTick(() => {
    const el = bodyRef.value
    if (!el) return
    if (isScrubbing.value) {
      el.scrollTop = el.scrollHeight
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Controls
// ────────────────────────────────────────────────────────────────────────────

function togglePause() {
  paused.value = !paused.value
}

function restart() {
  paused.value = false
  elapsedMs.value = 0
}

function onTerminalClick(ev: MouseEvent) {
  const target = ev.target as HTMLElement
  if (target.closest("a")) return
  togglePause()
}

const elapsedLabel = computed(() => formatMs(elapsedMs.value))
const totalLabel = computed(() => formatMs(TOTAL_MS))
const scrubFill = computed(
  () => `${(elapsedMs.value / TOTAL_MS) * 100}%`
)

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

// ── Scrubber drag ──────────────────────────────────────────────────────

function setScrubFromClient(clientX: number) {
  const t = trackRef.value
  if (!t) return
  const r = t.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  elapsedMs.value = Math.round(ratio * TOTAL_MS)
}

function onScrubDown(ev: PointerEvent) {
  isScrubbing.value = true
  ;(ev.currentTarget as Element).setPointerCapture?.(ev.pointerId)
  setScrubFromClient(ev.clientX)
  ev.preventDefault()
}

function onScrubMove(ev: PointerEvent) {
  if (!isScrubbing.value) return
  setScrubFromClient(ev.clientX)
}

function onScrubUp(ev: PointerEvent) {
  if (!isScrubbing.value) return
  isScrubbing.value = false
  ;(ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId)
}

function onScrubKey(ev: KeyboardEvent) {
  const STEP = TOTAL_MS / 60
  if (ev.key === "ArrowLeft") {
    elapsedMs.value = Math.max(0, elapsedMs.value - STEP)
    ev.preventDefault()
  } else if (ev.key === "ArrowRight") {
    elapsedMs.value = Math.min(TOTAL_MS, elapsedMs.value + STEP)
    ev.preventDefault()
  } else if (ev.key === "Home") {
    elapsedMs.value = 0
    ev.preventDefault()
  } else if (ev.key === "End") {
    elapsedMs.value = TOTAL_MS
    ev.preventDefault()
  } else if (ev.key === " " || ev.key === "Enter") {
    togglePause()
    ev.preventDefault()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────────

onMounted(() => {
  reduced.value =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (reduced.value) {
    elapsedMs.value = TOTAL_MS
  } else {
    startClock()
  }
})

onUnmounted(() => {
  stopClock()
})
</script>

<template>
  <div ref="rootRef" class="qs-root">
    <span class="sr-only">
      Animated terminal walkthrough: creates a Durable Stream, appends a
      message, reads it back from offset -1, then tails it live with
      server-sent events.
    </span>

    <div class="qs-stage">
      <div class="qs-frame" aria-hidden="true">
        <div class="qs-chrome">
          <span class="qs-dot qs-dot--r"></span>
          <span class="qs-dot qs-dot--y"></span>
          <span class="qs-dot qs-dot--g"></span>
          <span class="qs-title">
            Terminal — durable-streams quickstart
          </span>
        </div>

        <div ref="bodyRef" class="qs-body" @click="onTerminalClick">
          <template v-for="(step, sIdx) in script" :key="step.id">
            <div v-if="isStepVisible(sIdx)" class="qs-block">
              <div
                v-for="(ln, li) in renderTypedLines(sIdx)"
                :key="li"
                class="qs-line"
                :class="{ 'qs-line--cont': ln.isContinuation }"
              >
                <span v-if="!ln.isContinuation" class="qs-prompt">$</span>
                <span class="qs-cmd">{{ ln.text }}</span>
                <span v-if="ln.showCursor" class="qs-blink">▍</span>
              </div>

              <!-- Annotation anchored to the command line -->
              <div
                v-if="
                  (step.annotationAnchor ?? 'cmd') === 'cmd' &&
                  isAnnotationVisible(step, sIdx)
                "
                class="qs-annot"
              >
                <span class="qs-annot-arrow">└─</span>
                <span class="qs-annot-text">{{ step.annotation }}</span>
              </div>

              <template v-if="isOutputShown(sIdx)">
                <div
                  v-for="(line, lIdx) in step.output"
                  :key="lIdx"
                  class="qs-out"
                >
                  <span
                    v-for="(seg, segI) in line"
                    :key="segI"
                    :class="{
                      'qs-out-ok': seg.kind === 'ok',
                      'qs-out-data': seg.kind === 'data',
                      'qs-out-key': seg.kind === 'key',
                      'qs-out-muted': seg.kind === 'muted',
                      'qs-out-cursor': seg.kind === 'cursor',
                    }"
                  >{{ seg.text }}</span>
                </div>

                <!-- Annotation anchored to the output -->
                <div
                  v-if="
                    step.annotationAnchor === 'out' &&
                    isAnnotationVisible(step, sIdx)
                  "
                  class="qs-annot qs-annot--out"
                >
                  <span class="qs-annot-arrow">└─</span>
                  <span class="qs-annot-text">{{ step.annotation }}</span>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>

      <!-- ─── Asciinema-style controls ────────────────────────────── -->
      <div class="qs-controls">
        <button
          type="button"
          class="qs-ctrl-btn"
          aria-label="Restart playback"
          @click="restart"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3.5 8a4.5 4.5 0 1 0 1.32-3.18M3.5 4v3h3"
            />
          </svg>
        </button>

        <button
          type="button"
          class="qs-ctrl-btn"
          :aria-label="paused ? 'Play' : 'Pause'"
          @click="togglePause"
        >
          <svg
            v-if="paused"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path fill="currentColor" d="M4.5 3v10l8-5z" />
          </svg>
          <svg
            v-else
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <rect x="4" y="3" width="2.6" height="10" fill="currentColor" />
            <rect x="9.4" y="3" width="2.6" height="10" fill="currentColor" />
          </svg>
        </button>

        <div
          ref="trackRef"
          class="qs-scrub"
          role="slider"
          aria-label="Playback position"
          :aria-valuemin="0"
          :aria-valuemax="TOTAL_MS"
          :aria-valuenow="Math.round(elapsedMs)"
          :aria-valuetext="elapsedLabel"
          tabindex="0"
          @pointerdown="onScrubDown"
          @pointermove="onScrubMove"
          @pointerup="onScrubUp"
          @pointercancel="onScrubUp"
          @keydown="onScrubKey"
        >
          <div class="qs-scrub-track">
            <div
              class="qs-scrub-fill"
              :style="{ width: scrubFill }"
            ></div>
            <div
              class="qs-scrub-thumb"
              :class="{ scrubbing: isScrubbing }"
              :style="{ left: scrubFill }"
            ></div>
          </div>
        </div>

        <div class="qs-time">{{ elapsedLabel }} / {{ totalLabel }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qs-root {
  width: 100%;
  display: flex;
  justify-content: center;
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

.qs-stage {
  width: 100%;
  max-width: 860px;
  display: flex;
  flex-direction: column;
}

/* ── Terminal frame ─────────────────────────────────────────────────── */

.qs-frame {
  position: relative;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  overflow: hidden;
}

.qs-chrome {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  border-radius: 8px 8px 0 0;
  position: relative;
}

.qs-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--ea-divider);
  border: 1px solid color-mix(in srgb, var(--ea-text-2) 20%, transparent);
}

.qs-dot--r {
  background: color-mix(in srgb, #ff5f56 80%, transparent);
}
.qs-dot--y {
  background: color-mix(in srgb, #ffbd2e 80%, transparent);
}
.qs-dot--g {
  background: color-mix(in srgb, #27c93f 80%, transparent);
}

.qs-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-2);
}

.qs-body {
  /* Fixed viewport so the section doesn't grow as content arrives. */
  height: 360px;
  padding: 18px 22px 20px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
  color: var(--ea-text-1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
  white-space: pre;
  overflow-y: auto;
  overflow-x: auto;
  scroll-behavior: smooth;
  /* Bottom edge fade so content scrolling out of view feels intentional. */
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 14px,
    #000 calc(100% - 14px),
    transparent 100%
  );
          mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 14px,
    #000 calc(100% - 14px),
    transparent 100%
  );
}

.qs-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.qs-body::-webkit-scrollbar-thumb {
  background: var(--ea-divider);
  border-radius: 3px;
}

.qs-block {
  display: flex;
  flex-direction: column;
}

.qs-line {
  color: var(--ea-text-1);
  display: flex;
  align-items: baseline;
  gap: 0;
  white-space: pre;
}

.qs-line--cont {
  color: var(--ea-text-1);
  padding-left: 0; /* indent comes from typed spaces (literal whitespace) */
}

.qs-prompt {
  color: var(--vp-c-brand-1);
  margin-right: 8px;
  font-weight: 600;
  flex-shrink: 0;
}

.qs-cmd {
  color: var(--ea-text-1);
}

.qs-blink {
  display: inline-block;
  margin-left: 1px;
  color: var(--vp-c-brand-1);
  width: 0.55em;
  animation: qs-blink-anim 1s steps(2, start) infinite;
}

@keyframes qs-blink-anim {
  to {
    visibility: hidden;
  }
}

.qs-out {
  color: var(--ea-text-2);
  padding-left: 18px;
  white-space: pre;
}

.qs-out-ok {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.qs-out-data {
  color: color-mix(in srgb, var(--ea-text-2) 75%, transparent);
}

.qs-out-key {
  color: var(--ea-text-1);
  font-weight: 500;
}

.qs-out-muted {
  color: var(--ea-text-2);
  opacity: 0.7;
}

.qs-out-cursor {
  display: inline-block;
  color: var(--vp-c-brand-1);
  animation: qs-blink-anim 1s steps(2, start) infinite;
}

/* ── Inline annotations ──────────────────────────────────────────────── */

.qs-annot {
  display: flex;
  align-items: stretch;
  gap: 10px;
  margin: 6px 0 10px;
  padding-left: 18px;
  font-family: var(--vp-font-family-base);
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ea-text-1);
  animation: qs-annot-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  white-space: normal;
}

.qs-annot--out {
  padding-left: 36px;
}

.qs-annot-arrow {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: color-mix(in srgb, var(--vp-c-brand-1) 80%, var(--ea-text-2));
  flex-shrink: 0;
  align-self: center;
  line-height: 1;
}

.qs-annot-text {
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  border-left: 2px solid var(--vp-c-brand-1);
  border-radius: 0 4px 4px 0;
  padding: 6px 12px;
  font-weight: 500;
  letter-spacing: 0.005em;
  color: var(--ea-text-1);
  box-shadow: 0 1px 0 0
    color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
}

.dark .qs-annot-text {
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
  color: #f0f6fc;
}

@keyframes qs-annot-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── Reduced motion: kill the blink + animation in ────────────────── */

@media (prefers-reduced-motion: reduce) {
  .qs-blink,
  .qs-out-cursor {
    animation: none;
    visibility: visible;
  }
  .qs-annot {
    animation: none;
  }
  .qs-body {
    scroll-behavior: auto;
  }
}

/* ── Playback controls ─────────────────────────────────────────────── */

.qs-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 0 4px;
}

.qs-ctrl-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ea-divider);
  border-radius: 4px;
  color: var(--ea-text-2);
  cursor: pointer;
  padding: 0;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.qs-ctrl-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.qs-ctrl-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.qs-scrub {
  flex: 1;
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 6px;
  min-width: 0;
  cursor: pointer;
  touch-action: none;
}

.qs-scrub:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
  border-radius: 4px;
}

.qs-scrub-track {
  position: relative;
  width: 100%;
  height: 4px;
  background: var(--ea-divider);
  border-radius: 2px;
  overflow: visible;
}

.qs-scrub-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--vp-c-brand-1);
  border-radius: 2px;
  transition: width 0.08s linear;
}

.qs-scrub:active .qs-scrub-fill,
.qs-scrub.scrubbing .qs-scrub-fill {
  transition: none;
}

.qs-scrub-thumb {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  transform: translate(-50%, -50%);
  transition: left 0.08s linear, transform 0.12s ease-out, box-shadow 0.12s ease-out;
  box-shadow: 0 0 0 2px var(--ea-surface);
}

.qs-scrub:hover .qs-scrub-thumb {
  transform: translate(-50%, -50%) scale(1.2);
  box-shadow: 0 0 0 2px var(--ea-surface),
    0 0 0 6px color-mix(in srgb, var(--vp-c-brand-1) 22%, transparent);
}

.qs-scrub-thumb.scrubbing {
  transform: translate(-50%, -50%) scale(1.35);
  transition: transform 0.05s ease-out, box-shadow 0.05s ease-out;
  box-shadow: 0 0 0 2px var(--ea-surface),
    0 0 0 7px color-mix(in srgb, var(--vp-c-brand-1) 32%, transparent);
}

.qs-time {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-2);
  letter-spacing: 0.02em;
  white-space: nowrap;
  min-width: 70px;
  text-align: right;
}

/* ── Dark-band specifics ───────────────────────────────────────────── */

.dark .qs-frame {
  background: var(--ea-surface);
}

.dark .qs-chrome {
  background: var(--ea-surface-alt);
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .qs-body {
    height: 300px;
    font-size: 11.5px;
    padding: 14px 16px 16px;
  }
  .qs-title {
    font-size: 11px;
  }
  .qs-out {
    padding-left: 14px;
  }
  .qs-annot {
    padding-left: 14px;
    font-size: 12.5px;
    gap: 8px;
  }
  .qs-annot--out {
    padding-left: 30px;
  }
  .qs-annot-text {
    padding: 5px 10px;
  }
}

@media (max-width: 480px) {
  .qs-body {
    height: 280px;
    font-size: 10.5px;
    padding: 12px 12px 14px;
  }
  .qs-time {
    font-size: 11px;
    min-width: 64px;
  }
  .qs-prompt {
    margin-right: 6px;
  }
  .qs-annot {
    font-size: 12px;
  }
}
</style>
