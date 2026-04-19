<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"
import {
  useStreamSimulator,
  type StreamEvent,
} from "./useStreamSimulator"

const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

const rootRef = ref<HTMLElement>()
const isVisible = useDemoVisibility(rootRef)

const paused = ref(false)
function isPaused() {
  // Pause emission when off-screen, OR when reduced motion is on (we'll
  // pre-seed and freeze).
  return paused.value || reduceMotion
}

const sim = useStreamSimulator({
  intervalMs: 2400,
  paused: isPaused,
  seed: reduceMotion ? 5 : 3,
})

watch(
  isVisible,
  (v) => {
    paused.value = !v
  },
  { immediate: true },
)

/** Recently changed keys for flash animation, with timeouts to clear */
const flashKeys = ref<Set<string>>(new Set())
/** Recently inserted keys keep a "✱ new" badge for ~3s */
const newlyInserted = ref<Set<string>>(new Set())

const flashTimers = new Map<string, ReturnType<typeof setTimeout>>()
const newTimers = new Map<string, ReturnType<typeof setTimeout>>()

function flash(key: string) {
  if (reduceMotion) return
  const next = new Set(flashKeys.value)
  next.add(key)
  flashKeys.value = next
  const prev = flashTimers.get(key)
  if (prev) clearTimeout(prev)
  flashTimers.set(
    key,
    setTimeout(() => {
      const n = new Set(flashKeys.value)
      n.delete(key)
      flashKeys.value = n
      flashTimers.delete(key)
    }, 900),
  )
}

function markNew(key: string) {
  if (reduceMotion) return
  const next = new Set(newlyInserted.value)
  next.add(key)
  newlyInserted.value = next
  const prev = newTimers.get(key)
  if (prev) clearTimeout(prev)
  newTimers.set(
    key,
    setTimeout(() => {
      const n = new Set(newlyInserted.value)
      n.delete(key)
      newlyInserted.value = n
      newTimers.delete(key)
    }, 3000),
  )
}

watch(sim.latest, (ev) => {
  if (!ev) return
  flash(ev.key)
  if (ev.op === "insert") markNew(ev.key)
})

onUnmounted(() => {
  for (const t of flashTimers.values()) clearTimeout(t)
  for (const t of newTimers.values()) clearTimeout(t)
  sim.destroy()
})

/* ── Panel-1 (raw) view: most recent N events as JSON lines ─────────── */

const RAW_LIMIT = 6
const rawEvents = computed<StreamEvent[]>(() => {
  const evs = sim.events.value
  return evs.slice(-RAW_LIMIT)
})

function rawLine(ev: StreamEvent): string {
  // Compact-ish JSON, single line
  return JSON.stringify({
    offset: ev.id,
    type: ev.type,
    key: ev.key,
    value: ev.value,
    headers: { operation: ev.op },
  })
}

/* ── Panel-2 / Panel-3 view: materialized projection ────────────────── */

interface ProjectedRow {
  key: string
  value: Record<string, any>
}

const projected = computed<ProjectedRow[]>(() => {
  const map = new Map<string, Record<string, any>>()
  for (const ev of sim.events.value) {
    const prev = map.get(ev.key) ?? {}
    map.set(ev.key, { ...prev, ...ev.value })
  }
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }))
})

const STREAM_URL = "/v1/stream/users-state"
</script>

<template>
  <div ref="rootRef" class="ldd">
    <!-- Stream URL banner ─────────────────────────────────────────── -->
    <div class="ldd-banner">
      <div class="ldd-banner-row">
        <span class="ldd-method">GET</span>
        <span class="ldd-url">{{ STREAM_URL }}</span>
        <span class="ldd-banner-tag">shared stream</span>
      </div>
      <div class="ldd-banner-row ldd-banner-row--meta">
        <span class="ldd-banner-label">Content-Type:</span>
        <span class="ldd-banner-value">application/json</span>
      </div>
    </div>

    <!-- Three panels ──────────────────────────────────────────────── -->
    <div class="ldd-grid">
      <!-- Panel 1: Raw HTTP -->
      <div class="ldd-panel">
        <div class="ldd-panel-head">
          <span class="ldd-panel-name">Raw HTTP</span>
          <span class="ldd-panel-tag">res.body()</span>
        </div>
        <div class="ldd-panel-body ldd-panel-body--raw">
          <div class="ldd-raw">
            <div
              v-for="ev in rawEvents"
              :key="ev.id"
              class="ldd-raw-line"
              :class="{ 'ldd-raw-line--flash': flashKeys.has(ev.key) }"
            >
              {{ rawLine(ev) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Panel 2: Materialized state -->
      <div class="ldd-panel">
        <div class="ldd-panel-head">
          <span class="ldd-panel-name">State events</span>
          <span class="ldd-panel-tag">state.apply(evt)</span>
        </div>
        <div class="ldd-panel-body">
          <div class="ldd-state">
            <div class="ldd-state-head">
              <div>key</div>
              <div>value (name)</div>
            </div>
            <div
              v-for="row in projected"
              :key="row.key"
              class="ldd-state-row"
              :class="{ 'ldd-row--flash': flashKeys.has(row.key) }"
            >
              <div class="ldd-mono">{{ row.key }}</div>
              <div>{{ row.value.name }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Panel 3: StreamDB -->
      <div class="ldd-panel">
        <div class="ldd-panel-head">
          <span class="ldd-panel-name">StreamDB</span>
          <span class="ldd-panel-tag">db.users.toArray()</span>
        </div>
        <div class="ldd-panel-body">
          <div class="ldd-table">
            <div class="ldd-table-head">
              <div>id</div>
              <div>name</div>
              <div></div>
            </div>
            <div
              v-for="row in projected"
              :key="row.key"
              class="ldd-table-row"
              :class="{ 'ldd-row--flash': flashKeys.has(row.key) }"
            >
              <div class="ldd-mono">{{ row.value.id }}</div>
              <div>{{ row.value.name }}</div>
              <div>
                <span v-if="newlyInserted.has(row.key)" class="ldd-flag">
                  ✱ new
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer row (consumer code under each panel) ───────────────── -->
    <div class="ldd-foot-grid">
      <div class="ldd-foot">
        <code>@durable-streams/client</code>
      </div>
      <div class="ldd-foot">
        <code>@durable-streams/state · MaterializedState</code>
      </div>
      <div class="ldd-foot">
        <code>@durable-streams/state · createStreamDB({ schema })</code>
      </div>
    </div>

    <p class="ldd-takeaway">
      The point: there are no &ldquo;JSON mode&rdquo; vs &ldquo;State&rdquo; vs
      &ldquo;DB&rdquo; <em>streams</em> on the wire. There is one stream. Each
      consumer chooses how much of the protocol it wants to use.
    </p>
  </div>
</template>

<style scoped>
.ldd {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-family: var(--vp-font-family-base);
}

/* ── Stream URL banner ──────────────────────────────────────────────── */

.ldd-banner {
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface-alt);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ldd-banner-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--vp-font-family-mono);
  flex-wrap: wrap;
}

.ldd-banner-row--meta {
  font-size: 11.5px;
  color: var(--ea-text-2);
}

.ldd-method {
  font-size: 11px;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}

.ldd-url {
  font-size: 14px;
  color: var(--ea-text-1);
  font-weight: 600;
}

.ldd-banner-tag {
  margin-left: auto;
  font-family: var(--vp-font-family-base);
  font-size: 11px;
  color: var(--ea-text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ldd-banner-label {
  color: var(--ea-text-2);
}

.ldd-banner-value {
  color: var(--ea-text-1);
}

/* ── Panel grid ─────────────────────────────────────────────────────── */

.ldd-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  align-items: stretch;
}

.ldd-panel {
  display: flex;
  flex-direction: column;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  overflow: hidden;
  min-width: 0;
}

.ldd-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  flex-wrap: wrap;
}

.ldd-panel-name {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--ea-text-1);
}

.ldd-panel-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-brand-1);
}

.ldd-panel-body {
  flex: 1;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ldd-panel-body--raw {
  padding: 10px 12px;
}

/* ── Panel 1: raw JSON list ─────────────────────────────────────────── */

.ldd-raw {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--ea-text-1);
  overflow: hidden;
}

.ldd-raw-line {
  padding: 4px 8px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
  max-height: 56px;
  text-overflow: ellipsis;
  transition: background 0.6s ease, border-color 0.6s ease;
}

.ldd-raw-line--flash {
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, var(--ea-surface));
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 50%, var(--ea-divider));
}

/* ── Panel 2: state map table ───────────────────────────────────────── */

.ldd-state {
  margin: 12px 14px;
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  overflow: hidden;
  flex: 1;
}

.ldd-state-head,
.ldd-state-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  align-items: center;
}

.ldd-state-head {
  padding: 6px 10px;
  background: var(--ea-surface-alt);
  font-size: 10.5px;
  text-transform: uppercase;
  color: var(--ea-text-2);
  letter-spacing: 0.05em;
}

.ldd-state-row {
  padding: 7px 10px;
  border-top: 1px solid var(--ea-divider);
  color: var(--ea-text-1);
  transition: background 0.6s ease;
}

/* ── Panel 3: StreamDB table ────────────────────────────────────────── */

.ldd-table {
  margin: 12px 14px;
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  overflow: hidden;
  flex: 1;
}

.ldd-table-head,
.ldd-table-row {
  display: grid;
  grid-template-columns: 60px 1fr 60px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  align-items: center;
}

.ldd-table-head {
  padding: 6px 10px;
  background: var(--ea-surface-alt);
  font-size: 10.5px;
  text-transform: uppercase;
  color: var(--ea-text-2);
  letter-spacing: 0.05em;
}

.ldd-table-row {
  padding: 7px 10px;
  border-top: 1px solid var(--ea-divider);
  color: var(--ea-text-1);
  transition: background 0.6s ease;
}

.ldd-row--flash {
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, var(--ea-surface));
}

.ldd-mono {
  font-family: var(--vp-font-family-mono);
  color: var(--ea-text-2);
}

.ldd-flag {
  display: inline-block;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 30%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  animation: ldd-fadeout 3s ease forwards;
}

@keyframes ldd-fadeout {
  0% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}

/* ── Footer row + caption ───────────────────────────────────────────── */

.ldd-foot-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.ldd-foot {
  text-align: center;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-2);
}

.ldd-foot code {
  font-family: var(--vp-font-family-mono);
  background: transparent;
  color: var(--ea-text-2);
}

.ldd-takeaway {
  text-align: center;
  font-style: italic;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 24px auto 0;
  max-width: 640px;
}

.ldd-takeaway em {
  color: var(--ea-text-1);
  font-style: italic;
  font-weight: 600;
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .ldd-grid,
  .ldd-foot-grid {
    grid-template-columns: 1fr;
  }
  .ldd-banner {
    padding: 12px 14px;
  }
  .ldd-url {
    font-size: 13px;
  }
  .ldd-banner-tag {
    margin-left: 0;
  }
  .ldd-foot {
    font-size: 11.5px;
  }
}
</style>
