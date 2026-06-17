<script setup lang="ts">
/* StateTileContentToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the composed StateTileContent (header + state-explorer
   table) at a tile-shaped size so we can review the deterministic
   pulse loop.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import StateTileContent from '../primitives/workspace/parts/StateTileContent.vue'

withDefaults(
  defineProps<{
    pulseRate?: number
    paused?: boolean
    density?: 'comfortable' | 'compact'
    showClose?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    pulseRate: 0.8,
    paused: false,
    density: 'comfortable',
    showClose: true,
    theme: 'dark',
  }
)
</script>

<template>
  <div class="state-tile-toy app-mockup-root" :data-theme="theme">
    <StateTileContent
      :pulse-rate="pulseRate"
      :paused="paused"
      :density="density"
      :show-close="showClose"
    />
  </div>
</template>

<style scoped>
.state-tile-toy {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ds-bg);
}
</style>
