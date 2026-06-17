<script setup lang="ts">
/* AppTimelineMarkerToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Wraps the pure `<AppTimelineMarker>` primitive in the
   `.app-mockup-root` token cascade so the muted text colour and
   left-border accent pick up `--ds-*` correctly inside the
   brand-toys harness (which forces `html.dark` regardless of the
   toy's intended theme).

   The primitive renders a single label · value marker; the toy
   stage shows two side-by-side ("spawned · 14:59" + "sandbox ·
   Local") to demonstrate the typical inline-row composition the
   live timeline uses. */

import '../shared.css'
import AppTimelineMarker from '../primitives/chat/AppTimelineMarker.vue'

withDefaults(
  defineProps<{
    label?: string
    value?: string
    secondLabel?: string
    secondValue?: string
    theme?: 'light' | 'dark'
  }>(),
  {
    label: 'spawned',
    value: '14:59',
    secondLabel: 'sandbox',
    secondValue: 'Local',
    theme: 'dark',
  }
)
</script>

<template>
  <div class="tm-toy app-mockup-root" :data-theme="theme">
    <div class="tm-toy-stage">
      <AppTimelineMarker :label="label" :value="value" />
      <AppTimelineMarker
        v-if="secondLabel"
        :label="secondLabel"
        :value="secondValue"
      />
    </div>
  </div>
</template>

<style scoped>
.tm-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tm-toy-stage {
  background: var(--ds-bg);
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid var(--ds-divider);
}
</style>
