<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

// Grid that represents the whole shape (everything the user is allowed
// to see). Each cell is a row in Postgres.
const COLS = 14
const ROWS = 7
const TOTAL = COLS * ROWS

// Three example live queries. Each has a `lens` rectangle (in grid
// cells) — the cells inside the lens are the rows the live query
// actually selects, and therefore the rows that get loaded onto the
// client. Cycling between them shows how different queries narrow the
// same shape down to different subsets without changing the shape.
type Query = {
  label: string
  // Position is in grid cells (0-based). The lens covers cells where
  // c >= colStart && c < colStart + cols, similarly for rows.
  colStart: number
  rowStart: number
  cols: number
  rows: number
}

const queries: Query[] = [
  // 1. Filter by priority — small slice in the top-left area.
  {
    label: "WHERE priority = 'urgent'",
    colStart: 1,
    rowStart: 1,
    cols: 5,
    rows: 3,
  },
  // 2. Mine — different slice on the right.
  {
    label: "WHERE assignee = 'me'",
    colStart: 7,
    rowStart: 2,
    cols: 6,
    rows: 4,
  },
  // 3. Recent (a horizontal "page") — bottom band, simulates LIMIT/window.
  {
    label: "ORDER BY updated_at DESC LIMIT 50",
    colStart: 1,
    rowStart: 5,
    cols: 12,
    rows: 1,
  },
]

const rootRef = ref<HTMLElement>()
const isActive = useDemoVisibility(rootRef)
const started = ref(false)
const idx = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

watch(isActive, (v) => {
  if (v) {
    if (!started.value) started.value = true
    if (!timer) {
      timer = setInterval(() => {
        idx.value = (idx.value + 1) % queries.length
      }, 3200)
    }
  } else {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const current = computed(() => queries[idx.value])

// Style the lens rectangle in % so it animates smoothly between query
// positions.
const lensStyle = computed(() => {
  const q = current.value
  return {
    left: `${(q.colStart / COLS) * 100}%`,
    top: `${(q.rowStart / ROWS) * 100}%`,
    width: `${(q.cols / COLS) * 100}%`,
    height: `${(q.rows / ROWS) * 100}%`,
  }
})

// For each cell, compute whether it's inside the lens for the active
// query. Returned as a flat boolean[] indexed by r * COLS + c, so the
// template can light up the matching dots.
const litCells = computed(() => {
  const q = current.value
  const out: boolean[] = new Array(TOTAL).fill(false)
  for (let r = q.rowStart; r < q.rowStart + q.rows; r++) {
    for (let c = q.colStart; c < q.colStart + q.cols; c++) {
      out[r * COLS + c] = true
    }
  }
  return out
})

const litCount = computed(() => current.value.cols * current.value.rows)
</script>

<template>
  <div ref="rootRef" class="qld" :class="{ started }">
    <!-- Outer frame: the shape -->
    <div class="qld-shape">
      <div class="qld-shape-head">
        <span class="qld-tag mono qld-tag-shape">SHAPE</span>
        <span class="qld-shape-title mono">
          workspace.issues <span class="qld-shape-where">where org_id = $user.org_id</span>
        </span>
        <span class="qld-shape-count mono">{{ TOTAL }}&nbsp;rows</span>
      </div>

      <div class="qld-grid-wrap">
        <div
          class="qld-grid"
          :style="{
            gridTemplateColumns: `repeat(${COLS}, 1fr)`,
            gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          }"
        >
          <span
            v-for="(_, i) in TOTAL"
            :key="i"
            class="qld-dot"
            :class="{ lit: litCells[i] }"
          />
        </div>

        <!-- The lens: the live-query subset that's actually loaded. -->
        <div class="qld-lens" :style="lensStyle" aria-hidden="true">
          <span class="qld-tag mono qld-tag-lens">LIVE&nbsp;QUERY</span>
        </div>
      </div>

      <div class="qld-foot">
        <code class="qld-code mono">{{ current.label }}</code>
        <span class="qld-foot-count mono">
          loads <strong>{{ litCount }}</strong> / {{ TOTAL }}&nbsp;rows
        </span>
      </div>

      <div class="qld-dots-nav" role="tablist" aria-label="Live queries">
        <button
          v-for="(q, i) in queries"
          :key="i"
          type="button"
          class="qld-nav-dot"
          :class="{ active: i === idx }"
          :aria-selected="i === idx"
          :aria-label="q.label"
          @click="idx = i"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.qld {
  --brand: var(--vp-c-brand-1);
  --shape-stroke: color-mix(in srgb, var(--ea-text-3) 50%, transparent);
  --lens-stroke: var(--brand);
  --dot-dim: color-mix(in srgb, var(--ea-text-3) 50%, transparent);
  --dot-lit: var(--brand);
  width: 100%;
  max-width: 440px;
  margin-left: auto;
}

.qld-shape {
  position: relative;
  padding: 12px 14px 14px;
  background: var(--ea-surface);
  border: 1px dashed var(--shape-stroke);
  border-radius: 10px;
}

.qld-shape-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.qld-tag {
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid currentColor;
  line-height: 1.4;
}
.qld-tag-shape {
  color: var(--ea-text-3);
}
.qld-tag-lens {
  color: var(--brand);
  background: var(--ea-surface);
  position: absolute;
  top: -1px;
  left: -1px;
  transform: translateY(-50%);
  padding: 1px 6px;
  font-size: 9px;
  white-space: nowrap;
}

.qld-shape-title {
  font-size: 11px;
  color: var(--ea-text-2);
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qld-shape-where {
  color: var(--ea-text-3);
}
.qld-shape-count {
  font-size: 10px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}

/* Grid + lens ─────────────────────────────────────────────────── */

.qld-grid-wrap {
  position: relative;
  width: 100%;
  /* aspect-ratio matches COLS:ROWS so the lens % numbers map cleanly */
  aspect-ratio: 14 / 7;
}

.qld-grid {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 0;
  padding: 5px;
}

.qld-dot {
  align-self: center;
  justify-self: center;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--dot-dim);
  opacity: 0.55;
  transition: background 350ms ease, opacity 350ms ease,
              transform 350ms ease;
}
.qld-dot.lit {
  background: var(--dot-lit);
  opacity: 1;
  transform: scale(1.35);
}

.qld-lens {
  position: absolute;
  border: 1.5px solid var(--lens-stroke);
  border-radius: 6px;
  background: color-mix(in srgb, var(--brand) 8%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 6%, transparent);
  /* Animate movement and resize between queries. The transition is
     applied unconditionally so the lens settles smoothly even from the
     initial state. */
  transition: left 600ms cubic-bezier(0.4, 0, 0.2, 1),
              top 600ms cubic-bezier(0.4, 0, 0.2, 1),
              width 600ms cubic-bezier(0.4, 0, 0.2, 1),
              height 600ms cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

/* Foot row: query label + counts ─────────────────────────────── */

.qld-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--ea-divider);
  flex-wrap: nowrap;
  min-width: 0;
}
.qld-code {
  font-size: 11px;
  color: var(--ea-text-1);
  background: var(--ea-surface-alt);
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--ea-divider);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}
.qld-foot-count {
  font-size: 10px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
  flex: 0 0 auto;
  white-space: nowrap;
}
.qld-foot-count strong {
  color: var(--brand);
  font-weight: 700;
}

/* Tab dots underneath ────────────────────────────────────────── */

.qld-dots-nav {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
}
.qld-nav-dot {
  appearance: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ea-divider);
  border: none;
  padding: 0;
  cursor: pointer;
  transition: background 200ms ease, transform 200ms ease;
}
.qld-nav-dot:hover { background: var(--ea-text-3); }
.qld-nav-dot.active {
  background: var(--brand);
  transform: scale(1.25);
}

@media (prefers-reduced-motion: reduce) {
  .qld-lens, .qld-dot { transition: none !important; }
}

@media (max-width: 768px) {
  .qld-shape { padding: 14px 14px 16px; }
  .qld-shape-title { font-size: 11px; }
  .qld-shape-where { display: none; }
  .qld-foot { gap: 8px; }
  .qld-code { font-size: 11px; }
}

@media (max-width: 480px) {
  .qld-shape-head { gap: 6px; margin-bottom: 12px; }
  .qld-shape-count { font-size: 10px; }
  .qld-grid { padding: 4px; }
  .qld-dot { width: 4px; height: 4px; }
}
</style>
