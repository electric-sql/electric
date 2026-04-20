<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

type Author = "Alice" | "agent" | "Bob"
type ClientState = "live" | "offline"

interface ScriptEvent {
  who: Author
  body: string
}

interface Row extends ScriptEvent {
  id: number
}

const SCRIPT: ScriptEvent[] = [
  { who: "Alice", body: "PR #214 needs review" },
  { who: "agent", body: "Found 3 issues" },
  { who: "Bob",   body: "👍 on it" },
  { who: "agent", body: "drafting fix…" },
]

const CLIENTS: Author[] = ["Alice", "agent", "Bob"]

/* ── Timing ─────────────────────────────────────────────────────── */
const APPEND_EVERY_MS    = 1300
const PROPAGATE_DELAY_MS = 200
const BOB_OFFLINE_AT_IDX = 2   // Bob goes offline right after his own message lands
const BOB_BACK_AT_IDX    = 3   // Bob reconnects after the next event lands
const HOLD_AFTER_LAST_MS = 2200
const RESET_FADE_MS      = 500
const REPLAY_GAP_MS      = 220

const rootRef = ref<HTMLElement>()
const isActive = useDemoVisibility(rootRef)
const prefersReducedMotion = ref(false)

const stream = ref<Row[]>([])
const clients = ref<Record<Author, Row[]>>({ Alice: [], agent: [], Bob: [] })
const states = ref<Record<Author, ClientState>>({
  Alice: "live", agent: "live", Bob: "live",
})

let timers: number[] = []
let cycleId = 0
let nextId = 0

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t))
  timers = []
}
function schedule(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms))
}

function reset() {
  stream.value = []
  clients.value = { Alice: [], agent: [], Bob: [] }
  states.value = { Alice: "live", agent: "live", Bob: "live" }
}

function appendToStream(ev: ScriptEvent, thisCycle: number) {
  if (cycleId !== thisCycle) return
  const row: Row = { ...ev, id: ++nextId }
  stream.value = [...stream.value, row]

  CLIENTS.forEach((name, i) => {
    schedule(PROPAGATE_DELAY_MS + i * 80, () => {
      if (cycleId !== thisCycle) return
      if (states.value[name] !== "live") return
      clients.value[name] = [...clients.value[name], row]
    })
  })
}

function bobReconnect(thisCycle: number) {
  if (cycleId !== thisCycle) return
  states.value.Bob = "live"
  const missed = stream.value.filter(
    (r) => !clients.value.Bob.find((m) => m.id === r.id)
  )
  missed.forEach((row, i) => {
    schedule(i * REPLAY_GAP_MS, () => {
      if (cycleId !== thisCycle) return
      clients.value.Bob = [...clients.value.Bob, row]
    })
  })
}

function runCycle() {
  cycleId++
  const thisCycle = cycleId
  reset()

  let t = 350
  SCRIPT.forEach((ev, i) => {
    schedule(t, () => appendToStream(ev, thisCycle))

    if (i === BOB_OFFLINE_AT_IDX) {
      schedule(t + PROPAGATE_DELAY_MS + 2 * 80 + 240, () => {
        if (cycleId !== thisCycle) return
        states.value.Bob = "offline"
      })
    }
    if (i === BOB_BACK_AT_IDX) {
      schedule(t + PROPAGATE_DELAY_MS + 2 * 80 + 380, () => bobReconnect(thisCycle))
    }
    t += APPEND_EVERY_MS
  })

  const finalAt = t + HOLD_AFTER_LAST_MS
  schedule(finalAt, () => {
    if (cycleId !== thisCycle) return
    reset()
  })
  schedule(finalAt + RESET_FADE_MS, () => {
    if (cycleId !== thisCycle) return
    runCycle()
  })
}

function renderStaticEndState() {
  reset()
  SCRIPT.forEach((ev) => {
    const row: Row = { ...ev, id: ++nextId }
    stream.value.push(row)
    CLIENTS.forEach((c) => clients.value[c].push(row))
  })
}

function stop() {
  cycleId++
  clearTimers()
  reset()
}

watch(isActive, (v) => {
  if (prefersReducedMotion.value) return
  if (v) runCycle()
  else stop()
})

onMounted(() => {
  if (typeof window !== "undefined") {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
    prefersReducedMotion.value = mql.matches
  }
  if (prefersReducedMotion.value) renderStaticEndState()
  else if (isActive.value) runCycle()
})

onBeforeUnmount(stop)

const srDescription = computed(
  () =>
    "Three clients reading the same session URL. Bob's connection drops, " +
    "the others keep going, then Bob reconnects and catches up."
)
</script>

<template>
  <div ref="rootRef" class="csd" aria-hidden="true">
    <span class="sr-only">{{ srDescription }}</span>

    <div class="csd-url">
      <span class="csd-url-key">URL</span>
      <span class="csd-url-path">/v1/stream/session/design-review</span>
    </div>

    <div class="csd-grid">
      <article
        v-for="name in CLIENTS"
        :key="name"
        class="csd-pane"
        :class="`csd-pane--${states[name]}`"
      >
        <header class="csd-head">
          <span class="csd-dot" />
          <span class="csd-name">{{ name }}</span>
          <span class="csd-flag">
            {{ states[name] === "offline" ? "offline" : "live" }}
          </span>
        </header>
        <TransitionGroup name="csd-row" tag="div" class="csd-rows">
          <div
            v-for="row in clients[name]"
            :key="row.id"
            class="csd-row"
          >
            <span class="csd-who">{{ row.who }}</span>
            <span class="csd-body">{{ row.body }}</span>
          </div>
        </TransitionGroup>
      </article>
    </div>
  </div>
</template>

<style scoped>
.csd {
  --csd-warn: #f5b94a;
  --csd-pane-h: 140px;

  position: relative;
  display: flex;
  flex-direction: column;
  font-family: var(--vp-font-family-base);
  color: var(--ea-text-1);
}

.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── URL ── */
.csd-url {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  background: var(--ea-surface);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-1);
  min-width: 0;
}
.csd-url-key {
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ea-text-2);
  border: 1px solid var(--ea-divider);
  border-radius: 3px;
  padding: 1px 5px;
  background: var(--ea-surface-alt);
  flex-shrink: 0;
}
.csd-url-path {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Grid ── */
.csd-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.csd-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  background: var(--ea-surface);
  overflow: hidden;
  min-width: 0;
  transition: border-color 280ms ease, opacity 280ms ease;
}
.csd-pane--offline {
  border-color: color-mix(in srgb, var(--csd-warn) 50%, var(--ea-divider));
}

/* ── Header ── */
.csd-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  background: var(--ea-surface-alt);
}
.csd-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 5px color-mix(in srgb, var(--vp-c-brand-1) 70%, transparent);
  animation: csd-blink 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
.csd-name {
  font-weight: 600;
  color: var(--ea-text-1);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csd-flag {
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ea-text-2);
  flex-shrink: 0;
}
.csd-pane--offline .csd-dot {
  background: var(--csd-warn);
  box-shadow: 0 0 5px color-mix(in srgb, var(--csd-warn) 70%, transparent);
  animation: none;
}
.csd-pane--offline .csd-flag {
  color: var(--csd-warn);
}

/* ── Rows ── */
.csd-rows {
  display: flex;
  flex-direction: column;
  height: var(--csd-pane-h);
  padding: 8px 10px 10px;
  gap: 4px;
  overflow: hidden;
  min-width: 0;
}
.csd-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 12.5px;
  line-height: 1.4;
  min-width: 0;
}
.csd-who {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--ea-text-2);
  flex-shrink: 0;
}
.csd-body {
  color: var(--ea-text-1);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csd-pane--offline .csd-row {
  opacity: 0.5;
}

/* ── Animations ── */
.csd-row-enter-active {
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.3, 1),
              opacity 240ms ease;
}
.csd-row-leave-active {
  transition: opacity 200ms ease;
  position: absolute;
}
.csd-row-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.csd-row-leave-to {
  opacity: 0;
}

@keyframes csd-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

@media (prefers-reduced-motion: reduce) {
  .csd-dot { animation: none !important; }
  .csd-row-enter-active,
  .csd-row-leave-active { transition: none !important; }
}

/* ── Mobile ── */
/* Match the parent .ds-split breakpoint so the demo stacks at the same
   width the surrounding two-column layout collapses. */
@media (max-width: 960px) {
  .csd {
    --csd-pane-h: 110px;
    /* The root needs to actively claim the full width of its column, so
       the inline-flex URL bar and the grid below both line up edge-to-
       edge with the available space rather than shrinking to content. */
    width: 100%;
    align-items: stretch;
  }
  .csd-grid {
    grid-template-columns: 1fr;
    width: 100%;
  }
  .csd-url {
    /* Switch from inline-flex (content-sized) to flex so the URL bar
       fills the same width as the panes below it. */
    display: flex;
    width: 100%;
    box-sizing: border-box;
  }
}
</style>
