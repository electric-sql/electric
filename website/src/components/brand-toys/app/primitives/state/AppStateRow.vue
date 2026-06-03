<script setup lang="ts">
/* AppStateRow — single state-explorer row.
   ─────────────────────────────────────────────────────────────────
   The state-explorer renders a 3-column grid of (key, value, source)
   triples with a left-edge accent hue per row kind. The row is the
   atomic unit of the table primitive's deterministic pulse loop —
   when its `pulsing` flag flips true the row briefly lights up via
   a CSS keyframe.

   Hue mapping (matches the live state-explorer):
     message     → blue   (--ds-blue-9)
     event       → cyan   (--ds-accent-9 / --ds-cyan-9 fallback)
     tool-call   → amber  (--ds-amber-9)
     tool-result → green  (--ds-green-9)
     error       → red    (--ds-red-9)

   Pure primitive — does NOT include `.app-mockup-root`. */

import type { MockStateRow } from '../../fixtures'

withDefaults(
  defineProps<{
    row: MockStateRow
    pulsing?: boolean
  }>(),
  {
    pulsing: false,
  }
)
</script>

<template>
  <div
    class="state-row"
    :data-kind="row.kind"
    :data-pulse="pulsing ? 'true' : 'false'"
  >
    <div class="state-row-edge" aria-hidden="true" />
    <span class="state-row-key mono">{{ row.key }}</span>
    <span class="state-row-value mono">{{ row.value }}</span>
    <span class="state-row-source mono">{{ row.source }}</span>
  </div>
</template>

<style scoped>
.state-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr) minmax(0, 0.7fr);
  align-items: center;
  gap: 12px;
  height: 32px;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--ds-divider);
  font-family: var(--ds-font-mono);
  font-size: 11.5px;
  line-height: 1;
  color: var(--ds-text-2);
  background: transparent;
  transition: background 0.18s ease;
}

.state-row-edge {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 1px;
  background: var(--ds-gray-7);
  opacity: 0.7;
}

.state-row[data-kind='message'] .state-row-edge {
  background: var(--ds-blue-9);
}
.state-row[data-kind='event'] .state-row-edge {
  background: var(--ds-cyan-9, var(--ds-accent-9));
}
.state-row[data-kind='tool-call'] .state-row-edge {
  background: var(--ds-amber-9);
}
.state-row[data-kind='tool-result'] .state-row-edge {
  background: var(--ds-green-9);
}
.state-row[data-kind='error'] .state-row-edge {
  background: var(--ds-red-9);
}

.state-row-key {
  color: var(--ds-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state-row-value {
  color: var(--ds-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state-row-source {
  color: var(--ds-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

/* Pulse keyframe — runs once when data-pulse flips to "true".
   The flag is held on the row by AppStateTable for ~600 ms; the
   keyframe shape (lift-then-fade) reads as "this cell just got an
   update". Lift: 0 → +1 → 0; brightness peak at the top of the lift. */
@keyframes state-row-pulse {
  0% {
    background: transparent;
    box-shadow: inset 0 0 0 0 var(--ds-accent-a4);
    transform: translateY(0);
  }
  20% {
    background: var(--ds-accent-a3);
    box-shadow: inset 2px 0 0 0 var(--ds-accent-9);
    transform: translateY(-1px);
  }
  100% {
    background: transparent;
    box-shadow: inset 0 0 0 0 var(--ds-accent-a4);
    transform: translateY(0);
  }
}

.state-row[data-pulse='true'] {
  animation: state-row-pulse 600ms cubic-bezier(0.32, 0.72, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  .state-row[data-pulse='true'] {
    animation: none;
    background: var(--ds-accent-a3);
  }
}
</style>
