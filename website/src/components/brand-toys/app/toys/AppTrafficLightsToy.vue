<script setup lang="ts">
/* AppTrafficLightsToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Wraps the pure `<AppTrafficLights>` primitive in the
   `.app-mockup-root` token cascade so the dot colours / glyph shapes
   pick up `--ds-*` correctly inside the brand-toys harness (which
   forces `html.dark` regardless of the toy's intended theme).

   See APP_DESKTOP_MOCKUP_PLAN.md §6 (toy schema) for the controls
   exposed by the registered toy entry. */

import '../shared.css'
import AppTrafficLights from '../primitives/chrome/AppTrafficLights.vue'

withDefaults(
  defineProps<{
    state?: 'normal' | 'hover' | 'active'
    theme?: 'light' | 'dark'
  }>(),
  { state: 'normal', theme: 'dark' }
)
</script>

<template>
  <!--
    Centred on the stage so the small dot group reads cleanly
    regardless of how big the toy frame happens to be. The toy
    background provides the contrast against which the dots sit.
  -->
  <div class="tl-toy app-mockup-root" :data-theme="theme">
    <div class="tl-toy-stage">
      <AppTrafficLights :state="state" />
    </div>
  </div>
</template>

<style scoped>
.tl-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tl-toy-stage {
  /* Approximation of where the dots sit on a real macOS titlebar
     band — 28-px tall, padded to ~13px from the leading edge. The
     stage doesn't render a full window frame; it's just enough
     context that the dots don't float in space. */
  background: var(--ds-chrome-bg);
  height: 28px;
  width: 240px;
  display: flex;
  align-items: center;
  padding: 0 13px;
  border-radius: 6px;
  border: 1px solid var(--ds-divider);
}
</style>
