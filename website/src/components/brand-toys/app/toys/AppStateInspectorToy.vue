<script setup lang="ts">
/* AppStateInspectorToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders AppStateInspector inside a darker stage so the panel
   borders + selected-type accent read clearly. The pulse animation
   targets the Events panel and only starts when the toy stage is
   visible; toggle `paused` from the controls to freeze it. */

import '../shared.css'
import AppStateInspector from '../primitives/state/AppStateInspector.vue'

withDefaults(
  defineProps<{
    pulseRate?: number
    paused?: boolean
    density?: 'comfortable' | 'compact'
    theme?: 'light' | 'dark'
  }>(),
  {
    pulseRate: 0.8,
    paused: false,
    density: 'comfortable',
    theme: 'dark',
  }
)
</script>

<template>
  <div class="state-inspector-toy app-mockup-root" :data-theme="theme">
    <AppStateInspector
      :pulse-rate="pulseRate"
      :paused="paused"
      :density="density"
    />
  </div>
</template>

<style scoped>
.state-inspector-toy {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ds-bg);
  border: 1px solid var(--ds-divider);
}
</style>
