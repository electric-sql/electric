<script setup lang="ts">
/* AppStateInspector — real-shape state-explorer panel.
   ─────────────────────────────────────────────────────────────────
   Mirrors the desktop-app state inspector reference screenshot
   (`_reference/real-chat-state-explorer.png`):

     [  StreamDB  1   runtime ⌄                                    ]
     ├─────────────┬──────────────────────────────────────────────┤
     │  Types  7   │  Records  1                                  │
     │ entity_cr…1 │  key            from           payload       │
     │ inbox     1 │  msg-in-…   /principal/sys…   "Test"         │
     │ run       1 │                                              │
     │ step      1 │                                              │
     │ text      1 │                                              │
     │ text_de…  6 │ ← selected                                   │
     │ tags      1 │                                              │
     ├─────────────┴──────────────────────────────────────────────┤
     │  Events  15                                  [→][filter][↻]│
     │  01  INS  entity_created:entity-created                  +↻│
     │  02  INS  inbox:msg-in-1780491582518-283dha              +↻│
     │  …                                                       …│
     └────────────────────────────────────────────────────────────┘

   The deterministic pulse loop runs on the Events panel: every
   `1 / pulseRate` seconds the cursor advances through
   STATE_EVENT_PULSE_ORDER and the targeted row briefly lifts (CSS
   keyframe). Loop wraps to the start.

   Pure primitive — does NOT include `.app-mockup-root`. */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  STATE_EVENT_PULSE_ORDER,
  STATE_EVENTS_FIXTURE,
  STATE_RECORDS_FIXTURE,
  STATE_TYPES_FIXTURE,
} from '../../fixtures'

const PULSE_HOLD_MS = 600

const props = withDefaults(
  defineProps<{
    pulseRate?: number
    paused?: boolean
    /** Compact mode drops the StreamDB strip + tightens row heights. */
    density?: 'comfortable' | 'compact'
  }>(),
  {
    pulseRate: 0.8,
    paused: false,
    density: 'comfortable',
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
  const target =
    STATE_EVENT_PULSE_ORDER[cursor % STATE_EVENT_PULSE_ORDER.length]
  cursor = (cursor + 1) % STATE_EVENT_PULSE_ORDER.length
  if (target == null || target >= STATE_EVENTS_FIXTURE.length) return

  pulseSet.value = new Set([...pulseSet.value, target])
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
    tick()
    intervalId = setInterval(tick, 1000 / Math.max(0.05, props.pulseRate))
  } else if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
})

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
  <div ref="rootEl" class="state-inspector" :data-density="density">
    <!-- ───────── StreamDB / runtime selector strip ───────── -->
    <div v-if="density === 'comfortable'" class="streamdb-strip">
      <span class="strip-label">StreamDB</span>
      <span class="strip-count">1</span>
      <span class="strip-selector">
        <span class="strip-selector-label mono">runtime</span>
        <span class="strip-selector-chevron" aria-hidden="true" />
      </span>
    </div>

    <!-- ───────── Types | Records split ───────── -->
    <div class="types-records-split">
      <div class="types-panel">
        <div class="panel-header">
          <span class="panel-title">Types</span>
          <span class="panel-count">{{ STATE_TYPES_FIXTURE.length }}</span>
        </div>
        <div class="types-list">
          <div
            v-for="t in STATE_TYPES_FIXTURE"
            :key="t.name"
            class="type-row"
            :data-selected="t.selected ? 'true' : 'false'"
          >
            <span class="type-row-name mono">{{ t.name }}</span>
            <span class="type-row-count mono">{{ t.count }}</span>
          </div>
        </div>
      </div>

      <div class="records-panel">
        <div class="panel-header records-header">
          <span class="panel-title">Records</span>
          <span class="panel-count">{{ STATE_RECORDS_FIXTURE.length }}</span>
        </div>
        <div class="records-table">
          <div class="records-table-header">
            <span class="records-col records-col-key mono">key</span>
            <span class="records-col records-col-from mono">from</span>
            <span class="records-col records-col-payload mono">payload</span>
          </div>
          <div class="records-table-rows">
            <div
              v-for="(r, i) in STATE_RECORDS_FIXTURE"
              :key="i"
              class="record-row"
            >
              <span class="record-cell record-cell-key mono" :title="r.key">{{
                r.key
              }}</span>
              <span class="record-cell record-cell-from mono" :title="r.from">{{
                r.from
              }}</span>
              <span
                class="record-cell record-cell-payload mono"
                :title="r.payload"
                >{{ r.payload }}</span
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ───────── Events panel ───────── -->
    <div class="events-panel">
      <div class="panel-header events-header">
        <span class="panel-title">Events</span>
        <span class="panel-count">{{ STATE_EVENTS_FIXTURE.length }}</span>
        <span class="events-toolbar">
          <span class="events-toolbar-btn" aria-hidden="true" title="Forward">
            <span class="events-toolbar-glyph events-toolbar-glyph-arrow" />
          </span>
          <span class="events-toolbar-btn" aria-hidden="true" title="Filter">
            <span class="events-toolbar-glyph events-toolbar-glyph-filter" />
          </span>
          <span class="events-toolbar-btn" aria-hidden="true" title="Refresh">
            <span class="events-toolbar-glyph events-toolbar-glyph-refresh" />
          </span>
        </span>
      </div>
      <div class="events-list">
        <div
          v-for="(e, i) in STATE_EVENTS_FIXTURE"
          :key="e.index"
          class="event-row"
          :data-pulse="pulseSet.has(i) ? 'true' : 'false'"
        >
          <span class="event-row-index mono">{{
            String(e.index).padStart(2, '0')
          }}</span>
          <span class="event-row-kind mono">{{ e.kind }}</span>
          <span class="event-row-summary mono" :title="e.summary">{{
            e.summary
          }}</span>
          <span class="event-row-actions">
            <span class="event-row-action" aria-hidden="true" title="Add">
              <span class="event-action-glyph event-action-glyph-add" />
            </span>
            <span class="event-row-action" aria-hidden="true" title="Replay">
              <span class="event-action-glyph event-action-glyph-refresh" />
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.state-inspector {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--ds-bg);
  font-family: var(--ds-font-body);
  /* All the panel grids work in a deterministic 1-px line system. */
  --line: 1px solid var(--ds-divider);
}

/* ───────── StreamDB strip ───────── */

.streamdb-strip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: var(--line);
  background: var(--ds-surface-soft);
  font-size: 11.5px;
  color: var(--ds-text-2);
}

.strip-label {
  font-weight: 500;
  color: var(--ds-text-1);
}

.strip-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  min-width: 16px;
  padding: 0 4px;
  border-radius: var(--ds-radius-1);
  background: var(--ds-gray-a3);
  color: var(--ds-text-2);
  font-size: 10px;
  line-height: 1;
}

.strip-selector {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: var(--ds-radius-2);
  background: var(--ds-bg);
  border: 1px solid var(--ds-divider);
  margin-left: auto;
  width: 220px;
  max-width: 50%;
}

.strip-selector-label {
  flex: 1;
  font-size: 11.5px;
  color: var(--ds-text-1);
}

.strip-selector-chevron {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid var(--ds-text-3);
  border-bottom: 1.5px solid var(--ds-text-3);
  transform: rotate(45deg) translate(-2px, -2px);
  flex-shrink: 0;
}

/* ───────── Types | Records split ───────── */

.types-records-split {
  flex: 1.2;
  min-height: 0;
  display: flex;
  border-bottom: var(--line);
}

.types-panel,
.records-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.types-panel {
  flex: 0 0 35%;
  max-width: 220px;
  border-right: var(--line);
}

.records-panel {
  flex: 1;
}

.panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-bottom: var(--line);
  background: var(--ds-surface-soft);
  font-size: 11px;
  color: var(--ds-text-2);
}

.panel-title {
  font-weight: 500;
  color: var(--ds-text-1);
  text-transform: capitalize;
}

.panel-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 14px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: var(--ds-radius-1);
  background: var(--ds-gray-a3);
  color: var(--ds-text-3);
  font-size: 10px;
  line-height: 1;
}

/* ───────── Types list ───────── */

.types-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.type-row {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
  color: var(--ds-text-2);
  cursor: default;
  position: relative;
  border-left: 2px solid transparent;
}

.type-row[data-selected='true'] {
  background: var(--ds-bg-hover);
  color: var(--ds-text-1);
  border-left-color: var(--ds-accent-9);
}

.type-row-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-row-count {
  flex-shrink: 0;
  color: var(--ds-text-3);
  font-size: 10.5px;
  margin-left: 8px;
}

.type-row[data-selected='true'] .type-row-count {
  color: var(--ds-accent-11, var(--ds-accent-9));
}

/* ───────── Records table ───────── */

.records-table {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.records-table-header {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
  padding: 0 12px;
  height: 22px;
  align-items: center;
  font-size: 10.5px;
  letter-spacing: 0.02em;
  color: var(--ds-text-3);
  border-bottom: var(--line);
  background: var(--ds-bg);
}

.records-col-payload {
  text-align: left;
}

.records-table-rows {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.record-row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
  padding: 0 12px;
  height: 28px;
  align-items: center;
  font-size: 11.5px;
  color: var(--ds-text-2);
}

.record-cell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.record-cell-key {
  color: var(--ds-text-1);
}

.record-cell-from {
  color: var(--ds-text-3);
}

.record-cell-payload {
  color: var(--ds-text-2);
}

/* ───────── Events panel ───────── */

.events-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.events-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.events-toolbar {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.events-toolbar-btn {
  width: 22px;
  height: 22px;
  border-radius: var(--ds-radius-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
}

.events-toolbar-glyph {
  width: 12px;
  height: 12px;
  position: relative;
  display: inline-block;
}

.events-toolbar-glyph-arrow::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 8px;
  height: 1.4px;
  background: currentColor;
}
.events-toolbar-glyph-arrow::after {
  content: '';
  position: absolute;
  right: 1px;
  top: 50%;
  width: 0;
  height: 0;
  border-left: 4px solid currentColor;
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
  transform: translateY(-50%);
}

.events-toolbar-glyph-filter {
  border: 1.4px solid currentColor;
  border-bottom: none;
  border-left: none;
  border-right: none;
}
.events-toolbar-glyph-filter::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  width: 12px;
  height: 1.4px;
  background: currentColor;
}
.events-toolbar-glyph-filter::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 1px;
  width: 1.4px;
  height: 11px;
  background: currentColor;
  transform: translateX(-50%) rotate(0deg);
  clip-path: polygon(50% 0, 100% 0, 100% 60%, 50% 100%, 0 60%, 0 0);
}

.events-toolbar-glyph-refresh {
  border: 1.4px solid currentColor;
  border-radius: 50%;
  border-top-color: transparent;
}
.events-toolbar-glyph-refresh::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-top: 4px solid currentColor;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
}

.events-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.event-row {
  display: grid;
  grid-template-columns: 24px 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
  color: var(--ds-text-2);
  border-bottom: var(--line);
  background: transparent;
}

.event-row-index {
  color: var(--ds-text-3);
  font-size: 10.5px;
}

.event-row-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  padding: 0 5px;
  border-radius: var(--ds-radius-1);
  background: var(--ds-green-a3);
  color: var(--ds-green-11, var(--ds-green-9));
  font-size: 9.5px;
  letter-spacing: 0.04em;
}

.event-row-summary {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ds-text-1);
}

.event-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.event-row-action {
  width: 18px;
  height: 18px;
  border-radius: var(--ds-radius-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  opacity: 0.7;
}

.event-action-glyph {
  width: 10px;
  height: 10px;
  position: relative;
  display: inline-block;
}

.event-action-glyph-add::before,
.event-action-glyph-add::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  background: currentColor;
  border-radius: 1px;
}
.event-action-glyph-add::before {
  width: 9px;
  height: 1.3px;
}
.event-action-glyph-add::after {
  width: 1.3px;
  height: 9px;
}

.event-action-glyph-refresh {
  border: 1.3px solid currentColor;
  border-radius: 50%;
  border-top-color: transparent;
}
.event-action-glyph-refresh::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-top: 3px solid currentColor;
  border-left: 2.5px solid transparent;
  border-right: 2.5px solid transparent;
}

/* Pulse keyframe — matches the legacy AppStateRow pulse but tuned
   for the events panel where the visual cadence reads strongest. */
@keyframes event-row-pulse {
  0% {
    background: transparent;
    box-shadow: inset 2px 0 0 0 transparent;
  }
  20% {
    background: var(--ds-accent-a3);
    box-shadow: inset 2px 0 0 0 var(--ds-accent-9);
  }
  100% {
    background: transparent;
    box-shadow: inset 2px 0 0 0 transparent;
  }
}

.event-row[data-pulse='true'] {
  animation: event-row-pulse 600ms cubic-bezier(0.32, 0.72, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  .event-row[data-pulse='true'] {
    animation: none;
    background: var(--ds-accent-a3);
  }
}

/* ───────── Compact density ───────── */

.state-inspector[data-density='compact'] .streamdb-strip {
  display: none;
}
.state-inspector[data-density='compact'] .panel-header {
  height: 24px;
  font-size: 10.5px;
}
.state-inspector[data-density='compact'] .type-row,
.state-inspector[data-density='compact'] .record-row,
.state-inspector[data-density='compact'] .event-row {
  height: 24px;
  font-size: 11px;
}
</style>
