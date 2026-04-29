<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useDemoVisibility } from '../../../.vitepress/theme/composables/useDemoVisibility'

// Section 3: "Shape — the unit of sync".
// A SQL query on the left visibly "carves" matching rows out of a Postgres
// table on the right; the carved subset slides into the client below.
// The user toggles between two example shapes to feel the primitive.

interface Row {
  id: number
  assignee: string
  status: 'open' | 'done' | 'blocked'
  priority: 'P0' | 'P1' | 'P2'
  text: string
}

const TABLE: Row[] = [
  {
    id: 101,
    assignee: 'alex',
    status: 'open',
    priority: 'P0',
    text: 'Wire new auth flow',
  },
  {
    id: 102,
    assignee: 'jen',
    status: 'done',
    priority: 'P2',
    text: 'Update changelog',
  },
  {
    id: 103,
    assignee: 'alex',
    status: 'open',
    priority: 'P1',
    text: 'Fix race in worker',
  },
  {
    id: 104,
    assignee: 'kai',
    status: 'blocked',
    priority: 'P0',
    text: 'Postgres upgrade',
  },
  {
    id: 105,
    assignee: 'sam',
    status: 'done',
    priority: 'P1',
    text: 'Refactor router',
  },
  {
    id: 106,
    assignee: 'alex',
    status: 'open',
    priority: 'P2',
    text: 'Doc the API',
  },
  {
    id: 107,
    assignee: 'jen',
    status: 'open',
    priority: 'P0',
    text: 'Customer demo prep',
  },
  {
    id: 108,
    assignee: 'kai',
    status: 'done',
    priority: 'P0',
    text: 'Ship release notes',
  },
]

interface ShapeDef {
  id: string
  label: string
  sql: string
  match: (r: Row) => boolean
}

const SHAPES: ShapeDef[] = [
  {
    id: 'alex-open',
    label: "Alex's open issues",
    sql: `WHERE assignee = 'alex'\n  AND status = 'open'`,
    match: (r) => r.assignee === 'alex' && r.status === 'open',
  },
  {
    id: 'p0',
    label: 'All P0 work',
    sql: `WHERE priority = 'P0'`,
    match: (r) => r.priority === 'P0',
  },
]

const activeIdx = ref(0)
const active = computed(() => SHAPES[activeIdx.value])
const matched = computed(() => TABLE.filter(active.value.match))

// A carve "tick" used to retrigger animations on shape switch
const carveKey = ref(0)

function selectShape(i: number) {
  if (i === activeIdx.value) return
  activeIdx.value = i
  carveKey.value += 1
}

const rootRef = ref<HTMLElement>()
const isVisible = useDemoVisibility(rootRef)
const hasStarted = ref(false)

let rotate: number | undefined

function startRotation() {
  if (rotate) return
  rotate = window.setInterval(() => {
    selectShape((activeIdx.value + 1) % SHAPES.length)
  }, 5500)
}

function stopRotation() {
  if (rotate) {
    window.clearInterval(rotate)
    rotate = undefined
  }
}

let hasRevealed = false
watch(isVisible, (v) => {
  if (v) {
    // First-time entry: bump carveKey so the carve-in / client-in
    // animations actually play as the demo scrolls into view (not
    // silently on initial mount). Guard with a permanent latch so a
    // transient visibility flip during layout settle doesn't
    // re-trigger the entry animation.
    if (!hasRevealed) {
      hasRevealed = true
      hasStarted.value = true
      carveKey.value += 1
    }
    startRotation()
  } else {
    stopRotation()
  }
})

onMounted(() => {
  if (isVisible.value) {
    hasStarted.value = true
    startRotation()
  }
})

onUnmounted(stopRotation)
</script>

<template>
  <div ref="rootRef" class="shape-carve" :class="{ started: hasStarted }">
    <!-- Top bar: shape selector -->
    <div class="sc-controls">
      <span class="sc-controls-label">Shape:</span>
      <button
        v-for="(s, i) in SHAPES"
        :key="s.id"
        class="sc-pill"
        :class="{ active: i === activeIdx }"
        @click="selectShape(i)"
      >
        {{ s.label }}
      </button>
    </div>

    <div class="sc-stage">
      <!-- LEFT: SQL definition -->
      <div class="sc-sql">
        <div class="sc-pane-label">
          <span class="dot"></span>
          <span class="mono">define a shape</span>
        </div>
        <pre class="sc-sql-body"><code><span class="k">SELECT</span> *
<span class="k">FROM</span> issues
<span :key="`sql-${carveKey}`" class="sql-where">{{ active.sql }}</span></code></pre>
        <div class="sc-meta">
          <div class="sc-meta-item">
            <span class="mono kv-k">rows matched</span>
            <span class="mono kv-v">{{ matched.length }}</span>
          </div>
          <div class="sc-meta-item">
            <span class="mono kv-k">scope</span>
            <span class="mono kv-v"
              >{{ matched.length }} / {{ TABLE.length }}</span
            >
          </div>
        </div>
      </div>

      <!-- MIDDLE: Postgres table being carved -->
      <div class="sc-table">
        <div class="sc-pane-label">
          <span class="dot pg"></span>
          <span class="mono">postgres · issues</span>
        </div>
        <ul class="sc-rows">
          <li
            v-for="row in TABLE"
            :key="`r-${row.id}-${carveKey}`"
            class="sc-row"
            :class="{ matched: active.match(row) }"
            :style="{ '--carve-delay': `${(row.id - 101) * 60}ms` }"
          >
            <span class="cell id mono">#{{ row.id }}</span>
            <span class="cell user mono">{{ row.assignee }}</span>
            <span class="cell pri mono" :data-pri="row.priority">{{
              row.priority
            }}</span>
            <span class="cell status mono" :data-status="row.status">{{
              row.status
            }}</span>
            <span class="cell text">{{ row.text }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- BOTTOM: arrow + client -->
    <div class="sc-flow">
      <svg class="sc-flow-arrow" viewBox="0 0 80 24" aria-hidden="true">
        <path
          d="M0 12 H66 M58 6 L66 12 L58 18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <div class="sc-flow-label mono">streams to&nbsp;client</div>
      <svg class="sc-flow-arrow" viewBox="0 0 80 24" aria-hidden="true">
        <path
          d="M0 12 H66 M58 6 L66 12 L58 18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <div class="sc-client">
      <div class="sc-client-header">
        <span class="dot client"></span>
        <span class="mono sc-client-title">client · live shape</span>
        <span class="sc-client-count mono">{{ matched.length }} rows</span>
      </div>
      <ul class="sc-client-rows">
        <li
          v-for="(row, i) in matched"
          :key="`c-${row.id}-${carveKey}`"
          class="sc-client-row"
          :style="{ '--in-delay': `${i * 60 + 200}ms` }"
        >
          <span class="cell id mono">#{{ row.id }}</span>
          <span class="cell user mono">{{ row.assignee }}</span>
          <span class="cell pri mono" :data-pri="row.priority">{{
            row.priority
          }}</span>
          <span class="cell text">{{ row.text }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.shape-carve {
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── Controls ───────────────────────────────────────────────────── */

.sc-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sc-controls-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ea-text-3);
}

.sc-pill {
  appearance: none;
  border: 1px solid var(--ea-divider);
  background: var(--ea-bg);
  color: var(--ea-text-2);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12.5px;
  font-family: var(--vp-font-family-base);
  cursor: pointer;
  transition:
    border-color 0.18s,
    color 0.18s,
    background 0.18s;
}
.sc-pill:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--ea-text-1);
}
.sc-pill.active {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
}

/* ── Stage layout: SQL | table ──────────────────────────────────── */

.sc-stage {
  display: grid;
  grid-template-columns: minmax(220px, 0.85fr) 1.4fr;
  gap: 18px;
  align-items: stretch;
}

.sc-pane-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--ea-text-3);
  margin-bottom: 10px;
}
.sc-pane-label .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ea-text-3);
}
.sc-pane-label .dot.pg {
  background: #336791;
}
.sc-pane-label .dot.client {
  background: var(--vp-c-brand-1);
}

/* ── SQL pane ───────────────────────────────────────────────────── */

.sc-sql {
  background: var(--ea-bg);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
}

.sc-sql-body {
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--ea-text-1);
  background: transparent;
  white-space: pre-wrap;
  flex: 1;
}
.sc-sql-body .k {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.sc-sql-body .sql-where {
  display: block;
  color: var(--ea-text-2);
}
.shape-carve.started .sc-sql-body .sql-where {
  animation: sql-where-flash 0.6s ease-out;
}

@keyframes sql-where-flash {
  0% {
    background: color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent);
  }
  100% {
    background: transparent;
  }
}

.sc-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--ea-divider);
}
.sc-meta-item {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
}
.kv-k {
  color: var(--ea-text-3);
}
.kv-v {
  color: var(--ea-text-1);
}

/* ── Postgres table pane ────────────────────────────────────────── */

.sc-table {
  background: var(--ea-bg);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sc-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.sc-row {
  display: grid;
  grid-template-columns: 50px 60px 38px 70px 1fr;
  gap: 10px;
  align-items: baseline;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12.5px;
  line-height: 1.3;
  background: transparent;
  border: 1px solid transparent;
  opacity: 0.45;
  transition:
    opacity 0.35s,
    background 0.35s,
    border-color 0.35s;
}
.sc-row.matched {
  opacity: 1;
  background: color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--ea-divider));
}
.shape-carve.started .sc-row.matched {
  animation: sc-carve-in 0.5s ease-out backwards;
  animation-delay: var(--carve-delay);
}

@keyframes sc-carve-in {
  0% {
    background: color-mix(in srgb, var(--vp-c-brand-1) 28%, transparent);
    transform: translateX(-4px);
  }
  100% {
    background: color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
    transform: translateX(0);
  }
}

.cell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell.id {
  color: var(--ea-text-3);
}
.cell.user {
  color: var(--ea-text-2);
}
.cell.text {
  color: var(--ea-text-1);
  white-space: normal;
}
.cell.pri {
  font-weight: 600;
}
.cell.pri[data-pri='P0'] {
  color: #d73a49;
}
.cell.pri[data-pri='P1'] {
  color: #b08800;
}
.cell.pri[data-pri='P2'] {
  color: var(--ea-text-3);
}
.cell.status[data-status='open'] {
  color: var(--vp-c-brand-1);
}
.cell.status[data-status='done'] {
  color: var(--ea-text-3);
}
.cell.status[data-status='blocked'] {
  color: #d73a49;
}

/* ── Flow arrow ─────────────────────────────────────────────────── */

.sc-flow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ea-text-3);
  margin: 4px 0 -2px;
}
.sc-flow-arrow {
  width: 80px;
  height: 24px;
  flex: 0 0 80px;
  color: var(--ea-text-3);
}
.sc-flow-label {
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ea-text-3);
}

/* ── Client pane ────────────────────────────────────────────────── */

.sc-client {
  background: var(--ea-bg);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 14px 16px;
}

.sc-client-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--ea-text-3);
  padding-bottom: 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--ea-divider);
}
.sc-client-title {
  color: var(--ea-text-2);
}
.sc-client-count {
  margin-left: auto;
  color: var(--vp-c-brand-1);
}

.sc-client-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px;
}

.sc-client-row {
  display: grid;
  grid-template-columns: 44px 50px 32px 1fr;
  gap: 8px;
  align-items: baseline;
  padding: 6px 8px;
  font-size: 12px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 4px;
}
.shape-carve.started .sc-client-row {
  animation: sc-client-in 0.45s ease-out backwards;
  animation-delay: var(--in-delay);
}

@keyframes sc-client-in {
  0% {
    opacity: 0;
    transform: translateY(6px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.mono {
  font-family: var(--vp-font-family-mono);
}

/* ── Responsive ─────────────────────────────────────────────────── */

@media (max-width: 820px) {
  .sc-stage {
    grid-template-columns: 1fr;
  }
  .sc-row {
    grid-template-columns: 44px 50px 32px 60px 1fr;
    font-size: 12px;
  }
}

@media (max-width: 540px) {
  .shape-carve {
    padding: 16px;
  }
  .sc-row {
    grid-template-columns: 38px 44px 30px 1fr;
  }
  .sc-row .cell.status {
    display: none;
  }
  .sc-client-row {
    grid-template-columns: 40px 44px 30px 1fr;
  }
}
</style>
