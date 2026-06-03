<script setup lang="ts">
/* AppStateTableToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the full state-explorer grid with the deterministic pulse
   loop running. `paused` freezes the cursor; `pulseRate` scales the
   cadence.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import AppStateTable from '../primitives/state/AppStateTable.vue'

withDefaults(
  defineProps<{
    pulseRate?: number
    paused?: boolean
    showHeader?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    pulseRate: 0.8,
    paused: false,
    showHeader: true,
    theme: 'dark',
  }
)
</script>

<template>
  <div class="table-toy app-mockup-root" :data-theme="theme">
    <div class="table-toy-stage">
      <AppStateTable
        :pulse-rate="pulseRate"
        :paused="paused"
        :show-header="showHeader"
      />
    </div>
  </div>
</template>

<style scoped>
.table-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 24px;
  background: var(--ds-bg);
}

.table-toy-stage {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ds-divider);
  border-radius: 8px;
  overflow: hidden;
}
</style>
