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
  ChevronsUpDown,
  Crosshair,
  ListCollapse,
  ListTree,
  Plus,
  SkipForward,
} from 'lucide-vue-next'
import AppIcon from '../AppIcon.vue'
import { STATE_FIXTURES, type StateFixtureKey } from '../../fixtures'

const PULSE_HOLD_MS = 600

const props = withDefaults(
  defineProps<{
    pulseRate?: number
    paused?: boolean
    /** Compact mode drops the StreamDB strip + tightens row heights. */
    density?: 'comfortable' | 'compact'
    /** Which `STATE_FIXTURES` variant to render. Defaults to
     *  `'default'` — the Horton run-loop fixture used by the hero
     *  stage. Other variants (e.g. `'summarizer'`) tailor the
     *  types / records / events to a specific scenario card on
     *  the /app page. */
    fixtureKey?: StateFixtureKey
  }>(),
  {
    pulseRate: 0.8,
    paused: false,
    density: 'comfortable',
    fixtureKey: 'default',
  }
)

/* Resolve the active fixture once per render — the inspector reads
   `types`, `records`, `events`, and `pulseOrder` off this. Computed
   so swapping the fixtureKey at runtime (e.g. in the brand-toy
   stage) reflows the panels without us having to wire up explicit
   watchers per slice. */
const fixture = computed(() => STATE_FIXTURES[props.fixtureKey])

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
  const order = fixture.value.pulseOrder
  const events = fixture.value.events
  const target = order[cursor % order.length]
  cursor = (cursor + 1) % order.length
  if (target == null || target >= events.length) return

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

/* Reset the pulse cursor when the fixture variant changes so we
   don't keep walking off the end of an order list that's shorter
   than where the cursor currently is. Also clear any in-flight
   pulse highlights since they reference indices into the OLD
   `events` list. */
watch(
  () => props.fixtureKey,
  () => {
    cursor = 0
    pulseSet.value = new Set()
    for (const t of pulseHoldTimers.values()) clearTimeout(t)
    pulseHoldTimers.clear()
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
        <span class="strip-selector-chevron" aria-hidden="true">
          <AppIcon :icon="ChevronsUpDown" :size="1" />
        </span>
      </span>
    </div>

    <!-- ───────── Types | Records split ───────── -->
    <div class="types-records-split">
      <div class="types-panel">
        <div class="panel-header">
          <span class="panel-title">Types</span>
          <span class="panel-count">{{ fixture.types.length }}</span>
        </div>
        <div class="types-list">
          <div
            v-for="t in fixture.types"
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
          <span class="panel-count">{{ fixture.records.length }}</span>
        </div>
        <div class="records-table">
          <div class="records-table-header">
            <span class="records-col records-col-key mono">key</span>
            <span class="records-col records-col-from mono">from</span>
            <span class="records-col records-col-payload mono">payload</span>
          </div>
          <div class="records-table-rows">
            <div v-for="(r, i) in fixture.records" :key="i" class="record-row">
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
        <span class="panel-count">{{ fixture.events.length }}</span>
        <span class="events-toolbar">
          <span
            class="events-toolbar-btn"
            aria-hidden="true"
            title="Go to live"
          >
            <AppIcon :icon="SkipForward" :size="2" />
          </span>
          <span
            class="events-toolbar-btn"
            aria-hidden="true"
            title="Expand all"
          >
            <AppIcon :icon="ListTree" :size="2" />
          </span>
          <span
            class="events-toolbar-btn"
            aria-hidden="true"
            title="Collapse all"
          >
            <AppIcon :icon="ListCollapse" :size="2" />
          </span>
        </span>
      </div>
      <div class="events-list">
        <div
          v-for="(e, i) in fixture.events"
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
            <span class="event-row-action" aria-hidden="true" title="Expand">
              <AppIcon :icon="Plus" :size="2" />
            </span>
            <span class="event-row-action" aria-hidden="true" title="Focus">
              <AppIcon :icon="Crosshair" :size="2" />
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

/* ───────── StreamDB strip ─────────
   Live: `StateExplorerPanel.tsx` `StateSourceHeader` —
   `<Stack px={3} py={2}>` + Text size={1} weight="medium" muted
   ("StreamDB") + Badge size={1} (count) + Select trigger.
   Text size={1} → `--ds-text-xs` (11px); Badge size={1} → 11px / h18. */

.streamdb-strip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: var(--line);
  background: var(--ds-bg);
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh);
  color: var(--ds-text-2);
}

.strip-label {
  font-weight: 500;
  color: var(--ds-text-2);
}

/* Mirrors `<Badge size={1}>` in the live UI: 11px font / 18px tall /
   2px 6px padding / 500 weight / pill-radius. */
.strip-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 2px 6px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-gray-a3);
  color: var(--ds-gray-11);
  font-size: var(--ds-text-xs);
  font-weight: 500;
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
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh);
  color: var(--ds-text-1);
}

.strip-selector-chevron {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
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

/* Header strip above each panel — mirrors live `TypeList.tsx` /
   `EventSidebar.tsx` headers: `<Stack px={3} py={1}>` with Text size={1}
   weight="medium" muted + Badge size={1}. So fonts are all 11px. */
.panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-bottom: var(--line);
  background: var(--ds-bg);
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh);
  color: var(--ds-text-2);
}

.panel-title {
  font-weight: 500;
  color: var(--ds-text-2);
  text-transform: capitalize;
}

/* Same Badge size={1} geometry as `.strip-count` above. */
.panel-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 2px 6px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-gray-a3);
  color: var(--ds-gray-11);
  font-size: var(--ds-text-xs);
  font-weight: 500;
  line-height: 1;
}

/* ───────── Types list ─────────
   Live `TypeList.tsx` rows use `<Text size={1}>` (11px) for both name
   and count — `tone="muted"` is colour only, not size. */

.types-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: var(--ds-space-2);
  gap: 4px;
}

.type-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
  padding: 0 var(--ds-space-2);
  border-radius: var(--ds-radius-2);
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh);
  color: var(--ds-text-2);
  cursor: default;
  position: relative;
}

.type-row[data-selected='true'] {
  background: var(--ds-accent-a3);
  color: var(--ds-accent-11, var(--ds-accent-9));
}

.type-row[data-selected='true'] .type-row-name {
  font-weight: 500;
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
  font-size: var(--ds-text-xs);
}

.type-row[data-selected='true'] .type-row-count {
  color: var(--ds-accent-11, var(--ds-accent-9));
}

/* ───────── Records table ─────────
   Live `StateTable.module.css` `.gridTable { font-size: var(--ds-text-xs) }`
   so every cell + header renders at 11px. */

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
  font-size: var(--ds-text-xs);
  line-height: 1;
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
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh);
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

/* ───────── Events panel ─────────
   Live `EventSidebar.tsx` toolbar buttons: `<IconButton size={1}>`
   (24×24) with custom 14px lucide icons. */

.events-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.events-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.events-toolbar {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.events-toolbar-btn {
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
}

.events-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Each event row is a `<Stack>` with `<Text size={1} family="mono">`
   index, `<Badge size={1}>` op pill and `<Code size={1}>` summary —
   so every text element resolves to 11px. The live `.eventRow` has
   no per-row divider — rows read as a flat list, separated only by
   the panel-header above. */
.event-row {
  display: grid;
  grid-template-columns: 24px auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh);
  color: var(--ds-text-2);
  background: transparent;
}

.event-row-index {
  color: var(--ds-text-3);
  font-size: var(--ds-text-xs);
}

/* Live op badge — `<Badge size={1} variant="soft" tone="success">`. */
.event-row-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 2px 6px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-green-a3);
  color: var(--ds-green-11, var(--ds-green-9));
  font-size: var(--ds-text-xs);
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
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
  gap: 2px;
}

.event-row-action {
  width: 20px;
  height: 20px;
  border-radius: var(--ds-radius-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  opacity: 0.7;
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

/* ───────── Compact density ─────────
   Tightens row heights only. Font sizes already sit at 11px (the
   smallest token in the live UI), so the compact mode stays at the
   same 11px and only loses a few pixels of vertical padding. */

.state-inspector[data-density='compact'] .streamdb-strip {
  display: none;
}
.state-inspector[data-density='compact'] .panel-header {
  height: 24px;
}
.state-inspector[data-density='compact'] .type-row,
.state-inspector[data-density='compact'] .record-row,
.state-inspector[data-density='compact'] .event-row {
  height: 22px;
}
</style>
