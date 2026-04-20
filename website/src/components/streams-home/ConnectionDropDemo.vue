<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

// ────────────────────────────────────────────────────────────────────────────
// Script: a single timeline drives both cards in lock-step so they read as a
// side-by-side comparison. Each event toggles a single id in `visible` (and
// optionally flashes it as "new" for ~300ms).
// ────────────────────────────────────────────────────────────────────────────

type EventKind = "show" | "drop" | "retry" | "settle" | "reset"

interface TimelineEvent {
  t: number
  kind: EventKind
  id?: string
}

// Loop ≈ 6.0s of action + 1.0s hold = 7.0s cycle.
const TIMELINE: TimelineEvent[] = [
  { t: 0, kind: "reset" },

  // ── Initial stream (both cards in parallel) ──────────────────────────
  { t: 400, kind: "show", id: "bad-tok-1" },
  { t: 400, kind: "show", id: "good-tok-1" },
  { t: 900, kind: "show", id: "bad-tok-2" },
  { t: 900, kind: "show", id: "good-tok-2" },

  // ── Drop ────────────────────────────────────────────────────────────
  { t: 1400, kind: "drop", id: "bad-drop" },
  { t: 1400, kind: "drop", id: "good-drop" },

  // ── 1.5s gap, then divergence ───────────────────────────────────────
  { t: 2900, kind: "show", id: "bad-retry" },
  { t: 2900, kind: "show", id: "good-resume" },

  { t: 3100, kind: "show", id: "bad-post-2" },
  { t: 3100, kind: "show", id: "good-get" },

  // Top card re-streams from scratch (wasted work).
  { t: 3500, kind: "show", id: "bad-tok-r1" },
  { t: 4000, kind: "show", id: "bad-tok-r2" },

  // Bottom card resumes — only the missing tokens.
  { t: 3500, kind: "show", id: "good-tok-r" },

  // The "exactly-once" payoff line lands last, in brand teal.
  { t: 4700, kind: "show", id: "good-check" },

  // Hold the final state for ~1.3s before reset.
  { t: 6000, kind: "settle" },
]

const CYCLE_MS = 7000
const NEW_MS = 320 // how long a token glows brand-teal before settling

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

const visible = ref(new Set<string>())
const isNew = ref(new Set<string>())
const reduced = ref(false)

const rootRef = ref<HTMLElement>()
const isVisibleOnScreen = useDemoVisibility(rootRef)

let timers: ReturnType<typeof setTimeout>[] = []
let cycleTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let cycleId = 0

function clearAllTimers() {
  timers.forEach(clearTimeout)
  timers = []
  if (cycleTimer) {
    clearTimeout(cycleTimer)
    cycleTimer = null
  }
}

function reveal(id: string) {
  const next = new Set(visible.value)
  next.add(id)
  visible.value = next
  flashNew(id)
}

function dropMark(id: string) {
  // Same as reveal but no "new" flash — error markers should not glow teal.
  const next = new Set(visible.value)
  next.add(id)
  visible.value = next
}

function flashNew(id: string) {
  const nextNew = new Set(isNew.value)
  nextNew.add(id)
  isNew.value = nextNew
  timers.push(
    setTimeout(() => {
      const after = new Set(isNew.value)
      after.delete(id)
      isNew.value = after
    }, NEW_MS)
  )
}

function resetVisible() {
  visible.value = new Set()
  isNew.value = new Set()
}

function showAllFinalState() {
  visible.value = new Set([
    "bad-tok-1",
    "bad-tok-2",
    "bad-drop",
    "bad-retry",
    "bad-post-2",
    "bad-tok-r1",
    "bad-tok-r2",
    "good-tok-1",
    "good-tok-2",
    "good-drop",
    "good-resume",
    "good-get",
    "good-tok-r",
    "good-check",
  ])
  isNew.value = new Set()
}

function runOnce() {
  cycleId++
  const myId = cycleId
  resetVisible()

  for (const ev of TIMELINE) {
    timers.push(
      setTimeout(() => {
        if (myId !== cycleId || !running) return
        if (ev.kind === "reset") resetVisible()
        else if (ev.kind === "show" && ev.id) reveal(ev.id)
        else if (ev.kind === "drop" && ev.id) dropMark(ev.id)
        // "settle" is a no-op marker — used only to anchor the hold period.
      }, ev.t)
    )
  }

  cycleTimer = setTimeout(() => {
    if (myId !== cycleId || !running) return
    runOnce()
  }, CYCLE_MS)
}

// Watch visibility — start/stop when the demo enters/leaves the viewport.
function syncRunState() {
  if (reduced.value) return
  if (isVisibleOnScreen.value && !running) {
    running = true
    runOnce()
  } else if (!isVisibleOnScreen.value && running) {
    running = false
    clearAllTimers()
  }
}

let visibilityWatcher: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  reduced.value =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (reduced.value) {
    showAllFinalState()
    return
  }

  // Lightweight poll for visibility state changes (cheap; 200ms cadence).
  visibilityWatcher = setInterval(syncRunState, 200)
  syncRunState()
})

onUnmounted(() => {
  running = false
  clearAllTimers()
  if (visibilityWatcher) clearInterval(visibilityWatcher)
})

const isShown = computed(() => (id: string) => visible.value.has(id))
const isFresh = computed(() => (id: string) => isNew.value.has(id))
</script>

<template>
  <div ref="rootRef" class="cd-root">
    <span class="sr-only">
      Comparison of two streaming token responses. Without Electric Streams, a
      dropped connection forces a full retry that re-bills the LLM. With
      Electric Streams, the client resumes from the last offset and only the
      missing tokens stream in.
    </span>

    <div class="cd-stack" aria-hidden="true">
      <!-- ─── Card 1 — Without Electric Streams ─────────────────────── -->
      <div class="cd-card cd-card--bad">
        <div class="cd-strip">
          <span class="cd-strip-label cd-strip-label--bad">
            Without Electric Streams
          </span>
        </div>
        <div class="cd-body">
          <div class="cd-req">
            <span class="cd-verb">POST</span> /v1/chat/completions
          </div>
          <div class="cd-rule"></div>

          <div class="cd-tokens">
            <div
              class="cd-tok"
              :class="{ on: isShown('bad-tok-1'), fresh: isFresh('bad-tok-1') }"
            >
              <span class="cd-arrow">▶</span> The capital of
            </div>
            <div
              class="cd-tok"
              :class="{ on: isShown('bad-tok-2'), fresh: isFresh('bad-tok-2') }"
            >
              <span class="cd-arrow">▶</span> France is Pa<span
                class="cd-err"
                :class="{ on: isShown('bad-drop') }"
              >
                ✕ connection lost</span
              >
            </div>
          </div>

          <div class="cd-after">
            <div class="cd-action" :class="{ on: isShown('bad-retry') }">
              <span class="cd-arrow cd-arrow--muted">⤴</span> retry
            </div>
            <div
              class="cd-req cd-req--retry"
              :class="{ on: isShown('bad-post-2') }"
            >
              <span class="cd-verb">POST</span> /v1/chat/completions
              <span class="cd-rebills">re-bills</span>
            </div>
            <div class="cd-tokens">
              <div
                class="cd-tok"
                :class="{
                  on: isShown('bad-tok-r1'),
                  fresh: isFresh('bad-tok-r1'),
                }"
              >
                <span class="cd-arrow">▶</span> The capital of
              </div>
              <div
                class="cd-tok"
                :class="{
                  on: isShown('bad-tok-r2'),
                  fresh: isFresh('bad-tok-r2'),
                }"
              >
                <span class="cd-arrow">▶</span> France is Paris.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── Card 2 — With Electric Streams ────────────────────────── -->
      <div class="cd-card cd-card--good">
        <div class="cd-strip">
          <span class="cd-strip-label cd-strip-label--good">
            With Electric Streams
          </span>
        </div>
        <div class="cd-body">
          <div class="cd-req">
            <span class="cd-verb">POST</span> /v1/stream/chat-42
          </div>
          <div class="cd-rule"></div>

          <div class="cd-tokens">
            <div
              class="cd-tok"
              :class="{
                on: isShown('good-tok-1'),
                fresh: isFresh('good-tok-1'),
              }"
            >
              <span class="cd-arrow">▶</span> The capital of
            </div>
            <div
              class="cd-tok"
              :class="{
                on: isShown('good-tok-2'),
                fresh: isFresh('good-tok-2'),
              }"
            >
              <span class="cd-arrow">▶</span> France is Pa<span
                class="cd-err"
                :class="{ on: isShown('good-drop') }"
              >
                ✕ connection lost</span
              >
            </div>
          </div>

          <div class="cd-after">
            <div class="cd-action" :class="{ on: isShown('good-resume') }">
              <span class="cd-arrow cd-arrow--good">⤴</span> resume
            </div>
            <div
              class="cd-req cd-req--retry"
              :class="{ on: isShown('good-get') }"
            >
              <span class="cd-verb">GET</span>&nbsp; /v1/stream/chat-42<span
                class="cd-q"
                >?offset=7</span
              >
            </div>
            <div class="cd-tokens">
              <div
                class="cd-tok"
                :class="{
                  on: isShown('good-tok-r'),
                  fresh: isFresh('good-tok-r'),
                }"
              >
                <span class="cd-arrow cd-arrow--good">▶</span> ris.
              </div>
            </div>

            <div class="cd-check" :class="{ on: isShown('good-check') }">
              <span class="cd-check-mark">✓</span>
              exactly-once, no extra LLM call
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cd-root {
  width: 100%;
  font-family: var(--vp-font-family-mono);
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

.cd-stack {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: stretch;
}

@media (max-width: 760px) {
  .cd-stack {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

.cd-card {
  display: flex;
  flex-direction: column;
}
.cd-card .cd-body {
  flex: 1;
}

/* ── Card chrome ────────────────────────────────────────────────────── */

.cd-card {
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  overflow: hidden;
}

.cd-card--good {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--ea-divider));
}

.cd-strip {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
}

.cd-strip-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ea-text-2);
}

.cd-strip-label--bad {
  color: var(--ea-event-error);
}

.cd-strip-label--good {
  color: var(--vp-c-brand-1);
}

.cd-body {
  padding: 14px 16px 16px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--ea-text-1);
}

/* ── Request / divider ──────────────────────────────────────────────── */

.cd-req {
  font-size: 12.5px;
  color: var(--ea-text-1);
  white-space: pre;
  opacity: 1;
}

.cd-req--retry {
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
}

.cd-req--retry.on {
  opacity: 1;
  transform: none;
}

.cd-verb {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.cd-q {
  color: var(--ea-text-2);
}

.cd-rebills {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ea-event-error);
  background: color-mix(in srgb, var(--ea-event-error) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--ea-event-error) 38%, transparent);
  vertical-align: 1px;
}

.cd-rule {
  height: 1px;
  background: var(--ea-divider);
  margin: 6px 0 8px;
}

/* ── Tokens ─────────────────────────────────────────────────────────── */

.cd-tokens {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 4px;
}

.cd-tok {
  color: var(--ea-text-1);
  opacity: 0;
  transform: translateY(-2px);
  transition: color 0.32s ease-out, opacity 0.18s ease-out,
    transform 0.18s ease-out;
  white-space: pre;
}

.cd-tok.on {
  opacity: 1;
  transform: none;
}

.cd-tok.fresh {
  color: var(--vp-c-brand-1);
}

.cd-arrow {
  color: var(--ea-text-2);
  margin-right: 2px;
}

.cd-arrow--good {
  color: var(--vp-c-brand-1);
}

.cd-arrow--muted {
  color: var(--ea-text-2);
}

.cd-err {
  color: var(--ea-event-error);
  font-weight: 600;
  margin-left: 4px;
  opacity: 0;
  transition: opacity 0.18s ease-out;
}

.cd-err.on {
  opacity: 1;
}

/* ── After-the-drop section ────────────────────────────────────────── */

.cd-after {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cd-action {
  font-size: 11.5px;
  color: var(--ea-text-2);
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
  letter-spacing: 0.02em;
}

.cd-action.on {
  opacity: 1;
  transform: none;
}

/* ── Success line ───────────────────────────────────────────────────── */

.cd-check {
  margin-top: 10px;
  font-size: 12px;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.4s ease-out, transform 0.4s ease-out;
}

.cd-check.on {
  opacity: 1;
  transform: none;
}

.cd-check-mark {
  display: inline-block;
  margin-right: 4px;
}

/* ── Reduced motion: drop transitions, show everything statically ──── */

@media (prefers-reduced-motion: reduce) {
  .cd-tok,
  .cd-err,
  .cd-action,
  .cd-req--retry,
  .cd-check {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
  .cd-tok.fresh {
    color: var(--ea-text-1);
  }
}

/* ── Dark-mode adjustments — inherit tokens, slight body lift ──────── */

.dark .cd-card {
  background: var(--ea-surface-alt);
}

.dark .cd-strip {
  background: var(--ea-surface);
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 480px) {
  .cd-body {
    padding: 12px 12px 14px;
    font-size: 11.5px;
  }
  .cd-req {
    font-size: 11.5px;
  }
  .cd-strip-label {
    font-size: 10px;
  }
}
</style>
