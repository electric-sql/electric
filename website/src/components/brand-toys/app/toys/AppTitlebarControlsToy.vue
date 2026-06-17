<script setup lang="ts">
/* AppTitlebarControlsToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Wraps the pure `<AppTitlebarControls>` primitive in the
   `.app-mockup-root` token cascade so the icon colours pick up
   `--ds-*` correctly inside the brand-toys harness (which forces
   `html.dark` regardless of the toy's intended theme).

   The primitive's left padding (84-px on macOS to clear the traffic
   lights) is exposed via `chromeInsetTarget` for review — toggle
   off to see the bare icon strip without the inset. */

import '../shared.css'
import AppTitlebarControls from '../primitives/chrome/AppTitlebarControls.vue'

withDefaults(
  defineProps<{
    collapsed?: boolean
    chromeInsetTarget?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    collapsed: false,
    chromeInsetTarget: true,
    theme: 'dark',
  }
)
</script>

<template>
  <div class="tbc-toy app-mockup-root" :data-theme="theme">
    <div class="tbc-toy-stage">
      <AppTitlebarControls
        :collapsed="collapsed"
        :chrome-inset-target="chromeInsetTarget"
      />
    </div>
  </div>
</template>

<style scoped>
.tbc-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tbc-toy-stage {
  /* Approximation of where the controls sit on a real macOS desktop
     window — a 44-px sidebar header band with the controls anchored
     to the leading edge. The stage doesn't paint traffic lights so
     the inset behaviour reads as left padding only. */
  background: var(--ds-chrome-bg);
  height: 44px;
  width: 360px;
  display: flex;
  align-items: center;
  border-radius: 6px;
  border: 1px solid var(--ds-divider);
}
</style>
