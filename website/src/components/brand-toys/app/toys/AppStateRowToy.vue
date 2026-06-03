<script setup lang="ts">
/* AppStateRowToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders one state-explorer row inside a small table-shaped strip so
   the row reads as it would inside the real grid. The `pulsing` toggle
   triggers the keyframe so we can pause + screenshot the lift state.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import { computed } from 'vue'
import '../shared.css'
import AppStateRow from '../primitives/state/AppStateRow.vue'
import { STATE_TABLE_FIXTURE, type MockStateRow } from '../fixtures'

const props = withDefaults(
  defineProps<{
    /** Which fixture row to render (index into STATE_TABLE_FIXTURE). */
    rowIndex?: number
    pulsing?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    rowIndex: 0,
    pulsing: false,
    theme: 'dark',
  }
)

const row = computed<MockStateRow>(() => {
  const i = Math.max(
    0,
    Math.min(STATE_TABLE_FIXTURE.length - 1, props.rowIndex)
  )
  return STATE_TABLE_FIXTURE[i]
})
</script>

<template>
  <div class="row-toy app-mockup-root" :data-theme="theme">
    <div class="row-toy-strip">
      <AppStateRow :row="row" :pulsing="pulsing" />
    </div>
  </div>
</template>

<style scoped>
.row-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--ds-bg);
}

.row-toy-strip {
  width: 100%;
  max-width: 640px;
  border-top: 1px solid var(--ds-divider);
  border-bottom: 1px solid var(--ds-divider);
  background: var(--ds-bg);
}
</style>
