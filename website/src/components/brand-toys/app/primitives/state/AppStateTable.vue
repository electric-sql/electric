<script setup lang="ts">
/* AppStateTable — state-explorer grid with deterministic row pulses.
   ─────────────────────────────────────────────────────────────────
   Renders the STATE_TABLE_FIXTURE rows as a 3-column grid (key | value
   | source) with a small column header and a deterministic pulse loop
   on the rows.

   Animation:
     - Every `1 / pulseRate` seconds, advance a cursor through
       STATE_PULSE_ORDER and flip the row at that index to
       `pulsing: true` for ~600 ms (CSS keyframe handles the visual
       lift). After the keyframe, the flag is cleared.
     - Cursor wraps to the start of the order list — same recording
       every cycle. (Random pulses look noisier and screenshot worse.)

   Lifecycle hooks:
     - IntersectionObserver gates the timer start. The setInterval is
       only kicked off after the table intersects the viewport once.
     - `paused` freezes the cursor in place (does NOT clear the active
       pulse).
     - `prefers-reduced-motion: reduce` keeps the table static.

   Pure primitive — does NOT include `.app-mockup-root`. */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  STATE_PULSE_ORDER,
  STATE_TABLE_FIXTURE,
  type MockStateRow,
} from '../../fixtures'
import AppStateRow from './AppStateRow.vue'

const PULSE_HOLD_MS = 600

const props = withDefaults(
  defineProps<{
    /** Rows to render — defaults to STATE_TABLE_FIXTURE. */
    rows?: readonly MockStateRow[]
    /** Pulses per second target. */
    pulseRate?: number
    /** Freeze the cursor in place. */
    paused?: boolean
    /** Render the column header strip. */
    showHeader?: boolean
  }>(),
  {
    rows: () => STATE_TABLE_FIXTURE,
    pulseRate: 0.8,
    paused: false,
    showHeader: true,
  }
)

const reducedMotion = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const hasIntersected = ref(false)

const pulseSet = ref<Set<number>>(new Set())
let cursor = 0
let intervalId: ReturnType<typeof setInterval> | null = null
const pulseHoldTimers = new Map<number, ReturnType<typeof setTimeout>>()

const driven = computed(
  () =>
    !props.paused &&
    !reducedMotion.value &&
    hasIntersected.value &&
    props.pulseRate > 0
)

function tick() {
  if (!driven.value) return
  /* The pulse cursor walks the index list deterministically. We use
     the pulse-order as a pointer into props.rows — this means the same
     row indices fire in the same order across mounts. */
  const target = STATE_PULSE_ORDER[cursor % STATE_PULSE_ORDER.length]
  cursor = (cursor + 1) % STATE_PULSE_ORDER.length
  if (target == null || target >= props.rows.length) return

  pulseSet.value = new Set([...pulseSet.value, target])
  /* Clear any prior hold timer for this row so re-pulses reset
     cleanly (rare, but the order list could repeat). */
  const existing = pulseHoldTimers.get(target)
  if (existing) clearTimeout(existing)

  const t = setTimeout(() => {
    pulseSet.value = new Set([...pulseSet.value].filter((i) => i !== target))
    pulseHoldTimers.delete(target)
  }, PULSE_HOLD_MS)
  pulseHoldTimers.set(target, t)
}

watch(driven, (on) => {
  if (on) {
    /* Kick off the first pulse immediately so the table doesn't sit
       idle while the user waits for the first interval. */
    tick()
    intervalId = setInterval(tick, 1000 / Math.max(0.05, props.pulseRate))
  } else if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
})

/* Restart timer on pulseRate change while running. */
watch(
  () => props.pulseRate,
  () => {
    if (intervalId === null) return
    clearInterval(intervalId)
    intervalId = setInterval(tick, 1000 / Math.max(0.05, props.pulseRate))
  }
)

let observer: IntersectionObserver | null = null

onMounted(() => {
  if (typeof window === 'undefined') return

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    reducedMotion.value = true
    return
  }

  if (!rootEl.value) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          hasIntersected.value = true
          observer?.disconnect()
          observer = null
          break
        }
      }
    },
    { threshold: 0.1 }
  )
  observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  for (const t of pulseHoldTimers.values()) clearTimeout(t)
  pulseHoldTimers.clear()
  if (observer) {
    observer.disconnect()
    observer = null
  }
})
</script>

<template>
  <div ref="rootEl" class="state-table">
    <div v-if="showHeader" class="state-table-header">
      <span class="state-table-header-cell">key</span>
      <span class="state-table-header-cell">value</span>
      <span class="state-table-header-cell state-table-header-cell--right"
        >source</span
      >
    </div>
    <div class="state-table-rows">
      <AppStateRow
        v-for="(row, i) in rows"
        :key="row.key"
        :row="row"
        :pulsing="pulseSet.has(i)"
      />
    </div>
  </div>
</template>

<style scoped>
.state-table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--ds-bg);
  font-family: var(--ds-font-body);
  border-top: 1px solid var(--ds-divider);
}

.state-table-header {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr) minmax(0, 0.7fr);
  gap: 12px;
  height: 28px;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--ds-divider);
  background: var(--ds-surface-soft);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ds-text-3);
  align-items: center;
}

.state-table-header-cell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state-table-header-cell--right {
  text-align: right;
}

.state-table-rows {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
